"""
CRM module: Properties, Contacts, Deals.
Backed by Supabase (PostgreSQL). Requires SUPABASE_URL + SUPABASE_KEY env vars.
"""
import csv
import io
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, BackgroundTasks, Body, File, HTTPException, Query, UploadFile

from models.crm_schemas import (
    Contact, ContactCreate, ContactUpdate,
    CRMCampaign, CRMCampaignCreate, CRMCampaignUpdate,
    Deal, DealCreate, DealUpdate,
    ImportResult,
    Property, PropertyCreate, PropertyUpdate,
)
from services.supabase_client import get_supabase

router = APIRouter(prefix="/crm", tags=["crm"])

# In-memory job store for async imports (single-process Railway deployment)
_import_jobs: dict[str, dict] = {}

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
}


def _map_pebble_row(row: dict, col_to_field: dict[str, str]) -> dict:
    """Map one CSV row to a crm_properties insert dict."""
    result: dict = {}
    extra_phones: list[str] = []

    for col, value in row.items():
        field = col_to_field.get(col)
        if field is None:
            continue

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
            if v is not None:
                result[field] = v
        else:
            s = _safe_str(value)
            if s:
                result[field] = s

    if extra_phones:
        result["additional_phones"] = extra_phones

    return result


# ══════════════════════════════════════════════════════════════════════
# Properties
# ══════════════════════════════════════════════════════════════════════

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
                batch.append(data)
                if len(batch) >= 500:
                    sb.table("crm_properties").insert(batch).execute()
                    imported += len(batch)
                    batch = []
            except Exception as exc:
                errors.append(f"Row {i + 2}: {exc}")
                skipped += 1

        if batch:
            sb.table("crm_properties").insert(batch).execute()
            imported += len(batch)

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
                batch.append(data)
                if len(batch) >= 50:
                    sb.table("crm_properties").insert(batch).execute()
                    imported += len(batch)
                    batch = []
            except Exception as exc:
                errors.append(f"Row {i + 1}: {exc}")
                skipped += 1

        if batch:
            sb.table("crm_properties").insert(batch).execute()
            imported += len(batch)

    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return ImportResult(imported=imported, skipped=skipped, errors=errors[:20])


# ── CRM Campaigns ─────────────────────────────────────────────────────


@router.get("/campaigns")
async def list_crm_campaigns() -> list:
    """List CRM import campaigns with their property counts."""
    try:
        sb = get_supabase()
        campaigns = sb.table("crm_campaigns").select("*").order("created_at", desc=True).execute().data
        for c in campaigns:
            r = sb.table("crm_properties").select("*", count="exact").eq("campaign_id", c["id"]).limit(0).execute()
            c["property_count"] = r.count or 0
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

    mapped: list[dict] = []
    skipped = 0
    errors: list[str] = []
    now = _now()

    for i, raw_row in enumerate(rows):
        try:
            data = _map_pebble_row(raw_row, col_to_field)
            if not data:
                skipped += 1
                continue
            data["updated_at"] = now
            if campaign_id:
                data["campaign_id"] = campaign_id
            mapped.append(data)
        except Exception as exc:
            errors.append(f"Row {i + 1}: {exc}")
            skipped += 1

    imported = 0
    if mapped:
        try:
            sb = get_supabase()
            sb.table("crm_properties").insert(mapped).execute()
            imported = len(mapped)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc))

    return ImportResult(imported=imported, skipped=skipped, errors=errors[:5])


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


@router.delete("/properties/all", status_code=204)
async def delete_all_properties() -> None:
    """Truncate the entire crm_properties table."""
    try:
        sb = get_supabase()
        sb.table("crm_properties").delete().gte("created_at", "1900-01-01T00:00:00+00:00").execute()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/properties")
async def list_properties(
    status: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    county: Optional[str] = Query(None),
    campaign_id: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=500),
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
            q = q.eq("county", county)
        if campaign_id:
            q = q.eq("campaign_id", campaign_id)
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
