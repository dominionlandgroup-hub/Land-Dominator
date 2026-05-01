import os
from fastapi import HTTPException
from supabase import create_client, Client

_client: Client | None = None
_admin_client: Client | None = None


def get_supabase() -> Client:
    global _client
    if _client is None:
        url = os.getenv("SUPABASE_URL", "").strip()
        key = os.getenv("SUPABASE_KEY", "").strip()
        if not url or not key:
            raise HTTPException(
                status_code=503,
                detail="Database not configured. Set SUPABASE_URL and SUPABASE_KEY in the backend environment.",
            )
        _client = create_client(url, key)
    return _client


def get_supabase_admin() -> Client:
    """Return a Supabase client using the service role key.

    Required for Storage operations — the anon key is typically blocked by
    Storage RLS policies even when the bucket exists.
    Falls back to the anon-key client if SUPABASE_SERVICE_KEY is not set so
    existing deployments continue to work (with a logged warning).
    """
    global _admin_client
    if _admin_client is None:
        url = os.getenv("SUPABASE_URL", "").strip()
        service_key = os.getenv("SUPABASE_SERVICE_KEY", "").strip()
        if not url:
            raise HTTPException(
                status_code=503,
                detail="Database not configured. Set SUPABASE_URL in the backend environment.",
            )
        if service_key:
            _admin_client = create_client(url, service_key)
        else:
            # No service key configured — fall back to anon client and warn
            import logging
            logging.getLogger(__name__).warning(
                "SUPABASE_SERVICE_KEY not set. Storage operations will use the anon key "
                "and may fail if Storage RLS policies are enabled. Add the service role key "
                "from Supabase Settings → API → Secret keys."
            )
            _admin_client = get_supabase()
    return _admin_client
