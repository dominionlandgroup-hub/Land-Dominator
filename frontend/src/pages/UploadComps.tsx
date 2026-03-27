import React, { useState } from 'react'
import FileUpload from '../components/FileUpload'
import DataTable from '../components/DataTable'
import { useApp } from '../context/AppContext'
import { uploadComps } from '../api/client'
import type { Column } from '../components/DataTable'

export default function UploadComps() {
  const { compsStats, setCompsStats, setDashboardData, setCurrentPage } = useApp()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)

  async function handleFile(file: File) {
    setFileName(file.name)
    setLoading(true)
    setError(null)
    try {
      const stats = await uploadComps(file)
      setCompsStats(stats)
      setDashboardData(null)
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail ?? 'Upload failed. Please check your CSV and try again.'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  const previewCols: Column<Record<string, unknown>>[] = (
    compsStats?.columns_found.slice(0, 12) ?? []
  ).map((col) => ({
    key: col,
    header: col,
    render: (val) =>
      val == null ? (
        <span style={{ color: '#9B8AAE' }}>—</span>
      ) : (
        <span className="max-w-[180px] block truncate text-xs" title={String(val)}>
          {String(val)}
        </span>
      ),
  }))

  return (
    <div className="flex flex-col min-h-screen">
      {/* Page header */}
      <div className="page-header">
        <div>
          <h1 className="text-lg font-semibold" style={{ color: '#1A0A2E', fontWeight: 700 }}>Upload Sold Comps</h1>
          <p className="text-xs mt-0.5" style={{ color: '#6B5B8A' }}>Step 1 of 5 — Import your Land Portal sold comps export</p>
        </div>
        {compsStats && (
          <button className="btn-primary text-sm" onClick={() => setCurrentPage('dashboard')}>
            View Dashboard →
          </button>
        )}
      </div>

      <div className="p-8 max-w-4xl mx-auto w-full">
        {/* Upload zone */}
        <div className="card mb-6">
          <FileUpload
            label="Drop your Sold Comps CSV here"
            hint="Land Portal export — up to 226 columns supported"
            onFile={handleFile}
            loading={loading}
            selectedFile={compsStats ? fileName : null}
          />
        </div>

        {error && (
          <div className="rounded-xl px-5 py-4 mb-6 text-sm" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.3)', color: '#dc2626' }}>
            <strong className="font-semibold">Error:</strong> {error}
          </div>
        )}

        {compsStats && (
          <>
            {/* Success banner */}
            <div className="rounded-xl px-5 py-4 mb-6 flex items-start gap-4" style={{ background: 'rgba(45,122,79,0.06)', border: '1px solid rgba(45,122,79,0.2)', borderLeft: '4px solid #2D7A4F' }}>
              <div className="w-8 h-8 rounded-full flex items-center justify-center flex-none" style={{ background: 'rgba(45,122,79,0.1)' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2D7A4F" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </div>
              <div>
                <p className="font-semibold text-sm" style={{ color: '#2D7A4F' }}>File uploaded successfully</p>
                <p className="text-sm mt-0.5" style={{ color: '#1A4A2E' }}>
                  <strong>{compsStats.total_rows.toLocaleString()}</strong> total rows —{' '}
                  <strong>{compsStats.valid_rows.toLocaleString()}</strong> have a valid sale price and will be used for analysis.
                </p>
              </div>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              <StatCard label="Total Rows" value={compsStats.total_rows.toLocaleString()} accent="#5C2977" />
              <StatCard label="Valid Sale Prices" value={compsStats.valid_rows.toLocaleString()} accent="#2D7A4F" />
              <StatCard label="Columns Detected" value={compsStats.columns_found.length.toString()} accent="#8B4DB8" />
            </div>

            {/* Missing columns warning/info */}
            {compsStats.missing_columns.length > 0 && compsStats.format_detected !== 'MLS' && (
              <div className="rounded-xl px-5 py-4 mb-6" style={{ background: 'rgba(213,169,64,0.06)', border: '1px solid rgba(213,169,64,0.2)' }}>
                <p className="font-semibold text-sm mb-2" style={{ color: '#8B6A00' }}>
                  ⚠ Missing expected columns ({compsStats.missing_columns.length})
                </p>
                <div className="flex flex-wrap gap-2">
                  {compsStats.missing_columns.map((col) => (
                    <code
                      key={col}
                      className="text-xs px-2 py-0.5 rounded"
                      style={{ background: 'rgba(213,169,64,0.1)', color: '#8B6A00' }}
                    >
                      {col}
                    </code>
                  ))}
                </div>
              </div>
            )}

            {compsStats.format_detected === 'MLS' && compsStats.message && (
              <div className="rounded-xl px-5 py-4 mb-6" style={{ background: 'rgba(45,122,79,0.06)', border: '1px solid rgba(45,122,79,0.2)' }}>
                <p className="font-semibold text-sm mb-2" style={{ color: '#2D7A4F' }}>
                  ✅ ℹ️ MLS format detected
                </p>
                <p className="text-sm mb-2" style={{ color: '#1A4A2E' }}>
                  {compsStats.message}
                </p>
                {!!compsStats.mapped_columns?.length && (
                  <div className="flex flex-wrap gap-2">
                    {compsStats.mapped_columns.map((mapping) => (
                      <code
                        key={mapping}
                        className="text-xs px-2 py-0.5 rounded"
                        style={{ background: 'rgba(45,122,79,0.1)', color: '#2D7A4F' }}
                      >
                        {mapping}
                      </code>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Data preview */}
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold" style={{ color: '#1A0A2E' }}>
                  Data Preview
                </h2>
                <span className="text-xs" style={{ color: '#6B5B8A' }}>First 20 rows · 12 columns shown</span>
              </div>
              <DataTable<Record<string, unknown>>
                columns={previewCols}
                data={compsStats.preview as Record<string, unknown>[]}
                pageSize={20}
                emptyMessage="No preview data available"
              />
            </div>

            <div className="mt-6 flex justify-end">
              <button className="btn-primary" onClick={() => setCurrentPage('dashboard')}>
                View ZIP Dashboard →
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-xl p-5" style={{ background: '#FFFFFF', border: '1px solid #E8E0F0', borderRadius: 12, boxShadow: '0 2px 8px rgba(92,41,119,0.06)' }}>
      <p className="text-xs uppercase tracking-wider mb-2" style={{ color: '#6B5B8A', letterSpacing: '0.8px' }}>{label}</p>
      <p className="text-2xl font-bold" style={{ color: accent }}>{value}</p>
    </div>
  )
}
