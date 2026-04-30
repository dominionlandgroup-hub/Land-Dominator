import React, { useEffect, useRef, useState } from 'react'
import DataTable from '../components/DataTable'
import type { Column } from '../components/DataTable'
import type { CRMProperty, PropertyStatus } from '../types/crm'
import { listProperties, createProperty, updateProperty, deleteProperty, importPropertiesBatch, deleteProperties } from '../api/crm'
import PropertyDetail from './PropertyDetail'

type View = 'list' | 'detail' | 'new'

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

// ── CSV parser ─────────────────────────────────────────────────────────────

function parseCSV(text: string): Record<string, string>[] {
  const t = text.startsWith('﻿') ? text.slice(1) : text

  const rows: string[][] = []
  let current: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0

  while (i < t.length) {
    const ch = t[i]
    if (inQuotes) {
      if (ch === '"') {
        if (t[i + 1] === '"') { field += '"'; i += 2 }
        else { inQuotes = false; i++ }
      } else { field += ch; i++ }
    } else {
      if (ch === '"') { inQuotes = true; i++ }
      else if (ch === ',') { current.push(field); field = ''; i++ }
      else if (ch === '\r') {
        if (t[i + 1] === '\n') i++
        current.push(field); field = ''; rows.push(current); current = []; i++
      } else if (ch === '\n') {
        current.push(field); field = ''; rows.push(current); current = []; i++
      } else { field += ch; i++ }
    }
  }
  if (field || current.length > 0) {
    current.push(field)
    if (current.some(f => f.trim())) rows.push(current)
  }

  if (rows.length < 2) return []
  const headers = rows[0]
  return rows.slice(1)
    .filter(row => row.some(f => f.trim()))
    .map(row => {
      const record: Record<string, string> = {}
      headers.forEach((h, idx) => { record[h] = row[idx] ?? '' })
      return record
    })
}

// ── Main component ─────────────────────────────────────────────────────────

export default function Properties() {
  const [view, setView] = useState<View>('list')
  const [selected, setSelected] = useState<CRMProperty | null>(null)
  const [properties, setProperties] = useState<CRMProperty[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [statusFilter, setStatusFilter] = useState('all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => { fetchProperties() }, [])

  async function fetchProperties() {
    setLoading(true)
    setError(null)
    try {
      const data = await listProperties()
      setProperties(data)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      const detail = err?.response?.data?.detail ?? ''
      setError(detail && !detail.includes('SUPABASE') ? detail : 'Failed to load properties. Check that the backend API is reachable.')
    } finally {
      setLoading(false)
    }
  }

  async function handleBulkDelete() {
    setDeleting(true)
    try {
      await deleteProperties(Array.from(selectedIds))
      setSelectedIds(new Set())
      setShowDeleteConfirm(false)
      await fetchProperties()
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
        onBack={() => { setView('list'); setSelected(null); fetchProperties() }}
        onSave={async (updates) => {
          const updated = await updateProperty(selected.id, updates)
          setSelected(updated)
        }}
        onDelete={async () => {
          await deleteProperty(selected.id)
          setView('list')
          setSelected(null)
          fetchProperties()
        }}
      />
    )
  }

  if (view === 'new') {
    return (
      <PropertyDetail
        property={null}
        onBack={() => { setView('list'); fetchProperties() }}
        onSave={async (data) => { await createProperty(data); setView('list'); fetchProperties() }}
        onDelete={() => Promise.resolve()}
      />
    )
  }

  const filtered = statusFilter === 'all'
    ? properties
    : properties.filter(p => p.status === statusFilter)

  const counts = {
    total: properties.length,
    lead: properties.filter(p => p.status === 'lead').length,
    offer_sent: properties.filter(p => p.status === 'offer_sent').length,
    under_contract: properties.filter(p => p.status === 'under_contract').length,
    closed_won: properties.filter(p => p.status === 'closed_won').length,
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
          <p className="page-subtitle">{properties.length.toLocaleString()} properties in CRM</p>
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
              <span className="stat-value" style={{ fontSize: '28px' }}>{s.value}</span>
            </div>
          ))}
        </div>

        {/* Status filters */}
        <div className="flex items-center gap-2 mb-5 flex-wrap">
          {ALL_STATUSES.map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
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
                  {properties.filter(p => p.status === s).length}
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
          <div className="card-static">
            <DataTable
              columns={columns}
              data={filtered}
              searchable
              searchKeys={['apn', 'county', 'state', 'owner_full_name', 'campaign_code', 'status', 'marketing_nearest_city']}
              pageSize={50}
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
        )}
      </div>

      {showImport && (
        <ImportModal
          onDone={fetchProperties}
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

function ImportModal({ onDone, onClose }: {
  onDone: () => void
  onClose: () => void
}) {
  const [dragOver, setDragOver] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'ready' | 'importing' | 'done'>('idle')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [rowCount, setRowCount] = useState(0)
  const [progress, setProgress] = useState(0)
  const [imported, setImported] = useState(0)
  const [failed, setFailed] = useState(0)
  const [parsedRows, setParsedRows] = useState<Record<string, string>[]>([])
  const cancelledRef = useRef(false)

  function isCSV(f: File) { return f.name.toLowerCase().endsWith('.csv') }

  async function handleFile(f: File) {
    if (!isCSV(f)) return
    setSelectedFile(f)
    const text = await f.text()
    const rows = parseCSV(text)
    setParsedRows(rows)
    setRowCount(rows.length)
    setPhase('ready')
  }

  async function startImport() {
    if (!parsedRows.length) return
    cancelledRef.current = false
    setPhase('importing')
    setProgress(0)
    setImported(0)
    setFailed(0)

    const BATCH_SIZE = 100
    let totalImported = 0
    let totalFailed = 0

    for (let i = 0; i < parsedRows.length; i += BATCH_SIZE) {
      if (cancelledRef.current) break
      const batch = parsedRows.slice(i, i + BATCH_SIZE)
      let succeeded = false

      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const result = await importPropertiesBatch(batch)
          totalImported += result.imported
          totalFailed += result.skipped
          succeeded = true
          break
        } catch {
          if (attempt === 1) totalFailed += batch.length
        }
      }

      if (!succeeded) {
        // already counted failed above
      }

      const done = Math.min(i + BATCH_SIZE, parsedRows.length)
      setProgress(done)
      setImported(totalImported)
      setFailed(totalFailed)

      if (i + BATCH_SIZE < parsedRows.length) {
        await new Promise(r => setTimeout(r, 50))
      }
    }

    setPhase('done')
    onDone()
  }

  function cancel() {
    cancelledRef.current = true
    onClose()
  }

  const pct = rowCount > 0 ? Math.round((progress / rowCount) * 100) : 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(26,10,46,0.55)' }}>
      <div className="bg-white rounded-2xl p-6 w-full shadow-xl" style={{ maxWidth: '480px' }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="section-heading">Import Pebble CSV</h2>
          <button
            onClick={phase === 'importing' ? cancel : onClose}
            style={{ color: '#9B8AAE', fontSize: '18px', lineHeight: 1 }}
          >✕</button>
        </div>

        {phase === 'done' ? (
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
              Import complete. {imported.toLocaleString()} imported, {failed.toLocaleString()} failed.
            </p>
            <button className="btn-primary w-full" onClick={onClose}>Done</button>
          </>
        ) : phase === 'importing' ? (
          <>
            <div className="text-center py-6">
              <div className="text-lg font-semibold mb-1" style={{ color: '#3D2B5E' }}>
                Importing {progress.toLocaleString()} of {rowCount.toLocaleString()}…
              </div>
              <div className="text-sm mb-4" style={{ color: '#9B8AAE' }}>
                {imported.toLocaleString()} imported · {failed.toLocaleString()} failed
              </div>
              <div className="w-full rounded-full overflow-hidden" style={{ height: '8px', background: '#E8E0F0' }}>
                <div
                  className="h-full rounded-full transition-all duration-200"
                  style={{ width: `${pct}%`, background: '#5C2977' }}
                />
              </div>
              <div className="text-xs mt-2" style={{ color: '#9B8AAE' }}>{pct}%</div>
            </div>
            <button className="btn-secondary w-full" onClick={cancel}>Cancel</button>
          </>
        ) : (
          <>
            <p className="text-sm mb-4" style={{ color: '#6B5B8A' }}>
              Upload a Pebble REI property export CSV (supports 81-column format).
              Columns are matched automatically — case-insensitive.
            </p>

            <div
              className={`drop-zone${dragOver ? ' drag-over' : ''}`}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
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
              {phase === 'ready' && rowCount > 0 && (
                <div style={{ fontSize: '13px', color: '#2E7D32', marginTop: '6px', fontWeight: 600 }}>
                  {rowCount.toLocaleString()} rows ready to import
                </div>
              )}
              {phase === 'idle' && (
                <div style={{ fontSize: '13px', color: '#9B8AAE', marginTop: '6px' }}>.csv files only</div>
              )}
            </div>

            <input
              id="pebble-csv-input"
              type="file"
              accept=".csv"
              style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); (e.target as HTMLInputElement).value = '' }}
            />

            <div className="flex gap-2 mt-4">
              <button
                className="btn-primary flex-1"
                onClick={startImport}
                disabled={phase !== 'ready'}
              >
                {phase === 'ready'
                  ? `Import ${rowCount.toLocaleString()} rows`
                  : 'Select a CSV file first'}
              </button>
              {selectedFile && (
                <button
                  className="btn-secondary"
                  onClick={() => { setSelectedFile(null); setPhase('idle'); setParsedRows([]); setRowCount(0) }}
                  title="Clear selection"
                >✕</button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
