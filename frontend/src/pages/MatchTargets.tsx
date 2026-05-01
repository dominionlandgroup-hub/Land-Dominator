import React, { useState, useEffect } from 'react'
import FileUpload from '../components/FileUpload'
import DataTable from '../components/DataTable'
import LoadingSpinner from '../components/LoadingSpinner'
import LoadingOverlay from '../components/LoadingOverlay'
import { useApp } from '../context/AppContext'
import { uploadTargets, runMatch, getMailingDownloadUrl, getMatchedLeadsDownloadUrl } from '../api/client'
import { listCrmCampaigns, autoCreateCampaign, addMatchResultsToCampaign, saveMatchPricing } from '../api/crm'
import type { Column } from '../components/DataTable'
import type { MatchedParcel, MatchFilters } from '../types'
import { getConfidence } from '../types'
import MatchMap from '../components/MatchMap'
import WelcomeScreen from './WelcomeScreen'

const SQFT_PER_ACRE = 43560

export default function MatchTargets() {
  const {
    compsStats,
    compsRestoring,
    targetStats, setTargetStats,
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

  // ── Filter state ────────────────────────────────────────────────────────
  const init = lastFilters

  const [minScore] = useState<number>(Number(init?.min_match_score ?? 0))
  const [zipFilter, setZipFilter] = useState<string[]>((init?.zip_filter as string[]) ?? [])
  const [zipInputText, setZipInputText] = useState<string>(((init?.zip_filter as string[]) ?? []).join(', '))
  const [minAcreage, setMinAcreage] = useState<string>(init?.min_acreage != null ? String(init.min_acreage) : '')
  const [maxAcreage, setMaxAcreage] = useState<string>(init?.max_acreage != null ? String(init.max_acreage) : '')
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
  const [mailingExportType, setMailingExportType] = useState<'mailable' | 'matched'>('mailable')

  // Save to CRM state
  const [savingToCrm, setSavingToCrm] = useState(false)
  const [saveCrmSuccess, setSaveCrmSuccess] = useState<string | null>(null)
  const [saveCrmError, setSaveCrmError] = useState<string | null>(null)

  // Pre-fill acreage from sweet spot when no saved filters
  useEffect(() => {
    if (lastFilters || !dashboardData?.sweet_spot) return
    const b = dashboardData.sweet_spot.bucket
    if (b === '0-0.5') { setMinAcreage('0.1'); setMaxAcreage('0.5') }
    else if (b === '0.5-1') { setMinAcreage('0.5'); setMaxAcreage('1') }
    else if (b === '1-2') { setMinAcreage('1'); setMaxAcreage('2') }
    else if (b === '2-5') { setMinAcreage('2'); setMaxAcreage('5') }
    else if (b === '5-10') { setMinAcreage('5'); setMaxAcreage('10') }
    else if (b === '10+') { setMinAcreage('10'); setMaxAcreage('40') }
  }, [dashboardData])

  // Top 10 ZIPs from dashboard for "Use Buy Box ZIPs" — exclude outliers (ppa > 3x market median)
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
      .filter(z => !outlierCodes.has(z.zip_code))
      .sort((a, b) => b.sales_count - a.sales_count)
      .slice(0, 10)
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
          <p className="text-sm" style={{ color: '#6B5B8A' }}>Loading comps from database…</p>
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
    { key: 'latitude', header: 'Latitude', defaultHidden: true, align: 'right', render: (v) => (v == null ? <span style={{ color: '#9B8AAE' }}>—</span> : <span className="text-xs">{(v as number).toFixed(5)}</span>) },
    { key: 'longitude', header: 'Longitude', defaultHidden: true, align: 'right', render: (v) => (v == null ? <span style={{ color: '#9B8AAE' }}>—</span> : <span className="text-xs">{(v as number).toFixed(5)}</span>) },
    { key: 'lot_acres', header: 'Acres', sortable: true, align: 'right', render: (v) => v == null ? <span style={{ color: '#9B8AAE' }}>—</span> : <span>{(v as number).toFixed(2)}</span> },
    { key: 'acreage_band', header: 'Band', sortable: true, align: 'center', render: (v) => <span className="text-xs" style={{ color: '#6B5B8A' }}>{String(v || '—')}</span> },
    { key: 'matched_comp_count', header: 'Comps', sortable: true, align: 'center', render: (v) => <span className="text-xs">{String(v ?? '—')}</span> },
    {
      key: 'no_match_reason', header: 'No Match Reason', defaultHidden: false,
      render: (v, row) => {
        if (!v) return <span style={{ color: '#9B8AAE' }}>—</span>
        const flag = row.pricing_flag
        const color = flag === 'LP_FALLBACK' ? '#8B4DB8' : '#9CA3AF'
        return <span className="text-xs" style={{ color }}>{String(v)}</span>
      },
    },
    { key: 'comp_count', header: 'Comp Count', sortable: true, align: 'center', defaultHidden: true, render: (v) => <span className="text-xs">{String(v ?? '—')}</span> },
    { key: 'closest_comp_distance', header: 'Distance to Closest Comp', sortable: true, align: 'right', defaultHidden: true, render: (v) => (v == null ? <span style={{ color: '#9B8AAE' }}>—</span> : <span className="text-xs">{(v as number).toFixed(2)}</span>) },
    { key: 'retail_estimate', header: 'Retail Est.', sortable: true, align: 'right', defaultHidden: true, render: (v) => v == null ? <span style={{ color: '#9B8AAE' }}>—</span> : <span className="text-xs" style={{ color: '#1A0A2E' }}>${Math.round(v as number).toLocaleString()}</span> },
    { key: 'suggested_offer_low', header: 'Offer Low', align: 'right', render: (v) => v == null ? <span style={{ color: '#9B8AAE' }}>—</span> : <span className="text-xs" style={{ color: '#6B5B8A' }}>${Math.round(v as number).toLocaleString()}</span> },
    { key: 'suggested_offer_mid', header: 'Offer Mid', sortable: true, align: 'right', render: (v) => v == null ? <span style={{ color: '#9B8AAE' }}>—</span> : <span className="font-semibold" style={{ color: '#2D7A4F' }}>${Math.round(v as number).toLocaleString()}</span> },
    { key: 'suggested_offer_high', header: 'Offer High', align: 'right', render: (v) => v == null ? <span style={{ color: '#9B8AAE' }}>—</span> : <span className="text-xs" style={{ color: '#6B5B8A' }}>${Math.round(v as number).toLocaleString()}</span> },
    { key: 'median_comp_sale_price', header: 'Med. Comp $', align: 'right', defaultHidden: true, render: (v) => v == null ? <span style={{ color: '#9B8AAE' }}>—</span> : <span className="text-xs">${Math.round(v as number).toLocaleString()}</span> },
    { key: 'median_ppa', header: 'Med. PPA', align: 'right', defaultHidden: true, render: (v) => v == null ? <span style={{ color: '#9B8AAE' }}>—</span> : <span className="text-xs">${Math.round(v as number).toLocaleString()}</span> },
    { key: 'min_comp_price', header: 'Min Comp $', align: 'right', defaultHidden: true, render: (v) => v == null ? <span style={{ color: '#9B8AAE' }}>—</span> : <span className="text-xs">${Math.round(v as number).toLocaleString()}</span> },
    { key: 'max_comp_price', header: 'Max Comp $', align: 'right', defaultHidden: true, render: (v) => v == null ? <span style={{ color: '#9B8AAE' }}>—</span> : <span className="text-xs">${Math.round(v as number).toLocaleString()}</span> },
    { key: 'outliers_removed', header: 'Outliers', align: 'center', defaultHidden: true, render: (v) => <span className="text-xs">{String(v ?? 0)}</span> },
    { key: 'tlp_estimate', header: 'TLP Est.', align: 'right', defaultHidden: true, render: (v) => v == null ? <span style={{ color: '#9B8AAE' }}>—</span> : <span className="text-xs" style={{ color: '#6B5B8A' }}>${Math.round(v as number).toLocaleString()}</span> },
    { key: 'tlp_capped', header: 'TLP Cap', align: 'center', defaultHidden: true, render: (v) => <span className="text-xs">{v ? 'Yes' : 'No'}</span> },
    { key: 'flood_zone', header: 'Flood', defaultHidden: true, render: (v) => <span className="text-xs" style={{ color: '#6B5B8A' }}>{String(v || '—')}</span> },
    {
      key: 'buildability_pct', header: 'Build%', sortable: true, align: 'right', defaultHidden: true,
      render: (v) => v == null ? <span style={{ color: '#9B8AAE' }}>—</span> : (
        <span style={{ color: (v as number) > 70 ? '#2D7A4F' : (v as number) > 40 ? '#f59e0b' : '#ef4444', fontSize: '12px' }}>
          {(v as number).toFixed(0)}%
        </span>
      ),
    },
  ]

  return (
    <div className="flex flex-col min-h-screen">
      <LoadingOverlay visible={matchLoading} title="Running matching engine…" />

      <div className="page-header">
        <div>
          <h1 className="text-lg font-semibold" style={{ color: '#1A0A2E' }}>Match Targets</h1>
          <p className="text-xs mt-0.5" style={{ color: '#6B5B8A' }}>Upload target parcels and run the matching engine with smart filters</p>
        </div>
        {matchResult && (
          <button className="btn-primary text-sm" onClick={() => setCurrentPage('mailing-list')}>
            Mailing List →
          </button>
        )}
      </div>

      <div className="p-8 max-w-[1400px] mx-auto w-full">

        {/* ── Comps info banner ────────────────────────────────── */}
        <div className="rounded-xl px-4 py-3 mb-5 flex items-center justify-between" style={{ background: 'rgba(45,122,79,0.06)', border: '1px solid rgba(45,122,79,0.2)' }}>
          <div className="flex items-center gap-3">
            <span style={{ color: '#2D7A4F', fontWeight: 700, fontSize: 16 }}>✓</span>
            <div>
              <p className="text-sm font-medium" style={{ color: '#2D7A4F' }}>
                Using {compsStats.valid_rows.toLocaleString()} sold comps
                {compsStats.uploaded_at && (
                  <span className="font-normal ml-2" style={{ color: '#6B5B8A' }}>
                    · uploaded {new Date(compsStats.uploaded_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                )}
              </p>
              <p className="text-xs mt-0.5" style={{ color: '#6B5B8A' }}>Upload new comps on the Dashboard page to refresh</p>
            </div>
          </div>
        </div>

        {/* ── Target upload ─────────────────────────────────────── */}
        <div className="card mb-6">
          <h2 className="font-semibold mb-4" style={{ color: '#1A0A2E' }}>Target Parcels CSV</h2>
          {targetStats ? (
            <div className="rounded-lg px-4 py-3 flex items-center justify-between" style={{ background: 'rgba(45,122,79,0.06)', border: '1px solid rgba(45,122,79,0.15)' }}>
              <div>
                <p className="font-medium text-sm" style={{ color: '#2D7A4F' }}>
                  ✓ {targetStats.total_rows.toLocaleString()} rows loaded
                </p>
                <p className="text-xs mt-0.5" style={{ color: '#6B5B8A' }}>
                  {targetStats.columns_found.length} columns · {fileName}
                </p>
              </div>
              <button className="text-xs" style={{ color: '#6B5B8A' }} onClick={() => { setTargetStats(null); setFileName(null) }}>
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
          <h2 className="font-semibold mb-5" style={{ color: '#1A0A2E' }}>Filters</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

            {/* 1. Acreage Range */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: '#6B5B8A' }}>Acreage Range</p>
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <input
                    type="number" step="0.1" min="0" placeholder="Min acres"
                    className="input-base text-xs py-2 w-full"
                    value={minAcreage}
                    onChange={e => setMinAcreage(e.target.value)}
                  />
                  {minAcreage && Number(minAcreage) > 0 && (
                    <p className="text-[10px] mt-1" style={{ color: '#9B8AAE' }}>
                      {Math.round(Number(minAcreage) * SQFT_PER_ACRE).toLocaleString()} sq ft
                    </p>
                  )}
                </div>
                <span className="text-sm mt-2" style={{ color: '#6B5B8A' }}>to</span>
                <div className="flex-1">
                  <input
                    type="number" step="0.1" min="0" placeholder="Max acres"
                    className="input-base text-xs py-2 w-full"
                    value={maxAcreage}
                    onChange={e => setMaxAcreage(e.target.value)}
                  />
                  {maxAcreage && Number(maxAcreage) > 0 && (
                    <p className="text-[10px] mt-1" style={{ color: '#9B8AAE' }}>
                      {Math.round(Number(maxAcreage) * SQFT_PER_ACRE).toLocaleString()} sq ft
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* 2. Flood Zone */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: '#6B5B8A' }}>Flood Zone</p>
              <div className="inline-flex rounded-lg overflow-hidden" style={{ border: '1px solid #E8E0F0' }}>
                <button className="px-4 py-2 text-xs transition-all" style={floodZoneFilter === 'exclude' ? { background: '#5C2977', color: 'white' } : { background: '#FFFFFF', color: '#6B5B8A' }} onClick={() => setFloodZoneFilter('exclude')}>Exclude</button>
                <button className="px-4 py-2 text-xs transition-all" style={floodZoneFilter === 'all' ? { background: '#5C2977', color: 'white' } : { background: '#FFFFFF', color: '#6B5B8A' }} onClick={() => setFloodZoneFilter('all')}>Include All</button>
                <button className="px-4 py-2 text-xs transition-all" style={floodZoneFilter === 'only' ? { background: '#5C2977', color: 'white' } : { background: '#FFFFFF', color: '#6B5B8A' }} onClick={() => setFloodZoneFilter('only')}>Only Flood</button>
              </div>
              <p className="text-[10px] mt-1.5" style={{ color: '#9B8AAE' }}>Exclude = no FEMA flood zones (recommended)</p>
            </div>

            {/* 3. Minimum Offer Floor */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: '#6B5B8A' }}>Minimum Offer Floor</p>
              <input type="number" step="1000" min="0" placeholder="10000"
                className="input-base text-xs py-2 w-full"
                value={minOfferFloor}
                onChange={e => setMinOfferFloor(e.target.value)} />
              <p className="text-[10px] mt-1" style={{ color: '#9B8AAE' }}>Below this → flagged LOW_OFFER (kept in results)</p>
            </div>

            {/* 4. Minimum Retail Value */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: '#6B5B8A' }}>Minimum Retail Value</p>
              <input type="number" step="1000" min="0" placeholder="20000"
                className="input-base text-xs py-2 w-full"
                value={minLpEstimate}
                onChange={e => setMinLpEstimate(e.target.value)} />
              <p className="text-[10px] mt-1" style={{ color: '#9B8AAE' }}>Below this → flagged LOW_VALUE (kept in results)</p>
            </div>

          </div>

          {/* 5. ZIP Filter */}
          <div className="mt-5 pt-5" style={{ borderTop: '1px solid #E8E0F0' }}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#6B5B8A' }}>ZIP Filter</p>
              <div className="flex gap-2">
                {top10Zips.length > 0 && (
                  <button className="text-xs px-3 py-1 rounded-lg border transition-colors"
                    style={{ borderColor: '#E8E0F0', color: '#5C2977', background: '#F8F6FB' }}
                    onClick={useBuyBoxZips}>
                    Use Buy Box ZIPs
                  </button>
                )}
                {zipFilter.length > 0 && (
                  <button className="text-xs" style={{ color: '#9B8AAE' }} onClick={clearZips}>Clear</button>
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
              <p className="text-xs mt-1.5" style={{ color: '#6B5B8A' }}>
                {zipFilter.length} ZIP{zipFilter.length !== 1 ? 's' : ''} selected: {zipFilter.join(', ')}
              </p>
            )}
          </div>
        </div>

        {/* ── Active Filters Summary ──────────────────────────── */}
        <div className="mb-5 px-4 py-3 rounded-xl text-xs" style={{ background: '#F8F6FB', border: '1px solid #E8E0F0', color: '#5C2977' }}>
          {filterSummary}
        </div>

        {/* ── Run button ──────────────────────────────────────── */}
        <div className="mb-6">
          <button
            disabled={!targetStats || matchLoading}
            onClick={handleMatch}
            style={{
              width: '100%', padding: '18px 32px', fontSize: 18, fontWeight: 700, letterSpacing: '0.5px',
              borderRadius: 12, border: 'none', cursor: !targetStats || matchLoading ? 'not-allowed' : 'pointer',
              opacity: !targetStats || matchLoading ? 0.5 : 1,
              background: 'linear-gradient(135deg, #5C2977 0%, #8B4DB8 50%, #D5A940 100%)',
              color: 'white', boxShadow: '0 4px 20px rgba(92,41,119,0.35)', transition: 'all 0.3s ease',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            }}
            onMouseEnter={e => { if (!matchLoading && targetStats) { (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 8px 30px rgba(92,41,119,0.5)'; (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-2px)' } }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 20px rgba(92,41,119,0.35)'; (e.currentTarget as HTMLButtonElement).style.transform = 'none' }}
          >
            {matchLoading ? (
              <><LoadingSpinner size="sm" />Running…</>
            ) : (
              <>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                Run Matching Engine
              </>
            )}
          </button>
          {targetStats && !matchLoading && (
            <p className="text-sm mt-2 text-center" style={{ color: '#6B5B8A' }}>
              {targetStats.total_rows.toLocaleString()} targets × {compsStats.valid_rows.toLocaleString()} comps
            </p>
          )}
        </div>

        {matchError && (
          <div className="rounded-xl px-5 py-4 mb-6 text-sm" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#dc2626' }}>
            {matchError}
          </div>
        )}

        {matchResult && (
          <>
            {/* Smart floor recommendation */}
            {matchResult.smart_floor_recommendation != null && (
              <div className="mb-5 px-4 py-3 rounded-xl flex items-center justify-between" style={{ background: 'rgba(45,122,79,0.06)', border: '1px solid rgba(45,122,79,0.25)' }}>
                <div>
                  <p className="text-sm font-medium" style={{ color: '#2D7A4F' }}>
                    Recommended minimum offer: <strong>${Math.round(matchResult.smart_floor_recommendation).toLocaleString()}</strong>
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: '#6B5B8A' }}>10th percentile of all matched offers — based on this market's comp data</p>
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

            {/* Download exports */}
            {(() => {
              const matchId = matchResult.match_id
              return (
                <div className="card mb-6">
                  <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                    <h2 className="font-semibold" style={{ color: '#1A0A2E' }}>Download Results</h2>
                    <div className="flex gap-2 flex-wrap">
                      <button
                        className="btn-secondary text-sm"
                        style={{ padding: '8px 16px' }}
                        disabled={savingToCrm}
                        onClick={async () => {
                          const matchId = matchResult?.match_id
                          if (!matchId) return
                          setSavingToCrm(true)
                          setSaveCrmSuccess(null)
                          setSaveCrmError(null)
                          try {
                            const res = await saveMatchPricing(matchId, 'all')
                            if (res.updated > 0) {
                              setSaveCrmSuccess(`Updated ${res.updated.toLocaleString()} existing CRM properties with comp & pricing data. (${res.not_found} not found in CRM)`)
                            } else {
                              setSaveCrmSuccess(`No matching CRM records found by APN (${res.not_found} parcels not in CRM yet — use "Add to Mailing List" to import them first).`)
                            }
                          } catch {
                            setSaveCrmError('Failed to save pricing to CRM.')
                          } finally {
                            setSavingToCrm(false)
                          }
                        }}
                      >
                        {savingToCrm ? 'Saving…' : 'Save Pricing to CRM'}
                      </button>
                      <button
                        className="btn-primary text-sm"
                        style={{ padding: '8px 16px' }}
                        onClick={() => setShowMailingModal(true)}
                      >
                        + Add to Mailing List
                      </button>
                    </div>
                  </div>
                  {saveCrmSuccess && (
                    <div className="mb-3 text-xs rounded-lg px-3 py-2" style={{ background: '#E8F5E9', color: '#2D7A4F' }}>
                      {saveCrmSuccess}
                    </div>
                  )}
                  {saveCrmError && (
                    <div className="mb-3 text-xs rounded-lg px-3 py-2" style={{ background: '#FFF0F0', color: '#B71C1C' }}>
                      {saveCrmError}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <a href={getMailingDownloadUrl(matchId, 'mailable-records', 'mailable')} download className="btn-primary text-sm no-underline" style={{ padding: '8px 16px' }}>
                      Mailable Records ({(matchResult.mailable_count ?? 0).toLocaleString()})
                    </a>
                    <a href={getMailingDownloadUrl(matchId, 'high-confidence', 'high-confidence')} download className="btn-secondary text-sm no-underline">High Confidence Only</a>
                    <a href={getMatchedLeadsDownloadUrl(matchId, 'matched-leads')} download className="btn-secondary text-sm no-underline">Matched Only</a>
                    <a href={getMailingDownloadUrl(matchId, 'full-list', 'full')} download className="btn-secondary text-sm no-underline">Full List</a>
                  </div>
                  <p className="text-[10px] mt-2" style={{ color: '#9B8AAE' }}>Mailable Records = MATCHED + LP_FALLBACK above offer floor · ready for mail house</p>
                </div>
              )
            })()}

            {/* Result summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <ResultCard label="Mailable" value={(matchResult.mailable_count ?? 0).toLocaleString()} accent="#2D7A4F" sub="Priced · above floor" />
              <ResultCard label="Low Offer" value={(matchResult.low_offer_count ?? 0).toLocaleString()} accent="#f59e0b" sub="Below min offer" />
              <ResultCard label="Low Value" value={(matchResult.low_value_count ?? 0).toLocaleString()} accent="#f97316" sub="Retail too low" />
              <ResultCard label="Unpriced" value={(matchResult.unpriced_count ?? 0).toLocaleString()} accent="#6B5B8A" sub="No comps / LP data" />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
              <ResultCard label="Total Targets" value={matchResult.total_targets.toLocaleString()} accent="#5C2977" />
              <ResultCard label="Comp-Matched" value={matchResult.matched_count.toLocaleString()} accent="#2D7A4F" />
              <ResultCard label="LP Fallback" value={(matchResult.lp_fallback_count ?? 0).toLocaleString()} accent="#8B4DB8" sub="Priced from LP Est." />
            </div>

            {/* Assignment fee calculator */}
            {(() => {
              const fee = parseFloat(assignmentFee) || 0
              const supporting = matchResult.results.filter(r => {
                const retail = r.retail_estimate
                const offer = r.suggested_offer_mid
                return retail != null && offer != null && retail >= offer + fee
              }).length
              return (
                <div className="card mb-6">
                  <h2 className="font-semibold mb-3" style={{ color: '#1A0A2E' }}>Assignment Fee Calculator</h2>
                  <div className="flex items-end gap-4 flex-wrap">
                    <div>
                      <label className="text-xs block mb-1" style={{ color: '#6B5B8A' }}>Target Assignment Fee</label>
                      <div className="flex items-center gap-2">
                        <span className="text-sm" style={{ color: '#6B5B8A' }}>$</span>
                        <input type="number" min="0" step="500" placeholder="5000"
                          className="input-base text-sm py-2"
                          style={{ width: 120 }}
                          value={assignmentFee}
                          onChange={e => setAssignmentFee(e.target.value)} />
                      </div>
                    </div>
                    <div className="rounded-xl px-4 py-3" style={{ background: supporting > 0 ? 'rgba(45,122,79,0.08)' : 'rgba(239,68,68,0.08)', border: `1px solid ${supporting > 0 ? 'rgba(45,122,79,0.25)' : 'rgba(239,68,68,0.25)'}` }}>
                      <p className="text-sm font-semibold" style={{ color: supporting > 0 ? '#2D7A4F' : '#dc2626' }}>
                        {supporting.toLocaleString()} record{supporting !== 1 ? 's' : ''} support a ${Number(assignmentFee || 0).toLocaleString()} assignment fee
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: '#6B5B8A' }}>
                        Formula: retail estimate ≥ offer + ${Number(assignmentFee || 0).toLocaleString()} assignment fee
                      </p>
                    </div>
                  </div>
                </div>
              )
            })()}

            {matchResult.warnings && matchResult.warnings.filter(w => w.includes('Excluded') || w.includes('WARNING')).length > 0 && (
              <div className="mb-4 p-3 rounded-lg" style={{ background: '#FEF3C7', border: '1px solid #F59E0B' }}>
                <p className="text-xs font-semibold mb-1" style={{ color: '#92400E' }}>Filters Applied:</p>
                {matchResult.warnings.filter(w => w.includes('Excluded') || w.includes('WARNING')).map((w, i) => (
                  <p key={i} className="text-xs" style={{ color: '#78350F' }}>{w}</p>
                ))}
              </div>
            )}

            <div className="flex items-center gap-3 mb-5">
              <span className="text-xs" style={{ color: '#6B5B8A' }}>Score distribution:</span>
              {[5, 4, 3, 2, 1, 0].map(s => {
                const count = matchResult.results.filter(r => r.match_score === s).length
                if (count === 0) return null
                return (
                  <span key={s} className="flex items-center gap-1.5">
                    <ScoreBadge score={s} />
                    <span className="text-xs" style={{ color: '#6B5B8A' }}>{count.toLocaleString()}</span>
                  </span>
                )
              })}
            </div>

            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold" style={{ color: '#1A0A2E' }}>
                  Matched Parcels
                  <span className="text-sm font-normal ml-2" style={{ color: '#6B5B8A' }}>sorted by score</span>
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

            <div className="mt-6 flex justify-end">
              <button className="btn-primary" onClick={() => setCurrentPage('mailing-list')}>
                Generate Mailing List →
              </button>
            </div>
          </>
        )}
      </div>

      {/* Add to Mailing List modal */}
      {showMailingModal && matchResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(26,10,46,0.55)' }}
          onClick={e => { if (e.target === e.currentTarget) setShowMailingModal(false) }}>
          <div className="bg-white rounded-2xl p-6 shadow-xl" style={{ maxWidth: '480px', width: '100%' }}>
            <h2 className="section-heading mb-1">Add to Mailing List</h2>
            <p className="text-xs mb-4" style={{ color: '#9B8AAE' }}>
              Insert match results into a CRM campaign as leads.
            </p>

            <div className="flex flex-col gap-1 mb-3">
              <label className="label-caps">Records to add</label>
              <div className="flex gap-2">
                {(['mailable', 'matched'] as const).map(t => (
                  <button key={t} onClick={() => setMailingExportType(t)}
                    className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${mailingExportType === t ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                    {t === 'mailable' ? `Mailable (${(matchResult.mailable_count ?? 0).toLocaleString()})` : `Matched Only (${matchResult.matched_count.toLocaleString()})`}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1 mb-4">
              <label className="label-caps">Campaign</label>
              <select
                className="input-base text-sm"
                value={selectedCampaignId}
                onChange={e => setSelectedCampaignId(e.target.value)}
                onClick={async () => {
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
            </div>

            {mailingError && <p className="text-xs mb-3" style={{ color: '#B71C1C' }}>{mailingError}</p>}
            {mailingSuccess && <p className="text-xs mb-3 font-medium" style={{ color: '#2D7A4F' }}>{mailingSuccess}</p>}

            <div className="flex gap-3">
              <button className="btn-secondary flex-1" onClick={() => { setShowMailingModal(false); setMailingSuccess(null); setMailingError(null) }} disabled={mailingLoading}>Cancel</button>
              <button
                className="btn-primary flex-1"
                disabled={mailingLoading || !selectedCampaignId}
                onClick={async () => {
                  setMailingLoading(true)
                  setMailingError(null)
                  setMailingSuccess(null)
                  try {
                    let campaignId = selectedCampaignId
                    let campaignName = mailingCampaigns.find(c => c.id === campaignId)?.name ?? 'Campaign'
                    if (selectedCampaignId === '__new__') {
                      const topCounty = dashboardData?.top_counties?.[0] ?? ''
                      const topState = dashboardData?.top_states?.[0] ?? ''
                      const created = await autoCreateCampaign({ county: topCounty, state: topState })
                      campaignId = created.campaign_id
                      campaignName = created.name
                    }
                    const result = await addMatchResultsToCampaign(campaignId, matchResult.match_id, mailingExportType)
                    setMailingSuccess(`${result.imported.toLocaleString()} records added to "${campaignName}". Go to Campaigns to view.`)
                    setSelectedCampaignId('')
                  } catch (e: unknown) {
                    const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
                    setMailingError(detail ?? 'Failed to add records.')
                  } finally { setMailingLoading(false) }
                }}
              >
                {mailingLoading ? 'Adding…' : 'Add Records'}
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
      style={{ background: score === 5 ? '#2D7A4F' : score === 4 ? '#5C2977' : score === 3 ? '#D5A940' : score === 2 ? '#C06820' : '#B03030' }}
    >
      {score}
    </span>
  )
}

function ResultCard({ label, value, accent, sub }: { label: string; value: string; accent: string; sub?: string }) {
  return (
    <div className="rounded-xl p-4" style={{ background: '#F8F6FB', border: '1px solid #E8E0F0' }}>
      <p className="text-xs uppercase tracking-wider mb-1" style={{ color: '#6B5B8A' }}>{label}</p>
      <p className="text-2xl font-bold" style={{ color: accent }}>{value}</p>
      {sub && <p className="text-[10px] mt-0.5" style={{ color: '#9B8AAE' }}>{sub}</p>}
    </div>
  )
}
