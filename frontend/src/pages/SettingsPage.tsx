import React, { useEffect, useState } from 'react'
import { clearAllProperties, getBuyBox, saveBuyBox } from '../api/crm'
import type { BuyBox } from '../types/crm'

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold" style={{ color: '#9B8AAE' }}>{label}</label>
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
    <div className="flex flex-col min-h-screen" style={{ background: '#F8F6FB' }}>
      <div className="page-header">
        <div>
          <h1 className="text-lg font-bold" style={{ color: '#1A0A2E' }}>Settings</h1>
          <p className="text-xs mt-0.5" style={{ color: '#9B8AAE' }}>Configure your account and workflow preferences</p>
        </div>
      </div>

      <div className="p-6 max-w-3xl space-y-8">

        {/* Buy Box Builder */}
        <section>
          <h2 className="text-sm font-bold uppercase tracking-wider mb-3" style={{ color: '#5C2977' }}>Buy Box Builder</h2>
          <div className="rounded-lg p-5" style={{ background: '#FFFFFF', border: '1px solid #E8E0F0', boxShadow: '0 1px 3px rgba(92,41,119,0.08)' }}>
            {boxLoading ? (
              <p className="text-sm" style={{ color: '#6B5B8A' }}>Loading…</p>
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

                <div className="border-t pt-4 mb-4" style={{ borderColor: '#E8E0F0' }}>
                  <p className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: '#9B8AAE' }}>Mail House Settings</p>
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

                {boxError && <p className="text-sm mb-2" style={{ color: '#DC2626' }}>{boxError}</p>}
                {boxSaved && <p className="text-sm mb-2" style={{ color: '#059669' }}>✓ Buy box saved.</p>}

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
          <h2 className="text-sm font-bold uppercase tracking-wider mb-3" style={{ color: '#5C2977' }}>Account & Integrations</h2>
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
                style={{ background: '#FFFFFF', border: '1px solid #E8E0F0', boxShadow: '0 1px 3px rgba(92,41,119,0.08)' }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = '#D4C5E8')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = '#E8E0F0')}
              >
                <div>
                  <p className="font-semibold text-sm" style={{ color: '#1A0A2E' }}>{s.title}</p>
                  <p className="text-xs mt-0.5" style={{ color: '#6B5B8A' }}>{s.desc}</p>
                </div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9B8AAE" strokeWidth="2">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </div>
            ))}
          </div>
        </section>

        {/* Danger Zone */}
        <section>
          <h2 className="text-sm font-bold mb-3 uppercase tracking-wider" style={{ color: '#DC2626' }}>Danger Zone</h2>
          <div className="rounded-lg px-5 py-4" style={{ background: '#FFFFFF', border: '1px solid rgba(220,38,38,0.3)', boxShadow: '0 1px 3px rgba(92,41,119,0.08)' }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-sm" style={{ color: '#1A0A2E' }}>Clear All Properties</p>
                <p className="text-xs mt-0.5" style={{ color: '#6B5B8A' }}>
                  Permanently delete every property record from the CRM. This cannot be undone.
                </p>
                {clearCount !== null && (
                  <p className="text-xs mt-1 font-semibold" style={{ color: '#059669' }}>
                    ✓ {clearCount.toLocaleString()} {clearCount === 1 ? 'property' : 'properties'} deleted successfully.
                  </p>
                )}
                {clearError && <p className="text-xs mt-1 font-semibold" style={{ color: '#DC2626' }}>{clearError}</p>}
              </div>
              <button
                className="ml-4 px-4 py-2 rounded-lg text-sm font-semibold text-white flex-none"
                style={{ background: '#DC2626' }}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(26,10,46,0.5)' }}>
          <div className="rounded-lg p-6 w-full" style={{ maxWidth: '420px', background: '#FFFFFF', border: '1px solid #E8E0F0', boxShadow: '0 1px 3px rgba(92,41,119,0.08)' }}>
            <h2 className="text-base font-bold mb-2" style={{ color: '#DC2626' }}>Clear All Properties?</h2>
            <p className="text-sm mb-2" style={{ color: '#6B5B8A' }}>
              This will permanently delete <strong style={{ color: '#1A0A2E' }}>every property record</strong> in your CRM.
            </p>
            <p className="text-sm font-semibold mb-6" style={{ color: '#DC2626' }}>This action cannot be undone.</p>
            {clearError && (
              <div className="mb-4 p-3 rounded-lg text-sm" style={{ background: '#FEE2E2', color: '#DC2626', border: '1px solid rgba(220,38,38,0.3)' }}>
                {clearError}
              </div>
            )}
            <div className="flex gap-3">
              <button className="btn-secondary flex-1" onClick={() => setShowClearConfirm(false)} disabled={clearing}>Cancel</button>
              <button
                className="flex-1 px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60"
                style={{ background: '#DC2626' }}
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
