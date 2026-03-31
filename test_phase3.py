"""
Phase 3: Targeted accuracy testing after fixes.
Test 1: 5 failing APNs
Test 2: Full Moore County regression
Test 3: Brunswick County regression
"""
import sys
import os
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

from services.matching_engine import (
    run_matching, get_acreage_band, _acreage_band_label_vec,
    _extract_street_name, _haversine_matrix, clean_comps_for_pricing,
    identify_premium_zips, COMP_SEARCH_STEPS,
)
from services.csv_parser import parse_csv

TEST_DATA = "D:/upwork/Land_Parcel/test-data"


def load_csv(path, is_comps=False):
    with open(path, "rb") as f:
        df, stats = parse_csv(f.read(), is_comps=is_comps)
    return df, stats


# ============================================================
# TEST 1: 5 Failing APNs
# ============================================================
def test_5_apns():
    print("\n" + "=" * 70)
    print("TEST 1: 5 Failing APNs — Post-Fix Accuracy")
    print("=" * 70)

    solds_df, _ = load_csv(os.path.join(TEST_DATA, "Moore County Solds.csv"), is_comps=True)
    # Use small targets (has correct APNs)
    targets_small, _ = load_csv(os.path.join(TEST_DATA, "Moore County NC Target_837 (1).csv"))
    # Use big targets for 00041750 (maps to propertyID)
    targets_big, _ = load_csv(os.path.join(TEST_DATA, "Moore County Targets.csv"))

    # Run matching on small targets
    print("\nRunning matching engine on small targets file...")
    result_small = run_matching(
        comps_df=solds_df.copy(),
        targets_df=targets_small.copy(),
        max_retail_price=None,  # Don't apply price ceiling for this test
    )
    print(f"  Matched: {result_small['matched_count']} / {result_small['total_targets']}")

    # Run matching on big targets
    print("Running matching engine on big targets file...")
    result_big = run_matching(
        comps_df=solds_df.copy(),
        targets_df=targets_big.copy(),
        max_retail_price=None,
    )
    print(f"  Matched: {result_big['matched_count']} / {result_big['total_targets']}")

    # Merge results by APN
    results_by_apn = {}
    for r in result_small['results'] + result_big['results']:
        apn = str(r.get('apn', '')).strip()
        if apn not in results_by_apn:
            results_by_apn[apn] = r

    # Check by propertyID too for 00041750
    # APN 10000146 in big file = propertyID containing 41750
    if '10000146' in results_by_apn:
        results_by_apn['00041750'] = results_by_apn['10000146']

    failing_apns = [
        ("00041750", 15000, 12500),
        ("20120180", 30000, 107000),
        ("43972",    22500, 15000),
        ("24698",    85000, 70400),
        ("20150038", 170000, 20000),
    ]

    print(f"\n{'APN':<12} {'Before':>10} {'After':>10} {'Expected':>10} {'Result':>8}")
    print("-" * 60)

    passes = 0
    for apn, before, expected in failing_apns:
        r = results_by_apn.get(apn)
        if r is None:
            # Try stripping leading zeros
            r = results_by_apn.get(apn.lstrip("0"))
        if r is None:
            print(f"{apn:<12} {'$'+str(before):>10} {'N/A':>10} {'$'+str(expected):>10} {'MISS':>8}")
            continue

        after = r.get('retail_estimate')
        if after is None:
            after_str = "NO_COMPS"
            pct_off = 100
        else:
            after = round(after)
            after_str = f"${after:,}"
            pct_off = abs(after - expected) / expected * 100

        passed = pct_off <= 20
        if passed:
            passes += 1
        status = "PASS" if passed else "FAIL"

        # Show comp info
        comp_addr = r.get('comp_1_address', '')
        comp_price = r.get('comp_1_price')
        comp_dist = r.get('comp_1_distance')
        comp_info = ""
        if comp_addr:
            comp_info = f" | Comp: {comp_addr}"
            if comp_price:
                comp_info += f" ${comp_price:,.0f}"
            if comp_dist:
                comp_info += f" {comp_dist:.2f}mi"

        print(f"{apn:<12} {'$'+str(before):>10} {after_str:>10} {'$'+str(expected):>10} {status:>8}{comp_info}")

    print(f"\nOverall: {passes}/5 passing")
    return passes


# ============================================================
# TEST 2: Full Moore County Regression
# ============================================================
def test_moore_county():
    print("\n" + "=" * 70)
    print("TEST 2: Full Moore County Regression")
    print("=" * 70)

    solds_df, solds_stats = load_csv(os.path.join(TEST_DATA, "Moore County Solds.csv"), is_comps=True)
    targets_df, _ = load_csv(os.path.join(TEST_DATA, "Moore County Targets.csv"))

    print(f"\nSolds: {solds_stats['total_rows']} total, {solds_stats['valid_rows']} valid")
    print(f"Targets: {len(targets_df)} total")

    # Show outlier removal stats
    print("\nRunning matching engine...")
    result = run_matching(
        comps_df=solds_df.copy(),
        targets_df=targets_df.copy(),
        max_retail_price=None,
    )

    matched = sum(1 for r in result['results'] if r.get('pricing_flag') == 'MATCHED')
    no_comps = sum(1 for r in result['results'] if r.get('pricing_flag') != 'MATCHED')
    total = len(result['results'])
    rate = matched / total * 100 if total > 0 else 0

    print(f"\nMatch results:")
    print(f"  MATCHED: {matched} | NO_COMPS: {no_comps} | Match rate: {rate:.1f}%")

    # Pricing sanity flag distribution
    flags = {}
    for r in result['results']:
        flag = r.get('pricing_sanity_flag', 'N/A')
        flags[flag] = flags.get(flag, 0) + 1

    print(f"\nPricing Sanity Flag distribution:")
    for flag in ['OK', 'ABOVE_TLP', 'SUSPECT_HIGH', 'BELOW_TLP', 'NO_TLP', 'N/A']:
        print(f"  {flag}: {flags.get(flag, 0)}")

    # Retail/TLP sanity
    suspect_high = 0
    below_tlp = 0
    for r in result['results']:
        retail = r.get('retail_estimate')
        tlp = r.get('tlp_estimate')
        if retail and tlp and retail > 0 and tlp > 0:
            ratio = retail / tlp
            if ratio > 3.0:
                suspect_high += 1
            elif ratio < 0.3:
                below_tlp += 1

    print(f"\nRetail/TLP sanity:")
    print(f"  Records where Retail > 3x TLP: {suspect_high}")
    print(f"  Records where Retail < 0.3x TLP: {below_tlp}")

    # Sample matched records with comp transparency
    matched_results = [r for r in result['results'] if r.get('pricing_flag') == 'MATCHED']
    print(f"\nSample 5 matched records with comp transparency:")
    print(f"{'APN':<12} {'Retail':>10} {'TLP':>10} {'Flag':>8} {'Comp Address':<25} {'Comp$':>10} {'Dist':>6} {'Street':>7}")
    print("-" * 100)
    for r in matched_results[:5]:
        apn = r.get('apn', '')[:11]
        retail = f"${r.get('retail_estimate', 0):,.0f}" if r.get('retail_estimate') else "N/A"
        tlp = f"${r.get('tlp_estimate', 0):,.0f}" if r.get('tlp_estimate') else "N/A"
        flag = r.get('pricing_sanity_flag', '')[:8]
        comp_addr = (r.get('comp_1_address') or '')[:24]
        comp_price = f"${r.get('comp_1_price', 0):,.0f}" if r.get('comp_1_price') else ""
        comp_dist = f"{r.get('comp_1_distance', 0):.2f}" if r.get('comp_1_distance') else ""
        comp_street = "Yes" if r.get('comp_1_same_street') else "No"
        print(f"{apn:<12} {retail:>10} {tlp:>10} {flag:>8} {comp_addr:<25} {comp_price:>10} {comp_dist:>6} {comp_street:>7}")

    # Verify all MATCHED have comp info
    matched_with_comp = sum(1 for r in matched_results if r.get('comp_1_address'))
    matched_with_price = sum(1 for r in matched_results if r.get('comp_1_price') and r['comp_1_price'] > 0)
    print(f"\nAll MATCHED have Comp 1 Address: {'YES' if matched_with_comp == len(matched_results) else 'NO'} ({matched_with_comp}/{len(matched_results)})")
    print(f"All MATCHED have Comp 1 Price > 0: {'YES' if matched_with_price == len(matched_results) else 'NO'} ({matched_with_price}/{len(matched_results)})")

    return result


# ============================================================
# TEST 3: Brunswick County Regression
# ============================================================
def test_brunswick_county():
    print("\n" + "=" * 70)
    print("TEST 3: Brunswick County Regression")
    print("=" * 70)

    solds_path = os.path.join(TEST_DATA, "Brunswick Sold NEW TEST.csv")
    targets_path = os.path.join(TEST_DATA, "NC_Brunswick_Targets Test Data.csv")

    if not os.path.exists(solds_path) or not os.path.exists(targets_path):
        print("  Brunswick County test files not found, skipping.")
        return None

    solds_df, _ = load_csv(solds_path, is_comps=True)
    targets_df, _ = load_csv(targets_path)

    print(f"\nSolds: {len(solds_df)} rows")
    print(f"Targets: {len(targets_df)} rows")

    print("\nRunning matching engine...")
    result = run_matching(
        comps_df=solds_df.copy(),
        targets_df=targets_df.copy(),
        max_retail_price=None,
    )

    matched = sum(1 for r in result['results'] if r.get('pricing_flag') == 'MATCHED')
    no_comps = sum(1 for r in result['results'] if r.get('pricing_flag') != 'MATCHED')
    total = len(result['results'])
    rate = matched / total * 100 if total > 0 else 0

    print(f"\nMatch results: MATCHED {matched} | NO_COMPS {no_comps} | Rate {rate:.1f}%")

    # Pricing flags
    flags = {}
    for r in result['results']:
        flag = r.get('pricing_sanity_flag', 'N/A')
        flags[flag] = flags.get(flag, 0) + 1

    print(f"Pricing Flag: ", end="")
    for flag in ['OK', 'SUSPECT_HIGH', 'ABOVE_TLP', 'BELOW_TLP', 'NO_TLP']:
        print(f"{flag} {flags.get(flag, 0)} | ", end="")
    print()

    # Verify comp transparency
    matched_results = [r for r in result['results'] if r.get('pricing_flag') == 'MATCHED']
    matched_with_comp = sum(1 for r in matched_results if r.get('comp_1_address'))
    matched_with_price = sum(1 for r in matched_results if r.get('comp_1_price') and r['comp_1_price'] > 0)
    print(f"All MATCHED have Comp 1 Address populated: {'YES' if matched_with_comp == len(matched_results) else 'NO'} ({matched_with_comp}/{len(matched_results)})")
    print(f"All MATCHED have Comp 1 Sale Price > 0: {'YES' if matched_with_price == len(matched_results) else 'NO'} ({matched_with_price}/{len(matched_results)})")

    return result


if __name__ == "__main__":
    passes = test_5_apns()
    test_moore_county()
    test_brunswick_county()
