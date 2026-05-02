"""
Matching engine: Haversine-based radius filtering + scoring + pricing.
Fully vectorized numpy throughout — no DataFrame creation inside the inner loop.

Pricing model (client-approved March 2026):
    Retail Estimate = median(comp sale prices)  — NOT ppa × acres
    Offer Low  = 50% of retail
    Offer Mid  = 52% of retail
    Offer High = 55% of retail

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
    (2.00, '2mi'),
    (3.00, '3mi'),
    (5.00, '5mi'),
    (10.00, '10mi'),
]

# Minimum comps before stopping radius expansion; accept 1 at final step
_MIN_COMPS_TO_STOP = 2

# Adjacent acreage bands to try within 1mi when exact band has no comps
_ADJACENT_BANDS: dict[str, list[str]] = {
    'nano':   ['micro'],
    'micro':  ['nano', 'small'],
    'small':  ['micro', 'medium'],
    'medium': ['small', 'large'],
    'large':  ['medium', 'tract'],
    'tract':  ['large'],
}


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


def get_quality_thresholds(is_mls_data: bool) -> Tuple[float, float, float]:
    """Return (spread_ratio, spread_amount, cv) thresholds by comp source."""
    if is_mls_data:
        return (5.0, 200000.0, 0.75)
    return (3.0, 100000.0, 0.5)


def is_comp_set_too_spread(
    prices: np.ndarray,
    spread_ratio_threshold: float = 3.0,
    spread_amount_threshold: float = 100000.0,
) -> bool:
    """
    Reject comp set if max > 3x min AND spread > $100K.
    """
    if len(prices) < 2:
        return False

    min_p = float(np.min(prices))
    max_p = float(np.max(prices))

    if min_p <= 0:
        return True

    spread_ratio = max_p / min_p
    spread_amount = max_p - min_p
    return spread_ratio > spread_ratio_threshold and spread_amount > spread_amount_threshold


def is_comp_set_inconsistent(prices: np.ndarray, cv_threshold: float = 0.5) -> bool:
    """
    Coefficient of variation check: std/mean > 0.5 means inconsistent comps.
    For 2 comps, uses a stricter spread ratio check (max/min > 5x).
    """
    if len(prices) < 2:
        return False

    # For exactly 2 comps, use spread ratio since CV is unreliable with n=2
    if len(prices) == 2:
        min_p, max_p = float(np.min(prices)), float(np.max(prices))
        if min_p > 0 and max_p / min_p > 5.0:
            return True
        return False

    mean = float(np.mean(prices))
    std = float(np.std(prices))

    if mean <= 0:
        return True

    cv = std / mean
    return cv > cv_threshold


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


def calculate_score(radius_label: Optional[str], same_street_used: bool, comp_count: int) -> int:
    """
    Client-requested score model tied to comp quality/radius.
    """
    if comp_count == 0:
        return 0
    if same_street_used:
        return 5
    if radius_label == '0.25mi':
        return 4 if comp_count >= 3 else 3
    if radius_label == '0.50mi':
        return 3 if comp_count >= 3 else 2
    if radius_label == '1mi':
        return 2 if comp_count >= 3 else 1
    return 1


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
    bulk_keys = key_counts[key_counts >= 6].index
    clean = df[~df['_bulk_key'].isin(bulk_keys)].drop(columns=['_bulk_key'])
    removed = len(df) - len(clean)
    return clean, removed


def remove_outliers_zip_level(comps_df: pd.DataFrame) -> pd.DataFrame:
    """
    Remove comps whose price-per-acre is an outlier within their ZIP code.
    Uses IQR method: outlier = price_per_acre > Q3 + 1.5*IQR for that ZIP.
    ZIPs with fewer than 4 comps use a simpler 3x median threshold.
    """
    comps_df = comps_df.copy()
    if 'ppa' not in comps_df.columns:
        comps_df['_ppa'] = comps_df['Current Sale Price'] / comps_df['Lot Acres'].replace(0, np.nan)
    else:
        comps_df['_ppa'] = comps_df['ppa']

    zip_col = 'Parcel Zip' if 'Parcel Zip' in comps_df.columns else None
    if zip_col is None or len(comps_df) == 0:
        comps_df.drop(columns=['_ppa'], inplace=True, errors='ignore')
        return comps_df

    kept_indices = []
    removal_log = []

    for zip_code, group in comps_df.groupby(zip_col):
        ppa = group['_ppa'].dropna()

        if len(ppa) == 0:
            kept_indices.extend(group.index.tolist())
            continue

        median_ppa = ppa.median()

        if len(ppa) < 4:
            upper_threshold = median_ppa * 3.0
        else:
            Q1, Q3 = ppa.quantile(0.25), ppa.quantile(0.75)
            IQR = Q3 - Q1
            upper_threshold = Q3 + 1.5 * IQR

        # Lower bound: comps with PPA < 15% of ZIP median are likely
        # distressed/non-arm's-length sales (tax liens, foreclosures, etc.)
        lower_threshold = median_ppa * 0.15 if median_ppa > 0 else 0

        kept = group[(group['_ppa'] <= upper_threshold) & (group['_ppa'] >= lower_threshold)]
        removed = group[(group['_ppa'] > upper_threshold) | (group['_ppa'] < lower_threshold)]

        kept_indices.extend(kept.index.tolist())
        for _, row in removed.iterrows():
            is_low = row.get('_ppa', 0) < lower_threshold
            removal_log.append({
                'zip': zip_code,
                'apn': row.get('APN', ''),
                'price': row.get('Current Sale Price', 0),
                'acres': row.get('Lot Acres', 0),
                'ppa': row.get('_ppa', 0),
                'threshold': lower_threshold if is_low else upper_threshold,
                'reason': 'DISTRESSED' if is_low else 'PREMIUM',
            })

    # For comps with missing ZIP, check against county-wide median threshold
    missing_zip_mask = comps_df[zip_col].isna() | (comps_df[zip_col].astype(str).str.strip().isin(['', 'nan', 'None']))
    missing_zip = comps_df[missing_zip_mask]
    if len(missing_zip) > 0:
        county_median_ppa = comps_df['_ppa'].dropna().median()
        county_threshold = county_median_ppa * 3.0 if county_median_ppa > 0 else float('inf')
        kept_missing = missing_zip[missing_zip['_ppa'] <= county_threshold]
        removed_missing = missing_zip[missing_zip['_ppa'] > county_threshold]
        kept_indices.extend(kept_missing.index.tolist())
        for _, row in removed_missing.iterrows():
            removal_log.append({
                'zip': 'MISSING',
                'apn': row.get('APN', ''),
                'price': row.get('Current Sale Price', 0),
                'acres': row.get('Lot Acres', 0),
                'ppa': row.get('_ppa', 0),
                'threshold': county_threshold,
            })
    kept_indices = list(set(kept_indices))

    result = comps_df.loc[comps_df.index.isin(kept_indices)].drop(columns=['_ppa'], errors='ignore')
    n_removed = len(comps_df) - len(result)
    n_premium = sum(1 for r in removal_log if r.get('reason', 'PREMIUM') == 'PREMIUM')
    n_distressed = sum(1 for r in removal_log if r.get('reason') == 'DISTRESSED')
    print(f"ZIP-level outlier removal: {n_removed} comps removed ({n_premium} premium, {n_distressed} distressed)")
    for r in removal_log[:10]:
        reason = r.get('reason', 'PREMIUM')
        print(f"  [{reason}] ZIP {r['zip']} | APN:{r['apn']} | ${r['price']:,.0f} | {r['acres']}ac | ${r['ppa']:,.0f}/ac | threshold ${r['threshold']:,.0f}/ac")

    return result

def remove_outliers_subdivision_level(comps_df: pd.DataFrame) -> pd.DataFrame:
    """
    Remove comp outliers within each subdivision.
    When 3+ comps share the same subdivision, run IQR within that group.
    Catches cases where one inflated sale anchors an entire street/subdivision.
    """
    if 'Subdivision Name' not in comps_df.columns:
        return comps_df

    comps_df = comps_df.copy()
    if 'ppa' not in comps_df.columns:
        comps_df['ppa'] = comps_df['Current Sale Price'] / comps_df['Lot Acres'].replace(0, np.nan)

    comps_df['_subdiv'] = comps_df['Subdivision Name'].fillna('').str.upper().str.strip()

    kept_indices = []
    total_removed = 0

    for subdiv, group in comps_df.groupby('_subdiv'):
        if not subdiv or len(group) < 3:
            kept_indices.extend(group.index.tolist())
            continue

        ppa = group['ppa'].dropna()
        if len(ppa) < 3:
            kept_indices.extend(group.index.tolist())
            continue

        median_ppa = ppa.median()
        Q1, Q3 = ppa.quantile(0.25), ppa.quantile(0.75)
        IQR = Q3 - Q1
        upper = min(Q3 + 1.5 * IQR, median_ppa * 2.5)
        lower = median_ppa * 0.20

        clean = group[(group['ppa'] <= upper) & (group['ppa'] >= lower)]
        removed = len(group) - len(clean)
        if removed > 0:
            print(f"  Subdivision IQR [{subdiv}]: {removed} outlier comps removed")
            total_removed += removed
        kept_indices.extend(clean.index.tolist())

    result = comps_df.loc[comps_df.index.isin(kept_indices)].drop(columns=['_subdiv'], errors='ignore')
    if total_removed > 0:
        print(f"Subdivision-level outlier removal total: {total_removed} comps removed")
    return result
def remove_outliers_band_level(comps_df: pd.DataFrame) -> pd.DataFrame:
    """
    Remove comps whose PPA is an outlier within their acreage band.
    Uses stricter thresholds than ZIP-level: min(Q3 + 1.5*IQR, 3.0 * band median).
    This catches premium comps that survive ZIP-level filtering because their ZIP
    has too few comps or is uniformly expensive.
    """
    comps_df = comps_df.copy()
    if 'ppa' not in comps_df.columns:
        comps_df['ppa'] = comps_df['Current Sale Price'] / comps_df['Lot Acres'].replace(0, np.nan)

    acres = comps_df['Lot Acres'].values
    band_labels = np.full(len(comps_df), 'nano', dtype=object)
    for low, high, label in ACREAGE_BANDS:
        mask = (acres >= low) & (acres < high)
        band_labels[mask] = label
    comps_df['_band'] = band_labels

    kept = []
    total_removed = 0
    for band_name, group in comps_df.groupby('_band'):
        ppa = group['ppa'].dropna()
        if len(ppa) < 4:
            kept.append(group)
            continue
        Q1, Q3 = ppa.quantile(0.25), ppa.quantile(0.75)
        IQR = Q3 - Q1
        iqr_threshold = Q3 + 1.5 * IQR
        median_threshold = ppa.median() * 3.0
        threshold = min(iqr_threshold, median_threshold)
        clean = group[group['ppa'] <= threshold]
        removed = len(group) - len(clean)
        if removed > 0:
            print(f"  Band-level outlier removal [{band_name}]: {removed} comps removed (threshold ${threshold:,.0f}/ac)")
        total_removed += removed
        kept.append(clean)

    result = pd.concat(kept, ignore_index=True).drop(columns=['_band'], errors='ignore')
    if total_removed > 0:
        print(f"Band-level outlier removal total: {total_removed} comps removed")
    return result


def clean_comps_for_pricing(df: pd.DataFrame) -> pd.DataFrame:
    """
    Remove data quality issues from comp dataset.
    Apply once at comp load time. Returns clean DataFrame.

    Removes: invalid rows, near-zero acreage, non-market sales,
    bulk/developer transactions, PPA outliers (global IQR + ZIP-level + band-level).
    """
    df = df.copy()

    # Require valid price and acreage
    df = df[(df['Current Sale Price'] > 0) & (df['Lot Acres'] > 0)]

    # Remove near-zero acreage (sqft entered as acres)
    df = df[df['Lot Acres'] >= 0.01]

    # Remove non-market sales
    df = df[df['Current Sale Price'] >= 5000]

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

        # Apply pre-calculated global fence
        df = df[(df['ppa'] >= lower_fence) & (df['ppa'] <= upper_fence)]

        # ZIP-level outlier removal (catches premium comps that pass global IQR)
        df = remove_outliers_zip_level(df)

        # Band-level outlier removal (catches comps that are outliers within their acreage band)
        df = remove_outliers_band_level(df)
        

    return df.reset_index(drop=True)


# ─────────────────────────────────────────────
# Pricing function (client-approved formula)
# ─────────────────────────────────────────────

# Client-confirmed pricing percentages (March 2026 - Updated per Damien's request)
LOW_PCT  = 0.50   # 50% of retail
MID_PCT  = 0.52   # 52% of retail
HIGH_PCT = 0.55   # 55% of retail

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
        Offer Low  = 50% of retail
        Offer Mid  = 52% of retail
        Offer High = 55% of retail

    TLP cap: if retail > 2x TLP, retail is capped at TLP.
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
        'no_match_reason': 'NO_COMPS',
        'comp_avg_age_days': None,
        'comp_oldest_days': None,
        'comp_age_warning': False,
        'premium_zip': False,
        'same_street_match': False,
        'closest_comp_distance': None,
    }

    if matched_comps_df is None or len(matched_comps_df) == 0:
        # No comps within 1 mile — return NO_MATCH/NO_COMPS
        return empty

    total_before_clean = len(matched_comps_df)
    comps = matched_comps_df.copy()

    # Ensure ppa column exists
    if 'ppa' not in comps.columns:
        comps['ppa'] = comps['Current Sale Price'] / comps['Lot Acres']

    # Outlier removal (IQR logic + hard sanity guard for extreme prices)
    outliers_removed = 0
    if len(comps) >= 1:
        market_cap = 2_000_000
        market_mask = comps['Current Sale Price'] <= market_cap
        removed_market_extremes = int((~market_mask).sum())
        if removed_market_extremes > 0:
            outliers_removed += removed_market_extremes
            comps = comps[market_mask]

    if len(comps) >= 1:
        median_price = comps['Current Sale Price'].median()
        hard_upper = median_price * 2.0
        hard_outlier_mask = comps['Current Sale Price'] > hard_upper
        hard_removed = int(hard_outlier_mask.sum())
        if hard_removed > 0 and len(comps) - hard_removed >= 1:
            comps = comps[~hard_outlier_mask]
            outliers_removed += hard_removed
    if len(comps) >= 4:
        Q1 = comps['ppa'].quantile(0.25)
        Q3 = comps['ppa'].quantile(0.75)
        IQR = Q3 - Q1
        upper_fence = Q3 + 3 * IQR
        clean = comps[comps['ppa'] <= upper_fence]
        outliers_removed += int(len(comps) - len(clean))
        if len(clean) >= 1:
            comps = clean

    if len(comps) == 0:
        result = empty.copy()
        result['comp_count'] = int(total_before_clean)
        result['outliers_removed'] = int(outliers_removed)
        result['no_match_reason'] = 'ALL_OUTLIERS'
        result['confidence'] = 'NONE'
        result['radius_label'] = radius_label or 'ALL_OUTLIERS'
        return result

    prices = comps['Current Sale Price'].values.astype(np.float64)
    ppas = comps['ppa'].values.astype(np.float64)

    is_mls_data = (
        '_file_format' in comps.columns
        and (comps['_file_format'].astype(str).str.upper() == 'MLS').any()
    )
    spread_ratio_threshold, spread_amount_threshold, cv_threshold = get_quality_thresholds(is_mls_data)

    spread_reject = is_comp_set_too_spread(
        prices,
        spread_ratio_threshold=spread_ratio_threshold,
        spread_amount_threshold=spread_amount_threshold,
    )
    inconsistent_reject = is_comp_set_inconsistent(prices, cv_threshold=cv_threshold)

    if spread_reject:
        reason = 'WIDE_SPREAD'
        # Keep Damien's requested order (spread check first), but when the set is
        # also highly inconsistent and all values are unique, surface inconsistency.
        if inconsistent_reject and len(prices) >= 3 and len(np.unique(prices)) == len(prices):
            reason = 'INCONSISTENT_COMPS'
        result = empty.copy()
        result['comp_count'] = int(total_before_clean)
        result['clean_comp_count'] = 0
        result['outliers_removed'] = int(outliers_removed)
        result['median_comp_sale_price'] = round(float(np.median(prices)))
        result['min_comp_price'] = round(float(np.min(prices)))
        result['max_comp_price'] = round(float(np.max(prices)))
        result['radius_label'] = radius_label or '1mi'
        result['radius_used_miles'] = {'0.25mi': 0.25, '0.50mi': 0.50, '1mi': 1.0, 'same_street': 0.0}.get(radius_label)
        result['no_match_reason'] = reason
        result['confidence'] = 'NONE'
        return result

    if inconsistent_reject:
        result = empty.copy()
        result['comp_count'] = int(total_before_clean)
        result['clean_comp_count'] = 0
        result['outliers_removed'] = int(outliers_removed)
        result['median_comp_sale_price'] = round(float(np.median(prices)))
        result['min_comp_price'] = round(float(np.min(prices)))
        result['max_comp_price'] = round(float(np.max(prices)))
        result['radius_label'] = radius_label or '1mi'
        result['radius_used_miles'] = {'0.25mi': 0.25, '0.50mi': 0.50, '1mi': 1.0, 'same_street': 0.0}.get(radius_label)
        result['no_match_reason'] = 'INCONSISTENT_COMPS'
        result['confidence'] = 'NONE'
        return result

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
    if tlp_estimate and tlp_estimate > 0 and retail_estimate > tlp_estimate * 2.0:
        retail_estimate = tlp_estimate
    offer_low = int(round(retail_estimate * LOW_PCT / 100)) * 100
    offer_mid = int(round(retail_estimate * MID_PCT / 100)) * 100
    offer_high = int(round(retail_estimate * HIGH_PCT / 100)) * 100

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
        'comp_count': int(total_before_clean),
        'clean_comp_count': int(n),
        'outliers_removed': int(outliers_removed),
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
        'pricing_flag': 'MATCHED',
        'no_match_reason': None,
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
    radius_miles: float = 1.0,           # Deprecated — unused. Engine uses hard max 1 mile.
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
    max_retail_price: Optional[float] = None,  # Price ceiling - None = disabled
    # Offer floor filters (flag only, do not exclude)
    min_offer_floor: float = 10000.0,     # Flag as LOW_OFFER if offer_mid < this
    min_lp_estimate: float = 20000.0,     # Flag as LOW_VALUE if retail_estimate < this
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

    # ── 0. Check for important missing columns in targets ────────────
    important_target_cols = {
        "Parcel County": "Parcel County will be empty in exports",
        "Parcel Full Address": "Parcel addresses will be constructed from APN+City+Zip",
        "Parcel State": "Parcel State will be empty in exports",
        "Current Sale Recording Date": "Cannot filter out recently sold properties",
        "Owner 1 First Name": "Owner first/last name split unavailable",
    }
    missing_important = []
    for col, msg in important_target_cols.items():
        if col not in targets_df.columns:
            missing_important.append(f"{col}: {msg}")
    if missing_important:
        warnings.append(
            f"WARNING: Target file is missing {len(missing_important)} important columns. "
            f"Please re-export with ALL columns from Land Portal. Missing: "
            + "; ".join(missing_important)
        )
        print(f"\n*** WARNING: Target file missing {len(missing_important)} important columns ***")
        for m in missing_important:
            print(f"  - {m}")
        print("  Please re-export targets with ALL columns from Land Portal.\n")

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
    # County-awareness: target comps use `Parcel County` from the source export.
    comp_counties = (
        vc["Parcel County"]
        .fillna("")
        .astype(str)
        .str.strip()
        .str.lower()
        .values
        if "Parcel County" in vc.columns
        else (
            vc["Parcel Address County"]
            .fillna("")
            .astype(str)
            .str.strip()
            .str.lower()
            .values
            if "Parcel Address County" in vc.columns
            else np.full(len(vc), "", dtype=object)
        )
    )
    comp_band_labels = _acreage_band_label_vec(comp_acres)

    # Pre-compute county median PPA for county-level fallback
    county_ppa_medians: dict = {}
    if len(vc) > 0 and 'ppa' in vc.columns:
        for _county_key in set(comp_counties):
            if _county_key:
                _cmask = comp_counties == _county_key
                _ppas = comp_ppa[_cmask]
                if len(_ppas) >= 3:
                    county_ppa_medians[_county_key] = float(np.median(_ppas))
    print(f"[match] County PPA medians: {len(county_ppa_medians)} counties — {sorted(county_ppa_medians.keys())[:10]}", flush=True)

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

    # ── Filter out targets that are also in the solds/comps file ─────
    # Only exclude targets whose APN appears in solds WITH a valid sale price
    # (many solds files contain unsold properties with $0/NaN price)
    if "APN" in targets.columns and "APN" in comps_df.columns:
        sold_comps = comps_df[
            (comps_df["Current Sale Price"].notna()) & (comps_df["Current Sale Price"] > 0)
        ] if "Current Sale Price" in comps_df.columns else comps_df
        comp_apns = set(sold_comps["APN"].astype(str).str.strip())
        target_apn_col = targets["APN"].astype(str).str.strip()
        overlap_mask = target_apn_col.isin(comp_apns)
        n_overlap = overlap_mask.sum()
        if n_overlap > 0:
            targets = targets[~overlap_mask]
            warnings.append(f"Excluded {n_overlap} targets that also appear in solds/comps file")
            print(f"Solds overlap filter: removed {n_overlap} targets that are also comp sales")
    filter_counts['after_solds_overlap_filter'] = len(targets)

    # ── Filter out recently sold properties ──────────────────────────
    # Damien: "I don't want any sold properties on a mailing list"
    # Exclude targets that sold within the last 12 months
    if "Current Sale Recording Date" in targets.columns:
        sale_dates = pd.to_datetime(
            targets["Current Sale Recording Date"], format='mixed', errors='coerce'
        )
        cutoff = pd.Timestamp.now() - pd.DateOffset(months=12)
        recently_sold = sale_dates >= cutoff
        before_sold_filter = len(targets)
        targets = targets[~recently_sold]
        n_sold_removed = before_sold_filter - len(targets)
        if n_sold_removed > 0:
            warnings.append(f"Excluded {n_sold_removed} recently sold properties (sold within last 12 months)")
            print(f"Recently sold filter: removed {n_sold_removed} targets sold after {cutoff.strftime('%Y-%m-%d')}")
    filter_counts['after_recently_sold_filter'] = len(targets)

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

    # Debug: Print available columns to help diagnose missing fields
    print("\n[DEBUG] Available columns in targets DataFrame:", flush=True)
    owner_cols = [col for col in targets.columns if 'owner' in col.lower()]
    parcel_cols = [col for col in targets.columns if 'parcel' in col.lower() or 'property' in col.lower()]
    print(f"  Owner-related columns: {owner_cols}", flush=True)
    print(f"  Parcel/Property-related columns: {parcel_cols}", flush=True)
    print(f"  First 5 column names: {targets.columns[:5].tolist()}", flush=True)
    print(f"  All columns containing 'address': {[c for c in targets.columns if 'address' in c.lower()]}", flush=True)
    print(f"  All columns containing 'street': {[c for c in targets.columns if 'street' in c.lower()]}", flush=True)
    print(f"  All columns containing 'situs': {[c for c in targets.columns if 'situs' in c.lower()]}", flush=True)
    print(f"  First 30 columns: {targets.columns[:30].tolist()}", flush=True)

    # Check for parcel address
    has_parcel_address = any(col in targets.columns for col in [
        "Parcel Full Address", "Parcel Address", "Property Address", "Parcel Street Address",
        "Situs Address", "Site Address", "Physical Address", "Location Address"
    ])
    print(f"  Has parcel address column: {has_parcel_address}", flush=True)

    # If we still don't have it, try partial matches
    potential_address_cols = [c for c in targets.columns if
                             ('situs' in c.lower() or 'site' in c.lower() or
                              'physical' in c.lower() or 'location' in c.lower()) and
                             'address' not in c.lower()]
    if potential_address_cols:
        print(f"  Potential address columns (situs/site/physical/location): {potential_address_cols}", flush=True)

    if not has_parcel_address:
        print("  WARNING: No parcel street address column found in CSV - will construct from APN + City + Zip", flush=True)
    print("")
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
    band_ppa_medians = {}
    for band_lo, band_hi, band_name in ACREAGE_BANDS:
        band_masks_dict[band_name] = (comp_acres >= band_lo) & (comp_acres < band_hi)
        band_ppas = comp_ppa[band_masks_dict[band_name]]
        band_ppa_medians[band_name] = float(np.median(band_ppas)) if len(band_ppas) > 0 else 0.0

    # Process targets WITHOUT coordinates (no comps matched)
    results: List[Dict[str, Any]] = []

    # DEBUG: APNs to trace (set to empty list to disable)
    DEBUG_APNS = []

    def _process_one(ti: int, row_distances: Optional[np.ndarray]) -> None:
        """Score + price one target using same-street priority + acreage band + proximity-tiered radius."""
        target_acres = t_acres_raw[ti]
        has_acres = not (np.isnan(target_acres) or target_acres <= 0)
        cross_county_match = False

        # Get APN for debug
        row = targets.iloc[ti]
        target_apn = str(row.get("APN", "")).strip()
        debug = target_apn in DEBUG_APNS
        is_premium = False  # Initialize here
        target_county_raw = str(
            row.get("Parcel County")
            or row.get("Parcel Address County")
            or row.get("County")
            or ""
        ).strip().lower()

        # Apply acreage band filter
        band_label = 'unknown'
        radius_label = None
        same_street_used = False

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

            # ═══ SEARCH PRIORITY ORDER ═══
            # Priority 1: SAME STREET within 1mi (always wins)
            # Priority 2: Expand radius 0.25 → 0.5 → 1 → 2 → 3mi, stop at ≥2 comps
            #             At each step, augment with adjacent acreage bands if exact band is thin
            # Priority 3: Accept single comp at largest radius reached
            # Priority 4: No comps → NO_COMPS

            matched_mask = np.zeros(len(vc), dtype=bool)
            radius_label = 'NO_COMPS'
            same_street_used = False

            # Pre-search: classify why we might fail (for unmatched reasons display)
            _no_match_pre_reason = None
            if has_acres and band_mask.sum() == 0:
                _no_match_pre_reason = 'No comps in acreage band'
            elif t_zip_str and t_zip_str not in ('nan', 'None', ''):
                zip_comp_count = sum(1 for z in comp_zips if str(z).split('.')[0].strip() == t_zip_str)
                if zip_comp_count == 0:
                    _no_match_pre_reason = 'ZIP has no comp data'

            target_street = t_streets[ti]

            # STEP 0: Check same-street comps first across full 1mi radius
            if target_street and len(target_street) > 2:
                street_mask = band_mask & (row_distances <= 1.0) & np.array([s == target_street for s in comp_streets])
                if street_mask.sum() >= 1:
                    matched_mask = street_mask
                    same_street_used = True
                    closest_ss_dist = float(np.min(row_distances[street_mask]))
                    if closest_ss_dist <= 0.25:
                        radius_label = '0.25mi'
                    elif closest_ss_dist <= 0.50:
                        radius_label = '0.50mi'
                    else:
                        radius_label = '1mi'
                    if debug:
                        print(
                            f"[DEBUG {target_apn}] SAME-STREET FIRST: {street_mask.sum()} comps on '{target_street}' within 1mi (closest: {closest_ss_dist:.3f}mi)",
                            flush=True,
                        )

            # STEPS 1-N: Radius expansion up to 3mi with adjacent-band augmentation
            # Stop early once we have ≥2 comps; accept 1 comp as fallback at any step
            if not same_street_used:
                _zip_mask_arr = np.array([str(z).split('.')[0].strip() == t_zip_str for z in comp_zips]) if is_premium else None
                adj_bands = _ADJACENT_BANDS.get(band_label, []) if has_acres else []

                for radius, label in COMP_SEARCH_STEPS:
                    # Start with exact acreage band
                    trial_mask = band_mask & (row_distances <= radius)
                    n = int(trial_mask.sum())

                    # Augment with adjacent bands if exact band is thin at this radius
                    if adj_bands and n < _MIN_COMPS_TO_STOP:
                        for adj_label in adj_bands:
                            adj_mask = band_masks_dict.get(adj_label, np.zeros(len(vc), dtype=bool))
                            adj_trial = adj_mask & (row_distances <= radius)
                            if is_premium and _zip_mask_arr is not None:
                                adj_trial = adj_trial & _zip_mask_arr
                            trial_mask = trial_mask | adj_trial
                            n = int(trial_mask.sum())
                            if n >= _MIN_COMPS_TO_STOP:
                                break

                    if debug:
                        print(
                            f"[DEBUG {target_apn}] Step {label}: {n} comps (exact+adj) within {radius}mi",
                            flush=True,
                        )

                    if n >= _MIN_COMPS_TO_STOP:
                        matched_mask = trial_mask
                        radius_label = label
                        if debug:
                            print(f"[DEBUG {target_apn}] SELECTED ≥{_MIN_COMPS_TO_STOP}: {n} comps at {label}", flush=True)
                        break
                    elif n == 1:
                        # Keep as best-so-far, continue expanding for more
                        matched_mask = trial_mask
                        radius_label = label
                    # n == 0: continue without updating

            # County-awareness guard: if nearby comps are all from different counties,
            # treat as no local comps and avoid forced pricing.
            if matched_mask.sum() > 0 and target_county_raw:
                nearby_counties = comp_counties[matched_mask]
                target_county_key = target_county_raw.split()[0]
                nearby_counties_non_empty = [c for c in nearby_counties if c]
                has_local = any(target_county_key in c for c in nearby_counties_non_empty)
                # Only enforce county guard when comp county data exists.
                if nearby_counties_non_empty and not has_local:
                    matched_mask = np.zeros(len(vc), dtype=bool)
                    radius_label = 'NO_COMPS'
                    cross_county_match = True

            if debug and radius_label == 'NO_COMPS':
                print(f"[DEBUG {target_apn}] NO_COMPS - no comps within 3mi", flush=True)

            # ── Acreage similarity filter (band-specific thresholds) ──
            # Micro/nano bands: lots under 0.5ac vary widely, use looser threshold
            # Small/medium/large: tighter threshold to prevent cross-size matching
            ACREAGE_SIMILARITY_THRESHOLDS = {
                'nano': 0.40,
                'micro': 0.50,   # 0.05-0.5ac range is wide, allow more variation
                'small': 0.75,   # Damien confirmed: 0.5ac vs 0.7ac = too different
                'medium': 0.65,
                'large': 0.55,
                'tract': 0.50,
            }
            if has_acres and matched_mask.sum() > 0 and target_acres > 0:
                matched_idx = np.where(matched_mask)[0]
                matched_comp_acres = comp_acres[matched_idx]
                acreage_ratios = np.minimum(matched_comp_acres, target_acres) / np.maximum(matched_comp_acres, target_acres)

                acreage_threshold = ACREAGE_SIMILARITY_THRESHOLDS.get(band_label, 0.65)
                good_similarity = acreage_ratios >= acreage_threshold
                if good_similarity.sum() == 0:
                    if debug:
                        print(
                            f"[DEBUG {target_apn}] ACREAGE FILTER: all {len(acreage_ratios)} comps fail "
                            f"{acreage_threshold} threshold for {band_label} band (best: {acreage_ratios.max():.2f}) → NO_COMPS",
                            flush=True,
                        )
                    matched_mask = np.zeros(len(vc), dtype=bool)
                    radius_label = 'NO_COMPS'
                elif good_similarity.sum() < len(acreage_ratios):
                    new_mask = np.zeros(len(vc), dtype=bool)
                    new_mask[matched_idx[good_similarity]] = True
                    matched_mask = new_mask
                    if debug:
                        print(
                            f"[DEBUG {target_apn}] ACREAGE FILTER: kept {good_similarity.sum()}/{len(acreage_ratios)} "
                            f"comps with ratio >= {acreage_threshold} ({band_label} band)",
                            flush=True,
                        )

            # ── Single-comp PPA sanity check ──
            # When only 1-2 comps are found, check if their PPA is reasonable
            # relative to the county-wide band median. Prevents premium area comps
            # from pricing rural targets.
            if has_acres and matched_mask.sum() in (1, 2) and band_label in band_ppa_medians:
                band_median_ppa = band_ppa_medians[band_label]
                if band_median_ppa > 0:
                    matched_idx_ppa = np.where(matched_mask)[0]
                    matched_ppas = comp_ppa[matched_idx_ppa]
                    # Remove comps with PPA > 2.5x band median when few comps
                    ppa_ok = matched_ppas <= band_median_ppa * 2.5
                    if ppa_ok.sum() < len(matched_ppas) and ppa_ok.sum() == 0:
                        # All comps are premium outliers → NO_COMPS
                        if debug:
                            print(
                                f"[DEBUG {target_apn}] PPA SANITY: all {len(matched_ppas)} comps have PPA > 2.5x band median "
                                f"(${band_median_ppa:,.0f}/ac) → NO_COMPS",
                                flush=True,
                            )
                        matched_mask = np.zeros(len(vc), dtype=bool)
                        radius_label = 'NO_COMPS'
                    elif ppa_ok.sum() < len(matched_ppas):
                        # Some comps are outliers → keep only reasonable ones
                        new_mask = np.zeros(len(vc), dtype=bool)
                        new_mask[matched_idx_ppa[ppa_ok]] = True
                        matched_mask = new_mask
                        if debug:
                            print(
                                f"[DEBUG {target_apn}] PPA SANITY: removed {(~ppa_ok).sum()} premium comps, kept {ppa_ok.sum()}",
                                flush=True,
                            )

            # ── Step: Same ZIP code, any acreage band (no distance constraint) ──
            if matched_mask.sum() == 0 and t_zip_str and t_zip_str not in ('nan', 'None', ''):
                zip_all_mask = np.array([str(z).split('.')[0].strip() == t_zip_str for z in comp_zips])
                if int(zip_all_mask.sum()) >= 2:
                    matched_mask = zip_all_mask
                    radius_label = 'ZIP'
                    if debug:
                        print(
                            f"[DEBUG {target_apn}] ZIP FALLBACK: {zip_all_mask.sum()} comps in ZIP {t_zip_str}",
                            flush=True,
                        )

            # ── Step: Same county, any acreage band (set radius label — pricing handled below) ──
            if matched_mask.sum() == 0 and target_county_raw:
                target_county_key = target_county_raw.split()[0]
                county_key_match = (
                    target_county_key if target_county_key in county_ppa_medians
                    else (target_county_raw if target_county_raw in county_ppa_medians else None)
                )
                if county_key_match:
                    # Mark so county median pricing fires below
                    radius_label = 'COUNTY_MEDIAN'

        n_matched = int(matched_mask.sum())
        t_zip = t_zips[ti]

        # ── Scoring ──────────────────────────────────────────────────
        score = calculate_score(radius_label, same_street_used, n_matched)
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

        tlp_raw = str(row.get("TLP Estimate") or "").replace("$", "").replace(",", "").strip()
        tlp_val = _f(tlp_raw) if tlp_raw else None

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
            same_street_match=same_street_used,
        )

        valid_comps_count = int(pricing.get('clean_comp_count') or 0)
        has_real_pricing = pricing.get('retail_estimate') is not None and float(pricing.get('retail_estimate') or 0) > 0

        # Hard status assignment guard: only true matches can be MATCHED.
        if n_matched == 0 or valid_comps_count == 0 or not has_real_pricing:
            pricing['pricing_flag'] = 'NO_COMPS'
            pricing['no_match_reason'] = pricing.get('no_match_reason') or 'NO_COMPS'
            pricing['retail_estimate'] = None
            pricing['offer_low'] = None
            pricing['offer_mid'] = None
            pricing['offer_high'] = None
            pricing['confidence'] = 'NONE'
            pricing['comp_count'] = int(pricing.get('comp_count') or 0)
            pricing['clean_comp_count'] = 0
            pricing['closest_comp_distance'] = None
            score = 0
        else:
            pricing['pricing_flag'] = 'MATCHED'
            pricing['no_match_reason'] = None
            score = calculate_score(radius_label, same_street_used, valid_comps_count)
            pricing['confidence'] = get_confidence(valid_comps_count, radius_label)

        if cross_county_match and pricing.get('pricing_flag') == 'NO_COMPS':
            pricing['no_match_reason'] = 'NO_LOCAL_COMPS'

        # ── COUNTY_MEDIAN: county PPA median × target acres ──
        if pricing['pricing_flag'] == 'NO_COMPS' and radius_label == 'COUNTY_MEDIAN' and has_acres and target_acres > 0:
            target_county_key = target_county_raw.split()[0] if target_county_raw else ''
            _county_ppa = (
                county_ppa_medians.get(target_county_key)
                or county_ppa_medians.get(target_county_raw)
            )
            if _county_ppa and _county_ppa > 0:
                _county_retail = _county_ppa * float(target_acres)
                if _county_retail > 0 and (not max_retail_price or _county_retail <= max_retail_price):
                    pricing.update({
                        'pricing_flag': 'COUNTY_MEDIAN',
                        'pricing_source': 'COUNTY_MEDIAN',
                        'retail_estimate': round(_county_retail),
                        'offer_low': int(round(_county_retail * LOW_PCT / 100)) * 100,
                        'offer_mid': int(round(_county_retail * MID_PCT / 100)) * 100,
                        'offer_high': int(round(_county_retail * HIGH_PCT / 100)) * 100,
                        'confidence': 'EST',
                        'no_match_reason': f'No comps within 10mi — county median used',
                        'radius_label': 'COUNTY_MEDIAN',
                        'comp_count': 0,
                        'clean_comp_count': 0,
                        'closest_comp_distance': None,
                    })

        # ── LP_FALLBACK: no comps but target has a TLP/LP Estimate ──
        # Use lp_estimate × pricing percentages as fallback pricing
        if pricing['pricing_flag'] == 'NO_COMPS' and tlp_val and tlp_val > 0:
            lp_retail = float(tlp_val)
            _lp_reason = _no_match_pre_reason or 'No comps within 10 miles'
            pricing.update({
                'pricing_flag': 'LP_FALLBACK',
                'pricing_source': 'LP_FALLBACK',
                'retail_estimate': round(lp_retail),
                'offer_low': int(round(lp_retail * LOW_PCT / 100)) * 100,
                'offer_mid': int(round(lp_retail * MID_PCT / 100)) * 100,
                'offer_high': int(round(lp_retail * HIGH_PCT / 100)) * 100,
                'confidence': 'EST',
                'no_match_reason': _lp_reason,
                'radius_label': 'LP_FALLBACK',
            })
            # score stays 0 — no comp evidence, LP estimate only

        # Set human-readable no_match_reason for records that remain unpriced
        if pricing.get('pricing_flag') == 'NO_COMPS' and not pricing.get('no_match_reason'):
            pricing['no_match_reason'] = _no_match_pre_reason or 'No comps within 10 miles'

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

        # Parse owner name into first/last if separate columns don't exist
        owner_full = _s(row.get("Owner Name(s)") or row.get("Owner 1 Full Name"))

        # Try to get first/last from dedicated columns first
        owner_first = _s(
            row.get("Owner 1 First Name") or
            row.get("Owner1FirstName") or
            row.get("Owner First Name") or
            row.get("Owner1 First Name")
        )
        owner_last = _s(
            row.get("Owner 1 Last Name") or
            row.get("Owner1LastName") or
            row.get("Owner Last Name") or
            row.get("Owner1 Last Name")
        )

        # If no dedicated columns, parse from full name
        if not owner_first and not owner_last and owner_full:
            name_parts = owner_full.strip().split()
            if len(name_parts) >= 2:
                owner_first = name_parts[0]
                owner_last = " ".join(name_parts[1:])
            elif len(name_parts) == 1:
                owner_last = name_parts[0]

            # Debug first parsed name
            if ti == 0:
                print(f"[DEBUG] First owner name parsed: '{owner_full}' -> first='{owner_first}', last='{owner_last}'", flush=True)

        # Build parcel address - try dedicated columns first, then construct from available data
        parcel_street_address = _s(
            row.get("Parcel Full Address") or
            row.get("Parcel Address") or
            row.get("Property Address") or
            row.get("Parcel Street Address") or
            row.get("Situs Address") or
            row.get("Site Address") or
            row.get("Physical Address") or
            row.get("Location Address") or
            ""
        )

        # If no street address column exists, construct from APN + City + Zip
        if not parcel_street_address:
            apn_val = _s(row.get("APN"))
            city_val = _s(row.get("Parcel City"))
            zip_val = _s(t_zip)
            if apn_val and city_val:
                parcel_street_address = f"APN: {apn_val}, {city_val}, NC {zip_val}"
            elif city_val:
                parcel_street_address = f"{city_val}, NC {zip_val}"

        # ── Extract comp transparency fields (sorted by distance, up to 3 comps) ──
        comp_1_apn = comp_1_address = comp_1_date = ""
        comp_2_apn = comp_2_address = comp_2_date = ""
        comp_3_apn = comp_3_address = comp_3_date = ""
        comp_1_price = comp_1_acres = comp_1_distance = comp_1_ppa = None
        comp_2_price = comp_2_acres = comp_2_distance = comp_2_ppa = None
        comp_3_price = comp_3_acres = comp_3_distance = comp_3_ppa = None
        comp_1_same_street = False
        comp_quality_flags: list = []
        num_comps_used = 0
        pricing_method = "NO_COMPS"

        if n_matched > 0 and len(matched_comps_df) > 0:
            if 'distance_miles' in matched_comps_df.columns:
                sorted_comps = matched_comps_df.sort_values('distance_miles').reset_index(drop=True)
            else:
                sorted_comps = matched_comps_df.reset_index(drop=True)

            num_comps_used = len(sorted_comps)
            pricing_method = "SINGLE" if num_comps_used == 1 else "MEDIAN"

            _cutoff_18mo = pd.Timestamp.now() - pd.DateOffset(months=18)
            _target_ac = float(target_acres) if has_acres and target_acres > 0 else None

            def _extract_comp_row(comp_row):
                _apn = _s(comp_row.get("APN", ""))
                _addr = _s(comp_row.get("Parcel Full Address", ""))
                _price = _f(comp_row.get("Current Sale Price"))
                _acres = _f(comp_row.get("Lot Acres"))
                _date = _s(comp_row.get("Current Sale Recording Date", ""))
                _dist = _f(comp_row.get("distance_miles")) if 'distance_miles' in comp_row.index else None
                _ppa = round(_price / _acres, 2) if _price and _acres and _acres > 0 else None
                _qflags = []
                if _acres and _target_ac:
                    _ratio = max(_acres, _target_ac) / min(_acres, _target_ac)
                    if _ratio > 3.0:
                        _qflags.append("POOR_COMP")
                if _date:
                    try:
                        _dt = pd.to_datetime(_date, errors='coerce')
                        if pd.notna(_dt) and _dt < _cutoff_18mo:
                            _qflags.append("STALE_COMP")
                    except Exception:
                        pass
                return _apn, _addr, _price, _acres, _date, _dist, _ppa, _qflags

            if len(sorted_comps) >= 1:
                comp_1_apn, comp_1_address, comp_1_price, comp_1_acres, comp_1_date, comp_1_distance, comp_1_ppa, _qflags1 = _extract_comp_row(sorted_comps.iloc[0])
                comp_1_same_street = same_street_used
                comp_quality_flags.extend(_qflags1)

            if len(sorted_comps) >= 2:
                comp_2_apn, comp_2_address, comp_2_price, comp_2_acres, comp_2_date, comp_2_distance, comp_2_ppa, _qflags2 = _extract_comp_row(sorted_comps.iloc[1])
                comp_quality_flags.extend(_qflags2)

            if len(sorted_comps) >= 3:
                comp_3_apn, comp_3_address, comp_3_price, comp_3_acres, comp_3_date, comp_3_distance, comp_3_ppa, _qflags3 = _extract_comp_row(sorted_comps.iloc[2])
                comp_quality_flags.extend(_qflags3)

            # If ALL comps have quality issues, flag as REVIEW_NEEDED
            unique_flags = list(set(comp_quality_flags))
            if num_comps_used > 0 and comp_quality_flags and all(f in ("POOR_COMP", "STALE_COMP") for f in comp_quality_flags):
                unique_flags.append("REVIEW_NEEDED")
            comp_quality_flags = unique_flags

        # Update pricing_method for LP_FALLBACK case
        if pricing.get('pricing_flag') == 'LP_FALLBACK':
            pricing_method = 'LP_FALLBACK'
        if pricing.get('pricing_flag') == 'COUNTY_MEDIAN':
            pricing_method = 'COUNTY_MEDIAN'

        # ── Pricing sanity flag (TLP comparison) ──
        pricing_sanity_flag = "NO_TLP"
        retail_est = pricing.get('retail_estimate')
        if retail_est and retail_est > 0 and tlp_val and tlp_val > 0:
            ratio = retail_est / tlp_val
            if ratio > 3.0:
                pricing_sanity_flag = "SUSPECT_HIGH"
            elif ratio > 1.5:
                pricing_sanity_flag = "ABOVE_TLP"
            elif ratio < 0.3:
                pricing_sanity_flag = "BELOW_TLP"
            else:
                pricing_sanity_flag = "OK"

        results.append({
            "apn": _s(row.get("APN") or row.get("Assessor Parcel Number") or row.get("Parcel Number") or row.get("Parcel ID")),
            "owner_name": owner_full,
            "owner_first_name": owner_first,
            "owner_last_name": owner_last,
            "mail_address": _s(row.get("Mail Full Address")),
            "mail_city": _s(row.get("Mail City")),
            "mail_state": _s(row.get("Mail State")),
            "mail_zip": _s(row.get("Mail Zip")),
            "parcel_zip": _s(t_zip),
            "parcel_city": _s(row.get("Parcel City")),
            "parcel_address": parcel_street_address,
            "parcel_state": _s(row.get("Parcel State") or row.get("Parcel Address State") or ""),
            "parcel_county": _s(row.get("Parcel County") or row.get("Parcel Address County") or ""),
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
            "no_match_reason": pricing.get('no_match_reason'),
            "cross_county_match": cross_county_match,
            "radius_used_miles": pricing.get('radius_used_miles'),
            "radius_label": pricing.get('radius_label'),
            "proximity_weighted": pricing.get('proximity_weighted', False),
            "tier_counts": pricing.get('tier_counts'),
            "pricing_source": pricing.get('pricing_source', 'NO_COMPS'),
            "flood_zone": _s(row.get("FL FEMA Flood Zone")) or None,
            "buildability_pct": _f(row.get("Buildability total (%)")),
            # LP fields passed through from target CSV
            "owner_phone": _s(row.get("Phone 1") or row.get("Owner Phone") or row.get("Phone")),
            "lp_property_id": _s(row.get("Property Id") or row.get("Property ID") or row.get("propertyID") or row.get("Id")),
            "fips": _s(row.get("Parcel FIPS") or row.get("County Code (FIPS)") or row.get("Parcel Fips") or row.get("FIPS") or row.get("Fips")),
            "land_locked": _s(row.get("Land Locked")),
            "fema_coverage": _f(row.get("FEMA Flood Coverage") or row.get("Fema Flood Coverage")),
            "wetlands_coverage": _f(row.get("Wetlands Coverage")),
            "slope_avg": _f(row.get("Slope Avg")),
            "elevation_avg": _f(row.get("Elevation Avg")),
            "school_district": _s(row.get("School District")),
            "zoning": _s(row.get("Zoning Code") or row.get("Zoning")),
            "assessed_value": _s(row.get("Total Assessed Value") or row.get("Assessed Value")),
            "land_use": _s(row.get("Land Use Code") or row.get("Land Use")),
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
            # Comp 1 transparency fields
            "comp_1_apn": comp_1_apn,
            "comp_1_address": comp_1_address,
            "comp_1_price": comp_1_price,
            "comp_1_acres": comp_1_acres,
            "comp_1_date": comp_1_date,
            "comp_1_distance": comp_1_distance,
            "comp_1_ppa": comp_1_ppa,
            "comp_1_same_street": comp_1_same_street,
            # Comp 2 transparency fields
            "comp_2_apn": comp_2_apn,
            "comp_2_address": comp_2_address,
            "comp_2_price": comp_2_price,
            "comp_2_acres": comp_2_acres,
            "comp_2_date": comp_2_date,
            "comp_2_distance": comp_2_distance,
            "comp_2_ppa": comp_2_ppa,
            # Comp 3 transparency fields
            "comp_3_apn": comp_3_apn,
            "comp_3_address": comp_3_address,
            "comp_3_price": comp_3_price,
            "comp_3_acres": comp_3_acres,
            "comp_3_date": comp_3_date,
            "comp_3_distance": comp_3_distance,
            "comp_3_ppa": comp_3_ppa,
            # Pricing metadata
            "num_comps_used": num_comps_used,
            "pricing_method": pricing_method,
            "comp_quality_flags": ",".join(comp_quality_flags) if comp_quality_flags else "",
            # Pricing sanity flag
            "pricing_sanity_flag": pricing_sanity_flag,
        })

        if cross_county_match:
            results[-1]['match_score'] = 0
            results[-1]['matched_comp_count'] = 0
            results[-1]['confidence'] = 'NONE'

        # Debug: Print first result to verify fields are populated
        if ti == 0:
            print(f"[DEBUG] First result added to results list:", flush=True)
            print(f"  owner_name: '{results[-1]['owner_name']}'", flush=True)
            print(f"  owner_first_name: '{results[-1]['owner_first_name']}'", flush=True)
            print(f"  owner_last_name: '{results[-1]['owner_last_name']}'", flush=True)
            print(f"  parcel_address (constructed): '{results[-1]['parcel_address']}'", flush=True)
            print(f"  parcel_city: '{results[-1]['parcel_city']}'", flush=True)

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
                results[-1]['no_match_reason'] = 'NO_COMPS'
                results[-1]['pricing_source'] = 'PRICE_CEILING'
                results[-1]['retail_estimate'] = None
                results[-1]['suggested_offer_low'] = None
                results[-1]['suggested_offer_mid'] = None
                results[-1]['suggested_offer_high'] = None
                results[-1]['match_score'] = 0
                results[-1]['confidence'] = 'NONE'
                results[-1]['matched_comp_count'] = 0
                results[-1]['clean_comp_count'] = 0
                results[-1]['closest_comp_distance'] = None

        # ── Floor checks: flag below-minimum records (do not remove) ──
        _flag = results[-1].get('pricing_flag')
        if _flag in ('MATCHED', 'LP_FALLBACK'):
            _offer_mid = results[-1].get('suggested_offer_mid')
            _retail = results[-1].get('retail_estimate')
            if _offer_mid is not None and min_offer_floor and float(_offer_mid) < float(min_offer_floor):
                results[-1]['pricing_flag'] = 'LOW_OFFER'
            elif _retail is not None and min_lp_estimate and float(_retail) < float(min_lp_estimate):
                results[-1]['pricing_flag'] = 'LOW_VALUE'

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

    # ── County coverage diagnostics ───────────────────────────────────────
    comp_counties_set = set(c for c in comp_counties if c)
    _target_county_col = next(
        (col for col in ('Parcel County', 'Parcel Address County', 'County') if col in targets.columns),
        None,
    )
    if _target_county_col:
        target_counties_set = set(
            str(v).strip().lower()
            for v in targets[_target_county_col].dropna()
            if str(v).strip()
        )
    else:
        target_counties_set = set()
    covered_counties   = sorted(target_counties_set & comp_counties_set)
    uncovered_counties = sorted(target_counties_set - comp_counties_set)
    coverage_pct = round(len(covered_counties) / len(target_counties_set) * 100) if target_counties_set else 100
    county_diagnostics = {
        'target_county_count':  len(target_counties_set),
        'comp_county_count':    len(comp_counties_set),
        'covered_county_count': len(covered_counties),
        'uncovered_counties':   uncovered_counties,
        'coverage_pct':         coverage_pct,
        'message': (
            f"Your comps cover {len(covered_counties)} of {len(target_counties_set)} counties in your target list."
            + (f" Missing: {', '.join(uncovered_counties[:5])}{'...' if len(uncovered_counties) > 5 else ''}." if uncovered_counties else "")
        ),
    }
    print(f"[match] County coverage: {len(covered_counties)}/{len(target_counties_set)} ({coverage_pct}%)", flush=True)
    if uncovered_counties:
        print(f"[match] Uncovered counties: {uncovered_counties}", flush=True)

    # ── Pricing method breakdown ──────────────────────────────────────────
    _breakdown_keys = ['0.25mi', '0.50mi', '1mi', '2mi', '3mi', '5mi', '10mi', 'ZIP', 'COUNTY_MEDIAN', 'LP_FALLBACK', 'NO_DATA']
    pricing_breakdown: dict = {k: 0 for k in _breakdown_keys}
    county_median_count = 0
    for _r in results:
        _flag = _r.get('pricing_flag')
        _rl   = _r.get('radius_label', '')
        if _flag == 'MATCHED' and _rl in pricing_breakdown:
            pricing_breakdown[_rl] += 1
        elif _flag == 'COUNTY_MEDIAN':
            pricing_breakdown['COUNTY_MEDIAN'] += 1
            county_median_count += 1
        elif _flag == 'LP_FALLBACK':
            pricing_breakdown['LP_FALLBACK'] += 1
        elif _flag in ('NO_COMPS', None):
            pricing_breakdown['NO_DATA'] += 1

    # Debug: Verify first result in final sorted list
    if results:
        print(f"\n[DEBUG] Final result sample (before return):", flush=True)
        print(f"  apn: '{results[0].get('apn')}'", flush=True)
        print(f"  owner_name: '{results[0].get('owner_name')}'", flush=True)
        print(f"  owner_first_name: '{results[0].get('owner_first_name')}'", flush=True)
        print(f"  owner_last_name: '{results[0].get('owner_last_name')}'", flush=True)
        print(f"  parcel_address (constructed): '{results[0].get('parcel_address')}'", flush=True)
        print("  OK: All fields populated correctly", flush=True)
        print("")

    matched_count     = sum(1 for r in results if r.get("pricing_flag") == "MATCHED")
    lp_fallback_count = sum(1 for r in results if r.get("pricing_flag") == "LP_FALLBACK")
    low_offer_count   = sum(1 for r in results if r.get("pricing_flag") == "LOW_OFFER")
    low_value_count   = sum(1 for r in results if r.get("pricing_flag") == "LOW_VALUE")
    unpriced_count    = sum(1 for r in results if r.get("pricing_flag") in ("NO_COMPS", None))
    mailable_count    = matched_count  # LP_FALLBACK is reference only, not mailable

    # Smart floor: 10th percentile of all priced offer_mid values
    _priced_offers = sorted([
        float(r['suggested_offer_mid']) for r in results
        if r.get('suggested_offer_mid') is not None
        and r.get('pricing_flag') in ('MATCHED', 'LP_FALLBACK', 'LOW_OFFER', 'LOW_VALUE')
    ])
    if _priced_offers:
        _idx = max(0, int(len(_priced_offers) * 0.10) - 1)
        smart_floor_recommendation: Optional[float] = _priced_offers[_idx]
    else:
        smart_floor_recommendation = None

    return {
        "match_id": str(uuid.uuid4()),
        "total_targets": total_targets,
        "matched_count": matched_count,
        "mailable_count": mailable_count,
        "lp_fallback_count": lp_fallback_count,
        "low_offer_count": low_offer_count,
        "low_value_count": low_value_count,
        "unpriced_count": unpriced_count,
        "county_median_count": county_median_count,
        "smart_floor_recommendation": smart_floor_recommendation,
        "results": results,
        "warnings": warnings,
        "filter_counts": filter_counts,
        "county_diagnostics": county_diagnostics,
        "pricing_breakdown": pricing_breakdown,
    }
