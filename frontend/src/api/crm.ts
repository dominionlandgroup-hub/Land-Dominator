import api from './client'
import type { CRMProperty, CRMContact, CRMDeal, ImportResult } from '../types/crm'

// ── Properties ────────────────────────────────────────────────────────

export async function listProperties(filters?: {
  status?: string
  state?: string
  county?: string
}): Promise<CRMProperty[]> {
  const { data } = await api.get<CRMProperty[]>('/crm/properties', { params: filters })
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

export async function importProperties(file: File): Promise<ImportResult> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await api.post<ImportResult>('/crm/properties/import', form)
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
