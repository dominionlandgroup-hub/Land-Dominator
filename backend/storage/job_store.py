"""
DB-backed match job store using crm_match_jobs table.
Falls back to in-memory silently when Supabase is unavailable or table doesn't exist.

Schema (run in Supabase SQL Editor):
  CREATE TABLE IF NOT EXISTS crm_match_jobs (
    id TEXT PRIMARY KEY,
    status TEXT DEFAULT 'running',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    total_targets INTEGER,
    progress INTEGER DEFAULT 0,
    match_id TEXT,
    message TEXT,
    error TEXT
  );
"""
import threading
import time
from typing import Any, Dict, Optional

_mem: Dict[str, Dict] = {}
_lock = threading.Lock()
_JOB_TTL = 3600  # seconds before in-memory entry is evicted

_TABLE = "crm_match_jobs"


def _sb():
    try:
        from services.supabase_client import get_supabase
        return get_supabase()
    except Exception:
        return None


def _db_write(op, *args, **kwargs):
    """Execute a Supabase write, silently swallowing errors."""
    sb = _sb()
    if not sb:
        return
    try:
        op(sb, *args, **kwargs)
    except Exception as exc:
        print(f"[job_store] DB write skipped: {exc}", flush=True)


# ── Public API ────────────────────────────────────────────────────────────────

def create_job(job_id: str, total: int) -> None:
    """Record a new running job."""
    msg = f"Starting… 0 of {total:,} processed"
    with _lock:
        _mem[job_id] = {
            "id": job_id,
            "status": "running",
            "total_targets": total,
            "progress": 0,
            "match_id": None,
            "error": None,
            "message": msg,
            "created_at": time.time(),
        }

    def _write(sb):
        sb.table(_TABLE).upsert({
            "id": job_id,
            "status": "running",
            "total_targets": total,
            "progress": 0,
            "message": msg,
        }, on_conflict="id", ignore_duplicates=False).execute()

    _db_write(_write)


def update_progress(job_id: str, progress: int, total: int) -> None:
    msg = f"Matching… {progress:,} of {total:,} complete"
    with _lock:
        j = _mem.get(job_id)
        if j:
            j["progress"] = progress
            j["message"] = msg

    def _write(sb):
        sb.table(_TABLE).update({"progress": progress, "message": msg}).eq("id", job_id).execute()

    _db_write(_write)


def complete_job(job_id: str, match_id: str, total: int) -> None:
    with _lock:
        j = _mem.get(job_id)
        if j:
            j["status"] = "complete"
            j["match_id"] = match_id
            j["progress"] = total
            j["message"] = "Complete"

    def _write(sb):
        sb.table(_TABLE).update({
            "status": "complete",
            "match_id": match_id,
            "progress": total,
            "message": "Complete",
        }).eq("id", job_id).execute()

    _db_write(_write)


def fail_job(job_id: str, error: str) -> None:
    with _lock:
        j = _mem.get(job_id)
        if j:
            j["status"] = "error"
            j["error"] = error

    def _write(sb):
        sb.table(_TABLE).update({
            "status": "error",
            "error": error[:500],
        }).eq("id", job_id).execute()

    _db_write(_write)


def get_job(job_id: str) -> Optional[Dict[str, Any]]:
    """Return job dict, falling back to DB lookup after a server restart."""
    with _lock:
        j = _mem.get(job_id)
        if j:
            return dict(j)

    # Not in memory — server may have restarted; try DB
    sb = _sb()
    if not sb:
        return None
    try:
        res = sb.table(_TABLE).select("*").eq("id", job_id).limit(1).execute()
        rows = res.data or []
        if not rows:
            return None
        row = rows[0]
        with _lock:
            _mem[job_id] = row  # warm the cache
        return dict(row)
    except Exception as exc:
        print(f"[job_store] get_job DB read failed: {exc}", flush=True)
        return None


def cleanup_old_jobs() -> None:
    """Evict stale in-memory entries."""
    now = time.time()
    with _lock:
        stale = [
            jid for jid, j in _mem.items()
            if isinstance(j.get("created_at"), (int, float))
            and now - j["created_at"] > _JOB_TTL
        ]
        for jid in stale:
            del _mem[jid]


async def recover_interrupted_jobs() -> None:
    """
    Called at server startup. Any job still in 'running' state was killed by a
    restart. Mark them as 'error' so the frontend can show a clear message.
    """
    sb = _sb()
    if not sb:
        return
    try:
        res = sb.table(_TABLE).select("id").eq("status", "running").execute()
        ids = [r["id"] for r in (res.data or [])]
        if not ids:
            return
        for jid in ids:
            sb.table(_TABLE).update({
                "status": "error",
                "error": "Server restarted — please re-run the matching engine.",
            }).eq("id", jid).execute()
        print(f"[job_store] Marked {len(ids)} interrupted job(s) as error on startup", flush=True)
    except Exception as exc:
        print(f"[job_store] recover_interrupted_jobs skipped: {exc}", flush=True)


MIGRATION_SQL = """
CREATE TABLE IF NOT EXISTS crm_match_jobs (
  id TEXT PRIMARY KEY,
  status TEXT DEFAULT 'running',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  total_targets INTEGER,
  progress INTEGER DEFAULT 0,
  match_id TEXT,
  message TEXT,
  error TEXT
);
""".strip()
