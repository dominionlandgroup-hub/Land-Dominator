import React from 'react'

const SECTIONS = [
  { title: 'Account',       desc: 'Manage your profile, email, and password.' },
  { title: 'Integrations',  desc: 'Connect CRM, communication, and data providers.' },
  { title: 'Notifications', desc: 'Configure email and push notification preferences.' },
  { title: 'Data & Import', desc: 'Manage CSV templates, field mappings, and exports.' },
  { title: 'Team',          desc: 'Invite teammates and manage access permissions.' },
  { title: 'Billing',       desc: 'Subscription plan, invoices, and payment methods.' },
]

export default function SettingsPage() {
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
      </div>
    </div>
  )
}
