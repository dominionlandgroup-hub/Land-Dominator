import React, { useEffect, useRef, useState } from 'react'
import { listCommunications, sendSms, initiateOutboundCall, markThreadRead, markAllRead, patchThreadRead, getCallbackNumber, listCrmCampaigns, updateProperty, listDeals } from '../api/crm'
import type { Communication, CRMCampaign, CRMDeal } from '../types/crm'
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
  hasUnread: boolean
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
    const scores = sorted.map(c => c.lead_score?.toLowerCase()).filter(Boolean)
    const topScore = scores.includes('hot') ? 'hot' : scores.includes('warm') ? 'warm' : (scores[0] || null)
    const dispositions = sorted.map(c => c.disposition).filter(Boolean)
    const dispPriority = ['INTERESTED', 'CALLBACK_NEEDED', 'MAYBE', 'NOT_INTERESTED', 'WRONG_NUMBER', 'NO_ANSWER']
    const topDisp = dispPriority.find(d => dispositions.includes(d)) || null
    const hasUnread = sorted.some(c => c.is_read === false && c.direction === 'inbound')
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
      hasUnread,
    })
  }
  // Sort: unread first, then by most recent activity
  return threads.sort((a, b) => {
    if (a.hasUnread !== b.hasUnread) return a.hasUnread ? -1 : 1
    return new Date(b.lastComm.created_at).getTime() - new Date(a.lastComm.created_at).getTime()
  })
}

// ── Disposition badge ─────────────────────────────────────────────────────────

const DISP_CONFIG: Record<string, { label: string; bg: string; color: string; border?: string }> = {
  INTERESTED:       { label: 'Interested', bg: '#D1FAE5', color: '#059669' },
  CALLBACK_NEEDED:  { label: 'Callback', bg: '#FEF3C7', color: '#D97706' },
  MAYBE:            { label: 'Maybe', bg: '#FEF3C7', color: '#D97706' },
  NOT_INTERESTED:   { label: 'Not Interested', bg: '#FEE2E2', color: '#DC2626' },
  WRONG_NUMBER:     { label: 'Wrong #', bg: '#F3F4F6', color: '#6B5B8A' },
  NO_ANSWER:        { label: 'No Answer', bg: '#F3F4F6', color: '#6B5B8A', border: '1px solid #E8E0F0' },
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
      style={{ position: 'fixed', inset: 0, background: 'rgba(26,10,46,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={onClose}
    >
      <div
        style={{ background: '#FFFFFF', borderRadius: 8, padding: 24, width: '100%', maxWidth: 560, maxHeight: '82vh', overflowY: 'auto', border: '1px solid #E8E0F0' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1A0A2E', margin: 0 }}>
              {isCall
                ? (isInbound ? '↙ Inbound Call' : '↗ Outbound Call')
                : (isInbound ? '← Inbound SMS' : '→ Outbound SMS')}
            </h2>
            <p style={{ fontSize: 12, color: '#6B5B8A', margin: '3px 0 0' }}>{fmtMsgTime(comm.created_at)}</p>
          </div>
          <button onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: '#6B5B8A', lineHeight: 1, padding: '0 4px' }}>×</button>
        </div>

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
                background: comm.lead_score === 'hot' ? '#FFF3E0' : comm.lead_score === 'warm' ? '#FFF9E6' : '#F7F3FC',
                color: comm.lead_score === 'hot' ? '#E65100' : comm.lead_score === 'warm' ? '#D97706' : '#6B5B8A',
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

        {comm.recording_url ? (
          <div style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: '#9B8AAE', textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>
                🎙 Recording{comm.duration_seconds ? ` · ${Math.floor(comm.duration_seconds / 60)}m ${comm.duration_seconds % 60}s` : ''}
              </p>
              <a
                href={comm.recording_url}
                download
                onClick={e => e.stopPropagation()}
                style={{ fontSize: 11, color: '#4F46E5', textDecoration: 'none', fontWeight: 600, padding: '2px 8px', border: '1px solid rgba(79,70,229,0.3)', borderRadius: 4 }}
              >
                ↓ Download
              </a>
            </div>
            <audio controls src={comm.recording_url} style={{ width: '100%', height: 36 }} />
          </div>
        ) : comm.type?.startsWith('call') && (
          <div style={{ marginBottom: 18 }}>
            <p style={{ fontSize: 10, fontWeight: 700, color: '#9B8AAE', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 4px' }}>Recording</p>
            <p style={{ fontSize: 12, color: '#9B8AAE', margin: 0, fontStyle: 'italic' }}>No recording available</p>
          </div>
        )}

        {isCall && (
          <div style={{ marginBottom: 18 }}>
            <p style={{ fontSize: 10, fontWeight: 700, color: '#9B8AAE', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 6px' }}>Summary</p>
            <p style={{ fontSize: 13, color: '#1A0A2E', margin: 0, lineHeight: 1.6, background: '#F7F3FC', borderRadius: 8, padding: '10px 14px' }}>
              {comm.summary || 'Call completed — no summary generated'}
            </p>
          </div>
        )}

        {comm.transcript && (
          <div style={{ marginBottom: 18 }}>
            <p style={{ fontSize: 10, fontWeight: 700, color: '#9B8AAE', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 6px' }}>Transcript</p>
            <pre style={{
              fontSize: 12, color: '#6B5B8A', margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit',
              lineHeight: 1.6, background: '#F7F3FC', borderRadius: 8, padding: '10px 14px',
              maxHeight: 280, overflowY: 'auto',
            }}>{comm.transcript}</pre>
          </div>
        )}

        {!isCall && comm.message_body && (
          <div>
            <p style={{ fontSize: 10, fontWeight: 700, color: '#9B8AAE', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 6px' }}>Message</p>
            <p style={{ fontSize: 14, color: '#1A0A2E', margin: 0, background: '#F7F3FC', borderRadius: 8, padding: '10px 14px', lineHeight: 1.5 }}>
              {comm.message_body}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Call confirm modal ────────────────────────────────────────────────────────

function CallConfirmModal({
  thread,
  callbackNumber,
  onConfirm,
  onClose,
  calling,
}: {
  thread: Thread
  callbackNumber: string
  onConfirm: () => void
  onClose: () => void
  calling: boolean
}) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(26,10,46,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={onClose}
    >
      <div
        style={{ background: '#FFFFFF', borderRadius: 8, padding: 28, width: '100%', maxWidth: 420, border: '1px solid #E8E0F0' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#5C2977', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.63 3.38 2 2 0 0 1 3.6 1.21h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.9a16 16 0 0 0 6 6l1.06-1.06a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
            </svg>
          </div>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1A0A2E', margin: 0 }}>Call {thread.name}</h2>
            <p style={{ fontSize: 12, color: '#6B5B8A', margin: 0 }}>{fmtPhone(thread.phone)}</p>
          </div>
        </div>

        <p style={{ fontSize: 13, color: '#6B5B8A', margin: '0 0 12px', lineHeight: 1.7 }}>
          We will call you at{' '}
          <strong style={{ color: '#1A0A2E' }}>{callbackNumber || 'your configured number'}</strong>{' '}
          first, then connect you to{' '}
          <strong style={{ color: '#1A0A2E' }}>{thread.name}</strong>.
        </p>

        <div style={{ background: '#FEF3C7', border: '1px solid rgba(217,119,6,0.3)', borderRadius: 8, padding: '10px 14px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16 }}>⚠️</span>
          <p style={{ fontSize: 12, color: '#D97706', margin: 0, fontWeight: 600 }}>Make sure to answer within 30 seconds</p>
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{ padding: '9px 18px', borderRadius: 8, border: '1px solid #E8E0F0', background: '#F7F3FC', color: '#6B5B8A', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={calling}
            style={{ padding: '9px 22px', borderRadius: 8, border: 'none', background: calling ? '#9B8AAE' : '#5C2977', color: '#fff', fontWeight: 700, fontSize: 14, cursor: calling ? 'default' : 'pointer' }}>
            {calling ? 'Calling…' : 'Call Now'}
          </button>
        </div>
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
          background: isOutbound ? '#5C2977' : '#F3EEF9',
          color: isOutbound ? '#FFFFFF' : '#1A0A2E',
          borderRadius: isOutbound ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
          padding: '10px 14px', fontSize: 14,
        }}>
          <p style={{ margin: 0, lineHeight: 1.4 }}>{c.message_body || '—'}</p>
          <p style={{ margin: '4px 0 0', fontSize: 10, opacity: 0.6, textAlign: isOutbound ? 'right' : 'left' }}>
            {fmtMsgTime(c.created_at)}
          </p>
        </div>
      </div>
    )
  }

  const isMissed = !isOutbound && (
    (c.summary?.includes('Missed call') ?? false) ||
    (c.summary === 'Call in progress...' && (c.duration_seconds ?? 0) < 5)
  )
  const isInProgress = c.summary === 'Call in progress...'
  const icon = isMissed ? '✗' : isOutbound ? '↗' : '↙'
  const label = isMissed ? 'Missed call' : isOutbound ? 'Outbound call' : isInProgress ? 'Call in progress…' : 'Inbound call'
  const bg = isMissed ? '#FFF1F2' : isOutbound ? 'rgba(92,41,119,0.08)' : '#F3EEF9'
  const col = isMissed ? '#DC2626' : '#5C2977'
  const borderCol = isMissed ? '#FECDD3' : '#E8E0F0'

  return (
    <div className="flex justify-center mb-3" style={{ cursor: 'pointer' }} onClick={() => onSelect(c)} title="Click to view call details">
      <div style={{
        background: bg, border: `1px solid ${borderCol}`, borderRadius: 8, padding: '10px 16px', maxWidth: '85%', width: '100%',
        transition: 'border-color 0.1s',
      }}
        onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = isMissed ? '#FCA5A5' : '#D4C5E8' }}
        onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = borderCol }}
      >
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span style={{ color: col, fontWeight: 700, fontSize: 13 }}>{icon} {label}</span>
          {c.duration_seconds != null && c.duration_seconds > 0 && (
            <span style={{ color: '#6B5B8A', fontSize: 11 }}>{fmtTalk(c.duration_seconds)}</span>
          )}
          {c.disposition && <DispositionBadge disposition={c.disposition} />}
          <span style={{ color: '#9B8AAE', fontSize: 11, marginLeft: 'auto' }}>{fmtMsgTime(c.created_at)}</span>
        </div>
        {c.recording_url
          ? <span style={{ fontSize: 11, color: '#059669', fontWeight: 600 }}>▶ Recording available</span>
          : !isInProgress && !isMissed && c.type?.startsWith('call') && (
            <span style={{ fontSize: 11, color: '#9B8AAE', fontStyle: 'italic' }}>Recording processing…</span>
          )
        }
        {c.summary && c.summary !== 'Call in progress...'
          ? <p style={{ color: '#6B5B8A', fontSize: 12, margin: '4px 0 0', lineHeight: 1.4 }}>{c.summary}</p>
          : isInProgress
            ? <p style={{ color: '#D97706', fontSize: 12, margin: '4px 0 0', fontStyle: 'italic' }}>Active call — details will appear when call ends</p>
            : !isMissed && <p style={{ color: '#9B8AAE', fontSize: 11, margin: '4px 0 0', fontStyle: 'italic' }}>Call completed — no summary generated</p>
        }
        {!isMissed && !isInProgress && (
          <p style={{ color: '#9B8AAE', fontSize: 10, margin: '4px 0 0' }}>Click to view full transcript →</p>
        )}
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

// ── Create Deal modal ─────────────────────────────────────────────────────────

function CreateDealModal({
  thread,
  onClose,
  onSuccess,
}: {
  thread: Thread
  onClose: () => void
  onSuccess: () => void
}) {
  const prop = thread.comms.find(c => c.property)?.property
  const ownerName = thread.name !== thread.phone ? thread.name : (prop?.owner_full_name || '')
  const apn = prop?.apn || ''
  const county = prop?.county || ''
  const defaultName = [ownerName, apn, county].filter(Boolean).join(' - ')

  const [dealName, setDealName] = useState(defaultName)
  const [fee, setFee] = useState('5000')
  const [campaigns, setCampaigns] = useState<CRMCampaign[]>([])
  const [campaignId, setCampaignId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    listCrmCampaigns().then(list => {
      setCampaigns(list)
      if (list.length > 0) setCampaignId(list[0].id)
    }).catch(() => {})
  }, [])

  async function handleConfirm() {
    if (!prop?.id) { setError('No property linked to this conversation.'); return }
    setLoading(true); setError(null)
    try {
      await updateProperty(prop.id, {
        status: 'prospect',
        assignment_fee: parseFloat(fee) || 5000,
        ...(campaignId ? { campaign_id: campaignId } : {}),
      })
      setSuccess(true)
      setTimeout(() => { onSuccess(); onClose() }, 1800)
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail ?? 'Failed to create deal.')
    } finally { setLoading(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(26,10,46,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={onClose}>
      <div style={{ background: '#FFFFFF', borderRadius: 12, padding: 28, maxWidth: 460, width: '100%', border: '1px solid #E8E0F0' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1A0A2E', margin: 0 }}>Create Deal</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: '#6B5B8A', lineHeight: 1 }}>×</button>
        </div>

        {success ? (
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <p style={{ fontSize: 20, marginBottom: 8 }}>✅</p>
            <p style={{ fontWeight: 700, color: '#059669', fontSize: 14 }}>Deal created and added to Seller Deals</p>
          </div>
        ) : (
          <>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#9B8AAE', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 4 }}>Deal Name</label>
              <input
                type="text"
                value={dealName}
                onChange={e => setDealName(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: 8, border: '1px solid #E8E0F0', fontSize: 14, color: '#1A0A2E', outline: 'none', background: '#F7F3FC' }}
              />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#9B8AAE', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 4 }}>Campaign</label>
              <select
                value={campaignId}
                onChange={e => setCampaignId(e.target.value)}
                style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #E8E0F0', fontSize: 14, color: '#1A0A2E', background: '#F7F3FC', outline: 'none' }}
              >
                <option value="">— No campaign —</option>
                {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#9B8AAE', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 4 }}>Est. Assignment Fee</label>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#6B5B8A', fontSize: 14 }}>$</span>
                <input
                  type="number"
                  min="0"
                  step="500"
                  value={fee}
                  onChange={e => setFee(e.target.value)}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px 9px 22px', borderRadius: 8, border: '1px solid #E8E0F0', fontSize: 14, color: '#1A0A2E', outline: 'none', background: '#F7F3FC' }}
                />
              </div>
            </div>

            <div style={{ marginBottom: 20, padding: '10px 14px', borderRadius: 8, background: '#F7F3FC', border: '1px solid #E8E0F0' }}>
              <p style={{ fontSize: 12, color: '#6B5B8A', margin: 0 }}>
                Status: <strong style={{ color: '#5C2977' }}>New Lead</strong> — will appear on Seller Deals board
              </p>
              {!prop?.id && (
                <p style={{ fontSize: 11, color: '#D97706', margin: '4px 0 0' }}>⚠️ No property linked — open the conversation to link a property first</p>
              )}
            </div>

            {error && <p style={{ fontSize: 12, color: '#DC2626', marginBottom: 12 }}>{error}</p>}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={onClose} disabled={loading}
                style={{ padding: '9px 18px', borderRadius: 8, border: '1px solid #E8E0F0', background: '#F7F3FC', color: '#6B5B8A', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={handleConfirm} disabled={loading || !prop?.id}
                style={{ padding: '9px 22px', borderRadius: 8, border: 'none', background: loading || !prop?.id ? '#9B8AAE' : '#5C2977', color: '#fff', fontWeight: 700, fontSize: 14, cursor: loading || !prop?.id ? 'default' : 'pointer' }}>
                {loading ? 'Creating…' : 'Add to Seller Deals'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

type InboxFilter = 'all' | 'calls' | 'texts' | 'hot' | 'callback' | 'unread'

export default function SellerInbox() {
  const { setCurrentPage, setSelectedPropertyId, unreadCount, setUnreadCount } = useApp()
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
  const [markingAll, setMarkingAll] = useState(false)
  const [callConfirmThread, setCallConfirmThread] = useState<Thread | null>(null)
  const [callbackNumber, setCallbackNumber] = useState('')
  const [createDealThread, setCreateDealThread] = useState<Thread | null>(null)
  const [selectedDeal, setSelectedDeal] = useState<CRMDeal | null>(null)
  const threadEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => { load() }, [])
  useEffect(() => {
    getCallbackNumber().then(r => setCallbackNumber(r.formatted)).catch(() => {})
  }, [])

  // Load deal for selected thread's property
  useEffect(() => {
    setSelectedDeal(null)
    if (!selectedPhone) return
    const propComms = comms.filter(c => c.phone_number === selectedPhone)
    const propId = propComms.find(c => c.property?.id)?.property?.id
    if (!propId) return
    listDeals().then(all => {
      const match = all.find(d => d.property_id === propId)
      setSelectedDeal(match ?? null)
    }).catch(() => {})
  }, [selectedPhone, comms])

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
  const totalUnread = allThreads.filter(t => t.hasUnread).length

  const filteredThreads = allThreads.filter(t => {
    const q = search.toLowerCase()
    if (q && !t.name.toLowerCase().includes(q) && !t.phone.includes(q)) return false
    if (filter === 'calls') return t.comms.some(c => c.type.startsWith('call'))
    if (filter === 'texts') return t.comms.some(c => c.type.startsWith('sms'))
    if (filter === 'hot') return t.leadScore === 'hot'
    if (filter === 'callback') return t.disposition === 'CALLBACK_NEEDED'
    if (filter === 'unread') return t.hasUnread
    return true
  })

  const selected = selectedPhone ? allThreads.find(t => t.phone === selectedPhone) ?? null : null
  const threadComms = selected ? [...selected.comms].reverse() : []

  function selectThread(phone: string) {
    setSelectedPhone(phone)
    setSendErr(null)
    setSendOk(false)
    // Auto-mark as read
    const thread = allThreads.find(t => t.phone === phone)
    if (thread?.hasUnread) {
      markThreadRead([phone]).catch(() => {})
      // Optimistic update: mark all comms from this phone as read
      setComms(prev => prev.map(c =>
        c.phone_number === phone ? { ...c, is_read: true } : c
      ))
      // Update global badge
      setUnreadCount(Math.max(0, unreadCount - 1))
    }
  }

  async function handleMarkAllRead() {
    setMarkingAll(true)
    try {
      await markAllRead()
      setComms(prev => prev.map(c => ({ ...c, is_read: true })))
      setUnreadCount(0)
    } catch {
      // silent
    } finally { setMarkingAll(false) }
  }

  async function handleToggleRead(phone: string, hasUnread: boolean, e: React.MouseEvent) {
    e.stopPropagation()
    const newRead = hasUnread  // unread → mark as read; read → mark as unread
    try {
      await patchThreadRead(phone, newRead)
      setComms(prev => prev.map(c =>
        c.phone_number === phone ? { ...c, is_read: newRead } : c
      ))
      setUnreadCount(newRead ? Math.max(0, unreadCount - 1) : unreadCount + 1)
    } catch {
      // silent
    }
  }

  const FILTERS: { id: InboxFilter; label: string; count?: number }[] = [
    { id: 'all', label: 'All' },
    { id: 'calls', label: 'Calls' },
    { id: 'texts', label: 'Texts' },
    { id: 'hot', label: '🔥 HOT' },
    { id: 'callback', label: '📅 Callback' },
    { id: 'unread', label: 'Unread', count: totalUnread },
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
    setCallConfirmThread(null)
    setCalling(true); setCallMsg(null)
    try {
      await initiateOutboundCall(thread.phone, thread.propertyId ?? undefined, thread.name)
      setCallMsg('✓ Calling you now — answer your phone to connect to ' + thread.name)
      setTimeout(() => setCallMsg(null), 6000)
      await load()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setCallMsg(detail ? `✗ ${detail}` : '✗ Call failed')
      setTimeout(() => setCallMsg(null), 8000)
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
      <div style={{ width: 320, borderRight: '1px solid #E8E0F0', display: 'flex', flexDirection: 'column', background: '#FFFFFF', flexShrink: 0 }}>

        {/* Header */}
        <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid #E8E0F0' }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h1 style={{ fontSize: 18, fontWeight: 700, color: '#1A0A2E' }}>Seller Inbox</h1>
              {totalUnread > 0 && (
                <span style={{ background: '#DC2626', color: '#fff', borderRadius: 10, padding: '1px 7px', fontSize: 11, fontWeight: 700 }}>
                  {totalUnread}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {totalUnread > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  disabled={markingAll}
                  style={{ fontSize: 11, color: '#5C2977', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, padding: '2px 6px', borderRadius: 6, opacity: markingAll ? 0.5 : 1 }}>
                  {markingAll ? '…' : 'Mark all read'}
                </button>
              )}
              <button onClick={load} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9B8AAE', fontSize: 13 }}>↻</button>
            </div>
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
              style={{ width: '100%', boxSizing: 'border-box', paddingLeft: 32, paddingRight: 10, paddingTop: 7, paddingBottom: 7, borderRadius: 8, border: '1px solid #E8E0F0', fontSize: 13, outline: 'none', color: '#1A0A2E', background: '#F7F3FC' }}
            />
          </div>
        </div>

        {/* Filter tabs */}
        <div style={{ display: 'flex', gap: 4, padding: '8px 12px', borderBottom: '1px solid #E8E0F0', flexWrap: 'wrap' }}>
          {FILTERS.map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)}
              style={{
                padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                background: filter === f.id ? '#5C2977' : 'transparent',
                color: filter === f.id ? '#fff' : '#6B5B8A',
                border: filter === f.id ? '1px solid #5C2977' : '1px solid transparent',
                display: 'flex', alignItems: 'center', gap: 4,
              }}>
              {f.label}
              {f.count != null && f.count > 0 && (
                <span style={{
                  background: filter === f.id ? 'rgba(255,255,255,0.3)' : '#DC2626',
                  color: '#fff', borderRadius: 8, padding: '0 5px', fontSize: 9, fontWeight: 700,
                }}>{f.count}</span>
              )}
            </button>
          ))}
        </div>

        {/* Thread list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ padding: 24, textAlign: 'center', color: '#9B8AAE', fontSize: 13 }}>Loading…</div>
          ) : error ? (
            <div style={{ padding: 16, fontSize: 12, color: '#DC2626' }}>{error}</div>
          ) : filteredThreads.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: '#9B8AAE', fontSize: 13 }}>No conversations</div>
          ) : filteredThreads.map(t => {
            const isSelected = selectedPhone === t.phone
            const initials = getInitials(t.name)
            const preview = messagePreview(t.lastComm)
            const scoreColors: Record<string, string> = { hot: '#E65100', warm: '#D97706', cold: '#9B8AAE' }
            const avatarBg = t.leadScore ? scoreColors[t.leadScore] || '#5C2977' : '#5C2977'

            return (
              <div key={t.phone}
                onClick={() => selectThread(t.phone)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px',
                  cursor: 'pointer', borderBottom: '1px solid #E8E0F0',
                  background: isSelected ? '#F3EEF9' : t.hasUnread ? '#FAF7FD' : 'transparent',
                  borderLeft: isSelected ? '3px solid #5C2977' : '3px solid transparent',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = '#F3EEF9' }}
                onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = t.hasUnread ? '#FAF7FD' : 'transparent' }}
              >
                {/* Unread dot — click to toggle read/unread */}
                <div
                  style={{ width: 16, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                  onClick={e => handleToggleRead(t.phone, t.hasUnread, e)}
                  title={t.hasUnread ? 'Mark as read' : 'Mark as unread'}
                >
                  {t.hasUnread ? (
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#DC2626', display: 'block' }} />
                  ) : (
                    <span style={{ width: 8, height: 8, borderRadius: '50%', border: '1.5px solid #D4C5E8', display: 'block' }} />
                  )}
                </div>

                {/* Avatar */}
                <div style={{
                  width: 42, height: 42, borderRadius: '50%', background: avatarBg,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontWeight: 700, fontSize: 14, flexShrink: 0,
                }}>
                  {initials}
                </div>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="flex items-center justify-between">
                    <span style={{ fontWeight: t.hasUnread ? 800 : 600, fontSize: 14, color: '#1A0A2E', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 110 }}>
                      {t.name}
                    </span>
                    <span style={{ fontSize: 11, color: t.hasUnread ? '#5C2977' : '#9B8AAE', flexShrink: 0, marginLeft: 4, fontWeight: t.hasUnread ? 700 : 400 }}>
                      {fmtInboxDate(t.lastComm.created_at)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 mt-1">
                    {t.disposition && <DispositionBadge disposition={t.disposition} />}
                    <p style={{ fontSize: 12, color: t.hasUnread ? '#5C2977' : '#9B8AAE', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, fontWeight: t.hasUnread ? 600 : 400 }}>
                      {preview}
                    </p>
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
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#D4C5E8' }}>
            <div style={{ textAlign: 'center' }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" style={{ marginBottom: 12, opacity: 0.4 }}>
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
              <p style={{ fontSize: 14, color: '#9B8AAE' }}>Select a conversation</p>
              {totalUnread > 0 && (
                <p style={{ fontSize: 12, color: '#5C2977', marginTop: 8 }}>
                  {totalUnread} unread {totalUnread === 1 ? 'conversation' : 'conversations'}
                </p>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* Thread header */}
            <div style={{ padding: '12px 20px', borderBottom: '1px solid #E8E0F0', background: '#FFFFFF', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ width: 38, height: 38, borderRadius: '50%', background: '#5C2977', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 14, flexShrink: 0 }}>
                {getInitials(selected.name)}
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontWeight: 700, fontSize: 15, color: '#1A0A2E', margin: 0 }}>{selected.name}</p>
                <p style={{ fontSize: 12, color: '#6B5B8A', margin: 0 }}>{fmtPhone(selected.phone)}</p>
              </div>
              {callMsg && (
                <span style={{ fontSize: 12, fontWeight: 600, color: callMsg.startsWith('✓') ? '#059669' : '#DC2626', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {callMsg}
                </span>
              )}
              <button
                onClick={() => setCallConfirmThread(selected)}
                disabled={calling}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, border: '1px solid #E8E0F0', background: calling ? '#F7F3FC' : '#FFFFFF', color: '#5C2977', fontWeight: 600, fontSize: 13, cursor: calling ? 'default' : 'pointer' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.63 3.38 2 2 0 0 1 3.6 1.21h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.9a16 16 0 0 0 6 6l1.06-1.06a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
                </svg>
                {calling ? 'Calling…' : 'Call'}
              </button>
              {selected.propertyId && (
                <button
                  onClick={() => openProperty(selected)}
                  style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #E8E0F0', background: '#FFFFFF', color: '#6B5B8A', fontSize: 13, cursor: 'pointer' }}>
                  View Property →
                </button>
              )}
              <button
                onClick={() => setCreateDealThread(selected)}
                style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #5C2977', background: '#5C2977', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                + Create Deal
              </button>
            </div>

            {/* Messages */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', background: '#F8F6FB' }}>
              {threadComms.map(c => (
                <MessageEntry key={c.id} c={c} onSelect={setSelectedComm} />
              ))}
              <div ref={threadEndRef} />
            </div>

            {/* Quick templates */}
            <div style={{ padding: '8px 24px 0', background: '#FFFFFF', borderTop: '1px solid #E8E0F0' }}>
              <div className="flex gap-2 flex-wrap">
                {TEMPLATES(selected.ownerFirstName, selected.propertyAddress, selected.offerPrice).map(tpl => (
                  <button key={tpl.label}
                    onClick={() => setSmsText(tpl.text)}
                    style={{ fontSize: 11, padding: '4px 10px', borderRadius: 14, border: '1px solid #E8E0F0', background: '#F7F3FC', color: '#5C2977', cursor: 'pointer', fontWeight: 500 }}>
                    {tpl.label}
                  </button>
                ))}
              </div>
            </div>

            {/* SMS composer */}
            <div style={{ padding: '10px 24px 16px', background: '#FFFFFF' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
                <textarea
                  value={smsText}
                  onChange={e => setSmsText(e.target.value)}
                  placeholder="Type a message…"
                  rows={2}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
                  style={{ flex: 1, borderRadius: 8, border: '1px solid #E8E0F0', padding: '10px 14px', fontSize: 14, resize: 'none', outline: 'none', background: '#F7F3FC', color: '#1A0A2E' }}
                />
                <button
                  onClick={handleSend}
                  disabled={sending || !smsText.trim()}
                  style={{
                    padding: '10px 18px', borderRadius: 8, border: 'none',
                    background: !smsText.trim() ? '#E8E0F0' : '#5C2977',
                    color: !smsText.trim() ? '#9B8AAE' : '#fff',
                    fontWeight: 700, fontSize: 14, cursor: sending || !smsText.trim() ? 'default' : 'pointer', flexShrink: 0,
                  }}>
                  {sendOk ? '✓' : sending ? '…' : '→'}
                </button>
              </div>
              {!selected.propertyId && (
                <p style={{ fontSize: 11, color: '#9B8AAE', marginTop: 4 }}>No property linked — message will be sent without template data</p>
              )}
              {sendErr && <p style={{ fontSize: 12, color: '#DC2626', marginTop: 6 }}>{sendErr}</p>}
            </div>
          </>
        )}
      </div>

      {/* ── Right: contact info panel ── */}
      {selected && (
        <div style={{ width: 240, borderLeft: '1px solid #E8E0F0', background: '#FFFFFF', overflowY: 'auto', flexShrink: 0, padding: 20 }}>
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#5C2977', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 20, margin: '0 auto 8px' }}>
              {getInitials(selected.name)}
            </div>
            <p style={{ fontWeight: 700, fontSize: 15, color: '#1A0A2E', margin: 0 }}>{selected.name}</p>
            <div className="flex gap-1 flex-wrap justify-center mt-1">
              {selected.leadScore && (
                <span style={{
                  display: 'inline-block', padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700,
                  background: selected.leadScore === 'hot' ? '#FFF3E0' : selected.leadScore === 'warm' ? '#FFF9E6' : '#F7F3FC',
                  color: selected.leadScore === 'hot' ? '#E65100' : selected.leadScore === 'warm' ? '#D97706' : '#6B5B8A',
                }}>{selected.leadScore.toUpperCase()}</span>
              )}
              {selected.disposition && <DispositionBadge disposition={selected.disposition} />}
            </div>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid #E8E0F0', margin: '0 0 16px' }} />

          <div style={{ marginBottom: 14 }}>
            <p style={{ fontSize: 10, fontWeight: 700, color: '#9B8AAE', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Phone</p>
            <div className="flex items-center gap-2">
              <span style={{ fontSize: 14, color: '#1A0A2E' }}>{fmtPhone(selected.phone)}</span>
              <button onClick={() => setCallConfirmThread(selected)} title="Call"
                style={{ padding: '4px 8px', borderRadius: 8, border: '1px solid #E8E0F0', background: '#F7F3FC', color: '#5C2977', cursor: 'pointer', fontSize: 12 }}>
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

          {selectedDeal && (
            <div style={{ marginBottom: 14 }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: '#9B8AAE', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Pipeline Stage</p>
              <div style={{ background: '#F3EEF9', borderRadius: 8, padding: '8px 10px', border: '1px solid #E8E0F0' }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: '#5C2977', margin: '0 0 6px' }}>
                  {selectedDeal.stage === 'new_lead' ? 'New Lead' :
                   selectedDeal.stage === 'contacted' ? 'Contacted' :
                   selectedDeal.stage === 'offer_sent' ? 'Offer Sent' :
                   selectedDeal.stage === 'follow_up' ? 'Follow Up' :
                   selectedDeal.stage === 'under_contract' ? 'Under Contract' :
                   selectedDeal.stage === 'closed_won' ? 'Closed Won' :
                   selectedDeal.stage === 'dead' ? 'Dead' :
                   selectedDeal.stage}
                </p>
                <button
                  onClick={() => setCurrentPage('seller-deals')}
                  style={{ fontSize: 11, color: '#5C2977', fontWeight: 600, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                >
                  View Deal →
                </button>
              </div>
            </div>
          )}

          {selected.offerPrice != null && (
            <div style={{ marginBottom: 14 }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: '#9B8AAE', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Offer Price</p>
              <p style={{ fontSize: 16, fontWeight: 700, color: '#059669', margin: 0 }}>
                ${selected.offerPrice.toLocaleString()}
              </p>
            </div>
          )}

          <hr style={{ border: 'none', borderTop: '1px solid #E8E0F0', margin: '0 0 16px' }} />

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

      {/* ── Call confirm modal ── */}
      {callConfirmThread && (
        <CallConfirmModal
          thread={callConfirmThread}
          callbackNumber={callbackNumber}
          onConfirm={() => handleCall(callConfirmThread)}
          onClose={() => setCallConfirmThread(null)}
          calling={calling}
        />
      )}

      {/* ── Create Deal modal ── */}
      {createDealThread && (
        <CreateDealModal
          thread={createDealThread}
          onClose={() => setCreateDealThread(null)}
          onSuccess={() => setCreateDealThread(null)}
        />
      )}
    </div>
  )
}
