import React, { useState, useEffect } from 'react'
import FileUpload from '../components/FileUpload'
import DataTable from '../components/DataTable'
import LoadingSpinner from '../components/LoadingSpinner'
import LoadingOverlay from '../components/LoadingOverlay'
import { useApp } from '../context/AppContext'
import { uploadTargets, runMatch, getMailingDownloadUrl, getMatchedLeadsDownloadUrl, getDbCompsCount } from '../api/client'
import { listCrmCampaigns, autoCreateCampaign, addMatchResultsToCampaign, getMatchFilters, saveMatchFilters } from '../api/crm'
import type { Column } from '../components/DataTable'
import type { MatchedParcel, MatchFilters } from '../types'
import { getConfidence } from '../types'
import MatchMap from '../components/MatchMap'
import WelcomeScreen from './WelcomeScreen'

const SQFT_PER_ACRE = 43560

function fmtPrice(v: number | null | undefined): string {
  if (v == null || isNaN(v as number)) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v as number)
}

export default function MatchTargets() {
  const {
    compsStats,
    compsRestoring,
    targetStats, setTargetStats,
    targetRestoring,
    matchResult, setMatchResult,
    setCurrentPage, setLastFilters,
    dashboardData,
    lastFilters,
    mailingPreview, setMailingPreview,
  } = useApp()

  const [uploadLoading, setUploadLoading] = useState(false)
  const [matchLoading, setMatchLoading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [matchError, setMatchError] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [resultView, setResultView] = useState<'table' | 'map'>('table')
  const [dbCompsCount, setDbCompsCount] = useState<number | null>(null)

  useEffect(() => {
    getDbCompsCount().then(setDbCompsCount).catch(() => {})
    // Load persisted filter settings from DB
    getMatchFilters().then(saved => {
      if (saved.flood_zone_filter) setFloodZoneFilter(saved.flood_zone_filter as 'all' | 'exclude' | 'only')
      if (saved.min_offer_floor != null) setMinOfferFloor(String(saved.min_offer_floor))
      if (saved.min_lp_estimate != null) setMinLpEstimate(String(saved.min_lp_estimate))
    }).catch(() => {})
  }, [])

  // ── Filter state ────────────────────────────────────────────────────────
  const init = lastFilters

  const [minScore] = useState<number>(Number(init?.min_match_score ?? 0))
  const [zipFilter, setZipFilter] = useState<string[]>((init?.zip_filter as string[]) ?? [])
  const [zipInputText, setZipInputText] = useState<string>(((init?.zip_filter as string[]) ?? []).join(', '))
  const [minAcreage, setMinAcreage] = useState<string>('')
  const [maxAcreage, setMaxAcreage] = useState<string>('')
  const acreagePrefilled = React.useRef(false)
  const [floodZoneFilter, setFloodZoneFilter] = useState<'all' | 'exclude' | 'only'>((init?.flood_zone_filter as 'all' | 'exclude' | 'only') ?? 'exclude')
  const [minOfferFloor, setMinOfferFloor] = useState<string>('10000')
  const [minLpEstimate, setMinLpEstimate] = useState<string>('20000')
  const [assignmentFee, setAssignmentFee] = useState<string>('5000')

  // Add to Mailing List modal
  const [showMailingModal, setShowMailingModal] = useState(false)
  const [mailingCampaigns, setMailingCampaigns] = useState<{ id: string; name: string }[]>([])
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>('')
  const [mailingLoading, setMailingLoading] = useState(false)
  const [mailingSuccess, setMailingSuccess] = useState<string | null>(null)
  const [mailingError, setMailingError] = useState<string | null>(null)
  const [mailingExportType, setMailingExportType] = useState<'mailable' | 'matched'>('matched')
  const [mailingDone, setMailingDone] = useState(false)
  const [showUnmatched, setShowUnmatched] = useState(false)

  // Pre-fill acreage from sweet spot — runs once when dashboardData first loads, never overrides user edits
  useEffect(() => {
    if (acreagePrefilled.current || lastFilters || !dashboardData) return
    acreagePrefilled.current = true
    const b = dashboardData.sweet_spot?.bucket
    if (b === '0-0.5') { setMinAcreage('0.1'); setMaxAcreage('2') }
    else if (b === '0.5-1') { setMinAcreage('0.1'); setMaxAcreage('2') }
    else if (b === '1-2') { setMinAcreage('0.5'); setMaxAcreage('3') }
    else if (b === '2-5') { setMinAcreage('1'); setMaxAcreage('6') }
    else if (b === '5-10') { setMinAcreage('3'); setMaxAcreage('12') }
    else if (b === '10+') { setMinAcreage('8'); setMaxAcreage('50') }
    else { setMinAcreage('0.1'); setMaxAcreage('2') }
  }, [dashboardData])

  // Top 20 ZIPs from dashboard for "Use Buy Box ZIPs" — exclude outliers (ppa > 3x market median) and <5 sales
  const top10Zips = React.useMemo(() => {
    const stats = dashboardData?.zip_stats ?? []
    const ppas = stats
      .map(z => z.median_price_per_acre)
      .filter((v): v is number => v != null && Number.isFinite(v) && v > 0)
    const ppaSorted = [...ppas].sort((a, b) => a - b)
    const mid = Math.floor(ppaSorted.length / 2)
    const mktMedian = ppaSorted.length === 0 ? 0
      : ppaSorted.length % 2 === 0 ? (ppaSorted[mid - 1] + ppaSorted[mid]) / 2
      : ppaSorted[mid]
    const outlierCodes = new Set(
      mktMedian > 0
        ? stats.filter(z => (z.median_price_per_acre ?? 0) > 3 * mktMedian).map(z => z.zip_code)
        : []
    )
    return stats
      .filter(z => !outlierCodes.has(z.zip_code) && z.sales_count >= 5)
      .sort((a, b) => b.sales_count - a.sales_count)
      .slice(0, 20)
      .map(z => z.zip_code)
  }, [dashboardData?.zip_stats])

  function handleZipInput(text: string) {
    setZipInputText(text)
    const parsed = text.split(/[\s,]+/).map(z => z.trim()).filter(z => /^\d{5}$/.test(z))
    setZipFilter(parsed)
  }

  function useBuyBoxZips() {
    setZipFilter(top10Zips)
    setZipInputText(top10Zips.join(', '))
  }

  function clearZips() {
    setZipFilter([])
    setZipInputText('')
  }

  async function handleFile(file: File) {
    setFileName(file.name)
    setUploadLoading(true)
    setUploadError(null)
    try {
      const stats = await uploadTargets(file)
      setTargetStats(stats)
      setMatchResult(null)
      setMailingPreview(null)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Upload failed.'
      setUploadError(msg)
    } finally {
      setUploadLoading(false)
    }
  }

  async function handleMatch() {
    if (!compsStats || !targetStats) return
    setMatchLoading(true)
    setMatchError(null)

    const filters: MatchFilters = {
      session_id: compsStats.session_id,
      target_session_id: targetStats.session_id,
      radius_miles: 1,
      acreage_tolerance_pct: 50,
      min_match_score: minScore,
      zip_filter: zipFilter,
      flood_zone_filter: floodZoneFilter,
      min_acreage: minAcreage ? parseFloat(minAcreage) : null,
      max_acreage: maxAcreage ? parseFloat(maxAcreage) : null,
      exclude_flood: floodZoneFilter === 'exclude',
      only_flood: floodZoneFilter === 'only',
      exclude_with_buildings: true,
      max_retail_price: 200000,
      min_offer_floor: minOfferFloor ? parseFloat(minOfferFloor) : 10000,
      min_lp_estimate: minLpEstimate ? parseFloat(minLpEstimate) : 20000,
    }

    // Persist filter settings
    saveMatchFilters({
      flood_zone_filter: floodZoneFilter,
      min_offer_floor: minOfferFloor ? parseFloat(minOfferFloor) : 10000,
      min_lp_estimate: minLpEstimate ? parseFloat(minLpEstimate) : 20000,
    }).catch(() => {})

    try {
      const result = await runMatch(filters)
      setMatchResult(result)
      setMailingPreview(null)
      setLastFilters(filters)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Matching failed.'
      setMatchError(msg)
    } finally {
      setMatchLoading(false)
    }
  }

  // Active filters summary line
  const filterParts: string[] = []
  if (zipFilter.length > 0) {
    const zips = zipFilter.slice(0, 2).join(', ')
    const extra = zipFilter.length > 2 ? ` (+${zipFilter.length - 2} more)` : ''
    filterParts.push(`ZIPs ${zips}${extra}`)
  }
  if (minAcreage || maxAcreage) filterParts.push(`${minAcreage || '0'}–${maxAcreage || '∞'} acres`)
  if (floodZoneFilter === 'exclude') filterParts.push('No flood zone')
  if (floodZoneFilter === 'only') filterParts.push('Flood zones only')
  if (minOfferFloor) filterParts.push(`Offer floor $${Number(minOfferFloor).toLocaleString()}`)
  if (minLpEstimate) filterParts.push(`Min retail $${Number(minLpEstimate).toLocaleString()}`)
  const filterSummary = filterParts.length > 0
    ? `Active filters: ${filterParts.join(' · ')}`
    : 'No filters active — matching all targets'

  if (!compsStats) {
    if (compsRestoring) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen gap-4">
          <LoadingSpinner size="lg" />
          <p className="text-sm" style={{ color: '#9CA3AF' }}>Loading comps from database…</p>
        </div>
      )
    }
    return <WelcomeScreen contextualMessage="Upload your comps first to enable matching." />
  }

  const cols: Column<MatchedParcel>[] = [
    { key: 'match_score', header: 'Score', sortable: true, align: 'center', render: (v) => <ScoreBadge score={v as number} /> },
    {
      key: 'confidence', header: 'Conf.', align: 'center', sortable: true,
      render: (_, row) => { const c = row.confidence || getConfidence(row.matched_comp_count); return <span className={`conf-${c}`}>{c}</span> },
    },
    { key: 'apn', header: 'APN', sortable: true, render: (v) => <span className="font-mono text-xs">{String(v || '—')}</span> },
    { key: 'owner_name', header: 'Owner', render: (v) => <span className="max-w-[160px] block truncate text-xs" title={String(v)}>{String(v || '—')}</span> },
    { key: 'owner_first_name', header: 'Owner First Name', defaultHidden: true, render: (v) => <span className="text-xs">{String(v || '—')}</span> },
    { key: 'owner_last_name', header: 'Owner Last Name', defaultHidden: true, render: (v) => <span className="text-xs">{String(v || '—')}</span> },
    { key: 'parcel_zip', header: 'ZIP', sortable: true },
    { key: 'parcel_city', header: 'City', defaultHidden: true },
    { key: 'parcel_address', header: 'Parcel Address', defaultHidden: true, render: (v) => <span className="max-w-[220px] block truncate text-xs" title={String(v || '')}>{String(v || '—')}</span> },
    { key: 'parcel_state', header: 'Parcel State', defaultHidden: true, render: (v) => <span className="text-xs">{String(v || '—')}</span> },
    { key: 'parcel_county', header: 'Parcel County', defaultHidden: true, render: (v) => <span className="text-xs">{String(v || '—')}</span> },
    { key: 'latitude', header: 'Latitude', defaultHidden: true, align: 'right', render: (v) => (v == null ? <span style={{ color: '#6B7280' }}>—</span> : <span className="text-xs">{(v as number).toFixed(5)}</span>) },
    { key: 'longitude', header: 'Longitude', defaultHidden: true, align: 'right', render: (v) => (v == null ? <span style={{ color: '#6B7280' }}>—</span> : <span className="text-xs">{(v as number).toFixed(5)}</span>) },
    { key: 'lot_acres', header: 'Acres', sortable: true, align: 'right', render: (v) => v == null ? <span style={{ color: '#6B7280' }}>—</span> : <span>{(v as number).toFixed(2)}</span> },
    { key: 'acreage_band', header: 'Band', sortable: true, align: 'center', render: (v) => <span className="text-xs" style={{ color: '#6B7280' }}>{String(v || '—')}</span> },
    { key: 'matched_comp_count', header: 'Comps', sortable: true, align: 'center', render: (v) => <span className="text-xs">{String(v ?? '—')}</span> },
    {
      key: 'no_match_reason', header: 'No Match Reason', defaultHidden: false,
      render: (v, row) => {
        if (!v) return <span style={{ color: '#6B7280' }}>—</span>
        const flag = row.pricing_flag
        const color = flag === 'LP_FALLBACK' ? '#C084FC' : '#6B7280'
        return <span className="text-xs" style={{ color }}>{String(v)}</span>
      },
    },
    { key: 'comp_count', header: 'Comp Count', sortable: true, align: 'center', defaultHidden: true, render: (v) => <span className="text-xs">{String(v ?? '—')}</span> },
    { key: 'closest_comp_distance', header: 'Distance to Closest Comp', sortable: true, align: 'right', defaultHidden: true, render: (v) => (v == null ? <span style={{ color: '#6B7280' }}>—</span> : <span className="text-xs">{(v as number).toFixed(2)}</span>) },
    { key: 'retail_estimate', header: 'Retail Est.', sortable: true, align: 'right', defaultHidden: true, render: (v) => <span className="text-xs" style={{ color: '#374151' }}>{fmtPrice(v as number)}</span> },
    { key: 'suggested_offer_low', header: 'Offer Low', align: 'right', render: (v) => <span className="text-xs" style={{ color: '#9CA3AF' }}>{fmtPrice(v as number)}</span> },
    { key: 'suggested_offer_mid', header: 'Offer Mid', sortable: true, align: 'right', render: (v) => <span className="font-semibold" style={{ color: '#10B981' }}>{fmtPrice(v as number)}</span> },
    { key: 'suggested_offer_high', header: 'Offer High', align: 'right', render: (v) => <span className="text-xs" style={{ color: '#9CA3AF' }}>{fmtPrice(v as number)}</span> },
    { key: 'median_comp_sale_price', header: 'Med. Comp $', align: 'right', defaultHidden: true, render: (v) => <span className="text-xs">{fmtPrice(v as number)}</span> },
    { key: 'median_ppa', header: 'Med. PPA', align: 'right', defaultHidden: true, render: (v) => <span className="text-xs">{fmtPrice(v as number)}</span> },
    { key: 'min_comp_price', header: 'Min Comp $', align: 'right', defaultHidden: true, render: (v) => <span className="text-xs">{fmtPrice(v as number)}</span> },
    { key: 'max_comp_price', header: 'Max Comp $', align: 'right', defaultHidden: true, render: (v) => <span className="text-xs">{fmtPrice(v as number)}</span> },
    { key: 'outliers_removed', header: 'Outliers', align: 'center', defaultHidden: true, render: (v) => <span className="text-xs">{String(v ?? 0)}</span> },
    { key: 'tlp_estimate', header: 'TLP Est.', align: 'right', defaultHidden: true, render: (v) => <span className="text-xs" style={{ color: '#9CA3AF' }}>{fmtPrice(v as number)}</span> },
    { key: 'tlp_capped', header: 'TLP Cap', align: 'center', defaultHidden: true, render: (v) => <span className="text-xs">{v ? 'Yes' : 'No'}</span> },
    { key: 'flood_zone', header: 'Flood', defaultHidden: true, render: (v) => <span className="text-xs" style={{ color: '#6B5B8A' }}>{String(v || '—')}</span> },
    {
      key: 'buildability_pct', header: 'Build%', sortable: true, align: 'right', defaultHidden: true,
      render: (v) => v == null ? <span style={{ color: '#6B7280' }}>—</span> : (
        <span style={{ color: (v as number) > 70 ? '#059669' : (v as number) > 40 ? '#D97706' : '#DC2626', fontSize: '12px' }}>
          {(v as number).toFixed(0)}%
        </span>
      ),
    },
  ]

  return (
    <div className="flex flex-col min-h-screen">
      <LoadingOverlay visible={matchLoading} title="Running matching engine…" />

      <div className="page-header">
        <div className="flex items-center gap-3">
          <button className="btn-secondary text-sm" onClick={() => setCurrentPage('dashboard')}>
            ← Market Analysis
          </button>
          <div>
            <h1 className="text-lg font-semibold" style={{ color: '#111827' }}>Match Targets</h1>
            <p className="text-xs mt-0.5" style={{ color: '#9CA3AF' }}>Upload target parcels and run the matching engine with smart filters</p>
          </div>
        </div>
      </div>

      <div className="p-8 max-w-[1400px] mx-auto w-full">

        {/* ── Comps info banner ────────────────────────────────── */}
        <div className="rounded-xl px-4 py-3 mb-5 flex items-center justify-between" style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)' }}>
          <div className="flex items-center gap-3">
            <span style={{ color: '#10B981', fontWeight: 700, fontSize: 16 }}>✓</span>
            <div>
              <p className="text-sm font-medium" style={{ color: '#10B981' }}>
                Using {(dbCompsCount ?? compsStats.valid_rows).toLocaleString()} sold comps from database
              </p>
              <button
                className="text-xs mt-0.5"
                style={{ color: '#4F46E5', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
                onClick={() => setCurrentPage('upload-comps')}
              >
                + Add more comps
              </button>
            </div>
          </div>
        </div>

        {/* ── Target upload ─────────────────────────────────────── */}
        <div className="card mb-6">
          <h2 className="font-semibold mb-4" style={{ color: '#111827' }}>Target Parcels CSV</h2>
          {targetRestoring ? (
            <div className="rounded-lg px-4 py-3 flex items-center gap-3" style={{ background: 'rgba(79,70,229,0.04)', border: '1px solid rgba(79,70,229,0.12)' }}>
              <div style={{ width: 14, height: 14, border: '2px solid #C7D2FE', borderTopColor: '#4F46E5', borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
              <p className="text-sm" style={{ color: '#6B7280' }}>Restoring target file…</p>
            </div>
          ) : targetStats ? (
            <div className="rounded-lg px-4 py-3 flex items-center justify-between" style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.15)' }}>
              <div>
                <p className="font-medium text-sm" style={{ color: '#10B981' }}>
                  ✓ {targetStats.total_rows.toLocaleString()} rows loaded
                </p>
                <p className="text-xs mt-0.5" style={{ color: '#9CA3AF' }}>
                  {targetStats.columns_found.length} columns · {fileName ?? targetStats.filename ?? 'targets.csv'}
                </p>
              </div>
              <button className="text-xs" style={{ color: '#9CA3AF' }} onClick={() => { setTargetStats(null); setFileName(null) }}>
                Replace
              </button>
            </div>
          ) : (
            <FileUpload label="Drop Target Parcels CSV" hint="Land Portal export — same format as comps" onFile={handleFile} loading={uploadLoading} />
          )}
          {uploadError && <p className="text-red-400 text-sm mt-2">{uploadError}</p>}
        </div>

        {/* ── Filters ─────────────────────────────────────────── */}
        <div className="card mb-6">
          <h2 className="font-semibold mb-5" style={{ color: '#111827' }}>Filters</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

            {/* 1. Acreage Range */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: '#6B7280' }}>Acreage Range</p>
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <input
                    type="number" step="0.1" placeholder="Min acres"
                    className="input-base text-xs py-2 w-full"
                    value={minAcreage}
                    onChange={e => setMinAcreage(e.target.value)}
                  />
                  <p className="text-[10px] mt-1" style={{ color: '#6B7280' }}>
                    {minAcreage && Number(minAcreage) > 0
                      ? `${Number(minAcreage).toLocaleString(undefined, { maximumFractionDigits: 2 })} acres (${Math.round(Number(minAcreage) * SQFT_PER_ACRE).toLocaleString()} sq ft)`
                      : 'no min'}
                  </p>
                </div>
                <span className="text-sm mt-2" style={{ color: '#9CA3AF' }}>to</span>
                <div className="flex-1">
                  <input
                    type="number" step="0.1" placeholder="Max acres"
                    className="input-base text-xs py-2 w-full"
                    value={maxAcreage}
                    onChange={e => setMaxAcreage(e.target.value)}
                  />
                  <p className="text-[10px] mt-1" style={{ color: '#6B7280' }}>
                    {maxAcreage && Number(maxAcreage) > 0
                      ? `${Number(maxAcreage).toLocaleString(undefined, { maximumFractionDigits: 2 })} acres (${Math.round(Number(maxAcreage) * SQFT_PER_ACRE).toLocaleString()} sq ft)`
                      : 'no max'}
                  </p>
                </div>
              </div>
            </div>

            {/* 2. Flood Zone */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: '#6B7280' }}>Flood Zone</p>
              <div className="inline-flex rounded-lg overflow-hidden" style={{ border: '1px solid #E5E7EB' }}>
                <button className="px-4 py-2 text-xs transition-all" style={floodZoneFilter === 'exclude' ? { background: '#4F46E5', color: '#FFFFFF' } : { background: '#FFFFFF', color: '#6B7280' }} onClick={() => setFloodZoneFilter('exclude')}>Exclude</button>
                <button className="px-4 py-2 text-xs transition-all" style={floodZoneFilter === 'all' ? { background: '#4F46E5', color: '#FFFFFF' } : { background: '#FFFFFF', color: '#6B7280' }} onClick={() => setFloodZoneFilter('all')}>Include All</button>
                <button className="px-4 py-2 text-xs transition-all" style={floodZoneFilter === 'only' ? { background: '#4F46E5', color: '#FFFFFF' } : { background: '#FFFFFF', color: '#6B7280' }} onClick={() => setFloodZoneFilter('only')}>Only Flood</button>
              </div>
              <p className="text-[10px] mt-1.5" style={{ color: '#6B7280' }}>Exclude = no FEMA flood zones (recommended)</p>
            </div>

            {/* 3. Minimum Offer Floor */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: '#6B7280' }}>Minimum Offer Floor</p>
              <input type="number" step="1000" min="0" placeholder="10000"
                className="input-base text-xs py-2 w-full"
                value={minOfferFloor}
                onChange={e => setMinOfferFloor(e.target.value)} />
              <p className="text-[10px] mt-1" style={{ color: '#6B7280' }}>Below this → flagged LOW_OFFER (kept in results)</p>
            </div>

            {/* 4. Minimum Retail Value */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: '#6B7280' }}>Minimum Retail Value</p>
              <input type="number" step="1000" min="0" placeholder="20000"
                className="input-base text-xs py-2 w-full"
                value={minLpEstimate}
                onChange={e => setMinLpEstimate(e.target.value)} />
              <p className="text-[10px] mt-1" style={{ color: '#6B7280' }}>Below this → flagged LOW_VALUE (kept in results)</p>
            </div>

          </div>

          {/* 5. ZIP Filter */}
          <div className="mt-5 pt-5" style={{ borderTop: '1px solid #E5E7EB' }}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#6B7280' }}>ZIP Filter</p>
              <div className="flex gap-2">
                {top10Zips.length > 0 && (
                  <button className="text-xs px-3 py-1 rounded-lg border transition-colors"
                    style={{ borderColor: '#E5E7EB', color: '#4F46E5', background: 'transparent' }}
                    onClick={useBuyBoxZips}>
                    Use Buy Box ZIPs
                  </button>
                )}
                {zipFilter.length > 0 && (
                  <button className="text-xs" style={{ color: '#6B7280' }} onClick={clearZips}>Clear</button>
                )}
              </div>
            </div>
            <input
              type="text"
              className="input-base text-sm w-full"
              placeholder="e.g. 37876, 37862, 37801 (leave empty to match all ZIPs)"
              value={zipInputText}
              onChange={e => handleZipInput(e.target.value)}
            />
            {zipFilter.length > 0 && (
              <p className="text-xs mt-1.5" style={{ color: '#9CA3AF' }}>
                {zipFilter.length} ZIP{zipFilter.length !== 1 ? 's' : ''} selected: {zipFilter.join(', ')}
              </p>
            )}
          </div>
        </div>

        {/* ── Active Filters Summary ──────────────────────────── */}
        <div className="mb-5 px-4 py-3 rounded-xl text-xs" style={{ background: 'rgba(79,70,229,0.04)', border: '1px solid rgba(79,70,229,0.12)', color: '#4F46E5' }}>
          {filterSummary}
        </div>

        {/* ── Run button ──────────────────────────────────────── */}
        <div className="mb-6">
          <button
            disabled={!targetStats || matchLoading}
            onClick={handleMatch}
            style={{
              width: '100%', padding: '18px 32px', fontSize: 18, fontWeight: 700, letterSpacing: '0.5px',
              borderRadius: 8, border: 'none', cursor: !targetStats || matchLoading ? 'not-allowed' : 'pointer',
              opacity: !targetStats || matchLoading ? 0.5 : 1,
              background: '#4F46E5',
              color: '#FFFFFF', boxShadow: '0 1px 3px rgba(79,70,229,0.15)', transition: 'all 0.3s ease',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            }}
            onMouseEnter={e => { if (!matchLoading && targetStats) { (e.currentTarget as HTMLButtonElement).style.background = '#4338CA'; (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-2px)' } }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = '#4F46E5'; (e.currentTarget as HTMLButtonElement).style.transform = 'none' }}
          >
            {matchLoading ? (
              <><LoadingSpinner size="sm" />Running…</>
            ) : matchResult ? (
              <>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                Re-run with new filters
              </>
            ) : (
              <>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                Run Matching Engine
              </>
            )}
          </button>
          {targetStats && !matchLoading && (
            <p className="text-sm mt-2 text-center" style={{ color: '#9CA3AF' }}>
              {targetStats.total_rows.toLocaleString()} targets × {(dbCompsCount ?? compsStats.valid_rows).toLocaleString()} comps
            </p>
          )}
        </div>

        {matchError && (
          <div className="rounded-xl px-5 py-4 mb-6 text-sm" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#EF4444' }}>
            {matchError}
          </div>
        )}

        {matchResult && (
          <>
            {/* Smart floor recommendation */}
            {matchResult.smart_floor_recommendation != null && (
              <div className="mb-5 px-4 py-3 rounded-xl flex items-center justify-between" style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)' }}>
                <div>
                  <p className="text-sm font-medium" style={{ color: '#10B981' }}>
                    Recommended minimum: <strong>{fmtPrice(matchResult.smart_floor_recommendation)}</strong> based on comp data
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: '#9CA3AF' }}>
                    Hard floor is currently <strong>${Number(minOfferFloor || 10000).toLocaleString()}</strong> — click "Use this floor" to apply the recommendation
                  </p>
                </div>
                <button
                  className="btn-secondary text-xs"
                  style={{ padding: '6px 12px', flexShrink: 0 }}
                  onClick={() => setMinOfferFloor(String(Math.round(matchResult.smart_floor_recommendation!)))}
                >
                  Use this floor
                </button>
              </div>
            )}

            {/* Download exports + match summary */}
            {(() => {
              const matchId = matchResult.match_id
              const distMatchedCt = matchResult.distance_matched_count ?? matchResult.matched_count
              const zipMatchedCt = matchResult.zip_matched_count ?? 0
              const lpFallbackCt = matchResult.lp_fallback_count ?? 0
              const unpricedCt = matchResult.unpriced_count ?? 0
              const mrw = (matchResult as any).match_rate_warning as { level: string; match_rate_pct: number; message: string; top_unmatched_zips: string[] } | undefined
              const rateColor = !mrw ? '#10B981' : mrw.level === 'ok' ? '#10B981' : mrw.level === 'warning' ? '#F59E0B' : '#EF4444'
              const rateBg = !mrw ? 'rgba(16,185,129,0.08)' : mrw.level === 'ok' ? 'rgba(16,185,129,0.08)' : mrw.level === 'warning' ? 'rgba(245,158,11,0.1)' : 'rgba(239,68,68,0.1)'
              const rateBorder = !mrw ? 'rgba(16,185,129,0.3)' : mrw.level === 'ok' ? 'rgba(16,185,129,0.3)' : mrw.level === 'warning' ? 'rgba(245,158,11,0.3)' : 'rgba(239,68,68,0.3)'
              return (
                <div className="card mb-6">
                  <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
                    <div>
                      <div className="flex items-baseline gap-2 mb-0.5">
                        <span className="text-3xl font-bold" style={{ color: '#10B981' }}>{distMatchedCt.toLocaleString()}</span>
                        <span className="text-sm font-semibold" style={{ color: '#10B981' }}>Distance-matched records (strong comps within 3 miles)</span>
                      </div>
                      <p className="text-[11px]" style={{ color: '#6B7280' }}>{matchResult.total_targets.toLocaleString()} total targets</p>
                    </div>
                    <button className="btn-primary text-sm" style={{ padding: '8px 16px' }} onClick={() => setShowMailingModal(true)}>
                      + Add to Mailing List
                    </button>
                  </div>

                  {/* Match rate banner (distance-matched only) */}
                  {mrw && (
                    <div className="rounded-xl px-4 py-3 mb-3 flex items-start gap-3" style={{ background: rateBg, border: `1px solid ${rateBorder}` }}>
                      <div className="flex-1">
                        <p className="text-sm font-bold" style={{ color: rateColor }}>{mrw.message}</p>
                        {mrw.level !== 'ok' && mrw.top_unmatched_zips.length > 0 && (
                          <p className="text-xs mt-0.5" style={{ color: rateColor, opacity: 0.8 }}>
                            Top unmatched ZIPs: {mrw.top_unmatched_zips.join(', ')}
                          </p>
                        )}
                        {mrw.level !== 'ok' && (
                          <p className="text-[11px] mt-1" style={{ color: '#9CA3AF' }}>
                            Match rate counts only records with LP comps within 3 miles. ZIP-matched and LP Fallback are excluded from this rate.
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Three-category breakdown */}
                  <div className="flex flex-col gap-2 mb-4">
                    <div className="rounded-lg px-3 py-2 flex items-center justify-between" style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.15)' }}>
                      <div>
                        <span className="text-sm font-semibold" style={{ color: '#059669' }}>Distance-matched: {distMatchedCt.toLocaleString()} records</span>
                        <span className="text-xs ml-2" style={{ color: '#9CA3AF' }}>strong comps within 3 miles — recommended for mailing</span>
                      </div>
                      <a href={getMatchedLeadsDownloadUrl(matchId, 'comp-matched')} download className="btn-primary text-xs no-underline" style={{ padding: '4px 10px', flexShrink: 0 }}>
                        Download
                      </a>
                    </div>
                    {zipMatchedCt > 0 && (
                      <div className="rounded-lg px-3 py-2 flex items-center justify-between" style={{ background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.15)' }}>
                        <div>
                          <span className="text-sm font-semibold" style={{ color: '#2563EB' }}>ZIP-matched: {zipMatchedCt.toLocaleString()} records</span>
                          <span className="text-xs ml-2" style={{ color: '#9CA3AF' }}>matched by ZIP code — less precise, use as bonus</span>
                        </div>
                        <a href={getMailingDownloadUrl(matchId, 'full-list', 'full')} download className="btn-secondary text-xs no-underline" style={{ padding: '4px 10px', flexShrink: 0 }}>
                          Download
                        </a>
                      </div>
                    )}
                    {lpFallbackCt > 0 && (
                      <div className="rounded-lg px-3 py-2" style={{ background: 'rgba(92,41,119,0.08)', border: '1px solid rgba(92,41,119,0.2)' }}>
                        <span className="text-sm font-semibold" style={{ color: '#7C3AED' }}>LP Fallback: {lpFallbackCt.toLocaleString()} records</span>
                        <span className="text-xs ml-2" style={{ color: '#9CA3AF' }}>no local comps — priced from LP estimate only</span>
                      </div>
                    )}
                    {unpricedCt > 0 && (
                      <p className="text-[11px]" style={{ color: '#6B7280' }}>
                        {unpricedCt.toLocaleString()} records have no data (no comps and no LP estimate) — skip these
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <a href={getMailingDownloadUrl(matchId, 'high-confidence', 'high-confidence')} download className="btn-secondary text-sm no-underline">
                      High Confidence Only
                    </a>
                    <a href={getMailingDownloadUrl(matchId, 'full-list', 'full')} download className="btn-secondary text-sm no-underline">
                      Full List
                    </a>
                  </div>
                </div>
              )
            })()}

            {/* Result summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
              <ResultCard label="Comp-Matched" value={matchResult.matched_count.toLocaleString()} accent="#10B981" sub="Ready to mail" />
              <ResultCard label="County Median" value={((matchResult as any).county_median_count ?? 0).toLocaleString()} accent="#3B82F6" sub="Estimated" />
              <ResultCard label="LP Estimate Only" value={(matchResult.lp_fallback_count ?? 0).toLocaleString()} accent="#C084FC" sub="Reference only" />
              <ResultCard label="Below Floor" value={((matchResult.low_offer_count ?? 0) + (matchResult.low_value_count ?? 0)).toLocaleString()} accent="#F59E0B" sub="Offer too low" />
              <ResultCard label="No Data" value={(matchResult.unpriced_count ?? 0).toLocaleString()} accent="#6B7280" sub="Skip these" />
            </div>
            {(matchResult.zip_coord_free_count ?? 0) > 0 && (
              <div className="mb-4 px-4 py-2.5 rounded-lg text-sm flex items-center gap-2" style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', color: '#1D4ED8' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                <span><strong>ZIP Matched: {(matchResult.zip_coord_free_count ?? 0).toLocaleString()} records</strong> — matched via ZIP code (no coordinates available). These comps were saved without GPS coordinates.</span>
              </div>
            )}

            {/* Pricing method breakdown */}
            {(matchResult as any).pricing_breakdown && (() => {
              const pb = (matchResult as any).pricing_breakdown as Record<string, number>
              const rows = [
                { label: 'Within 0.25mi', key: '0.25mi', color: '#059669' },
                { label: 'Within 0.50mi', key: '0.50mi', color: '#059669' },
                { label: 'Within 1 mile', key: '1mi', color: '#059669' },
                { label: 'Within 2 miles', key: '2mi', color: '#16A34A' },
                { label: 'Within 3 miles', key: '3mi', color: '#D97706' },
                { label: 'Same ZIP', key: 'ZIP', color: '#2563EB' },
                { label: 'ZIP (no coords)', key: 'ZIP_MATCH', color: '#60A5FA' },
                { label: 'LP fallback', key: 'LP_FALLBACK', color: '#C084FC' },
                { label: 'No data', key: 'NO_DATA', color: '#6B7280' },
              ].filter(r => pb[r.key] > 0)
              if (rows.length === 0) return null
              return (
                <div className="card mb-6">
                  <h2 className="font-semibold mb-3" style={{ color: '#111827' }}>Pricing Method Breakdown</h2>
                  <div className="flex flex-col gap-1.5">
                    {rows.map(r => (
                      <div key={r.key} className="flex items-center gap-3">
                        <span className="text-xs w-36 shrink-0" style={{ color: '#6B7280' }}>{r.label}</span>
                        <div className="flex-1 rounded-full h-2 overflow-hidden" style={{ background: '#E5E7EB' }}>
                          <div className="h-full rounded-full" style={{
                            width: `${Math.round(pb[r.key] / matchResult.total_targets * 100)}%`,
                            background: r.color,
                            minWidth: pb[r.key] > 0 ? 4 : 0,
                          }} />
                        </div>
                        <span className="text-xs tabular-nums font-semibold w-14 text-right" style={{ color: r.color }}>
                          {pb[r.key].toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })()}

            {/* Assignment fee calculator */}
            {(() => {
              const fee = parseFloat(assignmentFee) || 0
              const compMatched = matchResult.results.filter(r => {
                const retail = r.retail_estimate
                const offer = r.suggested_offer_mid
                return r.pricing_flag === 'MATCHED' && retail != null && offer != null && retail >= offer + fee
              }).length
              const lpSupporting = matchResult.results.filter(r => {
                const retail = r.retail_estimate
                const offer = r.suggested_offer_mid
                return r.pricing_flag === 'LP_FALLBACK' && retail != null && offer != null && retail >= offer + fee
              }).length
              return (
                <div className="card mb-6">
                  <h2 className="font-semibold mb-3" style={{ color: '#111827' }}>Assignment Fee Calculator</h2>
                  <div className="flex items-end gap-4 flex-wrap">
                    <div>
                      <label className="text-xs block mb-1" style={{ color: '#9CA3AF' }}>Target Assignment Fee</label>
                      <div className="flex items-center gap-2">
                        <span className="text-sm" style={{ color: '#9CA3AF' }}>$</span>
                        <input type="number" min="0" step="500" placeholder="5000"
                          className="input-base text-sm py-2"
                          style={{ width: 120 }}
                          value={assignmentFee}
                          onChange={e => setAssignmentFee(e.target.value)} />
                      </div>
                    </div>
                    <div className="rounded-xl px-4 py-3" style={{ background: compMatched > 0 ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)', border: `1px solid ${compMatched > 0 ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)'}` }}>
                      <p className="text-sm font-semibold" style={{ color: compMatched > 0 ? '#10B981' : '#EF4444' }}>
                        {compMatched.toLocaleString()} comp-matched record{compMatched !== 1 ? 's' : ''} support a ${Number(assignmentFee || 0).toLocaleString()} assignment fee
                      </p>
                      {lpSupporting > 0 && (
                        <p className="text-xs mt-1" style={{ color: '#9CA3AF' }}>
                          {lpSupporting.toLocaleString()} additional LP estimate record{lpSupporting !== 1 ? 's' : ''} may also support the fee (not comp-verified)
                        </p>
                      )}
                      <p className="text-xs mt-0.5" style={{ color: '#6B7280' }}>
                        Formula: retail estimate ≥ offer + ${Number(assignmentFee || 0).toLocaleString()} assignment fee
                      </p>
                    </div>
                  </div>
                </div>
              )
            })()}

            {matchResult.warnings && matchResult.warnings.filter(w => w.includes('Excluded') || w.includes('WARNING')).length > 0 && (
              <div className="mb-4 p-3 rounded-lg" style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)' }}>
                <p className="text-xs font-semibold mb-1" style={{ color: '#F59E0B' }}>Filters Applied:</p>
                {matchResult.warnings.filter(w => w.includes('Excluded') || w.includes('WARNING')).map((w, i) => (
                  <p key={i} className="text-xs" style={{ color: '#F59E0B' }}>{w}</p>
                ))}
              </div>
            )}

            {/* Unmatched Records + Comp Coverage */}
            {(() => {
              const noCompRecords = matchResult.results.filter(r => r.pricing_flag === 'NO_COMPS')
              const targetZips = Array.from(new Set(matchResult.results.map(r => r.parcel_zip).filter(Boolean))) as string[]
              const matchedZipSet = new Set(matchResult.results.filter(r => r.pricing_flag === 'MATCHED').map(r => r.parcel_zip).filter(Boolean))
              const uncoveredZips = targetZips.filter(z => !matchedZipSet.has(z)).sort()
              const reasonGroups: Record<string, number> = {}
              for (const r of noCompRecords) {
                const reason = (r.no_match_reason as string) || 'Unknown reason'
                reasonGroups[reason] = (reasonGroups[reason] || 0) + 1
              }
              return (
                <div className="card mb-6">
                  <div
                    className="flex items-center justify-between cursor-pointer"
                    style={{ marginBottom: showUnmatched ? 12 : 0 }}
                    onClick={() => setShowUnmatched(v => !v)}
                  >
                    <h2 className="font-semibold" style={{ color: '#111827' }}>
                      Unmatched Records
                      <span className="text-sm font-normal ml-2" style={{ color: '#9CA3AF' }}>({noCompRecords.length.toLocaleString()} records couldn't be comp-matched)</span>
                    </h2>
                    <span className="text-sm" style={{ color: '#6B7280' }}>{showUnmatched ? '▲ Hide' : '▼ Show'}</span>
                  </div>

                  {/* County diagnostics — always visible */}
                  {(matchResult as any).county_diagnostics && (() => {
                    const cd = (matchResult as any).county_diagnostics as {
                      target_county_count: number; comp_county_count: number;
                      covered_county_count: number; uncovered_counties: string[];
                      coverage_pct: number; message: string;
                    }
                    const pct = cd.coverage_pct
                    const color = pct >= 80 ? '#059669' : pct >= 50 ? '#D97706' : '#DC2626'
                    return (
                      <div className="rounded-lg p-2.5 mt-3" style={{ background: 'rgba(79,70,229,0.04)', border: '1px solid rgba(79,70,229,0.12)' }}>
                        <p className="text-xs font-semibold mb-1" style={{ color }}>
                          County coverage: {cd.covered_county_count} of {cd.target_county_count} counties ({pct}%)
                        </p>
                        <p className="text-[10px] mb-1" style={{ color: '#4F46E5' }}>{cd.message}</p>
                        {cd.uncovered_counties.length > 0 && (
                          <p className="text-[10px]" style={{ color: '#EF4444' }}>
                            No comps for: <span className="font-semibold">{cd.uncovered_counties.slice(0, 8).join(', ')}{cd.uncovered_counties.length > 8 ? ` +${cd.uncovered_counties.length - 8} more` : ''}</span>
                            {' '}—{' '}
                            <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#4F46E5', textDecoration: 'underline', fontSize: 'inherit', padding: 0 }} onClick={() => setCurrentPage('upload-comps')}>
                              upload comps
                            </button>
                            {' '}from these counties to increase match rate
                          </p>
                        )}
                      </div>
                    )
                  })()}

                  {/* ZIP coverage */}
                  <div className="rounded-lg p-2.5 mt-2" style={{ background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.15)' }}>
                    <p className="text-xs font-semibold mb-0.5" style={{ color: '#3B82F6' }}>
                      ZIP coverage: {matchedZipSet.size} of {targetZips.length} target ZIPs have comp-matched records
                    </p>
                    {uncoveredZips.length > 0 && uncoveredZips.length <= 20 && (
                      <p className="text-[10px]" style={{ color: '#60A5FA' }}>
                        To increase match rate,{' '}
                        <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#60A5FA', textDecoration: 'underline', fontSize: 'inherit', padding: 0 }} onClick={() => setCurrentPage('upload-comps')}>
                          upload more comps
                        </button>
                        {' '}from: <span className="font-mono">{uncoveredZips.join(', ')}</span>
                      </p>
                    )}
                    {uncoveredZips.length > 20 && (
                      <p className="text-[10px]" style={{ color: '#60A5FA' }}>
                        {uncoveredZips.length} ZIPs have no matched records —{' '}
                        <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#60A5FA', textDecoration: 'underline', fontSize: 'inherit', padding: 0 }} onClick={() => setCurrentPage('upload-comps')}>
                          upload more comps
                        </button>
                        {' '}from these areas to increase match rate
                      </p>
                    )}
                  </div>

                  {showUnmatched && noCompRecords.length > 0 && (
                    <>
                      <p className="text-[10px] uppercase tracking-wide font-semibold mt-4 mb-2" style={{ color: '#6B7280' }}>Why records didn't match:</p>
                      <div className="flex flex-col gap-1 mb-4">
                        {Object.entries(reasonGroups).sort(([, a], [, b]) => b - a).map(([reason, count]) => (
                          <div key={reason} className="flex justify-between items-center px-2.5 py-1.5 rounded-lg" style={{ background: '#F3F4F6' }}>
                            <span className="text-xs" style={{ color: '#374151' }}>{reason}</span>
                            <span className="text-xs font-semibold tabular-nums" style={{ color: '#9CA3AF' }}>{count.toLocaleString()}</span>
                          </div>
                        ))}
                      </div>

                      <p className="text-[10px] uppercase tracking-wide font-semibold mb-2" style={{ color: '#6B7280' }}>
                        Sample unmatched records (first 20 of {noCompRecords.length.toLocaleString()}):
                      </p>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr style={{ borderBottom: '1px solid #E5E7EB' }}>
                              {['APN', 'ZIP', 'Acres', 'Band', 'Reason'].map(h => (
                                <th key={h} className="text-left py-1.5 pr-3 last:pr-0" style={{ color: '#6B7280', fontWeight: 500 }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {noCompRecords.slice(0, 20).map((r, i) => (
                              <tr key={i} style={{ borderBottom: '1px solid #F3F4F6' }}>
                                <td className="py-1 pr-3 font-mono" style={{ color: '#374151' }}>{r.apn || '—'}</td>
                                <td className="py-1 pr-3" style={{ color: '#6B7280' }}>{r.parcel_zip || '—'}</td>
                                <td className="py-1 pr-3 tabular-nums" style={{ color: '#6B7280' }}>{r.lot_acres != null ? Number(r.lot_acres).toFixed(2) : '—'}</td>
                                <td className="py-1 pr-3" style={{ color: '#6B7280' }}>{(r.acreage_band as string) || '—'}</td>
                                <td className="py-1" style={{ color: '#DC2626' }}>{(r.no_match_reason as string) || 'Unknown'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              )
            })()}

            <div className="flex items-center gap-3 mb-5">
              <span className="text-xs" style={{ color: '#9CA3AF' }}>Score distribution:</span>
              {[5, 4, 3, 2, 1, 0].map(s => {
                const count = matchResult.results.filter(r => r.match_score === s).length
                if (count === 0) return null
                return (
                  <span key={s} className="flex items-center gap-1.5">
                    <ScoreBadge score={s} />
                    <span className="text-xs" style={{ color: '#9CA3AF' }}>{count.toLocaleString()}</span>
                  </span>
                )
              })}
            </div>

            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold" style={{ color: '#111827' }}>
                  Matched Parcels
                  <span className="text-sm font-normal ml-2" style={{ color: '#9CA3AF' }}>sorted by score</span>
                </h2>
                <div className="inline-flex gap-1">
                  <button className={`toggle-btn${resultView === 'table' ? ' active' : ''}`} onClick={() => setResultView('table')}>Table</button>
                  <button className={`toggle-btn${resultView === 'map' ? ' active' : ''}`} onClick={() => setResultView('map')}>Map</button>
                </div>
              </div>
              {resultView === 'table' ? (
                <DataTable<MatchedParcel>
                  columns={cols}
                  data={matchResult.results}
                  pageSize={50}
                  emptyMessage="No parcels matched with current filters"
                  searchable
                  searchKeys={['apn', 'owner_name', 'parcel_zip', 'parcel_city']}
                />
              ) : (
                <MatchMap targets={matchResult.results} comps={dashboardData?.comp_locations ?? []} radiusMiles={1} />
              )}
            </div>

          </>
        )}
      </div>

      {/* Add to Mailing List modal */}
      {showMailingModal && matchResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}
          onClick={e => { if (e.target === e.currentTarget) setShowMailingModal(false) }}>
          <div className="rounded-2xl p-6 shadow-xl" style={{ background: '#FFFFFF', border: '1px solid #E5E7EB', maxWidth: '480px', width: '100%', boxShadow: '0 4px 24px rgba(0,0,0,0.1)' }}>
            <h2 className="section-heading mb-1">Add to Mailing List</h2>
            <p className="text-xs mb-4" style={{ color: '#6B7280' }}>
              Insert match results into a CRM campaign as leads.
            </p>

            <div className="flex flex-col gap-1 mb-3">
              <label className="label-caps">Records to add</label>
              <div className="rounded-lg px-3 py-2 text-sm font-medium" style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', color: '#10B981' }}>
                ✓ {matchResult.matched_count.toLocaleString()} Comp-Matched Records
              </div>
              <p className="text-[10px] mt-0.5" style={{ color: '#10B981' }}>
                Only records priced from local sold comps — LP Fallback records are excluded
              </p>
            </div>

            <div className="flex flex-col gap-1 mb-4">
              <label className="label-caps">Campaign</label>
              <select
                className="input-base text-sm"
                value={selectedCampaignId}
                onChange={e => setSelectedCampaignId(e.target.value)}
                onFocus={async () => {
                  if (mailingCampaigns.length === 0) {
                    const list = await listCrmCampaigns().catch(() => [])
                    setMailingCampaigns(list.map(c => ({ id: c.id, name: c.name })))
                  }
                }}
              >
                <option value="">— Select campaign —</option>
                <option value="__new__">+ Create new campaign automatically</option>
                {mailingCampaigns.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              {selectedCampaignId === '__new__' && (
                <p className="text-[10px] mt-1" style={{ color: '#6B7280' }}>
                  Will be named based on your comp data counties: {(dashboardData?.top_counties ?? []).slice(0, 3).join(', ') || 'Auto-detect'}
                </p>
              )}
            </div>

            {mailingError && <p className="text-xs mb-3" style={{ color: '#EF4444' }}>{mailingError}</p>}
            {mailingSuccess && (
              <div className="mb-3 rounded-lg px-3 py-2" style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)' }}>
                <p className="text-xs font-medium" style={{ color: '#10B981' }}>{mailingSuccess}</p>
                <button
                  className="text-xs mt-1 underline"
                  style={{ color: '#4F46E5', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                  onClick={() => { setShowMailingModal(false); setMailingSuccess(null); setMailingError(null); setCurrentPage('crm-campaigns') }}
                >
                  Go to Campaign →
                </button>
              </div>
            )}

            <div className="flex gap-3">
              <button className="btn-secondary flex-1" onClick={() => { setShowMailingModal(false); setMailingSuccess(null); setMailingError(null); setMailingDone(false) }} disabled={mailingLoading}>Cancel</button>
              <button
                className="btn-primary flex-1"
                disabled={mailingLoading || !selectedCampaignId || mailingDone}
                style={mailingDone ? { background: '#059669', cursor: 'default' } : {}}
                onClick={async () => {
                  setMailingLoading(true)
                  setMailingError(null)
                  setMailingSuccess(null)
                  try {
                    let campaignId = selectedCampaignId
                    let campaignName = mailingCampaigns.find(c => c.id === campaignId)?.name ?? 'Campaign'
                    if (selectedCampaignId === '__new__') {
                      const allCounties = dashboardData?.top_counties ?? []
                      const topState = dashboardData?.top_states?.[0] ?? ''
                      const created = await autoCreateCampaign({ counties: allCounties, state: topState })
                      campaignId = created.campaign_id
                      campaignName = created.name
                      setMailingCampaigns(prev => [...prev, { id: created.campaign_id, name: created.name }])
                    }
                    console.log('[MailingModal] matchResult.results count:', matchResult.results.length)
                    console.log('[MailingModal] mailingExportType:', mailingExportType)
                    console.log('[MailingModal] sample result:', matchResult.results[0])
                    const result = await addMatchResultsToCampaign(
                      campaignId,
                      matchResult.match_id,
                      mailingExportType,
                      matchResult.results,
                    )
                    setMailingSuccess(`${result.imported.toLocaleString()} records added to "${campaignName}" with pricing saved.`)
                    setSelectedCampaignId(campaignId)
                    setMailingDone(true)
                    setTimeout(() => {
                      setShowMailingModal(false)
                      setMailingDone(false)
                      setMailingSuccess(null)
                      setMailingError(null)
                    }, 3000)
                  } catch (e: unknown) {
                    const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
                    setMailingError(detail ?? 'Failed to add records.')
                  } finally { setMailingLoading(false) }
                }}
              >
                {mailingLoading ? 'Adding…' : mailingDone ? '✓ Done' : 'Add Records'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────


function ScoreBadge({ score }: { score: number }) {
  return (
    <span
      className="inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold text-white"
      style={{ background: score === 5 ? '#059669' : score === 4 ? '#4F46E5' : score === 3 ? '#F59E0B' : score === 2 ? '#D97706' : '#DC2626', color: '#fff' }}
    >
      {score}
    </span>
  )
}

function ResultCard({ label, value, accent, sub }: { label: string; value: string; accent: string; sub?: string }) {
  return (
    <div className="rounded-xl p-4" style={{ background: '#FFFFFF', border: '1px solid #E5E7EB', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      <p className="text-xs uppercase tracking-wider mb-1" style={{ color: '#6B7280' }}>{label}</p>
      <p className="text-2xl font-bold" style={{ color: accent }}>{value}</p>
      {sub && <p className="text-[10px] mt-0.5" style={{ color: '#6B7280' }}>{sub}</p>}
    </div>
  )
}
