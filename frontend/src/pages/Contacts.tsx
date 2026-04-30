import React, { useEffect, useState } from 'react'
import DataTable from '../components/DataTable'
import type { Column } from '../components/DataTable'
import type { CRMContact } from '../types/crm'
import { listContacts, createContact, updateContact, deleteContact } from '../api/crm'

export default function Contacts() {
  const [contacts, setContacts] = useState<CRMContact[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editContact, setEditContact] = useState<CRMContact | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => { fetchContacts() }, [])

  async function fetchContacts() {
    setLoading(true)
    setError(null)
    try {
      const data = await listContacts()
      setContacts(data)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      const detail = err?.response?.data?.detail ?? ''
      setError(detail && !detail.includes('SUPABASE') ? detail : 'Failed to load contacts. Check that the backend API is reachable.')
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id)
    try {
      await deleteContact(id)
      setContacts(prev => prev.filter(c => c.id !== id))
    } catch {
      // ignore
    } finally {
      setDeletingId(null)
    }
  }

  const columns: Column<CRMContact>[] = [
    {
      key: 'full_name',
      header: 'Name',
      sortable: true,
      render: (val, row) => (
        <button
          onClick={() => { setEditContact(row); setShowForm(true) }}
          className="font-semibold text-left hover:underline"
          style={{ color: '#5C2977' }}
        >
          {val
            ? String(val)
            : [row.first_name, row.last_name].filter(Boolean).join(' ') || <span style={{ color: '#9B8AAE' }}>—</span>}
        </button>
      ),
    },
    {
      key: 'email',
      header: 'Email',
      sortable: true,
      render: (val) => val
        ? <a href={`mailto:${val}`} style={{ color: '#5C2977' }}>{String(val)}</a>
        : <span style={{ color: '#9B8AAE' }}>—</span>,
    },
    {
      key: 'phone',
      header: 'Phone',
      render: (val) => val ? String(val) : <span style={{ color: '#9B8AAE' }}>—</span>,
    },
    {
      key: 'state',
      header: 'State',
      sortable: true,
      render: (val) => val ? String(val) : <span style={{ color: '#9B8AAE' }}>—</span>,
    },
    {
      key: 'city',
      header: 'City',
      sortable: true,
      defaultHidden: true,
      render: (val) => val ? String(val) : <span style={{ color: '#9B8AAE' }}>—</span>,
    },
    {
      key: 'tags',
      header: 'Tags',
      render: (val) => {
        const tags = (val as string[] | undefined) || []
        return tags.length > 0 ? (
          <div className="flex gap-1 flex-wrap">
            {tags.map(t => (
              <span key={t} className="px-1.5 py-0.5 rounded text-[11px]"
                style={{ background: '#F0EBF8', color: '#5C2977' }}>{t}</span>
            ))}
          </div>
        ) : <span style={{ color: '#9B8AAE' }}>—</span>
      },
    },
    {
      key: 'id',
      header: '',
      align: 'right',
      render: (val) => (
        <button
          className="btn-danger"
          style={{ height: '28px', padding: '0 10px', fontSize: '12px' }}
          disabled={deletingId === String(val)}
          onClick={() => handleDelete(String(val))}
        >
          {deletingId === String(val) ? '…' : 'Delete'}
        </button>
      ),
    },
  ]

  return (
    <div className="page-content">
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Contacts</h1>
          <p className="page-subtitle">{contacts.length.toLocaleString()} contacts</p>
        </div>
        <button className="btn-primary" onClick={() => { setEditContact(null); setShowForm(true) }}>
          + New Contact
        </button>
      </div>

      <div className="p-6">
        {/* Summary stat */}
        <div className="grid gap-4 mb-6" style={{ gridTemplateColumns: 'repeat(3, 1fr)', maxWidth: '480px' }}>
          {[
            { label: 'Total Contacts', value: contacts.length, accent: '#5C2977' },
            { label: 'With Email', value: contacts.filter(c => c.email).length, accent: '#1565C0' },
            { label: 'With Phone', value: contacts.filter(c => c.phone).length, accent: '#2E7D32' },
          ].map(s => (
            <div key={s.label} className="stat-card" style={{ '--stat-accent': s.accent } as React.CSSProperties}>
              <span className="label-caps">{s.label}</span>
              <span className="stat-value" style={{ fontSize: '28px' }}>{s.value}</span>
            </div>
          ))}
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg text-sm" style={{ background: '#FFF0F0', color: '#B71C1C', border: '1px solid #FFCDD2' }}>
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="text-sm" style={{ color: '#6B5B8A' }}>Loading contacts…</div>
          </div>
        ) : (
          <div className="card-static">
            <DataTable
              columns={columns}
              data={contacts}
              searchable
              searchKeys={['full_name', 'first_name', 'last_name', 'email', 'phone', 'state', 'city']}
              pageSize={50}
              emptyMessage="No contacts yet. Add your first contact to get started."
            />
          </div>
        )}
      </div>

      {showForm && (
        <ContactForm
          contact={editContact}
          onClose={() => { setShowForm(false); setEditContact(null) }}
          onSave={async (data) => {
            if (editContact) {
              const updated = await updateContact(editContact.id, data)
              setContacts(prev => prev.map(c => c.id === editContact.id ? updated : c))
            } else {
              const created = await createContact(data)
              setContacts(prev => [created, ...prev])
            }
            setShowForm(false)
            setEditContact(null)
          }}
        />
      )}
    </div>
  )
}

function ContactForm({
  contact, onClose, onSave,
}: {
  contact: CRMContact | null
  onClose: () => void
  onSave: (data: Partial<CRMContact>) => Promise<void>
}) {
  const [form, setForm] = useState<Partial<CRMContact>>(contact ?? {})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tagInput, setTagInput] = useState('')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function set(field: keyof CRMContact, value: any) {
    setForm(prev => ({ ...prev, [field]: value }))
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

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const payload = {
        ...form,
        full_name: form.full_name ||
          [form.first_name, form.last_name].filter(Boolean).join(' ') || undefined,
      }
      await onSave(payload)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setError(err?.response?.data?.detail ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(26,10,46,0.55)' }}>
      <div className="bg-white rounded-2xl p-6 w-full shadow-xl" style={{ maxWidth: '520px', maxHeight: '90vh', overflowY: 'auto' }}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="section-heading">{contact ? 'Edit Contact' : 'New Contact'}</h2>
          <button onClick={onClose} style={{ color: '#9B8AAE', fontSize: '18px', lineHeight: 1 }}>✕</button>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg text-sm" style={{ background: '#FFF0F0', color: '#B71C1C', border: '1px solid #FFCDD2' }}>
            {error}
          </div>
        )}

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label-caps">First Name</label>
              <input type="text" className="input-base mt-1" value={form.first_name || ''}
                onChange={e => set('first_name', e.target.value)} />
            </div>
            <div>
              <label className="label-caps">Last Name</label>
              <input type="text" className="input-base mt-1" value={form.last_name || ''}
                onChange={e => set('last_name', e.target.value)} />
            </div>
          </div>

          <div>
            <label className="label-caps">Email</label>
            <input type="email" className="input-base mt-1" value={form.email || ''}
              onChange={e => set('email', e.target.value)} placeholder="owner@email.com" />
          </div>

          <div>
            <label className="label-caps">Phone</label>
            <input type="text" className="input-base mt-1" value={form.phone || ''}
              onChange={e => set('phone', e.target.value)} placeholder="(555) 000-0000" />
          </div>

          <div>
            <label className="label-caps">Mailing Address</label>
            <input type="text" className="input-base mt-1" value={form.mailing_address || ''}
              onChange={e => set('mailing_address', e.target.value)} />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label-caps">City</label>
              <input type="text" className="input-base mt-1" value={form.city || ''}
                onChange={e => set('city', e.target.value)} />
            </div>
            <div>
              <label className="label-caps">State</label>
              <input type="text" className="input-base mt-1" value={form.state || ''}
                onChange={e => set('state', e.target.value)} placeholder="TX" />
            </div>
            <div>
              <label className="label-caps">ZIP</label>
              <input type="text" className="input-base mt-1" value={form.zip || ''}
                onChange={e => set('zip', e.target.value)} />
            </div>
          </div>

          <div>
            <label className="label-caps">Notes</label>
            <textarea
              className="mt-1"
              rows={3}
              value={form.notes || ''}
              onChange={e => set('notes', e.target.value)}
              style={{
                width: '100%', padding: '8px 12px',
                background: '#FFFFFF', border: '1.5px solid #E0D0F0',
                borderRadius: '8px', fontSize: '13px',
                fontFamily: "'Montserrat', sans-serif",
                color: '#1A0A2E', outline: 'none', resize: 'vertical',
              }}
            />
          </div>

          <div>
            <label className="label-caps">Tags</label>
            <div className="flex gap-2 mt-1">
              <input
                type="text"
                className="input-base"
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addTag() }}
                placeholder="Add tag, press Enter"
              />
              <button className="btn-secondary" style={{ padding: '0 14px', flexShrink: 0 }} onClick={addTag}>Add</button>
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
        </div>

        <div className="flex gap-2 mt-6">
          <button className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
          <button className="btn-primary flex-1" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : contact ? 'Save Changes' : 'Create Contact'}
          </button>
        </div>
      </div>
    </div>
  )
}
