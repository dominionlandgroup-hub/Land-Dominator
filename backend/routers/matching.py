"""
Matching engine endpoint — runs in a thread pool to avoid blocking the event loop.
"""
import asyncio
import json
import traceback
from concurrent.futures import ThreadPoolExecutor
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from models.schemas import MatchFilters
from services.matching_engine import run_matching
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
    return Response(
        content=content,
        media_type="application/json",
    )
