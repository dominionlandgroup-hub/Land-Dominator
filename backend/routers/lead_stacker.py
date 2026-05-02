"""
Tampa Bay Lead Stacker — cross-reference distressed-land signals across
Hillsborough, Pinellas, and Pasco counties.

Upload endpoint:  POST /lead-stacker/upload/{county}/{source}
MLS cross-ref:    POST /lead-stacker/upload/mls
Stats:            GET  /lead-stacker/stats
Leads list:       GET  /lead-stacker/leads
Export:           GET  /lead-stacker/export
Clear all:        DELETE /lead-stacker/clear
Clear source:     DELETE /lead-stacker/clear/{county}/{source}
"""
import io
import csv
import json
from typing import Optional, Literal
from fastapi import APIRouter, HTTPException, UploadFile, File, Query
from fastapi.responses import StreamingResponse

from services.supabase_client import get_supabase

router = APIRouter(prefix="/lead-stacker", tags=["lead-stacker"])

VALID_COUNTIES = {"hillsborough", "pinellas", "pasco"}

# ── County / source registry ─────────────────────────────────────────────────

COUNTY_SOURCES: dict[str, dict[str, dict]] = {
    "hillsborough": {
        "tax-deed":        {"label": "Tax Deed",        "url": "hillsclerk.com"},
        "lands-available": {"label": "Lands Available", "url": "hillsclerk.com"},
        "lis-pendens":     {"label": "Lis Pendens",     "url": "hillsclerk.com"},
        "foreclosure":     {"label": "Foreclosure",     "url": "hillsborough.realforeclose.com"},
        "probate":         {"label": "Probate",         "url": "hillsclerk.com"},
        "code-violation":  {"label": "Code Violations", "url": "hillsboroughcounty.org"},
    },
    "pinellas": {
        "tax-deed":    {"label": "Tax Deed/Certificate", "url": "lienhub.com/county/pinellas"},
        "foreclosure": {"label": "Foreclosure",          "url": "pinellas.realforeclose.com"},
        "lis-pendens": {"label": "Lis Pendens",          "url": "pinellasclerk.org"},
        "probate":     {"label": "Probate",              "url": "pinellasclerk.org"},
    },
    "pasco": {
        "tax-deed":    {"label": "Tax Certificate/Deed", "url": "lienhub.com/county/pasco"},
        "foreclosure": {"label": "Foreclosure",          "url": "pasco.realforeclose.com"},
        "lis-pendens": {"label": "Lis Pendens",          "url": "pascoclerk.com"},
        "probate":     {"label": "Probate",              "url": "pascoclerk.com"},
    },
}

# Keywords that indicate a land use is *improved* (exclude these)
_IMPROVED_KEYWORDS = {
    "single family", "residential", "multi family", "multifamily", "condominium",
    "condo", "commercial", "industrial", "warehouse", "office", "retail", "hotel",
    "motel", "apartment", "duplex", "triplex", "quadruplex", "mobile home",
    "manufactured", "improved", "building", "structure",
}
# Keywords that indicate vacant/raw land (include these)
_VACANT_KEYWORDS = {
    "vacant", "land", "acreage", "agricultural", "agriculture", "timberland",
    "timber", "pasture", "range", "unimproved", "raw", "rural", "wetland",
    "marsh", "wooded", "forest", "grove", "range", "farm",
}


def _is_vacant_land(land_use: str) -> bool:
    """Return True if land use indicates vacant/raw land with no improved structure."""
    if not land_use:
        return True  # no land use data → include by default
    lu = land_use.strip().lower()
    # Explicit improved check takes priority
    for kw in _IMPROVED_KEYWORDS:
        if kw in lu:
            return False
    # Must match at least one vacant keyword
    for kw in _VACANT_KEYWORDS:
        if kw in lu:
            return True
    # No match either way — include (conservative, don't filter out unknowns)
    return True


MIGRATION_SQL = """
CREATE TABLE IF NOT EXISTS tampa_bay_leads (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW(),
  county             TEXT NOT NULL,
  parcel_id          TEXT,
  owner_name         TEXT,
  owner_first_name   TEXT,
  owner_last_name    TEXT,
  property_address   TEXT,
  property_city      TEXT,
  property_state     TEXT DEFAULT 'FL',
  property_zip       TEXT,
  lot_acres          NUMERIC,
  land_use           TEXT,
  mail_address       TEXT,
  mail_city          TEXT,
  mail_state         TEXT,
  mail_zip           TEXT,
  score              INTEGER DEFAULT 0,
  pain_signals       JSONB DEFAULT '[]'::jsonb,
  on_mls             BOOLEAN DEFAULT FALSE,
  mls_list_price     NUMERIC,
  mls_days_on_market INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS tampa_bay_leads_county_parcel
  ON tampa_bay_leads (county, parcel_id) WHERE parcel_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tampa_bay_leads_score_idx
  ON tampa_bay_leads (score DESC);
CREATE INDEX IF NOT EXISTS tampa_bay_leads_county_idx
  ON tampa_bay_leads (county);
"""

# ── Column detection helpers ─────────────────────────────────────────────────

def _norm(s: str) -> str:
    return s.strip().lower().replace("_", " ").replace("-", " ").replace(".", "").replace("#", "")


def _find_col(headers: list[str], candidates: list[str]) -> Optional[str]:
    normed = {_norm(h): h for h in headers}
    for c in candidates:
        if _norm(c) in normed:
            return normed[_norm(c)]
    return None


_PARCEL_COLS = [
    "parcel number", "parcel id", "parcel_id", "folio", "folio number",
    "tax id", "account number", "parcel no", "property id", "property_id",
    "apn", "pin", "situs id", "property number", "parcel", "id",
]
_OWNER_COLS = [
    "owner name", "owner", "grantor", "defendant", "borrower",
    "decedent", "petitioner", "violator", "mail names",
    "owner 1 full name", "name", "taxpayer name", "taxpayer",
]
_FIRST_COLS  = ["owner first name", "first name", "owner 1 first name"]
_LAST_COLS   = ["owner last name", "last name", "owner 1 last name"]
_ADDR_COLS   = [
    "property address", "situs address", "site address",
    "violation address", "address", "location", "prop address",
    "property location", "situs",
]
_CITY_COLS   = ["property city", "city", "situs city", "site city", "prop city"]
_ZIP_COLS    = ["property zip", "zip", "zip code", "situs zip", "site zip", "postal code"]
_MADDR_COLS  = ["mail address", "mailing address", "owner mail address", "owner address"]
_MCITY_COLS  = ["mail city", "mailing city"]
_MSTATE_COLS = ["mail state", "mailing state"]
_MZIP_COLS   = ["mail zip", "mailing zip", "mailing zip code"]
_ACRES_COLS  = [
    "acres", "acreage", "lot acres", "lot size acres", "total acres",
    "site acreage", "lot size", "land area", "area acres", "parcel acreage",
]
_LANDUSE_COLS = [
    "land use", "land_use", "property class", "use code", "dor code",
    "state use code", "property use", "land use description", "use description",
    "improvement code", "property type",
]


def _parse_csv_bytes(raw: bytes) -> tuple[list[str], list[dict]]:
    for enc in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            text = raw.decode(enc)
            reader = csv.DictReader(io.StringIO(text))
            headers = list(reader.fieldnames or [])
            rows = list(reader)
            return headers, rows
        except Exception:
            continue
    raise ValueError("Could not decode CSV file")


def _clean_parcel(raw: str) -> str:
    return raw.strip().upper().replace(" ", "").replace("-", "") if raw else ""


def _extract_row(row: dict, headers: list[str]) -> dict:
    def gc(candidates): return _find_col(headers, candidates)
    def gv(col): return (row.get(col) or "").strip() if col else ""

    parcel_id  = _clean_parcel(gv(gc(_PARCEL_COLS)))
    owner_name = gv(gc(_OWNER_COLS))
    first      = gv(gc(_FIRST_COLS))
    last       = gv(gc(_LAST_COLS))
    if not owner_name and (first or last):
        owner_name = f"{first} {last}".strip()

    acres_raw = gv(gc(_ACRES_COLS))
    try:
        lot_acres = float(acres_raw.replace(",", "")) if acres_raw else None
        if lot_acres is not None and (lot_acres <= 0 or lot_acres > 50000):
            lot_acres = None
    except ValueError:
        lot_acres = None

    land_use = gv(gc(_LANDUSE_COLS))

    return {
        "parcel_id":        parcel_id,
        "owner_name":       owner_name,
        "owner_first_name": first,
        "owner_last_name":  last,
        "property_address": gv(gc(_ADDR_COLS)),
        "property_city":    gv(gc(_CITY_COLS)),
        "property_zip":     gv(gc(_ZIP_COLS)),
        "mail_address":     gv(gc(_MADDR_COLS)),
        "mail_city":        gv(gc(_MCITY_COLS)),
        "mail_state":       gv(gc(_MSTATE_COLS)),
        "mail_zip":         gv(gc(_MZIP_COLS)),
        "lot_acres":        lot_acres,
        "land_use":         land_use,
    }


# ── Migration endpoint ────────────────────────────────────────────────────────

@router.post("/migrate")
async def run_migration():
    """Create tampa_bay_leads table if not exists."""
    sb = get_supabase()
    try:
        sb.table("tampa_bay_leads").select("id").limit(1).execute()
    except Exception:
        try:
            sb.rpc("exec_sql", {"sql": MIGRATION_SQL}).execute()
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Migration failed: {e}")
    return {"ok": True, "message": "tampa_bay_leads table ready"}


# ── Upload endpoint ───────────────────────────────────────────────────────────

@router.post("/upload/{county}/{source}")
async def upload_source(
    county: str,
    source: str,
    file: UploadFile = File(...),
):
    """
    Upload CSV for a specific county/source combination.
    county: hillsborough | pinellas | pasco
    source: tax-deed | lands-available | lis-pendens | foreclosure | probate | code-violation
    """
    county = county.lower()
    source = source.lower()

    if county not in VALID_COUNTIES:
        raise HTTPException(status_code=400, detail=f"Unknown county '{county}'. Valid: {sorted(VALID_COUNTIES)}")
    if source not in COUNTY_SOURCES.get(county, {}):
        valid = list(COUNTY_SOURCES[county].keys())
        raise HTTPException(status_code=400, detail=f"Source '{source}' not valid for {county}. Valid: {valid}")

    signal_key = f"{county}:{source}"
    raw = await file.read()

    try:
        headers, rows = _parse_csv_bytes(raw)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    if not rows:
        return {"county": county, "source": source, "uploaded": 0, "message": "CSV was empty"}

    sb = get_supabase()
    inserted = 0
    updated = 0
    skipped_no_id = 0
    skipped_improved = 0

    batch: list[dict] = []
    for row in rows:
        extracted = _extract_row(row, headers)
        if not extracted["parcel_id"]:
            skipped_no_id += 1
            continue
        land_use = extracted.get("land_use") or ""
        if land_use and not _is_vacant_land(land_use):
            skipped_improved += 1
            continue
        batch.append(extracted)

    if not batch:
        return {
            "county": county, "source": source,
            "uploaded": 0,
            "skipped_no_parcel_id": skipped_no_id,
            "skipped_improved_land": skipped_improved,
            "message": "No valid vacant-land parcels found. Check column names and land use values.",
        }

    parcel_ids = list({r["parcel_id"] for r in batch})
    existing_map: dict[str, dict] = {}
    for i in range(0, len(parcel_ids), 200):
        chunk = parcel_ids[i:i+200]
        res = (
            sb.table("tampa_bay_leads")
            .select("id,parcel_id,pain_signals,owner_name,property_address,lot_acres,land_use,mail_address,mail_city,mail_state,mail_zip")
            .eq("county", county)
            .in_("parcel_id", chunk)
            .execute()
        )
        for rec in (res.data or []):
            existing_map[rec["parcel_id"]] = rec

    to_insert: list[dict] = []
    to_update: list[dict] = []

    for extracted in batch:
        pid = extracted["parcel_id"]
        if pid in existing_map:
            existing = existing_map[pid]
            existing_signals: list = existing.get("pain_signals") or []
            if isinstance(existing_signals, str):
                existing_signals = json.loads(existing_signals)
            if signal_key not in existing_signals:
                new_signals = existing_signals + [signal_key]
            else:
                new_signals = existing_signals
            updates: dict = {
                "pain_signals": new_signals,
                "score": len(new_signals),
                "id": existing["id"],
            }
            for fld in ("owner_name", "property_address", "property_city", "property_zip",
                        "lot_acres", "land_use", "mail_address", "mail_city", "mail_state", "mail_zip"):
                if extracted.get(fld) and not existing.get(fld):
                    updates[fld] = extracted[fld]
            to_update.append(updates)
            updated += 1
        else:
            rec = {
                **extracted,
                "county": county,
                "property_state": "FL",
                "pain_signals": [signal_key],
                "score": 1,
            }
            to_insert.append(rec)
            inserted += 1

    if to_insert:
        for i in range(0, len(to_insert), 100):
            sb.table("tampa_bay_leads").insert(to_insert[i:i+100]).execute()

    for rec in to_update:
        rid = rec.pop("id")
        sb.table("tampa_bay_leads").update(rec).eq("id", rid).execute()

    return {
        "county": county,
        "source": source,
        "label": COUNTY_SOURCES[county][source]["label"],
        "total_in_csv": len(rows),
        "inserted": inserted,
        "updated": updated,
        "skipped_no_parcel_id": skipped_no_id,
        "skipped_improved_land": skipped_improved,
    }


# ── MLS cross-reference ───────────────────────────────────────────────────────

@router.post("/upload/mls")
async def upload_mls(file: UploadFile = File(...)):
    """
    Upload MLS export CSV. Cross-references against tampa_bay_leads by parcel ID or owner name.
    Marks matching leads with on_mls=True and stores list price + DOM.
    """
    raw = await file.read()
    try:
        headers, rows = _parse_csv_bytes(raw)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    if not rows:
        return {"uploaded": 0, "message": "CSV was empty"}

    sb = get_supabase()
    parcel_col  = _find_col(headers, _PARCEL_COLS)
    price_col   = _find_col(headers, ["list price", "listing price", "current price", "price", "list_price"])
    dom_col     = _find_col(headers, ["days on market", "dom", "cumulative days on market", "cdom"])
    owner_col   = _find_col(headers, _OWNER_COLS)

    matched = 0
    for row in rows:
        pid = _clean_parcel((row.get(parcel_col) or "").strip()) if parcel_col else ""
        owner = (row.get(owner_col) or "").strip().lower() if owner_col else ""

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

        if pid:
            res = sb.table("tampa_bay_leads").update(updates).eq("parcel_id", pid).execute()
            if res.data:
                matched += len(res.data)
                continue

        # Fallback: match by owner name
        if owner and len(owner) > 3:
            res = sb.table("tampa_bay_leads").select("id,owner_name").execute()
            for rec in (res.data or []):
                if (rec.get("owner_name") or "").strip().lower() == owner:
                    sb.table("tampa_bay_leads").update(updates).eq("id", rec["id"]).execute()
                    matched += 1
                    break

    return {"total_in_csv": len(rows), "matched_leads": matched}


# ── Stats ─────────────────────────────────────────────────────────────────────

@router.get("/stats")
async def get_stats():
    """Score distribution, per-county counts, and source signal breakdown."""
    sb = get_supabase()
    try:
        res = sb.table("tampa_bay_leads").select("county,score,pain_signals,on_mls,lot_acres").execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    rows = res.data or []
    total = len(rows)
    score_dist = {str(i): 0 for i in range(1, 7)}
    county_counts: dict[str, int] = {"hillsborough": 0, "pinellas": 0, "pasco": 0}
    signal_counts: dict[str, int] = {}
    mls_count = 0

    for r in rows:
        s = r.get("score", 0)
        if 1 <= s <= 6:
            score_dist[str(s)] += 1
        c = r.get("county") or "unknown"
        county_counts[c] = county_counts.get(c, 0) + 1
        signals = r.get("pain_signals") or []
        if isinstance(signals, str):
            try: signals = json.loads(signals)
            except Exception: signals = []
        for sig in signals:
            signal_counts[sig] = signal_counts.get(sig, 0) + 1
        if r.get("on_mls"):
            mls_count += 1

    return {
        "total": total,
        "score_distribution": score_dist,
        "county_counts": county_counts,
        "signal_counts": signal_counts,
        "mls_cross_referenced": mls_count,
        "high_value": sum(v for k, v in score_dist.items() if int(k) >= 4),
    }


# ── Lead list ─────────────────────────────────────────────────────────────────

@router.get("/leads")
async def get_leads(
    county: Optional[str] = Query(None, description="Filter by county (hillsborough|pinellas|pasco)"),
    min_score: int = Query(1, ge=1, le=6),
    on_mls: Optional[bool] = Query(None),
    limit: int = Query(500, ge=1, le=2000),
    offset: int = Query(0, ge=0),
):
    sb = get_supabase()
    try:
        q = (
            sb.table("tampa_bay_leads")
            .select("*")
            .gte("score", min_score)
            .order("score", desc=True)
            .range(offset, offset + limit - 1)
        )
        if county and county in VALID_COUNTIES:
            q = q.eq("county", county)
        if on_mls is not None:
            q = q.eq("on_mls", on_mls)
        res = q.execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {"leads": res.data or [], "offset": offset, "limit": limit}


# ── Export ────────────────────────────────────────────────────────────────────

EXPORT_HEADERS = [
    "Owner Name",
    "Owner First Name",
    "Owner Last Name",
    "Mailing Address",
    "Mailing City",
    "Mailing State",
    "Mailing Zip",
    "Property Address",
    "Property City",
    "Property State",
    "Property Zip",
    "Parcel ID",
    "County",
    "Acres",
    "Land Use",
    "Score",
    "Pain Signals",
    "Tax Deed",
    "Lands Available",
    "Lis Pendens",
    "Foreclosure",
    "Probate",
    "Code Violation",
    "On MLS",
    "MLS List Price",
    "MLS Days on Market",
]


@router.get("/export")
async def export_leads(
    county: Optional[str] = Query(None),
    min_score: int = Query(1, ge=1, le=6),
):
    """
    BatchLeads-ready export CSV with owner details, parcel info, and stacked pain signals.
    Sorted highest score first.
    """
    sb = get_supabase()
    try:
        q = (
            sb.table("tampa_bay_leads")
            .select("*")
            .gte("score", min_score)
            .order("score", desc=True)
        )
        if county and county in VALID_COUNTIES:
            q = q.eq("county", county)
        res = q.execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    rows = res.data or []

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(EXPORT_HEADERS)

    for r in rows:
        signals: list = r.get("pain_signals") or []
        if isinstance(signals, str):
            try: signals = json.loads(signals)
            except Exception: signals = []

        county_val = r.get("county") or ""

        def has_signal(source: str) -> str:
            key = f"{county_val}:{source}"
            return "Yes" if key in signals else ""

        # Human-readable signal names
        signal_labels = []
        for sig in signals:
            parts = sig.split(":", 1)
            src = parts[1] if len(parts) == 2 else sig
            src_label = COUNTY_SOURCES.get(parts[0], {}).get(src, {}).get("label", src) if len(parts) == 2 else src
            signal_labels.append(src_label)

        first = r.get("owner_first_name") or ""
        last  = r.get("owner_last_name") or ""
        owner = r.get("owner_name") or ""
        if not first and not last and owner:
            parts_name = owner.split(" ", 1)
            first = parts_name[0]
            last  = parts_name[1] if len(parts_name) > 1 else ""

        mls_price = r.get("mls_list_price")
        acres = r.get("lot_acres")

        writer.writerow([
            owner,
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
            county_val.capitalize(),
            f"{acres:.2f}" if acres else "",
            r.get("land_use") or "",
            r.get("score") or 0,
            "; ".join(signal_labels),
            has_signal("tax-deed"),
            has_signal("lands-available"),
            has_signal("lis-pendens"),
            has_signal("foreclosure"),
            has_signal("probate"),
            has_signal("code-violation"),
            "Yes" if r.get("on_mls") else "",
            f"{mls_price:.2f}" if mls_price else "",
            r.get("mls_days_on_market") or "",
        ])

    suffix_parts = []
    if county:
        suffix_parts.append(county)
    suffix_parts.append(f"score{min_score}plus")
    suffix_parts.append(f"{len(rows)}records")
    filename = f"tampa-bay-leads-{'-'.join(suffix_parts)}.csv"

    return StreamingResponse(
        io.BytesIO(buf.getvalue().encode("utf-8")),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Schema info (frontend uses to build UI) ───────────────────────────────────

@router.get("/schema")
async def get_schema():
    """Return county/source structure for frontend rendering."""
    return {"counties": COUNTY_SOURCES}


# ── Clear all ─────────────────────────────────────────────────────────────────

@router.delete("/clear")
async def clear_all(county: Optional[str] = Query(None)):
    """Delete all leads, optionally filtered to one county."""
    sb = get_supabase()
    try:
        q = sb.table("tampa_bay_leads").delete().neq("id", "00000000-0000-0000-0000-000000000000")
        if county and county in VALID_COUNTIES:
            q = q.eq("county", county)
        res = q.execute()
        return {"deleted": len(res.data) if res.data else 0}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Clear single source ───────────────────────────────────────────────────────

@router.delete("/clear/{county}/{source}")
async def clear_source(county: str, source: str):
    """
    Remove a single county:source signal from all matching leads.
    Records that drop to score 0 are deleted.
    """
    county = county.lower()
    source = source.lower()
    if county not in VALID_COUNTIES or source not in COUNTY_SOURCES.get(county, {}):
        raise HTTPException(status_code=400, detail=f"Invalid county/source: {county}/{source}")

    signal_key = f"{county}:{source}"
    sb = get_supabase()

    res = sb.table("tampa_bay_leads").select("id,pain_signals").eq("county", county).execute()
    rows = res.data or []

    to_delete = []
    to_update = []

    for r in rows:
        signals: list = r.get("pain_signals") or []
        if isinstance(signals, str):
            try: signals = json.loads(signals)
            except Exception: signals = []
        if signal_key not in signals:
            continue
        new_signals = [s for s in signals if s != signal_key]
        if not new_signals:
            to_delete.append(r["id"])
        else:
            to_update.append({"id": r["id"], "pain_signals": new_signals, "score": len(new_signals)})

    for rid in to_delete:
        sb.table("tampa_bay_leads").delete().eq("id", rid).execute()

    for rec in to_update:
        rid = rec.pop("id")
        sb.table("tampa_bay_leads").update(rec).eq("id", rid).execute()

    return {
        "county": county, "source": source,
        "records_affected": len(to_delete) + len(to_update),
        "deleted_zero_score": len(to_delete),
        "updated": len(to_update),
    }
