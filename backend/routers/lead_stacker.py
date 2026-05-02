"""
Hillsborough Lead Stacker — pull, cross-reference, and score distressed leads
from 6 Hillsborough County public sources.

Sources:
  tax-deed          → Weekly Tax Deed Spreadsheet (hillsclerk.com)
  lands-available   → Lands Available list (hillsclerk.com)
  lis-pendens       → Lis Pendens monthly CSV (hillsclerk.com)
  foreclosure       → Mortgage Foreclosure list (realforeclose.com)
  probate           → Probate cases (hillsclerk.com)
  code-violation    → Code violation records (Hillsborough County)
"""
import io
import csv
import json
from typing import Literal, Optional
from fastapi import APIRouter, HTTPException, UploadFile, File, Query
from fastapi.responses import StreamingResponse, Response

from services.supabase_client import get_supabase

router = APIRouter(prefix="/lead-stacker", tags=["lead-stacker"])

SOURCES = Literal[
    "tax-deed",
    "lands-available",
    "lis-pendens",
    "foreclosure",
    "probate",
    "code-violation",
]

SOURCE_FLAGS = {
    "tax-deed":        "has_tax_deed",
    "lands-available": "has_lands_available",
    "lis-pendens":     "has_lis_pendens",
    "foreclosure":     "has_foreclosure",
    "probate":         "has_probate",
    "code-violation":  "has_code_violation",
}

SOURCE_LABELS = {
    "tax-deed":        "Tax Deed",
    "lands-available": "Lands Available",
    "lis-pendens":     "Lis Pendens",
    "foreclosure":     "Mortgage Foreclosure",
    "probate":         "Probate",
    "code-violation":  "Code Violations",
}

MIGRATION_SQL = """
CREATE TABLE IF NOT EXISTS hillsborough_leads (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW(),
  parcel_id          TEXT,
  owner_name         TEXT,
  owner_first_name   TEXT,
  owner_last_name    TEXT,
  property_address   TEXT,
  property_city      TEXT,
  property_state     TEXT DEFAULT 'FL',
  property_zip       TEXT,
  mail_address       TEXT,
  mail_city          TEXT,
  mail_state         TEXT,
  mail_zip           TEXT,
  score              INTEGER DEFAULT 0,
  has_tax_deed       BOOLEAN DEFAULT FALSE,
  has_lands_available BOOLEAN DEFAULT FALSE,
  has_lis_pendens    BOOLEAN DEFAULT FALSE,
  has_foreclosure    BOOLEAN DEFAULT FALSE,
  has_probate        BOOLEAN DEFAULT FALSE,
  has_code_violation BOOLEAN DEFAULT FALSE,
  on_mls             BOOLEAN DEFAULT FALSE,
  mls_list_price     NUMERIC,
  mls_days_on_market INTEGER,
  source_details     JSONB DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS hillsborough_leads_parcel_idx ON hillsborough_leads (parcel_id);
CREATE INDEX IF NOT EXISTS hillsborough_leads_score_idx  ON hillsborough_leads (score DESC);
"""

# ── Column detection helpers ────────────────────────────────────────────────

def _norm(s: str) -> str:
    return s.strip().lower().replace("_", " ").replace("-", " ").replace(".", "")


def _find_col(headers: list[str], candidates: list[str]) -> Optional[str]:
    normed = {_norm(h): h for h in headers}
    for c in candidates:
        if _norm(c) in normed:
            return normed[_norm(c)]
    return None


PARCEL_CANDIDATES = [
    "parcel number", "parcel id", "parcel_id", "folio", "folio number",
    "tax id", "account number", "parcel no", "property id", "property_id",
    "apn", "pin", "situs id", "property number",
]
OWNER_CANDIDATES = [
    "owner name", "owner", "grantor", "defendant", "borrower",
    "decedent", "petitioner", "violator", "mail names",
    "owner 1 full name", "name",
]
OWNER_FIRST_CANDIDATES = [
    "owner first name", "first name", "owner 1 first name",
]
OWNER_LAST_CANDIDATES = [
    "owner last name", "last name", "owner 1 last name",
]
ADDRESS_CANDIDATES = [
    "property address", "situs address", "site address",
    "violation address", "address", "location", "prop address",
]
CITY_CANDIDATES = [
    "property city", "city", "situs city", "site city",
]
ZIP_CANDIDATES = [
    "property zip", "zip", "zip code", "situs zip", "site zip",
]
MAIL_ADDR_CANDIDATES = [
    "mail address", "mailing address", "owner mail address",
]
MAIL_CITY_CANDIDATES = [
    "mail city", "mailing city",
]
MAIL_STATE_CANDIDATES = [
    "mail state", "mailing state",
]
MAIL_ZIP_CANDIDATES = [
    "mail zip", "mailing zip", "mailing zip code",
]


def _parse_csv_bytes(raw: bytes) -> tuple[list[str], list[dict]]:
    """Return (headers, rows) from raw CSV bytes. Tries UTF-8 then latin-1."""
    for enc in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            text = raw.decode(enc)
            reader = csv.DictReader(io.StringIO(text))
            headers = reader.fieldnames or []
            rows = list(reader)
            return list(headers), rows
        except Exception:
            continue
    raise ValueError("Could not decode CSV")


def _extract_row(row: dict, headers: list[str]) -> dict:
    """Extract standardized fields from a source CSV row."""
    parcel_col  = _find_col(headers, PARCEL_CANDIDATES)
    owner_col   = _find_col(headers, OWNER_CANDIDATES)
    first_col   = _find_col(headers, OWNER_FIRST_CANDIDATES)
    last_col    = _find_col(headers, OWNER_LAST_CANDIDATES)
    addr_col    = _find_col(headers, ADDRESS_CANDIDATES)
    city_col    = _find_col(headers, CITY_CANDIDATES)
    zip_col     = _find_col(headers, ZIP_CANDIDATES)
    maddr_col   = _find_col(headers, MAIL_ADDR_CANDIDATES)
    mcity_col   = _find_col(headers, MAIL_CITY_CANDIDATES)
    mstate_col  = _find_col(headers, MAIL_STATE_CANDIDATES)
    mzip_col    = _find_col(headers, MAIL_ZIP_CANDIDATES)

    parcel_id = (row.get(parcel_col) or "").strip() if parcel_col else ""
    owner_name = (row.get(owner_col) or "").strip() if owner_col else ""
    first = (row.get(first_col) or "").strip() if first_col else ""
    last  = (row.get(last_col) or "").strip()  if last_col  else ""

    if not owner_name and (first or last):
        owner_name = f"{first} {last}".strip()

    return {
        "parcel_id":         _clean_parcel(parcel_id),
        "owner_name":        owner_name,
        "owner_first_name":  first,
        "owner_last_name":   last,
        "property_address":  (row.get(addr_col) or "").strip() if addr_col else "",
        "property_city":     (row.get(city_col) or "").strip() if city_col else "",
        "property_zip":      (row.get(zip_col) or "").strip()  if zip_col  else "",
        "mail_address":      (row.get(maddr_col) or "").strip() if maddr_col else "",
        "mail_city":         (row.get(mcity_col) or "").strip() if mcity_col else "",
        "mail_state":        (row.get(mstate_col) or "").strip() if mstate_col else "",
        "mail_zip":          (row.get(mzip_col) or "").strip()  if mzip_col  else "",
    }


def _clean_parcel(raw: str) -> str:
    """Normalize Hillsborough parcel IDs: strip dashes, spaces, leading zeros in segments."""
    if not raw:
        return ""
    # Remove common separators but keep the raw string for storage; use for matching
    return raw.strip().upper().replace(" ", "").replace("-", "")


def _recompute_score(row: dict) -> int:
    return sum(1 for flag in SOURCE_FLAGS.values() if row.get(flag))


# ── Startup migration ────────────────────────────────────────────────────────

@router.post("/migrate")
async def run_migration():
    """Create hillsborough_leads table if not exists."""
    sb = get_supabase()
    try:
        sb.rpc("exec_sql", {"sql": MIGRATION_SQL}).execute()
    except Exception:
        pass
    try:
        sb.table("hillsborough_leads").select("id").limit(1).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Migration failed: {e}")
    return {"ok": True, "message": "hillsborough_leads table ready"}


# ── Upload endpoints ─────────────────────────────────────────────────────────

@router.post("/upload/{source}")
async def upload_source(
    source: str,
    file: UploadFile = File(...),
):
    """
    Upload a CSV for one of the 6 Hillsborough sources.
    source: tax-deed | lands-available | lis-pendens | foreclosure | probate | code-violation
    """
    if source not in SOURCE_FLAGS:
        raise HTTPException(status_code=400, detail=f"Unknown source '{source}'. Valid: {list(SOURCE_FLAGS.keys())}")

    flag_col = SOURCE_FLAGS[source]
    raw = await file.read()

    try:
        headers, rows = _parse_csv_bytes(raw)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    if not rows:
        return {"source": source, "uploaded": 0, "message": "CSV was empty"}

    sb = get_supabase()
    inserted = 0
    updated = 0
    skipped = 0

    # Build parcel_id → raw data map for the uploaded CSV
    batch: list[dict] = []
    for row in rows:
        extracted = _extract_row(row, headers)
        if not extracted["parcel_id"]:
            skipped += 1
            continue
        batch.append(extracted)

    if not batch:
        return {"source": source, "uploaded": 0, "skipped": skipped, "message": "No parcel IDs found in CSV. Check column names."}

    # Fetch existing records matching any of these parcel IDs
    parcel_ids = list({r["parcel_id"] for r in batch})

    # Process in chunks of 200 to avoid URL length limits
    existing_map: dict[str, dict] = {}
    for i in range(0, len(parcel_ids), 200):
        chunk = parcel_ids[i:i+200]
        res = sb.table("hillsborough_leads").select("id,parcel_id," + ",".join(SOURCE_FLAGS.values())).in_("parcel_id", chunk).execute()
        for rec in (res.data or []):
            existing_map[rec["parcel_id"]] = rec

    to_insert: list[dict] = []
    to_update: list[dict] = []

    for extracted in batch:
        pid = extracted["parcel_id"]
        if pid in existing_map:
            existing = existing_map[pid]
            updates = {flag_col: True}
            # Backfill empty address fields
            for fld in ("owner_name", "property_address", "property_city", "property_zip", "mail_address", "mail_city", "mail_state", "mail_zip"):
                if extracted.get(fld) and not existing.get(fld):
                    updates[fld] = extracted[fld]
            # Recompute score
            merged = {**existing, **updates}
            updates["score"] = _recompute_score(merged)
            updates["id"] = existing["id"]
            to_update.append(updates)
            updated += 1
        else:
            rec = {**extracted, flag_col: True, "property_state": "FL"}
            rec["score"] = _recompute_score(rec)
            to_insert.append(rec)
            inserted += 1

    # Batch insert new records
    if to_insert:
        for i in range(0, len(to_insert), 100):
            sb.table("hillsborough_leads").insert(to_insert[i:i+100]).execute()

    # Batch update existing records
    for rec in to_update:
        rid = rec.pop("id")
        sb.table("hillsborough_leads").update(rec).eq("id", rid).execute()

    return {
        "source": source,
        "label": SOURCE_LABELS[source],
        "total_in_csv": len(rows),
        "inserted": inserted,
        "updated": updated,
        "skipped": skipped,
    }


@router.post("/upload/mls")
async def upload_mls(
    file: UploadFile = File(...),
):
    """
    Upload MLS export CSV. Cross-references against hillsborough_leads by parcel ID.
    Marks matching leads with on_mls=True and stores list price + days on market.
    """
    raw = await file.read()
    try:
        headers, rows = _parse_csv_bytes(raw)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    if not rows:
        return {"uploaded": 0, "message": "CSV was empty"}

    sb = get_supabase()

    # MLS-specific columns
    parcel_col  = _find_col(headers, PARCEL_CANDIDATES)
    price_col   = _find_col(headers, ["list price", "listing price", "current price", "price"])
    dom_col     = _find_col(headers, ["days on market", "dom", "cumulative days on market", "cdom"])

    matched = 0
    for row in rows:
        if not parcel_col:
            break
        pid = _clean_parcel((row.get(parcel_col) or "").strip())
        if not pid:
            continue

        updates: dict = {"on_mls": True}
        if price_col:
            try:
                updates["mls_list_price"] = float((row.get(price_col) or "").replace(",", "").replace("$", ""))
            except Exception:
                pass
        if dom_col:
            try:
                updates["mls_days_on_market"] = int((row.get(dom_col) or "0").strip())
            except Exception:
                pass

        res = sb.table("hillsborough_leads").update(updates).eq("parcel_id", pid).execute()
        if res.data:
            matched += len(res.data)

    return {"total_in_csv": len(rows), "matched_leads": matched}


# ── Stats endpoint ────────────────────────────────────────────────────────────

@router.get("/stats")
async def get_stats():
    """Return score distribution and per-source counts."""
    sb = get_supabase()
    try:
        res = sb.table("hillsborough_leads").select(
            "score,has_tax_deed,has_lands_available,has_lis_pendens,has_foreclosure,has_probate,has_code_violation,on_mls"
        ).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    rows = res.data or []
    total = len(rows)

    score_dist = {str(i): 0 for i in range(1, 7)}
    source_counts = {k: 0 for k in SOURCE_FLAGS}
    mls_count = 0

    for r in rows:
        s = r.get("score", 0)
        if 1 <= s <= 6:
            score_dist[str(s)] += 1
        for src, flag in SOURCE_FLAGS.items():
            if r.get(flag):
                source_counts[src] += 1
        if r.get("on_mls"):
            mls_count += 1

    return {
        "total": total,
        "score_distribution": score_dist,
        "source_counts": source_counts,
        "mls_cross_referenced": mls_count,
        "high_value": sum(v for k, v in score_dist.items() if int(k) >= 4),
    }


# ── Lead list endpoint ────────────────────────────────────────────────────────

@router.get("/leads")
async def get_leads(
    min_score: int = Query(1, ge=1, le=6),
    max_score: int = Query(6, ge=1, le=6),
    on_mls: Optional[bool] = Query(None),
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
):
    """Return paginated lead list filtered by score range."""
    sb = get_supabase()
    try:
        q = (
            sb.table("hillsborough_leads")
            .select("*")
            .gte("score", min_score)
            .lte("score", max_score)
            .order("score", desc=True)
            .range(offset, offset + limit - 1)
        )
        if on_mls is not None:
            q = q.eq("on_mls", on_mls)
        res = q.execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {"leads": res.data or [], "offset": offset, "limit": limit}


# ── Export endpoint ────────────────────────────────────────────────────────────

BATCHLEADS_HEADERS = [
    "First Name",
    "Last Name",
    "Mailing Address",
    "Mailing City",
    "Mailing State",
    "Mailing Zip",
    "Property Address",
    "Property City",
    "Property State",
    "Property Zip",
    "Parcel ID",
    "Score",
    "Tax Deed",
    "Lands Available",
    "Lis Pendens",
    "Foreclosure",
    "Probate",
    "Code Violation",
    "On MLS",
    "MLS List Price",
]


@router.get("/export")
async def export_leads(
    min_score: int = Query(1, ge=1, le=6),
    format: str = Query("batchleads", description="batchleads | full"),
):
    """
    Download leads as BatchLeads-ready CSV sorted highest score first.
    """
    sb = get_supabase()
    try:
        res = (
            sb.table("hillsborough_leads")
            .select("*")
            .gte("score", min_score)
            .order("score", desc=True)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    rows = res.data or []

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(BATCHLEADS_HEADERS)

    for r in rows:
        owner = r.get("owner_name") or ""
        first = r.get("owner_first_name") or ""
        last  = r.get("owner_last_name") or ""
        if not first and not last and owner:
            parts = owner.split(" ", 1)
            first = parts[0]
            last  = parts[1] if len(parts) > 1 else ""

        mls_price = r.get("mls_list_price")
        writer.writerow([
            first,
            last,
            r.get("mail_address") or r.get("property_address") or "",
            r.get("mail_city") or r.get("property_city") or "",
            r.get("mail_state") or "FL",
            r.get("mail_zip") or r.get("property_zip") or "",
            r.get("property_address") or "",
            r.get("property_city") or "",
            r.get("property_state") or "FL",
            r.get("property_zip") or "",
            r.get("parcel_id") or "",
            r.get("score") or 0,
            "Yes" if r.get("has_tax_deed") else "",
            "Yes" if r.get("has_lands_available") else "",
            "Yes" if r.get("has_lis_pendens") else "",
            "Yes" if r.get("has_foreclosure") else "",
            "Yes" if r.get("has_probate") else "",
            "Yes" if r.get("has_code_violation") else "",
            "Yes" if r.get("on_mls") else "",
            f"{mls_price:.2f}" if mls_price else "",
        ])

    return StreamingResponse(
        io.BytesIO(buf.getvalue().encode("utf-8")),
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="hillsborough-leads-score{min_score}plus-{len(rows)}records.csv"'
        },
    )


# ── Clear endpoint ─────────────────────────────────────────────────────────────

@router.delete("/clear")
async def clear_leads():
    """Delete all hillsborough_leads records."""
    sb = get_supabase()
    try:
        res = sb.table("hillsborough_leads").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
        deleted = len(res.data) if res.data else 0
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"deleted": deleted}


# ── Per-source clear ───────────────────────────────────────────────────────────

@router.delete("/clear/{source}")
async def clear_source(source: str):
    """
    Remove a single source's contribution from all leads.
    Recalculates scores and removes records that drop to 0.
    """
    if source not in SOURCE_FLAGS:
        raise HTTPException(status_code=400, detail=f"Unknown source: {source}")

    flag_col = SOURCE_FLAGS[source]
    sb = get_supabase()

    # Get all leads that have this source flag
    res = sb.table("hillsborough_leads").select("id," + ",".join(SOURCE_FLAGS.values())).eq(flag_col, True).execute()
    rows = res.data or []

    to_delete = []
    to_update = []

    for r in rows:
        updated = {**r, flag_col: False}
        new_score = _recompute_score(updated)
        if new_score == 0:
            to_delete.append(r["id"])
        else:
            to_update.append({"id": r["id"], flag_col: False, "score": new_score})

    for rid in to_delete:
        sb.table("hillsborough_leads").delete().eq("id", rid).execute()

    for rec in to_update:
        rid = rec.pop("id")
        sb.table("hillsborough_leads").update(rec).eq("id", rid).execute()

    return {
        "source": source,
        "records_cleared": len(rows),
        "deleted_zero_score": len(to_delete),
        "updated": len(to_update),
    }
