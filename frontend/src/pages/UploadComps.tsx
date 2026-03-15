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
        <span className="text-gray-600">—</span>
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
          <h1 className="text-lg font-semibold" style={{ color: '#f9fafb' }}>Upload Sold Comps</h1>
          <p className="text-xs mt-0.5" style={{ color: '#8A8070' }}>Step 1 of 5 — Import your Land Portal sold comps export</p>
        </div>
        {compsStats && (
          <button className="btn-primary text-sm" onClick={() => setCurrentPage('dashboard')}>
            View Dashboard →
          </button>
        )}
      </div>

      <div className="p-8 max-w-4xl">
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
          <div className="rounded-xl px-5 py-4 mb-6 text-sm" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' }}>
            <strong className="font-semibold">Error:</strong> {error}
          </div>
        )}

        {compsStats && (
          <>
            {/* Success banner */}
            <div className="rounded-xl px-5 py-4 mb-6 flex items-start gap-4" style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)' }}>
              <div className="w-8 h-8 rounded-full flex items-center justify-center flex-none" style={{ background: 'rgba(16,185,129,0.15)' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </div>
              <div>
                <p className="font-semibold text-sm" style={{ color: '#34d399' }}>File uploaded successfully</p>
                <p className="text-sm mt-0.5" style={{ color: 'rgba(52,211,153,0.75)' }}>
                  <strong>{compsStats.total_rows.toLocaleString()}</strong> total rows —{' '}
                  <strong>{compsStats.valid_rows.toLocaleString()}</strong> have a valid sale price and will be used for analysis.
                </p>
              </div>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              <StatCard label="Total Rows" value={compsStats.total_rows.toLocaleString()} accent="#C9A84C" />
              <StatCard label="Valid Sale Prices" value={compsStats.valid_rows.toLocaleString()} accent="#10b981" />
              <StatCard label="Columns Detected" value={compsStats.columns_found.length.toString()} accent="#8b5cf6" />
            </div>

            {/* Missing columns warning */}
            {compsStats.missing_columns.length > 0 && (
              <div className="rounded-xl px-5 py-4 mb-6" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)' }}>
                <p className="font-semibold text-sm mb-2" style={{ color: '#fbbf24' }}>
                  ⚠ Missing expected columns ({compsStats.missing_columns.length})
                </p>
                <div className="flex flex-wrap gap-2">
                  {compsStats.missing_columns.map((col) => (
                    <code
                      key={col}
                      className="text-xs px-2 py-0.5 rounded"
                      style={{ background: 'rgba(245,158,11,0.15)', color: '#fbbf24' }}
                    >
                      {col}
                    </code>
                  ))}
                </div>
              </div>
            )}

            {/* Data preview */}
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold" style={{ color: '#F5F0E8' }}>
                  Data Preview
                </h2>
                <span className="text-xs" style={{ color: '#8A8070' }}>First 20 rows · 12 columns shown</span>
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
    <div className="rounded-xl p-5" style={{ background: 'linear-gradient(135deg, #1A1610 0%, #161616 100%)', border: '1px solid rgba(201,168,76,0.12)' }}>
      <p className="text-xs uppercase tracking-wider mb-2" style={{ color: '#8A8070' }}>{label}</p>
      <p className="text-2xl font-bold" style={{ color: accent }}>{value}</p>
    </div>
  )
}
