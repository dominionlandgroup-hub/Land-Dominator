const API_BASE = import.meta.env.VITE_API_URL || '/api'

export interface LeadStackerStats {
  total: number
  score_distribution: Record<string, number>
  source_counts: Record<string, number>
  mls_cross_referenced: number
  high_value: number
}

export interface HillsboroughLead {
  id: string
  created_at: string
  parcel_id: string
  owner_name: string
  owner_first_name: string
  owner_last_name: string
  property_address: string
  property_city: string
  property_state: string
  property_zip: string
  mail_address: string
  mail_city: string
  mail_state: string
  mail_zip: string
  score: number
  has_tax_deed: boolean
  has_lands_available: boolean
  has_lis_pendens: boolean
  has_foreclosure: boolean
  has_probate: boolean
  has_code_violation: boolean
  on_mls: boolean
  mls_list_price: number | null
  mls_days_on_market: number | null
}

export interface UploadResult {
  source: string
  label: string
  total_in_csv: number
  inserted: number
  updated: number
  skipped: number
}

export type SourceKey =
  | 'tax-deed'
  | 'lands-available'
  | 'lis-pendens'
  | 'foreclosure'
  | 'probate'
  | 'code-violation'

export async function uploadSourceCSV(source: SourceKey, file: File): Promise<UploadResult> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${API_BASE}/lead-stacker/upload/${source}`, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'Upload failed')
  }
  return res.json()
}

export async function uploadMLSCSV(file: File): Promise<{ total_in_csv: number; matched_leads: number }> {
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
  minScore?: number
  maxScore?: number
  onMls?: boolean
  limit?: number
  offset?: number
}): Promise<{ leads: HillsboroughLead[]; offset: number; limit: number }> {
  const q = new URLSearchParams()
  if (params.minScore != null) q.set('min_score', String(params.minScore))
  if (params.maxScore != null) q.set('max_score', String(params.maxScore))
  if (params.onMls != null) q.set('on_mls', String(params.onMls))
  if (params.limit != null) q.set('limit', String(params.limit))
  if (params.offset != null) q.set('offset', String(params.offset))
  const res = await fetch(`${API_BASE}/lead-stacker/leads?${q}`)
  if (!res.ok) throw new Error('Failed to load leads')
  return res.json()
}

export function exportLeadsUrl(minScore: number): string {
  return `${API_BASE}/lead-stacker/export?min_score=${minScore}`
}

export async function clearAllLeads(): Promise<{ deleted: number }> {
  const res = await fetch(`${API_BASE}/lead-stacker/clear`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Clear failed')
  return res.json()
}

export async function clearSource(source: SourceKey): Promise<unknown> {
  const res = await fetch(`${API_BASE}/lead-stacker/clear/${source}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Clear failed')
  return res.json()
}
