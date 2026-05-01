import React, { useEffect, useRef, useState } from 'react'
import { listCommunications, sendSms, initiateOutboundCall } from '../api/crm'
import type { Communication } from '../types/crm'
import { useApp } from '../context/AppContext'

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtInboxDate(iso: string) {
  try {
    const d = new Date(iso)
    const now = new Date()
    const isToday = d.toDateString() === now.toDateString()
    if (isToday) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch { return '' }
}

function fmtMsgTime(iso: string) {
  try {
    return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  } catch { return iso }
}

function fmtTalk(s?: number | null) {
  if (!s) return ''
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

function fmtPhone(phone?: string) {
  if (!phone) return ''
  const d = phone.replace(/\D/g, '')
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`
  if (d.length === 11) return `+${d[0]} (${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`
  return phone
}

function contactName(comms: Communication[]): string {
  for (const c of comms) {
    const p = c.property
    if (!p) continue
    const full = p.owner_full_name || [p.owner_first_name, p.owner_last_name].filter(Boolean).join(' ')
    if (full) return full
  }
  return comms[0]?.phone_number || 'Unknown'
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function messagePreview(c: Communication): string {
  if (c.type.startsWith('sms')) return c.message_body || '(SMS)'
  if (c.summary) return c.summary
  if (c.transcript) return c.transcript.slice(0, 100)
  return c.type === 'call_inbound' ? '📞 Inbound call' : '📞 Outbound call'
}

// ── Thread grouping ───────────────────────────────────────────────────────────

interface Thread {
  phone: string
  name: string
  comms: Communication[]
  lastComm: Communication
  propertyId: string | null
  ownerFirstName: string
  propertyAddress: string
  offerPrice: number | null
  email: string | null
  leadScore: string | null
  disposition: string | null
}

function buildThreads(comms: Communication[]): Thread[] {
  const map = new Map<string, Communication[]>()
  for (const c of comms) {
    const key = c.phone_number || 'unknown'
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(c)
  }
  const threads: Thread[] = []
  for (const [phone, cs] of map) {
    const sorted = [...cs].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    const name = contactName(sorted)
    const prop = sorted.find(c => c.property)?.property
    const scores = sorted.map(c => c.lead_score).filter(Boolean)
    const topScore = scores.includes('hot') ? 'hot' : scores.includes('warm') ? 'warm' : (scores[0] || null)
    const dispositions = sorted.map(c => c.disposition).filter(Boolean)
    const dispPriority = ['INTERESTED', 'CALLBACK_NEEDED', 'MAYBE', 'NOT_INTERESTED', 'WRONG_NUMBER', 'NO_ANSWER']
    const topDisp = dispPriority.find(d => dispositions.includes(d)) || null
    threads.push({
      phone,
      name,
      comms: sorted,
      lastComm: sorted[0],
      propertyId: prop?.id || null,
      ownerFirstName: prop?.owner_first_name || name.split(' ')[0] || '',
      propertyAddress: '',
      offerPrice: prop?.offer_price || null,
      email: null,
      leadScore: topScore,
      disposition: topDisp,
    })
  }
  return threads.sort((a, b) => new Date(b.lastComm.created_at).getTime() - new Date(a.lastComm.created_at).getTime())
}

// ── Score dot ─────────────────────────────────────────────────────────────────

function ScoreDot({ score }: { score: string | null }) {
  if (!score) return null
  const color = score === 'hot' ? '#E65100' : score === 'warm' ? '#F59E0B' : '#78909C'
  return <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }} />
}

// ── Disposition badge ─────────────────────────────────────────────────────────

const DISP_CONFIG: Record<string, { label: string; bg: string; color: string; border?: string }> = {
  INTERESTED:       { label: 'Interested', bg: '#ECFDF5', color: '#065F46' },
  CALLBACK_NEEDED:  { label: 'Callback', bg: '#EFF6FF', color: '#1D4ED8' },
  MAYBE:            { label: 'Maybe', bg: '#F3F4F6', color: '#6B7280' },
  NOT_INTERESTED:   { label: 'Not Interested', bg: '#FEF2F2', color: '#991B1B' },
  WRONG_NUMBER:     { label: 'Wrong #', bg: '#FFF7ED', color: '#9A3412' },
  NO_ANSWER:        { label: 'No Answer', bg: '#F9FAFB', color: '#9CA3AF', border: '1px solid #E5E7EB' },
}

function DispositionBadge({ disposition }: { disposition: string | null }) {
  if (!disposition) return null
  const cfg = DISP_CONFIG[disposition]
  if (!cfg) return null
  return (
    <span style={{
      display: 'inline-block', padding: '1px 7px', borderRadius: 10, fontSize: 10, fontWeight: 700,
      background: cfg.bg, color: cfg.color, border: cfg.border,
    }}>{cfg.label}</span>
  )
}

// ── Communication detail modal ────────────────────────────────────────────────

function CommDetailModal({ comm, onClose }: { comm: Communication; onClose: () => void }) {
  const isCall = comm.type.startsWith('call')
  const isInbound = comm.direction === 'inbound' || comm.type.includes('inbound')
  const prop = comm.property

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={onClose}
    >
      <div
        style={{ background: '#fff', borderRadius: 16, padding: 24, width: '100%', maxWidth: 560, maxHeight: '82vh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1A0A2E', margin: 0 }}>
              {isCall
                ? (isInbound ? '↙ Inbound Call' : '↗ Outbound Call')
                : (isInbound ? '← Inbound SMS' : '→ Outbound SMS')}
            </h2>
            <p style={{ fontSize: 12, color: '#9B8AAE', margin: '3px 0 0' }}>{fmtMsgTime(comm.created_at)}</p>
          </div>
          <button onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: '#9B8AAE', lineHeight: 1, padding: '0 4px' }}>
            ×
          </button>
        </div>

        {/* Details grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 24px', marginBottom: 20 }}>
          <div>
            <p style={{ fontSize: 10, fontWeight: 700, color: '#9B8AAE', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 3px' }}>Phone</p>
            <p style={{ fontSize: 13, color: '#1A0A2E', margin: 0 }}>{fmtPhone(comm.phone_number) || '—'}</p>
          </div>
          {comm.duration_seconds != null && (
            <div>
              <p style={{ fontSize: 10, fontWeight: 700, color: '#9B8AAE', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 3px' }}>Duration</p>
              <p style={{ fontSize: 13, color: '#1A0A2E', margin: 0 }}>{fmtTalk(comm.duration_seconds) || '—'}</p>
            </div>
          )}
          {comm.lead_score && (
            <div>
              <p style={{ fontSize: 10, fontWeight: 700, color: '#9B8AAE', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 3px' }}>Lead Score</p>
              <span style={{
                display: 'inline-block', padding: '2px 10px', borderRadius: 12, fontSize: 12, fontWeight: 700,
                background: comm.lead_score === 'hot' ? '#FFF3E0' : comm.lead_score === 'warm' ? '#FFF9E6' : '#F5F5F5',
                color: comm.lead_score === 'hot' ? '#E65100' : comm.lead_score === 'warm' ? '#F59E0B' : '#78909C',
              }}>{comm.lead_score.toUpperCase()}</span>
            </div>
          )}
          {comm.disposition && (
            <div>
              <p style={{ fontSize: 10, fontWeight: 700, color: '#9B8AAE', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 3px' }}>Disposition</p>
              <DispositionBadge disposition={comm.disposition} />
            </div>
          )}
          {prop && (
            <div style={{ gridColumn: '1 / -1' }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: '#9B8AAE', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 3px' }}>Linked Property</p>
              <p style={{ fontSize: 13, color: '#1A0A2E', margin: 0 }}>
                {prop.owner_full_name || [prop.owner_first_name, prop.owner_last_name].filter(Boolean).join(' ') || 'Unknown'}
                {prop.apn ? ` · APN: ${prop.apn}` : ''}
                {prop.county ? ` · ${prop.county}` : ''}
              </p>
            </div>
          )}
        </div>

        {/* Recording */}
        {comm.recording_url && (
          <div style={{ marginBottom: 18 }}>
            <p style={{ fontSize: 10, fontWeight: 700, color: '#9B8AAE', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 6px' }}>Recording</p>
            <audio controls src={comm.recording_url} style={{ width: '100%', height: 32 }} />
          </div>
        )}

        {/* Summary (calls only) */}
        {isCall && (
          <div style={{ marginBottom: 18 }}>
            <p style={{ fontSize: 10, fontWeight: 700, color: '#9B8AAE', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 6px' }}>Summary</p>
            <p style={{ fontSize: 13, color: '#1A0A2E', margin: 0, lineHeight: 1.6, background: '#F8F6FB', borderRadius: 8, padding: '10px 14px' }}>
              {comm.summary || 'Call completed — no summary generated'}
            </p>
          </div>
        )}

        {/* Transcript */}
        {comm.transcript && (
          <div style={{ marginBottom: 18 }}>
            <p style={{ fontSize: 10, fontWeight: 700, color: '#9B8AAE', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 6px' }}>Transcript</p>
            <pre style={{
              fontSize: 12, color: '#6B5B8A', margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit',
              lineHeight: 1.6, background: '#F8F6FB', borderRadius: 8, padding: '10px 14px',
              maxHeight: 280, overflowY: 'auto',
            }}>
              {comm.transcript}
            </pre>
          </div>
        )}

        {/* SMS message body */}
        {!isCall && comm.message_body && (
          <div>
            <p style={{ fontSize: 10, fontWeight: 700, color: '#9B8AAE', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 6px' }}>Message</p>
            <p style={{ fontSize: 14, color: '#1A0A2E', margin: 0, background: '#F8F6FB', borderRadius: 8, padding: '10px 14px', lineHeight: 1.5 }}>
              {comm.message_body}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Message bubble ────────────────────────────────────────────────────────────

function MessageEntry({ c, onSelect }: { c: Communication; onSelect: (c: Communication) => void }) {
  const isOutbound = c.direction === 'outbound' || c.type.includes('outbound')
  const isSms = c.type.startsWith('sms')

  if (isSms) {
    return (
      <div
        className={`flex ${isOutbound ? 'justify-end' : 'justify-start'} mb-3`}
        style={{ cursor: 'pointer' }}
        onClick={() => onSelect(c)}
        title="Click to view details"
      >
        <div style={{
          maxWidth: '72%',
          background: isOutbound ? '#5C2977' : '#F0EBF8',
          color: isOutbound ? '#fff' : '#1A0A2E',
          borderRadius: isOutbound ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
          padding: '10px 14px',
          fontSize: 14,
        }}>
          <p style={{ margin: 0, lineHeight: 1.4 }}>{c.message_body || '—'}</p>
          <p style={{ margin: '4px 0 0', fontSize: 10, opacity: 0.6, textAlign: isOutbound ? 'right' : 'left' }}>
            {fmtMsgTime(c.created_at)}
          </p>
        </div>
      </div>
    )
  }

  // Call entry
  const icon = isOutbound ? '↗' : '↙'
  const label = isOutbound ? 'Outbound call' : 'Inbound call'
  const bg = isOutbound ? '#E3F2FD' : '#F3E5F5'
  const col = isOutbound ? '#1565C0' : '#6A1B9A'

  return (
    <div
      className="flex justify-center mb-3"
      style={{ cursor: 'pointer' }}
      onClick={() => onSelect(c)}
      title="Click to view call details"
    >
      <div style={{
        background: bg, border: `1px solid ${col}22`, borderRadius: 12, padding: '10px 16px',
        maxWidth: '85%', width: '100%',
        transition: 'box-shadow 0.1s',
      }}
        onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = 'none' }}
      >
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span style={{ color: col, fontWeight: 700, fontSize: 13 }}>{icon} {label}</span>
          {c.duration_seconds != null && <span style={{ color: '#6B5B8A', fontSize: 11 }}>{fmtTalk(c.duration_seconds)}</span>}
          {c.disposition && <DispositionBadge disposition={c.disposition} />}
          <span style={{ color: '#9B8AAE', fontSize: 11, marginLeft: 'auto' }}>{fmtMsgTime(c.created_at)}</span>
        </div>
        {c.recording_url && (
          <span style={{ fontSize: 11, color: '#2E7D32', fontWeight: 600 }}>▶ Recording available</span>
        )}
        {c.summary
          ? <p style={{ color: '#6B5B8A', fontSize: 12, margin: '4px 0 0', lineHeight: 1.4 }}>{c.summary}</p>
          : <p style={{ color: '#9B8AAE', fontSize: 11, margin: '4px 0 0', fontStyle: 'italic' }}>Call completed — no summary generated</p>
        }
        <p style={{ color: '#C4B5D8', fontSize: 10, margin: '4px 0 0' }}>Click to view full transcript →</p>
      </div>
    </div>
  )
}

// ── Quick templates ───────────────────────────────────────────────────────────

const TEMPLATES = (firstName: string, address: string, offerPrice: number | null) => [
  {
    label: 'Initial contact',
    text: `Hi ${firstName || '[First Name]'}, this is Damien with Dominion Land Group. I sent you a letter about your property${address ? ` at ${address}` : ''}. We have a cash offer${offerPrice ? ` of $${offerPrice.toLocaleString()}` : ''}. Are you still interested? Reply YES or call me back.`,
  },
  {
    label: 'Follow-up',
    text: `Hi ${firstName || '[First Name]'}, following up on our conversation about your property. Are you ready to move forward with our offer${offerPrice ? ` of $${offerPrice.toLocaleString()}` : ''}?`,
  },
  {
    label: 'Check-in',
    text: `Hi ${firstName || '[First Name]'}, just checking in. Has anything changed with your property${address ? ` at ${address}` : ''}? We are still interested in buying.`,
  },
]

// ── Main ──────────────────────────────────────────────────────────────────────

type InboxFilter = 'all' | 'calls' | 'texts' | 'hot' | 'callback' | 'unread'

export default function SellerInbox() {
  const { setCurrentPage, setSelectedPropertyId } = useApp()
  const [comms, setComms] = useState<Communication[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<InboxFilter>('all')
  const [search, setSearch] = useState('')
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null)
  const [selectedComm, setSelectedComm] = useState<Communication | null>(null)
  const [smsText, setSmsText] = useState('')
  const [sending, setSending] = useState(false)
  const [sendErr, setSendErr] = useState<string | null>(null)
  const [sendOk, setSendOk] = useState(false)
  const [calling, setCalling] = useState(false)
  const [callMsg, setCallMsg] = useState<string | null>(null)
  const threadEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => { load() }, [])

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [selectedPhone, comms])

  async function load() {
    setLoading(true); setError(null)
    try {
      setComms(await listCommunications({ limit: 500 }))
    } catch {
      setError('Failed to load communications.')
    } finally { setLoading(false) }
  }

  const allThreads = buildThreads(comms)

  const filteredThreads = allThreads.filter(t => {
    const q = search.toLowerCase()
    if (q && !t.name.toLowerCase().includes(q) && !t.phone.includes(q)) return false
    if (filter === 'calls') return t.comms.some(c => c.type.startsWith('call'))
    if (filter === 'texts') return t.comms.some(c => c.type.startsWith('sms'))
    if (filter === 'hot') return t.leadScore === 'hot'
    if (filter === 'callback') return t.disposition === 'CALLBACK_NEEDED'
    if (filter === 'unread') return false
    return true
  })

  const selected = selectedPhone ? allThreads.find(t => t.phone === selectedPhone) ?? null : null
  const threadComms = selected ? [...selected.comms].reverse() : []

  const FILTERS: { id: InboxFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'calls', label: 'Calls' },
    { id: 'texts', label: 'Texts' },
    { id: 'hot', label: '🔥 HOT' },
    { id: 'callback', label: '📅 Callback' },
    { id: 'unread', label: 'Unread' },
  ]

  async function handleSend() {
    if (!smsText.trim() || !selected) return
    setSending(true); setSendErr(null); setSendOk(false)
    try {
      await sendSms(selected.phone, smsText.trim(), selected.propertyId ?? undefined)
      setSmsText(''); setSendOk(true)
      setTimeout(() => setSendOk(false), 2000)
      await load()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setSendErr(detail ?? 'Failed to send SMS.')
    } finally { setSending(false) }
  }

  async function handleCall(thread: Thread) {
    setCalling(true); setCallMsg(null)
    try {
      await initiateOutboundCall(thread.phone, thread.propertyId ?? undefined)
      setCallMsg('✓ Call initiated')
      setTimeout(() => setCallMsg(null), 4000)
      await load()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setCallMsg(detail ? `✗ ${detail}` : '✗ Call failed')
      setTimeout(() => setCallMsg(null), 6000)
    } finally { setCalling(false) }
  }

  function openProperty(thread: Thread) {
    if (!thread.propertyId) return
    setSelectedPropertyId(thread.propertyId)
    setCurrentPage('crm-properties')
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#F8F6FB', overflow: 'hidden' }}>

      {/* ── Left sidebar: conversation list ── */}
      <div style={{ width: 320, borderRight: '1px solid #EDE8F5', display: 'flex', flexDirection: 'column', background: '#fff', flexShrink: 0 }}>

        {/* Header */}
        <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid #EDE8F5' }}>
          <div className="flex items-center justify-between mb-3">
            <h1 style={{ fontSize: 18, fontWeight: 700, color: '#1A0A2E' }}>Seller Inbox</h1>
            <button onClick={load} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9B8AAE', fontSize: 13 }}>↻</button>
          </div>
          <div style={{ position: 'relative' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9B8AAE" strokeWidth="2"
              style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              type="text"
              placeholder="Search by name or phone…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: '100%', boxSizing: 'border-box', paddingLeft: 32, paddingRight: 10, paddingTop: 7, paddingBottom: 7, borderRadius: 10, border: '1px solid #EDE8F5', fontSize: 13, outline: 'none', color: '#1A0A2E', background: '#F8F6FB' }}
            />
          </div>
        </div>

        {/* Filter tabs */}
        <div style={{ display: 'flex', gap: 4, padding: '8px 12px', borderBottom: '1px solid #EDE8F5', flexWrap: 'wrap' }}>
          {FILTERS.map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)}
              style={{
                padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                background: filter === f.id ? '#5C2977' : 'transparent',
                color: filter === f.id ? '#fff' : '#6B5B8A',
                border: filter === f.id ? '1px solid #5C2977' : '1px solid transparent',
              }}>
              {f.label}
            </button>
          ))}
        </div>

        {/* Thread list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ padding: 24, textAlign: 'center', color: '#9B8AAE', fontSize: 13 }}>Loading…</div>
          ) : error ? (
            <div style={{ padding: 16, fontSize: 12, color: '#B71C1C' }}>{error}</div>
          ) : filteredThreads.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: '#9B8AAE', fontSize: 13 }}>No conversations</div>
          ) : filteredThreads.map(t => {
            const isSelected = selectedPhone === t.phone
            const initials = getInitials(t.name)
            const preview = messagePreview(t.lastComm)
            const scoreColors: Record<string, string> = { hot: '#E65100', warm: '#F59E0B', cold: '#78909C' }
            const avatarBg = t.leadScore ? scoreColors[t.leadScore] || '#5C2977' : '#5C2977'

            return (
              <div key={t.phone}
                onClick={() => { setSelectedPhone(t.phone); setSendErr(null); setSendOk(false) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
                  cursor: 'pointer', borderBottom: '1px solid #F0EBF8',
                  background: isSelected ? '#F0EBF8' : 'transparent',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = '#F8F5FC' }}
                onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
              >
                <div style={{
                  width: 44, height: 44, borderRadius: '50%', background: avatarBg,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontWeight: 700, fontSize: 15, flexShrink: 0,
                }}>
                  {initials}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="flex items-center justify-between">
                    <span style={{ fontWeight: 700, fontSize: 14, color: '#1A0A2E', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>
                      {t.name}
                    </span>
                    <span style={{ fontSize: 11, color: '#9B8AAE', flexShrink: 0, marginLeft: 4 }}>
                      {fmtInboxDate(t.lastComm.created_at)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 mt-1">
                    {t.disposition && <DispositionBadge disposition={t.disposition} />}
                    {!t.disposition && (
                      <p style={{ fontSize: 12, color: '#9B8AAE', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {preview}
                      </p>
                    )}
                    {t.disposition && (
                      <p style={{ fontSize: 11, color: '#9B8AAE', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                        {preview}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Center: conversation thread ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {!selected ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#C4B5D8' }}>
            <div style={{ textAlign: 'center' }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" style={{ marginBottom: 12, opacity: 0.4 }}>
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
              <p style={{ fontSize: 14 }}>Select a conversation</p>
            </div>
          </div>
        ) : (
          <>
            {/* Thread header */}
            <div style={{ padding: '12px 20px', borderBottom: '1px solid #EDE8F5', background: '#fff', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ width: 38, height: 38, borderRadius: '50%', background: '#5C2977', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 14, flexShrink: 0 }}>
                {getInitials(selected.name)}
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontWeight: 700, fontSize: 15, color: '#1A0A2E', margin: 0 }}>{selected.name}</p>
                <p style={{ fontSize: 12, color: '#9B8AAE', margin: 0 }}>{fmtPhone(selected.phone)}</p>
              </div>
              {callMsg && (
                <span style={{
                  fontSize: 12, fontWeight: 600,
                  color: callMsg.startsWith('✓') ? '#2D7A4F' : '#B71C1C',
                  maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis',
                }}>{callMsg}</span>
              )}
              <button
                onClick={() => handleCall(selected)}
                disabled={calling}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 10, border: '1px solid #EDE8F5', background: calling ? '#EDE8F5' : '#fff', color: '#5C2977', fontWeight: 600, fontSize: 13, cursor: calling ? 'default' : 'pointer' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.63 3.38 2 2 0 0 1 3.6 1.21h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.9a16 16 0 0 0 6 6l1.06-1.06a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
                </svg>
                {calling ? 'Calling…' : 'Call'}
              </button>
              {selected.propertyId && (
                <button
                  onClick={() => openProperty(selected)}
                  style={{ padding: '7px 14px', borderRadius: 10, border: '1px solid #EDE8F5', background: '#fff', color: '#6B5B8A', fontSize: 13, cursor: 'pointer' }}>
                  View Property →
                </button>
              )}
            </div>

            {/* Messages */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
              {threadComms.map(c => (
                <MessageEntry key={c.id} c={c} onSelect={setSelectedComm} />
              ))}
              <div ref={threadEndRef} />
            </div>

            {/* Quick templates */}
            <div style={{ padding: '8px 24px 0', background: '#F8F6FB', borderTop: '1px solid #EDE8F5' }}>
              <div className="flex gap-2 flex-wrap">
                {TEMPLATES(selected.ownerFirstName, selected.propertyAddress, selected.offerPrice).map(tpl => (
                  <button key={tpl.label}
                    onClick={() => setSmsText(tpl.text)}
                    style={{ fontSize: 11, padding: '4px 10px', borderRadius: 14, border: '1px solid #EDE8F5', background: '#fff', color: '#5C2977', cursor: 'pointer', fontWeight: 500 }}>
                    {tpl.label}
                  </button>
                ))}
              </div>
            </div>

            {/* SMS composer */}
            <div style={{ padding: '10px 24px 16px', background: '#F8F6FB' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
                <textarea
                  value={smsText}
                  onChange={e => setSmsText(e.target.value)}
                  placeholder="Type a message…"
                  rows={2}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
                  style={{ flex: 1, borderRadius: 16, border: '1px solid #EDE8F5', padding: '10px 14px', fontSize: 14, resize: 'none', outline: 'none', background: '#fff', color: '#1A0A2E' }}
                />
                <button
                  onClick={handleSend}
                  disabled={sending || !smsText.trim()}
                  style={{
                    padding: '10px 18px', borderRadius: 16, border: 'none',
                    background: !smsText.trim() ? '#EDE8F5' : '#5C2977',
                    color: !smsText.trim() ? '#9B8AAE' : '#fff',
                    fontWeight: 700, fontSize: 14, cursor: sending || !smsText.trim() ? 'default' : 'pointer', flexShrink: 0,
                  }}>
                  {sendOk ? '✓' : sending ? '…' : '→'}
                </button>
              </div>
              {!selected.propertyId && (
                <p style={{ fontSize: 11, color: '#9B8AAE', marginTop: 4 }}>No property linked — message will be sent without template data</p>
              )}
              {sendErr && <p style={{ fontSize: 12, color: '#B71C1C', marginTop: 6 }}>{sendErr}</p>}
            </div>
          </>
        )}
      </div>

      {/* ── Right: contact info panel ── */}
      {selected && (
        <div style={{ width: 240, borderLeft: '1px solid #EDE8F5', background: '#fff', overflowY: 'auto', flexShrink: 0, padding: 20 }}>
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#5C2977', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 20, margin: '0 auto 8px' }}>
              {getInitials(selected.name)}
            </div>
            <p style={{ fontWeight: 700, fontSize: 15, color: '#1A0A2E', margin: 0 }}>{selected.name}</p>
            <div className="flex gap-1 flex-wrap justify-center mt-1">
              {selected.leadScore && (
                <span style={{
                  display: 'inline-block', padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700,
                  background: selected.leadScore === 'hot' ? '#FFF3E0' : selected.leadScore === 'warm' ? '#FFF9E6' : '#F5F5F5',
                  color: selected.leadScore === 'hot' ? '#E65100' : selected.leadScore === 'warm' ? '#F59E0B' : '#78909C',
                }}>{selected.leadScore.toUpperCase()}</span>
              )}
              {selected.disposition && <DispositionBadge disposition={selected.disposition} />}
            </div>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid #EDE8F5', margin: '0 0 16px' }} />

          <div style={{ marginBottom: 14 }}>
            <p style={{ fontSize: 10, fontWeight: 700, color: '#9B8AAE', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Phone</p>
            <div className="flex items-center gap-2">
              <span style={{ fontSize: 14, color: '#1A0A2E' }}>{fmtPhone(selected.phone)}</span>
              <button onClick={() => handleCall(selected)} title="Call"
                style={{ padding: '4px 8px', borderRadius: 8, border: '1px solid #EDE8F5', background: '#F8F5FC', color: '#5C2977', cursor: 'pointer', fontSize: 12 }}>
                📞
              </button>
            </div>
          </div>

          {selected.propertyId && (
            <div style={{ marginBottom: 14 }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: '#9B8AAE', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Linked Property</p>
              <button onClick={() => openProperty(selected)}
                style={{ fontSize: 12, color: '#5C2977', fontWeight: 600, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>
                View property →
              </button>
            </div>
          )}

          {selected.offerPrice != null && (
            <div style={{ marginBottom: 14 }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: '#9B8AAE', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Offer Price</p>
              <p style={{ fontSize: 16, fontWeight: 700, color: '#2D7A4F', margin: 0 }}>
                ${selected.offerPrice.toLocaleString()}
              </p>
            </div>
          )}

          <hr style={{ border: 'none', borderTop: '1px solid #EDE8F5', margin: '0 0 16px' }} />

          <div style={{ marginBottom: 12 }}>
            <p style={{ fontSize: 10, fontWeight: 700, color: '#9B8AAE', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Activity</p>
            {[
              { label: 'Calls', count: selected.comms.filter(c => c.type.startsWith('call')).length },
              { label: 'Texts', count: selected.comms.filter(c => c.type.startsWith('sms')).length },
            ].map(({ label, count }) => (
              <div key={label} className="flex justify-between" style={{ marginBottom: 4 }}>
                <span style={{ fontSize: 12, color: '#6B5B8A' }}>{label}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#1A0A2E' }}>{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Communication detail modal ── */}
      {selectedComm && (
        <CommDetailModal comm={selectedComm} onClose={() => setSelectedComm(null)} />
      )}
    </div>
  )
}
