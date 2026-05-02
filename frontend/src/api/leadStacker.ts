const API_BASE = import.meta.env.VITE_API_URL || '/api'

export type County = 'hillsborough' | 'pinellas' | 'pasco'

export type SourceKey =
  | 'tax-deed'
  | 'lands-available'
  | 'lis-pendens'
  | 'foreclosure'
  | 'probate'
  | 'code-violation'

export interface TampaBayLead {
  id: string
  created_at: string
  county: County
  parcel_id: string
  owner_name: string
  owner_first_name: string
  owner_last_name: string
  property_address: string
  property_city: string
  property_state: string
  property_zip: string
  lot_acres: number | null
  land_use: string | null
  mail_address: string
  mail_city: string
  mail_state: string
  mail_zip: string
  score: number
  pain_signals: string[]
  on_mls: boolean
  mls_list_price: number | null
  mls_days_on_market: number | null
}

export interface UploadResult {
  county: string
  source: string
  label: string
  total_in_csv: number
  inserted: number
  updated: number
  skipped_no_parcel_id: number
  skipped_improved_land: number
}

export interface LeadStackerStats {
  total: number
  score_distribution: Record<string, number>
  county_counts: Record<County, number>
  signal_counts: Record<string, number>
  mls_cross_referenced: number
  high_value: number
}

export interface SchemaInfo {
  counties: Record<County, Record<SourceKey, { label: string; url: string }>>
}

export async function getSchema(): Promise<SchemaInfo> {
  const res = await fetch(`${API_BASE}/lead-stacker/schema`)
  if (!res.ok) throw new Error('Failed to load schema')
  return res.json()
}

export async function uploadSourceCSV(
  county: County,
  source: SourceKey,
  file: File,
): Promise<UploadResult> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${API_BASE}/lead-stacker/upload/${county}/${source}`, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'Upload failed')
  }
  return res.json()
}

export async function uploadMLSCSV(
  file: File,
): Promise<{ total_in_csv: number; matched_leads: number }> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${API_BASE}/lead-stacker/upload/mls`, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'Upload failed')
  }
  return res.json()
}

export async function getLeadStackerStats(): Promise<LeadStackerStats> {
  const res = await fetch(`${API_BASE}/lead-stacker/stats`)
  if (!res.ok) throw new Error('Failed to load stats')
  return res.json()
}

export async function getLeads(params: {
  county?: County | 'all'
  minScore?: number
  onMls?: boolean
  limit?: number
  offset?: number
}): Promise<{ leads: TampaBayLead[]; offset: number; limit: number }> {
  const q = new URLSearchParams()
  if (params.county && params.county !== 'all') q.set('county', params.county)
  if (params.minScore != null) q.set('min_score', String(params.minScore))
  if (params.onMls != null) q.set('on_mls', String(params.onMls))
  if (params.limit != null) q.set('limit', String(params.limit))
  if (params.offset != null) q.set('offset', String(params.offset))
  const res = await fetch(`${API_BASE}/lead-stacker/leads?${q}`)
  if (!res.ok) throw new Error('Failed to load leads')
  return res.json()
}

export function exportLeadsUrl(minScore: number, county?: County | 'all'): string {
  const q = new URLSearchParams({ min_score: String(minScore) })
  if (county && county !== 'all') q.set('county', county)
  return `${API_BASE}/lead-stacker/export?${q}`
}

export async function clearLeads(county?: County): Promise<{ deleted: number }> {
  const q = county ? `?county=${county}` : ''
  const res = await fetch(`${API_BASE}/lead-stacker/clear${q}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Clear failed')
  return res.json()
}

export async function clearSignal(county: County, source: SourceKey): Promise<unknown> {
  const res = await fetch(`${API_BASE}/lead-stacker/clear/${county}/${source}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error('Clear failed')
  return res.json()
}
