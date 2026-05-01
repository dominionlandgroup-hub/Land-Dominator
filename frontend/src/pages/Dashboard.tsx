import React, { useEffect, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts'
import { useApp } from '../context/AppContext'
import { fetchDashboard } from '../api/client'
import { createCrmCampaign, saveBuyBox } from '../api/crm'
import LoadingSpinner from '../components/LoadingSpinner'
import DataTable from '../components/DataTable'
import type { Column } from '../components/DataTable'
import type { ZipStats } from '../types'
import CompMap from '../components/CompMap'
import WelcomeScreen from './WelcomeScreen'

const CHART_COLORS = ['#5C2977','#8B4DB8','#D5A940','#7B3E99','#A068C8','#2D7A4F','#B8860B','#C05000','#3D1A5C','#6B5B8A','#4CAF7A','#9B8AAE']

export default function Dashboard() {
  const { compsStats, dashboardData, setDashboardData, setCurrentPage } = useApp()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedZips, setSelectedZips] = useState<string[]>([])
  const [viewMode, setViewMode] = useState<'charts' | 'map'>('charts')
  const [mapVisibleZips, setMapVisibleZips] = useState<string[]>([])

  useEffect(() => {
    if (!compsStats) return
    if (dashboardData && selectedZips.length === 0) return
    load()
  }, [compsStats, selectedZips])

  async function load() {
    if (!compsStats) return
    setLoading(true)
    setError(null)
    try {
      const data = await fetchDashboard(compsStats.session_id, selectedZips)
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

  const zipOptions = dashboardData?.available_zips ?? []

  useEffect(() => {
    setMapVisibleZips([])
  }, [dashboardData?.available_zips.join(',')])

  function toggleZip(zip: string) {
    setSelectedZips((prev) => prev.includes(zip) ? prev.filter((z) => z !== zip) : [...prev, zip])
  }

  function toggleMapZip(zip: string) {
    setMapVisibleZips((prev) => prev.includes(zip) ? prev.filter((z) => z !== zip) : [...prev, zip])
  }

  // Chart data
  const volumeData = (dashboardData?.zip_stats ?? []).map((z) => ({
    zip: z.zip_code,
    sales: z.sales_count,
  }))

  const ppaData = (dashboardData?.zip_stats ?? [])
    .filter((z) => z.median_price_per_acre != null)
    .sort((a, b) => (b.median_price_per_acre ?? 0) - (a.median_price_per_acre ?? 0))
    .map((z) => ({
      zip: z.zip_code,
      ppa: Math.round(z.median_price_per_acre ?? 0),
    }))

  const maxPPA = Math.max(...ppaData.map((d) => d.ppa), 1)

  const market = computeMarketIntelligence(dashboardData?.zip_stats ?? [], dashboardData?.comp_locations ?? [], dashboardData?.sweet_spot)

  // Table columns
  const cols: Column<ZipStats>[] = [
    {
      key: 'zip_code', header: 'ZIP', sortable: true,
      render: (v) => <span className="font-mono" style={{ color: '#5C2977', fontWeight: 600, cursor: 'pointer' }}>{String(v)}</span>,
    },
    {
      key: 'sales_count', header: 'Sales', sortable: true, align: 'right',
      render: (v) => <span style={{ color: '#5C2977', fontWeight: 600 }}>{String(v)}</span>,
    },
    {
      key: 'median_lot_size', header: 'Median Ac', sortable: true, align: 'right',
      render: (v) => v == null ? <span style={{ color: '#9B8AAE' }}>—</span> : <span>{(v as number).toFixed(2)}</span>,
    },
    {
      key: 'min_lot_size', header: 'Min Ac', sortable: true, align: 'right', defaultHidden: true,
      render: (v) => v == null ? <span style={{ color: '#9B8AAE' }}>—</span> : <span>{(v as number).toFixed(2)}</span>,
    },
    {
      key: 'max_lot_size', header: 'Max Ac', sortable: true, align: 'right', defaultHidden: true,
      render: (v) => v == null ? <span style={{ color: '#9B8AAE' }}>—</span> : <span>{(v as number).toFixed(2)}</span>,
    },
    {
      key: 'min_sale_price', header: 'Min Price', sortable: true, align: 'right', defaultHidden: true,
      render: (v) => v == null ? <span style={{ color: '#9B8AAE' }}>—</span> : <span>${Math.round(v as number).toLocaleString()}</span>,
    },
    {
      key: 'max_sale_price', header: 'Max Price', sortable: true, align: 'right',
      render: (v) => v == null ? <span style={{ color: '#9B8AAE' }}>—</span> : <span>${Math.round(v as number).toLocaleString()}</span>,
    },
    {
      key: 'median_price_per_acre', header: 'Median $/Ac', sortable: true, align: 'right',
      render: (v) => v == null ? <span style={{ color: '#9B8AAE' }}>—</span> : (
        <span className="font-semibold" style={{ color: (v as number) > 500000 ? '#D5A940' : '#D5A940' }}>
          ${Math.round(v as number).toLocaleString()}
        </span>
      ),
    },
    {
      key: 'avg_price_per_acre', header: 'Avg $/Ac', sortable: true, align: 'right', defaultHidden: true,
      render: (v) => v == null ? <span style={{ color: '#9B8AAE' }}>—</span> : <span>${Math.round(v as number).toLocaleString()}</span>,
    },
    {
      key: 'price_band_lt50k', header: 'Price Bands', align: 'left',
      render: (_, row) => <PriceBandPills row={row} />,
    },
    {
      key: 'acreage_band_0_1', header: 'Acreage Mix', align: 'left', defaultHidden: true,
      render: (_, row) => <AcreageBandPills row={row} />,
    },
  ]

  const tooltipStyle = {
    contentStyle: { background: '#3D1A5C', border: '1px solid rgba(213,169,64,0.3)', borderRadius: 8, fontSize: 12 },
    labelStyle: { color: '#FFFFFF', fontWeight: 600 },
    itemStyle: { color: '#E8D5F5' },
    cursor: { fill: 'rgba(92,41,119,0.06)' },
  }

  return (
    <div className="flex flex-col min-h-screen">
      {/* Page header */}
      <div className="page-header">
        <div>
          <h1 className="text-lg" style={{ color: '#1A0A2E', fontWeight: 700 }}>ZIP Code Intelligence Dashboard</h1>
          <p className="text-xs mt-0.5" style={{ color: '#6B5B8A' }}>
            {compsStats.valid_rows.toLocaleString()} valid sold comps · {dashboardData?.available_zips.length ?? '…'} ZIP codes
          </p>
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
        {/* ── Summary Stats Cards ─────────────────────────────────── */}
        {dashboardData && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <SummaryCard
              label="Valid Comps"
              value={dashboardData.valid_comps.toLocaleString()}
              sub={`of ${dashboardData.total_comps.toLocaleString()} total`}
              icon={<IconDB />}
              accent="#5C2977"
            />
            <SummaryCard
              label="Median Sale Price"
              value={dashboardData.median_price ? `$${Math.round(dashboardData.median_price).toLocaleString()}` : '—'}
              sub="across all ZIPs"
              icon={<IconDollar />}
              accent="#D5A940"
            />
            <SummaryCard
              label="Median $/Acre"
              value={dashboardData.median_price_per_acre
                ? `$${Math.round(dashboardData.median_price_per_acre).toLocaleString()}`
                : '—'}
              sub="all valid comps"
              icon={<IconAcre />}
              accent="#8B4DB8"
            />
            <SummaryCard
              label="Most Active ZIP"
              value={dashboardData.zip_stats[0]?.zip_code ?? '—'}
              sub={dashboardData.zip_stats[0] ? `${dashboardData.zip_stats[0].sales_count} sales` : ''}
              icon={<IconPin />}
              accent="#D5A940"
            />
          </div>
        )}

        {/* ── ZIP Filter ─────────────────────────────────────────── */}
        {zipOptions.length > 0 && (
          <div className="card mb-6">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-medium" style={{ color: '#1A0A2E' }}>Filter by ZIP Code</p>
              {selectedZips.length > 0 && (
                <button className="text-xs hover:opacity-80 transition-opacity" style={{ color: '#5C2977' }} onClick={() => setSelectedZips([])}>
                  Clear all
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {zipOptions.map((zip) => (
                <button
                  key={zip}
                  onClick={() => toggleZip(zip)}
                  className="px-3 py-1 rounded-full text-sm font-medium transition-all"
                  style={
                    selectedZips.includes(zip)
                      ? { background: '#5C2977', color: '#FFFFFF', border: '1px solid #5C2977', boxShadow: '0 2px 8px rgba(92,41,119,0.3)' }
                      : { background: '#FFFFFF', color: '#5C2977', border: '1.5px solid #D4B8E8' }
                  }
                >
                  {zip}
                </button>
              ))}
            </div>
          </div>
        )}

        {loading && (
          <div className="flex justify-center py-16">
            <LoadingSpinner size="lg" label="Computing ZIP analytics…" />
          </div>
        )}

        {error && (
          <div className="rounded-xl px-5 py-4 mb-6 text-sm" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#dc2626' }}>
            {error}
          </div>
        )}

        {dashboardData && !loading && (
          <>
            <div className="card mb-6">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-sm" style={{ color: '#1A0A2E' }}>Dashboard View</h2>
                <div className="inline-flex gap-1">
                  <button
                    className={`toggle-btn${viewMode === 'charts' ? ' active' : ''}`}
                    onClick={() => setViewMode('charts')}
                  >
                    Charts
                  </button>
                  <button
                    className={`toggle-btn${viewMode === 'map' ? ' active' : ''}`}
                    onClick={() => setViewMode('map')}
                  >
                    Map
                  </button>
                </div>
              </div>
            </div>

            {/* ── Insight Panel ─────────────────────────────────── */}
            {dashboardData.insight && (
              <div className="insight-panel mb-6">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-none" style={{ background: 'rgba(92,41,119,0.1)' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D5A940" strokeWidth="2">
                      <circle cx="12" cy="12" r="10"/>
                      <line x1="12" y1="8" x2="12" y2="12"/>
                      <line x1="12" y1="16" x2="12.01" y2="16"/>
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-semibold mb-1" style={{ color: '#5C2977' }}>Market Intelligence</p>
                    <p className="text-sm leading-relaxed" style={{ color: '#3D2B5E' }}>{dashboardData.insight}</p>
                  </div>
                </div>
              </div>
            )}

            {/* ── Charts row ────────────────────────────────────── */}
            {viewMode === 'charts' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              {/* Sales Volume */}
              <div className="card">
                <h2 className="font-semibold text-sm mb-1" style={{ color: '#1A0A2E' }}>Sales Volume by ZIP</h2>
                <p className="text-xs mb-4" style={{ color: '#6B5B8A' }}>Number of valid sales per ZIP code (sorted descending)</p>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={volumeData} margin={{ left: 0, right: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(92,41,119,0.06)" vertical={false} />
                    <XAxis dataKey="zip" tick={{ fill: '#6B5B8A', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: '#6B5B8A', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip {...tooltipStyle} formatter={(v: number) => [v.toLocaleString(), 'Sales']} />
                    <Bar dataKey="sales" radius={[4, 4, 0, 0]}>
                      {volumeData.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Median PPA */}
              <div className="card">
                <h2 className="font-semibold text-sm mb-1" style={{ color: '#1A0A2E' }}>Median Price Per Acre by ZIP</h2>
                <p className="text-xs mb-4" style={{ color: '#6B5B8A' }}>Outlier ZIPs indicate waterfront or premium areas</p>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={ppaData} margin={{ left: 0, right: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(92,41,119,0.06)" vertical={false} />
                    <XAxis dataKey="zip" tick={{ fill: '#6B5B8A', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis
                      tick={{ fill: '#6B5B8A', fontSize: 11 }}
                      tickFormatter={(v) => v >= 1000 ? `$${(v / 1000).toFixed(0)}K` : `$${v}`}
                      axisLine={false} tickLine={false}
                    />
                    <Tooltip
                      {...tooltipStyle}
                      formatter={(v: number) => [`$${v.toLocaleString()}/ac`, 'Median $/Acre']}
                    />
                    <Bar dataKey="ppa" radius={[4, 4, 0, 0]}>
                      {ppaData.map((entry, i) => (
                        <Cell
                          key={i}
                          fill={entry.ppa > maxPPA * 0.7 ? '#D5A940' : CHART_COLORS[i % CHART_COLORS.length]}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              </div>
            )}

            {viewMode === 'map' && (
              <div className="card mb-6">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-semibold text-sm" style={{ color: '#1A0A2E' }}>Sold Comps Map</h2>
                  {mapVisibleZips.length > 0 && (
                    <button className="text-xs" style={{ color: '#5C2977' }} onClick={() => setMapVisibleZips([])}>
                      Show all ZIPs
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 mb-4">
                  {zipOptions.map((zip, i) => (
                    <button
                      key={zip}
                      onClick={() => toggleMapZip(zip)}
                      className="px-2.5 py-1 rounded-full text-xs font-medium border"
                      style={mapVisibleZips.length === 0 || mapVisibleZips.includes(zip)
                        ? { borderColor: CHART_COLORS[i % CHART_COLORS.length], color: CHART_COLORS[i % CHART_COLORS.length], background: `${CHART_COLORS[i % CHART_COLORS.length]}20` }
                        : { borderColor: '#E8E0F0', color: '#6B5B8A', background: '#F8F6FB' }}
                    >
                      {zip}
                    </button>
                  ))}
                </div>
                <CompMap
                  comps={dashboardData.comp_locations}
                  availableZips={zipOptions}
                  visibleZips={mapVisibleZips}
                  onZipToggle={toggleMapZip}
                />
              </div>
            )}

            <div className="card mb-6">
              <h2 className="font-semibold mb-3" style={{ color: '#1A0A2E' }}>Market Intelligence</h2>
              <p className="text-sm leading-relaxed mb-4" style={{ color: '#3D2B5E' }}>
                {market.paragraph}
              </p>

              <div className="rounded-xl p-4" style={{ background: '#F8F6FB', border: '1px solid #E8E0F0' }}>
                <p className="text-xs uppercase tracking-wider mb-3" style={{ color: '#6B5B8A' }}>Recommended Target Profile</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                  <div>
                    <span style={{ color: '#6B5B8A' }}>Ideal acreage range:</span>{' '}
                    <span style={{ color: '#1A0A2E' }}>{market.idealAcreageRange}</span>
                  </div>
                  <div>
                    <span style={{ color: '#6B5B8A' }}>Expected offer range:</span>{' '}
                    <span style={{ color: '#D5A940' }}>{market.expectedOfferRange}</span>
                  </div>
                  <div>
                    <span style={{ color: '#6B5B8A' }}>Target ZIPs:</span>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {market.targetZips.length > 0 ? market.targetZips.map((z) => (
                        <button
                          key={z}
                          onClick={() => toggleZip(z)}
                          className="badge badge-blue text-[10px]"
                        >
                          {z}
                        </button>
                      )) : <span className="text-xs" style={{ color: '#6B5B8A' }}>No ZIPs with 20+ sales</span>}
                    </div>
                  </div>
                  <div>
                    <span style={{ color: '#6B5B8A' }}>Avoid ZIPs:</span>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {market.avoidZips.length > 0 ? market.avoidZips.map((z) => (
                        <span key={z} className="badge badge-red text-[10px]">{z}</span>
                      )) : <span className="text-xs" style={{ color: '#6B5B8A' }}>None</span>}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Buy Box Recipe ─────────────────────────────────── */}
            <BuyBoxRecipe
              zipStats={dashboardData.zip_stats}
              comps={dashboardData.comp_locations}
              sweetSpot={dashboardData.sweet_spot}
            />

            {/* ── ZIP Stats Table ───────────────────────────────── */}
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold" style={{ color: '#1A0A2E' }}>
                  ZIP Performance Table
                  <span className="text-sm font-normal ml-2" style={{ color: '#6B5B8A' }}>
                    ({dashboardData.zip_stats.length} ZIPs)
                  </span>
                </h2>
              </div>
              <DataTable<ZipStats>
                columns={cols}
                data={dashboardData.zip_stats}
                pageSize={25}
                emptyMessage="No comp data found for selected ZIPs"
                searchable
                searchKeys={['zip_code']}
              />
            </div>

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

// ── Buy Box Recipe ────────────────────────────────────────────────────────

function BuyBoxRecipe({
  zipStats,
  comps,
  sweetSpot,
}: {
  zipStats: ZipStats[]
  comps: Array<{ lot_acres: number; sale_price: number; zip_code?: string }>
  sweetSpot?: { bucket: string; count: number; total_sales: number; expected_offer_low: number; expected_offer_high: number } | null
}) {
  const [copied, setCopied] = useState(false)
  const [building, setBuilding] = useState(false)
  const [built, setBuilt] = useState(false)

  // Top ZIPs by sales count
  const topZips = [...zipStats]
    .sort((a, b) => b.sales_count - a.sales_count)
    .slice(0, 10)
    .map((z) => z.zip_code)

  // Acreage percentiles from comp_locations
  const acres = comps.map((c) => c.lot_acres).filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b)
  const acreP25 = percentile(acres, 25)
  const acreP75 = percentile(acres, 75)
  const minAcre = acres.length > 0 ? Math.max(0.1, Math.floor(acreP25 * 10) / 10) : 0.5
  const maxAcre = acres.length > 0 ? Math.ceil(acreP75 * 10) / 10 : 5

  // Pricing
  const prices = comps.map((c) => c.sale_price).filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b)
  const priceP75 = prices.length > 0 ? percentile(prices, 75) : 0
  const maxTlp = Math.round(priceP75 * 2)
  const offerLow = Math.round(maxTlp * 0.35)
  const offerHigh = Math.round(maxTlp * 0.525)

  // Sweet spot acreage label
  let acreLabel = `${minAcre}–${maxAcre} acres`
  if (sweetSpot) {
    const b = sweetSpot.bucket
    if (b === '0-0.5') acreLabel = '0.1–0.5 acres'
    else if (b === '0.5-1') acreLabel = '0.5–1 acres'
    else if (b === '1-2') acreLabel = '1–2 acres'
    else if (b === '2-5') acreLabel = '2–5 acres'
    else if (b === '5-10') acreLabel = '5–10 acres'
    else if (b === '10+') acreLabel = '10–40 acres'
  }

  // Expected list size estimate: ~500 per top ZIP
  const estListSize = topZips.length * 500
  const costPerPiece = 0.55
  const weeklyBudget = 500
  const estBudget = Math.round(estListSize * costPerPiece)
  const estWeeks = Math.ceil(estListSize / Math.floor(weeklyBudget / costPerPiece))

  const recipeText = [
    '=== LAND PORTAL BUY BOX ===',
    '',
    `LOCATION FILTERS`,
    `  ZIP Codes: ${topZips.join(', ')}`,
    `  (Enter each ZIP in Land Portal → Location → ZIP Code)`,
    '',
    `PROPERTY TYPE`,
    `  ✓ Vacant Land`,
    `  ✗ Residential / Commercial / Other (uncheck all)`,
    '',
    `SIZE FILTERS`,
    `  Min Acreage: ${minAcre} acres`,
    `  Max Acreage: ${maxAcre} acres`,
    `  (Targeting sweet spot: ${acreLabel})`,
    '',
    `MLS / LISTING STATUS`,
    `  ✓ Never Listed (off-market only)`,
    `  ✗ Currently Listed`,
    `  ✗ Recently Sold`,
    '',
    `LAND QUALITY`,
    `  ✓ Buildable`,
    `  ✓ In-fill lots OK`,
    `  ✗ Wetlands / Flood Zone (exclude if possible)`,
    '',
    `OWNER FILTERS`,
    `  ✓ Individual / Trust owners (not LLC/Corp)`,
    `  Owner tenure: 5+ years`,
    `  ✗ Absentee owners in same county (keep cross-county absentees)`,
    '',
    `PRICING / OFFER`,
    `  Max TLP (target list price): $${maxTlp.toLocaleString()}`,
    `  Offer range: $${offerLow.toLocaleString()}–$${offerHigh.toLocaleString()} (35–52.5% of TLP)`,
    `  Formula: TLP = 75th pct sale price × 2; Offer = 52.5% × TLP`,
    '',
    `EXPECTED RESULTS`,
    `  Estimated list size: ~${estListSize.toLocaleString()} parcels`,
    `  Mail budget (${costPerPiece}/piece): ~$${estBudget.toLocaleString()} total`,
    `  At $${weeklyBudget}/week: ~${estWeeks} weeks to mail full list`,
  ].join('\n')

  function handleCopy() {
    navigator.clipboard.writeText(recipeText).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  async function handleBuildCampaign() {
    setBuilding(true)
    try {
      const campaign = await createCrmCampaign(
        `Buy Box — ${topZips.slice(0, 3).join(', ')}${topZips.length > 3 ? '…' : ''}`,
        {
          total_budget: estBudget,
          weekly_budget: weeklyBudget,
          cost_per_piece: costPerPiece,
          send_day: 'Tuesday',
        }
      )
      await saveBuyBox({
        min_acreage: minAcre,
        max_acreage: maxAcre,
        max_price: maxTlp,
        offer_pct: 52.5,
        weekly_budget: weeklyBudget,
        cost_per_piece: costPerPiece,
      })
      setBuilt(true)
      setTimeout(() => setBuilt(false), 3000)
    } catch (e) {
      alert('Failed to create campaign. Check console.')
      console.error(e)
    } finally {
      setBuilding(false)
    }
  }

  function handlePdf() {
    const html = `<!DOCTYPE html><html><head><title>Buy Box Recipe</title>
<style>body{font-family:monospace;padding:40px;color:#1A0A2E;max-width:800px}
h1{color:#5C2977;font-size:20px;margin-bottom:24px}
.section{margin-bottom:20px}.section h2{color:#5C2977;font-size:13px;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #E8E0F0;padding-bottom:6px;margin-bottom:10px}
.row{display:flex;gap:8px;margin-bottom:4px;font-size:13px}.label{color:#6B5B8A;min-width:200px}.value{color:#1A0A2E;font-weight:600}
.zips{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}.zip{background:#5C297715;color:#5C2977;border:1px solid #5C297740;border-radius:4px;padding:2px 8px;font-size:12px}
.highlight{background:#D5A94015;border:1px solid #D5A94040;border-radius:8px;padding:16px;margin-top:8px}
@media print{@page{margin:24px}}</style></head><body>
<h1>Land Portal Buy Box Recipe</h1>
<p style="color:#6B5B8A;font-size:12px;margin-bottom:24px">Generated ${new Date().toLocaleDateString()} · Based on ${comps.length.toLocaleString()} sold comps</p>
<div class="section"><h2>Location</h2>
<div class="row"><span class="label">Top ZIPs by sales volume</span></div>
<div class="zips">${topZips.map(z => `<span class="zip">${z}</span>`).join('')}</div></div>
<div class="section"><h2>Property Type</h2>
<div class="row"><span class="label">Asset type</span><span class="value">Vacant Land only</span></div>
<div class="row"><span class="label">Listing status</span><span class="value">Never listed (off-market)</span></div></div>
<div class="section"><h2>Size Filters</h2>
<div class="row"><span class="label">Min acreage</span><span class="value">${minAcre} acres</span></div>
<div class="row"><span class="label">Max acreage</span><span class="value">${maxAcre} acres</span></div>
<div class="row"><span class="label">Sweet spot</span><span class="value">${acreLabel}</span></div></div>
<div class="section"><h2>Owner Filters</h2>
<div class="row"><span class="label">Owner type</span><span class="value">Individual / Trust (not LLC/Corp)</span></div>
<div class="row"><span class="label">Owner tenure</span><span class="value">5+ years</span></div>
<div class="row"><span class="label">Absentee</span><span class="value">Cross-county absentees preferred</span></div></div>
<div class="section"><h2>Pricing &amp; Offer</h2>
<div class="highlight">
<div class="row"><span class="label">Max TLP (target list price)</span><span class="value">$${maxTlp.toLocaleString()}</span></div>
<div class="row"><span class="label">Offer low (35%)</span><span class="value">$${offerLow.toLocaleString()}</span></div>
<div class="row"><span class="label">Offer high (52.5%)</span><span class="value">$${offerHigh.toLocaleString()}</span></div>
<div class="row" style="margin-top:8px;font-size:11px;color:#6B5B8A"><span>TLP = 75th percentile sale price × 2 = $${Math.round(priceP75).toLocaleString()} × 2</span></div></div></div>
<div class="section"><h2>Expected Results</h2>
<div class="row"><span class="label">Estimated list size</span><span class="value">~${estListSize.toLocaleString()} parcels</span></div>
<div class="row"><span class="label">Total mail budget</span><span class="value">~$${estBudget.toLocaleString()} at $${costPerPiece}/piece</span></div>
<div class="row"><span class="label">Weeks to mail full list</span><span class="value">~${estWeeks} weeks at $${weeklyBudget}/week</span></div></div>
</body></html>`
    const w = window.open('', '_blank')
    if (w) {
      w.document.write(html)
      w.document.close()
      setTimeout(() => w.print(), 400)
    }
  }

  if (topZips.length === 0) return null

  return (
    <div className="card mb-6" style={{ border: '1.5px solid rgba(213,169,64,0.35)' }}>
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="font-semibold" style={{ color: '#1A0A2E' }}>Land Portal Buy Box Recipe</h2>
          <p className="text-xs mt-0.5" style={{ color: '#6B5B8A' }}>
            Exact filter settings derived from your {comps.length.toLocaleString()} sold comps
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleCopy}
            className="btn-secondary text-xs"
            style={{ padding: '6px 12px' }}
          >
            {copied ? '✓ Copied!' : 'Copy Buy Box'}
          </button>
          <button
            onClick={handlePdf}
            className="btn-secondary text-xs"
            style={{ padding: '6px 12px' }}
          >
            Download PDF
          </button>
          <button
            onClick={handleBuildCampaign}
            className="btn-primary text-xs"
            style={{ padding: '6px 12px' }}
            disabled={building}
          >
            {built ? '✓ Campaign Created!' : building ? 'Creating…' : 'Build Campaign'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Location */}
        <div className="rounded-xl p-4" style={{ background: '#F8F6FB', border: '1px solid #E8E0F0' }}>
          <p className="text-[10px] uppercase tracking-wider font-semibold mb-3" style={{ color: '#5C2977' }}>Location</p>
          <p className="text-xs mb-2" style={{ color: '#6B5B8A' }}>Top ZIPs by sales volume — enter in Land Portal → Location → ZIP Code</p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {topZips.map((z) => (
              <span key={z} className="font-mono text-[11px] px-2 py-0.5 rounded" style={{ background: 'rgba(92,41,119,0.1)', color: '#5C2977', border: '1px solid rgba(92,41,119,0.2)' }}>
                {z}
              </span>
            ))}
          </div>
        </div>

        {/* Property Type & Size */}
        <div className="rounded-xl p-4" style={{ background: '#F8F6FB', border: '1px solid #E8E0F0' }}>
          <p className="text-[10px] uppercase tracking-wider font-semibold mb-3" style={{ color: '#5C2977' }}>Property Type &amp; Size</p>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span style={{ color: '#6B5B8A' }}>Asset type</span>
              <span style={{ color: '#2D7A4F', fontWeight: 600 }}>Vacant Land only</span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: '#6B5B8A' }}>Listing status</span>
              <span style={{ color: '#1A0A2E', fontWeight: 600 }}>Never listed</span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: '#6B5B8A' }}>Min acreage</span>
              <span style={{ color: '#1A0A2E', fontWeight: 600 }}>{minAcre} acres</span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: '#6B5B8A' }}>Max acreage</span>
              <span style={{ color: '#1A0A2E', fontWeight: 600 }}>{maxAcre} acres</span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: '#6B5B8A' }}>Sweet spot</span>
              <span style={{ color: '#8B4DB8', fontWeight: 600 }}>{acreLabel}</span>
            </div>
          </div>
        </div>

        {/* Pricing */}
        <div className="rounded-xl p-4" style={{ background: 'rgba(213,169,64,0.06)', border: '1px solid rgba(213,169,64,0.25)' }}>
          <p className="text-[10px] uppercase tracking-wider font-semibold mb-3" style={{ color: '#8B6A00' }}>Pricing &amp; Offer</p>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span style={{ color: '#6B5B8A' }}>Max TLP</span>
              <span style={{ color: '#1A0A2E', fontWeight: 700 }}>${maxTlp.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: '#6B5B8A' }}>Offer low (35%)</span>
              <span style={{ color: '#D5A940', fontWeight: 600 }}>${offerLow.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: '#6B5B8A' }}>Offer high (52.5%)</span>
              <span style={{ color: '#D5A940', fontWeight: 700 }}>${offerHigh.toLocaleString()}</span>
            </div>
            <div className="mt-2 pt-2" style={{ borderTop: '1px solid rgba(213,169,64,0.2)' }}>
              <p className="text-[10px]" style={{ color: '#8B6A00' }}>
                TLP = 75th pct sale price (${Math.round(priceP75).toLocaleString()}) × 2
              </p>
            </div>
          </div>
        </div>

        {/* Owner Filters */}
        <div className="rounded-xl p-4" style={{ background: '#F8F6FB', border: '1px solid #E8E0F0' }}>
          <p className="text-[10px] uppercase tracking-wider font-semibold mb-3" style={{ color: '#5C2977' }}>Owner Filters</p>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span style={{ color: '#6B5B8A' }}>Owner type</span>
              <span style={{ color: '#1A0A2E', fontWeight: 600 }}>Individual / Trust</span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: '#6B5B8A' }}>Owner tenure</span>
              <span style={{ color: '#1A0A2E', fontWeight: 600 }}>5+ years</span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: '#6B5B8A' }}>Absentee</span>
              <span style={{ color: '#1A0A2E', fontWeight: 600 }}>Cross-county preferred</span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: '#6B5B8A' }}>Exclude</span>
              <span style={{ color: '#dc2626', fontWeight: 600 }}>LLC / Corp owners</span>
            </div>
          </div>
        </div>

        {/* Land Quality */}
        <div className="rounded-xl p-4" style={{ background: '#F8F6FB', border: '1px solid #E8E0F0' }}>
          <p className="text-[10px] uppercase tracking-wider font-semibold mb-3" style={{ color: '#5C2977' }}>Land Quality</p>
          <div className="space-y-2 text-xs">
            <div className="flex gap-2 items-center">
              <span style={{ color: '#2D7A4F', fontWeight: 700 }}>✓</span>
              <span style={{ color: '#1A0A2E' }}>Buildable parcels</span>
            </div>
            <div className="flex gap-2 items-center">
              <span style={{ color: '#2D7A4F', fontWeight: 700 }}>✓</span>
              <span style={{ color: '#1A0A2E' }}>In-fill lots OK</span>
            </div>
            <div className="flex gap-2 items-center">
              <span style={{ color: '#dc2626', fontWeight: 700 }}>✗</span>
              <span style={{ color: '#6B5B8A' }}>Wetlands / Flood zone</span>
            </div>
            <div className="flex gap-2 items-center">
              <span style={{ color: '#dc2626', fontWeight: 700 }}>✗</span>
              <span style={{ color: '#6B5B8A' }}>Landlocked parcels</span>
            </div>
          </div>
        </div>

        {/* Expected Results */}
        <div className="rounded-xl p-4" style={{ background: 'rgba(45,122,79,0.06)', border: '1px solid rgba(45,122,79,0.2)' }}>
          <p className="text-[10px] uppercase tracking-wider font-semibold mb-3" style={{ color: '#2D7A4F' }}>Expected Results</p>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span style={{ color: '#6B5B8A' }}>Est. list size</span>
              <span style={{ color: '#1A0A2E', fontWeight: 700 }}>~{estListSize.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: '#6B5B8A' }}>Total budget</span>
              <span style={{ color: '#1A0A2E', fontWeight: 600 }}>~${estBudget.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: '#6B5B8A' }}>At $500/week</span>
              <span style={{ color: '#2D7A4F', fontWeight: 600 }}>~{estWeeks} weeks</span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: '#6B5B8A' }}>Cost per piece</span>
              <span style={{ color: '#1A0A2E', fontWeight: 600 }}>${costPerPiece}/piece</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function computeMarketIntelligence(
  zipStats: ZipStats[], 
  comps: Array<{ lot_acres: number; sale_price: number }>,
  sweetSpot?: { bucket: string; count: number; total_sales: number; expected_offer_low: number; expected_offer_high: number } | null
) {
  const mostLiquid = zipStats.length > 0 ? zipStats.reduce((a, b) => a.sales_count >= b.sales_count ? a : b) : null
  const ppas = zipStats.map((z) => z.median_price_per_acre).filter((v): v is number => v != null && Number.isFinite(v))
  const overallMedian = median(ppas)
  const outliers = overallMedian > 0
    ? zipStats.filter((z) => (z.median_price_per_acre ?? 0) > 3 * overallMedian).map((z) => z.zip_code)
    : []
  const thin = zipStats.filter((z) => z.sales_count < 10).map((z) => z.zip_code)
  const targetZips = zipStats.filter((z) => z.sales_count >= 20).map((z) => z.zip_code)

  // Use backend sweet_spot if available, otherwise fallback to zip_stats bands
  let sweetBand = '0.0–0.5 acres'
  let sweetCount = 0
  let sweetPct = 0
  
  if (sweetSpot) {
    // Format bucket name for display
    const bucket = sweetSpot.bucket
    if (bucket === '0-0.5') sweetBand = '0.0–0.5 acres'
    else if (bucket === '0.5-1') sweetBand = '0.5–1 acres'
    else if (bucket === '1-2') sweetBand = '1–2 acres'
    else if (bucket === '2-5') sweetBand = '2–5 acres'
    else if (bucket === '5-10') sweetBand = '5–10 acres'
    else if (bucket === '10+') sweetBand = '10+ acres'
    else sweetBand = bucket
    
    sweetCount = sweetSpot.count
    sweetPct = sweetSpot.total_sales > 0 ? Math.round((sweetCount / sweetSpot.total_sales) * 100) : 0
  } else {
    // Fallback to zip_stats acreage bands
    const bandCounts: Record<string, number> = {
      '<1 acre': zipStats.reduce((sum, z) => sum + (z.acreage_band_0_1 ?? 0), 0),
      '1–5 acres': zipStats.reduce((sum, z) => sum + (z.acreage_band_1_5 ?? 0), 0),
      '5–10 acres': zipStats.reduce((sum, z) => sum + (z.acreage_band_5_10 ?? 0), 0),
      '10+ acres': zipStats.reduce((sum, z) => sum + (z.acreage_band_gt10 ?? 0), 0),
    }
    const totalBandSales = Object.values(bandCounts).reduce((a, b) => a + b, 0)
    Object.entries(bandCounts).forEach(([band, count]) => {
      if (count > sweetCount) { sweetCount = count; sweetBand = band }
    })
    sweetPct = totalBandSales > 0 ? Math.round((sweetCount / totalBandSales) * 100) : 0
  }

  // For expected offer range, use comp_locations prices if available, else zip_stats
  let p25 = 0, p75 = 0
  const validPrices = comps.map((c) => c.sale_price).filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b)
  if (validPrices.length > 0) {
    p25 = percentile(validPrices, 25)
    p75 = percentile(validPrices, 75)
  } else {
    // Fallback: derive from zip_stats min/max sale prices
    const minPrices = zipStats.map(z => z.min_sale_price).filter((v): v is number => v != null && v > 0)
    const maxPrices = zipStats.map(z => z.max_sale_price).filter((v): v is number => v != null && v > 0)
    if (minPrices.length > 0) p25 = median(minPrices.sort((a, b) => a - b))
    if (maxPrices.length > 0) p75 = median(maxPrices.sort((a, b) => a - b))
  }

  const paragraph = [
    `The sweet spot is parcels ${sweetBand}, accounting for ${sweetPct}% of all sales (${sweetCount.toLocaleString()} transactions).`,
    mostLiquid ? `The most liquid ZIP is ${mostLiquid.zip_code} with ${mostLiquid.sales_count.toLocaleString()} sales.` : 'No liquid ZIP detected yet.',
    outliers.length > 0
      ? `Outlier ZIPs with median $/acre above 3x market median are ${outliers.join(', ')}.`
      : 'No outlier ZIPs currently exceed 3x the overall median $/acre.',
    thin.length > 0
      ? `Thin data ZIPs (<10 sales) are ${thin.join(', ')} and should be treated cautiously.`
      : 'No thin-data ZIPs were detected.'
  ].join(' ')

  return {
    paragraph,
    idealAcreageRange: `${sweetBand}`,
    targetZips,
    expectedOfferRange: p25 > 0 && p75 > 0 ? `$${Math.round(p25).toLocaleString()}–$${Math.round(p75).toLocaleString()}` : 'Insufficient data',
    avoidZips: thin,
  }
}

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
        <p className="text-xs uppercase tracking-wider font-medium" style={{ color: '#6B5B8A', letterSpacing: '0.8px' }}>{label}</p>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${accent}20`, color: accent }}>
          {icon}
        </div>
      </div>
      <p className="text-2xl font-bold mb-0.5" style={{ color: accent }}>{value}</p>
      {sub && <p className="text-xs" style={{ color: '#6B5B8A' }}>{sub}</p>}
    </div>
  )
}

function PriceBandPills({ row }: { row: ZipStats }) {
  const total = row.price_band_lt50k + row.price_band_50k_100k + row.price_band_100k_250k + row.price_band_gt250k
  if (total === 0) return <span className="text-xs" style={{ color: '#9B8AAE' }}>—</span>
  return (
    <div className="flex gap-1 flex-wrap">
      {row.price_band_lt50k > 0 && (
        <span className="badge" style={{ background: 'rgba(45,122,79,0.08)', color: '#2D7A4F', border: '1px solid rgba(45,122,79,0.2)', fontSize: '10px' }}>
          &lt;$50K·{row.price_band_lt50k}
        </span>
      )}
      {row.price_band_50k_100k > 0 && (
        <span className="badge" style={{ background: 'rgba(92,41,119,0.08)', color: '#5C2977', border: '1px solid rgba(92,41,119,0.2)', fontSize: '10px' }}>
          $50–100K·{row.price_band_50k_100k}
        </span>
      )}
      {row.price_band_100k_250k > 0 && (
        <span className="badge" style={{ background: 'rgba(139,77,184,0.08)', color: '#8B4DB8', border: '1px solid rgba(139,77,184,0.2)', fontSize: '10px' }}>
          $100–250K·{row.price_band_100k_250k}
        </span>
      )}
      {row.price_band_gt250k > 0 && (
        <span className="badge" style={{ background: 'rgba(213,169,64,0.1)', color: '#8B6A00', border: '1px solid rgba(213,169,64,0.25)', fontSize: '10px' }}>
          $250K+·{row.price_band_gt250k}
        </span>
      )}
    </div>
  )
}

function AcreageBandPills({ row }: { row: ZipStats }) {
  return (
    <div className="flex gap-1 flex-wrap">
      {row.acreage_band_0_1 > 0 && <span className="badge badge-gray text-[10px]">&lt;1ac·{row.acreage_band_0_1}</span>}
      {row.acreage_band_1_5 > 0 && <span className="badge badge-blue text-[10px]">1-5ac·{row.acreage_band_1_5}</span>}
      {row.acreage_band_5_10 > 0 && <span className="badge badge-green text-[10px]">5-10ac·{row.acreage_band_5_10}</span>}
      {row.acreage_band_gt10 > 0 && <span className="badge badge-yellow text-[10px]">&gt;10ac·{row.acreage_band_gt10}</span>}
    </div>
  )
}

// Small SVG icons for stat cards
const IconDB = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
const IconDollar = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
const IconAcre = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
const IconPin = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
