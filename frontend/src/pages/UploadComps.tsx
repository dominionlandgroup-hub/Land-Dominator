import React, { useEffect, useRef, useState } from 'react'
import { useApp } from '../context/AppContext'
import {
  uploadComps,
  uploadListings,
  getCompsInventory,
  clearAllComps,
  clearCompsByState,
  clearCompsByFile,
  type CompInventoryItem,
} from '../api/client'
import type { UploadStats, ListingsStats } from '../types'

// ── Format badge ──────────────────────────────────────────────────────────────

const FORMAT_META: Record<string, { label: string; color: string }> = {
  land_portal: { label: 'Land Portal', color: '#4F46E5' },
  mls:         { label: 'MLS',         color: '#0891B2' },
  generic:     { label: 'Generic',     color: '#6B7280' },
}

function FormatBadge({ format }: { format: string }) {
  const meta = FORMAT_META[format] ?? FORMAT_META.generic
  return (
    <span
      style={{
        fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
        background: `${meta.color}12`, color: meta.color,
        border: `1px solid ${meta.color}30`,
        whiteSpace: 'nowrap',
      }}
    >
      {meta.label}
    </span>
  )
}

// ── Upload result row ─────────────────────────────────────────────────────────

interface FileUploadResult {
  filename: string
  status: 'uploading' | 'done' | 'error'
  stats?: UploadStats
  error?: string
}

function UploadResultRow({ result }: { result: FileUploadResult }) {
  if (result.status === 'uploading') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #F3F4F6' }}>
        <div style={{ width: 16, height: 16, border: '2px solid #E5E7EB', borderTopColor: '#4F46E5', borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
        <span style={{ fontSize: 13, color: '#6B7280', fontFamily: 'monospace' }}>{result.filename}</span>
        <span style={{ fontSize: 11, color: '#9CA3AF' }}>Processing…</span>
      </div>
    )
  }
  if (result.status === 'error') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #F3F4F6' }}>
        <span style={{ color: '#DC2626', fontSize: 14 }}>✕</span>
        <span style={{ fontSize: 13, color: '#374151', fontFamily: 'monospace' }}>{result.filename}</span>
        <span style={{ fontSize: 11, color: '#DC2626' }}>{result.error}</span>
      </div>
    )
  }
  const s = result.stats!
  const fmt = s.detected_format ?? 'land_portal'
  const newSaved = s.saved_to_db ?? s.valid_rows
  const dbTotal = s.db_total
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #F3F4F6' }}>
      <span style={{ color: '#059669', fontSize: 14, flexShrink: 0 }}>✓</span>
      <FormatBadge format={fmt} />
      <span style={{ fontSize: 13, color: '#374151', fontFamily: 'monospace', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {result.filename}
      </span>
      <span style={{ fontSize: 12, color: '#059669', fontWeight: 600, whiteSpace: 'nowrap' }}>
        +{newSaved.toLocaleString()} added
      </span>
      {(s.deduped_count ?? 0) > 0 && (
        <span style={{ fontSize: 11, color: '#9CA3AF', whiteSpace: 'nowrap' }}>
          {s.deduped_count} dupes skipped
        </span>
      )}
      {dbTotal != null && (
        <span style={{ fontSize: 11, color: '#4F46E5', fontWeight: 600, whiteSpace: 'nowrap' }}>
          Total: {dbTotal.toLocaleString()} in DB
        </span>
      )}
    </div>
  )
}

// ── Inventory table ────────────────────────────────────────────────────────────

function InventoryTable({
  items,
  total,
  onClearAll,
  onClearState,
  onClearFile,
  onAddMore,
}: {
  items: CompInventoryItem[]
  total: number
  onClearAll: () => void
  onClearState: (state: string) => void
  onClearFile: (filename: string) => void
  onAddMore: () => void
}) {
  const [clearAllConfirm, setClearAllConfirm] = useState(false)

  const allStates = [...new Set(items.flatMap(i => i.states))].sort()

  function fmtDate(iso: string | null): string {
    if (!iso) return '—'
    try {
      return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    } catch {
      return iso.slice(0, 10)
    }
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10, overflow: 'hidden' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', background: '#F9FAFB', borderBottom: '1px solid #E5E7EB',
          flexWrap: 'wrap', gap: 8,
        }}
      >
        <div>
          <span style={{ fontWeight: 600, fontSize: 13, color: '#111827' }}>
            Comp Inventory
          </span>
          <span style={{ marginLeft: 10, fontSize: 12, color: '#6B7280' }}>
            {total.toLocaleString()} total comps · {items.length} file{items.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Add More Comps */}
          <button
            onClick={onAddMore}
            style={{
              padding: '5px 12px', fontSize: 12, fontWeight: 600,
              background: '#4F46E5', color: '#fff',
              border: 'none', borderRadius: 6, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 5,
            }}
          >
            <span style={{ fontSize: 14 }}>+</span> Add More Comps
          </button>
          {/* Clear by state */}
          {allStates.map(st => (
            <button
              key={st}
              onClick={() => onClearState(st)}
              style={{
                padding: '4px 10px', fontSize: 11, fontWeight: 600,
                background: 'transparent', color: '#6B7280',
                border: '1px solid #E5E7EB', borderRadius: 5, cursor: 'pointer',
              }}
            >
              Clear {st}
            </button>
          ))}
          {/* Clear all */}
          {!clearAllConfirm ? (
            <button
              onClick={() => setClearAllConfirm(true)}
              style={{
                padding: '4px 10px', fontSize: 11, fontWeight: 600,
                background: 'transparent', color: '#DC2626',
                border: '1px solid #FCA5A5', borderRadius: 5, cursor: 'pointer',
              }}
            >
              Clear All Comps
            </button>
          ) : (
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: '#DC2626', fontWeight: 600 }}>
                Delete all {total.toLocaleString()} comps?
              </span>
              <button
                onClick={() => { onClearAll(); setClearAllConfirm(false) }}
                style={{
                  padding: '4px 10px', fontSize: 11, fontWeight: 700,
                  background: '#DC2626', color: '#fff',
                  border: 'none', borderRadius: 5, cursor: 'pointer',
                }}
              >
                Yes, Delete All
              </button>
              <button
                onClick={() => setClearAllConfirm(false)}
                style={{ padding: '4px 8px', fontSize: 11, background: 'transparent', color: '#9CA3AF', border: '1px solid #E5E7EB', borderRadius: 5, cursor: 'pointer' }}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Table */}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: '#F9FAFB' }}>
            <Th>File</Th>
            <Th>Format</Th>
            <Th>Records</Th>
            <Th>States</Th>
            <Th>Uploaded</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <tr key={item.filename} style={{ borderTop: '1px solid #F3F4F6', background: i % 2 === 0 ? '#fff' : '#FAFAFA' }}>
              <td style={{ padding: '8px 12px', color: '#374151', fontFamily: 'monospace', fontSize: 11, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {item.filename}
              </td>
              <td style={{ padding: '8px 12px' }}>
                <FormatBadge format={item.source_format} />
              </td>
              <td style={{ padding: '8px 12px', color: '#111827', fontWeight: 600 }}>
                {item.record_count.toLocaleString()}
              </td>
              <td style={{ padding: '8px 12px' }}>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {item.states.map(s => (
                    <span key={s} style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: 'rgba(79,70,229,0.08)', color: '#4F46E5', border: '1px solid rgba(79,70,229,0.15)' }}>
                      {s}
                    </span>
                  ))}
                </div>
              </td>
              <td style={{ padding: '8px 12px', color: '#9CA3AF', whiteSpace: 'nowrap' }}>
                {fmtDate(item.uploaded_at)}
              </td>
              <td style={{ padding: '8px 12px' }}>
                <button
                  onClick={() => onClearFile(item.filename)}
                  style={{ fontSize: 11, color: '#9CA3AF', background: 'transparent', border: '1px solid #E5E7EB', borderRadius: 4, padding: '2px 8px', cursor: 'pointer' }}
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: '2px solid #E5E7EB', background: '#F9FAFB' }}>
            <td style={{ padding: '8px 12px', color: '#374151', fontSize: 12 }} colSpan={2}>
              <span style={{ fontWeight: 600 }}>Total</span>
            </td>
            <td style={{ padding: '8px 12px', fontWeight: 700, fontSize: 13, color: '#4F46E5' }}>
              {total.toLocaleString()}
            </td>
            <td colSpan={3} style={{ padding: '8px 12px', fontSize: 11, color: '#9CA3AF' }}>
              unique comps in database
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function Th({ children }: { children?: React.ReactNode }) {
  return (
    <th style={{ padding: '7px 12px', textAlign: 'left', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#9CA3AF', whiteSpace: 'nowrap' }}>
      {children}
    </th>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function UploadComps() {
  const { compsStats, setCompsStats, setDashboardData, setCurrentPage, listingsStats, setListingsStats } = useApp()
  const [uploadResults, setUploadResults] = useState<FileUploadResult[]>([])
  const [inventory, setInventory] = useState<{ items: CompInventoryItem[]; total_comps: number } | null>(null)
  const [loadingInventory, setLoadingInventory] = useState(false)
  const [showDropZone, setShowDropZone] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const listingsInputRef = useRef<HTMLInputElement>(null)
  const [listingsUploading, setListingsUploading] = useState(false)
  const [listingsError, setListingsError] = useState<string | null>(null)

  async function loadInventory() {
    setLoadingInventory(true)
    try {
      const inv = await getCompsInventory()
      setInventory(inv)
    } catch {
      setInventory(null)
    } finally {
      setLoadingInventory(false)
    }
  }

  useEffect(() => {
    loadInventory()
  }, [])

  const hasInventory = (inventory?.total_comps ?? 0) > 0

  // Show drop zone initially when no comps exist; otherwise hidden until "Add More Comps" clicked
  useEffect(() => {
    if (!loadingInventory && !hasInventory) {
      setShowDropZone(true)
    }
  }, [loadingInventory, hasInventory])

  function handleAddMore() {
    setShowDropZone(true)
    // Small delay so the drop zone renders before we click the input
    setTimeout(() => fileInputRef.current?.click(), 50)
  }

  async function handleFiles(files: FileList | File[]) {
    const fileArr = Array.from(files).filter(f => f.name.toLowerCase().endsWith('.csv'))
    if (!fileArr.length) return

    const initial: FileUploadResult[] = fileArr.map(f => ({
      filename: f.name,
      status: 'uploading',
    }))
    setUploadResults(prev => [...initial, ...prev])

    for (const file of fileArr) {
      try {
        const stats = await uploadComps(file, true) // always append
        setUploadResults(prev =>
          prev.map(r =>
            r.filename === file.name && r.status === 'uploading'
              ? { filename: file.name, status: 'done', stats }
              : r,
          ),
        )
        setCompsStats(stats)
        setDashboardData(null)
      } catch (e: unknown) {
        const msg =
          (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
          'Upload failed'
        setUploadResults(prev =>
          prev.map(r =>
            r.filename === file.name && r.status === 'uploading'
              ? { filename: file.name, status: 'error', error: msg }
              : r,
          ),
        )
      }
    }

    await loadInventory()
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    handleFiles(e.dataTransfer.files)
  }

  async function handleListingsFile(file: File) {
    setListingsUploading(true)
    setListingsError(null)
    try {
      const stats = await uploadListings(file)
      setListingsStats(stats as ListingsStats)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Upload failed'
      setListingsError(msg)
    } finally {
      setListingsUploading(false)
      if (listingsInputRef.current) listingsInputRef.current.value = ''
    }
  }

  async function handleClearAll() {
    await clearAllComps()
    await loadInventory()
    setCompsStats(null)
    setDashboardData(null)
    setUploadResults([])
    setShowDropZone(true)
  }

  async function handleClearState(state: string) {
    await clearCompsByState(state)
    await loadInventory()
  }

  async function handleClearFile(filename: string) {
    await clearCompsByFile(filename)
    await loadInventory()
  }

  return (
    <div className="flex flex-col min-h-screen">
      {/* Page header */}
      <div className="page-header">
        <div>
          <h1 className="text-lg font-semibold" style={{ color: '#111827', fontWeight: 700 }}>
            Upload Sold Comps
          </h1>
          <p className="text-xs mt-0.5" style={{ color: '#9CA3AF' }}>
            Land Portal or MLS format · Upload multiple files · Appends to existing inventory
          </p>
        </div>
        {compsStats && (
          <button className="btn-primary text-sm" onClick={() => setCurrentPage('dashboard')}>
            View Dashboard →
          </button>
        )}
      </div>

      <div style={{ padding: '24px 32px', maxWidth: 900, margin: '0 auto', width: '100%' }}>

        {/* Comp inventory — shown when DB has comps */}
        {hasInventory && inventory && (
          <div style={{ marginBottom: 24 }}>
            <InventoryTable
              items={inventory.items}
              total={inventory.total_comps}
              onClearAll={handleClearAll}
              onClearState={handleClearState}
              onClearFile={handleClearFile}
              onAddMore={handleAddMore}
            />
          </div>
        )}

        {!hasInventory && !loadingInventory && (
          <div
            style={{
              background: 'rgba(79,70,229,0.04)', border: '1px solid rgba(79,70,229,0.12)',
              borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#6B7280',
            }}
          >
            No comps in database yet. Upload one or more CSV files below to get started.
          </div>
        )}

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          multiple
          style={{ display: 'none' }}
          onChange={e => e.target.files && handleFiles(e.target.files)}
        />

        {/* Drop zone — always shown when no inventory, toggled when inventory exists */}
        {showDropZone && (
          <div
            onDrop={handleDrop}
            onDragOver={e => e.preventDefault()}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: '2px dashed #C7D2FE',
              borderRadius: 10,
              padding: '32px 24px',
              textAlign: 'center',
              cursor: 'pointer',
              background: '#F5F3FF',
              marginBottom: 16,
              transition: 'border-color 0.15s',
              position: 'relative',
            }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = '#4F46E5')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = '#C7D2FE')}
          >
            {hasInventory && (
              <button
                onClick={e => { e.stopPropagation(); setShowDropZone(false) }}
                style={{
                  position: 'absolute', top: 8, right: 8,
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  fontSize: 16, color: '#9CA3AF', lineHeight: 1,
                }}
                title="Close"
              >
                ×
              </button>
            )}
            <div style={{ fontSize: 28, marginBottom: 8 }}>📂</div>
            <p style={{ fontWeight: 600, fontSize: 14, color: '#4F46E5', margin: '0 0 4px' }}>
              {hasInventory ? 'Drop CSV files here or click to browse' : 'Drop CSV files here or click to browse'}
            </p>
            <p style={{ fontSize: 12, color: '#6B7280', margin: 0 }}>
              Accepts Land Portal exports, MLS exports, or generic CSV · Multiple files supported · Appends to existing comps · Duplicate APNs automatically skipped
            </p>
          </div>
        )}

        {/* Upload results */}
        {uploadResults.length > 0 && (
          <div
            style={{
              background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8,
              padding: '12px 16px', marginBottom: 16,
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
              Upload Results
            </div>
            {uploadResults.map((r, i) => (
              <UploadResultRow key={`${r.filename}-${i}`} result={r} />
            ))}
          </div>
        )}

        {/* Format guide */}
        <details style={{ marginBottom: 16 }}>
          <summary
            style={{
              fontWeight: 600, fontSize: 13, color: '#374151', cursor: 'pointer',
              padding: '10px 14px', background: '#F9FAFB',
              border: '1px solid #E5E7EB', borderRadius: 8,
              listStyle: 'none', display: 'flex', justifyContent: 'space-between',
            }}
          >
            <span>Supported file formats</span>
            <span style={{ color: '#9CA3AF', fontSize: 11 }}>click to expand</span>
          </summary>
          <div
            style={{
              border: '1px solid #E5E7EB', borderTop: 'none',
              borderRadius: '0 0 8px 8px', padding: '16px',
              background: '#fff',
            }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <FormatGuideCard
                title="Land Portal"
                badge="land_portal"
                columns={['Current Sale Price', 'Current Sale Recording Date', 'Lot Acres', 'APN', 'Parcel State', 'Parcel County', 'Latitude/Longitude']}
                note="Auto-detected. Full feature support including buildability, FEMA, and slope data."
              />
              <FormatGuideCard
                title="MLS Export"
                badge="mls"
                columns={['Close Price / Sold Price', 'Close Date', 'Acres / Approximate Acres', 'APN / Parcel Number', 'State', 'County', 'Address (geocoded)']}
                note="Auto-detected. Coordinates geocoded via Census API. No buildability data — comps used for price-per-acre only."
              />
            </div>

            <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #F3F4F6' }}>
              <p style={{ fontWeight: 600, fontSize: 12, color: '#374151', marginBottom: 8 }}>Land Portal export steps:</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 6 }}>
                {[
                  'Log in → Sold Data tab',
                  'Property Type → "Vacant Land"',
                  'Sale Date → Last 24 months',
                  'Buyer Type → LLC + Corporation',
                  'Set State + County + Acreage range',
                  'Export → Export to CSV (all columns)',
                ].map((s, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <span style={{ width: 18, height: 18, borderRadius: '50%', background: '#4F46E5', color: '#fff', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i + 1}</span>
                    <p style={{ fontSize: 12, color: '#6B7280', margin: 0 }}>{s}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </details>

        {/* Merge strategy note */}
        <div
          style={{
            background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8,
            padding: '10px 14px', fontSize: 12, color: '#6B7280',
          }}
        >
          <strong style={{ color: '#374151' }}>Deduplication: </strong>
          Files are appended to the comp database. Duplicate APNs are automatically detected and skipped before inserting — you can safely re-upload the same file without creating duplicates. Use "Remove" next to each file to delete just those comps, or "Clear All Comps" to start fresh.
        </div>

        {/* Active Listings upload */}
        <div
          style={{
            background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10,
            padding: '16px 20px', marginTop: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div>
              <p style={{ fontWeight: 600, fontSize: 13, color: '#111827', margin: 0 }}>
                Active Listings <span style={{ fontSize: 11, color: '#9CA3AF', fontWeight: 400 }}>optional</span>
              </p>
              <p style={{ fontSize: 11, color: '#9CA3AF', margin: '2px 0 0' }}>
                Upload an active listings CSV to add market velocity analysis (months of supply per ZIP)
              </p>
            </div>
            {listingsStats && (
              <button
                onClick={() => setListingsStats(null)}
                style={{ fontSize: 11, color: '#9CA3AF', background: 'transparent', border: '1px solid #E5E7EB', borderRadius: 4, padding: '2px 8px', cursor: 'pointer' }}
              >
                Remove
              </button>
            )}
          </div>

          {listingsStats ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, padding: '10px 14px', background: 'rgba(16,185,129,0.04)', border: '1px solid rgba(16,185,129,0.15)', borderRadius: 8 }}>
              <div>
                <p style={{ fontSize: 10, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>Active</p>
                <p style={{ fontSize: 15, fontWeight: 700, color: '#111827', margin: '2px 0 0' }}>{listingsStats.total_active.toLocaleString()}</p>
              </div>
              <div>
                <p style={{ fontSize: 10, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>Pending</p>
                <p style={{ fontSize: 15, fontWeight: 700, color: '#111827', margin: '2px 0 0' }}>{listingsStats.total_pending.toLocaleString()}</p>
              </div>
              <div>
                <p style={{ fontSize: 10, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>ZIPs</p>
                <p style={{ fontSize: 15, fontWeight: 700, color: '#111827', margin: '2px 0 0' }}>{listingsStats.zip_count}</p>
              </div>
              {listingsStats.counties_covered.length > 0 && (
                <div>
                  <p style={{ fontSize: 10, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>Counties</p>
                  <p style={{ fontSize: 12, color: '#374151', margin: '2px 0 0' }}>{listingsStats.counties_covered.slice(0, 4).join(', ')}{listingsStats.counties_covered.length > 4 ? ` +${listingsStats.counties_covered.length - 4}` : ''}</p>
                </div>
              )}
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: '#10B981', fontWeight: 600 }}>✓ Velocity data loaded — visible in Market Analysis</span>
              </div>
            </div>
          ) : (
            <div>
              <input
                ref={listingsInputRef}
                type="file"
                accept=".csv"
                style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) handleListingsFile(f) }}
              />
              <button
                onClick={() => listingsInputRef.current?.click()}
                disabled={listingsUploading}
                style={{
                  width: '100%', padding: '12px 0', border: '2px dashed #E5E7EB', borderRadius: 8,
                  background: '#FAFAFA', color: '#9CA3AF', cursor: listingsUploading ? 'default' : 'pointer',
                  fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
              >
                {listingsUploading ? (
                  <>
                    <span style={{ width: 14, height: 14, border: '2px solid #E5E7EB', borderTopColor: '#4F46E5', borderRadius: '50%', animation: 'spin 0.8s linear infinite', display: 'inline-block' }} />
                    Processing…
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                    Upload Active Listings CSV
                  </>
                )}
              </button>
              {listingsError && (
                <p style={{ fontSize: 12, color: '#DC2626', marginTop: 6 }}>{listingsError}</p>
              )}
              <p style={{ fontSize: 11, color: '#9CA3AF', marginTop: 6 }}>
                Expected columns: ZIP, Status (Active/Pending), List Price, DOM. Computes months-of-supply per ZIP vs. your sold comps.
              </p>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg) } }
      `}</style>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function FormatGuideCard({
  title,
  badge,
  columns,
  note,
}: {
  title: string
  badge: string
  columns: string[]
  note: string
}) {
  return (
    <div style={{ background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 8, padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 13, color: '#111827' }}>{title}</span>
        <FormatBadge format={badge} />
      </div>
      <div style={{ marginBottom: 8 }}>
        {columns.map(c => (
          <div key={c} style={{ fontSize: 11, color: '#6B7280', padding: '1px 0' }}>
            • {c}
          </div>
        ))}
      </div>
      <p style={{ fontSize: 11, color: '#9CA3AF', margin: 0, fontStyle: 'italic' }}>{note}</p>
    </div>
  )
}
