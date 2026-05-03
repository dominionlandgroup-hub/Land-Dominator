import React, { useState, useEffect } from 'react'
import FileUpload from '../components/FileUpload'
import DataTable from '../components/DataTable'
import LoadingSpinner from '../components/LoadingSpinner'
import LoadingOverlay from '../components/LoadingOverlay'
import { useApp } from '../context/AppContext'
import { uploadTargets, runMatch, getMatchJobStatus, getMailingDownloadUrl, getMatchedLeadsDownloadUrl, getDbCompsCount } from '../api/client'
import { listCrmCampaigns, autoCreateCampaign, addMatchResultsToCampaign, getMatchFilters, saveMatchFilters } from '../api/crm'
import type { Column } from '../components/DataTable'
import type { MatchedParcel, MatchFilters } from '../types'
import { getConfidence } from '../types'
import MatchMap from '../components/MatchMap'
import WelcomeScreen from './WelcomeScreen'

const SQFT_PER_ACRE = 43560
const CLOSING_COSTS = 2000

function calcMatchFee(retailEstimate: number | null | undefined, offerMid: number | null | undefined): number | null {
  if (!retailEstimate || !offerMid || offerMid <= 0) return null
  const fee = Math.round(retailEstimate - offerMid - CLOSING_COSTS)
  return fee > 0 ? fee : 0
}

function fmtPrice(v: number | null | undefined): string {
  if (v == null || isNaN(v as number)) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v as number)
}

const fmt = (n: any) => (n ?? 0).toLocaleString()
const fmtPct = (n: any) => ((n ?? 0) as number).toFixed(1) + '%'

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
    listingsStats,
  } = useApp()

  const [uploadLoading, setUploadLoading] = useState(false)
  const [matchLoading, setMatchLoading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [matchError, setMatchError] = useState<string | null>(null)
  const [matchJobId, setMatchJobId] = useState<string | null>(null)
  const [matchProgress, setMatchProgress] = useState(0)
  const [matchTotal, setMatchTotal] = useState(0)
  const [matchStatusMsg, setMatchStatusMsg] = useState('')
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

  // Poll background job status every 5 seconds
  useEffect(() => {
    if (!matchJobId) return
    const interval = setInterval(async () => {
      try {
        const status = await getMatchJobStatus(matchJobId)
        setMatchProgress(status.progress)
        setMatchTotal(status.total)
        setMatchStatusMsg(status.message)
        if (status.status === 'complete' && status.result) {
          clearInterval(interval)
          setMatchJobId(null)
          setMatchResult(status.result)
          setMailingPreview(null)
          setMatchLoading(false)
          setMatchStatusMsg('')
        } else if (status.status === 'error') {
          clearInterval(interval)
          setMatchJobId(null)
          setMatchError(status.error ?? 'Background matching job failed.')
          setMatchLoading(false)
        }
      } catch {
        // Ignore transient polling errors
      }
    }, 5000)
    return () => clearInterval(interval)
  }, [matchJobId])

  // ── Filter state ────────────────────────────────────────────────────────
  const init = lastFilters

  const [minScore] = useState<number>(Number(init?.min_match_score ?? 0))
  const [zipFilter, setZipFilter] = useState<string[]>((init?.zip_filter as string[]) ?? [])
  const [zipInputText, setZipInputText] = useState<string>(((init?.zip_filter as string[]) ?? []).join(', '))
  const [minAcreage, setMinAcreage] = useState<string>(
    () => localStorage.getItem('matchTargets_acreage_min') ?? '0.1'
  )
  const [maxAcreage, setMaxAcreage] = useState<string>(
    () => localStorage.getItem('matchTargets_acreage_max') ?? '2.0'
  )
  // Only pre-fill from sweet spot if localStorage has no saved value
  const acreagePrefilled = React.useRef(
    localStorage.getItem('matchTargets_acreage_min') !== null
  )
  const [floodZoneFilter, setFloodZoneFilter] = useState<'all' | 'exclude' | 'only'>((init?.flood_zone_filter as 'all' | 'exclude' | 'only') ?? 'exclude')
  const [minOfferFloor, setMinOfferFloor] = useState<string>('10000')
  const [minLpEstimate, setMinLpEstimate] = useState<string>('20000')
  const [assignmentFee, setAssignmentFee] = useState<string>('5000')
  const [offerPct, setOfferPct] = useState<number>(
    () => parseFloat(localStorage.getItem('matchTargets_offer_pct') ?? '52.5')
  )

  // Add to Mailing List modal
  const [showMailingModal, setShowMailingModal] = useState(false)
  const [mailingCampaigns, setMailingCampaigns] = useState<{ id: string; name: string }[]>([])
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>('')
  const [mailingLoading, setMailingLoading] = useState(false)
  const [mailingSuccess, setMailingSuccess] = useState<string | null>(null)
  const [mailingError, setMailingError] = useState<string | null>(null)
  const [mailingExportType, setMailingExportType] = useState<'mailable' | 'matched'>('matched')
  const [excludeSlowMarkets, setExcludeSlowMarkets] = useState<boolean>(true)
  const [includeSlowInMailing, setIncludeSlowInMailing] = useState<boolean>(false)
  const [mailingDone, setMailingDone] = useState(false)
  const [showUnmatched, setShowUnmatched] = useState(false)
  const [showMatchedTable, setShowMatchedTable] = useState(false)

  // Persist acreage + offer pct to localStorage whenever values change
  useEffect(() => {
    localStorage.setItem('matchTargets_acreage_min', minAcreage)
    localStorage.setItem('matchTargets_acreage_max', maxAcreage)
  }, [minAcreage, maxAcreage])

  // Auto-set offer % based on detected state from target CSV
  useEffect(() => {
    if (!targetStats?.detected_state) return
    const state = targetStats.detected_state.toUpperCase()
    let defaultPct: number | null = null
    if (state === 'TN') defaultPct = 62.5
    else if (state === 'FL') defaultPct = 55.0
    else if (['NC', 'SC', 'GA', 'TX'].includes(state)) defaultPct = 52.5
    if (defaultPct !== null) {
      setOfferPct(defaultPct)
    }
  }, [targetStats?.detected_state])

  useEffect(() => {
    localStorage.setItem('matchTargets_offer_pct', String(offerPct))
  }, [offerPct])

  // Pre-fill acreage from sweet spot — only on first load when no localStorage value exists
  useEffect(() => {
    if (acreagePrefilled.current || !dashboardData) return
    acreagePrefilled.current = true
    const b = dashboardData.sweet_spot?.bucket
    if (b === '0-0.5')      { setMinAcreage('0.1'); setMaxAcreage('0.5') }
    else if (b === '0.5-1') { setMinAcreage('0.5'); setMaxAcreage('1.0') }
    else if (b === '1-2')   { setMinAcreage('1.0'); setMaxAcreage('2.0') }
    else if (b === '2-5')   { setMinAcreage('2.0'); setMaxAcreage('5.0') }
    else if (b === '5-10')  { setMinAcreage('5.0'); setMaxAcreage('10.0') }
    else if (b === '10+')   { setMinAcreage('10.0'); setMaxAcreage('40.0') }
    else                    { setMinAcreage('0.1'); setMaxAcreage('2.0') }
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
    setMatchJobId(null)
    setMatchProgress(0)
    setMatchStatusMsg('')

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
      offer_pct: offerPct,
    }

    // Persist filter settings
    saveMatchFilters({
      flood_zone_filter: floodZoneFilter,
      min_offer_floor: minOfferFloor ? parseFloat(minOfferFloor) : 10000,
      min_lp_estimate: minLpEstimate ? parseFloat(minLpEstimate) : 20000,
    }).catch(() => {})

    try {
      const response = await runMatch(filters)
      if ('is_background' in response && response.is_background) {
        // Large file — background job started
        setMatchJobId(response.job_id)
        setMatchTotal(response.total_targets)
        setMatchStatusMsg(response.message)
        setLastFilters(filters)
        // Keep matchLoading=true; polling useEffect will clear it on completion
      } else {
        // Small file — synchronous result
        setMatchResult(response as import('../types').MatchResult)
        setMailingPreview(null)
        setLastFilters(filters)
        setMatchLoading(false)
      }
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Matching failed.'
      setMatchError(msg)
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
  filterParts.push(`${offerPct.toFixed(1)}% offer`)
  if (excludeSlowMarkets && listingsStats?.zip_velocity) filterParts.push('Exclude slow markets')

  const slowMarketZips = React.useMemo(() => {
    if (!matchResult || !listingsStats?.zip_velocity) return [] as { zip: string; months: number }[]
    const seen = new Set<string>()
    const out: { zip: string; months: number }[] = []
    for (const r of matchResult.results) {
      const vel = listingsStats.zip_velocity[r.parcel_zip]
      if (vel?.velocity_label === 'SLOW' && r.parcel_zip && !seen.has(r.parcel_zip)) {
        seen.add(r.parcel_zip)
        out.push({ zip: r.parcel_zip, months: vel.months_supply })
      }
    }
    return out.sort((a, b) => b.months - a.months)
  }, [matchResult, listingsStats])

  const displayedResults = React.useMemo(() => {
    if (!matchResult) return [] as import('../types').MatchedParcel[]
    let results = matchResult.results
    if (excludeSlowMarkets && listingsStats?.zip_velocity) {
      results = results.filter(r => {
        const vel = listingsStats.zip_velocity?.[r.parcel_zip]
        return !vel || vel.velocity_label !== 'SLOW'
      })
    }
    // Default sort: highest estimated assignment fee first
    return [...results].sort((a, b) => {
      const fa = calcMatchFee(a.retail_estimate, a.suggested_offer_mid) ?? -1
      const fb = calcMatchFee(b.retail_estimate, b.suggested_offer_mid) ?? -1
      return fb - fa
    })
  }, [matchResult, excludeSlowMarkets, listingsStats])
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
    {
      key: 'suggested_offer_mid', header: 'Offer Mid', sortable: true, align: 'right',
      render: (v, row) => {
        const offerMid = v as number | null
        const medianComp = row.median_comp_sale_price
        const isLowOffer = offerMid != null && medianComp != null && medianComp > 0 && offerMid < medianComp * 0.20
        return (
          <span
            className="font-semibold"
            style={{ color: isLowOffer ? '#D97706' : '#10B981' }}
            title={isLowOffer ? `Offer price (${fmtPrice(offerMid)}) is significantly below comp values (${fmtPrice(medianComp)} avg). Review before mailing.` : undefined}
          >
            {fmtPrice(offerMid)}{isLowOffer && ' ⚠️'}
          </span>
        )
      },
    },
    { key: 'suggested_offer_high', header: 'Offer High', align: 'right', render: (v) => <span className="text-xs" style={{ color: '#9CA3AF' }}>{fmtPrice(v as number)}</span> },
    {
      key: '_fee', header: 'Est. Fee', sortable: false, align: 'right',
      render: (_, row) => {
        const fee = calcMatchFee(row.retail_estimate, row.suggested_offer_mid)
        if (fee == null) return <span style={{ color: '#9CA3AF', fontSize: 11 }}>—</span>
        const color = fee >= 10000 ? '#059669' : fee >= 5000 ? '#D97706' : '#9CA3AF'
        return (
          <span style={{ fontSize: 12, fontWeight: 700, color }}>
            {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(fee)}
          </span>
        )
      },
    },
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
    {
      key: '_vel', header: 'Market', defaultHidden: false,
      render: (_, row) => {
        const vel = listingsStats?.zip_velocity?.[row.parcel_zip]
        if (!vel) return <span style={{ color: '#9CA3AF', fontSize: 10 }}>—</span>
        const isSlow = vel.velocity_label === 'SLOW'
        const color = vel.velocity_label === 'HOT' ? '#DC2626' : vel.velocity_label === 'BALANCED' ? '#D97706' : '#6B7280'
        return (
          <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 4, color, background: `${color}12`, border: `1px solid ${color}30` }}>
            {isSlow ? '⚠️ ' : ''}{vel.velocity_label} {vel.months_supply}mo
          </span>
        )
      },
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
          {targetStats?.detected_state && (() => {
            const state = targetStats.detected_state!.toUpperCase()
            const pct = state === 'TN' ? 62.5 : state === 'FL' ? 55.0 : ['NC','SC','GA','TX'].includes(state) ? 52.5 : null
            if (!pct) return null
            return (
              <div className="mt-2 px-3 py-2 rounded-lg text-xs flex items-center gap-2" style={{ background: 'rgba(79,70,229,0.06)', border: '1px solid rgba(79,70,229,0.15)', color: '#4F46E5' }}>
                <span>Detected: {state} targets — offer % set to {pct}%</span>
              </div>
            )
          })()}
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

          {/* 5. Offer Percentage */}
          <div className="mt-5 pt-5" style={{ borderTop: '1px solid #E5E7EB' }}>
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#6B7280' }}>Offer Percentage</p>
              <span className="text-sm font-bold" style={{ color: '#4F46E5' }}>{offerPct.toFixed(1)}% of comp value</span>
            </div>
            <input
              type="range" min="35" max="75" step="0.5"
              value={offerPct}
              onChange={e => setOfferPct(parseFloat(e.target.value))}
              className="w-full accent-indigo-600"
              style={{ height: 4 }}
            />
            <div className="flex justify-between text-[10px] mt-0.5" style={{ color: '#9CA3AF' }}>
              <span>35% — conservative offer</span>
              <span>52.5% — standard offer</span>
              <span>75% — aggressive offer</span>
            </div>
            {matchResult && (() => {
              const priced = matchResult.results.filter(r => r.suggested_offer_mid != null)
              if (priced.length === 0) return null
              const avgRetail = priced.reduce((s, r) => s + (r.retail_estimate ?? 0), 0) / priced.length
              const dynAvgOffer = avgRetail * (offerPct / 100)
              return (
                <p className="text-xs mt-1.5 font-medium" style={{ color: '#4F46E5' }}>
                  At {offerPct.toFixed(1)}%: avg offer {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(dynAvgOffer)}
                  <span className="font-normal ml-1" style={{ color: '#9CA3AF' }}>(re-run match to apply)</span>
                </p>
              )
            })()}
            {!matchResult && (
              <p className="text-[10px] mt-1" style={{ color: '#9CA3AF' }}>Offer = comp price per acre × acreage × percentage</p>
            )}
          </div>

          {/* 6. ZIP Filter */}
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

          {/* 7. Slow Market Filter */}
          {listingsStats?.zip_velocity && (
            <div className="mt-5 pt-5" style={{ borderTop: '1px solid #E5E7EB' }}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: '#6B7280' }}>Slow Market Filter</p>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={excludeSlowMarkets}
                  onChange={e => setExcludeSlowMarkets(e.target.checked)}
                  style={{ accentColor: '#4F46E5', width: 14, height: 14 }}
                />
                <span className="text-xs" style={{ color: '#374151' }}>Exclude slow markets (6+ months supply)</span>
              </label>
              <p className="text-[10px] mt-1.5" style={{ color: '#9CA3AF' }}>Based on active listings velocity data — DO NOT MAIL recommended</p>
            </div>
          )}
        </div>

        {/* ── Active Filters Summary ──────────────────────────── */}
        <div className="mb-5 px-4 py-3 rounded-xl text-xs" style={{ background: 'rgba(79,70,229,0.04)', border: '1px solid rgba(79,70,229,0.12)', color: '#4F46E5' }}>
          {filterSummary}
        </div>

        {/* ── Large file warning ──────────────────────────────── */}
        {targetStats && targetStats.total_rows > 5000 && !matchLoading && (
          <div className="mb-4 px-4 py-3 rounded-xl text-sm flex items-start gap-2" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', color: '#92400E' }}>
            <span style={{ fontSize: 16 }}>⚠</span>
            <span>
              Large file detected ({targetStats.total_rows.toLocaleString()} records). This will run as a background job and may take {Math.round(targetStats.total_rows / 6000) + 2}–{Math.round(targetStats.total_rows / 4000) + 3} minutes.
            </span>
          </div>
        )}

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
              <><LoadingSpinner size="sm" />{matchJobId ? 'Processing in background…' : 'Running…'}</>
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

          {/* Progress bar for background jobs */}
          {matchLoading && matchJobId && (
            <div className="mt-4 px-1">
              <p className="text-sm font-medium mb-2" style={{ color: '#4F46E5' }}>{matchStatusMsg || 'Starting…'}</p>
              <div className="relative h-3 rounded-full overflow-hidden" style={{ background: '#E0E7FF' }}>
                <div
                  className="absolute inset-y-0 left-0 rounded-full transition-all duration-700"
                  style={{
                    width: matchTotal > 0 ? `${Math.min(100, Math.round(matchProgress / matchTotal * 100))}%` : '0%',
                    background: 'linear-gradient(90deg, #4F46E5, #7C3AED)',
                  }}
                />
              </div>
              <p className="text-xs mt-1.5" style={{ color: '#6B7280' }}>
                {matchProgress.toLocaleString()} of {matchTotal.toLocaleString()} processed
                {matchTotal > 0 && ` · ${Math.min(100, Math.round(matchProgress / matchTotal * 100))}%`}
              </p>
            </div>
          )}

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
            {/* Offer pct badge */}
            <div className="mb-4 px-3 py-2 rounded-lg text-xs font-medium inline-flex items-center gap-1.5" style={{ background: 'rgba(79,70,229,0.06)', border: '1px solid rgba(79,70,229,0.15)', color: '#4F46E5' }}>
              <span>Offers calculated at {(matchResult.offer_pct ?? offerPct).toFixed(1)}% of LP estimate</span>
            </div>

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

            {/* Match rate banner — always visible */}
            {(() => {
              const distMatchedCt = matchResult.distance_matched_count ?? matchResult.matched_count ?? 0
              const totalTargets = matchResult.total_targets ?? 0
              const mrw = (matchResult as any).match_rate_warning as { level: string; match_rate_pct: number; message: string; top_unmatched_zips: string[] } | undefined
              const ratePct = mrw?.match_rate_pct != null
                ? mrw.match_rate_pct
                : totalTargets > 0 ? Math.round(distMatchedCt / totalTargets * 100) : 0
              const level = ratePct >= 80 ? 'ok' : ratePct >= 60 ? 'warning' : 'error'
              const icon = level === 'ok' ? '✓' : level === 'warning' ? '⚠️' : '✗'
              const color = level === 'ok' ? '#059669' : level === 'warning' ? '#D97706' : '#DC2626'
              const bg = level === 'ok' ? 'rgba(5,150,105,0.08)' : level === 'warning' ? 'rgba(245,158,11,0.1)' : 'rgba(220,38,38,0.08)'
              const border = level === 'ok' ? 'rgba(5,150,105,0.25)' : level === 'warning' ? 'rgba(245,158,11,0.3)' : 'rgba(220,38,38,0.25)'
              return (
                <div className="mb-4 px-4 py-3 rounded-xl flex items-center gap-3" style={{ background: bg, border: `1px solid ${border}` }}>
                  <span style={{ fontSize: 20, lineHeight: 1 }}>{icon}</span>
                  <div>
                    <p className="text-base font-bold" style={{ color }}>
                      {ratePct}% matched within 1 mile
                      {level !== 'ok' && <span className="text-sm font-normal ml-2" style={{ color }}>— {level === 'warning' ? 'below 80% target' : 'below 60% — low comp coverage'}</span>}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: '#6B7280' }}>
                      {distMatchedCt.toLocaleString()} of {totalTargets.toLocaleString()} targets have strong comps within 1 mile
                      {level !== 'ok' && mrw?.top_unmatched_zips?.length ? ` · Unmatched ZIPs: ${mrw.top_unmatched_zips.join(', ')}` : ''}
                    </p>
                  </div>
                </div>
              )
            })()}

            {/* Download exports + match summary */}
            {(() => {
              const matchId = matchResult.match_id
              const distMatchedCt = matchResult.distance_matched_count ?? matchResult.matched_count ?? 0
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
                        <span className="text-3xl font-bold" style={{ color: '#10B981' }}>{fmt(distMatchedCt)}</span>
                        <span className="text-sm font-semibold" style={{ color: '#10B981' }}>Distance-matched records (strong comps within 1 mile)</span>
                      </div>
                      <p className="text-[11px]" style={{ color: '#6B7280' }}>{(matchResult.total_targets ?? 0).toLocaleString()} total targets</p>
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
                            Match rate counts only records with LP comps within 1 mile. ZIP-matched and LP Fallback are excluded from this rate.
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Three-category breakdown */}
                  <div className="flex flex-col gap-2 mb-4">
                    <div className="rounded-lg px-3 py-2 flex items-center justify-between" style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.15)' }}>
                      <div>
                        <span className="text-sm font-semibold" style={{ color: '#059669' }}>Distance-matched: {fmt(distMatchedCt)} records</span>
                        <span className="text-xs ml-2" style={{ color: '#9CA3AF' }}>strong comps within 1 mile — recommended for mailing</span>
                      </div>
                      <a href={getMatchedLeadsDownloadUrl(matchId, 'comp-matched')} download className="btn-primary text-xs no-underline" style={{ padding: '4px 10px', flexShrink: 0 }}>
                        Download
                      </a>
                    </div>
                    {zipMatchedCt > 0 && (
                      <div className="rounded-lg px-3 py-2 flex items-center justify-between" style={{ background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.15)' }}>
                        <div>
                          <span className="text-sm font-semibold" style={{ color: '#2563EB' }}>ZIP-matched: {fmt(zipMatchedCt)} records</span>
                          <span className="text-xs ml-2" style={{ color: '#9CA3AF' }}>matched by ZIP code — less precise, use as bonus</span>
                        </div>
                        <a href={getMailingDownloadUrl(matchId, 'full-list', 'full')} download className="btn-secondary text-xs no-underline" style={{ padding: '4px 10px', flexShrink: 0 }}>
                          Download
                        </a>
                      </div>
                    )}
                    {lpFallbackCt > 0 && (
                      <div className="rounded-lg px-3 py-2" style={{ background: 'rgba(92,41,119,0.08)', border: '1px solid rgba(92,41,119,0.2)' }}>
                        <span className="text-sm font-semibold" style={{ color: '#7C3AED' }}>LP Fallback: {fmt(lpFallbackCt)} records</span>
                        <span className="text-xs ml-2" style={{ color: '#9CA3AF' }}>no local comps — priced from LP estimate only</span>
                      </div>
                    )}
                    {unpricedCt > 0 && (
                      <p className="text-[11px]" style={{ color: '#6B7280' }}>
                        {fmt(unpricedCt)} records have no data (no comps and no LP estimate) — skip these
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
              <ResultCard label="Comp-Matched" value={(matchResult.matched_count ?? 0).toLocaleString()} accent="#10B981" sub="Ready to mail" />
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

                  {showUnmatched && noCompRecords.length > 0 && (
                    <>
                      <p className="text-[10px] uppercase tracking-wide font-semibold mt-4 mb-2" style={{ color: '#6B7280' }}>Why records didn't match:</p>
                      <div className="flex flex-col gap-1 mb-4">
                        {Object.entries(reasonGroups).sort(([, a], [, b]) => b - a).map(([reason, count]) => (
                          <div key={reason} className="flex justify-between items-center px-2.5 py-1.5 rounded-lg" style={{ background: '#F3F4F6' }}>
                            <span className="text-xs" style={{ color: '#374151' }}>{reason}</span>
                            <span className="text-xs font-semibold tabular-nums" style={{ color: '#9CA3AF' }}>{(count ?? 0).toLocaleString()}</span>
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


            {/* Slow market warnings */}
            {slowMarketZips.length > 0 && !excludeSlowMarkets && (
              <div className="mb-4 p-3 rounded-lg" style={{ background: 'rgba(107,114,128,0.08)', border: '1px solid rgba(107,114,128,0.2)' }}>
                <p className="text-xs font-semibold mb-2" style={{ color: '#374151' }}>⚠️ Oversupplied Markets in Results:</p>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {slowMarketZips.map(({ zip, months }) => (
                    <span key={zip} style={{ fontSize: 11, fontFamily: 'monospace', padding: '2px 7px', borderRadius: 4, background: '#F3F4F6', color: '#6B7280', border: '1px solid #E5E7EB' }}>
                      ⚠️ {zip} — {months}mo supply — oversupplied market
                    </span>
                  ))}
                </div>
                <p className="text-[10px]" style={{ color: '#9CA3AF' }}>Enable "Exclude slow markets" filter to remove these from results and mailing</p>
              </div>
            )}
            {slowMarketZips.length > 0 && excludeSlowMarkets && (
              <div className="mb-4 px-3 py-2 rounded-lg flex items-center gap-2" style={{ background: 'rgba(107,114,128,0.06)', border: '1px solid rgba(107,114,128,0.15)' }}>
                <span style={{ fontSize: 13 }}>🚫</span>
                <p className="text-xs" style={{ color: '#6B7280' }}>
                  <strong>{slowMarketZips.length} slow-market ZIP{slowMarketZips.length !== 1 ? 's' : ''} excluded</strong> — DO NOT MAIL: {slowMarketZips.slice(0, 5).map(s => `${s.zip} (${s.months}mo)`).join(', ')}{slowMarketZips.length > 5 ? ` +${slowMarketZips.length - 5} more` : ''}
                </p>
              </div>
            )}

            <div className="card">
              <div
                className="flex items-center justify-between cursor-pointer"
                style={{ marginBottom: showMatchedTable ? 16 : 0 }}
                onClick={() => setShowMatchedTable(v => !v)}
              >
                <h2 className="font-semibold" style={{ color: '#111827' }}>
                  Matched Parcels
                  <span className="text-sm font-normal ml-2" style={{ color: '#9CA3AF' }}>{displayedResults.length.toLocaleString()} records</span>
                  {excludeSlowMarkets && slowMarketZips.length > 0 && (
                    <span className="ml-2 text-xs font-normal px-2 py-0.5 rounded-full" style={{ background: 'rgba(107,114,128,0.1)', color: '#6B7280' }}>
                      slow markets excluded
                    </span>
                  )}
                </h2>
                <div className="flex items-center gap-2">
                  <span className="text-sm" style={{ color: '#6B7280' }}>{showMatchedTable ? '▲ Hide' : '▼ Show'}</span>
                </div>
              </div>
              {showMatchedTable && (
                <>
                  <div className="flex justify-end mb-3">
                    <div className="inline-flex gap-1">
                      <button className={`toggle-btn${resultView === 'table' ? ' active' : ''}`} onClick={e => { e.stopPropagation(); setResultView('table') }}>Table</button>
                      <button className={`toggle-btn${resultView === 'map' ? ' active' : ''}`} onClick={e => { e.stopPropagation(); setResultView('map') }}>Map</button>
                    </div>
                  </div>
                  {resultView === 'table' ? (
                    <DataTable<MatchedParcel>
                      columns={cols}
                      data={displayedResults}
                      pageSize={50}
                      emptyMessage="No parcels matched with current filters"
                      searchable
                      searchKeys={['apn', 'owner_name', 'parcel_zip', 'parcel_city']}
                    />
                  ) : (
                    <MatchMap targets={displayedResults} comps={dashboardData?.comp_locations ?? []} radiusMiles={1} />
                  )}
                </>
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

            {(() => {
              const slowCount = slowMarketZips.reduce((n, { zip }) => {
                return n + matchResult.results.filter(r => r.parcel_zip === zip && r.pricing_flag === 'MATCHED').length
              }, 0)
              const exportCount = (matchResult.matched_count ?? 0) - (!includeSlowInMailing ? slowCount : 0)
              return (
                <div className="flex flex-col gap-1 mb-3">
                  <label className="label-caps">Records to add</label>
                  <div className="rounded-lg px-3 py-2 text-sm font-medium" style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', color: '#10B981' }}>
                    ✓ {exportCount.toLocaleString()} Comp-Matched Records
                  </div>
                  <p className="text-[10px] mt-0.5" style={{ color: '#10B981' }}>
                    Only records priced from local sold comps — LP Fallback records are excluded
                  </p>
                  {slowCount > 0 && listingsStats?.zip_velocity && (
                    <div className="mt-2 rounded-lg px-3 py-2" style={{ background: 'rgba(107,114,128,0.08)', border: '1px solid rgba(107,114,128,0.2)' }}>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={includeSlowInMailing}
                          onChange={e => setIncludeSlowInMailing(e.target.checked)}
                          style={{ accentColor: '#4F46E5', width: 13, height: 13 }}
                        />
                        <span className="text-[11px]" style={{ color: '#374151' }}>Include slow markets ({slowCount.toLocaleString()} records from {slowMarketZips.length} oversupplied ZIPs)</span>
                      </label>
                      <p className="text-[10px] mt-1" style={{ color: '#9CA3AF' }}>
                        {!includeSlowInMailing ? `🚫 Excluded by default — DO NOT MAIL: ${slowMarketZips.slice(0, 3).map(s => `${s.zip} (${s.months}mo)`).join(', ')}${slowMarketZips.length > 3 ? ` +${slowMarketZips.length - 3} more` : ''}` : '⚠️ Slow markets included — oversupplied, slower resale exit'}
                      </p>
                    </div>
                  )}
                </div>
              )
            })()}

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
                      const created = await autoCreateCampaign({ counties: allCounties, state: topState, offer_pct: matchResult.offer_pct ?? offerPct })
                      campaignId = created.campaign_id
                      campaignName = created.name
                      setMailingCampaigns(prev => [...prev, { id: created.campaign_id, name: created.name }])
                    }
                    const slowZipSet = new Set(slowMarketZips.map(s => s.zip))
                    const resultsForExport = (!includeSlowInMailing && listingsStats?.zip_velocity && slowZipSet.size > 0)
                      ? matchResult.results.filter(r => !slowZipSet.has(r.parcel_zip))
                      : matchResult.results
                    const result = await addMatchResultsToCampaign(
                      campaignId,
                      matchResult.match_id,
                      mailingExportType,
                      resultsForExport,
                      matchResult.offer_pct ?? offerPct,
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
