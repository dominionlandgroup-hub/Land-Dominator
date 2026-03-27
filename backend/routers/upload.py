"""
Upload endpoints for comps and target CSVs.
"""
import uuid
from typing import Tuple, List

import pandas as pd
from fastapi import APIRouter, UploadFile, File, HTTPException

from models.schemas import UploadResponse
from services.csv_parser import parse_csv
from storage.session_store import store_comps, store_targets

router = APIRouter(prefix="/upload", tags=["upload"])

MAX_SIZE_BYTES = 300 * 1024 * 1024  # 300 MB

COMP_COLS_REQUIRED = [
    'APN', 'Latitude', 'Longitude', 'Lot Acres', 'Parcel Zip',
    'Current Sale Price', 'Current Sale Recording Date',
    'Parcel Full Address', 'Parcel City',
    'Current Sale Buyer 1 Full Name', 'Current Sale Seller 1 Full Name',
    'FL FEMA Flood Zone', 'Buildability total (%)', 'TLP Estimate'
]

TARGET_COLS_REQUIRED = [
    'APN', 'propertyID', 'Latitude', 'Longitude', 'Lot Acres',
    'Parcel Zip', 'Parcel City', 'Owner Name(s)', 'Owner 1 Full Name',
    'Mail Full Address', 'Mail City', 'Mail State', 'Mail Zip',
    'FL FEMA Flood Zone', 'FEMA Flood Coverage', 'Buildability total (%)', 'TLP Estimate',
    'Vacant Flag', 'Land Locked', 'Road Frontage', 'Land Locked Flag', 'Road Frontage Flag',
    'Do Not Mail', 'Mail Foreign Address Indicator'
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


def detect_and_normalize_comps(df: pd.DataFrame) -> Tuple[pd.DataFrame, str, str, str, List[str]]:
    is_mls = 'Close Price' in df.columns or 'Approximate Acres' in df.columns

    if is_mls:
        mapped_pairs: List[str] = []
        if 'Close Price' in df.columns:
            df['Current Sale Price'] = pd.to_numeric(
                df['Close Price'].astype(str)
                .str.replace('$', '', regex=False)
                .str.replace(',', '', regex=False)
                .str.strip(),
                errors='coerce'
            )
            mapped_pairs.append('Close Price → Current Sale Price')
        elif 'List Price' in df.columns:
            df['Current Sale Price'] = pd.to_numeric(df['List Price'], errors='coerce')
            mapped_pairs.append('List Price → Current Sale Price')

        col_map = {
            'Approximate Acres': 'Lot Acres',
            'Geocodio Latitude': 'Latitude',
            'Geocodio Longitude': 'Longitude',
            'Postal Code': 'Parcel Zip',
            'Address': 'Parcel Full Address',
            'Close Date': 'Current Sale Recording Date',
            'City': 'Parcel City',
        }
        for src, dst in col_map.items():
            if src in df.columns and dst not in df.columns:
                df[dst] = df[src]
                mapped_pairs.append(f'{src} → {dst}')

        df['APN'] = 'MLS-' + df.index.astype(str)
        mapped_pairs.append('Generated APN → APN')
        df['_file_format'] = 'MLS'
        msg = (
            f"MLS format detected — {len(mapped_pairs)} columns auto-mapped from MLS fields "
            f"({', '.join(mapped_pairs)})."
        )
        return df, 'MLS', msg, 'info', mapped_pairs

    df['_file_format'] = 'LandPortal'
    return df, 'LandPortal', "Land Portal format detected.", 'success', []



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
        df, detected_format, format_message, message_severity, mapped_columns = detect_and_normalize_comps(df)
        required_cols = COMP_COLS_REQUIRED.copy()
        if "_file_format" not in required_cols:
            required_cols.append("_file_format")
        df = slim_to_required(df, required_cols)
        df = downcast_numerics(df)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    session_id = str(uuid.uuid4())
    store_comps(session_id, df)

    valid_sale_prices = 0
    if "Current Sale Price" in df.columns:
        valid_sale_prices = int(pd.to_numeric(df["Current Sale Price"], errors="coerce").gt(0).sum())

    return UploadResponse(
        session_id=session_id,
        total_rows=stats["total_rows"],
        valid_rows=stats["valid_rows"],
        columns_found=stats["columns_found"],
        missing_columns=stats["missing_columns"],
        preview=stats["preview"],
        valid_sale_prices=valid_sale_prices,
        format_detected=detected_format,
        message=format_message,
        message_severity=message_severity,
        mapped_columns=mapped_columns,
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


def _validate_file(file: UploadFile) -> None:
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are accepted")
