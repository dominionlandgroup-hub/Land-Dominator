import React, { useEffect, useState, useCallback } from 'react'
import { listProperties, updateProperty } from '../api/crm'
import type { CRMProperty } from '../types/crm'
import { useApp } from '../context/AppContext'

const SELLER_STATUSES = ['prospect', 'interested', 'offer_sent', 'under_contract', 'closed_won']

function calcFee(offerPrice: number | null | undefined, lpEstimate: number | null | undefined): number {
  const offer = offerPrice ?? 0
  if (offer <= 0) return 0
  const retail = (lpEstimate && lpEstimate > 0) ? lpEstimate : offer / 0.525
  return Math.max(0, Math.round(retail - offer - 2000))
}

interface BoardsProps {
  view: 'boards-seller' | 'boards-buyer' | 'boards-inventory'
}

// Column definitions per board view
const BOARD_COLUMNS: Record<string, { status: string; label: string; color: string }[]> = {
  'boards-seller': [
    { status: 'prospect',       label: 'New Lead',        color: '#5C2977' },
    { status: 'interested',     label: 'Interested',      color: '#7C3AED' },
    { status: 'offer_sent',     label: 'Offer Sent',      color: '#D97706' },
    { status: 'under_contract', label: 'Under Contract',  color: '#2563EB' },
    { status: 'closed_won',     label: 'Closed Won',      color: '#059669' },
  ],
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

const BOARD_LABELS: Record<string, string> = {
  'boards-seller':    'Seller Deals Board',
  'boards-buyer':     'Buyer Deals Board',
  'boards-inventory': 'Inventory Board',
}

function fmtCurrency(n: number): string {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `$${Math.round(n / 1000)}K`
  return `$${n.toLocaleString()}`
}

function daysAgo(dateStr: string | undefined): number {
  if (!dateStr) return 0
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24))
}

export default function Boards({ view }: BoardsProps) {
  const { setCurrentPage, setSelectedPropertyId } = useApp()
  const [properties, setProperties] = useState<CRMProperty[]>([])
  const [loading, setLoading] = useState(true)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverCol, setDragOverCol] = useState<string | null>(null)
  const [clearAllConfirm, setClearAllConfirm] = useState(false)
  const [clearingAll, setClearingAll] = useState(false)

  const columns = BOARD_COLUMNS[view] ?? BOARD_COLUMNS['boards-seller']

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const statuses = view === 'boards-seller' ? SELLER_STATUSES : columns.map(c => c.status)
      const allResults = await Promise.all(
        statuses.map(s => listProperties({ status: s, limit: 200, page: 1 }).catch(() => ({ data: [], total: 0, page: 1, limit: 200 })))
      )
      const all = allResults.flatMap(r => r.data)
      setProperties(all)
    } finally { setLoading(false) }
  }, [view]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  function propertiesForStatus(status: string): CRMProperty[] {
    return properties.filter(p => p.status === status)
      .sort((a, b) => new Date(b.updated_at ?? b.created_at ?? '').getTime() - new Date(a.updated_at ?? a.created_at ?? '').getTime())
  }

  function openProperty(p: CRMProperty) {
    setSelectedPropertyId(p.id)
    setCurrentPage('crm-properties')
  }

  async function moveCard(propertyId: string, newStatus: string) {
    const prev = properties.find(p => p.id === propertyId)
    if (!prev || prev.status === newStatus) return
    // Optimistic update
    setProperties(ps => ps.map(p => p.id === propertyId ? { ...p, status: newStatus as CRMProperty['status'] } : p))
    try {
      await updateProperty(propertyId, { status: newStatus as CRMProperty['status'] })
    } catch {
      // Revert on failure
      setProperties(ps => ps.map(p => p.id === propertyId ? { ...p, status: prev.status } : p))
    }
  }

  function onDragStart(e: React.DragEvent, id: string) {
    setDraggingId(id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('propertyId', id)
  }

  function onDragEnd() {
    setDraggingId(null)
    setDragOverCol(null)
  }

  function onDragOver(e: React.DragEvent, status: string) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverCol(status)
  }

  function onDrop(e: React.DragEvent, status: string) {
    e.preventDefault()
    const id = e.dataTransfer.getData('propertyId') || draggingId
    if (id) moveCard(id, status)
    setDraggingId(null)
    setDragOverCol(null)
  }

  async function handleClearNewLeads() {
    setClearingAll(true)
    try {
      const prospects = properties.filter(p => p.status === 'prospect')
      await Promise.all(prospects.map(p => updateProperty(p.id, { status: 'lead' })))
      setProperties(ps => ps.filter(p => p.status !== 'prospect'))
    } catch { /* silent */ } finally {
      setClearingAll(false)
      setClearAllConfirm(false)
    }
  }

  // Pipeline value calculation — sum assignment_fee for all active (non-closed) records
  const activeStatuses = new Set(['prospect', 'interested', 'offer_sent', 'under_contract'])
  const activeProperties = properties.filter(p => p.status && activeStatuses.has(p.status))
  const pipelineValue = activeProperties.reduce((sum, p) => sum + calcFee(p.offer_price, p.lp_estimate), 0)
  const newLeadCount = properties.filter(p => p.status === 'prospect').length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#F8F6FB', overflow: 'hidden' }}>
      {/* Header */}
      <div className="page-header" style={{ flexShrink: 0 }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: '#1A0A2E' }}>{BOARD_LABELS[view]}</h1>
          {view === 'boards-seller' && !loading && (
            <p style={{ fontSize: 12, color: '#059669', fontWeight: 600, margin: '2px 0 0' }}>
              Pipeline: {fmtCurrency(pipelineValue)} across {activeProperties.length} active lead{activeProperties.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>
        <button className="btn-secondary text-sm" onClick={load}>↻ Refresh</button>
      </div>

      {loading ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9B8AAE' }}>
          Loading board…
        </div>
      ) : (
        <div style={{ flex: 1, overflowX: 'auto', overflowY: 'hidden', padding: '16px 24px 24px' }}>
          <div style={{ display: 'flex', gap: 16, height: '100%' }}>
            {columns.map(col => {
              const cards = propertiesForStatus(col.status)
              const isDragTarget = dragOverCol === col.status
              const colValue = cards.reduce((sum, p) => sum + calcFee(p.offer_price, p.lp_estimate), 0)
              return (
                <div
                  key={col.status}
                  style={{ minWidth: 280, width: 280, display: 'flex', flexDirection: 'column', flexShrink: 0 }}
                  onDragOver={e => onDragOver(e, col.status)}
                  onDragLeave={() => setDragOverCol(null)}
                  onDrop={e => onDrop(e, col.status)}
                >
                  {/* Column header */}
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    marginBottom: 10, padding: '0 2px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 10, height: 10, borderRadius: '50%', background: col.color, display: 'inline-block', flexShrink: 0 }} />
                      <span style={{ fontWeight: 700, fontSize: 13, color: '#1A0A2E' }}>{col.label}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {cards.length > 0 && (
                        <span style={{ fontSize: 11, fontWeight: 600, color: col.color }}>{fmtCurrency(colValue)}</span>
                      )}
                      <span style={{
                        background: `${col.color}18`, color: col.color,
                        border: `1px solid ${col.color}30`,
                        borderRadius: 10, padding: '1px 8px', fontSize: 11, fontWeight: 700,
                      }}>{cards.length}</span>
                      {view === 'boards-seller' && col.status === 'prospect' && cards.length > 0 && (
                        <button
                          onClick={() => setClearAllConfirm(true)}
                          style={{ fontSize: 10, padding: '2px 7px', borderRadius: 6, border: '1px solid #E8E0F0', background: '#F7F3FC', color: '#9B8AAE', cursor: 'pointer', fontWeight: 600 }}
                        >
                          Clear All
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Cards container */}
                  <div style={{
                    flex: 1, overflowY: 'auto', borderRadius: 8, padding: '8px 6px',
                    background: isDragTarget ? `${col.color}08` : '#F3EEF9',
                    border: `2px dashed ${isDragTarget ? col.color : 'transparent'}`,
                    transition: 'border-color 0.15s, background 0.15s',
                    minHeight: 80,
                  }}>
                    {cards.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '20px 12px', color: '#D4C5E8', fontSize: 12 }}>
                        Drop here
                      </div>
                    ) : cards.map(p => {
                      const isDragging = draggingId === p.id
                      const days = daysAgo(p.updated_at ?? p.created_at)
                      const fee = calcFee(p.offer_price, p.lp_estimate)
                      const feeColor = fee >= 10000 ? '#059669' : fee >= 5000 ? '#D97706' : '#9B8AAE'
                      return (
                        <div
                          key={p.id}
                          draggable
                          onDragStart={e => onDragStart(e, p.id)}
                          onDragEnd={onDragEnd}
                          onClick={() => openProperty(p)}
                          style={{
                            background: '#FFFFFF', borderRadius: 8, padding: '12px 14px',
                            marginBottom: 8, cursor: 'pointer',
                            border: isDragging ? `1px solid ${col.color}` : '1px solid #E8E0F0',
                            opacity: isDragging ? 0.5 : 1,
                            transition: 'border-color 0.1s, opacity 0.1s',
                            userSelect: 'none',
                            boxShadow: '0 1px 3px rgba(92,41,119,0.08)',
                          }}
                          onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = '#D4C5E8' }}
                          onMouseLeave={e => { if (!isDragging) (e.currentTarget as HTMLDivElement).style.borderColor = '#E8E0F0' }}
                        >
                          <p style={{ fontWeight: 700, fontSize: 13, color: '#1A0A2E', margin: '0 0 4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {p.owner_full_name || [p.owner_first_name, p.owner_last_name].filter(Boolean).join(' ') || '—'}
                          </p>
                          {p.apn && <p style={{ fontSize: 11, color: '#9B8AAE', margin: '0 0 2px', fontFamily: 'monospace' }}>{p.apn}</p>}
                          {p.county && <p style={{ fontSize: 11, color: '#6B5B8A', margin: '0 0 6px' }}>{p.county}{p.state ? `, ${p.state}` : ''}</p>}
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: col.color }}>
                              {p.offer_price != null ? fmtCurrency(p.offer_price) : <span style={{ color: '#D4C5E8', fontSize: 11, fontWeight: 400 }}>No offer</span>}
                            </span>
                            <span style={{ fontSize: 10, color: '#D4C5E8' }}>{days}d ago</span>
                          </div>
                          {p.acreage != null && (
                            <p style={{ fontSize: 10, color: '#9B8AAE', margin: '4px 0 0' }}>{p.acreage.toFixed(2)} acres</p>
                          )}
                          <p style={{ fontSize: 11, fontWeight: 600, color: feeColor, margin: '4px 0 0' }}>
                            Est. Fee: {fmtCurrency(fee)}
                          </p>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Clear All New Leads confirmation modal */}
      {clearAllConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(26,10,46,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => !clearingAll && setClearAllConfirm(false)}>
          <div style={{ background: '#FFFFFF', borderRadius: 12, padding: 28, maxWidth: 420, width: '100%', border: '1px solid #E8E0F0' }}
            onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1A0A2E', margin: '0 0 10px' }}>Clear New Leads?</h2>
            <p style={{ fontSize: 13, color: '#6B5B8A', margin: '0 0 20px', lineHeight: 1.6 }}>
              Move all <strong>{newLeadCount} New Lead{newLeadCount !== 1 ? 's' : ''}</strong> to archive? This removes them from the board but keeps them in your CRM under Properties.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setClearAllConfirm(false)} disabled={clearingAll}
                style={{ padding: '9px 18px', borderRadius: 8, border: '1px solid #E8E0F0', background: '#F7F3FC', color: '#6B5B8A', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={handleClearNewLeads} disabled={clearingAll}
                style={{ padding: '9px 22px', borderRadius: 8, border: 'none', background: clearingAll ? '#9B8AAE' : '#DC2626', color: '#fff', fontWeight: 700, fontSize: 14, cursor: clearingAll ? 'default' : 'pointer' }}>
                {clearingAll ? 'Clearing…' : `Clear All (${newLeadCount})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
