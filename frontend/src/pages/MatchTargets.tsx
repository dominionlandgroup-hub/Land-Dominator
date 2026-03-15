import React, { useState, useEffect } from 'react'
import FileUpload from '../components/FileUpload'
import DataTable from '../components/DataTable'
import LoadingSpinner from '../components/LoadingSpinner'
import LoadingOverlay from '../components/LoadingOverlay'
import { useApp } from '../context/AppContext'
import { uploadTargets, runMatch } from '../api/client'
import type { Column } from '../components/DataTable'
import type { MatchedParcel, MatchFilters } from '../types'
import { getConfidence } from '../types'
import MatchMap from '../components/MatchMap'
import WelcomeScreen from './WelcomeScreen'

const DEFAULT_FILTERS: Omit<MatchFilters, 'session_id' | 'target_session_id'> = {
  radius_miles: 10,
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
  const [radiusMiles, setRadiusMiles] = useState<number>(Number(init.radius_miles ?? 10))
  const [acreageTol, setAcreageTol] = useState<number>(Number(init.acreage_tolerance_pct ?? 50))
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
      radius_miles: radiusMiles,
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
  const activeFilters: { label: string; onRemove: () => void }[] = []
  activeFilters.push({ label: `${radiusMiles} mi radius`, onRemove: () => setRadiusMiles(10) })
  activeFilters.push({ label: `±${acreageTol}% acreage`, onRemove: () => setAcreageTol(50) })
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
      key: 'matched_comp_count', header: 'Conf.', align: 'center',
      render: (v) => {
        const c = getConfidence(v as number)
        return <span className={`conf-${c}`}>{c}</span>
      },
    },
    { key: 'apn', header: 'APN', sortable: true, render: (v) => <span className="font-mono text-xs">{String(v || '—')}</span> },
    { key: 'owner_name', header: 'Owner', render: (v) => <span className="max-w-[160px] block truncate text-xs" title={String(v)}>{String(v || '—')}</span> },
    { key: 'parcel_zip', header: 'ZIP', sortable: true },
    { key: 'parcel_city', header: 'City', defaultHidden: true },
    {
      key: 'lot_acres', header: 'Acres', sortable: true, align: 'right',
      render: (v) => v == null ? <span className="text-gray-600">—</span> : <span>{(v as number).toFixed(2)}</span>,
    },
    {
      key: 'suggested_offer_mid', header: 'Mid Offer', sortable: true, align: 'right',
      render: (v) => v == null ? <span className="text-gray-600">—</span> : (
        <span className="font-semibold text-emerald-400">${Math.round(v as number).toLocaleString()}</span>
      ),
    },
    {
      key: 'suggested_offer_low', header: 'Low', align: 'right', defaultHidden: true,
      render: (v) => v == null ? <span className="text-gray-600">—</span> : <span className="text-xs text-gray-400">${Math.round(v as number).toLocaleString()}</span>,
    },
    {
      key: 'suggested_offer_high', header: 'High', align: 'right', defaultHidden: true,
      render: (v) => v == null ? <span className="text-gray-600">—</span> : <span className="text-xs text-gray-400">${Math.round(v as number).toLocaleString()}</span>,
    },
    {
      key: 'flood_zone', header: 'Flood', defaultHidden: true,
      render: (v) => <span className="text-xs text-gray-400">{String(v || '—')}</span>,
    },
    {
      key: 'buildability_pct', header: 'Build%', sortable: true, align: 'right', defaultHidden: true,
      render: (v) => v == null ? <span className="text-gray-600">—</span> : (
        <span style={{ color: (v as number) > 70 ? '#10b981' : (v as number) > 40 ? '#f59e0b' : '#ef4444', fontSize: '12px' }}>
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
          <h1 className="text-lg font-semibold" style={{ color: '#f9fafb' }}>Match Targets</h1>
          <p className="text-xs mt-0.5" style={{ color: '#8A8070' }}>Upload target parcels and run the matching engine with smart filters</p>
        </div>
        {matchResult && (
          <button className="btn-primary text-sm" onClick={() => setCurrentPage('mailing-list')}>
            Mailing List →
          </button>
        )}
      </div>

      <div className="p-8 max-w-[1400px]">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Upload targets */}
          <div className="card">
            <h2 className="font-semibold mb-4" style={{ color: '#e5e7eb' }}>Target Parcels CSV</h2>
            {targetStats ? (
              <div className="rounded-lg px-4 py-3 flex items-center justify-between" style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)' }}>
                <div>
                  <p className="font-medium text-sm" style={{ color: '#34d399' }}>
                    ✓ {targetStats.total_rows.toLocaleString()} rows loaded
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: 'rgba(52,211,153,0.6)' }}>
                    {targetStats.columns_found.length} columns · {fileName}
                  </p>
                </div>
                <button
                  className="text-xs hover:text-gray-300 transition-colors"
                  style={{ color: '#8A8070' }}
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
            <h2 className="font-semibold mb-4" style={{ color: '#e5e7eb' }}>Matching Parameters</h2>
            <div className="space-y-4">
              <SliderRow label="Radius" value={radiusMiles} onChange={setRadiusMiles} min={1} max={50} step={1} display={`${radiusMiles} miles`} />
              <SliderRow label="Acreage Tolerance" value={acreageTol} onChange={setAcreageTol} min={5} max={200} step={5} display={`±${acreageTol}%`} />
              <SliderRow label="Min Match Score" value={minScore} onChange={setMinScore} min={0} max={5} step={1} display={`${minScore} / 5`} />
            </div>
          </div>
        </div>

        {/* ZIP filter */}
        {availableZips.length > 0 && (
          <div className="card mb-6">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-medium" style={{ color: '#F5F0E8' }}>
                ZIP Filter
                <span className="text-xs font-normal ml-2" style={{ color: '#8A8070' }}>(leave empty to match all)</span>
              </p>
              {zipFilter.length > 0 && (
                <button className="text-xs hover:opacity-80 transition-opacity" style={{ color: '#C9A84C' }} onClick={() => setZipFilter([])}>Clear all</button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {availableZips.map((zip) => (
                <button key={zip} onClick={() => toggleZip(zip)}
                  className="px-3 py-1 rounded-full text-xs font-medium transition-all"
                  style={zipFilter.includes(zip)
                    ? { background: 'linear-gradient(135deg, #C9A84C 0%, #A07828 100%)', color: '#080808', border: '1px solid #C9A84C' }
                    : { background: '#0F0F0F', color: '#8A8070', border: '1px solid rgba(201,168,76,0.2)' }}
                >{zip}</button>
              ))}
            </div>
          </div>
        )}

        {/* Smart filters */}
        <div className="card mb-6">
          <button
            className="w-full flex items-center justify-between text-sm font-medium"
            style={{ color: '#F5F0E8' }}
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
            <span style={{ color: '#8A8070' }}>{showAdvanced ? '▲' : '▼'}</span>
          </button>

          {showAdvanced && (
            <div className="mt-5 space-y-5">
              {/* Acreage range */}
              <div>
                <p className="text-xs font-medium mb-2" style={{ color: '#8A8070' }}>ACREAGE RANGE</p>
                <div className="flex items-center gap-3">
                  <input type="number" step="0.1" min="0" placeholder="Min acres" className="input-base text-xs py-2"
                    value={minAcreage} onChange={(e) => setMinAcreage(e.target.value)} />
                  <span style={{ color: '#8A8070' }}>to</span>
                  <input type="number" step="0.1" min="0" placeholder="Max acres" className="input-base text-xs py-2"
                    value={maxAcreage} onChange={(e) => setMaxAcreage(e.target.value)} />
                </div>
              </div>

              <div className="h-px" style={{ background: 'rgba(201,168,76,0.1)' }} />

              {/* Flood zone */}
              <div>
                <p className="text-xs font-medium mb-2" style={{ color: '#8A8070' }}>FLOOD ZONE</p>
                <div className="inline-flex rounded-lg overflow-hidden" style={{ border: '1px solid rgba(201,168,76,0.2)' }}>
                  <button className="px-3 py-1.5 text-xs transition-all" style={floodZoneFilter === 'all' ? { background: 'linear-gradient(135deg, #C9A84C 0%, #A07828 100%)', color: '#080808' } : { background: '#0F0F0F', color: '#8A8070' }} onClick={() => setFloodZoneFilter('all')}>All</button>
                  <button className="px-3 py-1.5 text-xs transition-all" style={floodZoneFilter === 'exclude' ? { background: 'linear-gradient(135deg, #C9A84C 0%, #A07828 100%)', color: '#080808' } : { background: '#0F0F0F', color: '#8A8070' }} onClick={() => setFloodZoneFilter('exclude')}>Exclude</button>
                  <button className="px-3 py-1.5 text-xs transition-all" style={floodZoneFilter === 'only' ? { background: 'linear-gradient(135deg, #C9A84C 0%, #A07828 100%)', color: '#080808' } : { background: '#0F0F0F', color: '#8A8070' }} onClick={() => setFloodZoneFilter('only')}>Only</button>
                </div>
              </div>

              <div className="h-px" style={{ background: 'rgba(201,168,76,0.1)' }} />

              {/* Buildability */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium" style={{ color: '#8A8070' }}>BUILDABILITY MINIMUM</p>
                  <ToggleOption label="Enable" checked={useBuildability} onChange={setUseBuildability} />
                </div>
                {useBuildability && (
                  <SliderRow label="" value={minBuildability} onChange={setMinBuildability} min={0} max={100} step={5} display={`${minBuildability}%+`} />
                )}
              </div>

              <div className="h-px" style={{ background: 'rgba(201,168,76,0.12)' }} />

              {/* Parcel flags */}
              <div>
                <p className="text-xs font-medium mb-3" style={{ color: '#8A8070' }}>PARCEL FLAGS</p>
                <div className="grid grid-cols-2 gap-3">
                  <ToggleOption label="Vacant land only" checked={vacantOnly} onChange={setVacantOnly} />
                  <ToggleOption label="Require road frontage" checked={requireRoadFrontage} onChange={setRequireRoadFrontage} />
                  <ToggleOption label="Exclude land locked" checked={excludeLandLocked} onChange={setExcludeLandLocked} />
                  <ToggleOption label="Require TLP estimate" checked={requireTlp} onChange={setRequireTlp} />
                </div>
                <div className="mt-3 max-w-xs">
                  <label className="text-xs block mb-1" style={{ color: '#8A8070' }}>Price ceiling (TLP Estimate)</label>
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
            <span className="text-xs self-center" style={{ color: '#8A8070' }}>Active filters:</span>
            {activeFilters.map((f, i) => (
              <span key={i} className="filter-chip">
                {f.label}
                <button onClick={f.onRemove} className="hover:text-red-400 transition-colors ml-0.5">×</button>
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
              background: 'linear-gradient(135deg, #1d4ed8 0%, #3b82f6 50%, #06b6d4 100%)',
              backgroundSize: '200% auto',
              color: 'white',
              boxShadow: '0 4px 20px rgba(59,130,246,0.4), 0 0 40px rgba(59,130,246,0.15)',
              transition: 'all 0.3s ease',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
            }}
            onMouseEnter={(e) => {
              if (!matchLoading && targetStats) {
                (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 8px 30px rgba(59,130,246,0.6), 0 0 60px rgba(59,130,246,0.2)'
                ;(e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-2px)'
                ;(e.currentTarget as HTMLButtonElement).style.background = 'linear-gradient(135deg, #2563eb 0%, #60a5fa 50%, #22d3ee 100%)'
              }
            }}
            onMouseLeave={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 20px rgba(59,130,246,0.4), 0 0 40px rgba(59,130,246,0.15)'
              ;(e.currentTarget as HTMLButtonElement).style.transform = 'none'
              ;(e.currentTarget as HTMLButtonElement).style.background = 'linear-gradient(135deg, #1d4ed8 0%, #3b82f6 50%, #06b6d4 100%)'
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
            <p className="text-sm mt-2 text-center" style={{ color: '#8A8070' }}>
              {targetStats.total_rows.toLocaleString()} targets × {compsStats.valid_rows.toLocaleString()} comps
            </p>
          )}
        </div>

        {matchError && (
          <div className="rounded-xl px-5 py-4 mb-6 text-sm" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' }}>
            {matchError}
          </div>
        )}

        {matchResult && (
          <>
            {/* Results summary */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              <ResultCard label="Total Targets" value={matchResult.total_targets.toLocaleString()} accent="#C9A84C" />
              <ResultCard label="Matched" value={matchResult.matched_count.toLocaleString()} accent="#10b981" />
              <ResultCard
                label="Match Rate"
                value={`${matchResult.total_targets > 0 ? Math.round((matchResult.matched_count / matchResult.total_targets) * 100) : 0}%`}
                accent="#8b5cf6"
              />
            </div>

            {/* Score distribution pills */}
            <div className="flex items-center gap-3 mb-5">
              <span className="text-xs" style={{ color: '#8A8070' }}>Score distribution:</span>
              {[5, 4, 3, 2, 1, 0].map((s) => {
                const count = matchResult.results.filter((r) => r.match_score === s).length
                if (count === 0) return null
                return (
                  <span key={s} className="flex items-center gap-1.5">
                    <ScoreBadge score={s} />
                    <span className="text-xs" style={{ color: '#8A8070' }}>{count.toLocaleString()}</span>
                  </span>
                )
              })}
            </div>

            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold" style={{ color: '#F5F0E8' }}>
                  Matched Parcels
                  <span className="text-sm font-normal ml-2" style={{ color: '#8A8070' }}>sorted by score</span>
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
                  radiusMiles={radiusMiles}
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
          <span style={{ color: '#8A8070' }}>{label}</span>
          <span className="font-medium" style={{ color: '#C9A84C' }}>{display}</span>
        </div>
      )}
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full cursor-pointer" style={{ accentColor: '#C9A84C' }}
      />
      <div className="flex justify-between text-xs mt-0.5" style={{ color: '#3A3025' }}>
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
        style={{ background: checked ? '#C9A84C' : '#252015' }}
      >
        <div
          className="w-4 h-4 rounded-full absolute top-0.5 transition-transform"
          style={{ background: checked ? '#080808' : '#8A8070', transform: checked ? 'translateX(18px)' : 'translateX(2px)' }}
        />
      </div>
      <span className="text-xs select-none" style={{ color: checked ? '#F5F0E8' : '#8A8070' }}>{label}</span>
    </label>
  )
}

function ScoreBadge({ score }: { score: number }) {
  return (
    <span
      className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold text-white score-badge-${score}`}
      style={{ background: score === 4 ? '#0891b2' : score === 3 ? '#d97706' : score === 2 ? '#ea580c' : score === 1 ? '#dc2626' : '#059669' }}
    >
      {score}
    </span>
  )
}

function ResultCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-xl p-4" style={{ background: `${accent}12`, border: `1px solid ${accent}30` }}>
      <p className="text-xs uppercase tracking-wider mb-1" style={{ color: '#8A8070' }}>{label}</p>
      <p className="text-2xl font-bold" style={{ color: accent }}>{value}</p>
    </div>
  )
}
