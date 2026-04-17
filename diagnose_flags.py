"""
Diagnose SUSPECT_HIGH and BELOW_TLP records to determine
whether they represent actual engine bugs or valid data situations.
"""
import sys, os
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

from services.matching_engine import run_matching, clean_comps_for_pricing
from services.csv_parser import parse_csv

TEST_DATA = "D:/upwork/Land_Parcel/test-data"


def load_csv(path, is_comps=False):
    with open(path, "rb") as f:
        df, stats = parse_csv(f.read(), is_comps=is_comps)
    return df, stats


def analyze_flags(dataset_name, solds_path, targets_path):
    print(f"\n{'=' * 70}")
    print(f"ANALYSIS: {dataset_name}")
    print(f"{'=' * 70}")

    solds_df, _ = load_csv(solds_path, is_comps=True)
    targets_df, _ = load_csv(targets_path)

    result = run_matching(
        comps_df=solds_df.copy(),
        targets_df=targets_df.copy(),
        max_retail_price=None,
    )

    matched = [r for r in result['results'] if r.get('pricing_flag') == 'MATCHED']
    total = len(result['results'])
    print(f"\nMATCHED: {len(matched)} / {total} ({len(matched)/total*100:.1f}%)")

    # Classify by pricing_sanity_flag
    flags = {}
    for r in result['results']:
        f = r.get('pricing_sanity_flag', 'N/A')
        flags[f] = flags.get(f, 0) + 1
    print(f"\nPricing Sanity Flags:")
    for f in ['OK', 'ABOVE_TLP', 'SUSPECT_HIGH', 'BELOW_TLP', 'NO_TLP']:
        print(f"  {f}: {flags.get(f, 0)}")

    # ── SUSPECT_HIGH analysis ──
    suspect = [r for r in matched if r.get('pricing_sanity_flag') == 'SUSPECT_HIGH']
    print(f"\n--- SUSPECT_HIGH Analysis ({len(suspect)} records) ---")

    if suspect:
        ratios = []
        comp_ppa_vs_zip = []
        for r in suspect:
            retail = r.get('retail_estimate', 0) or 0
            tlp = r.get('tlp_estimate', 0) or 0
            ratio = retail / tlp if tlp > 0 else 0
            ratios.append(ratio)

        print(f"  Retail/TLP ratio: min={min(ratios):.1f}x, median={np.median(ratios):.1f}x, max={max(ratios):.1f}x")
        print(f"  Ratio 3-5x: {sum(1 for r in ratios if 3 < r <= 5)}")
        print(f"  Ratio 5-10x: {sum(1 for r in ratios if 5 < r <= 10)}")
        print(f"  Ratio >10x: {sum(1 for r in ratios if r > 10)}")

        # Are these same-street matches?
        same_street_count = sum(1 for r in suspect if r.get('same_street_match') or r.get('comp_1_same_street'))
        print(f"  Same-street matches: {same_street_count}/{len(suspect)}")

        # Show first 10 examples
        print(f"\n  Top 10 SUSPECT_HIGH examples:")
        suspect_sorted = sorted(suspect, key=lambda r: (r.get('retail_estimate',0) or 0) / max(r.get('tlp_estimate',1) or 1, 1), reverse=True)
        for r in suspect_sorted[:10]:
            retail = r.get('retail_estimate', 0) or 0
            tlp = r.get('tlp_estimate', 0) or 0
            ratio = retail / tlp if tlp > 0 else 0
            comp_price = r.get('comp_1_price', 0) or 0
            comp_dist = r.get('comp_1_distance', 0) or 0
            comp_addr = (r.get('comp_1_address') or '')[:30]
            comp_ppa = r.get('comp_1_ppa', 0) or 0
            same_st = 'Y' if r.get('comp_1_same_street') else 'N'
            print(f"    APN:{r.get('apn','')[:10]} | Retail:${retail:,.0f} | TLP:${tlp:,.0f} | {ratio:.1f}x | Comp:${comp_price:,.0f} {comp_dist:.2f}mi {same_st} | {comp_addr}")

        # Key question: Is TLP unreliable, or are the comps wrong?
        # Check if SUSPECT_HIGH comps are in premium areas vs TLP understating
        print(f"\n  DIAGNOSIS: Are these bad comps or bad TLP?")
        # Count how many have comp $/acre within 2x of ZIP median (meaning comp is reasonable)
        # vs comp $/acre way above ZIP median (meaning comp might be outlier)

    # ── BELOW_TLP analysis ──
    below = [r for r in matched if r.get('pricing_sanity_flag') == 'BELOW_TLP']
    print(f"\n--- BELOW_TLP Analysis ({len(below)} records) ---")

    if below:
        ratios = []
        for r in below:
            retail = r.get('retail_estimate', 0) or 0
            tlp = r.get('tlp_estimate', 0) or 0
            ratio = retail / tlp if tlp > 0 else 0
            ratios.append(ratio)

        print(f"  Retail/TLP ratio: min={min(ratios):.2f}x, median={np.median(ratios):.2f}x, max={max(ratios):.2f}x")
        print(f"  Ratio 0.2-0.3x: {sum(1 for r in ratios if 0.2 <= r < 0.3)}")
        print(f"  Ratio 0.1-0.2x: {sum(1 for r in ratios if 0.1 <= r < 0.2)}")
        print(f"  Ratio <0.1x: {sum(1 for r in ratios if r < 0.1)}")

        # Are these genuinely cheap areas?
        same_street_count = sum(1 for r in below if r.get('same_street_match') or r.get('comp_1_same_street'))
        print(f"  Same-street matches: {same_street_count}/{len(below)}")

        # Show first 10 examples
        print(f"\n  Top 10 BELOW_TLP examples (lowest ratio first):")
        below_sorted = sorted(below, key=lambda r: (r.get('retail_estimate',0) or 0) / max(r.get('tlp_estimate',1) or 1, 1))
        for r in below_sorted[:10]:
            retail = r.get('retail_estimate', 0) or 0
            tlp = r.get('tlp_estimate', 0) or 0
            ratio = retail / tlp if tlp > 0 else 0
            comp_price = r.get('comp_1_price', 0) or 0
            comp_dist = r.get('comp_1_distance', 0) or 0
            comp_addr = (r.get('comp_1_address') or '')[:30]
            comp_ppa = r.get('comp_1_ppa', 0) or 0
            acres = r.get('lot_acres', 0) or 0
            same_st = 'Y' if r.get('comp_1_same_street') else 'N'
            clean_comps = r.get('clean_comp_count', 0)
            print(f"    APN:{r.get('apn','')[:10]} | {acres:.2f}ac | Retail:${retail:,.0f} | TLP:${tlp:,.0f} | {ratio:.2f}x | Comp:${comp_price:,.0f} {comp_dist:.2f}mi {same_st} #{clean_comps}comps | {comp_addr}")

        # Check if these are single-comp matches (less reliable)
        single_comp = sum(1 for r in below if (r.get('clean_comp_count', 0) or 0) == 1)
        multi_comp = sum(1 for r in below if (r.get('clean_comp_count', 0) or 0) >= 2)
        print(f"\n  Single-comp matches: {single_comp}/{len(below)}")
        print(f"  Multi-comp matches: {multi_comp}/{len(below)}")

    # ── Coverage summary (proposed Issue 3) ──
    # Build what the comp coverage looks like
    vc = solds_df[
        (solds_df["Current Sale Price"].notna()) & (solds_df["Current Sale Price"] > 0) &
        (solds_df["Lot Acres"].notna()) & (solds_df["Lot Acres"] > 0)
    ]
    vc_clean = clean_comps_for_pricing(vc.copy())

    print(f"\n--- Data Coverage ---")
    print(f"  Total comps loaded: {len(vc_clean)} (after outlier removal)")
    if 'Parcel Zip' in vc_clean.columns:
        zip_counts = vc_clean['Parcel Zip'].value_counts()
        print(f"  ZIP codes covered: {len(zip_counts)}")
        print(f"  Average comps/ZIP: {zip_counts.mean():.1f}")
        reliable = zip_counts[zip_counts >= 20]
        moderate = zip_counts[(zip_counts >= 10) & (zip_counts < 20)]
        thin = zip_counts[zip_counts < 10]
        print(f"  ZIPs with 20+ comps (reliable): {len(reliable)} -> {', '.join(str(z) for z in reliable.index[:5])}")
        print(f"  ZIPs with 10-19 comps (moderate): {len(moderate)} -> {', '.join(str(z) for z in moderate.index[:5])}")
        print(f"  ZIPs with <10 comps (thin): {len(thin)} -> {', '.join(str(z) for z in thin.index[:10])}")


if __name__ == "__main__":
    analyze_flags(
        "Moore County",
        os.path.join(TEST_DATA, "Moore County Solds.csv"),
        os.path.join(TEST_DATA, "Moore County Targets.csv"),
    )
    analyze_flags(
        "Brunswick County",
        os.path.join(TEST_DATA, "Brunswick Sold NEW TEST.csv"),
        os.path.join(TEST_DATA, "NC_Brunswick_Targets Test Data.csv"),
    )
