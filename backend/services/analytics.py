"""
ZIP code analytics engine for sold comps.
"""
import pandas as pd
import numpy as np
from typing import List, Dict, Any


def compute_zip_stats(df: pd.DataFrame) -> List[Dict[str, Any]]:
    """
    Compute per-ZIP statistics from comp data.
    Only rows with Current Sale Price > 0 AND Lot Acres > 0 are used.
    """
    if "Current Sale Price" not in df.columns or "Lot Acres" not in df.columns:
        return []

    valid = df[
        (df["Current Sale Price"].notna())
        & (df["Current Sale Price"] > 0)
        & (df["Lot Acres"].notna())
        & (df["Lot Acres"] > 0)
        & (df["Parcel Zip"].notna())
    ].copy()

    if len(valid) == 0:
        return []

    valid["price_per_acre"] = valid["Current Sale Price"] / valid["Lot Acres"]

    results: List[Dict[str, Any]] = []

    for zip_code, grp in valid.groupby("Parcel Zip"):
        zc = str(zip_code)
        if zc in ("nan", "None", ""):
            continue

        prices = grp["Current Sale Price"]
        acres = grp["Lot Acres"]
        ppa = grp["price_per_acre"]

        stats: Dict[str, Any] = {
            "zip_code": zc,
            "sales_count": len(grp),
            "min_lot_size": _safe_float(acres.min()),
            "max_lot_size": _safe_float(acres.max()),
            "median_lot_size": _safe_float(acres.median()),
            "min_sale_price": _safe_float(prices.min()),
            "max_sale_price": _safe_float(prices.max()),
            "avg_price_per_acre": _safe_float(ppa.mean()),
            "median_price_per_acre": _safe_float(ppa.median()),
            "price_band_lt50k": int((prices < 50_000).sum()),
            "price_band_50k_100k": int(
                ((prices >= 50_000) & (prices < 100_000)).sum()
            ),
            "price_band_100k_250k": int(
                ((prices >= 100_000) & (prices < 250_000)).sum()
            ),
            "price_band_gt250k": int((prices >= 250_000).sum()),
            "acreage_band_0_1": int((acres < 1).sum()),
            "acreage_band_1_5": int(((acres >= 1) & (acres < 5)).sum()),
            "acreage_band_5_10": int(((acres >= 5) & (acres < 10)).sum()),
            "acreage_band_gt10": int((acres >= 10).sum()),
        }
        results.append(stats)

    results.sort(key=lambda x: x["sales_count"], reverse=True)
    return results


def compute_sweet_spot(df: pd.DataFrame) -> Dict[str, Any] | None:
    """Find the best performing acreage bucket based on sales volume."""
    if "Current Sale Price" not in df.columns or "Lot Acres" not in df.columns:
        return None

    valid = df[
        (df["Current Sale Price"].notna())
        & (df["Current Sale Price"] > 0)
        & (df["Lot Acres"].notna())
        & (df["Lot Acres"] > 0)
    ].copy()

    if len(valid) == 0:
        return None

    buckets = {
        "0-0.5": (0, 0.5),
        "0.5-1": (0.5, 1.0),
        "1-2": (1.0, 2.0),
        "2-5": (2.0, 5.0),
        "5-10": (5.0, 10.0),
        "10+": (10.0, float('inf'))
    }

    best_bucket = None
    best_count = -1
    best_data = None

    for name, (low, high) in buckets.items():
        if high == float('inf'):
            mask = valid["Lot Acres"] >= low
        else:
            mask = (valid["Lot Acres"] >= low) & (valid["Lot Acres"] < high)
        
        subset = valid[mask]
        count = len(subset)

        if count > best_count:
            best_count = count
            best_bucket = name
            best_data = subset

    if best_count == 0 or best_bucket is None or best_data is None:
        return None
        
    # Expected offer range from ALL valid comps (not just the sweet spot bucket)
    all_prices = valid["Current Sale Price"]
    q25 = float(all_prices.quantile(0.25)) if not all_prices.empty else 0.0
    q75 = float(all_prices.quantile(0.75)) if not all_prices.empty else 0.0

    return {
        "bucket": best_bucket,
        "count": best_count,
        "total_sales": len(valid),
        "expected_offer_low": q25,
        "expected_offer_high": q75,
    }


def compute_summary(df: pd.DataFrame) -> Dict[str, Any]:
    """Overall summary stats from comps."""
    total_rows = len(df)

    # Valid comps must have BOTH positive price AND positive acres
    valid_mask = pd.Series([True] * len(df), index=df.index)
    if "Current Sale Price" in df.columns:
        valid_mask &= (df["Current Sale Price"].notna()) & (df["Current Sale Price"] > 0)
    if "Lot Acres" in df.columns:
        valid_mask &= (df["Lot Acres"].notna()) & (df["Lot Acres"] > 0)

    valid = df[valid_mask].copy()

    median_price: float | None = None
    median_acreage: float | None = None
    median_price_per_acre: float | None = None

    if len(valid) > 0 and "Current Sale Price" in valid.columns:
        median_price = _safe_float(valid["Current Sale Price"].median())
    if len(valid) > 0 and "Lot Acres" in valid.columns:
        median_acreage = _safe_float(valid["Lot Acres"].median())
    if len(valid) > 0 and "Current Sale Price" in valid.columns and "Lot Acres" in valid.columns:
        valid["price_per_acre"] = valid["Current Sale Price"] / valid["Lot Acres"]
        median_price_per_acre = _safe_float(valid["price_per_acre"].median())

    # Only include ZIPs that have at least 1 valid comp
    available_zips: List[str] = []
    if "Parcel Zip" in valid.columns:
        available_zips = sorted(
            [
                str(z)
                for z in valid["Parcel Zip"].dropna().unique()
                if str(z) not in ("nan", "None", "")
            ]
        )

    # Top states and counties by comp count
    top_states: List[str] = []
    top_counties: List[str] = []
    state_col = next((c for c in ["Parcel State", "State"] if c in valid.columns), None)
    county_col = next((c for c in ["Parcel County", "Parcel Address County", "County"] if c in valid.columns), None)
    if state_col:
        counts = valid[state_col].dropna().value_counts()
        top_states = [str(s) for s in counts.index if str(s) not in ("nan", "None", "")][:5]
    if county_col:
        counts = valid[county_col].dropna().value_counts()
        top_counties = [str(c) for c in counts.index if str(c) not in ("nan", "None", "")][:10]

    return {
        "total_comps": total_rows,
        "valid_comps": int(valid_mask.sum()),
        "median_price": median_price,
        "median_acreage": median_acreage,
        "median_price_per_acre": median_price_per_acre,
        "available_zips": available_zips,
        "top_states": top_states,
        "top_counties": top_counties,
    }


def generate_insight(zip_stats: List[Dict[str, Any]], summary: Dict[str, Any], sweet_spot_data: Dict[str, Any] | None = None) -> str:
    """
    Auto-generate a human-readable market insight from ZIP analytics.
    Produces spec-style output: sweet spot, most liquid market, outlier ZIPs, thin data warning.
    """
    if not zip_stats:
        return "No comp data available for insight generation."

    top_zip = zip_stats[0]  # sorted by sales_count desc
    all_sales = sum(z["sales_count"] for z in zip_stats)

    # ── Sweet spot from compute_sweet_spot if available ──────────────
    if sweet_spot_data:
        bucket = sweet_spot_data.get("bucket", "0-0.5")
        count = sweet_spot_data.get("count", 0)
        total = sweet_spot_data.get("total_sales", all_sales)
        pct = round(count / total * 100) if total > 0 else 0
        # Format bucket name
        if bucket == "0-0.5":
            sweet_spot_band = "under 0.5 acres"
        elif bucket == "0.5-1":
            sweet_spot_band = "0.5–1 acres"
        elif bucket == "1-2":
            sweet_spot_band = "1–2 acres"
        elif bucket == "2-5":
            sweet_spot_band = "2–5 acres"
        elif bucket == "5-10":
            sweet_spot_band = "5–10 acres"
        else:
            sweet_spot_band = "over 10 acres"
        sweet_spot_pct = pct
        sweet_spot_count = count
    else:
        # Fallback to old band logic
        bands = {
            "under 1 acre": sum(z["acreage_band_0_1"] for z in zip_stats),
            "1–5 acres": sum(z["acreage_band_1_5"] for z in zip_stats),
            "5–10 acres": sum(z["acreage_band_5_10"] for z in zip_stats),
            "over 10 acres": sum(z["acreage_band_gt10"] for z in zip_stats),
        }
        sweet_spot_band = max(bands, key=lambda k: bands[k])
        sweet_spot_pct = round(bands[sweet_spot_band] / all_sales * 100) if all_sales > 0 else 0
        sweet_spot_count = bands[sweet_spot_band]

    # ── Overall median PPA (average of per-ZIP medians) ──────────────
    ppas = [
        z["median_price_per_acre"]
        for z in zip_stats
        if z.get("median_price_per_acre") is not None
    ]
    overall_median_ppa = sum(ppas) / len(ppas) if ppas else None

    # ── Premium outlier ZIPs (PPA > 3x overall median) ───────────────
    outlier_zips: List[tuple] = []
    if overall_median_ppa and overall_median_ppa > 0:
        outlier_zips = [
            (z["zip_code"], z["median_price_per_acre"])
            for z in zip_stats
            if z.get("median_price_per_acre") and z["median_price_per_acre"] > 3 * overall_median_ppa
        ]
        outlier_zips.sort(key=lambda x: x[1], reverse=True)

    # ── Thin data ZIPs (<10 sales) ───────────────────────────────────
    thin_zips = [z["zip_code"] for z in zip_stats if z["sales_count"] < 10]

    parts: List[str] = []

    # Sentence 1: sweet spot with transaction count
    parts.append(
        f"The sweet spot is parcels {sweet_spot_band}, "
        f"accounting for {sweet_spot_pct}% of all sales ({sweet_spot_count} transactions)."
    )

    # Sentence 2: most liquid market + median price
    liquid_part = (
        f"ZIP {top_zip['zip_code']} is the most liquid market "
        f"with {top_zip['sales_count']} transactions."
    )
    if summary.get("median_price"):
        liquid_part += (
            f" The median sale price across all ZIPs is "
            f"${round(summary['median_price']):,}."
        )
    parts.append(liquid_part)

    # Sentence 3: premium outlier ZIPs
    if outlier_zips:
        if len(outlier_zips) == 1:
            z, ppa = outlier_zips[0]
            note = " — likely waterfront or resort" if ppa > 500_000 else " — premium area"
            parts.append(
                f"ZIP {z} is a premium outlier at ${round(ppa):,}/acre{note} "
                f"and should be analyzed separately."
            )
        else:
            zip_strs = [f"ZIP {z[0]} (${round(z[1]):,}/ac)" for z in outlier_zips[:3]]
            parts.append(
                f"{', '.join(zip_strs)} are premium outliers with pricing "
                f"more than 3× the market median — likely waterfront or resort areas."
            )

    # Sentence 4: thin data warning
    if thin_zips:
        if len(thin_zips) <= 3:
            zip_list = ", ".join(thin_zips)
        else:
            zip_list = ", ".join(thin_zips[:3]) + f" and {len(thin_zips) - 3} others"
        plural = "s" if len(thin_zips) > 1 else ""
        have = "have" if len(thin_zips) > 1 else "has"
        parts.append(
            f"Avoid ZIP{plural} {zip_list} which {have} fewer than 10 sales "
            f"and insufficient comp data for reliable pricing."
        )
    elif top_zip.get("median_lot_size"):
        # Fallback: acreage recommendation
        med = top_zip["median_lot_size"]
        low_ac = max(0.1, round(med * 0.5, 1))
        high_ac = round(med * 2.0, 1)
        parts.append(
            f"Recommended target acreage: {low_ac}–{high_ac} acres "
            f"based on median lot size in {top_zip['zip_code']}."
        )

    return " ".join(parts)


def get_comp_locations(
    df: pd.DataFrame,
    zip_filter: List[str] | None = None,
    limit: int = 8000,
) -> List[Dict[str, Any]]:
    """
    Extract comp locations with lat/lon for map display.
    Returns records with valid coordinates only.
    """
    needed = ["Latitude", "Longitude", "Current Sale Price", "Lot Acres"]
    for col in needed:
        if col not in df.columns:
            return []

    valid = df[
        df["Latitude"].notna()
        & df["Longitude"].notna()
        & df["Current Sale Price"].notna()
        & (df["Current Sale Price"] > 0)
    ].copy()

    if zip_filter and "Parcel Zip" in valid.columns:
        valid = valid[valid["Parcel Zip"].astype(str).isin(zip_filter)]

    if len(valid) == 0:
        return []

    # Limit for map performance
    if len(valid) > limit:
        valid = valid.sample(n=limit, random_state=42)

    valid["price_per_acre"] = np.where(valid["Lot Acres"] > 0, valid["Current Sale Price"] / valid["Lot Acres"], 0.0)

    # Try several APN column names
    apn_col = next(
        (c for c in ["APN", "Parcel Number", "Tax Parcel ID", "APN-DAN", "Property ID"] if c in valid.columns),
        None,
    )
    # Try several sale date column names
    date_col = next(
        (c for c in ["Current Sale Recording Date", "Current Sale Contract Date", "Current Sale Date", "Last Sale Date", "Sale Date", "Deed Transfer Date"] if c in valid.columns),
        None,
    )
    
    zip_col = "Parcel Zip" if "Parcel Zip" in valid.columns else None

    results = []
    for _, row in valid.iterrows():
        lat = float(row["Latitude"])
        lon = float(row["Longitude"])
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            continue
        if lat == 0.0 and lon == 0.0:
            continue

        results.append({
            "lat": lat,
            "lng": lon,
            "sale_price": float(row["Current Sale Price"]),
            "lot_acres": float(row["Lot Acres"]) if pd.notna(row["Lot Acres"]) else 0.0,
            "price_per_acre": round(float(row["price_per_acre"]), 2),
            "zip": str(row[zip_col]) if zip_col and pd.notna(row[zip_col]) else "",
            "apn": str(row[apn_col]) if apn_col and pd.notna(row[apn_col]) else "",
            "sale_date": str(row[date_col]) if date_col and pd.notna(row[date_col]) else None,
        })

    return results


def _safe_float(val: Any) -> "float | None":
    """Convert numpy scalar to Python float, returning None for NaN/inf."""
    try:
        f = float(val)
        if np.isnan(f) or np.isinf(f):
            return None
        return round(f, 4)
    except (TypeError, ValueError):
        return None


def compute_land_quality_stats(df: pd.DataFrame) -> Dict[str, Any]:
    """Derive data-driven land quality thresholds from sold comp data.

    Returns percentile-based recommendations for each quality dimension, plus
    the number of comps that had data for each field. When a column is absent
    or has no valid rows the count is 0 and the value is None (caller shows
    a sensible default instead).
    """

    def _pct(series: pd.Series, pct: float) -> "float | None":
        valid = series.dropna()
        valid = valid[np.isfinite(valid)]
        if len(valid) == 0:
            return None
        return _safe_float(np.percentile(valid, pct))

    def _median(series: pd.Series) -> "float | None":
        valid = series.dropna()
        valid = valid[np.isfinite(valid)]
        if len(valid) == 0:
            return None
        return _safe_float(float(valid.median()))

    def _count(series: pd.Series) -> int:
        return int(series.dropna().pipe(lambda s: s[np.isfinite(s)]).shape[0])

    # Buildability — column: 'Buildability total (%)'
    build_col = pd.to_numeric(df.get("Buildability total (%)"), errors="coerce") if "Buildability total (%)" in df.columns else pd.Series(dtype=float)
    build_median = _median(build_col)
    build_count = _count(build_col)
    # Round down to nearest 10 for the minimum recommendation
    build_min: "float | None" = (max(0.0, (build_median // 10) * 10)) if build_median is not None else None

    # Road Frontage — column: 'Road Frontage'
    rf_col = pd.to_numeric(df.get("Road Frontage"), errors="coerce") if "Road Frontage" in df.columns else pd.Series(dtype=float)
    rf_p25 = _pct(rf_col, 25)
    rf_count = _count(rf_col)

    # Slope — column: 'Slope' or 'Average Slope'
    slope_col_name = next((c for c in ["Slope", "Average Slope", "Slope (%)", "Avg Slope"] if c in df.columns), None)
    slope_col = pd.to_numeric(df[slope_col_name], errors="coerce") if slope_col_name else pd.Series(dtype=float)
    slope_p75 = _pct(slope_col, 75)
    slope_count = _count(slope_col)

    # Wetlands — column: 'Wetlands Coverage' or 'FEMA Flood Coverage' (proxy)
    wet_col_name = next((c for c in ["Wetlands Coverage", "Wetlands (%)", "Wetland Coverage"] if c in df.columns), None)
    wet_col = pd.to_numeric(df[wet_col_name], errors="coerce") if wet_col_name else pd.Series(dtype=float)
    wetlands_p75 = _pct(wet_col, 75)
    wetlands_count = _count(wet_col)

    return {
        "buildability_min": build_min,
        "buildability_median": build_median,
        "buildability_count": build_count,
        "road_frontage_p25": rf_p25,
        "road_frontage_count": rf_count,
        "slope_p75": slope_p75,
        "slope_count": slope_count,
        "wetlands_p75": wetlands_p75,
        "wetlands_count": wetlands_count,
    }
