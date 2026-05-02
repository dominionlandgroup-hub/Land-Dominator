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
        <span style={{ color: '#6B7280' }}>—</span>
      ) : (
        <span className="max-w-[180px] block truncate text-xs" title={String(val)} style={{ color: '#374151' }}>
          {String(val)}
        </span>
      ),
  }))

  return (
    <div className="flex flex-col min-h-screen">
      {/* Page header */}
      <div className="page-header">
        <div>
          <h1 className="text-lg font-semibold" style={{ color: '#111827', fontWeight: 700 }}>Upload Sold Comps</h1>
          <p className="text-xs mt-0.5" style={{ color: '#9CA3AF' }}>Step 1 of 5 — Import your Land Portal sold comps export</p>
        </div>
        {compsStats && (
          <button className="btn-primary text-sm" onClick={() => setCurrentPage('dashboard')}>
            View Dashboard →
          </button>
        )}
      </div>

      <div className="p-8 max-w-4xl mx-auto w-full">

        {/* Land Portal Export Instructions */}
        <div className="card mb-6">
          <h2 className="font-semibold mb-1" style={{ color: '#111827' }}>How to Export Sold Comps from Land Portal</h2>
          <p className="text-xs mb-4" style={{ color: '#9CA3AF' }}>Follow these steps exactly — LLC/Corporate buyer sales give the most accurate pricing data</p>

          <div className="space-y-2 mb-5">
            {[
              { n: 1, text: 'Log in to Land Portal and click "Sold Data" in the top navigation' },
              { n: 2, text: 'Set Property Type → "Vacant Land"' },
              { n: 3, text: 'Set Sale Date → Last 24 months (not 5 years — recent LLC sales reflect true market value)' },
              { n: 4, text: 'Set Buyer Type → "LLC" and "Corporation" (uncheck Individual/Trust — LLC buyers are investors who pay retail)' },
              { n: 5, text: 'Set your target State and County from your Buy Box' },
              { n: 6, text: 'Set Acreage range matching your target lot sizes (e.g., 1–100 acres)' },
              { n: 7, text: 'Click "Search" and wait for results to load' },
              { n: 8, text: 'Click "Export" → "Export to CSV" (all columns)' },
              { n: 9, text: 'Upload the downloaded CSV file below' },
            ].map(step => (
              <div key={step.n} className="flex items-start gap-3">
                <span
                  className="w-5 h-5 rounded-full flex items-center justify-center flex-none text-[10px] font-bold mt-0.5"
                  style={{ background: '#4F46E5', color: '#FFFFFF' }}
                >{step.n}</span>
                <p className="text-sm" style={{ color: '#374151' }}>{step.text}</p>
              </div>
            ))}
          </div>

          <div className="rounded-lg px-4 py-3" style={{ background: 'rgba(79,70,229,0.04)', border: '1px solid rgba(79,70,229,0.12)' }}>
            <p className="text-xs font-semibold mb-1" style={{ color: '#4F46E5' }}>Why LLC/Corporate buyers only?</p>
            <p className="text-xs" style={{ color: '#9CA3AF' }}>
              Individual buyers often overpay or underpay due to emotion. LLC and corporate buyers are professional investors
              who consistently pay fair market retail prices — making them the most reliable benchmark for setting your acquisition offers.
            </p>
          </div>
        </div>

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
          <div className="rounded-xl px-5 py-4 mb-6 text-sm" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#EF4444' }}>
            <strong className="font-semibold">Error:</strong> {error}
          </div>
        )}

        {compsStats && (
          <>
            {/* Success banner */}
            <div className="rounded-xl px-5 py-4 mb-6 flex items-start gap-4" style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', borderLeft: '4px solid #10B981' }}>
              <div className="w-8 h-8 rounded-full flex items-center justify-center flex-none" style={{ background: 'rgba(16,185,129,0.12)' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </div>
              <div>
                <p className="font-semibold text-sm" style={{ color: '#10B981' }}>File uploaded successfully</p>
                <p className="text-sm mt-0.5" style={{ color: '#374151' }}>
                  <strong>{compsStats.total_rows.toLocaleString()}</strong> total rows —{' '}
                  <strong>{compsStats.valid_rows.toLocaleString()}</strong> have a valid sale price and will be used for analysis.
                </p>
                {compsStats.saved_to_db != null && (
                  <p className="text-xs mt-1" style={{ color: '#10B981' }}>
                    Saving <strong>{compsStats.saved_to_db.toLocaleString()}</strong> comps to database for persistent matching across sessions.
                  </p>
                )}
              </div>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              <StatCard label="Total Rows" value={compsStats.total_rows.toLocaleString()} accent="#5C2977" />
              <StatCard label="Valid Sale Prices" value={compsStats.valid_rows.toLocaleString()} accent="#059669" />
              <StatCard label="Columns Detected" value={compsStats.columns_found.length.toString()} accent="#6B5B8A" />
            </div>

            {/* Missing columns warning */}
            {compsStats.missing_columns.length > 0 && (
              <div className="rounded-xl px-5 py-4 mb-6" style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)' }}>
                <p className="font-semibold text-sm mb-2" style={{ color: '#F59E0B' }}>
                  ⚠ Missing expected columns ({compsStats.missing_columns.length})
                </p>
                <div className="flex flex-wrap gap-2">
                  {compsStats.missing_columns.map((col) => (
                    <code
                      key={col}
                      className="text-xs px-2 py-0.5 rounded"
                      style={{ background: 'rgba(245,158,11,0.1)', color: '#F59E0B' }}
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
                <h2 className="font-semibold" style={{ color: '#111827' }}>
                  Data Preview
                </h2>
                <span className="text-xs" style={{ color: '#9CA3AF' }}>First 20 rows · 12 columns shown</span>
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
  const mappedAccent = accent === '#5C2977' ? '#4F46E5' : accent === '#6B5B8A' ? '#9CA3AF' : accent
  return (
    <div className="rounded-xl p-5" style={{ background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 8 }}>
      <p className="text-xs uppercase tracking-wider mb-2" style={{ color: '#6B7280', letterSpacing: '0.8px' }}>{label}</p>
      <p className="text-2xl font-bold" style={{ color: mappedAccent }}>{value}</p>
    </div>
  )
}
