import React, { useEffect, useMemo, useState } from 'react'
import { listCrmCampaigns, createCrmCampaign, deleteCrmCampaign } from '../api/crm'
import type { CRMCampaign } from '../types/crm'
import CampaignDetail from './CampaignDetail'

type View = 'list' | 'detail'
type SortKey = 'name' | 'created_at' | 'property_count' | 'deals' | 'response_rate' | 'offers' | 'purchases' | 'sales'

function getStats(c: CRMCampaign) {
  const bs = c.by_status ?? {}
  const offers = bs.offer_sent ?? 0
  const purchases = bs.under_contract ?? 0
  const sales = bs.closed_won ?? 0
  const deals = offers + purchases + sales
  const total = c.property_count ?? 0
  const responseRate = total > 0 ? (deals / total) * 100 : 0
  return { offers, purchases, sales, deals, responseRate, total }
}

function formatDate(iso: string) {
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return iso }
}

function SortIcon({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      style={{ opacity: active ? 1 : 0.3, marginLeft: 3, flexShrink: 0 }}>
      {active && dir === 'asc'
        ? <polyline points="18 15 12 9 6 15" />
        : <polyline points="6 9 12 15 18 9" />
      }
    </svg>
  )
}

export default function CRMCampaigns() {
  const [view, setView] = useState<View>('list')
  const [selectedCampaign, setSelectedCampaign] = useState<CRMCampaign | null>(null)
  const [campaigns, setCampaigns] = useState<CRMCampaign[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('created_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [showNewModal, setShowNewModal] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => { fetchCampaigns() }, [])

  async function fetchCampaigns() {
    setLoading(true); setError(null)
    try { setCampaigns(await listCrmCampaigns()) }
    catch { setError('Failed to load campaigns.') }
    finally { setLoading(false) }
  }

  async function handleCreate() {
    if (!newName.trim()) return
    setCreating(true); setCreateError(null)
    try {
      const camp = await createCrmCampaign(newName.trim())
      setCampaigns(prev => [camp, ...prev])
      setNewName(''); setShowNewModal(false)
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

  function openDetail(camp: CRMCampaign) { setSelectedCampaign(camp); setView('detail') }

  function handleCampaignUpdated(updated: CRMCampaign) {
    setCampaigns(prev => prev.map(c => c.id === updated.id ? updated : c))
    if (selectedCampaign?.id === updated.id) setSelectedCampaign(updated)
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const sorted = useMemo(() => {
    const filtered = campaigns.filter(c => !search || c.name.toLowerCase().includes(search.toLowerCase()))
    return [...filtered].sort((a, b) => {
      const sa = getStats(a), sb2 = getStats(b)
      let av: string | number, bv: string | number
      switch (sortKey) {
        case 'name': av = a.name.toLowerCase(); bv = b.name.toLowerCase(); break
        case 'created_at': av = a.created_at; bv = b.created_at; break
        case 'property_count': av = sa.total; bv = sb2.total; break
        case 'deals': av = sa.deals; bv = sb2.deals; break
        case 'response_rate': av = sa.responseRate; bv = sb2.responseRate; break
        case 'offers': av = sa.offers; bv = sb2.offers; break
        case 'purchases': av = sa.purchases; bv = sb2.purchases; break
        case 'sales': av = sa.sales; bv = sb2.sales; break
        default: av = a.created_at; bv = b.created_at
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })
  }, [campaigns, search, sortKey, sortDir])

  if (view === 'detail' && selectedCampaign) {
    return <CampaignDetail campaign={selectedCampaign} onBack={() => setView('list')} onCampaignUpdated={handleCampaignUpdated} />
  }

  function TH({ label, sk }: { label: string; sk?: SortKey }) {
    const active = sk ? sortKey === sk : false
    return (
      <th
        onClick={sk ? () => toggleSort(sk) : undefined}
        style={{
          padding: '10px 16px',
          textAlign: 'left',
          fontSize: '11px',
          fontWeight: 700,
          letterSpacing: '0.06em',
          textTransform: 'uppercase' as const,
          color: active ? '#5C2977' : '#6B5B8A',
          background: '#F8F6FB',
          borderBottom: '2px solid #EDE8F5',
          cursor: sk ? 'pointer' : 'default',
          userSelect: 'none' as const,
          whiteSpace: 'nowrap' as const,
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center' }}>
          {label}
          {sk && <SortIcon active={active} dir={active ? sortDir : 'desc'} />}
        </span>
      </th>
    )
  }

  return (
    <div style={{ background: '#F8F6FB', minHeight: '100vh' }}>
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
          <button className="btn-primary" onClick={() => setShowNewModal(true)}>+ Add Campaign</button>
        </div>
      </div>

      <div className="p-6">
        <div className="mb-4" style={{ position: 'relative', display: 'inline-block' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9B8AAE" strokeWidth="2"
            style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="text"
            className="input-base text-sm"
            style={{ paddingLeft: 32, width: 320 }}
            placeholder="Search campaigns…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg text-sm" style={{ background: '#FFF0F0', color: '#B71C1C', border: '1px solid #FFCDD2' }}>
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-sm" style={{ color: '#6B5B8A' }}>Loading campaigns…</div>
          </div>
        ) : sorted.length === 0 ? (
          <div className="text-center py-20" style={{ color: '#6B5B8A' }}>
            <svg className="mx-auto mb-4 opacity-30" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            <p className="text-sm font-medium">{search ? 'No campaigns match your search' : 'No campaigns yet'}</p>
            {!search && <p className="text-xs mt-1">Create a campaign, then import a property list</p>}
            {!search && <button className="btn-primary mt-4" onClick={() => setShowNewModal(true)}>+ Add Campaign</button>}
          </div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <TH label="Name" sk="name" />
                  <TH label="Date" sk="created_at" />
                  <TH label="Records" sk="property_count" />
                  <TH label="Amount Spent" />
                  <TH label="Deals" sk="deals" />
                  <TH label="Response %" sk="response_rate" />
                  <TH label="Offers" sk="offers" />
                  <TH label="Purchases" sk="purchases" />
                  <TH label="Sales" sk="sales" />
                  <TH label="" />
                </tr>
              </thead>
              <tbody>
                {sorted.map((camp, idx) => {
                  const stats = getStats(camp)
                  const isDeleting = deletingId === camp.id
                  return (
                    <tr
                      key={camp.id}
                      style={{
                        background: idx % 2 === 0 ? '#FFFFFF' : '#FAF8FD',
                        borderBottom: '1px solid #EDE8F5',
                        cursor: 'pointer',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#F0EBF8')}
                      onMouseLeave={e => (e.currentTarget.style.background = idx % 2 === 0 ? '#FFFFFF' : '#FAF8FD')}
                      onClick={() => openDetail(camp)}
                    >
                      <td style={{ padding: '12px 16px', maxWidth: 260 }}>
                        <span className="text-sm font-semibold" style={{ color: '#1A0A2E' }}>{camp.name}</span>
                      </td>
                      <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
                        <span className="text-sm" style={{ color: '#6B5B8A' }}>{formatDate(camp.created_at)}</span>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span className="text-sm font-semibold" style={{ color: '#5C2977' }}>{stats.total.toLocaleString()}</span>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span className="text-sm" style={{ color: '#9B8AAE' }}>$0</span>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span className="text-sm font-medium" style={{ color: '#1A0A2E' }}>{stats.deals.toLocaleString()}</span>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span className="text-sm" style={{ color: stats.responseRate > 0 ? '#2E7D32' : '#9B8AAE' }}>
                          {stats.responseRate > 0 ? `${stats.responseRate.toFixed(1)}%` : '0%'}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span className="text-sm" style={{ color: '#1A0A2E' }}>{stats.offers.toLocaleString()}</span>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span className="text-sm" style={{ color: '#1A0A2E' }}>{stats.purchases.toLocaleString()}</span>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span className="text-sm" style={{ color: '#1A0A2E' }}>{stats.sales.toLocaleString()}</span>
                      </td>
                      <td style={{ padding: '12px 16px' }} onClick={e => e.stopPropagation()}>
                        {isDeleting ? (
                          <div className="flex items-center gap-1">
                            <button
                              className="text-xs px-2 py-1 rounded font-semibold"
                              style={{ background: 'rgba(183,28,28,0.1)', color: '#B71C1C', border: '1px solid rgba(183,28,28,0.25)' }}
                              onClick={() => handleDelete(camp.id)}
                            >Delete</button>
                            <button className="btn-secondary text-xs py-1 px-2" onClick={() => setDeletingId(null)}>No</button>
                          </div>
                        ) : (
                          <button
                            className="px-2 py-1 rounded transition-all"
                            style={{ color: '#C4B5D8', border: '1px solid #EDE8F5' }}
                            onClick={() => setDeletingId(camp.id)}
                            onMouseEnter={e => { e.currentTarget.style.color = '#B71C1C'; e.currentTarget.style.borderColor = 'rgba(183,28,28,0.3)' }}
                            onMouseLeave={e => { e.currentTarget.style.color = '#C4B5D8'; e.currentTarget.style.borderColor = '#EDE8F5' }}
                            title="Delete campaign"
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="3 6 5 6 21 6"/>
                              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                              <path d="M10 11v6M14 11v6"/>
                            </svg>
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showNewModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(26,10,46,0.45)' }}
          onClick={e => { if (e.target === e.currentTarget) { setShowNewModal(false); setNewName(''); setCreateError(null) } }}
        >
          <div className="card" style={{ width: 440, maxWidth: '90vw', padding: 24 }}>
            <h2 className="section-heading mb-4">New Campaign</h2>
            <input
              type="text"
              className="input-base w-full text-sm mb-3"
              placeholder="e.g. Brunswick County April 2026"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              disabled={creating}
              maxLength={80}
              autoFocus
            />
            {createError && <p className="text-sm mb-3" style={{ color: '#B71C1C' }}>{createError}</p>}
            <div className="flex gap-2 justify-end">
              <button className="btn-secondary" onClick={() => { setShowNewModal(false); setNewName(''); setCreateError(null) }}>Cancel</button>
              <button className="btn-primary" onClick={handleCreate} disabled={creating || !newName.trim()}>
                {creating ? 'Creating…' : 'Create Campaign'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
