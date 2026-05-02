import React, { useEffect, useRef, useState } from 'react'
import { uploadComps } from '../api/client'
import {
  upsertSetting,
  listCrmCampaigns,
  createCrmCampaign,
  saveBuyBox,
  previewMailDrop,
  createMailDrop,
  approveMailDrop,
  researchState,
  type CountyRecommendation,
  type StateResearchResult,
} from '../api/crm'
import type { UploadStats } from '../types'

const SQFT_PER_ACRE = 43560

function fmtAcreageWithSqft(acres: number): string {
  const sqft = Math.round(acres * SQFT_PER_ACRE)
  return `${acres} acres (${sqft.toLocaleString()} sq ft)`
}

// ── Constants ────────────────────────────────────────────────────────────────

const US_STATES = [
  'Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut',
  'Delaware','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa',
  'Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan',
  'Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada',
  'New Hampshire','New Jersey','New Mexico','New York','North Carolina',
  'North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania','Rhode Island',
  'South Carolina','South Dakota','Tennessee','Texas','Utah','Vermont',
  'Virginia','Washington','West Virginia','Wisconsin','Wyoming',
]

const STEPS = ['Strategy','Learn','Research','Comps','Market','Launch']

type Strategy = 'infill_lots' | 'rural_acreage' | 'subdivide_and_sell'

interface WizardProps {
  onComplete: () => void
  startAtStep?: number
}

// ── Progress Bar ─────────────────────────────────────────────────────────────

function ProgressBar({ step }: { step: number }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {STEPS.map((label, i) => {
        const num = i + 1
        const done = num < step
        const active = num === step
        return (
          <React.Fragment key={label}>
            <div className="flex flex-col items-center gap-1">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                style={{
                  background: done ? '#5C2977' : active ? '#7C3FA8' : '#EDE8F5',
                  color: done || active ? '#fff' : '#9B8AAE',
                }}
              >
                {done ? '✓' : num}
              </div>
              <span className="text-xs font-medium" style={{ color: active ? '#5C2977' : '#9B8AAE', whiteSpace: 'nowrap' }}>
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className="h-0.5 w-8 mb-5 rounded" style={{ background: done ? '#5C2977' : '#EDE8F5' }} />
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}

// ── Confetti ─────────────────────────────────────────────────────────────────

function Confetti() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = canvasRef.current as HTMLCanvasElement
    if (!cv) return
    const ctx = cv.getContext('2d') as CanvasRenderingContext2D
    if (!ctx) return
    cv.width = window.innerWidth
    cv.height = window.innerHeight
    const pieces = Array.from({ length: 120 }, () => ({
      x: Math.random() * cv.width,
      y: Math.random() * -cv.height,
      w: 8 + Math.random() * 8,
      h: 5 + Math.random() * 5,
      color: ['#5C2977','#D5A940','#2D7A4F','#4A90D9','#E65100'][Math.floor(Math.random() * 5)],
      angle: Math.random() * Math.PI * 2,
      vx: (Math.random() - 0.5) * 3,
      vy: 2 + Math.random() * 3,
      va: (Math.random() - 0.5) * 0.1,
    }))
    let raf: number
    function draw() {
      ctx.clearRect(0, 0, cv.width, cv.height)
      pieces.forEach(p => {
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.angle)
        ctx.fillStyle = p.color
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h)
        ctx.restore()
        p.x += p.vx
        p.y += p.vy
        p.angle += p.va
        if (p.y > cv.height) { p.y = -10; p.x = Math.random() * cv.width }
      })
      raf = requestAnimationFrame(draw)
    }
    draw()
    const timer = setTimeout(() => cancelAnimationFrame(raf), 4000)
    return () => { cancelAnimationFrame(raf); clearTimeout(timer) }
  }, [])
  return <canvas ref={canvasRef} className="fixed inset-0 pointer-events-none" style={{ zIndex: 9999 }} />
}

// ── Step 1 — Strategy Selection ──────────────────────────────────────────────

const STRATEGIES = [
  {
    id: 'infill_lots' as Strategy,
    title: 'Infill Lots',
    badge: 'Most Popular',
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
      </svg>
    ),
    description: 'Residential lots inside neighborhoods. Sell to builders and developers. Fast-moving deals.',
    range: '$15k – $150k range',
    tag: 'Best strategy for beginners',
    color: '#5C2977',
  },
  {
    id: 'rural_acreage' as Strategy,
    title: 'Rural Acreage',
    badge: null,
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M17 8C8 10 5.9 16.17 3.82 19.82"/><path d="M13.78 9.22c0 0-4.78 5.78-3.78 12.78"/>
        <path d="M12 4l-2.5 5h5L12 4z"/><circle cx="12" cy="4" r="1.5"/>
      </svg>
    ),
    description: 'Larger parcels outside city limits. Sell to investors and land buyers. Higher margins but longer hold times.',
    range: 'Higher margins',
    tag: 'More patient capital required',
    color: '#2D7A4F',
  },
  {
    id: 'subdivide_and_sell' as Strategy,
    title: 'Subdivide & Sell',
    badge: null,
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
        <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
      </svg>
    ),
    description: 'Buy large parcels and split into smaller lots. Highest profit potential but more complex. Requires survey work.',
    range: 'Highest profit potential',
    tag: 'Advanced strategy',
    color: '#4A90D9',
  },
]

function Step1Strategy({ onNext }: { onNext: (s: Strategy) => void }) {
  const [selected, setSelected] = useState<Strategy | null>(null)
  return (
    <div>
      <h2 className="text-2xl font-bold mb-2" style={{ color: '#1A0A2E' }}>What's your investing strategy?</h2>
      <p className="text-sm mb-8" style={{ color: '#6B5B8A' }}>Choose the type of land you want to buy and sell. You can change this later.</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {STRATEGIES.map(s => (
          <button
            key={s.id}
            onClick={() => setSelected(s.id)}
            className="rounded-2xl p-6 text-left transition-all"
            style={{
              border: selected === s.id ? `2px solid ${s.color}` : '2px solid #EDE8F5',
              background: selected === s.id ? `${s.color}08` : '#fff',
              boxShadow: selected === s.id ? `0 0 0 4px ${s.color}18` : '0 1px 4px rgba(61,26,94,0.06)',
            }}
          >
            {s.badge && (
              <span className="inline-block text-xs font-bold px-2 py-0.5 rounded-full mb-3"
                style={{ background: '#D5A94020', color: '#D5A940' }}>{s.badge}</span>
            )}
            <div className="mb-3" style={{ color: s.color }}>{s.icon}</div>
            <h3 className="font-bold text-base mb-2" style={{ color: '#1A0A2E' }}>{s.title}</h3>
            <p className="text-xs mb-3" style={{ color: '#6B5B8A', lineHeight: 1.6 }}>{s.description}</p>
            <p className="text-xs font-semibold" style={{ color: s.color }}>{s.range}</p>
            <p className="text-xs mt-1" style={{ color: '#9B8AAE' }}>{s.tag}</p>
          </button>
        ))}
      </div>
      <div className="flex justify-end">
        <button className="btn-primary px-8 py-3 text-sm" disabled={!selected}
          onClick={() => selected && onNext(selected)}>
          Continue →
        </button>
      </div>
    </div>
  )
}

// ── Step 2 — How It Works ─────────────────────────────────────────────────────

const HOW_IT_WORKS: Record<Strategy, { steps: string[]; timeline: string; profit: string }> = {
  infill_lots: {
    steps: [
      'Find vacant lots in neighborhoods that owners aren\'t using',
      'Send them a cash offer below market value by mail',
      'They accept, you close, you sell to a builder for profit',
    ],
    timeline: '30–90 days from mail to close',
    profit: '$5,000 – $40,000 per deal',
  },
  rural_acreage: {
    steps: [
      'Identify rural parcels 5–100 acres in growing counties',
      'Mail blind offers at 30–50% of market value',
      'Accept, sell to land investors or recreational buyers',
    ],
    timeline: '60–180 days from mail to close',
    profit: '$10,000 – $100,000 per deal',
  },
  subdivide_and_sell: {
    steps: [
      'Buy large raw parcels (10+ acres) at a deep discount',
      'Survey and subdivide into smaller sellable lots',
      'List and sell each lot individually for max profit',
    ],
    timeline: '6–18 months per project',
    profit: '$30,000 – $200,000+ per project',
  },
}

function Step2Learn({ strategy, onNext, onBack }: { strategy: Strategy; onNext: () => void; onBack: () => void }) {
  const info = HOW_IT_WORKS[strategy]
  const stratLabel = STRATEGIES.find(s => s.id === strategy)?.title ?? strategy
  return (
    <div>
      <h2 className="text-2xl font-bold mb-2" style={{ color: '#1A0A2E' }}>How {stratLabel} works</h2>
      <p className="text-sm mb-8" style={{ color: '#6B5B8A' }}>Here's the exact process, from finding deals to cashing checks.</p>
      <div className="space-y-4 mb-8">
        {info.steps.map((step, i) => (
          <div key={i} className="flex gap-4 items-start p-4 rounded-xl" style={{ background: '#F8F6FB', border: '1px solid #EDE8F5' }}>
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
              style={{ background: '#5C2977', color: '#fff' }}>{i + 1}</div>
            <p className="text-sm pt-1" style={{ color: '#1A0A2E' }}>{step}</p>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-4 mb-8">
        <div className="rounded-xl p-4" style={{ background: '#E8F5E9', border: '1px solid #C8E6C9' }}>
          <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: '#2E7D32' }}>Timeline</p>
          <p className="font-bold" style={{ color: '#1A0A2E' }}>{info.timeline}</p>
        </div>
        <div className="rounded-xl p-4" style={{ background: '#FFF9E6', border: '1px solid #FFE082' }}>
          <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: '#B8860B' }}>Average Profit</p>
          <p className="font-bold" style={{ color: '#1A0A2E' }}>{info.profit}</p>
        </div>
      </div>
      <p className="text-sm font-medium mb-8" style={{ color: '#5C2977' }}>Ready to find your market? Let's go. 🎯</p>
      <div className="flex justify-between">
        <button className="btn-secondary" onClick={onBack}>← Back</button>
        <button className="btn-primary px-8 py-3 text-sm" onClick={onNext}>Find My Market →</button>
      </div>
    </div>
  )
}

// ── Step 3 — State + AI Research ──────────────────────────────────────────────

function DemandBadge({ level }: { level: string }) {
  const map: Record<string, { bg: string; text: string }> = {
    High:   { bg: '#E8F5E9', text: '#2E7D32' },
    Medium: { bg: '#FFF9E6', text: '#B8860B' },
    Low:    { bg: '#FFF0F0', text: '#B71C1C' },
  }
  const s = map[level] ?? { bg: '#EDE8F5', text: '#5C2977' }
  return <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: s.bg, color: s.text }}>{level}</span>
}

function Step3Research({
  strategy, onNext, onBack,
  onStateSelect, onResearchDone,
}: {
  strategy: Strategy
  onNext: (state: string, county: CountyRecommendation) => void
  onBack: () => void
  onStateSelect: (s: string) => void
  onResearchDone: (r: StateResearchResult) => void
}) {
  const [selectedState, setSelectedState] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<StateResearchResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [chosen, setChosen] = useState<CountyRecommendation | null>(null)

  async function doResearch() {
    if (!selectedState) return
    setLoading(true); setError(null); setResult(null); setChosen(null)
    try {
      const acreageMax = strategy === 'infill_lots' ? 2 : strategy === 'rural_acreage' ? 100 : 50
      const res = await researchState(selectedState, strategy, 0.1, acreageMax)
      setResult(res)
      onStateSelect(selectedState)
      onResearchDone(res)
    } catch {
      setError('Research failed. Please try again or skip to select manually.')
    } finally { setLoading(false) }
  }

  return (
    <div>
      <h2 className="text-2xl font-bold mb-2" style={{ color: '#1A0A2E' }}>What state do you want to start in?</h2>
      <p className="text-sm mb-6" style={{ color: '#6B5B8A' }}>Our AI will research the market and recommend the best counties.</p>

      <div className="flex gap-3 mb-6">
        <select
          className="input-base flex-1"
          value={selectedState}
          onChange={e => setSelectedState(e.target.value)}
        >
          <option value="">Select a state...</option>
          {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <button
          className="btn-primary px-6"
          disabled={!selectedState || loading}
          onClick={doResearch}
        >
          {loading ? 'Researching…' : 'Research →'}
        </button>
      </div>

      {loading && (
        <div className="rounded-xl p-8 text-center" style={{ background: '#F8F6FB', border: '1px solid #EDE8F5' }}>
          <div className="w-8 h-8 border-2 border-purple-300 border-t-purple-700 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm font-medium" style={{ color: '#5C2977' }}>Researching the {selectedState} land market…</p>
          <p className="text-xs mt-1" style={{ color: '#9B8AAE' }}>Analyzing sales trends, builder demand, and population growth</p>
        </div>
      )}

      {error && (
        <div className="rounded-xl p-4 mb-4 text-sm" style={{ background: '#FFF0F0', color: '#B71C1C', border: '1px solid #FFCDD2' }}>
          {error}
        </div>
      )}

      {result && (
        <div>
          {result.market_summary && (
            <div className="rounded-xl p-4 mb-5" style={{ background: '#F3E5F5', border: '1px solid #E1BEE7' }}>
              <p className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: '#6A1B9A' }}>Market Overview</p>
              <p className="text-sm" style={{ color: '#1A0A2E' }}>{result.market_summary}</p>
              {result.cached && result.last_updated && (
                <p className="text-xs mt-2" style={{ color: '#9B8AAE' }}>Last updated: {result.last_updated}</p>
              )}
            </div>
          )}

          <p className="text-sm font-semibold mb-3" style={{ color: '#1A0A2E' }}>Top county recommendations:</p>
          <div className="space-y-3 mb-6">
            {(result.counties || []).map((county, i) => (
              <button
                key={`${county.county}-${i}`}
                onClick={() => setChosen(county)}
                className="w-full rounded-xl p-4 text-left transition-all"
                style={{
                  border: chosen?.county === county.county ? '2px solid #5C2977' : '2px solid #EDE8F5',
                  background: chosen?.county === county.county ? '#F3E5F5' : '#fff',
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold w-5 h-5 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center flex-shrink-0">
                      {county.rank || i + 1}
                    </span>
                    <div>
                      <p className="font-bold text-sm" style={{ color: '#1A0A2E' }}>
                        {county.county} County, {county.state}
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: '#6B5B8A' }}>{county.why_good}</p>
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <DemandBadge level={county.builder_demand} />
                    <p className="text-xs mt-1" style={{ color: '#6B5B8A' }}>
                      ${(county.price_range_low / 1000).toFixed(0)}k–${(county.price_range_high / 1000).toFixed(0)}k
                    </p>
                    <p className="text-xs" style={{ color: '#9B8AAE' }}>
                      {county.recommended_acreage_min}–{county.recommended_acreage_max} ac
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-between">
        <button className="btn-secondary" onClick={onBack}>← Back</button>
        <button
          className="btn-primary px-8 py-3 text-sm"
          disabled={!selectedState || (!chosen && !result)}
          onClick={() => {
            const c = chosen || result?.counties?.[0]
            if (c) onNext(selectedState, c)
          }}
        >
          {chosen ? `Continue with ${chosen.county} →` : result ? 'Continue →' : 'Select a county to continue'}
        </button>
      </div>
    </div>
  )
}

// ── Step 4 — Upload Comps ─────────────────────────────────────────────────────

function Step4Comps({
  state, strategy, county, onNext, onBack, onSkip,
}: {
  state: string; strategy: Strategy; county?: CountyRecommendation | null; onNext: (stats: UploadStats) => void; onBack: () => void; onSkip: () => void
}) {
  const [uploading, setUploading] = useState(false)
  const [stats, setStats] = useState<UploadStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const propType = strategy === 'infill_lots' ? 'Lots and Land' : 'Land'

  // Use AI-researched county acreage if available, else fall back to strategy defaults
  const defaultMin = strategy === 'infill_lots' ? 0.1 : strategy === 'rural_acreage' ? 5 : 10
  const defaultMax = strategy === 'infill_lots' ? 2 : strategy === 'rural_acreage' ? 100 : 500
  const acreageMin = county?.recommended_acreage_min ?? defaultMin
  const acreageMax = county?.recommended_acreage_max ?? defaultMax
  const acreageRange = `${fmtAcreageWithSqft(acreageMin)} minimum to ${fmtAcreageWithSqft(acreageMax)} maximum`

  async function handleFile(file: File) {
    setUploading(true); setError(null)
    try {
      const s = await uploadComps(file)
      setStats(s)
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Upload failed.')
    } finally { setUploading(false) }
  }

  return (
    <div>
      <h2 className="text-2xl font-bold mb-2" style={{ color: '#1A0A2E' }}>Upload your sold comps</h2>
      <p className="text-sm mb-6" style={{ color: '#6B5B8A' }}>Real sales data confirms the best sub-markets. This takes 2 minutes.</p>

      <div className="rounded-xl p-5 mb-6" style={{ background: '#F8F6FB', border: '1px solid #EDE8F5' }}>
        <p className="text-sm font-bold mb-3" style={{ color: '#1A0A2E' }}>How to export from Land Portal:</p>
        <ol className="space-y-2.5">
          {([
            { text: 'Go to landportal.com and click Solds in the top menu' },
            { text: `Set State: ${state}` },
            ...(county ? [{ text: `Set County: ${county.county} County` }] : []),
            { text: `Set Property Type: ${propType}` },
            { text: `Set Acreage: ${acreageRange}` },
            {
              text: 'Set Buyer Type: Include LLC and Corporate buyers',
              note: 'Builders and developers typically buy as LLCs. Including them gives you more comp data showing what builders actually paid — which is your real exit price.',
            },
            { text: 'Set Date Range: Last 12 months' },
            { text: 'Click Export CSV and upload the file below' },
          ] as { text: string; note?: string }[]).map((step, i) => (
            <li key={i} className="flex gap-2 text-xs" style={{ color: '#3D2B5E' }}>
              <span className="font-bold flex-shrink-0" style={{ color: '#5C2977' }}>{i + 1}.</span>
              <span className="flex flex-col gap-1">
                <span>{step.text}</span>
                {step.note && (
                  <span className="text-[11px] px-2 py-1 rounded-lg" style={{ background: '#EDE8F5', color: '#6B5B8A' }}>
                    💡 {step.note}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-[11px] rounded-lg px-3 py-2" style={{ background: '#FFF8E7', border: '1px solid #F0D070', color: '#7A5800' }}>
          <strong>Include both Individual AND LLC buyer sales</strong> — builders buy as LLCs so you need their sales to know your real exit price.
        </p>
      </div>

      {!stats ? (
        <div
          className="rounded-xl border-2 border-dashed p-10 text-center cursor-pointer transition-all"
          style={{ borderColor: uploading ? '#C4A8D8' : '#C4A8D8', background: uploading ? '#FAF8FD' : '#FDFBFF' }}
          onClick={() => !uploading && inputRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
        >
          <input ref={inputRef} type="file" accept=".csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
          {uploading ? (
            <>
              <div className="w-8 h-8 border-2 border-purple-300 border-t-purple-700 rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm" style={{ color: '#5C2977' }}>Uploading…</p>
            </>
          ) : (
            <>
              <svg className="mx-auto mb-3" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#C4A8D8" strokeWidth="1.5">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              <p className="text-sm font-medium" style={{ color: '#1A0A2E' }}>Drop your comps CSV here or click to browse</p>
              <p className="text-xs mt-1" style={{ color: '#9B8AAE' }}>Land Portal export · CSV format</p>
            </>
          )}
        </div>
      ) : (
        <div className="rounded-xl p-5" style={{ background: '#E8F5E9', border: '1px solid #C8E6C9' }}>
          <p className="font-bold text-sm mb-1" style={{ color: '#2E7D32' }}>✓ Upload complete</p>
          <p className="text-sm" style={{ color: '#1A0A2E' }}>Analyzed {stats.valid_rows.toLocaleString()} sales across your market</p>
        </div>
      )}

      {error && <p className="text-xs mt-2" style={{ color: '#B71C1C' }}>{error}</p>}

      <div className="flex justify-between mt-6">
        <button className="btn-secondary" onClick={onBack}>← Back</button>
        <div className="flex gap-2">
          <button className="btn-secondary text-sm" onClick={onSkip}>Skip for now</button>
          {stats && (
            <button className="btn-primary px-8 py-3 text-sm" onClick={() => onNext(stats)}>
              Continue →
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Step 5 — Market Selection ─────────────────────────────────────────────────

function Step5Market({
  state, county, strategy, onNext, onBack,
}: {
  state: string; county: CountyRecommendation; strategy: Strategy; onNext: (campaignId: string) => void; onBack: () => void
}) {
  const [creating, setCreating] = useState(false)
  const [campaignCreated, setCampaignCreated] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const now = new Date()
  const monthYear = now.toLocaleString('en-US', { month: 'long', year: 'numeric' })
  const campaignName = `${county.county} County ${monthYear}`

  async function buildCampaign() {
    setCreating(true); setError(null)
    try {
      const camp = await createCrmCampaign(campaignName, {
        notes: `Auto-created from onboarding. Strategy: ${strategy}. AI-recommended market.`,
      })
      await saveBuyBox({
        target_state: state,
        target_county: county.county,
        min_acreage: county.recommended_acreage_min,
        max_acreage: county.recommended_acreage_max,
        offer_pct: 30,
      })
      await upsertSetting('investing_strategy', strategy)
      setCampaignCreated(camp.id)
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Failed to create campaign.')
    } finally { setCreating(false) }
  }

  const acreageMin = county.recommended_acreage_min
  const acreageMax = county.recommended_acreage_max

  return (
    <div>
      <h2 className="text-2xl font-bold mb-2" style={{ color: '#1A0A2E' }}>Your recommended market</h2>
      <p className="text-sm mb-6" style={{ color: '#6B5B8A' }}>Based on your strategy and AI research, here's where to start.</p>

      <div className="rounded-2xl p-6 mb-6" style={{ background: '#F3E5F5', border: '2px solid #5C2977' }}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-xl font-bold" style={{ color: '#1A0A2E' }}>{county.county} County, {state}</p>
            <p className="text-sm mt-1" style={{ color: '#6B5B8A' }}>{county.why_good}</p>
          </div>
          <DemandBadge level={county.builder_demand} />
        </div>
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Price Range', value: `$${(county.price_range_low / 1000).toFixed(0)}k – $${(county.price_range_high / 1000).toFixed(0)}k` },
            { label: 'Target Acreage', value: `${acreageMin} – ${acreageMax} ac` },
            { label: 'Avg Days on Market', value: `${county.dom_estimate || '—'} days` },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-xl p-3" style={{ background: '#fff' }}>
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#9B8AAE' }}>{label}</p>
              <p className="font-bold mt-1" style={{ color: '#1A0A2E' }}>{value}</p>
            </div>
          ))}
        </div>
      </div>

      {!campaignCreated ? (
        <>
          <div className="rounded-xl p-5 mb-6" style={{ background: '#F8F6FB', border: '1px solid #EDE8F5' }}>
            <p className="text-sm font-bold mb-3" style={{ color: '#1A0A2E' }}>How to pull your mail list from Land Portal:</p>
            <ol className="space-y-2">
              {[
                'Go to Land Portal → click Lists',
                `Set State: ${state}`,
                `Set County: ${county.county}`,
                'Set Property Type: Vacant Land / Lots',
                `Set Acreage: ${fmtAcreageWithSqft(acreageMin)} minimum to ${fmtAcreageWithSqft(acreageMax)} maximum`,
                'Set Owner Type: Individual',
                'Export and upload the file on the next step',
              ].map((step, i) => (
                <li key={i} className="flex gap-2 text-xs" style={{ color: '#3D2B5E' }}>
                  <span className="font-bold" style={{ color: '#5C2977' }}>{i + 1}.</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>
          {error && <p className="text-xs mb-3" style={{ color: '#B71C1C' }}>{error}</p>}
          <div className="flex justify-between">
            <button className="btn-secondary" onClick={onBack}>← Back</button>
            <button className="btn-primary px-8 py-3 text-sm" onClick={buildCampaign} disabled={creating}>
              {creating ? 'Creating campaign…' : `Build My Campaign: ${campaignName} →`}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="rounded-xl p-4 mb-6" style={{ background: '#E8F5E9', border: '1px solid #C8E6C9' }}>
            <p className="font-bold text-sm" style={{ color: '#2E7D32' }}>✓ Campaign "{campaignName}" created</p>
            <p className="text-xs mt-1" style={{ color: '#1A0A2E' }}>Buy box saved. Now let's set your mail budget and schedule your first send.</p>
          </div>
          <div className="flex justify-between">
            <button className="btn-secondary" onClick={onBack}>← Back</button>
            <button className="btn-primary px-8 py-3 text-sm" onClick={() => onNext(campaignCreated)}>
              Set Budget & Launch →
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ── Step 6 — Budget + First Send ─────────────────────────────────────────────

function Step6Launch({
  campaignId, onComplete, onBack,
}: {
  campaignId: string; onComplete: () => void; onBack: () => void
}) {
  const [weeklyBudget, setWeeklyBudget] = useState(500)
  const [costPerPiece, setCostPerPiece] = useState(0.55)
  const [mailHouseEmail, setMailHouseEmail] = useState('')
  const [scheduling, setScheduling] = useState(false)
  const [mailDrop, setMailDrop] = useState<{ id: string; pieces_count?: number; estimated_cost?: number; scheduled_date?: string } | null>(null)
  const [approving, setApproving] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showConfetti, setShowConfetti] = useState(false)

  const piecesPerWeek = Math.floor(weeklyBudget / costPerPiece)

  // Next Monday
  const nextMonday = (() => {
    const d = new Date()
    const day = d.getDay()
    const diff = day === 0 ? 1 : 8 - day
    d.setDate(d.getDate() + diff)
    return d.toISOString().slice(0, 10)
  })()

  async function scheduleDrop() {
    setScheduling(true); setError(null)
    try {
      const drop = await createMailDrop(campaignId, nextMonday, 1)
      setMailDrop(drop)
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail ?? 'Failed to schedule. You can do this later from Mail Calendar.')
    } finally { setScheduling(false) }
  }

  async function approveDrop() {
    if (!mailDrop) return
    setApproving(true)
    try {
      await approveMailDrop(mailDrop.id)
      await upsertSetting('onboarding_complete', true)
      setDone(true)
      setShowConfetti(true)
      setTimeout(() => setShowConfetti(false), 4500)
    } catch {
      // Still complete onboarding even if approve fails
      await upsertSetting('onboarding_complete', true).catch(() => {})
      setDone(true)
      setShowConfetti(true)
      setTimeout(() => { setShowConfetti(false); onComplete() }, 4500)
    } finally { setApproving(false) }
  }

  if (done) {
    return (
      <div className="text-center py-8">
        {showConfetti && <Confetti />}
        <div className="text-5xl mb-4">🎉</div>
        <h2 className="text-2xl font-bold mb-2" style={{ color: '#1A0A2E' }}>You're all set!</h2>
        <p className="text-sm mb-2" style={{ color: '#6B5B8A' }}>Your first mail campaign is live. Sellers will start calling within days of your first send.</p>
        <p className="text-xs mb-8" style={{ color: '#9B8AAE' }}>Check your Mail Calendar to track drops and your Seller Inbox for incoming calls.</p>
        <button className="btn-primary px-10 py-3 text-base" onClick={onComplete}>
          Go to Dashboard →
        </button>
      </div>
    )
  }

  return (
    <div>
      <h2 className="text-2xl font-bold mb-2" style={{ color: '#1A0A2E' }}>Set your mail budget</h2>
      <p className="text-sm mb-6" style={{ color: '#6B5B8A' }}>How much do you want to mail each week?</p>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div>
          <label className="block text-xs font-semibold mb-1" style={{ color: '#6B5B8A' }}>Weekly Budget ($)</label>
          <input type="number" className="input-base w-full" value={weeklyBudget}
            onChange={e => setWeeklyBudget(Number(e.target.value))} min={50} step={50} />
        </div>
        <div>
          <label className="block text-xs font-semibold mb-1" style={{ color: '#6B5B8A' }}>Cost Per Piece ($)</label>
          <input type="number" className="input-base w-full" value={costPerPiece}
            onChange={e => setCostPerPiece(Number(e.target.value))} min={0.1} step={0.05} />
        </div>
      </div>

      <div className="rounded-xl p-4 mb-6" style={{ background: '#F8F6FB', border: '1px solid #EDE8F5' }}>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-2xl font-bold" style={{ color: '#5C2977' }}>{piecesPerWeek.toLocaleString()}</p>
            <p className="text-xs" style={{ color: '#9B8AAE' }}>pieces per week</p>
          </div>
          <div>
            <p className="text-2xl font-bold" style={{ color: '#5C2977' }}>${weeklyBudget}</p>
            <p className="text-xs" style={{ color: '#9B8AAE' }}>weekly cost</p>
          </div>
          <div>
            <p className="text-2xl font-bold" style={{ color: '#5C2977' }}>
              {nextMonday}
            </p>
            <p className="text-xs" style={{ color: '#9B8AAE' }}>first send date</p>
          </div>
        </div>
      </div>

      <div className="mb-6">
        <label className="block text-xs font-semibold mb-1" style={{ color: '#6B5B8A' }}>Mail House Email</label>
        <input type="email" className="input-base w-full" placeholder="mailhouse@example.com"
          value={mailHouseEmail} onChange={e => setMailHouseEmail(e.target.value)} />
        <p className="text-xs mt-1" style={{ color: '#9B8AAE' }}>CSV + PDF will be emailed here when you send each drop</p>
      </div>

      {!mailDrop ? (
        <>
          {error && <p className="text-xs mb-3" style={{ color: '#B71C1C' }}>{error}</p>}
          <div className="flex justify-between">
            <button className="btn-secondary" onClick={onBack}>← Back</button>
            <button className="btn-primary px-8 py-3 text-sm" onClick={scheduleDrop} disabled={scheduling}>
              {scheduling ? 'Scheduling…' : `Schedule First Send: ${nextMonday} →`}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="rounded-xl p-5 mb-6" style={{ background: '#E8F5E9', border: '1px solid #C8E6C9' }}>
            <p className="font-bold text-sm mb-2" style={{ color: '#2E7D32' }}>✓ Mail drop scheduled</p>
            <p className="text-sm" style={{ color: '#1A0A2E' }}>
              First send: <strong>{mailDrop.scheduled_date || nextMonday}</strong>
              {mailDrop.pieces_count ? ` · ${mailDrop.pieces_count.toLocaleString()} pieces` : ''}
              {mailDrop.estimated_cost ? ` · Est. $${mailDrop.estimated_cost.toLocaleString()}` : ''}
            </p>
          </div>
          <div className="flex justify-between">
            <button className="btn-secondary" onClick={onBack}>← Back</button>
            <button className="btn-primary px-8 py-3 text-sm" onClick={approveDrop} disabled={approving}>
              {approving ? 'Approving…' : '🚀 Approve & Launch'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ── Main Wizard ───────────────────────────────────────────────────────────────

export default function OnboardingWizard({ onComplete, startAtStep = 1 }: WizardProps) {
  const [step, setStep] = useState(startAtStep)
  const [strategy, setStrategy] = useState<Strategy>('infill_lots')
  const [selectedState, setSelectedState] = useState('')
  const [researchResult, setResearchResult] = useState<StateResearchResult | null>(null)
  const [selectedCounty, setSelectedCounty] = useState<CountyRecommendation | null>(null)
  const [campaignId, setCampaignId] = useState<string | null>(null)

  const placeholderCounty: CountyRecommendation = {
    county: 'Your County', state: selectedState.slice(0, 2).toUpperCase(),
    rank: 1, why_good: 'Selected market', price_range_low: 15000, price_range_high: 80000,
    builder_demand: 'Medium', recommended_acreage_min: 0.1, recommended_acreage_max: 2.0,
    population_trend: 'Growing', dom_estimate: 60,
  }

  async function finish() {
    await upsertSetting('onboarding_complete', true).catch(() => {})
    onComplete()
  }

  return (
    <div className="fixed inset-0 z-50 overflow-auto" style={{ background: 'rgba(26,10,46,0.6)', backdropFilter: 'blur(4px)' }}>
      <div className="min-h-full flex items-center justify-center p-4 py-12">
        <div className="w-full max-w-2xl rounded-2xl" style={{ background: '#fff', boxShadow: '0 24px 80px rgba(26,10,46,0.25)' }}>
          {/* Header */}
          <div className="px-8 pt-8 pb-4" style={{ borderBottom: '1px solid #EDE8F5' }}>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: '#5C2977' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                </svg>
              </div>
              <span className="font-bold text-sm" style={{ color: '#5C2977' }}>Land Dominator Setup</span>
            </div>
            <ProgressBar step={step} />
          </div>

          {/* Step content */}
          <div className="px-8 py-8">
            {step === 1 && (
              <Step1Strategy onNext={(s) => { setStrategy(s); setStep(2) }} />
            )}
            {step === 2 && (
              <Step2Learn strategy={strategy} onNext={() => setStep(3)} onBack={() => setStep(1)} />
            )}
            {step === 3 && (
              <Step3Research
                strategy={strategy}
                onNext={(st, c) => { setSelectedState(st); setSelectedCounty(c); setStep(4) }}
                onBack={() => setStep(2)}
                onStateSelect={setSelectedState}
                onResearchDone={setResearchResult}
              />
            )}
            {step === 4 && (
              <Step4Comps
                state={selectedState || 'your state'}
                strategy={strategy}
                county={selectedCounty || researchResult?.counties?.[0]}
                onNext={() => setStep(5)}
                onBack={() => setStep(3)}
                onSkip={() => setStep(5)}
              />
            )}
            {step === 5 && (
              <Step5Market
                state={selectedState}
                county={selectedCounty || researchResult?.counties?.[0] || placeholderCounty}
                strategy={strategy}
                onNext={(id) => { setCampaignId(id); setStep(6) }}
                onBack={() => setStep(4)}
              />
            )}
            {step === 6 && campaignId && (
              <Step6Launch
                campaignId={campaignId}
                onComplete={finish}
                onBack={() => setStep(5)}
              />
            )}
          </div>

          {/* Skip link at bottom */}
          {step < 6 && (
            <div className="px-8 pb-6 text-center">
              <button className="text-xs underline" style={{ color: '#9B8AAE' }} onClick={finish}>
                Skip setup — go straight to dashboard
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
