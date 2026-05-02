import React, { useEffect, useState } from 'react'
import { clearAllProperties, getBuyBox, saveBuyBox } from '../api/crm'
import type { BuyBox } from '../types/crm'

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold" style={{ color: '#6B6B6B' }}>{label}</label>
      {children}
    </div>
  )
}

function NumInput({ value, onChange, placeholder }: { value?: number; onChange: (v?: number) => void; placeholder?: string }) {
  return (
    <input
      type="number"
      className="input-base text-sm"
      value={value ?? ''}
      placeholder={placeholder}
      onChange={e => onChange(e.target.value === '' ? undefined : parseFloat(e.target.value))}
    />
  )
}

function TextInput({ value, onChange, placeholder }: { value?: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      type="text"
      className="input-base text-sm"
      value={value ?? ''}
      placeholder={placeholder}
      onChange={e => onChange(e.target.value)}
    />
  )
}

export default function SettingsPage() {
  // Buy Box state
  const [box, setBox] = useState<BuyBox>({
    offer_pct: 52.5,
    cost_per_piece: 0.55,
  })
  const [boxLoading, setBoxLoading] = useState(true)
  const [boxSaving, setBoxSaving] = useState(false)
  const [boxSaved, setBoxSaved] = useState(false)
  const [boxError, setBoxError] = useState<string | null>(null)

  // Danger zone
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [clearCount, setClearCount] = useState<number | null>(null)
  const [clearError, setClearError] = useState<string | null>(null)

  useEffect(() => {
    getBuyBox()
      .then(b => { if (b && Object.keys(b).length > 0) setBox(b) })
      .catch(() => {/* table may not exist yet, use defaults */})
      .finally(() => setBoxLoading(false))
  }, [])

  function setField<K extends keyof BuyBox>(key: K, val: BuyBox[K]) {
    setBox(prev => ({ ...prev, [key]: val }))
    setBoxSaved(false)
  }

  async function handleSaveBox() {
    setBoxSaving(true); setBoxError(null); setBoxSaved(false)
    try {
      await saveBuyBox(box)
      setBoxSaved(true)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Failed to save buy box'
      setBoxError(msg)
    } finally { setBoxSaving(false) }
  }

  async function handleClearAll() {
    setClearing(true); setClearError(null)
    try {
      const result = await clearAllProperties()
      setClearCount(result.count)
      setShowClearConfirm(false)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setClearError(err?.response?.data?.detail ?? 'Failed to clear properties.')
    } finally { setClearing(false) }
  }

  return (
    <div className="flex flex-col min-h-screen" style={{ background: '#0F0F0F' }}>
      <div className="page-header">
        <div>
          <h1 className="text-lg font-bold" style={{ color: '#F5F5F5' }}>Settings</h1>
          <p className="text-xs mt-0.5" style={{ color: '#6B6B6B' }}>Configure your account and workflow preferences</p>
        </div>
      </div>

      <div className="p-6 max-w-3xl space-y-8">

        {/* Buy Box Builder */}
        <section>
          <h2 className="text-sm font-bold uppercase tracking-wider mb-3" style={{ color: '#7C3AED' }}>Buy Box Builder</h2>
          <div className="rounded-lg p-5" style={{ background: '#1A1A1A', border: '1px solid #2E2E2E' }}>
            {boxLoading ? (
              <p className="text-sm" style={{ color: '#A0A0A0' }}>Loading…</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <FieldRow label="Target State (abbrev.)">
                    <TextInput value={box.target_state} onChange={v => setField('target_state', v)} placeholder="e.g. TX" />
                  </FieldRow>
                  <FieldRow label="Target County">
                    <TextInput value={box.target_county} onChange={v => setField('target_county', v)} placeholder="e.g. Brazoria" />
                  </FieldRow>
                  <FieldRow label="Min Acreage">
                    <NumInput value={box.min_acreage} onChange={v => setField('min_acreage', v)} placeholder="5" />
                  </FieldRow>
                  <FieldRow label="Max Acreage">
                    <NumInput value={box.max_acreage} onChange={v => setField('max_acreage', v)} placeholder="50" />
                  </FieldRow>
                  <FieldRow label="Min Price ($)">
                    <NumInput value={box.min_price} onChange={v => setField('min_price', v)} placeholder="5000" />
                  </FieldRow>
                  <FieldRow label="Max Price ($)">
                    <NumInput value={box.max_price} onChange={v => setField('max_price', v)} placeholder="200000" />
                  </FieldRow>
                  <FieldRow label="Offer % (e.g. 52.5)">
                    <NumInput value={box.offer_pct} onChange={v => setField('offer_pct', v)} placeholder="52.5" />
                  </FieldRow>
                  <FieldRow label="Cost Per Piece ($)">
                    <NumInput value={box.cost_per_piece} onChange={v => setField('cost_per_piece', v)} placeholder="0.55" />
                  </FieldRow>
                </div>

                <div className="border-t pt-4 mb-4" style={{ borderColor: '#2E2E2E' }}>
                  <p className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: '#6B6B6B' }}>Mail House Settings</p>
                  <div className="grid grid-cols-2 gap-4">
                    <FieldRow label="Mail House Email">
                      <TextInput value={box.mail_house_email} onChange={v => setField('mail_house_email', v)} placeholder="orders@mailhouse.com" />
                    </FieldRow>
                    <FieldRow label="Weekly Send Day">
                      <select
                        className="input-base text-sm"
                        value={box.weekly_send_day ?? ''}
                        onChange={e => setField('weekly_send_day', e.target.value || undefined)}
                      >
                        <option value="">Select day…</option>
                        {DAYS.map(d => <option key={d} value={d.toLowerCase()}>{d}</option>)}
                      </select>
                    </FieldRow>
                    <FieldRow label="Weekly Budget ($)">
                      <NumInput value={box.weekly_budget} onChange={v => setField('weekly_budget', v)} placeholder="500" />
                    </FieldRow>
                  </div>
                </div>

                {boxError && <p className="text-sm mb-2" style={{ color: '#EF4444' }}>{boxError}</p>}
                {boxSaved && <p className="text-sm mb-2" style={{ color: '#10B981' }}>✓ Buy box saved.</p>}

                <button
                  className="btn-primary"
                  onClick={handleSaveBox}
                  disabled={boxSaving}
                >
                  {boxSaving ? 'Saving…' : 'Save Buy Box'}
                </button>
              </>
            )}
          </div>
        </section>

        {/* Other settings stubs */}
        <section>
          <h2 className="text-sm font-bold uppercase tracking-wider mb-3" style={{ color: '#7C3AED' }}>Account & Integrations</h2>
          <div className="space-y-3">
            {[
              { title: 'Account',       desc: 'Manage your profile, email, and password.' },
              { title: 'Integrations',  desc: 'Connect CRM, communication, and data providers.' },
              { title: 'Notifications', desc: 'Configure email and push notification preferences.' },
              { title: 'Data & Import', desc: 'Manage CSV templates, field mappings, and exports.' },
              { title: 'Team',          desc: 'Invite teammates and manage access permissions.' },
              { title: 'Billing',       desc: 'Subscription plan, invoices, and payment methods.' },
            ].map(s => (
              <div
                key={s.title}
                className="rounded-lg px-5 py-4 flex items-center justify-between cursor-pointer transition-all"
                style={{ background: '#1A1A1A', border: '1px solid #2E2E2E' }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = '#3E3E3E')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = '#2E2E2E')}
              >
                <div>
                  <p className="font-semibold text-sm" style={{ color: '#F5F5F5' }}>{s.title}</p>
                  <p className="text-xs mt-0.5" style={{ color: '#A0A0A0' }}>{s.desc}</p>
                </div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6B6B6B" strokeWidth="2">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </div>
            ))}
          </div>
        </section>

        {/* Danger Zone */}
        <section>
          <h2 className="text-sm font-bold mb-3 uppercase tracking-wider" style={{ color: '#EF4444' }}>Danger Zone</h2>
          <div className="rounded-lg px-5 py-4" style={{ background: '#1A1A1A', border: '1px solid rgba(239,68,68,0.3)' }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-sm" style={{ color: '#F5F5F5' }}>Clear All Properties</p>
                <p className="text-xs mt-0.5" style={{ color: '#A0A0A0' }}>
                  Permanently delete every property record from the CRM. This cannot be undone.
                </p>
                {clearCount !== null && (
                  <p className="text-xs mt-1 font-semibold" style={{ color: '#10B981' }}>
                    ✓ {clearCount.toLocaleString()} {clearCount === 1 ? 'property' : 'properties'} deleted successfully.
                  </p>
                )}
                {clearError && <p className="text-xs mt-1 font-semibold" style={{ color: '#EF4444' }}>{clearError}</p>}
              </div>
              <button
                className="ml-4 px-4 py-2 rounded-lg text-sm font-semibold text-white flex-none"
                style={{ background: '#EF4444' }}
                onClick={() => { setClearCount(null); setClearError(null); setShowClearConfirm(true) }}
              >
                Clear All Properties
              </button>
            </div>
          </div>
        </section>
      </div>

      {/* Confirmation dialog */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
          <div className="rounded-lg p-6 w-full" style={{ maxWidth: '420px', background: '#1A1A1A', border: '1px solid #2E2E2E' }}>
            <h2 className="text-base font-bold mb-2" style={{ color: '#EF4444' }}>Clear All Properties?</h2>
            <p className="text-sm mb-2" style={{ color: '#A0A0A0' }}>
              This will permanently delete <strong style={{ color: '#F5F5F5' }}>every property record</strong> in your CRM.
            </p>
            <p className="text-sm font-semibold mb-6" style={{ color: '#EF4444' }}>This action cannot be undone.</p>
            {clearError && (
              <div className="mb-4 p-3 rounded-lg text-sm" style={{ background: 'rgba(239,68,68,0.12)', color: '#F87171', border: '1px solid rgba(239,68,68,0.3)' }}>
                {clearError}
              </div>
            )}
            <div className="flex gap-3">
              <button className="btn-secondary flex-1" onClick={() => setShowClearConfirm(false)} disabled={clearing}>Cancel</button>
              <button
                className="flex-1 px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60"
                style={{ background: '#EF4444' }}
                onClick={handleClearAll}
                disabled={clearing}
              >
                {clearing ? 'Clearing…' : 'Yes, Delete Everything'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
