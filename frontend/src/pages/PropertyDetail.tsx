import React, { useState } from 'react'
import type { CRMProperty, PropertyStatus } from '../types/crm'
import { pullLpData } from '../api/crm'

interface Props {
  property: CRMProperty | null
  onBack: () => void
  onSave: (data: Partial<CRMProperty>) => Promise<void>
  onDelete: () => Promise<void>
}

const STATUS_OPTIONS: { value: PropertyStatus; label: string }[] = [
  { value: 'lead', label: 'Lead' },
  { value: 'prospect', label: 'Prospect' },
  { value: 'offer_sent', label: 'Offer Sent' },
  { value: 'under_contract', label: 'Under Contract' },
  { value: 'due_diligence', label: 'Due Diligence' },
  { value: 'closed_won', label: 'Closed Won' },
  { value: 'closed_lost', label: 'Closed Lost' },
  { value: 'dead', label: 'Dead' },
]

export default function PropertyDetail({ property, onBack, onSave, onDelete }: Props) {
  const [form, setForm] = useState<Partial<CRMProperty>>(property ?? { status: 'lead' })
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tagInput, setTagInput] = useState('')
  const [phoneInput, setPhoneInput] = useState('')
  const [lpPulling, setLpPulling] = useState(false)
  const [lpMsg, setLpMsg] = useState<string | null>(null)
  const isNew = !property

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function set(field: keyof CRMProperty, value: any) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  function setFloat(field: keyof CRMProperty, raw: string) {
    const v = raw === '' ? undefined : parseFloat(raw)
    set(field, isNaN(v as number) ? undefined : v)
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      await onSave(form)
      if (isNew) onBack()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setError(err?.response?.data?.detail ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await onDelete()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setError(err?.response?.data?.detail ?? 'Delete failed')
      setDeleting(false)
      setConfirmDelete(false)
    }
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

  function addPhone() {
    const p = phoneInput.trim()
    if (!p) return
    set('additional_phones', [...(form.additional_phones || []), p])
    setPhoneInput('')
  }

  function removePhone(p: string) {
    set('additional_phones', (form.additional_phones || []).filter(x => x !== p))
  }

  async function handlePullLp() {
    if (!property?.id || lpPulling) return
    setLpPulling(true)
    setLpMsg(null)
    setError(null)
    try {
      const updated = await pullLpData(property.id)
      setForm(updated)
      setLpMsg(`✓ LP data pulled — LP Estimate: $${updated.lp_estimate?.toLocaleString() ?? '—'}, Offer Price: $${updated.offer_price?.toLocaleString() ?? '—'}`)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setError(err?.response?.data?.detail ?? 'LP pull failed')
    } finally {
      setLpPulling(false)
    }
  }

  const Field = ({
    label, field, type = 'text', placeholder = '', span = 1,
  }: {
    label: string
    field: keyof CRMProperty
    type?: 'text' | 'number' | 'date' | 'textarea'
    placeholder?: string
    span?: number
  }) => (
    <div className={`flex flex-col gap-1${span > 1 ? ` col-span-${span}` : ''}`}>
      <label className="label-caps">{label}</label>
      {type === 'textarea' ? (
        <textarea
          value={(form[field] as string | undefined) || ''}
          onChange={e => set(field, e.target.value)}
          placeholder={placeholder}
          rows={3}
          style={{
            resize: 'vertical',
            padding: '8px 12px',
            width: '100%',
            background: '#FFFFFF',
            border: '1.5px solid #E0D0F0',
            borderRadius: '8px',
            fontSize: '13px',
            fontFamily: "'Montserrat', sans-serif",
            color: '#1A0A2E',
            outline: 'none',
          }}
        />
      ) : type === 'number' ? (
        <input
          type="number"
          className="input-base"
          value={form[field] != null ? String(form[field]) : ''}
          onChange={e => setFloat(field, e.target.value)}
          placeholder={placeholder}
          step="any"
        />
      ) : (
        <input
          type={type}
          className="input-base"
          value={(form[field] as string | undefined) || ''}
          onChange={e => set(field, e.target.value)}
          placeholder={placeholder}
        />
      )}
    </div>
  )

  return (
    <div className="page-content">
      <div className="page-header">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="btn-secondary text-xs" style={{ height: '32px', padding: '0 12px' }}>
            ← Back
          </button>
          <div className="page-header-left">
            <h1 className="page-title">{isNew ? 'New Property' : (form.apn || 'Property Detail')}</h1>
            {!isNew && (form.county || form.state) && (
              <p className="page-subtitle">{[form.county, form.state].filter(Boolean).join(', ')}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!isNew && property?.property_id && (
            <button
              className="btn-secondary text-sm flex items-center gap-1.5"
              onClick={handlePullLp}
              disabled={lpPulling}
              title="Pull LP estimate, offer price, and comps from Land Portal"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              {lpPulling ? 'Pulling LP…' : 'Pull LP Data'}
            </button>
          )}
          {!isNew && (
            <button className="btn-danger" onClick={() => setConfirmDelete(true)} disabled={deleting}>
              Delete
            </button>
          )}
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : isNew ? 'Create Property' : 'Save Changes'}
          </button>
        </div>
      </div>

      <div className="p-6" style={{ maxWidth: '900px' }}>
        {error && (
          <div className="mb-4 p-3 rounded-lg text-sm" style={{ background: '#FFF0F0', color: '#B71C1C', border: '1px solid #FFCDD2' }}>
            {error}
          </div>
        )}
        {lpMsg && (
          <div className="mb-4 p-3 rounded-lg text-sm" style={{ background: '#E8F5E9', color: '#2E7D32', border: '1px solid #A5D6A7' }}>
            {lpMsg}
          </div>
        )}

        <div className="space-y-5">
          {/* Basic Info */}
          <section className="card-static">
            <h2 className="section-heading mb-4">Basic Information</h2>
            <div className="grid grid-cols-3 gap-4">
              <Field label="APN" field="apn" placeholder="123-456-789" />
              <Field label="County" field="county" />
              <Field label="State" field="state" placeholder="TX" />
              <Field label="Acreage" field="acreage" type="number" placeholder="0.00" />
              <Field label="Property ID (LP)" field="property_id" placeholder="LP property ID" />
              <Field label="FIPS Code" field="fips" placeholder="County FIPS code" />
              <div className="flex flex-col gap-1">
                <label className="label-caps">Status</label>
                <select
                  className="input-base"
                  value={form.status || 'lead'}
                  onChange={e => set('status', e.target.value as PropertyStatus)}
                >
                  {STATUS_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <Field label="Property Address" field="property_address" span={2} />
              <Field label="Property City" field="property_city" />
              <Field label="Property Zip" field="property_zip" />
            </div>
          </section>

          {/* Owner */}
          <section className="card-static">
            <h2 className="section-heading mb-4">Owner Information</h2>
            <div className="grid grid-cols-3 gap-4">
              <Field label="Full Name" field="owner_full_name" />
              <Field label="First Name" field="owner_first_name" />
              <Field label="Last Name" field="owner_last_name" />
              <Field label="Primary Phone" field="owner_phone" />
              <Field label="Phone 2" field="phone_2" />
              <Field label="Phone 3" field="phone_3" />
              <Field label="Email" field="owner_email" placeholder="owner@email.com" />
              <div />
              <div />
              <Field label="Mailing Address (Line 1)" field="owner_mailing_address" placeholder="123 Main St" />
              <Field label="City" field="owner_mailing_city" placeholder="Austin" />
              <Field label="Mailing State" field="owner_mailing_state" placeholder="TX" />
              <Field label="Zip" field="owner_mailing_zip" placeholder="78701" />
            </div>

            <div className="mt-4">
              <label className="label-caps">Additional Phone Numbers</label>
              <div className="flex gap-2 mt-1">
                <input
                  type="text"
                  className="input-base"
                  value={phoneInput}
                  onChange={e => setPhoneInput(e.target.value)}
                  placeholder="Add phone number"
                  onKeyDown={e => { if (e.key === 'Enter') addPhone() }}
                />
                <button className="btn-secondary" style={{ padding: '0 16px', flexShrink: 0 }} onClick={addPhone}>Add</button>
              </div>
              {(form.additional_phones || []).length > 0 && (
                <div className="flex gap-2 mt-2 flex-wrap">
                  {(form.additional_phones || []).map(p => (
                    <span key={p} className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs"
                      style={{ background: '#F0EBF8', color: '#5C2977', border: '1px solid #D4B8E8' }}>
                      {p}
                      <button onClick={() => removePhone(p)} style={{ color: '#9B8AAE', lineHeight: 1 }}>×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Campaign & Sale */}
          <section className="card-static">
            <h2 className="section-heading mb-4">Campaign & Sale</h2>
            <div className="grid grid-cols-3 gap-4">
              <Field label="Campaign Code" field="campaign_code" />
              <Field label="Campaign Price" field="campaign_price" type="number" placeholder="0" />
              <Field label="Offer Price" field="offer_price" type="number" placeholder="0" />
              <Field label="Sale Date" field="sale_date" type="date" />
              <Field label="Sale Price" field="sale_price" type="number" placeholder="0" />
              <div />
              <Field label="Purchase Date" field="purchase_date" type="date" />
              <Field label="Purchase Price" field="purchase_price" type="number" placeholder="0" />
            </div>
          </section>

          {/* Due Diligence */}
          <section className="card-static">
            <h2 className="section-heading mb-4">Due Diligence</h2>
            <div className="grid grid-cols-3 gap-4">
              <Field label="Access" field="dd_access" />
              <Field label="Topography" field="dd_topography" />
              <Field label="Flood Zone" field="dd_flood_zone" />
              <Field label="Sewer" field="dd_sewer" />
              <Field label="Septic" field="dd_septic" />
              <Field label="Water" field="dd_water" />
              <Field label="Power" field="dd_power" />
              <Field label="Zoning" field="dd_zoning" />
              <Field label="Back Taxes" field="dd_back_taxes" />
              <Field label="Assessed Value" field="assessed_value" />
            </div>
          </section>

          {/* Comparables */}
          <section className="card-static">
            <h2 className="section-heading mb-4">Comparables</h2>
            <div className="space-y-4">
              {([1, 2, 3] as const).map(n => (
                <div key={n}>
                  <div className="label-caps mb-2" style={{ color: '#5C2977' }}>Comp {n}</div>
                  <div className="grid grid-cols-3 gap-4">
                    <Field label="Link" field={`comp${n}_link` as keyof CRMProperty} placeholder="https://…" />
                    <Field label="Price" field={`comp${n}_price` as keyof CRMProperty} type="number" placeholder="0" />
                    <Field label="Acreage" field={`comp${n}_acreage` as keyof CRMProperty} type="number" placeholder="0.00" />
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Marketing */}
          <section className="card-static">
            <h2 className="section-heading mb-4">Marketing Details</h2>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Marketing Price" field="marketing_price" type="number" placeholder="0" />
              <Field label="Nearest City" field="marketing_nearest_city" />
              <Field label="Title" field="marketing_title" />
              <div />
              <div className="col-span-2">
                <Field label="Description" field="marketing_description" type="textarea" />
              </div>
            </div>
          </section>

          {/* Pricing */}
          <section className="card-static">
            <h2 className="section-heading mb-4">Pricing Fields</h2>
            <div className="grid grid-cols-3 gap-4">
              <Field label="GHL Offer Code" field="ghl_offer_code" />
              <Field label="LP Estimate" field="lp_estimate" type="number" placeholder="0" />
              <Field label="Offer Range High" field="offer_range_high" type="number" placeholder="0" />
              <Field label="Pebble Code" field="pebble_code" />
              <Field label="Claude AI Comp" field="claude_ai_comp" type="number" placeholder="0" />
            </div>
          </section>

          {/* Tags & Notes */}
          <section className="card-static">
            <h2 className="section-heading mb-4">Tags & Notes</h2>
            <div className="mb-4">
              <label className="label-caps">Tags</label>
              <div className="flex gap-2 mt-1">
                <input
                  type="text"
                  className="input-base"
                  value={tagInput}
                  onChange={e => setTagInput(e.target.value)}
                  placeholder="Add a tag"
                  onKeyDown={e => { if (e.key === 'Enter') addTag() }}
                />
                <button className="btn-secondary" style={{ padding: '0 16px', flexShrink: 0 }} onClick={addTag}>Add</button>
              </div>
              {(form.tags || []).length > 0 && (
                <div className="flex gap-2 mt-2 flex-wrap">
                  {(form.tags || []).map(t => (
                    <span key={t} className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs"
                      style={{ background: '#F0EBF8', color: '#5C2977', border: '1px solid #D4B8E8' }}>
                      {t}
                      <button onClick={() => removeTag(t)} style={{ color: '#9B8AAE', lineHeight: 1 }}>×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <label className="label-caps">Notes</label>
              <textarea
                value={form.notes || ''}
                onChange={e => set('notes', e.target.value)}
                rows={4}
                style={{
                  padding: '8px 12px',
                  width: '100%',
                  background: '#FFFFFF',
                  border: '1.5px solid #E0D0F0',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontFamily: "'Montserrat', sans-serif",
                  color: '#1A0A2E',
                  outline: 'none',
                  resize: 'vertical',
                }}
              />
            </div>
          </section>
        </div>
      </div>

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(26,10,46,0.55)' }}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <h2 className="section-heading mb-2">Delete Property?</h2>
            <p className="text-sm mb-5" style={{ color: '#6B5B8A' }}>
              Permanently delete <strong>{form.apn || 'this property'}</strong>. This cannot be undone.
            </p>
            <div className="flex gap-2">
              <button className="btn-secondary flex-1" onClick={() => setConfirmDelete(false)}>Cancel</button>
              <button className="btn-danger flex-1" onClick={handleDelete} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
