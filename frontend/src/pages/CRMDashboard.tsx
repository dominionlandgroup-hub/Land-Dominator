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
      className="rounded-xl p-5 bg-white"
      style={{
        borderTop: `4px solid ${accentColor}`,
        boxShadow: '0 1px 4px rgba(61,26,94,0.08)',
        border: '1px solid #EDE8F5',
        borderTopColor: accentColor,
        borderTopWidth: '4px',
      }}
    >
      <div className="flex items-start justify-between mb-3">
        <p style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: '#6B5B8A' }}>
          {label}
        </p>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${accentColor}18`, color: accentColor }}>
          {icon}
        </div>
      </div>
      <p className="text-2xl font-bold" style={{ color: '#1A0A2E' }}>{value}</p>
      {sub && <p className="text-xs mt-1" style={{ color: '#9B8AAE' }}>{sub}</p>}
    </div>
  )
}

function TableCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl" style={{ border: '1px solid #EDE8F5', boxShadow: '0 1px 4px rgba(61,26,94,0.06)' }}>
      <div className="px-5 py-4" style={{ borderBottom: '1px solid #F0EBF8' }}>
        <h2 className="font-semibold text-sm" style={{ color: '#1A0A2E' }}>{title}</h2>
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
  const { setCurrentPage, unreadCount } = useApp()
  const [properties, setProperties] = useState<CRMProperty[]>([])
  const [deals, setDeals] = useState<CRMDeal[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [commStats, setCommStats] = useState<CommStats | null>(null)

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
    { label: 'Deals Added',           value: stats.dealsAdded,           sub: 'total in pipeline',       accentColor: '#5C2977', icon: <IconDeals /> },
    { label: 'Offers Made',           value: stats.offersMade,           sub: 'across all properties',   accentColor: '#D5A940', icon: <IconOffer /> },
    { label: 'Properties Purchased',  value: stats.propertiesPurchased,  sub: 'with purchase price set', accentColor: '#2D7A4F', icon: <IconBuy /> },
    { label: 'Properties Sold',       value: stats.propertiesSold,       sub: 'with sale price set',     accentColor: '#4A90D9', icon: <IconSell /> },
    { label: 'ROI',                   value: `${stats.roi}%`,            sub: 'sale vs purchase total',  accentColor: stats.roi >= 0 ? '#2D7A4F' : '#DC2626', icon: <IconROI /> },
  ]

  return (
    <div className="flex flex-col min-h-screen" style={{ background: '#F8F6FB' }}>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="text-lg font-bold" style={{ color: '#1A0A2E' }}>Dashboard</h1>
          <p className="text-xs mt-0.5" style={{ color: '#6B5B8A' }}>
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
            cursor: 'pointer', borderRadius: 12, padding: '14px 20px', background: '#fff',
            border: `2px solid ${unreadCount > 0 ? '#DC2626' : '#EDE8F5'}`,
            boxShadow: unreadCount > 0 ? '0 2px 8px rgba(220,38,38,0.12)' : '0 1px 4px rgba(61,26,94,0.06)',
            display: 'flex', alignItems: 'center', gap: 16, transition: 'box-shadow 0.15s',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 16px rgba(92,41,119,0.15)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = unreadCount > 0 ? '0 2px 8px rgba(220,38,38,0.12)' : '0 1px 4px rgba(61,26,94,0.06)' }}
        >
          <div style={{ width: 40, height: 40, borderRadius: 10, background: unreadCount > 0 ? '#FEF2F2' : '#F3EEF8', display: 'flex', alignItems: 'center', justifyContent: 'center', color: unreadCount > 0 ? '#DC2626' : '#5C2977', flexShrink: 0 }}>
            <IconInbox />
          </div>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: '#6B5B8A', textTransform: 'uppercase', letterSpacing: '0.07em', margin: 0 }}>Unread Messages</p>
            <div className="flex items-baseline gap-2">
              <p style={{ fontSize: 28, fontWeight: 800, color: unreadCount > 0 ? '#DC2626' : '#1A0A2E', margin: 0, lineHeight: 1.2 }}>
                {unreadCount}
              </p>
              {unreadCount > 0 && (
                <span style={{ fontSize: 13, color: '#DC2626', fontWeight: 600 }}>
                  unread {unreadCount === 1 ? 'conversation' : 'conversations'}
                </span>
              )}
              {unreadCount === 0 && (
                <span style={{ fontSize: 13, color: '#9B8AAE' }}>all caught up</span>
              )}
            </div>
          </div>
          <span style={{ fontSize: 13, color: '#5C2977', fontWeight: 600 }}>Open Inbox →</span>
        </div>

        {/* Campaign Report */}
        <TableCard title="Campaign Report">
          {loading ? (
            <div className="py-10 text-center text-sm" style={{ color: '#9B8AAE' }}>Loading…</div>
          ) : campaigns.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm" style={{ color: '#9B8AAE' }}>No campaigns yet.</p>
              <button className="mt-2 text-sm underline" style={{ color: '#5C2977' }} onClick={() => setCurrentPage('campaigns')}>
                Go to Campaigns →
              </button>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid #F0EBF8' }}>
                  {['Campaign Name', 'Amount Spent', 'Total Records', 'Total Deals', 'Response Rate', 'ROAS'].map((h) => (
                    <th key={h} className="px-5 py-3 text-left" style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#9B8AAE' }}>
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
                      style={{ borderBottom: i < campaigns.length - 1 ? '1px solid #F8F5FC' : 'none' }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#FAF8FD')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      <td className="px-5 py-3 font-medium" style={{ color: '#1A0A2E' }}>{c.name}</td>
                      <td className="px-5 py-3" style={{ color: '#9B8AAE' }}>—</td>
                      <td className="px-5 py-3" style={{ color: '#3D2B5E' }}>{records > 0 ? records.toLocaleString() : '—'}</td>
                      <td className="px-5 py-3" style={{ color: '#9B8AAE' }}>—</td>
                      <td className="px-5 py-3" style={{ color: '#9B8AAE' }}>—</td>
                      <td className="px-5 py-3" style={{ color: '#9B8AAE' }}>—</td>
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
              <tr style={{ borderBottom: '1px solid #F0EBF8' }}>
                {['Total Conversations', 'Calls', 'Texts Sent', 'Talk Time', 'HOT Leads (7d)', 'Inbox'].map((h) => (
                  <th key={h} className="px-5 py-3 text-left" style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#9B8AAE' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="px-5 py-4 font-semibold" style={{ color: '#1A0A2E' }}>
                  {commStats ? commStats.total_conversations.toLocaleString() : '—'}
                </td>
                <td className="px-5 py-4" style={{ color: '#1565C0' }}>
                  {commStats ? commStats.calls_total.toLocaleString() : '—'}
                </td>
                <td className="px-5 py-4" style={{ color: '#6A1B9A' }}>
                  {commStats ? commStats.texts_outbound.toLocaleString() : '—'}
                </td>
                <td className="px-5 py-4" style={{ color: '#1A0A2E' }}>
                  {commStats
                    ? commStats.talk_time_seconds > 0
                      ? `${Math.floor(commStats.talk_time_seconds / 60)}m ${commStats.talk_time_seconds % 60}s`
                      : '0m'
                    : '—'}
                </td>
                <td className="px-5 py-4 font-bold" style={{ color: commStats && commStats.hot_leads_this_week > 0 ? '#E65100' : '#9B8AAE' }}>
                  {commStats ? (commStats.hot_leads_this_week > 0 ? `🔥 ${commStats.hot_leads_this_week}` : '0') : '—'}
                </td>
                <td className="px-5 py-4">
                  <button
                    className="text-xs underline"
                    style={{ color: '#5C2977' }}
                    onClick={() => setCurrentPage('seller-inbox')}
                  >
                    View Inbox →
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
          {!commStats && (
            <div className="px-5 py-3" style={{ borderTop: '1px solid #F8F5FC' }}>
              <p className="text-xs" style={{ color: '#9B8AAE' }}>
                Connect Telnyx to start tracking communication data. Set <code>TELNYX_API_KEY</code> and <code>TELNYX_PHONE_NUMBER</code> in Railway.
              </p>
            </div>
          )}
        </TableCard>

        {/* Quick links */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {([
            { label: 'View Properties', page: 'crm-properties', color: '#5C2977' },
            { label: 'View Contacts',   page: 'crm-contacts',   color: '#4A90D9' },
            { label: 'Deals Pipeline',  page: 'crm-deals',      color: '#2D7A4F' },
            { label: 'Campaigns',       page: 'campaigns',      color: '#D5A940' },
          ] as { label: string; page: AppPage; color: string }[]).map(({ label, page, color }) => (
            <button
              key={page}
              onClick={() => setCurrentPage(page)}
              className="rounded-xl py-3 px-4 text-sm font-medium text-left transition-all hover:opacity-90"
              style={{ background: '#FFFFFF', color, border: `1px solid ${color}30`, boxShadow: '0 1px 3px rgba(61,26,94,0.06)' }}
            >
              {label} →
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

