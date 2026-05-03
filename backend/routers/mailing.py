"""
Mailing list: deduplication, preview, and CSV download.
Priority 6: three download tiers — full, high-confidence (3+ comps), top-500.
"""
import io
import csv
import json
import math
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse, Response
from typing import Literal

from models.schemas import MailingPreviewResponse, MatchedParcel
from storage.session_store import get_match

router = APIRouter(prefix="/mailing", tags=["mailing"])

FOREIGN_STATES = {"AE", "AP", "AS"}

OUTPUT_HEADERS = [
    "Owner Full Name",
    "Owner First Name",
    "Owner Last Name",
    "Mailing Address",
    "Mailing City",
    "Mailing State",
    "Mailing Zip",
    "Property Address",
    "Property City",
    "Property State",
    "Property Zip",
    "APN",
    "County",
    "FIPS",
    "Acreage",
    "Campaign Code",
    "Offer Price",
    "Status",
]


def _looks_like_lp_name_simple(s: str) -> bool:
    """True if string looks like LP all-caps 'LAST FIRST' format (no institutional check needed here)."""
    stripped = s.replace("&", "").strip()
    if not stripped or len(stripped) <= 3 or stripped != stripped.upper() or " " not in stripped:
        return False
    first_word = stripped.split()[0].upper()
    # Skip institutional prefixes
    institutional = {"LLC", "INC", "CORP", "LTD", "LP", "LLP", "TRUST", "ESTATE",
                     "COUNTY", "CITY", "STATE", "TOWN", "VILLAGE", "TOWNSHIP"}
    last_word = stripped.split()[-1].upper().rstrip(".,;")
    if first_word in institutional or last_word in institutional or " OF " in s.upper():
        return False
    return True


def _reformat_lp_name_simple(raw: str) -> str:
    """Convert 'FOSTER DAVID A & SMITH MARY B' → 'David A Foster & Mary B Smith'."""
    import re as _re
    owners = _re.split(r"\s*&\s*", raw)
    formatted = []
    for owner in owners:
        words = owner.strip().split()
        if len(words) >= 2:
            last = words[0].capitalize()
            rest = [w.capitalize() for w in words[1:]]
            formatted.append(" ".join(rest + [last]))
        elif words:
            formatted.append(words[0].title())
    return " & ".join(formatted)


# Cache for pre-serialized mailing preview JSON (avoids reprocessing 14K+ records)
_preview_cache: dict[str, str] = {}


@router.get("/preview")
async def preview_mailing(
    match_id: str = Query(..., description="Match ID from /match/run"),
) -> Response:
    """
    Return deduplicated mailing list preview for a given match run.
    Uses pre-serialized JSON + caching to avoid timeout on large datasets.
    """
    # Return cached result if available (second call is instant)
    if match_id in _preview_cache:
        return Response(content=_preview_cache[match_id], media_type="application/json")

    match_data = get_match(match_id)
    if match_data is None:
        raise HTTPException(
            status_code=404,
            detail="Match result not found. Please re-run the matching engine.",
        )

    raw_results = match_data["results"]
    total_before = len(raw_results)

    cleaned, n_foreign, n_dnm = _deduplicate(raw_results)

    # Serialize manually to avoid Pydantic validation overhead on 14K+ records
    results_dicts = []
    for p in cleaned:
        results_dicts.append(p.model_dump() if hasattr(p, 'model_dump') else p.dict())

    def _clean_nans(obj):
        if isinstance(obj, dict):
            return {k: _clean_nans(v) for k, v in obj.items()}
        if isinstance(obj, list):
            return [_clean_nans(v) for v in obj]
        if isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
            return None
        return obj

    payload = _clean_nans({
        "match_id": match_id,
        "total_before_dedup": total_before,
        "total_after_dedup": len(cleaned),
        "filtered_foreign": n_foreign,
        "filtered_do_not_mail": n_dnm,
        "results": results_dicts,
    })

    content = json.dumps(payload, default=str)
    _preview_cache[match_id] = content  # Cache for instant retry
    return Response(content=content, media_type="application/json")


@router.get("/download")
async def download_mailing(
    match_id: str = Query(..., description="Match ID from /match/run"),
    campaign_name: str = Query("mailing_list", description="File name prefix"),
    export_type: str = Query("full", description="Export type: full | high-confidence | top500"),
) -> StreamingResponse:
    """
    Stream a deduplicated, mail-ready CSV.
    export_type: 'full' | 'high-confidence' (3+ comps) | 'top500' (top 500 by score)
    """
    match_data = get_match(match_id)
    if match_data is None:
        raise HTTPException(
            status_code=404,
            detail="Match result not found. Please re-run the matching engine.",
        )

    raw_results = match_data["results"]
    cleaned, _, _ = _deduplicate(raw_results)

    # Apply export type filter
    # Note: With simplified flags (MATCHED/NO_COMPS only), these legacy flag sets are mostly empty
    HIGH_CONF_EXCLUDED_FLAGS = {'NO_COMPS'}
    FLAGGED_REVIEW_FLAGS = set()  # No longer used - simplified per Damien's request
    FLAGGED_SUSPECT_FLAGS = set()  # No longer used - simplified per Damien's request

    if export_type == "mailable":
        # Mailable = MATCHED only (LP_FALLBACK is reference-only, not recommended for mailing)
        filtered = [p for p in cleaned if getattr(p, 'pricing_flag', None) == 'MATCHED']
        suffix = f"comp-matched-{len(filtered)}-records"
    elif export_type == "matched":
        filtered = [p for p in cleaned if getattr(p, 'pricing_flag', None) == 'MATCHED']
        suffix = f"matched-{len(filtered)}-records"
    elif export_type == "high-confidence":
        filtered = [
            p for p in cleaned
            if p.comp_count >= 3
            and getattr(p, 'pricing_flag', None) == 'MATCHED'
        ]
        suffix = f"high-confidence-{len(filtered)}-records"
    elif export_type == "flagged-for-review":
        # No longer used - return empty
        filtered = []
        suffix = f"flagged-for-review-0-records"
    elif export_type == "suspect-comps":
        # No longer used - return empty
        filtered = []
        suffix = f"suspect-comps-0-records"
    elif export_type == "top500":
        # Damien's Top 500 requirements (Point 10):
        # - MATCHED properties only (no flags, no suspect comps)
        # - Sort by: 1) Same street matches, 2) Closest distance, 3) Best acreage match
        matched_only = [p for p in cleaned if getattr(p, 'pricing_flag', None) == 'MATCHED']
        
        # Sort: same_street_match DESC, closest_comp_distance ASC, match_score DESC
        def top500_sort_key(p):
            same_street = 1 if getattr(p, 'same_street_match', False) else 0
            distance = getattr(p, 'closest_comp_distance', 999) or 999
            score = getattr(p, 'match_score', 0) or 0
            return (-same_street, distance, -score)  # negative for DESC
        
        filtered = sorted(matched_only, key=top500_sort_key)[:500]
        suffix = f"top500-records"
    else:
        filtered = list (cleaned)
        suffix = f"{len(filtered)}-records"

    csv_bytes = _build_csv(filtered)

    safe_name = "".join(
        c if c.isalnum() or c in ("-", "_") else "-" for c in campaign_name.lower()
    ).strip("-")

    filename = f"{safe_name}-{suffix}.csv"

    return StreamingResponse(
        io.BytesIO(csv_bytes),
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"'
        },
    )


# ─────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────

def _confidence_label(comp_count: int) -> str:
    """HIGH (5+), MEDIUM (3-4), LOW (1-2), EST (0 = ZIP fallback)."""
    if comp_count >= 5:
        return "HIGH"
    if comp_count >= 3:
        return "MEDIUM"
    if comp_count >= 1:
        return "LOW"
    return "EST"


def _deduplicate(
    results: list,
) -> tuple[list[MatchedParcel], int, int]:
    """
    Apply deduplication rules:
      1. Filter foreign mail states
      2. Deduplicate by Owner + Mail Address
      3. Deduplicate by APN
    Returns (cleaned_list, n_foreign_removed, n_dnm_removed).
    """
    n_foreign = 0
    cleaned = []

    for row in results:
        state = (row.get("mail_state") or "").strip().upper()
        if state in FOREIGN_STATES:
            n_foreign += 1
            continue
        cleaned.append(row)

    n_dnm = 0  # already filtered during matching

    # Dedup by owner + mail address
    seen_owner_addr: set[str] = set()
    deduped: list = []
    for row in cleaned:
        key = (
            (row.get("owner_name") or "").strip().lower()
            + "|"
            + (row.get("mail_address") or "").strip().lower()
        )
        if key in seen_owner_addr:
            continue
        seen_owner_addr.add(key)
        deduped.append(row)

    # Dedup by APN
    seen_apn: set[str] = set()
    final: list = []
    for row in deduped:
        apn = (row.get("apn") or "").strip()
        if apn and apn in seen_apn:
            continue
        if apn:
            seen_apn.add(apn)
        final.append(row)

    # Convert dicts to MatchedParcel objects
    parcels: list[MatchedParcel] = []
    for row in final:
        parcels.append(
            MatchedParcel(
                apn=row.get("apn", ""),
                owner_name=row.get("owner_name", ""),
                owner_first_name=row.get("owner_first_name", ""),
                owner_last_name=row.get("owner_last_name", ""),
                mail_address=row.get("mail_address", ""),
                mail_city=row.get("mail_city", ""),
                mail_state=row.get("mail_state", ""),
                mail_zip=row.get("mail_zip", ""),
                parcel_zip=row.get("parcel_zip", ""),
                parcel_city=row.get("parcel_city", ""),
                parcel_address=row.get("parcel_address", ""),
                parcel_state=row.get("parcel_state", ""),
                parcel_county=row.get("parcel_county", ""),
                lot_acres=row.get("lot_acres"),
                match_score=row.get("match_score", 0),
                matched_comp_count=row.get("matched_comp_count", 0),
                suggested_offer_low=row.get("suggested_offer_low"),
                suggested_offer_mid=row.get("suggested_offer_mid"),
                suggested_offer_high=row.get("suggested_offer_high"),
                retail_estimate=row.get("retail_estimate"),
                comp_count=row.get("comp_count", 0),
                clean_comp_count=row.get("clean_comp_count", 0),
                outliers_removed=row.get("outliers_removed", 0),
                median_comp_sale_price=row.get("median_comp_sale_price"),
                median_ppa=row.get("median_ppa"),
                min_comp_price=row.get("min_comp_price"),
                max_comp_price=row.get("max_comp_price"),
                acreage_band=row.get("acreage_band"),
                confidence=row.get("confidence", "NO DATA"),
                tlp_estimate=row.get("tlp_estimate"),
                tlp_capped=row.get("tlp_capped", False),
                flood_zone=row.get("flood_zone"),
                buildability_pct=row.get("buildability_pct"),
                latitude=row.get("latitude"),
                longitude=row.get("longitude"),
                pricing_flag=row.get("pricing_flag"),
                no_match_reason=row.get("no_match_reason"),
                cross_county_match=row.get("cross_county_match", False),
                comp_avg_age_days=row.get("comp_avg_age_days"),
                comp_oldest_days=row.get("comp_oldest_days"),
                comp_age_warning=row.get("comp_age_warning", False),
                premium_zip=row.get("premium_zip", False),
                nano_buildability_warning=row.get("nano_buildability_warning", False),
                nano_buildability_pct=row.get("nano_buildability_pct"),
                same_street_match=row.get("same_street_match", False),
                closest_comp_distance=row.get("closest_comp_distance"),
                road_frontage=row.get("road_frontage"),
                possible_issue=row.get("possible_issue"),
                comp_1_apn=row.get("comp_1_apn"),
                comp_1_address=row.get("comp_1_address"),
                comp_1_price=row.get("comp_1_price"),
                comp_1_acres=row.get("comp_1_acres"),
                comp_1_date=row.get("comp_1_date"),
                comp_1_distance=row.get("comp_1_distance"),
                comp_1_ppa=row.get("comp_1_ppa"),
                comp_1_same_street=row.get("comp_1_same_street", False),
                comp_2_apn=row.get("comp_2_apn"),
                comp_2_address=row.get("comp_2_address"),
                comp_2_price=row.get("comp_2_price"),
                comp_2_acres=row.get("comp_2_acres"),
                comp_2_date=row.get("comp_2_date"),
                comp_2_distance=row.get("comp_2_distance"),
                comp_2_ppa=row.get("comp_2_ppa"),
                comp_3_apn=row.get("comp_3_apn"),
                comp_3_address=row.get("comp_3_address"),
                comp_3_price=row.get("comp_3_price"),
                comp_3_acres=row.get("comp_3_acres"),
                comp_3_date=row.get("comp_3_date"),
                comp_3_distance=row.get("comp_3_distance"),
                comp_3_ppa=row.get("comp_3_ppa"),
                num_comps_used=row.get("num_comps_used", 0),
                pricing_method=row.get("pricing_method"),
                comp_quality_flags=row.get("comp_quality_flags"),
                pricing_sanity_flag=row.get("pricing_sanity_flag"),
                fips=row.get("fips"),
            )
        )

    return parcels, n_foreign, n_dnm


def _build_csv(parcels: list[MatchedParcel]) -> bytes:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(OUTPUT_HEADERS)

    for p in parcels:
        # Apply LP name format fix on export
        owner_name = p.owner_name or ""
        if owner_name and _looks_like_lp_name_simple(owner_name):
            owner_name = _reformat_lp_name_simple(owner_name)
        first = p.owner_first_name or ""
        last = p.owner_last_name or ""

        writer.writerow([
            owner_name,
            first,
            last,
            p.mail_address or "",
            p.mail_city or "",
            p.mail_state or "",
            p.mail_zip or "",
            p.parcel_address or "",
            p.parcel_city or "",
            p.parcel_state or "",
            p.parcel_zip or "",
            p.apn or "",
            p.parcel_county or "",
            p.fips or "",
            f"{p.lot_acres:.2f}" if p.lot_acres is not None else "",
            "",  # Campaign Code — not available in match result context
            _fmt_currency(p.suggested_offer_mid),
            "",  # Status — lead by default
        ])

    return buf.getvalue().encode("utf-8")


def _fmt_currency(val: float | None) -> str:
    if val is None:
        return ""
    return f"{val:.2f}"
