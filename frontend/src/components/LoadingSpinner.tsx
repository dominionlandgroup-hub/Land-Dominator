import React from 'react'

interface Props {
  size?: 'sm' | 'md' | 'lg'
  label?: string
}

export default function LoadingSpinner({ size = 'md', label }: Props) {
  const dim = { sm: 'w-4 h-4', md: 'w-8 h-8', lg: 'w-12 h-12' }[size]

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className={`${dim} rounded-full border-2 border-blue-800 border-t-blue-400 animate-spin`}
      />
      {label && <p className="text-slate-400 text-sm">{label}</p>}
    </div>
  )
}
