import os
import csv
import io
from collections import Counter
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, "D:/upwork/Land_Parcel/backend")

from backend.services.csv_parser import parse_csv
from backend.services.matching_engine import (
    run_matching,
    clean_comps_for_pricing,
    get_acreage_band,
    _haversine_matrix,
)
from backend.routers import mailing as mailing_router


BASE = "D:/upwork/Land_Parcel/test-data/"


def load_csv(path: str, is_comps: bool):
    with open(path, "rb") as f:
        data = f.read()
    return parse_csv(data, is_comps=is_comps)


def detect_format(cols):
    cset = set(cols)
    if "_file_format" in cset:
        return "mls_or_normalized"
    if "Current Sale Price" in cset:
        return "land_portal"
    if "ClosePrice" in cset or "Close Price" in cset:
        return "mls"
    return "unknown"


def handoff_prints(comps_df: pd.DataFrame):
    print("=== COMP DATAFRAME ENTERING MATCHING ENGINE ===")
    print("Shape:", comps_df.shape)
    print("Columns:", list(comps_df.columns))
    print("'Current Sale Price' present:", "Current Sale Price" in comps_df.columns)
    if "Current Sale Price" in comps_df.columns:
        print("Valid sale prices:", comps_df["Current Sale Price"].notna().sum())
        print("Sample prices:", comps_df["Current Sale Price"].dropna().head(5).tolist())
    else:
        print("CRITICAL: 'Current Sale Price' column is MISSING from comp DataFrame")
        print(
            "Available price-like columns:",
            [c for c in comps_df.columns if "price" in c.lower() or "sale" in c.lower()],
        )
    print("Lat/lon present:", "Latitude" in comps_df.columns and "Longitude" in comps_df.columns)
    if "Latitude" in comps_df.columns:
        print("Valid lat/lon rows:", comps_df["Latitude"].notna().sum())


def run_one_test(name: str, solds_name: str, target_name: str):
    solds_path = BASE + solds_name
    target_path = BASE + target_name
    comps_raw, comps_stats = load_csv(solds_path, is_comps=True)
    targets_df, targets_stats = load_csv(target_path, is_comps=False)

    file_format = detect_format(comps_raw.columns)
    if "_file_format" in comps_raw.columns:
        vals = [str(v).upper() for v in comps_raw["_file_format"].dropna().unique().tolist()]
        if "MLS" in vals:
            file_format = "mls"
        elif vals:
            file_format = "land_portal"
    comps_clean = clean_comps_for_pricing(comps_raw.copy())

    result = run_matching(
        comps_df=comps_raw,
        targets_df=targets_df,
        radius_miles=1.0,
        acreage_tolerance_pct=50.0,
        min_match_score=0,
        zip_filter=None,
        min_acreage=None,
        max_acreage=None,
        exclude_flood=False,
        only_flood=False,
        min_buildability=None,
        vacant_only=False,
        require_road_frontage=False,
        exclude_land_locked=False,
        require_tlp_estimate=False,
        price_ceiling=None,
        exclude_with_buildings=True,
        min_road_frontage=50.0,
        max_retail_price=200000.0,
    )

    rows = result["results"]
    total = len(rows)
    matched = [r for r in rows if r.get("pricing_flag") == "MATCHED"]
    no_comps = [r for r in rows if r.get("pricing_flag") == "NO_COMPS"]

    # status counters requested
    status_counts = {"MATCHED": 0, "NO_COMPS": 0, "EDGE_CASE": 0}
    score_counts = Counter()
    matched_but_zero = 0
    for r in rows:
        pf = r.get("pricing_flag")
        if pf == "MATCHED":
            status_counts["MATCHED"] += 1
        elif pf == "NO_COMPS":
            status_counts["NO_COMPS"] += 1
        else:
            status_counts["EDGE_CASE"] += 1
        score_counts[int(r.get("match_score") or 0)] += 1
        if pf == "MATCHED" and (r.get("retail_estimate") in (None, 0)):
            matched_but_zero += 1

    # target-level diagnostics for first 3 targets
    print(f"\n=== TEST {name} ===")
    print(
        f"Solds file: {solds_name} | Rows: {comps_stats['total_rows']} | Valid comps: {len(comps_clean)} | Format: {file_format}"
    )
    print(f"Targets file: {target_name} | Rows: {targets_stats['total_rows']}")

    # comp matrix prep for first-3 debug
    comp_lats = pd.to_numeric(comps_clean["Latitude"], errors="coerce").to_numpy(dtype=float)
    comp_lons = pd.to_numeric(comps_clean["Longitude"], errors="coerce").to_numpy(dtype=float)
    comp_acres = pd.to_numeric(comps_clean["Lot Acres"], errors="coerce").to_numpy(dtype=float)
    t_lats = pd.to_numeric(targets_df["Latitude"], errors="coerce").to_numpy(dtype=float)
    t_lons = pd.to_numeric(targets_df["Longitude"], errors="coerce").to_numpy(dtype=float)
    t_acres = pd.to_numeric(targets_df["Lot Acres"], errors="coerce").to_numpy(dtype=float)

    apn_to_result = {str(r.get("apn")): r for r in rows}
    shown = 0
    for i in range(len(targets_df)):
        if shown >= 3:
            break
        apn = str(targets_df.iloc[i].get("APN", "")).strip()
        lat, lon, acres = t_lats[i], t_lons[i], t_acres[i]
        if np.isnan(lat) or np.isnan(lon):
            continue
        bl, bh, band = get_acreage_band(float(acres)) if not np.isnan(acres) and acres > 0 else (0.0, 99999.0, "unknown")
        band_mask = (comp_acres >= bl) & (comp_acres < bh)
        dists = _haversine_matrix(np.array([lat]), np.array([lon]), comp_lats, comp_lons)[0]
        within_025 = int(np.sum(band_mask & (dists <= 0.25)))
        within_050 = int(np.sum(band_mask & (dists <= 0.50)))
        within_100 = int(np.sum(band_mask & (dists <= 1.00)))
        res = apn_to_result.get(apn, {})
        status = "MATCHED" if res.get("pricing_flag") == "MATCHED" else "NO_COMPS" if res.get("pricing_flag") == "NO_COMPS" else "EDGE_CASE"
        print(f"\n=== TARGET {apn} ===")
        print(f"  Acreage: {None if np.isnan(acres) else float(acres)} | Band: {band}")
        print(f"  Lat: {None if np.isnan(lat) else float(lat)} | Lon: {None if np.isnan(lon) else float(lon)}")
        print(f"  Comps in same band: {int(band_mask.sum())}")
        print(f"  Comps within 0.25mi: {within_025}")
        print(f"  Comps within 0.50mi: {within_050}")
        print(f"  Comps within 1.00mi: {within_100}")
        print(f"  Comps selected: {int(res.get('matched_comp_count') or 0)}")
        print(f"  Status assigned: {status}")
        print(f"  Retail estimate: {res.get('retail_estimate')}")
        print(f"  Score: {int(res.get('match_score') or 0)}")
        shown += 1

    print("\nMATCH RESULTS:")
    print(f"  MATCHED: {len(matched)} ({(len(matched) / total * 100 if total else 0):.2f}%)")
    print(f"  NO_COMPS: {len(no_comps)} ({(len(no_comps) / total * 100 if total else 0):.2f}%)")
    print(f"  Total: {total}")

    print("\nSCORE DISTRIBUTION:")
    for s in [5, 4, 3, 2, 1, 0]:
        print(f"  Score {s}: {score_counts.get(s, 0)}")

    print("\nPRICING SANITY CHECK:")
    print(f"  MATCHED records with retail_estimate = 0 or None: {matched_but_zero}")
    print(f"  MATCHED records with valid retail_estimate: {len(matched) - matched_but_zero}")

    print("  Sample 3 MATCHED records:")
    for r in matched[:3]:
        print(
            f"    {r.get('apn')} | {r.get('lot_acres')} | {r.get('acreage_band')} | "
            f"{r.get('retail_estimate')} | {r.get('suggested_offer_mid')} | "
            f"{r.get('comp_count')} | {r.get('closest_comp_distance')} | "
            f"{r.get('match_score')} | {r.get('confidence')}"
        )

    print("  Sample 3 NO_COMPS records:")
    for r in no_comps[:3]:
        status = "NO_COMPS" if r.get("pricing_flag") == "NO_COMPS" else r.get("pricing_flag")
        print(f"    {r.get('apn')} | Status={status} | Retail={r.get('retail_estimate')} | Score={r.get('match_score')}")

    pass_match_rate = 0 < (len(matched) / total if total else 0) < 1
    pass_matched_prices = matched_but_zero == 0
    pass_nocomps_none = all(r.get("retail_estimate") is None for r in no_comps)
    pass_score_varies = len([k for k, v in score_counts.items() if v > 0]) > 1
    pass_no_crash = True

    print("\nPASS/FAIL:")
    print(f"  Match rate realistic (not 0% or 100%): {'PASS' if pass_match_rate else 'FAIL'}")
    print(f"  All MATCHED have retail > 0: {'PASS' if pass_matched_prices else 'FAIL'}")
    print(f"  All NO_COMPS have retail = None: {'PASS' if pass_nocomps_none else 'FAIL'}")
    print(f"  Score distribution varies: {'PASS' if pass_score_varies else 'FAIL'}")
    print(f"  No crashes: {'PASS' if pass_no_crash else 'FAIL'}")

    print("\n=== FINAL STATUS COUNTS ===")
    print(status_counts)
    print("Any MATCHED with retail=0 or None:", matched_but_zero)

    return result, rows, matched


if __name__ == "__main__":
    print("STEP 5 — Normalization/Handoff Call Chain")
    print("upload endpoint -> parse_csv() -> session store -> run_matching()")
    print("Handoff verification done below from parse_csv output into run_matching input.")

    # Step 2 diagnostic run on the bug combo
    bug_solds = "Brunswick Sold NEW TEST.csv"
    bug_targets = "NC_Brunswick_Targets Test Data.csv"
    comps_bug_df, _ = load_csv(BASE + bug_solds, is_comps=True)
    handoff_prints(comps_bug_df)
    print("Normalization post-check:",
          "Current Sale Price" in comps_bug_df.columns,
          "Latitude" in comps_bug_df.columns,
          "Longitude" in comps_bug_df.columns,
          "Lot Acres" in comps_bug_df.columns)

    run_one_test("DIAGNOSTIC (bug combo)", bug_solds, bug_targets)

    # Step 6 regression tests
    test_a_result, test_a_rows, test_a_matched = run_one_test(
        "A — Brunswick County baseline",
        "Brunswick Sold NEW TEST.csv",
        "NC_Brunswick_Targets Test Data.csv",
    )
    run_one_test(
        "B — Moore County",
        "Moore County NC Solds_625.csv",
        "Moore County NC Target_837 (1).csv",
    )
    run_one_test(
        "C — MLS solds + Land Portal targets",
        "NC SOLD MLS 30-.csv",
        "NC Target Master.csv",
    )

    # Step 7 export verification based on Test A
    cleaned, _, _ = mailing_router._deduplicate(test_a_rows)
    matched_leads = [
        p for p in cleaned
        if getattr(p, "pricing_flag", None) == "MATCHED" and p.retail_estimate is not None
    ]
    csv_bytes = mailing_router._build_csv(matched_leads)
    out_path = "D:/upwork/Land_Parcel/matched_leads_output.csv"
    with open(out_path, "wb") as f:
        f.write(csv_bytes)

    print("\nSTEP 7 — Export Verification")
    df = pd.read_csv(out_path)
    print("Columns:", list(df.columns))
    print("Total rows:", len(df))
    print("Rows with empty Retail Est.:", df["Retail Est."].isna().sum())
    print("Rows with Retail Est. = 0:", (df["Retail Est."] == 0).sum())
    print("Min Retail Est.:", df["Retail Est."].min())
    print("Max Retail Est.:", df["Retail Est."].max())
    print("Sample 3 rows:")
    print(
        df[
            [
                "APN",
                "Parcel County",
                "Parcel ZIP",
                "Retail Est.",
                "Offer Mid",
                "Comp Count",
                "Distance to Closest Comp",
                "Confidence",
            ]
        ]
        .head(3)
        .to_string(index=False)
    )
