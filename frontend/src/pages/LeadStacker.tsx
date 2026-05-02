import React, { useEffect, useRef, useState } from 'react'
import {
  uploadSourceCSV,
  uploadMLSCSV,
  getLeadStackerStats,
  getLeads,
  exportLeadsUrl,
  clearAllLeads,
  clearSource,
  type SourceKey,
  type HillsboroughLead,
  type LeadStackerStats,
  type UploadResult,
} from '../api/leadStacker'

// ── Constants ───────────────────────────────────────────────────────────────

const SOURCE_META: {
  key: SourceKey
  label: string
  description: string
  icon: string
}[] = [
  {
    key: 'tax-deed',
    label: 'Tax Deed',
    description: 'Weekly Tax Deed Spreadsheet — hillsclerk.com',
    icon: '⚖️',
  },
  {
    key: 'lands-available',
    label: 'Lands Available',
    description: 'Lands Available for Taxes — hillsclerk.com Public Access',
    icon: '🏚️',
  },
  {
    key: 'lis-pendens',
    label: 'Lis Pendens',
    description: 'Monthly Lis Pendens CSV — hillsclerk.com',
    icon: '📋',
  },
  {
    key: 'foreclosure',
    label: 'Foreclosure',
    description: 'Mortgage Foreclosure — hillsborough.realforeclose.com',
    icon: '🔨',
  },
  {
    key: 'probate',
    label: 'Probate',
    description: 'Probate Cases — hillsclerk.com Case Search',
    icon: '📜',
  },
  {
    key: 'code-violation',
    label: 'Code Violations',
    description: 'Code Violation Records — Hillsborough County',
    icon: '⚠️',
  },
]

const SCORE_COLORS: Record<number, string> = {
  1: '#4B5563',
  2: '#6B7280',
  3: '#D97706',
  4: '#F59E0B',
  5: '#EF4444',
  6: '#DC2626',
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function ScoreBadge({ score }: { score: number }) {
  const color = SCORE_COLORS[score] ?? '#4B5563'
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 28,
        height: 28,
        borderRadius: '50%',
        background: color,
        color: '#fff',
        fontSize: 12,
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {score}
    </span>
  )
}

function SourceIcon({ lead }: { lead: HillsboroughLead }) {
  const flags = [
    { key: 'has_tax_deed',        label: 'TD', title: 'Tax Deed' },
    { key: 'has_lands_available', label: 'LA', title: 'Lands Available' },
    { key: 'has_lis_pendens',     label: 'LP', title: 'Lis Pendens' },
    { key: 'has_foreclosure',     label: 'FC', title: 'Foreclosure' },
    { key: 'has_probate',         label: 'PB', title: 'Probate' },
    { key: 'has_code_violation',  label: 'CV', title: 'Code Violation' },
  ] as const
  return (
    <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
      {flags.map(f => {
        const active = (lead as unknown as Record<string, boolean>)[f.key]
        return (
          <span
            key={f.key}
            title={f.title}
            style={{
              fontSize: 9,
              fontWeight: 700,
              padding: '1px 4px',
              borderRadius: 3,
              background: active ? '#D5A940' : '#1F2937',
              color: active ? '#111827' : '#4B5563',
              border: active ? '1px solid #D5A940' : '1px solid #2D3748',
            }}
          >
            {f.label}
          </span>
        )
      })}
      {lead.on_mls && (
        <span
          title="On MLS"
          style={{
            fontSize: 9, fontWeight: 700, padding: '1px 4px', borderRadius: 3,
            background: '#3B82F6', color: '#fff', border: '1px solid #3B82F6',
          }}
        >MLS</span>
      )}
    </div>
  )
}

// ── Upload Card ──────────────────────────────────────────────────────────────

function SourceCard({
  meta,
  count,
  onUpload,
  onClear,
}: {
  meta: typeof SOURCE_META[number]
  count: number
  onUpload: (file: File) => Promise<void>
  onClear: () => Promise<void>
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<UploadResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      await onUpload(file)
      setResult({ source: meta.key, label: meta.label, total_in_csv: 0, inserted: 0, updated: 0, skipped: 0 })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setLoading(false)
      if (ref.current) ref.current.value = ''
    }
  }

  const hasData = count > 0

  return (
    <div
      style={{
        background: '#1F2937',
        border: `1px solid ${hasData ? '#D5A940' : '#2D3748'}`,
        borderRadius: 8,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <span style={{ fontSize: 20, lineHeight: 1 }}>{meta.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, color: '#F9FAFB', fontSize: 13 }}>{meta.label}</div>
          <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2, lineHeight: 1.4 }}>
            {meta.description}
          </div>
        </div>
        {hasData && (
          <span
            style={{
              background: 'rgba(213,169,64,0.1)',
              border: '1px solid rgba(213,169,64,0.3)',
              color: '#D5A940',
              borderRadius: 4,
              padding: '2px 8px',
              fontSize: 11,
              fontWeight: 700,
              whiteSpace: 'nowrap',
            }}
          >
            {count.toLocaleString()} leads
          </span>
        )}
      </div>

      {error && (
        <div style={{ fontSize: 11, color: '#F87171', background: 'rgba(239,68,68,0.1)', borderRadius: 4, padding: '4px 8px' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <input ref={ref} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleFile} />
        <button
          onClick={() => ref.current?.click()}
          disabled={loading}
          style={{
            flex: 1,
            padding: '7px 12px',
            background: loading ? '#2D3748' : '#D5A940',
            color: loading ? '#6B7280' : '#111827',
            border: 'none',
            borderRadius: 6,
            fontWeight: 600,
            fontSize: 12,
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'Uploading…' : hasData ? 'Re-Upload CSV' : 'Upload CSV'}
        </button>
        {hasData && (
          <button
            onClick={onClear}
            style={{
              padding: '7px 10px',
              background: 'transparent',
              color: '#6B7280',
              border: '1px solid #374151',
              borderRadius: 6,
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Clear
          </button>
        )}
      </div>
    </div>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function LeadStacker() {
  const [stats, setStats] = useState<LeadStackerStats | null>(null)
  const [leads, setLeads] = useState<HillsboroughLead[]>([])
  const [minScore, setMinScore] = useState(1)
  const [loadingStats, setLoadingStats] = useState(true)
  const [loadingLeads, setLoadingLeads] = useState(false)
  const [mlsFile, setMlsFile] = useState<File | null>(null)
  const [mlsLoading, setMlsLoading] = useState(false)
  const [mlsResult, setMlsResult] = useState<{ total_in_csv: number; matched_leads: number } | null>(null)
  const [clearConfirm, setClearConfirm] = useState(false)
  const [uploadResults, setUploadResults] = useState<Record<string, UploadResult>>({})
  const mlsRef = useRef<HTMLInputElement>(null)

  async function loadStats() {
    try {
      const s = await getLeadStackerStats()
      setStats(s)
    } catch {
      // Table may not exist yet
    } finally {
      setLoadingStats(false)
    }
  }

  async function loadLeads() {
    setLoadingLeads(true)
    try {
      const res = await getLeads({ minScore, limit: 500 })
      setLeads(res.leads)
    } catch {
      setLeads([])
    } finally {
      setLoadingLeads(false)
    }
  }

  useEffect(() => {
    loadStats()
  }, [])

  useEffect(() => {
    loadLeads()
  }, [minScore]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSourceUpload(source: SourceKey, file: File) {
    const result = await uploadSourceCSV(source, file)
    setUploadResults(prev => ({ ...prev, [source]: result }))
    await loadStats()
    await loadLeads()
  }

  async function handleSourceClear(source: SourceKey) {
    await clearSource(source)
    await loadStats()
    await loadLeads()
  }

  async function handleMLSUpload() {
    if (!mlsFile) return
    setMlsLoading(true)
    setMlsResult(null)
    try {
      const r = await uploadMLSCSV(mlsFile)
      setMlsResult(r)
      await loadStats()
      await loadLeads()
    } catch {
      // ignore
    } finally {
      setMlsLoading(false)
      setMlsFile(null)
      if (mlsRef.current) mlsRef.current.value = ''
    }
  }

  async function handleClearAll() {
    if (!clearConfirm) { setClearConfirm(true); return }
    await clearAllLeads()
    setClearConfirm(false)
    setUploadResults({})
    await loadStats()
    await loadLeads()
  }

  const totalLeads = stats?.total ?? 0
  const highValue = stats?.high_value ?? 0

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, gap: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#D5A940' }} />
            <h1 style={{ fontSize: 20, fontWeight: 700, color: '#F9FAFB', margin: 0 }}>
              Hillsborough Lead Stacker
            </h1>
          </div>
          <p style={{ fontSize: 13, color: '#6B7280', marginTop: 4 }}>
            Cross-reference 6 county distress signals · Score 1-6 · Export for BatchLeads skip trace
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <a
            href={exportLeadsUrl(minScore)}
            download
            style={{
              padding: '8px 16px',
              background: '#D5A940',
              color: '#111827',
              borderRadius: 6,
              fontWeight: 700,
              fontSize: 13,
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              opacity: totalLeads === 0 ? 0.5 : 1,
              pointerEvents: totalLeads === 0 ? 'none' : 'auto',
            }}
          >
            ↓ Export BatchLeads CSV
          </a>
          <button
            onClick={handleClearAll}
            style={{
              padding: '8px 14px',
              background: 'transparent',
              color: clearConfirm ? '#EF4444' : '#6B7280',
              border: `1px solid ${clearConfirm ? '#EF4444' : '#374151'}`,
              borderRadius: 6,
              fontSize: 13,
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            {clearConfirm ? 'Confirm Clear All' : 'Clear All'}
          </button>
          {clearConfirm && (
            <button
              onClick={() => setClearConfirm(false)}
              style={{ padding: '8px 10px', background: 'transparent', color: '#6B7280', border: '1px solid #374151', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* Stats bar */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 12,
          marginBottom: 24,
        }}
      >
        <StatCard label="Total Leads" value={totalLeads.toLocaleString()} gold />
        <StatCard label="High Value (4-6)" value={highValue.toLocaleString()} />
        {[6, 5, 4, 3, 2, 1].map(s => (
          <StatCard
            key={s}
            label={`Score ${s}`}
            value={(stats?.score_distribution[String(s)] ?? 0).toLocaleString()}
            color={SCORE_COLORS[s]}
          />
        ))}
      </div>

      {/* Source upload grid */}
      <h2 style={{ fontSize: 13, fontWeight: 700, color: '#9CA3AF', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>
        Data Sources
      </h2>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
          gap: 12,
          marginBottom: 24,
        }}
      >
        {SOURCE_META.map(meta => (
          <SourceCard
            key={meta.key}
            meta={meta}
            count={stats?.source_counts[meta.key] ?? 0}
            onUpload={file => handleSourceUpload(meta.key, file)}
            onClear={() => handleSourceClear(meta.key)}
          />
        ))}
      </div>

      {/* Upload result feedback */}
      {Object.values(uploadResults).length > 0 && (
        <div
          style={{
            background: 'rgba(213,169,64,0.06)',
            border: '1px solid rgba(213,169,64,0.2)',
            borderRadius: 8,
            padding: '12px 16px',
            marginBottom: 24,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 16,
          }}
        >
          {Object.values(uploadResults).map(r => (
            <div key={r.source} style={{ fontSize: 12, color: '#D5A940' }}>
              <strong>{r.label}:</strong> {r.inserted} new · {r.updated} updated
              {r.skipped > 0 && <span style={{ color: '#6B7280' }}> · {r.skipped} skipped (no parcel ID)</span>}
            </div>
          ))}
        </div>
      )}

      {/* MLS cross-reference */}
      <div
        style={{
          background: '#1F2937',
          border: '1px solid #2D3748',
          borderRadius: 8,
          padding: 16,
          marginBottom: 24,
        }}
      >
        <h3 style={{ fontSize: 13, fontWeight: 700, color: '#F9FAFB', margin: '0 0 6px 0' }}>
          MLS Cross-Reference
        </h3>
        <p style={{ fontSize: 12, color: '#6B7280', margin: '0 0 12px 0' }}>
          Upload an MLS export CSV. Leads matching by parcel ID will be flagged — useful for finding sellers already
          trying to list.
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            ref={mlsRef}
            type="file"
            accept=".csv"
            style={{ display: 'none' }}
            onChange={e => setMlsFile(e.target.files?.[0] ?? null)}
          />
          <button
            onClick={() => mlsRef.current?.click()}
            style={{
              padding: '7px 14px',
              background: '#2D3748',
              color: '#D1D5DB',
              border: '1px solid #374151',
              borderRadius: 6,
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            {mlsFile ? mlsFile.name : 'Choose MLS CSV…'}
          </button>
          {mlsFile && (
            <button
              onClick={handleMLSUpload}
              disabled={mlsLoading}
              style={{
                padding: '7px 14px',
                background: '#3B82F6',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                fontWeight: 600,
                fontSize: 12,
                cursor: mlsLoading ? 'not-allowed' : 'pointer',
              }}
            >
              {mlsLoading ? 'Processing…' : 'Cross-Reference'}
            </button>
          )}
          {mlsResult && (
            <span style={{ fontSize: 12, color: '#10B981' }}>
              ✓ {mlsResult.matched_leads} leads matched from {mlsResult.total_in_csv} MLS records
            </span>
          )}
          {(stats?.mls_cross_referenced ?? 0) > 0 && !mlsResult && (
            <span style={{ fontSize: 12, color: '#6B7280' }}>
              {stats?.mls_cross_referenced} leads currently flagged as on MLS
            </span>
          )}
        </div>
      </div>

      {/* Lead table */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 style={{ fontSize: 13, fontWeight: 700, color: '#9CA3AF', letterSpacing: '0.08em', textTransform: 'uppercase', margin: 0 }}>
          Leads {totalLeads > 0 && `— ${leads.length.toLocaleString()} shown`}
        </h2>
        {/* Score filter tabs */}
        <div style={{ display: 'flex', gap: 4 }}>
          {[
            { label: 'All', value: 1 },
            { label: 'Score 3+', value: 3 },
            { label: 'Score 4+', value: 4 },
            { label: 'Score 5+', value: 5 },
            { label: 'Score 6', value: 6 },
          ].map(tab => (
            <button
              key={tab.value}
              onClick={() => setMinScore(tab.value)}
              style={{
                padding: '5px 10px',
                background: minScore === tab.value ? 'rgba(213,169,64,0.15)' : 'transparent',
                color: minScore === tab.value ? '#D5A940' : '#6B7280',
                border: `1px solid ${minScore === tab.value ? '#D5A940' : '#374151'}`,
                borderRadius: 5,
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {loadingLeads ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#6B7280', fontSize: 13 }}>Loading leads…</div>
      ) : leads.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '48px 24px',
            background: '#1F2937',
            border: '1px solid #2D3748',
            borderRadius: 8,
            color: '#6B7280',
            fontSize: 13,
          }}
        >
          {totalLeads === 0
            ? 'No leads yet. Upload CSVs from one or more sources to begin.'
            : `No leads with score ${minScore}+. Try a lower threshold.`}
        </div>
      ) : (
        <div style={{ background: '#1F2937', border: '1px solid #2D3748', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#111827' }}>
                  <Th>Score</Th>
                  <Th>Parcel ID</Th>
                  <Th>Owner</Th>
                  <Th>Property Address</Th>
                  <Th>Zip</Th>
                  <Th>Sources</Th>
                  <Th>MLS Price</Th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead, i) => (
                  <tr
                    key={lead.id}
                    style={{
                      background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)',
                      borderTop: '1px solid #2D3748',
                    }}
                  >
                    <Td>
                      <ScoreBadge score={lead.score} />
                    </Td>
                    <Td>
                      <span style={{ fontFamily: 'monospace', color: '#D1D5DB', fontSize: 11 }}>
                        {lead.parcel_id || '—'}
                      </span>
                    </Td>
                    <Td>
                      <div style={{ color: '#F9FAFB' }}>{lead.owner_name || '—'}</div>
                      {lead.mail_city && (
                        <div style={{ color: '#6B7280', fontSize: 10 }}>
                          {[lead.mail_city, lead.mail_state].filter(Boolean).join(', ')}
                        </div>
                      )}
                    </Td>
                    <Td>
                      <span style={{ color: '#D1D5DB' }}>{lead.property_address || '—'}</span>
                    </Td>
                    <Td>
                      <span style={{ color: '#9CA3AF' }}>{lead.property_zip || '—'}</span>
                    </Td>
                    <Td>
                      <SourceIcon lead={lead} />
                    </Td>
                    <Td>
                      {lead.mls_list_price ? (
                        <span style={{ color: '#3B82F6', fontWeight: 600 }}>
                          ${lead.mls_list_price.toLocaleString()}
                          {lead.mls_days_on_market != null && (
                            <span style={{ fontWeight: 400, color: '#6B7280', marginLeft: 4 }}>
                              {lead.mls_days_on_market}d
                            </span>
                          )}
                        </span>
                      ) : (
                        <span style={{ color: '#374151' }}>—</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        padding: '8px 12px',
        textAlign: 'left',
        fontWeight: 600,
        fontSize: 10,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: '#6B7280',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </th>
  )
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td style={{ padding: '8px 12px', verticalAlign: 'middle' }}>
      {children}
    </td>
  )
}

function StatCard({
  label,
  value,
  gold,
  color,
}: {
  label: string
  value: string
  gold?: boolean
  color?: string
}) {
  return (
    <div
      style={{
        background: '#1F2937',
        border: `1px solid ${gold ? 'rgba(213,169,64,0.3)' : '#2D3748'}`,
        borderRadius: 8,
        padding: '12px 14px',
      }}
    >
      <div
        style={{
          fontSize: 18,
          fontWeight: 700,
          color: gold ? '#D5A940' : color ?? '#F9FAFB',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 10, color: '#6B7280', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </div>
    </div>
  )
}
