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

const DEFAULT_FILTERS: Omit<MatchFilters, 'session_id' | 'target_session_id'> = {
  radius_miles: 1,
  acreage_tolerance_pct: 50,
  min_match_score: 0,
  zip_filter: [],
  flood_zone_filter: 'all',
  min_acreage: null,
  max_acreage: null,
  exclude_flood: false,
  only_flood: false,
  min_buildability: null,
  vacant_only: false,
  require_road_frontage: false,
  exclude_landlocked: false,
  exclude_land_locked: false,
  require_tlp: false,
  require_tlp_estimate: false,
  price_ceiling: null,
  // Damien's auto-filters (March 2026) - always enabled by default
  exclude_with_buildings: true,      // Exclude properties with buildings
  min_road_frontage: 50.0,           // Minimum 50ft road frontage
  max_retail_price: 200000,          // $200K ceiling to exclude premium/waterfront
}

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
  const [showAdvanced, setShowAdvanced] = useState(true)
  const [resultView, setResultView] = useState<'table' | 'map'>('table')

  // Filter state — pre-fill from lastFilters if available (from "Duplicate Settings")
  const init = lastFilters ?? DEFAULT_FILTERS
  // radius_miles is fixed to the engine's hard maximum (max 1 mile)
  const acreageTol = 50
  const [minScore, setMinScore] = useState<number>(Number(init.min_match_score ?? 0))
  const [zipFilter, setZipFilter] = useState<string[]>((init.zip_filter as string[]) ?? [])
  const [minAcreage, setMinAcreage] = useState<string>(init.min_acreage != null ? String(init.min_acreage) : '')
  const [maxAcreage, setMaxAcreage] = useState<string>(init.max_acreage != null ? String(init.max_acreage) : '')
  const [excludeFlood, setExcludeFlood] = useState<boolean>(Boolean(init.exclude_flood))
  const [onlyFlood, setOnlyFlood] = useState<boolean>(Boolean(init.only_flood))
  const [floodZoneFilter, setFloodZoneFilter] = useState<'all' | 'exclude' | 'only'>((init.flood_zone_filter as 'all' | 'exclude' | 'only') ?? 'all')
  const [minBuildability, setMinBuildability] = useState<number>(Number(init.min_buildability ?? 0))
  const [useBuildability, setUseBuildability] = useState<boolean>(init.min_buildability != null)
  const [vacantOnly, setVacantOnly] = useState<boolean>(Boolean(init.vacant_only))
  const [requireRoadFrontage, setRequireRoadFrontage] = useState<boolean>(Boolean(init.require_road_frontage))
  const [excludeLandLocked, setExcludeLandLocked] = useState<boolean>(Boolean(init.exclude_land_locked || init.exclude_landlocked))
  const [requireTlp, setRequireTlp] = useState<boolean>(Boolean(init.require_tlp_estimate || init.require_tlp))
  const [priceCeiling, setPriceCeiling] = useState<string>(init.price_ceiling != null ? String(init.price_ceiling) : '')

  const availableZips = dashboardData?.available_zips ?? []

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
      radius_miles: 1, // engine hard max (kept for API compat)
      acreage_tolerance_pct: acreageTol,
      min_match_score: minScore,
      zip_filter: zipFilter,
      flood_zone_filter: floodZoneFilter,
      min_acreage: minAcreage ? parseFloat(minAcreage) : null,
      max_acreage: maxAcreage ? parseFloat(maxAcreage) : null,
      exclude_flood: floodZoneFilter === 'exclude' || excludeFlood,
      only_flood: floodZoneFilter === 'only' || onlyFlood,
      min_buildability: useBuildability ? minBuildability : null,
      vacant_only: vacantOnly,
      require_road_frontage: requireRoadFrontage,
      exclude_landlocked: excludeLandLocked,
      exclude_land_locked: excludeLandLocked,
      require_tlp: requireTlp,
      require_tlp_estimate: requireTlp,
      price_ceiling: priceCeiling ? parseFloat(priceCeiling) : null,
      // Damien's auto-filters (March 2026) - always enabled
      exclude_with_buildings: true,      // Exclude properties with buildings
      min_road_frontage: 50.0,           // Minimum 50ft road frontage
      max_retail_price: 200000,          // $200K ceiling filters premium/waterfront
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

  function toggleZip(zip: string) {
    setZipFilter((prev) => prev.includes(zip) ? prev.filter((z) => z !== zip) : [...prev, zip])
  }

  // Active filter chips
  const activeFilters: { label: string; onRemove?: () => void }[] = []
  activeFilters.push({ label: 'Max 1 mi radius' })
  activeFilters.push({ label: 'Fixed acreage bands' })
  if (minScore > 0) activeFilters.push({ label: `Score ≥ ${minScore}`, onRemove: () => setMinScore(0) })
  if (zipFilter.length > 0) activeFilters.push({ label: `ZIPs: ${zipFilter.join(', ')}`, onRemove: () => setZipFilter([]) })
  if (minAcreage) activeFilters.push({ label: `Min ${minAcreage} ac`, onRemove: () => setMinAcreage('') })
  if (maxAcreage) activeFilters.push({ label: `Max ${maxAcreage} ac`, onRemove: () => setMaxAcreage('') })
  if (floodZoneFilter === 'exclude') activeFilters.push({ label: 'Flood: exclude', onRemove: () => setFloodZoneFilter('all') })
  if (floodZoneFilter === 'only') activeFilters.push({ label: 'Flood: only', onRemove: () => setFloodZoneFilter('all') })
  if (useBuildability && minBuildability > 0) activeFilters.push({ label: `Buildable ≥${minBuildability}%`, onRemove: () => { setUseBuildability(false); setMinBuildability(0) } })
  if (vacantOnly) activeFilters.push({ label: 'Vacant only', onRemove: () => setVacantOnly(false) })
  if (requireRoadFrontage) activeFilters.push({ label: 'Road frontage', onRemove: () => setRequireRoadFrontage(false) })
  if (excludeLandLocked) activeFilters.push({ label: 'Not land locked', onRemove: () => setExcludeLandLocked(false) })
  if (requireTlp) activeFilters.push({ label: 'TLP required', onRemove: () => setRequireTlp(false) })
  if (priceCeiling) activeFilters.push({ label: `TLP <= $${Number(priceCeiling).toLocaleString()}`, onRemove: () => setPriceCeiling('') })

  if (!compsStats) {
    return <WelcomeScreen contextualMessage="Upload your comps first to enable matching." />
  }

  const cols: Column<MatchedParcel>[] = [
    {
      key: 'match_score', header: 'Score', sortable: true, align: 'center',
      render: (v) => <ScoreBadge score={v as number} />,
    },
    {
      key: 'confidence', header: 'Conf.', align: 'center', sortable: true,
      render: (_, row) => {
        const c = row.confidence || getConfidence(row.matched_comp_count)
        return <span className={`conf-${c}`}>{c}</span>
      },
    },
    { key: 'apn', header: 'APN', sortable: true, render: (v) => <span className="font-mono text-xs">{String(v || '—')}</span> },
    { key: 'owner_name', header: 'Owner', render: (v) => <span className="max-w-[160px] block truncate text-xs" title={String(v)}>{String(v || '—')}</span> },
    {
      key: 'owner_first_name',
      header: 'Owner First Name',
      defaultHidden: true,
      render: (v) => <span className="text-xs">{String(v || '—')}</span>,
    },
    {
      key: 'owner_last_name',
      header: 'Owner Last Name',
      defaultHidden: true,
      render: (v) => <span className="text-xs">{String(v || '—')}</span>,
    },
    { key: 'parcel_zip', header: 'ZIP', sortable: true },
    { key: 'parcel_city', header: 'City', defaultHidden: true },
    {
      key: 'parcel_address',
      header: 'Parcel Address',
      defaultHidden: true,
      render: (v) => (
        <span className="max-w-[220px] block truncate text-xs" title={String(v || '')}>
          {String(v || '—')}
        </span>
      ),
    },
    { key: 'parcel_state', header: 'Parcel State', defaultHidden: true, render: (v) => <span className="text-xs">{String(v || '—')}</span> },
    { key: 'parcel_county', header: 'Parcel County', defaultHidden: true, render: (v) => <span className="text-xs">{String(v || '—')}</span> },
    {
      key: 'latitude',
      header: 'Latitude',
      defaultHidden: true,
      align: 'right',
      render: (v) => (v == null ? <span style={{ color: '#9B8AAE' }}>—</span> : <span className="text-xs">{(v as number).toFixed(5)}</span>),
    },
    {
      key: 'longitude',
      header: 'Longitude',
      defaultHidden: true,
      align: 'right',
      render: (v) => (v == null ? <span style={{ color: '#9B8AAE' }}>—</span> : <span className="text-xs">{(v as number).toFixed(5)}</span>),
    },
    {
      key: 'lot_acres', header: 'Acres', sortable: true, align: 'right',
      render: (v) => v == null ? <span style={{ color: '#9B8AAE' }}>—</span> : <span>{(v as number).toFixed(2)}</span>,
    },
    {
      key: 'acreage_band', header: 'Band', sortable: true, align: 'center',
      render: (v) => <span className="text-xs" style={{ color: '#6B5B8A' }}>{String(v || '—')}</span>,
    },
    {
      key: 'matched_comp_count', header: 'Comps', sortable: true, align: 'center',
      render: (v) => <span className="text-xs">{String(v ?? '—')}</span>,
    },
    {
      key: 'comp_count',
      header: 'Comp Count',
      sortable: true,
      align: 'center',
      defaultHidden: true,
      render: (v) => <span className="text-xs">{String(v ?? '—')}</span>,
    },
    {
      key: 'closest_comp_distance',
      header: 'Distance to Closest Comp',
      sortable: true,
      align: 'right',
      defaultHidden: true,
      render: (v) => (v == null ? <span style={{ color: '#9B8AAE' }}>—</span> : <span className="text-xs">{(v as number).toFixed(2)}</span>),
    },
    {
      key: 'retail_estimate', header: 'Retail Est.', sortable: true, align: 'right',
      render: (v) => v == null ? <span style={{ color: '#9B8AAE' }}>—</span> : (
        <span className="text-xs" style={{ color: '#1A0A2E' }}>${Math.round(v as number).toLocaleString()}</span>
      ),
      defaultHidden: true,
    },
    {
      key: 'suggested_offer_low', header: 'Offer Low', align: 'right',
      render: (v) => v == null ? <span style={{ color: '#9B8AAE' }}>—</span> : <span className="text-xs" style={{ color: '#6B5B8A' }}>${Math.round(v as number).toLocaleString()}</span>,
    },
    {
      key: 'suggested_offer_mid', header: 'Offer Mid', sortable: true, align: 'right',
      render: (v) => v == null ? <span style={{ color: '#9B8AAE' }}>—</span> : (
        <span className="font-semibold" style={{ color: '#2D7A4F', fontWeight: 600 }}>${Math.round(v as number).toLocaleString()}</span>
      ),
    },
    {
      key: 'suggested_offer_high', header: 'Offer High', align: 'right',
      render: (v) => v == null ? <span style={{ color: '#9B8AAE' }}>—</span> : <span className="text-xs" style={{ color: '#6B5B8A' }}>${Math.round(v as number).toLocaleString()}</span>,
    },
    {
      key: 'median_comp_sale_price', header: 'Med. Comp $', align: 'right', defaultHidden: true,
      render: (v) => v == null ? <span style={{ color: '#9B8AAE' }}>—</span> : <span className="text-xs">${Math.round(v as number).toLocaleString()}</span>,
    },
    {
      key: 'median_ppa', header: 'Med. PPA', align: 'right', defaultHidden: true,
      render: (v) => v == null ? <span style={{ color: '#9B8AAE' }}>—</span> : <span className="text-xs">${Math.round(v as number).toLocaleString()}</span>,
    },
    {
      key: 'min_comp_price', header: 'Min Comp $', align: 'right', defaultHidden: true,
      render: (v) => v == null ? <span style={{ color: '#9B8AAE' }}>—</span> : <span className="text-xs">${Math.round(v as number).toLocaleString()}</span>,
    },
    {
      key: 'max_comp_price', header: 'Max Comp $', align: 'right', defaultHidden: true,
      render: (v) => v == null ? <span style={{ color: '#9B8AAE' }}>—</span> : <span className="text-xs">${Math.round(v as number).toLocaleString()}</span>,
    },
    {
      key: 'outliers_removed', header: 'Outliers', align: 'center', defaultHidden: true,
      render: (v) => <span className="text-xs">{String(v ?? 0)}</span>,
    },
    {
      key: 'tlp_estimate', header: 'TLP Est.', align: 'right', defaultHidden: true,
      render: (v) => v == null ? <span style={{ color: '#9B8AAE' }}>—</span> : <span className="text-xs" style={{ color: '#6B5B8A' }}>${Math.round(v as number).toLocaleString()}</span>,
    },
    {
      key: 'tlp_capped', header: 'TLP Cap', align: 'center', defaultHidden: true,
      render: (v) => <span className="text-xs">{v ? 'Yes' : 'No'}</span>,
    },
    {
      key: 'flood_zone', header: 'Flood', defaultHidden: true,
      render: (v) => <span className="text-xs" style={{ color: '#6B5B8A' }}>{String(v || '—')}</span>,
    },
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
      {/* Page header */}
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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Upload targets */}
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
                <button
                  className="text-xs hover:text-gray-300 transition-colors"
                  style={{ color: '#6B5B8A' }}
                  onClick={() => { setTargetStats(null); setFileName(null) }}
                >
                  Replace
                </button>
              </div>
            ) : (
              <FileUpload
                label="Drop Target Parcels CSV"
                hint="Land Portal export — same format as comps"
                onFile={handleFile}
                loading={uploadLoading}
              />
            )}
            {uploadError && <p className="text-red-400 text-sm mt-2">{uploadError}</p>}
          </div>

          {/* Core filters */}
          <div className="card">
            <h2 className="font-semibold mb-4" style={{ color: '#1A0A2E' }}>Matching Parameters</h2>
            <div className="space-y-4">
              {/* Comp radius is fixed at max 1 mile — not user-adjustable */}
              <div className="rounded-lg px-3 py-2" style={{ backgroundColor: '#F3EEFA', border: '1px solid #E0D4F0' }}>
                <div className="flex justify-between text-sm">
                  <span style={{ color: '#6B5B8A' }}>Comp Radius</span>
                  <span className="font-medium" style={{ color: '#5C2977' }}>Max 1 mi radius</span>
                </div>
                <p className="text-xs mt-1" style={{ color: '#9B8AAE' }}>
                  Comps within 1 mile are used. No fallback beyond 1 mile.
                </p>
              </div>
              <div className="rounded-lg px-3 py-2" style={{ backgroundColor: '#F3EEFA', border: '1px solid #E0D4F0' }}>
                <div className="text-sm" style={{ color: '#5C2977' }}>
                  Acreage matching uses fixed bands: Micro (0–0.5 ac) · Small (0.5–2 ac) · Medium (2–10 ac) · Large (10–50 ac) · XL (50+ ac)
                </div>
              </div>
              <div title="Only include parcels with a match score at or above this threshold (0 = include all, 5 = highest quality only)">
                <SliderRow label="Min Match Score" value={minScore} onChange={setMinScore} min={0} max={5} step={1} display={`${minScore} / 5`} />
              </div>
            </div>
          </div>
        </div>

        {/* ZIP filter */}
        {availableZips.length > 0 && (
          <div className="card mb-6">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-medium" style={{ color: '#1A0A2E' }}>
                ZIP Filter
                <span className="text-xs font-normal ml-2" style={{ color: '#6B5B8A' }}>(leave empty to match all)</span>
              </p>
              {zipFilter.length > 0 && (
                <button className="text-xs hover:opacity-80 transition-opacity" style={{ color: '#5C2977' }} onClick={() => setZipFilter([])}>Clear all</button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {availableZips.map((zip) => (
                <button key={zip} onClick={() => toggleZip(zip)}
                  className="px-3 py-1 rounded-full text-xs font-medium transition-all"
                  style={zipFilter.includes(zip)
                    ? { background: '#5C2977', color: 'white', border: '1px solid #5C2977' }
                    : { background: '#FFFFFF', color: '#5C2977', border: '1px solid #D4B8E8' }}
                >{zip}</button>
              ))}
            </div>
          </div>
        )}

        {/* Smart filters */}
        <div className="card mb-6">
          <button
            className="w-full flex items-center justify-between text-sm font-medium"
            style={{ color: '#1A0A2E' }}
            onClick={() => setShowAdvanced((v) => !v)}
          >
            <span className="flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="11" y1="18" x2="13" y2="18"/>
              </svg>
              Smart Filters
              {[floodZoneFilter !== 'all', vacantOnly, requireRoadFrontage, excludeLandLocked, requireTlp, useBuildability, !!minAcreage, !!maxAcreage, !!priceCeiling].filter(Boolean).length > 0 && (
                <span className="badge badge-blue text-[10px] px-1.5">
                  {[floodZoneFilter !== 'all', vacantOnly, requireRoadFrontage, excludeLandLocked, requireTlp, useBuildability, !!minAcreage, !!maxAcreage, !!priceCeiling].filter(Boolean).length} active
                </span>
              )}
            </span>
            <span style={{ color: '#6B5B8A' }}>{showAdvanced ? '▲' : '▼'}</span>
          </button>

          {showAdvanced && (
            <div className="mt-5 space-y-5">
              {/* Acreage range */}
              <div>
                <p className="text-xs font-medium mb-2" style={{ color: '#6B5B8A' }}>ACREAGE RANGE</p>
                <div className="flex items-center gap-3">
                  <input type="number" step="0.1" min="0" placeholder="Min acres" className="input-base text-xs py-2"
                    value={minAcreage} onChange={(e) => setMinAcreage(e.target.value)} />
                  <span style={{ color: '#6B5B8A' }}>to</span>
                  <input type="number" step="0.1" min="0" placeholder="Max acres" className="input-base text-xs py-2"
                    value={maxAcreage} onChange={(e) => setMaxAcreage(e.target.value)} />
                </div>
              </div>

              <div className="h-px" style={{ background: 'rgba(92,41,119,0.08)' }} />

              {/* Flood zone */}
              <div>
                <p className="text-xs font-medium mb-2" style={{ color: '#6B5B8A' }}>FLOOD ZONE</p>
                <div className="inline-flex rounded-lg overflow-hidden" style={{ border: '1px solid #E8E0F0' }}>
                  <button className="px-3 py-1.5 text-xs transition-all" style={floodZoneFilter === 'all' ? { background: '#5C2977', color: 'white' } : { background: '#FFFFFF', color: '#6B5B8A' }} onClick={() => setFloodZoneFilter('all')}>All</button>
                  <button className="px-3 py-1.5 text-xs transition-all" style={floodZoneFilter === 'exclude' ? { background: '#5C2977', color: 'white' } : { background: '#FFFFFF', color: '#6B5B8A' }} onClick={() => setFloodZoneFilter('exclude')}>Exclude</button>
                  <button className="px-3 py-1.5 text-xs transition-all" style={floodZoneFilter === 'only' ? { background: '#5C2977', color: 'white' } : { background: '#FFFFFF', color: '#6B5B8A' }} onClick={() => setFloodZoneFilter('only')}>Only</button>
                </div>
              </div>

              <div className="h-px" style={{ background: 'rgba(92,41,119,0.08)' }} />

              {/* Buildability */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium" style={{ color: '#6B5B8A' }}>BUILDABILITY MINIMUM</p>
                  <ToggleOption label="Enable" checked={useBuildability} onChange={setUseBuildability} />
                </div>
                {useBuildability && (
                  <SliderRow label="" value={minBuildability} onChange={setMinBuildability} min={0} max={100} step={5} display={`${minBuildability}%+`} />
                )}
              </div>

              <div className="h-px" style={{ background: 'rgba(92,41,119,0.08)' }} />

              {/* Parcel flags */}
              <div>
                <p className="text-xs font-medium mb-3" style={{ color: '#6B5B8A' }}>PARCEL FLAGS</p>
                <div className="grid grid-cols-2 gap-3">
                  <ToggleOption label="Vacant land only" checked={vacantOnly} onChange={setVacantOnly} />
                  <ToggleOption label="Require road frontage" checked={requireRoadFrontage} onChange={setRequireRoadFrontage} />
                  <ToggleOption label="Exclude land locked" checked={excludeLandLocked} onChange={setExcludeLandLocked} />
                  <ToggleOption label="Require TLP estimate" checked={requireTlp} onChange={setRequireTlp} />
                </div>
                <div className="mt-3 max-w-xs">
                  <label className="text-xs block mb-1" style={{ color: '#6B5B8A' }}>Price ceiling (TLP Estimate)</label>
                  <input
                    type="number"
                    min="0"
                    step="1000"
                    placeholder="e.g. 120000"
                    className="input-base text-xs py-2"
                    value={priceCeiling}
                    onChange={(e) => setPriceCeiling(e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Filter chips summary */}
        {activeFilters.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-5">
            <span className="text-xs self-center" style={{ color: '#6B5B8A' }}>Active filters:</span>
            {activeFilters.map((f, i) => (
              <span key={i} className="filter-chip">
                {f.label}
                {f.onRemove && (
                  <button onClick={f.onRemove} className="hover:text-red-400 transition-colors ml-0.5">×</button>
                )}
              </span>
            ))}
          </div>
        )}

        {/* Run button */}
        <div className="mb-6">
          <button
            disabled={!targetStats || matchLoading}
            onClick={handleMatch}
            style={{
              width: '100%',
              padding: '18px 32px',
              fontSize: 18,
              fontWeight: 700,
              letterSpacing: '0.5px',
              borderRadius: 12,
              border: 'none',
              cursor: !targetStats || matchLoading ? 'not-allowed' : 'pointer',
              opacity: !targetStats || matchLoading ? 0.5 : 1,
              background: 'linear-gradient(135deg, #5C2977 0%, #8B4DB8 50%, #D5A940 100%)',
              backgroundSize: '200% auto',
              color: 'white',
              boxShadow: '0 4px 20px rgba(92,41,119,0.35)',
              transition: 'all 0.3s ease',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
            }}
            onMouseEnter={(e) => {
              if (!matchLoading && targetStats) {
                (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 8px 30px rgba(92,41,119,0.5)'
                ;(e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-2px)'
                ;(e.currentTarget as HTMLButtonElement).style.background = 'linear-gradient(135deg, #3D1A5C 0%, #5C2977 50%, #D5A940 100%)'
              }
            }}
            onMouseLeave={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 20px rgba(92,41,119,0.35)'
              ;(e.currentTarget as HTMLButtonElement).style.transform = 'none'
              ;(e.currentTarget as HTMLButtonElement).style.background = 'linear-gradient(135deg, #5C2977 0%, #8B4DB8 50%, #D5A940 100%)'
            }}
          >
            {matchLoading ? (
              <><LoadingSpinner size="sm" />Running…</>
            ) : (
              <>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
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
              const matchedUrl = getMatchedLeadsDownloadUrl(matchId, 'matched-leads')
              const top500Url = getMailingDownloadUrl(matchId, 'top-500', 'top500')
              const highConfUrl = getMailingDownloadUrl(matchId, 'high-confidence', 'high-confidence')
              const fullUrl = getMailingDownloadUrl(matchId, 'full-list', 'full')
              return (
                <div className="card mb-6">
                  <h2 className="font-semibold mb-4" style={{ color: '#1A0A2E' }}>Download Results</h2>
                  <div className="flex flex-wrap gap-2">
                    <a href={matchedUrl} download className="btn-secondary text-sm no-underline">Download Matched Leads</a>
                    <a href={top500Url} download className="btn-secondary text-sm no-underline">Top 500</a>
                    <a href={highConfUrl} download className="btn-secondary text-sm no-underline">High Confidence Only</a>
                    <a href={fullUrl} download className="btn-secondary text-sm no-underline">Full List</a>
                  </div>
                </div>
              )
            })()}
            {/* Results summary */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              <ResultCard label="Total Targets" value={matchResult.total_targets.toLocaleString()} accent="#5C2977" />
              <ResultCard label="Matched" value={matchResult.matched_count.toLocaleString()} accent="#2D7A4F" />
              <ResultCard
                label="Match Rate"
                value={`${matchResult.total_targets > 0 ? Math.round((matchResult.matched_count / matchResult.total_targets) * 100) : 0}%`}
                accent="#8B4DB8"
              />
            </div>

            {/* Warnings from matching engine */}
            {matchResult.warnings && matchResult.warnings.filter(w => w.includes('Excluded') || w.includes('WARNING')).length > 0 && (
              <div className="mb-4 p-3 rounded-lg" style={{ background: '#FEF3C7', border: '1px solid #F59E0B' }}>
                <p className="text-xs font-semibold mb-1" style={{ color: '#92400E' }}>Filters Applied:</p>
                {matchResult.warnings.filter(w => w.includes('Excluded') || w.includes('WARNING')).map((w, i) => (
                  <p key={i} className="text-xs" style={{ color: '#78350F' }}>{w}</p>
                ))}
              </div>
            )}

            {/* Score distribution pills */}
            <div className="flex items-center gap-3 mb-5">
              <span className="text-xs" style={{ color: '#6B5B8A' }}>Score distribution:</span>
              {[5, 4, 3, 2, 1, 0].map((s) => {
                const count = matchResult.results.filter((r) => r.match_score === s).length
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
                  <button
                    className={`toggle-btn${resultView === 'table' ? ' active' : ''}`}
                    onClick={() => setResultView('table')}
                  >
                    Table
                  </button>
                  <button
                    className={`toggle-btn${resultView === 'map' ? ' active' : ''}`}
                    onClick={() => setResultView('map')}
                  >
                    Map
                  </button>
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
                <MatchMap
                  targets={matchResult.results}
                  comps={dashboardData?.comp_locations ?? []}
                  radiusMiles={1}
                />
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
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
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
      className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold text-white score-badge-${score}`}
      style={{ background: score === 4 ? '#5C2977' : score === 3 ? '#D5A940' : score === 2 ? '#C06820' : score === 1 ? '#B03030' : '#2D7A4F' }}
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
