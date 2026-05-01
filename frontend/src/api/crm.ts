import api from './client'
import type { CRMProperty, CRMContact, CRMDeal, CRMCampaign, ImportResult, MailDrop, MailDropPreview, BuyBox, Communication, CommStats } from '../types/crm'

// ── Properties ────────────────────────────────────────────────────────

export interface PropertyListResponse {
  data: CRMProperty[]
  total: number
  page: number
  limit: number
}

export interface PropertyCounts {
  total: number
  by_status: Record<string, number>
}

export async function listProperties(params?: {
  page?: number
  limit?: number
  status?: string
  state?: string
  county?: string
  campaign_id?: string
  search?: string
}): Promise<PropertyListResponse> {
  const { data } = await api.get<PropertyListResponse>('/crm/properties', { params })
  return data
}

export async function getPropertyCounts(): Promise<PropertyCounts> {
  const { data } = await api.get<PropertyCounts>('/crm/properties/counts')
  return data
}

export async function clearAllProperties(): Promise<{ deleted: boolean; count: number }> {
  const { data } = await api.delete<{ deleted: boolean; count: number }>('/crm/properties/all')
  return data
}

export async function createProperty(body: Partial<CRMProperty>): Promise<CRMProperty> {
  const { data } = await api.post<CRMProperty>('/crm/properties', body)
  return data
}

export async function getProperty(id: string): Promise<CRMProperty> {
  const { data } = await api.get<CRMProperty>(`/crm/properties/${id}`)
  return data
}

export async function updateProperty(id: string, body: Partial<CRMProperty>): Promise<CRMProperty> {
  const { data } = await api.put<CRMProperty>(`/crm/properties/${id}`, body)
  return data
}

export async function deleteProperty(id: string): Promise<void> {
  await api.delete(`/crm/properties/${id}`)
}

export interface ImportJobStatus {
  status: 'pending' | 'done' | 'error'
  result?: ImportResult
  error?: string
}

export async function startPropertyImport(file: File): Promise<{ job_id: string }> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await api.post<{ job_id: string }>('/crm/properties/import', form)
  return data
}

export async function getImportJobStatus(jobId: string): Promise<ImportJobStatus> {
  const { data } = await api.get<ImportJobStatus>(`/crm/properties/import-status/${jobId}`)
  return data
}

export async function bulkInsertRows(rows: Record<string, string>[], campaignId?: string): Promise<ImportResult> {
  const params = campaignId ? { campaign_id: campaignId } : {}
  const { data } = await api.post<ImportResult>('/crm/properties/bulk', rows, { params })
  return data
}

// ── CRM Campaigns ─────────────────────────────────────────────────────

export async function listCrmCampaigns(): Promise<CRMCampaign[]> {
  const { data } = await api.get<CRMCampaign[]>('/crm/campaigns')
  return data
}

export async function getCrmCampaign(id: string): Promise<CRMCampaign> {
  const { data } = await api.get<CRMCampaign>(`/crm/campaigns/${id}`)
  return data
}

export async function createCrmCampaign(
  name: string,
  opts?: {
    notes?: string
    total_budget?: number
    cost_per_piece?: number
    weekly_budget?: number
    pieces_per_week?: number
    send_day?: string
    mail_house_email?: string
    start_date?: string
  }
): Promise<CRMCampaign> {
  const { data } = await api.post<CRMCampaign>('/crm/campaigns', { name, ...opts })
  return data
}

export async function updateCrmCampaign(
  id: string,
  updates: Partial<CRMCampaign>
): Promise<CRMCampaign> {
  const { data } = await api.patch<CRMCampaign>(`/crm/campaigns/${id}`, updates)
  return data
}

export async function deleteCrmCampaign(id: string): Promise<void> {
  await api.delete(`/crm/campaigns/${id}`)
}

export async function importPropertiesBatch(
  rows: Record<string, string>[],
): Promise<ImportResult> {
  const { data } = await api.post<ImportResult>('/crm/properties/import-batch', rows)
  return data
}

export async function deleteProperties(ids: string[]): Promise<void> {
  await api.post('/crm/properties/bulk-delete', ids)
}

export async function deletePropertiesFiltered(params: {
  status?: string
  campaign_id?: string
  county?: string
  state?: string
  search?: string
}): Promise<void> {
  await api.post('/crm/properties/bulk-delete-filtered', null, { params })
}

export async function exportPropertiesCsv(params: {
  status?: string
  campaign_id?: string
  county?: string
  state?: string
  search?: string
  fmt?: 'full' | 'mailhouse'
  filename?: string
}): Promise<void> {
  const { filename, ...queryParams } = params
  const { data } = await api.get('/crm/properties/export-csv', {
    params: queryParams,
    responseType: 'blob',
  })
  const url = URL.createObjectURL(new Blob([data], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename ?? `properties-export-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Land Portal ───────────────────────────────────────────────────────

export async function pullLpData(id: string): Promise<CRMProperty> {
  const { data } = await api.post<CRMProperty>(`/crm/properties/${id}/pull-lp-data`)
  return data
}

export interface LpPullJobStatus {
  status: 'running' | 'done' | 'error'
  done: number
  total: number
  errors?: string[]
  error?: string
}

export async function startCampaignLpPull(campaignId: string): Promise<{ job_id: string }> {
  const { data } = await api.post<{ job_id: string }>(`/crm/campaigns/${campaignId}/pull-lp-data`)
  return data
}

export async function getCampaignLpPullStatus(campaignId: string, jobId: string): Promise<LpPullJobStatus> {
  const { data } = await api.get<LpPullJobStatus>(`/crm/campaigns/${campaignId}/pull-lp-status/${jobId}`)
  return data
}

// ── Contacts ──────────────────────────────────────────────────────────

export async function listContacts(): Promise<CRMContact[]> {
  const { data } = await api.get<CRMContact[]>('/crm/contacts')
  return data
}

export async function createContact(body: Partial<CRMContact>): Promise<CRMContact> {
  const { data } = await api.post<CRMContact>('/crm/contacts', body)
  return data
}

export async function updateContact(id: string, body: Partial<CRMContact>): Promise<CRMContact> {
  const { data } = await api.put<CRMContact>(`/crm/contacts/${id}`, body)
  return data
}

export async function deleteContact(id: string): Promise<void> {
  await api.delete(`/crm/contacts/${id}`)
}

// ── Deals ─────────────────────────────────────────────────────────────

export async function listDeals(stage?: string): Promise<CRMDeal[]> {
  const { data } = await api.get<CRMDeal[]>('/crm/deals', {
    params: stage ? { stage } : undefined,
  })
  return data
}

export async function createDeal(
  body: Omit<CRMDeal, 'id' | 'created_at' | 'updated_at'>,
): Promise<CRMDeal> {
  const { data } = await api.post<CRMDeal>('/crm/deals', body)
  return data
}

export async function updateDeal(id: string, body: Partial<CRMDeal>): Promise<CRMDeal> {
  const { data } = await api.put<CRMDeal>(`/crm/deals/${id}`, body)
  return data
}

export async function deleteDeal(id: string): Promise<void> {
  await api.delete(`/crm/deals/${id}`)
}

// ── Mail Drops ────────────────────────────────────────────────────────

export async function listMailDrops(campaignId?: string): Promise<MailDrop[]> {
  const { data } = await api.get<MailDrop[]>('/crm/mail-drops', {
    params: campaignId ? { campaign_id: campaignId } : undefined,
  })
  return data
}

export async function previewMailDrop(
  campaign_id: string,
  scheduled_date: string
): Promise<MailDropPreview> {
  const { data } = await api.post<MailDropPreview>('/crm/mail-drops/preview', {
    campaign_id,
    scheduled_date,
  })
  return data
}

export async function createMailDrop(
  campaign_id: string,
  scheduled_date: string,
  week_number?: number
): Promise<MailDrop> {
  const { data } = await api.post<MailDrop>('/crm/mail-drops', {
    campaign_id,
    scheduled_date,
    week_number,
  })
  return data
}

export async function approveMailDrop(id: string): Promise<MailDrop> {
  const { data } = await api.patch<MailDrop>(`/crm/mail-drops/${id}/approve`)
  return data
}

export async function sendMailDrop(id: string): Promise<MailDrop> {
  const { data } = await api.post<MailDrop>(`/crm/mail-drops/${id}/send`)
  return data
}

export async function downloadMailDropCsv(id: string, filename?: string): Promise<void> {
  const { data } = await api.get(`/crm/mail-drops/${id}/csv`, { responseType: 'blob' })
  const url = URL.createObjectURL(new Blob([data], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename ?? `mail_list_${id.slice(0, 8)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export async function deleteMailDrop(id: string): Promise<void> {
  await api.delete(`/crm/mail-drops/${id}`)
}

// ── Settings ──────────────────────────────────────────────────────────

export async function getSetting(key: string): Promise<{ key: string; value: unknown }> {
  const { data } = await api.get<{ key: string; value: unknown }>(`/crm/settings/${key}`)
  return data
}

export async function upsertSetting(key: string, value: unknown): Promise<{ key: string; value: unknown }> {
  const { data } = await api.put<{ key: string; value: unknown }>(`/crm/settings/${key}`, { value })
  return data
}

export async function getBuyBox(): Promise<BuyBox> {
  const res = await getSetting('buy_box')
  return (res.value as BuyBox) ?? {}
}

export async function saveBuyBox(box: BuyBox): Promise<void> {
  await upsertSetting('buy_box', box)
}

// ── Communications ────────────────────────────────────────────────────

export async function listCommunications(params?: {
  property_id?: string
  comm_type?: string
  lead_score?: string
  limit?: number
}): Promise<Communication[]> {
  const { data } = await api.get<Communication[]>('/crm/communications', { params })
  return data
}

export async function listPropertyCommunications(propertyId: string): Promise<Communication[]> {
  const { data } = await api.get<Communication[]>(`/crm/properties/${propertyId}/communications`)
  return data
}

export async function getCommStats(): Promise<CommStats> {
  const { data } = await api.get<CommStats>('/crm/communications/stats')
  return data
}

export async function sendSms(property_id: string, to_phone: string, message: string): Promise<{ sent: boolean; communication_id?: string }> {
  const { data } = await api.post('/crm/sms/send', { property_id, to_phone, message })
  return data
}

// ── Property Documents ────────────────────────────────────────────────────────

export interface PropertyDocument {
  id: string
  created_at: string
  property_id: string
  filename: string
  file_size: number | null
  file_type: string | null
  storage_path: string
  uploaded_by: string | null
}

export async function listPropertyDocuments(propertyId: string): Promise<PropertyDocument[]> {
  const { data } = await api.get<PropertyDocument[]>(`/crm/properties/${propertyId}/documents`)
  return data
}

export async function uploadPropertyDocument(propertyId: string, file: File): Promise<PropertyDocument> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await api.post<PropertyDocument>(`/crm/properties/${propertyId}/documents`, form)
  return data
}

export async function deleteDocument(docId: string): Promise<void> {
  await api.delete(`/crm/documents/${docId}`)
}

export async function getDocumentDownloadUrl(docId: string): Promise<string> {
  const { data } = await api.get<{ url: string }>(`/crm/documents/${docId}/download`)
  return data.url
}

// ── Market Research ──────────────────────────────────────────────────────────

export interface CountyRecommendation {
  county: string
  state: string
  rank: number
  why_good: string
  price_range_low: number
  price_range_high: number
  builder_demand: 'High' | 'Medium' | 'Low'
  recommended_acreage_min: number
  recommended_acreage_max: number
  population_trend: string
  dom_estimate: number
  key_cities?: string[]
}

export interface StateResearchResult {
  state: string
  strategy: string
  market_summary: string
  counties: CountyRecommendation[]
  cached?: boolean
  last_updated?: string
  error?: string
}

export async function researchState(
  state: string,
  strategy: string = 'infill_lots',
  acreageMin: number = 0.1,
  acreageMax: number = 2.0
): Promise<StateResearchResult> {
  const { data } = await api.post<StateResearchResult>('/market-research/state', {
    state,
    strategy,
    acreage_min: acreageMin,
    acreage_max: acreageMax,
  })
  return data
}

export async function researchCounty(
  county: string,
  state: string,
  strategy: string = 'infill_lots'
): Promise<Record<string, unknown>> {
  const { data } = await api.post('/market-research/county', { county, state, strategy })
  return data
}
