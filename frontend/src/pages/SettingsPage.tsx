import React, { useEffect, useState } from 'react'
import { clearAllProperties, fixPropertyNames, getBuyBox, saveBuyBox, getAgentFaq, saveAgentFaq } from '../api/crm'
import type { BuyBox } from '../types/crm'
import type { FaqItem } from '../api/crm'

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

  // Fix names
  const [fixingNames, setFixingNames] = useState(false)
  const [fixNamesResult, setFixNamesResult] = useState<{ fixed: number; total: number } | null>(null)
  const [fixNamesError, setFixNamesError] = useState<string | null>(null)

  // FAQ manager
  const [faqItems, setFaqItems] = useState<FaqItem[]>([])
  const [faqLoading, setFaqLoading] = useState(true)
  const [faqSaving, setFaqSaving] = useState(false)
  const [faqSaved, setFaqSaved] = useState(false)
  const [faqError, setFaqError] = useState<string | null>(null)
  const [editingFaq, setEditingFaq] = useState<number | null>(null)
  const [newFaq, setNewFaq] = useState<FaqItem | null>(null)

  useEffect(() => {
    getBuyBox()
      .then(b => { if (b && Object.keys(b).length > 0) setBox(b) })
      .catch(() => {/* table may not exist yet, use defaults */})
      .finally(() => setBoxLoading(false))
    getAgentFaq()
      .then(items => setFaqItems(items))
      .catch(() => {})
      .finally(() => setFaqLoading(false))
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

  async function handleFixNames() {
    setFixingNames(true); setFixNamesError(null); setFixNamesResult(null)
    try {
      const result = await fixPropertyNames()
      setFixNamesResult(result)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setFixNamesError(err?.response?.data?.detail ?? 'Failed to fix names.')
    } finally { setFixingNames(false) }
  }

  async function handleSaveFaq(items: FaqItem[]) {
    setFaqSaving(true); setFaqError(null); setFaqSaved(false)
    try {
      await saveAgentFaq(items)
      setFaqItems(items)
      setFaqSaved(true)
      setTimeout(() => setFaqSaved(false), 2500)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setFaqError(err?.response?.data?.detail ?? 'Failed to save FAQ.')
    } finally { setFaqSaving(false) }
  }

  function updateFaqItem(index: number, field: keyof FaqItem, value: string) {
    setFaqItems(prev => prev.map((item, i) => {
      if (i !== index) return item
      if (field === 'question_keywords') {
        return { ...item, question_keywords: value.split(',').map(k => k.trim()).filter(Boolean) }
      }
      return { ...item, [field]: value }
    }))
    setFaqSaved(false)
  }

  function deleteFaqItem(index: number) {
    const updated = faqItems.filter((_, i) => i !== index)
    setFaqItems(updated)
    setFaqSaved(false)
  }

  function addFaqItem() {
    if (!newFaq || !newFaq.answer.trim()) return
    const keywords = newFaq.question_keywords.length > 0
      ? newFaq.question_keywords
      : ['new question']
    const updated = [...faqItems, { question_keywords: keywords, answer: newFaq.answer.trim() }]
    setFaqItems(updated)
    setNewFaq(null)
    setFaqSaved(false)
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

        {/* Data Tools */}
        <section>
          <h2 className="text-sm font-bold uppercase tracking-wider mb-3" style={{ color: '#5C2977' }}>Data Tools</h2>
          <div className="rounded-lg px-5 py-4" style={{ background: '#FFFFFF', border: '1px solid #E8E0F0', boxShadow: '0 1px 3px rgba(92,41,119,0.08)' }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-sm" style={{ color: '#1A0A2E' }}>Fix Owner Names</p>
                <p className="text-xs mt-0.5" style={{ color: '#6B5B8A' }}>
                  Reformat any backwards LP names (e.g. "FOSTER DAVID" → "David Foster") across all property records.
                </p>
                {fixNamesResult && (
                  <p className="text-xs mt-1 font-semibold" style={{ color: '#059669' }}>
                    ✓ Fixed {fixNamesResult.fixed.toLocaleString()} of {fixNamesResult.total.toLocaleString()} records.
                  </p>
                )}
                {fixNamesError && <p className="text-xs mt-1 font-semibold" style={{ color: '#DC2626' }}>{fixNamesError}</p>}
              </div>
              <button
                className="ml-4 btn-secondary flex-none text-sm"
                onClick={handleFixNames}
                disabled={fixingNames}
              >
                {fixingNames ? 'Fixing…' : 'Fix Names'}
              </button>
            </div>
          </div>
        </section>

        {/* Voice Agent FAQ Manager */}
        <section>
          <h2 className="text-sm font-bold uppercase tracking-wider mb-3" style={{ color: '#5C2977' }}>Voice Agent FAQ</h2>
          <div className="rounded-lg p-5" style={{ background: '#FFFFFF', border: '1px solid #E8E0F0', boxShadow: '0 1px 3px rgba(92,41,119,0.08)' }}>
            <p className="text-xs mb-4" style={{ color: '#6B5B8A' }}>
              When a caller asks a question, the agent answers from this list. Each entry has keywords (comma-separated) and an answer spoken aloud.
            </p>
            {faqLoading ? (
              <p className="text-sm" style={{ color: '#6B5B8A' }}>Loading…</p>
            ) : (
              <div className="space-y-3">
                {faqItems.map((item, i) => (
                  <div key={i} className="rounded-lg p-3 space-y-2" style={{ background: '#F8F6FB', border: '1px solid #E8E0F0' }}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 space-y-1">
                        {editingFaq === i ? (
                          <>
                            <label className="text-xs font-semibold" style={{ color: '#9B8AAE' }}>Keywords (comma-separated)</label>
                            <input
                              type="text"
                              className="input-base text-xs w-full"
                              value={item.question_keywords.join(', ')}
                              onChange={e => updateFaqItem(i, 'question_keywords', e.target.value)}
                            />
                            <label className="text-xs font-semibold" style={{ color: '#9B8AAE' }}>Answer</label>
                            <textarea
                              className="input-base text-xs w-full"
                              rows={3}
                              value={item.answer}
                              onChange={e => updateFaqItem(i, 'answer', e.target.value)}
                            />
                          </>
                        ) : (
                          <>
                            <p className="text-xs font-semibold" style={{ color: '#5C2977' }}>
                              {item.question_keywords.slice(0, 3).join(' · ')}{item.question_keywords.length > 3 ? ' …' : ''}
                            </p>
                            <p className="text-xs leading-relaxed" style={{ color: '#1A0A2E' }}>{item.answer}</p>
                          </>
                        )}
                      </div>
                      <div className="flex gap-1 flex-none">
                        <button
                          className="px-2 py-1 rounded text-xs font-semibold"
                          style={{ background: '#EDE9F5', color: '#5C2977' }}
                          onClick={() => setEditingFaq(editingFaq === i ? null : i)}
                        >
                          {editingFaq === i ? 'Done' : 'Edit'}
                        </button>
                        <button
                          className="px-2 py-1 rounded text-xs font-semibold"
                          style={{ background: '#FEE2E2', color: '#DC2626' }}
                          onClick={() => deleteFaqItem(i)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ))}

                {/* Add new FAQ */}
                {newFaq !== null ? (
                  <div className="rounded-lg p-3 space-y-2" style={{ border: '1px dashed #A78BC4', background: '#F8F6FB' }}>
                    <label className="text-xs font-semibold" style={{ color: '#9B8AAE' }}>Keywords (comma-separated)</label>
                    <input
                      type="text"
                      className="input-base text-xs w-full"
                      placeholder="e.g. how long, timeline, how soon"
                      value={newFaq.question_keywords.join(', ')}
                      onChange={e => setNewFaq(prev => ({ ...prev!, question_keywords: e.target.value.split(',').map(k => k.trim()).filter(Boolean) }))}
                    />
                    <label className="text-xs font-semibold" style={{ color: '#9B8AAE' }}>Answer (spoken aloud to caller)</label>
                    <textarea
                      className="input-base text-xs w-full"
                      rows={3}
                      placeholder="Type the answer the agent will speak…"
                      value={newFaq.answer}
                      onChange={e => setNewFaq(prev => ({ ...prev!, answer: e.target.value }))}
                    />
                    <div className="flex gap-2">
                      <button className="btn-primary text-xs py-1 px-3" onClick={addFaqItem} disabled={!newFaq.answer.trim()}>Add</button>
                      <button className="btn-secondary text-xs py-1 px-3" onClick={() => setNewFaq(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <button
                    className="btn-secondary text-xs"
                    onClick={() => setNewFaq({ question_keywords: [], answer: '' })}
                  >
                    + Add FAQ Entry
                  </button>
                )}

                {faqError && <p className="text-sm" style={{ color: '#DC2626' }}>{faqError}</p>}
                {faqSaved && <p className="text-sm" style={{ color: '#059669' }}>✓ FAQ saved.</p>}

                <div className="pt-2 border-t" style={{ borderColor: '#E8E0F0' }}>
                  <button
                    className="btn-primary"
                    onClick={() => handleSaveFaq(faqItems)}
                    disabled={faqSaving}
                  >
                    {faqSaving ? 'Saving…' : 'Save FAQ'}
                  </button>
                </div>
              </div>
            )}
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
