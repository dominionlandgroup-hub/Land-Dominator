import React, { useEffect, useState, useCallback } from 'react'
import { listProperties, updateProperty } from '../api/crm'
import type { CRMProperty } from '../types/crm'
import { useApp } from '../context/AppContext'

interface BoardsProps {
  view: 'boards-seller' | 'boards-buyer' | 'boards-inventory'
}

// Column definitions per board view
const BOARD_COLUMNS: Record<string, { status: string; label: string; color: string }[]> = {
  'boards-seller': [
    { status: 'lead',           label: 'New Lead',       color: '#E65100' },
    { status: 'prospect',       label: 'Contacted',      color: '#1565C0' },
    { status: 'offer_sent',     label: 'Offer Sent',     color: '#6A1B9A' },
    { status: 'under_contract', label: 'Under Contract', color: '#2E7D32' },
    { status: 'due_diligence',  label: 'Due Diligence',  color: '#F57F17' },
    { status: 'closed_won',     label: 'Closed Won',     color: '#00695C' },
    { status: 'closed_lost',    label: 'Closed Lost',    color: '#B71C1C' },
  ],
  'boards-buyer': [
    { status: 'lead',           label: 'Available',      color: '#1565C0' },
    { status: 'prospect',       label: 'Buyer Found',    color: '#6A1B9A' },
    { status: 'under_contract', label: 'Under Contract', color: '#2E7D32' },
    { status: 'closed_won',     label: 'Closed',         color: '#00695C' },
  ],
  'boards-inventory': [
    { status: 'lead',           label: 'Listed',         color: '#1565C0' },
    { status: 'under_contract', label: 'Under Contract', color: '#2E7D32' },
    { status: 'closed_won',     label: 'Sold',           color: '#00695C' },
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

  const columns = BOARD_COLUMNS[view] ?? BOARD_COLUMNS['boards-seller']

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const statuses = columns.map(c => c.status)
      // Load up to 500 properties across all relevant statuses
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#F8F6FB', overflow: 'hidden' }}>
      {/* Header */}
      <div className="page-header" style={{ flexShrink: 0 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: '#1A0A2E' }}>{BOARD_LABELS[view]}</h1>
        <button className="btn-secondary text-sm" onClick={load}>↻ Refresh</button>
      </div>

      {loading ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9B8AAE' }}>
          Loading board…
        </div>
      ) : (
        <div style={{ flex: 1, overflowX: 'auto', overflowY: 'hidden', padding: '16px 24px 24px' }}>
          <div style={{ display: 'flex', gap: 16, height: '100%', minWidth: 'max-content' }}>
            {columns.map(col => {
              const cards = propertiesForStatus(col.status)
              const isDragTarget = dragOverCol === col.status
              return (
                <div
                  key={col.status}
                  style={{ width: 260, display: 'flex', flexDirection: 'column', flexShrink: 0 }}
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
                    <span style={{
                      background: `${col.color}18`, color: col.color,
                      border: `1px solid ${col.color}30`,
                      borderRadius: 10, padding: '1px 8px', fontSize: 11, fontWeight: 700,
                    }}>{cards.length}</span>
                  </div>

                  {/* Cards container */}
                  <div style={{
                    flex: 1, overflowY: 'auto', borderRadius: 12, padding: '8px 6px',
                    background: isDragTarget ? `${col.color}08` : '#F3EEF8',
                    border: `2px dashed ${isDragTarget ? col.color : 'transparent'}`,
                    transition: 'border-color 0.15s, background 0.15s',
                    minHeight: 80,
                  }}>
                    {cards.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '20px 12px', color: '#C4B5D8', fontSize: 12 }}>
                        Drop here
                      </div>
                    ) : cards.map(p => {
                      const isDragging = draggingId === p.id
                      const days = daysAgo(p.updated_at ?? p.created_at)
                      return (
                        <div
                          key={p.id}
                          draggable
                          onDragStart={e => onDragStart(e, p.id)}
                          onDragEnd={onDragEnd}
                          onClick={() => openProperty(p)}
                          style={{
                            background: '#fff', borderRadius: 10, padding: '12px 14px',
                            marginBottom: 8, cursor: 'pointer',
                            border: '1px solid #EDE8F5',
                            boxShadow: isDragging ? '0 4px 16px rgba(92,41,119,0.18)' : '0 1px 3px rgba(61,26,94,0.06)',
                            opacity: isDragging ? 0.5 : 1,
                            transition: 'box-shadow 0.1s, opacity 0.1s',
                            userSelect: 'none',
                          }}
                          onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 3px 10px rgba(92,41,119,0.12)' }}
                          onMouseLeave={e => { if (!isDragging) (e.currentTarget as HTMLDivElement).style.boxShadow = '0 1px 3px rgba(61,26,94,0.06)' }}
                        >
                          <p style={{ fontWeight: 700, fontSize: 13, color: '#1A0A2E', margin: '0 0 4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {p.owner_full_name || [p.owner_first_name, p.owner_last_name].filter(Boolean).join(' ') || '—'}
                          </p>
                          {p.apn && <p style={{ fontSize: 11, color: '#9B8AAE', margin: '0 0 2px', fontFamily: 'monospace' }}>{p.apn}</p>}
                          {p.county && <p style={{ fontSize: 11, color: '#6B5B8A', margin: '0 0 6px' }}>{p.county}{p.state ? `, ${p.state}` : ''}</p>}
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: col.color }}>
                              {p.offer_price != null ? fmtCurrency(p.offer_price) : <span style={{ color: '#C4B5D8', fontSize: 11, fontWeight: 400 }}>No offer</span>}
                            </span>
                            <span style={{ fontSize: 10, color: '#C4B5D8' }}>{days}d ago</span>
                          </div>
                          {p.acreage != null && (
                            <p style={{ fontSize: 10, color: '#9B8AAE', margin: '4px 0 0' }}>{p.acreage.toFixed(2)} acres</p>
                          )}
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
    </div>
  )
}
