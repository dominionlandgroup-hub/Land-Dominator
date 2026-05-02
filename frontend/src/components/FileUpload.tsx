import React, { useCallback, useState } from 'react'

interface Props {
  label: string
  hint?: string
  onFile: (file: File) => void
  loading?: boolean
  accept?: string
  selectedFile?: string | null
}

export default function FileUpload({
  label,
  hint,
  onFile,
  loading = false,
  accept = '.csv',
  selectedFile,
}: Props) {
  const [dragging, setDragging] = useState(false)

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      setDragging(false)
      const file = e.dataTransfer.files[0]
      if (file) onFile(file)
    },
    [onFile]
  )

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) onFile(file)
      // Reset input value so same file can be re-uploaded
      e.target.value = ''
    },
    [onFile]
  )

  return (
    <label className="block cursor-pointer">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className="border-2 border-dashed rounded-xl px-8 py-10 text-center transition-all duration-200"
        style={{
          borderColor: dragging ? '#5C2977' : loading ? '#E8E0F0' : '#D4C5E8',
          background: dragging ? 'rgba(92,41,119,0.06)' : loading ? '#F3EEF9' : '#FFFFFF',
          pointerEvents: loading ? 'none' : 'auto',
          opacity: loading ? 0.7 : 1,
        }}
        onMouseEnter={(e) => {
          if (!loading && !dragging)
            (e.currentTarget as HTMLElement).style.borderColor = '#5C2977'
        }}
        onMouseLeave={(e) => {
          if (!loading && !dragging)
            (e.currentTarget as HTMLElement).style.borderColor = '#D4C5E8'
        }}
      >
        {loading ? (
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 rounded-full border-2 border-[#E8E0F0] border-t-[#5C2977] animate-spin" />
            <p className="text-sm" style={{ color: '#6B5B8A' }}>Processing file…</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            {/* Cloud upload icon */}
            <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: 'rgba(92,41,119,0.08)' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#5C2977" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 16 12 12 8 16"/>
                <line x1="12" y1="12" x2="12" y2="21"/>
                <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
              </svg>
            </div>

            {selectedFile ? (
              <div className="flex items-center gap-2 px-4 py-2 rounded-lg" style={{ background: '#D1FAE5', border: '1px solid rgba(5,150,105,0.2)' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                </svg>
                <span className="text-xs font-medium truncate max-w-[200px]" style={{ color: '#059669' }}>{selectedFile}</span>
              </div>
            ) : (
              <div>
                <p className="font-medium mb-1" style={{ color: '#1A0A2E' }}>{label}</p>
                {hint && <p className="text-sm" style={{ color: '#6B5B8A' }}>{hint}</p>}
              </div>
            )}

            <span
              className="inline-flex items-center gap-1.5 text-xs px-4 py-1.5 rounded-full font-medium transition-colors"
              style={{
                background: 'rgba(92,41,119,0.08)',
                border: '1px solid rgba(92,41,119,0.2)',
                color: '#5C2977',
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              {selectedFile ? 'Replace file' : 'Drag & drop or click to browse'}
            </span>
            <p className="text-xs" style={{ color: '#9B8AAE' }}>CSV files only · Max 300 MB</p>
          </div>
        )}
      </div>
      <input
        type="file"
        accept={accept}
        className="hidden"
        onChange={handleChange}
        disabled={loading}
      />
    </label>
  )
}
