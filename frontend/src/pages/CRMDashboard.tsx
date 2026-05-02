import React, { useEffect, useState } from 'react'
import { useApp } from '../context/AppContext'
import { listProperties, listDeals, getCommStats } from '../api/crm'
import { listCampaigns } from '../api/client'
import type { CRMProperty, CRMDeal, CommStats } from '../types/crm'
import type { Campaign, AppPage } from '../types'

// ── Stat helpers ─────────────────────────────────────────────────────────────

function computeStats(properties: CRMProperty[], deals: CRMDeal[]) {
  const dealsAdded = deals.length
  const offersMade = properties.filter(
    (p) => p.status === 'offer_sent'
  ).length
  const purchased = properties.filter(
    (p) => p.purchase_price != null && p.purchase_price > 0
  )
  const sold = properties.filter(
    (p) => p.sale_price != null && p.sale_price > 0
  )
  const totalPurchase = purchased.reduce((s, p) => s + (p.purchase_price ?? 0), 0)
  const totalSale = sold.reduce((s, p) => s + (p.sale_price ?? 0), 0)
  const roi = totalPurchase > 0 ? Math.round(((totalSale - totalPurchase) / totalPurchase) * 100) : 0
  return {
    dealsAdded,
    offersMade,
    propertiesPurchased: purchased.length,
    propertiesSold: sold.length,
    roi,
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string
  value: string | number
  sub?: string
  accentColor: string
  icon: React.ReactNode
}

// ── Components ───────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, accentColor, icon }: StatCardProps) {
  return (
    <div
      className="rounded-lg p-5"
      style={{
        borderTop: `4px solid ${accentColor}`,
        border: '1px solid #2E2E2E',
        borderTopColor: accentColor,
        borderTopWidth: '4px',
        background: '#1A1A1A',
      }}
    >
      <div className="flex items-start justify-between mb-3">
        <p style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: '#6B6B6B' }}>
          {label}
        </p>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${accentColor}18`, color: accentColor }}>
          {icon}
        </div>
      </div>
      <p className="text-2xl font-bold" style={{ color: '#F5F5F5' }}>{value}</p>
      {sub && <p className="text-xs mt-1" style={{ color: '#A0A0A0' }}>{sub}</p>}
    </div>
  )
}

function TableCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg" style={{ border: '1px solid #2E2E2E', background: '#1A1A1A' }}>
      <div className="px-5 py-4" style={{ borderBottom: '1px solid #2E2E2E' }}>
        <h2 className="font-semibold text-sm" style={{ color: '#F5F5F5' }}>{title}</h2>
      </div>
      <div className="overflow-x-auto">
        {children}
      </div>
    </div>
  )
}

// ── Icons ─────────────────────────────────────────────────────────────────────

const IconDeals = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
const IconOffer = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
const IconBuy = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
const IconSell = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
const IconROI = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>

// ── Main ─────────────────────────────────────────────────────────────────────

const IconInbox = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/>
    <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>
  </svg>
)

export default function CRMDashboard() {
  const { setCurrentPage, unreadCount, setShowSetupGuide, compsStats, dashboardData,
          campaigns: ctxCampaigns, loadingCampaigns } = useApp()
  const [properties, setProperties] = useState<CRMProperty[]>([])
  const [deals, setDeals] = useState<CRMDeal[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [commStats, setCommStats] = useState<CommStats | null>(null)
  const [quickStartDismissed, setQuickStartDismissed] = useState(() => {
    try { return localStorage.getItem('ld_quickstart_dismissed') === '1' } catch { return false }
  })

  function dismissQuickStart() {
    try { localStorage.setItem('ld_quickstart_dismissed', '1') } catch {}
    setQuickStartDismissed(true)
  }

  function setupComplete(): number {
    let done = 2
    if (dashboardData?.top_states?.length || dashboardData?.top_counties?.length) done++
    if (compsStats?.valid_rows && compsStats.valid_rows > 0) done++
    if (ctxCampaigns.length > 0) done++
    if (ctxCampaigns.some(c => (c.cost_per_piece ?? 0) > 0)) done++
    return done
  }
  const completedSteps = loadingCampaigns ? null : setupComplete()
  const showQuickStart = !quickStartDismissed && completedSteps !== null && completedSteps < 6

  useEffect(() => {
    Promise.all([
      listProperties({ limit: 500 }).then(r => r.data).catch(() => [] as CRMProperty[]),
      listDeals().catch(() => [] as CRMDeal[]),
      listCampaigns().catch(() => [] as Campaign[]),
    ]).then(([props, dls, camps]) => {
      setProperties(props as CRMProperty[])
      setDeals(dls)
      setCampaigns(camps)
      setLoading(false)
    })
    getCommStats().then(setCommStats).catch(() => {})
  }, [])

  const stats = computeStats(properties, deals)

  const STAT_CARDS: StatCardProps[] = [
    { label: 'Deals Added',           value: stats.dealsAdded,           sub: 'total in pipeline',       accentColor: '#7C3AED', icon: <IconDeals /> },
    { label: 'Offers Made',           value: stats.offersMade,           sub: 'across all properties',   accentColor: '#D5A940', icon: <IconOffer /> },
    { label: 'Properties Purchased',  value: stats.propertiesPurchased,  sub: 'with purchase price set', accentColor: '#10B981', icon: <IconBuy /> },
    { label: 'Properties Sold',       value: stats.propertiesSold,       sub: 'with sale price set',     accentColor: '#4A90D9', icon: <IconSell /> },
    { label: 'ROI',                   value: `${stats.roi}%`,            sub: 'sale vs purchase total',  accentColor: stats.roi >= 0 ? '#10B981' : '#EF4444', icon: <IconROI /> },
  ]

  return (
    <div className="flex flex-col min-h-screen" style={{ background: '#0F0F0F' }}>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="text-lg font-bold" style={{ color: '#F5F5F5' }}>Dashboard</h1>
          <p className="text-xs mt-0.5" style={{ color: '#6B6B6B' }}>
            Overview of your land investing activity
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-primary text-sm" onClick={() => setCurrentPage('crm-properties')}>
            + Add Property
          </button>
        </div>
      </div>

      <div className="p-6 max-w-[1300px] mx-auto w-full space-y-6">

        {/* Quick Start card */}
        {showQuickStart && (
          <div className="rounded-lg px-5 py-4" style={{ background: '#1A1A1A', border: '1.5px solid rgba(124,58,237,0.25)' }}>
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="font-semibold text-sm" style={{ color: '#F5F5F5' }}>
                  Quick Start — {completedSteps} of 6 steps complete
                </p>
                <p className="text-xs mt-0.5" style={{ color: '#A0A0A0' }}>
                  Complete these steps to send your first mailer
                </p>
              </div>
              <button
                onClick={dismissQuickStart}
                className="text-xs ml-4 flex-none"
                style={{ color: '#6B6B6B' }}
                title="Dismiss"
              >✕</button>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden mb-4" style={{ background: '#2E2E2E' }}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${((completedSteps ?? 0) / 6) * 100}%`, background: '#7C3AED' }}
              />
            </div>
            <button
              className="btn-primary text-sm"
              onClick={() => setShowSetupGuide(true)}
            >
              Continue Setup →
            </button>
          </div>
        )}

        {/* Stat cards */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {STAT_CARDS.map((card) => (
            <StatCard key={card.label} {...card} />
          ))}
        </div>

        {/* Unread Messages card — full width, clickable */}
        <div
          onClick={() => setCurrentPage('seller-inbox')}
          style={{
            cursor: 'pointer', borderRadius: 8, padding: '14px 20px', background: '#1A1A1A',
            border: `2px solid ${unreadCount > 0 ? '#EF4444' : '#2E2E2E'}`,
            display: 'flex', alignItems: 'center', gap: 16, transition: 'border-color 0.15s',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = unreadCount > 0 ? '#EF4444' : '#3E3E3E' }}
          onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = unreadCount > 0 ? '#EF4444' : '#2E2E2E' }}
        >
          <div style={{ width: 40, height: 40, borderRadius: 8, background: unreadCount > 0 ? 'rgba(239,68,68,0.12)' : '#242424', display: 'flex', alignItems: 'center', justifyContent: 'center', color: unreadCount > 0 ? '#EF4444' : '#7C3AED', flexShrink: 0 }}>
            <IconInbox />
          </div>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: '#6B6B6B', textTransform: 'uppercase', letterSpacing: '0.07em', margin: 0 }}>Unread Messages</p>
            <div className="flex items-baseline gap-2">
              <p style={{ fontSize: 28, fontWeight: 800, color: unreadCount > 0 ? '#EF4444' : '#F5F5F5', margin: 0, lineHeight: 1.2 }}>
                {unreadCount}
              </p>
              {unreadCount > 0 && (
                <span style={{ fontSize: 13, color: '#EF4444', fontWeight: 600 }}>
                  unread {unreadCount === 1 ? 'conversation' : 'conversations'}
                </span>
              )}
              {unreadCount === 0 && (
                <span style={{ fontSize: 13, color: '#A0A0A0' }}>all caught up</span>
              )}
            </div>
          </div>
          <span style={{ fontSize: 13, color: '#7C3AED', fontWeight: 600 }}>Open Inbox →</span>
        </div>

        {/* Campaign Report */}
        <TableCard title="Campaign Report">
          {loading ? (
            <div className="py-10 text-center text-sm" style={{ color: '#A0A0A0' }}>Loading…</div>
          ) : campaigns.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm" style={{ color: '#A0A0A0' }}>No campaigns yet.</p>
              <button className="mt-2 text-sm underline" style={{ color: '#7C3AED' }} onClick={() => setCurrentPage('campaigns')}>
                Go to Campaigns →
              </button>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid #2E2E2E', background: '#171717' }}>
                  {['Campaign Name', 'Amount Spent', 'Total Records', 'Total Deals', 'Response Rate', 'ROAS'].map((h) => (
                    <th key={h} className="px-5 py-3 text-left" style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#6B6B6B' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c, i) => {
                  const records = Number(c.stats?.['mailing_list_count'] ?? c.stats?.['matched_count'] ?? 0)
                  return (
                    <tr
                      key={c.id}
                      style={{ borderBottom: i < campaigns.length - 1 ? '1px solid #2E2E2E' : 'none', background: '#1A1A1A' }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#242424')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = '#1A1A1A')}
                    >
                      <td className="px-5 py-3 font-medium" style={{ color: '#F5F5F5' }}>{c.name}</td>
                      <td className="px-5 py-3" style={{ color: '#A0A0A0' }}>—</td>
                      <td className="px-5 py-3" style={{ color: '#F5F5F5' }}>{records > 0 ? records.toLocaleString() : '—'}</td>
                      <td className="px-5 py-3" style={{ color: '#A0A0A0' }}>—</td>
                      <td className="px-5 py-3" style={{ color: '#A0A0A0' }}>—</td>
                      <td className="px-5 py-3" style={{ color: '#A0A0A0' }}>—</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </TableCard>

        {/* Communication Report */}
        <TableCard title="Communication Report">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid #2E2E2E', background: '#171717' }}>
                {['Total Conversations', 'Calls', 'Texts Sent', 'Talk Time', 'HOT Leads (7d)', 'Inbox'].map((h) => (
                  <th key={h} className="px-5 py-3 text-left" style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#6B6B6B' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr style={{ background: '#1A1A1A' }}>
                <td className="px-5 py-4 font-semibold" style={{ color: '#F5F5F5' }}>
                  {commStats ? commStats.total_conversations.toLocaleString() : '—'}
                </td>
                <td className="px-5 py-4" style={{ color: '#A78BFA' }}>
                  {commStats ? commStats.calls_total.toLocaleString() : '—'}
                </td>
                <td className="px-5 py-4" style={{ color: '#A78BFA' }}>
                  {commStats ? commStats.texts_outbound.toLocaleString() : '—'}
                </td>
                <td className="px-5 py-4" style={{ color: '#F5F5F5' }}>
                  {commStats
                    ? commStats.talk_time_seconds > 0
                      ? `${Math.floor(commStats.talk_time_seconds / 60)}m ${commStats.talk_time_seconds % 60}s`
                      : '0m'
                    : '—'}
                </td>
                <td className="px-5 py-4 font-bold" style={{ color: commStats && commStats.hot_leads_this_week > 0 ? '#F59E0B' : '#A0A0A0' }}>
                  {commStats ? (commStats.hot_leads_this_week > 0 ? `🔥 ${commStats.hot_leads_this_week}` : '0') : '—'}
                </td>
                <td className="px-5 py-4">
                  <button
                    className="text-xs underline"
                    style={{ color: '#7C3AED' }}
                    onClick={() => setCurrentPage('seller-inbox')}
                  >
                    View Inbox →
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
          {!commStats && (
            <div className="px-5 py-3" style={{ borderTop: '1px solid #2E2E2E' }}>
              <p className="text-xs" style={{ color: '#A0A0A0' }}>
                Connect Telnyx to start tracking communication data. Set <code>TELNYX_API_KEY</code> and <code>TELNYX_PHONE_NUMBER</code> in Railway.
              </p>
            </div>
          )}
        </TableCard>

        {/* Quick links */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {([
            { label: 'View Properties', page: 'crm-properties', color: '#7C3AED' },
            { label: 'View Contacts',   page: 'crm-contacts',   color: '#4A90D9' },
            { label: 'Deals Pipeline',  page: 'crm-deals',      color: '#10B981' },
            { label: 'Campaigns',       page: 'campaigns',      color: '#D5A940' },
          ] as { label: string; page: AppPage; color: string }[]).map(({ label, page, color }) => (
            <button
              key={page}
              onClick={() => setCurrentPage(page)}
              className="rounded-lg py-3 px-4 text-sm font-medium text-left transition-all hover:opacity-90"
              style={{ background: '#1A1A1A', color, border: `1px solid ${color}30` }}
            >
              {label} →
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
