import io
import csv
import os
import re
import sys

import pandas as pd

ROOT = r"D:/upwork/Land_Parcel"
BACKEND = os.path.join(ROOT, "backend")
sys.path.insert(0, BACKEND)

from services.csv_parser import parse_csv
from services.matching_engine import run_matching
from routers.mailing import _deduplicate, _matched_only, _build_matched_csv

TARGET_PATH = r"D:/upwork/Land_Parcel/test-data/Moore County NC Target_837 (1).csv"
SOLDS_PATH = r"D:/upwork/Land_Parcel/test-data/Moore County NC Solds_625.csv"


def main():
    with open(TARGET_PATH, "rb") as f:
        target_df, _ = parse_csv(f.read(), is_comps=False)
    with open(SOLDS_PATH, "rb") as f:
        solds_df, _ = parse_csv(f.read(), is_comps=True)

    match = run_matching(
        comps_df=solds_df,
        targets_df=target_df,
        min_match_score=0,
        exclude_with_buildings=True,
        min_road_frontage=50.0,
        max_retail_price=200000.0,
    )
    cleaned, _, _ = _deduplicate(match["results"])
    matched = _matched_only(cleaned)
    matched_rows = list(csv.DictReader(io.StringIO(_build_matched_csv(matched).decode("utf-8"))))

    target_lookup = {}
    for _, r in target_df.iterrows():
        apn = str(r.get("APN", "")).strip()
        if not apn:
            continue
        target_lookup[apn] = {
            "full": str(r.get("Owner 1 Full Name") if pd.notna(r.get("Owner 1 Full Name")) else "").strip(),
            "corp": str(r.get("Owner 1 Corp Indicator") if pd.notna(r.get("Owner 1 Corp Indicator")) else "").strip(),
        }

    picks = []
    cnt_company = 0
    cnt_person = 0
    cnt_suffix = 0
    for row in matched_rows:
        apn = str(row.get("APN", "")).strip()
        src = target_lookup.get(apn, {"full": "", "corp": ""})
        raw = src["full"]
        corp = src["corp"]
        ef = str(row.get("Owner First Name", "")).strip()
        el = str(row.get("Owner Last Name", "")).strip()
        raw_u = raw.upper()
        is_company = corp.upper() in {"Y", "1", "TRUE", "T", "YES"} or any(t in raw_u for t in ["LLC", "INC", "TRUST", "CORP", "ESTATE", "LLP", " LP "])
        is_suffix = bool(re.search(r"\b(JR|SR|II|III)\b", raw_u))
        if is_company and cnt_company < 2:
            picks.append((raw, corp, ef, el)); cnt_company += 1; continue
        if (not is_company) and cnt_person < 10:
            picks.append((raw, corp, ef, el)); cnt_person += 1
            if is_suffix:
                cnt_suffix += 1
        if len(picks) >= 10:
            break

    if cnt_suffix == 0:
        for row in matched_rows:
            apn = str(row.get("APN", "")).strip()
            src = target_lookup.get(apn, {"full": "", "corp": ""})
            raw = src["full"]
            corp = src["corp"]
            if re.search(r"\b(JR|SR|II|III)\b", raw.upper()):
                ef = str(row.get("Owner First Name", "")).strip()
                el = str(row.get("Owner Last Name", "")).strip()
                if (raw, corp, ef, el) not in picks:
                    picks.append((raw, corp, ef, el))
                break

    picks = picks[:10]
    company_avail = 0
    suffix_avail = 0
    for row in matched_rows:
        apn = str(row.get("APN", "")).strip()
        src = target_lookup.get(apn, {"full": "", "corp": ""})
        raw = src["full"]
        corp = src["corp"].upper().strip()
        if corp in {"Y", "1", "TRUE", "T", "YES"} or re.search(r"\b(LLC|INC|TRUST|CORP|ESTATE|LLP|LP)\b", raw.upper()):
            company_avail += 1
        if re.search(r"\b(JR|SR|II|III)\b", raw.upper()):
            suffix_avail += 1

    if suffix_avail > 0 and not any(re.search(r"\b(JR|SR|II|III)\b", raw.upper()) for raw, _, _, _ in picks):
        for row in matched_rows:
            apn = str(row.get("APN", "")).strip()
            src = target_lookup.get(apn, {"full": "", "corp": ""})
            raw = src["full"]
            corp = src["corp"]
            if re.search(r"\b(JR|SR|II|III)\b", raw.upper()):
                ef = str(row.get("Owner First Name", "")).strip()
                el = str(row.get("Owner Last Name", "")).strip()
                picks[-1] = (raw, corp, ef, el)
                break

    print(f"Matched rows analyzed: {len(matched_rows)}")
    print(f"Company-name rows available in matched leads: {company_avail}")
    print(f"Suffix-name rows available in matched leads: {suffix_avail}")
    print("Owner 1 Full Name (raw)     | Corp Ind | First Name exported  | Last Name exported")
    for raw, corp, ef, el in picks:
        print(f"{raw[:28]:<28} | {corp[:8]:<8} | {ef[:20]:<20} | {el}")


if __name__ == "__main__":
    main()
