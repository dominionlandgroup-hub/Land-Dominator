import os
from fastapi import HTTPException
from supabase import create_client, Client

_client: Client | None = None


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
