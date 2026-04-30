import React, { useState, useMemo } from 'react'

export interface Column<T> {
  key: string
  header: React.ReactNode
  render?: (value: unknown, row: T) => React.ReactNode
  sortable?: boolean
  align?: 'left' | 'right' | 'center'
  width?: string
  defaultHidden?: boolean
}

interface Props<T extends object> {
  columns: Column<T>[]
  data: T[]
  pageSize?: number
  emptyMessage?: string
  className?: string
  searchable?: boolean
  searchKeys?: string[]
  onRowClick?: (row: T) => void
  // Bulk selection
  selectable?: boolean
  selectedKeys?: Set<string>
  getRowKey?: (row: T) => string
  onSelectionChange?: (keys: Set<string>) => void
}

type SortDir = 'asc' | 'desc'

export default function DataTable<T extends object>({
  columns,
  data,
  pageSize = 50,
  emptyMessage = 'No data',
  className = '',
  searchable = false,
  searchKeys,
  onRowClick,
  selectable = false,
  selectedKeys,
  getRowKey,
  onSelectionChange,
}: Props<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(
    () => new Set(columns.filter((c) => c.defaultHidden).map((c) => c.key))
  )
  const [showColToggle, setShowColToggle] = useState(false)

  const visibleCols = columns.filter((c) => !hiddenCols.has(c.key))

  // Search filter
  const searchFiltered = useMemo(() => {
    if (!search.trim()) return data
    const q = search.toLowerCase()
    return data.filter((row) => {
      const r = row as Record<string, unknown>
      const keys = searchKeys ?? Object.keys(r)
      return keys.some((k) => {
        const v = r[k]
        if (v == null) return false
        return String(v).toLowerCase().includes(q)
      })
    })
  }, [data, search, searchKeys])

  const sorted = useMemo(() => {
    if (!sortKey) return searchFiltered
    return [...searchFiltered].sort((a, b) => {
      const ar = a as Record<string, unknown>
      const br = b as Record<string, unknown>
      const av = ar[sortKey] ?? ''
      const bv = br[sortKey] ?? ''
      const cmp =
        typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv))
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [searchFiltered, sortKey, sortDir])

  const totalPages = Math.ceil(sorted.length / pageSize)
  const pageData = sorted.slice(page * pageSize, (page + 1) * pageSize)

  // Selection helpers
  const allFilteredKeys = useMemo(
    () => (selectable && getRowKey ? searchFiltered.map(getRowKey) : []),
    [searchFiltered, selectable, getRowKey]
  )
  const allSelected =
    selectable && allFilteredKeys.length > 0 &&
    allFilteredKeys.every((k) => selectedKeys?.has(k))
  const someSelected =
    selectable && !allSelected && allFilteredKeys.some((k) => selectedKeys?.has(k))

  function toggleSelectAll(e: React.MouseEvent) {
    e.stopPropagation()
    if (!onSelectionChange) return
    if (allSelected) {
      const next = new Set(selectedKeys)
      allFilteredKeys.forEach((k) => next.delete(k))
      onSelectionChange(next)
    } else {
      const next = new Set(selectedKeys)
      allFilteredKeys.forEach((k) => next.add(k))
      onSelectionChange(next)
    }
  }

  function toggleRowKey(e: React.MouseEvent, key: string) {
    e.stopPropagation()
    if (!onSelectionChange || !selectedKeys) return
    const next = new Set(selectedKeys)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    onSelectionChange(next)
  }

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
    setPage(0)
  }

  function toggleCol(key: string) {
    setHiddenCols((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function handleSearchChange(val: string) {
    setSearch(val)
    setPage(0)
  }

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {/* Toolbar */}
      {(searchable || columns.length > 4) && (
        <div className="flex items-center gap-3 mb-1">
          {searchable && (
            <div className="relative flex-1 max-w-xs">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2"
                style={{ color: '#9B8AAE' }}
                width="14" height="14" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2"
              >
                <circle cx="11" cy="11" r="8"/>
                <line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input
                type="text"
                className="input-base pl-9 py-1.5 text-xs"
                placeholder="Search…"
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
              />
              {search && (
                <button
                  className="absolute right-2.5 top-1/2 -translate-y-1/2"
                  style={{ color: '#9B8AAE' }}
                  onClick={() => handleSearchChange('')}
                >
                  ×
                </button>
              )}
            </div>
          )}
          {search && (
            <span className="text-xs" style={{ color: '#6B5B8A' }}>
              {sorted.length.toLocaleString()} of {data.length.toLocaleString()}
            </span>
          )}
          <div className="ml-auto relative">
            <button
              className="btn-secondary text-xs py-1.5 px-3 gap-1.5"
              onClick={() => setShowColToggle((v) => !v)}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/>
                <line x1="8" y1="18" x2="21" y2="18"/>
                <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/>
                <line x1="3" y1="18" x2="3.01" y2="18"/>
              </svg>
              Columns
              {hiddenCols.size > 0 && (
                <span className="badge badge-blue text-[10px] px-1.5 py-0">{hiddenCols.size} hidden</span>
              )}
            </button>
            {showColToggle && (
              <div
                className="absolute right-0 top-full mt-1 rounded-lg p-3 z-50 shadow-xl min-w-[180px]"
                style={{ background: '#FFFFFF', border: '1px solid #E8E0F0' }}
              >
                <div className="text-xs mb-2 font-medium uppercase tracking-wider" style={{ color: '#6B5B8A' }}>Toggle Columns</div>
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {columns.map((col) => (
                    <label key={col.key} className="flex items-center gap-2 cursor-pointer py-0.5">
                      <input
                        type="checkbox"
                        checked={!hiddenCols.has(col.key)}
                        onChange={() => toggleCol(col.key)}
                        className="w-3.5 h-3.5"
                        style={{ accentColor: '#5C2977' }}
                      />
                      <span className="text-xs" style={{ color: '#3D2B5E' }}>
                        {typeof col.header === 'string' ? col.header : col.key}
                      </span>
                    </label>
                  ))}
                </div>
                <button
                  className="text-xs mt-2"
                  style={{ color: '#5C2977' }}
                  onClick={() => setHiddenCols(new Set())}
                >
                  Show all
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {data.length === 0 ? (
        <div className="text-center py-12 text-sm" style={{ color: '#6B5B8A' }}>{emptyMessage}</div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg" style={{ border: '1px solid #E8E0F0' }}>
            <table className="w-full text-sm min-w-max">
              <thead className="sticky top-0 z-10" style={{ background: '#F0EBF8', borderBottom: '2px solid #D4B8E8' }}>
                <tr>
                  {/* Select-all checkbox column */}
                  {selectable && (
                    <th className="px-3 py-3 w-10" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={allSelected}
                        ref={(el) => { if (el) el.indeterminate = someSelected }}
                        onChange={() => {}}
                        onClick={toggleSelectAll}
                        className="w-3.5 h-3.5 cursor-pointer"
                        style={{ accentColor: '#5C2977' }}
                        title={allSelected ? 'Deselect all' : 'Select all'}
                      />
                    </th>
                  )}
                  {visibleCols.map((col) => (
                    <th
                      key={String(col.key)}
                      className={`
                        px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider whitespace-nowrap
                        ${col.sortable ? 'cursor-pointer select-none transition-colors' : ''}
                        ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : ''}
                        ${col.width ?? ''}
                      `}
                      style={{ color: sortKey === col.key ? '#5C2977' : '#3D2B5E' }}
                      onClick={() => col.sortable && handleSort(String(col.key))}
                    >
                      <span className="inline-flex items-center gap-1">
                        {col.header}
                        {col.sortable && (
                          <span style={{ color: sortKey === String(col.key) ? '#5C2977' : '#C4A8D8' }}>
                            {sortKey === String(col.key)
                              ? sortDir === 'asc' ? '↑' : '↓'
                              : '↕'}
                          </span>
                        )}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody style={{ background: '#FFFFFF' }}>
                {pageData.map((row, i) => {
                  const rowKey = selectable && getRowKey ? getRowKey(row) : ''
                  const isSelected = selectable && selectedKeys?.has(rowKey)
                  return (
                    <tr
                      key={i}
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                      className={`table-row-hover${onRowClick ? ' cursor-pointer' : ''}`}
                      style={{
                        borderBottom: '1px solid rgba(92,41,119,0.06)',
                        background: isSelected
                          ? 'rgba(92,41,119,0.06)'
                          : i % 2 === 1 ? '#FDFBFF' : undefined,
                      }}
                    >
                      {/* Row checkbox */}
                      {selectable && (
                        <td className="px-3 py-2.5 w-10" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isSelected ?? false}
                            onChange={() => {}}
                            onClick={(e) => toggleRowKey(e, rowKey)}
                            className="w-3.5 h-3.5 cursor-pointer"
                            style={{ accentColor: '#5C2977' }}
                          />
                        </td>
                      )}
                      {visibleCols.map((col) => {
                        const val = (row as Record<string, unknown>)[col.key]
                        return (
                          <td
                            key={String(col.key)}
                            className={`
                              px-4 py-2.5 whitespace-nowrap
                              ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : ''}
                            `}
                            style={{ color: '#3D2B5E' }}
                          >
                            {col.render
                              ? col.render(val as unknown, row)
                              : val == null
                              ? <span style={{ color: '#9B8AAE' }}>—</span>
                              : String(val)}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between text-xs px-1" style={{ color: '#6B5B8A' }}>
            <span>
              Showing{' '}
              <strong style={{ color: '#1A0A2E' }}>{(page * pageSize + 1).toLocaleString()}</strong>
              –
              <strong style={{ color: '#1A0A2E' }}>
                {Math.min((page + 1) * pageSize, sorted.length).toLocaleString()}
              </strong>{' '}
              of <strong style={{ color: '#1A0A2E' }}>{sorted.length.toLocaleString()}</strong> rows
              {selectable && selectedKeys && selectedKeys.size > 0 && (
                <span className="ml-3" style={{ color: '#5C2977' }}>
                  · {selectedKeys.size.toLocaleString()} selected
                </span>
              )}
            </span>
            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(0)}
                  disabled={page === 0}
                  className="px-2 py-1 rounded disabled:opacity-30 transition-colors"
                  style={{ color: '#6B5B8A' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(92,41,119,0.06)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >«</button>
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="px-2.5 py-1 rounded disabled:opacity-30 transition-colors"
                  style={{ color: '#6B5B8A' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(92,41,119,0.06)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >‹ Prev</button>
                <span className="px-3 py-1 rounded" style={{ background: '#F0EBF8', color: '#1A0A2E' }}>
                  {page + 1} / {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="px-2.5 py-1 rounded disabled:opacity-30 transition-colors"
                  style={{ color: '#6B5B8A' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(92,41,119,0.06)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >Next ›</button>
                <button
                  onClick={() => setPage(totalPages - 1)}
                  disabled={page >= totalPages - 1}
                  className="px-2 py-1 rounded disabled:opacity-30 transition-colors"
                  style={{ color: '#6B5B8A' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(92,41,119,0.06)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >»</button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
