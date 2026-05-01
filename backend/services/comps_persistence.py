"""
Persist and restore comps sessions via Supabase Storage.

Required one-time setup in Supabase:
  Storage → New Bucket → Name: 'comps-uploads' → Private

No new database tables needed — metadata is stored as JSON alongside the CSV.
"""
import io
import gzip
import json
import logging
import pandas as pd
from datetime import datetime, timezone
from typing import Optional, Tuple, Dict, Any

logger = logging.getLogger(__name__)
_BUCKET = "comps-uploads"
_CSV_PATH = "latest-comps.csv.gz"
_META_PATH = "latest-meta.json"


def persist_comps(session_id: str, df: pd.DataFrame, stats: Dict[str, Any]) -> bool:
    """Persist comps to Supabase Storage (best-effort, never raises)."""
    try:
        from services.supabase_client import get_supabase_admin
        sb = get_supabase_admin()

        # Serialize df as gzipped CSV
        buf = io.BytesIO()
        with gzip.GzipFile(fileobj=buf, mode="wb") as gz:
            df.to_csv(gz, index=False)
        buf.seek(0)
        csv_bytes = buf.read()

        # Upload CSV (remove old first, ignore errors)
        try:
            sb.storage.from_(_BUCKET).remove([_CSV_PATH])
        except Exception:
            pass
        sb.storage.from_(_BUCKET).upload(
            _CSV_PATH, csv_bytes, {"content-type": "application/gzip"}
        )

        # Upload metadata JSON
        meta = {
            "session_id": session_id,
            "total_rows": stats["total_rows"],
            "valid_rows": stats["valid_rows"],
            "columns_found": stats.get("columns_found", []),
            "uploaded_at": datetime.now(timezone.utc).isoformat(),
        }
        meta_bytes = json.dumps(meta).encode()
        try:
            sb.storage.from_(_BUCKET).remove([_META_PATH])
        except Exception:
            pass
        sb.storage.from_(_BUCKET).upload(
            _META_PATH, meta_bytes, {"content-type": "application/json"}
        )

        logger.info("Persisted %d comps rows to Supabase Storage", stats["total_rows"])
        return True

    except Exception as exc:
        logger.warning(
            "Failed to persist comps to Supabase Storage: %s. "
            "Ensure the 'comps-uploads' bucket exists (Supabase → Storage → New Bucket) "
            "and SUPABASE_SERVICE_KEY is set.",
            exc,
        )
        return False


def restore_comps() -> Optional[Tuple[str, pd.DataFrame, Dict[str, Any]]]:
    """Download latest comps from Supabase Storage. Returns (session_id, df, stats) or None."""
    try:
        from services.supabase_client import get_supabase_admin
        sb = get_supabase_admin()

        # Download metadata
        meta_bytes = sb.storage.from_(_BUCKET).download(_META_PATH)
        meta = json.loads(meta_bytes)

        # Download CSV
        csv_bytes = sb.storage.from_(_BUCKET).download(_CSV_PATH)
        with gzip.GzipFile(fileobj=io.BytesIO(csv_bytes), mode="rb") as gz:
            df = pd.read_csv(gz)

        stats = {
            "total_rows": meta["total_rows"],
            "valid_rows": meta["valid_rows"],
            "columns_found": meta.get("columns_found") or [],
            "missing_columns": [],
            "preview": [],
            "uploaded_at": meta.get("uploaded_at", ""),
        }

        logger.info("Restored %d comps rows from Supabase Storage", len(df))
        return meta["session_id"], df, stats

    except Exception as exc:
        logger.warning("Failed to restore comps from Supabase Storage: %s", exc)
        return None
