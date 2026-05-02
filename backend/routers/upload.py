"""
Upload endpoints for comps and target CSVs.
Supports Land Portal format, MLS format, and generic CSV.
Multiple files can be uploaded and merged (append mode, APN-deduped).
"""
import asyncio
import io
import csv
import json
import math
import uuid
import time
from datetime import datetime, timezone
from typing import Optional
import numpy as np
import pandas as pd
from fastapi import APIRouter, UploadFile, File, HTTPException, Query
from fastapi.responses import JSONResponse, Response

from models.schemas import UploadResponse, CompInventoryResponse, CompInventoryItem
from services.csv_parser import parse_csv
from storage.session_store import store_comps, store_targets, get_comps

router = APIRouter(prefix="/upload", tags=["upload"])


def _clean_for_json(obj):
    """Recursively convert numpy scalars / NaN / Inf to JSON-safe Python types."""
    if isinstance(obj, dict):
        return {k: _clean_for_json(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_clean_for_json(v) for v in obj]
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        f = float(obj)
        return None if (math.isnan(f) or math.isinf(f)) else f
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    if isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
        return None
    return obj


# ── DB migration SQL ─────────────────────────────────────────────────────────

_COMPS_MIGRATION_SQL = """
ALTER TABLE crm_sold_comps ADD COLUMN IF NOT EXISTS filename TEXT;
ALTER TABLE crm_sold_comps ADD COLUMN IF NOT EXISTS source_format TEXT DEFAULT 'land_portal';
"""

# ── LLC / buyer type ─────────────────────────────────────────────────────────

_LLC_KEYWORDS = {
    'LLC', 'CORP', 'INC', 'LTD', 'TRUST', 'PROPERTIES', 'HOLDINGS',
    'INVESTMENT', 'DEVELOPMENT', 'VENTURES', 'REALTY', 'GROUP', 'PARTNERS',
    'CAPITAL', 'ASSETS', 'ACQUISITIONS', 'LAND', 'REAL ESTATE',
}


def _buyer_type(buyer_name: str) -> str:
    if not buyer_name:
        return 'INDIVIDUAL'
    upper = buyer_name.upper()
    for kw in _LLC_KEYWORDS:
        if kw in upper:
            return 'LLC'
    return 'INDIVIDUAL'


# ── Format detection ──────────────────────────────────────────────────────────

_LP_INDICATORS = {
    'propertyid', 'parcel county', 'current sale price', 'parcel fips',
    'tlp estimate', 'lot acres', 'buildability total (%)', 'parcel full address',
    'current sale recording date', 'current sale buyer 1 full name',
}
_MLS_INDICATORS = {
    'close price', 'sold price', 'dom', 'days on market',
    'approximate acres', 'mls#', 'listing id', 'mls number', 'close date',
    'sold date', 'cp/acre',
}


def _detect_format(df: pd.DataFrame) -> str:
    """Detect if CSV is Land Portal, MLS, or Generic format."""
    cols_lower = {c.strip().lower() for c in df.columns}
    lp_score  = sum(1 for c in _LP_INDICATORS  if c in cols_lower)
    mls_score = sum(1 for c in _MLS_INDICATORS if c in cols_lower)
    if lp_score >= 3:
        return 'land_portal'
    if mls_score >= 2:
        return 'mls'
    return 'generic'


# ── MLS column normalization ──────────────────────────────────────────────────

# Priority order: first match wins when multiple candidates for same target
_MLS_RENAME: list[tuple[str, str]] = [
    # sale_price
    ("Close Price",        "Current Sale Price"),
    ("Sold Price",         "Current Sale Price"),
    ("Sale Price",         "Current Sale Price"),
    # acreage
    ("Approximate Acres",  "Lot Acres"),
    ("Acreage",            "Lot Acres"),
    ("Acres",              "Lot Acres"),
    ("Lot Size Acres",     "Lot Acres"),
    ("Total Acres",        "Lot Acres"),
    # sale_date
    ("Close Date",         "Current Sale Recording Date"),
    ("Sold Date",          "Current Sale Recording Date"),
    ("Closing Date",       "Current Sale Recording Date"),
    # location
    ("City",               "Parcel City"),
    ("Area",               "Parcel City"),
    ("County",             "Parcel County"),
    ("County Name",        "Parcel County"),
    ("Zip",                "Parcel Zip"),
    ("Zip Code",           "Parcel Zip"),
    ("Postal Code",        "Parcel Zip"),
    ("State",              "Parcel State"),
    ("Street Address",     "Parcel Full Address"),
    ("Address",            "Parcel Full Address"),
    ("Property Address",   "Parcel Full Address"),
    # APN
    ("Parcel Number",      "APN"),
    ("Tax ID",             "APN"),
    ("Parcel ID",          "APN"),
    # extras stored as-is
    ("DOM",                "days_on_market_mls"),
    ("Days on Market",     "days_on_market_mls"),
    ("CP/Acre",            "price_per_acre_mls"),
    ("Price Per Acre",     "price_per_acre_mls"),
    ("$/Acre",             "price_per_acre_mls"),
    ("MLS#",               "mls_id"),
    ("MLS Number",         "mls_id"),
    ("Listing ID",         "mls_id"),
    ("Subdivision",        "subdivision"),
]


def _normalize_mls_df(df: pd.DataFrame) -> pd.DataFrame:
    """Rename MLS column names to Land Portal equivalents."""
    col_map: dict[str, str] = {}
    existing_targets: set[str] = set()
    for src, tgt in _MLS_RENAME:
        if src in df.columns and tgt not in existing_targets and tgt not in df.columns:
            col_map[src] = tgt
            existing_targets.add(tgt)
    return df.rename(columns=col_map)


# ── Census batch geocoder ─────────────────────────────────────────────────────

def _census_batch_geocode(address_rows: list[dict]) -> dict[int, tuple[float, float]]:
    """
    Geocode up to 10 000 addresses using the Census Geocoder batch endpoint.
    address_rows: list of dicts with keys id, address, city, state, zip
    Returns {id: (lat, lon)} for successfully matched rows.
    """
    if not address_rows:
        return {}
    import requests as _req

    buf = io.StringIO()
    writer = csv.writer(buf)
    for r in address_rows:
        writer.writerow([r["id"], r.get("address",""), r.get("city",""), r.get("state",""), r.get("zip","")])

    csv_bytes = buf.getvalue().encode("utf-8")
    url = "https://geocoding.geo.census.gov/geocoder/locations/addressbatch"
    payload = {
        "benchmark": (None, "2020"),
        "returntype": (None, "locations"),
    }

    results: dict[int, tuple[float, float]] = {}
    try:
        resp = _req.post(
            url,
            files={"addressFile": ("addresses.csv", csv_bytes, "text/csv")},
            data={"benchmark": "2020", "returntype": "locations"},
            timeout=120,
        )
        if resp.status_code != 200:
            print(f"[geocode] Census batch HTTP {resp.status_code}", flush=True)
            return {}
        # Parse the response CSV
        reader = csv.reader(io.StringIO(resp.text))
        for parts in reader:
            if len(parts) < 6:
                continue
            try:
                row_id = int(parts[0].strip())
                match_flag = parts[2].strip()
                coords_str = parts[5].strip()
                if match_flag in ("Match", "Tie") and "," in coords_str:
                    lon_str, lat_str = coords_str.split(",", 1)
                    lat = float(lat_str.strip())
                    lon = float(lon_str.strip())
                    if lat and lon:
                        results[row_id] = (lat, lon)
            except (ValueError, IndexError):
                continue
        print(f"[geocode] Census batch geocoded {len(results)}/{len(address_rows)} addresses", flush=True)
    except Exception as exc:
        print(f"[geocode] Census batch error: {exc}", flush=True)

    return results


# ── Core DB save ──────────────────────────────────────────────────────────────

def _safe_float(val) -> "float | None":
    if val is None:
        return None
    try:
        fv = float(val)
        if fv != fv or fv in (float("inf"), float("-inf")):
            return None
        return fv if fv != 0.0 else None
    except (TypeError, ValueError):
        return None


def _save_comps_to_db(
    df: pd.DataFrame,
    filename: str,
    source_format: str,
    append: bool = True,
) -> tuple[int, int, int]:
    """
    Persist comp rows to crm_sold_comps.
    append=True: never delete existing; skip APNs already in DB.
    append=False: delete-then-insert per state (legacy behavior).
    Returns (inserted, skipped_filter, deduped_by_apn).
    """
    try:
        from services.supabase_client import get_supabase
        sb = get_supabase()

        # Ensure filename/source_format columns exist
        try:
            sb.rpc("exec_sql", {"sql": _COMPS_MIGRATION_SQL}).execute()
        except Exception:
            pass

        _sf = _safe_float

        # Determine states present in this upload
        states: list[str] = []
        if "Parcel State" in df.columns:
            states = [
                s for s in df["Parcel State"].dropna().astype(str).str.strip().str.upper().unique()
                if s and s not in ("NAN", "NONE", "")
            ]

        if not append and states:
            # Legacy replace mode: clear existing comps for these states first
            for state in states:
                sb.table("crm_sold_comps").delete().eq("state", state).execute()
            print(f"[comps-db] Replace mode: cleared comps for states {states}", flush=True)

        # For append mode, preload existing APNs so we can skip duplicates
        existing_apns: set[str] = set()
        if append:
            # Load APNs already in DB for any matching states
            for state in (states or [""]):
                q = sb.table("crm_sold_comps").select("apn")
                if state:
                    q = q.eq("state", state)
                res = q.execute()
                for r in (res.data or []):
                    apn = (r.get("apn") or "").strip()
                    if apn:
                        existing_apns.add(apn)
            print(f"[comps-db] Append mode: {len(existing_apns)} existing APNs loaded for dedup", flush=True)

        # Bulk sale detection (same buyer+price+date)
        bulk_key_counts: dict[tuple, int] = {}
        price_col = _col_first(df, ["Current Sale Price", "sale_price"])
        date_col  = _col_first(df, ["Current Sale Recording Date", "sale_date"])
        buyer_col = _col_first(df, ["Current Sale Buyer 1 Full Name", "buyer_name"])
        for _, row in df.iterrows():
            sp = _sf(row.get(price_col)) if price_col else None
            sd = str(row.get(date_col) or "").strip() if date_col else ""
            bn = str(row.get(buyer_col) or "").strip().upper() if buyer_col else ""
            if sp and sp > 0 and sd and bn:
                key = (bn, sp, sd)
                bulk_key_counts[key] = bulk_key_counts.get(key, 0) + 1
        bulk_keys = {k for k, cnt in bulk_key_counts.items() if cnt > 1}

        # Build rows to geocode (MLS comps missing lat/lon)
        needs_geocode: list[dict] = []

        rows: list[dict] = []
        skipped_filter = 0
        deduped = 0

        for idx, row in df.iterrows():
            # Resolve sale_price
            sale_price = _sf(row.get("Current Sale Price"))
            # Acreage: try multiple column names
            acreage = _sf(_col_value(row, ["Lot Acres", "Calc Acreage"]))
            sale_date = str(_col_value(row, ["Current Sale Recording Date"]) or "").strip()
            land_use = str(row.get("Land Use") or "").strip()
            apn = str(_col_value(row, ["APN"]) or "").strip()

            # Filters
            if not sale_price or sale_price <= 0:
                skipped_filter += 1; continue
            if not acreage or acreage <= 0:
                skipped_filter += 1; continue
            if not sale_date or sale_date.lower() in ("nan", "none", ""):
                skipped_filter += 1; continue
            if land_use and "vacant" not in land_use.lower() and "land" not in land_use.lower():
                # MLS comps rarely have land_use; skip filter if column absent
                if "Land Use" in df.columns:
                    skipped_filter += 1; continue
            if acreage <= 0.05:
                skipped_filter += 1; continue
            if sale_price > 5_000_000:
                skipped_filter += 1; continue
            ppa = sale_price / acreage
            if ppa > 2_000_000:
                skipped_filter += 1; continue
            # Bulk sale
            bn = str(_col_value(row, ["Current Sale Buyer 1 Full Name", "buyer_name"]) or "").strip().upper()
            if bulk_keys and (bn, sale_price, sale_date) in bulk_keys:
                skipped_filter += 1; continue

            # APN dedup (append mode)
            if append and apn and apn in existing_apns:
                deduped += 1; continue

            lat = _sf(_col_value(row, ["Latitude", "latitude"]))
            lon = _sf(_col_value(row, ["Longitude", "longitude"]))

            buyer_name = str(_col_value(row, ["Current Sale Buyer 1 Full Name", "buyer_name"]) or "").strip()
            property_id = str(row.get("propertyID") or "").strip() or None
            fips = str(row.get("Parcel FIPS") or "").strip() or None
            if fips and fips.endswith(".0"):
                fips = fips[:-2]

            state_val = str(_col_value(row, ["Parcel State", "state"]) or "").strip() or None
            city_val  = str(_col_value(row, ["Parcel City", "city"]) or "").strip() or None
            zip_val   = str(_col_value(row, ["Parcel Zip", "zip_code"]) or "").strip().split(".")[0] or None
            addr_val  = str(_col_value(row, ["Parcel Full Address", "full_address", "address"]) or "").strip() or None

            _raw_county = str(_col_value(row, ["Parcel County", "Parcel Address County", "county"]) or "").strip()
            _norm_county = _raw_county.lower().replace(" county", "").replace("county", "").strip() if _raw_county else None
            row_dict = {
                "apn":               apn or None,
                "county":            _norm_county or None,
                "state":             state_val,
                "zip_code":          zip_val,
                "acreage":           acreage,
                "sale_price":        sale_price,
                "price_per_acre":    ppa,
                "sale_date":         sale_date or None,
                "latitude":          lat,
                "longitude":         lon,
                "slope_avg":         _sf(_col_value(row, ["Slope AVG", "Average Slope", "Slope", "slope_avg"])),
                "wetlands_coverage": _sf(row.get("Wetlands Coverage")),
                "fema_coverage":     _sf(row.get("FEMA Flood Coverage")),
                "buildability":      _sf(row.get("Buildability total (%)")),
                "road_frontage":     _sf(row.get("Road Frontage")),
                "elevation_avg":     _sf(row.get("Elevation AVG")),
                "land_use":          land_use or None,
                "buyer_name":        buyer_name or None,
                "buyer_type":        _buyer_type(buyer_name),
                "full_address":      addr_val,
                "property_id":       property_id,
                "fips":              fips,
                "source":            source_format,
                "filename":          filename,
                "source_format":     source_format,
            }
            rows.append(row_dict)

            # Queue for geocoding if no coords and MLS format
            if source_format == 'mls' and (lat is None or lon is None):
                needs_geocode.append({
                    "id":      len(rows) - 1,
                    "address": addr_val or "",
                    "city":    city_val or "",
                    "state":   state_val or "",
                    "zip":     zip_val or "",
                })

        print(f"[comps-db] {len(rows)} rows passed filters, {skipped_filter} skipped, {deduped} deduped (APN clash)", flush=True)

        # Geocode MLS rows (batch Census API, up to 10 000 per call)
        geocoded_count = 0
        if needs_geocode:
            print(f"[comps-db] Geocoding {len(needs_geocode)} MLS addresses via Census batch API...", flush=True)
            geo_results = _census_batch_geocode(needs_geocode[:10_000])
            geocoded_count = len(geo_results)
            for item in needs_geocode:
                idx_row = item["id"]
                if idx_row in geo_results:
                    lat_g, lon_g = geo_results[idx_row]
                    rows[idx_row]["latitude"]  = lat_g
                    rows[idx_row]["longitude"] = lon_g

        if not rows:
            print(f"[comps-db] No rows to insert after filtering (all {skipped_filter} skipped)", flush=True)
            return 0, skipped_filter, deduped

        # Insert in chunks with per-chunk error reporting
        CHUNK = 500
        inserted = 0
        insert_errors: list[str] = []
        for i in range(0, len(rows), CHUNK):
            chunk = rows[i:i+CHUNK]
            try:
                res = sb.table("crm_sold_comps").insert(chunk).execute()
                n = len(res.data) if res.data else len(chunk)
                inserted += n
                print(f"[comps-db] Inserted chunk {i}–{i+len(chunk)}: {n} rows saved", flush=True)
            except Exception as chunk_exc:
                msg = str(chunk_exc)
                insert_errors.append(msg)
                print(f"[comps-db] INSERT ERROR chunk {i}–{i+len(chunk)}: {msg}", flush=True)
                # Log first row of failing chunk to diagnose schema mismatch
                if i == 0 and chunk:
                    print(f"[comps-db] First failing row keys: {list(chunk[0].keys())}", flush=True)
                    print(f"[comps-db] First failing row sample: {dict(list(chunk[0].items())[:5])}", flush=True)

        if insert_errors:
            print(f"[comps-db] ⚠ {len(insert_errors)} chunk(s) failed. First error: {insert_errors[0]}", flush=True)

        # Verify final count in DB
        try:
            count_res = sb.table("crm_sold_comps").select("id", count="exact").execute()
            db_total = count_res.count or 0
            print(f"[comps-db] ✓ Done — inserted={inserted}, geocoded={geocoded_count}, DB total now={db_total}", flush=True)
        except Exception:
            print(f"[comps-db] ✓ Done — inserted={inserted}, geocoded={geocoded_count}", flush=True)

        return inserted, skipped_filter, deduped

    except Exception as exc:
        import traceback
        print(f"[comps-db] CRITICAL ERROR: {exc}", flush=True)
        print(f"[comps-db] Traceback: {traceback.format_exc()}", flush=True)
        return 0, 0, 0


def _col_first(df: pd.DataFrame, candidates: list[str]) -> "str | None":
    for c in candidates:
        if c in df.columns:
            return c
    return None


def _col_value(row, candidates: list[str]):
    for c in candidates:
        v = row.get(c)
        if v is not None and str(v).strip() not in ("", "nan", "None"):
            return v
    return None


# ── File size / type guard ────────────────────────────────────────────────────

MAX_SIZE_BYTES = 300 * 1024 * 1024  # 300 MB

COMP_COLS_REQUIRED = [
    'APN', 'Latitude', 'Longitude', 'Lot Acres', 'Parcel Zip',
    'Current Sale Price', 'Current Sale Recording Date',
    'Parcel Full Address', 'Parcel City', 'Parcel State', 'Parcel County',
    'Current Sale Buyer 1 Full Name', 'Current Sale Seller 1 Full Name',
    'FL FEMA Flood Zone', 'Buildability total (%)', 'TLP Estimate',
    'Lot Sq Ft', 'Calc Acreage', 'Parcel Address County',
    'Road Frontage', 'Slope', 'Average Slope', 'Slope AVG',
    'Wetlands Coverage', 'FEMA Flood Coverage', 'Elevation AVG',
    'Land Use', 'propertyID', 'Parcel FIPS',
]

TARGET_COLS_REQUIRED = [
    'APN', 'Assessor Parcel Number', 'Parcel Number', 'Parcel ID',
    'propertyID', 'Property Id', 'Property ID', 'Id',
    'Latitude', 'Longitude', 'Lot Acres', 'Lot Sq Ft',
    'Parcel Zip', 'Parcel City', 'Parcel State', 'Parcel County',
    'Parcel Full Address', 'Parcel Address County',
    'Parcel FIPS', 'Parcel Fips', 'County Code (FIPS)', 'FIPS', 'Fips',
    'Parcel Carrier Code',
    'Owner Name(s)', 'Owner 1 Full Name',
    'Owner 1 First Name', 'Owner 1 Middle Name', 'Owner 1 Last Name',
    'Owner 2 Full Name', 'Owner 2 First Name', 'Owner 2 Last Name',
    'Mail Names', 'Mail Full Address', 'Mail City', 'Mail State', 'Mail Zip', 'Mail County',
    'Mail Care Of', 'Mail Foreign Address Indicator',
    'Do Not Mail',
    'Current Sale Price', 'Current Sale Recording Date', 'Current Sale Contract Date',
    'Prev Sales Price', 'Prev Sale Recording Date',
    'FL FEMA Flood Zone', 'FEMA Flood Coverage',
    'Buildability total (%)', 'TLP Estimate',
    'Vacant Flag', 'Land Locked', 'Road Frontage',
    'Building Sq Ft', 'Building Area', 'Bldg Area',
    'MLS Parcel Acreage', 'Zoning', 'Topography',
    'Total Assessed Value', 'Land Market Value',
    'Phone 1', 'Owner Phone', 'Phone',
    'Slope Avg', 'Elevation Avg', 'Wetlands Coverage', 'School District',
    'Zoning Code', 'Land Use Code', 'Land Use',
]


def slim_to_required(df: pd.DataFrame, required_cols: list) -> pd.DataFrame:
    available = [c for c in required_cols if c in df.columns]
    return df[available].copy()


def downcast_numerics(df: pd.DataFrame) -> pd.DataFrame:
    for col in df.select_dtypes(include=['float64']).columns:
        df[col] = pd.to_numeric(df[col], downcast='float')
    for col in df.select_dtypes(include=['int64']).columns:
        df[col] = pd.to_numeric(df[col], downcast='integer')
    return df


def _validate_file(file: UploadFile) -> None:
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are accepted")


# ── Parse helpers (robust to NaN / None / numpy types) ───────────────────────

def parse_price(val) -> float:
    """Convert any price value to Python float; returns 0.0 for invalid."""
    if val is None:
        return 0.0
    try:
        s = str(val).replace('$', '').replace(',', '').strip()
        if not s or s.lower() in ('nan', 'none', ''):
            return 0.0
        f = float(s)
        return f if (f > 0 and math.isfinite(f)) else 0.0
    except Exception:
        return 0.0


def _parse_coord(row, *keys) -> "float | None":
    """
    Try each key in order and return the first valid non-zero coordinate.
    Handles pandas NaN explicitly — NaN is truthy in Python so 'val or fallback'
    silently skips fallback columns when the primary column is NaN.
    """
    for key in keys:
        val = row.get(key)
        if val is None:
            continue
        s = str(val).strip()
        if s.lower() in ('', 'none', 'nan', '0', '0.0'):
            continue
        try:
            f = float(s)
            if math.isfinite(f) and f != 0.0:
                return f
        except Exception:
            continue
    return None


def parse_float(val) -> "float | None":
    """Convert any value to Python float; returns None for invalid/NaN."""
    if val is None:
        return None
    try:
        f = float(val)
        return f if math.isfinite(f) else None
    except Exception:
        return None


def parse_date(val) -> "str | None":
    """Convert date value to string; returns None for missing/NaN."""
    if val is None:
        return None
    s = str(val).strip()
    return s if s.lower() not in ('nan', 'none', '') else None


# ── Upload comps (single or first-of-many) ────────────────────────────────────

@router.post("/comps")
async def upload_comps(
    file: UploadFile = File(...),
    append: bool = Query(True, description="True = append to existing comps; False = replace state"),
):
    import traceback as _tb

    _validate_file(file)
    content = await file.read()
    if len(content) > MAX_SIZE_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 300 MB)")

    filename = file.filename or "comps.csv"

    # Read raw CSV — bypass parse_csv/slim_to_required so no columns get dropped
    try:
        df = pd.read_csv(io.BytesIO(content), low_memory=False)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Could not parse CSV: {e}")

    print(f"[comps] File read: {len(df)} rows, columns: {list(df.columns[:20])}", flush=True)
    # Log coordinate column detection
    _coord_cols = [c for c in df.columns if c.lower() in ('latitude','longitude','lat','lon','lng','x','y')]
    print(f"[comps] Coordinate columns detected: {_coord_cols}", flush=True)
    if _coord_cols:
        _sample = df[_coord_cols].head(3).to_dict('records')
        print(f"[comps] Coordinate sample (first 3 rows): {_sample}", flush=True)

    rows = []
    _logged_rows = 0
    for _, row in df.iterrows():
        sale_price = parse_price(
            row.get("Current Sale Price") or
            row.get("Close Price") or
            row.get("Sold Price") or
            row.get("sale_price") or 0
        )
        acreage = parse_float(
            row.get("Lot Acres") or
            row.get("Approximate Acres") or
            row.get("Calc Acreage") or
            row.get("Acreage") or
            row.get("Acres") or
            row.get("acreage") or 0
        ) or 0.0
        county = str(
            row.get("Parcel County") or
            row.get("Parcel Address County") or
            row.get("County") or
            row.get("county") or ""
        ).lower().strip().replace(" county", "").replace("county", "").strip()
        state = str(
            row.get("Parcel State") or
            row.get("State") or
            row.get("state") or "TN"
        ).upper().strip()
        zip_code = str(
            row.get("Parcel Zip") or
            row.get("Zip Code") or
            row.get("Postal Code") or
            row.get("zip_code") or ""
        ).strip().replace(".0", "")
        sale_date = parse_date(
            row.get("Current Sale Recording Date") or
            row.get("Close Date") or
            row.get("Sold Date") or
            row.get("sale_date")
        )
        lat = _parse_coord(row, "Latitude", "latitude", "LAT", "lat", "Y", "y")
        lon = _parse_coord(row, "Longitude", "longitude", "LON", "lon", "LNG", "lng", "X", "x")
        apn = str(row.get("APN") or row.get("Parcel Number") or row.get("apn") or "").strip()
        if _logged_rows < 3:
            print(f"Row lat/lon: raw_lat={row.get('Latitude')!r} raw_lon={row.get('Longitude')!r} → {lat} / {lon}", flush=True)
            _logged_rows += 1
        land_use = str(row.get("Land Use") or row.get("land_use") or "").strip()
        buyer_name = str(
            row.get("Current Sale Buyer 1 Full Name") or
            row.get("buyer_name") or ""
        ).strip()
        price_per_acre = sale_price / acreage if acreage > 0 else 0.0
        if _logged_rows <= 3 and sale_price > 0 and acreage > 0:
            print(f"sale_price: {sale_price}, acreage: {acreage}, ppa: {price_per_acre:.2f}", flush=True)

        # Filter mega sales (commercial transactions) and extreme outliers at ingestion
        if sale_price > 5_000_000:
            continue
        if acreage > 0 and price_per_acre > 2_000_000:
            continue

        if sale_price > 0 and acreage > 0:
            rows.append({
                "county":        county or None,
                "state":         state or None,
                "acreage":       float(acreage),
                "sale_price":    float(sale_price),
                "price_per_acre": float(price_per_acre),
                "zip_code":      zip_code or None,
                "sale_date":     sale_date,
                "apn":           apn or None,
                "land_use":      land_use or None,
                "latitude":      lat,
                "longitude":     lon,
                "buyer_name":    buyer_name or None,
                "buyer_type":    _buyer_type(buyer_name),
                "full_address":  str(row.get("Parcel Full Address") or row.get("Address") or "").strip() or None,
                "filename":      filename,
                "source":        "upload",
            })

    geo_count = sum(1 for r in rows if r.get("latitude") and r.get("longitude"))
    print(f"[comps] Valid rows to save: {len(rows)} of {len(df)} | with coordinates: {geo_count}", flush=True)

    # APN dedup — skip rows whose APN is already in DB
    deduped_count = 0
    if rows:
        apns_in_upload = [r["apn"] for r in rows if r.get("apn")]
        if apns_in_upload:
            try:
                from services.supabase_client import get_supabase as _gsb
                _sb = _gsb()
                existing_apns: set[str] = set()
                for i in range(0, len(apns_in_upload), 500):
                    batch = apns_in_upload[i:i + 500]
                    res = _sb.table("crm_sold_comps").select("apn").in_("apn", batch).execute()
                    for r in (res.data or []):
                        if r.get("apn"):
                            existing_apns.add(r["apn"])
                before = len(rows)
                rows = [r for r in rows if not r.get("apn") or r["apn"] not in existing_apns]
                deduped_count = before - len(rows)
                if deduped_count:
                    print(f"[comps] APN dedup: skipped {deduped_count} rows already in DB", flush=True)
            except Exception as _e:
                print(f"[comps] APN dedup check failed (continuing without dedup): {_e}", flush=True)

    if not rows:
        print(f"[comps] No valid rows. Columns present: {list(df.columns)}", flush=True)
        session_id = str(uuid.uuid4())
        store_comps(session_id, df)
        # Still fetch DB total for accurate display
        db_total = 0
        try:
            from services.supabase_client import get_supabase as _gsb2
            _sb2 = _gsb2()
            _ct = _sb2.table("crm_sold_comps").select("id", count="exact").execute()
            db_total = _ct.count or 0
        except Exception:
            pass
        return Response(
            content=json.dumps({
                "status": "ok",
                "saved": 0,
                "parsed": len(df),
                "reason": "No valid rows after filtering — need sale_price > 0 and acreage > 0",
                "columns_found": list(df.columns),
                "session_id": session_id,
                "total_rows": len(df),
                "valid_rows": 0,
                "missing_columns": [],
                "preview": [],
                "saved_to_db": 0,
                "detected_format": _detect_format(df),
                "deduped_count": deduped_count,
                "geocoded_count": 0,
                "db_total": db_total,
            }),
            media_type="application/json"
        )

    # Store for matching engine session
    session_id = str(uuid.uuid4())
    store_comps(session_id, df)
    uploaded_at = datetime.now(timezone.utc).isoformat()
    detected_format = _detect_format(df)

    # Save to database in chunks of 100
    saved = 0
    errors: list[str] = []

    try:
        from services.supabase_client import get_supabase
        supabase = get_supabase()
        print(f"[comps] Supabase client ready — inserting {len(rows)} rows...", flush=True)

        for i in range(0, len(rows), 100):
            chunk = rows[i:i + 100]
            try:
                result = supabase.table('crm_sold_comps').insert(chunk).execute()
                # supabase-py v1: errors in result.error; v2: raises APIError
                if hasattr(result, 'error') and result.error:
                    raise Exception(str(result.error))
                chunk_saved = len(result.data) if result.data else len(chunk)
                saved += chunk_saved
                print(f"[comps] Saved chunk {i}–{i + len(chunk)}: {saved} total", flush=True)
            except Exception as chunk_exc:
                err_msg = str(chunk_exc)
                errors.append(err_msg)
                print(f"[comps] CHUNK ERROR at rows {i}–{i + len(chunk)}: {err_msg}", flush=True)
                _tb.print_exc()

        print(f"[comps] TOTAL SAVED TO DATABASE: {saved}", flush=True)
        if errors:
            print(f"[comps] {len(errors)} chunk(s) failed. First error: {errors[0]}", flush=True)

    except Exception as outer_exc:
        print(f"[comps] OUTER SAVE ERROR: {outer_exc}", flush=True)
        _tb.print_exc()
        errors.append(str(outer_exc))

    # Fetch real DB total after insert
    db_total = 0
    try:
        count_res = supabase.table("crm_sold_comps").select("id", count="exact").execute()
        db_total = count_res.count or 0
        print(f"[comps] DB total after insert: {db_total}", flush=True)
    except Exception:
        pass

    # Build a safe preview (first 5 rows, string-only values)
    preview_cols = {
        "APN", "Parcel County", "County", "Parcel State", "State",
        "Lot Acres", "Approximate Acres", "Current Sale Price", "Close Price",
        "Current Sale Recording Date", "Close Date", "Parcel Zip",
    }
    preview = [
        {str(k): str(v) for k, v in row.items()
         if k in preview_cols and str(v) not in ('nan', 'None', '')}
        for _, row in df.head(5).iterrows()
    ]

    return Response(
        content=json.dumps({
            "status": "ok",
            "saved": saved,
            "parsed": len(df),
            "session_id": session_id,
            "total_rows": len(df),
            "valid_rows": len(rows) + deduped_count,
            "columns_found": list(df.columns),
            "missing_columns": [],
            "preview": preview,
            "uploaded_at": uploaded_at,
            "saved_to_db": saved,
            "detected_format": detected_format,
            "deduped_count": deduped_count,
            "geocoded_count": 0,
            "db_total": db_total,
            "errors": errors[:5],
        }),
        media_type="application/json"
    )


# ── Upload targets ─────────────────────────────────────────────────────────────

@router.post("/targets", response_model=UploadResponse)
async def upload_targets(file: UploadFile = File(...)) -> UploadResponse:
    _validate_file(file)
    content = await file.read()
    if len(content) > MAX_SIZE_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 300 MB)")

    try:
        df, stats = parse_csv(content, is_comps=False)
        df = slim_to_required(df, TARGET_COLS_REQUIRED)
        df = downcast_numerics(df)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    session_id = str(uuid.uuid4())
    store_targets(session_id, df)

    # Persist to Supabase Storage so session survives navigation / server restart
    stats_with_file = {**stats, "filename": file.filename or "targets.csv"}
    try:
        import asyncio as _aio
        loop = _aio.get_running_loop()
        from services.targets_persistence import persist_targets as _persist
        await loop.run_in_executor(None, lambda: _persist(session_id, df, stats_with_file))
    except Exception as _pe:
        print(f"[targets] persist warning: {_pe}", flush=True)

    return UploadResponse(
        session_id=session_id,
        total_rows=stats["total_rows"],
        valid_rows=stats["valid_rows"],
        columns_found=stats["columns_found"],
        missing_columns=stats["missing_columns"],
        preview=stats["preview"],
        uploaded_at=datetime.now(timezone.utc).isoformat(),
        filename=file.filename,
    )


@router.get("/targets/restore")
async def restore_targets_session():
    """
    Restore the latest target session from Supabase Storage.
    Called on app load when the in-memory session has expired.
    Returns a fresh session_id + upload stats.
    """
    from services.targets_persistence import restore_targets as _restore
    try:
        import asyncio as _aio
        loop = _aio.get_running_loop()
        result = await loop.run_in_executor(None, _restore)
    except Exception:
        result = None

    if result is None:
        raise HTTPException(status_code=404, detail="No persisted target session found.")

    new_session_id, df, stats = result
    store_targets(new_session_id, df)

    return {
        "session_id":    new_session_id,
        "total_rows":    stats["total_rows"],
        "valid_rows":    stats["valid_rows"],
        "columns_found": stats["columns_found"],
        "missing_columns": [],
        "preview":       [],
        "filename":      stats.get("filename"),
        "uploaded_at":   stats.get("uploaded_at"),
    }


# ── Restore latest comps session ──────────────────────────────────────────────

@router.get("/comps/latest-session", response_model=UploadResponse)
async def get_latest_comps_session() -> UploadResponse:
    from services.comps_persistence import restore_comps
    result = restore_comps()
    if result is None:
        raise HTTPException(status_code=404, detail="No comps found. Please upload a comps CSV first.")
    session_id, df, stats = result
    if get_comps(session_id) is None:
        store_comps(session_id, df)
    return UploadResponse(
        session_id=session_id,
        total_rows=stats["total_rows"],
        valid_rows=stats["valid_rows"],
        columns_found=stats.get("columns_found", []),
        missing_columns=[],
        preview=[],
        uploaded_at=stats.get("uploaded_at"),
    )


# ── Comp inventory ─────────────────────────────────────────────────────────────

@router.get("/comps/inventory", response_model=CompInventoryResponse)
async def get_comps_inventory() -> CompInventoryResponse:
    """
    Return a list of all uploaded comp files with record counts.
    Groups by (filename, source_format).
    """
    from services.supabase_client import get_supabase
    sb = get_supabase()
    try:
        res = sb.table("crm_sold_comps").select("filename,source_format,state,created_at").execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    rows = res.data or []
    total = len(rows)

    # Group by filename
    groups: dict[str, dict] = {}
    for r in rows:
        fn = r.get("filename") or "unknown"
        sf = r.get("source_format") or "land_portal"
        key = fn
        if key not in groups:
            groups[key] = {
                "filename": fn,
                "source_format": sf,
                "record_count": 0,
                "states": set(),
                "uploaded_at": r.get("created_at"),
            }
        groups[key]["record_count"] += 1
        if r.get("state"):
            groups[key]["states"].add(r["state"])
        # Track earliest created_at as upload date
        cat = r.get("created_at")
        if cat and (groups[key]["uploaded_at"] is None or cat > groups[key]["uploaded_at"]):
            groups[key]["uploaded_at"] = cat

    items = [
        CompInventoryItem(
            filename=g["filename"],
            source_format=g["source_format"],
            record_count=g["record_count"],
            states=sorted(g["states"]),
            uploaded_at=g["uploaded_at"],
        )
        for g in sorted(groups.values(), key=lambda x: x.get("uploaded_at") or "", reverse=True)
    ]

    return CompInventoryResponse(items=items, total_comps=total)


# ── Clear endpoints ────────────────────────────────────────────────────────────

@router.delete("/comps/all")
async def clear_all_comps():
    """Delete all comps from crm_sold_comps."""
    from services.supabase_client import get_supabase
    sb = get_supabase()
    try:
        res = sb.table("crm_sold_comps").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
        deleted = len(res.data) if res.data else 0
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"deleted": deleted}


@router.delete("/comps/state/{state}")
async def clear_comps_by_state(state: str):
    """Delete all comps for a specific state (e.g. TN, FL)."""
    from services.supabase_client import get_supabase
    state = state.strip().upper()
    sb = get_supabase()
    try:
        res = sb.table("crm_sold_comps").delete().eq("state", state).execute()
        deleted = len(res.data) if res.data else 0
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"state": state, "deleted": deleted}


@router.delete("/comps/file/{filename}")
async def clear_comps_by_file(filename: str):
    """Delete all comps from a specific uploaded file."""
    from services.supabase_client import get_supabase
    sb = get_supabase()
    try:
        res = sb.table("crm_sold_comps").delete().eq("filename", filename).execute()
        deleted = len(res.data) if res.data else 0
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"filename": filename, "deleted": deleted}


@router.get("/comps/count")
async def get_comps_count():
    """Return the total number of comps in crm_sold_comps."""
    from services.supabase_client import get_supabase
    try:
        sb = get_supabase()
        res = sb.table("crm_sold_comps").select("id", count="exact").execute()
        return {"count": res.count or 0}
    except Exception as exc:
        return {"count": 0, "error": str(exc)}


@router.get("/comps/db-status")
async def comps_db_status():
    """Diagnostic: count comps in DB, list states, and verify Supabase connectivity."""
    from services.supabase_client import get_supabase
    try:
        sb = get_supabase()
        count_res = sb.table("crm_sold_comps").select("id", count="exact").execute()
        total = count_res.count or 0

        # Sample a few rows to confirm column structure
        sample_res = sb.table("crm_sold_comps").select("state,county,acreage,sale_price,latitude,longitude").limit(5).execute()
        sample = sample_res.data or []

        # State breakdown
        state_res = sb.table("crm_sold_comps").select("state").execute()
        state_counts: dict = {}
        for r in (state_res.data or []):
            s = r.get("state") or "NULL"
            state_counts[s] = state_counts.get(s, 0) + 1

        return {
            "status": "ok",
            "total_comps": total,
            "states": state_counts,
            "sample": sample,
        }
    except Exception as exc:
        return {"status": "error", "detail": str(exc), "total_comps": 0}


@router.post("/comps/normalize-counties")
async def normalize_counties_in_db():
    """One-time migration: strip ' County' suffix from all county values in crm_sold_comps."""
    from services.supabase_client import get_supabase
    sb = get_supabase()
    try:
        # Fetch all rows with a county value
        res = sb.table("crm_sold_comps").select("id,county").not_.is_("county", "null").execute()
        rows = res.data or []
        updated = 0
        for row in rows:
            raw = row.get("county") or ""
            normalized = raw.lower().strip().replace(" county", "").replace("county", "").strip()
            if normalized != raw:
                sb.table("crm_sold_comps").update({"county": normalized}).eq("id", row["id"]).execute()
                updated += 1
        return {"total_checked": len(rows), "updated": updated}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/comps/fix-coordinates")
async def fix_coordinates(file: UploadFile = File(...)):
    """
    Patch NULL lat/lon in crm_sold_comps by re-parsing a previously uploaded file.
    Matches existing records by APN and updates only those with missing coordinates.
    Does not re-insert or duplicate — updates in-place.
    """
    from services.supabase_client import get_supabase
    content = await file.read()
    try:
        df = pd.read_csv(io.BytesIO(content), low_memory=False)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Could not parse CSV: {e}")

    print(f"[fix-coords] File read: {len(df)} rows, columns: {list(df.columns[:20])}", flush=True)
    _coord_cols = [c for c in df.columns if c.lower() in ('latitude', 'longitude', 'lat', 'lon', 'lng', 'x', 'y')]
    print(f"[fix-coords] Coordinate columns: {_coord_cols}", flush=True)

    # Build APN → (lat, lon) map from the file
    apn_coords: dict = {}
    for _, row in df.iterrows():
        apn = str(row.get("APN") or row.get("Parcel Number") or row.get("apn") or "").strip()
        if not apn:
            continue
        lat = _parse_coord(row, "Latitude", "latitude", "LAT", "lat", "Y", "y")
        lon = _parse_coord(row, "Longitude", "longitude", "LON", "lon", "LNG", "lng", "X", "x")
        if lat and lon:
            apn_coords[apn] = (lat, lon)

    print(f"[fix-coords] APNs with coordinates in file: {len(apn_coords)}", flush=True)
    if not apn_coords:
        return {"message": "No coordinate data found in file", "updated": 0}

    sb = get_supabase()
    # Fetch records with NULL coordinates (paginated)
    null_rows: list = []
    offset = 0
    while True:
        res = (sb.table("crm_sold_comps")
               .select("id,apn")
               .is_("latitude", "null")
               .range(offset, offset + 999)
               .execute())
        batch = res.data or []
        null_rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000

    print(f"[fix-coords] DB records with NULL latitude: {len(null_rows)}", flush=True)

    updated = 0
    skipped = 0
    for rec in null_rows:
        apn = str(rec.get("apn") or "").strip()
        coords = apn_coords.get(apn)
        if not coords:
            skipped += 1
            continue
        lat, lon = coords
        sb.table("crm_sold_comps").update({"latitude": lat, "longitude": lon}).eq("id", rec["id"]).execute()
        updated += 1

    print(f"[fix-coords] Updated: {updated}, Skipped (no match): {skipped}", flush=True)
    return {
        "file_apns_with_coords": len(apn_coords),
        "db_null_coord_records": len(null_rows),
        "updated": updated,
        "skipped_no_match": skipped,
    }
