import React, { useEffect, useRef, useState } from 'react'
import type { CRMProperty, PropertyStatus, Communication } from '../types/crm'
import type { PropertyDocument } from '../api/crm'
import { pullLpData, sendSms, initiateOutboundCall, listPropertyCommunications, listPropertyDocuments, uploadPropertyDocument, deleteDocument, getDocumentDownloadUrl, listPropertyNotes, addPropertyNote, startSmsCampaign } from '../api/crm'
import type { PropertyNote } from '../api/crm'
import CommDetailModal, { ScoreBadge, TypeBadge, fmtTalk } from '../components/CommDetailModal'

// ── Confidence level normalizer ──────────────────────────────────────────────

function normalizeConfidence(v: string | null | undefined): 'HIGH' | 'MEDIUM' | 'LOW' | null {
  if (!v) return null
  const u = v.toUpperCase().trim().replace(/-/g, '_')
  if (u === 'HIGH' || u === 'HIGH_CONFIDENCE') return 'HIGH'
  if (u === 'MEDIUM' || u === 'MED' || u === 'MEDIUM_CONFIDENCE') return 'MEDIUM'
  if (['LOW', 'LOW_CONFIDENCE', 'ESTIMATED', 'EST'].includes(u)) return 'LOW'
  return null
}

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
        style={bold ? { fontWeight: 700, color: '#059669', fontSize: '14px' } : undefined}
      />
    </div>
  )
}

// ── Phone input with local state (saves on blur only) ────────────────────────
function PhoneField({
  label, value, onChange,
}: {
  label: string
  value: string | null | undefined
  onChange: (v: string) => void
}) {
  const [local, setLocal] = React.useState(value ?? '')
  const [invalid, setInvalid] = React.useState(false)

  React.useEffect(() => { setLocal(value ?? '') }, [value])

  function handleBlur() {
    const digits = local.replace(/\D/g, '')
    if (!digits) { onChange(''); setInvalid(false); return }
    if (digits.length === 10) { onChange(`+1${digits}`); setInvalid(false) }
    else if (digits.length === 11 && digits.startsWith('1')) { onChange(`+${digits}`); setInvalid(false) }
    else { setInvalid(true) }
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="label-caps">{label}</label>
      <input
        type="tel"
        className="input-base"
        value={local}
        onChange={e => { setLocal(e.target.value); setInvalid(false) }}
        onBlur={handleBlur}
        placeholder="(xxx) xxx-xxxx"
        style={invalid ? { borderColor: '#DC2626' } : undefined}
      />
      {invalid && <span style={{ fontSize: 11, color: '#DC2626' }}>Invalid phone number</span>}
    </div>
  )
}

// ── Skip-traced phone row: number + type dropdown + DNC checkbox ──────────────
function SkipTracedPhoneRow({
  label, phone, phoneType, dnc,
  onPhone, onType, onDnc,
}: {
  label: string
  phone: string | null | undefined
  phoneType: string | null | undefined
  dnc: boolean | null | undefined
  onPhone: (v: string) => void
  onType: (v: string) => void
  onDnc: (v: boolean) => void
}) {
  const [local, setLocal] = React.useState(phone ?? '')
  const [invalid, setInvalid] = React.useState(false)

  React.useEffect(() => { setLocal(phone ?? '') }, [phone])

  function handleBlur() {
    const digits = local.replace(/\D/g, '')
    if (!digits) { onPhone(''); setInvalid(false); return }
    if (digits.length === 10) { onPhone(`+1${digits}`); setInvalid(false) }
    else if (digits.length === 11 && digits.startsWith('1')) { onPhone(`+${digits}`); setInvalid(false) }
    else { setInvalid(true) }
  }

  return (
    <div className="flex flex-col gap-1" style={{ gridColumn: 'span 2' }}>
      <label className="label-caps">{label}</label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <input
            type="tel"
            className="input-base"
            value={local}
            onChange={e => { setLocal(e.target.value); onPhone(e.target.value); setInvalid(false) }}
            onBlur={handleBlur}
            placeholder="(xxx) xxx-xxxx"
            style={invalid ? { borderColor: '#DC2626' } : undefined}
          />
          {invalid && <span style={{ fontSize: 11, color: '#DC2626' }}>Invalid phone number</span>}
        </div>
        <select
          className="input-base"
          style={{ width: 110, flexShrink: 0 }}
          value={phoneType || 'mobile'}
          onChange={e => onType(e.target.value)}
        >
          <option value="mobile">Mobile</option>
          <option value="landline">Landline</option>
          <option value="voip">VoIP</option>
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#6B7280', whiteSpace: 'nowrap', paddingTop: 8, flexShrink: 0, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={!!dnc}
            onChange={e => onDnc(e.target.checked)}
            style={{ accentColor: '#DC2626' }}
          />
          DNC
        </label>
      </div>
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
  if (v >= 80) return '#059669'
  if (v >= 50) return '#D97706'
  return '#DC2626'
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
    <div style={{ border: '1px solid #E8E0F0', borderRadius: '8px', overflow: 'hidden', background: '#FFFFFF' }}>
      <button
        type="button"
        onClick={() => toggleSection(sectionKey)}
        className="w-full flex items-center justify-between"
        style={{
          padding: '12px 16px',
          background: isOpen ? '#EDE8F5' : '#F7F3FC',
          borderBottom: isOpen ? '1px solid #E8E0F0' : 'none',
          cursor: 'pointer',
          textAlign: 'left',
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#EDE8F5' }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = isOpen ? '#EDE8F5' : '#F7F3FC' }}
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
        <div style={{ padding: '20px 16px', background: '#FFFFFF' }}>
          {children}
        </div>
      )}
    </div>
  )
}

// ── Field context — lets the Field component live OUTSIDE PropertyDetail ──────
// Defining Field inside PropertyDetail causes React to see a new component type
// on every re-render, which unmounts/remounts every input and loses focus.
type FieldCtxType = {
  form: Partial<CRMProperty>
  setField: (field: keyof CRMProperty, value: unknown) => void
}
const FieldCtx = React.createContext<FieldCtxType>({ form: {}, setField: () => {} })

// Field must be defined OUTSIDE the parent so its reference is stable across renders.
// It uses local state so typing never triggers a parent re-render.
function Field({
  label, field, type = 'text', placeholder = '', span = 1,
}: {
  label: string
  field: string
  type?: 'text' | 'number' | 'date' | 'textarea'
  placeholder?: string
  span?: number
}) {
  const { form, setField } = React.useContext(FieldCtx)
  const raw = (form as Record<string, unknown>)[field]
  const [local, setLocal] = React.useState(raw != null ? String(raw) : '')

  React.useEffect(() => { setLocal(raw != null ? String(raw) : '') }, [raw])

  function commit() {
    if (type === 'number') {
      const n = parseFloat(local)
      setField(field as keyof CRMProperty, local === '' ? undefined : (isNaN(n) ? undefined : n))
    } else {
      setField(field as keyof CRMProperty, local)
    }
  }

  const taStyle: React.CSSProperties = {
    resize: 'vertical', padding: '8px 12px', width: '100%',
    background: '#F7F3FC', border: '1.5px solid #E8E0F0', borderRadius: '8px',
    fontSize: '13px', fontFamily: "'Montserrat', sans-serif", color: '#1A0A2E', outline: 'none',
  }

  return (
    <div className={`flex flex-col gap-1${span > 1 ? ` col-span-${span}` : ''}`}>
      <label className="label-caps">{label}</label>
      {type === 'textarea' ? (
        <textarea value={local} onChange={e => setLocal(e.target.value)} onBlur={commit}
          placeholder={placeholder} rows={3} style={taStyle} />
      ) : (
        <input type={type} className="input-base" value={local}
          onChange={e => setLocal(e.target.value)} onBlur={commit}
          placeholder={placeholder} step={type === 'number' ? 'any' : undefined} />
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
  const [savedOk, setSavedOk] = useState(false)
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
  const [quickTextSending, setQuickTextSending] = useState(false)
  const [quickTextResult, setQuickTextResult] = useState<string | null>(null)
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
    new Set(['basic', 'owner', 'campaign', 'comp-pricing', 'comps'])
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
    const offerFmt = form.offer_price ? fmtCurrency(form.offer_price) : 'our cash offer'
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
      await sendSms(form.owner_phone, smsMessage, property.id)
      setSmsSuccess('SMS sent successfully.')
      setShowSmsModal(false)
      listPropertyCommunications(property.id).then(setComms).catch(() => {})
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setSmsError(detail ?? 'Failed to send SMS. Check TELNYX_API_KEY and TELNYX_PHONE_NUMBER.')
    } finally { setSmsSending(false) }
  }

  async function handleQuickText() {
    if (!property?.id || !property?.campaign_id) return
    setQuickTextSending(true); setQuickTextResult(null)
    try {
      const res = await startSmsCampaign(property.campaign_id, 1, [property.id])
      setQuickTextResult(res.total > 0 ? '✓ Day 1 text queued' : 'No eligible mobile number found')
      setTimeout(() => setQuickTextResult(null), 3000)
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setQuickTextResult(detail ?? 'Failed to send')
    } finally { setQuickTextSending(false) }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function set(field: keyof CRMProperty, value: any) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  function setFloat(field: keyof CRMProperty, raw: string) {
    const v = raw === '' ? undefined : parseFloat(raw)
    set(field, isNaN(v as number) ? undefined : v)
  }

  // Local state for fields not managed by Field component
  const [notesLocal, setNotesLocal] = useState(property?.notes || '')
  const [confLocal, setConfLocal] = useState((property?.confidence_level as string | undefined) || '')

  useEffect(() => { setNotesLocal(form.notes || '') }, [form.notes])
  useEffect(() => { setConfLocal((form.confidence_level as string | undefined) || '') }, [form.confidence_level])

  async function handleSave() {
    setSaving(true)
    setSavedOk(false)
    setError(null)
    const saveForm = {
      ...form,
      phone_1_type: form.phone_1 ? (form.phone_1_type || 'mobile') : form.phone_1_type,
      phone_2_type: form.phone_2 ? (form.phone_2_type || 'mobile') : form.phone_2_type,
    }
    console.log('[PropertyDetail] Saving:', { phone_1: saveForm.phone_1, phone_1_type: saveForm.phone_1_type, phone_1_dnc: saveForm.phone_1_dnc })
    try {
      await onSave(saveForm)
      if (isNew) {
        onBack()
      } else {
        setSavedOk(true)
        setTimeout(() => setSavedOk(false), 2000)
      }
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
      setLpMsg(`✓ LP data pulled — LP Estimate: ${updated.lp_estimate != null ? fmtCurrency(updated.lp_estimate) : '—'}, Offer Price: ${updated.offer_price != null ? fmtCurrency(updated.offer_price) : '—'}`)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setError(err?.response?.data?.detail ?? 'LP pull failed')
    } finally {
      setLpPulling(false)
    }
  }

  async function handleSaveNotes() {
    if (isNew || noteSaving || !notesLocal.trim()) return
    set('notes', notesLocal)
    setNoteSaving(true)
    try {
      await onSave({ notes: notesLocal })
      // Add to timestamped history
      if (property?.id) {
        try {
          const note = await addPropertyNote(property.id, notesLocal.trim())
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
              {property?.campaign_id && (
                <button
                  className="btn-secondary text-sm flex items-center gap-1.5"
                  onClick={handleQuickText}
                  disabled={quickTextSending}
                  title="Send Day 1 campaign text to this person"
                  style={quickTextResult?.startsWith('✓') ? { color: '#059669', borderColor: '#059669' } : {}}
                >
                  📱 {quickTextSending ? 'Sending…' : quickTextResult || 'Text This Person'}
                </button>
              )}
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
          <button className="btn-primary" onClick={handleSave} disabled={saving}
            style={savedOk ? { background: '#059669' } : undefined}>
            {saving ? 'Saving…' : savedOk ? 'Saved ✓' : isNew ? 'Create Property' : 'Save Changes'}
          </button>
        </div>
      </div>

      <div className="p-6" style={{ maxWidth: '900px' }}>
        {error && (
          <div className="mb-4 p-3 rounded-lg text-sm" style={{ background: '#FEE2E2', color: '#DC2626', border: '1px solid #FECACA' }}>
            {error}
          </div>
        )}
        {lpMsg && (
          <div className="mb-4 p-3 rounded-lg text-sm" style={{ background: '#D1FAE5', color: '#059669', border: '1px solid #A7F3D0' }}>
            {lpMsg}
          </div>
        )}
        {smsSuccess && (
          <div className="mb-4 p-3 rounded-lg text-sm" style={{ background: '#D1FAE5', color: '#059669', border: '1px solid #A7F3D0' }}>
            {smsSuccess}
          </div>
        )}

        <FieldCtx.Provider value={{ form, setField: set }}>
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
              <PhoneField label="Owner Phone (raw)" value={form.owner_phone} onChange={v => set('owner_phone', v)} />
              <Field label="Email" field="owner_email" placeholder="owner@email.com" />
              <Field label="Email (Skip Traced)" field="email_1" placeholder="skip@traced.com" />
              <SkipTracedPhoneRow
                label="Phone 1 (Skip Traced — used for SMS)"
                phone={form.phone_1} phoneType={form.phone_1_type} dnc={form.phone_1_dnc}
                onPhone={v => set('phone_1', v)}
                onType={v => set('phone_1_type', v)}
                onDnc={v => set('phone_1_dnc', v)}
              />
              <SkipTracedPhoneRow
                label="Phone 2 (Skip Traced)"
                phone={form.phone_2} phoneType={form.phone_2_type} dnc={form.phone_2_dnc}
                onPhone={v => set('phone_2', v)}
                onType={v => set('phone_2_type', v)}
                onDnc={v => set('phone_2_dnc', v)}
              />
              <PhoneField label="Phone 3" value={form.phone_3} onChange={v => set('phone_3', v)} />
              <div />
              <div />
              <Field label="Mailing Address (Line 1)" field="owner_mailing_address" placeholder="123 Main St" />
              <Field label="City" field="owner_mailing_city" placeholder="Austin" />
              <Field label="Mailing State" field="owner_mailing_state" placeholder="TX" />
              <Field label="Zip" field="owner_mailing_zip" placeholder="78701" />
              {(() => {
                const mailState = (form.owner_mailing_state as string | undefined)?.toUpperCase().trim()
                const parcelState = (form.state as string | undefined)?.toUpperCase().trim()
                if (!mailState || !parcelState) return null
                const isOut = mailState !== parcelState
                return (
                  <div>
                    <label className="label-caps">Owner Location</label>
                    <p className="text-xs mt-1 font-semibold" style={{ color: isOut ? '#059669' : '#6B7280' }}>
                      {isOut ? `Out of State (${mailState})` : `In State (${mailState})`}
                    </p>
                  </div>
                )
              })()}
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
                      style={{ background: '#F7F3FC', color: '#5C2977', border: '1px solid #E8E0F0' }}>
                      {p}
                      <button onClick={() => removePhone(p)} style={{ color: '#9B8AAE', lineHeight: 1 }}>×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </AccordionSection>

          {/* Communications History — always visible, full thread */}
          {!isNew && (
            <div style={{ border: '1px solid #E8E0F0', borderRadius: '8px', background: '#FFFFFF', overflow: 'hidden' }}>
              <div style={{ padding: '12px 16px', background: '#EDE8F5', borderBottom: '1px solid #E8E0F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '14px', fontWeight: 600, color: '#1A0A2E', fontFamily: "'Montserrat', sans-serif" }}>
                  Communications History
                </span>
                <span style={{ fontSize: '11px', color: '#9B8AAE' }}>{comms.length} messages</span>
              </div>
              <div style={{ padding: '16px', maxHeight: 480, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {commsLoading ? (
                  <p style={{ fontSize: 12, color: '#9B8AAE' }}>Loading…</p>
                ) : comms.length === 0 ? (
                  <p style={{ fontSize: 12, color: '#9B8AAE' }}>
                    No communications yet. Use "Send Text" to SMS, or history appears when seller calls or texts your Telnyx number.
                  </p>
                ) : (
                  [...comms]
                    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
                    .map(c => {
                      const isOut = c.direction === 'outbound' || c.type === 'sms_outbound'
                      const isCall = c.type?.startsWith('call')
                      const ts = new Date(c.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
                      if (isCall) {
                        return (
                          <div key={c.id} style={{ borderRadius: 10, background: '#F7F3FC', border: '1px solid #E8E0F0', padding: '10px 14px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#5C2977" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.63 3.38 2 2 0 0 1 3.6 1.21h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.9a16 16 0 0 0 6 6l1.06-1.06a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
                              </svg>
                              <span style={{ fontSize: 11, fontWeight: 600, color: '#5C2977' }}>
                                {isOut ? 'Outbound Call' : 'Inbound Call'}
                              </span>
                              {c.duration_seconds != null && (
                                <span style={{ fontSize: 11, color: '#9B8AAE' }}>{fmtTalk(c.duration_seconds)}</span>
                              )}
                              <ScoreBadge score={c.lead_score} />
                              <span style={{ fontSize: 10, color: '#9B8AAE', marginLeft: 'auto' }}>{ts}</span>
                            </div>
                            {c.summary && <p style={{ fontSize: 11, color: '#374151', lineHeight: 1.5, marginBottom: c.recording_url ? 6 : 0 }}>{c.summary}</p>}
                            {c.recording_url && (
                              <audio controls src={c.recording_url} style={{ width: '100%', height: 32, marginTop: 4 }} />
                            )}
                          </div>
                        )
                      }
                      return (
                        <div key={c.id} style={{ display: 'flex', justifyContent: isOut ? 'flex-end' : 'flex-start' }}>
                          <div style={{
                            maxWidth: '78%',
                            padding: '8px 12px',
                            borderRadius: isOut ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                            background: isOut ? '#EEF2FF' : '#F3F4F6',
                            border: isOut ? '1px solid #C7D2FE' : '1px solid #E5E7EB',
                          }}>
                            <div style={{ fontSize: 10, color: '#9CA3AF', marginBottom: 3 }}>
                              {isOut ? '→ SENT' : '← RECEIVED'} · {ts}
                            </div>
                            <div style={{ fontSize: 13, color: '#1A0A2E', lineHeight: 1.5 }}>
                              {c.message_body ?? <em style={{ color: '#9CA3AF' }}>(no message body)</em>}
                            </div>
                          </div>
                        </div>
                      )
                    })
                )}
              </div>
            </div>
          )}

          {/* Campaign & Sale */}
          <AccordionSection title="Campaign & Sale" sectionKey="campaign" {...accordionProps}>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Campaign Code" field="campaign_code" />
              <CurrencyInput label="Offer Price" value={form.offer_price} onChange={v => set('offer_price', v)} />
            </div>
          </AccordionSection>

          {/* Comp-Based Pricing */}
          <AccordionSection title="Comp-Based Pricing" sectionKey="comp-pricing" {...accordionProps}>
            {(() => {
              const pricingDesc = form.pricing_description as string | undefined
              const pricingTier = form.pricing_tier as string | undefined
              const compMedianPpa = form.comp_median_ppa as number | null | undefined
              const compDerivedValue = form.comp_derived_value as number | null | undefined
              const offer = form.offer_price as number | null | undefined
              const retail = compDerivedValue ?? (form.lp_estimate && (form.lp_estimate as number) > 0 ? form.lp_estimate as number : null)
              const fee = retail != null && offer != null ? Math.max(0, Math.round((retail as number) - (offer as number))) : null
              const isLpFallback = !compDerivedValue && form.lp_estimate
              return (
                <div>
                  {pricingDesc && (
                    <div className="mb-4 px-3 py-2.5 rounded-lg text-xs" style={{ background: '#F7F3FC', border: '1px solid #E8E0F0', color: '#374151' }}>
                      {pricingTier && (
                        <span className="inline-block mr-2 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase" style={{ background: '#EDE8F5', color: '#5C2977' }}>
                          {pricingTier.replace(/_/g, ' ')}
                        </span>
                      )}
                      {pricingDesc}
                    </div>
                  )}
                  {isLpFallback && (
                    <div className="mb-4 px-3 py-2 rounded-lg text-[10px]" style={{ background: '#FEF3C7', color: '#92400E', border: '1px solid #FDE68A' }}>
                      LP Estimate fallback — no comp found within 1 mile
                    </div>
                  )}
                  <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #E8E0F0' }}>
                    {[
                      { label: 'Comp Median $/Acre', value: compMedianPpa, fmt: (v: number) => `$${Math.round(v).toLocaleString()}/ac`, color: '#374151' },
                      { label: 'Comp-Derived Value', value: retail, fmt: (v: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v), color: '#1A0A2E' },
                      { label: 'Your Offer', value: offer, fmt: (v: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v), color: '#DC2626' },
                    ].map(({ label, value, fmt, color }, i) => (
                      <div key={label} className="flex justify-between items-center px-4 py-3"
                        style={{ borderBottom: '1px solid #F3F4F6', background: i % 2 === 0 ? '#FAFAFA' : '#FFFFFF' }}>
                        <span style={{ fontSize: 12, color: '#6B5B8A' }}>{label}</span>
                        <span style={{ fontSize: 13, fontWeight: 600, color }}>
                          {value != null ? fmt(value as number) : <span style={{ color: '#C4B5D6' }}>—</span>}
                        </span>
                      </div>
                    ))}
                    <div className="flex justify-between items-center px-4 py-3.5" style={{ background: '#F7F3FC' }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#1A0A2E' }}>Est. Assignment Fee</span>
                      <span style={{ fontSize: 16, fontWeight: 800, color: '#059669' }}>
                        {fee != null
                          ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(fee)
                          : <span style={{ color: '#C4B5D6', fontSize: 13, fontWeight: 400 }}>—</span>}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })()}
          </AccordionSection>

          {/* Comparables */}
          <AccordionSection title="Comparables" sectionKey="comps" {...accordionProps}>
            {/* Quality flag banner */}
            {form.comp_quality_flags && (
              <div className="mb-4 flex flex-wrap gap-2 items-center">
                {form.comp_quality_flags.split(',').map(f => f.trim()).filter(Boolean).map(flag => (
                  <span key={flag} className="text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-wider"
                    style={{
                      background: flag === 'REVIEW_NEEDED' ? '#FEE2E2' : '#FEF3C7',
                      color: flag === 'REVIEW_NEEDED' ? '#DC2626' : '#D97706',
                      border: `1px solid ${flag === 'REVIEW_NEEDED' ? '#FECACA' : '#FDE68A'}`,
                    }}>
                    {flag.replace(/_/g, ' ')}
                  </span>
                ))}
                {form.pricing_method_used && (
                  <span className="text-[10px] font-medium px-2 py-1 rounded-full" style={{ background: '#F7F3FC', color: '#5C2977' }}>
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
                const now = Date.now()
                const dateMs = date ? new Date(date).getTime() : null
                const isStale = dateMs != null && (now - dateMs) > 18 * 30.44 * 24 * 60 * 60 * 1000
                const propertyAcreage = form.acreage
                const isPoor = acreage != null && propertyAcreage != null && propertyAcreage > 0
                  ? Math.max(acreage, propertyAcreage) / Math.min(acreage, propertyAcreage) > 3
                  : false
                return (
                  <div key={n} className="rounded-xl overflow-hidden" style={{ border: '1px solid #E8E0F0' }}>
                    <div className="px-4 pt-4 pb-3" style={{ background: '#F7F3FC', borderBottom: '1px solid #E8E0F0' }}>
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#9B8AAE' }}>Comp {n}</p>
                        <div className="flex gap-1">
                          {isStale && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: '#FEF3C7', color: '#D97706', border: '1px solid #FDE68A' }}>STALE</span>}
                          {isPoor && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: '#FEE2E2', color: '#DC2626', border: '1px solid #FECACA' }}>POOR</span>}
                        </div>
                      </div>
                      <p className="text-2xl font-bold" style={{ color: '#1A0A2E' }}>
                        {price != null ? fmtCurrency(price) : <span style={{ color: '#9B8AAE', fontSize: '13px', fontWeight: 400 }}>No price yet</span>}
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
                      style={{ background: '#F7F3FC', color: '#5C2977', border: '1px solid #E8E0F0' }}>
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
                value={notesLocal}
                onChange={e => setNotesLocal(e.target.value)}
                onBlur={() => set('notes', notesLocal)}
                rows={4}
                style={{
                  padding: '8px 12px',
                  width: '100%',
                  background: '#F7F3FC',
                  border: '1.5px solid #E8E0F0',
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
                  <span className="text-xs font-medium" style={{ color: '#059669' }}>Saved to history</span>
                )}
              </div>
              {noteHistory.length > 0 && (
                <div className="mt-4">
                  <p className="label-caps mb-2">Note History</p>
                  <div className="flex flex-col gap-2">
                    {noteHistory.map(n => (
                      <div key={n.id} className="rounded-lg p-3" style={{ background: '#F7F3FC', border: '1px solid #E8E0F0' }}>
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
            <div className="grid grid-cols-4 gap-3 mb-4 p-3 rounded-xl" style={{ background: '#F7F3FC', border: '1px solid #E8E0F0' }}>
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
                <p className="text-sm font-medium" style={{ color: fmtLandLocked(form.land_locked as string | undefined) === 'Yes' ? '#DC2626' : '#1A0A2E' }}>
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
              {(() => {
                const conf = normalizeConfidence(form.confidence_level as string | undefined)
                return conf ? (
                  <span className="inline-block self-start px-3 py-1.5 rounded-full text-sm font-bold"
                    style={{
                      background: conf === 'HIGH' ? '#D1FAE5' : conf === 'MEDIUM' ? '#FEF3C7' : '#FEE2E2',
                      color: conf === 'HIGH' ? '#059669' : conf === 'MEDIUM' ? '#D97706' : '#DC2626',
                    }}>
                    {conf}
                  </span>
                ) : (
                  <input
                    type="text"
                    className="input-base"
                    value={confLocal}
                    onChange={e => setConfLocal(e.target.value)}
                    onBlur={() => set('confidence_level', confLocal)}
                    placeholder="High / Medium / Low"
                    style={{ maxWidth: 200 }}
                  />
                )
              })()}
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
                <p className="text-xs mb-3" style={{ color: '#DC2626' }}>{docError}</p>
              )}
              {docsLoading ? (
                <p className="text-xs" style={{ color: '#9B8AAE' }}>Loading…</p>
              ) : docs.length === 0 ? (
                <p className="text-xs" style={{ color: '#9B8AAE' }}>No documents yet. Upload a PDF, Word doc, or image.</p>
              ) : (
                <div className="space-y-2">
                  {docs.map(doc => (
                    <div key={doc.id} className="flex items-center justify-between rounded-lg px-4 py-3"
                      style={{ background: '#F7F3FC', border: '1px solid #E8E0F0' }}>
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
                          style={{ color: '#DC2626', padding: '4px 8px' }}
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


        </div>
        </FieldCtx.Provider>
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
            {smsError && <p className="text-xs mb-2" style={{ color: '#DC2626' }}>{smsError}</p>}
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
                style={{ background: callMsg.startsWith('Error') ? '#FEE2E2' : '#D1FAE5', color: callMsg.startsWith('Error') ? '#DC2626' : '#059669' }}>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(26,10,46,0.5)' }}>
          <div style={{ background: '#FFFFFF', border: '1px solid #E8E0F0', borderRadius: '8px', padding: '24px', width: '100%', maxWidth: '384px' }}>
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
