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
        className={`${dim} rounded-full animate-spin`}
        style={{ border: '2px solid #E8E0F0', borderTopColor: '#5C2977' }}
      />
      {label && <p className="text-sm" style={{ color: '#6B5B8A' }}>{label}</p>}
    </div>
  )
}
