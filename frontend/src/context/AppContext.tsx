import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import type {
  UploadStats,
  DashboardData,
  MatchFilters,
  MatchResult,
  MailingPreview,
  AppPage,
} from '../types'
import { restoreLatestCompsSession, fetchDashboard } from '../api/client'

const LS_COMPS_KEY = 'ld_comps_stats'

interface AppState {
  // Comps
  compsStats: UploadStats | null
  setCompsStats: (s: UploadStats | null) => void
  compsRestoring: boolean

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

  // Pre-select a specific property when navigating to crm-properties
  selectedPropertyId: string | null
  setSelectedPropertyId: (id: string | null) => void
}

const AppContext = createContext<AppState | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  // Seed from localStorage immediately so UI doesn't flash "upload comps"
  const [compsStats, _setCompsStats] = useState<UploadStats | null>(() => {
    try {
      const cached = localStorage.getItem(LS_COMPS_KEY)
      return cached ? JSON.parse(cached) : null
    } catch {
      return null
    }
  })
  const [compsRestoring, setCompsRestoring] = useState(true)
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null)
  const [targetStats, setTargetStats] = useState<UploadStats | null>(null)
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null)
  const [lastFilters, setLastFilters] = useState<Partial<MatchFilters> | null>(null)
  const [mailingPreview, setMailingPreview] = useState<MailingPreview | null>(null)
  const [currentPage, setCurrentPage] = useState<AppPage>('crm-dashboard')
  const [propertyCampaignId, setPropertyCampaignId] = useState<string | null>(null)
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null)

  const setCompsStats = useCallback((s: UploadStats | null) => {
    _setCompsStats(s)
    if (s) {
      try { localStorage.setItem(LS_COMPS_KEY, JSON.stringify(s)) } catch {}
    } else {
      try { localStorage.removeItem(LS_COMPS_KEY) } catch {}
    }
  }, [])

  // Auto-restore comps session from Supabase Storage on app load
  const restoreRan = useRef(false)
  useEffect(() => {
    if (restoreRan.current) return
    restoreRan.current = true

    restoreLatestCompsSession()
      .then(stats => {
        _setCompsStats(stats)
        try { localStorage.setItem(LS_COMPS_KEY, JSON.stringify(stats)) } catch {}
        return fetchDashboard(stats.session_id)
      })
      .then(dashboard => {
        setDashboardData(dashboard)
      })
      .catch(() => {
        // No persisted comps — clear stale cache
        try { localStorage.removeItem(LS_COMPS_KEY) } catch {}
        _setCompsStats(null)
      })
      .finally(() => {
        setCompsRestoring(false)
      })
  }, [])

  const value: AppState = {
    compsStats,
    setCompsStats,
    compsRestoring,
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
    selectedPropertyId,
    setSelectedPropertyId: useCallback((id) => setSelectedPropertyId(id), []),
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppState {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
