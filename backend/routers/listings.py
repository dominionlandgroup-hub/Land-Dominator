"""
Active Listings upload — parses a CSV of active land listings,
computes market velocity (months of supply) per ZIP from crm_sold_comps,
and returns per-ZIP velocity metrics.
"""
import csv
import io
import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, File, UploadFile
from fastapi.responses import JSONResponse

from services.supabase_client import get_supabase

router = APIRouter(prefix="/upload", tags=["listings"])

_PRICE_COLS   = {'list price', 'price', 'listing price', 'list_price'}
_ACREAGE_COLS = {'acreage', 'approximate acres', 'acres', 'lot acres', 'lot size', 'acreage_calc'}
_DOM_COLS     = {'dom', 'days on market', 'days_on_market', 'days on mkt'}
_ZIP_COLS     = {'zip', 'postal code', 'zip code', 'zipcode', 'zip_code', 'parcel zip'}
_COUNTY_COLS  = {'county', 'parcel county'}
_STATUS_COLS  = {'status', 'listing status', 'mls status'}


def _find_col(headers: list, aliases: set) -> str | None:
    for h in headers:
        if h.lower().strip() in aliases:
            return h
    return None


@router.post("/listings")
async def upload_listings(file: UploadFile = File(...)):
    """
    Parse an active listings CSV, compute market velocity per ZIP from
    crm_sold_comps monthly solds, and return per-ZIP velocity data.
    """
    raw = await file.read()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))
    headers = list(reader.fieldnames or [])

    price_col   = _find_col(headers, _PRICE_COLS)
    acreage_col = _find_col(headers, _ACREAGE_COLS)
    dom_col     = _find_col(headers, _DOM_COLS)
    zip_col     = _find_col(headers, _ZIP_COLS)
    county_col  = _find_col(headers, _COUNTY_COLS)
    status_col  = _find_col(headers, _STATUS_COLS)

    by_zip: dict[str, dict] = {}
    total_active  = 0
    total_pending = 0
    counties_seen: set = set()

    for row in reader:
        raw_status = (row.get(status_col, "") if status_col else "").strip().lower()
        is_active  = raw_status in ("active", "active listing", "")
        is_pending = raw_status in ("pending", "under contract", "contingent", "active under contract")
        if not (is_active or is_pending):
            continue

        raw_zip = (row.get(zip_col, "") if zip_col else "").strip()
        z = str(raw_zip).split(".")[0].strip()
        if not z or z in ("nan", "None", ""):
            continue

        if county_col:
            county = row.get(county_col, "").strip()
            if county:
                counties_seen.add(county)

        if z not in by_zip:
            by_zip[z] = {"active": 0, "pending": 0, "prices": [], "dom": []}

        if is_active:
            by_zip[z]["active"] += 1
            total_active += 1
        else:
            by_zip[z]["pending"] += 1
            total_pending += 1

        if price_col:
            try:
                by_zip[z]["prices"].append(
                    float(str(row[price_col]).replace(",", "").replace("$", "").strip())
                )
            except (ValueError, TypeError):
                pass

        if dom_col:
            try:
                by_zip[z]["dom"].append(int(float(str(row[dom_col]).strip())))
            except (ValueError, TypeError):
                pass

    if not by_zip:
        return JSONResponse(
            {"error": "No valid listing rows found. Check that ZIP and Status columns are present."},
            status_code=400,
        )

    # Load monthly solds per ZIP from crm_sold_comps (last 12 months)
    monthly_solds_by_zip: dict[str, float] = {}
    try:
        sb = get_supabase()
        cutoff = (datetime.now() - timedelta(days=365)).strftime("%Y-%m-%d")
        offset = 0
        while True:
            batch = (
                sb.table("crm_sold_comps")
                .select("zip_code")
                .gte("sale_date", cutoff)
                .range(offset, offset + 999)
                .execute()
            )
            for r in batch.data or []:
                z = str(r.get("zip_code") or "").split(".")[0].strip()
                if z and z not in ("nan", "None", ""):
                    monthly_solds_by_zip[z] = monthly_solds_by_zip.get(z, 0) + (1.0 / 12.0)
            if len(batch.data or []) < 1000:
                break
            offset += 1000
    except Exception as exc:
        print(f"[listings] Warning: could not load sold comps for velocity: {exc}", flush=True)

    # Build velocity record per ZIP
    zip_velocity: dict[str, dict] = {}
    for z, data in by_zip.items():
        active_count  = data["active"]
        monthly_solds = round(monthly_solds_by_zip.get(z, 0.0), 2)

        if monthly_solds > 0:
            months_supply = round(active_count / monthly_solds, 1)
        else:
            months_supply = 99.0 if active_count > 0 else 0.0

        if months_supply < 3:
            label = "HOT"
        elif months_supply <= 6:
            label = "BALANCED"
        else:
            label = "SLOW"

        avg_dom   = round(sum(data["dom"]) / len(data["dom"])) if data["dom"] else None
        avg_price = round(sum(data["prices"]) / len(data["prices"])) if data["prices"] else None

        zip_velocity[z] = {
            "zip": z,
            "active_count": active_count,
            "pending_count": data["pending"],
            "monthly_solds": monthly_solds,
            "months_supply": months_supply,
            "absorption_rate": round(monthly_solds / active_count, 3) if active_count > 0 else 0.0,
            "velocity_label": label,
            "avg_dom": avg_dom,
            "avg_list_price": avg_price,
        }

    columns_found = [c for c in [price_col, acreage_col, dom_col, zip_col, county_col, status_col] if c]

    return {
        "listings_session_id": str(uuid.uuid4()),
        "total_active": total_active,
        "total_pending": total_pending,
        "zip_count": len(zip_velocity),
        "counties_covered": sorted(counties_seen),
        "columns_found": columns_found,
        "zip_velocity": zip_velocity,
    }
