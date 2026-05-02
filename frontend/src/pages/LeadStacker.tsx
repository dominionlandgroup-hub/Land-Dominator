import React, { useEffect, useRef, useState } from 'react'
import {
  getSchema,
  uploadSourceCSV,
  uploadMLSCSV,
  getLeadStackerStats,
  getLeads,
  exportLeadsUrl,
  clearLeads,
  clearSignal,
  type County,
  type SourceKey,
  type TampaBayLead,
  type LeadStackerStats,
  type UploadResult,
  type SchemaInfo,
} from '../api/leadStacker'

// ── Constants ────────────────────────────────────────────────────────────────

const COUNTIES: { id: County; label: string; color: string }[] = [
  { id: 'hillsborough', label: 'Hillsborough', color: '#4F46E5' },
  { id: 'pinellas',     label: 'Pinellas',     color: '#0891B2' },
  { id: 'pasco',        label: 'Pasco',        color: '#059669' },
]

const COUNTY_COLOR: Record<string, string> = {
  hillsborough: '#4F46E5',
  pinellas: '#0891B2',
  pasco: '#059669',
}

const SCORE_COLORS: Record<number, string> = {
  1: '#9CA3AF',
  2: '#6B7280',
  3: '#D97706',
  4: '#F59E0B',
  5: '#EF4444',
  6: '#DC2626',
}

const SOURCE_ICONS: Record<string, string> = {
  'tax-deed':        '⚖️',
  'lands-available': '🏚️',
  'lis-pendens':     '📋',
  'foreclosure':     '🔨',
  'probate':         '📜',
  'code-violation':  '⚠️',
}

// ── Score badge ───────────────────────────────────────────────────────────────

function ScoreBadge({ score }: { score: number }) {
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 28, height: 28, borderRadius: '50%',
        background: SCORE_COLORS[score] ?? '#9CA3AF',
        color: '#fff', fontSize: 12, fontWeight: 700, flexShrink: 0,
      }}
    >
      {score}
    </span>
  )
}

// ── Pain signal chips ─────────────────────────────────────────────────────────

function SignalChips({
  signals,
  schema,
}: {
  signals: string[]
  schema: SchemaInfo | null
}) {
  return (
    <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
      {signals.map(sig => {
        const [county, source] = sig.split(':', 2)
        const label = schema?.counties[county as County]?.[source as SourceKey]?.label ?? source
        const short = label.split(/[\s/]/)[0].slice(0, 3).toUpperCase()
        const color = COUNTY_COLOR[county] ?? '#4F46E5'
        return (
          <span
            key={sig}
            title={`${county.charAt(0).toUpperCase() + county.slice(1)}: ${label}`}
            style={{
              fontSize: 9, fontWeight: 700, padding: '1px 4px', borderRadius: 3,
              background: `${color}1A`, color: color, border: `1px solid ${color}40`,
            }}
          >
            {short}
          </span>
        )
      })}
    </div>
  )
}

// ── Source upload card ────────────────────────────────────────────────────────

function SourceCard({
  county,
  source,
  label,
  url,
  signalKey,
  signalCount,
  onUpload,
  onClear,
}: {
  county: County
  source: SourceKey
  label: string
  url: string
  signalKey: string
  signalCount: number
  onUpload: (file: File) => Promise<UploadResult>
  onClear: () => Promise<void>
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<UploadResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const countyColor = COUNTY_COLOR[county]

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setLoading(true); setError(null); setResult(null)
    try {
      const r = await onUpload(file)
      setResult(r)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setLoading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const hasData = signalCount > 0

  return (
    <div
      style={{
        background: '#fff',
        border: `1px solid ${hasData ? countyColor + '40' : '#E5E7EB'}`,
        borderLeft: hasData ? `3px solid ${countyColor}` : '3px solid transparent',
        borderRadius: 8,
        padding: '12px 14px',
        display: 'flex', flexDirection: 'column', gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span style={{ fontSize: 18, lineHeight: 1.1 }}>{SOURCE_ICONS[source] ?? '📄'}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, color: '#111827', fontSize: 12 }}>{label}</div>
          <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 1 }}>
            {url}
          </div>
        </div>
        {hasData && (
          <span
            style={{
              background: `${countyColor}12`, border: `1px solid ${countyColor}30`,
              color: countyColor, borderRadius: 4, padding: '1px 6px',
              fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap',
            }}
          >
            {signalCount.toLocaleString()}
          </span>
        )}
      </div>

      {error && (
        <div style={{ fontSize: 10, color: '#DC2626', background: '#FEF2F2', borderRadius: 4, padding: '3px 6px' }}>
          {error}
        </div>
      )}
      {result && (
        <div style={{ fontSize: 10, color: '#059669', background: '#F0FDF4', borderRadius: 4, padding: '3px 6px' }}>
          +{result.inserted} new · {result.updated} updated
          {result.skipped_improved_land > 0 && (
            <span style={{ color: '#6B7280' }}> · {result.skipped_improved_land} improved skipped</span>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6 }}>
        <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleFile} />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={loading}
          style={{
            flex: 1, padding: '5px 10px', borderRadius: 5, fontSize: 11, fontWeight: 600,
            background: loading ? '#F3F4F6' : countyColor,
            color: loading ? '#9CA3AF' : '#fff',
            border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'Uploading…' : hasData ? 'Re-Upload' : 'Upload CSV'}
        </button>
        {hasData && (
          <button
            onClick={onClear}
            style={{
              padding: '5px 8px', background: 'transparent', color: '#9CA3AF',
              border: '1px solid #E5E7EB', borderRadius: 5, fontSize: 11, cursor: 'pointer',
            }}
          >
            ✕
          </button>
        )}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function LeadStacker() {
  const [schema, setSchema] = useState<SchemaInfo | null>(null)
  const [stats, setStats] = useState<LeadStackerStats | null>(null)
  const [leads, setLeads] = useState<TampaBayLead[]>([])
  const [county, setCounty] = useState<County | 'all'>('all')
  const [minScore, setMinScore] = useState(1)
  const [loadingLeads, setLoadingLeads] = useState(false)
  const [mlsFile, setMlsFile] = useState<File | null>(null)
  const [mlsLoading, setMlsLoading] = useState(false)
  const [mlsResult, setMlsResult] = useState<{ total_in_csv: number; matched_leads: number } | null>(null)
  const [clearTarget, setClearTarget] = useState<string | null>(null)
  const mlsRef = useRef<HTMLInputElement>(null)

  async function refresh() {
    try {
      const s = await getLeadStackerStats()
      setStats(s)
    } catch { /* table may not exist yet */ }
  }

  async function loadLeads() {
    setLoadingLeads(true)
    try {
      const res = await getLeads({
        county: county === 'all' ? undefined : county,
        minScore,
        limit: 1000,
      })
      setLeads(res.leads)
    } catch {
      setLeads([])
    } finally {
      setLoadingLeads(false)
    }
  }

  useEffect(() => {
    getSchema().then(setSchema).catch(() => null)
    refresh()
  }, [])

  useEffect(() => {
    loadLeads()
  }, [county, minScore]) // eslint-disable-line

  async function handleUpload(c: County, s: SourceKey, file: File): Promise<UploadResult> {
    const result = await uploadSourceCSV(c, s, file)
    await refresh()
    await loadLeads()
    return result
  }

  async function handleClearSignal(c: County, s: SourceKey) {
    await clearSignal(c, s)
    await refresh()
    await loadLeads()
  }

  async function handleClearCounty(c: County) {
    if (clearTarget !== c) { setClearTarget(c); return }
    await clearLeads(c)
    setClearTarget(null)
    await refresh()
    await loadLeads()
  }

  async function handleMLSUpload() {
    if (!mlsFile) return
    setMlsLoading(true)
    try {
      const r = await uploadMLSCSV(mlsFile)
      setMlsResult(r)
      await refresh()
      await loadLeads()
    } catch { /* ignore */ } finally {
      setMlsLoading(false)
      setMlsFile(null)
      if (mlsRef.current) mlsRef.current.value = ''
    }
  }

  const totalLeads = stats?.total ?? 0

  // Build signal count map: "hillsborough:tax-deed" → count
  const signalCounts = stats?.signal_counts ?? {}

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1300, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: 0 }}>
            Tampa Bay Lead Stacker
          </h1>
          <p style={{ fontSize: 13, color: '#6B7280', margin: '4px 0 0' }}>
            Hillsborough · Pinellas · Pasco — cross-reference distress signals, score 1-6, export to BatchLeads
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <a
            href={exportLeadsUrl(minScore, county)}
            download
            style={{
              padding: '8px 16px', background: '#4F46E5', color: '#fff',
              borderRadius: 6, fontWeight: 700, fontSize: 13, textDecoration: 'none',
              display: 'inline-flex', alignItems: 'center', gap: 6,
              opacity: totalLeads === 0 ? 0.4 : 1,
              pointerEvents: totalLeads === 0 ? 'none' : 'auto',
            }}
          >
            ↓ Export BatchLeads CSV
          </a>
        </div>
      </div>

      {/* Stats row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto auto auto auto repeat(6, auto)',
          gap: 10,
          marginBottom: 24,
          overflowX: 'auto',
        }}
      >
        <StatCard label="Total Leads" value={totalLeads.toLocaleString()} primary />
        {COUNTIES.map(c => (
          <StatCard
            key={c.id}
            label={c.label}
            value={(stats?.county_counts[c.id] ?? 0).toLocaleString()}
            color={c.color}
          />
        ))}
        {[6, 5, 4, 3, 2, 1].map(s => (
          <StatCard
            key={s}
            label={`Score ${s}`}
            value={(stats?.score_distribution[String(s)] ?? 0).toLocaleString()}
            color={SCORE_COLORS[s]}
          />
        ))}
      </div>

      {/* County tabs + source upload cards */}
      <div style={{ marginBottom: 24 }}>
        {COUNTIES.map(cInfo => (
          <CountySection
            key={cInfo.id}
            county={cInfo.id}
            color={cInfo.color}
            schema={schema}
            signalCounts={signalCounts}
            onUpload={handleUpload}
            onClearSignal={handleClearSignal}
            onClearAll={handleClearCounty}
            clearTarget={clearTarget}
            setClearTarget={setClearTarget}
          />
        ))}
      </div>

      {/* MLS cross-reference */}
      <div
        style={{
          background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8,
          padding: '14px 16px', marginBottom: 24,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div>
            <div style={{ fontWeight: 600, color: '#111827', fontSize: 13 }}>MLS Cross-Reference</div>
            <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>
              Upload MLS export CSV — matches against all three counties by parcel ID or owner name
            </div>
          </div>
          {(stats?.mls_cross_referenced ?? 0) > 0 && !mlsResult && (
            <span style={{ fontSize: 12, color: '#6B7280' }}>
              {stats?.mls_cross_referenced} leads flagged as on MLS
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input ref={mlsRef} type="file" accept=".csv" style={{ display: 'none' }}
            onChange={e => setMlsFile(e.target.files?.[0] ?? null)} />
          <button
            onClick={() => mlsRef.current?.click()}
            style={{
              padding: '6px 12px', background: '#F9FAFB', color: '#374151',
              border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 12, cursor: 'pointer',
            }}
          >
            {mlsFile ? mlsFile.name : 'Choose MLS CSV…'}
          </button>
          {mlsFile && (
            <button
              onClick={handleMLSUpload}
              disabled={mlsLoading}
              style={{
                padding: '6px 14px', background: '#2563EB', color: '#fff',
                border: 'none', borderRadius: 6, fontWeight: 600, fontSize: 12,
                cursor: mlsLoading ? 'not-allowed' : 'pointer',
              }}
            >
              {mlsLoading ? 'Processing…' : 'Cross-Reference'}
            </button>
          )}
          {mlsResult && (
            <span style={{ fontSize: 12, color: '#059669' }}>
              ✓ {mlsResult.matched_leads} leads matched from {mlsResult.total_in_csv.toLocaleString()} MLS records
            </span>
          )}
        </div>
      </div>

      {/* Lead table */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {/* County filter */}
          <div style={{ display: 'flex', gap: 4 }}>
            {(['all', ...COUNTIES.map(c => c.id)] as (County | 'all')[]).map(c => {
              const active = county === c
              const color = c === 'all' ? '#4F46E5' : (COUNTY_COLOR[c] ?? '#4F46E5')
              return (
                <button
                  key={c}
                  onClick={() => setCounty(c)}
                  style={{
                    padding: '4px 10px', borderRadius: 5, fontSize: 11, fontWeight: 600,
                    background: active ? `${color}12` : 'transparent',
                    color: active ? color : '#9CA3AF',
                    border: `1px solid ${active ? color + '40' : '#E5E7EB'}`,
                    cursor: 'pointer',
                  }}
                >
                  {c === 'all' ? 'All Counties' : c.charAt(0).toUpperCase() + c.slice(1)}
                  {c !== 'all' && stats && (
                    <span style={{ marginLeft: 4, fontSize: 10, opacity: 0.8 }}>
                      {(stats.county_counts[c as County] ?? 0).toLocaleString()}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          <div style={{ width: 1, height: 18, background: '#E5E7EB', margin: '0 4px' }} />

          {/* Score filter */}
          <div style={{ display: 'flex', gap: 4 }}>
            {[
              { label: 'All', v: 1 },
              { label: '3+', v: 3 },
              { label: '4+', v: 4 },
              { label: '5+', v: 5 },
              { label: '6', v: 6 },
            ].map(tab => (
              <button
                key={tab.v}
                onClick={() => setMinScore(tab.v)}
                style={{
                  padding: '4px 8px', borderRadius: 5, fontSize: 11, fontWeight: 600,
                  background: minScore === tab.v ? '#F0F0FF' : 'transparent',
                  color: minScore === tab.v ? '#4F46E5' : '#9CA3AF',
                  border: `1px solid ${minScore === tab.v ? '#C7D2FE' : '#E5E7EB'}`,
                  cursor: 'pointer',
                }}
              >
                Score {tab.label}
              </button>
            ))}
          </div>
        </div>

        <span style={{ fontSize: 12, color: '#9CA3AF' }}>
          {loadingLeads ? 'Loading…' : `${leads.length.toLocaleString()} leads shown`}
        </span>
      </div>

      {/* Table */}
      {leads.length === 0 && !loadingLeads ? (
        <div
          style={{
            textAlign: 'center', padding: '48px 24px',
            background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8,
            color: '#9CA3AF', fontSize: 13,
          }}
        >
          {totalLeads === 0
            ? 'No leads yet. Upload CSVs from one or more sources to begin.'
            : `No leads match the current filters.`}
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#F9FAFB', borderBottom: '1px solid #E5E7EB' }}>
                  <Th>Score</Th>
                  <Th>County</Th>
                  <Th>Parcel ID</Th>
                  <Th>Owner</Th>
                  <Th>Property Address</Th>
                  <Th>Acres</Th>
                  <Th>Signals</Th>
                  <Th>MLS</Th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead, i) => {
                  const countyColor = COUNTY_COLOR[lead.county] ?? '#4F46E5'
                  return (
                    <tr
                      key={lead.id}
                      style={{
                        background: i % 2 === 0 ? '#fff' : '#FAFAFA',
                        borderTop: '1px solid #F3F4F6',
                      }}
                    >
                      <Td>
                        <ScoreBadge score={lead.score} />
                      </Td>
                      <Td>
                        <span
                          style={{
                            fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                            background: `${countyColor}12`, color: countyColor,
                            border: `1px solid ${countyColor}30`,
                          }}
                        >
                          {lead.county.charAt(0).toUpperCase() + lead.county.slice(1)}
                        </span>
                      </Td>
                      <Td>
                        <span style={{ fontFamily: 'monospace', color: '#374151', fontSize: 11 }}>
                          {lead.parcel_id || '—'}
                        </span>
                      </Td>
                      <Td>
                        <div style={{ color: '#111827', fontWeight: 500 }}>{lead.owner_name || '—'}</div>
                        {(lead.mail_city || lead.mail_state) && (
                          <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 1 }}>
                            {[lead.mail_city, lead.mail_state].filter(Boolean).join(', ')}
                          </div>
                        )}
                      </Td>
                      <Td>
                        <div style={{ color: '#374151' }}>{lead.property_address || '—'}</div>
                        {lead.property_city && (
                          <div style={{ fontSize: 10, color: '#9CA3AF' }}>
                            {lead.property_city}, FL {lead.property_zip}
                          </div>
                        )}
                      </Td>
                      <Td>
                        <span style={{ color: lead.lot_acres ? '#374151' : '#D1D5DB' }}>
                          {lead.lot_acres != null ? `${lead.lot_acres.toFixed(2)} ac` : '—'}
                        </span>
                      </Td>
                      <Td>
                        <SignalChips signals={lead.pain_signals || []} schema={schema} />
                      </Td>
                      <Td>
                        {lead.on_mls && lead.mls_list_price ? (
                          <span style={{ color: '#2563EB', fontWeight: 600 }}>
                            ${lead.mls_list_price.toLocaleString()}
                            {lead.mls_days_on_market != null && (
                              <span style={{ fontWeight: 400, color: '#9CA3AF', marginLeft: 4 }}>
                                {lead.mls_days_on_market}d
                              </span>
                            )}
                          </span>
                        ) : lead.on_mls ? (
                          <span style={{ fontSize: 10, color: '#2563EB' }}>Listed</span>
                        ) : (
                          <span style={{ color: '#E5E7EB' }}>—</span>
                        )}
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── County section ────────────────────────────────────────────────────────────

function CountySection({
  county,
  color,
  schema,
  signalCounts,
  onUpload,
  onClearSignal,
  onClearAll,
  clearTarget,
  setClearTarget,
}: {
  county: County
  color: string
  schema: SchemaInfo | null
  signalCounts: Record<string, number>
  onUpload: (c: County, s: SourceKey, f: File) => Promise<UploadResult>
  onClearSignal: (c: County, s: SourceKey) => Promise<void>
  onClearAll: (c: County) => Promise<void>
  clearTarget: string | null
  setClearTarget: (v: string | null) => void
}) {
  const [open, setOpen] = useState(true)
  const sources = schema?.counties[county] ?? {}
  const countySources = Object.entries(sources) as [SourceKey, { label: string; url: string }][]

  const totalForCounty = countySources.reduce(
    (sum, [src]) => sum + (signalCounts[`${county}:${src}`] ?? 0),
    0,
  )

  return (
    <div
      style={{
        marginBottom: 12,
        border: '1px solid #E5E7EB',
        borderRadius: 10,
        overflow: 'hidden',
        background: '#fff',
      }}
    >
      {/* County header */}
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px',
          background: `${color}08`,
          borderBottom: open ? '1px solid #E5E7EB' : 'none',
          cursor: 'pointer',
        }}
        onClick={() => setOpen(v => !v)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
          <span style={{ fontWeight: 700, fontSize: 13, color: '#111827' }}>
            {county.charAt(0).toUpperCase() + county.slice(1)} County
          </span>
          {totalForCounty > 0 && (
            <span
              style={{
                background: `${color}15`, border: `1px solid ${color}30`,
                color: color, borderRadius: 4, padding: '1px 8px',
                fontSize: 11, fontWeight: 700,
              }}
            >
              {totalForCounty.toLocaleString()} leads
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
          {totalForCounty > 0 && (
            <>
              <button
                onClick={() => onClearAll(county)}
                style={{
                  padding: '3px 10px', fontSize: 11, fontWeight: 600,
                  background: 'transparent',
                  color: clearTarget === county ? '#DC2626' : '#9CA3AF',
                  border: `1px solid ${clearTarget === county ? '#DC2626' : '#E5E7EB'}`,
                  borderRadius: 5, cursor: 'pointer',
                }}
              >
                {clearTarget === county ? 'Confirm Clear' : 'Clear County'}
              </button>
              {clearTarget === county && (
                <button
                  onClick={() => setClearTarget(null)}
                  style={{
                    padding: '3px 8px', fontSize: 11,
                    background: 'transparent', color: '#9CA3AF',
                    border: '1px solid #E5E7EB', borderRadius: 5, cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              )}
            </>
          )}
          <span style={{ fontSize: 12, color: '#9CA3AF' }}>{open ? '▲' : '▼'}</span>
        </div>
      </div>

      {/* Source cards grid */}
      {open && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: 10,
            padding: 12,
          }}
        >
          {countySources.map(([src, meta]) => (
            <SourceCard
              key={src}
              county={county}
              source={src}
              label={meta.label}
              url={meta.url}
              signalKey={`${county}:${src}`}
              signalCount={signalCounts[`${county}:${src}`] ?? 0}
              onUpload={f => onUpload(county, src, f)}
              onClear={() => onClearSignal(county, src)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Layout primitives ─────────────────────────────────────────────────────────

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        padding: '7px 12px', textAlign: 'left', fontWeight: 600,
        fontSize: 10, letterSpacing: '0.07em', textTransform: 'uppercase',
        color: '#9CA3AF', whiteSpace: 'nowrap',
      }}
    >
      {children}
    </th>
  )
}

function Td({ children }: { children: React.ReactNode }) {
  return <td style={{ padding: '7px 12px', verticalAlign: 'middle' }}>{children}</td>
}

function StatCard({
  label,
  value,
  primary,
  color,
}: {
  label: string
  value: string
  primary?: boolean
  color?: string
}) {
  const c = primary ? '#4F46E5' : (color ?? '#374151')
  return (
    <div
      style={{
        background: '#fff',
        border: `1px solid ${primary ? '#C7D2FE' : '#E5E7EB'}`,
        borderRadius: 8, padding: '10px 14px', minWidth: 90,
      }}
    >
      <div style={{ fontSize: 17, fontWeight: 700, color: c, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
      <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </div>
    </div>
  )
}
