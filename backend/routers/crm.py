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
from services.supabase_client import get_supabase, get_supabase_admin

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
    "owner 2 first name": "_owner2_first",
    "owner 2 last name": "_owner2_last",

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
    "fl fema flood zone": "dd_flood_zone",
    "wetlands coverage": "wetlands_coverage",
    "buildability total (%)": "buildability",
    "buildability area (acres)": "buildability_acres",
    "elevation avg": "elevation_avg",
    "school district": "school_district",
    "land use": "land_use",
    "road frontage": "road_frontage",
    "slope avg": "slope_avg",

    # NOTE: "hyperlink" removed — comp links only come from LP API pull, not CSV

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
    "elevation_avg", "road_frontage", "slope_avg", "price_per_acre",
}

# Columns that should only fill in a field if it is not already populated by a
# higher-priority column (e.g. "mail names" only fires when "owner name(s)" is absent).
_FALLBACK_COLS: set[str] = {"mail names", "calc acreage"}


_INSTITUTIONAL_PREFIXES = frozenset([
    "LLC", "INC", "CORP", "LTD", "LP", "LLP", "TRUST", "ESTATE",
    "COUNTY", "CITY", "STATE", "TOWN", "VILLAGE", "TOWNSHIP", "CHURCH",
    "SCHOOL", "DISTRICT",
])


def _is_institutional(s: str) -> bool:
    """True if name looks like a company/org rather than a person."""
    words = s.strip().upper().split()
    if not words:
        return False
    first = words[0].rstrip(".,;")
    last = words[-1].rstrip(".,;")
    return (first in _INSTITUTIONAL_PREFIXES or last in _INSTITUTIONAL_PREFIXES
            or " OF " in s.upper() or " LLC" in s.upper() or " INC" in s.upper())


def _looks_like_lp_name(s: str) -> bool:
    """True if string looks like Land Portal 'LAST FIRST MIDDLE' format (all caps, 2+ words)."""
    if _is_institutional(s):
        return False
    stripped = re.sub(r"\s*&\s*", " ", s).strip()
    return len(stripped) > 3 and stripped == stripped.upper() and " " in stripped


def _reformat_lp_name(raw: str) -> str:
    """Convert 'FOSTER DAVID A & SMITH MARY B' → 'David A Foster & Mary B Smith'."""
    owners = re.split(r"\s*&\s*", raw)
    formatted = []
    for owner in owners:
        words = owner.strip().split()
        if len(words) >= 2:
            last = words[0].capitalize()
            rest = [w.capitalize() for w in words[1:]]
            formatted.append(" ".join(rest + [last]))
        elif words:
            formatted.append(words[0].title())
    return " & ".join(formatted)


def reformat_name(name: str) -> str:
    """Reformat LP 'Last First [Middle]' names to 'First [Middle] Last'.
    Handles comma-separated couples ('Krantz Gary W, Krantz Anita J'),
    '&'-separated couples ('FOSTER DAVID & SMITH MARY'), and single all-caps names."""
    if not name:
        return name
    name = name.strip()
    institutional = ['llc', 'corp', 'inc', 'ltd', 'trust', 'county', 'city', 'state', 'bank', 'church', 'estate']
    if any(word in name.lower() for word in institutional):
        return name.title()

    # Detect LP format: either all-caps words OR comma-separated (LP uses comma for couples)
    clean = re.sub(r"[,&]", " ", name).strip()
    is_all_caps = len(clean) > 3 and clean == clean.upper() and " " in clean
    has_comma = "," in name

    if not is_all_caps and not has_comma:
        return name

    # Split on comma first, then & — whichever is present
    if has_comma:
        segments = [s.strip() for s in name.split(",") if s.strip()]
    else:
        segments = [s.strip() for s in re.split(r"\s*&\s*", name) if s.strip()]

    reformatted = []
    for segment in segments:
        words = segment.split()
        if len(words) >= 2:
            last = words[0].capitalize()
            rest = " ".join(w.capitalize() for w in words[1:])
            reformatted.append(f"{rest} {last}")
        elif words:
            reformatted.append(words[0].title())
    return " & ".join(reformatted)


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

        # Temp owner-2 fields — stored temporarily, combined below
        if field in ("_owner2_first", "_owner2_last"):
            s = _safe_str(value)
            if s:
                result[field] = s
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

    # ── Owner name post-processing ────────────────────────────────────────
    first1 = (result.get("owner_first_name") or "").strip()
    last1  = (result.get("owner_last_name")  or "").strip()
    first2 = result.pop("_owner2_first", "").strip()
    last2  = result.pop("_owner2_last",  "").strip()

    if first1 or last1:
        # Case A: LP gave us separate Owner 1 (and maybe Owner 2) columns
        name1 = f"{first1} {last1}".strip()
        name2 = f"{first2} {last2}".strip() if (first2 or last2) else ""
        full = f"{name1} & {name2}" if name2 else name1
        result["owner_full_name"] = full
    elif result.get("owner_full_name"):
        # Case B: only a combined name string — reformat if it's in LP "LAST FIRST" format
        raw = result["owner_full_name"]
        if _looks_like_lp_name(raw):
            result["owner_full_name"] = _reformat_lp_name(raw)
            # Extract first/last from original raw (before reformatting) for correct values
            orig_owners = re.split(r"\s*&\s*", raw)
            orig_words = orig_owners[0].strip().split()
            if len(orig_words) >= 2:
                result.setdefault("owner_first_name", orig_words[1].capitalize())
                result.setdefault("owner_last_name", orig_words[0].capitalize())

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
        "documents_table_sql": DOCUMENTS_MIGRATION_SQL,
        "notes_table_sql": NOTES_MIGRATION_SQL,
        "comp_columns_sql": COMP_MIGRATION_SQL,
        "comm_columns_sql": COMM_MIGRATION_SQL,
        "sold_comps_table_sql": SOLD_COMPS_MIGRATION_SQL,
        "errors_tried": errors_tried,
    }


# ══════════════════════════════════════════════════════════════════════
# Properties
# ══════════════════════════════════════════════════════════════════════


def _extract_bad_column(err_msg: str, candidate_cols: Optional[list] = None) -> Optional[str]:
    """Extract a missing-column name from error message.

    Tries regex patterns first (PostgreSQL native + PostgREST PGRST204), then
    falls back to scanning candidate column names directly in the error string.
    This two-stage approach handles any error-message format the Supabase client
    may produce regardless of library version.
    """
    lower = err_msg.lower()
    # Stage 1: regex for known formats
    for pattern in [
        r'[Cc]olumn ["\']([^"\']+)["\'] of relation',
        r'[Cc]olumn ["\']([^"\']+)["\'] does not exist',
        r'[Cc]olumn "([^"]+)" does not exist',
        r"column ([a-z_][a-z0-9_]*) of relation",
        r"'([a-z_][a-z0-9_]*)' of relation '",
    ]:
        m = re.search(pattern, err_msg, re.IGNORECASE)
        if m:
            col = m.group(1).strip('"\'')
            return col
    # Stage 2: if we have the candidate list, check which one appears in the error
    if candidate_cols:
        for col in candidate_cols:
            if col in lower or f'"{col}"' in err_msg or f"'{col}'" in err_msg:
                return col
    return None


def _safe_batch_insert(sb: Any, rows: list[dict]) -> tuple[int, list[str]]:
    """Insert a batch into crm_properties, stripping any unknown columns on failure.

    Algorithm:
    1. Try bulk insert of entire chunk.
    2. If it fails with a column-related error, identify and strip that column,
       then retry up to 30 times (handles tables with many missing migrations).
    3. If the error is NOT column-related, fall back to per-row inserts so at
       least the good rows land.
    4. Returns (imported_count, warning_messages).
    """
    if not rows:
        return 0, []

    current = list(rows)
    warnings: list[str] = []

    for attempt in range(30):  # strip up to 30 unknown columns
        try:
            sb.table("crm_properties").insert(current).execute()
            return len(current), warnings
        except Exception as exc:
            err_msg = str(exc)
            candidate_cols = list(current[0].keys()) if current else []
            bad_col = _extract_bad_column(err_msg, candidate_cols)
            if bad_col and bad_col in candidate_cols:
                warnings.append(f"Stripped column '{bad_col}' not in DB (run /crm/db-migrate)")
                print(f"[safe_insert] attempt={attempt} stripping '{bad_col}' | err: {err_msg[:150]}", flush=True)
                current = [{k: v for k, v in d.items() if k != bad_col} for d in current]
                continue
            # Not a recognisable column error — fall back to per-row inserts
            print(f"[safe_insert] Non-column error (attempt={attempt}): {err_msg[:400]}", flush=True)
            imported = 0
            row_errors: list[str] = []
            for j, row_data in enumerate(current):
                try:
                    sb.table("crm_properties").insert(row_data).execute()
                    imported += 1
                except Exception as row_exc:
                    row_errors.append(f"Row {j + 1}: {str(row_exc)[:300]}")
                    if j == 0:
                        # Surface the first row error immediately so we can diagnose
                        print(f"[safe_insert] First row error: {str(row_exc)[:400]}", flush=True)
            if row_errors:
                print(f"[safe_insert] {len(row_errors)}/{len(current)} rows failed. First: {row_errors[0]}", flush=True)
            return imported, warnings + row_errors

    print(f"[safe_insert] Gave up after 30 strips. Remaining cols: {list(current[0].keys()) if current else []}", flush=True)
    return 0, warnings + ["Gave up stripping columns after 30 attempts — run POST /crm/db-migrate"]

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
                    data["offer_price"] = float(data["lp_estimate"]) * 0.525
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
                    data["offer_price"] = float(data["lp_estimate"]) * 0.525
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


# ── Campaign auto-create ──────────────────────────────────────────────

@router.post("/campaigns/auto-create", status_code=201)
async def auto_create_campaign(body: dict = Body(...)) -> dict:
    """
    Create a campaign with a smart name based on counties covered.
    Accepts: {counties?: list[str], county?: str, state?: str, month?, year?}
    1 county  → "[County] County [Month] [Year]"
    2-3 counties → "[County1] / [County2] [Month] [Year]"
    4+ counties  → "[State] Multi-County [Month] [Year]"
    """
    try:
        sb = get_supabase()
        state = (body.get("state") or "").strip()
        from datetime import datetime
        now = datetime.now()
        month = body.get("month") or now.strftime("%B")
        year = body.get("year") or now.year

        # Collect counties — accept both 'counties' list and legacy 'county' string
        counties_raw: list = body.get("counties") or []
        single = (body.get("county") or "").strip()
        counties = [c.strip() for c in counties_raw if (c or "").strip()]
        if not counties and single:
            counties = [single]

        if len(counties) == 1:
            name = f"{counties[0]} County {month} {year}"
        elif len(counties) == 2:
            name = f"{counties[0]} / {counties[1]} {month} {year}"
        elif len(counties) == 3:
            name = f"{counties[0]} / {counties[1]} / {counties[2]} {month} {year}"
        elif len(counties) >= 4:
            name = f"{state} Multi-County {month} {year}" if state else f"Multi-County {month} {year}"
        elif state:
            name = f"{state} {month} {year}"
        else:
            name = f"Mail Drop {month} {year}"

        r = sb.table("crm_campaigns").insert({
            "name": name,
            "created_at": _now(),
            "updated_at": _now(),
        }).execute()
        campaign = r.data[0]
        return {"campaign_id": campaign["id"], "name": name}
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# ── Start Mailing (send mail drop to mail house) ──────────────────────

@router.post("/campaigns/{campaign_id}/send-mail-drop")
async def send_campaign_mail_drop(campaign_id: str, body: dict = Body(default={})) -> dict:
    """
    Send a mail drop for a campaign.
    If mail_house_email is provided in body it is saved to the campaign first.
    Generates a CSV of all 'lead' properties in the campaign and emails it via SendGrid.
    """
    try:
        sb = get_supabase()
        # Fetch campaign
        r = sb.table("crm_campaigns").select("*").eq("id", campaign_id).execute()
        if not r.data:
            raise HTTPException(status_code=404, detail="Campaign not found")
        campaign = r.data[0]

        # Optionally update mail_house_email from request body
        mail_house_email = (
            body.get("mail_house_email")
            or campaign.get("mail_house_email", "")
            or os.getenv("MAIL_HOUSE_EMAIL", "")
        )
        if body.get("mail_house_email"):
            sb.table("crm_campaigns").update({"mail_house_email": mail_house_email, "updated_at": _now()}).eq("id", campaign_id).execute()

        if not mail_house_email:
            raise HTTPException(status_code=400, detail="mail_house_email is required. Set it in campaign settings, request body, or MAIL_HOUSE_EMAIL env var.")

        # Get lead properties in this campaign (all pages — Supabase default cap is 1000)
        properties: list[dict] = []
        batch_size = 1000
        offset = 0
        while True:
            props_r = (
                sb.table("crm_properties")
                .select("*")
                .eq("campaign_id", campaign_id)
                .eq("status", "lead")
                .range(offset, offset + batch_size - 1)
                .execute()
            )
            batch = props_r.data or []
            properties.extend(batch)
            if len(batch) < batch_size:
                break
            offset += batch_size

        print(f"[mail-drop] Mailing {len(properties)} lead records to {mail_house_email}", flush=True)
        if not properties:
            raise HTTPException(status_code=400, detail="No lead properties found in this campaign to mail.")

        # Build CSV
        import csv as _csv
        import io as _io
        buf = _io.StringIO()
        headers = [
            "Owner Full Name", "Owner First Name", "Owner Last Name",
            "Mail Address", "Mail City", "Mail State", "Mail Zip",
            "APN", "County", "State", "Acreage", "Offer Price",
            "Campaign Code",
        ]
        writer = _csv.writer(buf)
        writer.writerow(headers)
        for p in properties:
            writer.writerow([
                p.get("owner_full_name", ""),
                p.get("owner_first_name", ""),
                p.get("owner_last_name", ""),
                p.get("owner_mailing_address", ""),
                p.get("owner_mailing_city", ""),
                p.get("owner_mailing_state", ""),
                p.get("owner_mailing_zip", ""),
                p.get("apn", ""),
                p.get("county", ""),
                p.get("state", ""),
                p.get("acreage", ""),
                p.get("offer_price", ""),
                p.get("campaign_code", ""),
            ])
        csv_content = buf.getvalue()
        record_count = len(properties)

        # Send via SendGrid
        sendgrid_key = os.environ.get("SENDGRID_API_KEY", "")
        from_email = os.getenv("SENDGRID_FROM_EMAIL", "dominionlandgroup@gmail.com")
        if not sendgrid_key:
            raise HTTPException(status_code=503, detail="SENDGRID_API_KEY not configured. Add it to Railway environment variables.")

        import base64 as _base64
        from datetime import datetime as _dt
        campaign_name = campaign.get("name", campaign_id)
        date_str = _dt.now().strftime("%Y-%m-%d")
        encoded_csv = _base64.b64encode(csv_content.encode("utf-8")).decode("utf-8")
        plain_body = (
            f"Hi,\n\n"
            f"Please find attached the mailing list for the following campaign:\n\n"
            f"  Campaign: {campaign_name}\n"
            f"  Date: {date_str}\n"
            f"  Records: {record_count}\n\n"
            f"The attached CSV contains owner name, mailing address, APN, acreage, and offer price for each lead.\n\n"
            f"Estimated cost: ${record_count * float(campaign.get('cost_per_piece') or 0.55):.2f} "
            f"(@ ${float(campaign.get('cost_per_piece') or 0.55):.2f}/piece)\n\n"
            f"Please process this mail drop at your earliest convenience.\n\n"
            f"Thank you,\n"
            f"Dominion Land Group\n"
            f"dominionlandgroup@gmail.com\n"
        )
        html_body = f"""<html><body style="font-family:Arial,sans-serif;color:#1A0A2E;max-width:600px;margin:0 auto;padding:24px">
<p style="font-size:16px">Hi,</p>
<p>Please find attached the mailing list for the following campaign:</p>
<table style="border-collapse:collapse;margin:16px 0">
  <tr><td style="padding:6px 16px 6px 0;color:#6B5B8A;font-weight:bold">Campaign:</td><td style="padding:6px 0"><strong>{campaign_name}</strong></td></tr>
  <tr><td style="padding:6px 16px 6px 0;color:#6B5B8A;font-weight:bold">Date:</td><td style="padding:6px 0">{date_str}</td></tr>
  <tr><td style="padding:6px 16px 6px 0;color:#6B5B8A;font-weight:bold">Records:</td><td style="padding:6px 0"><strong>{record_count:,}</strong></td></tr>
  <tr><td style="padding:6px 16px 6px 0;color:#6B5B8A;font-weight:bold">Est. Cost:</td><td style="padding:6px 0">${record_count * float(campaign.get('cost_per_piece') or 0.55):.2f} @ ${float(campaign.get('cost_per_piece') or 0.55):.2f}/piece</td></tr>
</table>
<p>The attached CSV contains owner name, mailing address, APN, acreage, and offer price for each lead.</p>
<p>Please process this mail drop at your earliest convenience.</p>
<p style="margin-top:24px">Thank you,<br><strong>Dominion Land Group</strong><br><a href="mailto:dominionlandgroup@gmail.com">dominionlandgroup@gmail.com</a></p>
</body></html>"""
        payload = {
            "personalizations": [{"to": [{"email": mail_house_email}]}],
            "from": {"email": from_email, "name": "Dominion Land Group"},
            "reply_to": {"email": "dominionlandgroup@gmail.com", "name": "Dominion Land Group"},
            "subject": f"Mail Drop - {campaign_name} - {date_str} - {record_count} Records",
            "headers": {
                "List-Unsubscribe": "<mailto:dominionlandgroup@gmail.com?subject=Unsubscribe>",
                "X-Mailer": "Land Dominator CRM",
            },
            "content": [
                {"type": "text/plain", "value": plain_body},
                {"type": "text/html", "value": html_body},
            ],
            "attachments": [{
                "content": encoded_csv,
                "type": "text/csv",
                "filename": f"{campaign_name.replace(' ', '-').lower()}-{date_str}-{record_count}-records.csv",
                "disposition": "attachment",
            }],
        }
        async with httpx.AsyncClient(timeout=30) as client:
            sg_r = await client.post(
                "https://api.sendgrid.com/v3/mail/send",
                json=payload,
                headers={"Authorization": f"Bearer {sendgrid_key}", "Content-Type": "application/json"},
            )
            if sg_r.status_code >= 400:
                raise HTTPException(status_code=502, detail=f"SendGrid error {sg_r.status_code}: {sg_r.text[:200]}")

        # Update campaign: amount_spent, last_mailed_at
        cost_per_piece = float(campaign.get("cost_per_piece") or 0)
        amount_spent_prev = float(campaign.get("amount_spent") or 0)
        amount_spent_new = amount_spent_prev + cost_per_piece * record_count
        sb.table("crm_campaigns").update({
            "amount_spent": amount_spent_new,
            "updated_at": _now(),
        }).eq("id", campaign_id).execute()

        return {
            "sent": True,
            "record_count": record_count,
            "mail_house_email": mail_house_email,
            "amount_spent": amount_spent_new,
        }
    except HTTPException:
        raise
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# ── Add match results to campaign ─────────────────────────────────────

@router.post("/campaigns/{campaign_id}/add-match-results", status_code=201)
async def add_match_results_to_campaign(campaign_id: str, body: dict = Body(...)) -> dict:
    """
    Bulk-insert mailable matched parcels into a CRM campaign as 'lead' properties.
    Body: {match_id: str, export_type?: 'mailable'|'matched', records?: list}
    If records is provided it is used directly (avoids volatile in-memory session store).
    """
    try:
        match_id = body.get("match_id", "")
        export_type = body.get("export_type", "mailable")

        # Prefer inline records sent from the frontend (resilient to server restarts)
        inline_records = body.get("records")
        if inline_records is not None:
            raw_results = inline_records
        else:
            from storage.session_store import get_match
            match_data = get_match(match_id)
            if match_data is None:
                raise HTTPException(status_code=404, detail="Match result not found. Re-run matching engine.")
            raw_results = match_data.get("results", [])

        print(f"[add-match-results] campaign_id={campaign_id} export_type={export_type} total_raw={len(raw_results)}", flush=True)
        if raw_results:
            print(f"[add-match-results] Sample record keys: {list(raw_results[0].keys())[:15]}", flush=True)
            print(f"[add-match-results] Sample pricing_flag: {raw_results[0].get('pricing_flag')}", flush=True)

        # Filter by export type
        if export_type == "mailable":
            results = [r for r in raw_results if r.get("pricing_flag") in ("MATCHED", "LP_FALLBACK")]
        elif export_type == "matched":
            results = [r for r in raw_results if r.get("pricing_flag") == "MATCHED"]
        else:
            results = raw_results

        print(f"[add-match-results] After filter: {len(results)} records to insert", flush=True)

        if results:
            r0 = results[0]
            print(f"[add-match-results] RAW engine keys (ALL): {sorted(r0.keys())}", flush=True)
            print(f"[add-match-results] APN={r0.get('apn')!r} lp_property_id={r0.get('lp_property_id')!r} fips={r0.get('fips')!r}", flush=True)
            print(f"[add-match-results] owner_name={r0.get('owner_name')!r} suggested_offer_mid={r0.get('suggested_offer_mid')!r}", flush=True)

        if not results:
            flag_counts: dict[str, int] = {}
            for r in raw_results:
                f = str(r.get("pricing_flag", "None"))
                flag_counts[f] = flag_counts.get(f, 0) + 1
            raise HTTPException(
                status_code=400,
                detail=f"No mailable records found (export_type='{export_type}'). Flag breakdown: {flag_counts}. Re-run the matching engine or switch to 'matched' export type."
            )

        sb = get_supabase()
        # Verify campaign exists
        c_r = sb.table("crm_campaigns").select("id,name,campaign_code").eq("id", campaign_id).execute()
        if not c_r.data:
            raise HTTPException(status_code=404, detail="Campaign not found")

        # Derive a short 2-digit campaign number for campaign_code prefix
        all_camp = sb.table("crm_campaigns").select("id").order("created_at").execute()
        camp_num = next((i + 1 for i, c in enumerate(all_camp.data or []) if c["id"] == campaign_id), 1)
        code_prefix = f"{camp_num:02d}"

        rows = []
        for seq, r in enumerate(results, start=1):
            owner_full_raw = r.get("owner_name") or r.get("owner_full_name") or ""
            owner_full = reformat_name(owner_full_raw) if owner_full_raw else ""

            # Derive first/last from the reformatted name (first owner before &)
            primary = re.split(r"\s*&\s*", owner_full)[0].strip() if owner_full else ""
            primary_parts = primary.split()
            if len(primary_parts) >= 3:
                owner_first = primary_parts[0]
                owner_last = primary_parts[-1]
            elif len(primary_parts) == 2:
                owner_first = primary_parts[0]
                owner_last = primary_parts[1]
            elif primary_parts:
                owner_first = primary_parts[0]
                owner_last = ""
            else:
                owner_first = ""
                owner_last = ""

            if owner_full_raw != owner_full:
                print(f"[add-match-results] Name fix: '{owner_full_raw}' → '{owner_full}' (first='{owner_first}' last='{owner_last}')", flush=True)

            # Resolve FIPS and Land Portal property_id with broad key fallbacks
            prop_id = (
                r.get("lp_property_id")
                or r.get("property_id")
                or r.get("propertyid")
                or r.get("Property ID")
                or r.get("LP Property ID")
                or None
            )
            fips_val = (
                r.get("fips")
                or r.get("fips_code")
                or r.get("Parcel FIPS")
                or r.get("County FIPS")
                or r.get("parcel_fips")
                or r.get("county_fips")
                or None
            )
            print(f"[add-match-results] FIPS: {fips_val}, Property ID: {prop_id}", flush=True)

            rows.append({
                # Basic
                "campaign_id": campaign_id,
                "status": "lead",
                "campaign_code": f"{code_prefix}-{seq}",
                # Owner
                "owner_full_name": owner_full,
                "owner_first_name": owner_first,
                "owner_last_name": owner_last,
                "owner_phone": r.get("owner_phone") or None,
                # Mailing address
                "owner_mailing_address": r.get("mail_address") or None,
                "owner_mailing_city": r.get("mail_city") or None,
                "owner_mailing_state": r.get("mail_state") or None,
                "owner_mailing_zip": r.get("mail_zip") or None,
                # Parcel location
                "apn": r.get("apn") or None,
                "property_address": r.get("parcel_address") or None,
                "property_city": r.get("parcel_city") or None,
                "property_zip": r.get("parcel_zip") or None,
                "state": r.get("parcel_state") or None,
                "county": r.get("parcel_county") or None,
                "acreage": r.get("lot_acres"),
                # LP IDs
                "property_id": prop_id,
                "fips": fips_val,
                # Pricing
                "offer_price": float(r["suggested_offer_mid"]) if r.get("suggested_offer_mid") is not None else None,
                "lp_estimate": r.get("retail_estimate"),
                "recommended_offer": float(r["suggested_offer_mid"]) if r.get("suggested_offer_mid") is not None else None,
                "confidence_level": r.get("confidence") or None,
                "pricing_method_used": r.get("pricing_method") or None,
                # Geo
                "latitude": r.get("latitude"),
                "longitude": r.get("longitude"),
                # Comp 1
                "comp1_price": r.get("comp_1_price") or r.get("Comp 1 Sale Price"),
                "comp1_acreage": r.get("comp_1_acreage") or r.get("comp_1_acres") or r.get("Comp 1 Acreage"),
                "comp_1_address": r.get("comp_1_address") or r.get("Comp 1 Address") or None,
                "comp_1_date": r.get("comp_1_date") or r.get("Comp 1 Sale Date") or None,
                "comp_1_distance": r.get("comp_1_distance") or r.get("Comp 1 Distance"),
                "comp_1_ppa": r.get("comp_1_ppa") or r.get("Comp 1 $/Acre"),
                # Comp 2
                "comp2_price": r.get("comp_2_price") or r.get("Comp 2 Sale Price"),
                "comp2_acreage": r.get("comp_2_acreage") or r.get("comp_2_acres") or r.get("Comp 2 Acreage"),
                "comp_2_address": r.get("comp_2_address") or r.get("Comp 2 Address") or None,
                "comp_2_date": r.get("comp_2_date") or r.get("Comp 2 Sale Date") or None,
                "comp_2_distance": r.get("comp_2_distance") or r.get("Comp 2 Distance"),
                "comp_2_ppa": r.get("comp_2_ppa") or r.get("Comp 2 $/Acre"),
                # Comp 3
                "comp3_price": r.get("comp_3_price") or r.get("Comp 3 Sale Price"),
                "comp3_acreage": r.get("comp_3_acreage") or r.get("comp_3_acres") or r.get("Comp 3 Acreage"),
                "comp_3_address": r.get("comp_3_address") or r.get("Comp 3 Address") or None,
                "comp_3_date": r.get("comp_3_date") or r.get("Comp 3 Sale Date") or None,
                "comp_3_distance": r.get("comp_3_distance") or r.get("Comp 3 Distance"),
                "comp_3_ppa": r.get("comp_3_ppa") or r.get("Comp 3 $/Acre"),
                # Comp metadata
                "comp_quality_flags": r.get("comp_quality_flags") or None,
                # Match engine metadata
                "match_radius_used": r.get("match_radius_used"),
                "num_comps_used": r.get("num_comps_used"),
                "owner_proximity": r.get("owner_proximity") or None,
                "lp_fallback": r.get("pricing_flag") == "LP_FALLBACK",
                "score": r.get("score"),
                "retail_estimate": r.get("retail_estimate"),
                "acreage_band": r.get("acreage_band") or None,
                # Land analysis (present when LP CSV columns were in target file)
                "buildability": r.get("buildability_pct"),
                "land_locked": r.get("land_locked") or None,
                "dd_flood_zone": r.get("flood_zone") or None,
                "fema_coverage": r.get("fema_coverage"),
                "wetlands_coverage": r.get("wetlands_coverage"),
                "slope_avg": r.get("slope_avg"),
                "elevation_avg": r.get("elevation_avg"),
                "road_frontage": r.get("road_frontage"),
                "land_use": r.get("land_use") or None,
                "school_district": r.get("school_district") or None,
                "dd_zoning": r.get("zoning") or r.get("dd_zoning") or None,
                "created_at": _now(),
                "updated_at": _now(),
            })

        print(f"[add-match-results] Inserting {len(rows)} rows in chunks of 25", flush=True)
        if rows:
            print(f"[add-match-results] ALL column names in first row: {list(rows[0].keys())}", flush=True)
            print(f"[add-match-results] First row sample: campaign_id={rows[0].get('campaign_id')} apn={rows[0].get('apn')} offer_price={rows[0].get('offer_price')} lp_estimate={rows[0].get('lp_estimate')}", flush=True)

        # Insert in chunks of 25 so any per-row error is isolated
        CHUNK = 25
        imported = 0
        all_warnings: list[str] = []
        for chunk_start in range(0, len(rows), CHUNK):
            chunk = rows[chunk_start:chunk_start + CHUNK]
            n, warns = _safe_batch_insert(sb, chunk)
            imported += n
            all_warnings.extend(warns)
            print(f"[add-match-results] chunk {chunk_start}–{chunk_start+len(chunk)}: inserted {n}/{len(chunk)}", flush=True)

        print(f"[add-match-results] Total imported={imported}/{len(rows)} warnings={all_warnings[:3]}", flush=True)

        if imported == 0 and (all_warnings or len(rows) > 0):
            raise HTTPException(
                status_code=500,
                detail=f"Insert failed — 0 of {len(rows)} records written. First error: {all_warnings[0] if all_warnings else 'unknown'}. Run POST /crm/db-migrate to add missing columns."
            )

        # Post-insert name fix: catch any remaining backwards names in this campaign
        names_fixed = 0
        try:
            camp_recs = sb.table("crm_properties").select("id,owner_full_name,owner_first_name,owner_last_name").eq("campaign_id", campaign_id).execute()
            for rec in (camp_recs.data or []):
                raw = rec.get("owner_full_name") or ""
                if not raw:
                    continue
                clean = re.sub(r"[,&]", " ", raw).strip()
                is_all_caps = len(clean) > 3 and clean == clean.upper() and " " in clean
                has_comma = "," in raw
                if not is_all_caps and not has_comma:
                    continue
                reformatted = reformat_name(raw)
                if reformatted == raw:
                    continue
                primary = re.split(r"\s*&\s*", reformatted)[0].strip()
                parts = primary.split()
                first = parts[0] if parts else ""
                last = parts[-1] if len(parts) >= 2 else ""
                sb.table("crm_properties").update({
                    "owner_full_name": reformatted,
                    "owner_first_name": first,
                    "owner_last_name": last,
                    "updated_at": _now(),
                }).eq("id", rec["id"]).execute()
                names_fixed += 1
        except Exception as ne:
            print(f"[add-match-results] post-insert name fix error (non-fatal): {ne}", flush=True)

        print(f"[add-match-results] Post-insert name fix: {names_fixed} names corrected", flush=True)

        return {
            "imported": imported,
            "total": len(results),
            "campaign_id": campaign_id,
            "warnings": all_warnings[:5],
            "names_fixed": names_fixed,
        }
    except HTTPException:
        raise
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        print(f"[add-match-results] ERROR: {exc}", flush=True)
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
                        lp_estimate = price_acre_mean * size
                        updates["lp_estimate"] = lp_estimate
                        updates["offer_price"] = lp_estimate * 0.525

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
                    data["campaign_code"] = f"{campaign_number:02d}-{record_num}"
            if not data.get("offer_price") and data.get("lp_estimate"):
                data["offer_price"] = float(data["lp_estimate"]) * 0.525
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

        # Step 0: null communications references (FK to crm_properties)
        try:
            sb.table("crm_communications").update({"property_id": None}).not_.is_("property_id", "null").execute()
        except Exception:
            pass  # table may not exist yet

        # Step 1: clear all FK references so cascade constraints don't block delete
        sb.table("crm_properties").update({
            "campaign_id": None,
        }).gte("created_at", "1900-01-01T00:00:00+00:00").execute()

        # Step 2: clear any deals that reference these properties to avoid reverse FK
        try:
            sb.table("crm_deals").update({
                "property_id": None,
            }).gte("created_at", "1900-01-01T00:00:00+00:00").execute()
        except Exception:
            pass  # table may not exist yet

        # Step 3: delete
        sb.table("crm_properties").delete().gte("created_at", "1900-01-01T00:00:00+00:00").execute()

        return {"deleted": True, "count": count}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/properties/tags")
async def get_property_tags(campaign_id: Optional[str] = Query(None)) -> dict:
    """Return all unique tags from crm_properties.tags JSONB array with counts."""
    try:
        sb = get_supabase()
        q = sb.table("crm_properties").select("tags")
        if campaign_id:
            q = q.eq("campaign_id", campaign_id)
        result = q.execute()
        tag_counts: Dict[str, int] = {}
        for row in result.data or []:
            tags = row.get("tags") or []
            if isinstance(tags, list):
                for tag in tags:
                    if tag and isinstance(tag, str):
                        tag_counts[tag] = tag_counts.get(tag, 0) + 1
        return {"tags": [{"tag": t, "count": c} for t, c in sorted(tag_counts.items())]}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/properties/fix-names")
async def fix_property_names() -> dict:
    """One-time fix: reformat owner_full_name from LP all-caps 'LAST FIRST' format to 'First Last'."""
    try:
        sb = get_supabase()
        fixed = 0
        page = 0
        while True:
            result = (sb.table("crm_properties")
                      .select("id, owner_full_name, owner_first_name, owner_last_name")
                      .range(page * 500, (page + 1) * 500 - 1)
                      .execute())
            batch = result.data or []
            if not batch:
                break
            for row in batch:
                raw = row.get("owner_full_name") or ""
                if raw and _looks_like_lp_name(raw):
                    new_full = _reformat_lp_name(raw)
                    orig_owners = re.split(r"\s*&\s*", raw)
                    orig_words = orig_owners[0].strip().split()
                    new_first = orig_words[1].capitalize() if len(orig_words) >= 2 else (row.get("owner_first_name") or "")
                    new_last = orig_words[0].capitalize() if orig_words else (row.get("owner_last_name") or "")
                    (sb.table("crm_properties")
                       .update({"owner_full_name": new_full, "owner_first_name": new_first, "owner_last_name": new_last})
                       .eq("id", row["id"])
                       .execute())
                    fixed += 1
            if len(batch) < 500:
                break
            page += 1
        return {"fixed": fixed, "message": f"Reformatted {fixed} property names from LP format to First Last"}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


_SORT_COLS = {
    "offer_price": "offer_price",
    "acreage": "acreage",
    "owner_full_name": "owner_full_name",
    "county": "county",
    "campaign_code": "campaign_code",
    "status": "status",
    "confidence_level": "confidence_level",
    "created_at": "created_at",
}


@router.get("/properties")
async def list_properties(
    status: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    county: Optional[str] = Query(None),
    campaign_id: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    tag: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=500),
    sort_by: Optional[str] = Query(None),
    sort_dir: Optional[str] = Query(None),
) -> dict:
    try:
        sb = get_supabase()
        offset = (page - 1) * limit
        sort_col = _SORT_COLS.get(sort_by or "", "offer_price")
        sort_desc = (sort_dir or "desc") != "asc"
        q = (sb.table("crm_properties")
             .select("*", count="exact")
             .order(sort_col, desc=sort_desc, nullsfirst=False)
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
        if tag:
            q = q.contains("tags", [tag])
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

        HEADERS = [
            "Owner Full Name", "Owner First Name", "Owner Last Name",
            "Mailing Address", "Mailing City", "Mailing State", "Mailing Zip",
            "Property Address", "Property City", "Property State", "Property Zip",
            "APN", "County", "State", "Acreage",
            "Campaign Code", "Offer Price", "Confidence Level", "Pricing Method",
            "Comp 1 Address", "Comp 1 Price", "Comp 1 Acreage", "Comp 1 Date",
            "Comp 2 Address", "Comp 2 Price", "Comp 2 Acreage", "Comp 2 Date",
            "Comp 3 Address", "Comp 3 Price", "Comp 3 Acreage", "Comp 3 Date",
            "Status",
        ]

        def _row_values(row: dict) -> list:
            full_name = row.get("owner_full_name") or ""
            if full_name and _looks_like_lp_name(full_name):
                full_name = _reformat_lp_name(full_name)
            return [
                full_name,
                row.get("owner_first_name") or "",
                row.get("owner_last_name") or "",
                row.get("owner_mailing_address") or "",
                row.get("owner_mailing_city") or "",
                row.get("owner_mailing_state") or "",
                row.get("owner_mailing_zip") or "",
                row.get("property_address") or "",
                row.get("property_city") or "",
                row.get("state") or "",
                row.get("property_zip") or "",
                row.get("apn") or "",
                row.get("county") or "",
                row.get("state") or "",
                row.get("acreage") or "",
                row.get("campaign_code") or "",
                row.get("offer_price") or "",
                row.get("confidence_level") or "",
                row.get("pricing_method_used") or "",
                row.get("comp_1_address") or "",
                row.get("comp1_price") or "",
                row.get("comp1_acreage") or "",
                row.get("comp_1_date") or "",
                row.get("comp_2_address") or "",
                row.get("comp2_price") or "",
                row.get("comp2_acreage") or "",
                row.get("comp_2_date") or "",
                row.get("comp_3_address") or "",
                row.get("comp3_price") or "",
                row.get("comp3_acreage") or "",
                row.get("comp_3_date") or "",
                row.get("status") or "",
            ]

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
            lp_estimate = price_acre_mean * size
            updates["lp_estimate"] = lp_estimate
            updates["offer_price"] = lp_estimate * 0.525

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


@router.get("/properties/fix-names-now")
async def fix_property_names() -> dict:
    """One-time (and on-demand) fix for LP 'LAST FIRST' owner names already stored in DB."""
    try:
        sb = get_supabase()
        records: list[dict] = []
        batch_size = 1000
        offset = 0
        while True:
            r = sb.table("crm_properties").select("id,owner_full_name,owner_first_name,owner_last_name").range(offset, offset + batch_size - 1).execute()
            batch = r.data or []
            records.extend(batch)
            if len(batch) < batch_size:
                break
            offset += batch_size

        fixed = 0
        for rec in records:
            raw = rec.get("owner_full_name") or ""
            if not raw:
                continue
            clean = re.sub(r"[,&]", " ", raw).strip()
            is_all_caps = len(clean) > 3 and clean == clean.upper() and " " in clean
            has_comma = "," in raw
            if not is_all_caps and not has_comma:
                continue
            reformatted = reformat_name(raw)
            if reformatted == raw:
                continue
            primary = re.split(r"\s*&\s*", reformatted)[0].strip()
            parts = primary.split()
            first = parts[0] if parts else ""
            last = parts[-1] if len(parts) >= 2 else ""
            sb.table("crm_properties").update({
                "owner_full_name": reformatted,
                "owner_first_name": first,
                "owner_last_name": last,
                "updated_at": _now(),
            }).eq("id", rec["id"]).execute()
            fixed += 1
            print(f"[fix-names] '{raw}' → '{reformatted}'", flush=True)

        print(f"[fix-names] Fixed {fixed}/{len(records)} records", flush=True)
        return {"fixed": fixed, "total": len(records)}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


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


# ── Property Documents ────────────────────────────────────────────────────────

from fastapi import UploadFile, File as FastAPIFile

DOCUMENTS_MIGRATION_SQL = """
CREATE TABLE IF NOT EXISTS crm_property_documents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  property_id  UUID REFERENCES crm_properties(id) ON DELETE CASCADE,
  filename     TEXT NOT NULL,
  file_size    INTEGER,
  file_type    TEXT,
  storage_path TEXT NOT NULL,
  uploaded_by  TEXT
);
CREATE INDEX IF NOT EXISTS idx_crm_docs_property ON crm_property_documents(property_id);
""".strip()

_ALLOWED_DOC_TYPES = {
    "application/pdf", "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "image/jpeg", "image/png",
}
_STORAGE_BUCKET = "property-documents"


@router.post("/properties/{property_id}/documents")
async def upload_property_document(
    property_id: str,
    file: UploadFile = FastAPIFile(...),
) -> dict:
    """Upload a document (PDF, DOC, DOCX, JPG, PNG) and store in Supabase Storage."""
    try:
        sb = get_supabase()
        content = await file.read()
        content_type = file.content_type or "application/octet-stream"
        if content_type not in _ALLOWED_DOC_TYPES:
            raise HTTPException(status_code=415, detail=f"Unsupported file type: {content_type}")

        # Insert metadata row to get an ID for the storage path
        row = {
            "property_id": property_id,
            "filename": file.filename or "document",
            "file_size": len(content),
            "file_type": content_type,
            "storage_path": "__pending__",
            "created_at": _now(),
        }
        ins = sb.table("crm_property_documents").insert(row).execute()
        doc = ins.data[0]
        doc_id = doc["id"]

        storage_path = f"{property_id}/{doc_id}_{file.filename or 'document'}"

        # Upload to Supabase Storage using service role key (anon key is blocked by Storage RLS)
        try:
            sb_admin = get_supabase_admin()
            # Ensure bucket exists (creates it if missing — idempotent)
            try:
                sb_admin.storage.create_bucket(_STORAGE_BUCKET, {"public": False})
            except Exception:
                pass  # already exists
            sb_admin.storage.from_(_STORAGE_BUCKET).upload(
                storage_path,
                content,
                {"content-type": content_type},
            )
        except Exception as exc:
            import logging
            logging.getLogger(__name__).error(
                "Storage upload failed for path=%s bucket=%s: %s",
                storage_path, _STORAGE_BUCKET, exc,
            )
            # Rollback metadata row if storage upload fails
            sb.table("crm_property_documents").delete().eq("id", doc_id).execute()
            raise HTTPException(
                status_code=500,
                detail=f"Storage upload failed: {exc}. Ensure the '{_STORAGE_BUCKET}' bucket exists in Supabase Storage and SUPABASE_SERVICE_KEY is set.",
            )

        # Update storage_path
        sb.table("crm_property_documents").update({"storage_path": storage_path}).eq("id", doc_id).execute()
        doc["storage_path"] = storage_path
        return doc
    except HTTPException:
        raise
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/properties/{property_id}/documents")
async def list_property_documents(property_id: str) -> list:
    """List all documents for a property."""
    try:
        sb = get_supabase()
        res = (
            sb.table("crm_property_documents")
            .select("*")
            .eq("property_id", property_id)
            .order("created_at", desc=True)
            .execute()
        )
        return res.data or []
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.delete("/documents/{doc_id}", status_code=204)
async def delete_document(doc_id: str) -> None:
    """Delete a document record and its storage object."""
    try:
        sb = get_supabase()
        res = sb.table("crm_property_documents").select("storage_path").eq("id", doc_id).execute()
        if not res.data:
            raise HTTPException(status_code=404, detail="Document not found")
        storage_path = res.data[0].get("storage_path", "")
        if storage_path and storage_path != "__pending__":
            try:
                sb_admin = get_supabase_admin()
                sb_admin.storage.from_(_STORAGE_BUCKET).remove([storage_path])
            except Exception:
                pass  # best-effort; delete metadata regardless
        sb.table("crm_property_documents").delete().eq("id", doc_id).execute()
    except HTTPException:
        raise
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/documents/{doc_id}/download")
async def get_document_download_url(doc_id: str) -> dict:
    """Return a signed download URL valid for 1 hour."""
    try:
        sb = get_supabase()
        res = sb.table("crm_property_documents").select("*").eq("id", doc_id).execute()
        if not res.data:
            raise HTTPException(status_code=404, detail="Document not found")
        doc = res.data[0]
        storage_path = doc.get("storage_path", "")
        if not storage_path or storage_path == "__pending__":
            raise HTTPException(status_code=404, detail="Document not yet stored")
        sb_admin = get_supabase_admin()
        signed = sb_admin.storage.from_(_STORAGE_BUCKET).create_signed_url(storage_path, 3600)
        url = signed.get("signedURL") or signed.get("signed_url") or signed.get("data", {}).get("signedURL", "")
        if not url:
            raise HTTPException(status_code=500, detail="Could not generate signed URL")
        return {"url": url, "filename": doc.get("filename"), "expires_in": 3600}
    except HTTPException:
        raise
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# ── Property Notes History ────────────────────────────────────────────────────

NOTES_MIGRATION_SQL = """
CREATE TABLE IF NOT EXISTS crm_property_notes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  property_id UUID REFERENCES crm_properties(id) ON DELETE CASCADE,
  content     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_property_notes ON crm_property_notes(property_id, created_at DESC);
""".strip()


@router.get("/properties/{property_id}/notes")
async def list_property_notes(property_id: str) -> list:
    """Return all saved notes for a property, newest first."""
    try:
        sb = get_supabase()
        r = (
            sb.table("crm_property_notes")
            .select("id,created_at,content")
            .eq("property_id", property_id)
            .order("created_at", desc=True)
            .limit(100)
            .execute()
        )
        return r.data or []
    except Exception:
        return []


@router.post("/properties/{property_id}/notes", status_code=201)
async def add_property_note(property_id: str, body: dict = Body(...)) -> dict:
    """Append a timestamped note entry for a property."""
    content = str(body.get("content", "")).strip()
    if not content:
        raise HTTPException(status_code=400, detail="Note content cannot be empty")
    try:
        sb = get_supabase()
        r = sb.table("crm_property_notes").insert({
            "property_id": property_id,
            "content": content,
            "created_at": _now(),
        }).execute()
        return r.data[0]
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


COMP_MIGRATION_SQL = """
ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS comp_1_address TEXT;
ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS comp_2_address TEXT;
ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS comp_3_address TEXT;
ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS comp_1_date TEXT;
ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS comp_2_date TEXT;
ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS comp_3_date TEXT;
ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS comp_1_distance NUMERIC;
ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS comp_2_distance NUMERIC;
ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS comp_3_distance NUMERIC;
ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS comp_1_ppa NUMERIC;
ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS comp_2_ppa NUMERIC;
ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS comp_3_ppa NUMERIC;
ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS comp_quality_flags TEXT;
ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS pricing_method_used TEXT;
ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS recommended_offer NUMERIC;
ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS confidence_level TEXT;
ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS dd_zoning TEXT;
ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS match_radius_used NUMERIC;
ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS num_comps_used INTEGER;
ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS owner_proximity TEXT;
ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS lp_fallback BOOLEAN DEFAULT FALSE;
ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS score INTEGER;
ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS retail_estimate NUMERIC;
ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS acreage_band TEXT;
""".strip()


@router.post("/save-match-pricing")
async def save_match_pricing(body: dict = Body(...)) -> dict:
    """
    Update existing CRM properties with comp and pricing data from a match run.
    Matches by APN. Only updates records that already exist in crm_properties.
    Body: {match_id: str, export_type?: 'mailable'|'matched'|'all', records?: list}
    If records is provided it is used directly (avoids volatile in-memory session store).
    """
    try:
        match_id = body.get("match_id", "")
        export_type = body.get("export_type", "all")

        # Prefer inline records sent from the frontend (resilient to server restarts)
        inline_records = body.get("records")
        if inline_records is not None:
            raw_results = inline_records
        else:
            from storage.session_store import get_match
            match_data = get_match(match_id)
            if match_data is None:
                raise HTTPException(status_code=404, detail="Match result not found. Re-run matching engine.")
            raw_results = match_data.get("results", [])

        if export_type == "mailable":
            results = [r for r in raw_results if r.get("pricing_flag") in ("MATCHED", "LP_FALLBACK")]
        elif export_type == "matched":
            results = [r for r in raw_results if r.get("pricing_flag") == "MATCHED"]
        else:
            results = raw_results

        if not results:
            return {"updated": 0, "total": 0, "not_found": 0}

        sb = get_supabase()

        # Batch APN lookup
        all_apns = list(set((r.get("apn") or "").strip() for r in results if (r.get("apn") or "").strip()))
        if not all_apns:
            return {"updated": 0, "total": len(results), "not_found": len(results)}

        LOOKUP_CHUNK = 500
        apn_to_id: Dict[str, str] = {}
        for i in range(0, len(all_apns), LOOKUP_CHUNK):
            chunk_apns = all_apns[i:i + LOOKUP_CHUNK]
            found = sb.table("crm_properties").select("id,apn").in_("apn", chunk_apns).execute()
            for row in (found.data or []):
                if row.get("apn"):
                    apn_to_id[row["apn"].strip()] = row["id"]

        updated = 0
        not_found = 0
        errors: List[str] = []

        for r in results:
            apn = (r.get("apn") or "").strip()
            prop_id = apn_to_id.get(apn)
            if not prop_id:
                not_found += 1
                continue

            updates: Dict[str, Any] = {
                "comp1_price": r.get("comp_1_price"),
                "comp1_acreage": r.get("comp_1_acres"),
                "comp_1_address": r.get("comp_1_address") or None,
                "comp_1_date": r.get("comp_1_date") or None,
                "comp_1_distance": r.get("comp_1_distance"),
                "comp_1_ppa": r.get("comp_1_ppa"),
                "comp2_price": r.get("comp_2_price"),
                "comp2_acreage": r.get("comp_2_acres"),
                "comp_2_address": r.get("comp_2_address") or None,
                "comp_2_date": r.get("comp_2_date") or None,
                "comp_2_distance": r.get("comp_2_distance"),
                "comp_2_ppa": r.get("comp_2_ppa"),
                "comp3_price": r.get("comp_3_price"),
                "comp3_acreage": r.get("comp_3_acres"),
                "comp_3_address": r.get("comp_3_address") or None,
                "comp_3_date": r.get("comp_3_date") or None,
                "comp_3_distance": r.get("comp_3_distance"),
                "comp_3_ppa": r.get("comp_3_ppa"),
                "lp_estimate": r.get("retail_estimate"),
                "offer_price": r.get("suggested_offer_mid"),
                "recommended_offer": r.get("suggested_offer_mid"),
                "confidence_level": r.get("confidence"),
                "comp_quality_flags": r.get("comp_quality_flags") or None,
                "pricing_method_used": r.get("pricing_method") or None,
                "updated_at": _now(),
            }
            updates = {k: v for k, v in updates.items() if v is not None}

            try:
                sb.table("crm_properties").update(updates).eq("id", prop_id).execute()
                updated += 1
            except Exception as exc:
                errors.append(str(exc)[:80])
                not_found += 1

        return {
            "updated": updated,
            "total": len(results),
            "not_found": not_found,
            "errors": errors[:5],
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


COMM_MIGRATION_SQL = """
ALTER TABLE crm_communications ADD COLUMN IF NOT EXISTS disposition TEXT;
ALTER TABLE crm_communications ADD COLUMN IF NOT EXISTS callback_requested_at TEXT;
ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'::jsonb;
ALTER TABLE crm_communications ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT FALSE;
""".strip()


SOLD_COMPS_MIGRATION_SQL = """
CREATE TABLE IF NOT EXISTS crm_sold_comps (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  apn               TEXT,
  county            TEXT,
  state             TEXT,
  zip_code          TEXT,
  acreage           NUMERIC,
  sale_price        NUMERIC,
  price_per_acre    NUMERIC,
  sale_date         TEXT,
  dom               INTEGER,
  latitude          NUMERIC,
  longitude         NUMERIC,
  slope_avg         NUMERIC,
  wetlands_coverage NUMERIC,
  fema_coverage     NUMERIC,
  buildability      NUMERIC,
  road_frontage     NUMERIC,
  land_use          TEXT,
  buyer_name        TEXT,
  full_address      TEXT,
  source            TEXT DEFAULT 'land_portal'
);
CREATE INDEX IF NOT EXISTS idx_crm_sold_comps_state_county ON crm_sold_comps (state, county);
CREATE INDEX IF NOT EXISTS idx_crm_sold_comps_zip ON crm_sold_comps (zip_code);
CREATE INDEX IF NOT EXISTS idx_crm_sold_comps_latlon ON crm_sold_comps (latitude, longitude);
""".strip()
