"""
Matching engine endpoint — runs in a thread pool to avoid blocking the event loop.
Includes /api/test-pricing for isolated QA verification.
"""
import asyncio
import json
import traceback
import gc
from concurrent.futures import ThreadPoolExecutor
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response

import numpy as np
import pandas as pd

from models.schemas import MatchFilters
from services.matching_engine import (
    run_matching,
    get_acreage_band,
    calculate_offer_price,
    detect_bulk_sales,
    identify_premium_zips,
    COMP_SEARCH_STEPS,
)
from storage.session_store import get_comps, get_targets, store_match

router = APIRouter(prefix="/match", tags=["match"])

_executor = ThreadPoolExecutor(max_workers=2)


@router.post("/run")
async def run_match(filters: MatchFilters) -> Response:
    """
    Run the matching engine against uploaded comps + targets.
    Uses vectorized Haversine. Runs in a thread pool.
    Returns pre-serialized JSON to avoid Pydantic overhead on large result sets.
    """
    comps_df = get_comps(filters.session_id)
    if comps_df is None:
        raise HTTPException(
            status_code=404,
            detail="Comps session not found. Please re-upload your comps CSV.",
        )

    targets_df = get_targets(filters.target_session_id)
    if targets_df is None:
        raise HTTPException(
            status_code=404,
            detail="Target session not found. Please re-upload your targets CSV.",
        )

    flood_mode = (filters.flood_zone_filter or "").strip().lower()
    exclude_flood = filters.exclude_flood
    only_flood = filters.only_flood
    if flood_mode == "exclude":
        exclude_flood = True
        only_flood = False
    elif flood_mode == "only":
        only_flood = True
        exclude_flood = False

    exclude_land_locked = filters.exclude_land_locked or filters.exclude_landlocked
    require_tlp_estimate = filters.require_tlp_estimate or filters.require_tlp

    try:
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(
            _executor,
            lambda: run_matching(
                comps_df=comps_df,
                targets_df=targets_df,
                radius_miles=filters.radius_miles,
                acreage_tolerance_pct=filters.acreage_tolerance_pct,
                min_match_score=filters.min_match_score,
                zip_filter=filters.zip_filter,
                min_acreage=filters.min_acreage,
                max_acreage=filters.max_acreage,
                exclude_flood=exclude_flood,
                only_flood=only_flood,
                min_buildability=filters.min_buildability,
                vacant_only=filters.vacant_only,
                require_road_frontage=filters.require_road_frontage,
                exclude_land_locked=exclude_land_locked,
                require_tlp_estimate=require_tlp_estimate,
                price_ceiling=filters.price_ceiling,
                exclude_with_buildings=getattr(filters, 'exclude_with_buildings', True),
                min_road_frontage=getattr(filters, 'min_road_frontage', 50.0),
                max_retail_price=getattr(filters, 'max_retail_price', 200000.0),
            ),
        )
    except Exception:
        tb = traceback.format_exc()
        print("MATCHING ERROR:\n", tb, flush=True)
        raise HTTPException(status_code=500, detail=tb)

    # Cache result for mailing list + campaign use
    store_match(result["match_id"], result)

    try:
        import simplejson
        # Prefer simplejson to handle numpy/NaN safely
        content = simplejson.dumps({
            "match_id": result["match_id"],
            "total_targets": result["total_targets"],
            "matched_count": result["matched_count"],
            "results": result["results"],
            "warnings": result.get("warnings", []),
        }, ignore_nan=True, default=str)
    except ImportError:
        import math
        import numpy as np
        class NumpyEncoder(json.JSONEncoder):
            def default(self, obj):
                if isinstance(obj, np.integer):
                    return int(obj)
                elif isinstance(obj, np.floating):
                    if math.isnan(obj) or math.isinf(obj):
                        return None
                    return float(obj)
                elif isinstance(obj, np.ndarray):
                    return obj.tolist()
                return super().default(obj)
                
        # Clean any float('nan') in the native dict before serialization
        def clean_nans(d):
            if isinstance(d, dict):
                return {k: clean_nans(v) for k, v in d.items()}
            elif isinstance(d, list):
                return [clean_nans(v) for v in d]
            elif isinstance(d, float) and (math.isnan(d) or math.isinf(d)):
                return None
            return d
            
        cleaned_result = clean_nans({
            "match_id": result["match_id"],
            "total_targets": result["total_targets"],
            "matched_count": result["matched_count"],
            "results": result["results"],
            "warnings": result.get("warnings", []),
        })
        
        try:
            content = json.dumps(cleaned_result, cls=NumpyEncoder)
        except Exception as e:
            tb = traceback.format_exc()
            print("JSON DUMP ERROR:\n", tb, flush=True)
            raise HTTPException(status_code=500, detail=f"Serialization Error: {str(e)}")

    # Stream pre-serialized JSON — bypasses Pydantic validation on 15k+ records
    response = Response(
        content=content,
        media_type="application/json",
    )
    
    # Explicit memory cleanup after match completes
    gc.collect()
    
    return response


@router.post("/test-pricing")
async def test_pricing_endpoint(request: Request):
    """
    Unit test endpoint. Accepts manual comps for isolated pricing verification.
    Used for QA and client demos. Supports optional distance_miles per comp
    for proximity-weighted pricing.
    """
    body = await request.json()
    target_acres = float(body.get('target_acres', 0.32))
    tlp_estimate = body.get('tlp_estimate')
    target_zip = body.get('target_zip')
    premium_zips_override = body.get('premium_zips')  # optional list for testing
    raw_comps = body.get('comps', [])

    if tlp_estimate is not None:
        tlp_estimate = float(tlp_estimate)

    if not raw_comps:
        result = calculate_offer_price(target_acres, pd.DataFrame(), tlp_estimate)
        result['bulk_sales_removed'] = 0
        band_low, band_high, band_label = get_acreage_band(target_acres)
        result['acreage_band_range'] = f"{band_low}\u2013{band_high} acres"
        return result

    comps_df = pd.DataFrame(raw_comps)
    comps_df = comps_df.rename(columns={
        'sale_price': 'Current Sale Price',
        'lot_acres': 'Lot Acres',
        'sale_date': 'Current Sale Recording Date',
        'parcel_zip': 'Parcel Zip',
    })
    comps_df['Current Sale Price'] = pd.to_numeric(comps_df['Current Sale Price'])
    comps_df['Lot Acres'] = pd.to_numeric(comps_df['Lot Acres'])

    # Remove invalid data (zero/negative price or acreage)
    comps_df = comps_df[(comps_df['Current Sale Price'] > 0) & (comps_df['Lot Acres'] > 0)]

    # Check if distances are provided for proximity weighting
    has_distances = 'distance_miles' in comps_df.columns
    if has_distances:
        comps_df['distance_miles'] = pd.to_numeric(comps_df['distance_miles'])

    # Apply smart bulk sale filter (same price + same date)
    original_count = len(comps_df)
    comps_df, bulk_removed = detect_bulk_sales(comps_df)

    # Apply acreage band filter
    band_low, band_high, band_label = get_acreage_band(target_acres)
    comps_df = comps_df[
        (comps_df['Lot Acres'] >= band_low) &
        (comps_df['Lot Acres'] < band_high)
    ]

    # Apply proximity-based radius filtering if distances provided
    radius_label = None
    if has_distances and len(comps_df) > 0:
        for radius, label in COMP_SEARCH_STEPS:
            trial = comps_df[comps_df['distance_miles'] <= radius]
            if len(trial) >= 3:
                comps_df = trial
                radius_label = label
                break
        else:
            # Use whatever we have at max fallback
            comps_df = comps_df[comps_df['distance_miles'] <= 3.0]
            radius_label = '3mi_fallback'

    if len(comps_df) > 0:
        comps_df['ppa'] = comps_df['Current Sale Price'] / comps_df['Lot Acres']

    # Premium ZIP detection
    is_premium = False
    if target_zip and len(comps_df) > 0:
        t_zip_str = str(target_zip).split('.')[0].strip()
        if premium_zips_override is not None:
            # Test mode: use provided premium ZIP list
            p_zips = [str(z) for z in premium_zips_override]
        elif 'Parcel Zip' in comps_df.columns and 'ppa' in comps_df.columns:
            p_zips = identify_premium_zips(comps_df)
        else:
            p_zips = []
        if t_zip_str in p_zips:
            if 'Parcel Zip' in comps_df.columns:
                comps_df = comps_df[comps_df['Parcel Zip'].astype(str).str.split('.').str[0].str.strip() == t_zip_str]
            is_premium = True

    result = calculate_offer_price(target_acres, comps_df, tlp_estimate, band_label, radius_label)
    result['bulk_sales_removed'] = bulk_removed
    result['acreage_band_range'] = f"{band_low}\u2013{band_high} acres"
    result['premium_zip'] = is_premium
    return result
