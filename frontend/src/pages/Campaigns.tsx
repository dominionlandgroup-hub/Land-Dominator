import React, { useEffect, useState } from 'react'
import LoadingSpinner from '../components/LoadingSpinner'
import { useApp } from '../context/AppContext'
import {
  listCampaigns,
  createCampaign,
  renameCampaign,
  updateCampaignNotes,
  deleteCampaign,
  getCampaignDownloadUrl,
} from '../api/client'
import type { Campaign, MatchFilters } from '../types'

export default function Campaigns() {
  const { matchResult, lastFilters, setLastFilters, setCurrentPage } = useApp()

  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Save new campaign
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)

  // Rename
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  // Delete confirmation modal
  const [confirmDeleteCampaign, setConfirmDeleteCampaign] = useState<Campaign | null>(null)

  // Comparison mode
  const [compareIds, setCompareIds] = useState<string[]>([])
  const [showCompare, setShowCompare] = useState(false)

  useEffect(() => { fetchList() }, [])

  async function fetchList() {
    setLoading(true)
    setError(null)
    try {
      const list = await listCampaigns()
      setCampaigns(list)
    } catch {
      setError('Failed to load campaigns.')
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    if (!matchResult || !newName.trim()) return
    setSaving(true)
    setSaveError(null)
    try {
      const camp = await createCampaign(newName.trim(), matchResult.match_id, lastFilters ?? {})
      setCampaigns((prev) => [camp, ...prev])
      setSavedId(camp.id)
      setNewName('')
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail ?? 'Failed to save campaign.'
      setSaveError(msg)
    } finally {
      setSaving(false)
    }
  }

  async function handleRename(id: string) {
    if (!renameValue.trim()) return
    try {
      const updated = await renameCampaign(id, renameValue.trim())
      setCampaigns((prev) => prev.map((c) => (c.id === id ? updated : c)))
      setRenamingId(null)
      setRenameValue('')
    } catch {
      // silently ignore
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteCampaign(id)
      setCampaigns((prev) => prev.filter((c) => c.id !== id))
      if (compareIds.includes(id)) setCompareIds((prev) => prev.filter((i) => i !== id))
    } catch {
      setError('Failed to delete campaign.')
    } finally {
      setConfirmDeleteCampaign(null)
    }
  }

  function handleDuplicateSettings(camp: Campaign) {
    const filters = ((camp.settings?.filters as Partial<MatchFilters> | undefined) ?? (camp.settings as Partial<MatchFilters> | undefined))
    if (filters) {
      setLastFilters(filters)
    }
    setCurrentPage('match-targets')
  }

  function toggleCompare(id: string) {
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((i) => i !== id)
      if (prev.length >= 2) return [prev[1], id] // keep newest 2
      return [...prev, id]
    })
  }

  function formatDate(iso: string): string {
    try {
      return new Date(iso).toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    } catch { return iso }
  }

  const compareCampaigns = campaigns.filter((c) => compareIds.includes(c.id))

  return (
    <div className="flex flex-col min-h-screen">
      {/* Page header */}
      <div className="page-header">
        <div>
          <h1 className="text-lg font-semibold" style={{ color: '#1A0A2E' }}>Campaigns</h1>
          <p className="text-xs mt-0.5" style={{ color: '#6B5B8A' }}>
            {campaigns.length} savedcampaign{campaigns.length !== 1 ? 's' : ''} · Re-download CSVs anytime
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="btn-secondary text-sm"
            onClick={fetchList}
            disabled={loading}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 4 23 10 17 10"/>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
            </svg>
            Refresh
          </button>
          {compareIds.length > 0 && (
            <button
              className="btn-secondary text-sm"
              onClick={() => setShowCompare((v) => !v)}
            >
              {showCompare ? 'Hide Compare' : `Compare (${compareIds.length}/2)`}
            </button>
          )}
        </div>
      </div>

      <div className="p-6 max-w-5xl mx-auto w-full">
        {/* Save current run */}
        {matchResult ? (
          <div className="card mb-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold" style={{ color: '#1A0A2E' }}>Save Current Run</h2>
              <span className="text-xs px-2.5 py-1 rounded-full" style={{ background: 'rgba(92,41,119,0.08)', color: '#5C2977', border: '1px solid rgba(92,41,119,0.2)' }}>
                {matchResult.matched_count.toLocaleString()} matched parcels
              </span>
            </div>
            <div className="flex gap-3">
              <input
                type="text"
                className="input-base flex-1"
                placeholder="e.g. Brunswick Final March 2026"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                disabled={saving}
                maxLength={80}
              />
              <button
                className="btn-primary flex-none"
                onClick={handleSave}
                disabled={saving || !newName.trim()}
              >
                {saving ? <><LoadingSpinner size="sm" /> Saving…</> : 'Save Campaign'}
              </button>
            </div>
            {saveError && <p className="text-sm mt-2" style={{ color: '#dc2626' }}>{saveError}</p>}
            {savedId && (
              <p className="text-sm mt-2" style={{ color: '#2D7A4F' }}>
                Campaign saved successfully.
              </p>
            )}
          </div>
        ) : (
          <div
            className="rounded-xl px-5 py-4 mb-6 text-sm text-center"
            style={{ background: '#F8F6FB', border: '1px dashed #E8E0F0', color: '#6B5B8A' }}
          >
            Run the matching engine to save a new campaign.{' '}
            <button className="underline" style={{ color: '#5C2977' }} onClick={() => setCurrentPage('match-targets')}>
              Go to Match Targets →
            </button>
          </div>
        )}

        {error && (
          <div className="rounded-xl px-5 py-4 mb-6 text-sm" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.3)', color: '#dc2626' }}>
            {error}
          </div>
        )}

        {/* Compare panel */}
        {showCompare && compareCampaigns.length === 2 && (
          <div className="card mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold" style={{ color: '#1A0A2E' }}>Campaign Comparison</h2>
              <button className="text-xs" style={{ color: '#6B5B8A' }} onClick={() => setShowCompare(false)}>
                × Close
              </button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {compareCampaigns.map((camp) => (
                <CompareCard key={camp.id} campaign={camp} formatDate={formatDate} />
              ))}
            </div>
          </div>
        )}
        {showCompare && compareCampaigns.length < 2 && (
          <div className="rounded-xl px-5 py-4 mb-6 text-sm" style={{ background: '#F8F6FB', border: '1px solid #E8E0F0', color: '#6B5B8A' }}>
            Select 2 campaignsbelow to compare them side by side.
          </div>
        )}

        {/* Campaign cards */}
        {loading ? (
          <div className="flex justify-center py-16">
            <LoadingSpinner size="lg" label="Loading campaigns…" />
          </div>
        ) : campaigns.length === 0 ? (
          <div className="text-center py-16" style={{ color: '#6B5B8A' }}>
            <svg className="mx-auto mb-4 opacity-30" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            <p className="text-sm">No campaigns saved yet.</p>
            <p className="text-xs mt-1">Run the matching engine and save your first campaign.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {campaigns.map((camp) => (
              <CampaignCard
                key={camp.id}
                campaign={camp}
                formatDate={formatDate}
                isNew={camp.id === savedId}
                isSelectedForCompare={compareIds.includes(camp.id)}
                renamingId={renamingId}
                renameValue={renameValue}
                onRenameStart={() => { setRenamingId(camp.id); setRenameValue(camp.name) }}
                onRenameChange={setRenameValue}
                onRenameSubmit={() => handleRename(camp.id)}
                onRenameCancel={() => setRenamingId(null)}
                onDeleteStart={() => setConfirmDeleteCampaign(camp)}
                onDuplicateSettings={() => handleDuplicateSettings(camp)}
                onToggleCompare={() => toggleCompare(camp.id)}
                onImportList={() => setCurrentPage('upload-comps')}
              />
            ))}
          </div>
        )}
      </div>

      {confirmDeleteCampaign && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(26,10,46,0.55)' }}
          onClick={e => { if (e.target === e.currentTarget) setConfirmDeleteCampaign(null) }}
        >
          <div className="rounded-xl bg-white shadow-xl" style={{ width: 420, maxWidth: '95vw', padding: 24, border: '1px solid #E8E0F0' }}>
            <div className="flex items-center gap-3 mb-4">
              <div style={{ width: 36, height: 36, borderRadius: 8, background: '#FEE2E2', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                  <path d="M10 11v6M14 11v6"/>
                </svg>
              </div>
              <div>
                <h2 className="text-sm font-bold" style={{ color: '#1A0A2E' }}>Delete Campaign?</h2>
                <p className="text-xs mt-0.5" style={{ color: '#6B5B8A' }}>This action cannot be undone.</p>
              </div>
            </div>
            <div className="rounded-lg p-3 mb-4" style={{ background: '#FEF2F2', border: '1px solid rgba(220,38,38,0.2)' }}>
              <p className="text-sm font-semibold mb-1" style={{ color: '#1A0A2E' }}>{confirmDeleteCampaign.name}</p>
              <p className="text-xs" style={{ color: '#DC2626' }}>
                This will permanently delete all{' '}
                {Number(confirmDeleteCampaign.stats?.mailing_list_count ?? confirmDeleteCampaign.stats?.matched_count ?? 0).toLocaleString()} properties and all associated records.
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <button className="btn-secondary" onClick={() => setConfirmDeleteCampaign(null)}>Cancel</button>
              <button
                className="text-sm px-4 py-2 rounded-lg font-semibold"
                style={{ background: '#DC2626', color: '#FFFFFF' }}
                onClick={() => handleDelete(confirmDeleteCampaign.id)}
              >
                Delete Campaign
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Campaign Card ──────────────────────────────────────────────────────────────

function CampaignCard({
  campaign: camp,
  formatDate,
  isNew,
  isSelectedForCompare,
  renamingId,
  renameValue,
  onRenameStart,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
  onDeleteStart,
  onDuplicateSettings,
  onToggleCompare,
  onImportList,
}: {
  campaign: Campaign
  formatDate: (s: string) => string
  isNew: boolean
  isSelectedForCompare: boolean
  renamingId: string | null
  renameValue: string
  onRenameStart: () => void
  onRenameChange: (v: string) => void
  onRenameSubmit: () => void
  onRenameCancel: () => void
  onDeleteStart: () => void
  onDuplicateSettings: () => void
  onToggleCompare: () => void
  onImportList: () => void
}) {
  const filtersObj = ((camp.settings?.filters as Record<string, unknown> | undefined) ?? (camp.settings as Record<string, unknown> | undefined) ?? {})
  const hasFilters = Object.keys(filtersObj).length > 0
  const totalRecords = Number(camp.stats?.mailing_list_count ?? camp.stats?.matched_count ?? 0)
  const [notes, setNotes] = useState(camp.notes || '')
  const [savingNotes, setSavingNotes] = useState(false)

  async function saveNotes() {
    setSavingNotes(true)
    try {
      await updateCampaignNotes(camp.id, notes)
    } finally {
      setSavingNotes(false)
    }
  }

  return (
    <div
      className="rounded-xl bg-white transition-all"
      style={{
        border: `1px solid ${isNew ? 'rgba(45,122,79,0.25)' : isSelectedForCompare ? '#4F46E5' : '#EDE8F5'}`,
        boxShadow: '0 1px 4px rgba(61,26,94,0.06)',
        borderTop: `4px solid ${isNew ? '#2D7A4F' : '#5C2977'}`,
      }}
    >
      {/* Card header */}
      <div className="px-5 py-4">
        {renamingId === camp.id ? (
          <div className="flex gap-2">
            <input
              type="text"
              className="input-base text-sm py-1.5 flex-1"
              value={renameValue}
              onChange={(e) => onRenameChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onRenameSubmit()
                if (e.key === 'Escape') onRenameCancel()
              }}
              autoFocus
              maxLength={80}
            />
            <button className="btn-primary text-xs py-1 px-3" onClick={onRenameSubmit}>Save</button>
            <button className="btn-secondary text-xs py-1 px-3" onClick={onRenameCancel}>Cancel</button>
          </div>
        ) : (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-semibold text-sm truncate" style={{ color: '#1A0A2E' }}>{camp.name}</h3>
                {isNew && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
                    style={{ background: 'rgba(45,122,79,0.1)', color: '#2D7A4F', border: '1px solid rgba(45,122,79,0.2)' }}>
                    NEW
                  </span>
                )}
              </div>
              <p className="text-xs mt-0.5" style={{ color: '#9B8AAE' }}>{formatDate(camp.created_at)}</p>
            </div>
          </div>
        )}
      </div>

      {/* Stat grid */}
      <div className="grid grid-cols-3 gap-px mx-5 mb-4 rounded-lg overflow-hidden" style={{ background: '#F0EBF8' }}>
        {[
          { label: 'Amount Spent', value: '—' },
          { label: 'Total Records', value: totalRecords > 0 ? totalRecords.toLocaleString() : '—' },
          { label: 'Response Rate', value: '—' },
        ].map((s) => (
          <div key={s.label} className="px-4 py-3 text-center" style={{ background: '#FAFAFE' }}>
            <p className="text-base font-bold" style={{ color: '#1A0A2E' }}>{s.value}</p>
            <p style={{ fontSize: '10px', color: '#9B8AAE', marginTop: '2px' }}>{s.label}</p>
          </div>
        ))}
      </div>

      {/* Primary action buttons */}
      <div className="flex gap-2 px-5 pb-4">
        {camp.has_output ? (
          <a
            href={getCampaignDownloadUrl(camp.id)}
            download
            className="flex-1 text-center text-sm font-semibold rounded-lg py-2 transition-opacity hover:opacity-90 no-underline"
            style={{ background: '#5C2977', color: '#FFFFFF' }}
          >
            Start Mailing
          </a>
        ) : (
          <button
            className="flex-1 text-sm font-semibold rounded-lg py-2 transition-opacity hover:opacity-90"
            style={{ background: '#5C2977', color: '#FFFFFF', opacity: 0.4, cursor: 'not-allowed' }}
            disabled
          >
            Start Mailing
          </button>
        )}
        <button
          onClick={onImportList}
          className="flex-1 text-sm font-semibold rounded-lg py-2 transition-all hover:opacity-90"
          style={{ background: 'transparent', color: '#5C2977', border: '1.5px solid #5C2977' }}
        >
          Import List
        </button>
      </div>

      {/* Secondary actions */}
      {renamingId !== camp.id && (
        <div className="flex items-center gap-1.5 px-5 pb-4 flex-wrap">
          {hasFilters && (
            <button className="btn-secondary text-xs" onClick={onDuplicateSettings}>
              Duplicate Settings
            </button>
          )}
          <button
            className="btn-secondary text-xs"
            onClick={onToggleCompare}
            style={isSelectedForCompare ? { borderColor: '#4F46E5', color: '#4F46E5' } : {}}
          >
            {isSelectedForCompare ? 'Deselect' : 'Compare'}
          </button>
          <button className="btn-secondary text-xs" onClick={onRenameStart}>
            Rename
          </button>
          <button
            className="text-xs px-2 py-1 rounded-lg ml-auto transition-colors"
            style={{ color: '#9B8AAE' }}
            onClick={onDeleteStart}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#dc2626')}
            onMouseLeave={(e) => (e.currentTarget.style.color = '#9B8AAE')}
            title="Delete campaign"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6"/><path d="M14 11v6"/>
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
            </svg>
          </button>
        </div>
      )}

      {/* Notes */}
      <div className="px-5 pb-4">
        <textarea
          className="input-base text-xs min-h-[60px]"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={saveNotes}
          placeholder="Add notes, e.g. Sent to printer March 15"
        />
        {savingNotes && <p className="text-[11px] mt-1" style={{ color: '#9B8AAE' }}>Saving…</p>}
      </div>
    </div>
  )
}

// ── Compare Card ───────────────────────────────────────────────────────────────

function CompareCard({ campaign: camp, formatDate }: { campaign: Campaign; formatDate: (s: string) => string }) {
  const filters = camp.settings?.filters as Record<string, unknown> | undefined

  const statRows: { label: string; value: string; color?: string }[] = []
  if (camp.stats.matched_count != null)
    statRows.push({ label: 'Matched Parcels', value: Number(camp.stats.matched_count).toLocaleString(), color: '#5C2977' })
  if (camp.stats.mailing_list_count != null)
    statRows.push({ label: 'Mailing List', value: Number(camp.stats.mailing_list_count).toLocaleString(), color: '#2D7A4F' })

  return (
    <div className="rounded-xl p-4" style={{ background: '#F8F6FB', border: '1px solid #E8E0F0' }}>
      <h3 className="font-semibold mb-1 truncate" style={{ color: '#1A0A2E' }}>{camp.name}</h3>
      <p className="text-xs mb-4" style={{ color: '#6B5B8A' }}>{formatDate(camp.created_at)}</p>

      {statRows.length > 0 && (
        <div className="space-y-2 mb-4">
          {statRows.map((row) => (
            <div key={row.label} className="flex justify-between items-center">
              <span className="text-xs" style={{ color: '#6B5B8A' }}>{row.label}</span>
              <span className="text-sm font-bold" style={{ color: row.color ?? '#3D2B5E' }}>{row.value}</span>
            </div>
          ))}
        </div>
      )}

      {filters && Object.keys(filters).length > 0 && (
        <div style={{ borderTop: '1px solid #E8E0F0', paddingTop: '12px' }}>
          <p className="text-xs font-medium mb-2" style={{ color: '#6B5B8A' }}>Filter Settings</p>
          <div className="space-y-1">
            {Object.entries(filters).slice(0, 8).map(([k, v]) => (
              v != null && v !== false && (
                <div key={k} className="flex justify-between items-center">
                  <span className="text-xs" style={{ color: '#6B5B8A' }}>
                    {k.replace(/_/g, ' ')}
                  </span>
                  <span className="text-xs font-medium" style={{ color: '#6B5B8A' }}>
                    {String(v)}
                  </span>
                </div>
              )
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function buildFilterSummary(filters: Record<string, unknown>): string {
  const radius = Number(filters.radius_miles ?? 10)
  const tol = Number(filters.acreage_tolerance_pct ?? 50)
  const zips = Array.isArray(filters.zip_filter) ? filters.zip_filter.filter(Boolean).join(', ') : 'All'
  const score = Number(filters.min_match_score ?? 0)
  return `${radius}mi | ±${tol}% acreage | ZIPs: ${zips} | Score >= ${score}`
}

function buildOfferSummary(stats: Record<string, unknown>): string {
  const min = Number(stats.offer_min ?? 0)
  const max = Number(stats.offer_max ?? 0)
  const med = Number(stats.offer_median ?? 0)
  if (!min && !max && !med) {
    return 'Offers ranging N/A, median N/A'
  }
  const fmt = (v: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
  return `Offers ranging ${fmt(min)}-${fmt(max)}, median ${fmt(med)}`
}
