import React from 'react'
import type { AppPage } from '../types'

interface BoardsProps {
  view: 'boards-seller' | 'boards-buyer' | 'boards-inventory'
}

const BOARD_LABELS: Record<string, string> = {
  'boards-seller':    'Seller Deals Board',
  'boards-buyer':     'Buyer Deals Board',
  'boards-inventory': 'Inventory Board',
}

const BOARD_DESCS: Record<string, string> = {
  'boards-seller':    'Track seller deal stages from lead to closed.',
  'boards-buyer':     'Manage buyer deal progress and negotiations.',
  'boards-inventory': 'View and manage your active land inventory.',
}

const BOARD_COLORS: Record<string, string> = {
  'boards-seller':    '#5C2977',
  'boards-buyer':     '#4A90D9',
  'boards-inventory': '#2D7A4F',
}

const STAGES = ['New Lead', 'Contacted', 'Offer Sent', 'Under Contract', 'Closed']

export default function Boards({ view }: BoardsProps) {
  const label = BOARD_LABELS[view]
  const desc = BOARD_DESCS[view]
  const color = BOARD_COLORS[view]

  return (
    <div className="flex flex-col min-h-screen" style={{ background: '#F8F6FB' }}>
      <div className="page-header">
        <div>
          <h1 className="text-lg font-bold" style={{ color: '#1A0A2E' }}>{label}</h1>
          <p className="text-xs mt-0.5" style={{ color: '#6B5B8A' }}>{desc}</p>
        </div>
        <button
          className="btn-primary text-sm"
          style={{ background: color, borderColor: color }}
        >
          + Add Deal
        </button>
      </div>

      <div className="p-6 overflow-x-auto">
        <div className="flex gap-4 min-w-max">
          {STAGES.map((stage) => (
            <div
              key={stage}
              className="w-64 rounded-xl p-4 flex-none"
              style={{ background: '#FFFFFF', border: '1px solid #EDE8F5', boxShadow: '0 1px 4px rgba(61,26,94,0.06)' }}
            >
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold" style={{ color: '#1A0A2E' }}>{stage}</p>
                <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: `${color}12`, color, border: `1px solid ${color}25` }}>
                  0
                </span>
              </div>
              <div
                className="rounded-lg p-4 text-center"
                style={{ background: '#F8F6FB', border: '1.5px dashed #E0D8F0', minHeight: '80px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <p className="text-xs" style={{ color: '#9B8AAE' }}>No deals yet</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
