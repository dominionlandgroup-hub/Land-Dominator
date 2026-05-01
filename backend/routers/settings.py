"""CRM Settings router — key/value store for buy box and workflow config."""
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.supabase_client import get_supabase

router = APIRouter(prefix="/crm", tags=["settings"])


class SettingUpsert(BaseModel):
    value: Any


@router.get("/settings/{key}")
async def get_setting(key: str) -> dict:
    sb = get_supabase()
    try:
        res = sb.table("crm_settings").select("*").eq("key", key).execute()
        if not res.data:
            return {"key": key, "value": None}
        return res.data[0]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.put("/settings/{key}")
async def upsert_setting(key: str, body: SettingUpsert) -> dict:
    sb = get_supabase()
    try:
        now = datetime.now(timezone.utc).isoformat()
        res = sb.table("crm_settings").upsert(
            {"key": key, "value": body.value, "updated_at": now},
            on_conflict="key",
        ).execute()
        if not res.data:
            raise HTTPException(status_code=500, detail="Upsert failed")
        return res.data[0]
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# ── Migration SQL ──────────────────────────────────────────────────────

SETTINGS_MIGRATION_SQL = """
CREATE TABLE IF NOT EXISTS crm_settings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key         TEXT UNIQUE NOT NULL,
  value       JSONB,
  updated_at  TIMESTAMPTZ DEFAULT now()
);
"""
