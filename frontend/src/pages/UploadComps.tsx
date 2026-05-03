import React, { useEffect, useRef, useState } from 'react'
import { useApp } from '../context/AppContext'
import {
  uploadComps,
  getCompsInventory,
  clearAllComps,
  clearCompsByState,
  clearCompsByFile,
  type CompInventoryItem,
} from '../api/client'
import type { UploadStats } from '../types'

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
  const soldSaved = s.saved_to_db ?? s.valid_rows
  const activeSaved = s.active_saved ?? 0
  const skipped = (s.deduped_count ?? 0)
  const dbTotal = s.db_total
  return (
    <div style={{ padding: '10px 0', borderBottom: '1px solid #F3F4F6' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: activeSaved > 0 ? 6 : 0 }}>
        <span style={{ color: '#059669', fontSize: 14, flexShrink: 0 }}>✓</span>
        <FormatBadge format={fmt} />
        <span style={{ fontSize: 13, color: '#374151', fontFamily: 'monospace', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {result.filename}
        </span>
        {dbTotal != null && (
          <span style={{ fontSize: 11, color: '#4F46E5', fontWeight: 600, whiteSpace: 'nowrap' }}>
            Total: {dbTotal.toLocaleString()} in DB
          </span>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, paddingLeft: 24 }}>
        <span style={{ fontSize: 12, color: '#059669', fontWeight: 600 }}>
          ✓ {soldSaved.toLocaleString()} sold comps saved (used for pricing)
        </span>
        {activeSaved > 0 && (
          <span style={{ fontSize: 12, color: '#0891B2', fontWeight: 600 }}>
            ✓ {activeSaved.toLocaleString()} active listings saved (used for market velocity)
          </span>
        )}
        {skipped > 0 && (
          <span style={{ fontSize: 11, color: '#9CA3AF' }}>
            {skipped} dupes skipped
          </span>
        )}
      </div>
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
  const { compsStats, setCompsStats, setDashboardData, setCurrentPage, setListingsStats } = useApp()
  const [uploadResults, setUploadResults] = useState<FileUploadResult[]>([])
  const [inventory, setInventory] = useState<{ items: CompInventoryItem[]; total_comps: number } | null>(null)
  const [loadingInventory, setLoadingInventory] = useState(false)
  const [showDropZone, setShowDropZone] = useState(false)
  // replaceMode=true (default): clear all existing comps, then insert fresh
  // replaceMode=false: append without deleting (add more comps)
  const [replaceMode, setReplaceMode] = useState(true)
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  useEffect(() => {
    if (!loadingInventory && !hasInventory) {
      setShowDropZone(true)
    }
  }, [loadingInventory, hasInventory])

  function handleAddMore() {
    setShowDropZone(true)
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
        const stats = await uploadComps(file, !replaceMode)
        setUploadResults(prev =>
          prev.map(r =>
            r.filename === file.name && r.status === 'uploading'
              ? { filename: file.name, status: 'done', stats }
              : r,
          ),
        )
        setCompsStats(stats)
        setDashboardData(null)
        // Populate market velocity if active listings were detected in this file
        if (stats.listings) {
          setListingsStats(stats.listings)
        }
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
            Upload Sold Comps &amp; Active Listings
          </h1>
          <p className="text-xs mt-0.5" style={{ color: '#9CA3AF' }}>
            Export from Land Portal including both Sold and Active listings in the same file — the system separates them automatically
          </p>
        </div>
        {compsStats && (
          <button className="btn-primary text-sm" onClick={() => setCurrentPage('dashboard')}>
            View Dashboard →
          </button>
        )}
      </div>

      <div style={{ padding: '24px 32px', maxWidth: 900, margin: '0 auto', width: '100%' }}>

        {/* Auto-split info banner */}
        <div style={{
          background: 'rgba(79,70,229,0.04)', border: '1px solid rgba(79,70,229,0.12)',
          borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#374151',
        }}>
          <strong style={{ color: '#4F46E5' }}>Auto-detection: </strong>
          The system reads the <em>Current Sale Status</em> column and automatically separates your file:
          <span style={{ color: '#059669', fontWeight: 600 }}> Sold records</span> → comp pricing ·
          <span style={{ color: '#0891B2', fontWeight: 600 }}> Active records</span> → market velocity analysis
        </div>

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

        {/* Replace vs Add toggle */}
        {showDropZone && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 12, color: '#6B7280', fontWeight: 500 }}>Upload mode:</span>
            <button
              onClick={() => setReplaceMode(true)}
              style={{
                padding: '5px 14px', fontSize: 12, fontWeight: 700, borderRadius: 6, cursor: 'pointer',
                background: replaceMode ? '#DC2626' : '#F9FAFB',
                color: replaceMode ? '#fff' : '#6B7280',
                border: replaceMode ? 'none' : '1px solid #E5E7EB',
              }}
            >
              Replace All
            </button>
            <button
              onClick={() => setReplaceMode(false)}
              style={{
                padding: '5px 14px', fontSize: 12, fontWeight: 700, borderRadius: 6, cursor: 'pointer',
                background: !replaceMode ? '#4F46E5' : '#F9FAFB',
                color: !replaceMode ? '#fff' : '#6B7280',
                border: !replaceMode ? 'none' : '1px solid #E5E7EB',
              }}
            >
              Add More
            </button>
            <span style={{ fontSize: 11, color: replaceMode ? '#DC2626' : '#059669', fontWeight: 600 }}>
              {replaceMode
                ? 'Deletes existing comps then uploads fresh — prevents duplicates'
                : 'Appends to existing comps — duplicate APNs skipped automatically'}
            </span>
          </div>
        )}

        {/* Drop zone */}
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
              Drop CSV files here or click to browse
            </p>
            <p style={{ fontSize: 12, color: '#6B7280', margin: 0 }}>
              Accepts Land Portal exports (Sold + Active in one file), MLS exports, or generic CSV · Multiple files · Appends to existing comps · Duplicate APNs skipped
            </p>
            <p style={{ fontSize: 11, color: '#4F46E5', margin: '6px 0 0', fontWeight: 500 }}>
              💡 Set acreage 0.1 (4,356 sq ft) to 10 acres (435,600 sq ft) and include both Sold and Active to capture all segments + market velocity
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
            <span>Land Portal export instructions &amp; supported formats</span>
            <span style={{ color: '#9CA3AF', fontSize: 11 }}>click to expand</span>
          </summary>
          <div
            style={{
              border: '1px solid #E5E7EB', borderTop: 'none',
              borderRadius: '0 0 8px 8px', padding: '16px',
              background: '#fff',
            }}
          >
            {/* Land Portal step-by-step */}
            <p style={{ fontWeight: 600, fontSize: 12, color: '#374151', marginBottom: 10 }}>Land Portal export steps:</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 7, marginBottom: 16 }}>
              {[
                'Go to landportal.com and click Solds in the top menu',
                'Set State: [your target state]',
                'Set County: [your target county]',
                'Set Property Type: Vacant Land General, Residential Vacant Land',
                'Set Acreage: 0.1 acres (4,356 sq ft) minimum to 10 acres (435,600 sq ft) maximum',
                'Set Date Range: Last 24 months',
                'Set Status: Include BOTH Sold AND Active listings',
                'Set Buyer Type: All buyers (LLC, Individual, Trust)',
                'Exclude unknown sale dates for sold records: Yes',
                'Click Export CSV and upload below',
              ].map((s, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <span style={{ width: 18, height: 18, borderRadius: '50%', background: '#4F46E5', color: '#fff', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i + 1}</span>
                  <p style={{ fontSize: 12, color: '#6B7280', margin: 0 }}>{s}</p>
                </div>
              ))}
            </div>

            <div style={{ background: 'rgba(8,145,178,0.06)', border: '1px solid rgba(8,145,178,0.2)', borderRadius: 6, padding: '8px 12px', marginBottom: 16, fontSize: 12, color: '#374151' }}>
              <strong style={{ color: '#0891B2' }}>Note:</strong> Including active listings in the same export lets the system automatically calculate market velocity and flag oversupplied areas.
            </div>

            {/* Acreage band guide */}
            <p style={{ fontWeight: 600, fontSize: 12, color: '#374151', marginBottom: 8 }}>Buy Box Lot Size — all acreage segments:</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 6, marginBottom: 12 }}>
              {[
                { band: 'Micro',  range: '0–0.5 ac',   sqft: '0–21,780 sq ft' },
                { band: 'Small',  range: '0.5–2 ac',   sqft: '21,780–87,120 sq ft' },
                { band: 'Medium', range: '2–5 ac',     sqft: '87,120–217,800 sq ft' },
                { band: 'Large',  range: '5–10 ac',    sqft: '217,800–435,600 sq ft' },
              ].map(b => (
                <div key={b.band} style={{ background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 6, padding: '8px 10px' }}>
                  <p style={{ fontWeight: 700, fontSize: 12, color: '#374151', margin: '0 0 2px' }}>{b.band}</p>
                  <p style={{ fontSize: 11, color: '#6B7280', margin: '0 0 1px' }}>{b.range}</p>
                  <p style={{ fontSize: 10, color: '#9CA3AF', margin: 0 }}>{b.sqft}</p>
                </div>
              ))}
            </div>
            <p style={{ fontSize: 11, color: '#4F46E5', fontWeight: 600, margin: '0 0 16px' }}>
              Recommended pull: 0.1 to 10 acres to capture all segments
            </p>

            {/* Format cards */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <FormatGuideCard
                title="Land Portal"
                badge="land_portal"
                columns={['Current Sale Status (Sold / Active)', 'Current Sale Price', 'Current Sale Recording Date', 'Lot Acres', 'APN', 'Parcel State', 'Parcel County', 'Latitude/Longitude']}
                note="Auto-detected. Sold rows go to comp pricing; Active rows go to market velocity."
              />
              <FormatGuideCard
                title="MLS Export"
                badge="mls"
                columns={['Close Price / Sold Price', 'Close Date', 'Acres / Approximate Acres', 'APN / Parcel Number', 'State', 'County', 'Address (geocoded)']}
                note="Auto-detected. Coordinates geocoded via Census API. No buildability data."
              />
            </div>
          </div>
        </details>

        {/* Dedup note */}
        <div
          style={{
            background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8,
            padding: '10px 14px', fontSize: 12, color: '#6B7280',
          }}
        >
          <strong style={{ color: '#374151' }}>Deduplication: </strong>
          Files are appended to the comp database. Duplicate APNs are automatically detected and skipped — you can safely re-upload the same file without creating duplicates. Use "Remove" next to each file to delete just those comps, or "Clear All Comps" to start fresh.
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
