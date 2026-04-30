import React, { useState } from 'react'
import { useApp } from '../context/AppContext'
import type { AppPage } from '../types'

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

const SIDEBAR_BG = '#3D1A6E'
const ACTIVE_GOLD = '#D5A940'
const TEXT_DEFAULT = 'rgba(232,213,245,0.85)'
const TEXT_ACTIVE = '#D5A940'
const HOVER_BG = 'rgba(213,169,64,0.1)'
const ACTIVE_BG = 'linear-gradient(90deg, rgba(213,169,64,0.18) 0%, transparent 100%)'

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

// ── Sidebar ──────────────────────────────────────────────────────────────────

export default function Sidebar() {
  const { currentPage, setCurrentPage, compsStats, targetStats, matchResult } = useApp()
  const [boardsOpen, setBoardsOpen] = useState(
    ['boards-seller', 'boards-buyer', 'boards-inventory'].includes(currentPage)
  )

  const boardsActive = ['boards-seller', 'boards-buyer', 'boards-inventory'].includes(currentPage)

  function nav(page: AppPage) {
    setCurrentPage(page)
  }

  return (
    <aside
      className="w-60 min-h-screen flex flex-col shrink-0"
      style={{ background: SIDEBAR_BG, borderRight: '1px solid rgba(92,41,119,0.4)' }}
    >
      {/* Logo */}
      <div className="px-4 py-3" style={{ borderBottom: '1px solid rgba(213,169,64,0.15)' }}>
        <div className="flex items-center justify-center rounded-xl px-3 py-2" style={{ background: '#fff' }}>
          <img src="/logo.png" alt="Logo" className="h-12 w-auto object-contain" />
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">

        <NavBtn id="crm-dashboard" label="Dashboard"     icon={<IconDashboard />} active={currentPage === 'crm-dashboard'} onClick={() => nav('crm-dashboard')} />
        <NavBtn id="campaigns"     label="Campaigns"     icon={<IconCampaign />}  active={currentPage === 'campaigns'}     onClick={() => nav('campaigns')} />
        <NavBtn id="seller-inbox"  label="Seller Inbox"  icon={<IconInbox />}     active={currentPage === 'seller-inbox'}  onClick={() => nav('seller-inbox')} />
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

        <div style={{ borderTop: '1px solid rgba(213,169,64,0.1)', margin: '6px 4px' }} />

        <NavBtn id="crm-campaigns"  label="Campaigns"      icon={<IconCampaign />} active={currentPage === 'crm-campaigns'}  onClick={() => nav('crm-campaigns')} />
        <NavBtn id="crm-properties" label="Properties"     icon={<IconHome />}     active={currentPage === 'crm-properties'} onClick={() => nav('crm-properties')} />
        <NavBtn id="crm-contacts"   label="Contacts"       icon={<IconPerson />}   active={currentPage === 'crm-contacts'}   onClick={() => nav('crm-contacts')} />
        <NavBtn id="crm-deals"      label="Deals Pipeline" icon={<IconPipeline />} active={currentPage === 'crm-deals'}      onClick={() => nav('crm-deals')} />

        <div style={{ borderTop: '1px solid rgba(213,169,64,0.1)', margin: '6px 4px' }} />

        <NavBtn id="upload-comps" label="Upload Comps" icon={<IconUpload />}   active={currentPage === 'upload-comps' || currentPage === 'dashboard' || currentPage === 'match-targets' || currentPage === 'mailing-list'} onClick={() => nav('upload-comps')} />
        <NavBtn id="settings"     label="Settings"     icon={<IconSettings />} active={currentPage === 'settings'}     onClick={() => nav('settings')} />
      </nav>

      {/* Session status footer — shown only when workflow data is loaded */}
      {(compsStats || targetStats || matchResult) && (
        <div className="px-3 py-3 space-y-1.5" style={{ borderTop: '1px solid rgba(213,169,64,0.12)' }}>
          <p style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(155,138,174,0.7)', marginBottom: '4px' }}>
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
      <span style={{ fontSize: '10px', color: 'rgba(155,138,174,0.7)' }}>{label}</span>
      <span style={{ fontSize: '10px', color: ACTIVE_GOLD, background: 'rgba(213,169,64,0.1)', border: '1px solid rgba(213,169,64,0.2)', borderRadius: '9999px', padding: '1px 7px' }}>
        {value}
      </span>
    </div>
  )
}
