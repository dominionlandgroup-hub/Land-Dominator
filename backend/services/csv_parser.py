"""
CSV parsing and validation for Land Portal exports.
"""
import pandas as pd
from io import BytesIO
from typing import Tuple, Dict, Any, List

REQUIRED_COLS = [
    "APN",
    "Lot Acres",
    "Latitude",
    "Longitude",
    "Parcel Zip",
    "Parcel City",
    "Owner Name(s)",
    "Mail Full Address",
    "Mail City",
    "Mail State",
    "Mail Zip",
]

NUMERIC_COLS = [
    "Lot Acres",
    "Calc Acreage",
    "Latitude",
    "Longitude",
    "Current Sale Price",
    "TLP Estimate",
    "Total Assessed Value",
    "Land Market Value",
    "Buildability total (%)",
    "Slope AVG",
    "FEMA Flood Coverage",
    "Wetlands Coverage",
]

STRING_COLS = [
    "APN",
    "propertyID",
    "Parcel Zip",
    "Parcel City",
    "Parcel State",
    "Owner Name(s)",
    "Owner 1 Full Name",
    "Mail Full Address",
    "Mail City",
    "Mail State",
    "Mail Zip",
    "Mail Foreign Address Indicator",
    "FL FEMA Flood Zone",
    "Zoning",
    "Topography",
    "Vacant Flag",
    "Do Not Mail",
    "Road Frontage",
    "Land Locked",
    "Current Sale Recording Date",
]


def parse_csv(
    file_content: bytes, is_comps: bool = True
) -> Tuple[pd.DataFrame, Dict[str, Any]]:
    """
    Parse and validate a Land Portal CSV file.
    Returns (DataFrame, stats_dict).
    Raises ValueError on unrecoverable parse failure.
    """
    # Force ZIP/APN columns to be read as strings to avoid float representation
    dtype_overrides: Dict[str, Any] = {
        "Parcel Zip": str,
        "Mail Zip": str,
        "APN": str,
        "propertyID": str,
    }

    df: pd.DataFrame | None = None
    for encoding in ["utf-8", "latin-1", "cp1252"]:
        try:
            df = pd.read_csv(
                BytesIO(file_content),
                encoding=encoding,
                low_memory=False,
                dtype=dtype_overrides,
            )
            break
        except UnicodeDecodeError:
            continue
        except Exception as e:
            raise ValueError(f"Failed to parse CSV: {e}") from e

    if df is None:
        raise ValueError("Could not decode CSV — try saving as UTF-8.")

    # Strip leading/trailing whitespace from column names
    df.columns = [c.strip() for c in df.columns]

    # Identify missing required columns
    missing: List[str] = [c for c in REQUIRED_COLS if c not in df.columns]

    # Strip currency formatting from TLP Estimate before numeric conversion
    if "TLP Estimate" in df.columns:
        df["TLP Estimate"] = (
            df["TLP Estimate"].astype(str)
            .str.replace(r"[\$,\s]", "", regex=True)
            .replace(["nan", "None", "NaN", ""], pd.NA)
        )

    # Normalize numeric fields
    for col in NUMERIC_COLS:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    # Normalize string fields
    for col in STRING_COLS:
        if col in df.columns:
            df[col] = df[col].astype(str).str.strip()
            df[col] = df[col].replace(["nan", "None", "NaN", ""], pd.NA)

    # Normalize ZIP codes: strip trailing .0 (e.g. "28461.0" → "28461")
    for zip_col in ["Parcel Zip", "Mail Zip"]:
        if zip_col in df.columns:
            df[zip_col] = (
                df[zip_col]
                .astype(str)
                .str.strip()
                .str.replace(r"\.0$", "", regex=True)
                .replace(["nan", "None", "NaN", ""], pd.NA)
            )

    # Merge Lot Acres / Calc Acreage
    if "Lot Acres" not in df.columns and "Calc Acreage" in df.columns:
        df["Lot Acres"] = df["Calc Acreage"]
    elif "Lot Acres" in df.columns and "Calc Acreage" in df.columns:
        df["Lot Acres"] = df["Lot Acres"].fillna(df["Calc Acreage"])

    total_rows = len(df)
    valid_rows = total_rows

    if is_comps and "Current Sale Price" in df.columns:
        # Valid comps must have BOTH positive price AND positive acres
        # (zero acres = infinite $/acre which corrupts pricing)
        valid_mask = (
            (df["Current Sale Price"].notna()) & (df["Current Sale Price"] > 0)
        )
        if "Lot Acres" in df.columns:
            valid_mask &= (df["Lot Acres"].notna()) & (df["Lot Acres"] > 0)
        valid_rows = int(valid_mask.sum())

    # Preview: first 20 rows, NaN → None for JSON safety
    preview_df = df.head(20).where(pd.notnull(df.head(20)), None)
    preview: List[Dict[str, Any]] = preview_df.to_dict(orient="records")

    stats: Dict[str, Any] = {
        "total_rows": total_rows,
        "valid_rows": valid_rows,
        "columns_found": list(df.columns),
        "missing_columns": missing,
        "preview": preview,
    }

    return df, stats
