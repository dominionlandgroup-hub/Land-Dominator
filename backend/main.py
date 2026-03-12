"""
Land Parcel Analysis Tool - FastAPI Backend
Main application entry point
"""
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

app = FastAPI(
    title=os.getenv("APP_NAME", "Land Parcel Analysis Tool"),
    description="Analyze sold comps and match target parcels with AI-powered insights",
    version="1.0.0"
)

# CORS configuration
origins = os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health_check():
    """Health check endpoint for deployment monitoring"""
    return JSONResponse({
        "status": "healthy",
        "service": "Land Parcel Analysis Tool API"
    })

@app.get("/")
async def root():
    """Root endpoint"""
    return JSONResponse({
        "message": "Land Parcel Analysis Tool API",
        "version": "1.0.0",
        "docs": "/docs"
    })

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
