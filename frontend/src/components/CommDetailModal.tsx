import React, { useState } from 'react'
import type { Communication, LeadScore } from '../types/crm'

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    })
  } catch { return iso }
}

export function fmtTalk(secs?: number | null): string {
  if (!secs || secs <= 0) return '< 1 min'
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

// ── Badges ────────────────────────────────────────────────────────────────────

export function ScoreBadge({ score }: { score?: LeadScore | null }) {
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

export function TypeBadge({ type }: { type: Communication['type'] }) {
  const isCall = type.startsWith('call')
  const isIn = type.endsWith('inbound')
  const label = isCall ? (isIn ? '📞 Inbound Call' : '📱 Outbound Call') : (isIn ? '💬 SMS In' : '📤 SMS Out')
  const bg = isCall ? '#E3F2FD' : '#F3E5F5'
  const color = isCall ? '#1565C0' : '#6A1B9A'
  return (
    <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: bg, color }}>
      {label}
    </span>
  )
}

// ── Recording player ──────────────────────────────────────────────────────────

function RecordingPlayer({ url }: { url: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
        style={{ background: '#E8F5E9', color: '#2E7D32', border: '1px solid #A5D6A7' }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
          <polygon points="5 3 19 12 5 21 5 3"/>
        </svg>
        {open ? 'Hide Recording' : 'Play Recording'}
      </button>
      {open && (
        <div className="mt-2">
          <audio controls src={url} style={{ width: '100%', height: 36 }} autoPlay />
        </div>
      )}
    </div>
  )
}

// ── Main modal ────────────────────────────────────────────────────────────────

interface Props {
  comm: Communication
  onClose: () => void
  onOpenProperty?: (id: string) => void
}

export default function CommDetailModal({ comm, onClose, onOpenProperty }: Props) {
  const isCall = comm.type.startsWith('call')
  const prop = comm.property

  // Split summary from next action if present
  const summaryText = comm.summary || ''
  const nextActionMatch = summaryText.match(/Next action:\s*(.+)$/i)
  const mainSummary = nextActionMatch
    ? summaryText.slice(0, nextActionMatch.index).trim()
    : summaryText
  const nextAction = nextActionMatch ? nextActionMatch[1].trim() : ''

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ background: 'rgba(26,10,46,0.55)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full overflow-y-auto"
        style={{ maxWidth: 560, maxHeight: '90vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b" style={{ borderColor: '#EDE8F5' }}>
          <div className="flex items-center gap-2 flex-wrap">
            <TypeBadge type={comm.type} />
            <ScoreBadge score={comm.lead_score} />
          </div>
          <button onClick={onClose} style={{ color: '#9B8AAE', fontSize: 20, lineHeight: 1 }}>×</button>
        </div>

        <div className="p-5 space-y-4">
          {/* Meta row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="label-caps mb-1">Date & Time</p>
              <p className="text-sm" style={{ color: '#1A0A2E' }}>{fmtDate(comm.created_at)}</p>
            </div>
            {isCall && (
              <div>
                <p className="label-caps mb-1">Duration</p>
                <p className="text-sm font-semibold" style={{ color: '#1A0A2E' }}>{fmtTalk(comm.duration_seconds)}</p>
              </div>
            )}
            {comm.phone_number && (
              <div>
                <p className="label-caps mb-1">Phone</p>
                <a href={`tel:${comm.phone_number}`} className="text-sm font-semibold" style={{ color: '#5C2977' }}>
                  {comm.phone_number}
                </a>
              </div>
            )}
            {comm.caller_offer_code && (
              <div>
                <p className="label-caps mb-1">Offer Code Provided</p>
                <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded" style={{ background: '#F3E5F5', color: '#6A1B9A' }}>
                  {comm.caller_offer_code}
                </span>
              </div>
            )}
          </div>

          {/* Summary */}
          {mainSummary && (
            <div>
              <p className="label-caps mb-1">Summary</p>
              <p className="text-sm leading-relaxed" style={{ color: '#1A0A2E' }}>{mainSummary}</p>
            </div>
          )}

          {/* SMS message body */}
          {!isCall && comm.message_body && (
            <div>
              <p className="label-caps mb-1">Message</p>
              <p className="text-sm leading-relaxed p-3 rounded-xl" style={{ background: '#F8F5FC', color: '#1A0A2E' }}>
                {comm.message_body}
              </p>
            </div>
          )}

          {/* Recommended next action */}
          {nextAction && (
            <div className="p-3 rounded-xl" style={{ background: '#FFF9E6', border: '1px solid #F0D060' }}>
              <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: '#B8860B' }}>Recommended Next Action</p>
              <p className="text-sm font-medium" style={{ color: '#1A0A2E' }}>{nextAction}</p>
            </div>
          )}

          {/* Recording */}
          {comm.recording_url && (
            <div>
              <p className="label-caps mb-2">Recording</p>
              <RecordingPlayer url={comm.recording_url} />
            </div>
          )}

          {/* Transcript */}
          {comm.transcript && (
            <div>
              <p className="label-caps mb-2">Full Transcript</p>
              <pre className="text-xs leading-relaxed p-3 rounded-xl overflow-x-auto"
                style={{ background: '#F8F5FC', color: '#3D2B5E', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'monospace', maxHeight: 200, overflowY: 'auto' }}>
                {comm.transcript}
              </pre>
            </div>
          )}

          {/* Property info */}
          {prop && (
            <div className="p-3 rounded-xl" style={{ background: '#F8F5FC', border: '1px solid #EDE8F5' }}>
              <p className="label-caps mb-1">Matched Property</p>
              <p className="text-sm font-semibold" style={{ color: '#1A0A2E' }}>
                {prop.apn || '—'}{prop.county ? ` · ${prop.county}` : ''}{prop.state ? `, ${prop.state}` : ''}
              </p>
              {prop.owner_full_name && (
                <p className="text-xs mt-0.5" style={{ color: '#6B5B8A' }}>{prop.owner_full_name}</p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2 p-5 border-t" style={{ borderColor: '#EDE8F5' }}>
          {onOpenProperty && prop?.id && (
            <button
              className="btn-primary flex-1"
              onClick={() => { onOpenProperty(prop.id!); onClose() }}
            >
              Open Property →
            </button>
          )}
          <button className="btn-secondary flex-1" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
