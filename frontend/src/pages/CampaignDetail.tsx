import React, { useEffect, useRef, useState } from 'react'
import Papa from 'papaparse'
import type { CRMProperty, CRMCampaign, PropertyStatus } from '../types/crm'
import {
  listProperties, updateProperty, deleteProperties, bulkInsertRows, getCrmCampaign,
} from '../api/crm'

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

interface Props {
  campaign: CRMCampaign
  onBack: () => void
  onCampaignUpdated: (c: CRMCampaign) => void
}

export default function CampaignDetail({ campaign, onBack, onCampaignUpdated }: Props) {
  const [stats, setStats] = useState<CRMCampaign>(campaign)
  const [properties, setProperties] = useState<CRMProperty[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Adjust price
  const [showAdjustPrice, setShowAdjustPrice] = useState(false)
  const [newPrice, setNewPrice] = useState('')
  const [adjusting, setAdjusting] = useState(false)

  // Import
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cancelledRef = useRef(false)
  const [importPhase, setImportPhase] = useState<'idle' | 'parsing' | 'importing' | 'done'>('idle')
  const [importProgress, setImportProgress] = useState(0)
  const [importTotal, setImportTotal] = useState(0)
  const [importedCount, setImportedCount] = useState(0)
  const [importFailed, setImportFailed] = useState(0)

  useEffect(() => {
    loadProperties(1, 'all', '')
    refreshStats()
  }, [])

  async function refreshStats() {
    try {
      const data = await getCrmCampaign(campaign.id)
      setStats(data)
      onCampaignUpdated(data)
    } catch {}
  }

  async function loadProperties(p: number, sf: string, sq: string) {
    setLoading(true)
    try {
      const res = await listProperties({
        page: p, limit: PAGE_SIZE,
        campaign_id: campaign.id,
        status: sf === 'all' ? undefined : sf,
        search: sq.trim() || undefined,
      })
      setProperties(res.data)
      setTotalCount(res.total)
      setPage(p)
    } catch {} finally { setLoading(false) }
  }

  function handleStatusChange(sf: string) {
    setStatusFilter(sf)
    setSelectedIds(new Set())
    loadProperties(1, sf, search)
  }

  function handleSearch(sq: string) {
    setSearch(sq)
    loadProperties(1, statusFilter, sq)
  }

  function goToPage(p: number) {
    setSelectedIds(new Set())
    loadProperties(p, statusFilter, search)
  }

  // ── Select all on current page ──────────────────────────────────────
  function toggleSelectAll() {
    if (selectedIds.size === properties.length && properties.length > 0) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(properties.map(p => p.id)))
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // ── Bulk delete ─────────────────────────────────────────────────────
  async function handleDelete() {
    setDeleting(true)
    try {
      await deleteProperties(Array.from(selectedIds))
      setSelectedIds(new Set())
      setShowDeleteConfirm(false)
      await loadProperties(page, statusFilter, search)
      refreshStats()
    } finally { setDeleting(false) }
  }

  // ── Adjust price ────────────────────────────────────────────────────
  async function handleAdjustPrice() {
    const price = parseFloat(newPrice)
    if (isNaN(price) || price < 0) return
    setAdjusting(true)
    try {
      await Promise.all(Array.from(selectedIds).map(id => updateProperty(id, { offer_price: price })))
      setSelectedIds(new Set())
      setShowAdjustPrice(false)
      setNewPrice('')
      loadProperties(page, statusFilter, search)
    } finally { setAdjusting(false) }
  }

  // ── Export CSV ──────────────────────────────────────────────────────
  function handleExport() {
    const selected = properties.filter(p => selectedIds.has(p.id))
    const headers = ['Owner Name', 'Mailing Address', 'City', 'State', 'Zip', 'APN', 'County', 'Acreage', 'Campaign Code', 'Offer Price', 'Status']
    const rows = selected.map(p => [
      p.owner_full_name ?? '',
      p.owner_mailing_address ?? '',
      p.owner_mailing_city ?? '',
      p.owner_mailing_state ?? '',
      p.owner_mailing_zip ?? '',
      p.apn ?? '',
      p.county ?? '',
      p.acreage?.toFixed(2) ?? '',
      p.campaign_code ?? '',
      p.offer_price?.toString() ?? '',
      p.status ?? 'lead',
    ])
    const csv = [headers, ...rows].map(r => r.map(v => `"${v.replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${campaign.name.replace(/[^a-z0-9]/gi, '_')}_export.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Import ──────────────────────────────────────────────────────────
  function triggerImport() {
    cancelledRef.current = false
    fileInputRef.current?.click()
  }

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setImportPhase('parsing')
    setImportProgress(0)
    setImportTotal(0)
    setImportedCount(0)
    setImportFailed(0)

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h: string) => h.trim(),
      complete: async (results) => {
        const rows = results.data
        if (!rows.length) { setImportPhase('idle'); return }
        setImportTotal(rows.length)
        setImportPhase('importing')
        const CHUNK = 50
        let done = 0, fail = 0
        for (let i = 0; i < rows.length; i += CHUNK) {
          if (cancelledRef.current) break
          const chunk = rows.slice(i, i + CHUNK)
          try {
            const r = await bulkInsertRows(chunk, campaign.id)
            done += r.imported
            fail += r.skipped
          } catch { fail += chunk.length }
          setImportProgress(Math.min(i + CHUNK, rows.length))
          setImportedCount(done)
          setImportFailed(fail)
        }
        setImportPhase('done')
        loadProperties(1, statusFilter, search)
        refreshStats()
      },
      error: () => { setImportPhase('idle') },
    })
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE)
  const firstRow = totalCount === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const lastRow = Math.min(page * PAGE_SIZE, totalCount)
  const allSelected = properties.length > 0 && selectedIds.size === properties.length
  const someSelected = selectedIds.size > 0 && !allSelected

  const bs = stats.by_status ?? {}

  return (
    <div style={{ background: '#F8F6FB', minHeight: '100vh' }}>
      {/* Top bar */}
      <div className="page-header" style={{ borderBottom: '1px solid #EDE8F5' }}>
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-sm font-medium transition-opacity hover:opacity-70"
            style={{ color: '#5C2977' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
            Campaigns
          </button>
          <span style={{ color: '#D4B8E8' }}>/</span>
          <h1 className="text-base font-semibold truncate" style={{ color: '#1A0A2E', maxWidth: '320px' }}>{campaign.name}</h1>
        </div>
        <div className="flex items-center gap-2">
          {/* Import progress indicator */}
          {importPhase === 'parsing' && (
            <span className="text-xs" style={{ color: '#6B5B8A' }}>Parsing CSV…</span>
          )}
          {importPhase === 'importing' && (
            <span className="text-xs" style={{ color: '#6B5B8A' }}>
              Importing {importProgress.toLocaleString()} / {importTotal.toLocaleString()}…
            </span>
          )}
          {importPhase === 'done' && (
            <span className="text-xs font-semibold" style={{ color: '#2E7D32' }}>
              ✓ {importedCount.toLocaleString()} imported
            </span>
          )}
          <input ref={fileInputRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleFileSelected} />
          <button
            className="btn-secondary text-sm"
            onClick={triggerImport}
            disabled={importPhase === 'parsing' || importPhase === 'importing'}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Import List
          </button>
          <button
            className="btn-primary text-sm flex items-center gap-1.5"
            style={{ opacity: 0.5, cursor: 'not-allowed' }}
            disabled
          >
            Start Mailing
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Campaign stats */}
      <div className="px-6 py-4" style={{ borderBottom: '1px solid #EDE8F5', background: '#fff' }}>
        <div className="flex items-center gap-8 flex-wrap">
          {[
            { label: 'Total Records', value: (stats.property_count ?? 0).toLocaleString(), accent: '#5C2977' },
            { label: 'Amount Spent', value: '$0', accent: '#3D2B5E' },
            { label: 'Deals', value: ((bs.offer_sent ?? 0) + (bs.under_contract ?? 0) + (bs.closed_won ?? 0)).toLocaleString(), accent: '#1565C0' },
            { label: 'Response Rate', value: '0%', accent: '#3D2B5E' },
            { label: 'Offers', value: (bs.offer_sent ?? 0).toLocaleString(), accent: '#6A1B9A' },
            { label: 'Purchases', value: (bs.under_contract ?? 0).toLocaleString(), accent: '#2E7D32' },
            { label: 'Sales', value: (bs.closed_won ?? 0).toLocaleString(), accent: '#00695C' },
          ].map(s => (
            <div key={s.label} className="text-center">
              <div className="text-xl font-bold" style={{ color: s.accent }}>{s.value}</div>
              <div className="text-[10px] font-semibold uppercase tracking-wide mt-0.5" style={{ color: '#9B8AAE' }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Filter bar */}
      <div className="px-6 py-3 flex items-center gap-3 flex-wrap" style={{ borderBottom: '1px solid #EDE8F5', background: '#fff' }}>
        {/* Status filter */}
        <select
          className="input-base text-sm py-1.5"
          style={{ maxWidth: '160px' }}
          value={statusFilter}
          onChange={e => handleStatusChange(e.target.value)}
        >
          <option value="all">All Records</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v} ({(bs[k] ?? 0).toLocaleString()})</option>
          ))}
        </select>

        {/* Placeholder dropdowns */}
        <select className="input-base text-sm py-1.5" style={{ maxWidth: '120px' }} disabled>
          <option>All Tags</option>
        </select>
        <select className="input-base text-sm py-1.5" style={{ maxWidth: '120px' }} disabled>
          <option>All Boards</option>
        </select>

        {/* Search */}
        <div className="flex-1 relative" style={{ maxWidth: '280px' }}>
          <svg className="absolute left-3 top-1/2 -translate-y-1/2" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9B8AAE" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="text"
            className="input-base text-sm py-1.5 pl-8"
            placeholder="Search by owner or APN…"
            value={search}
            onChange={e => handleSearch(e.target.value)}
          />
        </div>

        {/* Bulk action buttons — visible when rows selected */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-xs font-semibold" style={{ color: '#5C2977' }}>
              {selectedIds.size.toLocaleString()} selected
            </span>
            <button
              className="px-3 py-1.5 text-xs font-semibold rounded-lg"
              style={{ background: '#F0EBF8', color: '#5C2977', border: '1px solid #D4B8E8' }}
              onClick={() => setShowAdjustPrice(true)}
            >
              Adjust Price
            </button>
            <button
              className="px-3 py-1.5 text-xs font-semibold rounded-lg"
              style={{ background: '#F0EBF8', color: '#5C2977', border: '1px solid #D4B8E8' }}
              onClick={handleExport}
            >
              Export
            </button>
            <button
              className="px-3 py-1.5 text-xs font-semibold rounded-lg"
              style={{ background: 'rgba(183,28,28,0.07)', color: '#B71C1C', border: '1px solid rgba(183,28,28,0.2)' }}
              onClick={() => setShowDeleteConfirm(true)}
            >
              Delete
            </button>
          </div>
        )}
      </div>

      {/* Import progress bar */}
      {importPhase === 'importing' && importTotal > 0 && (
        <div style={{ background: '#5C2977', height: '3px' }}>
          <div style={{ background: '#C4A8D8', height: '100%', width: `${Math.round((importProgress / importTotal) * 100)}%`, transition: 'width 0.3s' }} />
        </div>
      )}

      {/* Table */}
      <div className="px-6 py-4">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-sm" style={{ color: '#6B5B8A' }}>Loading properties…</div>
          </div>
        ) : (
          <div className="bg-white rounded-xl overflow-hidden" style={{ border: '1px solid #EDE8F5' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: '#F8F5FC', borderBottom: '1px solid #EDE8F5' }}>
                  <th style={{ width: '36px', padding: '10px 12px' }}>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={el => { if (el) el.indeterminate = someSelected }}
                      onChange={toggleSelectAll}
                      style={{ cursor: 'pointer' }}
                    />
                  </th>
                  {['OWNER NAME', 'MAILING ADDRESS', 'APN', 'COUNTY', 'ACRES', 'CODE', 'OFFER PRICE', 'STATUS'].map(h => (
                    <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', color: '#9B8AAE' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {properties.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ padding: '40px 20px', textAlign: 'center', color: '#9B8AAE', fontSize: '13px' }}>
                      No properties found.
                    </td>
                  </tr>
                ) : properties.map((p, i) => {
                  const isSelected = selectedIds.has(p.id)
                  const sc = STATUS_COLORS[p.status ?? 'lead'] ?? STATUS_COLORS.lead
                  const mailingAddr = [p.owner_mailing_address, p.owner_mailing_city, p.owner_mailing_state, p.owner_mailing_zip]
                    .filter(Boolean).join(', ')
                  return (
                    <tr
                      key={p.id}
                      style={{
                        borderBottom: i < properties.length - 1 ? '1px solid #F5F0FC' : 'none',
                        background: isSelected ? 'rgba(92,41,119,0.04)' : 'transparent',
                        cursor: 'pointer',
                      }}
                      onClick={() => toggleSelect(p.id)}
                    >
                      <td style={{ padding: '10px 12px' }} onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(p.id)}
                          style={{ cursor: 'pointer' }}
                        />
                      </td>
                      <td style={{ padding: '10px 12px', fontWeight: 500, color: '#1A0A2E', maxWidth: '180px' }}>
                        <div className="truncate">{p.owner_full_name ?? <span style={{ color: '#C4B5D8' }}>—</span>}</div>
                      </td>
                      <td style={{ padding: '10px 12px', color: '#6B5B8A', maxWidth: '200px' }}>
                        <div className="truncate text-xs">{mailingAddr || <span style={{ color: '#C4B5D8' }}>—</span>}</div>
                      </td>
                      <td style={{ padding: '10px 12px', color: '#3D2B5E', fontFamily: 'monospace', fontSize: '11px' }}>
                        {p.apn ?? <span style={{ color: '#C4B5D8' }}>—</span>}
                      </td>
                      <td style={{ padding: '10px 12px', color: '#6B5B8A' }}>
                        {p.county ?? <span style={{ color: '#C4B5D8' }}>—</span>}
                      </td>
                      <td style={{ padding: '10px 12px', color: '#6B5B8A', textAlign: 'right' }}>
                        {p.acreage != null ? p.acreage.toFixed(2) : <span style={{ color: '#C4B5D8' }}>—</span>}
                      </td>
                      <td style={{ padding: '10px 12px', color: '#6B5B8A', fontSize: '11px', fontFamily: 'monospace' }}>
                        {p.campaign_code ?? <span style={{ color: '#C4B5D8' }}>—</span>}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: '#3D2B5E', fontWeight: 500 }}>
                        {p.offer_price != null ? `$${p.offer_price.toLocaleString()}` : <span style={{ color: '#C4B5D8' }}>—</span>}
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

            {/* Pagination footer */}
            <div
              className="flex items-center justify-between px-4 py-3"
              style={{ borderTop: '1px solid #EDE8F5', background: '#FAFAFE' }}
            >
              <span className="text-xs" style={{ color: '#9B8AAE' }}>
                {totalCount === 0 ? '0 results' : `${firstRow.toLocaleString()}–${lastRow.toLocaleString()} of ${totalCount.toLocaleString()} results`}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => goToPage(page - 1)}
                  disabled={page <= 1}
                  className="p-1.5 rounded disabled:opacity-30 transition-opacity hover:opacity-70"
                  style={{ color: '#5C2977' }}
                  title="Previous page"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="15 18 9 12 15 6"/>
                  </svg>
                </button>
                <span className="text-xs px-2 font-medium" style={{ color: '#3D2B5E' }}>
                  {page} / {totalPages || 1}
                </span>
                <button
                  onClick={() => goToPage(page + 1)}
                  disabled={page >= totalPages}
                  className="p-1.5 rounded disabled:opacity-30 transition-opacity hover:opacity-70"
                  style={{ color: '#5C2977' }}
                  title="Next page"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="9 18 15 12 9 6"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Adjust Price modal */}
      {showAdjustPrice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(26,10,46,0.55)' }}>
          <div className="bg-white rounded-2xl p-6 shadow-xl" style={{ maxWidth: '360px', width: '100%' }}>
            <h2 className="section-heading mb-1">Adjust Offer Price</h2>
            <p className="text-sm mb-4" style={{ color: '#6B5B8A' }}>
              Set a new offer price for {selectedIds.size.toLocaleString()} selected {selectedIds.size === 1 ? 'property' : 'properties'}.
            </p>
            <input
              type="number"
              className="input-base w-full text-sm mb-4"
              placeholder="New offer price (e.g. 5000)"
              value={newPrice}
              onChange={e => setNewPrice(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAdjustPrice()}
              autoFocus
              min="0"
            />
            <div className="flex gap-3">
              <button className="btn-secondary flex-1" onClick={() => { setShowAdjustPrice(false); setNewPrice('') }} disabled={adjusting}>
                Cancel
              </button>
              <button className="btn-primary flex-1" onClick={handleAdjustPrice} disabled={adjusting || !newPrice}>
                {adjusting ? 'Updating…' : 'Apply Price'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(26,10,46,0.55)' }}>
          <div className="bg-white rounded-2xl p-6 shadow-xl" style={{ maxWidth: '400px', width: '100%' }}>
            <h2 className="section-heading mb-2">Delete {selectedIds.size.toLocaleString()} {selectedIds.size === 1 ? 'Property' : 'Properties'}?</h2>
            <p className="text-sm mb-6" style={{ color: '#6B5B8A' }}>This cannot be undone.</p>
            <div className="flex gap-3">
              <button className="btn-secondary flex-1" onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>Cancel</button>
              <button
                className="flex-1 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60"
                style={{ background: '#B71C1C' }}
                onClick={handleDelete}
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
