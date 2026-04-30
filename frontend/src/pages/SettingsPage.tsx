import React, { useState } from 'react'
import { clearAllProperties } from '../api/crm'

const SECTIONS = [
  { title: 'Account',       desc: 'Manage your profile, email, and password.' },
  { title: 'Integrations',  desc: 'Connect CRM, communication, and data providers.' },
  { title: 'Notifications', desc: 'Configure email and push notification preferences.' },
  { title: 'Data & Import', desc: 'Manage CSV templates, field mappings, and exports.' },
  { title: 'Team',          desc: 'Invite teammates and manage access permissions.' },
  { title: 'Billing',       desc: 'Subscription plan, invoices, and payment methods.' },
]

export default function SettingsPage() {
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [clearDone, setClearDone] = useState(false)
  const [clearError, setClearError] = useState<string | null>(null)

  async function handleClearAll() {
    setClearing(true)
    setClearError(null)
    try {
      await clearAllProperties()
      setClearDone(true)
      setShowClearConfirm(false)
    } catch {
      setClearError('Failed to clear properties. Try again.')
    } finally {
      setClearing(false)
    }
  }

  return (
    <div className="flex flex-col min-h-screen" style={{ background: '#F8F6FB' }}>
      <div className="page-header">
        <div>
          <h1 className="text-lg font-bold" style={{ color: '#1A0A2E' }}>Settings</h1>
          <p className="text-xs mt-0.5" style={{ color: '#6B5B8A' }}>Configure your account and preferences</p>
        </div>
      </div>
      <div className="p-6 max-w-3xl">
        <div className="space-y-3">
          {SECTIONS.map((s) => (
            <div
              key={s.title}
              className="bg-white rounded-xl px-5 py-4 flex items-center justify-between cursor-pointer transition-all hover:shadow-sm"
              style={{ border: '1px solid #EDE8F5' }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#D4B8E8')}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#EDE8F5')}
            >
              <div>
                <p className="font-semibold text-sm" style={{ color: '#1A0A2E' }}>{s.title}</p>
                <p className="text-xs mt-0.5" style={{ color: '#9B8AAE' }}>{s.desc}</p>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9B8AAE" strokeWidth="2">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </div>
          ))}
        </div>

        {/* Danger Zone */}
        <div className="mt-10">
          <h2 className="text-sm font-bold mb-3 uppercase tracking-wider" style={{ color: '#B71C1C' }}>Danger Zone</h2>
          <div className="bg-white rounded-xl px-5 py-4" style={{ border: '1px solid #FFCDD2' }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-sm" style={{ color: '#1A0A2E' }}>Clear All Properties</p>
                <p className="text-xs mt-0.5" style={{ color: '#9B8AAE' }}>
                  Permanently delete every property record from the CRM. This cannot be undone.
                </p>
                {clearDone && (
                  <p className="text-xs mt-1 font-semibold" style={{ color: '#2E7D32' }}>
                    All properties cleared successfully.
                  </p>
                )}
                {clearError && (
                  <p className="text-xs mt-1 font-semibold" style={{ color: '#B71C1C' }}>{clearError}</p>
                )}
              </div>
              <button
                className="ml-4 px-4 py-2 rounded-lg text-sm font-semibold text-white flex-none"
                style={{ background: '#B71C1C' }}
                onClick={() => { setClearDone(false); setClearError(null); setShowClearConfirm(true) }}
              >
                Clear All Properties
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation dialog */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(26,10,46,0.55)' }}>
          <div className="bg-white rounded-2xl p-6 w-full shadow-xl" style={{ maxWidth: '420px' }}>
            <h2 className="text-base font-bold mb-2" style={{ color: '#B71C1C' }}>Clear All Properties?</h2>
            <p className="text-sm mb-2" style={{ color: '#6B5B8A' }}>
              This will permanently delete <strong>every property record</strong> in your CRM. All data — contacts linked to properties, campaign history, deal associations — will be unaffected, but the properties themselves cannot be recovered.
            </p>
            <p className="text-sm font-semibold mb-6" style={{ color: '#B71C1C' }}>
              This action cannot be undone.
            </p>
            {clearError && (
              <div className="mb-4 p-3 rounded-lg text-sm" style={{ background: '#FFF0F0', color: '#B71C1C', border: '1px solid #FFCDD2' }}>
                {clearError}
              </div>
            )}
            <div className="flex gap-3">
              <button
                className="btn-secondary flex-1"
                onClick={() => setShowClearConfirm(false)}
                disabled={clearing}
              >
                Cancel
              </button>
              <button
                className="flex-1 px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60"
                style={{ background: '#B71C1C' }}
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
