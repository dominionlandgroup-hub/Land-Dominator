import React, { useEffect, useState } from 'react'
import { listCrmCampaigns, createCrmCampaign, deleteCrmCampaign } from '../api/crm'
import type { CRMCampaign } from '../types/crm'
import CampaignDetail from './CampaignDetail'

type View = 'list' | 'detail'

export default function CRMCampaigns() {
  const [view, setView] = useState<View>('list')
  const [selectedCampaign, setSelectedCampaign] = useState<CRMCampaign | null>(null)

  const [campaigns, setCampaigns] = useState<CRMCampaign[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [showNewForm, setShowNewForm] = useState(false)

  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => { fetchCampaigns() }, [])

  async function fetchCampaigns() {
    setLoading(true)
    setError(null)
    try { setCampaigns(await listCrmCampaigns()) }
    catch { setError('Failed to load campaigns.') }
    finally { setLoading(false) }
  }

  async function handleCreate() {
    if (!newName.trim()) return
    setCreating(true)
    setCreateError(null)
    try {
      const camp = await createCrmCampaign(newName.trim())
      setCampaigns(prev => [camp, ...prev])
      setNewName('')
      setShowNewForm(false)
    } catch { setCreateError('Failed to create campaign.') }
    finally { setCreating(false) }
  }

  async function handleDelete(id: string) {
    try {
      await deleteCrmCampaign(id)
      setCampaigns(prev => prev.filter(c => c.id !== id))
    } catch { setError('Failed to delete campaign.') }
    finally { setDeletingId(null) }
  }

  function openDetail(camp: CRMCampaign) {
    setSelectedCampaign(camp)
    setView('detail')
  }

  function handleCampaignUpdated(updated: CRMCampaign) {
    setCampaigns(prev => prev.map(c => c.id === updated.id ? updated : c))
    if (selectedCampaign?.id === updated.id) setSelectedCampaign(updated)
  }

  function formatDate(iso: string) {
    try {
      return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    } catch { return iso }
  }

  // ── Detail view ─────────────────────────────────────────────────────
  if (view === 'detail' && selectedCampaign) {
    return (
      <CampaignDetail
        campaign={selectedCampaign}
        onBack={() => setView('list')}
        onCampaignUpdated={handleCampaignUpdated}
      />
    )
  }

  // ── List view ────────────────────────────────────────────────────────
  return (
    <div style={{ background: '#F8F6FB', minHeight: '100vh' }}>
      {/* Header */}
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Campaigns</h1>
          <p className="page-subtitle">{campaigns.length} campaign{campaigns.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-secondary" onClick={fetchCampaigns} disabled={loading}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 4 23 10 17 10"/>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
            </svg>
            Refresh
          </button>
          <button className="btn-primary" onClick={() => setShowNewForm(v => !v)}>
            + New Campaign
          </button>
        </div>
      </div>

      <div className="p-6">
        {/* New campaign form */}
        {showNewForm && (
          <div className="card mb-6" style={{ maxWidth: '520px' }}>
            <h2 className="section-heading mb-3">New Campaign</h2>
            <div className="flex gap-3">
              <input
                type="text"
                className="input-base flex-1 text-sm"
                placeholder="e.g. Brunswick County April 2026"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreate()}
                disabled={creating}
                maxLength={80}
                autoFocus
              />
              <button className="btn-primary flex-none" onClick={handleCreate} disabled={creating || !newName.trim()}>
                {creating ? 'Creating…' : 'Create'}
              </button>
              <button className="btn-secondary flex-none" onClick={() => { setShowNewForm(false); setNewName('') }}>
                Cancel
              </button>
            </div>
            {createError && <p className="text-sm mt-2" style={{ color: '#B71C1C' }}>{createError}</p>}
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 rounded-lg text-sm" style={{ background: '#FFF0F0', color: '#B71C1C', border: '1px solid #FFCDD2' }}>
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-sm" style={{ color: '#6B5B8A' }}>Loading campaigns…</div>
          </div>
        ) : campaigns.length === 0 ? (
          <div className="text-center py-20" style={{ color: '#6B5B8A' }}>
            <svg className="mx-auto mb-4 opacity-30" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            <p className="text-sm font-medium">No campaigns yet</p>
            <p className="text-xs mt-1">Create a campaign, then import a property list</p>
            <button className="btn-primary mt-4" onClick={() => setShowNewForm(true)}>+ New Campaign</button>
          </div>
        ) : (
          <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}>
            {campaigns.map(camp => (
              <CampaignCard
                key={camp.id}
                campaign={camp}
                formatDate={formatDate}
                isDeletingThis={deletingId === camp.id}
                onOpen={() => openDetail(camp)}
                onDeleteStart={() => setDeletingId(camp.id)}
                onDeleteConfirm={() => handleDelete(camp.id)}
                onDeleteCancel={() => setDeletingId(null)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Campaign Card ──────────────────────────────────────────────────────────

function CampaignCard({
  campaign: c,
  formatDate,
  isDeletingThis,
  onOpen,
  onDeleteStart,
  onDeleteConfirm,
  onDeleteCancel,
}: {
  campaign: CRMCampaign
  formatDate: (s: string) => string
  isDeletingThis: boolean
  onOpen: () => void
  onDeleteStart: () => void
  onDeleteConfirm: () => void
  onDeleteCancel: () => void
}) {
  const bs = c.by_status ?? {}
  const offers = bs.offer_sent ?? 0
  const purchases = bs.under_contract ?? 0
  const sales = bs.closed_won ?? 0
  const deals = offers + purchases + sales
  const total = c.property_count ?? 0

  const STATS = [
    { label: 'Amount Spent', value: '$0' },
    { label: 'Deals', value: deals.toLocaleString() },
    { label: 'Response Rate', value: '0%' },
    { label: 'Offers', value: offers.toLocaleString() },
    { label: 'Purchases', value: purchases.toLocaleString() },
    { label: 'Sales', value: sales.toLocaleString() },
  ]

  return (
    <div
      className="bg-white rounded-xl flex flex-col overflow-hidden"
      style={{ border: '1px solid #EDE8F5', boxShadow: '0 2px 8px rgba(61,26,94,0.07)' }}
    >
      {/* Card header — clickable */}
      <div
        className="px-5 pt-4 pb-3 cursor-pointer transition-colors"
        onClick={onOpen}
        onMouseEnter={e => (e.currentTarget.style.background = '#FAF7FD')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-semibold text-sm leading-snug" style={{ color: '#1A0A2E' }}>{c.name}</h3>
            <p className="text-xs mt-0.5" style={{ color: '#9B8AAE' }}>{formatDate(c.created_at)}</p>
          </div>
          <div className="flex-none text-right">
            <div className="text-lg font-bold" style={{ color: '#5C2977' }}>{total.toLocaleString()}</div>
            <div className="text-[10px]" style={{ color: '#9B8AAE' }}>records</div>
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div
        className="grid mx-5 mb-4 rounded-lg overflow-hidden"
        style={{ gridTemplateColumns: 'repeat(3, 1fr)', background: '#EDE8F5', gap: '1px' }}
      >
        {STATS.map(s => (
          <div key={s.label} className="px-3 py-2.5 text-center" style={{ background: '#FAFAFE' }}>
            <div className="text-sm font-bold" style={{ color: '#1A0A2E' }}>{s.value}</div>
            <div style={{ fontSize: '9px', color: '#9B8AAE', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: '2px' }}>
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 px-5 pb-4 mt-auto">
        <button
          className="flex-1 text-sm font-semibold py-2 rounded-lg transition-opacity hover:opacity-90"
          style={{ background: 'transparent', color: '#5C2977', border: '1.5px solid #5C2977' }}
          onClick={onOpen}
        >
          Import List
        </button>
        <button
          className="flex-1 text-sm font-semibold py-2 rounded-lg flex items-center justify-center gap-1.5 transition-opacity"
          style={{ background: '#5C2977', color: '#fff', opacity: 0.45, cursor: 'not-allowed' }}
          disabled
        >
          Start Mailing
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
        </button>

        {isDeletingThis ? (
          <div className="flex items-center gap-1">
            <button
              className="text-xs px-2 py-1.5 rounded font-semibold"
              style={{ background: 'rgba(183,28,28,0.1)', color: '#B71C1C', border: '1px solid rgba(183,28,28,0.25)' }}
              onClick={onDeleteConfirm}
            >
              Delete
            </button>
            <button className="btn-secondary text-xs py-1.5 px-2" onClick={onDeleteCancel}>No</button>
          </div>
        ) : (
          <button
            className="px-3 rounded-lg transition-all"
            style={{ color: '#C4B5D8', border: '1px solid #EDE8F5' }}
            onClick={e => { e.stopPropagation(); onDeleteStart() }}
            onMouseEnter={e => { e.currentTarget.style.color = '#B71C1C'; e.currentTarget.style.borderColor = 'rgba(183,28,28,0.3)' }}
            onMouseLeave={e => { e.currentTarget.style.color = '#C4B5D8'; e.currentTarget.style.borderColor = '#EDE8F5' }}
            title="Delete campaign"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6M14 11v6"/>
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}
