"""
Mailing list: deduplication, preview, and CSV download.
Priority 6: three download tiers — full, high-confidence (3+ comps), top-500.
"""
import io
import csv
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from typing import Literal

from models.schemas import MailingPreviewResponse, MatchedParcel
from storage.session_store import get_match

router = APIRouter(prefix="/mailing", tags=["mailing"])

FOREIGN_STATES = {"AE", "AP", "AS"}

OUTPUT_HEADERS = [
    # PROPERTY
    "APN",
    "Parcel Address",
    "Parcel City",
    "Parcel State",
    "Parcel Zip",
    "Parcel County",
    "Latitude",
    "Longitude",
    # OWNER
    "Owner Name",
    "Mail Full Address",
    "Mail City",
    "Mail State",
    "Mail Zip",
    # PRICING
    "Retail Estimate",
    "Suggested Offer Low",
    "Suggested Offer Mid",
    "Suggested Offer High",
    # MATCH DATA
    "Comp Count",
    "Clean Comp Count",
    "Closest Comp Distance (mi)",
    "Acreage Band",
    "Same Street Match",
    # ADDITIONAL
    "Lot Acres",
    "Match Score",
    "Outliers Removed",
    "Confidence",
    "Median Comp Sale Price",
    "Median PPA",
    "Min Comp Price",
    "Max Comp Price",
    "TLP Estimate",
    "Pricing Flag",
    "Comp Avg Age Days",
    "Premium ZIP",
    "Flood Zone",
    "Buildability %",
    "Road Frontage",
    "Possible Issue",
    "Nano Warning",
]


@router.get("/preview", response_model=MailingPreviewResponse)
async def preview_mailing(
    match_id: str = Query(..., description="Match ID from /match/run"),
) -> MailingPreviewResponse:
    """
    Return deduplicated mailing list preview for a given match run.
    """
    match_data = get_match(match_id)
    if match_data is None:
        raise HTTPException(
            status_code=404,
            detail="Match result not found. Please re-run the matching engine.",
        )

    raw_results = match_data["results"]
    total_before = len(raw_results)

    cleaned, n_foreign, n_dnm = _deduplicate(raw_results)

    return MailingPreviewResponse(
        match_id=match_id,
        total_before_dedup=total_before,
        total_after_dedup=len(cleaned),
        filtered_foreign=n_foreign,
        filtered_do_not_mail=n_dnm,
        results=cleaned,
    )


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

    if export_type == "high-confidence":
        filtered = [
            p for p in cleaned
            if p.matched_comp_count >= 3
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
        filtered = cleaned
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
                mail_address=row.get("mail_address", ""),
                mail_city=row.get("mail_city", ""),
                mail_state=row.get("mail_state", ""),
                mail_zip=row.get("mail_zip", ""),
                parcel_zip=row.get("parcel_zip", ""),
                parcel_city=row.get("parcel_city", ""),
                parcel_address=row.get("parcel_address", ""),
                parcel_state=row.get("parcel_state", "NC"),  # Default to NC for Brunswick County
                parcel_county=row.get("parcel_county", "Brunswick"),  # Default
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
            )
        )

    return parcels, n_foreign, n_dnm


def _build_csv(parcels: list[MatchedParcel]) -> bytes:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(OUTPUT_HEADERS)

    for p in parcels:
        writer.writerow(
            [
                # PROPERTY
                p.apn,
                p.parcel_address or "",
                p.parcel_city or "",
                p.parcel_state or "NC",
                p.parcel_zip or "",
                p.parcel_county or "Brunswick",
                p.latitude if p.latitude is not None else "",
                p.longitude if p.longitude is not None else "",
                # OWNER
                p.owner_name,
                p.mail_address,
                p.mail_city,
                p.mail_state,
                p.mail_zip,
                # PRICING
                _fmt_currency(p.retail_estimate),
                _fmt_currency(p.suggested_offer_low),
                _fmt_currency(p.suggested_offer_mid),
                _fmt_currency(p.suggested_offer_high),
                # MATCH DATA
                p.comp_count,
                p.clean_comp_count,
                f"{p.closest_comp_distance:.2f}" if p.closest_comp_distance is not None else "",
                p.acreage_band or "",
                "Yes" if p.same_street_match else "No",
                # ADDITIONAL
                p.lot_acres if p.lot_acres is not None else "",
                p.match_score,
                p.outliers_removed,
                p.confidence,
                _fmt_currency(p.median_comp_sale_price),
                _fmt_currency(p.median_ppa),
                _fmt_currency(p.min_comp_price),
                _fmt_currency(p.max_comp_price),
                _fmt_currency(p.tlp_estimate),
                p.pricing_flag or "",
                p.comp_avg_age_days if p.comp_avg_age_days is not None else "",
                "Yes" if p.premium_zip else "No",
                p.flood_zone or "",
                p.buildability_pct if p.buildability_pct is not None else "",
                p.road_frontage if p.road_frontage is not None else "",
                p.possible_issue or "",
                "Yes" if p.nano_buildability_warning else "",
            ]
        )

    return buf.getvalue().encode("utf-8")


def _fmt_currency(val: float | None) -> str:
    if val is None:
        return ""
    return f"{val:.2f}"
