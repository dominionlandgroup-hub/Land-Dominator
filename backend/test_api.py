"""
End-to-end API test using the real Brunswick County CSV files.
Run from backend/ directory: python test_api.py
"""
import urllib.request
import json
import time
import os

BASE = "http://localhost:8000"


def multipart_post(url: str, filepath: str) -> dict:
    boundary = b"----LandParcelBoundary"
    with open(filepath, "rb") as f:
        data = f.read()
    fname = os.path.basename(filepath).encode()
    body = (
        b"--" + boundary + b"\r\n"
        b'Content-Disposition: form-data; name="file"; filename="' + fname + b'"\r\n'
        b"Content-Type: text/csv\r\n\r\n"
        + data
        + b"\r\n"
        b"--" + boundary + b"--\r\n"
    )
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary.decode()}"},
    )
    return json.loads(urllib.request.urlopen(req).read())


def post_json(url: str, payload: dict) -> dict:
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        url, data=body, headers={"Content-Type": "application/json"}
    )
    return json.loads(urllib.request.urlopen(req).read())


def get(url: str) -> dict:
    return json.loads(urllib.request.urlopen(url).read())


if __name__ == "__main__":
    solds = os.path.join("..", "Brunswick County NC Solds_.csv")
    targets = os.path.join("..", "Brunswick County NC Target List.csv")

    # 1. Upload comps
    print("1. Uploading comps...")
    t0 = time.time()
    comps_resp = multipart_post(f"{BASE}/upload/comps", solds)
    print(f"   {time.time()-t0:.1f}s | {comps_resp['total_rows']} rows | {comps_resp['valid_rows']} valid | session={comps_resp['session_id'][:8]}")
    session_id = comps_resp["session_id"]

    # 2. Dashboard
    print("2. Dashboard stats...")
    t0 = time.time()
    dash = get(f"{BASE}/dashboard/stats?session_id={session_id}")
    print(f"   {time.time()-t0:.1f}s | {len(dash['zip_stats'])} ZIPs | median_price=${dash['median_price']:,.0f}")
    for z in dash["zip_stats"][:4]:
        print(f"      ZIP {z['zip_code']}: {z['sales_count']} sales | median_ppa=${z['median_price_per_acre']:,.0f}/ac")

    # 3. Upload targets
    print("3. Uploading targets...")
    t0 = time.time()
    tgt_resp = multipart_post(f"{BASE}/upload/targets", targets)
    print(f"   {time.time()-t0:.1f}s | {tgt_resp['total_rows']} rows | session={tgt_resp['session_id'][:8]}")
    target_session_id = tgt_resp["session_id"]

    # 4. Run matching
    print("4. Running matching (min_score=2)...")
    t0 = time.time()
    match_resp = post_json(
        f"{BASE}/match/run",
        {
            "session_id": session_id,
            "target_session_id": target_session_id,
            "radius_miles": 10,
            "acreage_tolerance_pct": 50,
            "min_match_score": 2,
            "zip_filter": [],
        },
    )
    print(f"   {time.time()-t0:.1f}s | matched {match_resp['matched_count']} / {match_resp['total_targets']}")
    match_id = match_resp["match_id"]
    # Score breakdown
    sc = {}
    for r in match_resp["results"]:
        sc[r["match_score"]] = sc.get(r["match_score"], 0) + 1
    print("   Score dist:", dict(sorted(sc.items(), reverse=True)))

    # 5. Mailing preview
    print("5. Mailing list...")
    t0 = time.time()
    mail = get(f"{BASE}/mailing/preview?match_id={match_id}")
    print(f"   {time.time()-t0:.1f}s | before={mail['total_before_dedup']} after={mail['total_after_dedup']} foreign={mail['filtered_foreign']}")
    r0 = mail["results"][0]
    print(f"   Sample: {r0['owner_name']} | {r0['mail_address']}, {r0['mail_city']} {r0['mail_state']}")
    print(f"          APN={r0['apn']} | {r0['lot_acres']}ac | Score {r0['match_score']}/5")
    lo = r0["suggested_offer_low"] or 0
    mid = r0["suggested_offer_mid"] or 0
    hi = r0["suggested_offer_high"] or 0
    print(f"          Offers: ${lo:,.0f} / ${mid:,.0f} / ${hi:,.0f}")

    # 6. Save campaign
    print("6. Saving campaign...")
    camp = post_json(f"{BASE}/campaigns", {"name": "Brunswick Final March 2026", "match_id": match_id})
    print(f"   Saved '{camp['name']}' | id={camp['id'][:8]} | records={camp['stats'].get('mailing_list_count')}")

    # 7. List campaigns
    camps = get(f"{BASE}/campaigns")
    print(f"7. Campaigns list: {len(camps)} campaign(s)")

    print()
    print("=== ALL ENDPOINTS PASSED ===")
