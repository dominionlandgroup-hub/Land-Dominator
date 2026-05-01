import React, { useEffect, useState } from 'react'
import { listCommunications, sendSms } from '../api/crm'
import type { Communication, LeadScore } from '../types/crm'
import { useApp } from '../context/AppContext'

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  } catch { return iso }
}

function fmtTalk(secs?: number) {
  if (!secs) return '—'
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

function fmtPrice(v?: number | null) {
  if (!v) return '—'
  return `$${v.toLocaleString()}`
}

function ownerName(c: Communication) {
  const p = c.property
  if (!p) return c.phone_number || 'Unknown'
  return p.owner_full_name || [p.owner_first_name, p.owner_last_name].filter(Boolean).join(' ') || c.phone_number || 'Unknown'
}

// ── Badges ───────────────────────────────────────────────────────────────────

function ScoreBadge({ score }: { score?: LeadScore | null }) {
  if (!score) return null
  const map: Record<string, { bg: string; text: string; label: string }> = {
    hot:  { bg: '#FFF0E0', text: '#E65100', label: '🔥 HOT' },
    warm: { bg: '#FFF9E6', text: '#B8860B', label: '🌡 WARM' },
    cold: { bg: '#E8F5E9', text: '#2E7D32', label: '❄ COLD' },
  }
  const s = map[score] ?? { bg: '#EDE8F5', text: '#5C2977', label: score.toUpperCase() }
  return (
    <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: s.bg, color: s.text }}>
      {s.label}
    </span>
  )
}

function TypeBadge({ type }: { type: Communication['type'] }) {
  const isCall = type.startsWith('call')
  const isIn = type.endsWith('inbound')
  const label = isCall ? (isIn ? '📞 Inbound' : '📱 Outbound') : (isIn ? '💬 SMS In' : '📤 SMS Out')
  const bg = isCall ? '#E3F2FD' : '#F3E5F5'
  const color = isCall ? '#1565C0' : '#6A1B9A'
  return (
    <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: bg, color }}>
      {label}
    </span>
  )
}

type Filter = 'all' | 'calls' | 'texts' | 'hot' | 'warm'

// ── SMS Reply Modal ──────────────────────────────────────────────────────────

function SmsModal({ comm, onClose, onSent }: { comm: Communication; onClose: () => void; onSent: () => void }) {
  const [msg, setMsg] = useState('')
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function handleSend() {
    if (!msg.trim() || !comm.phone_number || !comm.property_id) return
    setSending(true); setErr(null)
    try {
      await sendSms(comm.property_id, comm.phone_number, msg.trim())
      onSent()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setErr(detail ?? 'Failed to send SMS.')
    } finally { setSending(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(26,10,46,0.5)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="card" style={{ width: 480, maxWidth: '95vw', padding: 24 }}>
        <h2 className="section-heading mb-1">Reply via SMS</h2>
        <p className="text-xs mb-4" style={{ color: '#9B8AAE' }}>To: {comm.phone_number} — {ownerName(comm)}</p>
        <textarea className="input-base w-full text-sm" rows={4} placeholder="Type your message…"
          value={msg} onChange={e => setMsg(e.target.value)} style={{ resize: 'vertical' }} autoFocus />
        {err && <p className="text-xs mt-2" style={{ color: '#B71C1C' }}>{err}</p>}
        <div className="flex gap-2 justify-end mt-3">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSend} disabled={sending || !msg.trim()}>
            {sending ? 'Sending…' : 'Send SMS'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Recording player ──────────────────────────────────────────────────────────

function RecordingBtn({ url }: { url: string }) {
  const [open, setOpen] = useState(false)
  return (
    <span>
      <button
        onClick={() => setOpen(o => !o)}
        className="px-2 py-1 rounded text-xs font-semibold"
        style={{ background: '#E8F5E9', color: '#2E7D32', border: '1px solid #A5D6A7' }}
        title="Play recording"
      >
        ▶ Play
      </button>
      {open && (
        <div className="mt-1">
          <audio controls src={url} style={{ height: 28, maxWidth: 180 }} autoPlay />
        </div>
      )}
    </span>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function SellerInbox() {
  const { setCurrentPage, setSelectedPropertyId } = useApp()
  const [comms, setComms] = useState<Communication[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [replyTo, setReplyTo] = useState<Communication | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true); setError(null)
    try {
      setComms(await listCommunications({ limit: 300 }))
    } catch {
      setError('Failed to load communications. Ensure the crm_communications table has been created.')
    } finally { setLoading(false) }
  }

  const filtered = comms.filter(c => {
    if (filter === 'calls') return c.type.startsWith('call')
    if (filter === 'texts') return c.type.startsWith('sms')
    if (filter === 'hot') return c.lead_score === 'hot'
    if (filter === 'warm') return c.lead_score === 'warm'
    return true
  })

  const callCount = comms.filter(c => c.type.startsWith('call')).length
  const textCount = comms.filter(c => c.type.startsWith('sms')).length
  const hotCount  = comms.filter(c => c.lead_score === 'hot').length

  const FILTERS: { id: Filter; label: string; count: number }[] = [
    { id: 'all',   label: 'All',     count: comms.length },
    { id: 'calls', label: 'Calls',   count: callCount },
    { id: 'texts', label: 'Texts',   count: textCount },
    { id: 'hot',   label: '🔥 HOT',  count: hotCount },
    { id: 'warm',  label: '🌡 WARM', count: comms.filter(c => c.lead_score === 'warm').length },
  ]

  function openProperty(c: Communication) {
    const id = c.property?.id
    if (!id) return
    setSelectedPropertyId(id)
    setCurrentPage('crm-properties')
  }

  return (
    <div style={{ background: '#F8F6FB', minHeight: '100vh' }}>
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Seller Inbox</h1>
          <p className="page-subtitle">{comms.length} total communications</p>
        </div>
        <button className="btn-secondary" onClick={load} disabled={loading}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="23 4 23 10 17 10"/>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
          Refresh
        </button>
      </div>

      <div className="p-6">
        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-4 mb-5">
          {[
            { label: 'Total Conversations', value: comms.length, color: '#5C2977' },
            { label: 'Calls',              value: callCount,     color: '#1565C0' },
            { label: '🔥 HOT Leads',       value: hotCount,      color: '#E65100' },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-white rounded-xl p-4" style={{ border: '1px solid #EDE8F5' }}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: '#9B8AAE' }}>{label}</p>
              <p className="text-2xl font-bold" style={{ color }}>{value}</p>
            </div>
          ))}
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1.5 mb-4">
          {FILTERS.map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
              style={{
                background: filter === f.id ? '#5C2977' : '#fff',
                color: filter === f.id ? '#fff' : '#6B5B8A',
                border: `1px solid ${filter === f.id ? '#5C2977' : '#EDE8F5'}`,
              }}>
              {f.label} {f.count > 0 && <span style={{ opacity: 0.7 }}>({f.count})</span>}
            </button>
          ))}
        </div>

        {successMsg && (
          <div className="mb-3 p-3 rounded-lg text-sm" style={{ background: '#E8F5E9', color: '#2E7D32', border: '1px solid #C8E6C9' }}>
            {successMsg}
            <button className="ml-3 underline text-xs" onClick={() => setSuccessMsg(null)}>Dismiss</button>
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 rounded-lg text-sm" style={{ background: '#FFF0F0', color: '#B71C1C', border: '1px solid #FFCDD2' }}>
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <p className="text-sm" style={{ color: '#9B8AAE' }}>Loading communications…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20" style={{ color: '#6B5B8A' }}>
            <svg className="mx-auto mb-4 opacity-30" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/>
              <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>
            </svg>
            <p className="text-sm font-medium">
              {filter === 'all' ? 'No communications yet' : `No ${filter} communications`}
            </p>
            {filter === 'all' && (
              <p className="text-xs mt-1 max-w-xs mx-auto">
                Communications appear here when sellers call or text your Telnyx number.
              </p>
            )}
          </div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#F8F6FB', borderBottom: '2px solid #EDE8F5' }}>
                  {['Owner', 'Phone', 'APN / County', 'Offer Code', 'Offer Price', 'Type', 'Score', 'Talk Time', 'Summary', 'Date', 'Actions'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '10px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#6B5B8A', whiteSpace: 'nowrap' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((c, idx) => {
                  const prop = c.property || {}
                  const name = ownerName(c)
                  const apn = prop.apn || '—'
                  const county = prop.county || ''
                  const offerCode = prop.campaign_code || c.caller_offer_code || '—'
                  const offerPrice = prop.offer_price
                  const isSms = c.type.startsWith('sms')
                  const hasProperty = !!prop.id
                  return (
                    <tr key={c.id}
                      style={{ background: idx % 2 === 0 ? '#fff' : '#FAF8FD', borderBottom: '1px solid #EDE8F5', cursor: hasProperty ? 'pointer' : 'default' }}
                      onClick={() => hasProperty && openProperty(c)}
                      onMouseEnter={e => { if (hasProperty) (e.currentTarget as HTMLTableRowElement).style.background = '#F0EBF8' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLTableRowElement).style.background = idx % 2 === 0 ? '#fff' : '#FAF8FD' }}
                    >
                      {/* Owner */}
                      <td style={{ padding: '10px 14px', maxWidth: 150 }}>
                        <span className="text-sm font-semibold" style={{ color: hasProperty ? '#5C2977' : '#1A0A2E' }}
                          title={hasProperty ? 'Click to open property' : ''}>
                          {name}
                          {hasProperty && <span style={{ marginLeft: 4, fontSize: 10, opacity: 0.6 }}>↗</span>}
                        </span>
                      </td>

                      {/* Phone */}
                      <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                        <span className="text-xs" style={{ color: '#6B5B8A' }}>{c.phone_number || '—'}</span>
                      </td>

                      {/* APN / County */}
                      <td style={{ padding: '10px 14px' }}>
                        <span className="text-xs font-medium" style={{ color: '#5C2977' }}>{apn}</span>
                        {county && <span className="text-xs block" style={{ color: '#9B8AAE' }}>{county}</span>}
                      </td>

                      {/* Offer Code */}
                      <td style={{ padding: '10px 14px' }}>
                        <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded" style={{ background: '#F3E5F5', color: '#6A1B9A' }}>
                          {offerCode}
                        </span>
                      </td>

                      {/* Offer Price */}
                      <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                        <span className="text-xs font-semibold" style={{ color: offerPrice ? '#2D7A4F' : '#9B8AAE' }}>
                          {fmtPrice(offerPrice)}
                        </span>
                      </td>

                      {/* Type */}
                      <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                        <TypeBadge type={c.type} />
                      </td>

                      {/* Score */}
                      <td style={{ padding: '10px 14px' }}>
                        <ScoreBadge score={c.lead_score} />
                      </td>

                      {/* Talk time */}
                      <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                        <span className="text-xs" style={{ color: '#9B8AAE' }}>
                          {c.type.startsWith('call') ? fmtTalk(c.duration_seconds) : '—'}
                        </span>
                      </td>

                      {/* Summary */}
                      <td style={{ padding: '10px 14px', maxWidth: 220 }}>
                        <p className="text-xs" style={{ color: '#6B5B8A', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                          {c.summary || c.message_body || '—'}
                        </p>
                      </td>

                      {/* Date */}
                      <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                        <span className="text-xs" style={{ color: '#9B8AAE' }}>{fmtDate(c.created_at)}</span>
                      </td>

                      {/* Actions */}
                      <td style={{ padding: '10px 14px' }} onClick={e => e.stopPropagation()}>
                        <div className="flex flex-col gap-1">
                          {isSms && c.property_id && (
                            <button
                              className="px-2 py-1 rounded text-xs font-semibold"
                              style={{ background: '#F3E5F5', color: '#6A1B9A', border: '1px solid #E1BEE7' }}
                              onClick={() => setReplyTo(c)}
                            >
                              Reply
                            </button>
                          )}
                          {c.type === 'call_inbound' && c.phone_number && (
                            <a
                              href={`tel:${c.phone_number}`}
                              className="px-2 py-1 rounded text-xs font-semibold text-center"
                              style={{ background: '#E3F2FD', color: '#1565C0', border: '1px solid #BBDEFB', textDecoration: 'none' }}
                            >
                              Call Back
                            </a>
                          )}
                          {c.recording_url && <RecordingBtn url={c.recording_url} />}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {replyTo && (
        <SmsModal
          comm={replyTo}
          onClose={() => setReplyTo(null)}
          onSent={() => {
            setReplyTo(null)
            setSuccessMsg('SMS sent successfully.')
            load()
          }}
        />
      )}
    </div>
  )
}
