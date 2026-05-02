import React, { useEffect, useState } from 'react'
import {
  listMailDrops,
  previewMailDrop,
  createMailDrop,
  approveMailDrop,
  sendMailDrop,
  downloadMailDropCsv,
  deleteMailDrop,
  listCrmCampaigns,
} from '../api/crm'
import type { MailDrop, MailDropPreview, CRMCampaign } from '../types/crm'

function fmt(iso?: string) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return iso }
}

function StatusBadge({ status }: { status: MailDrop['status'] }) {
  const map: Record<string, { bg: string; text: string; label: string }> = {
    scheduled: { bg: 'rgba(124,58,237,0.12)', text: '#A78BFA', label: 'Scheduled' },
    approved:  { bg: 'rgba(16,185,129,0.12)', text: '#34D399', label: 'Approved' },
    sent:      { bg: 'rgba(124,58,237,0.12)', text: '#A78BFA', label: 'Sent' },
    error:     { bg: 'rgba(239,68,68,0.12)', text: '#F87171', label: 'Error' },
  }
  const s = map[status] ?? map.scheduled
  return (
    <span
      className="text-xs font-semibold px-2 py-0.5 rounded-full"
      style={{ background: s.bg, color: s.text }}
    >
      {s.label}
    </span>
  )
}

export default function MailCalendar() {
  const [drops, setDrops] = useState<MailDrop[]>([])
  const [campaigns, setCampaigns] = useState<CRMCampaign[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  // Schedule modal
  const [showModal, setShowModal] = useState(false)
  const [modalCampaignId, setModalCampaignId] = useState('')
  const [modalDate, setModalDate] = useState('')
  const [preview, setPreview] = useState<MailDropPreview | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [scheduling, setScheduling] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true); setError(null)
    try {
      const [d, c] = await Promise.all([listMailDrops(), listCrmCampaigns()])
      setDrops(d)
      setCampaigns(c)
    } catch { setError('Failed to load mail calendar.') }
    finally { setLoading(false) }
  }

  async function handlePreview() {
    if (!modalCampaignId || !modalDate) return
    setPreviewing(true); setPreview(null); setModalError(null)
    try {
      const p = await previewMailDrop(modalCampaignId, modalDate)
      setPreview(p)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Preview failed'
      setModalError(msg)
    } finally { setPreviewing(false) }
  }

  async function handleSchedule() {
    if (!modalCampaignId || !modalDate) return
    setScheduling(true); setModalError(null)
    try {
      const drop = await createMailDrop(modalCampaignId, modalDate)
      setDrops(prev => [...prev, drop])
      setShowModal(false)
      setModalCampaignId(''); setModalDate(''); setPreview(null)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Failed to schedule drop'
      setModalError(msg)
    } finally { setScheduling(false) }
  }

  async function handleApprove(id: string) {
    setBusyId(id); setActionError(null)
    try {
      const updated = await approveMailDrop(id)
      setDrops(prev => prev.map(d => d.id === id ? updated : d))
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Approve failed'
      setActionError(msg)
    } finally { setBusyId(null) }
  }

  async function handleSend(id: string) {
    setBusyId(id); setActionError(null)
    try {
      const updated = await sendMailDrop(id)
      setDrops(prev => prev.map(d => d.id === id ? updated : d))
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Send failed'
      setActionError(msg)
    } finally { setBusyId(null) }
  }

  async function handleDelete(id: string) {
    setBusyId(id); setActionError(null)
    try {
      await deleteMailDrop(id)
      setDrops(prev => prev.filter(d => d.id !== id))
    } catch { setActionError('Delete failed') }
    finally { setBusyId(null) }
  }

  const totalPending = drops.filter(d => d.status === 'scheduled' || d.status === 'approved').length
  const totalSentMonth = drops.filter(d => {
    if (d.status !== 'sent' || !d.sent_at) return false
    const sent = new Date(d.sent_at)
    const now = new Date()
    return sent.getMonth() === now.getMonth() && sent.getFullYear() === now.getFullYear()
  }).length
  const totalPieces = drops.filter(d => d.status === 'sent').reduce((s, d) => s + (d.pieces_count ?? 0), 0)

  return (
    <div style={{ background: '#0F0F0F', minHeight: '100vh' }}>
      {/* Header */}
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Mail Calendar</h1>
          <p className="page-subtitle">Schedule and manage weekly mail drops</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-secondary" onClick={load} disabled={loading}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 4 23 10 17 10"/>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
            </svg>
            Refresh
          </button>
          <button className="btn-primary" onClick={() => { setShowModal(true); setModalError(null); setPreview(null) }}>
            + Schedule Drop
          </button>
        </div>
      </div>

      <div className="p-6">
        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[
            { label: 'Pending Drops', value: totalPending, color: '#A78BFA' },
            { label: 'Sent This Month', value: totalSentMonth, color: '#A78BFA' },
            { label: 'Total Pieces Mailed', value: totalPieces.toLocaleString(), color: '#10B981' },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-white rounded-xl p-5" style={{ background: '#1A1A1A', border: '1px solid #2E2E2E', borderRadius: 8 }}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: '#6B6B6B' }}>{label}</p>
              <p className="text-2xl font-bold" style={{ color }}>{value}</p>
            </div>
          ))}
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg text-sm" style={{ background: 'rgba(239,68,68,0.1)', color: '#F87171', border: '1px solid rgba(239,68,68,0.2)' }}>
            {error}
          </div>
        )}

        {actionError && (
          <div className="mb-4 p-3 rounded-lg text-sm" style={{ background: 'rgba(239,68,68,0.1)', color: '#F87171', border: '1px solid rgba(239,68,68,0.2)' }}>
            {actionError}
            <button className="ml-3 underline text-xs" onClick={() => setActionError(null)}>Dismiss</button>
          </div>
        )}

        {/* Drops table */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-sm" style={{ color: '#A0A0A0' }}>Loading…</div>
          </div>
        ) : drops.length === 0 ? (
          <div className="text-center py-20" style={{ color: '#A0A0A0' }}>
            <svg className="mx-auto mb-4 opacity-30" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
            <p className="text-sm font-medium">No mail drops scheduled</p>
            <p className="text-xs mt-1">Click "Schedule Drop" to create your first mail drop</p>
            <button className="btn-primary mt-4" onClick={() => setShowModal(true)}>+ Schedule Drop</button>
          </div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: 'hidden', background: '#1A1A1A', border: '1px solid #2E2E2E', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#242424', borderBottom: '2px solid #2E2E2E' }}>
                  {['Date', 'Campaign', 'Pieces', 'Est. Cost', 'Status', 'Sent To', 'Actions'].map(h => (
                    <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: '11px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#6B6B6B' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {drops.map((drop, idx) => {
                  const busy = busyId === drop.id
                  return (
                    <tr
                      key={drop.id}
                      style={{ background: idx % 2 === 0 ? '#1A1A1A' : '#1F1F1F', borderBottom: '1px solid #2E2E2E' }}
                    >
                      <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
                        <span className="text-sm font-medium" style={{ color: '#F5F5F5' }}>{fmt(drop.scheduled_date)}</span>
                      </td>
                      <td style={{ padding: '12px 16px', maxWidth: 200 }}>
                        <span className="text-sm" style={{ color: '#A78BFA' }}>{drop.campaign_name || '—'}</span>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span className="text-sm font-semibold" style={{ color: '#F5F5F5' }}>
                          {(drop.pieces_count ?? 0).toLocaleString()}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span className="text-sm" style={{ color: '#A0A0A0' }}>
                          {drop.estimated_cost != null ? `$${drop.estimated_cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <StatusBadge status={drop.status} />
                        {drop.error && (
                          <p className="text-xs mt-0.5" style={{ color: '#F87171' }} title={drop.error}>Error</p>
                        )}
                      </td>
                      <td style={{ padding: '12px 16px', maxWidth: 180 }}>
                        <span className="text-xs" style={{ color: '#6B6B6B' }}>{drop.email_sent_to || '—'}</span>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <div className="flex items-center gap-1.5">
                          {drop.status === 'scheduled' && (
                            <button
                              className="px-2.5 py-1 rounded text-xs font-semibold"
                              style={{ background: 'rgba(16,185,129,0.12)', color: '#34D399', border: '1px solid rgba(16,185,129,0.2)' }}
                              onClick={() => handleApprove(drop.id)}
                              disabled={busy}
                            >
                              {busy ? '…' : 'Approve'}
                            </button>
                          )}
                          {drop.status === 'approved' && (
                            <button
                              className="px-2.5 py-1 rounded text-xs font-semibold"
                              style={{ background: 'rgba(124,58,237,0.12)', color: '#A78BFA', border: '1px solid rgba(124,58,237,0.2)' }}
                              onClick={() => handleSend(drop.id)}
                              disabled={busy}
                            >
                              {busy ? 'Sending…' : 'Send'}
                            </button>
                          )}
                          {drop.status === 'sent' && (
                            <button
                              className="px-2.5 py-1 rounded text-xs font-semibold"
                              style={{ background: 'rgba(124,58,237,0.12)', color: '#A78BFA', border: '1px solid rgba(124,58,237,0.2)' }}
                              onClick={() => downloadMailDropCsv(drop.id)}
                              disabled={busy}
                            >
                              CSV
                            </button>
                          )}
                          {(drop.status === 'scheduled' || drop.status === 'approved' || drop.status === 'error') && (
                            <button
                              className="px-2 py-1 rounded text-xs"
                              style={{ color: '#6B6B6B', border: '1px solid #2E2E2E' }}
                              onClick={() => handleDelete(drop.id)}
                              disabled={busy}
                              title="Delete"
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polyline points="3 6 5 6 21 6"/>
                                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                              </svg>
                            </button>
                          )}
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

      {/* Schedule Drop Modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.7)' }}
          onClick={e => { if (e.target === e.currentTarget) { setShowModal(false); setPreview(null) } }}
        >
          <div className="card" style={{ width: 480, maxWidth: '95vw', padding: 24, background: '#1A1A1A', border: '1px solid #2E2E2E', borderRadius: 8 }}>
            <h2 className="section-heading mb-4">Schedule Mail Drop</h2>

            <div className="space-y-3 mb-4">
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: '#A0A0A0' }}>Campaign</label>
                <select
                  className="input-base w-full text-sm"
                  value={modalCampaignId}
                  onChange={e => { setModalCampaignId(e.target.value); setPreview(null) }}
                >
                  <option value="">Select campaign…</option>
                  {campaigns.map(c => (
                    <option key={c.id} value={c.id}>{c.name} ({(c.property_count ?? 0).toLocaleString()} records)</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: '#A0A0A0' }}>Scheduled Date</label>
                <input
                  type="date"
                  className="input-base w-full text-sm"
                  value={modalDate}
                  onChange={e => { setModalDate(e.target.value); setPreview(null) }}
                />
              </div>
            </div>

            {/* Preview button */}
            {modalCampaignId && modalDate && !preview && (
              <button
                className="btn-secondary w-full mb-3 text-sm"
                onClick={handlePreview}
                disabled={previewing}
              >
                {previewing ? 'Calculating…' : 'Preview Drop'}
              </button>
            )}

            {/* Preview results */}
            {preview && (
              <div className="rounded-xl p-4 mb-4 space-y-2" style={{ background: '#242424', border: '1px solid #2E2E2E' }}>
                <p className="text-xs font-bold uppercase tracking-wider" style={{ color: '#6B6B6B' }}>Drop Preview</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  {[
                    ['Total Records', preview.total_records.toLocaleString()],
                    ['Suppressed', preview.suppressed_count.toLocaleString()],
                    ['Eligible to Mail', <strong key="e" style={{ color: '#A78BFA' }}>{preview.eligible_count.toLocaleString()}</strong>],
                    ['Cost Per Piece', `$${preview.cost_per_piece.toFixed(2)}`],
                    ['Estimated Cost', <strong key="c" style={{ color: '#10B981' }}>{`$${preview.estimated_cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</strong>],
                  ].map(([label, val], i) => (
                    <React.Fragment key={i}>
                      <span className="text-xs" style={{ color: '#6B6B6B' }}>{label}</span>
                      <span className="text-xs font-medium" style={{ color: '#F5F5F5' }}>{val}</span>
                    </React.Fragment>
                  ))}
                </div>
                {preview.eligible_count === 0 && (
                  <p className="text-xs mt-1" style={{ color: '#F87171' }}>
                    No eligible records after suppression. Check statuses and "Do Not Mail" tags.
                  </p>
                )}
              </div>
            )}

            {modalError && (
              <p className="text-sm mb-3" style={{ color: '#F87171' }}>{modalError}</p>
            )}

            <div className="flex gap-2 justify-end">
              <button className="btn-secondary" onClick={() => { setShowModal(false); setPreview(null) }}>Cancel</button>
              <button
                className="btn-primary"
                onClick={handleSchedule}
                disabled={scheduling || !modalCampaignId || !modalDate || !preview || preview.eligible_count === 0}
              >
                {scheduling ? 'Scheduling…' : 'Schedule Drop'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
