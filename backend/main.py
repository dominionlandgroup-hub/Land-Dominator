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
    "https://land-parcel-tool-production.up.railway.app"
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


# ── Health / Root ─────────────────────────────────────────────────────
@app.get("/health")
async def health_check() -> JSONResponse:
    return JSONResponse({"status": "healthy", "service": "Land Parcel Analysis Tool API"})


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
