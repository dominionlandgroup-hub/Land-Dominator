"""
Campaign management: save, list, rename, delete, re-download.
Stored as JSON metadata + CSV output files on disk.
Includes filter settings for the 'Duplicate Settings' feature.
"""
import io
import json
import uuid
import os
from datetime import datetime
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse, JSONResponse
from typing import List

from models.schemas import Campaign, CampaignCreate, CampaignRename
from routers.mailing import _deduplicate, _build_csv
from storage.session_store import get_match

router = APIRouter(prefix="/campaigns", tags=["campaigns"])

CAMPAIGNS_DIR = os.path.join(os.path.dirname(__file__), "..", "campaigns")


def _ensure_dir() -> None:
    os.makedirs(CAMPAIGNS_DIR, exist_ok=True)


def _meta_path(campaign_id: str) -> str:
    return os.path.join(CAMPAIGNS_DIR, f"{campaign_id}.json")


def _csv_path(campaign_id: str) -> str:
    return os.path.join(CAMPAIGNS_DIR, f"{campaign_id}.csv")


def _offer_stats(rows: list) -> dict:
    mids = []
    for r in rows:
        try:
            if isinstance(r, dict):
                raw_val = r.get("suggested_offer_mid")
            else:
                raw_val = getattr(r, "suggested_offer_mid", None)
            v = float(raw_val)
            if v > 0:
                mids.append(v)
        except (TypeError, ValueError):
            continue
    if not mids:
        return {"offer_min": None, "offer_max": None, "offer_median": None}
    mids.sort()
    n = len(mids)
    med = mids[n // 2] if n % 2 == 1 else (mids[n // 2 - 1] + mids[n // 2]) / 2.0
    return {
        "offer_min": round(mids[0], 2),
        "offer_max": round(mids[-1], 2),
        "offer_median": round(med, 2),
    }


# ─────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────

@router.post("", response_model=Campaign)
async def create_campaign(body: CampaignCreate) -> Campaign:
    """Save a match run as a named campaign with filter settings."""
    _ensure_dir()

    match_data = get_match(body.match_id)
    if match_data is None:
        raise HTTPException(
            status_code=404,
            detail="Match result not found. Run the matching engine first.",
        )

    cleaned, n_foreign, n_dnm = _deduplicate(match_data["results"])
    csv_bytes = _build_csv(cleaned)

    campaign_id = str(uuid.uuid4())
    created_at = datetime.utcnow().isoformat() + "Z"

    offer_stats = _offer_stats(cleaned)
    stats = {
        "total_targets": match_data["total_targets"],
        "matched_count": match_data["matched_count"],
        "mailing_list_count": len(cleaned),
        "filtered_foreign": n_foreign,
        "filtered_do_not_mail": n_dnm,
        **offer_stats,
    }

    # Store filter settings for 'Duplicate Settings' feature
    settings = body.filters or {}

    meta: dict = {
        "id": campaign_id,
        "name": body.name,
        "created_at": created_at,
        "match_id": body.match_id,
        "settings": settings,
        "stats": stats,
        "has_output": True,
        "notes": "",
    }

    with open(_meta_path(campaign_id), "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)

    with open(_csv_path(campaign_id), "wb") as f:
        f.write(csv_bytes)

    return Campaign(
        id=campaign_id,
        name=body.name,
        created_at=created_at,
        settings=settings,
        stats=stats,
        has_output=True,
        notes="",
    )


@router.get("", response_model=List[Campaign])
async def list_campaigns() -> List[Campaign]:
    """List all saved campaigns, newest first."""
    _ensure_dir()
    campaigns: List[Campaign] = []

    for fname in os.listdir(CAMPAIGNS_DIR):
        if not fname.endswith(".json"):
            continue
        try:
            with open(os.path.join(CAMPAIGNS_DIR, fname), "r", encoding="utf-8") as f:
                meta = json.load(f)
            cid = meta["id"]
            campaigns.append(
                Campaign(
                    id=cid,
                    name=meta.get("name", "Unnamed"),
                    created_at=meta.get("created_at", ""),
                    settings=meta.get("settings", {}),
                    stats=meta.get("stats", {}),
                    has_output=os.path.exists(_csv_path(cid)),
                    notes=meta.get("notes", ""),
                )
            )
        except Exception:
            continue

    campaigns.sort(key=lambda c: c.created_at, reverse=True)
    return campaigns


@router.get("/{campaign_id}", response_model=Campaign)
async def get_campaign(campaign_id: str) -> Campaign:
    path = _meta_path(campaign_id)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Campaign not found")

    with open(path, "r", encoding="utf-8") as f:
        meta = json.load(f)

    return Campaign(
        id=meta["id"],
        name=meta.get("name", "Unnamed"),
        created_at=meta.get("created_at", ""),
        settings=meta.get("settings", {}),
        stats=meta.get("stats", {}),
        has_output=os.path.exists(_csv_path(campaign_id)),
        notes=meta.get("notes", ""),
    )


@router.patch("/{campaign_id}", response_model=Campaign)
async def rename_campaign(campaign_id: str, body: CampaignRename) -> Campaign:
    path = _meta_path(campaign_id)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Campaign not found")

    with open(path, "r", encoding="utf-8") as f:
        meta = json.load(f)

    if body.name is not None:
        meta["name"] = body.name
    if body.notes is not None:
        meta["notes"] = body.notes

    with open(path, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)

    return Campaign(
        id=meta["id"],
        name=meta["name"],
        created_at=meta.get("created_at", ""),
        settings=meta.get("settings", {}),
        stats=meta.get("stats", {}),
        has_output=os.path.exists(_csv_path(campaign_id)),
        notes=meta.get("notes", ""),
    )


@router.patch("/{campaign_id}/notes", response_model=Campaign)
async def patch_campaign_notes(campaign_id: str, body: CampaignRename) -> Campaign:
    path = _meta_path(campaign_id)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Campaign not found")

    with open(path, "r", encoding="utf-8") as f:
        meta = json.load(f)

    meta["notes"] = body.notes or ""

    with open(path, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)

    return Campaign(
        id=meta["id"],
        name=meta.get("name", "Unnamed"),
        created_at=meta.get("created_at", ""),
        settings=meta.get("settings", {}),
        stats=meta.get("stats", {}),
        has_output=os.path.exists(_csv_path(campaign_id)),
        notes=meta.get("notes", ""),
    )


@router.delete("/{campaign_id}")
async def delete_campaign(campaign_id: str) -> dict:
    meta_p = _meta_path(campaign_id)
    csv_p = _csv_path(campaign_id)

    if not os.path.exists(meta_p):
        raise HTTPException(status_code=404, detail="Campaign not found")

    os.remove(meta_p)
    if os.path.exists(csv_p):
        os.remove(csv_p)

    return {"deleted": campaign_id}


@router.get("/{campaign_id}/download")
async def download_campaign(campaign_id: str) -> StreamingResponse:
    """Re-download the CSV output of a saved campaign."""
    csv_p = _csv_path(campaign_id)
    if not os.path.exists(csv_p):
        raise HTTPException(status_code=404, detail="Output file not found for this campaign")

    meta_p = _meta_path(campaign_id)
    name = "campaign"
    record_count = ""
    if os.path.exists(meta_p):
        with open(meta_p, "r", encoding="utf-8") as f:
            meta = json.load(f)
        name = meta.get("name", "campaign")
        count = meta.get("stats", {}).get("mailing_list_count", "")
        if count:
            record_count = f"-{count}-records"

    safe_name = "".join(
        c if c.isalnum() or c in ("-", "_") else "-" for c in name.lower()
    ).strip("-")

    filename = f"{safe_name}{record_count}.csv"

    with open(csv_p, "rb") as f:
        data = f.read()

    return StreamingResponse(
        io.BytesIO(data),
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"'
        },
    )
