import React, { createContext, useContext, useState, useCallback } from 'react'
import type { ReactNode } from 'react'
import type {
  UploadStats,
  DashboardData,
  MatchFilters,
  MatchResult,
  MailingPreview,
  AppPage,
} from '../types'

interface AppState {
  // Comps
  compsStats: UploadStats | null
  setCompsStats: (s: UploadStats | null) => void

  // Dashboard
  dashboardData: DashboardData | null
  setDashboardData: (d: DashboardData | null) => void

  // Targets
  targetStats: UploadStats | null
  setTargetStats: (s: UploadStats | null) => void

  // Match results
  matchResult: MatchResult | null
  setMatchResult: (r: MatchResult | null) => void

  // Last filters used (for "Duplicate Settings" in Campaigns)
  lastFilters: Partial<MatchFilters> | null
  setLastFilters: (f: Partial<MatchFilters> | null) => void

  // Mailing preview
  mailingPreview: MailingPreview | null
  setMailingPreview: (m: MailingPreview | null) => void

  // Navigation
  currentPage: AppPage
  setCurrentPage: (p: AppPage) => void

  // Properties campaign pre-filter (set by CRM Campaigns page before navigating)
  propertyCampaignId: string | null
  setPropertyCampaignId: (id: string | null) => void
}

const AppContext = createContext<AppState | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [compsStats, setCompsStats] = useState<UploadStats | null>(null)
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null)
  const [targetStats, setTargetStats] = useState<UploadStats | null>(null)
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null)
  const [lastFilters, setLastFilters] = useState<Partial<MatchFilters> | null>(null)
  const [mailingPreview, setMailingPreview] = useState<MailingPreview | null>(null)
  const [currentPage, setCurrentPage] = useState<AppPage>('crm-dashboard')
  const [propertyCampaignId, setPropertyCampaignId] = useState<string | null>(null)

  const value: AppState = {
    compsStats,
    setCompsStats: useCallback((s) => setCompsStats(s), []),
    dashboardData,
    setDashboardData: useCallback((d) => setDashboardData(d), []),
    targetStats,
    setTargetStats: useCallback((s) => setTargetStats(s), []),
    matchResult,
    setMatchResult: useCallback((r) => setMatchResult(r), []),
    lastFilters,
    setLastFilters: useCallback((f) => setLastFilters(f), []),
    mailingPreview,
    setMailingPreview: useCallback((m) => setMailingPreview(m), []),
    currentPage,
    setCurrentPage: useCallback((p) => setCurrentPage(p), []),
    propertyCampaignId,
    setPropertyCampaignId: useCallback((id) => setPropertyCampaignId(id), []),
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppState {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
