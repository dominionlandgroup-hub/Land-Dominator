"""
Upload endpoints for comps and target CSVs.
"""
import uuid
import threading
from datetime import datetime, timezone
import pandas as pd
from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse

from models.schemas import UploadResponse
from services.csv_parser import parse_csv
from storage.session_store import store_comps, store_targets, get_comps

router = APIRouter(prefix="/upload", tags=["upload"])

MAX_SIZE_BYTES = 300 * 1024 * 1024  # 300 MB

COMP_COLS_REQUIRED = [
    'APN', 'Latitude', 'Longitude', 'Lot Acres', 'Parcel Zip',
    'Current Sale Price', 'Current Sale Recording Date',
    'Parcel Full Address', 'Parcel City', 'Parcel State', 'Parcel County',
    'Current Sale Buyer 1 Full Name', 'Current Sale Seller 1 Full Name',
    'FL FEMA Flood Zone', 'Buildability total (%)', 'TLP Estimate',
    'Lot Sq Ft', 'Calc Acreage', 'Parcel Address County',
    # Quality fields — present in some LP comp exports; preserved when available
    'Road Frontage', 'Slope', 'Average Slope', 'Wetlands Coverage',
]

TARGET_COLS_REQUIRED = [
    'APN', 'propertyID', 'Latitude', 'Longitude', 'Lot Acres', 'Lot Sq Ft',
    'Parcel Zip', 'Parcel City', 'Parcel State', 'Parcel County',
    'Parcel Full Address', 'Parcel Address County', 'Parcel FIPS', 'Parcel Carrier Code',
    'Owner Name(s)', 'Owner 1 Full Name',
    'Owner 1 First Name', 'Owner 1 Middle Name', 'Owner 1 Last Name',
    'Owner 2 Full Name', 'Owner 2 First Name', 'Owner 2 Last Name',
    'Mail Names', 'Mail Full Address', 'Mail City', 'Mail State', 'Mail Zip', 'Mail County',
    'Mail Care Of', 'Mail Foreign Address Indicator',
    'Do Not Mail',
    'Current Sale Price', 'Current Sale Recording Date', 'Current Sale Contract Date',
    'Prev Sales Price', 'Prev Sale Recording Date',
    'FL FEMA Flood Zone', 'FEMA Flood Coverage',
    'Buildability total (%)', 'TLP Estimate',
    'Vacant Flag', 'Land Locked', 'Road Frontage',
    'Building Sq Ft', 'Building Area', 'Bldg Area',
    'MLS Parcel Acreage', 'Zoning', 'Topography',
    'Total Assessed Value', 'Land Market Value',
]

def slim_to_required(df: pd.DataFrame, required_cols: list) -> pd.DataFrame:
    available = [c for c in required_cols if c in df.columns]
    return df[available].copy()

def downcast_numerics(df: pd.DataFrame) -> pd.DataFrame:
    for col in df.select_dtypes(include=['float64']).columns:
        df[col] = pd.to_numeric(df[col], downcast='float')
    for col in df.select_dtypes(include=['int64']).columns:
        df[col] = pd.to_numeric(df[col], downcast='integer')
    return df



@router.post("/comps", response_model=UploadResponse)
async def upload_comps(file: UploadFile = File(...)) -> UploadResponse:
    """
    Upload and parse a Sold Comps CSV (Land Portal export).
    Returns a session_id used by subsequent dashboard/match calls.
    """
    _validate_file(file)
    content = await file.read()

    if len(content) > MAX_SIZE_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 300 MB)")

    try:
        df, stats = parse_csv(content, is_comps=True)
        df = slim_to_required(df, COMP_COLS_REQUIRED)
        df = downcast_numerics(df)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    session_id = str(uuid.uuid4())
    store_comps(session_id, df)
    uploaded_at = datetime.now(timezone.utc).isoformat()

    # Persist to Supabase Storage in background (best-effort, never blocks the response)
    def _persist():
        from services.comps_persistence import persist_comps
        persist_comps(session_id, df, {**stats, "uploaded_at": uploaded_at})

    threading.Thread(target=_persist, daemon=True).start()

    return UploadResponse(
        session_id=session_id,
        total_rows=stats["total_rows"],
        valid_rows=stats["valid_rows"],
        columns_found=stats["columns_found"],
        missing_columns=stats["missing_columns"],
        preview=stats["preview"],
        uploaded_at=uploaded_at,
    )


@router.post("/targets", response_model=UploadResponse)
async def upload_targets(file: UploadFile = File(...)) -> UploadResponse:
    """
    Upload and parse a Target Parcels CSV (Land Portal export).
    Returns a target_session_id used by the matching engine.
    """
    _validate_file(file)
    content = await file.read()

    if len(content) > MAX_SIZE_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 300 MB)")

    try:
        df, stats = parse_csv(content, is_comps=False)
        df = slim_to_required(df, TARGET_COLS_REQUIRED)
        df = downcast_numerics(df)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    session_id = str(uuid.uuid4())
    store_targets(session_id, df)

    return UploadResponse(
        session_id=session_id,
        total_rows=stats["total_rows"],
        valid_rows=stats["valid_rows"],
        columns_found=stats["columns_found"],
        missing_columns=stats["missing_columns"],
        preview=stats["preview"],
    )


@router.get("/comps/latest-session", response_model=UploadResponse)
async def get_latest_comps_session() -> UploadResponse:
    """
    Return the latest comps session.
    If the session is still in backend memory, return its stats immediately.
    Otherwise, restore from Supabase Storage (re-hydrates in-memory session).
    Returns 404 if no comps have been uploaded yet.
    """
    from services.comps_persistence import restore_comps

    result = restore_comps()
    if result is None:
        raise HTTPException(
            status_code=404,
            detail="No comps found. Please upload a comps CSV first.",
        )

    session_id, df, stats = result

    # Only store in memory if not already there (avoids overwriting a fresh upload)
    if get_comps(session_id) is None:
        store_comps(session_id, df)

    return UploadResponse(
        session_id=session_id,
        total_rows=stats["total_rows"],
        valid_rows=stats["valid_rows"],
        columns_found=stats.get("columns_found", []),
        missing_columns=[],
        preview=[],
        uploaded_at=stats.get("uploaded_at"),
    )


def _validate_file(file: UploadFile) -> None:
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are accepted")
