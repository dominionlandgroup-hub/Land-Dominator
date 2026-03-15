import React, { useEffect, useState } from 'react'

const STEPS = [
  'Loading target parcels…',
  'Calculating distances…',
  'Scoring matches…',
  'Applying filters…',
  'Generating offer pricing…',
  'Almost done…',
]

interface Props {
  visible: boolean
  title?: string
}

export default function LoadingOverlay({ visible, title = 'Running matching engine…' }: Props) {
  const [stepIdx, setStepIdx] = useState(0)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!visible) { setStepIdx(0); setElapsed(0); return }
    const stepTimer = setInterval(() => setStepIdx((i) => Math.min(i + 1, STEPS.length - 1)), 2500)
    const secTimer = setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => { clearInterval(stepTimer); clearInterval(secTimer) }
  }, [visible])

  if (!visible) return null

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(8,8,8,0.85)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: 'linear-gradient(135deg, #161616 0%, #0d1421 100%)',
        border: '1px solid rgba(59,130,246,0.25)',
        borderRadius: 20,
        padding: '40px 48px',
        textAlign: 'center',
        minWidth: 320,
        boxShadow: '0 24px 80px rgba(0,0,0,0.6), 0 0 60px rgba(59,130,246,0.08)',
      }}>
        {/* Spinner */}
        <div style={{
          width: 52, height: 52,
          border: '3px solid rgba(59,130,246,0.2)',
          borderTopColor: '#3b82f6',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
          margin: '0 auto 24px',
        }} />
        <p style={{ color: '#f5f0e8', fontSize: 18, fontWeight: 700, marginBottom: 10 }}>{title}</p>
        <p style={{
          color: '#60a5fa', fontSize: 13, minHeight: 20,
          transition: 'opacity 0.3s ease',
        }}>
          {STEPS[stepIdx]}
        </p>
        <p style={{ color: '#4b5563', fontSize: 12, marginTop: 16 }}>
          {elapsed}s elapsed
        </p>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
