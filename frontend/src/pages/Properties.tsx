import React, { useEffect, useRef, useState } from 'react'
import type { CRMProperty, CRMCampaign, PropertyStatus } from '../types/crm'
import {
  listProperties, createProperty, updateProperty, deleteProperty,
  deleteProperties, deletePropertiesFiltered, exportPropertiesCsv,
  getPropertyCounts, listCrmCampaigns, getProperty,
} from '../api/crm'
import PropertyDetail from './PropertyDetail'
import { useApp } from '../context/AppContext'

type View = 'list' | 'detail' | 'new'

const PAGE_SIZE = 50

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  lead:           { bg: 'rgba(124,58,237,0.12)', text: '#A78BFA', border: 'rgba(124,58,237,0.25)' },
  prospect:       { bg: 'rgba(245,158,11,0.12)', text: '#FCD34D', border: 'rgba(245,158,11,0.25)' },
  offer_sent:     { bg: 'rgba(245,158,11,0.12)', text: '#FCD34D', border: 'rgba(245,158,11,0.25)' },
  under_contract: { bg: 'rgba(16,185,129,0.12)', text: '#34D399', border: 'rgba(16,185,129,0.25)' },
  due_diligence:  { bg: 'rgba(16,185,129,0.12)', text: '#34D399', border: 'rgba(16,185,129,0.25)' },
  closed_won:     { bg: 'rgba(16,185,129,0.15)', text: '#10B981', border: 'rgba(16,185,129,0.3)' },
  closed_lost:    { bg: 'rgba(239,68,68,0.12)', text: '#F87171', border: 'rgba(239,68,68,0.25)' },
  dead:           { bg: 'rgba(239,68,68,0.12)', text: '#F87171', border: 'rgba(239,68,68,0.25)' },
}

const STATUS_LABELS: Record<string, string> = {
  lead: 'Lead', prospect: 'Prospect', offer_sent: 'Offer Sent',
  under_contract: 'Under Contract', due_diligence: 'Due Diligence',
  closed_won: 'Closed Won', closed_lost: 'Closed Lost', dead: 'Dead',
}

const ALL_STATUSES = ['all', 'lead', 'prospect', 'offer_sent', 'under_contract', 'due_diligence', 'closed_won', 'closed_lost']

export default function Properties() {
  const { propertyCampaignId, setPropertyCampaignId, selectedPropertyId, setSelectedPropertyId } = useApp()
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
  const [allPagesSelected, setAllPagesSelected] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    const initCampaign = propertyCampaignId ?? ''
    setCampaignFilter(initCampaign)
    setPropertyCampaignId(null)
    loadPage(1, 'all', initCampaign, '', '', '')
    if (selectedPropertyId) {
      const id = selectedPropertyId
      setSelectedPropertyId(null)
      getProperty(id).then(p => { setSelected(p); setView('detail') }).catch(() => {})
    }
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

  function clearSelection() { setSelectedIds(new Set()); setAllPagesSelected(false) }

  function handleStatusChange(s: string) { setStatusFilter(s); clearSelection(); reload({ sf: s }) }
  function handleCampaignChange(v: string) { setCampaignFilter(v); clearSelection(); reload({ cf: v }) }
  function handleCountyChange(v: string) {
    setCountyFilter(v)
    clearSelection()
    if (searchDebounce.current) clearTimeout(searchDebounce.current)
    searchDebounce.current = setTimeout(() => reload({ county: v }), 400)
  }
  function handleStateChange(v: string) {
    setStateFilter(v)
    clearSelection()
    if (searchDebounce.current) clearTimeout(searchDebounce.current)
    searchDebounce.current = setTimeout(() => reload({ state: v }), 400)
  }
  function handleSearchChange(v: string) {
    setSearchQuery(v)
    clearSelection()
    if (searchDebounce.current) clearTimeout(searchDebounce.current)
    searchDebounce.current = setTimeout(() => reload({ sq: v }), 400)
  }
  function clearFilters() {
    setStatusFilter('all'); setCampaignFilter(''); setCountyFilter(''); setStateFilter(''); setSearchQuery('')
    clearSelection()
    loadPage(1, 'all', '', '', '', '')
  }

  async function handleBulkDelete() {
    setDeleting(true)
    try {
      if (allPagesSelected) {
        await deletePropertiesFiltered({
          status: statusFilter !== 'all' ? statusFilter : undefined,
          campaign_id: campaignFilter || undefined,
          county: countyFilter.trim() || undefined,
          state: stateFilter.trim() || undefined,
          search: searchQuery.trim() || undefined,
        })
      } else {
        await deleteProperties(Array.from(selectedIds))
      }
      clearSelection()
      setShowDeleteConfirm(false)
      reload({ p: 1 })
    } catch { setError('Failed to delete selected properties.') }
    finally { setDeleting(false) }
  }

  async function handleExport() {
    setExporting(true)
    try {
      if (!allPagesSelected && selectedIds.size > 0) {
        // Export only the selected records visible on this page
        const sel = properties.filter(p => selectedIds.has(p.id))
        downloadCsvLocally(sel, campaigns)
      } else {
        // Export ALL records matching current filters
        await exportPropertiesCsv({
          status: statusFilter !== 'all' ? statusFilter : undefined,
          campaign_id: campaignFilter || undefined,
          county: countyFilter.trim() || undefined,
          state: stateFilter.trim() || undefined,
          search: searchQuery.trim() || undefined,
          fmt: 'full',
        })
      }
    } catch { setError('Export failed. Please try again.') }
    finally { setExporting(false) }
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

  // Header checkbox states
  const allPageSelected = properties.length > 0 && selectedIds.size === properties.length && !allPagesSelected
  const someSelected = !allPagesSelected && selectedIds.size > 0 && selectedIds.size < properties.length
  const deleteCount = allPagesSelected ? totalCount : selectedIds.size
  const showSelectAllBanner = allPageSelected && totalCount > properties.length
  const anySelection = allPagesSelected || selectedIds.size > 0

  return (
    <div className="page-content">
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Properties</h1>
          <p className="page-subtitle">{allCounts.total.toLocaleString()} total · showing {totalCount.toLocaleString()}</p>
        </div>
        <div className="flex items-center gap-2">
          {anySelection && (
            <button
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white flex items-center gap-2"
              style={{ background: '#EF4444' }}
              onClick={() => setShowDeleteConfirm(true)}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                <path d="M10 11v6M14 11v6"/>
              </svg>
              Delete ({deleteCount.toLocaleString()})
            </button>
          )}
          <button
            className="btn-secondary flex items-center gap-1.5"
            onClick={handleExport}
            disabled={exporting}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            {exporting ? 'Exporting…' : anySelection && !allPagesSelected ? `Export (${selectedIds.size})` : 'Export CSV'}
          </button>
          <button className="btn-primary" onClick={() => setView('new')}>+ New Property</button>
        </div>
      </div>

      <div className="p-6">
        {/* Stat cards */}
        <div className="grid gap-4 mb-6" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
          {[
            { label: 'Total', value: counts.total, accent: '#7C3AED' },
            { label: 'Leads', value: counts.lead, accent: '#A78BFA' },
            { label: 'Offer Sent', value: counts.offer_sent, accent: '#FCD34D' },
            { label: 'Under Contract', value: counts.under_contract, accent: '#34D399' },
            { label: 'Closed Won', value: counts.closed_won, accent: '#10B981' },
          ].map(s => (
            <div key={s.label} className="stat-card" style={{ '--stat-accent': s.accent } as React.CSSProperties}>
              <span className="label-caps">{s.label}</span>
              <span className="stat-value" style={{ fontSize: '26px' }}>{s.value.toLocaleString()}</span>
            </div>
          ))}
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-2 mb-4 flex-wrap">
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
          <input
            type="text"
            className="input-base text-sm py-1.5"
            style={{ maxWidth: '150px' }}
            placeholder="County…"
            value={countyFilter}
            onChange={e => handleCountyChange(e.target.value)}
          />
          <input
            type="text"
            className="input-base text-sm py-1.5"
            style={{ maxWidth: '80px' }}
            placeholder="State…"
            value={stateFilter}
            onChange={e => handleStateChange(e.target.value)}
          />
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6B6B6B" strokeWidth="2">
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
              style={{ color: '#A78BFA', background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.25)' }}
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
                background: statusFilter === s ? '#7C3AED' : 'rgba(124,58,237,0.08)',
                color: statusFilter === s ? '#fff' : '#A78BFA',
                border: `1px solid ${statusFilter === s ? '#7C3AED' : 'rgba(124,58,237,0.2)'}`,
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
          <div className="mb-4 p-3 rounded-lg text-sm" style={{ background: 'rgba(239,68,68,0.12)', color: '#F87171', border: '1px solid rgba(239,68,68,0.25)' }}>
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="text-sm" style={{ color: '#6B6B6B' }}>Loading…</div>
          </div>
        ) : (
          <>
            {/* Select-all-pages banner */}
            {showSelectAllBanner && (
              <div
                className="flex items-center justify-between px-4 py-2.5 rounded-lg mb-3 text-sm"
                style={{ background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.2)' }}
              >
                <span style={{ color: '#F5F5F5' }}>
                  All {properties.length} properties on this page are selected.
                </span>
                <button
                  className="font-semibold text-sm ml-3"
                  style={{ color: '#A78BFA' }}
                  onClick={() => setAllPagesSelected(true)}
                >
                  Select all {totalCount.toLocaleString()} properties →
                </button>
              </div>
            )}
            {allPagesSelected && (
              <div
                className="flex items-center justify-between px-4 py-2.5 rounded-lg mb-3 text-sm"
                style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}
              >
                <span style={{ color: '#F87171', fontWeight: 600 }}>
                  All {totalCount.toLocaleString()} properties are selected.
                </span>
                <button
                  className="font-semibold text-sm ml-3"
                  style={{ color: '#F87171' }}
                  onClick={clearSelection}
                >
                  Clear selection ×
                </button>
              </div>
            )}

            <div style={{ background: '#1A1A1A', borderRadius: '8px', overflow: 'hidden', border: '1px solid #2E2E2E' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ background: '#242424', borderBottom: '1px solid #2E2E2E' }}>
                    <th style={{ width: '36px', padding: '10px 12px' }}>
                      <input
                        type="checkbox"
                        checked={allPagesSelected || allPageSelected}
                        ref={el => { if (el) el.indeterminate = someSelected }}
                        onChange={() => {
                          if (allPagesSelected) { clearSelection(); return }
                          if (selectedIds.size > 0) { clearSelection(); return }
                          setSelectedIds(new Set(properties.map(p => p.id)))
                        }}
                        style={{ cursor: 'pointer' }}
                      />
                    </th>
                    {['OWNER', 'APN', 'COUNTY', 'STATE', 'ACRES', 'OFFER PRICE', 'CAMPAIGN', 'STATUS'].map(h => (
                      <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', color: '#6B6B6B' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {properties.length === 0 ? (
                    <tr>
                      <td colSpan={9} style={{ padding: '48px 20px', textAlign: 'center', color: '#6B6B6B' }}>
                        No properties match the current filters.
                      </td>
                    </tr>
                  ) : properties.map((p, i) => {
                    const isSelected = allPagesSelected || selectedIds.has(p.id)
                    const sc = STATUS_COLORS[p.status ?? 'lead'] ?? STATUS_COLORS.lead
                    const campaignName = campaigns.find(c => c.id === p.campaign_id)?.name ?? p.campaign_code
                    return (
                      <tr
                        key={p.id}
                        style={{
                          borderBottom: i < properties.length - 1 ? '1px solid #2E2E2E' : 'none',
                          background: isSelected ? 'rgba(124,58,237,0.08)' : 'transparent',
                          cursor: 'pointer',
                        }}
                        onClick={() => { setSelected(p); setView('detail') }}
                      >
                        <td style={{ padding: '10px 12px' }} onClick={e => { e.stopPropagation(); if (!allPagesSelected) { setSelectedIds(prev => { const n = new Set(prev); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n }) } }}>
                          <input type="checkbox" checked={isSelected} onChange={() => {}} style={{ cursor: 'pointer' }} />
                        </td>
                        <td style={{ padding: '10px 12px', fontWeight: 500, color: '#F5F5F5', maxWidth: '180px' }}>
                          <div className="truncate">{p.owner_full_name ?? <span style={{ color: '#6B6B6B' }}>—</span>}</div>
                        </td>
                        <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontSize: '11px', color: '#A78BFA', fontWeight: 600 }}>
                          {p.apn ?? <span style={{ color: '#6B6B6B', fontFamily: 'inherit', fontWeight: 400 }}>—</span>}
                        </td>
                        <td style={{ padding: '10px 12px', color: '#A0A0A0' }}>
                          {p.county ?? <span style={{ color: '#6B6B6B' }}>—</span>}
                        </td>
                        <td style={{ padding: '10px 12px', color: '#A0A0A0' }}>
                          {p.state ?? <span style={{ color: '#6B6B6B' }}>—</span>}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', color: '#A0A0A0' }}>
                          {p.acreage != null ? p.acreage.toFixed(2) : <span style={{ color: '#6B6B6B' }}>—</span>}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', color: '#F5F5F5', fontWeight: 500 }}>
                          {p.offer_price != null ? `$${p.offer_price.toLocaleString()}` : <span style={{ color: '#6B6B6B' }}>—</span>}
                        </td>
                        <td style={{ padding: '10px 12px', fontSize: '11px', color: '#A0A0A0', maxWidth: '140px' }}>
                          <div className="truncate">{campaignName ?? <span style={{ color: '#6B6B6B' }}>—</span>}</div>
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
                style={{ borderTop: '1px solid #2E2E2E', background: '#1A1A1A' }}
              >
                <span className="text-xs" style={{ color: '#6B6B6B' }}>
                  {totalCount === 0 ? '0 results' : `${firstRow.toLocaleString()}–${lastRow.toLocaleString()} of ${totalCount.toLocaleString()} results`}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => { setSelectedIds(new Set()); reload({ p: page - 1 }) }}
                    disabled={page <= 1}
                    className="p-1.5 rounded disabled:opacity-30"
                    style={{ color: '#7C3AED' }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="15 18 9 12 15 6"/>
                    </svg>
                  </button>
                  <span className="text-xs px-2 font-medium" style={{ color: '#F5F5F5' }}>
                    {page} / {totalPages || 1}
                  </span>
                  <button
                    onClick={() => { setSelectedIds(new Set()); reload({ p: page + 1 }) }}
                    disabled={page >= totalPages}
                    className="p-1.5 rounded disabled:opacity-30"
                    style={{ color: '#7C3AED' }}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
          <div style={{ background: '#1A1A1A', borderRadius: '8px', padding: '24px', maxWidth: '420px', width: '100%', border: '1px solid #2E2E2E' }}>
            <h2 className="section-heading mb-3">
              {allPagesSelected
                ? `Delete all ${totalCount.toLocaleString()} properties?`
                : `Delete ${selectedIds.size.toLocaleString()} ${selectedIds.size === 1 ? 'Property' : 'Properties'}?`
              }
            </h2>
            {allPagesSelected && (
              <p className="text-sm mb-2" style={{ color: '#F87171' }}>
                This will delete every property matching the current filters.
              </p>
            )}
            <p className="text-sm mb-6" style={{ color: '#A0A0A0' }}>This cannot be undone.</p>
            <div className="flex gap-3">
              <button className="btn-secondary flex-1" onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>Cancel</button>
              <button
                className="flex-1 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60"
                style={{ background: '#EF4444' }}
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

function downloadCsvLocally(records: CRMProperty[], _camps: CRMCampaign[]) {
  const headers = [
    'Owner Full Name', 'Owner First Name', 'Owner Last Name',
    'Mailing Address Line 1', 'Mailing City', 'Mailing State', 'Mailing Zip',
    'APN', 'County', 'State', 'Acreage',
    'Campaign Code', 'Campaign Price', 'Offer Price', 'LP Estimate',
    'Status',
  ]
  const rows = records.map(p => [
    p.owner_full_name ?? '',
    p.owner_first_name ?? '',
    p.owner_last_name ?? '',
    p.owner_mailing_address ?? '',
    p.owner_mailing_city ?? '',
    p.owner_mailing_state ?? '',
    p.owner_mailing_zip ?? '',
    p.apn ?? '',
    p.county ?? '',
    p.state ?? '',
    p.acreage?.toFixed(2) ?? '',
    p.campaign_code ?? '',
    p.campaign_price?.toString() ?? '',
    p.offer_price?.toString() ?? '',
    p.lp_estimate?.toString() ?? '',
    p.status ?? 'lead',
  ])
  const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `properties-export-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export { STATUS_COLORS, STATUS_LABELS }
