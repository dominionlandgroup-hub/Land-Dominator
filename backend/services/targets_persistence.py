"""
Persist and restore the latest target session via Supabase Storage.
Bucket: 'target-files' (create in Supabase → Storage → New Bucket → Private)
"""
import io
import gzip
import json
import logging
import pandas as pd
from datetime import datetime, timezone
from typing import Optional, Tuple, Dict, Any

logger = logging.getLogger(__name__)
_BUCKET = "target-files"
_CSV_PATH = "latest_targets.csv.gz"
_META_PATH = "latest_targets_meta.json"


def persist_targets(session_id: str, df: pd.DataFrame, stats: Dict[str, Any]) -> bool:
    """Save targets CSV + metadata to Supabase Storage. Best-effort, never raises."""
    try:
        from services.supabase_client import get_supabase_admin
        sb = get_supabase_admin()

        buf = io.BytesIO()
        with gzip.GzipFile(fileobj=buf, mode="wb") as gz:
            df.to_csv(gz, index=False)
        buf.seek(0)
        csv_bytes = buf.read()

        for path in [_CSV_PATH, _META_PATH]:
            try:
                sb.storage.from_(_BUCKET).remove([path])
            except Exception:
                pass

        sb.storage.from_(_BUCKET).upload(
            _CSV_PATH, csv_bytes, {"content-type": "application/gzip"}
        )

        meta = {
            "session_id": session_id,
            "total_rows": stats.get("total_rows", len(df)),
            "valid_rows": stats.get("valid_rows", len(df)),
            "columns_found": stats.get("columns_found", list(df.columns)),
            "filename": stats.get("filename", "targets.csv"),
            "uploaded_at": datetime.now(timezone.utc).isoformat(),
        }
        sb.storage.from_(_BUCKET).upload(
            _META_PATH, json.dumps(meta).encode(), {"content-type": "application/json"}
        )

        logger.info("Persisted %d target rows to Supabase Storage", len(df))
        return True
    except Exception as exc:
        logger.warning(
            "Failed to persist targets to Supabase Storage: %s. "
            "Ensure the 'target-files' bucket exists and SUPABASE_SERVICE_KEY is set.",
            exc,
        )
        return False


def restore_targets() -> Optional[Tuple[str, pd.DataFrame, Dict[str, Any]]]:
    """Download latest targets from Supabase Storage. Returns (session_id, df, stats) or None."""
    try:
        from services.supabase_client import get_supabase_admin
        sb = get_supabase_admin()

        meta_bytes = sb.storage.from_(_BUCKET).download(_META_PATH)
        meta: Dict[str, Any] = json.loads(meta_bytes)

        csv_bytes = sb.storage.from_(_BUCKET).download(_CSV_PATH)
        with gzip.GzipFile(fileobj=io.BytesIO(csv_bytes)) as gz:
            df = pd.read_csv(gz, low_memory=False)

        import uuid
        new_session_id = str(uuid.uuid4())

        stats = {
            "session_id":    new_session_id,
            "total_rows":    meta.get("total_rows", len(df)),
            "valid_rows":    meta.get("valid_rows", len(df)),
            "columns_found": meta.get("columns_found", list(df.columns)),
            "missing_columns": [],
            "preview":       [],
            "filename":      meta.get("filename", "targets.csv"),
            "uploaded_at":   meta.get("uploaded_at"),
        }

        logger.info("Restored %d target rows from Supabase Storage", len(df))
        return new_session_id, df, stats
    except Exception as exc:
        logger.debug("Could not restore targets from Supabase Storage: %s", exc)
        return None
