import React, { useEffect, useRef, useState } from 'react'
import { useApp } from '../context/AppContext'
import { listCrmCampaigns, createCrmCampaign, deleteCrmCampaign } from '../api/crm'
import type { CRMCampaign } from '../types/crm'

export default function CRMCampaigns() {
  const { setCurrentPage, setPropertyCampaignId } = useApp()
  const [campaigns, setCampaigns] = useState<CRMCampaign[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Create new campaign
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // Delete confirm
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => { fetchCampaigns() }, [])

  async function fetchCampaigns() {
    setLoading(true)
    setError(null)
    try {
      setCampaigns(await listCrmCampaigns())
    } catch {
      setError('Failed to load campaigns.')
    } finally {
      setLoading(false)
    }
  }

  async function handleCreate() {
    if (!newName.trim()) return
    setCreating(true)
    setCreateError(null)
    try {
      const camp = await createCrmCampaign(newName.trim())
      setCampaigns(prev => [camp, ...prev])
      setNewName('')
    } catch {
      setCreateError('Failed to create campaign.')
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteCrmCampaign(id)
      setCampaigns(prev => prev.filter(c => c.id !== id))
    } catch {
      setError('Failed to delete campaign.')
    } finally {
      setDeletingId(null)
    }
  }

  function viewProperties(campaignId: string) {
    setPropertyCampaignId(campaignId)
    setCurrentPage('crm-properties')
  }

  function formatDate(iso: string) {
    try {
      return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    } catch { return iso }
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">CRM Campaigns</h1>
          <p className="page-subtitle">{campaigns.length} import campaign{campaigns.length !== 1 ? 's' : ''}</p>
        </div>
        <button className="btn-secondary" onClick={fetchCampaigns} disabled={loading}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="23 4 23 10 17 10"/>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
          Refresh
        </button>
      </div>

      <div className="p-6 max-w-5xl">
        {/* Create new campaign */}
        <div className="card mb-6">
          <h2 className="section-heading mb-3">New Campaign</h2>
          <div className="flex gap-3">
            <input
              type="text"
              className="input-base flex-1"
              placeholder="e.g. Brunswick County March 2026"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              disabled={creating}
              maxLength={80}
            />
            <button
              className="btn-primary flex-none"
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
            >
              {creating ? 'Creating…' : 'Create Campaign'}
            </button>
          </div>
          {createError && <p className="text-sm mt-2" style={{ color: '#B71C1C' }}>{createError}</p>}
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg text-sm" style={{ background: '#FFF0F0', color: '#B71C1C', border: '1px solid #FFCDD2' }}>
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="text-sm" style={{ color: '#6B5B8A' }}>Loading campaigns…</div>
          </div>
        ) : campaigns.length === 0 ? (
          <div className="text-center py-16" style={{ color: '#6B5B8A' }}>
            <svg className="mx-auto mb-4 opacity-30" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            <p className="text-sm">No campaigns yet.</p>
            <p className="text-xs mt-1">Create a campaign, then import a CSV and assign it.</p>
          </div>
        ) : (
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
            {campaigns.map(camp => (
              <CampaignCard
                key={camp.id}
                campaign={camp}
                formatDate={formatDate}
                isDeletingThis={deletingId === camp.id}
                onDeleteStart={() => setDeletingId(camp.id)}
                onDeleteConfirm={() => handleDelete(camp.id)}
                onDeleteCancel={() => setDeletingId(null)}
                onViewProperties={() => viewProperties(camp.id)}
                onImport={() => {
                  setPropertyCampaignId(camp.id)
                  setCurrentPage('crm-properties')
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function CampaignCard({
  campaign: c,
  formatDate,
  isDeletingThis,
  onDeleteStart,
  onDeleteConfirm,
  onDeleteCancel,
  onViewProperties,
}: {
  campaign: CRMCampaign
  formatDate: (s: string) => string
  isDeletingThis: boolean
  onDeleteStart: () => void
  onDeleteConfirm: () => void
  onDeleteCancel: () => void
  onViewProperties: () => void
  onImport: () => void
}) {
  const count = c.property_count ?? 0

  return (
    <div
      className="bg-white rounded-xl overflow-hidden"
      style={{ border: '1px solid #EDE8F5', boxShadow: '0 1px 4px rgba(61,26,94,0.06)', borderTop: '4px solid #5C2977' }}
    >
      <div className="px-5 pt-4 pb-3">
        <h3 className="font-semibold text-sm truncate" style={{ color: '#1A0A2E' }}>{c.name}</h3>
        <p className="text-xs mt-0.5" style={{ color: '#9B8AAE' }}>{formatDate(c.created_at)}</p>
      </div>

      {/* Property count stat */}
      <div className="mx-5 mb-4 rounded-lg px-4 py-3 text-center" style={{ background: '#F8F5FC' }}>
        <p className="text-2xl font-bold" style={{ color: '#5C2977' }}>{count.toLocaleString()}</p>
        <p className="text-xs mt-0.5" style={{ color: '#9B8AAE' }}>Properties</p>
      </div>

      {/* Actions */}
      <div className="flex gap-2 px-5 pb-4">
        <button
          className="flex-1 text-sm font-semibold rounded-lg py-2"
          style={{ background: '#5C2977', color: '#fff' }}
          onClick={onViewProperties}
        >
          View Properties
        </button>

        {isDeletingThis ? (
          <div className="flex items-center gap-1">
            <span className="text-xs" style={{ color: '#dc2626' }}>Delete?</span>
            <button
              className="text-xs px-2 py-1 rounded font-medium"
              style={{ background: 'rgba(239,68,68,0.12)', color: '#dc2626', border: '1px solid rgba(239,68,68,0.3)' }}
              onClick={onDeleteConfirm}
            >
              Yes
            </button>
            <button className="btn-secondary text-xs py-1 px-2" onClick={onDeleteCancel}>No</button>
          </div>
        ) : (
          <button
            className="px-3 py-2 rounded-lg transition-colors"
            style={{ color: '#9B8AAE', border: '1px solid #EDE8F5' }}
            onClick={onDeleteStart}
            onMouseEnter={e => (e.currentTarget.style.color = '#dc2626')}
            onMouseLeave={e => (e.currentTarget.style.color = '#9B8AAE')}
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
