export type PropertyStatus =
  | 'lead'
  | 'prospect'
  | 'offer_sent'
  | 'under_contract'
  | 'due_diligence'
  | 'closed_won'
  | 'closed_lost'
  | 'dead'

export interface CRMProperty {
  id: string
  created_at: string
  updated_at: string

  apn?: string
  county?: string
  state?: string
  acreage?: number
  status?: PropertyStatus

  owner_full_name?: string
  owner_first_name?: string
  owner_last_name?: string
  owner_phone?: string
  phone_2?: string
  phone_3?: string
  owner_email?: string
  owner_mailing_address?: string
  owner_mailing_city?: string
  owner_mailing_state?: string
  owner_mailing_zip?: string

  campaign_id?: string
  campaign_code?: string
  campaign_price?: number
  offer_price?: number

  sale_date?: string
  sale_price?: number
  purchase_date?: string
  purchase_price?: number

  dd_access?: string
  dd_topography?: string
  dd_flood_zone?: string
  dd_sewer?: string
  dd_septic?: string
  dd_water?: string
  dd_power?: string
  dd_zoning?: string
  dd_back_taxes?: string

  comp1_link?: string
  comp1_price?: number
  comp1_acreage?: number
  comp2_link?: string
  comp2_price?: number
  comp2_acreage?: number
  comp3_link?: string
  comp3_price?: number
  comp3_acreage?: number

  marketing_price?: number
  marketing_title?: string
  marketing_description?: string
  marketing_nearest_city?: string

  property_id?: string
  fips?: string
  property_address?: string
  property_city?: string
  property_zip?: string
  latitude?: number
  longitude?: number
  assessed_value?: string
  fema_coverage?: number
  wetlands_coverage?: number
  buildability?: number
  buildability_acres?: number
  elevation_avg?: number
  land_locked?: string
  school_district?: string
  land_use?: string
  road_frontage?: number
  slope_avg?: number
  price_per_acre?: number

  ghl_offer_code?: string
  lp_estimate?: number
  offer_range_high?: number
  pricing_offer_price?: number
  pebble_code?: string
  claude_ai_comp?: number

  tags?: string[]
  additional_phones?: string[]
  notes?: string
}

export interface CRMContact {
  id: string
  created_at: string
  updated_at: string
  first_name?: string
  last_name?: string
  full_name?: string
  email?: string
  phone?: string
  mailing_address?: string
  city?: string
  state?: string
  zip?: string
  notes?: string
  tags?: string[]
  property_ids?: string[]
}

export type DealStage =
  | 'lead'
  | 'prospect'
  | 'offer_sent'
  | 'under_contract'
  | 'due_diligence'
  | 'closed_won'
  | 'closed_lost'

export interface CRMDeal {
  id: string
  created_at: string
  updated_at: string
  title: string
  property_id?: string
  contact_id?: string
  stage: DealStage
  value?: number
  notes?: string
  expected_close_date?: string
  tags?: string[]
}

export interface ImportResult {
  imported: number
  skipped: number
  errors: string[]
}

export interface CRMCampaign {
  id: string
  name: string
  notes?: string
  color?: string
  created_at: string
  updated_at?: string
  property_count?: number
  by_status?: Record<string, number>
  total_budget?: number
  cost_per_piece?: number
  weekly_budget?: number
  pieces_per_week?: number
  send_day?: string
  mail_house_email?: string
  start_date?: string
  amount_spent?: number
}

export type MailDropStatus = 'scheduled' | 'approved' | 'sent' | 'error'

export interface MailDrop {
  id: string
  campaign_id?: string
  campaign_name?: string
  week_number?: number
  scheduled_date?: string
  pieces_count?: number
  estimated_cost?: number
  status: MailDropStatus
  approved_at?: string
  sent_at?: string
  email_sent_to?: string
  suppression_summary?: string
  error?: string
  created_at: string
  updated_at?: string
}

export interface MailDropPreview {
  campaign_id: string
  scheduled_date: string
  total_records: number
  suppressed_count: number
  eligible_count: number
  estimated_cost: number
  cost_per_piece: number
}

export interface BuyBox {
  target_state?: string
  target_county?: string
  min_acreage?: number
  max_acreage?: number
  min_price?: number
  max_price?: number
  offer_pct?: number
  mail_house_email?: string
  weekly_send_day?: string
  weekly_budget?: number
  cost_per_piece?: number
}
