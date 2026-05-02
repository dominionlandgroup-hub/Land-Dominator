import React from 'react'

export default function BuyerInbox() {
  return (
    <div className="flex flex-col min-h-screen" style={{ background: '#F8F6FB' }}>
      <div className="page-header">
        <div>
          <h1 className="text-lg font-bold" style={{ color: '#1A0A2E' }}>Buyer Inbox</h1>
          <p className="text-xs mt-0.5" style={{ color: '#6B5B8A' }}>Inbound buyer inquiries and messages</p>
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'rgba(213,169,64,0.1)' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#D5A940" strokeWidth="1.5">
              <polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/>
              <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>
            </svg>
          </div>
          <h2 className="text-lg font-semibold mb-2" style={{ color: '#1A0A2E' }}>Buyer Inbox</h2>
          <p className="text-sm" style={{ color: '#6B5B8A' }}>
            Connect your communication provider to view inbound buyer inquiries, calls, and texts here.
          </p>
        </div>
      </div>
    </div>
  )
}
