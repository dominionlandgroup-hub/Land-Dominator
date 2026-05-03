import axios from 'axios'
import type {
  UploadStats,
  ListingsStats,
  DashboardData,
  MatchFilters,
  MatchResult,
  MailingPreview,
  Campaign,
  CompLocation,
} from '../types'

// Use environment variable for API URL, fallback to /api for local dev with proxy
const API_BASE_URL = import.meta.env.VITE_API_URL || '/api'

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 300_000,
})

// ─── Upload ────────────────────────────────────────────────────────────────

export async function uploadComps(file: File, append = true): Promise<UploadStats> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await api.post<UploadStats>(`/upload/comps?append=${append}`, form)
  return data
}

export async function uploadListings(file: File): Promise<ListingsStats> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await api.post<ListingsStats>('/upload/listings', form)
  return data
}

export interface CompInventoryItem {
  filename: string
  source_format: string
  record_count: number
  states: string[]
  uploaded_at: string | null
}

export interface CompInventoryResponse {
  items: CompInventoryItem[]
  total_comps: number
}

export async function getCompsInventory(): Promise<CompInventoryResponse> {
  const { data } = await api.get<CompInventoryResponse>('/upload/comps/inventory')
  return data
}

export async function getDbCompsCount(): Promise<number> {
  try {
    const { data } = await api.get<{ count: number }>('/upload/comps/count')
    return data.count ?? 0
  } catch {
    return 0
  }
}

export async function clearAllComps(): Promise<{ deleted: number }> {
  const { data } = await api.delete<{ deleted: number }>('/upload/comps/all')
  return data
}

export async function clearCompsByState(state: string): Promise<{ state: string; deleted: number }> {
  const { data } = await api.delete<{ state: string; deleted: number }>(`/upload/comps/state/${state}`)
  return data
}

export async function clearCompsByFile(filename: string): Promise<{ filename: string; deleted: number }> {
  const { data } = await api.delete<{ filename: string; deleted: number }>(`/upload/comps/file/${encodeURIComponent(filename)}`)
  return data
}

export async function uploadTargets(file: File): Promise<UploadStats> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await api.post<UploadStats>('/upload/targets', form)
  return data
}

export async function restoreLatestCompsSession(): Promise<UploadStats> {
  const { data } = await api.get<UploadStats>('/upload/comps/latest-session')
  return data
}

export async function restoreLatestTargetSession(): Promise<UploadStats> {
  const { data } = await api.get<UploadStats>('/upload/targets/restore')
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

export interface MatchJobStart {
  job_id: string
  status: 'running'
  total_targets: number
  is_background: true
  message: string
}

export interface MatchJobStatus {
  job_id: string
  status: 'running' | 'complete' | 'error'
  progress: number
  total: number
  message: string
  error?: string
  result?: MatchResult
}

export async function runMatch(filters: MatchFilters): Promise<MatchResult | MatchJobStart> {
  const { data } = await api.post<MatchResult | MatchJobStart>('/match/run', filters, { timeout: 600_000 })
  return data
}

export async function getMatchJobStatus(jobId: string): Promise<MatchJobStatus> {
  const { data } = await api.get<MatchJobStatus>(`/match/job/${jobId}`)
  return data
}

// ─── Mailing ───────────────────────────────────────────────────────────────

export async function fetchMailingPreview(matchId: string): Promise<MailingPreview> {
  const { data } = await api.get<MailingPreview>('/mailing/preview', {
    params: { match_id: matchId },
    timeout: 600_000,
  })
  return data
}

export type ExportType = 'full' | 'matched' | 'mailable' | 'high-confidence' | 'top500' | 'flagged-for-review' | 'suspect-comps'

export function getMailingDownloadUrl(
  matchId: string,
  campaignName?: string,
  exportType: ExportType = 'full'
): string {
  const name = encodeURIComponent(campaignName ?? 'mailing-list')
  return `${API_BASE_URL}/mailing/download?match_id=${matchId}&campaign_name=${name}&export_type=${exportType}`
}

export function getMatchedLeadsDownloadUrl(
  matchId: string,
  campaignName?: string
): string {
  const name = encodeURIComponent(campaignName ?? 'matched-leads')
  return `${API_BASE_URL}/mailing/download?match_id=${matchId}&campaign_name=${name}&export_type=matched`
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
  return `${API_BASE_URL}/campaigns/${id}/download`
}

export default api
