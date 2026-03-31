"""
Phase 1 Diagnostic: Analyze the 5 failing APNs from client feedback.
Runs matching engine logic directly against Moore County CSV files.
Uses SMALL targets file (has correct APNs) + LARGE solds file (more comps).
"""
import sys
import os
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

from services.matching_engine import (
    get_acreage_band, _acreage_band_label_vec, _extract_street_name,
    _haversine_matrix, clean_comps_for_pricing, detect_bulk_sales,
    identify_premium_zips, COMP_SEARCH_STEPS, ACREAGE_BANDS,
    calculate_offer_price, get_comp_weight, weighted_median,
)
from services.csv_parser import parse_csv

TEST_DATA = "D:/upwork/Land_Parcel/test-data"
SOLDS_FILE = os.path.join(TEST_DATA, "Moore County Solds.csv")
# Use small targets file - it has the correct APNs the client referenced
TARGETS_FILE = os.path.join(TEST_DATA, "Moore County NC Target_837 (1).csv")

# Client's 5 failing APNs (APNs as they appear in the small targets file)
FAILING_APNS = {
    # APN in small file -> client's APN was 00041750 (propertyID based)
    # maps to APN 10000146 in big file, but present as... let's search
    "00041750": {"expected": 12500, "system_retail": 15000, "problem": "Over by $2,500 -- wrong comp"},
    "20120180": {"expected": 107000, "system_retail": 30000, "problem": "CRITICAL -- system found cheap wrong comp, missed real one"},
    "43972":    {"expected": 15000, "system_retail": 22500, "problem": "Over -- not using closest comp"},
    "24698":    {"expected": 70400, "system_retail": 85000, "problem": "Over by $14,600"},
    "20150038": {"expected": 20000, "system_retail": 170000, "problem": "CRITICAL -- premium/waterfront comp contaminating result"},
}


def load_data():
    print("Loading solds file (large)...")
    with open(SOLDS_FILE, "rb") as f:
        solds_df, solds_stats = parse_csv(f.read(), is_comps=True)
    print(f"  Total rows: {solds_stats['total_rows']}, Valid: {solds_stats['valid_rows']}")

    print("Loading targets file (small, has correct APNs)...")
    with open(TARGETS_FILE, "rb") as f:
        targets_df, targets_stats = parse_csv(f.read(), is_comps=False)
    print(f"  Total rows: {targets_stats['total_rows']}")

    # Also load large targets for the APNs that might only be there
    print("Loading targets file (large)...")
    with open(os.path.join(TEST_DATA, "Moore County Targets.csv"), "rb") as f:
        targets_big_df, _ = parse_csv(f.read(), is_comps=False)
    print(f"  Total rows: {len(targets_big_df)}")

    return solds_df, targets_df, targets_big_df


def prep_comps(solds_df):
    vc = solds_df[
        (solds_df["Current Sale Price"].notna())
        & (solds_df["Current Sale Price"] > 0)
        & (solds_df["Lot Acres"].notna())
        & (solds_df["Lot Acres"] > 0)
        & (solds_df["Latitude"].notna())
        & (solds_df["Longitude"].notna())
    ].copy().reset_index(drop=True)

    print(f"\n  Valid comps with price+acres+coords: {len(vc)}")
    vc = clean_comps_for_pricing(vc)
    if 'ppa' not in vc.columns and len(vc) > 0:
        vc['ppa'] = vc['Current Sale Price'] / vc['Lot Acres']
    print(f"  After clean_comps_for_pricing: {len(vc)}")

    if len(vc) > 0:
        ppa = vc['ppa']
        print(f"  PPA stats: min=${ppa.min():,.0f}, median=${ppa.median():,.0f}, max=${ppa.max():,.0f}")
        print(f"  Price stats: min=${vc['Current Sale Price'].min():,.0f}, median=${vc['Current Sale Price'].median():,.0f}, max=${vc['Current Sale Price'].max():,.0f}")

    return vc


def find_target_row(apn_str, targets_df, targets_big_df):
    """Find a target row by APN in either targets file."""
    for df in [targets_df, targets_big_df]:
        apn_col = df["APN"].astype(str).str.strip()
        m = df[apn_col == apn_str]
        if len(m) > 0:
            return m.iloc[0]
        m = df[apn_col == apn_str.lstrip("0")]
        if len(m) > 0:
            return m.iloc[0]
    # Try propertyID
    for df in [targets_df, targets_big_df]:
        if 'propertyID' in df.columns:
            pid_col = df["propertyID"].astype(str).str.strip()
            for fmt in [apn_str, apn_str.lstrip("0")]:
                m = df[pid_col.str.contains(fmt, na=False)]
                if len(m) > 0:
                    return m.iloc[0]
    return None


def diagnose_apn(apn_str, target_row, vc, premium_zips, raw_solds):
    info = FAILING_APNS[apn_str]
    expected = info["expected"]
    system_retail = info["system_retail"]
    problem = info["problem"]

    print(f"\n{'=' * 70}")
    print(f"APN: {apn_str}")
    print(f"{'=' * 70}")

    target_acres = float(target_row.get("Lot Acres", 0) or 0)
    target_lat = float(target_row.get("Latitude", 0) or 0)
    target_lon = float(target_row.get("Longitude", 0) or 0)
    target_zip = str(target_row.get("Parcel Zip", "")).strip()
    target_city = str(target_row.get("Parcel City", "")).strip()
    target_address = str(target_row.get("Parcel Full Address", "")).strip()
    tlp_est = target_row.get("TLP Estimate")
    try:
        tlp_est = float(tlp_est) if tlp_est and not pd.isna(tlp_est) else None
    except (ValueError, TypeError):
        tlp_est = None

    band_low, band_high, band_label = get_acreage_band(target_acres)
    target_street = _extract_street_name(target_address)

    print(f"\nTARGET INFO:")
    print(f"  Address: {target_address}")
    print(f"  City: {target_city} | ZIP: {target_zip}")
    print(f"  Acreage: {target_acres:.4f} | Band: {band_label} ({band_low}-{band_high})")
    print(f"  Lat/Lon: {target_lat}, {target_lon}")
    print(f"  Street extracted: '{target_street}'")
    print(f"  TLP Estimate: ${tlp_est:,.0f}" if tlp_est else "  TLP Estimate: None")

    # Calculate distances to all comps
    t_lat_arr = np.array([target_lat])
    t_lon_arr = np.array([target_lon])
    comp_lats = vc["Latitude"].values.astype(np.float64)
    comp_lons = vc["Longitude"].values.astype(np.float64)
    distances = _haversine_matrix(t_lat_arr, t_lon_arr, comp_lats, comp_lons)[0]

    comp_acres = vc["Lot Acres"].values.astype(np.float64)
    comp_prices = vc["Current Sale Price"].values.astype(np.float64)
    comp_bands = _acreage_band_label_vec(comp_acres)

    band_mask = comp_bands == band_label
    same_band_count = band_mask.sum()

    # Extract street names for same-street matching
    comp_streets = np.array([""] * len(vc), dtype=object)
    if "Parcel Full Address" in vc.columns:
        comp_streets = vc["Parcel Full Address"].fillna("").astype(str).apply(_extract_street_name).values

    print(f"\nCOMP SEARCH RESULTS:")
    print(f"  Same band ({band_label}) comps in full cleaned solds: {same_band_count} total")

    for radius in [0.25, 0.50, 1.00, 2.00, 5.00]:
        cnt = ((distances <= radius) & band_mask).sum()
        all_cnt = (distances <= radius).sum()
        print(f"  Within {radius}mi: {cnt} same-band, {all_cnt} total (any band)")

    # Step 0 -- Same street
    print(f"\n  Step 0 -- Same street '{target_street}' comps (same band):")
    if target_street:
        street_mask = np.array([s == target_street for s in comp_streets])
        street_band_mask = street_mask & band_mask
        n_street = street_band_mask.sum()
        print(f"    Found: {n_street}")
        if n_street > 0:
            idxs = np.where(street_band_mask)[0]
            for idx in idxs[:10]:
                addr = str(vc.iloc[idx].get("Parcel Full Address", ""))
                price = comp_prices[idx]
                acres = comp_acres[idx]
                dist = distances[idx]
                ppa = price / acres if acres > 0 else 0
                apn_c = str(vc.iloc[idx].get("APN", ""))
                print(f"    - APN:{apn_c} | {addr} | ${price:,.0f} | {acres:.2f}ac | {dist:.3f}mi | ${ppa:,.0f}/ac")
        # Also show same-street ANY band
        street_any = street_mask.sum()
        if street_any > n_street:
            print(f"    Same street ANY band: {street_any}")
            idxs = np.where(street_mask)[0]
            for idx in idxs[:10]:
                addr = str(vc.iloc[idx].get("Parcel Full Address", ""))
                price = comp_prices[idx]
                acres = comp_acres[idx]
                dist = distances[idx]
                band_c = comp_bands[idx]
                print(f"    - APN:{vc.iloc[idx].get('APN','')} | {addr} | ${price:,.0f} | {acres:.2f}ac | band:{band_c} | {dist:.3f}mi")
    else:
        street_mask = np.zeros(len(vc), dtype=bool)
        print(f"    No street name extracted")

    # Steps 1-3
    for step_i, (radius, label) in enumerate(COMP_SEARCH_STEPS, 1):
        trial_mask = band_mask & (distances <= radius)
        n_found = trial_mask.sum()
        print(f"\n  Step {step_i} -- Comps within {radius}mi, same band ({band_label}):")
        print(f"    Found: {n_found}")
        if n_found > 0:
            idxs = np.where(trial_mask)[0]
            sorted_idxs = idxs[np.argsort(distances[idxs])]
            for idx in sorted_idxs[:15]:
                addr = str(vc.iloc[idx].get("Parcel Full Address", ""))
                price = comp_prices[idx]
                acres = comp_acres[idx]
                dist = distances[idx]
                ppa = price / acres if acres > 0 else 0
                apn_c = str(vc.iloc[idx].get("APN", ""))
                sale_date = str(vc.iloc[idx].get("Current Sale Recording Date", ""))
                zip_c = str(vc.iloc[idx].get("Parcel Zip", ""))
                print(f"    - APN:{apn_c} | {addr} | ${price:,.0f} | {acres:.2f}ac | {dist:.3f}mi | ${ppa:,.0f}/ac | ZIP:{zip_c} | {sale_date}")

    # Engine simulation
    print(f"\n  ENGINE SIMULATION:")
    is_premium = target_zip in premium_zips
    print(f"  Premium ZIP: {target_zip} in {premium_zips} = {is_premium}")

    working_band_mask = band_mask.copy()
    if is_premium:
        comp_zips = vc["Parcel Zip"].astype(str).values
        zip_mask = np.array([str(z).split('.')[0].strip() == target_zip for z in comp_zips])
        working_band_mask = working_band_mask & zip_mask

    matched_mask = np.zeros(len(vc), dtype=bool)
    radius_label = 'NO_COMPS'
    same_street_used = False

    for radius, label in COMP_SEARCH_STEPS:
        trial_mask = working_band_mask & (distances <= radius)
        if trial_mask.sum() >= 1:
            if target_street and len(target_street) > 2:
                street_trial = trial_mask & street_mask
                if street_trial.sum() >= 1:
                    matched_mask = street_trial
                    same_street_used = True
                    radius_label = label
                    print(f"  -> Selected SAME-STREET at {label}: {street_trial.sum()} comps")
                    break
            matched_mask = trial_mask
            radius_label = label
            print(f"  -> Selected at {label}: {trial_mask.sum()} comps")
            break

    n_matched = matched_mask.sum()
    if n_matched == 0:
        print(f"  -> NO COMPS within 1mi in band {band_label}")

    if n_matched > 0:
        matched_indices = np.where(matched_mask)[0]
        matched_comps_df = vc.iloc[matched_indices].copy()
        matched_comps_df['distance_miles'] = distances[matched_indices]

        print(f"\n  COMPS SELECTED ({n_matched}):")
        for _, cr in matched_comps_df.sort_values('distance_miles').iterrows():
            addr = str(cr.get("Parcel Full Address", ""))
            price = float(cr["Current Sale Price"])
            acres = float(cr["Lot Acres"])
            dist = float(cr["distance_miles"])
            ppa = price / acres if acres > 0 else 0
            apn_c = str(cr.get("APN", ""))
            sale_date = str(cr.get("Current Sale Recording Date", ""))
            zip_c = str(cr.get("Parcel Zip", ""))
            print(f"    APN:{apn_c} | {addr} | ${price:,.0f} | {acres:.2f}ac | {dist:.3f}mi | ${ppa:,.0f}/ac | ZIP:{zip_c} | {sale_date}")

        pricing = calculate_offer_price(
            target_acres=target_acres,
            matched_comps_df=matched_comps_df,
            tlp_estimate=tlp_est,
            acreage_band_label=band_label,
            radius_label=radius_label,
            same_street_match=same_street_used,
        )

        retail = pricing.get('retail_estimate')
        print(f"\n  PRICING RESULT:")
        print(f"    Retail Estimate: ${retail:,.0f}" if retail else "    Retail Estimate: None")
        print(f"    Clean comps: {pricing['clean_comp_count']}, Outliers removed: {pricing['outliers_removed']}")
        print(f"    Pricing flag: {pricing['pricing_flag']}")
        if pricing.get('min_comp_price'):
            print(f"    Min comp: ${pricing['min_comp_price']:,.0f} | Max comp: ${pricing['max_comp_price']:,.0f}")
    else:
        retail = None
        print(f"\n  PRICING: NO_COMPS")

    # Search for the client's expected comp
    print(f"\n  SEARCHING FOR CLIENT'S EXPECTED COMP (~${expected:,.0f}):")
    # In cleaned comps
    near_expected = (distances <= 2.0) & (np.abs(comp_prices - expected) / max(expected, 1) < 0.20)
    if near_expected.sum() > 0:
        idxs = np.where(near_expected)[0]
        print(f"    Found {near_expected.sum()} in CLEANED comps within 2mi (+-20%):")
        for idx in idxs[:10]:
            addr = str(vc.iloc[idx].get("Parcel Full Address", ""))
            price = comp_prices[idx]
            acres = comp_acres[idx]
            dist = distances[idx]
            band_c = comp_bands[idx]
            apn_c = str(vc.iloc[idx].get("APN", ""))
            print(f"      APN:{apn_c} | {addr} | ${price:,.0f} | {acres:.2f}ac | band:{band_c} | {dist:.3f}mi")
    else:
        print(f"    None in cleaned comps within 2mi")

    # Search in RAW solds
    raw_with_coords = raw_solds[
        (raw_solds["Current Sale Price"].notna()) & (raw_solds["Current Sale Price"] > 0)
        & (raw_solds["Latitude"].notna()) & (raw_solds["Longitude"].notna())
    ].copy()
    if len(raw_with_coords) > 0:
        raw_lats = raw_with_coords["Latitude"].values.astype(np.float64)
        raw_lons = raw_with_coords["Longitude"].values.astype(np.float64)
        raw_dists = _haversine_matrix(t_lat_arr, t_lon_arr, raw_lats, raw_lons)[0]
        raw_prices = raw_with_coords["Current Sale Price"].values.astype(np.float64)
        near_raw = (raw_dists <= 2.0) & (np.abs(raw_prices - expected) / max(expected, 1) < 0.20)
        if near_raw.sum() > 0:
            idxs = np.where(near_raw)[0]
            print(f"    Found {near_raw.sum()} in RAW solds within 2mi (+-20%):")
            for idx in idxs[:10]:
                r = raw_with_coords.iloc[idx]
                price = float(r["Current Sale Price"])
                acres = float(r.get("Lot Acres", 0) or 0)
                print(f"      APN:{r.get('APN','')} | {r.get('Parcel Full Address','')} | ${price:,.0f} | {acres:.2f}ac | {raw_dists[idx]:.3f}mi")
        else:
            print(f"    None in RAW solds within 2mi either")
            # Show ALL raw comps within 1mi
            nearby_raw = raw_dists <= 1.0
            if nearby_raw.sum() > 0:
                print(f"    ALL raw comps within 1mi ({nearby_raw.sum()}):")
                idxs = np.where(nearby_raw)[0]
                sorted_idxs = idxs[np.argsort(raw_dists[idxs])]
                for idx in sorted_idxs[:20]:
                    r = raw_with_coords.iloc[idx]
                    price = float(r["Current Sale Price"])
                    acres = float(r.get("Lot Acres", 0) or 0)
                    raw_band = get_acreage_band(acres)[2] if acres > 0 else "?"
                    print(f"      APN:{r.get('APN','')} | {r.get('Parcel Full Address','')} | ${price:,.0f} | {acres:.2f}ac | band:{raw_band} | {raw_dists[idx]:.3f}mi")

    print(f"\n  SYSTEM RETAIL: ${system_retail:,.0f}")
    print(f"  CLIENT EXPECTED: ${expected:,.0f}")
    print(f"  PROBLEM: {problem}")

    print(f"\n  DIAGNOSIS:")
    if retail:
        pct_off = abs(retail - expected) / expected * 100
        direction = "OVER" if retail > expected else "UNDER"
        print(f"    Engine produces: ${retail:,.0f} ({direction} by {pct_off:.1f}%)")
    else:
        print(f"    Engine produces: NO_COMPS")

    # Specific diagnosis
    if apn_str == "20120180":
        print(f"    [X] Same-street match (Tucker Rd) found $30K comp")
        print(f"    [X] No $107K comp exists in solds file within any radius")
        print(f"    [ ] Client's $107K value may come from a different data source")
    elif apn_str == "20150038":
        print(f"    Checking if high-priced comps contaminate this ZIP...")
    elif retail and retail > expected:
        print(f"    [ ] Engine selecting a more expensive comp than the closest one")
    elif retail and retail < expected:
        print(f"    [ ] Engine selecting a cheaper comp, missing the correct one")


def main():
    solds_df, targets_df, targets_big_df = load_data()
    vc = prep_comps(solds_df)

    premium_zips = identify_premium_zips(vc) if len(vc) > 0 else []
    print(f"\nPremium ZIPs: {premium_zips}")

    # Show comp distribution
    if len(vc) > 0:
        comp_acres = vc["Lot Acres"].values.astype(np.float64)
        comp_bands = _acreage_band_label_vec(comp_acres)
        print(f"\nComp distribution by band:")
        for bn in ['nano', 'micro', 'small', 'medium', 'large', 'tract']:
            print(f"  {bn}: {(comp_bands == bn).sum()}")

    if "Parcel Zip" in vc.columns:
        print(f"\nComp distribution by ZIP:")
        for z, cnt in vc["Parcel Zip"].value_counts().head(10).items():
            zc = vc[vc["Parcel Zip"] == z]
            med_p = zc["Current Sale Price"].median()
            med_ppa = zc["ppa"].median() if "ppa" in zc.columns else 0
            max_p = zc["Current Sale Price"].max()
            print(f"  ZIP {z}: {cnt} comps | med=${med_p:,.0f} | max=${max_p:,.0f} | med_ppa=${med_ppa:,.0f}")

    # Diagnose each APN
    for apn_str in FAILING_APNS:
        target_row = find_target_row(apn_str, targets_df, targets_big_df)
        if target_row is None:
            print(f"\n{'=' * 70}")
            print(f"APN: {apn_str} -- NOT FOUND IN ANY TARGETS FILE")
            print(f"{'=' * 70}")
            continue
        diagnose_apn(apn_str, target_row, vc, premium_zips, solds_df)


if __name__ == "__main__":
    main()
