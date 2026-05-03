"""
Matching engine endpoint — runs in a thread pool to avoid blocking the event loop.
Includes /api/test-pricing for isolated QA verification.
Large files (>5000 targets) run as background jobs with progress polling.
"""
import asyncio
import json
import traceback
import gc
import math
import threading
import time
import uuid
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
from storage.session_store import get_targets, store_match, get_match

router = APIRouter(prefix="/match", tags=["match"])

_executor = ThreadPoolExecutor(max_workers=2)

# ── Background job store ─────────────────────────────────────────────────────
LARGE_FILE_THRESHOLD = 5000
_jobs: dict = {}
_jobs_lock = threading.Lock()
_JOB_TTL = 3600  # clean up jobs older than 1 hour


def _cleanup_old_jobs() -> None:
    now = time.time()
    with _jobs_lock:
        stale = [jid for jid, j in _jobs.items() if now - j.get("created_at", 0) > _JOB_TTL]
        for jid in stale:
            del _jobs[jid]


def _run_background_job(job_id: str, comps_df: pd.DataFrame, targets_df: pd.DataFrame, kwargs: dict) -> None:
    def _progress(completed: int, total: int) -> None:
        with _jobs_lock:
            j = _jobs.get(job_id)
            if j:
                j["progress"] = completed
                j["message"] = f"Matching… {completed:,} of {total:,} complete"

    try:
        result = run_matching(
            comps_df=comps_df,
            targets_df=targets_df,
            progress_callback=_progress,
            **kwargs,
        )
        store_match(result["match_id"], result)
        with _jobs_lock:
            j = _jobs.get(job_id)
            if j:
                j["status"] = "complete"
                j["match_id"] = result["match_id"]
                j["progress"] = j["total"]
                j["message"] = "Complete"
        print(f"[job/{job_id}] Done — {result['matched_count']} matched of {result['total_targets']}", flush=True)
    except Exception:
        tb = traceback.format_exc()
        print(f"[job/{job_id}] ERROR:\n{tb}", flush=True)
        with _jobs_lock:
            j = _jobs.get(job_id)
            if j:
                j["status"] = "error"
                j["error"] = tb[:600]


def _load_comps_from_db(states: "list[str] | None" = None) -> "pd.DataFrame | None":
    """
    Load comps from crm_sold_comps Supabase table and convert to the LP-export
    column names expected by the matching engine.

    If `states` is provided (list of 2-letter state codes), only comps from those
    states are loaded. Otherwise all comps are loaded.
    Returns None on failure or if no rows found.
    """
    try:
        from services.supabase_client import get_supabase
        sb = get_supabase()

        # Paginate to fetch rows (Supabase default cap = 1000)
        rows: list[dict] = []
        batch_size = 1000
        offset = 0

        # Normalize state codes for filtering
        state_filter = [s.strip().upper() for s in (states or []) if s and s.strip()]

        while True:
            q = sb.table("crm_sold_comps").select("*")
            if state_filter:
                # Use Supabase .in_() filter — state column stores uppercase 2-letter codes
                q = q.in_("state", state_filter)
            r = q.range(offset, offset + batch_size - 1).execute()
            batch = r.data or []
            rows.extend(batch)
            if len(batch) < batch_size:
                break
            offset += batch_size

        if not rows:
            state_msg = f" for states {state_filter}" if state_filter else ""
            print(f"[match] No comps found in DB{state_msg}", flush=True)
            return None

        # Map DB column names → LP export column names used by matching engine
        def _norm_county(v: object) -> str:
            s = str(v or "").lower().strip()
            return s.replace(" county", "").replace("county", "").strip()

        mapped = []
        for row in rows:
            _county = _norm_county(row.get("county") or "")
            mapped.append({
                "APN":                              row.get("apn") or "",
                "Parcel County":                    _county,
                "Parcel Address County":            _county,
                "Parcel State":                     row.get("state") or "",
                "Parcel Zip":                       str(row.get("zip_code") or ""),
                "Lot Acres":                        row.get("acreage"),
                "Current Sale Price":               row.get("sale_price"),
                "Current Sale Recording Date":      row.get("sale_date") or "",
                "Latitude":                         row.get("latitude"),
                "Longitude":                        row.get("longitude"),
                "Slope AVG":                        row.get("slope_avg"),
                "Wetlands Coverage":                row.get("wetlands_coverage"),
                "FEMA Flood Coverage":              row.get("fema_coverage"),
                "Buildability total (%)":           row.get("buildability"),
                "Road Frontage":                    row.get("road_frontage"),
                "Elevation AVG":                    row.get("elevation_avg"),
                "Land Use":                         row.get("land_use") or "",
                "Current Sale Buyer 1 Full Name":   row.get("buyer_name") or "",
                "Parcel Full Address":               row.get("full_address") or "",
                # buyer_type stored in DB, exposed for LLC pricing logic
                "_buyer_type":                      row.get("buyer_type") or "INDIVIDUAL",
            })

        df = pd.DataFrame(mapped)
        total = len(df)
        state_msg = f" (states: {state_filter})" if state_filter else ""
        print(f"Comps loaded: {total}{state_msg}", flush=True)

        # Filter bad comps at load time
        df["Lot Acres"] = pd.to_numeric(df["Lot Acres"], errors="coerce")
        df["Current Sale Price"] = pd.to_numeric(df["Current Sale Price"], errors="coerce")

        df = df[df["Lot Acres"].notna() & (df["Lot Acres"] >= 0.05)]
        after_zero = len(df)
        print(f"Comps after removing zero-acre (<0.05): {after_zero}", flush=True)

        df = df[df["Current Sale Price"].notna() & (df["Current Sale Price"] <= 5_000_000)]
        after_mega = len(df)
        print(f"Comps after removing mega-sales (>$5M): {after_mega}", flush=True)

        ppa_series = df["Current Sale Price"] / df["Lot Acres"].replace(0, np.nan)
        df = df[ppa_series <= 2_000_000]
        final_count = len(df)
        print(f"Comps after removing outliers (ppa>$2M/acre): {final_count}", flush=True)

        if final_count == 0:
            return None

        return df
    except Exception as exc:
        print(f"[match] Failed to load comps from DB: {exc}", flush=True)
        return None


def _build_match_kwargs(filters: MatchFilters, exclude_flood: bool, only_flood: bool, exclude_land_locked: bool, require_tlp_estimate: bool) -> dict:
    return dict(
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
        min_offer_floor=getattr(filters, 'min_offer_floor', 10000.0),
        min_lp_estimate=getattr(filters, 'min_lp_estimate', 20000.0),
        offer_pct=getattr(filters, 'offer_pct', 52.5),
    )


def _serialize_result(result: dict) -> str:
    """Serialize a match result dict to JSON string, handling numpy/NaN types."""
    payload = {
        "match_id": result["match_id"],
        "total_targets": result["total_targets"],
        "matched_count": result["matched_count"],
        "distance_matched_count": result.get("distance_matched_count", result["matched_count"]),
        "zip_matched_count": result.get("zip_matched_count", 0),
        "zip_coord_free_count": result.get("zip_coord_free_count", 0),
        "mailable_count": result.get("mailable_count", 0),
        "lp_fallback_count": result.get("lp_fallback_count", 0),
        "county_median_count": result.get("county_median_count", 0),
        "low_offer_count": result.get("low_offer_count", 0),
        "low_value_count": result.get("low_value_count", 0),
        "unpriced_count": result.get("unpriced_count", 0),
        "smart_floor_recommendation": result.get("smart_floor_recommendation"),
        "county_diagnostics": result.get("county_diagnostics"),
        "pricing_breakdown": result.get("pricing_breakdown"),
        "match_rate_warning": result.get("match_rate_warning"),
        "offer_pct": result.get("offer_pct", 52.5),
        "results": result["results"],
        "warnings": result.get("warnings", []),
    }
    try:
        import simplejson
        return simplejson.dumps(payload, ignore_nan=True, default=str)
    except ImportError:
        pass

    class _NpEncoder(json.JSONEncoder):
        def default(self, obj):
            if isinstance(obj, np.integer):
                return int(obj)
            if isinstance(obj, np.floating):
                return None if (math.isnan(obj) or math.isinf(obj)) else float(obj)
            if isinstance(obj, np.ndarray):
                return obj.tolist()
            return super().default(obj)

    def _clean(d):
        if isinstance(d, dict):
            return {k: _clean(v) for k, v in d.items()}
        if isinstance(d, list):
            return [_clean(v) for v in d]
        if isinstance(d, float) and (math.isnan(d) or math.isinf(d)):
            return None
        return d

    return json.dumps(_clean(payload), cls=_NpEncoder)


@router.post("/run")
async def run_match(filters: MatchFilters) -> Response:
    """
    Run the matching engine against uploaded comps + targets.
    Files with >5000 targets run as background jobs — returns {job_id} immediately.
    Small files run synchronously as before.
    """
    targets_df = get_targets(filters.target_session_id)
    if targets_df is None:
        raise HTTPException(
            status_code=404,
            detail="Target session not found. Please re-upload your targets CSV.",
        )

    # Always load ALL comps from DB — no state filtering.
    comps_df = _load_comps_from_db()
    if comps_df is None or len(comps_df) == 0:
        raise HTTPException(
            status_code=404,
            detail="No comps found in database. Please upload your comps CSV.",
        )
    print(f"[match] Loaded {len(comps_df)} comps, {len(targets_df)} targets", flush=True)

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
    match_kwargs = _build_match_kwargs(filters, exclude_flood, only_flood, exclude_land_locked, require_tlp_estimate)

    total_targets = len(targets_df)

    # ── Large file → background job ──────────────────────────────────────────
    if total_targets > LARGE_FILE_THRESHOLD:
        _cleanup_old_jobs()
        job_id = str(uuid.uuid4())
        with _jobs_lock:
            _jobs[job_id] = {
                "status": "running",
                "progress": 0,
                "total": total_targets,
                "message": f"Loading comps… 0 of {total_targets:,} processed",
                "match_id": None,
                "error": None,
                "created_at": time.time(),
            }
        t = threading.Thread(
            target=_run_background_job,
            args=(job_id, comps_df, targets_df, match_kwargs),
            daemon=True,
        )
        t.start()
        print(f"[match] Background job {job_id} started for {total_targets:,} targets", flush=True)
        try:
            import simplejson
            content = simplejson.dumps({
                "job_id": job_id,
                "status": "running",
                "total_targets": total_targets,
                "is_background": True,
                "message": f"Large file ({total_targets:,} records) — running in background. Estimated time: {total_targets // 6000 + 2}–{total_targets // 4000 + 3} min.",
            }, ignore_nan=True)
        except ImportError:
            content = json.dumps({
                "job_id": job_id,
                "status": "running",
                "total_targets": total_targets,
                "is_background": True,
                "message": f"Large file ({total_targets:,} records) — running in background.",
            })
        return Response(content=content, media_type="application/json")

    # ── Small file → synchronous (existing path) ─────────────────────────────
    try:
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(
            _executor,
            lambda: run_matching(comps_df=comps_df, targets_df=targets_df, **match_kwargs),
        )
    except Exception:
        tb = traceback.format_exc()
        print("MATCHING ERROR:\n", tb, flush=True)
        raise HTTPException(status_code=500, detail=tb)

    # Cache result for mailing list + campaign use
    store_match(result["match_id"], result)

    try:
        content = _serialize_result(result)
    except Exception as e:
        tb = traceback.format_exc()
        print("JSON DUMP ERROR:\n", tb, flush=True)
        raise HTTPException(status_code=500, detail=f"Serialization Error: {str(e)}")

    gc.collect()
    return Response(content=content, media_type="application/json")


@router.get("/job/{job_id}")
async def get_match_job(job_id: str) -> Response:
    """Poll status of a background matching job. Returns progress + full result when complete."""
    with _jobs_lock:
        job = dict(_jobs.get(job_id) or {})

    if not job:
        raise HTTPException(status_code=404, detail="Job not found or expired")

    resp: dict = {
        "job_id": job_id,
        "status": job.get("status", "running"),
        "progress": job.get("progress", 0),
        "total": job.get("total", 0),
        "message": job.get("message", ""),
        "error": job.get("error"),
        "result": None,
    }

    if job.get("status") == "complete":
        match_id = job.get("match_id")
        if match_id:
            result = get_match(match_id)
            if result:
                # Embed the full serialized result so the frontend can use it directly
                resp["result"] = result

    try:
        import simplejson
        content = simplejson.dumps(resp, ignore_nan=True, default=str)
    except ImportError:
        def _clean(d):
            if isinstance(d, dict):
                return {k: _clean(v) for k, v in d.items()}
            if isinstance(d, list):
                return [_clean(v) for v in d]
            if isinstance(d, float) and (math.isnan(d) or math.isinf(d)):
                return None
            return d
        content = json.dumps(_clean(resp), default=str)

    return Response(content=content, media_type="application/json")


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
            # FIX 1: strict comp-radius steps (>=1 comp stops the search)
            if len(trial) >= 1:
                comps_df = trial
                radius_label = label
                break
        else:
            # FIX 1: Step 4 — no comps within 1 mile => NO_COMPS
            comps_df = comps_df[0:0]
            radius_label = 'NO_COMPS'

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
