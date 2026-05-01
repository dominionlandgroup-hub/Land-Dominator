import React, { useState, useEffect } from 'react'
import FileUpload from '../components/FileUpload'
import DataTable from '../components/DataTable'
import LoadingSpinner from '../components/LoadingSpinner'
import LoadingOverlay from '../components/LoadingOverlay'
import { useApp } from '../context/AppContext'
import { uploadTargets, runMatch, getMailingDownloadUrl, getMatchedLeadsDownloadUrl } from '../api/client'
import type { Column } from '../components/DataTable'
import type { MatchedParcel, MatchFilters } from '../types'
import { getConfidence } from '../types'
import MatchMap from '../components/MatchMap'
import WelcomeScreen from './WelcomeScreen'

const SQFT_PER_ACRE = 43560

export default function MatchTargets() {
  const {
    compsStats,
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

  const [minScore, setMinScore] = useState<number>(Number(init?.min_match_score ?? 0))
  const [zipFilter, setZipFilter] = useState<string[]>((init?.zip_filter as string[]) ?? [])
  const [zipInputText, setZipInputText] = useState<string>(((init?.zip_filter as string[]) ?? []).join(', '))
  const [minAcreage, setMinAcreage] = useState<string>(init?.min_acreage != null ? String(init.min_acreage) : '')
  const [maxAcreage, setMaxAcreage] = useState<string>(init?.max_acreage != null ? String(init.max_acreage) : '')
  const [floodZoneFilter, setFloodZoneFilter] = useState<'all' | 'exclude' | 'only'>((init?.flood_zone_filter as 'all' | 'exclude' | 'only') ?? 'exclude')
  const [minBuildability, setMinBuildability] = useState<number>(Number(init?.min_buildability ?? 80))
  const [excludeLandLocked, setExcludeLandLocked] = useState<boolean>(init ? Boolean(init.exclude_land_locked || init.exclude_landlocked) : true)
  const [requireRoadFrontage, setRequireRoadFrontage] = useState<boolean>(init ? Boolean(init.require_road_frontage) : true)
  const [maxSlope, setMaxSlope] = useState<number>(10)
  const [vacantOnly, setVacantOnly] = useState<boolean>(Boolean(init?.vacant_only))
  const [requireTlp, setRequireTlp] = useState<boolean>(Boolean(init?.require_tlp_estimate || init?.require_tlp))
  const [priceCeiling, setPriceCeiling] = useState<string>(init?.price_ceiling != null ? String(init.price_ceiling) : '')

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

  // Top 10 ZIPs from dashboard for "Use Buy Box ZIPs"
  const top10Zips = [...(dashboardData?.zip_stats ?? [])]
    .sort((a, b) => b.sales_count - a.sales_count)
    .slice(0, 10)
    .map(z => z.zip_code)

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
      min_buildability: minBuildability > 0 ? minBuildability : null,
      vacant_only: vacantOnly,
      require_road_frontage: requireRoadFrontage,
      exclude_landlocked: excludeLandLocked,
      exclude_land_locked: excludeLandLocked,
      require_tlp: requireTlp,
      require_tlp_estimate: requireTlp,
      price_ceiling: priceCeiling ? parseFloat(priceCeiling) : null,
      exclude_with_buildings: true,
      min_road_frontage: 50.0,
      max_retail_price: 200000,
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
  if (minBuildability > 0) filterParts.push(`Buildability ${minBuildability}%+`)
  if (maxSlope < 30) filterParts.push(`Slope ≤${maxSlope}%`)
  if (floodZoneFilter === 'exclude') filterParts.push('No flood zone')
  if (floodZoneFilter === 'only') filterParts.push('Flood zones only')
  if (excludeLandLocked) filterParts.push('No landlocked')
  if (requireRoadFrontage) filterParts.push('Road frontage required')
  if (requireTlp) filterParts.push('TLP required')
  if (priceCeiling) filterParts.push(`TLP ≤ $${Number(priceCeiling).toLocaleString()}`)
  const filterSummary = filterParts.length > 0
    ? `Active filters: ${filterParts.join(' · ')}`
    : 'No filters active — matching all targets'

  if (!compsStats) {
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

        {/* ── Upload + Radius info ────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <div className="card">
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

          <div className="card">
            <h2 className="font-semibold mb-3" style={{ color: '#1A0A2E' }}>Matching Settings</h2>
            <div className="space-y-3">
              <div className="rounded-lg px-3 py-2" style={{ backgroundColor: '#F3EEFA', border: '1px solid #E0D4F0' }}>
                <div className="flex justify-between text-sm">
                  <span style={{ color: '#6B5B8A' }}>Comp Radius</span>
                  <span className="font-medium" style={{ color: '#5C2977' }}>Max 1 mi radius</span>
                </div>
                <p className="text-xs mt-0.5" style={{ color: '#9B8AAE' }}>Fixed. Comps within 1 mile are used. No fallback beyond 1 mile.</p>
              </div>
              <div className="rounded-lg px-3 py-2" style={{ backgroundColor: '#F3EEFA', border: '1px solid #E0D4F0' }}>
                <p className="text-xs" style={{ color: '#5C2977' }}>
                  Acreage bands: Micro (0–0.5 ac) · Small (0.5–2 ac) · Medium (2–10 ac) · Large (10–50 ac) · XL (50+ ac)
                </p>
              </div>
              <div title="Only include parcels with a match score at or above this threshold">
                <SliderRow label="Min Match Score" value={minScore} onChange={setMinScore} min={0} max={5} step={1} display={`${minScore} / 5`} />
              </div>
            </div>
          </div>
        </div>

        {/* ── ZIP Filter ──────────────────────────────────────── */}
        <div className="card mb-6">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm font-medium" style={{ color: '#1A0A2E' }}>ZIP Code Filter</p>
              <p className="text-xs mt-0.5" style={{ color: '#6B5B8A' }}>Enter ZIP codes separated by commas, or use your Buy Box ZIPs</p>
            </div>
            <div className="flex gap-2">
              {top10Zips.length > 0 && (
                <button
                  className="btn-secondary text-xs"
                  style={{ padding: '6px 12px' }}
                  onClick={useBuyBoxZips}
                >
                  Use Buy Box ZIPs
                </button>
              )}
              {zipFilter.length > 0 && (
                <button
                  className="text-xs"
                  style={{ color: '#6B5B8A' }}
                  onClick={clearZips}
                >
                  Clear
                </button>
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
            <p className="text-xs mt-2" style={{ color: '#6B5B8A' }}>
              {zipFilter.length} ZIP{zipFilter.length !== 1 ? 's' : ''} selected: {zipFilter.join(', ')}
            </p>
          )}
        </div>

        {/* ── Smart Filters ───────────────────────────────────── */}
        <div className="card mb-6">
          <h2 className="font-semibold mb-5" style={{ color: '#1A0A2E' }}>
            Smart Filters
            <span className="text-xs font-normal ml-2" style={{ color: '#6B5B8A' }}>Defaults match your buy box settings</span>
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Acreage Range */}
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

            {/* Flood Zone */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: '#6B5B8A' }}>Flood Zone</p>
              <div className="inline-flex rounded-lg overflow-hidden" style={{ border: '1px solid #E8E0F0' }}>
                <button className="px-4 py-2 text-xs transition-all" style={floodZoneFilter === 'exclude' ? { background: '#5C2977', color: 'white' } : { background: '#FFFFFF', color: '#6B5B8A' }} onClick={() => setFloodZoneFilter('exclude')}>Exclude</button>
                <button className="px-4 py-2 text-xs transition-all" style={floodZoneFilter === 'all' ? { background: '#5C2977', color: 'white' } : { background: '#FFFFFF', color: '#6B5B8A' }} onClick={() => setFloodZoneFilter('all')}>Include All</button>
                <button className="px-4 py-2 text-xs transition-all" style={floodZoneFilter === 'only' ? { background: '#5C2977', color: 'white' } : { background: '#FFFFFF', color: '#6B5B8A' }} onClick={() => setFloodZoneFilter('only')}>Only Flood</button>
              </div>
              <p className="text-[10px] mt-1.5" style={{ color: '#9B8AAE' }}>Exclude = no FEMA flood zones (recommended)</p>
            </div>

            {/* Buildability */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: '#6B5B8A' }}>Buildability Minimum</p>
              <SliderRow label="" value={minBuildability} onChange={setMinBuildability} min={0} max={100} step={5} display={minBuildability > 0 ? `${minBuildability}%+` : 'Any'} />
              <p className="text-[10px] mt-1" style={{ color: '#9B8AAE' }}>80% is the buy box recommendation</p>
            </div>

            {/* Max Slope */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: '#6B5B8A' }}>Maximum Slope</p>
              <SliderRow label="" value={maxSlope} onChange={setMaxSlope} min={0} max={30} step={1} display={`≤${maxSlope}%`} />
              <p className="text-[10px] mt-1" style={{ color: '#9B8AAE' }}>10% is the buy box recommendation</p>
            </div>

            {/* Land Locked */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: '#6B5B8A' }}>Landlocked Parcels</p>
              <div className="inline-flex rounded-lg overflow-hidden" style={{ border: '1px solid #E8E0F0' }}>
                <button className="px-4 py-2 text-xs transition-all" style={excludeLandLocked ? { background: '#5C2977', color: 'white' } : { background: '#FFFFFF', color: '#6B5B8A' }} onClick={() => setExcludeLandLocked(true)}>Exclude</button>
                <button className="px-4 py-2 text-xs transition-all" style={!excludeLandLocked ? { background: '#5C2977', color: 'white' } : { background: '#FFFFFF', color: '#6B5B8A' }} onClick={() => setExcludeLandLocked(false)}>Include</button>
              </div>
            </div>

            {/* Road Frontage */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: '#6B5B8A' }}>Road Frontage</p>
              <div className="inline-flex rounded-lg overflow-hidden" style={{ border: '1px solid #E8E0F0' }}>
                <button className="px-4 py-2 text-xs transition-all" style={requireRoadFrontage ? { background: '#5C2977', color: 'white' } : { background: '#FFFFFF', color: '#6B5B8A' }} onClick={() => setRequireRoadFrontage(true)}>Required</button>
                <button className="px-4 py-2 text-xs transition-all" style={!requireRoadFrontage ? { background: '#5C2977', color: 'white' } : { background: '#FFFFFF', color: '#6B5B8A' }} onClick={() => setRequireRoadFrontage(false)}>Optional</button>
              </div>
            </div>
          </div>

          {/* Advanced toggles */}
          <div className="mt-5 pt-4" style={{ borderTop: '1px solid #E8E0F0' }}>
            <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: '#6B5B8A' }}>Additional Filters</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <ToggleOption label="Vacant land only" checked={vacantOnly} onChange={setVacantOnly} />
              <ToggleOption label="Require TLP estimate" checked={requireTlp} onChange={setRequireTlp} />
            </div>
            {requireTlp && (
              <div className="mt-3 max-w-xs">
                <label className="text-xs block mb-1" style={{ color: '#6B5B8A' }}>Price ceiling (TLP Estimate)</label>
                <input type="number" min="0" step="1000" placeholder="e.g. 120000" className="input-base text-xs py-2" value={priceCeiling} onChange={e => setPriceCeiling(e.target.value)} />
              </div>
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
            {(() => {
              const matchId = matchResult.match_id
              return (
                <div className="card mb-6">
                  <h2 className="font-semibold mb-4" style={{ color: '#1A0A2E' }}>Download Results</h2>
                  <div className="flex flex-wrap gap-2">
                    <a href={getMatchedLeadsDownloadUrl(matchId, 'matched-leads')} download className="btn-secondary text-sm no-underline">Download Matched Leads</a>
                    <a href={getMailingDownloadUrl(matchId, 'top-500', 'top500')} download className="btn-secondary text-sm no-underline">Top 500</a>
                    <a href={getMailingDownloadUrl(matchId, 'high-confidence', 'high-confidence')} download className="btn-secondary text-sm no-underline">High Confidence Only</a>
                    <a href={getMailingDownloadUrl(matchId, 'full-list', 'full')} download className="btn-secondary text-sm no-underline">Full List</a>
                  </div>
                </div>
              )
            })()}

            <div className="grid grid-cols-3 gap-4 mb-6">
              <ResultCard label="Total Targets" value={matchResult.total_targets.toLocaleString()} accent="#5C2977" />
              <ResultCard label="Matched" value={matchResult.matched_count.toLocaleString()} accent="#2D7A4F" />
              <ResultCard label="Match Rate" value={`${matchResult.total_targets > 0 ? Math.round((matchResult.matched_count / matchResult.total_targets) * 100) : 0}%`} accent="#8B4DB8" />
            </div>

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
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────

function SliderRow({ label, value, onChange, min, max, step, display }: {
  label: string; value: number; onChange: (v: number) => void
  min: number; max: number; step: number; display: string
}) {
  return (
    <div>
      {label && (
        <div className="flex justify-between text-sm mb-1.5">
          <span style={{ color: '#6B5B8A' }}>{label}</span>
          <span className="font-medium" style={{ color: '#5C2977' }}>{display}</span>
        </div>
      )}
      {!label && (
        <div className="flex justify-end mb-1">
          <span className="text-sm font-medium" style={{ color: '#5C2977' }}>{display}</span>
        </div>
      )}
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full cursor-pointer" style={{ accentColor: '#5C2977' }}
      />
      <div className="flex justify-between text-xs mt-0.5" style={{ color: '#9B8AAE' }}>
        <span>{min}</span><span>{max}</span>
      </div>
    </div>
  )
}

function ToggleOption({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <div
        onClick={() => onChange(!checked)}
        className="w-9 h-5 rounded-full relative transition-colors cursor-pointer"
        style={{ background: checked ? '#5C2977' : '#E8E0F0' }}
      >
        <div
          className="w-4 h-4 rounded-full absolute top-0.5 transition-transform"
          style={{ background: checked ? '#FFFFFF' : '#9B8AAE', transform: checked ? 'translateX(18px)' : 'translateX(2px)' }}
        />
      </div>
      <span className="text-xs select-none" style={{ color: checked ? '#1A0A2E' : '#6B5B8A' }}>{label}</span>
    </label>
  )
}

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

function ResultCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-xl p-4" style={{ background: '#F8F6FB', border: '1px solid #E8E0F0' }}>
      <p className="text-xs uppercase tracking-wider mb-1" style={{ color: '#6B5B8A' }}>{label}</p>
      <p className="text-2xl font-bold" style={{ color: accent }}>{value}</p>
    </div>
  )
}
