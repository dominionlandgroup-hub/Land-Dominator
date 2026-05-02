import React, { useEffect, useRef, useState } from 'react'
import type { CRMDeal, DealStage } from '../types/crm'
import { listDeals, createDeal, updateDeal, deleteDeal } from '../api/crm'

interface StageConfig {
  id: DealStage
  label: string
  color: string
  bg: string
  border: string
}

const STAGES: StageConfig[] = [
  { id: 'lead',           label: 'Lead',           color: '#F59E0B', bg: 'rgba(245,158,11,0.08)',   border: 'rgba(245,158,11,0.2)'  },
  { id: 'prospect',       label: 'Prospect',       color: '#4A90D9', bg: 'rgba(74,144,217,0.08)',   border: 'rgba(74,144,217,0.2)'  },
  { id: 'offer_sent',     label: 'Offer Sent',     color: '#A78BFA', bg: 'rgba(167,139,250,0.08)',  border: 'rgba(167,139,250,0.2)' },
  { id: 'under_contract', label: 'Under Contract', color: '#10B981', bg: 'rgba(16,185,129,0.08)',   border: 'rgba(16,185,129,0.2)'  },
  { id: 'due_diligence',  label: 'Due Diligence',  color: '#F59E0B', bg: 'rgba(245,158,11,0.08)',   border: 'rgba(245,158,11,0.2)'  },
  { id: 'closed_won',     label: 'Closed Won',     color: '#10B981', bg: 'rgba(16,185,129,0.08)',   border: 'rgba(16,185,129,0.2)'  },
  { id: 'closed_lost',    label: 'Closed Lost',    color: '#EF4444', bg: 'rgba(239,68,68,0.08)',    border: 'rgba(239,68,68,0.2)'   },
]

export default function Deals() {
  const [deals, setDeals] = useState<CRMDeal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [formStage, setFormStage] = useState<DealStage>('lead')

  useEffect(() => { fetchDeals() }, [])

  async function fetchDeals() {
    setLoading(true)
    setError(null)
    try {
      const data = await listDeals()
      setDeals(data)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      const detail = err?.response?.data?.detail ?? ''
      setError(detail && !detail.includes('SUPABASE') ? detail : 'Failed to load deals. Check that the backend API is reachable.')
    } finally {
      setLoading(false)
    }
  }

  async function handleMove(deal: CRMDeal, newStage: DealStage) {
    setDeals(prev => prev.map(d => d.id === deal.id ? { ...d, stage: newStage } : d))
    try {
      await updateDeal(deal.id, { stage: newStage })
    } catch {
      setDeals(prev => prev.map(d => d.id === deal.id ? deal : d))
    }
  }

  async function handleDelete(id: string) {
    setDeals(prev => prev.filter(d => d.id !== id))
    try {
      await deleteDeal(id)
    } catch {
      fetchDeals()
    }
  }

  const pipelineValue = deals
    .filter(d => d.stage !== 'closed_lost')
    .reduce((s, d) => s + (d.value || 0), 0)

  const closedValue = deals
    .filter(d => d.stage === 'closed_won')
    .reduce((s, d) => s + (d.value || 0), 0)

  return (
    <div className="page-content">
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Deals Pipeline</h1>
          <p className="page-subtitle">
            {deals.length} deal{deals.length !== 1 ? 's' : ''} ·{' '}
            ${pipelineValue.toLocaleString()} pipeline ·{' '}
            ${closedValue.toLocaleString()} closed
          </p>
        </div>
        <button className="btn-primary" onClick={() => { setFormStage('lead'); setShowForm(true) }}>
          + New Deal
        </button>
      </div>

      <div className="p-6">
        {/* Summary row */}
        <div className="flex gap-3 mb-6 overflow-x-auto pb-1">
          {STAGES.map(s => {
            const count = deals.filter(d => d.stage === s.id).length
            const val = deals.filter(d => d.stage === s.id).reduce((sum, d) => sum + (d.value || 0), 0)
            return (
              <div key={s.id} className="flex-none rounded-lg px-4 py-3 text-center" style={{ minWidth: '110px', background: s.bg, border: `1px solid ${s.border}` }}>
                <div className="text-xs font-semibold" style={{ color: s.color }}>{s.label}</div>
                <div className="text-xl font-bold mt-1" style={{ color: s.color }}>{count}</div>
                {val > 0 && <div className="text-xs mt-0.5" style={{ color: s.color }}>${val.toLocaleString()}</div>}
              </div>
            )
          })}
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg text-sm" style={{ background: 'rgba(239,68,68,0.12)', color: '#F87171', border: '1px solid rgba(239,68,68,0.3)' }}>
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="text-sm" style={{ color: '#6B6B6B' }}>Loading deals…</div>
          </div>
        ) : (
          <div className="flex gap-4 overflow-x-auto pb-4" style={{ alignItems: 'flex-start' }}>
            {STAGES.map(stage => {
              const stageDeals = deals.filter(d => d.stage === stage.id)
              return (
                <div key={stage.id} style={{ flex: '0 0 240px', minWidth: '240px' }}>
                  <div className="rounded-lg p-3 mb-3" style={{ background: stage.bg, border: `1px solid ${stage.border}` }}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold" style={{ color: stage.color }}>{stage.label}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
                        style={{ background: `${stage.color}22`, color: stage.color }}>
                        {stageDeals.length}
                      </span>
                    </div>
                    {stageDeals.reduce((s, d) => s + (d.value || 0), 0) > 0 && (
                      <div className="text-xs mt-1 font-medium" style={{ color: stage.color }}>
                        ${stageDeals.reduce((s, d) => s + (d.value || 0), 0).toLocaleString()}
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    {stageDeals.map(deal => (
                      <DealCard
                        key={deal.id}
                        deal={deal}
                        stages={STAGES}
                        onMove={s => handleMove(deal, s)}
                        onDelete={() => handleDelete(deal.id)}
                      />
                    ))}
                    <button
                      style={{
                        width: '100%', padding: '8px', borderRadius: '6px',
                        fontSize: '12px', color: '#6B6B6B', textAlign: 'center',
                        border: '1.5px dashed #2E2E2E', background: 'transparent', cursor: 'pointer',
                      }}
                      onMouseEnter={e => {
                        const el = e.currentTarget
                        el.style.borderColor = '#7C3AED'
                        el.style.color = '#A78BFA'
                      }}
                      onMouseLeave={e => {
                        const el = e.currentTarget
                        el.style.borderColor = '#2E2E2E'
                        el.style.color = '#6B6B6B'
                      }}
                      onClick={() => { setFormStage(stage.id); setShowForm(true) }}
                    >
                      + Add deal
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {showForm && (
        <DealForm
          initialStage={formStage}
          onClose={() => setShowForm(false)}
          onSave={async (data) => {
            const created = await createDeal(data)
            setDeals(prev => [created, ...prev])
            setShowForm(false)
          }}
        />
      )}
    </div>
  )
}

function DealCard({
  deal, stages, onMove, onDelete,
}: {
  deal: CRMDeal
  stages: StageConfig[]
  onMove: (s: DealStage) => void
  onDelete: () => void
}) {
  const [showMenu, setShowMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false)
      }
    }
    if (showMenu) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showMenu])

  return (
    <div className="rounded-lg p-3 relative" style={{ background: '#1A1A1A', border: '1px solid #2E2E2E' }}>
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="text-sm font-semibold leading-snug" style={{ color: '#F5F5F5' }}>{deal.title}</div>
        <div className="relative flex-none" ref={menuRef}>
          <button
            onClick={() => setShowMenu(v => !v)}
            style={{ color: '#6B6B6B', fontSize: '16px', lineHeight: 1, padding: '0 2px' }}
          >⋮</button>
          {showMenu && (
            <div className="absolute right-0 top-full mt-1 rounded-lg z-30 overflow-hidden"
              style={{ background: '#242424', border: '1px solid #2E2E2E', minWidth: '170px' }}>
              <div className="p-1">
                <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: '#6B6B6B' }}>Move to</div>
                {stages.filter(s => s.id !== deal.stage).map(s => (
                  <button
                    key={s.id}
                    className="w-full text-left px-3 py-2 text-xs rounded-lg transition-colors"
                    style={{ color: '#F5F5F5' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#2E2E2E')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    onClick={() => { onMove(s.id); setShowMenu(false) }}
                  >
                    <span className="inline-block w-2 h-2 rounded-full mr-2" style={{ background: s.color }} />
                    {s.label}
                  </button>
                ))}
              </div>
              <div style={{ borderTop: '1px solid #2E2E2E' }} className="p-1">
                <button
                  className="w-full text-left px-3 py-2 text-xs rounded-lg"
                  style={{ color: '#EF4444' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.12)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  onClick={() => { onDelete(); setShowMenu(false) }}
                >
                  Delete deal
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {deal.value != null && deal.value > 0 && (
        <div className="text-xs font-bold mb-1" style={{ color: '#A78BFA' }}>
          ${deal.value.toLocaleString()}
        </div>
      )}
      {deal.expected_close_date && (
        <div className="text-xs" style={{ color: '#A0A0A0' }}>
          Close: {new Date(deal.expected_close_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </div>
      )}
      {deal.notes && (
        <div className="text-xs mt-1" style={{ color: '#6B6B6B', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {deal.notes}
        </div>
      )}
      {(deal.tags || []).length > 0 && (
        <div className="flex gap-1 flex-wrap mt-2">
          {(deal.tags || []).slice(0, 3).map(t => (
            <span key={t} className="px-1.5 py-0.5 rounded text-[10px]"
              style={{ background: 'rgba(124,58,237,0.12)', color: '#A78BFA' }}>{t}</span>
          ))}
        </div>
      )}
    </div>
  )
}

function DealForm({
  initialStage, onClose, onSave,
}: {
  initialStage: DealStage
  onClose: () => void
  onSave: (data: Omit<CRMDeal, 'id' | 'created_at' | 'updated_at'>) => Promise<void>
}) {
  const [form, setForm] = useState<Partial<CRMDeal>>({ title: '', stage: initialStage })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tagInput, setTagInput] = useState('')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function set(field: keyof CRMDeal, value: any) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  function addTag() {
    const t = tagInput.trim()
    if (!t) return
    const current = form.tags || []
    if (!current.includes(t)) set('tags', [...current, t])
    setTagInput('')
  }

  function removeTag(t: string) {
    set('tags', (form.tags || []).filter(x => x !== t))
  }

  async function handleSave() {
    if (!form.title?.trim()) { setError('Title is required'); return }
    setSaving(true)
    setError(null)
    try {
      await onSave({
        title: form.title!,
        stage: form.stage || 'lead',
        value: form.value,
        notes: form.notes,
        expected_close_date: form.expected_close_date,
        property_id: form.property_id,
        contact_id: form.contact_id,
        tags: form.tags,
      })
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setError(err?.response?.data?.detail ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="rounded-lg p-6 w-full" style={{ maxWidth: '440px', background: '#1A1A1A', border: '1px solid #2E2E2E' }}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="section-heading">New Deal</h2>
          <button onClick={onClose} style={{ color: '#6B6B6B', fontSize: '18px', lineHeight: 1 }}>✕</button>
        </div>

        {error && (
          <div className="mb-3 p-3 rounded-lg text-sm" style={{ background: 'rgba(239,68,68,0.12)', color: '#F87171', border: '1px solid rgba(239,68,68,0.3)' }}>
            {error}
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="label-caps">Title *</label>
            <input
              type="text" className="input-base mt-1"
              value={form.title || ''}
              onChange={e => set('title', e.target.value)}
              placeholder="e.g. Smith Farm — 40ac TX"
              autoFocus
            />
          </div>

          <div>
            <label className="label-caps">Stage</label>
            <select className="input-base mt-1" value={form.stage || 'lead'} onChange={e => set('stage', e.target.value as DealStage)}>
              {STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>

          <div>
            <label className="label-caps">Value ($)</label>
            <input
              type="number" className="input-base mt-1"
              value={form.value != null ? String(form.value) : ''}
              onChange={e => set('value', e.target.value ? parseFloat(e.target.value) : undefined)}
              placeholder="0" min="0"
            />
          </div>

          <div>
            <label className="label-caps">Expected Close Date</label>
            <input type="date" className="input-base mt-1" value={form.expected_close_date || ''}
              onChange={e => set('expected_close_date', e.target.value || undefined)} />
          </div>

          <div>
            <label className="label-caps">Notes</label>
            <textarea
              className="mt-1"
              rows={3}
              value={form.notes || ''}
              onChange={e => set('notes', e.target.value || undefined)}
              style={{
                width: '100%', padding: '8px 12px',
                background: '#242424', border: '1.5px solid #2E2E2E',
                borderRadius: '6px', fontSize: '13px',
                fontFamily: "'Montserrat', sans-serif",
                color: '#F5F5F5', outline: 'none', resize: 'vertical',
              }}
            />
          </div>

          <div>
            <label className="label-caps">Tags</label>
            <div className="flex gap-2 mt-1">
              <input
                type="text" className="input-base"
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addTag() }}
                placeholder="Add tag, press Enter"
              />
              <button className="btn-secondary" style={{ padding: '0 14px', flexShrink: 0 }} onClick={addTag}>Add</button>
            </div>
            {(form.tags || []).length > 0 && (
              <div className="flex gap-2 mt-2 flex-wrap">
                {(form.tags || []).map(t => (
                  <span key={t} className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs"
                    style={{ background: 'rgba(124,58,237,0.12)', color: '#A78BFA', border: '1px solid rgba(124,58,237,0.25)' }}>
                    {t}
                    <button onClick={() => removeTag(t)} style={{ color: '#6B6B6B', lineHeight: 1 }}>×</button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-2 mt-6">
          <button className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
          <button className="btn-primary flex-1" onClick={handleSave} disabled={saving}>
            {saving ? 'Creating…' : 'Create Deal'}
          </button>
        </div>
      </div>
    </div>
  )
}
