import React, { useEffect, useRef, useState } from 'react'
import DataTable from '../components/DataTable'
import type { Column } from '../components/DataTable'
import type { CRMProperty, CRMCampaign, PropertyStatus } from '../types/crm'
import Papa from 'papaparse'
import { listProperties, createProperty, updateProperty, deleteProperty, bulkInsertRows, deleteProperties, getPropertyCounts, listCrmCampaigns, createCrmCampaign } from '../api/crm'
import PropertyDetail from './PropertyDetail'
import { useApp } from '../context/AppContext'

type View = 'list' | 'detail' | 'new'

const PAGE_SIZE = 50

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
  lead: 'Lead',
  prospect: 'Prospect',
  offer_sent: 'Offer Sent',
  under_contract: 'Under Contract',
  due_diligence: 'Due Diligence',
  closed_won: 'Closed Won',
  closed_lost: 'Closed Lost',
  dead: 'Dead',
}

const ALL_STATUSES = ['all', 'lead', 'prospect', 'offer_sent', 'under_contract', 'due_diligence', 'closed_won', 'closed_lost']

// ── Main component ─────────────────────────────────────────────────────────

export default function Properties() {
  const { propertyCampaignId, setPropertyCampaignId } = useApp()
  const [view, setView] = useState<View>('list')
  const [selected, setSelected] = useState<CRMProperty | null>(null)
  const [properties, setProperties] = useState<CRMProperty[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('all')
  const [campaignFilter, setCampaignFilter] = useState<string>(propertyCampaignId ?? '')
  const [campaigns, setCampaigns] = useState<CRMCampaign[]>([])
  const [allCounts, setAllCounts] = useState<{ total: number; by_status: Record<string, number> }>({ total: 0, by_status: {} })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    const initialCampaign = propertyCampaignId ?? ''
    setCampaignFilter(initialCampaign)
    setPropertyCampaignId(null) // clear so next visit starts fresh
    loadPage(1, 'all', initialCampaign)
    listCrmCampaigns().then(setCampaigns).catch(() => {})
  }, [])

  async function loadPage(p: number, sf: string, cf = campaignFilter) {
    setLoading(true)
    setError(null)
    try {
      const [res, counts] = await Promise.all([
        listProperties({
          page: p,
          limit: PAGE_SIZE,
          status: sf === 'all' ? undefined : sf,
          campaign_id: cf || undefined,
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
      setError(detail && !detail.includes('SUPABASE') ? detail : 'Failed to load properties. Check that the backend API is reachable.')
    } finally {
      setLoading(false)
    }
  }

  function handleStatusChange(s: string) {
    setStatusFilter(s)
    loadPage(1, s, campaignFilter)
  }

  function handleCampaignChange(cid: string) {
    setCampaignFilter(cid)
    loadPage(1, statusFilter, cid)
  }

  function goToPage(p: number) {
    loadPage(p, statusFilter, campaignFilter)
  }

  async function handleBulkDelete() {
    setDeleting(true)
    try {
      await deleteProperties(Array.from(selectedIds))
      setSelectedIds(new Set())
      setShowDeleteConfirm(false)
      loadPage(page, statusFilter, campaignFilter)
    } catch {
      setError('Failed to delete selected properties.')
      setShowDeleteConfirm(false)
    } finally {
      setDeleting(false)
    }
  }

  if (view === 'detail' && selected) {
    return (
      <PropertyDetail
        property={selected}
        onBack={() => { setView('list'); setSelected(null); loadPage(page, statusFilter, campaignFilter) }}
        onSave={async (updates) => {
          const updated = await updateProperty(selected.id, updates)
          setSelected(updated)
        }}
        onDelete={async () => {
          await deleteProperty(selected.id)
          setView('list')
          setSelected(null)
          loadPage(page, statusFilter, campaignFilter)
        }}
      />
    )
  }

  if (view === 'new') {
    return (
      <PropertyDetail
        property={null}
        onBack={() => { setView('list'); loadPage(page, statusFilter, campaignFilter) }}
        onSave={async (data) => { await createProperty(data); setView('list'); loadPage(1, statusFilter, campaignFilter) }}
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

  const columns: Column<CRMProperty>[] = [
    {
      key: 'apn',
      header: 'APN',
      sortable: true,
      render: (val, row) => (
        <button
          onClick={e => { e.stopPropagation(); setSelected(row); setView('detail') }}
          className="text-left font-semibold hover:underline"
          style={{ color: '#5C2977' }}
        >
          {val ? String(val) : <span style={{ color: '#9B8AAE' }}>—</span>}
        </button>
      ),
    },
    { key: 'county', header: 'County', sortable: true },
    { key: 'state', header: 'State', sortable: true },
    {
      key: 'acreage',
      header: 'Acres',
      sortable: true,
      align: 'right',
      render: (val) => val != null ? Number(val).toFixed(2) : <span style={{ color: '#9B8AAE' }}>—</span>,
    },
    {
      key: 'owner_full_name',
      header: 'Owner',
      sortable: true,
      render: (val) => val ? String(val) : <span style={{ color: '#9B8AAE' }}>—</span>,
    },
    {
      key: 'offer_price',
      header: 'Offer Price',
      sortable: true,
      align: 'right',
      render: (val) => val != null ? `$${Number(val).toLocaleString()}` : <span style={{ color: '#9B8AAE' }}>—</span>,
    },
    {
      key: 'campaign_code',
      header: 'Campaign',
      sortable: true,
      defaultHidden: true,
      render: (val) => val ? String(val) : <span style={{ color: '#9B8AAE' }}>—</span>,
    },
    {
      key: 'lp_estimate',
      header: 'LP Estimate',
      sortable: true,
      align: 'right',
      defaultHidden: true,
      render: (val) => val != null ? `$${Number(val).toLocaleString()}` : <span style={{ color: '#9B8AAE' }}>—</span>,
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (val, row) => (
        <StatusDropdown
          status={String(val || 'lead') as PropertyStatus}
          onStatusChange={async (newStatus) => {
            await updateProperty(row.id, { status: newStatus })
            setProperties(prev => prev.map(p => p.id === row.id ? { ...p, status: newStatus } : p))
          }}
        />
      ),
    },
    {
      key: 'tags',
      header: 'Tags',
      defaultHidden: true,
      render: (val) => {
        const tags = (val as string[] | undefined) || []
        return tags.length > 0 ? (
          <div className="flex gap-1 flex-wrap">
            {tags.slice(0, 3).map(t => (
              <span key={t} className="px-1.5 py-0.5 rounded text-[11px]"
                style={{ background: '#F0EBF8', color: '#5C2977' }}>{t}</span>
            ))}
            {tags.length > 3 && (
              <span className="text-[11px]" style={{ color: '#9B8AAE' }}>+{tags.length - 3}</span>
            )}
          </div>
        ) : <span style={{ color: '#9B8AAE' }}>—</span>
      },
    },
  ]

  return (
    <div className="page-content">
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Properties</h1>
          <p className="page-subtitle">{allCounts.total.toLocaleString()} properties in CRM</p>
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <button
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors flex items-center gap-2"
              style={{ background: '#B71C1C' }}
              onClick={() => setShowDeleteConfirm(true)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                <path d="M10 11v6M14 11v6"/>
              </svg>
              Delete Selected ({selectedIds.size.toLocaleString()})
            </button>
          )}
          <button className="btn-secondary" onClick={() => setShowImport(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Import CSV
          </button>
          <button className="btn-primary" onClick={() => setView('new')}>
            + New Property
          </button>
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
              <span className="stat-value" style={{ fontSize: '28px' }}>{s.value.toLocaleString()}</span>
            </div>
          ))}
        </div>

        {/* Campaign filter */}
        {campaigns.length > 0 && (
          <div className="flex items-center gap-3 mb-4">
            <span className="text-xs font-semibold" style={{ color: '#6B5B8A' }}>Campaign:</span>
            <select
              className="input-base text-sm py-1.5"
              style={{ maxWidth: '280px' }}
              value={campaignFilter}
              onChange={e => handleCampaignChange(e.target.value)}
            >
              <option value="">All Campaigns</option>
              {campaigns.map(c => (
                <option key={c.id} value={c.id}>{c.name} ({(c.property_count ?? 0).toLocaleString()})</option>
              ))}
            </select>
            {campaignFilter && (
              <button
                className="text-xs px-2 py-1 rounded"
                style={{ color: '#5C2977', background: 'rgba(92,41,119,0.07)', border: '1px solid #D4B8E8' }}
                onClick={() => handleCampaignChange('')}
              >
                Clear filter
              </button>
            )}
          </div>
        )}

        {/* Status filters */}
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
                <span className="ml-1.5 opacity-70">
                  {(allCounts.by_status[s] ?? 0).toLocaleString()}
                </span>
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
            <div className="text-sm" style={{ color: '#6B5B8A' }}>Loading properties…</div>
          </div>
        ) : (
          <>
            <div className="card-static">
              <DataTable
                columns={columns}
                data={properties}
                searchable
                searchKeys={['apn', 'county', 'state', 'owner_full_name', 'campaign_code', 'status', 'marketing_nearest_city']}
                pageSize={PAGE_SIZE}
                emptyMessage={statusFilter === 'all'
                  ? 'No properties yet. Import a Pebble CSV or add one manually.'
                  : `No properties with status "${STATUS_LABELS[statusFilter] || statusFilter}".`}
                onRowClick={(row) => { setSelected(row); setView('detail') }}
                selectable
                selectedKeys={selectedIds}
                getRowKey={(row) => row.id}
                onSelectionChange={setSelectedIds}
              />
            </div>

            {/* Pagination controls */}
            {totalCount > PAGE_SIZE && (
              <div className="flex items-center justify-between mt-4 px-1">
                <span className="text-sm" style={{ color: '#6B5B8A' }}>
                  Showing {firstRow.toLocaleString()}–{lastRow.toLocaleString()} of {totalCount.toLocaleString()}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    className="px-3 py-1.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-40"
                    style={{ background: 'rgba(92,41,119,0.07)', color: '#5C2977', border: '1px solid #D4B8E8' }}
                    onClick={() => goToPage(page - 1)}
                    disabled={page <= 1}
                  >
                    ← Previous
                  </button>
                  <span className="text-sm font-medium px-2" style={{ color: '#3D2B5E' }}>
                    Page {page} of {totalPages.toLocaleString()}
                  </span>
                  <button
                    className="px-3 py-1.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-40"
                    style={{ background: 'rgba(92,41,119,0.07)', color: '#5C2977', border: '1px solid #D4B8E8' }}
                    onClick={() => goToPage(page + 1)}
                    disabled={page >= totalPages}
                  >
                    Next →
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {showImport && (
        <ImportModal
          campaigns={campaigns}
          onCampaignCreated={camp => setCampaigns(prev => [camp, ...prev])}
          onDone={() => {
            listCrmCampaigns().then(setCampaigns).catch(() => {})
            loadPage(1, statusFilter, campaignFilter)
          }}
          onClose={() => setShowImport(false)}
        />
      )}

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(26,10,46,0.55)' }}>
          <div className="bg-white rounded-2xl p-6 w-full shadow-xl" style={{ maxWidth: '400px' }}>
            <h2 className="section-heading mb-3">Delete {selectedIds.size.toLocaleString()} Properties?</h2>
            <p className="text-sm mb-6" style={{ color: '#6B5B8A' }}>
              This will permanently delete {selectedIds.size.toLocaleString()} selected {selectedIds.size === 1 ? 'property' : 'properties'}. This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button className="btn-secondary flex-1" onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>
                Cancel
              </button>
              <button
                className="flex-1 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-opacity disabled:opacity-60"
                style={{ background: '#B71C1C' }}
                onClick={handleBulkDelete}
                disabled={deleting}
              >
                {deleting ? 'Deleting…' : `Delete ${selectedIds.size.toLocaleString()} ${selectedIds.size === 1 ? 'Property' : 'Properties'}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Status inline dropdown ─────────────────────────────────────────────────

function StatusDropdown({
  status,
  onStatusChange,
}: {
  status: PropertyStatus
  onStatusChange: (s: PropertyStatus) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  const c = STATUS_COLORS[status] || STATUS_COLORS.lead

  async function select(s: PropertyStatus) {
    if (s === status) { setOpen(false); return }
    setSaving(true)
    setOpen(false)
    try { await onStatusChange(s) } finally { setSaving(false) }
  }

  return (
    <div ref={ref} className="relative inline-block" onClick={e => e.stopPropagation()}>
      <button
        onClick={() => setOpen(v => !v)}
        disabled={saving}
        className="px-2 py-0.5 rounded-full text-xs font-semibold flex items-center gap-1 transition-opacity hover:opacity-80"
        style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}`, opacity: saving ? 0.6 : 1 }}
      >
        {saving ? '…' : STATUS_LABELS[status] || status}
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {open && (
        <div
          className="absolute left-0 top-full mt-1 rounded-lg z-50 py-1 min-w-[140px]"
          style={{ background: '#FFFFFF', border: '1px solid #E8E0F0', boxShadow: '0 4px 16px rgba(61,26,94,0.12)' }}
        >
          {(Object.keys(STATUS_LABELS) as PropertyStatus[]).map(s => {
            const sc = STATUS_COLORS[s] || STATUS_COLORS.lead
            return (
              <button
                key={s}
                onClick={() => select(s)}
                className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors"
                style={{ color: s === status ? sc.text : '#3D2B5E', fontWeight: s === status ? 600 : 400 }}
                onMouseEnter={e => (e.currentTarget.style.background = '#F8F5FC')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <span className="w-2 h-2 rounded-full flex-none" style={{ background: sc.text }} />
                {STATUS_LABELS[s]}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Import modal ───────────────────────────────────────────────────────────

const CHUNK_SIZE = 50

function ImportModal({ campaigns, onCampaignCreated, onDone, onClose }: {
  campaigns: CRMCampaign[]
  onCampaignCreated: (c: CRMCampaign) => void
  onDone: () => void
  onClose: () => void
}) {
  // Step 1: campaign selection
  const [step, setStep] = useState<'campaign' | 'file'>('campaign')
  const [selectedCampaignId, setSelectedCampaignId] = useState('')
  const [isNewCampaign, setIsNewCampaign] = useState(false)
  const [newCampaignName, setNewCampaignName] = useState('')
  const [creatingCampaign, setCreatingCampaign] = useState(false)
  const [campaignError, setCampaignError] = useState('')

  // Step 2: file + import
  const [dragOver, setDragOver] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'parsing' | 'importing' | 'done' | 'error'>('idle')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [totalRows, setTotalRows] = useState(0)
  const [progress, setProgress] = useState(0)
  const [imported, setImported] = useState(0)
  const [failed, setFailed] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')
  const cancelledRef = useRef(false)

  async function handleCampaignNext() {
    setCampaignError('')
    if (isNewCampaign) {
      if (!newCampaignName.trim()) { setCampaignError('Enter a campaign name.'); return }
      setCreatingCampaign(true)
      try {
        const camp = await createCrmCampaign(newCampaignName.trim())
        onCampaignCreated(camp)
        setSelectedCampaignId(camp.id)
        setStep('file')
      } catch {
        setCampaignError('Failed to create campaign.')
      } finally {
        setCreatingCampaign(false)
      }
    } else {
      if (!selectedCampaignId) { setCampaignError('Select a campaign or create a new one.'); return }
      setStep('file')
    }
  }

  const selectedCampaignName = isNewCampaign
    ? newCampaignName
    : campaigns.find(c => c.id === selectedCampaignId)?.name ?? ''

  function isCSV(f: File) { return f.name.toLowerCase().endsWith('.csv') }
  function pickFile(f: File) { if (isCSV(f)) setSelectedFile(f) }

  function startImport() {
    if (!selectedFile) return
    cancelledRef.current = false
    setPhase('parsing')

    Papa.parse<Record<string, string>>(selectedFile, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h: string) => h.trim(),
      complete: async (results) => {
        const rows = results.data
        if (rows.length === 0) {
          setErrorMsg('CSV appears to be empty or has no data rows.')
          setPhase('error')
          return
        }
        setTotalRows(rows.length)
        setPhase('importing')

        let totalImported = 0
        let totalFailed = 0

        for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
          if (cancelledRef.current) break
          const chunk = rows.slice(i, i + CHUNK_SIZE)
          try {
            const result = await bulkInsertRows(chunk, selectedCampaignId || undefined)
            totalImported += result.imported
            totalFailed += result.skipped
          } catch (e: unknown) {
            totalFailed += chunk.length
          }
          setProgress(Math.min(i + CHUNK_SIZE, rows.length))
          setImported(totalImported)
          setFailed(totalFailed)
        }

        setPhase('done')
        onDone()
      },
      error: (err: Error) => {
        setErrorMsg(`Failed to parse CSV: ${err.message}`)
        setPhase('error')
      },
    })
  }

  const pct = totalRows > 0 ? Math.round((progress / totalRows) * 100) : 0
  const busy = phase === 'parsing' || phase === 'importing'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(26,10,46,0.55)' }}>
      <div className="bg-white rounded-2xl p-6 w-full shadow-xl" style={{ maxWidth: '480px' }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="section-heading">Import Pebble CSV</h2>
          {!busy && step !== 'campaign' && (
            <button onClick={() => setStep('campaign')} style={{ color: '#9B8AAE', fontSize: '13px' }}>← Back</button>
          )}
          {!busy && (
            <button onClick={onClose} style={{ color: '#9B8AAE', fontSize: '18px', lineHeight: 1 }}>✕</button>
          )}
        </div>

        {/* Step 1: Campaign selection */}
        {step === 'campaign' ? (
          <>
            <p className="text-sm mb-4" style={{ color: '#6B5B8A' }}>
              Which campaign is this import for? Properties will be tagged automatically.
            </p>

            <div className="mb-4">
              <label className="text-xs font-semibold mb-2 block" style={{ color: '#3D2B5E' }}>Select existing campaign</label>
              <select
                className="input-base w-full text-sm"
                value={isNewCampaign ? '__new__' : selectedCampaignId}
                onChange={e => {
                  if (e.target.value === '__new__') { setIsNewCampaign(true); setSelectedCampaignId('') }
                  else { setIsNewCampaign(false); setSelectedCampaignId(e.target.value) }
                }}
              >
                <option value="">— Choose a campaign —</option>
                {campaigns.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
                <option value="__new__">+ Create new campaign…</option>
              </select>
            </div>

            {isNewCampaign && (
              <div className="mb-4">
                <label className="text-xs font-semibold mb-2 block" style={{ color: '#3D2B5E' }}>New campaign name</label>
                <input
                  type="text"
                  className="input-base w-full text-sm"
                  placeholder="e.g. Brunswick County April 2026"
                  value={newCampaignName}
                  onChange={e => setNewCampaignName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleCampaignNext()}
                  maxLength={80}
                  autoFocus
                />
              </div>
            )}

            {campaignError && (
              <p className="text-sm mb-3" style={{ color: '#B71C1C' }}>{campaignError}</p>
            )}

            <div className="flex gap-2">
              <button className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
              <button
                className="btn-primary flex-1"
                onClick={handleCampaignNext}
                disabled={creatingCampaign || (!isNewCampaign && !selectedCampaignId)}
              >
                {creatingCampaign ? 'Creating…' : 'Next →'}
              </button>
            </div>
          </>

        ) : phase === 'done' ? (
          <>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="p-4 rounded-xl text-center" style={{ background: '#E8F5E9' }}>
                <div className="text-3xl font-bold" style={{ color: '#2E7D32' }}>{imported.toLocaleString()}</div>
                <div className="text-xs mt-1 font-medium" style={{ color: '#2E7D32' }}>Imported</div>
              </div>
              <div className="p-4 rounded-xl text-center" style={{ background: '#FFF8E1' }}>
                <div className="text-3xl font-bold" style={{ color: '#F57F17' }}>{failed.toLocaleString()}</div>
                <div className="text-xs mt-1 font-medium" style={{ color: '#F57F17' }}>Failed</div>
              </div>
            </div>
            <p className="text-sm mb-4 text-center" style={{ color: '#6B5B8A' }}>
              Import complete — {imported.toLocaleString()} imported, {failed.toLocaleString()} failed.
            </p>
            <button className="btn-primary w-full" onClick={onClose}>Done</button>
          </>

        ) : phase === 'parsing' ? (
          <div className="text-center py-8">
            <div className="inline-block w-10 h-10 rounded-full mb-4" style={{
              border: '3px solid #E8E0F0', borderTopColor: '#5C2977',
              animation: 'spin 0.8s linear infinite',
            }} />
            <div className="text-base font-semibold" style={{ color: '#3D2B5E' }}>Parsing CSV…</div>
          </div>

        ) : phase === 'importing' ? (
          <div className="text-center py-4">
            <div className="text-lg font-semibold mb-1" style={{ color: '#3D2B5E' }}>
              Importing {progress.toLocaleString()} of {totalRows.toLocaleString()}…
            </div>
            <div className="text-sm mb-4" style={{ color: '#9B8AAE' }}>
              {imported.toLocaleString()} imported · {failed.toLocaleString()} failed
            </div>
            <div className="w-full rounded-full overflow-hidden mb-1" style={{ height: '8px', background: '#E8E0F0' }}>
              <div className="h-full rounded-full transition-all duration-200"
                style={{ width: `${pct}%`, background: '#5C2977' }} />
            </div>
            <div className="text-xs mb-4" style={{ color: '#9B8AAE' }}>{pct}%</div>
            <button className="btn-secondary text-xs" onClick={() => { cancelledRef.current = true }}>
              Cancel
            </button>
          </div>

        ) : phase === 'error' ? (
          <>
            <div className="p-3 rounded-lg mb-4 text-sm" style={{ background: '#FFF0F0', color: '#B71C1C', border: '1px solid #FFCDD2' }}>
              {errorMsg}
            </div>
            <div className="flex gap-2">
              <button className="btn-secondary flex-1" onClick={() => { setPhase('idle'); setErrorMsg('') }}>Try Again</button>
              <button className="btn-secondary flex-1" onClick={onClose}>Close</button>
            </div>
          </>

        ) : (
          <>
            {selectedCampaignName && (
              <div className="mb-3 px-3 py-2 rounded-lg flex items-center gap-2" style={{ background: '#F0EBF8', border: '1px solid #D4B8E8' }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#5C2977" strokeWidth="2">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
                <span className="text-xs font-semibold" style={{ color: '#5C2977' }}>{selectedCampaignName}</span>
              </div>
            )}
            <p className="text-sm mb-4" style={{ color: '#6B5B8A' }}>
              Upload a Pebble REI export CSV. Parsed in the browser and sent in {CHUNK_SIZE}-row chunks — no timeouts possible.
            </p>
            <div
              className={`drop-zone${dragOver ? ' drag-over' : ''}`}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) pickFile(f) }}
              onClick={() => document.getElementById('pebble-csv-input')?.click()}
              style={{ cursor: 'pointer' }}
            >
              <div className="drop-zone-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
              </div>
              <div className="drop-zone-title">
                {selectedFile ? selectedFile.name : 'Drop CSV here or click to browse'}
              </div>
              <div style={{ fontSize: '13px', color: selectedFile ? '#2E7D32' : '#9B8AAE', marginTop: '6px', fontWeight: selectedFile ? 600 : 400 }}>
                {selectedFile ? `${(selectedFile.size / 1024 / 1024).toFixed(1)} MB — ready` : '.csv files only'}
              </div>
            </div>
            <input id="pebble-csv-input" type="file" accept=".csv" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) pickFile(f); (e.target as HTMLInputElement).value = '' }} />
            <div className="flex gap-2 mt-4">
              <button className="btn-primary flex-1" onClick={startImport} disabled={!selectedFile}>
                {selectedFile ? 'Parse & Import' : 'Select a CSV file first'}
              </button>
              {selectedFile && (
                <button className="btn-secondary" onClick={() => setSelectedFile(null)} title="Clear">✕</button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
