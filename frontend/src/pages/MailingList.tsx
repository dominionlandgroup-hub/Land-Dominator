import React, { useEffect, useState } from 'react'
import DataTable from '../components/DataTable'
import LoadingSpinner from '../components/LoadingSpinner'
import LoadingOverlay from '../components/LoadingOverlay'
import { useApp } from '../context/AppContext'
import {
  fetchMailingPreview,
  getMailingDownloadUrl,
  createCampaign,
} from '../api/client'
import type { Column } from '../components/DataTable'
import type { MatchedParcel } from '../types'
import { getConfidence } from '../types'
import WelcomeScreen from './WelcomeScreen'

const ZIP_COLORS = ['#5C2977','#8B4DB8','#2D7A4F','#D5A940','#7B3E99','#C05000','#4CAF7A','#B8860B','#3D1A5C']

export default function MailingList() {
  const {
    matchResult,
    mailingPreview,
    setMailingPreview,
    setCurrentPage,
    lastFilters,
  } = useApp()

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Save as campaign
  const [showSavePanel, setShowSavePanel] = useState(false)
  const [campaignName, setCampaignName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedName, setSavedName] = useState<string | null>(null)
  const [workingRows, setWorkingRows] = useState<MatchedParcel[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [flaggedIds, setFlaggedIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (matchResult && !mailingPreview) load()
  }, [matchResult])

  async function load() {
    if (!matchResult) return
    setLoading(true)
    setError(null)
    try {
      const preview = await fetchMailingPreview(matchResult.match_id)
      setMailingPreview(preview)
      setWorkingRows(preview.results)
      setSelectedIds(new Set())
      setFlaggedIds(new Set())
    } catch {
      setError('Failed to generate mailing list. Please retry.')
    } finally {
      setLoading(false)
    }
  }

  async function handleSaveCampaign() {
    if (!matchResult || !campaignName.trim()) return
    setSaving(true)
    setSaveError(null)
    try {
      await createCampaign(campaignName.trim(), matchResult.match_id, lastFilters ?? {})
      setSavedName(campaignName.trim())
      setShowSavePanel(false)
      setCampaignName('')
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail ?? 'Failed to save campaign.'
      setSaveError(msg)
    } finally {
      setSaving(false)
    }
  }

  if (!matchResult) {
    return <WelcomeScreen contextualMessage="Upload and match targets first to generate a mailing list." />
  }

  const matchId = matchResult.match_id
  const fullUrl = getMailingDownloadUrl(matchId, 'mailing-list', 'full')
  const highConfUrl = getMailingDownloadUrl(matchId, 'high-confidence', 'high-confidence')
  const top500Url = getMailingDownloadUrl(matchId, 'top-500', 'top500')

  const afterDedup = workingRows.length
  const highConfCount = mailingPreview
    ? workingRows.filter((r) => r.matched_comp_count >= 3).length
    : 0

  const selectedCount = selectedIds.size
  const flaggedRows = workingRows.filter((r, idx) => flaggedIds.has(rowId(r, idx)))

  const totalAcq = workingRows.reduce((s, r) => s + (r.suggested_offer_mid ?? 0), 0)
  const avgOffer = workingRows.length > 0 ? totalAcq / workingRows.length : 0
  const offerVals = workingRows.map((r) => r.suggested_offer_mid).filter((v): v is number => v != null)
  const offerMin = offerVals.length > 0 ? Math.min(...offerVals) : 0
  const offerMax = offerVals.length > 0 ? Math.max(...offerVals) : 0
  // Cap display at 95th percentile to avoid outlier skew
  const sortedOffers = [...offerVals].sort((a, b) => a - b)
  const p95Idx = Math.min(Math.floor(0.95 * sortedOffers.length), sortedOffers.length - 1)
  const offerMax95 = sortedOffers.length > 0 ? sortedOffers[p95Idx] : 0
  const hasOutlier = offerMax > offerMax95 * 1.5
  const zipBreakdown = new Map<string, number>()
  workingRows.forEach((r) => {
    const z = r.parcel_zip || 'Unknown'
    zipBreakdown.set(z, (zipBreakdown.get(z) ?? 0) + 1)
  })

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleFlag(id: string) {
    setFlaggedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function removeSelected() {
    setWorkingRows((prev) => prev.filter((r, idx) => !selectedIds.has(rowId(r, idx))))
    setFlaggedIds((prev) => {
      const next = new Set(prev)
      Array.from(selectedIds).forEach((id) => next.delete(id))
      return next
    })
    setSelectedIds(new Set())
  }

  const cols: Column<MatchedParcel>[] = [
    {
      key: '__selected',
      header: '',
      align: 'center',
      render: (_, row) => {
        const idx = workingRows.indexOf(row)
        const id = rowId(row, idx)
        const checked = selectedIds.has(id)
        return <input type="checkbox" checked={checked} onChange={() => toggleSelect(id)} className="accent-brand-600" />
      },
    },
    {
      key: '__flag',
      header: 'Flag',
      align: 'center',
      render: (_, row) => {
        const idx = workingRows.indexOf(row)
        const id = rowId(row, idx)
        const flagged = flaggedIds.has(id)
        return (
          <button onClick={() => toggleFlag(id)} title="Flag row">
            <svg width="14" height="14" viewBox="0 0 24 24" fill={flagged ? '#facc15' : 'none'} stroke={flagged ? '#facc15' : '#9B8AAE'} strokeWidth="2">
              <path d="M5 3v18"/>
              <path d="M5 4h11l-2 4 2 4H5"/>
            </svg>
          </button>
        )
      },
    },
    {
      key: 'match_score',
      header: 'Score',
      sortable: true,
      align: 'center',
      render: (v) => <ScoreBadge score={v as number} />,
    },
    {
      key: 'matched_comp_count',
      header: 'Confidence',
      sortable: true,
      align: 'center',
      render: (v) => {
        const level = getConfidence(v as number)
        return (
          <span className={`conf-${level}`}>
            {level}
          </span>
        )
      },
    },
    {
      key: 'owner_name',
      header: 'Owner Name',
      render: (v) => (
        <span className="max-w-[180px] block truncate text-xs" title={String(v)}>
          {String(v || '—')}
        </span>
      ),
    },
    {
      key: 'mail_address',
      header: 'Mail Address',
      render: (v) => (
        <span className="max-w-[180px] block truncate text-xs" title={String(v)}>
          {String(v || '—')}
        </span>
      ),
    },
    { key: 'mail_city', header: 'City', render: (v) => <span className="text-xs">{String(v || '—')}</span> },
    { key: 'mail_state', header: 'ST', render: (v) => <span className="text-xs">{String(v || '—')}</span> },
    { key: 'mail_zip', header: 'Mail ZIP', render: (v) => <span className="text-xs font-mono">{String(v || '—')}</span> },
    {
      key: 'apn',
      header: 'APN',
      sortable: true,
      defaultHidden: true,
      render: (v) => <span className="text-xs font-mono">{String(v || '—')}</span>,
    },
    { key: 'parcel_zip', header: 'Parcel ZIP', sortable: true, defaultHidden: true },
    {
      key: 'lot_acres',
      header: 'Acres',
      sortable: true,
      align: 'right',
      render: (v) =>
        v == null ? <span style={{ color: '#9B8AAE' }}>—</span> : <span>{(v as number).toFixed(2)}</span>,
    },
    {
      key: 'suggested_offer_low',
      header: 'Offer Low',
      sortable: true,
      align: 'right',
      defaultHidden: true,
      render: (v) =>
        v == null ? <span style={{ color: '#9B8AAE' }}>—</span> : <span className="text-xs">${Math.round(v as number).toLocaleString()}</span>,
    },
    {
      key: 'suggested_offer_mid',
      header: 'Offer Mid',
      sortable: true,
      align: 'right',
      render: (v) =>
        v == null ? (
          <span style={{ color: '#9B8AAE' }}>—</span>
        ) : (
          <span className="font-semibold" style={{ color: '#2D7A4F' }}>
            ${Math.round(v as number).toLocaleString()}
          </span>
        ),
    },
    {
      key: 'suggested_offer_high',
      header: 'Offer High',
      sortable: true,
      align: 'right',
      defaultHidden: true,
      render: (v) =>
        v == null ? <span style={{ color: '#9B8AAE' }}>—</span> : <span className="text-xs">${Math.round(v as number).toLocaleString()}</span>,
    },
    {
      key: 'tlp_estimate',
      header: 'TLP Est',
      align: 'right',
      defaultHidden: true,
      render: (v) =>
        v == null ? <span style={{ color: '#9B8AAE' }}>—</span> : <span className="text-xs" style={{ color: '#6B5B8A' }}>${Math.round(v as number).toLocaleString()}</span>,
    },
    {
      key: 'flood_zone',
      header: 'Flood',
      defaultHidden: true,
      render: (v) => <span className="text-xs" style={{ color: '#6B5B8A' }}>{String(v || '—')}</span>,
    },
    {
      key: 'buildability_pct',
      header: 'Build%',
      align: 'right',
      defaultHidden: true,
      render: (v) =>
        v == null ? (
          <span style={{ color: '#9B8AAE' }}>—</span>
        ) : (
          <span
            className="text-xs"
            style={{ color: (v as number) > 70 ? '#2D7A4F' : (v as number) > 40 ? '#D5A940' : '#ef4444' }}
          >
            {(v as number).toFixed(0)}%
          </span>
        ),
    },
  ]

  return (
    <div className="flex flex-col min-h-screen">
      <LoadingOverlay visible={loading && !mailingPreview} title="Generating mailing list…" />
      {/* Page header */}
      <div className="page-header">
        <div>
          <h1 className="text-lg font-semibold" style={{ color: '#1A0A2E' }}>Mailing List</h1>
          <p className="text-xs mt-0.5" style={{ color: '#6B5B8A' }}>
            Deduplicated, mail-ready list with offer pricing
            {mailingPreview && ` · ${mailingPreview.total_after_dedup.toLocaleString()} records`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="btn-secondary text-sm"
            onClick={load}
            disabled={loading}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 4 23 10 17 10"/>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
            </svg>
            Refresh
          </button>
          {mailingPreview && (
            <>
              <a
                href={highConfUrl}
                download
                className="btn-secondary text-sm no-underline"
                style={{ borderColor: '#D5A940', color: '#D5A940' }}
                title="Download parcels with 3+ matching comps"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                High Confidence ({highConfCount.toLocaleString()})
              </a>
              <a
                href={top500Url}
                download
                className="btn-secondary text-sm no-underline"
                style={{ borderColor: '#D5A940', color: '#D5A940' }}
                title="Top 500 records by match score"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Top 500
              </a>
              <a
                href={fullUrl}
                download
                className="btn-primary text-sm no-underline"
                title="Download full deduplicated list"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Full List ({afterDedup.toLocaleString()})
              </a>
            </>
          )}
        </div>
      </div>

      <div className="p-8 max-w-[1400px] mx-auto w-full">
        {loading && (
          <div className="flex justify-center py-16">
            <LoadingSpinner size="lg" label="Applying deduplication rules…" />
          </div>
        )}

        {error && (
          <div className="rounded-xl px-5 py-4 mb-6 text-sm flex items-center justify-between"
            style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#dc2626' }}>
            <span>{error}</span>
            <button className="btn-secondary text-sm" onClick={load}>Retry</button>
          </div>
        )}

        {savedName && (
          <div className="rounded-xl px-5 py-4 mb-6 text-sm flex items-center gap-3"
            style={{ background: 'rgba(45,122,79,0.06)', border: '1px solid rgba(45,122,79,0.15)', color: '#2D7A4F' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            <span>Campaign <strong>"{savedName}"</strong> saved.</span>
            <button
              className="ml-auto text-xs underline"
              style={{ color: '#2D7A4F' }}
              onClick={() => setCurrentPage('campaigns')}
            >
              View Campaigns →
            </button>
          </div>
        )}

        {mailingPreview && !loading && (
          <>
            <div className="card mb-6">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <p style={{ color: '#6B5B8A' }}>Total acquisition value</p>
                  <p className="font-semibold" style={{ color: '#2D7A4F' }}>
                    ${Math.round(totalAcq).toLocaleString()}
                    {hasOutlier && <span className="text-xs font-normal ml-1" style={{ color: '#6B5B8A' }}>(includes outliers)</span>}
                  </p>
                </div>
                <div>
                  <p style={{ color: '#6B5B8A' }}>Average offer per parcel</p>
                  <p className="font-semibold" style={{ color: '#1A0A2E' }}>${Math.round(avgOffer).toLocaleString()}</p>
                </div>
                <div>
                  <p style={{ color: '#6B5B8A' }}>ZIP breakdown</p>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {Array.from(zipBreakdown.entries()).sort((a, b) => b[1] - a[1]).map(([zip, n], i) => (
                      <span key={zip} className="badge text-[10px]" style={{ background: `${ZIP_COLORS[i % ZIP_COLORS.length]}20`, color: ZIP_COLORS[i % ZIP_COLORS.length], border: `1px solid ${ZIP_COLORS[i % ZIP_COLORS.length]}55` }}>
                        {zip}: {n}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <p style={{ color: '#6B5B8A' }}>Offer price range</p>
                  <p className="font-semibold" style={{ color: '#1A0A2E' }}>
                    ${Math.round(offerMin).toLocaleString()} – ${Math.round(offerMax95).toLocaleString()}
                  </p>
                  {hasOutlier && (
                    <p className="text-xs mt-0.5" style={{ color: '#6B5B8A' }}>
                      95th pct cap · actual max ${Math.round(offerMax).toLocaleString()}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Dedup stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <DedupeCard label="Before Dedup" value={mailingPreview.total_before_dedup.toLocaleString()} accent="#6B5B8A" />
              <DedupeCard label="After Dedup"value={mailingPreview.total_after_dedup.toLocaleString()} accent="#2D7A4F" highlight />
              <DedupeCard label="Foreign Removed" value={mailingPreview.filtered_foreign.toLocaleString()} accent="#D5A940" />
              <DedupeCard
                label="Total Removed"
                value={(mailingPreview.total_before_dedup - mailingPreview.total_after_dedup).toLocaleString()}
                accent="#6B5B8A"
              />
            </div>

            {/* Export buttons row */}
            <div className="card mb-6">
              <h2 className="text-sm font-semibold mb-4" style={{ color: '#1A0A2E' }}>Export Options</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <ExportOption
                  title="Full List"
                  subtitle={`All ${afterDedup.toLocaleString()} deduplicated records`}
                  badge="ALL"
                  badgeColor="#D5A940"
                  href={fullUrl}
                />
                <ExportOption
                  title="High Confidence Only"
                  subtitle={`${highConfCount.toLocaleString()} records with 3+ comp matches`}
                  badge="3+ COMPS"
                  badgeColor="#2D7A4F"
                  href={highConfUrl}
                />
                <ExportOption
                  title="Top 500 Records"
                  subtitle="Best-scored parcels, ideal for first mailer"
                  badge="TOP 500"
                  badgeColor="#D5A940"
                  href={top500Url}
                />
              </div>
              {flaggedRows.length > 0 && (
                <div className="mt-4 pt-4" style={{ borderTop: '1px solid #E8E0F0' }}>
                  <button className="btn-secondary text-sm" onClick={() => downloadRows(flaggedRows, `flagged-${flaggedRows.length}`)}>
                    Download Flagged ({flaggedRows.length})
                  </button>
                </div>
              )}
            </div>

            {/* Table */}
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold" style={{ color: '#1A0A2E' }}>
                  Ready to Mail{' '}
                  <span className="text-sm font-normal" style={{ color: '#6B5B8A' }}>
                    ({mailingPreview.total_after_dedup.toLocaleString()} records)
                  </span>
                </h2>
              </div>
              <DataTable<MatchedParcel>
                columns={cols}
                data={workingRows}
                pageSize={50}
                emptyMessage="No records in mailing list"
                searchable
                searchKeys={['owner_name', 'mail_address', 'mail_city', 'parcel_zip', 'apn']}
              />
            </div>

            {selectedCount > 0 && (
              <div className="fixed bottom-5 right-5 z-20">
                <button className="btn-danger" onClick={removeSelected}>
                  Remove Selected ({selectedCount})
                </button>
              </div>
            )}

            {/* Save as campaign */}
            <div className="mt-6 card">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-semibold" style={{ color: '#1A0A2E' }}>Save as Campaign</h2>
                  <p className="text-xs mt-0.5" style={{ color: '#6B5B8A' }}>
                    Store this run with a name so you can re-download it anytime
                  </p>
                </div>
                {!showSavePanel && (
                  <button
                    className="btn-primary text-sm"
                    onClick={() => setShowSavePanel(true)}
                  >
                    Save Campaign →
                  </button>
                )}
              </div>

              {showSavePanel && (
                <div className="mt-4 pt-4" style={{ borderTop: '1px solid #E8E0F0' }}>
                  <div className="flex gap-3">
                    <input
                      type="text"
                      className="input-base flex-1"
                      placeholder="e.g. Brunswick Final March 2026"
                      value={campaignName}
                      onChange={(e) => setCampaignName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSaveCampaign()}
                      disabled={saving}
                      maxLength={80}
                      autoFocus
                    />
                    <button
                      className="btn-primary flex-none"
                      onClick={handleSaveCampaign}
                      disabled={saving || !campaignName.trim()}
                    >
                      {saving ? <><LoadingSpinner size="sm" /> Saving…</> : 'Save'}
                    </button>
                    <button
                      className="btn-secondary flex-none"
                      onClick={() => { setShowSavePanel(false); setSaveError(null) }}
                    >
                      Cancel
                    </button>
                  </div>
                  {saveError && <p className="text-sm mt-2" style={{ color: '#dc2626' }}>{saveError}</p>}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function rowId(r: MatchedParcel, idx: number): string {
  return `${r.apn || 'apn'}|${r.mail_address || ''}|${idx}`
}

function downloadRows(rows: MatchedParcel[], suffix: string) {
  const headers = ['Owner Name', 'Mail Address', 'Mail City', 'Mail State', 'Mail Zip', 'APN', 'Parcel Zip', 'Lot Acres', 'Match Score', 'Offer Mid']
  const body = rows.map((r) => [
    r.owner_name,
    r.mail_address,
    r.mail_city,
    r.mail_state,
    r.mail_zip,
    r.apn,
    r.parcel_zip,
    r.lot_acres ?? '',
    r.match_score,
    r.suggested_offer_mid ?? '',
  ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
  const csv = [headers.join(','), ...body].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `mailing-${suffix}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function DedupeCard({ label, value, accent, highlight = false }: {
  label: string; value: string; accent: string; highlight?: boolean
}) {
  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: highlight ? `${accent}14` : '#F8F6FB',
        border: `1px solid ${highlight ? `${accent}40` : '#E8E0F0'}`,
      }}
    >
      <p className="text-xs uppercase tracking-wider mb-1" style={{ color: '#6B5B8A' }}>{label}</p>
      <p className="text-2xl font-bold" style={{ color: highlight ? accent : '#1A0A2E' }}>{value}</p>
    </div>
  )
}

function ExportOption({ title, subtitle, badge, badgeColor, href }: {
  title: string; subtitle: string; badge: string; badgeColor: string; href: string
}) {
  return (
    <a
      href={href}
      download
      className="no-underline block rounded-xl p-4 transition-all"
      style={{ background: '#FFFFFF', border: '1.5px solid #E8E0F0' }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = badgeColor)}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#E8E0F0')}
    >
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-semibold" style={{ color: '#1A0A2E' }}>{title}</p>
        <span
          className="text-[10px] font-bold px-2 py-0.5 rounded-full"
          style={{ background: `${badgeColor}20`, color: badgeColor, border: `1px solid ${badgeColor}40` }}
        >
          {badge}
        </span>
      </div>
      <p className="text-xs" style={{ color: '#6B5B8A' }}>{subtitle}</p>
      <div className="mt-3 flex items-center gap-1 text-xs font-medium" style={{ color: badgeColor }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        Download CSV
      </div>
    </a>
  )
}

function ScoreBadge({ score }: { score: number }) {
  return (
    <span
      className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold text-white score-badge-${score}`}
      style={{ background: score === 4 ? '#5C2977' : score === 3 ? '#D5A940' : score === 2 ? '#C06820' : score === 1 ? '#B03030' : '#2D7A4F' }}
    >
      {score}
    </span>
  )
}
