"""
CRM module: Properties, Contacts, Deals.
Backed by Supabase (PostgreSQL). Requires SUPABASE_URL + SUPABASE_KEY env vars.
"""
import csv
import io
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx

from fastapi import APIRouter, BackgroundTasks, Body, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse

from models.crm_schemas import (
    Contact, ContactCreate, ContactUpdate,
    CRMCampaign, CRMCampaignCreate, CRMCampaignUpdate,
    Deal, DealCreate, DealUpdate,
    ImportResult,
    Property, PropertyCreate, PropertyUpdate,
)
from services.supabase_client import get_supabase

router = APIRouter(prefix="/crm", tags=["crm"])

# In-memory job stores (single-process Railway deployment)
_import_jobs: dict[str, dict] = {}
_lp_pull_jobs: dict[str, dict] = {}

# ── Helpers ───────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_float(val: object) -> Optional[float]:
    if val is None or str(val).strip() == "":
        return None
    try:
        cleaned = re.sub(r"[^\d.\-]", "", str(val))
        return float(cleaned) if cleaned else None
    except (ValueError, TypeError):
        return None


def _safe_str(val: object) -> Optional[str]:
    if val is None:
        return None
    s = str(val).strip()
    return s if s else None


# ── Pebble CSV column → internal field mapping ────────────────────────

PEBBLE_MAP: dict[str, str] = {
    # APN — including Pebble's verbose column name
    "apn": "apn",
    "parcel number": "apn",
    "parcel_number": "apn",
    "assessor parcel number": "apn",
    "assessor_parcel_number": "apn",
    "property assessor's parcel number (apn)": "apn",
    "property assessors parcel number (apn)": "apn",
    "property assessor parcel number": "apn",
    "parcel id": "apn",
    "parcel_id": "apn",
    "tax id": "apn",

    # Location — including Pebble "County name" / "County state" variants
    "county": "county",
    "county name": "county",
    "state": "state",
    "county state": "state",

    # Acreage — including Pebble "Property acreage"
    "acreage": "acreage",
    "property acreage": "acreage",
    "lot size (acres)": "acreage",
    "lot_size_acres": "acreage",
    "lot acres": "acreage",
    "lot_acres": "acreage",
    "total acres": "acreage",
    "total_acres": "acreage",
    "size (acres)": "acreage",
    "size_acres": "acreage",
    "land area": "acreage",

    # Owner
    "owner name": "owner_full_name",
    "owner_name": "owner_full_name",
    "owner full name": "owner_full_name",
    "owner": "owner_full_name",
    "name": "owner_full_name",
    "first name": "owner_first_name",
    "first_name": "owner_first_name",
    "owner first name": "owner_first_name",
    "last name": "owner_last_name",
    "last_name": "owner_last_name",
    "owner last name": "owner_last_name",

    # Phone
    "phone 1": "owner_phone",
    "phone_1": "owner_phone",
    "phone": "owner_phone",
    "owner phone": "owner_phone",
    "mobile": "owner_phone",
    "cell": "owner_phone",
    "phone 2": "phone_2",
    "phone_2": "phone_2",
    "additional phone number - phone 2": "phone_2",
    "phone 3": "phone_3",
    "phone_3": "phone_3",
    "additional phone number - phone 3": "phone_3",
    "additional phone": "_extra_phone",
    "additional_phone": "_extra_phone",

    # Email
    "email": "owner_email",
    "owner email": "owner_email",
    "e-mail": "owner_email",

    # Mailing address — full address or line 1
    "mailing address": "owner_mailing_address",
    "mailing_address": "owner_mailing_address",
    "mail address": "owner_mailing_address",
    "mail_address": "owner_mailing_address",
    "owner address": "owner_mailing_address",
    "owner address line 1": "owner_mailing_address",

    # Mailing address parts
    "owner address city": "owner_mailing_city",
    "mailing city": "owner_mailing_city",
    "owner address state": "owner_mailing_state",
    "mailing state": "owner_mailing_state",
    "owner address zip": "owner_mailing_zip",
    "mailing zip": "owner_mailing_zip",
    "owner address zip code": "owner_mailing_zip",

    # Land Portal / Pebble IDs
    "property id": "property_id",
    "property_id": "property_id",
    "propertyid": "property_id",
    "prop id": "property_id",
    "prop_id": "property_id",
    "lp property id": "property_id",
    "land portal id": "property_id",
    "county code (fips)": "fips",
    "county code": "fips",
    "fips": "fips",
    "fips code": "fips",
    "fips_code": "fips",
    "county fips": "fips",
    "county_fips": "fips",
    "parcel fips": "fips",

    # Land Portal owner columns
    "owner name(s)": "owner_full_name",
    "mail names": "owner_full_name",          # fallback — see _FALLBACK_COLS
    "owner 1 first name": "owner_first_name",
    "owner 1 last name": "owner_last_name",

    # Land Portal mailing address columns
    "mail full address": "owner_mailing_address",
    "mail city": "owner_mailing_city",
    "mail state": "owner_mailing_state",
    "mail zip": "owner_mailing_zip",

    # Land Portal parcel location columns
    "parcel full address": "property_address",
    "parcel city": "property_city",
    "parcel state": "state",
    "parcel county": "county",
    "parcel zip": "property_zip",

    # Land Portal acreage / estimate
    "calc acreage": "acreage",                # fallback — see _FALLBACK_COLS
    "tlp estimate": "lp_estimate",

    # Land Portal due diligence / analysis
    "total assessed value": "assessed_value",
    "assessed value": "assessed_value",
    "tax delinquent year": "dd_back_taxes",
    "land locked": "land_locked",
    "fema flood coverage": "fema_coverage",
    "wetlands coverage": "wetlands_coverage",
    "buildability total (%)": "buildability",
    "buildability area (acres)": "buildability_acres",
    "elevation avg": "elevation_avg",
    "school district": "school_district",
    "land use": "land_use",
    "road frontage": "road_frontage",
    "slope avg": "slope_avg",

    # Land Portal comp link
    "hyperlink": "comp1_link",

    # Land Portal geo
    "latitude": "latitude",
    "longitude": "longitude",

    # Campaign
    "campaign code": "campaign_code",
    "campaign_code": "campaign_code",
    "campaign": "campaign_code",
    "campaign price": "campaign_price",
    "campaign_price": "campaign_price",
    "offer price": "offer_price",
    "offer_price": "offer_price",

    # Sale / Purchase
    "sale date": "sale_date",
    "sale_date": "sale_date",
    "sold date": "sale_date",
    "sale price": "sale_price",
    "sale_price": "sale_price",
    "sold price": "sale_price",
    "purchase date": "purchase_date",
    "purchase_date": "purchase_date",
    "purchase price": "purchase_price",
    "purchase_price": "purchase_price",

    # Due Diligence
    "access": "dd_access",
    "topography": "dd_topography",
    "flood zone": "dd_flood_zone",
    "flood_zone": "dd_flood_zone",
    "sewer": "dd_sewer",
    "septic": "dd_septic",
    "water": "dd_water",
    "power": "dd_power",
    "utilities": "dd_power",
    "zoning": "dd_zoning",
    "back taxes": "dd_back_taxes",
    "back_taxes": "dd_back_taxes",
    "taxes": "dd_back_taxes",

    # Comp 1
    "comp 1 link": "comp1_link",
    "comp1_link": "comp1_link",
    "comp1 link": "comp1_link",
    "comp 1 price": "comp1_price",
    "comp1_price": "comp1_price",
    "comp1 price": "comp1_price",
    "comp 1 acreage": "comp1_acreage",
    "comp1_acreage": "comp1_acreage",
    "comp1 acreage": "comp1_acreage",

    # Comp 2
    "comp 2 link": "comp2_link",
    "comp2_link": "comp2_link",
    "comp2 link": "comp2_link",
    "comp 2 price": "comp2_price",
    "comp2_price": "comp2_price",
    "comp2 price": "comp2_price",
    "comp 2 acreage": "comp2_acreage",
    "comp2_acreage": "comp2_acreage",
    "comp2 acreage": "comp2_acreage",

    # Comp 3
    "comp 3 link": "comp3_link",
    "comp3_link": "comp3_link",
    "comp3 link": "comp3_link",
    "comp 3 price": "comp3_price",
    "comp3_price": "comp3_price",
    "comp3 price": "comp3_price",
    "comp 3 acreage": "comp3_acreage",
    "comp3_acreage": "comp3_acreage",
    "comp3 acreage": "comp3_acreage",

    # Marketing
    "marketing price": "marketing_price",
    "marketing_price": "marketing_price",
    "list price": "marketing_price",
    "marketing title": "marketing_title",
    "marketing_title": "marketing_title",
    "title": "marketing_title",
    "marketing description": "marketing_description",
    "marketing_description": "marketing_description",
    "description": "marketing_description",
    "nearest city": "marketing_nearest_city",
    "nearest_city": "marketing_nearest_city",
    "city": "marketing_nearest_city",

    # Pricing
    "ghl offer code": "ghl_offer_code",
    "ghl_offer_code": "ghl_offer_code",
    "ghl code": "ghl_offer_code",
    "lp estimate": "lp_estimate",
    "lp_estimate": "lp_estimate",
    "offer range high": "offer_range_high",
    "offer_range_high": "offer_range_high",
    "pricing offer price": "pricing_offer_price",
    "pricing_offer_price": "pricing_offer_price",
    "pebble code": "pebble_code",
    "pebble_code": "pebble_code",
    "claude ai comp": "claude_ai_comp",
    "claude_ai_comp": "claude_ai_comp",
    "ai comp": "claude_ai_comp",

    # Meta
    "tags": "tags",
    "tag": "tags",
    "label": "tags",
    "notes": "notes",
    "note": "notes",
    "status": "status",
}

_FLOAT_FIELDS = {
    "acreage", "campaign_price", "offer_price", "sale_price", "purchase_price",
    "comp1_price", "comp1_acreage", "comp2_price", "comp2_acreage",
    "comp3_price", "comp3_acreage", "marketing_price", "lp_estimate",
    "offer_range_high", "pricing_offer_price", "claude_ai_comp",
    "latitude", "longitude",
    "fema_coverage", "wetlands_coverage", "buildability", "buildability_acres",
    "elevation_avg", "road_frontage", "slope_avg", "assessed_value", "price_per_acre",
}

# Columns that should only fill in a field if it is not already populated by a
# higher-priority column (e.g. "mail names" only fires when "owner name(s)" is absent).
_FALLBACK_COLS: set[str] = {"mail names", "calc acreage"}


def _map_pebble_row(row: dict, col_to_field: dict[str, str]) -> dict:
    """Map one CSV row to a crm_properties insert dict."""
    result: dict = {}
    extra_phones: list[str] = []

    for col, value in row.items():
        field = col_to_field.get(col)
        if field is None:
            continue

        is_fallback = col.strip().lower() in _FALLBACK_COLS

        if field == "tags":
            if value and str(value).strip():
                result["tags"] = [t.strip() for t in re.split(r"[,;|]", str(value)) if t.strip()]
            continue

        if field == "_extra_phone":
            s = _safe_str(value)
            if s:
                extra_phones.append(s)
            continue

        if field in _FLOAT_FIELDS:
            v = _safe_float(value)
            if v is not None and (not is_fallback or field not in result):
                result[field] = v
        else:
            s = _safe_str(value)
            if s and (not is_fallback or field not in result):
                result[field] = s

    if extra_phones:
        result["additional_phones"] = extra_phones

    return result


# ══════════════════════════════════════════════════════════════════════
# DB Migration helpers
# ══════════════════════════════════════════════════════════════════════

_MIGRATION_SQL = """
ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS property_id TEXT;
ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS fips TEXT;
ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS latitude NUMERIC;
ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS longitude NUMERIC;
ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS property_address TEXT;
ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS property_city TEXT;
ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS property_zip TEXT;
ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS assessed_value NUMERIC;
ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS fema_coverage NUMERIC;
ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS wetlands_coverage NUMERIC;
ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS buildability NUMERIC;
ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS buildability_acres NUMERIC;
ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS elevation_avg NUMERIC;
ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS land_locked TEXT;
ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS school_district TEXT;
ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS land_use TEXT;
ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS road_frontage NUMERIC;
ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS slope_avg NUMERIC;
ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS price_per_acre NUMERIC;
""".strip()


@router.get("/db-check")
async def db_check_columns() -> dict:
    """Verify that the property_id and fips columns exist in crm_properties."""
    try:
        sb = get_supabase()
        row = sb.table("crm_properties").select("property_id,fips").limit(1).execute()
        return {"property_id_exists": True, "fips_exists": True, "status": "ok"}
    except Exception as exc:
        msg = str(exc)
        return {
            "property_id_exists": "property_id" not in msg,
            "fips_exists": "fips" not in msg,
            "status": "missing_columns",
            "error": msg,
            "fix_sql": _MIGRATION_SQL,
            "instructions": (
                "Run the SQL below in your Supabase dashboard → SQL Editor → New Query, "
                "then call POST /crm/db-migrate to confirm."
            ),
        }


@router.post("/db-migrate")
async def db_migrate() -> dict:
    """
    Add property_id and fips columns to crm_properties if missing.
    Uses Supabase Management API via SUPABASE_URL + SUPABASE_KEY (service role).
    If that fails, returns the SQL to run manually.
    """
    supabase_url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    supabase_key = os.environ.get("SUPABASE_KEY", "")

    if not supabase_url or not supabase_key:
        raise HTTPException(status_code=503, detail="SUPABASE_URL or SUPABASE_KEY not configured")

    # Try Supabase REST pg endpoint (works with service role key on some versions)
    errors_tried: list[str] = []
    for sql_url in [
        f"{supabase_url}/pg/query",
        f"{supabase_url}/rest/v1/rpc/exec_sql",
    ]:
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                r = await client.post(
                    sql_url,
                    json={"query": _MIGRATION_SQL},
                    headers={
                        "apikey": supabase_key,
                        "Authorization": f"Bearer {supabase_key}",
                        "Content-Type": "application/json",
                    },
                )
                if r.status_code < 300:
                    return {"status": "ok", "message": "Columns added successfully"}
                errors_tried.append(f"{sql_url}: HTTP {r.status_code} — {r.text[:120]}")
        except Exception as exc:
            errors_tried.append(f"{sql_url}: {exc}")

    return {
        "status": "manual_required",
        "message": "Could not auto-apply migration. Run the SQL below in Supabase dashboard → SQL Editor.",
        "sql": _MIGRATION_SQL,
        "errors_tried": errors_tried,
    }


# ══════════════════════════════════════════════════════════════════════
# Properties
# ══════════════════════════════════════════════════════════════════════


def _safe_batch_insert(sb: Any, rows: list[dict]) -> tuple[int, list[str]]:
    """Insert a batch into crm_properties, stripping any unmigrated columns on failure.

    Returns (imported_count, warning_messages).
    If the error is not column-related, falls back to per-row inserts so good rows still land.
    """
    if not rows:
        return 0, []

    current = list(rows)
    warnings: list[str] = []

    for _ in range(12):  # up to 12 distinct unknown columns before giving up
        try:
            sb.table("crm_properties").insert(current).execute()
            return len(current), warnings
        except Exception as exc:
            err_msg = str(exc)
            col_match = re.search(r'column "([^"]+)" of relation', err_msg)
            if col_match:
                bad_col = col_match.group(1)
                warnings.append(f"Stripped unmigrated column '{bad_col}' (run ALTER TABLE)")
                print(f"[import] Stripping unmigrated column '{bad_col}' from batch and retrying")
                current = [{k: v for k, v in d.items() if k != bad_col} for d in current]
                continue
            # Not a missing-column error — fall back to per-row inserts
            print(f"[import] Batch insert error: {err_msg[:300]}")
            imported = 0
            row_errors: list[str] = []
            for j, row_data in enumerate(current):
                try:
                    sb.table("crm_properties").insert(row_data).execute()
                    imported += 1
                except Exception as row_exc:
                    row_errors.append(f"Row {j + 1}: {str(row_exc)[:150]}")
            return imported, warnings + row_errors

    return len(current), warnings

@router.post("/properties/import", status_code=202)
async def import_properties(
    file: UploadFile = File(...),
    background_tasks: BackgroundTasks = BackgroundTasks(),
) -> dict:
    """Start a background import job. Returns job_id immediately (no timeout risk)."""
    content = await file.read()
    job_id = str(uuid.uuid4())
    _import_jobs[job_id] = {"status": "pending"}
    background_tasks.add_task(_run_import_job, job_id, content)
    return {"job_id": job_id}


def _run_import_job(job_id: str, content: bytes) -> None:
    """Synchronous worker — FastAPI runs this in a thread pool via BackgroundTasks."""
    try:
        try:
            text = content.decode("utf-8-sig")
        except UnicodeDecodeError:
            text = content.decode("latin-1")

        reader = csv.DictReader(io.StringIO(text))
        if not reader.fieldnames:
            _import_jobs[job_id] = {"status": "error", "error": "CSV has no headers"}
            return

        col_to_field: dict[str, str] = {}
        for raw_col in reader.fieldnames:
            canonical = raw_col.strip().lower()
            if canonical in PEBBLE_MAP:
                col_to_field[raw_col] = PEBBLE_MAP[canonical]

        imported = 0
        skipped = 0
        errors: list[str] = []
        now = _now()

        sb = get_supabase()
        batch: list[dict] = []

        for i, row in enumerate(reader):
            try:
                data = _map_pebble_row(row, col_to_field)
                if not data:
                    skipped += 1
                    continue
                data["updated_at"] = now
                if not data.get("offer_price") and data.get("lp_estimate"):
                    data["offer_price"] = round(float(data["lp_estimate"]) * 0.525, 2)
                batch.append(data)
                if len(batch) >= 500:
                    n, warns = _safe_batch_insert(sb, batch)
                    imported += n
                    skipped += len(batch) - n
                    errors.extend(warns)
                    batch = []
            except Exception as exc:
                errors.append(f"Row {i + 2}: {exc}")
                skipped += 1

        if batch:
            n, warns = _safe_batch_insert(sb, batch)
            imported += n
            skipped += len(batch) - n
            errors.extend(warns)

        _import_jobs[job_id] = {
            "status": "done",
            "result": {"imported": imported, "skipped": skipped, "errors": errors[:20]},
        }
    except Exception as exc:
        _import_jobs[job_id] = {"status": "error", "error": str(exc)}


@router.get("/properties/import-status/{job_id}")
async def get_import_status(job_id: str) -> dict:
    """Poll for import job completion."""
    job = _import_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Import job not found or server was restarted")
    return job


@router.post("/properties/import-batch", response_model=ImportResult)
async def import_properties_batch(
    rows: List[Dict[str, str]] = Body(...),
) -> ImportResult:
    """Accept pre-parsed CSV rows from frontend batch processing, map columns, insert."""
    if not rows:
        return ImportResult(imported=0, skipped=0, errors=[])

    col_to_field: dict[str, str] = {}
    for raw_col in rows[0].keys():
        canonical = raw_col.strip().lower()
        if canonical in PEBBLE_MAP:
            col_to_field[raw_col] = PEBBLE_MAP[canonical]

    imported = 0
    skipped = 0
    errors: list[str] = []
    now = _now()

    try:
        sb = get_supabase()
        batch: list[dict] = []

        for i, raw_row in enumerate(rows):
            try:
                data = _map_pebble_row(raw_row, col_to_field)
                if not data:
                    skipped += 1
                    continue
                data["updated_at"] = now
                if not data.get("offer_price") and data.get("lp_estimate"):
                    data["offer_price"] = round(float(data["lp_estimate"]) * 0.525, 2)
                batch.append(data)
                if len(batch) >= 50:
                    n, warns = _safe_batch_insert(sb, batch)
                    imported += n
                    skipped += len(batch) - n
                    errors.extend(warns)
                    batch = []
            except Exception as exc:
                errors.append(f"Row {i + 1}: {exc}")
                skipped += 1

        if batch:
            n, warns = _safe_batch_insert(sb, batch)
            imported += n
            skipped += len(batch) - n
            errors.extend(warns)

    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return ImportResult(imported=imported, skipped=skipped, errors=errors[:20])


# ── CRM Campaigns ─────────────────────────────────────────────────────


@router.get("/campaigns")
async def list_crm_campaigns() -> list:
    """List CRM import campaigns with their property counts and key status counts."""
    try:
        sb = get_supabase()
        campaigns = sb.table("crm_campaigns").select("*").order("created_at", desc=True).execute().data
        key_statuses = ["offer_sent", "under_contract", "closed_won"]
        for c in campaigns:
            r = sb.table("crm_properties").select("*", count="exact").eq("campaign_id", c["id"]).limit(0).execute()
            c["property_count"] = r.count or 0
            by_status: dict = {}
            for s in key_statuses:
                rs = sb.table("crm_properties").select("*", count="exact").eq("campaign_id", c["id"]).eq("status", s).limit(0).execute()
                by_status[s] = rs.count or 0
            c["by_status"] = by_status
        return campaigns
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/campaigns", status_code=201)
async def create_crm_campaign(body: CRMCampaignCreate) -> dict:
    try:
        sb = get_supabase()
        data = body.model_dump(exclude_none=True)
        data["updated_at"] = _now()
        res = sb.table("crm_campaigns").insert(data).execute()
        row = res.data[0]
        row["property_count"] = 0
        return row
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/campaigns/{campaign_id}")
async def get_crm_campaign(campaign_id: str) -> dict:
    """Return a single campaign with detailed per-status property counts."""
    try:
        sb = get_supabase()
        res = sb.table("crm_campaigns").select("*").eq("id", campaign_id).execute()
        if not res.data:
            raise HTTPException(status_code=404, detail="Campaign not found")
        c = res.data[0]
        total_res = sb.table("crm_properties").select("*", count="exact").eq("campaign_id", campaign_id).limit(0).execute()
        c["property_count"] = total_res.count or 0
        statuses = ["lead", "prospect", "offer_sent", "under_contract",
                    "due_diligence", "closed_won", "closed_lost", "dead"]
        by_status: dict = {}
        for s in statuses:
            r = sb.table("crm_properties").select("*", count="exact").eq("campaign_id", campaign_id).eq("status", s).limit(0).execute()
            by_status[s] = r.count or 0
        c["by_status"] = by_status
        return c
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.patch("/campaigns/{campaign_id}")
async def update_crm_campaign(campaign_id: str, body: CRMCampaignUpdate) -> dict:
    try:
        sb = get_supabase()
        data = body.model_dump(exclude_none=True)
        if not data:
            raise HTTPException(status_code=400, detail="Nothing to update")
        data["updated_at"] = _now()
        res = sb.table("crm_campaigns").update(data).eq("id", campaign_id).execute()
        if not res.data:
            raise HTTPException(status_code=404, detail="Campaign not found")
        return res.data[0]
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.delete("/campaigns/{campaign_id}", status_code=204)
async def delete_crm_campaign(campaign_id: str) -> None:
    try:
        sb = get_supabase()
        # Unlink properties before deleting
        sb.table("crm_properties").update({"campaign_id": None}).eq("campaign_id", campaign_id).execute()
        sb.table("crm_campaigns").delete().eq("id", campaign_id).execute()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# ── Land Portal bulk pull (campaign) ──────────────────────────────────


@router.post("/campaigns/{campaign_id}/pull-lp-data", status_code=202)
async def start_campaign_lp_pull(
    campaign_id: str,
    background_tasks: BackgroundTasks,
) -> dict:
    """Start a background job to pull LP estimates for all properties in a campaign."""
    job_id = str(uuid.uuid4())
    _lp_pull_jobs[job_id] = {"status": "running", "done": 0, "total": 0, "errors": []}
    background_tasks.add_task(_run_lp_pull_job, job_id, campaign_id)
    return {"job_id": job_id}


@router.get("/campaigns/{campaign_id}/pull-lp-status/{job_id}")
async def get_campaign_lp_pull_status(campaign_id: str, job_id: str) -> dict:
    job = _lp_pull_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found or server was restarted")
    return job


def _run_lp_pull_job(job_id: str, campaign_id: str) -> None:
    """Synchronous background worker — calls Land Portal API for each property in the campaign."""
    token = os.environ.get("LAND_PORTAL_TOKEN", "")
    if not token:
        _lp_pull_jobs[job_id] = {"status": "error", "done": 0, "total": 0, "errors": [], "error": "LAND_PORTAL_TOKEN not configured"}
        return

    try:
        sb = get_supabase()
        all_props: list[dict] = []
        offset = 0
        while True:
            # Use select("*") — avoids hard failure if property_id/fips columns
            # haven't been added to the table yet via ALTER TABLE.
            r = (sb.table("crm_properties")
                 .select("*")
                 .eq("campaign_id", campaign_id)
                 .range(offset, offset + 999)
                 .execute())
            if not r.data:
                break
            all_props.extend(r.data)
            if len(r.data) < 1000:
                break
            offset += 1000

        eligible = [p for p in all_props if p.get("property_id") and p.get("fips")]
        _lp_pull_jobs[job_id]["total"] = len(eligible)
        # Detect missing column vs just empty values
        if not eligible and all_props and "property_id" not in all_props[0]:
            _lp_pull_jobs[job_id] = {
                "status": "error", "done": 0, "total": 0, "errors": [],
                "error": "property_id column missing in database — call POST /crm/db-migrate to add it",
            }
            return
    except Exception as exc:
        _lp_pull_jobs[job_id] = {"status": "error", "done": 0, "total": 0, "errors": [], "error": str(exc)}
        return

    done = 0
    errors: list[str] = []

    _LP_URL = "https://landportal.com/wp-json/lp-rest-api/v1/property-data"
    _LP_HEADERS_BASE = {"Authorization": f"Bearer {token}"}

    def _lp_post(client: httpx.Client, pid: str, fips_val: str) -> dict:
        """POST to Land Portal, falling back to form-encoded if JSON returns 404."""
        r = client.post(
            _LP_URL,
            json={"propertyid": pid, "fips": fips_val},
            headers={**_LP_HEADERS_BASE, "Content-Type": "application/json"},
        )
        if r.status_code == 404:
            # Some WP REST plugins reject JSON — retry with form-encoded body
            r = client.post(
                _LP_URL,
                data={"propertyid": pid, "fips": fips_val},
                headers=_LP_HEADERS_BASE,
            )
        r.raise_for_status()
        return r.json()

    with httpx.Client(timeout=30.0) as client:
        for prop in eligible:
            try:
                data = _lp_post(client, prop["property_id"], prop["fips"])

                lp_prop = data.get("property", {})
                price_acre_mean = _safe_float(lp_prop.get("price_acre_mean"))
                size = _safe_float(lp_prop.get("size")) or _safe_float(prop.get("acreage"))

                updates: dict = {}
                if price_acre_mean is not None:
                    updates["price_per_acre"] = round(price_acre_mean, 2)
                    if size:
                        lp_estimate = round(price_acre_mean * size, 2)
                        updates["lp_estimate"] = lp_estimate
                        updates["offer_price"] = round(lp_estimate * 0.525, 2)

                comps = data.get("list_of_rows_data", [])
                for i, comp in enumerate(comps[:3], 1):
                    link = _safe_str(comp.get("link") or comp.get("url") or comp.get("listing_url") or comp.get("property_url"))
                    if not link:
                        comp_apn = _safe_str(comp.get("apn") or comp.get("parcel_number") or comp.get("parcel_id"))
                        comp_fips = _safe_str(comp.get("fips") or comp.get("county_fips")) or prop.get("fips")
                        if comp_apn and comp_fips:
                            link = f"https://landportal.com/property/{comp_fips}/{comp_apn}"
                    price = _safe_float(comp.get("mls_price") or comp.get("price") or comp.get("sale_price") or comp.get("sold_price"))
                    acreage = _safe_float(comp.get("area_acres") or comp.get("acreage") or comp.get("size") or comp.get("lot_size"))
                    if link:
                        updates[f"comp{i}_link"] = link
                    if price is not None:
                        updates[f"comp{i}_price"] = price
                    if acreage is not None:
                        updates[f"comp{i}_acreage"] = acreage

                if updates:
                    updates["updated_at"] = _now()
                    sb.table("crm_properties").update(updates).eq("id", prop["id"]).execute()

            except Exception as exc:
                errors.append(f"Property {prop['id'][:8]}: {str(exc)[:80]}")

            done += 1
            _lp_pull_jobs[job_id]["done"] = done

    _lp_pull_jobs[job_id]["status"] = "done"
    _lp_pull_jobs[job_id]["errors"] = errors[:20]


# ── Property Bulk Import ───────────────────────────────────────────────


@router.post("/properties/bulk", response_model=ImportResult)
async def bulk_insert_properties(
    rows: List[Dict[str, str]] = Body(...),
    campaign_id: Optional[str] = Query(None),
) -> ImportResult:
    """Accept a chunk of pre-parsed CSV rows from frontend, map columns, insert immediately."""
    if not rows:
        return ImportResult(imported=0, skipped=0, errors=[])

    col_to_field: dict[str, str] = {}
    for raw_col in rows[0].keys():
        canonical = raw_col.strip().lower()
        if canonical in PEBBLE_MAP:
            col_to_field[raw_col] = PEBBLE_MAP[canonical]

    print(f"[bulk_insert] {len(rows)} rows received. col_to_field={col_to_field}")

    # Pre-fetch campaign number and existing record count for auto offer code generation
    campaign_number: int = 0
    starting_record: int = 1
    sb = get_supabase()
    if campaign_id:
        try:
            camp_res = sb.table("crm_campaigns").select("id").order("created_at", desc=False).execute()
            camp_ids = [r["id"] for r in camp_res.data]
            campaign_number = camp_ids.index(campaign_id) + 1 if campaign_id in camp_ids else 1
            count_res = sb.table("crm_properties").select("*", count="exact").eq("campaign_id", campaign_id).limit(0).execute()
            starting_record = (count_res.count or 0) + 1
        except Exception:
            campaign_number = 1
            starting_record = 1

    mapped: list[dict] = []
    skipped = 0
    errors: list[str] = []
    now = _now()
    valid_index = 0

    for i, raw_row in enumerate(rows):
        try:
            data = _map_pebble_row(raw_row, col_to_field)
            if not data:
                skipped += 1
                continue
            data["updated_at"] = now
            if campaign_id:
                data["campaign_id"] = campaign_id
                if not data.get("campaign_code") and campaign_number:
                    record_num = starting_record + valid_index
                    data["campaign_code"] = f"{campaign_number:03d}-{record_num:05d}"
            if not data.get("offer_price") and data.get("lp_estimate"):
                data["offer_price"] = round(float(data["lp_estimate"]) * 0.525, 2)
            valid_index += 1
            mapped.append(data)
        except Exception as exc:
            errors.append(f"Row {i + 1} mapping: {exc}")
            skipped += 1

    if not mapped:
        print(f"[bulk_insert] 0 rows mapped from {len(rows)} input rows. col_to_field keys: {list(col_to_field.keys())}")
        return ImportResult(imported=0, skipped=skipped, errors=errors[:20])

    print(f"[bulk_insert] First mapped row sample: {dict(list(mapped[0].items())[:8])}")

    imported, insert_warns = _safe_batch_insert(sb, mapped)
    skipped += len(mapped) - imported
    errors.extend(insert_warns)

    print(f"[bulk_insert] Done: imported={imported}, skipped={skipped}, errors={errors[:3]}")
    return ImportResult(imported=imported, skipped=skipped, errors=errors[:20])


@router.post("/properties/bulk-delete", status_code=204)
async def bulk_delete_properties(ids: List[str] = Body(...)) -> None:
    """Delete multiple properties by ID."""
    if not ids:
        return
    try:
        sb = get_supabase()
        sb.table("crm_properties").delete().in_("id", ids).execute()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/properties/bulk-delete-filtered", status_code=204)
async def bulk_delete_filtered_properties(
    status: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    county: Optional[str] = Query(None),
    campaign_id: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
) -> None:
    """Delete all properties matching the given filters (or all properties if no filters provided)."""
    try:
        sb = get_supabase()
        has_filters = any([status, state, county, campaign_id, search])
        if not has_filters:
            sb.table("crm_properties").delete().gte("created_at", "1900-01-01T00:00:00+00:00").execute()
        else:
            q = sb.table("crm_properties").delete().gte("created_at", "1900-01-01T00:00:00+00:00")
            if status:
                q = q.eq("status", status)
            if state:
                q = q.eq("state", state)
            if county:
                q = q.ilike("county", f"%{county}%")
            if campaign_id:
                q = q.eq("campaign_id", campaign_id)
            if search:
                q = q.or_(f"owner_full_name.ilike.%{search}%,apn.ilike.%{search}%")
            q.execute()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/properties/counts")
async def get_property_counts() -> dict:
    """Return total and per-status counts without loading all data."""
    try:
        sb = get_supabase()
        statuses = ["lead", "prospect", "offer_sent", "under_contract",
                    "due_diligence", "closed_won", "closed_lost", "dead"]
        total_res = sb.table("crm_properties").select("*", count="exact").limit(0).execute()
        total = total_res.count or 0
        by_status: dict = {}
        for s in statuses:
            r = sb.table("crm_properties").select("*", count="exact").eq("status", s).limit(0).execute()
            by_status[s] = r.count or 0
        return {"total": total, "by_status": by_status}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.delete("/properties/all")
async def delete_all_properties() -> dict:
    """
    Clear all properties.
    1. Null out campaign_id to avoid FK constraint violations.
    2. Null out any other FK columns.
    3. Count rows, then delete.
    """
    try:
        sb = get_supabase()
        # Count first
        count_res = sb.table("crm_properties").select("*", count="exact").limit(0).execute()
        count = count_res.count or 0

        # Step 1: clear all FK references so cascade constraints don't block delete
        sb.table("crm_properties").update({
            "campaign_id": None,
        }).gte("created_at", "1900-01-01T00:00:00+00:00").execute()

        # Step 2: clear any deals that reference these properties to avoid reverse FK
        sb.table("crm_deals").update({
            "property_id": None,
        }).gte("created_at", "1900-01-01T00:00:00+00:00").execute()

        # Step 3: delete
        sb.table("crm_properties").delete().gte("created_at", "1900-01-01T00:00:00+00:00").execute()

        return {"deleted": True, "count": count}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/properties")
async def list_properties(
    status: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    county: Optional[str] = Query(None),
    campaign_id: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=500),
) -> dict:
    try:
        sb = get_supabase()
        offset = (page - 1) * limit
        q = (sb.table("crm_properties")
             .select("*", count="exact")
             .order("created_at", desc=True)
             .range(offset, offset + limit - 1))
        if status:
            q = q.eq("status", status)
        if state:
            q = q.eq("state", state)
        if county:
            q = q.ilike("county", f"%{county}%")
        if campaign_id:
            q = q.eq("campaign_id", campaign_id)
        if search:
            q = q.or_(f"owner_full_name.ilike.%{search}%,apn.ilike.%{search}%,campaign_code.ilike.%{search}%")
        result = q.execute()
        return {"data": result.data, "total": result.count or 0, "page": page, "limit": limit}
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/properties", response_model=Property, status_code=201)
async def create_property(body: PropertyCreate) -> dict:
    try:
        sb = get_supabase()
        data = body.model_dump(exclude_none=True)
        data["updated_at"] = _now()
        res = sb.table("crm_properties").insert(data).execute()
        return res.data[0]
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/properties/export-csv")
async def export_properties_csv(
    status: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    county: Optional[str] = Query(None),
    campaign_id: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    fmt: str = Query("full"),
) -> StreamingResponse:
    """Export all matching properties as a CSV file download."""
    try:
        sb = get_supabase()
        page_size = 1000
        all_rows: List[dict] = []
        page = 0
        while True:
            q = (sb.table("crm_properties")
                 .select("*")
                 .order("created_at", desc=True)
                 .range(page * page_size, (page + 1) * page_size - 1))
            if status:
                q = q.eq("status", status)
            if state:
                q = q.eq("state", state)
            if county:
                q = q.ilike("county", f"%{county}%")
            if campaign_id:
                q = q.eq("campaign_id", campaign_id)
            if search:
                q = q.or_(f"owner_full_name.ilike.%{search}%,apn.ilike.%{search}%")
            result = q.execute()
            batch = result.data or []
            all_rows.extend(batch)
            if len(batch) < page_size:
                break
            page += 1

        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        output = io.StringIO()
        writer = csv.writer(output)

        # Shared full column set for both export types
        HEADERS = [
            "Owner Full Name", "Owner First Name", "Owner Last Name",
            "Owner Phone", "Owner Email",
            "Owner Address Line 1", "Owner Address City", "Owner Address State", "Owner Address Zip",
            "Property Address", "Property City", "Property State", "Property Zip",
            "APN", "County", "State", "Acreage",
            "Campaign Code", "Campaign Price", "Offer Price", "LP Estimate",
            "Status", "Tags", "Property ID", "FIPS",
        ]
        FIELDS = [
            "owner_full_name", "owner_first_name", "owner_last_name",
            "owner_phone", "owner_email",
            "owner_mailing_address", "owner_mailing_city", "owner_mailing_state", "owner_mailing_zip",
            "property_address", "property_city", "state", "property_zip",
            "apn", "county", "state", "acreage",
            "campaign_code", "campaign_price", "offer_price", "lp_estimate",
            "status", "_tags", "property_id", "fips",
        ]

        def _row_values(row: dict) -> list:
            out = []
            for f in FIELDS:
                if f == "_tags":
                    tags = row.get("tags") or []
                    out.append(",".join(str(t) for t in tags) if isinstance(tags, list) else str(tags))
                else:
                    out.append(row.get(f, "") or "")
            return out

        writer.writerow(HEADERS)
        for row in all_rows:
            writer.writerow(_row_values(row))

        if fmt == "mailhouse":
            safe_name = (campaign_id or status or "export").replace(" ", "_").lower()
            filename = f"{safe_name}-maillist-{today}.csv"
        else:
            filename = f"properties-export-{today}.csv"

        csv_bytes = output.getvalue().encode("utf-8")
        return StreamingResponse(
            iter([csv_bytes]),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/properties/{property_id}/pull-lp-data")
async def pull_lp_data_for_property(property_id: str) -> dict:
    """Call Land Portal API to pull lp_estimate, offer_price, and comps for a single property."""
    token = os.environ.get("LAND_PORTAL_TOKEN", "")
    if not token:
        raise HTTPException(status_code=503, detail="LAND_PORTAL_TOKEN not configured in environment")

    sb = get_supabase()
    res = sb.table("crm_properties").select("*").eq("id", property_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Property not found")

    prop = res.data[0]
    lp_pid = prop.get("property_id")
    fips = prop.get("fips")

    if not lp_pid or not fips:
        raise HTTPException(
            status_code=422,
            detail="Property is missing property_id or fips — import from Pebble CSV first"
        )

    _lp_url = "https://landportal.com/wp-json/lp-rest-api/v1/property-data"
    _lp_headers_base = {"Authorization": f"Bearer {token}"}
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.post(
                _lp_url,
                json={"propertyid": lp_pid, "fips": fips},
                headers={**_lp_headers_base, "Content-Type": "application/json"},
            )
            if r.status_code == 404:
                # Retry with form-encoded body — some WP REST plugins reject JSON
                r = await client.post(
                    _lp_url,
                    data={"propertyid": lp_pid, "fips": fips},
                    headers=_lp_headers_base,
                )
            r.raise_for_status()
        data = r.json()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail=f"Land Portal error {exc.response.status_code}: {exc.response.text[:200]}")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Land Portal request failed: {exc}")

    lp_prop = data.get("property", {})
    price_acre_mean = _safe_float(lp_prop.get("price_acre_mean"))
    size = _safe_float(lp_prop.get("size")) or _safe_float(prop.get("acreage"))

    updates: dict = {}
    if price_acre_mean is not None:
        updates["price_per_acre"] = round(price_acre_mean, 2)
        if size:
            lp_estimate = round(price_acre_mean * size, 2)
            updates["lp_estimate"] = lp_estimate
            updates["offer_price"] = round(lp_estimate * 0.525, 2)

    comps = data.get("list_of_rows_data", [])
    for i, comp in enumerate(comps[:3], 1):
        link = _safe_str(comp.get("link") or comp.get("url") or comp.get("listing_url") or comp.get("property_url"))
        if not link:
            comp_apn = _safe_str(comp.get("apn") or comp.get("parcel_number") or comp.get("parcel_id"))
            comp_fips = _safe_str(comp.get("fips") or comp.get("county_fips")) or prop.get("fips")
            if comp_apn and comp_fips:
                link = f"https://landportal.com/property/{comp_fips}/{comp_apn}"
        price = _safe_float(comp.get("mls_price") or comp.get("price") or comp.get("sale_price") or comp.get("sold_price"))
        acreage = _safe_float(comp.get("area_acres") or comp.get("acreage") or comp.get("size") or comp.get("lot_size"))
        if link:
            updates[f"comp{i}_link"] = link
        if price is not None:
            updates[f"comp{i}_price"] = price
        if acreage is not None:
            updates[f"comp{i}_acreage"] = acreage

    if updates:
        updates["updated_at"] = _now()
        sb.table("crm_properties").update(updates).eq("id", property_id).execute()

    updated = sb.table("crm_properties").select("*").eq("id", property_id).execute()
    return updated.data[0] if updated.data else prop


@router.get("/properties/{property_id}", response_model=Property)
async def get_property(property_id: str) -> dict:
    try:
        sb = get_supabase()
        res = sb.table("crm_properties").select("*").eq("id", property_id).execute()
        if not res.data:
            raise HTTPException(status_code=404, detail="Property not found")
        return res.data[0]
    except HTTPException:
        raise
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.put("/properties/{property_id}", response_model=Property)
async def update_property(property_id: str, body: PropertyUpdate) -> dict:
    try:
        sb = get_supabase()
        data = body.model_dump(exclude_unset=True)
        data["updated_at"] = _now()
        res = sb.table("crm_properties").update(data).eq("id", property_id).execute()
        if not res.data:
            raise HTTPException(status_code=404, detail="Property not found")
        return res.data[0]
    except HTTPException:
        raise
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.delete("/properties/{property_id}", status_code=204)
async def delete_property(property_id: str) -> None:
    try:
        sb = get_supabase()
        sb.table("crm_properties").delete().eq("id", property_id).execute()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# ══════════════════════════════════════════════════════════════════════
# Contacts
# ══════════════════════════════════════════════════════════════════════

@router.get("/contacts", response_model=List[Contact])
async def list_contacts() -> list:
    try:
        sb = get_supabase()
        return sb.table("crm_contacts").select("*").order("created_at", desc=True).execute().data
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/contacts", response_model=Contact, status_code=201)
async def create_contact(body: ContactCreate) -> dict:
    try:
        sb = get_supabase()
        data = body.model_dump(exclude_none=True)
        data["updated_at"] = _now()
        return sb.table("crm_contacts").insert(data).execute().data[0]
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/contacts/{contact_id}", response_model=Contact)
async def get_contact(contact_id: str) -> dict:
    try:
        sb = get_supabase()
        res = sb.table("crm_contacts").select("*").eq("id", contact_id).execute()
        if not res.data:
            raise HTTPException(status_code=404, detail="Contact not found")
        return res.data[0]
    except HTTPException:
        raise
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.put("/contacts/{contact_id}", response_model=Contact)
async def update_contact(contact_id: str, body: ContactUpdate) -> dict:
    try:
        sb = get_supabase()
        data = body.model_dump(exclude_unset=True)
        data["updated_at"] = _now()
        res = sb.table("crm_contacts").update(data).eq("id", contact_id).execute()
        if not res.data:
            raise HTTPException(status_code=404, detail="Contact not found")
        return res.data[0]
    except HTTPException:
        raise
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.delete("/contacts/{contact_id}", status_code=204)
async def delete_contact(contact_id: str) -> None:
    try:
        sb = get_supabase()
        sb.table("crm_contacts").delete().eq("id", contact_id).execute()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# ══════════════════════════════════════════════════════════════════════
# Deals
# ══════════════════════════════════════════════════════════════════════

@router.get("/deals", response_model=List[Deal])
async def list_deals(stage: Optional[str] = Query(None)) -> list:
    try:
        sb = get_supabase()
        q = sb.table("crm_deals").select("*").order("created_at", desc=True)
        if stage:
            q = q.eq("stage", stage)
        return q.execute().data
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/deals", response_model=Deal, status_code=201)
async def create_deal(body: DealCreate) -> dict:
    try:
        sb = get_supabase()
        data = body.model_dump(exclude_none=True)
        data["updated_at"] = _now()
        return sb.table("crm_deals").insert(data).execute().data[0]
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/deals/{deal_id}", response_model=Deal)
async def get_deal(deal_id: str) -> dict:
    try:
        sb = get_supabase()
        res = sb.table("crm_deals").select("*").eq("id", deal_id).execute()
        if not res.data:
            raise HTTPException(status_code=404, detail="Deal not found")
        return res.data[0]
    except HTTPException:
        raise
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.put("/deals/{deal_id}", response_model=Deal)
async def update_deal(deal_id: str, body: DealUpdate) -> dict:
    try:
        sb = get_supabase()
        data = body.model_dump(exclude_unset=True)
        data["updated_at"] = _now()
        res = sb.table("crm_deals").update(data).eq("id", deal_id).execute()
        if not res.data:
            raise HTTPException(status_code=404, detail="Deal not found")
        return res.data[0]
    except HTTPException:
        raise
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.delete("/deals/{deal_id}", status_code=204)
async def delete_deal(deal_id: str) -> None:
    try:
        sb = get_supabase()
        sb.table("crm_deals").delete().eq("id", deal_id).execute()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
