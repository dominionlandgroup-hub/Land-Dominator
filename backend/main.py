"""
Land Parcel Analysis Tool — FastAPI Backend
Entry point: registers all routers and configures middleware.
"""
import os
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from dotenv import load_dotenv

from routers import upload, dashboard, matching, mailing, campaigns, crm, ai_chat
from routers import settings as settings_router
from routers import mail_calendar as mail_cal_router
from routers import communications as comms_router
from routers import market_research as market_research_router

load_dotenv()

app = FastAPI(
    title=os.getenv("APP_NAME", "Land Parcel Analysis Tool"),
    description=(
        "Analyze sold comps, match target parcels, and generate "
        "mail-ready lists with AI-informed offer pricing."
    ),
    version="1.0.0",
)

# ── CORS ──────────────────────────────────────────────────────────────
default_origins = (
    "http://localhost:3000,"
    "http://localhost:5173,"
    "https://frontend-production-47175.up.railway.app,"
    "https://frontend-production-1224.up.railway.app,"
    "https://land-parcel-tool-production.up.railway.app,"
    "https://land-dominator-production.up.railway.app"
)
origins = os.getenv("CORS_ORIGINS", default_origins).split(",")
# Also allow all railway.app subdomains
origins = [o.strip() for o in origins if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_origin_regex=r"https://.*\.up\.railway\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────────
app.include_router(upload.router)
app.include_router(dashboard.router)
app.include_router(matching.router)
app.include_router(mailing.router)
app.include_router(campaigns.router)
app.include_router(crm.router)
app.include_router(ai_chat.router)
app.include_router(settings_router.router)
app.include_router(mail_cal_router.router)
app.include_router(comms_router.router)
app.include_router(market_research_router.router)


# ── Startup migration check ───────────────────────────────────────────

@app.on_event("startup")
async def start_scheduler() -> None:
    """Start APScheduler for weekly Monday notification."""
    try:
        from apscheduler.schedulers.asyncio import AsyncIOScheduler
        from apscheduler.triggers.cron import CronTrigger
        from routers.mail_calendar import send_weekly_summary_task

        scheduler = AsyncIOScheduler()
        scheduler.add_job(
            send_weekly_summary_task,
            CronTrigger(day_of_week="mon", hour=8, minute=0),
            id="weekly_summary",
            replace_existing=True,
        )
        scheduler.start()
        app.state.scheduler = scheduler
        print("Scheduler started — weekly summary fires every Monday 08:00")
    except Exception as exc:
        print(f"Scheduler startup warning: {exc}")


@app.on_event("startup")
async def check_env_vars() -> None:
    """Log presence/absence of all required environment variables at startup."""
    required_vars = [
        "TELNYX_API_KEY",
        "TELNYX_PHONE_NUMBER",
        "TELNYX_CALLBACK_NUMBER",
        "TELNYX_CONNECTION_ID",
        "ELEVENLABS_API_KEY",
        "ELEVENLABS_VOICE_ID",
        "SENDGRID_API_KEY",
        "SUPABASE_URL",
        "SUPABASE_KEY",
        "ANTHROPIC_API_KEY",
    ]
    print("=== Startup environment check ===")
    for var in required_vars:
        val = os.getenv(var)
        if val:
            print(f"  ✓ {var} is set")
        else:
            print(f"  ✗ {var} is MISSING")
    print("=================================")


@app.on_event("startup")
async def warmup_tts() -> None:
    """Pre-generate TTS audio in background — non-blocking so server accepts calls immediately."""
    try:
        import asyncio
        from routers.communications import warmup
        asyncio.create_task(warmup())
    except Exception as exc:
        print(f"TTS warmup warning: {exc}")


@app.on_event("shutdown")
async def stop_scheduler() -> None:
    scheduler = getattr(app.state, "scheduler", None)
    if scheduler and scheduler.running:
        scheduler.shutdown(wait=False)


@app.on_event("startup")
async def check_crm_schema() -> None:
    """Warn at startup if required columns/tables are missing from CRM schema."""
    try:
        from services.supabase_client import get_supabase
        sb = get_supabase()
        sb.table("crm_properties").select("property_id,fips").limit(1).execute()
    except Exception as exc:
        msg = str(exc)
        if "property_id" in msg or "fips" in msg:
            print(
                "\n"
                "═══════════════════════════════════════════════════════════════\n"
                "  MISSING DB COLUMNS — Land Portal integration will not work\n"
                "  Run this SQL in Supabase Dashboard → SQL Editor:\n\n"
                "  ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS property_id TEXT;\n"
                "  ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS fips TEXT;\n\n"
                "  Or call:  POST /crm/db-migrate  to auto-apply.\n"
                "═══════════════════════════════════════════════════════════════\n"
            )

    # Ensure notes history table exists (non-blocking)
    try:
        from services.supabase_client import get_supabase
        sb = get_supabase()
        sb.table("crm_property_notes").select("id").limit(1).execute()
    except Exception:
        print(
            "\n"
            "NOTE: crm_property_notes table missing. Run this in Supabase SQL Editor:\n"
            "  CREATE TABLE IF NOT EXISTS crm_property_notes (\n"
            "    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n"
            "    created_at TIMESTAMPTZ DEFAULT NOW(),\n"
            "    property_id UUID REFERENCES crm_properties(id) ON DELETE CASCADE,\n"
            "    content TEXT NOT NULL\n"
            "  );\n"
        )


# ── Health / Root ─────────────────────────────────────────────────────
@app.get("/health")
async def health_check() -> JSONResponse:
    return JSONResponse({"status": "ok"})


@app.get("/api/health")
async def health_check_api() -> JSONResponse:
    from services.supabase_client import get_supabase
    try:
        get_supabase().table("crm_properties").select("id").limit(1).execute()
        supabase_status = "connected"
    except Exception:
        supabase_status = "error"
    return JSONResponse({"status": "ok", "supabase": supabase_status})


@app.get("/")
async def root() -> JSONResponse:
    return JSONResponse(
        {
            "message": "Land Parcel Analysis Tool API",
            "version": "1.0.0",
            "docs": "/docs",
        }
    )


@app.post("/api/test-pricing")
async def api_test_pricing(request: Request):
    """Alias for /match/test-pricing — used by QA curl tests."""
    from routers.matching import test_pricing_endpoint
    return await test_pricing_endpoint(request)


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
