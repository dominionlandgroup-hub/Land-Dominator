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
          borderColor: dragging ? '#C9A84C' : loading ? 'rgba(201,168,76,0.15)' : 'rgba(201,168,76,0.2)',
          background: dragging ? 'rgba(201,168,76,0.08)' : loading ? 'rgba(15,15,15,0.5)' : 'rgba(15,15,15,0.3)',
          pointerEvents: loading ? 'none' : 'auto',
          opacity: loading ? 0.7 : 1,
        }}
        onMouseEnter={(e) => {
          if (!loading && !dragging)
            (e.currentTarget as HTMLElement).style.borderColor = '#C9A84C'
        }}
        onMouseLeave={(e) => {
          if (!loading && !dragging)
            (e.currentTarget as HTMLElement).style.borderColor = 'rgba(201,168,76,0.2)'
        }}
      >
        {loading ? (
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 rounded-full border-2 border-[#252015] border-t-[#C9A84C] animate-spin" />
            <p className="text-sm text-gray-400">Processing file…</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            {/* Cloud upload icon */}
            <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: 'rgba(201,168,76,0.1)' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#C9A84C" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 16 12 12 8 16"/>
                <line x1="12" y1="12" x2="12" y2="21"/>
                <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
              </svg>
            </div>

            {selectedFile ? (
              <div className="flex items-center gap-2 px-4 py-2 rounded-lg" style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                </svg>
                <span className="text-xs text-emerald-400 font-medium truncate max-w-[200px]">{selectedFile}</span>
              </div>
            ) : (
              <div>
                <p className="text-gray-200 font-medium mb-1">{label}</p>
                {hint && <p className="text-gray-500 text-sm">{hint}</p>}
              </div>
            )}

            <span
              className="inline-flex items-center gap-1.5 text-xs px-4 py-1.5 rounded-full font-medium transition-colors"
              style={{
                background: 'rgba(201,168,76,0.12)',
                border: '1px solid rgba(201,168,76,0.3)',
                color: '#C9A84C',
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              {selectedFile ? 'Replace file' : 'Drag & drop or click to browse'}
            </span>
            <p className="text-xs" style={{ color: '#8A8070' }}>CSV files only · Max 300 MB</p>
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
