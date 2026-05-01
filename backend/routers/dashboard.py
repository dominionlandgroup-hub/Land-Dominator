"""
ZIP code analytics dashboard endpoint.
"""
from fastapi import APIRouter, HTTPException, Query
from typing import Optional, List

from models.schemas import DashboardResponse, CompLocation, SweetSpot
from services.analytics import compute_zip_stats, compute_summary, generate_insight, get_comp_locations, compute_sweet_spot
from storage.session_store import get_comps

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/stats", response_model=DashboardResponse)
async def get_dashboard_stats(
    session_id: str = Query(..., description="Comps session ID from /upload/comps"),
    zip_codes: Optional[str] = Query(
        None, description="Comma-separated ZIP codes to filter (e.g. 28461,28422)"
    ),
) -> DashboardResponse:
    """
    Return ZIP-level analytics for uploaded comps.
    Optionally filter by specific ZIP codes.
    """
    df = get_comps(session_id)
    if df is None:
        raise HTTPException(
            status_code=404,
            detail="Comps session not found. Please re-upload your comps CSV.",
        )

    zip_filter: Optional[List[str]] = None
    if zip_codes:
        zip_filter = [z.strip() for z in zip_codes.split(",") if z.strip()]

    filtered_df = df
    if zip_filter:
        filtered_df = df[df["Parcel Zip"].astype(str).isin(zip_filter)]

    zip_stats = compute_zip_stats(filtered_df)
    summary = compute_summary(df)
    sweet_spot = compute_sweet_spot(filtered_df)
    insight = generate_insight(zip_stats, summary, sweet_spot)
    comp_locations = get_comp_locations(filtered_df, zip_filter=zip_filter)

    return DashboardResponse(
        zip_stats=zip_stats,
        total_comps=summary["total_comps"],
        valid_comps=summary["valid_comps"],
        median_price=summary["median_price"],
        median_acreage=summary["median_acreage"],
        median_price_per_acre=summary["median_price_per_acre"],
        available_zips=summary["available_zips"],
        comp_locations=comp_locations,
        insight=insight,
        sweet_spot=sweet_spot,
        top_states=summary.get("top_states", []),
        top_counties=summary.get("top_counties", []),
    )


@router.get("/comps", response_model=List[CompLocation])
async def get_comp_locations_endpoint(
    session_id: str = Query(..., description="Comps session ID"),
    zip_codes: Optional[str] = Query(None, description="Comma-separated ZIP filter"),
    limit: int = Query(8000, ge=1, le=15000, description="Max points returned"),
) -> List[CompLocation]:
    """
    Return comp locations with lat/lon for map display.
    Only comps with valid coordinates are returned.
    """
    df = get_comps(session_id)
    if df is None:
        raise HTTPException(status_code=404, detail="Comps session not found.")

    zip_filter: Optional[List[str]] = None
    if zip_codes:
        zip_filter = [z.strip() for z in zip_codes.split(",") if z.strip()]

    locations = get_comp_locations(df, zip_filter=zip_filter, limit=limit)
    return [CompLocation(**loc) for loc in locations]
