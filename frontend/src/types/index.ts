// ─── Upload ────────────────────────────────────────────────────────────────

export interface UploadStats {
  session_id: string
  total_rows: number
  valid_rows: number
  columns_found: string[]
  missing_columns: string[]
  preview: Record<string, unknown>[]
}

// ─── Dashboard ─────────────────────────────────────────────────────────────

export interface ZipStats {
  zip_code: string
  sales_count: number
  min_lot_size: number | null
  max_lot_size: number | null
  median_lot_size: number | null
  min_sale_price: number | null
  max_sale_price: number | null
  avg_price_per_acre: number | null
  median_price_per_acre: number | null
  price_band_lt50k: number
  price_band_50k_100k: number
  price_band_100k_250k: number
  price_band_gt250k: number
  acreage_band_0_1: number
  acreage_band_1_5: number
  acreage_band_5_10: number
  acreage_band_gt10: number
}

export interface DashboardData {
  zip_stats: ZipStats[]
  total_comps: number
  valid_comps: number
  median_price: number | null
  median_acreage: number | null
  available_zips: string[]
  comp_locations: CompLocation[]
  insight: string
  sweet_spot?: SweetSpot | null
}

export interface CompLocation {
  lat: number
  lng: number
  sale_price: number
  lot_acres: number
  price_per_acre: number
  zip: string
  apn: string
  sale_date: string | null
}

export interface SweetSpot {
  bucket: string
  count: number
  total_sales: number
  expected_offer_low: number
  expected_offer_high: number
}

// ─── Matching ──────────────────────────────────────────────────────────────

export interface MatchFilters {
  session_id: string
  target_session_id: string
  radius_miles: number
  acreage_tolerance_pct: number
  min_match_score: number
  zip_filter: string[]
  // Smart filters
  flood_zone_filter: 'all' | 'exclude' | 'only'
  min_acreage: number | null
  max_acreage: number | null
  exclude_flood: boolean
  only_flood: boolean
  min_buildability: number | null
  vacant_only: boolean
  require_road_frontage: boolean
  exclude_landlocked: boolean
  exclude_land_locked: boolean
  require_tlp: boolean
  require_tlp_estimate: boolean
  price_ceiling: number | null
}

export type MatchFiltersPartial = Partial<MatchFilters>

export interface MatchedParcel {
  apn: string
  owner_name: string
  mail_address: string
  mail_city: string
  mail_state: string
  mail_zip: string
  parcel_zip: string
  parcel_city: string
  lot_acres: number | null
  match_score: number
  matched_comp_count: number
  suggested_offer_low: number | null
  suggested_offer_mid: number | null
  suggested_offer_high: number | null
  tlp_estimate: number | null
  flood_zone: string | null
  buildability_pct: number | null
  latitude: number | null
  longitude: number | null
}

export interface MatchResult {
  match_id: string
  total_targets: number
  matched_count: number
  results: MatchedParcel[]
}

// ─── Mailing List ──────────────────────────────────────────────────────────

export interface MailingPreview {
  match_id: string
  total_before_dedup: number
  total_after_dedup: number
  filtered_foreign: number
  filtered_do_not_mail: number
  results: MatchedParcel[]
}

// ─── Campaigns ─────────────────────────────────────────────────────────────

export interface Campaign {
  id: string
  name: string
  created_at: string
  settings: Record<string, unknown>
  stats: Record<string, unknown>
  has_output: boolean
  notes: string
}

// ─── App State ─────────────────────────────────────────────────────────────

export type AppPage =
  | 'welcome'
  | 'upload-comps'
  | 'dashboard'
  | 'match-targets'
  | 'mailing-list'
  | 'campaigns'

// ─── Confidence ────────────────────────────────────────────────────────────

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'EST'

export function getConfidence(compCount: number): ConfidenceLevel {
  if (compCount >= 5) return 'HIGH'
  if (compCount >= 3) return 'MEDIUM'
  if (compCount >= 1) return 'LOW'
  return 'EST'
}
