import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import type {
  UploadStats,
  ListingsStats,
  DashboardData,
  MatchFilters,
  MatchResult,
  MailingPreview,
  AppPage,
} from '../types'
import { restoreLatestCompsSession, restoreLatestTargetSession, fetchDashboard } from '../api/client'
import { getUnreadCount, listCrmCampaigns, getNewDealCount } from '../api/crm'

const LS_COMPS_KEY = 'ld_comps_stats'
const LS_TARGET_KEY = 'ld_target_stats'

interface AppState {
  // Comps
  compsStats: UploadStats | null
  setCompsStats: (s: UploadStats | null) => void
  compsRestoring: boolean

  // Dashboard
  dashboardData: DashboardData | null
  setDashboardData: (d: DashboardData | null) => void

  // Active listings / market velocity
  listingsStats: ListingsStats | null
  setListingsStats: (s: ListingsStats | null) => void

  // Targets
  targetStats: UploadStats | null
  setTargetStats: (s: UploadStats | null) => void
  targetRestoring: boolean

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

  // Unread inbox count (polled every 30s)
  unreadCount: number
  setUnreadCount: (n: number) => void

  // New deal count for sidebar badge (polled every 60s)
  newDealCount: number

  // Setup Guide drawer
  showSetupGuide: boolean
  setShowSetupGuide: (v: boolean) => void

  // Campaigns (used for setup guide step tracking)
  campaigns: { id: string; name?: string; cost_per_piece?: number }[]
  loadingCampaigns: boolean
  refreshCampaigns: () => void
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
  const [listingsStats, setListingsStats] = useState<ListingsStats | null>(() => {
    try {
      const cached = localStorage.getItem('ld_listings_stats')
      return cached ? JSON.parse(cached) : null
    } catch { return null }
  })
  const [targetStats, _setTargetStats] = useState<UploadStats | null>(() => {
    try {
      const cached = localStorage.getItem(LS_TARGET_KEY)
      return cached ? JSON.parse(cached) : null
    } catch { return null }
  })
  const [targetRestoring, setTargetRestoring] = useState(false)
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null)
  const [lastFilters, setLastFilters] = useState<Partial<MatchFilters> | null>(null)
  const [mailingPreview, setMailingPreview] = useState<MailingPreview | null>(null)
  const [currentPage, setCurrentPage] = useState<AppPage>('crm-dashboard')
  const [propertyCampaignId, setPropertyCampaignId] = useState<string | null>(null)
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null)
  const [unreadCount, setUnreadCount] = useState(0)
  const [newDealCount, setNewDealCount] = useState(0)
  const [showSetupGuide, setShowSetupGuide] = useState(false)
  const [campaigns, setCampaigns] = useState<{ id: string; name?: string; cost_per_piece?: number }[]>([])
  const [loadingCampaigns, setLoadingCampaigns] = useState(true)

  const setCompsStats = useCallback((s: UploadStats | null) => {
    _setCompsStats(s)
    if (s) {
      try { localStorage.setItem(LS_COMPS_KEY, JSON.stringify(s)) } catch {}
    } else {
      try { localStorage.removeItem(LS_COMPS_KEY) } catch {}
    }
  }, [])

  const setTargetStats = useCallback((s: UploadStats | null) => {
    _setTargetStats(s)
    if (s) {
      try { localStorage.setItem(LS_TARGET_KEY, JSON.stringify(s)) } catch {}
    } else {
      try { localStorage.removeItem(LS_TARGET_KEY) } catch {}
    }
  }, [])

  // Poll unread count every 30s
  const pollUnreadRef = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => {
    const poll = () => getUnreadCount().then(setUnreadCount).catch(() => {})
    poll()
    pollUnreadRef.current = setInterval(poll, 30000)
    return () => { if (pollUnreadRef.current) clearInterval(pollUnreadRef.current) }
  }, [])

  // Poll new deal count every 60s
  const pollDealRef = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => {
    const poll = () => getNewDealCount().then(setNewDealCount).catch(() => {})
    poll()
    pollDealRef.current = setInterval(poll, 60000)
    return () => { if (pollDealRef.current) clearInterval(pollDealRef.current) }
  }, [])

  const refreshCampaigns = useCallback(() => {
    setLoadingCampaigns(true)
    listCrmCampaigns()
      .then(list => setCampaigns(list as { id: string; name?: string; cost_per_piece?: number }[]))
      .catch(() => {})
      .finally(() => setLoadingCampaigns(false))
  }, [])

  useEffect(() => { refreshCampaigns() }, [refreshCampaigns])

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

  // Auto-restore target session from Supabase Storage on app load
  const targetRestoreRan = useRef(false)
  useEffect(() => {
    if (targetRestoreRan.current) return
    targetRestoreRan.current = true

    // Only attempt restore if localStorage suggests there was a previous session
    const cached = (() => { try { const v = localStorage.getItem(LS_TARGET_KEY); return v ? JSON.parse(v) : null } catch { return null } })()
    if (!cached) return

    setTargetRestoring(true)
    restoreLatestTargetSession()
      .then(stats => {
        _setTargetStats(stats)
        try { localStorage.setItem(LS_TARGET_KEY, JSON.stringify(stats)) } catch {}
      })
      .catch(() => {
        // Restore failed — keep the stale stats for display but session_id is invalid
        // MatchTargets will handle this by showing re-upload prompt
      })
      .finally(() => setTargetRestoring(false))
  }, [])

  const value: AppState = {
    compsStats,
    setCompsStats,
    compsRestoring,
    dashboardData,
    setDashboardData: useCallback((d) => setDashboardData(d), []),
    listingsStats,
    setListingsStats: useCallback((s: ListingsStats | null) => {
      setListingsStats(s)
      if (s) { try { localStorage.setItem('ld_listings_stats', JSON.stringify(s)) } catch {} }
      else { try { localStorage.removeItem('ld_listings_stats') } catch {} }
    }, []),
    targetStats,
    setTargetStats,
    targetRestoring,
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
    unreadCount,
    setUnreadCount: useCallback((n) => setUnreadCount(n), []),
    newDealCount,
    showSetupGuide,
    setShowSetupGuide: useCallback((v) => setShowSetupGuide(v), []),
    campaigns,
    loadingCampaigns,
    refreshCampaigns,
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppState {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
