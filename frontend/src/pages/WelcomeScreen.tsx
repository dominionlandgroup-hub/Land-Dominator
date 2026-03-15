import React from 'react'
import { useApp } from '../context/AppContext'

export default function WelcomeScreen({ contextualMessage }: { contextualMessage?: string }) {
  const { setCurrentPage } = useApp()

  return (
    <div className="flex items-center justify-center min-h-screen p-8" style={{ background: '#080808' }}>
      <div className="max-w-2xl w-full">
        {/* Hero */}
        <div className="text-center mb-12">
          <div
            className="w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6"
            style={{ background: 'linear-gradient(135deg, #C9A84C 0%, #A07828 100%)' }}
          >
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              <polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
          </div>
          <h1 className="text-3xl font-bold mb-3" style={{ color: '#f9fafb' }}>
            Welcome to Land Parcel Analysis Tool
          </h1>
          <p className="text-lg" style={{ color: '#8A8070' }}>
            Follow 3 steps to generate your first mailing list
          </p>
          {contextualMessage && (
            <p className="text-sm mt-3" style={{ color: '#C9A84C' }}>{contextualMessage}</p>
          )}
        </div>

        {/* Steps */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10">
          <StepCard
            number={1}
            icon={
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
            }
            title="Upload Sold Comps"
            description="Start by uploading your Land Portal sold comps CSV"
            accent="#C9A84C"
          />
          <StepCard
            number={2}
            icon={
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="11" cy="11" r="8"/>
                <line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
            }
            title="Analyze and Match"
            description="Review ZIP performance and match against your target list"
            accent="#C9A84C"
          />
          <StepCard
            number={3}
            icon={
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10 9 9 9 8 9"/>
              </svg>
            }
            title="Download Mailing List"
            description="Export a clean deduplicated list with suggested offer prices"
            accent="#10b981"
          />
        </div>

        {/* Features */}
        <div className="rounded-2xl p-6 mb-8" style={{ background: '#161616', border: '1px solid rgba(201,168,76,0.12)' }}>
          <p className="text-xs font-semibold uppercase tracking-wider mb-4" style={{ color: '#8A8070' }}>
            What you get
          </p>
          <div className="grid grid-cols-2 gap-3">
            {[
              'Interactive ZIP analytics dashboard',
              'Haversine-radius matching engine',
              'Confidence-rated offer pricing (HIGH/MEDIUM/LOW)',
              'Smart filters: flood zone, buildability, acreage',
              'Interactive maps for comps & results',
              'Campaign history with re-download',
            ].map((f) => (
              <div key={f} className="flex items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                <span className="text-sm" style={{ color: '#D1CABD' }}>{f}</span>
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className="flex justify-center">
          <button
            className="btn-primary text-base px-10 py-3"
            onClick={() => setCurrentPage('upload-comps')}
          >
            Get Started →
          </button>
        </div>
      </div>
    </div>
  )
}

function StepCard({ number, icon, title, description, accent }: {
  number: number
  icon: React.ReactNode
  title: string
  description: string
  accent: string
}) {
  return (
    <div
      className="rounded-2xl p-5 relative"
      style={{ background: '#161616', border: '1px solid rgba(201,168,76,0.12)' }}
    >
      <div
        className="absolute -top-3 -left-1 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
        style={{ background: accent, color: 'white' }}
      >
        {number}
      </div>
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center mb-3"
        style={{ background: `${accent}15`, color: accent }}
      >
        {icon}
      </div>
      <h3 className="font-semibold mb-1.5" style={{ color: '#f9fafb' }}>{title}</h3>
      <p className="text-sm leading-relaxed" style={{ color: '#8A8070' }}>{description}</p>
    </div>
  )
}
