"""
Matching engine: Haversine-based radius filtering + scoring + pricing.
Fully vectorized numpy throughout — no DataFrame creation inside the inner loop.

Pricing model (client-approved March 2026):
    Retail Estimate = median(comp sale prices)  — NOT ppa × acres
    Offer Low  = 50% of retail
    Offer Mid  = 60% of retail
    Offer High = 70% of retail

Search order: 0.25mi → 0.50mi → 1mi (stop at first step with 1+ comp)
Minimum 1 comp required for pricing. No TLP cap. No fallback beyond 1 mile.

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


def _extract_street_name(address: str) -> str:
    """
    Extract street name from a full address for same-street matching.
    Examples:
        "123 Oak Street SW" -> "OAK ST"
        "456 Main Ave NE Supply NC 28462" -> "MAIN AVE"
        "789 Highway 17 South" -> "HIGHWAY 17"
    """
    if not address or not isinstance(address, str):
        return ""
    
    # Normalize
    addr = address.upper().strip()
    
    # Remove common suffixes and directions
    for suffix in [' NC ', ' SC ', ' VA ', ' GA ', ' FL ']:
        if suffix in addr:
            addr = addr.split(suffix)[0]
    
    # Remove ZIP codes (5 digits at end)
    import re
    addr = re.sub(r'\s+\d{5}(-\d{4})?\s*$', '', addr)
    
    # Remove city names (common in area)
    for city in ['SUPPLY', 'LELAND', 'SOUTHPORT', 'BOLIVIA', 'CALABASH', 
                 'OCEAN ISLE BEACH', 'SUNSET BEACH', 'OAK ISLAND', 'SHALLOTTE']:
        addr = addr.replace(city, '')
    
    # Split into parts
    parts = addr.split()
    if len(parts) < 2:
        return ""
    
    # Remove house number (first part if numeric)
    if parts[0].isdigit():
        parts = parts[1:]
    
    # Remove apt/unit numbers
    filtered_parts = []
    for p in parts:
        if p in ['APT', 'UNIT', 'STE', 'SUITE', '#']:
            break
        filtered_parts.append(p)
    
    if not filtered_parts:
        return ""
    
    # Normalize street type abbreviations
    type_map = {
        'STREET': 'ST', 'AVENUE': 'AVE', 'DRIVE': 'DR', 'ROAD': 'RD',
        'LANE': 'LN', 'COURT': 'CT', 'CIRCLE': 'CIR', 'BOULEVARD': 'BLVD',
        'PLACE': 'PL', 'WAY': 'WAY', 'TERRACE': 'TER', 'TRAIL': 'TRL',
        'HIGHWAY': 'HWY', 'PARKWAY': 'PKWY'
    }
    normalized = []
    for p in filtered_parts:
        normalized.append(type_map.get(p, p))
    
    # Remove directional suffixes at end (SW, NE, etc)
    if normalized and normalized[-1] in ['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW']:
        normalized = normalized[:-1]
    
    return ' '.join(normalized).strip()


# ─────────────────────────────────────────────
# Proximity weighting (client-specified)
# ─────────────────────────────────────────────

# ─────────────────────────────────────────────
# Comp search order (client-approved)
# ─────────────────────────────────────────────

COMP_SEARCH_STEPS = [
    (0.25, '0.25mi'),
    (0.50, '0.50mi'),
    (1.00, '1mi'),
]


def get_comp_weight(distance_miles: float) -> float:
    """
    Return proximity weight for a comp at given distance.
    Uses inverse-distance weighting so closest comps dominate pricing.
    
    Examples:
        0.05mi → weight = 20 (very close comp dominates)
        0.1mi  → weight = 10
        0.25mi → weight = 4
        0.5mi  → weight = 2
        1.0mi  → weight = 1
    
    Minimum distance capped at 0.05mi to prevent infinite weights.
    """
    # Cap minimum distance at 0.05mi (~264 feet) to prevent extreme weights
    capped_distance = max(distance_miles, 0.05)
    return 1.0 / capped_distance


PROXIMITY_TIERS = [
    (0.0,  0.25, 3),   # within 0.25 miles: weight = 3x
    (0.25, 0.50, 2),   # 0.25 to 0.50 miles: weight = 2x
    (0.50, 1.00, 1),   # 0.50 to 1.00 miles: weight = 1x
]


def weighted_median(values: np.ndarray, weights: np.ndarray) -> float:
    """
    Calculate weighted median using inverse-distance weights.
    Closest comps have much higher weight, naturally dominating the result.
    
    Example with inverse-distance:
        Comp A: $29,000 at 0.1mi → weight=10
        Comp B: $45,000 at 0.5mi → weight=2
        Comp C: $70,000 at 0.9mi → weight=1.1
        
        Weighted median heavily favors Comp A's $29,000 price.
    """
    if len(values) == 0:
        return 0.0
    if len(values) == 1:
        return float(values[0])
    
    # Sort by value
    sorted_indices = np.argsort(values)
    sorted_values = values[sorted_indices]
    sorted_weights = weights[sorted_indices]
    
    # Normalize weights to sum to 1
    total_weight = np.sum(sorted_weights)
    if total_weight == 0:
        return float(np.median(values))
    
    cumulative_weight = np.cumsum(sorted_weights) / total_weight
    
    # Find the value where cumulative weight crosses 0.5
    median_idx = np.searchsorted(cumulative_weight, 0.5)
    median_idx = min(median_idx, len(sorted_values) - 1)
    
    return float(sorted_values[median_idx])


def get_tier_counts(distances: np.ndarray) -> Dict[str, int]:
    """Count comps in each proximity tier."""
    return {
        'within_0.25mi': int(np.sum(distances <= 0.25)),
        'within_0.50mi': int(np.sum((distances > 0.25) & (distances <= 0.50))),
        'within_1.00mi': int(np.sum((distances > 0.50) & (distances <= 1.00))),
    }


def get_confidence(n_comps: int, radius_label: Optional[str] = None) -> str:
    """Get confidence level based on comp count (client-approved March 2026)."""
    if n_comps >= 3:
        return 'HIGH'
    elif n_comps == 2:
        return 'MEDIUM'
    elif n_comps == 1:
        return 'LOW'
    else:
        return 'NO MATCH'


# ─────────────────────────────────────────────
# Data cleaning
# ─────────────────────────────────────────────

def calculate_comp_age(matched_comps_df: pd.DataFrame) -> Tuple[Optional[int], Optional[int]]:
    """Calculate average and oldest age of comps in days from today."""
    date_col = 'Current Sale Recording Date'
    if date_col not in matched_comps_df.columns:
        return None, None

    dates = pd.to_datetime(matched_comps_df[date_col], format='mixed', dayfirst=False, errors='coerce').dropna()
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

    # Calculate PPA and IQR fence on FULL dataset (before bulk removal)
    if len(df) > 0:
        df['ppa'] = df['Current Sale Price'] / df['Lot Acres']
        Q1 = df['ppa'].quantile(0.25)
        Q3 = df['ppa'].quantile(0.75)
        IQR = Q3 - Q1
        upper_fence = Q3 + 3 * IQR
        lower_fence = max(100, Q1 - 3 * IQR)

        # THEN remove bulk/developer transactions (preserves true IQR distribution)
        df, _ = detect_bulk_sales(df)

        # Apply pre-calculated fence (from full dataset)
        df = df[(df['ppa'] >= lower_fence) & (df['ppa'] <= upper_fence)]

    return df.reset_index(drop=True)


# ─────────────────────────────────────────────
# Pricing function (client-approved formula)
# ─────────────────────────────────────────────

# Client-confirmed pricing percentages (March 2026 - Updated per Damien's request)
LOW_PCT  = 0.60   # 60% of retail
MID_PCT  = 0.65   # 65% of retail
HIGH_PCT = 0.70   # 70% of retail


def calculate_offer_price(
    target_acres: float,
    matched_comps_df: Optional[pd.DataFrame],
    tlp_estimate: Optional[float] = None,
    acreage_band_label: Optional[str] = None,
    radius_label: Optional[str] = None,
    same_street_match: bool = False,
) -> Dict[str, Any]:
    """
    Client-approved pricing model (March 2026 - Updated per Damien's request):

    Formula:
        Single comp: use that price directly as retail
        Multiple comps: use median(comp sale prices)
        Offer Low  = 60% of retail
        Offer Mid  = 65% of retail
        Offer High = 70% of retail

    No TLP involvement - comps only.
    Simplified flags: MATCHED or NO_COMPS only.
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
        'confidence': 'NO_COMPS',
        'tlp_estimate': tlp_estimate,
        'radius_used_miles': None,
        'radius_label': radius_label or 'NO_COMPS',
        'proximity_weighted': False,
        'tier_counts': None,
        'pricing_source': 'NO_COMPS',
        'pricing_flag': 'NO_COMPS',
        'comp_avg_age_days': None,
        'comp_oldest_days': None,
        'comp_age_warning': False,
        'premium_zip': False,
        'same_street_match': False,
        'closest_comp_distance': None,
    }

    if matched_comps_df is None or len(matched_comps_df) == 0:
        # No comps within 1 mile — return NO_COMPS, no TLP fallback
        return empty

    total_before_clean = len(matched_comps_df)
    comps = matched_comps_df.copy()

    # Ensure ppa column exists
    if 'ppa' not in comps.columns:
        comps['ppa'] = comps['Current Sale Price'] / comps['Lot Acres']

    # ═══ OUTLIER REMOVAL (Damien requirement #5) ═══
    # Remove extreme outliers: comps >2× median price are excluded
    # This catches waterfront/premium lots mixed with standard lots
    outliers_removed = 0
    if len(comps) >= 2:
        median_price = comps['Current Sale Price'].median()
        outlier_threshold = median_price * 2.5  # 2.5× median = outlier
        outlier_mask = comps['Current Sale Price'] > outlier_threshold
        outliers_removed = outlier_mask.sum()
        if outliers_removed > 0 and len(comps) - outliers_removed >= 1:
            comps = comps[~outlier_mask]
    if len(comps) >= 4:
        Q1 = comps['ppa'].quantile(0.25)
        Q3 = comps['ppa'].quantile(0.75)
        IQR = Q3 - Q1
        upper_fence = Q3 + 3 * IQR
        clean = comps[comps['ppa'] <= upper_fence]
        outliers_removed = len(comps) - len(clean)
        if len(clean) >= 1:
            comps = clean

    if len(comps) == 0:
        result = empty.copy()
        result['comp_count'] = total_before_clean
        result['outliers_removed'] = outliers_removed
        return result

    prices = comps['Current Sale Price'].values.astype(np.float64)
    ppas = comps['ppa'].values.astype(np.float64)

    # Core formula: single comp uses that price, multiple uses median
    has_distances = 'distance_miles' in comps.columns
    tier_counts = None
    if has_distances:
        distances = comps['distance_miles'].values.astype(np.float64)
        tier_counts = get_tier_counts(distances)

    # Single comp: use that price directly. Multiple comps: use median.
    if len(prices) == 1:
        retail_estimate = float(prices[0])
    else:
        if has_distances:
            distances = comps['distance_miles'].values.astype(np.float64)
            weights = np.array([get_comp_weight(d) for d in distances])
            retail_estimate = weighted_median(prices, weights)
        else:
            retail_estimate = float(np.median(prices))

    # Client-confirmed 60/65/70 percentages (updated March 2026)
    offer_low = round(retail_estimate * LOW_PCT)
    offer_mid = round(retail_estimate * MID_PCT)
    offer_high = round(retail_estimate * HIGH_PCT)

    # Confidence based on comp count
    n = len(comps)
    confidence = get_confidence(n, radius_label)

    # Get closest comp distance
    closest_comp_distance = None
    if has_distances:
        closest_comp_distance = float(np.min(distances))

    # Derive radius_used_miles from radius_label
    _radius_map = {'0.25mi': 0.25, '0.50mi': 0.50, '1mi': 1.0, 'same_street': 0.0}
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
        'radius_used_miles': radius_used_miles,
        'radius_label': radius_label,
        'proximity_weighted': has_distances,
        'tier_counts': tier_counts,
        'pricing_source': 'COMPS',
        'pricing_flag': 'MATCHED',  # Simplified: MATCHED or NO_COMPS only
        'comp_avg_age_days': None,
        'comp_oldest_days': None,
        'comp_age_warning': False,
        'premium_zip': False,
        'same_street_match': same_street_match,
        'closest_comp_distance': closest_comp_distance,
    }

    # Calculate comp age
    avg_age, oldest_age = calculate_comp_age(comps)
    result['comp_avg_age_days'] = avg_age
    result['comp_oldest_days'] = oldest_age
    result['comp_age_warning'] = avg_age > 730 if avg_age else False

    # Simplified pricing flags per Damien's requirement (March 2026):
    # Only MATCHED or NO_COMPS. No TLP-based flags.
    # Stale comps just get a warning flag, not a separate bucket.
    result['pricing_flag'] = 'MATCHED'

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
    radius_miles: float = 10.0,          # DEPRECATED — unused. Engine uses 1mi max.
    acreage_tolerance_pct: float = 50.0,  # DEPRECATED — unused. Engine uses acreage bands instead.
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
    # New filters per Damien (March 2026)
    exclude_with_buildings: bool = True,  # Exclude if Building Sq Ft > 0
    min_road_frontage: float = 50.0,      # Minimum 50ft road frontage
    max_retail_price: float = 200000.0,   # Price ceiling - exclude premium/waterfront ($200K default)
) -> Dict[str, Any]:
    """
    Run the full matching pipeline with cleaned comps and acreage band pricing.
    Uses median(comp sale prices) formula — NOT ppa × acres.
    
    Updated March 2026 per Damien:
    - Simplified flags: MATCHED or NO_COMPS only
    - Pricing: 60/65/70
    - Same-street priority
    - Exclude buildings (sqft > 0)
    - Min 50ft road frontage
    """
    warnings: List[str] = []
    filter_counts = {}  # Track counts at each filter step

    # ── 1. Clean comps (removes bulk sales, outliers, data errors) ───
    raw_comp_count = len(comps_df)
    filter_counts['total_comps'] = raw_comp_count
    
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

    # Extract street names from comp addresses for same-street matching
    comp_streets = np.array([""] * len(vc), dtype=object)
    if "Parcel Full Address" in vc.columns:
        comp_streets = vc["Parcel Full Address"].fillna("").astype(str).apply(_extract_street_name).values

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
    # Per Damien: Do NOT exclude missing data automatically
    # Keep records where Vacant Flag is YES, Y, 1, TRUE, or missing/unknown
    if vacant_only and "Vacant Flag" in targets.columns:
        vf = targets["Vacant Flag"].fillna("").astype(str).str.strip().str.lower()
        # Keep: yes, y, 1, true, OR any empty/null/nan/none (missing data = don't exclude)
        vacant_mask = (vf == "yes") | (vf == "y") | (vf == "1") | (vf == "true") | \
                      (vf == "") | (vf == "nan") | (vf == "none")
        targets = targets[vacant_mask]
    filter_counts['after_vacant_filter'] = len(targets)

    # Road frontage required
    # Per Damien: Do NOT exclude missing data automatically - only exclude explicit 0 or negative
    if require_road_frontage and "Road Frontage" in targets.columns:
        rf = pd.to_numeric(targets["Road Frontage"], errors="coerce")
        targets = targets[rf.isna() | (rf > 0)]  # Keep NULL/unknown frontage
    filter_counts['after_require_frontage'] = len(targets)

    # Exclude land locked
    if exclude_land_locked and "Land Locked" in targets.columns:
        ll = targets["Land Locked"].fillna("").astype(str).str.strip().str.lower()
        targets = targets[(ll == "") | (ll == "0") | (ll == "nan") | (ll == "none") | (ll == "no")]
    filter_counts['after_landlocked'] = len(targets)

    # ═══ NEW FILTERS per Damien (March 2026) ═══
    
    # Exclude properties with buildings (Building Sq Ft > 0)
    if exclude_with_buildings:
        building_col = None
        for col_name in ["Building Sq Ft", "Building Area", "Building Sqft", "Bldg Area"]:
            if col_name in targets.columns:
                building_col = col_name
                break
        if building_col:
            bldg_sqft = pd.to_numeric(targets[building_col], errors="coerce").fillna(0)
            before_bldg = len(targets)
            targets = targets[bldg_sqft <= 0]
            after_bldg = len(targets)
            if before_bldg > after_bldg:
                warnings.append(f"Excluded {before_bldg - after_bldg} properties with buildings (sqft > 0)")
    filter_counts['after_building_filter'] = len(targets)

    # Minimum road frontage (default 50ft)
    if min_road_frontage > 0 and "Road Frontage" in targets.columns:
        rf = pd.to_numeric(targets["Road Frontage"], errors="coerce")
        before_rf = len(targets)
        # Keep records with frontage >= min OR missing frontage (don't exclude unknowns)
        targets = targets[rf.isna() | (rf >= min_road_frontage)]
        after_rf = len(targets)
        if before_rf > after_rf:
            warnings.append(f"Excluded {before_rf - after_rf} properties with <{min_road_frontage}ft road frontage")
    filter_counts['after_frontage_filter'] = len(targets)

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
    filter_counts['final_targets'] = total_targets

    # Add filter counts to warnings for debugging
    warnings.append(f"Filter counts: {filter_counts}")

    if len(vc) == 0 or total_targets == 0:
        return {
            "match_id": str(uuid.uuid4()),
            "total_targets": total_targets,
            "matched_count": 0,
            "results": [],
            "warnings": warnings,
            "filter_counts": filter_counts,
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

    # Extract street names for same-street matching
    t_streets = np.array([""] * total_targets, dtype=object)
    if "Parcel Full Address" in targets.columns:
        t_streets = targets["Parcel Full Address"].fillna("").astype(str).apply(_extract_street_name).values

    has_coords = ~(np.isnan(t_lats_raw) | np.isnan(t_lons_raw))
    with_idx = np.where(has_coords)[0]
    without_idx = np.where(~has_coords)[0]
    
    # Pre-compute acreage band masks for all comps once
    band_masks_dict = {}
    for band_lo, band_hi, band_name in ACREAGE_BANDS:
        band_masks_dict[band_name] = (comp_acres >= band_lo) & (comp_acres < band_hi)

    # Process targets WITHOUT coordinates (no comps matched)
    results: List[Dict[str, Any]] = []

    # DEBUG: APNs to trace (set to empty list to disable)
    DEBUG_APNS = ['237EG02601', '240AB002', '237FB014']

    def _process_one(ti: int, row_distances: Optional[np.ndarray]) -> None:
        """Score + price one target using same-street priority + acreage band + proximity-tiered radius."""
        target_acres = t_acres_raw[ti]
        has_acres = not (np.isnan(target_acres) or target_acres <= 0)

        # Get APN for debug
        row = targets.iloc[ti]
        target_apn = str(row.get("APN", "")).strip()
        debug = target_apn in DEBUG_APNS
        is_premium = False  # Initialize here

        # Apply acreage band filter
        band_label = 'unknown'
        radius_label = None

        if row_distances is None:
            matched_mask = np.zeros(len(vc), dtype=bool)
            if debug:
                print(f"[DEBUG {target_apn}] No row_distances - skipping", flush=True)
        else:
            if has_acres:
                band_low, band_high, band_label = get_acreage_band(float(target_acres))
                band_mask = band_masks_dict.get(band_label, np.zeros(len(vc), dtype=bool)).copy()
                if debug:
                    print(f"\n[DEBUG {target_apn}] =========================================", flush=True)
                    print(f"[DEBUG {target_apn}] Target acres: {target_acres}", flush=True)
                    print(f"[DEBUG {target_apn}] Band: {band_label} ({band_low}-{band_high})", flush=True)
                    print(f"[DEBUG {target_apn}] Total comps: {len(vc)}", flush=True)
                    print(f"[DEBUG {target_apn}] Comps in band: {band_mask.sum()}", flush=True)
                    # Show comps in band
                    band_indices = np.where(band_mask)[0]
                    for idx in band_indices[:10]:  # First 10
                        d = row_distances[idx]
                        p = comp_prices[idx]
                        a = comp_acres[idx]
                        print(f"[DEBUG {target_apn}]   Comp idx={idx}: {a:.2f}ac, ${p:,.0f}, dist={d:.2f}mi", flush=True)
            else:
                band_mask = np.ones(len(vc), dtype=bool)

            # Premium ZIP restriction: restrict comps to same ZIP for premium areas
            is_premium = False
            t_zip_str = str(t_zips[ti]).split('.')[0].strip()
            if t_zip_str and t_zip_str not in ('nan', 'None', '') and t_zip_str in premium_zips:
                zip_mask = np.array([str(z).split('.')[0].strip() == t_zip_str for z in comp_zips])
                band_mask = band_mask & zip_mask
                is_premium = True
                if debug:
                    print(f"[DEBUG {target_apn}] Premium ZIP {t_zip_str}: comps after ZIP filter = {band_mask.sum()}", flush=True)

            # ═══ DAMIEN PRIORITY ORDER (March 2026) ═══
            # 1) SAME STREET FIRST - if comp on same street exists, use it (1 comp is enough)
            # 2) CLOSEST DISTANCE - search 0.25mi → 0.50mi → 1mi
            # 3) Never go beyond 1 mile
            
            matched_mask = np.zeros(len(vc), dtype=bool)
            radius_label = 'NO_COMPS'
            same_street_found = False
            
            # Step 1: Check for same-street comps first
            target_street = t_streets[ti]
            if target_street and len(target_street) > 2:
                street_mask = band_mask & np.array([s == target_street for s in comp_streets])
                if street_mask.sum() >= 1:
                    matched_mask = street_mask
                    radius_label = 'same_street'
                    same_street_found = True
                    if debug:
                        print(f"[DEBUG {target_apn}] SAME STREET MATCH: {street_mask.sum()} comps on '{target_street}'", flush=True)
            
            # Step 2: If no same-street match, use distance-based search
            if not same_street_found:
                for radius, label in COMP_SEARCH_STEPS:
                    trial_mask = band_mask & (row_distances <= radius)
                    if debug:
                        print(f"[DEBUG {target_apn}] Step {label}: {trial_mask.sum()} comps within {radius}mi", flush=True)
                        if trial_mask.sum() > 0:
                            trial_indices = np.where(trial_mask)[0]
                            for idx in trial_indices[:5]:
                                d = row_distances[idx]
                                p = comp_prices[idx]
                                a = comp_acres[idx]
                                print(f"[DEBUG {target_apn}]   -> Comp: {a:.2f}ac, ${p:,.0f}, dist={d:.2f}mi", flush=True)
                    if trial_mask.sum() >= 1:
                        matched_mask = trial_mask
                        radius_label = label
                        if debug:
                            print(f"[DEBUG {target_apn}] SELECTED: {trial_mask.sum()} comps at {label}", flush=True)
                        break
            
            # If no comps found within 1mi, matched_mask stays empty
            if debug and radius_label == 'NO_COMPS':
                print(f"[DEBUG {target_apn}] NO_COMPS - no comps within 1mi", flush=True)

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
            same_street_match=(radius_label == 'same_street'),
        )

        if debug:
            print(f"[DEBUG {target_apn}] PRICING RESULT:", flush=True)
            print(f"[DEBUG {target_apn}]   comp_count={pricing['comp_count']}, clean_comp_count={pricing['clean_comp_count']}", flush=True)
            print(f"[DEBUG {target_apn}]   retail=${pricing['retail_estimate']}, mid=${pricing['offer_mid']}", flush=True)
            print(f"[DEBUG {target_apn}]   radius_label={pricing['radius_label']}", flush=True)
            print(f"[DEBUG {target_apn}]   min_comp=${pricing['min_comp_price']}, max_comp=${pricing['max_comp_price']}", flush=True)
            print(f"[DEBUG {target_apn}] =========================================\n", flush=True)

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
            "parcel_address": _s(row.get("Parcel Full Address")),  # Added for export
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
            "pricing_flag": pricing.get('pricing_flag'),
            "radius_used_miles": pricing.get('radius_used_miles'),
            "radius_label": pricing.get('radius_label'),
            "proximity_weighted": pricing.get('proximity_weighted', False),
            "tier_counts": pricing.get('tier_counts'),
            "pricing_source": pricing.get('pricing_source', 'NO_COMPS'),
            "flood_zone": _s(row.get("FL FEMA Flood Zone")) or None,
            "buildability_pct": _f(row.get("Buildability total (%)")),
            "latitude": _f(t_lats_raw[ti]),
            "longitude": _f(t_lons_raw[ti]),
            "comp_avg_age_days": pricing.get('comp_avg_age_days'),
            "comp_oldest_days": pricing.get('comp_oldest_days'),
            "comp_age_warning": pricing.get('comp_age_warning', False),
            "premium_zip": is_premium if row_distances is not None else False,
            "same_street_match": pricing.get('same_street_match', False),
            "closest_comp_distance": pricing.get('closest_comp_distance'),
            "nano_buildability_warning": False,
            "nano_buildability_pct": None,
            # Road frontage for POSSIBLE_ISSUE detection
            "road_frontage": _f(row.get("Road Frontage")),
            "possible_issue": "YES" if (_f(row.get("Road Frontage")) or 999) < min_road_frontage else "NO",
        })

        # Nano buildability warning
        if band_label == 'nano':
            build_val_raw = _f(row.get("Buildability total (%)"))
            if build_val_raw is not None and build_val_raw < 50:
                results[-1]['nano_buildability_warning'] = True
                results[-1]['nano_buildability_pct'] = build_val_raw

        # ═══ PRICE CEILING (Damien March 2026) ═══
        # If retail > ceiling, mark as NO_COMPS (premium/waterfront exclusion)
        if max_retail_price and results[-1].get('retail_estimate'):
            if results[-1]['retail_estimate'] > max_retail_price:
                results[-1]['pricing_flag'] = 'NO_COMPS'
                results[-1]['pricing_source'] = 'PRICE_CEILING'

    # Process targets WITH coordinates in chunks to save memory
    import gc
    CHUNK_SIZE = 1000
    for chunk_start in range(0, len(with_idx), CHUNK_SIZE):
        chunk_idx = with_idx[chunk_start:chunk_start + CHUNK_SIZE]
        if len(chunk_idx) > 0:
            dist_chunk = _haversine_matrix(
                t_lats_raw[chunk_idx],
                t_lons_raw[chunk_idx],
                comp_lats,
                comp_lons,
            )
            for local_i, ti in enumerate(chunk_idx):
                row_distances = dist_chunk[local_i]
                _process_one(ti, row_distances)
            
            del dist_chunk
            gc.collect()

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
        "filter_counts": filter_counts,
    }
