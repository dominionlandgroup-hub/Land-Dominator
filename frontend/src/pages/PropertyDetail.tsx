import React, { useEffect, useRef, useState } from 'react'
import type { CRMProperty, PropertyStatus, Communication } from '../types/crm'
import type { PropertyDocument } from '../api/crm'
import { pullLpData, sendSms, initiateOutboundCall, listPropertyCommunications, listPropertyDocuments, uploadPropertyDocument, deleteDocument, getDocumentDownloadUrl, listPropertyNotes, addPropertyNote } from '../api/crm'
import type { PropertyNote } from '../api/crm'
import CommDetailModal, { ScoreBadge, TypeBadge, fmtTalk } from '../components/CommDetailModal'

// ── Display helpers ───────────────────────────────────────────────────────────

function fmtCurrency(v: number | null | undefined): string {
  if (v == null || isNaN(v as number)) return ''
  return `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function parseCurrency(s: string): number | undefined {
  const n = parseFloat(s.replace(/[$,\s]/g, ''))
  return isNaN(n) ? undefined : n
}

// ── Currency input (formats on blur, raw on focus) ────────────────────────────
function CurrencyInput({
  label, value, onChange, placeholder = '$0.00', bold = false,
}: {
  label: string
  value: number | null | undefined
  onChange: (v: number | undefined) => void
  placeholder?: string
  bold?: boolean
}) {
  const [focused, setFocused] = React.useState(false)
  const [raw, setRaw] = React.useState('')

  function onFocus() {
    setFocused(true)
    setRaw(value != null ? String(value) : '')
  }

  function onBlur() {
    setFocused(false)
    onChange(parseCurrency(raw))
  }

  function onChangeHandler(s: string) {
    setRaw(s)
    const n = parseCurrency(s)
    if (n !== undefined) onChange(n)
  }

  const displayValue = focused ? raw : (value != null ? fmtCurrency(value) : '')

  return (
    <div className="flex flex-col gap-1">
      <label className="label-caps">{label}</label>
      <input
        type="text"
        className="input-base"
        value={displayValue}
        onChange={e => onChangeHandler(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder={placeholder}
        style={bold ? { fontWeight: 700, color: '#2D7A4F', fontSize: '14px' } : undefined}
      />
    </div>
  )
}

function fmtLandLocked(v: string | null | undefined): string {
  if (!v) return '—'
  const up = v.trim().toLowerCase()
  if (['true', 'yes', 'y', '1'].includes(up)) return 'Yes'
  if (['false', 'no', 'n', '0'].includes(up)) return 'No'
  return v
}

function fmtPct(v: number | null | undefined, emptyLabel = 'None detected'): string {
  if (v == null || v === 0) return emptyLabel
  return `${Number(v).toFixed(1)}%`
}

function fmtFloodZone(v: string | null | undefined): string {
  if (!v) return '—'
  const z = v.trim().toUpperCase()
  if (z === 'X' || z === 'X500') return `Minimal Risk (Zone ${z})`
  if (z.startsWith('A') || z.startsWith('V')) return `High Risk (Zone ${z})`
  return `Zone ${z}`
}

function buildabilityColor(v: number | null | undefined): string {
  if (v == null) return '#9B8AAE'
  if (v >= 80) return '#2D7A4F'
  if (v >= 50) return '#D5A940'
  return '#dc2626'
}

function fmtFileSize(bytes: number | null | undefined): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ── Accordion section component ───────────────────────────────────────────────
function AccordionSection({
  title,
  sectionKey,
  openSections,
  toggleSection,
  children,
}: {
  title: string
  sectionKey: string
  openSections: Set<string>
  toggleSection: (key: string) => void
  children: React.ReactNode
}) {
  const isOpen = openSections.has(sectionKey)
  return (
    <div style={{ border: '1px solid #E0E0E0', borderRadius: '10px', overflow: 'hidden', background: '#fff' }}>
      <button
        type="button"
        onClick={() => toggleSection(sectionKey)}
        className="w-full flex items-center justify-between"
        style={{
          padding: '12px 16px',
          background: isOpen ? '#EEEEEE' : '#F5F5F5',
          borderBottom: isOpen ? '1px solid #E0E0E0' : 'none',
          cursor: 'pointer',
          textAlign: 'left',
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#EBEBEB' }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = isOpen ? '#EEEEEE' : '#F5F5F5' }}
      >
        <span style={{ fontSize: '14px', fontWeight: 600, color: '#1A0A2E', fontFamily: "'Montserrat', sans-serif" }}>
          {title}
        </span>
        <svg
          width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke="#6B5B8A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease', flexShrink: 0 }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {isOpen && (
        <div style={{ padding: '20px 16px' }}>
          {children}
        </div>
      )}
    </div>
  )
}

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
  const [showSmsModal, setShowSmsModal] = useState(false)
  const [smsMessage, setSmsMessage] = useState('')
  const [smsSending, setSmsSending] = useState(false)
  const [smsError, setSmsError] = useState<string | null>(null)
  const [smsSuccess, setSmsSuccess] = useState<string | null>(null)
  const [showCallModal, setShowCallModal] = useState(false)
  const [calling, setCalling] = useState(false)
  const [callMsg, setCallMsg] = useState<string | null>(null)
  const [comms, setComms] = useState<Communication[]>([])
  const [commsLoading, setCommsLoading] = useState(false)
  const [docs, setDocs] = useState<PropertyDocument[]>([])
  const [docsLoading, setDocsLoading] = useState(false)
  const [docUploading, setDocUploading] = useState(false)
  const [docError, setDocError] = useState<string | null>(null)
  const [detailComm, setDetailComm] = useState<Communication | null>(null)
  const [noteSaving, setNoteSaving] = useState(false)
  const [noteSaved, setNoteSaved] = useState(false)
  const [noteHistory, setNoteHistory] = useState<PropertyNote[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const isNew = !property

  // Accordion open/closed state — first 3 open by default
  const [openSections, setOpenSections] = useState<Set<string>>(
    new Set(['basic', 'owner', 'campaign'])
  )
  function toggleSection(key: string) {
    setOpenSections(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  useEffect(() => {
    if (!property?.id) return
    setCommsLoading(true)
    listPropertyCommunications(property.id)
      .then(setComms)
      .catch(() => {/* table may not exist yet */})
      .finally(() => setCommsLoading(false))

    setDocsLoading(true)
    listPropertyDocuments(property.id)
      .then(setDocs)
      .catch(() => {})
      .finally(() => setDocsLoading(false))

    listPropertyNotes(property.id)
      .then(setNoteHistory)
      .catch(() => {})
  }, [property?.id])

  async function handleDocUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !property?.id) return
    setDocUploading(true)
    setDocError(null)
    try {
      const doc = await uploadPropertyDocument(property.id, file)
      setDocs(prev => [doc, ...prev])
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setDocError(detail ?? 'Upload failed. Check that the property-documents storage bucket exists in Supabase.')
    } finally {
      setDocUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleDocDelete(docId: string) {
    if (!confirm('Delete this document?')) return
    try {
      await deleteDocument(docId)
      setDocs(prev => prev.filter(d => d.id !== docId))
    } catch {
      setDocError('Delete failed.')
    }
  }

  async function handleDocDownload(docId: string) {
    try {
      const url = await getDocumentDownloadUrl(docId)
      window.open(url, '_blank')
    } catch {
      setDocError('Could not get download link.')
    }
  }

  function openSmsModal() {
    const firstName = form.owner_first_name || form.owner_full_name?.split(' ')[0] || 'there'
    const addr = form.property_address || `${form.county ? form.county + ' County' : 'your area'}`
    const offerFmt = form.offer_price ? `$${Math.round(form.offer_price).toLocaleString()}` : 'our cash offer'
    const telnyx = '[Your Phone Number]'
    setSmsMessage(
      `Hi ${firstName}, this is Dominion Land Group. We sent you a letter about your property at ${addr}. ` +
      `We have a cash offer of ${offerFmt} for your land. Are you interested? ` +
      `Reply YES or call us back at ${telnyx}.`
    )
    setSmsError(null); setSmsSuccess(null)
    setShowSmsModal(true)
  }

  async function handleSendSms() {
    if (!property?.id || !form.owner_phone) return
    setSmsSending(true); setSmsError(null); setSmsSuccess(null)
    try {
      await sendSms(property.id, form.owner_phone, smsMessage)
      setSmsSuccess('SMS sent successfully.')
      setShowSmsModal(false)
      listPropertyCommunications(property.id).then(setComms).catch(() => {})
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setSmsError(detail ?? 'Failed to send SMS. Check TELNYX_API_KEY and TELNYX_PHONE_NUMBER.')
    } finally { setSmsSending(false) }
  }

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

  async function handleSaveNotes() {
    if (isNew || noteSaving || !form.notes?.trim()) return
    setNoteSaving(true)
    try {
      await onSave({ notes: form.notes })
      // Add to timestamped history
      if (property?.id) {
        try {
          const note = await addPropertyNote(property.id, form.notes.trim())
          setNoteHistory(prev => [note, ...prev])
        } catch {
          // history append is best-effort
        }
      }
      setNoteSaved(true)
      setTimeout(() => setNoteSaved(false), 3000)
    } catch {
      // ignore — full save will catch it
    } finally {
      setNoteSaving(false)
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

  const accordionProps = { openSections, toggleSection }

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
          {!isNew && form.owner_phone && (
            <>
              <button
                className="btn-secondary text-sm flex items-center gap-1.5"
                onClick={() => { setCallMsg(null); setShowCallModal(true) }}
                title="Call owner"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.63 3.38 2 2 0 0 1 3.6 1.21h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.9a16 16 0 0 0 6 6l1.06-1.06a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
                </svg>
                Call
              </button>
              <button
                className="btn-secondary text-sm flex items-center gap-1.5"
                onClick={openSmsModal}
                title="Send SMS to owner"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
                Send Text
              </button>
            </>
          )}
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
        {smsSuccess && (
          <div className="mb-4 p-3 rounded-lg text-sm" style={{ background: '#E8F5E9', color: '#2E7D32', border: '1px solid #A5D6A7' }}>
            {smsSuccess}
          </div>
        )}

        <div className="space-y-2">

          {/* Basic Information */}
          <AccordionSection title="Basic Information" sectionKey="basic" {...accordionProps}>
            <div className="grid grid-cols-3 gap-4">
              <Field label="Property Address" field="property_address" span={3} />
              <Field label="Property City" field="property_city" />
              <Field label="State" field="state" placeholder="TX" />
              <Field label="Property ZIP" field="property_zip" />
              <Field label="APN" field="apn" placeholder="123-456-789" />
              <Field label="County" field="county" />
              <Field label="Acreage" field="acreage" type="number" placeholder="0.00" />
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
              <Field label="Property ID (LP)" field="property_id" placeholder="LP property ID" />
              <Field label="FIPS Code" field="fips" placeholder="County FIPS code" />
            </div>
          </AccordionSection>

          {/* Owner Information */}
          <AccordionSection title="Owner Information" sectionKey="owner" {...accordionProps}>
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
          </AccordionSection>

          {/* Campaign & Sale */}
          <AccordionSection title="Campaign & Sale" sectionKey="campaign" {...accordionProps}>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Campaign Code" field="campaign_code" />
              <CurrencyInput label="Offer Price" value={form.offer_price} onChange={v => set('offer_price', v)} />
            </div>
          </AccordionSection>

          {/* Due Diligence */}
          <AccordionSection title="Due Diligence" sectionKey="dd" {...accordionProps}>
            <div className="grid grid-cols-3 gap-4">
              <Field label="Access" field="dd_access" />
              <Field label="Topography" field="dd_topography" />
              <Field label="Flood Zone" field="dd_flood_zone" />
              <Field label="Sewer" field="dd_sewer" />
              <Field label="Septic" field="dd_septic" />
              <Field label="Water" field="dd_water" />
              <Field label="Power" field="dd_power" />
              <Field label="Zoning" field="dd_zoning" />
              <Field label="Back Taxes (Delinquent Year)" field="dd_back_taxes" />
            </div>
          </AccordionSection>

          {/* Land Analysis */}
          <AccordionSection title="Land Analysis" sectionKey="land" {...accordionProps}>
            {/* Read-only summary row */}
            <div className="grid grid-cols-4 gap-3 mb-4 p-3 rounded-xl" style={{ background: '#F8F5FC', border: '1px solid #EDE8F5' }}>
              <div>
                <p className="label-caps mb-1">Buildability</p>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: buildabilityColor(form.buildability as number | undefined) }} />
                  <span className="text-sm font-semibold" style={{ color: buildabilityColor(form.buildability as number | undefined) }}>
                    {form.buildability != null ? `${Number(form.buildability).toFixed(1)}%` : '—'}
                  </span>
                </div>
              </div>
              <div>
                <p className="label-caps mb-1">Land Locked</p>
                <p className="text-sm font-medium" style={{ color: fmtLandLocked(form.land_locked as string | undefined) === 'Yes' ? '#dc2626' : '#1A0A2E' }}>
                  {fmtLandLocked(form.land_locked as string | undefined)}
                </p>
              </div>
              <div>
                <p className="label-caps mb-1">Flood Zone</p>
                <p className="text-sm font-medium" style={{ color: '#1A0A2E' }}>
                  {fmtFloodZone(form.dd_flood_zone as string | undefined)}
                </p>
              </div>
              <div>
                <p className="label-caps mb-1">FEMA Coverage</p>
                <p className="text-sm font-medium" style={{ color: '#1A0A2E' }}>
                  {fmtPct(form.fema_coverage as number | undefined)}
                </p>
              </div>
              <div>
                <p className="label-caps mb-1">Wetlands</p>
                <p className="text-sm font-medium" style={{ color: '#1A0A2E' }}>
                  {fmtPct(form.wetlands_coverage as number | undefined)}
                </p>
              </div>
              <div>
                <p className="label-caps mb-1">Road Frontage</p>
                <p className="text-sm font-medium" style={{ color: '#1A0A2E' }}>
                  {form.road_frontage != null ? `${Number(form.road_frontage).toFixed(0)} ft` : '—'}
                </p>
              </div>
              <div>
                <p className="label-caps mb-1">Slope AVG</p>
                <p className="text-sm font-medium" style={{ color: '#1A0A2E' }}>
                  {form.slope_avg != null ? `${Number(form.slope_avg).toFixed(1)}%` : '—'}
                </p>
              </div>
              <div>
                <p className="label-caps mb-1">Elevation AVG</p>
                <p className="text-sm font-medium" style={{ color: '#1A0A2E' }}>
                  {form.elevation_avg != null ? `${Number(form.elevation_avg).toFixed(0)} ft` : '—'}
                </p>
              </div>
            </div>
            {/* Editable fields */}
            <div className="grid grid-cols-3 gap-4">
              <Field label="Land Use" field="land_use" />
              <Field label="Land Locked (raw)" field="land_locked" placeholder="true / false / Y / N" />
              <Field label="School District" field="school_district" />
              <Field label="Buildability (%)" field="buildability" type="number" placeholder="0.00" />
              <Field label="Buildability Area (ac)" field="buildability_acres" type="number" placeholder="0.00" />
              <Field label="Road Frontage (ft)" field="road_frontage" type="number" placeholder="0" />
              <Field label="FEMA Flood Coverage (%)" field="fema_coverage" type="number" placeholder="0.00" />
              <Field label="Wetlands Coverage (%)" field="wetlands_coverage" type="number" placeholder="0.00" />
              <Field label="Slope AVG (%)" field="slope_avg" type="number" placeholder="0.00" />
              <Field label="Elevation AVG (ft)" field="elevation_avg" type="number" placeholder="0" />
              <Field label="Assessed Value" field="assessed_value" />
            </div>
          </AccordionSection>

          {/* Comparables */}
          <AccordionSection title="Comparables" sectionKey="comps" {...accordionProps}>
            {/* Quality flag banner */}
            {form.comp_quality_flags && (
              <div className="mb-4 flex flex-wrap gap-2 items-center">
                {form.comp_quality_flags.split(',').map(f => f.trim()).filter(Boolean).map(flag => (
                  <span key={flag} className="text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-wider"
                    style={{
                      background: flag === 'REVIEW_NEEDED' ? '#FFF0F0' : '#FFF9E6',
                      color: flag === 'REVIEW_NEEDED' ? '#B71C1C' : '#B8860B',
                      border: `1px solid ${flag === 'REVIEW_NEEDED' ? '#FFCDD2' : '#FFE082'}`,
                    }}>
                    {flag.replace(/_/g, ' ')}
                  </span>
                ))}
                {form.pricing_method_used && (
                  <span className="text-[10px] font-medium px-2 py-1 rounded-full" style={{ background: '#EDE8F5', color: '#5C2977' }}>
                    Method: {form.pricing_method_used}
                  </span>
                )}
              </div>
            )}
            <div className="grid grid-cols-3 gap-4">
              {([1, 2, 3] as const).map(n => {
                const price = form[`comp${n}_price` as keyof CRMProperty] as number | undefined
                const acreage = form[`comp${n}_acreage` as keyof CRMProperty] as number | undefined
                const link = form[`comp${n}_link` as keyof CRMProperty] as string | undefined
                const address = form[`comp_${n}_address` as keyof CRMProperty] as string | undefined
                const date = form[`comp_${n}_date` as keyof CRMProperty] as string | undefined
                const distance = form[`comp_${n}_distance` as keyof CRMProperty] as number | undefined
                const ppa = form[`comp_${n}_ppa` as keyof CRMProperty] as number | undefined
                // Per-comp quality check: stale if date > 18 months, poor if acreage ratio > 3x
                const now = Date.now()
                const dateMs = date ? new Date(date).getTime() : null
                const isStale = dateMs != null && (now - dateMs) > 18 * 30.44 * 24 * 60 * 60 * 1000
                const propertyAcreage = form.acreage
                const isPoor = acreage != null && propertyAcreage != null && propertyAcreage > 0
                  ? Math.max(acreage, propertyAcreage) / Math.min(acreage, propertyAcreage) > 3
                  : false
                return (
                  <div key={n} className="rounded-xl overflow-hidden" style={{ border: '1px solid #EDE8F5' }}>
                    <div className="px-4 pt-4 pb-3" style={{ background: '#F8F5FC', borderBottom: '1px solid #EDE8F5' }}>
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#9B8AAE' }}>Comp {n}</p>
                        <div className="flex gap-1">
                          {isStale && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: '#FFF9E6', color: '#B8860B', border: '1px solid #FFE082' }}>STALE</span>}
                          {isPoor && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: '#FFF0F0', color: '#B71C1C', border: '1px solid #FFCDD2' }}>POOR</span>}
                        </div>
                      </div>
                      <p className="text-2xl font-bold" style={{ color: '#1A0A2E' }}>
                        {price != null ? fmtCurrency(price) : <span style={{ color: '#C4B5D8', fontSize: '13px', fontWeight: 400 }}>No price yet</span>}
                      </p>
                      {acreage != null && <p className="text-sm mt-0.5" style={{ color: '#6B5B8A' }}>{acreage.toFixed(2)} ac{ppa != null ? ` · ${fmtCurrency(ppa)}/ac` : ''}</p>}
                      {address && <p className="text-xs mt-1 leading-tight" style={{ color: '#6B5B8A' }}>{address}</p>}
                      <div className="flex flex-wrap gap-2 mt-1.5">
                        {date && <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: '#EDE8F5', color: '#6B5B8A' }}>{new Date(date).toLocaleDateString('en-US', { year: 'numeric', month: 'short' })}</span>}
                        {distance != null && <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: '#EDE8F5', color: '#6B5B8A' }}>{distance.toFixed(2)} mi away</span>}
                      </div>
                      {link && (
                        <a href={link} target="_blank" rel="noopener noreferrer"
                          className="inline-block mt-2 text-xs font-semibold px-2 py-1 rounded-lg"
                          style={{ background: '#EDE8F5', color: '#5C2977' }}
                        >View on Land Portal →</a>
                      )}
                    </div>
                    <div className="p-4 space-y-2">
                      <Field label="Link" field={`comp${n}_link` as keyof CRMProperty} placeholder="https://…" />
                      <CurrencyInput label="Price" value={form[`comp${n}_price` as keyof CRMProperty] as number | undefined} onChange={v => set(`comp${n}_price` as keyof CRMProperty, v)} />
                      <Field label="Acreage" field={`comp${n}_acreage` as keyof CRMProperty} type="number" placeholder="0.00" />
                    </div>
                  </div>
                )
              })}
            </div>
          </AccordionSection>

          {/* Pricing Fields */}
          <AccordionSection title="Pricing Fields" sectionKey="pricing" {...accordionProps}>
            <div className="grid grid-cols-2 gap-4">
              <CurrencyInput label="LP Estimate" value={form.lp_estimate} onChange={v => set('lp_estimate', v)} />
              <CurrencyInput label="LP Based Offer" value={form.lp_based_offer} onChange={v => set('lp_based_offer', v)} />
              <CurrencyInput label="Comp Based Offer" value={form.comp_based_offer} onChange={v => set('comp_based_offer', v)} />
              <CurrencyInput label="Recommended Offer" value={form.recommended_offer} onChange={v => set('recommended_offer', v)} bold />
            </div>
            <div className="mt-4 flex flex-col gap-1">
              <label className="label-caps">Confidence Level</label>
              {form.confidence_level ? (
                <span className="inline-block self-start px-3 py-1.5 rounded-full text-sm font-bold"
                  style={{
                    background: form.confidence_level.toLowerCase() === 'high' ? '#E8F5E9'
                      : form.confidence_level.toLowerCase() === 'medium' ? '#FFF9E6'
                      : '#FFF0F0',
                    color: form.confidence_level.toLowerCase() === 'high' ? '#2D7A4F'
                      : form.confidence_level.toLowerCase() === 'medium' ? '#B8860B'
                      : '#B71C1C',
                  }}>
                  {form.confidence_level}
                </span>
              ) : (
                <input
                  type="text"
                  className="input-base"
                  value={(form.confidence_level as string | undefined) || ''}
                  onChange={e => set('confidence_level', e.target.value)}
                  placeholder="High / Medium / Low"
                  style={{ maxWidth: 200 }}
                />
              )}
            </div>
          </AccordionSection>

          {/* Tags & Notes */}
          <AccordionSection title="Tags & Notes" sectionKey="tags" {...accordionProps}>
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
              <div className="flex items-center gap-3 mt-2">
                <button
                  className="btn-secondary text-xs"
                  style={{ padding: '6px 14px' }}
                  onClick={handleSaveNotes}
                  disabled={noteSaving || isNew || !form.notes?.trim()}
                >
                  {noteSaving ? 'Saving…' : 'Save Note'}
                </button>
                {noteSaved && (
                  <span className="text-xs font-medium" style={{ color: '#2D7A4F' }}>Saved to history</span>
                )}
              </div>
              {noteHistory.length > 0 && (
                <div className="mt-4">
                  <p className="label-caps mb-2">Note History</p>
                  <div className="flex flex-col gap-2">
                    {noteHistory.map(n => (
                      <div key={n.id} className="rounded-lg p-3" style={{ background: '#F8F5FC', border: '1px solid #EDE8F5' }}>
                        <p className="text-[11px] mb-1" style={{ color: '#9B8AAE' }}>
                          {new Date(n.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                        </p>
                        <p className="text-xs whitespace-pre-wrap" style={{ color: '#1A0A2E' }}>{n.content}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </AccordionSection>

          {/* Documents */}
          {!isNew && (
            <AccordionSection title="Documents" sectionKey="docs" {...accordionProps}>
              <div className="flex items-center justify-between mb-4">
                <div />
                <div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                    className="hidden"
                    onChange={handleDocUpload}
                  />
                  <button
                    className="btn-secondary text-xs"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={docUploading}
                  >
                    {docUploading ? 'Uploading…' : '+ Upload Document'}
                  </button>
                </div>
              </div>
              {docError && (
                <p className="text-xs mb-3" style={{ color: '#B71C1C' }}>{docError}</p>
              )}
              {docsLoading ? (
                <p className="text-xs" style={{ color: '#9B8AAE' }}>Loading…</p>
              ) : docs.length === 0 ? (
                <p className="text-xs" style={{ color: '#9B8AAE' }}>No documents yet. Upload a PDF, Word doc, or image.</p>
              ) : (
                <div className="space-y-2">
                  {docs.map(doc => (
                    <div key={doc.id} className="flex items-center justify-between rounded-lg px-4 py-3"
                      style={{ background: '#F8F5FC', border: '1px solid #EDE8F5' }}>
                      <div className="flex items-center gap-3 min-w-0">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9B8AAE" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                          <polyline points="14 2 14 8 20 8"/>
                        </svg>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate" style={{ color: '#1A0A2E' }}>{doc.filename}</p>
                          <p className="text-[11px]" style={{ color: '#9B8AAE' }}>
                            {doc.file_type?.split('/')[1]?.toUpperCase() ?? 'FILE'}
                            {doc.file_size ? ` · ${fmtFileSize(doc.file_size)}` : ''}
                            {' · '}{new Date(doc.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                        <button
                          className="btn-secondary text-xs"
                          style={{ padding: '4px 10px' }}
                          onClick={() => handleDocDownload(doc.id)}
                        >
                          Download
                        </button>
                        <button
                          className="text-xs"
                          style={{ color: '#dc2626', padding: '4px 8px' }}
                          onClick={() => handleDocDelete(doc.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </AccordionSection>
          )}

          {/* Deal Details — only when Closed Won */}
          {form.status === 'closed_won' && (
            <AccordionSection title="Deal Details" sectionKey="deal" {...accordionProps}>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Sale Date" field="sale_date" type="date" />
                <CurrencyInput label="Sale Price" value={form.sale_price} onChange={v => set('sale_price', v)} />
                <Field label="Purchase Date" field="purchase_date" type="date" />
                <CurrencyInput label="Purchase Price" value={form.purchase_price} onChange={v => set('purchase_price', v)} />
              </div>
            </AccordionSection>
          )}

          {/* Communications History */}
          {!isNew && (
            <AccordionSection title="Communications History" sectionKey="comms" {...accordionProps}>
              {commsLoading ? (
                <p className="text-xs" style={{ color: '#9B8AAE' }}>Loading…</p>
              ) : comms.length === 0 ? (
                <p className="text-xs" style={{ color: '#9B8AAE' }}>
                  No communications yet. Use the "Send Text" button to send an SMS, or communications will appear here when this seller calls or texts your Telnyx number.
                </p>
              ) : (
                <div className="space-y-2">
                  {comms.map(c => {
                    const isCall = c.type.startsWith('call')
                    const previewText = c.summary
                      ? c.summary.replace(/Next action:.+$/i, '').trim().slice(0, 100) + (c.summary.length > 100 ? '…' : '')
                      : c.message_body?.slice(0, 100) ?? ''
                    return (
                      <button
                        key={c.id}
                        type="button"
                        className="w-full text-left rounded-lg p-3"
                        style={{ background: '#F8F5FC', border: '1px solid #EDE8F5', cursor: 'pointer', transition: 'background 0.1s' }}
                        onClick={() => setDetailComm(c)}
                        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#EDE8F5' }}
                        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = '#F8F5FC' }}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <TypeBadge type={c.type} />
                            <ScoreBadge score={c.lead_score} />
                            {isCall && c.duration_seconds != null && (
                              <span className="text-[11px]" style={{ color: '#9B8AAE' }}>{fmtTalk(c.duration_seconds)}</span>
                            )}
                          </div>
                          <span className="text-[11px] flex-shrink-0 ml-2" style={{ color: '#9B8AAE' }}>
                            {new Date(c.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                          </span>
                        </div>
                        {previewText && (
                          <p className="text-xs" style={{ color: '#6B5B8A' }}>{previewText}</p>
                        )}
                        <p className="text-[10px] mt-1" style={{ color: '#9B8AAE' }}>Click to view full details →</p>
                      </button>
                    )
                  })}
                </div>
              )}
            </AccordionSection>
          )}

        </div>
      </div>

      {/* SMS Modal */}
      {showSmsModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(26,10,46,0.5)' }}
          onClick={e => { if (e.target === e.currentTarget) setShowSmsModal(false) }}
        >
          <div className="card" style={{ width: 480, maxWidth: '95vw', padding: 24 }}>
            <h2 className="section-heading mb-1">Send Text Message</h2>
            <p className="text-xs mb-3" style={{ color: '#9B8AAE' }}>
              To: {form.owner_phone} — {form.owner_first_name || form.owner_full_name || 'Owner'}
            </p>
            <textarea
              className="input-base w-full text-sm mb-3"
              rows={5}
              value={smsMessage}
              onChange={e => setSmsMessage(e.target.value)}
              style={{ resize: 'vertical' }}
            />
            {smsError && <p className="text-xs mb-2" style={{ color: '#B71C1C' }}>{smsError}</p>}
            <div className="flex gap-2 justify-end">
              <button className="btn-secondary" onClick={() => setShowSmsModal(false)}>Cancel</button>
              <button
                className="btn-primary"
                onClick={handleSendSms}
                disabled={smsSending || !smsMessage.trim()}
              >
                {smsSending ? 'Sending…' : 'Send SMS'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Call Modal */}
      {showCallModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(26,10,46,0.5)' }}
          onClick={e => { if (e.target === e.currentTarget) { setShowCallModal(false); setCallMsg(null) } }}>
          <div className="card" style={{ width: 420, maxWidth: '95vw', padding: 24 }}>
            <h2 className="section-heading mb-1">Start Call</h2>
            <p className="text-sm mb-4" style={{ color: '#6B5B8A' }}>
              Calling <strong>{form.owner_first_name || form.owner_full_name || 'Owner'}</strong> at{' '}
              <strong>{form.owner_phone}</strong> from your Telnyx number.
            </p>
            {callMsg && (
              <div className="mb-4 p-3 rounded-lg text-sm"
                style={{ background: callMsg.startsWith('Error') ? '#FFF0F0' : '#E8F5E9', color: callMsg.startsWith('Error') ? '#B71C1C' : '#2D7A4F' }}>
                {callMsg}
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <button className="btn-secondary" onClick={() => { setShowCallModal(false); setCallMsg(null) }}>Cancel</button>
              {!callMsg && (
                <button
                  className="btn-primary flex items-center gap-2"
                  disabled={calling}
                  onClick={async () => {
                    setCalling(true)
                    try {
                      await initiateOutboundCall(form.owner_phone!, property?.id)
                      setCallMsg('Call initiated. Your seller will hear from your Telnyx number shortly.')
                    } catch {
                      setCallMsg('Error: Could not initiate call. Check TELNYX_API_KEY configuration.')
                    } finally { setCalling(false) }
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.63 3.38 2 2 0 0 1 3.6 1.21h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.9a16 16 0 0 0 6 6l1.06-1.06a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
                  </svg>
                  {calling ? 'Calling…' : 'Start Call'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {detailComm && (
        <CommDetailModal comm={detailComm} onClose={() => setDetailComm(null)} />
      )}

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
