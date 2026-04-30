import React, { useEffect, useState } from 'react'
import DataTable from '../components/DataTable'
import type { Column } from '../components/DataTable'
import type { CRMProperty, ImportResult } from '../types/crm'
import { listProperties, createProperty, updateProperty, deleteProperty, importProperties } from '../api/crm'
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

export default function Properties() {
  const [view, setView] = useState<View>('list')
  const [selected, setSelected] = useState<CRMProperty | null>(null)
  const [properties, setProperties] = useState<CRMProperty[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [statusFilter, setStatusFilter] = useState('all')

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

  async function handleImport(file: File) {
    setImporting(true)
    try {
      const result = await importProperties(file)
      setImportResult(result)
      await fetchProperties()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setError(err?.response?.data?.detail ?? 'Import failed')
    } finally {
      setImporting(false)
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
          onClick={() => { setSelected(row); setView('detail') }}
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
      render: (val) => {
        const s = String(val || 'lead')
        const c = STATUS_COLORS[s] || STATUS_COLORS.lead
        return (
          <span className="px-2 py-0.5 rounded-full text-xs font-semibold"
            style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}>
            {STATUS_LABELS[s] || s}
          </span>
        )
      },
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
            />
          </div>
        )}
      </div>

      {showImport && (
        <ImportModal
          importing={importing}
          result={importResult}
          onImport={handleImport}
          onClose={() => { setShowImport(false); setImportResult(null) }}
        />
      )}
    </div>
  )
}

function ImportModal({
  importing, result, onImport, onClose,
}: {
  importing: boolean
  result: ImportResult | null
  onImport: (f: File) => void
  onClose: () => void
}) {
  const [dragOver, setDragOver] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)

  function isCSV(f: File) { return f.name.toLowerCase().endsWith('.csv') }

  function handleDrop(f: File) {
    if (!isCSV(f)) return
    setSelectedFile(f)
    onImport(f)  // auto-import on drop
  }

  function handleBrowse(f: File) {
    if (!isCSV(f)) return
    setSelectedFile(f)
    // don't auto-import — user clicks the Import button
  }

  function triggerImport() {
    if (selectedFile && !importing) onImport(selectedFile)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(26,10,46,0.55)' }}>
      <div className="bg-white rounded-2xl p-6 w-full shadow-xl" style={{ maxWidth: '480px' }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="section-heading">Import Pebble CSV</h2>
          <button onClick={onClose} style={{ color: '#9B8AAE', fontSize: '18px', lineHeight: 1 }}>✕</button>
        </div>

        {result ? (
          <>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="p-4 rounded-xl text-center" style={{ background: '#E8F5E9' }}>
                <div className="text-3xl font-bold" style={{ color: '#2E7D32' }}>{result.imported}</div>
                <div className="text-xs mt-1 font-medium" style={{ color: '#2E7D32' }}>Imported</div>
              </div>
              <div className="p-4 rounded-xl text-center" style={{ background: '#FFF8E1' }}>
                <div className="text-3xl font-bold" style={{ color: '#F57F17' }}>{result.skipped}</div>
                <div className="text-xs mt-1 font-medium" style={{ color: '#F57F17' }}>Skipped</div>
              </div>
            </div>
            {result.errors.length > 0 && (
              <div className="p-3 rounded-lg mb-4 text-xs" style={{ background: '#FFF0F0', color: '#B71C1C', border: '1px solid #FFCDD2' }}>
                <div className="font-semibold mb-1">Row errors ({result.errors.length}):</div>
                {result.errors.slice(0, 5).map((e, i) => <div key={i}>{e}</div>)}
                {result.errors.length > 5 && <div>…and {result.errors.length - 5} more</div>}
              </div>
            )}
            <button className="btn-primary w-full" onClick={onClose}>Done</button>
          </>
        ) : (
          <>
            <p className="text-sm mb-4" style={{ color: '#6B5B8A' }}>
              Upload a Pebble REI property export CSV (supports 81-column format).
              Column headers are matched automatically — case-insensitive.
            </p>

            {/* Drop zone */}
            <div
              className={`drop-zone${dragOver ? ' drag-over' : ''}`}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleDrop(f) }}
              onClick={() => !importing && document.getElementById('pebble-csv-input')?.click()}
              style={{ cursor: importing ? 'not-allowed' : 'pointer' }}
            >
              <div className="drop-zone-icon">
                {importing
                  ? <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
                  : <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                }
              </div>
              <div className="drop-zone-title">
                {importing ? 'Importing…' : selectedFile ? selectedFile.name : 'Drop CSV here or click to browse'}
              </div>
              {!importing && (
                <div style={{ fontSize: '13px', color: '#9B8AAE', marginTop: '6px' }}>
                  {selectedFile ? 'Click below to import, or drop a new file' : '.csv files only'}
                </div>
              )}
            </div>

            <input
              id="pebble-csv-input"
              type="file"
              accept=".csv"
              style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleBrowse(f); (e.target as HTMLInputElement).value = '' }}
            />

            {/* Import button */}
            <div className="flex gap-2 mt-4">
              <button
                className="btn-primary flex-1"
                onClick={triggerImport}
                disabled={!selectedFile || importing}
              >
                {importing ? 'Importing…' : selectedFile ? `Import "${selectedFile.name}"` : 'Select a CSV file first'}
              </button>
              {selectedFile && !importing && (
                <button
                  className="btn-secondary"
                  onClick={() => setSelectedFile(null)}
                  title="Clear selection"
                >
                  ✕
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
