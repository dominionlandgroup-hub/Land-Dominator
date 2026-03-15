"""
Upload endpoints for comps and target CSVs.
"""
import uuid
from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse

from models.schemas import UploadResponse
from services.csv_parser import parse_csv
from storage.session_store import store_comps, store_targets

router = APIRouter(prefix="/upload", tags=["upload"])

MAX_SIZE_BYTES = 300 * 1024 * 1024  # 300 MB


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
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    session_id = str(uuid.uuid4())
    store_comps(session_id, df)

    return UploadResponse(
        session_id=session_id,
        total_rows=stats["total_rows"],
        valid_rows=stats["valid_rows"],
        columns_found=stats["columns_found"],
        missing_columns=stats["missing_columns"],
        preview=stats["preview"],
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


def _validate_file(file: UploadFile) -> None:
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are accepted")
