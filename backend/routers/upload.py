"""
Upload endpoints for comps and target CSVs.
"""
import uuid
import threading
from datetime import datetime, timezone
import numpy as np
import pandas as pd
from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse

from models.schemas import UploadResponse
from services.csv_parser import parse_csv
from storage.session_store import store_comps, store_targets, get_comps

router = APIRouter(prefix="/upload", tags=["upload"])


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


def _save_comps_to_db(df: pd.DataFrame) -> int:
    """
    Persist comp rows to crm_sold_comps Supabase table.
    Clears existing comps for the same state(s) before inserting fresh data.
    Returns the count of rows inserted.

    Filters applied:
      - sale_price > 0
      - acreage > 0
      - sale_date not null/empty
      - land_use contains "Vacant" or "Land" (case-insensitive)
    """
    try:
        from services.supabase_client import get_supabase
        sb = get_supabase()

        # Determine which states are in this upload (delete-then-insert per state)
        states: list[str] = []
        if "Parcel State" in df.columns:
            states = [
                s for s in df["Parcel State"].dropna().astype(str).str.strip().str.upper().unique()
                if s and s not in ("NAN", "NONE", "")
            ]
        if states:
            for state in states:
                sb.table("crm_sold_comps").delete().eq("state", state).execute()
            print(f"[comps-db] Cleared existing comps for states: {states}", flush=True)

        def _sf(val) -> "float | None":
            if val is None:
                return None
            try:
                fv = float(val)
                if fv != fv or fv == float("inf") or fv == float("-inf"):
                    return None
                return fv if fv != 0.0 else None
            except (TypeError, ValueError):
                return None

        # First pass: build bulk sale key set (same buyer + same price + same date = subdivision bulk sale)
        bulk_keys: set[tuple] = set()
        bulk_key_counts: dict[tuple, int] = {}
        for _, row in df.iterrows():
            sp = _sf(row.get("Current Sale Price"))
            sd = str(row.get("Current Sale Recording Date") or "").strip()
            bn = str(row.get("Current Sale Buyer 1 Full Name") or "").strip().upper()
            if sp and sp > 0 and sd and bn:
                key = (bn, sp, sd)
                bulk_key_counts[key] = bulk_key_counts.get(key, 0) + 1
        # Any key with >1 occurrence is a bulk sale — exclude all rows matching it
        bulk_keys = {k for k, cnt in bulk_key_counts.items() if cnt > 1}
        print(f"[comps-db] Bulk sale groups detected: {len(bulk_keys)} (rows will be excluded)", flush=True)

        rows = []
        skipped_filter = 0
        skipped_bulk = 0
        for _, row in df.iterrows():
            # Exact LP column names
            sale_price = _sf(row.get("Current Sale Price"))
            acreage_raw = row.get("Lot Acres") or row.get("Calc Acreage")
            acreage = _sf(acreage_raw)
            sale_date = str(row.get("Current Sale Recording Date") or "").strip()
            land_use = str(row.get("Land Use") or "").strip()

            # Apply filters
            if not sale_price or sale_price <= 0:
                skipped_filter += 1
                continue
            if not acreage or acreage <= 0:
                skipped_filter += 1
                continue
            if not sale_date or sale_date.lower() in ("nan", "none", ""):
                skipped_filter += 1
                continue
            lu_lower = land_use.lower()
            if land_use and "vacant" not in lu_lower and "land" not in lu_lower:
                skipped_filter += 1
                continue
            # Zero/micro-acre records (subdivision bulk sales)
            if acreage <= 0.05:
                skipped_filter += 1
                continue
            # Mega commercial transactions
            if sale_price > 5_000_000:
                skipped_filter += 1
                continue
            # Extreme price-per-acre outliers
            ppa_check = sale_price / acreage
            if ppa_check > 2_000_000:
                skipped_filter += 1
                continue
            # Bulk sale (same buyer + price + date = subdivision purchase)
            bn = str(row.get("Current Sale Buyer 1 Full Name") or "").strip().upper()
            if bulk_keys and (bn, sale_price, sale_date) in bulk_keys:
                skipped_bulk += 1
                continue

            price_per_acre = sale_price / acreage if acreage > 0 else None

            buyer_name = str(row.get("Current Sale Buyer 1 Full Name") or "").strip()
            property_id = str(row.get("propertyID") or "").strip() or None
            fips = str(row.get("Parcel FIPS") or "").strip() or None
            # Normalize fips: drop trailing .0
            if fips and fips.endswith(".0"):
                fips = fips[:-2]

            rows.append({
                "apn":               (str(row.get("APN") or "").strip() or None),
                "county":            (str(row.get("Parcel County") or row.get("Parcel Address County") or "").strip() or None),
                "state":             (str(row.get("Parcel State") or "").strip() or None),
                "zip_code":          (str(row.get("Parcel Zip") or "").strip().split(".")[0] or None),
                "acreage":           acreage,
                "sale_price":        sale_price,
                "price_per_acre":    price_per_acre,
                "sale_date":         sale_date or None,
                "latitude":          _sf(row.get("Latitude")),
                "longitude":         _sf(row.get("Longitude")),
                "slope_avg":         _sf(row.get("Slope AVG") or row.get("Average Slope") or row.get("Slope")),
                "wetlands_coverage": _sf(row.get("Wetlands Coverage")),
                "fema_coverage":     _sf(row.get("FEMA Flood Coverage")),
                "buildability":      _sf(row.get("Buildability total (%)")),
                "road_frontage":     _sf(row.get("Road Frontage")),
                "elevation_avg":     _sf(row.get("Elevation AVG")),
                "land_use":          land_use or None,
                "buyer_name":        buyer_name or None,
                "buyer_type":        _buyer_type(buyer_name),
                "full_address":      (str(row.get("Parcel Full Address") or "").strip() or None),
                "property_id":       property_id,
                "fips":              fips,
                "source":            "land_portal",
            })

        print(f"[comps-db] Filtered out {skipped_filter} rows (no price/acreage/date/land_use/outlier)", flush=True)
        print(f"[comps-db] Filtered out {skipped_bulk} rows (bulk sale exclusion)", flush=True)
        print(f"[comps-db] Rows ready for DB insert: {len(rows)}", flush=True)

        CHUNK = 500
        inserted = 0
        for i in range(0, len(rows), CHUNK):
            chunk = rows[i:i + CHUNK]
            sb.table("crm_sold_comps").insert(chunk).execute()
            inserted += len(chunk)
            print(f"[comps-db] Inserted chunk {i}–{i+len(chunk)}: {len(chunk)} rows", flush=True)

        print(f"[comps-db] ✓ Saved {inserted}/{len(rows)} valid comps to crm_sold_comps", flush=True)
        return inserted
    except Exception as exc:
        print(f"[comps-db] ERROR saving comps to DB: {exc}", flush=True)
        return 0

MAX_SIZE_BYTES = 300 * 1024 * 1024  # 300 MB

COMP_COLS_REQUIRED = [
    'APN', 'Latitude', 'Longitude', 'Lot Acres', 'Parcel Zip',
    'Current Sale Price', 'Current Sale Recording Date',
    'Parcel Full Address', 'Parcel City', 'Parcel State', 'Parcel County',
    'Current Sale Buyer 1 Full Name', 'Current Sale Seller 1 Full Name',
    'FL FEMA Flood Zone', 'Buildability total (%)', 'TLP Estimate',
    'Lot Sq Ft', 'Calc Acreage', 'Parcel Address County',
    # Quality fields — preserved when present in LP comp exports
    'Road Frontage', 'Slope', 'Average Slope', 'Slope AVG',
    'Wetlands Coverage', 'FEMA Flood Coverage', 'Elevation AVG',
    # Additional fields needed for DB persistence
    'Land Use', 'propertyID', 'Parcel FIPS',
]

TARGET_COLS_REQUIRED = [
    # APN variants
    'APN', 'Assessor Parcel Number', 'Parcel Number', 'Parcel ID',
    # LP property ID variants (LP exports "Property Id" with lowercase d)
    'propertyID', 'Property Id', 'Property ID', 'Id',
    'Latitude', 'Longitude', 'Lot Acres', 'Lot Sq Ft',
    'Parcel Zip', 'Parcel City', 'Parcel State', 'Parcel County',
    'Parcel Full Address', 'Parcel Address County',
    # FIPS variants (LP exports "Parcel FIPS" with uppercase S)
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
    # Phone
    'Phone 1', 'Owner Phone', 'Phone',
    # Additional LP fields
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



@router.post("/comps", response_model=UploadResponse)
async def upload_comps(file: UploadFile = File(...)) -> UploadResponse:
    """
    Upload and parse a Sold Comps CSV (Land Portal export).
    Returns a session_id used by subsequent dashboard/match calls.
    """
    _validate_file(file)
    content = await file.read()

    if len(content) > MAX_SIZE_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 300 MB)")

    try:
        df, stats = parse_csv(content, is_comps=True)
        df = slim_to_required(df, COMP_COLS_REQUIRED)
        df = downcast_numerics(df)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    session_id = str(uuid.uuid4())
    store_comps(session_id, df)
    uploaded_at = datetime.now(timezone.utc).isoformat()

    # Count valid rows for DB (price > 0 AND acreage > 0 AND has coords)
    db_row_count = int(
        (
            pd.to_numeric(df.get("Current Sale Price", pd.Series(dtype=float)), errors="coerce").fillna(0) > 0
        ).sum()
    ) if "Current Sale Price" in df.columns else stats["valid_rows"]

    # Persist to Supabase Storage AND crm_sold_comps DB in background
    def _persist():
        from services.comps_persistence import persist_comps
        persist_comps(session_id, df, {**stats, "uploaded_at": uploaded_at})
        _save_comps_to_db(df)

    threading.Thread(target=_persist, daemon=True).start()

    return UploadResponse(
        session_id=session_id,
        total_rows=stats["total_rows"],
        valid_rows=stats["valid_rows"],
        columns_found=stats["columns_found"],
        missing_columns=stats["missing_columns"],
        preview=stats["preview"],
        uploaded_at=uploaded_at,
        saved_to_db=db_row_count,
    )


@router.post("/targets", response_model=UploadResponse)
async def upload_targets(file: UploadFile = File(...)) -> UploadResponse:
    """
    Upload and parse a Target Parcels CSV (Land Portal export).
    Returns a target_session_id used by the matching engine.
    """
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

    return UploadResponse(
        session_id=session_id,
        total_rows=stats["total_rows"],
        valid_rows=stats["valid_rows"],
        columns_found=stats["columns_found"],
        missing_columns=stats["missing_columns"],
        preview=stats["preview"],
    )


@router.get("/comps/latest-session", response_model=UploadResponse)
async def get_latest_comps_session() -> UploadResponse:
    """
    Return the latest comps session.
    If the session is still in backend memory, return its stats immediately.
    Otherwise, restore from Supabase Storage (re-hydrates in-memory session).
    Returns 404 if no comps have been uploaded yet.
    """
    from services.comps_persistence import restore_comps

    result = restore_comps()
    if result is None:
        raise HTTPException(
            status_code=404,
            detail="No comps found. Please upload a comps CSV first.",
        )

    session_id, df, stats = result

    # Only store in memory if not already there (avoids overwriting a fresh upload)
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


def _validate_file(file: UploadFile) -> None:
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are accepted")
