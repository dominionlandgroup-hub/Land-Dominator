import axios from 'axios'
import type {
  UploadStats,
  DashboardData,
  MatchFilters,
  MatchResult,
  MailingPreview,
  Campaign,
  CompLocation,
} from '../types'

const api = axios.create({
  baseURL: '/api',
  timeout: 120_000,
})

// ─── Upload ────────────────────────────────────────────────────────────────

export async function uploadComps(file: File): Promise<UploadStats> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await api.post<UploadStats>('/upload/comps', form)
  return data
}

export async function uploadTargets(file: File): Promise<UploadStats> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await api.post<UploadStats>('/upload/targets', form)
  return data
}

// ─── Dashboard ─────────────────────────────────────────────────────────────

export async function fetchDashboard(
  sessionId: string,
  zipCodes?: string[]
): Promise<DashboardData> {
  const params: Record<string, string> = { session_id: sessionId }
  if (zipCodes && zipCodes.length > 0) {
    params.zip_codes = zipCodes.join(',')
  }
  const { data } = await api.get<DashboardData>('/dashboard/stats', { params })
  return data
}

export async function fetchCompLocations(
  sessionId: string,
  zipCodes?: string[]
): Promise<CompLocation[]> {
  const params: Record<string, string> = { session_id: sessionId }
  if (zipCodes && zipCodes.length > 0) {
    params.zip_codes = zipCodes.join(',')
  }
  const { data } = await api.get<CompLocation[]>('/dashboard/comps', { params })
  return data
}

// ─── Matching ──────────────────────────────────────────────────────────────

export async function runMatch(filters: MatchFilters): Promise<MatchResult> {
  const { data } = await api.post<MatchResult>('/match/run', filters)
  return data
}

// ─── Mailing ───────────────────────────────────────────────────────────────

export async function fetchMailingPreview(matchId: string): Promise<MailingPreview> {
  const { data } = await api.get<MailingPreview>('/mailing/preview', {
    params: { match_id: matchId },
  })
  return data
}

export type ExportType = 'full' | 'high-confidence' | 'top500'

export function getMailingDownloadUrl(
  matchId: string,
  campaignName?: string,
  exportType: ExportType = 'full'
): string {
  const name = encodeURIComponent(campaignName ?? 'mailing-list')
  return `/api/mailing/download?match_id=${matchId}&campaign_name=${name}&export_type=${exportType}`
}

// ─── Campaigns ─────────────────────────────────────────────────────────────

export async function listCampaigns(): Promise<Campaign[]> {
  const { data } = await api.get<Campaign[]>('/campaigns')
  return data
}

export async function createCampaign(
  name: string,
  matchId: string,
  filters?: Record<string, unknown>
): Promise<Campaign> {
  const { data } = await api.post<Campaign>('/campaigns', {
    name,
    match_id: matchId,
    filters: filters ?? {},
  })
  return data
}

export async function renameCampaign(id: string, name: string): Promise<Campaign> {
  const { data } = await api.patch<Campaign>(`/campaigns/${id}`, { name })
  return data
}

export async function updateCampaignNotes(id: string, notes: string): Promise<Campaign> {
  const { data } = await api.patch<Campaign>(`/campaigns/${id}/notes`, { notes })
  return data
}

export async function deleteCampaign(id: string): Promise<void> {
  await api.delete(`/campaigns/${id}`)
}

export function getCampaignDownloadUrl(id: string): string {
  return `/api/campaigns/${id}/download`
}

export default api
