import React, { useEffect, useRef, useState } from 'react'
import { sendChatMessage } from '../api/ai'
import type { ChatMessage } from '../api/ai'

const WELCOME: ChatMessage = {
  role: 'assistant',
  content: `Hey Damien! Welcome to Land Dominator. I'm your land investing assistant. Let's get your first deal moving. Here's what we need to do:

Step 1 — Pull your sold comps from Land Portal
Step 2 — I'll analyze the market and find your best counties
Step 3 — Pull your mail list for the top county
Step 4 — I'll price every record at 52.5% of LP estimate
Step 5 — Set your budget and I'll build your mail schedule

Ready to start? Just tell me what state you want to target.`,
}

function renderContent(text: string): React.ReactNode {
  const lines = text.split('\n')
  return lines.map((line, i) => {
    // Bold: **text**
    const parts = line.split(/(\*\*[^*]+\*\*)/)
    const rendered = parts.map((part, j) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={j}>{part.slice(2, -2)}</strong>
      }
      return <span key={j}>{part}</span>
    })
    return (
      <React.Fragment key={i}>
        {rendered}
        {i < lines.length - 1 && <br />}
      </React.Fragment>
    )
  })
}

export default function AIAssistant() {
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
        inputRef.current?.focus()
      }, 50)
    }
  }, [isOpen])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  async function send() {
    const text = input.trim()
    if (!text || loading) return

    const userMsg: ChatMessage = { role: 'user', content: text }
    const updated = [...messages, userMsg].slice(-10)
    setMessages(updated)
    setInput('')
    setLoading(true)

    try {
      const reply = await sendChatMessage(updated)
      setMessages(prev => [...prev, { role: 'assistant' as const, content: reply }].slice(-10))
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      const detail = err?.response?.data?.detail ?? 'Connection error. Please try again.'
      const msg = detail.includes('ANTHROPIC_API_KEY')
        ? 'The AI API key is not configured. Add ANTHROPIC_API_KEY to your Railway environment variables.'
        : detail
      setMessages(prev => [...prev, { role: 'assistant' as const, content: msg }].slice(-10))
    } finally {
      setLoading(false)
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  return (
    <>
      {/* Floating bubble — hidden when panel open */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 z-40 flex items-center justify-center rounded-full shadow-xl transition-transform hover:scale-105 active:scale-95"
          style={{ width: 56, height: 56, background: '#7C3AED' }}
          title="Land Assistant"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </button>
      )}

      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sliding panel */}
      <div
        className="fixed top-0 right-0 h-full z-50 flex flex-col"
        style={{
          width: 400,
          background: '#1A1A1A',
          border: '1px solid #2E2E2E',
          transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.28s cubic-bezier(0.4,0,0.2,1)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center gap-3 px-4 py-3 flex-shrink-0"
          style={{
            background: '#111111',
            borderBottom: '1px solid #2E2E2E',
          }}
        >
          <img
            src="/logo.png"
            alt="Land Dominator"
            style={{ width: 32, height: 32, objectFit: 'contain', borderRadius: 6, flexShrink: 0 }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm" style={{ color: '#F5F5F5', letterSpacing: '0.01em' }}>
              Land Assistant
            </div>
            <div className="text-xs" style={{ color: '#A0A0A0' }}>
              AI-powered land investing guide
            </div>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="flex items-center justify-center rounded-lg transition-colors flex-shrink-0"
            style={{ width: 30, height: 30, color: '#A0A0A0' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3" style={{ background: '#1A1A1A' }}>
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'assistant' && (
                <div
                  className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center mr-2 mt-0.5"
                  style={{ background: '#7C3AED' }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                  </svg>
                </div>
              )}
              <div
                className="rounded-2xl px-3.5 py-2.5 text-sm max-w-[85%]"
                style={
                  msg.role === 'user'
                    ? { background: 'rgba(124,58,237,0.2)', color: '#F5F5F5', borderBottomRightRadius: 4 }
                    : { background: '#242424', color: '#F5F5F5', borderBottomLeftRadius: 4, border: '1px solid #2E2E2E', lineHeight: '1.55' }
                }
              >
                {renderContent(msg.content)}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div
                className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center mr-2 mt-0.5"
                style={{ background: '#7C3AED' }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
              </div>
              <div
                className="rounded-2xl px-4 py-3 flex items-center gap-1"
                style={{ background: '#242424', border: '1px solid #2E2E2E', borderBottomLeftRadius: 4 }}
              >
                <span className="typing-dot" />
                <span className="typing-dot" style={{ animationDelay: '0.18s' }} />
                <span className="typing-dot" style={{ animationDelay: '0.36s' }} />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div
          className="flex-shrink-0 px-3 py-3 flex items-end gap-2"
          style={{ background: '#242424', borderTop: '1px solid #2E2E2E' }}
        >
          <input
            ref={inputRef}
            type="text"
            className="flex-1 rounded-xl text-sm px-3.5 py-2.5 outline-none resize-none"
            style={{
              border: '1.5px solid #2E2E2E',
              color: '#F5F5F5',
              background: '#1A1A1A',
              fontFamily: "'Montserrat', sans-serif",
              transition: 'border-color 0.15s',
            }}
            placeholder="Ask about your deals, counties, pipeline…"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            onFocus={e => (e.target.style.borderColor = '#7C3AED')}
            onBlur={e => (e.target.style.borderColor = '#2E2E2E')}
            disabled={loading}
          />
          <button
            onClick={send}
            disabled={!input.trim() || loading}
            className="flex items-center justify-center rounded-xl flex-shrink-0 transition-all"
            style={{
              width: 40,
              height: 40,
              background: input.trim() && !loading ? '#7C3AED' : '#2E2E2E',
              color: input.trim() && !loading ? '#FFFFFF' : '#6B6B6B',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"/>
              <polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </div>
      </div>
    </>
  )
}
