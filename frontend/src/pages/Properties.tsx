import React, { useEffect, useRef, useState } from 'react'
import type { CRMProperty, CRMCampaign, PropertyStatus } from '../types/crm'
import {
  listProperties, createProperty, updateProperty, deleteProperty,
  deleteProperties, getPropertyCounts, listCrmCampaigns,
} from '../api/crm'
import PropertyDetail from './PropertyDetail'
import { useApp } from '../context/AppContext'

type View = 'list' | 'detail' | 'new'

const PAGE_SIZE = 20

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  lead:           { bg: '#FFF3E0', text: '#E65100', border: '#FFCC80' },
  prospect:       { bg: '#E3F2FD', text: '#1565C0', border: '#90CAF9' },
  offer_sent:     { bg: '#F3E5F5', text: '#6A1B9A', border: '#CE93D8' },
  under_contract: { bg: '#E8F5E9', text: '#2E7D32', border: '#A5D6A7' },
  due_diligence:  { bg: '#FFF8E1', text: '#F57F17', border: '#FFE082' },
  closed_won:     { bg: '#E0F2F1', text: '#00695C', border: '#80CBC4' },
  closed_lost:    { bg: '#FFEBEE', text: '#B71C1C', border: '#EF9A9A' },
  dead:           { bg: '#F5F5F5', text: '#616161', border: '#BDBDBD' },
}

const STATUS_LABELS: Record<string, string> = {
  lead: 'Lead', prospect: 'Prospect', offer_sent: 'Offer Sent',
  under_contract: 'Under Contract', due_diligence: 'Due Diligence',
  closed_won: 'Closed Won', closed_lost: 'Closed Lost', dead: 'Dead',
}

const ALL_STATUSES = ['all', 'lead', 'prospect', 'offer_sent', 'under_contract', 'due_diligence', 'closed_won', 'closed_lost']

export default function Properties() {
  const { propertyCampaignId, setPropertyCampaignId } = useApp()
  const [view, setView] = useState<View>('list')
  const [selected, setSelected] = useState<CRMProperty | null>(null)

  const [properties, setProperties] = useState<CRMProperty[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [page, setPage] = useState(1)
  const [allCounts, setAllCounts] = useState<{ total: number; by_status: Record<string, number> }>({ total: 0, by_status: {} })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filters
  const [statusFilter, setStatusFilter] = useState('all')
  const [campaignFilter, setCampaignFilter] = useState<string>(propertyCampaignId ?? '')
  const [countyFilter, setCountyFilter] = useState('')
  const [stateFilter, setStateFilter] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [campaigns, setCampaigns] = useState<CRMCampaign[]>([])

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    const initCampaign = propertyCampaignId ?? ''
    setCampaignFilter(initCampaign)
    setPropertyCampaignId(null)
    loadPage(1, 'all', initCampaign, '', '', '')
    listCrmCampaigns().then(setCampaigns).catch(() => {})
  }, [])

  async function loadPage(p: number, sf: string, cf: string, county: string, state: string, sq: string) {
    setLoading(true)
    setError(null)
    try {
      const [res, counts] = await Promise.all([
        listProperties({
          page: p, limit: PAGE_SIZE,
          status: sf === 'all' ? undefined : sf,
          campaign_id: cf || undefined,
          county: county.trim() || undefined,
          state: state.trim() || undefined,
          search: sq.trim() || undefined,
        }),
        getPropertyCounts(),
      ])
      setProperties(res.data)
      setTotalCount(res.total)
      setAllCounts(counts)
      setPage(p)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      const detail = err?.response?.data?.detail ?? ''
      setError(detail && !detail.includes('SUPABASE') ? detail : 'Failed to load properties.')
    } finally { setLoading(false) }
  }

  function reload(overrides?: { sf?: string; cf?: string; county?: string; state?: string; sq?: string; p?: number }) {
    const sf = overrides?.sf ?? statusFilter
    const cf = overrides?.cf ?? campaignFilter
    const county = overrides?.county ?? countyFilter
    const state = overrides?.state ?? stateFilter
    const sq = overrides?.sq ?? searchQuery
    const p = overrides?.p ?? 1
    loadPage(p, sf, cf, county, state, sq)
  }

  function handleStatusChange(s: string) { setStatusFilter(s); setSelectedIds(new Set()); reload({ sf: s }) }
  function handleCampaignChange(v: string) { setCampaignFilter(v); setSelectedIds(new Set()); reload({ cf: v }) }
  function handleCountyChange(v: string) {
    setCountyFilter(v)
    if (searchDebounce.current) clearTimeout(searchDebounce.current)
    searchDebounce.current = setTimeout(() => reload({ county: v }), 400)
  }
  function handleStateChange(v: string) {
    setStateFilter(v)
    if (searchDebounce.current) clearTimeout(searchDebounce.current)
    searchDebounce.current = setTimeout(() => reload({ state: v }), 400)
  }
  function handleSearchChange(v: string) {
    setSearchQuery(v)
    if (searchDebounce.current) clearTimeout(searchDebounce.current)
    searchDebounce.current = setTimeout(() => reload({ sq: v }), 400)
  }
  function clearFilters() {
    setStatusFilter('all'); setCampaignFilter(''); setCountyFilter(''); setStateFilter(''); setSearchQuery('')
    loadPage(1, 'all', '', '', '', '')
  }

  async function handleBulkDelete() {
    setDeleting(true)
    try {
      await deleteProperties(Array.from(selectedIds))
      setSelectedIds(new Set())
      setShowDeleteConfirm(false)
      reload({ p: page })
    } catch { setError('Failed to delete selected properties.') }
    finally { setDeleting(false) }
  }

  if (view === 'detail' && selected) {
    return (
      <PropertyDetail
        property={selected}
        onBack={() => { setView('list'); setSelected(null); reload({ p: page }) }}
        onSave={async updates => { const u = await updateProperty(selected.id, updates); setSelected(u) }}
        onDelete={async () => { await deleteProperty(selected.id); setView('list'); setSelected(null); reload() }}
      />
    )
  }

  if (view === 'new') {
    return (
      <PropertyDetail
        property={null}
        onBack={() => { setView('list'); reload({ p: page }) }}
        onSave={async data => { await createProperty(data); setView('list'); reload() }}
        onDelete={() => Promise.resolve()}
      />
    )
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE)
  const firstRow = totalCount === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const lastRow = Math.min(page * PAGE_SIZE, totalCount)
  const counts = {
    total: allCounts.total,
    lead: allCounts.by_status.lead ?? 0,
    offer_sent: allCounts.by_status.offer_sent ?? 0,
    under_contract: allCounts.by_status.under_contract ?? 0,
    closed_won: allCounts.by_status.closed_won ?? 0,
  }
  const hasActiveFilter = campaignFilter || countyFilter || stateFilter || searchQuery || statusFilter !== 'all'

  return (
    <div className="page-content">
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Properties</h1>
          <p className="page-subtitle">{allCounts.total.toLocaleString()} total · showing {totalCount.toLocaleString()}</p>
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <button
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white flex items-center gap-2"
              style={{ background: '#B71C1C' }}
              onClick={() => setShowDeleteConfirm(true)}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                <path d="M10 11v6M14 11v6"/>
              </svg>
              Delete ({selectedIds.size.toLocaleString()})
            </button>
          )}
          <button className="btn-primary" onClick={() => setView('new')}>+ New Property</button>
        </div>
      </div>

      <div className="p-6">
        {/* Stat cards */}
        <div className="grid gap-4 mb-6" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
          {[
            { label: 'Total', value: counts.total, accent: '#5C2977' },
            { label: 'Leads', value: counts.lead, accent: '#E65100' },
            { label: 'Offer Sent', value: counts.offer_sent, accent: '#6A1B9A' },
            { label: 'Under Contract', value: counts.under_contract, accent: '#2E7D32' },
            { label: 'Closed Won', value: counts.closed_won, accent: '#00695C' },
          ].map(s => (
            <div key={s.label} className="stat-card" style={{ '--stat-accent': s.accent } as React.CSSProperties}>
              <span className="label-caps">{s.label}</span>
              <span className="stat-value" style={{ fontSize: '26px' }}>{s.value.toLocaleString()}</span>
            </div>
          ))}
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          {/* Campaign */}
          {campaigns.length > 0 && (
            <select
              className="input-base text-sm py-1.5"
              style={{ maxWidth: '220px' }}
              value={campaignFilter}
              onChange={e => handleCampaignChange(e.target.value)}
            >
              <option value="">All Campaigns</option>
              {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          {/* County */}
          <input
            type="text"
            className="input-base text-sm py-1.5"
            style={{ maxWidth: '150px' }}
            placeholder="County…"
            value={countyFilter}
            onChange={e => handleCountyChange(e.target.value)}
          />
          {/* State */}
          <input
            type="text"
            className="input-base text-sm py-1.5"
            style={{ maxWidth: '80px' }}
            placeholder="State…"
            value={stateFilter}
            onChange={e => handleStateChange(e.target.value)}
          />
          {/* Search */}
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9B8AAE" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              type="text"
              className="input-base text-sm py-1.5 pl-8"
              style={{ maxWidth: '220px' }}
              placeholder="Search APN or owner…"
              value={searchQuery}
              onChange={e => handleSearchChange(e.target.value)}
            />
          </div>
          {hasActiveFilter && (
            <button
              className="text-xs px-2.5 py-1.5 rounded-lg"
              style={{ color: '#5C2977', background: 'rgba(92,41,119,0.07)', border: '1px solid #D4B8E8' }}
              onClick={clearFilters}
            >
              Clear filters
            </button>
          )}
        </div>

        {/* Status filter pills */}
        <div className="flex items-center gap-2 mb-5 flex-wrap">
          {ALL_STATUSES.map(s => (
            <button
              key={s}
              onClick={() => handleStatusChange(s)}
              className="px-3 py-1.5 rounded-full text-xs font-semibold transition-all"
              style={{
                background: statusFilter === s ? '#5C2977' : 'rgba(92,41,119,0.06)',
                color: statusFilter === s ? '#fff' : '#5C2977',
                border: `1px solid ${statusFilter === s ? '#5C2977' : '#D4B8E8'}`,
              }}
            >
              {s === 'all' ? 'All' : STATUS_LABELS[s]}
              {s !== 'all' && (
                <span className="ml-1.5 opacity-70">{(allCounts.by_status[s] ?? 0).toLocaleString()}</span>
              )}
            </button>
          ))}
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg text-sm" style={{ background: '#FFF0F0', color: '#B71C1C', border: '1px solid #FFCDD2' }}>
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="text-sm" style={{ color: '#6B5B8A' }}>Loading…</div>
          </div>
        ) : (
          <>
            <div className="bg-white rounded-xl overflow-hidden" style={{ border: '1px solid #EDE8F5' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ background: '#F8F5FC', borderBottom: '1px solid #EDE8F5' }}>
                    <th style={{ width: '36px', padding: '10px 12px' }}>
                      <input
                        type="checkbox"
                        checked={selectedIds.size === properties.length && properties.length > 0}
                        ref={el => { if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < properties.length }}
                        onChange={() => {
                          if (selectedIds.size === properties.length) setSelectedIds(new Set())
                          else setSelectedIds(new Set(properties.map(p => p.id)))
                        }}
                        style={{ cursor: 'pointer' }}
                      />
                    </th>
                    {['OWNER', 'APN', 'COUNTY', 'STATE', 'ACRES', 'OFFER PRICE', 'CAMPAIGN', 'STATUS'].map(h => (
                      <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', color: '#9B8AAE' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {properties.length === 0 ? (
                    <tr>
                      <td colSpan={9} style={{ padding: '48px 20px', textAlign: 'center', color: '#9B8AAE' }}>
                        No properties match the current filters.
                      </td>
                    </tr>
                  ) : properties.map((p, i) => {
                    const isSelected = selectedIds.has(p.id)
                    const sc = STATUS_COLORS[p.status ?? 'lead'] ?? STATUS_COLORS.lead
                    return (
                      <tr
                        key={p.id}
                        style={{
                          borderBottom: i < properties.length - 1 ? '1px solid #F5F0FC' : 'none',
                          background: isSelected ? 'rgba(92,41,119,0.04)' : 'transparent',
                          cursor: 'pointer',
                        }}
                        onClick={() => { setSelected(p); setView('detail') }}
                      >
                        <td style={{ padding: '10px 12px' }} onClick={e => { e.stopPropagation(); setSelectedIds(prev => { const n = new Set(prev); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n }) }}>
                          <input type="checkbox" checked={isSelected} onChange={() => {}} style={{ cursor: 'pointer' }} />
                        </td>
                        <td style={{ padding: '10px 12px', fontWeight: 500, color: '#1A0A2E', maxWidth: '180px' }}>
                          <div className="truncate">{p.owner_full_name ?? <span style={{ color: '#C4B5D8' }}>—</span>}</div>
                        </td>
                        <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontSize: '11px', color: '#5C2977', fontWeight: 600 }}>
                          {p.apn ?? <span style={{ color: '#C4B5D8', fontFamily: 'inherit', fontWeight: 400 }}>—</span>}
                        </td>
                        <td style={{ padding: '10px 12px', color: '#6B5B8A' }}>
                          {p.county ?? <span style={{ color: '#C4B5D8' }}>—</span>}
                        </td>
                        <td style={{ padding: '10px 12px', color: '#6B5B8A' }}>
                          {p.state ?? <span style={{ color: '#C4B5D8' }}>—</span>}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', color: '#6B5B8A' }}>
                          {p.acreage != null ? p.acreage.toFixed(2) : <span style={{ color: '#C4B5D8' }}>—</span>}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', color: '#3D2B5E', fontWeight: 500 }}>
                          {p.offer_price != null ? `$${p.offer_price.toLocaleString()}` : <span style={{ color: '#C4B5D8' }}>—</span>}
                        </td>
                        <td style={{ padding: '10px 12px', fontSize: '11px', color: '#9B8AAE' }}>
                          {p.campaign_code ?? <span style={{ color: '#C4B5D8' }}>—</span>}
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <span
                            className="px-2 py-0.5 rounded-full text-[11px] font-semibold"
                            style={{ background: sc.bg, color: sc.text, border: `1px solid ${sc.border}` }}
                          >
                            {STATUS_LABELS[p.status ?? 'lead'] ?? p.status}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>

              {/* Pagination */}
              <div
                className="flex items-center justify-between px-4 py-3"
                style={{ borderTop: '1px solid #EDE8F5', background: '#FAFAFE' }}
              >
                <span className="text-xs" style={{ color: '#9B8AAE' }}>
                  {totalCount === 0 ? '0 results' : `${firstRow.toLocaleString()}–${lastRow.toLocaleString()} of ${totalCount.toLocaleString()} results`}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => { setSelectedIds(new Set()); reload({ p: page - 1 }) }}
                    disabled={page <= 1}
                    className="p-1.5 rounded disabled:opacity-30"
                    style={{ color: '#5C2977' }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="15 18 9 12 15 6"/>
                    </svg>
                  </button>
                  <span className="text-xs px-2 font-medium" style={{ color: '#3D2B5E' }}>
                    {page} / {totalPages || 1}
                  </span>
                  <button
                    onClick={() => { setSelectedIds(new Set()); reload({ p: page + 1 }) }}
                    disabled={page >= totalPages}
                    className="p-1.5 rounded disabled:opacity-30"
                    style={{ color: '#5C2977' }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="9 18 15 12 9 6"/>
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Bulk delete confirm */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(26,10,46,0.55)' }}>
          <div className="bg-white rounded-2xl p-6 shadow-xl" style={{ maxWidth: '400px', width: '100%' }}>
            <h2 className="section-heading mb-3">Delete {selectedIds.size.toLocaleString()} {selectedIds.size === 1 ? 'Property' : 'Properties'}?</h2>
            <p className="text-sm mb-6" style={{ color: '#6B5B8A' }}>This cannot be undone.</p>
            <div className="flex gap-3">
              <button className="btn-secondary flex-1" onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>Cancel</button>
              <button
                className="flex-1 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60"
                style={{ background: '#B71C1C' }}
                onClick={handleBulkDelete}
                disabled={deleting}
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Status badge (standalone, used if needed) ──────────────────────────────
export { STATUS_COLORS, STATUS_LABELS }
