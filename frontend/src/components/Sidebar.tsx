import React from 'react'
import { useApp } from '../context/AppContext'
import type { AppPage } from '../types'

interface NavItem {
  id: AppPage
  label: string
  step: number
  icon: React.ReactNode
  requiresComps?: boolean
  requiresTargets?: boolean
  requiresMatch?: boolean
}

// ── SVG Icons ──────────────────────────────────────────────────────────────
const IconUpload = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="17 8 12 3 7 8"/>
    <line x1="12" y1="3" x2="12" y2="15"/>
  </svg>
)

const IconChart = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="20" x2="18" y2="10"/>
    <line x1="12" y1="20" x2="12" y2="4"/>
    <line x1="6" y1="20" x2="6" y2="14"/>
    <line x1="2" y1="20" x2="22" y2="20"/>
  </svg>
)

const IconTarget = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <circle cx="12" cy="12" r="6"/>
    <circle cx="12" cy="12" r="2"/>
  </svg>
)

const IconMail = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
    <polyline points="22,6 12,13 2,6"/>
  </svg>
)

const IconFolder = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
  </svg>
)

const IconCheck = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
)

const NAV_ITEMS: NavItem[] = [
  { id: 'upload-comps',  label: 'Upload Comps',  step: 1, icon: <IconUpload /> },
  { id: 'dashboard',     label: 'ZIP Dashboard', step: 2, icon: <IconChart />,  requiresComps: true },
  { id: 'match-targets', label: 'Match Targets', step: 3, icon: <IconTarget />, requiresComps: true },
  { id: 'mailing-list',  label: 'Mailing List',  step: 4, icon: <IconMail />,   requiresMatch: true },
  { id: 'campaigns',     label: 'Campaigns',     step: 5, icon: <IconFolder /> },
]

export default function Sidebar() {
  const { currentPage, setCurrentPage, compsStats, targetStats, matchResult } = useApp()

  function isUnlocked(item: NavItem): boolean {
    if (item.requiresMatch && !matchResult) return false
    if (item.requiresComps && !compsStats) return false
    return true
  }

  function getStatus(item: NavItem): 'active' | 'complete' | 'locked' | 'available' {
    if (currentPage === item.id) return 'active'
    if (!isUnlocked(item)) return 'locked'
    if (item.id === 'upload-comps' && compsStats) return 'complete'
    if (item.id === 'dashboard' && matchResult) return 'complete'
    if (item.id === 'match-targets' && matchResult) return 'complete'
    if (item.id === 'match-targets' && targetStats) return 'complete'
    return 'available'
  }

  return (
    <aside className="w-64 min-h-screen flex flex-col shrink-0" style={{ background: '#3D1A5C', borderRight: '1px solid #5C2977' }}>
      {/* Logo */}
      <div className="px-5 py-5" style={{ borderBottom: '1px solid rgba(213,169,64,0.2)' }}>
        <div className="flex items-center gap-3" style={{ background: '#2A0F42' }}>
          <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #5C2977 0%, #3D1A55 100%)' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#D5A940" strokeWidth="2.5">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              <polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight" style={{ color: '#E8D5F5' }}>Land Specialists</div>
            <div className="text-xs" style={{ color: '#9B8AAE' }}>Analysis Tool</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-3 space-y-0.5">
        {NAV_ITEMS.map((item) => {
          const status = getStatus(item)
          const locked = status === 'locked'
          const active = status === 'active'
          const complete = status === 'complete'

          return (
            <button
              key={item.id}
              onClick={() => !locked && setCurrentPage(item.id)}
              disabled={locked}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all duration-150 relative"
              style={{
                background: active ? 'linear-gradient(90deg, rgba(213,169,64,0.2) 0%, transparent 100%)' : 'transparent',
                color: locked ? '#5C2977' : active ? '#D5A940' : complete ? '#E8D5F5' : '#E8D5F5',
                cursor: locked ? 'not-allowed' : 'pointer',
                borderLeft: active ? '3px solid #D5A940' : '3px solid transparent',
              }}
              onMouseEnter={(e) => {
                if (!locked && !active) {
                  (e.currentTarget as HTMLElement).style.background = 'rgba(213,169,64,0.12)'
                  ;(e.currentTarget as HTMLElement).style.color = '#E8D5F5'
                }
              }}
              onMouseLeave={(e) => {
                if (!locked && !active) {
                  (e.currentTarget as HTMLElement).style.background = 'transparent'
                  ;(e.currentTarget as HTMLElement).style.color = complete ? '#E8D5F5' : '#E8D5F5'
                }
              }}
            >
              {/* Step indicator */}
              <span
                className="flex-none w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold"
                style={{
                  background: active
                    ? '#D5A940'
                    : complete
                    ? '#D5A940'
                    : locked
                    ? '#2A0F42'
                    : 'rgba(232,213,245,0.15)',
                  color: active ? '#3D1A5C' : complete ? '#3D1A5C' : locked ? '#5C2977' : 'rgba(232,213,245,0.4)',
                  boxShadow: active ? '0 0 0 3px rgba(213,169,64,0.35)' : 'none',
                }}
              >
                {complete ? <IconCheck /> : item.step}
              </span>

              {/* Icon */}
              <span className="flex-none opacity-80">{item.icon}</span>

              {/* Label */}
              <span className="text-sm font-medium truncate">{item.label}</span>
            </button>
          )
        })}
      </nav>

      {/* Status footer */}
      <div className="p-4 space-y-2" style={{ borderTop: '1px solid rgba(213,169,64,0.2)' }}>
        <StatusRow
          label="Comps"
          value={compsStats ? `${compsStats.total_rows.toLocaleString()} rows` : 'Not loaded'}
          active={!!compsStats}
        />
        <StatusRow
          label="Targets"
          value={targetStats ? `${targetStats.total_rows.toLocaleString()} rows` : 'Not loaded'}
          active={!!targetStats}
        />
        <StatusRow
          label="Match"
          value={matchResult ? `${matchResult.matched_count.toLocaleString()} matched` : 'Not run'}
          active={!!matchResult}
        />
      </div>
    </aside>
  )
}

function StatusRow({ label, value, active }: { label: string; value: string; active: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs" style={{ color: '#9B8AAE' }}>{label}</span>
      <span
        className="text-xs px-2 py-0.5 rounded-full"
        style={
          active
            ? { background: 'rgba(213,169,64,0.15)', color: '#D5A940', border: '1px solid rgba(213,169,64,0.3)' }
            : { background: '#2A0F42', color: '#9B8AAE', border: '1px solid rgba(232,213,245,0.1)' }
        }
      >
        {value}
      </span>
    </div>
  )
}
