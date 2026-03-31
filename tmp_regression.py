import csv
import io
import os
import sys
from collections import Counter

import pandas as pd

ROOT = r"D:/upwork/Land_Parcel"
BACKEND = os.path.join(ROOT, "backend")
sys.path.insert(0, BACKEND)

from services.csv_parser import parse_csv
from services.matching_engine import run_matching
from routers.mailing import (
    _deduplicate,
    _build_csv,
    _build_matched_csv,
    _matched_only,
    OUTPUT_HEADERS,
    MATCHED_EXPORT_HEADERS,
)


TARGET_PATH = r"D:/upwork/Land_Parcel/test-data/Moore County NC Target_837 (1).csv"
SOLDS_PATH = r"D:/upwork/Land_Parcel/test-data/Moore County NC Solds_625.csv"


def non_empty(series: pd.Series) -> pd.Series:
    s = series.fillna("").astype(str).str.strip()
    return (s != "") & (s.str.lower() != "nan") & (s.str.lower() != "none")


def parse_csv_text_bytes(path: str) -> bytes:
    with open(path, "rb") as f:
        return f.read()


def to_rows(csv_bytes: bytes):
    text = csv_bytes.decode("utf-8", errors="replace")
    return list(csv.DictReader(io.StringIO(text)))


def apn_key(v: str) -> str:
    return str(v or "").strip()


def sample_apns(rows, cond, n=3):
    out = []
    for r in rows:
        if cond(r):
            a = apn_key(r.get("APN", ""))
            if a:
                out.append(a)
        if len(out) >= n:
            break
    return out


def print_export_report(name, rows, required_cols):
    headers = list(rows[0].keys()) if rows else required_cols
    missing_cols = [c for c in required_cols if c not in headers]

    empty_county_rows = [r for r in rows if str(r.get("Parcel County", r.get("County", ""))).strip() == ""]
    empty_zip_rows = [r for r in rows if str(r.get("Parcel Zip", r.get("ZIP", ""))).strip() == ""]
    empty_retail_rows = [r for r in rows if str(r.get("Retail Estimate", "")).strip() in ("", "0", "0.00")]
    empty_owner_rows = [r for r in rows if str(r.get("Owner Name", "")).strip() == ""]

    bad_brunswick = 0
    for r in rows:
        county = str(r.get("Parcel County", r.get("County", ""))).strip().lower()
        if county == "brunswick":
            state = str(r.get("Parcel State", r.get("State", ""))).strip().upper()
            if state != "NC":
                bad_brunswick += 1

    print(f"[{name}]")
    print(f"  Total rows: {len(rows)}")
    print(
        f"  Rows with empty County: {len(empty_county_rows)}"
        + (f"  (sample 3 APNs: {sample_apns(empty_county_rows, lambda _: True)})" if empty_county_rows else "")
    )
    print(
        f"  Rows with empty ZIP: {len(empty_zip_rows)}"
        + (f"  (sample 3 APNs: {sample_apns(empty_zip_rows, lambda _: True)})" if empty_zip_rows else "")
    )
    print(f"  Rows with \"Brunswick\" in County (that are NOT Brunswick County parcels): {bad_brunswick}")
    print(f"  Rows with empty Retail Estimate: {len(empty_retail_rows)}")
    print(f"  Rows with empty Owner Name: {len(empty_owner_rows)}")
    print(f"  All required columns present: {'YES' if not missing_cols else 'NO'}" + (f"  (missing: {missing_cols})" if missing_cols else ""))
    print()


def main():
    # Step 1
    target_bytes = parse_csv_text_bytes(TARGET_PATH)
    solds_bytes = parse_csv_text_bytes(SOLDS_PATH)
    target_df, target_stats = parse_csv(target_bytes, is_comps=False)
    solds_df, solds_stats = parse_csv(solds_bytes, is_comps=True)

    print("STEP 1 — Direct CSV Parse Test")
    print("TARGET HEADERS AFTER NORMALIZATION:")
    print(target_df.columns.tolist())
    print("SOLDS HEADERS AFTER NORMALIZATION:")
    print(solds_df.columns.tolist())
    print()

    target_total = len(target_df)
    target_zip_pop = int(non_empty(target_df["Parcel Zip"]).sum()) if "Parcel Zip" in target_df.columns else 0
    target_county_pop = int(non_empty(target_df["Parcel County"]).sum()) if "Parcel County" in target_df.columns else 0
    owner_col = "Owner Name(s)" if "Owner Name(s)" in target_df.columns else ("Owner 1 Full Name" if "Owner 1 Full Name" in target_df.columns else None)
    target_owner_pop = int(non_empty(target_df[owner_col]).sum()) if owner_col else 0

    solds_total = len(solds_df)
    solds_sale_pop = int(((pd.to_numeric(solds_df.get("Current Sale Price", pd.Series(dtype=float)), errors="coerce").notna()) &
                          (pd.to_numeric(solds_df.get("Current Sale Price", pd.Series(dtype=float)), errors="coerce") > 0)).sum())
    lat = pd.to_numeric(solds_df.get("Latitude", pd.Series(dtype=float)), errors="coerce")
    lon = pd.to_numeric(solds_df.get("Longitude", pd.Series(dtype=float)), errors="coerce")
    solds_latlon_pop = int((lat.notna() & lon.notna()).sum())

    print("TARGET FILE")
    print(f"  Total rows: {target_total}")
    print(f"  ZIP populated: {target_zip_pop} | ZIP empty: {target_total - target_zip_pop}")
    print(f"  County populated: {target_county_pop} | County empty: {target_total - target_county_pop}")
    print(f"  Owner name populated: {target_owner_pop} | Owner name empty: {target_total - target_owner_pop}")
    print()
    print("SOLDS FILE")
    print(f"  Total rows: {solds_total}")
    print(f"  Valid sale price: {solds_sale_pop} | Missing: {solds_total - solds_sale_pop}")
    print(f"  Valid lat/long: {solds_latlon_pop} | Missing: {solds_total - solds_latlon_pop}")
    print()

    # Step 2
    match = run_matching(
        comps_df=solds_df,
        targets_df=target_df,
        min_match_score=0,
        exclude_with_buildings=True,
        min_road_frontage=50.0,
        max_retail_price=200000.0,
    )
    results = match["results"]
    flags = Counter([(r.get("pricing_flag") or "N/A") for r in results])
    conf = Counter([(r.get("confidence") or "N/A") for r in results])

    print("STEP 2 — Run Full Match Engine")
    print("MATCH RESULTS")
    print(f"  Total targets processed: {match.get('total_targets', 0)}")
    print(f"  MATCHED: {flags.get('MATCHED', 0)}")
    print(f"  NO COMPS: {flags.get('NO_COMPS', 0)}")
    print(f"  NO MATCH: {flags.get('NO_MATCH', 0)}")
    print(f"  EDGE CASE: {flags.get('EDGE_CASE', 0)}")
    print(f"  HIGH confidence: {conf.get('HIGH', 0)}")
    print(f"  MEDIUM confidence: {conf.get('MEDIUM', 0)}")
    print(f"  LOW confidence: {conf.get('LOW', 0)}")
    print()

    # Step 3 exports
    cleaned, _, _ = _deduplicate(results)
    full_rows = to_rows(_build_csv(cleaned))
    high_rows = to_rows(_build_csv([p for p in cleaned if p.matched_comp_count >= 3 and (p.pricing_flag or "") == "MATCHED"]))
    matched_list = _matched_only(cleaned)
    matched_rows = to_rows(_build_matched_csv(matched_list))
    top500_src = [p for p in cleaned if (p.pricing_flag or "") == "MATCHED"]
    top500_sorted = sorted(
        top500_src,
        key=lambda p: (
            -(1 if getattr(p, "same_street_match", False) else 0),
            (getattr(p, "closest_comp_distance", 999) if getattr(p, "closest_comp_distance", None) is not None else 999),
            -(getattr(p, "match_score", 0) or 0),
        ),
    )[:500]
    top_rows = to_rows(_build_csv(top500_sorted))

    print("STEP 3 — Run All 4 Exports and Inspect Each")
    common_required = [
        "APN", "Parcel Address", "Parcel City", "Parcel State", "Parcel Zip", "Parcel County", "Latitude", "Longitude",
        "Owner Name", "Owner First Name", "Owner Last Name", "Mail Full Address", "Mail City", "Mail State", "Mail Zip",
        "Retail Estimate", "Suggested Offer Low", "Suggested Offer Mid", "Suggested Offer High",
        "Comp Count", "Closest Comp Distance (mi)", "Acreage Band", "Confidence", "Match Score",
    ]
    print_export_report("Matched Leads", matched_rows, MATCHED_EXPORT_HEADERS)
    print_export_report("Top 500", top_rows, common_required)
    print_export_report("High Confidence Only", high_rows, common_required)
    print_export_report("Full List", full_rows, common_required)

    # Step 4 owner split sample
    print("STEP 4 — Owner Name Split Sample")
    print("Full Name Raw           ->  First Name        |  Last Name")
    picks = []
    cats = {"normal": 0, "company": 0, "single": 0, "suffix": 0}
    for r in matched_rows:
        raw = str(r.get("Owner Name", "")).strip()
        fn = str(r.get("Owner First Name", "")).strip()
        ln = str(r.get("Owner Last Name", "")).strip()
        if not raw:
            continue
        raw_u = raw.upper()
        is_company = any(t in raw_u for t in ["LLC", "INC", "TRUST", "ESTATE", "CORP", "LLP", " LP "])
        is_single = (" " not in raw)
        is_suffix = any(raw_u.endswith(" " + s) or raw_u.endswith("." + s) for s in ["JR", "SR", "II", "III"])
        if is_company and cats["company"] < 2:
            picks.append((raw, fn, ln)); cats["company"] += 1; continue
        if is_single and cats["single"] < 1:
            picks.append((raw, fn, ln)); cats["single"] += 1; continue
        if is_suffix and cats["suffix"] < 1:
            picks.append((raw, fn, ln)); cats["suffix"] += 1; continue
        if (not is_company) and (not is_single) and cats["normal"] < 6:
            picks.append((raw, fn, ln)); cats["normal"] += 1
        if len(picks) >= 10:
            break
    if len(picks) < 10:
        seen = {(a, b, c) for a, b, c in picks}
        for r in matched_rows:
            raw = str(r.get("Owner Name", "")).strip()
            fn = str(r.get("Owner First Name", "")).strip()
            ln = str(r.get("Owner Last Name", "")).strip()
            tup = (raw, fn, ln)
            if raw and tup not in seen:
                picks.append(tup)
                seen.add(tup)
            if len(picks) >= 10:
                break
    for raw, fn, ln in picks[:10]:
        print(f"{raw:<24} ->  {fn:<16} |  {ln}")
    print()

    # Step 5 ZIP spot check for Top 500
    print("STEP 5 — ZIP Spot Check")
    top_empty_zip = [r for r in top_rows if str(r.get("Parcel Zip", "")).strip() == ""]
    target_apn_to_zip = {}
    if "APN" in target_df.columns:
        for _, rr in target_df.iterrows():
            target_apn_to_zip[apn_key(rr.get("APN"))] = "" if pd.isna(rr.get("Parcel Zip")) else str(rr.get("Parcel Zip")).strip()
    for r in top_empty_zip[:5]:
        apn = apn_key(r.get("APN", ""))
        src_zip = target_apn_to_zip.get(apn, "")
        print(
            f'APN: {apn} | ZIP in export: "" | ZIP in source CSV: "{src_zip}"'
            + (" <- BUG STILL EXISTS" if src_zip else " <- correctly empty")
        )
    if not top_empty_zip:
        print("No Top 500 rows with empty ZIP found.")


if __name__ == "__main__":
    main()
