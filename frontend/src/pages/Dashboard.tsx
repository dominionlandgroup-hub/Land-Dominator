import React, { useEffect, useState } from 'react'
import { useApp } from '../context/AppContext'
import { fetchDashboard, getDbCompsCount, getCompsInventory, clearAllComps, clearCompsByFile, type CompInventoryItem } from '../api/client'
import { createCrmCampaign, saveBuyBox } from '../api/crm'
import LoadingSpinner from '../components/LoadingSpinner'
import type { ZipStats, CompLocation, SweetSpot, LandQualityStats } from '../types'
import CompMap from '../components/CompMap'
import WelcomeScreen from './WelcomeScreen'

export default function Dashboard() {
  const { compsStats, dashboardData, setDashboardData, setCurrentPage } = useApp()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dbCompsCount, setDbCompsCount] = useState<number | null>(null)
  const [inventory, setInventory] = useState<{ items: CompInventoryItem[]; total_comps: number } | null>(null)
  const [clearAllConfirm, setClearAllConfirm] = useState(false)

  useEffect(() => {
    getDbCompsCount().then(setDbCompsCount).catch(() => {})
    getCompsInventory().then(setInventory).catch(() => {})
  }, [])

  async function handleClearAll() {
    await clearAllComps()
    setInventory(null)
    setDbCompsCount(0)
    setClearAllConfirm(false)
    setDashboardData(null)
  }

  async function handleClearFile(filename: string) {
    await clearCompsByFile(filename)
    const inv = await getCompsInventory()
    setInventory(inv)
    setDbCompsCount(inv.total_comps)
  }

  useEffect(() => {
    if (!compsStats) return
    if (dashboardData) return
    load()
  }, [compsStats])

  async function load() {
    if (!compsStats) return
    setLoading(true)
    setError(null)
    try {
      const data = await fetchDashboard(compsStats.session_id, [])
      setDashboardData(data)
    } catch {
      setError('Failed to load dashboard. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (!compsStats) {
    return <WelcomeScreen contextualMessage="Upload sold comps to unlock ZIP analytics and map intelligence." />
  }

  // Sweet spot stat
  const sp = dashboardData?.sweet_spot
  let sweetBand = '—'
  let sweetPct = 0
  if (sp) {
    const b = sp.bucket
    sweetBand = b === '0-0.5' ? '0–0.5 acres' : b === '0.5-1' ? '0.5–1 acres' : b === '1-2' ? '1–2 acres' : b === '2-5' ? '2–5 acres' : b === '5-10' ? '5–10 acres' : b === '10+' ? '10+ acres' : b
    sweetPct = sp.total_sales > 0 ? Math.round((sp.count / sp.total_sales) * 100) : 0
  }

  const topZip = dashboardData?.zip_stats[0]

  return (
    <div className="flex flex-col min-h-screen">
      <div className="page-header">
        <div className="flex items-center gap-3">
          <button className="btn-secondary text-sm" onClick={() => setCurrentPage('upload-comps')}>
            ← Upload Comps
          </button>
          <div>
            <h1 className="text-lg" style={{ color: '#111827', fontWeight: 700 }}>Market Analysis</h1>
            <p className="text-xs mt-0.5" style={{ color: '#9CA3AF' }}>
              {(dbCompsCount ?? compsStats.valid_rows).toLocaleString()} sold comps in database · {dashboardData?.available_zips.length ?? '…'} ZIP codes
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-secondary text-sm" onClick={load} disabled={loading}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 4 23 10 17 10"/>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
            </svg>
            Refresh
          </button>
          <button className="btn-primary text-sm" onClick={() => setCurrentPage('match-targets')}>
            Match Targets →
          </button>
        </div>
      </div>

      <div className="p-8 max-w-[1400px] mx-auto w-full">

        {/* ── Comp Inventory ───────────────────────────────────── */}
        {inventory && inventory.items.length > 0 && (
          <div className="mb-6 rounded-xl overflow-hidden" style={{ border: '1px solid #E5E7EB' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: '#F9FAFB', borderBottom: '1px solid #E5E7EB', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <span style={{ fontWeight: 600, fontSize: 13, color: '#111827' }}>Comp Inventory</span>
                <span style={{ marginLeft: 10, fontSize: 12, color: '#6B7280' }}>
                  {(dbCompsCount ?? inventory.total_comps).toLocaleString()} total · {inventory.items.length} file{inventory.items.length !== 1 ? 's' : ''}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <button
                  onClick={() => setCurrentPage('upload-comps')}
                  style={{ padding: '4px 12px', fontSize: 12, fontWeight: 600, background: '#4F46E5', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}
                >
                  + Add More Comps
                </button>
                {!clearAllConfirm ? (
                  <button
                    onClick={() => setClearAllConfirm(true)}
                    style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, background: 'transparent', color: '#DC2626', border: '1px solid #FCA5A5', borderRadius: 5, cursor: 'pointer' }}
                  >
                    Clear All
                  </button>
                ) : (
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: '#DC2626', fontWeight: 600 }}>
                      Delete all {(dbCompsCount ?? inventory.total_comps).toLocaleString()} comps?
                    </span>
                    <button onClick={handleClearAll} style={{ padding: '4px 10px', fontSize: 11, fontWeight: 700, background: '#DC2626', color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer' }}>
                      Yes
                    </button>
                    <button onClick={() => setClearAllConfirm(false)} style={{ padding: '4px 8px', fontSize: 11, background: 'transparent', color: '#9CA3AF', border: '1px solid #E5E7EB', borderRadius: 5, cursor: 'pointer' }}>
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, background: '#fff' }}>
              <tbody>
                {inventory.items.map((item, i) => (
                  <tr key={item.filename} style={{ borderTop: i === 0 ? 'none' : '1px solid #F3F4F6' }}>
                    <td style={{ padding: '7px 16px', color: '#374151', fontFamily: 'monospace', fontSize: 11, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.filename}
                    </td>
                    <td style={{ padding: '7px 8px', fontWeight: 600, color: '#111827', whiteSpace: 'nowrap' }}>
                      {item.record_count.toLocaleString()} comps
                    </td>
                    <td style={{ padding: '7px 8px', color: '#9CA3AF', whiteSpace: 'nowrap' }}>
                      {item.uploaded_at ? new Date(item.uploaded_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                    </td>
                    <td style={{ padding: '7px 16px 7px 8px' }}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {item.states.map(s => (
                          <span key={s} style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: 'rgba(79,70,229,0.08)', color: '#4F46E5', border: '1px solid rgba(79,70,229,0.15)' }}>{s}</span>
                        ))}
                      </div>
                    </td>
                    <td style={{ padding: '7px 16px', textAlign: 'right' }}>
                      <button
                        onClick={() => handleClearFile(item.filename)}
                        style={{ fontSize: 11, color: '#9CA3AF', background: 'transparent', border: '1px solid #E5E7EB', borderRadius: 4, padding: '2px 8px', cursor: 'pointer' }}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid #E5E7EB', background: '#F9FAFB' }}>
                  <td style={{ padding: '7px 16px', fontWeight: 600, fontSize: 12, color: '#374151' }}>Total</td>
                  <td style={{ padding: '7px 8px', fontWeight: 700, color: '#4F46E5' }}>{(dbCompsCount ?? inventory.total_comps).toLocaleString()} comps</td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* ── Section 1: 4 Stat Cards ──────────────────────────── */}
        {dashboardData && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <SummaryCard
              label="Sweet Spot"
              value={sweetBand}
              sub={sweetPct > 0 ? `${sweetPct}% of all sales` : 'Most common size'}
              icon={<IconTarget />}
              accent="#5C2977"
            />
            <SummaryCard
              label="Most Active ZIP"
              value={topZip?.zip_code ?? '—'}
              sub={topZip ? `${topZip.sales_count} sales` : ''}
              icon={<IconPin />}
              accent="#4F46E5"
            />
            <SummaryCard
              label="Median Sale Price"
              value={dashboardData.median_price ? `$${Math.round(dashboardData.median_price).toLocaleString()}` : '—'}
              sub="across all comps"
              icon={<IconDollar />}
              accent="#4F46E5"
            />
            <SummaryCard
              label="Total Valid Comps"
              value={dashboardData.valid_comps.toLocaleString()}
              sub={`of ${dashboardData.total_comps.toLocaleString()} total`}
              icon={<IconDB />}
              accent="#5C2977"
            />
          </div>
        )}

        {loading && (
          <div className="flex justify-center py-16">
            <LoadingSpinner size="lg" label="Computing ZIP analytics…" />
          </div>
        )}

        {error && (
          <div className="rounded-xl px-5 py-4 mb-6 text-sm" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#EF4444' }}>
            {error}
          </div>
        )}

        {dashboardData && !loading && (
          <>
            {/* ── Section 2: Buy Box Recipe ────────────────────────── */}
            <BuyBoxRecipe
              zipStats={dashboardData.zip_stats}
              comps={dashboardData.comp_locations}
              sweetSpot={dashboardData.sweet_spot}
              topStates={dashboardData.top_states ?? []}
              topCounties={dashboardData.top_counties ?? []}
              landQuality={dashboardData.land_quality}
            />

            {/* ── Section 3: Top 10 Markets ────────────────────────── */}
            <TopMarketsCard
              zipStats={dashboardData.zip_stats}
              comps={dashboardData.comp_locations}
            />

            {/* ── Section 4: Full ZIP Data ─────────────────────────── */}
            <CollapsibleZipTable zipStats={dashboardData.zip_stats} />

            <div className="mt-6 flex justify-end">
              <button className="btn-primary" onClick={() => setCurrentPage('match-targets')}>
                Match Targets →
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Top Markets Card ──────────────────────────────────────────────────────

function zipDotColor(z: ZipStats, outlierSet: Set<string>): string {
  if (outlierSet.has(z.zip_code)) return '#DC2626'
  if (z.sales_count >= 10) return '#059669'
  if (z.sales_count >= 5)  return '#D97706'
  return '#DC2626'
}

function TopMarketsCard({ zipStats, comps }: { zipStats: ZipStats[]; comps: CompLocation[] }) {
  const [showMap, setShowMap] = useState(false)
  const [showOutliers, setShowOutliers] = useState(false)
  const [showThin, setShowThin] = useState(false)

  // Compute outlier set FIRST so we can exclude them from the top-10 ranking
  const ppas = zipStats.map(z => z.median_price_per_acre).filter((v): v is number => v != null && Number.isFinite(v) && v > 0)
  const overallMedian = median(ppas)
  const outlierSet = new Set<string>(
    overallMedian > 0
      ? zipStats.filter(z => (z.median_price_per_acre ?? 0) > 3 * overallMedian).map(z => z.zip_code)
      : []
  )
  const thinZips = zipStats.filter(z => z.sales_count < 5).map(z => z.zip_code)
  const warningZips = new Set(zipStats.filter(z => z.sales_count >= 5 && z.sales_count < 10).map(z => z.zip_code))
  const avoidZips = [...outlierSet, ...thinZips]

  // Top 20: exclude outliers and <5 sales first, then rank by sales count
  const sorted = [...zipStats]
    .filter(z => !outlierSet.has(z.zip_code) && !thinZips.includes(z.zip_code))
    .sort((a, b) => b.sales_count - a.sales_count)
  const top20 = sorted.slice(0, 20)
  const top20Zips = top20.map(z => z.zip_code)

  return (
    <div className="card mb-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-semibold" style={{ color: '#111827' }}>Top 20 Markets</h2>
          <p className="text-xs mt-0.5" style={{ color: '#9CA3AF' }}>Ranked by sales volume · color shows market quality</p>
        </div>
        <button className="btn-secondary text-xs" onClick={() => setShowMap(v => !v)}>
          {showMap ? 'Hide Map' : 'View on Map'}
        </button>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mb-4 text-xs" style={{ color: '#9CA3AF' }}>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full inline-block" style={{ background: '#059669' }} />Solid (10+ sales)</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full inline-block" style={{ background: '#D97706' }} />Thin Data (5–9 sales)</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full inline-block" style={{ background: '#DC2626' }} />Avoid (outlier)</span>
      </div>

      {/* Top 20 ranked list */}
      <div className="rounded-xl overflow-hidden mb-4" style={{ border: '1px solid #E5E7EB' }}>
        <div className="grid text-[10px] uppercase tracking-wider px-4 py-2" style={{ gridTemplateColumns: '32px 12px 1fr 90px 100px 80px', color: '#6B7280', background: '#F9FAFB', borderBottom: '1px solid #E5E7EB' }}>
          <span>#</span><span></span><span>ZIP</span><span className="text-right">Sales</span><span className="text-right">Median $/Acre</span><span></span>
        </div>
        {top20.map((z, i) => {
          const dot = zipDotColor(z, outlierSet)
          const isThinWarning = warningZips.has(z.zip_code)
          return (
            <div
              key={z.zip_code}
              className="grid items-center px-4 py-2.5"
              style={{ gridTemplateColumns: '32px 12px 1fr 90px 100px 80px', background: i % 2 === 0 ? '#FFFFFF' : '#F9FAFB', borderBottom: i < top20.length - 1 ? '1px solid #F3F4F6' : 'none' }}
            >
              <span className="text-xs font-bold" style={{ color: '#9CA3AF' }}>{i + 1}</span>
              <div className="w-2 h-2 rounded-full" style={{ background: dot }} />
              <span className="font-mono font-semibold text-sm" style={{ color: '#4F46E5' }}>{fmtZip(z.zip_code)}</span>
              <span className="text-xs text-right font-medium" style={{ color: '#111827' }}>{z.sales_count.toLocaleString()}</span>
              <span className="text-xs text-right" style={{ color: '#4F46E5' }}>
                {z.median_price_per_acre != null ? `$${Math.round(z.median_price_per_acre).toLocaleString()}` : '—'}
              </span>
              <span className="flex justify-end">
                {isThinWarning && (
                  <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 6, background: 'rgba(245,158,11,0.15)', color: '#F59E0B', border: '1px solid rgba(245,158,11,0.25)' }}>Thin Data</span>
                )}
              </span>
            </div>
          )
        })}
      </div>

      {/* Avoid section */}
      {(outlierSet.size > 0 || thinZips.length > 0) && (
        <div className="rounded-lg px-4 py-3 mb-4 text-xs space-y-1" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)' }}>
          <p className="font-medium mb-1.5" style={{ color: '#EF4444' }}>Excluded from targets</p>
          {outlierSet.size > 0 && (
            <div>
              <span style={{ color: '#9CA3AF' }}>{outlierSet.size} outlier ZIPs excluded (premium/waterfront areas)</span>
              <button className="ml-2 underline" style={{ color: '#4F46E5' }} onClick={() => setShowOutliers(v => !v)}>
                {showOutliers ? 'hide' : 'view all'}
              </button>
              {showOutliers && (
                <p className="mt-1 font-mono text-[10px] leading-relaxed" style={{ color: '#6B7280' }}>
                  {[...outlierSet].map(fmtZip).join(', ')}
                </p>
              )}
            </div>
          )}
          {thinZips.length > 0 && (
            <div>
              <span style={{ color: '#9CA3AF' }}>{thinZips.length} thin data ZIPs excluded (fewer than 5 sales)</span>
              <button className="ml-2 underline" style={{ color: '#4F46E5' }} onClick={() => setShowThin(v => !v)}>
                {showThin ? 'hide' : 'view all'}
              </button>
              {showThin && (
                <p className="mt-1 font-mono text-[10px] leading-relaxed" style={{ color: '#6B7280' }}>
                  {thinZips.map(fmtZip).join(', ')}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Map toggle */}
      {showMap && (
        <CompMap
          comps={comps}
          availableZips={zipStats.map(z => z.zip_code)}
          visibleZips={top20Zips}
          onZipToggle={() => {}}
          topZips={top20Zips}
          avoidZips={avoidZips}
        />
      )}
    </div>
  )
}

// ── Collapsible ZIP Table ─────────────────────────────────────────────────

function CollapsibleZipTable({ zipStats }: { zipStats: ZipStats[] }) {
  const [expanded, setExpanded] = useState(false)
  const [showAll, setShowAll] = useState(false)

  const ppas = zipStats.map(z => z.median_price_per_acre).filter((v): v is number => v != null && Number.isFinite(v) && v > 0)
  const overallMedian = median(ppas)
  const outlierSet = new Set<string>(
    overallMedian > 0
      ? zipStats.filter(z => (z.median_price_per_acre ?? 0) > 3 * overallMedian).map(z => z.zip_code)
      : []
  )

  const filtered = showAll
    ? [...zipStats].sort((a, b) => b.sales_count - a.sales_count)
    : [...zipStats].filter(z => z.sales_count >= 10 && !outlierSet.has(z.zip_code)).sort((a, b) => b.sales_count - a.sales_count)

  return (
    <div className="card mb-6">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold" style={{ color: '#111827' }}>
          ZIP Code Data
          <span className="text-sm font-normal ml-2" style={{ color: '#9CA3AF' }}>
            ({zipStats.length} total ZIPs)
          </span>
        </h2>
        <button
          className="btn-secondary text-xs"
          onClick={() => setExpanded(v => !v)}
        >
          {expanded ? 'Collapse ▲' : `View all ${zipStats.length} ZIPs ▼`}
        </button>
      </div>

      {expanded && (
        <div className="mt-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs" style={{ color: '#9CA3AF' }}>
              Showing {filtered.length} ZIPs
              {!showAll && ' with 10+ sales, excluding outliers'}
            </p>
            <button className="text-xs underline" style={{ color: '#4F46E5' }} onClick={() => setShowAll(v => !v)}>
              {showAll ? 'Hide thin/outlier ZIPs' : 'Show all ZIPs'}
            </button>
          </div>

          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #E5E7EB' }}>
            <div className="grid text-[10px] uppercase tracking-wider px-4 py-2" style={{ gridTemplateColumns: '1fr 70px 100px 90px', color: '#6B7280', background: '#F9FAFB', borderBottom: '1px solid #E5E7EB' }}>
              <span>ZIP</span>
              <span className="text-right">Sales</span>
              <span className="text-right">Max Price</span>
              <span className="text-right">Median Acres</span>
            </div>
            {filtered.map((z, i) => (
              <div
                key={z.zip_code}
                className="grid items-center px-4 py-2"
                style={{ gridTemplateColumns: '1fr 70px 100px 90px', background: i % 2 === 0 ? '#FFFFFF' : '#F9FAFB', borderBottom: i < filtered.length - 1 ? '1px solid #F3F4F6' : 'none' }}
              >
                <span className="font-mono text-xs font-semibold" style={{ color: '#4F46E5' }}>{fmtZip(z.zip_code)}</span>
                <span className="text-xs text-right" style={{ color: '#111827' }}>{z.sales_count.toLocaleString()}</span>
                <span className="text-xs text-right" style={{ color: '#4F46E5' }}>
                  {z.max_sale_price ? `$${Math.round(z.max_sale_price).toLocaleString()}` : '—'}
                </span>
                <span className="text-xs text-right" style={{ color: '#9CA3AF' }}>
                  {z.median_lot_size != null ? `${z.median_lot_size.toFixed(2)} ac` : '—'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Buy Box Recipe ────────────────────────────────────────────────────────

const SQFT_PER_ACRE = 43560

function fmtSqft(acres: number): string {
  return `${Math.round(acres * SQFT_PER_ACRE).toLocaleString()} sq ft (${acres} ac)`
}

function fmtZip(z: string): string {
  return z.replace(/\.0$/, '').trim()
}

function BuyBoxRecipe({
  zipStats,
  comps,
  sweetSpot,
  topStates,
  topCounties,
  landQuality,
}: {
  zipStats: ZipStats[]
  comps: Array<{ lot_acres: number; sale_price: number; zip?: string }>
  sweetSpot?: SweetSpot | null
  topStates: string[]
  topCounties: string[]
  landQuality?: LandQualityStats | null
}) {
  const [copied, setCopied] = useState(false)
  const [building, setBuilding] = useState(false)
  const [built, setBuilt] = useState(false)

  const allPpas = zipStats.map(z => z.median_price_per_acre).filter((v): v is number => v != null && Number.isFinite(v) && v > 0)
  const sortedPpas = [...allPpas].sort((a, b) => a - b)
  const mid = Math.floor(sortedPpas.length / 2)
  const buyBoxMedianPpa = sortedPpas.length === 0 ? 0
    : sortedPpas.length % 2 === 0 ? (sortedPpas[mid - 1] + sortedPpas[mid]) / 2
    : sortedPpas[mid]
  const bbOutlierCodes = new Set(
    buyBoxMedianPpa > 0
      ? zipStats.filter(z => (z.median_price_per_acre ?? 0) > 3 * buyBoxMedianPpa).map(z => z.zip_code)
      : []
  )
  const topZips = [...zipStats]
    .filter(z => !bbOutlierCodes.has(z.zip_code) && z.sales_count >= 5)
    .sort((a, b) => b.sales_count - a.sales_count)
    .slice(0, 20)
    .map(z => fmtZip(z.zip_code))
  const sortedCounties = [...topCounties].sort((a, b) => a.localeCompare(b))

  // Land quality — data-driven from sold comps, with industry-standard floors/ceilings
  const buildabilityCount = landQuality?.buildability_count ?? 0
  const buildabilityMin = buildabilityCount > 0
    ? Math.round((landQuality!.buildability_min ?? 80) / 10) * 10
    : 80
  const buildabilityAdjusted = landQuality?.buildability_adjusted ?? false
  const buildabilityRaw = landQuality?.buildability_raw != null
    ? Math.round((landQuality.buildability_raw / 10)) * 10
    : null
  const buildabilityLabel = buildabilityCount > 0
    ? buildabilityAdjusted && buildabilityRaw != null
      ? `${buildabilityMin}% minimum (comp median was ${buildabilityRaw}% — floor applied)`
      : `${buildabilityMin}% minimum (based on ${buildabilityCount} comps)`
    : '60% minimum (industry standard — no comp data)'

  const slopeCount = landQuality?.slope_count ?? 0
  const slopeMax = slopeCount > 0 ? Math.round(landQuality!.slope_p75 ?? 10) : null
  const slopeAdjusted = landQuality?.slope_adjusted ?? false
  const slopeRaw = landQuality?.slope_raw != null ? Math.round(landQuality.slope_raw) : null
  const slopeLabel = slopeCount > 0 && slopeMax != null
    ? slopeAdjusted && slopeRaw != null
      ? `${slopeMax}% max (comp data showed ${slopeRaw}% — ceiling applied)`
      : `${slopeMax}% max (based on ${slopeCount} comps)`
    : null

  const wetlandsCount = landQuality?.wetlands_count ?? 0
  const wetlandsMax = wetlandsCount > 0 ? Math.round(landQuality!.wetlands_p75 ?? 5) : null
  const wetlandsAdjusted = landQuality?.wetlands_adjusted ?? false
  const wetlandsRaw = landQuality?.wetlands_raw != null ? Math.round(landQuality.wetlands_raw) : null
  const wetlandsLabel = wetlandsCount > 0 && wetlandsMax != null
    ? wetlandsAdjusted && wetlandsRaw != null
      ? `Less than ${wetlandsMax}% (comp data showed ${wetlandsRaw}% — ceiling applied)`
      : `Less than ${wetlandsMax}% (based on ${wetlandsCount} comps)`
    : null

  const roadFrontageCount = landQuality?.road_frontage_count ?? 0
  const roadFrontageMin = roadFrontageCount > 0
    ? Math.round(landQuality!.road_frontage_p25 ?? 30)
    : null
  const roadFrontageAdjusted = landQuality?.road_frontage_adjusted ?? false
  const roadFrontageRaw = landQuality?.road_frontage_raw != null ? Math.round(landQuality.road_frontage_raw) : null
  const roadFrontageLabel = roadFrontageCount > 0 && roadFrontageMin != null
    ? roadFrontageAdjusted && roadFrontageRaw != null
      ? `Minimum ${roadFrontageMin} ft (comp data showed ${roadFrontageRaw} ft — floor applied)`
      : `Minimum ${roadFrontageMin} ft (based on ${roadFrontageCount} comps)`
    : 'Data not available in comps — recommend 30 ft minimum'

  const acres = comps.map(c => c.lot_acres).filter(v => Number.isFinite(v) && v > 0).sort((a, b) => a - b)
  // 25th/75th percentile — shown as secondary "Middle 50% of sales" info only
  const p25Acre = acres.length > 0 ? Math.max(0.1, Math.floor(percentile(acres, 25) * 10) / 10) : 0.3
  const p75Acre = acres.length > 0 ? Math.ceil(percentile(acres, 75) * 10) / 10 : 1.0
  const middle50Label = `${p25Acre}–${p75Acre} acres`

  // Sweet spot = recommended pull range (min/max lot size for Land Portal filter)
  let sweetMin = 0.1
  let sweetMax = 0.5
  if (sweetSpot) {
    const b = sweetSpot.bucket
    if (b === '0-0.5')      { sweetMin = 0.1;  sweetMax = 0.5  }
    else if (b === '0.5-1') { sweetMin = 0.5;  sweetMax = 1.0  }
    else if (b === '1-2')   { sweetMin = 1.0;  sweetMax = 2.0  }
    else if (b === '2-5')   { sweetMin = 2.0;  sweetMax = 5.0  }
    else if (b === '5-10')  { sweetMin = 5.0;  sweetMax = 10.0 }
    else if (b === '10+')   { sweetMin = 10.0; sweetMax = 40.0 }
  }
  const minSqft = Math.round(sweetMin * SQFT_PER_ACRE)
  const maxSqft = Math.round(sweetMax * SQFT_PER_ACRE)

  const recipeText = [
    '=== LAND PORTAL BUY BOX ===',
    `Generated: ${new Date().toLocaleDateString()}`,
    '',
    '1. LOCATION — Pull by County (not ZIP)',
    topStates.length ? `   State: ${topStates.join(', ')}` : '',
    sortedCounties.length ? `   PULL BY COUNTY: ${sortedCounties.join(', ')} (Land Portal → Location → County)` : '',
    sortedCounties.length ? '   Why: County pulls capture more deals than ZIP filtering.' : '',
    topZips.length ? `   Reference ZIPs (don't filter in LP): ${topZips.join(', ')}` : '',
    '',
    '2. PROPERTY TYPE',
    '   Land Portal → Property Type → Land Use — check ONLY:',
    '   ✓ Vacant Land (General)',
    '   ✓ Residential Vacant Land',
    '   Uncheck all others:',
    '   ✗ Commercial',
    '   ✗ Agricultural',
    '   ✗ Industrial',
    '   ✗ Mobile Home',
    '   ✗ Improved/Built lots',
    '',
    '3. LOT SIZE',
    `   Min: ${minSqft.toLocaleString()} sq ft (${sweetMin} acres)`,
    `   Max: ${maxSqft.toLocaleString()} sq ft (${sweetMax} acres)`,
    `   Middle 50% of sales: ${middle50Label}`,
    '',
    '4. LAND QUALITY',
    `   Buildability: ${buildabilityLabel}`,
    ...(slopeLabel ? [`   Max slope: ${slopeLabel}`] : []),
    ...(wetlandsLabel ? [`   Wetlands: ${wetlandsLabel}`] : []),
    '   FEMA flood zone: Exclude all flood zones',
    `   Road frontage: ${roadFrontageLabel}`,
    '   Landlocked: Exclude',
    '',
    '5. SALE HISTORY',
    '   Include: Sold in last 5 years',
    '   Exclude: Unknown sale dates',
    '   Exclude: Properties sold in last 2 years',
    '',
    '6. OWNER',
    '   Owner type: Individual / Trust only (not LLC/Corp)',
    '   Owner tenure: 5+ years',
    '   Absentee: Cross-county absentees preferred',
    '   Exclude: LLC / Corp owners',
  ].filter(Boolean).join('\n')

  function handleCopy() {
    navigator.clipboard.writeText(recipeText).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }

  async function handleBuildCampaign() {
    setBuilding(true)
    try {
      await createCrmCampaign(
        `Buy Box — ${topZips.slice(0, 3).join(', ')}${topZips.length > 3 ? '…' : ''}`,
        { cost_per_piece: 0.55, weekly_budget: 500, send_day: 'Tuesday' }
      )
      await saveBuyBox({ min_acreage: sweetMin, max_acreage: sweetMax, cost_per_piece: 0.55, weekly_budget: 500 })
      setBuilt(true)
      setTimeout(() => setBuilt(false), 3000)
    } catch (e) {
      alert('Failed to create campaign. Check console.'); console.error(e)
    } finally {
      setBuilding(false)
    }
  }

  function handlePdf() {
    const pill = (label: string) =>
      `<span style="background:rgba(92,41,119,0.08);color:#5C2977;border:1px solid rgba(92,41,119,0.2);border-radius:4px;padding:2px 8px;font-size:12px;display:inline-block;margin:2px">${label}</span>`
    const check = (text: string, ok = true) =>
      `<div style="display:flex;gap:8px;margin-bottom:4px;font-size:13px"><span style="color:${ok ? '#059669' : '#DC2626'};font-weight:700">${ok ? '✓' : '✗'}</span><span style="color:#1A0A2E">${text}</span></div>`
    const row = (label: string, value: string) =>
      `<div style="display:flex;gap:8px;margin-bottom:4px;font-size:13px"><span style="color:#6B5B8A;min-width:200px">${label}</span><span style="color:#1A0A2E;font-weight:600">${value}</span></div>`
    const sec = (title: string, content: string) =>
      `<div style="margin-bottom:20px"><h2 style="color:#5C2977;font-size:13px;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #E8E0F0;padding-bottom:6px;margin-bottom:10px">${title}</h2>${content}</div>`

    const html = `<!DOCTYPE html><html><head><title>Buy Box Recipe</title>
<style>body{font-family:-apple-system,sans-serif;padding:40px;color:#1A0A2E;background:#F8F6FB;max-width:800px}@media print{@page{margin:24px}}</style></head><body>
<h1 style="color:#5C2977;font-size:20px;margin-bottom:8px">Land Portal Buy Box Recipe</h1>
<p style="color:#6B5B8A;font-size:12px;margin-bottom:28px">Generated ${new Date().toLocaleDateString()} · Based on ${comps.length.toLocaleString()} sold comps</p>
${sec('1. Location — Pull by County (not ZIP)',
  (topStates.length ? row('State', topStates.join(', ')) : '') +
  (sortedCounties.length ? `<div style="color:#059669;font-weight:600;font-size:12px;margin-bottom:4px">Pull by County — Land Portal → Location → County</div><div style="margin:4px 0 8px">${sortedCounties.map(pill).join('')}</div><div style="background:#D1FAE5;border:1px solid rgba(5,150,105,0.2);border-radius:6px;padding:8px;font-size:11px;color:#059669;margin-bottom:8px"><strong>Why pull the whole county?</strong> ZIP codes cut across market boundaries — county pulls capture more deals and let the matching engine filter by comp strength.</div>` : '') +
  `<div style="color:#9B8AAE;font-size:11px;margin-bottom:4px">Reference ZIPs — for context only (don't filter by ZIP in LP)</div><div style="margin:4px 0">${topZips.map(pill).join('')}</div>`
)}
${sec('2. Property Type',
  `<p style="font-size:12px;color:#6B5B8A;margin-bottom:8px">Land Portal → Property Type → Land Use — check <strong>only</strong>:</p>` +
  check('Vacant Land (General)') +
  check('Residential Vacant Land') +
  `<p style="font-size:12px;color:#6B5B8A;margin:8px 0 4px">Uncheck all others:</p>` +
  check('Commercial', false) + check('Agricultural', false) + check('Industrial', false) +
  check('Mobile Home', false) + check('Improved/Built lots', false)
)}
${sec('3. Lot Size',
  row('Min lot size', `${minSqft.toLocaleString()} sq ft (${sweetMin} acres)`) +
  row('Max lot size', `${maxSqft.toLocaleString()} sq ft (${sweetMax} acres)`) +
  `<div style="color:#9B8AAE;font-size:11px;margin-top:6px">Middle 50% of sales: ${middle50Label}</div>`
)}
${sec('4. Land Quality',
  row('Buildability minimum', buildabilityLabel) + (slopeLabel ? row('Maximum slope', slopeLabel) : '') + (wetlandsLabel ? row('Wetlands coverage', wetlandsLabel) : '') +
  check('Exclude all FEMA flood zones', false) + check('Exclude landlocked parcels', false) + row('Road frontage', roadFrontageLabel)
)}
${sec('5. Comp Filters (Land Portal Export)',
  check('Sale Date: last 24 months') + check('Buyer Type: LLC / Corporation only') + check('Exclude: Individual / Trust buyers', false)
)}
${sec('6. Owner',
  row('Owner type', 'Individual / Trust only') + check('Exclude LLC / Corp owners', false) + row('Owner tenure', '5+ years') + row('Absentee', 'Cross-county absentees preferred')
)}
</body></html>`
    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 400) }
  }

  if (topZips.length === 0) return null

  const cardStyle = { background: '#F9FAFB', border: '1px solid #E5E7EB' }
  const hdr = (title: string) => (
    <p className="text-[10px] uppercase tracking-wider font-semibold mb-3" style={{ color: '#6B7280' }}>{title}</p>
  )

  return (
    <div className="card mb-6" style={{ border: '1.5px solid rgba(79,70,229,0.2)' }}>
      <div className="flex items-start justify-between mb-5">
        <div>
          <h2 className="font-semibold" style={{ color: '#111827' }}>Land Portal Buy Box Recipe</h2>
          <p className="text-xs mt-0.5" style={{ color: '#9CA3AF' }}>
            Exact filter settings derived from your {comps.length.toLocaleString()} sold comps — paste directly into Land Portal
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleCopy} className="btn-secondary text-xs" style={{ padding: '6px 12px' }}>
            {copied ? '✓ Copied!' : 'Copy Buy Box'}
          </button>
          <button onClick={handlePdf} className="btn-secondary text-xs" style={{ padding: '6px 12px' }}>
            Download PDF
          </button>
          <button onClick={handleBuildCampaign} className="btn-primary text-xs" style={{ padding: '6px 12px' }} disabled={building}>
            {built ? '✓ Campaign Created!' : building ? 'Creating…' : 'Build Campaign'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Section 1 — Location */}
        <div className="rounded-xl p-4 lg:col-span-3" style={cardStyle}>
          {hdr('1 · Location')}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            {topStates.length > 0 && (
              <div>
                <p className="mb-1" style={{ color: '#9CA3AF' }}>State</p>
                <div className="flex flex-wrap gap-1.5">
                  {topStates.map(s => (
                    <span key={s} className="font-semibold px-2 py-0.5 rounded text-[11px]" style={{ background: 'rgba(79,70,229,0.08)', color: '#4F46E5', border: '1px solid rgba(79,70,229,0.2)' }}>{s}</span>
                  ))}
                </div>
              </div>
            )}
            {sortedCounties.length > 0 && (
              <div className="md:col-span-2">
                <p className="mb-1 font-semibold" style={{ color: '#10B981' }}>Pull by County — Land Portal → Location → County</p>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {sortedCounties.map(c => (
                    <span key={c} className="text-[11px] px-2 py-0.5 rounded font-medium" style={{ background: 'rgba(16,185,129,0.12)', color: '#10B981', border: '1px solid rgba(16,185,129,0.2)' }}>{c}</span>
                  ))}
                </div>
                <div className="rounded-lg p-2.5" style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.15)' }}>
                  <p className="text-[10px]" style={{ color: '#10B981' }}><span className="font-semibold">Why pull the whole county?</span> ZIP codes cut across market boundaries — filtering by ZIP excludes deals just outside your target area that would still comp well. Pull the entire county and let the matching engine filter by comp strength.</p>
                </div>
              </div>
            )}
            <div>
              <p className="mb-1" style={{ color: '#6B7280' }}>Top 20 ZIPs — reference only · don't filter by ZIP in LP</p>
              <div className="flex flex-wrap gap-1.5">
                {topZips.map(z => (
                  <span key={z} className="font-mono text-[11px] px-2 py-0.5 rounded" style={{ background: '#F3F4F6', color: '#6B7280', border: '1px solid #E5E7EB' }}>{z}</span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Section 2 — Property Type */}
        <div className="rounded-xl p-4" style={cardStyle}>
          {hdr('2 · Property Type')}
          <div className="space-y-2 text-xs">
            <p className="text-[10px] mb-1" style={{ color: '#9CA3AF' }}>Land Portal → Property Type → Land Use — check <strong>only</strong>:</p>
            <div className="flex gap-2"><span style={{ color: '#059669', fontWeight: 700 }}>✓</span><span style={{ color: '#374151' }}>Vacant Land (General)</span></div>
            <div className="flex gap-2"><span style={{ color: '#059669', fontWeight: 700 }}>✓</span><span style={{ color: '#374151' }}>Residential Vacant Land</span></div>
            <p className="text-[10px] mt-1 mb-0.5" style={{ color: '#9CA3AF' }}>Uncheck all others:</p>
            <div className="flex gap-2"><span style={{ color: '#EF4444', fontWeight: 700 }}>✗</span><span style={{ color: '#9CA3AF' }}>Commercial</span></div>
            <div className="flex gap-2"><span style={{ color: '#EF4444', fontWeight: 700 }}>✗</span><span style={{ color: '#9CA3AF' }}>Agricultural</span></div>
            <div className="flex gap-2"><span style={{ color: '#EF4444', fontWeight: 700 }}>✗</span><span style={{ color: '#9CA3AF' }}>Industrial</span></div>
            <div className="flex gap-2"><span style={{ color: '#EF4444', fontWeight: 700 }}>✗</span><span style={{ color: '#9CA3AF' }}>Mobile Home</span></div>
            <div className="flex gap-2"><span style={{ color: '#EF4444', fontWeight: 700 }}>✗</span><span style={{ color: '#9CA3AF' }}>Improved/Built lots</span></div>
          </div>
        </div>

        {/* Section 3 — Lot Size */}
        <div className="rounded-xl p-4" style={cardStyle}>
          {hdr('3 · Lot Size')}
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span style={{ color: '#6B7280' }}>Min lot size</span>
              <span style={{ color: '#111827', fontWeight: 600 }}>{fmtSqft(sweetMin)}</span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: '#6B7280' }}>Max lot size</span>
              <span style={{ color: '#111827', fontWeight: 600 }}>{fmtSqft(sweetMax)}</span>
            </div>
            <div className="mt-2 pt-2" style={{ borderTop: '1px solid #E5E7EB' }}>
              <span style={{ color: '#9CA3AF', fontSize: '10px' }}>Middle 50% of sales: {middle50Label}</span>
            </div>
          </div>
        </div>

        {/* Section 4 — Land Quality */}
        <div className="rounded-xl p-4" style={cardStyle}>
          {hdr('4 · Land Quality')}
          <div className="space-y-2 text-xs">
            <LQRow label="Buildability minimum" value={buildabilityLabel} highlight adjusted={buildabilityAdjusted} />
            {slopeLabel && <LQRow label="Maximum slope" value={slopeLabel} adjusted={slopeAdjusted} />}
            {wetlandsLabel && <LQRow label="Wetlands coverage" value={wetlandsLabel} adjusted={wetlandsAdjusted} />}
            <div className="flex gap-2"><span style={{ color: '#EF4444', fontWeight: 700 }}>✗</span><span style={{ color: '#9CA3AF' }}>FEMA flood zones (exclude all)</span></div>
            <div className="flex gap-2"><span style={{ color: '#EF4444', fontWeight: 700 }}>✗</span><span style={{ color: '#9CA3AF' }}>Landlocked parcels (exclude)</span></div>
            <LQRow label="Road frontage" value={roadFrontageLabel} highlight adjusted={roadFrontageAdjusted} />
          </div>
        </div>

        {/* Section 5 — Sale History */}
        <div className="rounded-xl p-4" style={cardStyle}>
          {hdr('5 · Comp Filters (Land Portal Export)')}
          <div className="space-y-2 text-xs">
            <div className="flex gap-2"><span style={{ color: '#059669', fontWeight: 700 }}>✓</span><span style={{ color: '#374151' }}>Sale Date: last 24 months</span></div>
            <div className="flex gap-2"><span style={{ color: '#059669', fontWeight: 700 }}>✓</span><span style={{ color: '#374151' }}>Buyer Type: LLC / Corporation only</span></div>
            <div className="flex gap-2"><span style={{ color: '#DC2626', fontWeight: 700 }}>✗</span><span style={{ color: '#6B7280' }}>Individual / Trust buyers (exclude — less reliable pricing)</span></div>
          </div>
          <p className="text-[10px] mt-2 italic" style={{ color: '#6B7280' }}>LLC buyers are professional investors who pay retail — best benchmark for offer pricing</p>
        </div>

        {/* Section 6 — Owner */}
        <div className="rounded-xl p-4" style={cardStyle}>
          {hdr('6 · Owner')}
          <div className="space-y-2 text-xs">
            <div className="flex justify-between"><span style={{ color: '#6B7280' }}>Owner type</span><span style={{ color: '#111827', fontWeight: 600 }}>Individual / Trust only</span></div>
            <div className="flex gap-2"><span style={{ color: '#DC2626', fontWeight: 700 }}>✗</span><span style={{ color: '#6B7280' }}>LLC / Corp owners (exclude)</span></div>
            <div className="flex justify-between"><span style={{ color: '#6B7280' }}>Owner tenure</span><span style={{ color: '#111827', fontWeight: 600 }}>5+ years</span></div>
            <div className="flex justify-between"><span style={{ color: '#6B7280' }}>Absentee</span><span style={{ color: '#4F46E5', fontWeight: 600 }}>Cross-county preferred</span></div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Math helpers ──────────────────────────────────────────────────────────

function percentile(arr: number[], pct: number): number {
  if (arr.length === 0) return 0
  const idx = (pct / 100) * (arr.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return arr[lo]
  return arr[lo] + (arr[hi] - arr[lo]) * (idx - lo)
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const n = sorted.length
  return n % 2 === 1 ? sorted[Math.floor(n / 2)] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2
}

// ── Sub-components ────────────────────────────────────────────────────────

function SummaryCard({ label, value, sub, icon, accent }: {
  label: string; value: string; sub?: string; icon: React.ReactNode; accent: string
}) {
  return (
    <div className="stat-card">
      <div className="flex items-start justify-between mb-3">
        <p className="text-xs uppercase tracking-wider font-medium" style={{ color: '#6B7280', letterSpacing: '0.8px' }}>{label}</p>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${accent}20`, color: accent }}>
          {icon}
        </div>
      </div>
      <p className="text-2xl font-bold mb-0.5" style={{ color: accent === '#5C2977' ? '#4F46E5' : accent }}>{value}</p>
      {sub && <p className="text-xs" style={{ color: '#6B7280' }}>{sub}</p>}
    </div>
  )
}

// Land Quality row — shows amber "adjusted" note when floor/ceiling was applied
function LQRow({
  label,
  value,
  highlight,
  adjusted,
}: {
  label: string
  value: string
  highlight?: boolean
  adjusted?: boolean
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div className="flex justify-between gap-2">
        <span style={{ color: '#9CA3AF', flexShrink: 0 }}>{label}</span>
        <span style={{ color: highlight ? '#10B981' : '#111827', fontWeight: 600, textAlign: 'right' }}>
          {value}
        </span>
      </div>
      {adjusted && (
        <div
          style={{
            fontSize: 10, color: '#D97706', textAlign: 'right',
            background: 'rgba(217,119,6,0.06)',
            border: '1px solid rgba(217,119,6,0.15)',
            borderRadius: 4, padding: '1px 6px',
            alignSelf: 'flex-end',
          }}
        >
          ⚠ adjusted from comp data — industry standard applied
        </div>
      )}
    </div>
  )
}

const IconDB = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
const IconDollar = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
const IconTarget = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>
const IconPin = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
