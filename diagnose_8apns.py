"""
Phase 1: Diagnose all 8 failing APNs reported by client.
Uses the NEW Moore County files (8MB solds + targets).
"""
import sys, os
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

from services.matching_engine import (
    run_matching, clean_comps_for_pricing, get_acreage_band,
    _extract_street_name, _haversine_matrix, ACREAGE_BANDS, remove_outliers_zip_level
)
from services.csv_parser import parse_csv

TEST_DATA = "D:/upwork/Land_Parcel/test-data"

FAILING_APNS = {
    "87000115": {"retail": 42000, "expected": "NO_COMPS", "issue": "no comp in correct acreage band"},
    "20090181": {"retail": 160000, "expected": "NO_COMPS or lower", "issue": "two comps are outliers"},
    "20000434": {"retail": 18000, "expected": "NO_COMPS", "issue": "no comp in correct acreage band"},
    "95000272": {"retail": 18000, "expected": "~18000", "issue": "1ac matched to 3ac comp, tighten band"},
    "20000471": {"retail": 10000, "expected": "~20000", "issue": "$20K comp across street ignored"},
    "97000363": {"retail": 30000, "expected": "~78000", "issue": "$78K comp across street ignored"},
    "20060014": {"retail": 51500, "expected": "NO_COMPS", "issue": "no comp in correct acreage band"},
    "20060059": {"retail": 50000, "expected": "~20000", "issue": "$20K comp across street, wrong comp used"},
}


def load_csv(path, is_comps=False):
    with open(path, "rb") as f:
        df, stats = parse_csv(f.read(), is_comps=is_comps)
    return df, stats


def diagnose():
    solds_path = os.path.join(TEST_DATA, "Moore County Solds.csv")
    targets_path = os.path.join(TEST_DATA, "Moore County NC Targets.csv")

    print("Loading data...")
    solds_df, _ = load_csv(solds_path, is_comps=True)
    targets_df, _ = load_csv(targets_path)

    # Clean comps the same way the engine does
    vc = solds_df[
        (solds_df["Current Sale Price"].notna()) & (solds_df["Current Sale Price"] > 0) &
        (solds_df["Lot Acres"].notna()) & (solds_df["Lot Acres"] > 0) &
        (solds_df["Latitude"].notna()) & (solds_df["Longitude"].notna())
    ].copy()
    vc = clean_comps_for_pricing(vc)
    if 'ppa' not in vc.columns:
        vc['ppa'] = vc['Current Sale Price'] / vc['Lot Acres']

    comp_lats = vc["Latitude"].values.astype(np.float64)
    comp_lons = vc["Longitude"].values.astype(np.float64)
    comp_acres = vc["Lot Acres"].values.astype(np.float64)
    comp_prices = vc["Current Sale Price"].values.astype(np.float64)
    comp_ppas = vc["ppa"].values.astype(np.float64)

    comp_streets = np.array([""] * len(vc), dtype=object)
    if "Parcel Full Address" in vc.columns:
        comp_streets = vc["Parcel Full Address"].fillna("").astype(str).apply(_extract_street_name).values

    comp_band_labels = np.full(len(vc), 'nano', dtype=object)
    for low, high, label in ACREAGE_BANDS:
        mask = (comp_acres >= low) & (comp_acres < high)
        comp_band_labels[mask] = label

    print(f"Clean comps: {len(vc)}")
    print(f"Targets: {len(targets_df)}")

    # Also run the full engine to get actual results
    print("\nRunning full matching engine...")
    result = run_matching(
        comps_df=solds_df.copy(),
        targets_df=targets_df.copy(),
        max_retail_price=None,
    )
    engine_results = {r.get('apn', '').strip(): r for r in result['results']}

    for apn, info in FAILING_APNS.items():
        print(f"\n{'=' * 70}")
        print(f"APN: {apn}")
        print(f"{'=' * 70}")

        # Find target
        target_row = targets_df[targets_df["APN"].astype(str).str.strip() == apn]
        if len(target_row) == 0:
            print(f"  TARGET NOT FOUND in targets file!")
            continue

        target = target_row.iloc[0]
        t_acres = float(target.get("Lot Acres", 0) or 0)
        t_lat = float(target.get("Latitude", 0) or 0)
        t_lon = float(target.get("Longitude", 0) or 0)
        t_zip = str(target.get("Parcel Zip", "")).strip()
        t_addr = str(target.get("Parcel Full Address", "")).strip()
        t_city = str(target.get("Parcel City", "")).strip()
        t_street = _extract_street_name(t_addr)

        band_low, band_high, band_label = get_acreage_band(t_acres)

        print(f"\nTARGET INFO:")
        print(f"  Address: {t_addr} | City: {t_city} | ZIP: {t_zip}")
        print(f"  Acreage: {t_acres:.3f} acres -> Correct band: {band_label} ({band_low}-{band_high})")
        print(f"  Lat/Lon: {t_lat}, {t_lon}")
        print(f"  Street name: '{t_street}'")

        # Calculate distances to all comps
        if t_lat == 0 or t_lon == 0:
            print(f"  NO COORDINATES - cannot match")
            continue

        distances = _haversine_matrix(
            np.array([t_lat]), np.array([t_lon]),
            comp_lats, comp_lons
        )[0]

        # Band mask
        correct_band_mask = (comp_acres >= band_low) & (comp_acres < band_high)

        print(f"\nACREAGE BAND CHECK:")
        print(f"  Total comps in correct band ({band_label}): {correct_band_mask.sum()}")

        # Same-street comps
        street_mask = np.array([s == t_street for s in comp_streets]) if t_street else np.zeros(len(vc), dtype=bool)

        print(f"\nCOMP SEARCH (correct band only):")

        for radius_label, radius in [("0.25mi", 0.25), ("0.50mi", 0.50), ("1.00mi", 1.00)]:
            radius_mask = (distances <= radius) & correct_band_mask
            n = radius_mask.sum()
            print(f"  Within {radius_label}, correct band: {n}")
            if n > 0 and n <= 15:
                indices = np.where(radius_mask)[0]
                for idx in indices:
                    d = distances[idx]
                    p = comp_prices[idx]
                    a = comp_acres[idx]
                    ppa = comp_ppas[idx]
                    addr = str(vc.iloc[idx].get("Parcel Full Address", ""))[:40]
                    same_st = "SAME-ST" if (street_mask[idx] if len(street_mask) > idx else False) else ""
                    bl = comp_band_labels[idx]
                    print(f"    {addr} | ${p:,.0f} | {a:.2f}ac ({bl}) | ${ppa:,.0f}/ac | {d:.3f}mi {same_st}")

        # Same-street comps within 1mi (any band)
        ss_within_1mi = street_mask & (distances <= 1.0)
        print(f"\n  Same-street comps within 1mi (ANY band): {ss_within_1mi.sum()}")
        if ss_within_1mi.sum() > 0:
            indices = np.where(ss_within_1mi)[0]
            for idx in indices:
                d = distances[idx]
                p = comp_prices[idx]
                a = comp_acres[idx]
                ppa = comp_ppas[idx]
                addr = str(vc.iloc[idx].get("Parcel Full Address", ""))[:40]
                bl = comp_band_labels[idx]
                print(f"    {addr} | ${p:,.0f} | {a:.2f}ac ({bl}) | ${ppa:,.0f}/ac | {d:.3f}mi")

        # All comps within 1mi (any band) - top 10 by distance
        any_band_1mi = distances <= 1.0
        print(f"\n  All comps within 1mi (ANY band): {any_band_1mi.sum()}")
        if any_band_1mi.sum() > 0:
            indices = np.where(any_band_1mi)[0]
            sorted_idx = indices[np.argsort(distances[indices])]
            for idx in sorted_idx[:10]:
                d = distances[idx]
                p = comp_prices[idx]
                a = comp_acres[idx]
                ppa = comp_ppas[idx]
                addr = str(vc.iloc[idx].get("Parcel Full Address", ""))[:40]
                same_st = "SAME-ST" if (street_mask[idx] if len(street_mask) > idx else False) else ""
                bl = comp_band_labels[idx]
                print(f"    {addr} | ${p:,.0f} | {a:.2f}ac ({bl}) | ${ppa:,.0f}/ac | {d:.3f}mi {same_st}")

        # Engine result
        eng = engine_results.get(apn)
        print(f"\nENGINE OUTPUT:")
        if eng:
            retail = eng.get('retail_estimate')
            flag = eng.get('pricing_flag')
            band_used = eng.get('acreage_band')
            comp1_addr = eng.get('comp_1_address', '')
            comp1_price = eng.get('comp_1_price')
            comp1_acres = eng.get('comp_1_acres')
            comp1_dist = eng.get('comp_1_distance')
            comp1_ppa = eng.get('comp_1_ppa')
            comp1_same_st = eng.get('comp_1_same_street')
            n_comps = eng.get('clean_comp_count', 0)
            radius = eng.get('radius_label')
            no_match = eng.get('no_match_reason')

            print(f"  Retail Estimate: ${retail:,.0f}" if retail else f"  Retail Estimate: None")
            print(f"  Pricing Flag: {flag}")
            print(f"  Band Used: {band_used}")
            print(f"  Radius: {radius}")
            print(f"  Clean Comp Count: {n_comps}")
            print(f"  No Match Reason: {no_match}")
            if comp1_addr:
                comp1_band = "?"
                if comp1_acres:
                    _, _, comp1_band = get_acreage_band(comp1_acres)
                print(f"  Comp 1: {comp1_addr}")
                print(f"    Price: ${comp1_price:,.0f}" if comp1_price else "    Price: None")
                print(f"    Acres: {comp1_acres:.2f} ({comp1_band})" if comp1_acres else "    Acres: None")
                print(f"    Distance: {comp1_dist:.3f}mi" if comp1_dist else "    Distance: None")
                print(f"    PPA: ${comp1_ppa:,.0f}" if comp1_ppa else "    PPA: None")
                print(f"    Same Street: {comp1_same_st}")
                if comp1_band != band_label:
                    print(f"    *** BAND MISMATCH: comp is {comp1_band}, target is {band_label} ***")
        else:
            print(f"  NOT FOUND in engine results")

        print(f"\nCLIENT REPORT:")
        print(f"  Engine retail: ${info['retail']:,}")
        print(f"  Expected: {info['expected']}")
        print(f"  Issue: {info['issue']}")

        # Diagnosis
        print(f"\nDIAGNOSIS:")
        if eng:
            comp1_band_actual = "?"
            if eng.get('comp_1_acres'):
                _, _, comp1_band_actual = get_acreage_band(eng['comp_1_acres'])

            if eng.get('pricing_flag') == 'MATCHED' and comp1_band_actual != band_label:
                print(f"  A) BAND ENFORCEMENT BROKEN - comp from {comp1_band_actual} band used for {band_label} target")
            elif eng.get('pricing_flag') == 'MATCHED' and info['expected'].startswith('NO_COMPS'):
                # Check if comps in correct band within 1mi exist
                correct_in_1mi = (correct_band_mask & (distances <= 1.0)).sum()
                if correct_in_1mi == 0:
                    print(f"  A) BAND ENFORCEMENT BROKEN - no comps in correct band within 1mi but got MATCHED")
                else:
                    print(f"  B) OUTLIER NOT FILTERED - comps exist but are outliers")
            elif info['expected'].startswith('~'):
                expected_val = float(info['expected'].replace('~', '').replace('K', '000').replace('$', ''))
                actual = eng.get('retail_estimate', 0) or 0
                if actual > 0 and abs(actual - expected_val) / expected_val > 0.25:
                    print(f"  C) WRONG COMP PRIORITY - expected ~${expected_val:,.0f}, got ${actual:,.0f}")
                else:
                    print(f"  OK - within 25% of expected")
            else:
                print(f"  Needs manual review")
        else:
            print(f"  TARGET NOT IN ENGINE RESULTS")


if __name__ == "__main__":
    diagnose()
