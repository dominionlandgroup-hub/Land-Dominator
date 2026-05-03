import React, { useEffect, useState, useCallback, useRef } from 'react'
import { listDeals, updateDeal, listProperties, updateProperty, initiateOutboundCall } from '../api/crm'
import type { CRMDeal, CRMProperty } from '../types/crm'
import { useApp } from '../context/AppContext'

// ── Types ─────────────────────────────────────────────────────────────────────

interface BoardsProps {
  view: 'boards-seller' | 'boards-buyer' | 'boards-inventory'
}

// ── Pipeline columns ──────────────────────────────────────────────────────────

const PIPELINE_STAGES: { stage: string; label: string; color: string; desc: string }[] = [
  { stage: 'new_lead',       label: 'New Lead',       color: '#DC2626', desc: 'Hot inbound from SMS or call' },
  { stage: 'contacted',      label: 'Contacted',      color: '#7C3AED', desc: 'First contact made' },
  { stage: 'offer_sent',     label: 'Offer Sent',     color: '#D97706', desc: 'Formal offer delivered' },
  { stage: 'follow_up',      label: 'Follow Up',      color: '#2563EB', desc: 'Seller needs time to think' },
  { stage: 'under_contract', label: 'Under Contract', color: '#059669', desc: 'Purchase agreement signed' },
  { stage: 'closed_won',     label: 'Closed Won',     color: '#065F46', desc: 'Deal closed' },
]

const NEXT_STAGE: Record<string, string> = {
  new_lead: 'contacted',
  contacted: 'offer_sent',
  offer_sent: 'follow_up',
  follow_up: 'under_contract',
  under_contract: 'closed_won',
}

// ── Property board columns (buyer / inventory) ────────────────────────────────

const PROPERTY_BOARD_COLUMNS: Record<string, { status: string; label: string; color: string }[]> = {
  'boards-buyer': [
    { status: 'lead',           label: 'Available',      color: '#4A90D9' },
    { status: 'prospect',       label: 'Buyer Found',    color: '#7C3AED' },
    { status: 'under_contract', label: 'Under Contract', color: '#059669' },
    { status: 'closed_won',     label: 'Closed',         color: '#059669' },
  ],
  'boards-inventory': [
    { status: 'lead',           label: 'Listed',         color: '#4A90D9' },
    { status: 'under_contract', label: 'Under Contract', color: '#059669' },
    { status: 'closed_won',     label: 'Sold',           color: '#059669' },
  ],
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtCurrency(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${Math.round(n / 1000)}K`
  return `$${n.toLocaleString()}`
}

function timeAgo(dateStr: string | undefined): string {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function daysInStage(dateStr: string | undefined): number {
  if (!dateStr) return 0
  return Math.max(0, Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000))
}

function calcFee(offerPrice: number | null | undefined): number {
  const p = offerPrice ?? 0
  if (p <= 0) return 0
  const retail = p / 0.525
  return Math.max(0, Math.round(retail - p - 2000))
}

// ── Seller Deals Board ────────────────────────────────────────────────────────

function SellerDealsBoard() {
  const { setCurrentPage, newDealCount } = useApp()
  const [deals, setDeals] = useState<CRMDeal[]>([])
  const [loading, setLoading] = useState(true)
  const [showDead, setShowDead] = useState(false)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverCol, setDragOverCol] = useState<string | null>(null)
  const [callingId, setCallingId] = useState<string | null>(null)
  const [callMsg, setCallMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const all = await listDeals()
      setDeals(all)
    } catch { /* silent */ } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  function dealsForStage(stage: string): CRMDeal[] {
    return deals
      .filter(d => d.stage === stage)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  }

  const deadDeals = deals.filter(d => d.stage === 'dead')

  const activeDeals = deals.filter(d => !['closed_won', 'dead'].includes(d.stage))
  const pipelineValue = activeDeals.reduce((sum, d) => sum + (d.offer_high ?? d.offer_price ?? 0), 0)

  async function moveToStage(dealId: string, stage: string) {
    const prev = deals.find(d => d.id === dealId)
    if (!prev || prev.stage === stage) return
    setDeals(ds => ds.map(d => d.id === dealId ? { ...d, stage: stage as CRMDeal['stage'], stage_entered_at: new Date().toISOString() } : d))
    try {
      await updateDeal(dealId, { stage: stage as CRMDeal['stage'], stage_entered_at: new Date().toISOString() })
    } catch {
      setDeals(ds => ds.map(d => d.id === dealId ? { ...d, stage: prev.stage, stage_entered_at: prev.stage_entered_at } : d))
    }
  }

  async function markDead(dealId: string) {
    await moveToStage(dealId, 'dead')
  }

  async function moveNext(dealId: string) {
    const deal = deals.find(d => d.id === dealId)
    if (!deal) return
    const next = NEXT_STAGE[deal.stage]
    if (next) await moveToStage(dealId, next)
  }

  async function callSeller(deal: CRMDeal) {
    if (!deal.seller_phone) { setCallMsg('No phone number on file'); return }
    setCallingId(deal.id)
    try {
      await initiateOutboundCall(deal.seller_phone, deal.property_id ?? undefined, deal.owner_name ?? undefined)
      setCallMsg(`Calling ${deal.owner_name ?? deal.seller_phone}…`)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Call failed'
      setCallMsg(msg)
    } finally {
      setCallingId(null)
      setTimeout(() => setCallMsg(null), 4000)
    }
  }

  function textSeller(_deal: CRMDeal) {
    setCurrentPage('seller-inbox')
  }

  function onDragStart(e: React.DragEvent, id: string) {
    setDraggingId(id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('dealId', id)
  }

  function onDragEnd() {
    setDraggingId(null)
    setDragOverCol(null)
  }

  function onDragOver(e: React.DragEvent, stage: string) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverCol(stage)
  }

  function onDrop(e: React.DragEvent, stage: string) {
    e.preventDefault()
    const id = e.dataTransfer.getData('dealId') || draggingId
    if (id) moveToStage(id, stage)
    setDraggingId(null)
    setDragOverCol(null)
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#9B8AAE' }}>
        Loading pipeline…
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#F8F6FB', overflow: 'hidden' }}>
      {/* Header */}
      <div className="page-header" style={{ flexShrink: 0 }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: '#1A0A2E' }}>Seller Deals</h1>
          {!loading && (
            <p style={{ fontSize: 12, color: '#059669', fontWeight: 600, margin: '2px 0 0' }}>
              Pipeline Value: {fmtCurrency(pipelineValue)} · {activeDeals.length} active lead{activeDeals.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {showDead && deadDeals.length > 0 && (
            <span style={{ fontSize: 12, color: '#9CA3AF' }}>{deadDeals.length} dead</span>
          )}
          <button
            onClick={() => setShowDead(s => !s)}
            style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #E5E7EB', background: '#fff', color: '#6B7280', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}
          >
            {showDead ? 'Hide Dead' : 'Show Dead'}
          </button>
          <button className="btn-secondary text-sm" onClick={load}>↻ Refresh</button>
        </div>
      </div>

      {/* Toast */}
      {callMsg && (
        <div style={{ position: 'fixed', top: 20, right: 20, zIndex: 2000, background: '#1F2937', color: '#fff', padding: '10px 18px', borderRadius: 10, fontSize: 13, fontWeight: 600, boxShadow: '0 4px 20px rgba(0,0,0,0.25)' }}>
          {callMsg}
        </div>
      )}

      {/* Board */}
      <div style={{ flex: 1, overflowX: 'auto', overflowY: 'hidden', padding: '16px 24px 24px' }}>
        <div style={{ display: 'flex', gap: 14, height: '100%', minWidth: 'max-content' }}>
          {PIPELINE_STAGES.map(col => {
            const cards = dealsForStage(col.stage)
            const isDragTarget = dragOverCol === col.stage
            const isNewLead = col.stage === 'new_lead'
            return (
              <div
                key={col.stage}
                style={{ width: 290, display: 'flex', flexDirection: 'column', flexShrink: 0 }}
                onDragOver={e => onDragOver(e, col.stage)}
                onDragLeave={() => setDragOverCol(null)}
                onDrop={e => onDrop(e, col.stage)}
              >
                {/* Column header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, padding: '0 2px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: col.color, display: 'inline-block', flexShrink: 0 }} />
                    <span style={{ fontWeight: 700, fontSize: 13, color: '#1A0A2E' }}>{col.label}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{
                      background: `${col.color}18`, color: col.color,
                      border: `1px solid ${col.color}30`,
                      borderRadius: 10, padding: '1px 8px', fontSize: 11, fontWeight: 700,
                    }}>
                      {isNewLead && newDealCount > 0 ? newDealCount : cards.length}
                    </span>
                  </div>
                </div>

                {/* Cards */}
                <div style={{
                  flex: 1, overflowY: 'auto', borderRadius: 8, padding: '8px 6px',
                  background: isDragTarget ? `${col.color}08` : '#F3EEF9',
                  border: `2px dashed ${isDragTarget ? col.color : 'transparent'}`,
                  transition: 'border-color 0.15s, background 0.15s',
                  minHeight: 80,
                }}>
                  {cards.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '20px 12px', color: '#D4C5E8', fontSize: 12 }}>Drop here</div>
                  ) : cards.map(deal => (
                    <DealCard
                      key={deal.id}
                      deal={deal}
                      col={col}
                      isDragging={draggingId === deal.id}
                      isCalling={callingId === deal.id}
                      onDragStart={onDragStart}
                      onDragEnd={onDragEnd}
                      onCall={() => callSeller(deal)}
                      onText={() => textSeller(deal)}
                      onMoveNext={() => moveNext(deal.id)}
                      onMarkDead={() => markDead(deal.id)}
                    />
                  ))}
                </div>
              </div>
            )
          })}

          {/* Dead column — hidden unless toggled */}
          {showDead && (
            <div
              style={{ width: 260, display: 'flex', flexDirection: 'column', flexShrink: 0 }}
              onDragOver={e => onDragOver(e, 'dead')}
              onDragLeave={() => setDragOverCol(null)}
              onDrop={e => onDrop(e, 'dead')}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10, padding: '0 2px' }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#6B7280', display: 'inline-block', flexShrink: 0 }} />
                <span style={{ fontWeight: 700, fontSize: 13, color: '#6B7280' }}>Dead</span>
                <span style={{ background: '#F3F4F6', color: '#6B7280', border: '1px solid #E5E7EB', borderRadius: 10, padding: '1px 8px', fontSize: 11, fontWeight: 700 }}>{deadDeals.length}</span>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', borderRadius: 8, padding: '8px 6px', background: '#F9FAFB', border: `2px dashed ${dragOverCol === 'dead' ? '#6B7280' : 'transparent'}`, minHeight: 80 }}>
                {deadDeals.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '20px 12px', color: '#D1D5DB', fontSize: 12 }}>No dead deals</div>
                ) : deadDeals.map(deal => (
                  <div key={deal.id} style={{ background: '#fff', borderRadius: 8, padding: '10px 12px', marginBottom: 8, border: '1px solid #E5E7EB', opacity: 0.7 }}>
                    <p style={{ fontWeight: 700, fontSize: 13, color: '#374151', margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {deal.owner_name || deal.title || '—'}
                    </p>
                    <p style={{ fontSize: 11, color: '#9CA3AF', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {deal.property_address || '—'}
                    </p>
                    <button
                      onClick={() => moveToStage(deal.id, 'new_lead')}
                      style={{ marginTop: 6, fontSize: 10, padding: '2px 8px', borderRadius: 6, border: '1px solid #D1D5DB', background: '#F9FAFB', color: '#6B7280', cursor: 'pointer' }}
                    >
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Deal Card ─────────────────────────────────────────────────────────────────

interface DealCardProps {
  deal: CRMDeal
  col: { stage: string; label: string; color: string }
  isDragging: boolean
  isCalling: boolean
  onDragStart: (e: React.DragEvent, id: string) => void
  onDragEnd: () => void
  onCall: () => void
  onText: () => void
  onMoveNext: () => void
  onMarkDead: () => void
}

function DealCard({ deal, col, isDragging, isCalling, onDragStart, onDragEnd, onCall, onText, onMoveNext, onMarkDead }: DealCardProps) {
  const [hovered, setHovered] = useState(false)
  const days = daysInStage(deal.stage_entered_at ?? deal.created_at)
  const fee = deal.assignment_fee ?? calcFee(deal.offer_price)
  const feeColor = fee >= 10000 ? '#059669' : fee >= 5000 ? '#D97706' : '#9B8AAE'
  const sourceIcon = deal.source === 'SMS' ? '💬' : deal.source === 'CALL' ? '📞' : ''
  const hasNext = !!NEXT_STAGE[deal.stage]

  const offerRangeStr = (deal.offer_low != null && deal.offer_high != null)
    ? `${fmtCurrency(deal.offer_low)} – ${fmtCurrency(deal.offer_high)}`
    : deal.offer_price != null ? fmtCurrency(deal.offer_price) : null

  return (
    <div
      draggable
      onDragStart={e => onDragStart(e, deal.id)}
      onDragEnd={onDragEnd}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: '#FFFFFF', borderRadius: 10, padding: '12px 14px',
        marginBottom: 10, cursor: 'grab',
        border: isDragging ? `1.5px solid ${col.color}` : hovered ? '1.5px solid #D4C5E8' : '1px solid #E8E0F0',
        opacity: isDragging ? 0.45 : 1,
        transition: 'border-color 0.1s, opacity 0.1s',
        userSelect: 'none',
        boxShadow: hovered ? '0 3px 12px rgba(92,41,119,0.12)' : '0 1px 3px rgba(92,41,119,0.07)',
      }}
    >
      {/* Owner name + source */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 3 }}>
        <p style={{ fontWeight: 700, fontSize: 14, color: '#1A0A2E', margin: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {deal.owner_name || deal.title || '—'}
        </p>
        {sourceIcon && (
          <span style={{ fontSize: 13, marginLeft: 6, flexShrink: 0 }} title={deal.source ?? ''}>{sourceIcon}</span>
        )}
      </div>

      {/* Address */}
      {deal.property_address && (
        <p style={{ fontSize: 11, color: '#6B5B8A', margin: '0 0 6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {deal.property_address}
        </p>
      )}

      {/* Offer range */}
      {offerRangeStr && (
        <p style={{ fontSize: 12, fontWeight: 700, color: col.color, margin: '0 0 4px' }}>
          {offerRangeStr}
        </p>
      )}

      {/* Contract price for under_contract / closed */}
      {deal.contract_price != null && (
        <p style={{ fontSize: 11, color: '#059669', margin: '0 0 4px', fontWeight: 600 }}>
          Contract: {fmtCurrency(deal.contract_price)}
          {deal.closing_date ? ` · Closes ${deal.closing_date}` : ''}
        </p>
      )}

      {/* Meta row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
        <span style={{ fontSize: 10, color: '#9CA3AF' }}>{timeAgo(deal.created_at)}</span>
        <span style={{ fontSize: 10, color: days >= 7 ? '#DC2626' : '#9CA3AF', fontWeight: days >= 7 ? 700 : 400 }}>
          Day {days}
        </span>
      </div>

      {fee > 0 && (
        <p style={{ fontSize: 11, fontWeight: 600, color: feeColor, margin: '4px 0 0' }}>
          Est. Fee: {fmtCurrency(fee)}
        </p>
      )}

      {/* Assignment fee for closed */}
      {deal.assignment_fee != null && deal.stage === 'closed_won' && (
        <p style={{ fontSize: 12, fontWeight: 700, color: '#065F46', margin: '4px 0 0' }}>
          Earned: {fmtCurrency(deal.assignment_fee)}
        </p>
      )}

      {/* Action buttons — visible on hover */}
      {hovered && (
        <div style={{ display: 'flex', gap: 5, marginTop: 10, flexWrap: 'wrap' }}>
          <ActionBtn onClick={onCall} disabled={isCalling} color="#4F46E5" title="Call">📞</ActionBtn>
          <ActionBtn onClick={onText} color="#059669" title="Text">💬</ActionBtn>
          {hasNext && (
            <ActionBtn onClick={onMoveNext} color="#D97706" title="Move to next stage">→</ActionBtn>
          )}
          <ActionBtn onClick={onMarkDead} color="#DC2626" title="Mark as Dead">🗑</ActionBtn>
        </div>
      )}
    </div>
  )
}

function ActionBtn({ onClick, disabled, color, title, children }: {
  onClick: () => void; disabled?: boolean; color: string; title: string; children: React.ReactNode
}) {
  const [hov, setHov] = useState(false)
  return (
    <button
      onClick={e => { e.stopPropagation(); onClick() }}
      disabled={disabled}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      title={title}
      style={{
        padding: '4px 8px', borderRadius: 6, border: `1px solid ${color}40`,
        background: hov ? `${color}18` : '#F9F9F9',
        color, fontSize: 12, cursor: disabled ? 'default' : 'pointer',
        fontWeight: 600, transition: 'background 0.1s',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  )
}

// ── Property Board (buyer / inventory) ───────────────────────────────────────

function PropertyBoard({ view }: { view: 'boards-buyer' | 'boards-inventory' }) {
  const { setCurrentPage, setSelectedPropertyId } = useApp()
  const [properties, setProperties] = useState<CRMProperty[]>([])
  const [loading, setLoading] = useState(true)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverCol, setDragOverCol] = useState<string | null>(null)

  const columns = PROPERTY_BOARD_COLUMNS[view] ?? []

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const statuses = columns.map(c => c.status)
      const results = await Promise.all(
        statuses.map(s => listProperties({ status: s, limit: 200, page: 1 }).catch(() => ({ data: [], total: 0, page: 1, limit: 200 })))
      )
      setProperties(results.flatMap(r => r.data))
    } finally { setLoading(false) }
  }, [view]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  async function moveCard(propertyId: string, newStatus: string) {
    const prev = properties.find(p => p.id === propertyId)
    if (!prev || prev.status === newStatus) return
    setProperties(ps => ps.map(p => p.id === propertyId ? { ...p, status: newStatus as CRMProperty['status'] } : p))
    try {
      await updateProperty(propertyId, { status: newStatus as CRMProperty['status'] })
    } catch {
      setProperties(ps => ps.map(p => p.id === propertyId ? { ...p, status: prev.status } : p))
    }
  }

  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#9B8AAE' }}>Loading…</div>
  }

  const LABELS: Record<string, string> = { 'boards-buyer': 'Buyer Deals Board', 'boards-inventory': 'Inventory Board' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#F8F6FB', overflow: 'hidden' }}>
      <div className="page-header" style={{ flexShrink: 0 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: '#1A0A2E' }}>{LABELS[view]}</h1>
        <button className="btn-secondary text-sm" onClick={load}>↻ Refresh</button>
      </div>
      <div style={{ flex: 1, overflowX: 'auto', overflowY: 'hidden', padding: '16px 24px 24px' }}>
        <div style={{ display: 'flex', gap: 16, height: '100%' }}>
          {columns.map(col => {
            const cards = properties.filter(p => p.status === col.status)
            return (
              <div
                key={col.status}
                style={{ minWidth: 280, width: 280, display: 'flex', flexDirection: 'column', flexShrink: 0 }}
                onDragOver={e => { e.preventDefault(); setDragOverCol(col.status) }}
                onDragLeave={() => setDragOverCol(null)}
                onDrop={e => {
                  e.preventDefault()
                  const id = e.dataTransfer.getData('propertyId') || draggingId
                  if (id) moveCard(id, col.status)
                  setDraggingId(null); setDragOverCol(null)
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: col.color, display: 'inline-block' }} />
                  <span style={{ fontWeight: 700, fontSize: 13, color: '#1A0A2E' }}>{col.label}</span>
                  <span style={{ background: `${col.color}18`, color: col.color, border: `1px solid ${col.color}30`, borderRadius: 10, padding: '1px 8px', fontSize: 11, fontWeight: 700 }}>{cards.length}</span>
                </div>
                <div style={{
                  flex: 1, overflowY: 'auto', borderRadius: 8, padding: '8px 6px',
                  background: dragOverCol === col.status ? `${col.color}08` : '#F3EEF9',
                  border: `2px dashed ${dragOverCol === col.status ? col.color : 'transparent'}`,
                  minHeight: 80,
                }}>
                  {cards.map(p => (
                    <div
                      key={p.id}
                      draggable
                      onDragStart={e => { setDraggingId(p.id); e.dataTransfer.setData('propertyId', p.id) }}
                      onDragEnd={() => { setDraggingId(null); setDragOverCol(null) }}
                      onClick={() => { setSelectedPropertyId(p.id); setCurrentPage('crm-properties') }}
                      style={{
                        background: '#fff', borderRadius: 8, padding: '12px 14px', marginBottom: 8,
                        cursor: 'pointer', border: '1px solid #E8E0F0', opacity: draggingId === p.id ? 0.5 : 1,
                        boxShadow: '0 1px 3px rgba(92,41,119,0.08)',
                      }}
                    >
                      <p style={{ fontWeight: 700, fontSize: 13, color: '#1A0A2E', margin: '0 0 4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.owner_full_name || [p.owner_first_name, p.owner_last_name].filter(Boolean).join(' ') || '—'}
                      </p>
                      {p.county && <p style={{ fontSize: 11, color: '#6B5B8A', margin: '0 0 6px' }}>{p.county}</p>}
                      {p.offer_price != null && <p style={{ fontSize: 13, fontWeight: 700, color: col.color, margin: 0 }}>{fmtCurrency(p.offer_price)}</p>}
                    </div>
                  ))}
                  {cards.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '20px 12px', color: '#D4C5E8', fontSize: 12 }}>Drop here</div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Entry point ───────────────────────────────────────────────────────────────

export default function Boards({ view }: BoardsProps) {
  if (view === 'boards-seller') return <SellerDealsBoard />
  return <PropertyBoard view={view as 'boards-buyer' | 'boards-inventory'} />
}
