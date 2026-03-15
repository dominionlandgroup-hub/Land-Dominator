"""
Pydantic schemas for request/response validation.
"""
from pydantic import BaseModel
from typing import Optional, List, Dict, Any


class UploadResponse(BaseModel):
    session_id: str
    total_rows: int
    valid_rows: int
    columns_found: List[str]
    missing_columns: List[str]
    preview: List[Dict[str, Any]]


class ZipStats(BaseModel):
    zip_code: str
    sales_count: int
    min_lot_size: Optional[float] = None
    max_lot_size: Optional[float] = None
    median_lot_size: Optional[float] = None
    min_sale_price: Optional[float] = None
    max_sale_price: Optional[float] = None
    avg_price_per_acre: Optional[float] = None
    median_price_per_acre: Optional[float] = None
    price_band_lt50k: int = 0
    price_band_50k_100k: int = 0
    price_band_100k_250k: int = 0
    price_band_gt250k: int = 0
    acreage_band_0_1: int = 0
    acreage_band_1_5: int = 0
    acreage_band_5_10: int = 0
    acreage_band_gt10: int = 0


class CompLocation(BaseModel):
    lat: float
    lng: float
    sale_price: float
    lot_acres: float
    price_per_acre: float
    zip: str
    apn: str
    sale_date: Optional[str] = None


class SweetSpot(BaseModel):
    bucket: str
    count: int
    total_sales: int
    expected_offer_low: float
    expected_offer_high: float

class DashboardResponse(BaseModel):
    zip_stats: List[ZipStats]
    total_comps: int
    valid_comps: int
    median_price: Optional[float] = None
    median_acreage: Optional[float] = None
    median_price_per_acre: Optional[float] = None
    available_zips: List[str]
    comp_locations: List[CompLocation] = []
    insight: str = ""
    sweet_spot: Optional[SweetSpot] = None


class MatchFilters(BaseModel):
    session_id: str
    target_session_id: str
    radius_miles: float = 10.0
    acreage_tolerance_pct: float = 50.0
    min_match_score: int = 0
    zip_filter: Optional[List[str]] = None
    # Smart filters
    flood_zone_filter: Optional[str] = None  # all | exclude | only
    min_acreage: Optional[float] = None
    max_acreage: Optional[float] = None
    exclude_flood: bool = False
    only_flood: bool = False
    min_buildability: Optional[float] = None
    vacant_only: bool = False
    require_road_frontage: bool = False
    exclude_landlocked: bool = False
    exclude_land_locked: bool = False
    require_tlp: bool = False
    require_tlp_estimate: bool = False
    price_ceiling: Optional[float] = None


class MatchedParcel(BaseModel):
    apn: str
    owner_name: str
    mail_address: str
    mail_city: str
    mail_state: str
    mail_zip: str
    parcel_zip: str
    parcel_city: str
    lot_acres: Optional[float] = None
    match_score: int
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    matched_comp_count: int
    suggested_offer_low: Optional[float] = None
    suggested_offer_mid: Optional[float] = None
    suggested_offer_high: Optional[float] = None
    tlp_estimate: Optional[float] = None
    flood_zone: Optional[str] = None
    buildability_pct: Optional[float] = None


class MatchResponse(BaseModel):
    match_id: str
    total_targets: int
    matched_count: int
    results: List[MatchedParcel]
    warnings: List[str] = []


class MailingPreviewResponse(BaseModel):
    match_id: str
    total_before_dedup: int
    total_after_dedup: int
    filtered_foreign: int
    filtered_do_not_mail: int
    results: List[MatchedParcel]


class CampaignCreate(BaseModel):
    name: str
    match_id: str
    filters: Optional[Dict[str, Any]] = None


class CampaignRename(BaseModel):
    name: Optional[str] = None
    notes: Optional[str] = None


class Campaign(BaseModel):
    id: str
    name: str
    created_at: str
    settings: Dict[str, Any]
    stats: Dict[str, Any]
    has_output: bool
    notes: str = ""
