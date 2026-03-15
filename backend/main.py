"""
Land Parcel Analysis Tool — FastAPI Backend
Entry point: registers all routers and configures middleware.
"""
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from dotenv import load_dotenv

from routers import upload, dashboard, matching, mailing, campaigns

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
origins = os.getenv(
    "CORS_ORIGINS", "http://localhost:3000,http://localhost:5173"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
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


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
