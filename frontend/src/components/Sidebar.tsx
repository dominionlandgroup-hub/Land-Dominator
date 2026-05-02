import React, { useState } from 'react'
import { useApp } from '../context/AppContext'
import type { AppPage } from '../types'

const IconGuide = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
    <line x1="12" y1="17" x2="12.01" y2="17"/>
  </svg>
)

// ── Icons ───────────────────────────────────────────────────────────────────

const IconDashboard = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
    <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
  </svg>
)

const IconCampaign = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
  </svg>
)

const IconInbox = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/>
    <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>
  </svg>
)

const IconBoard = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="6" height="18" rx="1"/>
    <rect x="9" y="7" width="6" height="14" rx="1"/>
    <rect x="16" y="11" width="6" height="10" rx="1"/>
  </svg>
)

const IconHome = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
    <polyline points="9 22 9 12 15 12 15 22"/>
  </svg>
)

const IconPerson = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
    <circle cx="12" cy="7" r="4"/>
  </svg>
)

const IconPipeline = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="5" r="3"/><line x1="12" y1="8" x2="12" y2="12"/>
    <circle cx="5" cy="17" r="3"/><circle cx="19" cy="17" r="3"/>
    <path d="M12 12 L5 14"/><path d="M12 12 L19 14"/>
  </svg>
)

const IconUpload = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="17 8 12 3 7 8"/>
    <line x1="12" y1="3" x2="12" y2="15"/>
  </svg>
)

const IconCalendar = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
    <line x1="16" y1="2" x2="16" y2="6"/>
    <line x1="8" y1="2" x2="8" y2="6"/>
    <line x1="3" y1="10" x2="21" y2="10"/>
  </svg>
)

const IconSettings = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>
)

const IconChevronDown = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9"/>
  </svg>
)

const IconChevronRight = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6"/>
  </svg>
)

// ── Constants ────────────────────────────────────────────────────────────────

const SIDEBAR_BG = '#1A0A2E'
const ACTIVE_GOLD = '#FFFFFF'
const TEXT_DEFAULT = 'rgba(232,213,245,0.65)'
const TEXT_ACTIVE = '#FFFFFF'
const HOVER_BG = 'rgba(124,58,237,0.15)'
const ACTIVE_BG = '#7C3AED'

const BOARD_SUBITEMS: { id: AppPage; label: string }[] = [
  { id: 'boards-seller', label: 'Seller Deals' },
  { id: 'boards-buyer',  label: 'Buyer Deals' },
  { id: 'boards-inventory', label: 'Inventory' },
]

// ── NavButton ────────────────────────────────────────────────────────────────

function NavBtn({
  id,
  label,
  icon,
  active,
  onClick,
  indent = false,
  rightEl,
}: {
  id: AppPage
  label: string
  icon?: React.ReactNode
  active: boolean
  onClick: () => void
  indent?: boolean
  rightEl?: React.ReactNode
}) {
  const [hovered, setHovered] = React.useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="w-full flex items-center gap-2.5 rounded-lg text-left transition-all duration-150"
      style={{
        padding: indent ? '6px 12px 6px 28px' : '7px 12px',
        background: active ? ACTIVE_BG : hovered ? HOVER_BG : 'transparent',
        color: active ? TEXT_ACTIVE : TEXT_DEFAULT,
        borderLeft: active ? `3px solid ${ACTIVE_GOLD}` : '3px solid transparent',
      }}
    >
      {icon && <span className="flex-none" style={{ opacity: active ? 1 : 0.75 }}>{icon}</span>}
      <span className="text-sm font-medium flex-1 truncate">{label}</span>
      {rightEl}
    </button>
  )
}

function SetupGuideBtn({ active, incompleteCount, onClick }: {
  active: boolean
  incompleteCount: number | null
  onClick: () => void
}) {
  const [hovered, setHovered] = React.useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="w-full flex items-center gap-2.5 rounded-lg text-left transition-all duration-150"
      style={{
        padding: '7px 12px',
        background: active ? ACTIVE_BG : hovered ? HOVER_BG : 'transparent',
        color: active ? TEXT_ACTIVE : TEXT_DEFAULT,
        borderLeft: active ? `3px solid ${ACTIVE_GOLD}` : '3px solid transparent',
      }}
    >
      <span className="flex-none" style={{ opacity: active ? 1 : 0.75 }}><IconGuide /></span>
      <span className="text-sm font-medium flex-1">Setup Guide</span>
      {incompleteCount !== null && incompleteCount > 0 && (
        <span style={{
          background: '#7C3AED', color: '#fff', borderRadius: 4,
          padding: '1px 6px', fontSize: 10, fontWeight: 600, lineHeight: '1.4',
          minWidth: 18, textAlign: 'center',
        }}>{incompleteCount}</span>
      )}
      {incompleteCount === 0 && (
        <span style={{ fontSize: 11, color: '#10B981', fontWeight: 600 }}>✓</span>
      )}
    </button>
  )
}

// ── Sidebar ──────────────────────────────────────────────────────────────────

export default function Sidebar() {
  const { currentPage, setCurrentPage, compsStats, targetStats, matchResult, unreadCount,
          showSetupGuide, setShowSetupGuide, dashboardData, campaigns, loadingCampaigns } = useApp()
  const [boardsOpen, setBoardsOpen] = useState(
    ['boards-seller', 'boards-buyer', 'boards-inventory'].includes(currentPage)
  )

  function setupIncomplete(): number | null {
    if (loadingCampaigns) return null
    let done = 2 // steps 1 & 2 always complete
    if (dashboardData?.top_states?.length || dashboardData?.top_counties?.length) done++
    if (compsStats?.valid_rows && compsStats.valid_rows > 0) done++
    if (campaigns.length > 0) done++
    if (campaigns.some(c => (c.cost_per_piece ?? 0) > 0)) done++
    return 6 - done
  }
  const incompleteCount = setupIncomplete()

  const boardsActive = ['boards-seller', 'boards-buyer', 'boards-inventory'].includes(currentPage)

  function nav(page: AppPage) {
    setCurrentPage(page)
  }

  return (
    <aside
      className="w-60 min-h-screen flex flex-col shrink-0"
      style={{ background: SIDEBAR_BG, borderRight: '1px solid rgba(255,255,255,0.06)' }}
    >
      {/* Logo */}
      <div className="px-4 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex items-center justify-center rounded-lg px-3 py-2" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>
          <img src="/logo.png" alt="Logo" className="h-10 w-auto object-contain" />
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">

        <NavBtn id="crm-dashboard" label="Dashboard"    icon={<IconDashboard />} active={currentPage === 'crm-dashboard'} onClick={() => nav('crm-dashboard')} />
        <NavBtn id="seller-inbox"  label="Seller Inbox" icon={<IconInbox />}     active={currentPage === 'seller-inbox'}  onClick={() => nav('seller-inbox')}
          rightEl={unreadCount > 0 ? (
            <span style={{
              background: '#DC2626', color: '#fff', borderRadius: 10,
              padding: '1px 6px', fontSize: 10, fontWeight: 700, lineHeight: '1.4', minWidth: 18, textAlign: 'center',
            }}>{unreadCount > 99 ? '99+' : unreadCount}</span>
          ) : undefined}
        />
        <NavBtn id="buyer-inbox"   label="Buyer Inbox"   icon={<IconInbox />}     active={currentPage === 'buyer-inbox'}   onClick={() => nav('buyer-inbox')} />

        {/* Boards accordion */}
        <button
          onClick={() => setBoardsOpen((v) => !v)}
          className="w-full flex items-center gap-2.5 rounded-lg text-left transition-all duration-150"
          style={{
            padding: '7px 12px',
            background: boardsActive ? ACTIVE_BG : 'transparent',
            color: boardsActive ? TEXT_ACTIVE : TEXT_DEFAULT,
            borderLeft: boardsActive ? `3px solid ${ACTIVE_GOLD}` : '3px solid transparent',
          }}
          onMouseEnter={(e) => { if (!boardsActive) (e.currentTarget as HTMLElement).style.background = HOVER_BG }}
          onMouseLeave={(e) => { if (!boardsActive) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
        >
          <span className="flex-none" style={{ opacity: boardsActive ? 1 : 0.75 }}><IconBoard /></span>
          <span className="text-sm font-medium flex-1">Boards</span>
          <span style={{ opacity: 0.5, transition: 'transform 0.15s', transform: boardsOpen ? 'rotate(0deg)' : 'rotate(-90deg)', display: 'inline-flex' }}>
            <IconChevronDown />
          </span>
        </button>

        {boardsOpen && BOARD_SUBITEMS.map((sub) => (
          <NavBtn
            key={sub.id}
            id={sub.id}
            label={sub.label}
            active={currentPage === sub.id}
            onClick={() => nav(sub.id)}
            indent
          />
        ))}

        <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', margin: '6px 4px' }} />

        <NavBtn id="crm-campaigns"  label="Campaigns"      icon={<IconCampaign />} active={currentPage === 'crm-campaigns'}  onClick={() => nav('crm-campaigns')} />
        <NavBtn id="mail-calendar" label="Mail Calendar"  icon={<IconCalendar />} active={currentPage === 'mail-calendar'}  onClick={() => nav('mail-calendar')} />
        <NavBtn id="crm-properties" label="Properties"     icon={<IconHome />}     active={currentPage === 'crm-properties'} onClick={() => nav('crm-properties')} />
        <NavBtn id="crm-contacts"   label="Contacts"       icon={<IconPerson />}   active={currentPage === 'crm-contacts'}   onClick={() => nav('crm-contacts')} />
        <NavBtn id="crm-deals"      label="Deals Pipeline" icon={<IconPipeline />} active={currentPage === 'crm-deals'}      onClick={() => nav('crm-deals')} />

        <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', margin: '6px 4px' }} />

        <NavBtn id="upload-comps" label="Upload Comps" icon={<IconUpload />}   active={currentPage === 'upload-comps' || currentPage === 'dashboard' || currentPage === 'match-targets'} onClick={() => nav('upload-comps')} />

        {/* Setup Guide — opens drawer, not a page */}
        <SetupGuideBtn
          active={showSetupGuide}
          incompleteCount={incompleteCount}
          onClick={() => setShowSetupGuide(!showSetupGuide)}
        />

        <NavBtn id="settings"     label="Settings"     icon={<IconSettings />} active={currentPage === 'settings'}     onClick={() => nav('settings')} />
      </nav>

      {/* Session status footer — shown only when workflow data is loaded */}
      {(compsStats || targetStats || matchResult) && (
        <div className="px-3 py-3 space-y-1.5" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <p style={{ fontSize: '9px', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(232,213,245,0.35)', marginBottom: '4px' }}>
            Session
          </p>
          {compsStats && (
            <StatusRow label="Comps" value={`${compsStats.total_rows.toLocaleString()} rows`} />
          )}
          {targetStats && (
            <StatusRow label="Targets" value={`${targetStats.total_rows.toLocaleString()} rows`} />
          )}
          {matchResult && (
            <StatusRow label="Match" value={`${matchResult.matched_count.toLocaleString()} matched`} />
          )}
        </div>
      )}
    </aside>
  )
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span style={{ fontSize: '10px', color: 'rgba(232,213,245,0.45)' }}>{label}</span>
      <span style={{ fontSize: '10px', color: '#E8D5F5', background: 'rgba(124,58,237,0.2)', border: '1px solid rgba(124,58,237,0.3)', borderRadius: '4px', padding: '1px 6px' }}>
        {value}
      </span>
    </div>
  )
}
