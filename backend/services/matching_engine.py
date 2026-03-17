"""
Matching engine: Haversine-based radius filtering + scoring + pricing.
Fully vectorized numpy throughout — no DataFrame creation inside the inner loop.

Pricing model (client-specified):
    Retail Estimate = median(comp sale prices)  — NOT ppa × acres
    Offer Low  = 40% of retail
    Offer Mid  = 50% of retail
    Offer High = 60% of retail

Data cleaning removes bulk sales, PPA outliers, and data errors.
Acreage band matching prevents cross-band distortion.
"""
import uuid
import datetime
import numpy as np
import pandas as pd
from typing import Any, Dict, List, Optional, Tuple


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
# Acreage band definitions (client-specified)
# ─────────────────────────────────────────────

ACREAGE_BANDS = [
    (0.001, 0.05, 'nano'),        # very small lots < 0.05 acres
    (0.05,  0.5,  'micro'),       # small residential lots
    (0.5,   2.0,  'small'),       # half-acre to 2 acres
    (2.0,   10.0, 'medium'),      # 2 to 10 acres
    (10.0,  50.0, 'large'),       # 10 to 50 acres
    (50.0,  float('inf'), 'tract')  # 50+ acres
]


def get_acreage_band(acres: float) -> Tuple[float, float, str]:
    """Return (low, high, label) for the acreage band containing `acres`."""
    for low, high, label in ACREAGE_BANDS:
        if low <= acres < high:
            return (low, high, label)
    return (0.001, 0.05, 'nano')  # default fallback for very small parcels


def _acreage_band_label_vec(acres_arr: np.ndarray) -> np.ndarray:
    """Vectorized acreage band label calculation."""
    labels = np.full(len(acres_arr), 'nano', dtype=object)
    for low, high, label in ACREAGE_BANDS:
        mask = (acres_arr >= low) & (acres_arr < high)
        labels[mask] = label
    return labels


# ─────────────────────────────────────────────
# Proximity weighting (client-specified)
# ─────────────────────────────────────────────

PROXIMITY_TIERS = [
    (0.0,  0.25, 3),   # within 0.25 miles: weight = 3x
    (0.25, 0.50, 2),   # 0.25 to 0.50 miles: weight = 2x
    (0.50, 1.00, 1),   # 0.50 to 1.00 miles: weight = 1x
]

FALLBACK_RADII = [(1.0, '1mi'), (3.0, '3mi')]


def get_comp_weight(distance_miles: float) -> int:
    """Return proximity weight for a comp at given distance."""
    if distance_miles <= 0.25:
        return 3
    elif distance_miles <= 0.50:
        return 2
    else:
        return 1


def weighted_median(values: np.ndarray, weights: np.ndarray) -> float:
    """
    Calculate weighted median by expanding values by their weights.
    Comps within 0.25 miles count 3x, 0.5mi count 2x, 1mi+ count 1x.
    """
    expanded = []
    for v, w in zip(values, weights):
        expanded.extend([v] * int(w))
    return float(np.median(expanded))


def get_tier_counts(distances: np.ndarray) -> Dict[str, int]:
    """Count comps in each proximity tier."""
    return {
        'within_0.25mi': int(np.sum(distances <= 0.25)),
        'within_0.50mi': int(np.sum((distances > 0.25) & (distances <= 0.50))),
        'within_1.00mi': int(np.sum((distances > 0.50) & (distances <= 1.00))),
    }


def get_confidence(n_comps: int, radius_label: Optional[str] = None) -> str:
    """Get confidence level based on comp count and radius used."""
    if radius_label is None:
        # Legacy mode (test endpoint without distances)
        if n_comps >= 5: return 'HIGH'
        elif n_comps >= 3: return 'MEDIUM'
        elif n_comps >= 1: return 'LOW'
        else: return 'NO DATA'
    if radius_label == '1mi':
        if n_comps >= 5: return 'HIGH'
        elif n_comps >= 3: return 'MEDIUM'
        elif n_comps >= 1: return 'LOW'
        else: return 'NO DATA'
    elif radius_label == '3mi':
        if n_comps >= 5: return 'MEDIUM'
        elif n_comps >= 3: return 'LOW'
        elif n_comps >= 1: return 'LOW'
        else: return 'NO DATA'
    else:  # 3mi_fallback or extended radius
        if n_comps >= 3: return 'LOW'
        elif n_comps >= 1: return 'LOW'
        else: return 'NO DATA'


# ─────────────────────────────────────────────
# Data cleaning
# ─────────────────────────────────────────────

def calculate_comp_age(matched_comps_df: pd.DataFrame) -> Tuple[Optional[int], Optional[int]]:
    """Calculate average and oldest age of comps in days from today."""
    date_col = 'Current Sale Recording Date'
    if date_col not in matched_comps_df.columns:
        return None, None

    dates = pd.to_datetime(matched_comps_df[date_col], errors='coerce').dropna()
    if len(dates) == 0:
        return None, None

    today = datetime.date.today()
    ages_days = [(today - d.date()).days for d in dates]
    avg_age_days = round(sum(ages_days) / len(ages_days))
    oldest_days = max(ages_days)

    return avg_age_days, oldest_days


def identify_premium_zips(clean_comps_df: pd.DataFrame, multiplier: float = 3.0) -> List[str]:
    """ZIPs where median PPA > multiplier x county median PPA."""
    if 'ppa' not in clean_comps_df.columns or len(clean_comps_df) == 0:
        return []
    county_median_ppa = clean_comps_df['ppa'].median()
    if county_median_ppa is None or pd.isna(county_median_ppa) or county_median_ppa <= 0:
        return []
    zip_col = 'Parcel Zip' if 'Parcel Zip' in clean_comps_df.columns else None
    if zip_col is None:
        return []
    zip_medians = clean_comps_df.groupby(zip_col)['ppa'].median()
    premium = zip_medians[zip_medians > county_median_ppa * multiplier].index.tolist()
    result = []
    for z in premium:
        if pd.isna(z):
            continue
        try:
            result.append(str(int(float(z))))
        except (ValueError, TypeError):
            result.append(str(z).strip())
    return result


def detect_bulk_sales(df: pd.DataFrame) -> Tuple[pd.DataFrame, int]:
    """
    Bulk sale = same price AND same recording date.
    Same price alone is legitimate (market comps in same area).
    """
    if 'Current Sale Recording Date' not in df.columns:
        # Fallback: if no date column, use original logic but raise threshold to 5+
        price_counts = df['Current Sale Price'].value_counts()
        bulk_prices = price_counts[price_counts >= 5].index
        clean = df[~df['Current Sale Price'].isin(bulk_prices)]
        return clean, len(df) - len(clean)

    # Primary: same price + same date = bulk transaction
    df = df.copy()
    df['_bulk_key'] = df['Current Sale Price'].astype(str) + '_' + df['Current Sale Recording Date'].astype(str)
    key_counts = df['_bulk_key'].value_counts()
    bulk_keys = key_counts[key_counts >= 3].index
    clean = df[~df['_bulk_key'].isin(bulk_keys)].drop(columns=['_bulk_key'])
    removed = len(df) - len(clean)
    return clean, removed


def clean_comps_for_pricing(df: pd.DataFrame) -> pd.DataFrame:
    """
    Remove data quality issues from comp dataset.
    Apply once at comp load time. Returns clean DataFrame.

    Removes: invalid rows, near-zero acreage, non-market sales,
    bulk/developer transactions, PPA outliers (IQR 3× fence).
    """
    df = df.copy()

    # Require valid price and acreage
    df = df[(df['Current Sale Price'] > 0) & (df['Lot Acres'] > 0)]

    # Remove near-zero acreage (sqft entered as acres)
    df = df[df['Lot Acres'] >= 0.01]

    # Remove non-market sales
    df = df[df['Current Sale Price'] >= 1000]

    # Remove bulk/developer transactions (same price + same date)
    df, _ = detect_bulk_sales(df)

    # Remove PPA outliers (IQR method, 3× fence)
    if len(df) > 0:
        df['ppa'] = df['Current Sale Price'] / df['Lot Acres']
        Q1 = df['ppa'].quantile(0.25)
        Q3 = df['ppa'].quantile(0.75)
        IQR = Q3 - Q1
        upper_fence = Q3 + 3 * IQR
        lower_fence = max(100, Q1 - 3 * IQR)
        df = df[(df['ppa'] >= lower_fence) & (df['ppa'] <= upper_fence)]

    return df.reset_index(drop=True)


# ─────────────────────────────────────────────
# Pricing function (client-specified formula)
# ─────────────────────────────────────────────

def calculate_offer_price(
    target_acres: float,
    matched_comps_df: Optional[pd.DataFrame],
    tlp_estimate: Optional[float] = None,
    acreage_band_label: Optional[str] = None,
    radius_label: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Client-specified pricing model with optional proximity weighting.

    Formula:
        Retail Estimate = weighted_median(comp sale prices) if distances available
                        = median(comp sale prices)          otherwise
        Offer Low  = 40% of retail
        Offer Mid  = 50% of retail
        Offer High = 60% of retail

    Verified against client example:
        3 comps: $95K, $88K, $102K
        retail=95000, low=38000, mid=47500, high=57000 ✓
    """
    empty: Dict[str, Any] = {
        'retail_estimate': None,
        'offer_low': None,
        'offer_mid': None,
        'offer_high': None,
        'comp_count': 0,
        'clean_comp_count': 0,
        'outliers_removed': 0,
        'median_comp_sale_price': None,
        'median_ppa': None,
        'min_comp_price': None,
        'max_comp_price': None,
        'acreage_band': acreage_band_label or 'unknown',
        'confidence': 'NO DATA',
        'tlp_estimate': tlp_estimate,
        'tlp_capped': False,
        'radius_used_miles': None,
        'radius_label': radius_label,
        'proximity_weighted': False,
        'tier_counts': None,
        'pricing_source': 'NO DATA',
        'tlp_fallback_mid': None,
        'comp_avg_age_days': None,
        'comp_oldest_days': None,
        'comp_age_warning': False,
        'premium_zip': False,
    }

    if matched_comps_df is None or len(matched_comps_df) == 0:
        if tlp_estimate and tlp_estimate > 0:
            empty['tlp_fallback_mid'] = round(tlp_estimate * 0.30)
            empty['pricing_source'] = 'TLP_FALLBACK'
        return empty

    total_before_clean = len(matched_comps_df)
    comps = matched_comps_df.copy()

    # Ensure ppa column exists
    if 'ppa' not in comps.columns:
        comps['ppa'] = comps['Current Sale Price'] / comps['Lot Acres']

    # Remove outliers from this specific matched set (IQR 3× fence)
    outliers_removed = 0
    if len(comps) >= 4:
        Q1 = comps['ppa'].quantile(0.25)
        Q3 = comps['ppa'].quantile(0.75)
        IQR = Q3 - Q1
        upper_fence = Q3 + 3 * IQR
        clean = comps[comps['ppa'] <= upper_fence]
        outliers_removed = len(comps) - len(clean)
        if len(clean) >= 1:
            comps = clean

    # TLP-anchored comp filter: remove comps > 5× TLP estimate
    tlp_comps_removed = 0
    if tlp_estimate and tlp_estimate > 0 and len(comps) > 0:
        ceiling = tlp_estimate * 5
        filtered = comps[comps['Current Sale Price'] <= ceiling]
        tlp_comps_removed = len(comps) - len(filtered)
        comps = filtered  # TLP fallback handles zero-comp case

    if len(comps) == 0:
        result = empty.copy()
        result['comp_count'] = total_before_clean
        result['outliers_removed'] = outliers_removed
        result['tlp_comps_removed'] = tlp_comps_removed
        if tlp_estimate and tlp_estimate > 0:
            result['tlp_fallback_mid'] = round(tlp_estimate * 0.30)
            result['pricing_source'] = 'TLP_FALLBACK'
        return result

    prices = comps['Current Sale Price'].values.astype(np.float64)
    ppas = comps['ppa'].values.astype(np.float64)

    # Core formula: proximity-weighted median or plain median
    has_distances = 'distance_miles' in comps.columns
    tier_counts = None
    if has_distances:
        distances = comps['distance_miles'].values.astype(np.float64)
        weights = np.array([get_comp_weight(d) for d in distances])
        retail_estimate = weighted_median(prices, weights)
        tier_counts = get_tier_counts(distances)
    else:
        retail_estimate = float(np.median(prices))

    offer_low = round(retail_estimate * 0.40)
    offer_mid = round(retail_estimate * 0.50)
    offer_high = round(retail_estimate * 0.60)

    # Confidence based on comp count and radius
    n = len(comps)
    confidence = get_confidence(n, radius_label)

    # Derive radius_used_miles from radius_label
    _radius_map = {'1mi': 1.0, '3mi': 3.0, '3mi_fallback': 3.0}
    radius_used_miles = _radius_map.get(radius_label) if radius_label else None

    result: Dict[str, Any] = {
        'retail_estimate': round(retail_estimate),
        'offer_low': offer_low,
        'offer_mid': offer_mid,
        'offer_high': offer_high,
        'comp_count': total_before_clean,
        'clean_comp_count': n,
        'outliers_removed': outliers_removed,
        'median_comp_sale_price': round(float(np.median(prices))),
        'median_ppa': round(float(np.median(ppas))),
        'min_comp_price': round(float(np.min(prices))),
        'max_comp_price': round(float(np.max(prices))),
        'acreage_band': acreage_band_label or 'unknown',
        'confidence': confidence,
        'tlp_estimate': tlp_estimate,
        'tlp_capped': False,
        'radius_used_miles': radius_used_miles,
        'radius_label': radius_label,
        'proximity_weighted': has_distances,
        'tier_counts': tier_counts,
        'pricing_source': 'COMPS',
        'tlp_fallback_mid': None,
        'comp_avg_age_days': None,
        'comp_oldest_days': None,
        'comp_age_warning': False,
        'premium_zip': False,
    }

    # Calculate comp age
    avg_age, oldest_age = calculate_comp_age(comps)
    result['comp_avg_age_days'] = avg_age
    result['comp_oldest_days'] = oldest_age
    result['comp_age_warning'] = avg_age > 730 if avg_age else False

    # TLP investor cap: cap offer_mid at 50% of TLP (investor offer, not full retail)
    TLP_CAP_PERCENTAGE = 0.50
    if tlp_estimate and tlp_estimate > 0:
        tlp_investor_ceiling = tlp_estimate * TLP_CAP_PERCENTAGE
        if offer_mid > tlp_investor_ceiling:
            result['offer_mid_uncapped'] = offer_mid
            result['offer_mid'] = round(tlp_investor_ceiling)
            result['offer_low'] = round(tlp_estimate * 0.40)
            result['offer_high'] = round(tlp_estimate * 0.60)
            result['tlp_capped'] = True
            if retail_estimate > tlp_estimate * 2:
                result['pricing_flag'] = 'SUSPECT_COMPS'
            else:
                result['pricing_flag'] = 'HIGH_OFFER_VS_TLP'

    # TLP floor: if offer_mid < 25% of TLP, anchor to 30% of TLP
    # Also flag REVIEW_LOW (25-30%) and SUSPECT_COMPS (retail > 2× TLP)
    if tlp_estimate and tlp_estimate > 0 and result['offer_mid'] is not None and not result['tlp_capped']:
        tlp_ratio = result['offer_mid'] / tlp_estimate
        if tlp_ratio < 0.25:
            result['pricing_flag'] = 'LOW_OFFER_VS_TLP'
            result['offer_mid_original'] = result['offer_mid']
            result['offer_mid'] = round(tlp_estimate * 0.30)
            result['offer_low'] = round(tlp_estimate * 0.25)
            result['offer_high'] = round(tlp_estimate * 0.40)
        elif tlp_ratio < 0.30:
            result['pricing_flag'] = 'REVIEW_LOW'
        elif retail_estimate > tlp_estimate * 2:
            result['pricing_flag'] = 'SUSPECT_COMPS'
        else:
            result['pricing_flag'] = 'OK'

    result['tlp_comps_removed'] = tlp_comps_removed

    # Upgrade pricing flag when comps are stale (>2 years) — unreliable in any direction
    if result.get('comp_age_warning'):
        existing_flag = result.get('pricing_flag', 'OK')
        if existing_flag == 'OK':
            result['pricing_flag'] = 'STALE_COMPS'
        elif existing_flag in ('REVIEW_LOW', 'LOW_OFFER_VS_TLP'):
            result['pricing_flag'] = 'REVIEW_LOW_STALE'
        elif existing_flag in ('HIGH_OFFER_VS_TLP', 'SUSPECT_COMPS'):
            result['pricing_flag'] = 'SUSPECT_COMPS_STALE'

    # Guarantee correct ordering
    result['offer_low'] = min(result['offer_low'], result['offer_mid'])
    result['offer_high'] = max(result['offer_high'], result['offer_mid'])

    return result


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
    Run the full matching pipeline with cleaned comps and acreage band pricing.
    Uses median(comp sale prices) formula — NOT ppa × acres.
    """
    warnings: List[str] = []

    # ── 1. Clean comps (removes bulk sales, outliers, data errors) ───
    raw_comp_count = len(comps_df)
    vc = comps_df[
        (comps_df["Current Sale Price"].notna())
        & (comps_df["Current Sale Price"] > 0)
        & (comps_df["Lot Acres"].notna())
        & (comps_df["Lot Acres"] > 0)
        & (comps_df["Latitude"].notna())
        & (comps_df["Longitude"].notna())
    ].copy()
    vc = vc.reset_index(drop=True)

    # Apply full data cleaning pipeline
    vc = clean_comps_for_pricing(vc)
    if 'ppa' not in vc.columns and len(vc) > 0:
        vc['ppa'] = vc['Current Sale Price'] / vc['Lot Acres']

    cleaned_comp_count = len(vc)
    if raw_comp_count > 0 and cleaned_comp_count < raw_comp_count:
        removed = raw_comp_count - cleaned_comp_count
        warnings.append(
            f"Data cleaning removed {removed} of {raw_comp_count} comps "
            f"(bulk sales, outliers, data errors). {cleaned_comp_count} clean comps remain."
        )

    # Identify premium ZIPs dynamically
    premium_zips = identify_premium_zips(vc) if len(vc) > 0 else []

    # Pre-extract comp arrays (numpy)
    comp_lats = vc["Latitude"].values.astype(np.float64)
    comp_lons = vc["Longitude"].values.astype(np.float64)
    comp_acres = vc["Lot Acres"].values.astype(np.float64)
    comp_prices = vc["Current Sale Price"].values.astype(np.float64)
    comp_ppa = vc["ppa"].values.astype(np.float64)
    comp_zips = vc["Parcel Zip"].astype(str).values if "Parcel Zip" in vc.columns else np.full(len(vc), "")
    comp_band_labels = _acreage_band_label_vec(comp_acres)

    # Build acreage band bounds arrays for vectorized filtering
    comp_band_lows = np.zeros(len(vc), dtype=np.float64)
    comp_band_highs = np.zeros(len(vc), dtype=np.float64)
    for i, ac in enumerate(comp_acres):
        bl, bh, _ = get_acreage_band(float(ac))
        comp_band_lows[i] = bl
        comp_band_highs[i] = bh

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
        high_risk_zones = {"A", "AE", "AH", "AO", "AR", "A99", "V", "VE", "VO"}
        if "FL FEMA Flood Zone" in targets.columns:
            fema_zone = targets["FL FEMA Flood Zone"].fillna("").astype(str).str.strip().str.upper()
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

    # Price ceiling
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
        )

    # ── 5. Inner loop — acreage band + radius + new pricing ──────────
    results: List[Dict[str, Any]] = []

    def _process_one(ti: int, row_distances: Optional[np.ndarray]) -> None:
        """Score + price one target using acreage band + proximity-tiered radius + weighted median pricing."""
        target_acres = t_acres_raw[ti]
        has_acres = not (np.isnan(target_acres) or target_acres <= 0)

        # Apply acreage band filter
        band_label = 'unknown'
        radius_label = None

        if row_distances is None:
            matched_mask = np.zeros(len(vc), dtype=bool)
        else:
            if has_acres:
                band_low, band_high, band_label = get_acreage_band(float(target_acres))
                band_mask = (comp_acres >= band_low) & (comp_acres < band_high)
            else:
                band_mask = np.ones(len(vc), dtype=bool)

            # Premium ZIP restriction: restrict comps to same ZIP for premium areas
            is_premium = False
            t_zip_str = str(t_zips[ti]).split('.')[0].strip()
            if t_zip_str and t_zip_str not in ('nan', 'None', '') and t_zip_str in premium_zips:
                zip_mask = np.array([str(z).split('.')[0].strip() == t_zip_str for z in comp_zips])
                band_mask = band_mask & zip_mask
                is_premium = True

            # Tiered proximity fallback: 1mi → 3mi → 5mi
            matched_mask = np.zeros(len(vc), dtype=bool)
            for radius, label in FALLBACK_RADII:
                trial_mask = band_mask & (row_distances <= radius)
                if trial_mask.sum() >= 3:
                    matched_mask = trial_mask
                    radius_label = label
                    break
            else:
                # Use whatever we have at max fallback radius (3mi)
                matched_mask = band_mask & (row_distances <= 3.0)
                radius_label = '3mi_fallback'

        n_matched = int(matched_mask.sum())

        # ── Scoring ──────────────────────────────────────────────────
        score = 0

        # 1. Acreage band match (always true now since we filter by band)
        if has_acres and n_matched > 0:
            score += 1

        # 2. ZIP match
        t_zip = t_zips[ti]
        if t_zip and t_zip not in ("nan", "None", "") and n_matched > 0:
            if np.any(comp_zips[matched_mask] == t_zip):
                score += 1

        # 3. Comp count quality
        if n_matched >= 3:
            score += 1

        # 4. Price reasonableness
        if has_acres and n_matched > 0:
            matched_prices = comp_prices[matched_mask]
            median_price = float(np.median(matched_prices))
            if 0 < median_price < 2_000_000:
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

        # ── Pricing (proximity-weighted median of comp sale prices) ──
        tlp_val = None
        row = targets.iloc[ti]

        def _f(v: Any) -> "float | None":
            try:
                fv = float(v)
                return None if (np.isnan(fv) or np.isinf(fv)) else fv
            except (TypeError, ValueError):
                return None

        tlp_val = _f(row.get("TLP Estimate"))

        # Build matched comps DataFrame for pricing (include distances for weighting)
        if n_matched > 0:
            matched_indices = np.where(matched_mask)[0]
            matched_comps_df = vc.iloc[matched_indices].copy()
            if row_distances is not None:
                matched_comps_df['distance_miles'] = row_distances[matched_indices]
        else:
            matched_comps_df = pd.DataFrame()

        pricing = calculate_offer_price(
            target_acres=float(target_acres) if has_acres else 0.0,
            matched_comps_df=matched_comps_df,
            tlp_estimate=tlp_val,
            acreage_band_label=band_label,
            radius_label=radius_label,
        )

        # ── Build result dict ────────────────────────────────────────
        def _s(v: Any) -> str:
            if v is None or v is pd.NA:
                return ""
            if isinstance(v, float) and np.isnan(v):
                return ""
            return str(v)

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
            "matched_comp_count": pricing['clean_comp_count'],
            "suggested_offer_low": pricing['offer_low'],
            "suggested_offer_mid": pricing['offer_mid'],
            "suggested_offer_high": pricing['offer_high'],
            "retail_estimate": pricing['retail_estimate'],
            "comp_count": pricing['comp_count'],
            "clean_comp_count": pricing['clean_comp_count'],
            "outliers_removed": pricing['outliers_removed'],
            "median_comp_sale_price": pricing['median_comp_sale_price'],
            "median_ppa": pricing['median_ppa'],
            "min_comp_price": pricing['min_comp_price'],
            "max_comp_price": pricing['max_comp_price'],
            "acreage_band": pricing['acreage_band'],
            "confidence": pricing['confidence'],
            "tlp_estimate": tlp_val,
            "tlp_capped": pricing['tlp_capped'],
            "pricing_flag": pricing.get('pricing_flag'),
            "radius_used_miles": pricing.get('radius_used_miles'),
            "radius_label": pricing.get('radius_label'),
            "proximity_weighted": pricing.get('proximity_weighted', False),
            "tier_counts": pricing.get('tier_counts'),
            "pricing_source": pricing.get('pricing_source', 'NO DATA'),
            "tlp_fallback_mid": pricing.get('tlp_fallback_mid'),
            "flood_zone": _s(row.get("FL FEMA Flood Zone")) or None,
            "buildability_pct": _f(row.get("Buildability total (%)")),
            "latitude": _f(t_lats_raw[ti]),
            "longitude": _f(t_lons_raw[ti]),
            "comp_avg_age_days": pricing.get('comp_avg_age_days'),
            "comp_oldest_days": pricing.get('comp_oldest_days'),
            "comp_age_warning": pricing.get('comp_age_warning', False),
            "premium_zip": is_premium if row_distances is not None else False,
            "nano_buildability_warning": False,
            "nano_buildability_pct": None,
        })

        # Nano buildability warning
        if band_label == 'nano':
            build_val_raw = _f(row.get("Buildability total (%)"))
            if build_val_raw is not None and build_val_raw < 50:
                results[-1]['nano_buildability_warning'] = True
                results[-1]['nano_buildability_pct'] = build_val_raw

    # Process targets WITH coordinates (pass distances for proximity-tiered matching)
    if dist_matrix is not None:
        for local_i, ti in enumerate(with_idx):
            row_distances = dist_matrix[local_i]
            _process_one(ti, row_distances)

    # Process targets WITHOUT coordinates (no comps matched)
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
