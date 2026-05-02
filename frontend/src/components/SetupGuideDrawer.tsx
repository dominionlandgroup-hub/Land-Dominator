import React from 'react'
import { useApp } from '../context/AppContext'

interface Props {
  onClose: () => void
  onOpenStep: (step: number) => void
}

const STEPS = [
  { num: 1, label: 'Choose Your Strategy', desc: 'Pick infill lots, rural acreage, or subdivide & sell' },
  { num: 2, label: 'Learn How It Works', desc: 'Understand the direct mail + comps pricing workflow' },
  { num: 3, label: 'Research Your Market', desc: 'Select a state and county to target' },
  { num: 4, label: 'Upload Sold Comps', desc: 'Export LLC sales from Land Portal and upload CSV' },
  { num: 5, label: 'Select Your Market', desc: 'Review comp data and launch your first campaign' },
  { num: 6, label: 'Set Budget and Launch', desc: 'Configure mail budget and send your first mailer' },
]

export default function SetupGuideDrawer({ onClose, onOpenStep }: Props) {
  const { compsStats, dashboardData, campaigns, loadingCampaigns } = useApp()

  function isComplete(step: number): boolean {
    switch (step) {
      case 1: return true  // strategy always "complete" — user chose to open the app
      case 2: return true  // educational step
      case 3: return !!(dashboardData?.top_states?.length || dashboardData?.top_counties?.length)
      case 4: return !!(compsStats?.valid_rows && compsStats.valid_rows > 0)
      case 5: return campaigns.length > 0
      case 6: return campaigns.some(c => (c.cost_per_piece ?? 0) > 0)
      default: return false
    }
  }

  const completedCount = loadingCampaigns ? null : STEPS.filter(s => isComplete(s.num)).length
  const totalSteps = STEPS.length

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(0,0,0,0.6)' }}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className="fixed top-0 right-0 bottom-0 z-50 flex flex-col"
        style={{
          width: 380,
          background: '#1A1A1A',
          borderLeft: '1px solid #2E2E2E',
        }}
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4" style={{ borderBottom: '1px solid #2E2E2E' }}>
          <div className="flex items-start justify-between mb-3">
            <div>
              <h2 className="text-base font-bold" style={{ color: '#F5F5F5' }}>Setup Guide</h2>
              <p className="text-xs mt-0.5" style={{ color: '#A0A0A0' }}>Complete these steps to launch your first campaign</p>
            </div>
            <button
              onClick={onClose}
              className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
              style={{ color: '#A0A0A0', background: 'transparent' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#242424')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>

          {/* Progress bar */}
          {completedCount !== null && (
            <div>
              <div className="flex justify-between text-xs mb-1.5" style={{ color: '#6B6B6B' }}>
                <span>{completedCount} of {totalSteps} steps complete</span>
                <span>{Math.round((completedCount / totalSteps) * 100)}%</span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#2E2E2E' }}>
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${(completedCount / totalSteps) * 100}%`, background: '#7C3AED' }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Steps list */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1">
          {STEPS.map((step, i) => {
            const done = isComplete(step.num)
            const isNext = !done && (i === 0 || isComplete(STEPS[i - 1].num))
            return (
              <div
                key={step.num}
                className="rounded-xl p-3 transition-all"
                style={{
                  background: isNext ? 'rgba(124,58,237,0.12)' : '#242424',
                  border: isNext ? '1px solid rgba(124,58,237,0.25)' : '1px solid #2E2E2E',
                }}
              >
                <div className="flex items-start gap-3">
                  {/* Status circle */}
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center flex-none mt-0.5 text-xs font-bold"
                    style={{
                      background: done ? '#10B981' : isNext ? '#7C3AED' : '#2E2E2E',
                      color: done || isNext ? '#fff' : '#6B6B6B',
                    }}
                  >
                    {done ? '✓' : step.num}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p
                      className="text-sm font-semibold truncate"
                      style={{ color: done ? '#6B6B6B' : '#F5F5F5' }}
                    >
                      {step.label}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: '#A0A0A0' }}>{step.desc}</p>
                  </div>

                  <button
                    className="text-xs px-2.5 py-1 rounded-lg font-medium flex-none transition-colors"
                    style={{
                      background: done ? 'transparent' : isNext ? '#7C3AED' : 'transparent',
                      color: done ? '#6B6B6B' : isNext ? '#fff' : '#A0A0A0',
                      border: done ? '1px solid #2E2E2E' : isNext ? 'none' : '1px solid #3E3E3E',
                    }}
                    onClick={() => onOpenStep(step.num)}
                  >
                    {done ? 'Review' : isNext ? 'Start →' : 'Open'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="px-6 py-4" style={{ borderTop: '1px solid #2E2E2E' }}>
          <p className="text-[10px] text-center" style={{ color: '#6B6B6B' }}>
            You can always access this guide from the sidebar
          </p>
        </div>
      </div>
    </>
  )
}
