import api from './client'
import type { CRMProperty, CRMContact, CRMDeal, CRMCampaign, ImportResult } from '../types/crm'

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

export async function clearAllProperties(): Promise<void> {
  await api.delete('/crm/properties/all')
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

export async function createCrmCampaign(name: string, notes?: string): Promise<CRMCampaign> {
  const { data } = await api.post<CRMCampaign>('/crm/campaigns', { name, notes })
  return data
}

export async function updateCrmCampaign(id: string, updates: { name?: string; notes?: string }): Promise<CRMCampaign> {
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
