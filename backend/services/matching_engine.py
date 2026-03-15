"""
Matching engine: Haversine-based radius filtering + scoring + pricing.
Fully vectorized numpy throughout — no DataFrame creation inside the inner loop.
"""
import uuid
import numpy as np
import pandas as pd
from typing import Any, Dict, List, Optional


# ─────────────────────────────────────────────
# Haversine (vectorized)
# ─────────────────────────────────────────────

EARTH_RADIUS_MILES = 3_958.8


def _haversine_matrix(
    target_lats: np.ndarray,
    target_lons: np.ndarray,
    comp_lats: np.ndarray,
    comp_lons: np.ndarray,
) -> np.ndarray:
    """
    Compute distances (miles) between every target-comp pair.
    Returns shape (N_targets, N_comps).
    """
    lat1 = np.radians(target_lats[:, np.newaxis])   # (T, 1)
    lon1 = np.radians(target_lons[:, np.newaxis])
    lat2 = np.radians(comp_lats[np.newaxis, :])     # (1, C)
    lon2 = np.radians(comp_lons[np.newaxis, :])

    dlat = lat2 - lat1
    dlon = lon2 - lon1

    a = (
        np.sin(dlat / 2) ** 2
        + np.cos(lat1) * np.cos(lat2) * np.sin(dlon / 2) ** 2
    )
    a = np.clip(a, 0.0, 1.0)
    return 2.0 * EARTH_RADIUS_MILES * np.arcsin(np.sqrt(a))


# ─────────────────────────────────────────────
# Acreage band helper
# ─────────────────────────────────────────────

def _acreage_band_scalar(acres: float) -> int:
    """0 = 0-1 ac, 1 = 1-5 ac, 2 = 5-10 ac, 3 = 10+ ac"""
    if acres < 1:
        return 0
    if acres < 5:
        return 1
    if acres < 10:
        return 2
    return 3


def _acreage_bands_vec(acres_arr: np.ndarray) -> np.ndarray:
    """Vectorized acreage band calculation."""
    bands = np.zeros(len(acres_arr), dtype=np.int8)
    bands[acres_arr >= 1] = 1
    bands[acres_arr >= 5] = 2
    bands[acres_arr >= 10] = 3
    return bands


# ─────────────────────────────────────────────
# Flood zone helper
# ─────────────────────────────────────────────

# FEMA zones considered high-risk for filtering
_HIGH_RISK_FLOOD_ZONES = {"A", "AE", "AH", "AO", "AR", "A99", "V", "VE", "VO"}
_FLOOD_COVERAGE_KEYWORDS = {"HIGH", "100%", "1", "TRUE", "YES"}


def _is_flood_risk(fema_zone: str, coverage_str: str) -> bool:
    """Return True if this parcel has meaningful flood risk."""
    zone_upper = str(fema_zone).strip().upper()
    cov_upper = str(coverage_str).strip().upper()
    if zone_upper in _HIGH_RISK_FLOOD_ZONES:
        return True
    if cov_upper in _FLOOD_COVERAGE_KEYWORDS:
        return True
    # Numeric coverage > 50%
    try:
        if float(cov_upper) > 50:
            return True
    except (ValueError, TypeError):
        pass
    return False


# ─────────────────────────────────────────────
# Main matching function
# ─────────────────────────────────────────────

def run_matching(
    comps_df: pd.DataFrame,
    targets_df: pd.DataFrame,
    radius_miles: float = 10.0,
    acreage_tolerance_pct: float = 50.0,
    min_match_score: int = 0,
    zip_filter: Optional[List[str]] = None,
    # Smart filters
    min_acreage: Optional[float] = None,
    max_acreage: Optional[float] = None,
    exclude_flood: bool = False,
    only_flood: bool = False,
    min_buildability: Optional[float] = None,
    vacant_only: bool = False,
    require_road_frontage: bool = False,
    exclude_land_locked: bool = False,
    require_tlp_estimate: bool = False,
    price_ceiling: Optional[float] = None,
) -> Dict[str, Any]:
    """
    Run the full matching pipeline.
    Inner loop uses numpy arrays throughout — no DataFrame slicing per target.
    """
    warnings: List[str] = []

    # ── 1. Prep valid comps ──────────────────────────────────────────
    vc = comps_df[
        (comps_df["Current Sale Price"].notna())
        & (comps_df["Current Sale Price"] > 0)
        & (comps_df["Lot Acres"].notna())
        & (comps_df["Lot Acres"] > 0)
        & (comps_df["Latitude"].notna())
        & (comps_df["Longitude"].notna())
    ].copy()
    vc = vc.reset_index(drop=True)
    vc["price_per_acre"] = vc["Current Sale Price"] / vc["Lot Acres"]

    # ZIP-level fallback PPA
    zip_ppa: Dict[str, float] = {}
    if "Parcel Zip" in vc.columns:
        zip_ppa = vc.groupby("Parcel Zip")["price_per_acre"].median().to_dict()
    global_median_ppa = float(vc["price_per_acre"].median()) if len(vc) > 0 else 0.0

    # Pre-extract comp arrays (numpy) — avoid DataFrame access inside loop
    comp_lats = vc["Latitude"].values.astype(np.float64)
    comp_lons = vc["Longitude"].values.astype(np.float64)
    comp_acres = vc["Lot Acres"].values.astype(np.float64)
    comp_ppa = vc["price_per_acre"].values.astype(np.float64)
    comp_zips = vc["Parcel Zip"].astype(str).values  # string array
    comp_acreage_bands = _acreage_bands_vec(comp_acres)

    # ── 2. Prep targets ──────────────────────────────────────────────
    targets = targets_df.copy()

    # ── Check for data issues before filtering ──
    if vacant_only and "Vacant Flag" in targets_df.columns:
        vacant_count = targets_df["Vacant Flag"].fillna("").astype(str).str.strip().ne("").sum()
        if vacant_count <= 5:
            warnings.append(f"Only {vacant_count} parcels have Vacant Flag data. Results will be very limited.")
    
    if exclude_land_locked and "Land Locked" in targets_df.columns:
        ll_col = targets_df["Land Locked"].fillna("").astype(str).str.strip()
        ll_count = ((ll_col != "") & (ll_col.str.lower() != "nan") & (ll_col.str.lower() != "none")).sum()
        if ll_count == 0:
            warnings.append("No Land Locked data found in this dataset. Filter has no effect.")

    if zip_filter:
        targets = targets[
            targets["Parcel Zip"].astype(str).isin([str(z) for z in zip_filter])
        ]

    # Filter out foreign addresses & Do Not Mail
    foreign_states = {"AE", "AP", "AS"}
    if "Mail State" in targets.columns:
        targets = targets[
            ~targets["Mail State"].astype(str).str.strip().str.upper().isin(foreign_states)
        ]
    if "Mail Foreign Address Indicator" in targets.columns:
        targets = targets[
            targets["Mail Foreign Address Indicator"]
            .astype(str).str.strip().str.upper() != "C"
        ]
    if "Do Not Mail" in targets.columns:
        dnm = targets["Do Not Mail"].astype(str).str.strip().str.upper()
        targets = targets[~dnm.isin(["YES", "Y", "1", "TRUE"])]

    # ── Smart filters ────────────────────────────────────────────────

    # Acreage range filter
    if min_acreage is not None and "Lot Acres" in targets.columns:
        t_ac = pd.to_numeric(targets["Lot Acres"], errors="coerce")
        targets = targets[t_ac.isna() | (t_ac >= min_acreage)]
    if max_acreage is not None and "Lot Acres" in targets.columns:
        t_ac = pd.to_numeric(targets["Lot Acres"], errors="coerce")
        targets = targets[t_ac.isna() | (t_ac <= max_acreage)]

    # Flood zone filter
    if exclude_flood or only_flood:
        # High-risk flood zones to filter (exclude or require)
        high_risk_zones = {"A", "AE", "AH", "AO", "AR", "A99", "V", "VE", "VO"}
        if "FL FEMA Flood Zone" in targets.columns:
            fema_zone = targets["FL FEMA Flood Zone"].fillna("").astype(str).str.strip().str.upper()
            # True if flood zone is a high-risk zone (not null/empty/X/nan/none)
            flood_mask = fema_zone.isin(high_risk_zones)
        else:
            flood_mask = pd.Series([False] * len(targets), index=targets.index)

        if exclude_flood:
            targets = targets[~flood_mask]
        elif only_flood:
            targets = targets[flood_mask]

    # Buildability filter
    if min_buildability is not None and "Buildability total (%)" in targets.columns:
        build_col = pd.to_numeric(targets["Buildability total (%)"], errors="coerce")
        targets = targets[(build_col >= min_buildability)]

    # Vacant only filter
    if vacant_only and "Vacant Flag" in targets.columns:
        vf = targets["Vacant Flag"].fillna("").astype(str).str.strip().str.lower()
        targets = targets[(vf != "") & (vf != "nan") & (vf != "none")]

    # Road frontage required
    if require_road_frontage and "Road Frontage" in targets.columns:
        rf = pd.to_numeric(targets["Road Frontage"], errors="coerce")
        targets = targets[rf.notna() & (rf > 0)]

    # Exclude land locked
    if exclude_land_locked and "Land Locked" in targets.columns:
        ll = targets["Land Locked"].fillna("").astype(str).str.strip().str.lower()
        targets = targets[(ll == "") | (ll == "0") | (ll == "nan") | (ll == "none")]

    # Require TLP Estimate
    if require_tlp_estimate and "TLP Estimate" in targets.columns:
        tlp = pd.to_numeric(targets["TLP Estimate"], errors="coerce")
        targets = targets[tlp.notna()]

    # Price ceiling: exclude parcels where TLP Estimate exceeds max price
    # Allow null TLP values to pass (they don't exceed the ceiling)
    if price_ceiling is not None and "TLP Estimate" in targets.columns:
        tlp_ceil = pd.to_numeric(targets["TLP Estimate"], errors="coerce")
        targets = targets[tlp_ceil.isna() | (tlp_ceil <= price_ceiling)]

    targets = targets.reset_index(drop=True)
    total_targets = len(targets)

    if len(vc) == 0 or total_targets == 0:
        return {
            "match_id": str(uuid.uuid4()),
            "total_targets": total_targets,
            "matched_count": 0,
            "results": [],
            "warnings": warnings,
        }

    # ── 3. Pre-extract target numpy arrays ───────────────────────────
    t_lats_raw = pd.to_numeric(targets["Latitude"], errors="coerce").values
    t_lons_raw = pd.to_numeric(targets["Longitude"], errors="coerce").values
    t_acres_raw = pd.to_numeric(targets["Lot Acres"], errors="coerce").values
    # fillna("") before astype(str) prevents pd.NA from becoming "<NA>" or float nan
    t_zips = targets["Parcel Zip"].fillna("").astype(str).values
    t_build = pd.to_numeric(
        targets.get("Buildability total (%)", pd.Series(dtype=float)), errors="coerce"
    ).values if "Buildability total (%)" in targets.columns else np.full(total_targets, np.nan)
    t_flood = targets["FEMA Flood Coverage"].astype(str).values if "FEMA Flood Coverage" in targets.columns else np.full(total_targets, "")

    has_coords = ~(np.isnan(t_lats_raw) | np.isnan(t_lons_raw))
    with_idx = np.where(has_coords)[0]
    without_idx = np.where(~has_coords)[0]

    # ── 4. Vectorized distance matrix for targets with coords ─────────
    dist_matrix: Optional[np.ndarray] = None
    if len(with_idx) > 0:
        dist_matrix = _haversine_matrix(
            t_lats_raw[with_idx],
            t_lons_raw[with_idx],
            comp_lats,
            comp_lons,
        )  # shape (len(with_idx), len(vc))

    tol = acreage_tolerance_pct / 100.0

    # ── 5. Inner loop — numpy operations only ────────────────────────
    results: List[Dict[str, Any]] = []

    def _process_one(ti: int, row_mask: Optional[np.ndarray]) -> None:
        """Score + price one target. row_mask selects matched comps."""
        target_acres = t_acres_raw[ti]
        has_acres = not (np.isnan(target_acres) or target_acres <= 0)

        if row_mask is None:
            matched_mask = np.zeros(len(vc), dtype=bool)
        else:
            matched_mask = row_mask

        n_matched = int(matched_mask.sum())
        matched_ppas = comp_ppa[matched_mask]
        valid_ppas = matched_ppas[np.isfinite(matched_ppas) & (matched_ppas > 0)]

        # ── Scoring ──────────────────────────────────────────────────
        score = 0

        # 1. Acreage band match
        if has_acres and n_matched > 0:
            t_band = _acreage_band_scalar(float(target_acres))
            if np.any(comp_acreage_bands[matched_mask] == t_band):
                score += 1

        # 2. ZIP match
        t_zip = t_zips[ti]
        if t_zip and t_zip not in ("nan", "None", "") and n_matched > 0:
            if np.any(comp_zips[matched_mask] == t_zip):
                score += 1

        # 3. Comp count quality
        if n_matched >= 3:
            score += 1

        # 4. Price band alignment
        if has_acres and len(valid_ppas) > 0:
            est = float(np.median(valid_ppas)) * float(target_acres)
            if 0 < est < 2_000_000:
                score += 1

        # 5. Buildability / flood
        build_val = t_build[ti]
        flood_val = str(t_flood[ti]).strip().upper()
        if not np.isnan(build_val) if isinstance(build_val, float) else True:
            try:
                if float(build_val) > 50:
                    score += 1
            except (ValueError, TypeError):
                if flood_val not in ("HIGH", "100%", "1", "TRUE"):
                    score += 1
        else:
            if flood_val not in ("HIGH", "100%", "1", "TRUE"):
                score += 1

        score = min(score, 5)
        if score < min_match_score:
            return

        # ── Pricing ──────────────────────────────────────────────────
        sugg_low = sugg_mid = sugg_high = None
        if has_acres:
            ta = float(target_acres)
            if len(valid_ppas) >= 3:
                p25 = float(np.percentile(valid_ppas, 25))
                med = float(np.median(valid_ppas))
                p75 = float(np.percentile(valid_ppas, 75))
                # Ensure strictly increasing Low < Mid < High
                if p25 >= med:
                    p25 = med * 0.75
                if p75 <= med:
                    p75 = med * 1.25
                sugg_low = round(p25 * ta, 2)
                sugg_mid = round(med * ta, 2)
                sugg_high = round(p75 * ta, 2)
            else:
                fallback = zip_ppa.get(t_zip, global_median_ppa)
                if isinstance(fallback, float) and not np.isnan(fallback) and fallback > 0:
                    sugg_low = round(float(fallback) * 0.75 * ta, 2)
                    sugg_mid = round(float(fallback) * ta, 2)
                    sugg_high = round(float(fallback) * 1.25 * ta, 2)

        # ── Build result dict using pandas row (field access only) ────
        row = targets.iloc[ti]

        def _s(v: Any) -> str:
            if v is None or v is pd.NA:
                return ""
            if isinstance(v, float) and np.isnan(v):
                return ""
            return str(v)

        def _f(v: Any) -> "float | None":
            try:
                fv = float(v)
                return None if (np.isnan(fv) or np.isinf(fv)) else fv
            except (TypeError, ValueError):
                return None

        results.append({
            "apn": _s(row.get("APN")),
            "owner_name": _s(row.get("Owner Name(s)") or row.get("Owner 1 Full Name")),
            "mail_address": _s(row.get("Mail Full Address")),
            "mail_city": _s(row.get("Mail City")),
            "mail_state": _s(row.get("Mail State")),
            "mail_zip": _s(row.get("Mail Zip")),
            "parcel_zip": _s(t_zip),
            "parcel_city": _s(row.get("Parcel City")),
            "lot_acres": float(target_acres) if has_acres else None,
            "match_score": score,
            "matched_comp_count": n_matched,
            "suggested_offer_low": sugg_low,
            "suggested_offer_mid": sugg_mid,
            "suggested_offer_high": sugg_high,
            "tlp_estimate": _f(row.get("TLP Estimate")),
            "flood_zone": _s(row.get("FL FEMA Flood Zone")) or None,
            "buildability_pct": _f(row.get("Buildability total (%)")),
            "latitude": _f(t_lats_raw[ti]),
            "longitude": _f(t_lons_raw[ti]),
        })

    # Process targets WITH coordinates
    if dist_matrix is not None:
        for local_i, ti in enumerate(with_idx):
            row_distances = dist_matrix[local_i]
            radius_mask = row_distances <= radius_miles

            ta = t_acres_raw[ti]
            if not (np.isnan(ta) or ta <= 0):
                acre_mask = (comp_acres >= ta * (1 - tol)) & (comp_acres <= ta * (1 + tol))
                final_mask: np.ndarray = radius_mask & acre_mask
            else:
                final_mask = radius_mask

            _process_one(ti, final_mask)

    # Process targets WITHOUT coordinates (ZIP fallback pricing only)
    for ti in without_idx:
        _process_one(ti, None)

    results.sort(key=lambda x: x["match_score"], reverse=True)

    return {
        "match_id": str(uuid.uuid4()),
        "total_targets": total_targets,
        "matched_count": len(results),
        "results": results,
        "warnings": warnings,
    }
