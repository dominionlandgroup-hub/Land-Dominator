from pydantic import BaseModel
from typing import Optional, List


class PropertyBase(BaseModel):
    apn: Optional[str] = None
    county: Optional[str] = None
    state: Optional[str] = None
    acreage: Optional[float] = None
    status: Optional[str] = "lead"

    # Owner
    owner_full_name: Optional[str] = None
    owner_first_name: Optional[str] = None
    owner_last_name: Optional[str] = None
    owner_phone: Optional[str] = None
    phone_2: Optional[str] = None
    phone_3: Optional[str] = None
    owner_email: Optional[str] = None
    owner_mailing_address: Optional[str] = None
    owner_mailing_city: Optional[str] = None
    owner_mailing_state: Optional[str] = None
    owner_mailing_zip: Optional[str] = None

    # CRM Campaign link
    campaign_id: Optional[str] = None

    # Campaign
    campaign_code: Optional[str] = None
    campaign_price: Optional[float] = None
    offer_price: Optional[float] = None

    # Sale / Purchase
    sale_date: Optional[str] = None
    sale_price: Optional[float] = None
    purchase_date: Optional[str] = None
    purchase_price: Optional[float] = None

    # Due Diligence
    dd_access: Optional[str] = None
    dd_topography: Optional[str] = None
    dd_flood_zone: Optional[str] = None
    dd_sewer: Optional[str] = None
    dd_septic: Optional[str] = None
    dd_water: Optional[str] = None
    dd_power: Optional[str] = None
    dd_zoning: Optional[str] = None
    dd_back_taxes: Optional[str] = None

    # Comparables (3)
    comp1_link: Optional[str] = None
    comp1_price: Optional[float] = None
    comp1_acreage: Optional[float] = None
    comp2_link: Optional[str] = None
    comp2_price: Optional[float] = None
    comp2_acreage: Optional[float] = None
    comp3_link: Optional[str] = None
    comp3_price: Optional[float] = None
    comp3_acreage: Optional[float] = None

    # Marketing
    marketing_price: Optional[float] = None
    marketing_title: Optional[str] = None
    marketing_description: Optional[str] = None
    marketing_nearest_city: Optional[str] = None

    # Pricing
    ghl_offer_code: Optional[str] = None
    lp_estimate: Optional[float] = None
    offer_range_high: Optional[float] = None
    pricing_offer_price: Optional[float] = None
    pebble_code: Optional[str] = None
    claude_ai_comp: Optional[float] = None

    # Meta
    tags: Optional[List[str]] = None
    additional_phones: Optional[List[str]] = None
    notes: Optional[str] = None


class PropertyCreate(PropertyBase):
    pass


class PropertyUpdate(PropertyBase):
    pass


class Property(PropertyBase):
    id: str
    created_at: str
    updated_at: str

    model_config = {"from_attributes": True}


# ── Contacts ─────────────────────────────────────────────────────────


class ContactBase(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    full_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    mailing_address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip: Optional[str] = None
    notes: Optional[str] = None
    tags: Optional[List[str]] = None
    property_ids: Optional[List[str]] = None


class ContactCreate(ContactBase):
    pass


class ContactUpdate(ContactBase):
    pass


class Contact(ContactBase):
    id: str
    created_at: str
    updated_at: str

    model_config = {"from_attributes": True}


# ── Deals ─────────────────────────────────────────────────────────────


class DealBase(BaseModel):
    title: str
    property_id: Optional[str] = None
    contact_id: Optional[str] = None
    stage: Optional[str] = "lead"
    value: Optional[float] = None
    notes: Optional[str] = None
    expected_close_date: Optional[str] = None
    tags: Optional[List[str]] = None


class DealCreate(DealBase):
    pass


class DealUpdate(BaseModel):
    title: Optional[str] = None
    property_id: Optional[str] = None
    contact_id: Optional[str] = None
    stage: Optional[str] = None
    value: Optional[float] = None
    notes: Optional[str] = None
    expected_close_date: Optional[str] = None
    tags: Optional[List[str]] = None


class Deal(DealBase):
    id: str
    created_at: str
    updated_at: str

    model_config = {"from_attributes": True}


# ── CRM Campaigns ─────────────────────────────────────────────────────


class CRMCampaignBase(BaseModel):
    name: str
    notes: Optional[str] = None
    color: Optional[str] = None


class CRMCampaignCreate(CRMCampaignBase):
    pass


class CRMCampaignUpdate(BaseModel):
    name: Optional[str] = None
    notes: Optional[str] = None
    color: Optional[str] = None


class CRMCampaign(CRMCampaignBase):
    id: str
    created_at: str
    updated_at: Optional[str] = None
    property_count: Optional[int] = None

    model_config = {"from_attributes": True}


# ── Import ────────────────────────────────────────────────────────────


class ImportResult(BaseModel):
    imported: int
    skipped: int
    errors: List[str]
