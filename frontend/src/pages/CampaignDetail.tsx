import React, { useEffect, useRef, useState } from 'react'
import Papa from 'papaparse'
import type { CRMProperty, CRMCampaign, PropertyStatus } from '../types/crm'
import {
  listProperties, updateProperty, deleteProperties, bulkInsertRows, getCrmCampaign,
  exportPropertiesCsv, startCampaignLpPull, getCampaignLpPullStatus,
  sendCampaignMailDrop, updateCrmCampaign, getPropertyTags, recalculateAmountSpent,
  startSkipTrace, getSkipTraceStatus, startSmsCampaign, getSmsStatus,
  getCampaignFunnelStats, exportMailQueue,
  getLpSkipTraceCount, startLpSkipTrace, getLpSkipTraceStatus,
} from '../api/crm'
import type { CampaignFunnelStats } from '../api/crm'
import PropertyDetail from './PropertyDetail'

const PAGE_SIZE = 20

type SortBy = 'offer_price' | 'acreage' | 'owner_full_name' | 'county' | 'campaign_code' | 'status' | 'confidence_level'
type SortDir = 'asc' | 'desc'

const QUICK_SORT_OPTIONS: { label: string; sort_by: SortBy; sort_dir: SortDir }[] = [
  { label: 'Offer Price: High to Low', sort_by: 'offer_price', sort_dir: 'desc' },
  { label: 'Offer Price: Low to High', sort_by: 'offer_price', sort_dir: 'asc' },
  { label: 'Acreage: Large to Small', sort_by: 'acreage', sort_dir: 'desc' },
  { label: 'Acreage: Small to Large', sort_by: 'acreage', sort_dir: 'asc' },
  { label: 'Owner Name: A to Z', sort_by: 'owner_full_name', sort_dir: 'asc' },
  { label: 'Confidence: High First', sort_by: 'confidence_level', sort_dir: 'asc' },
  { label: 'Status', sort_by: 'status', sort_dir: 'asc' },
]

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  lead:           { bg: '#FFF3E0', text: '#E65100', border: '#FFCC80' },
  prospect:       { bg: '#E3F2FD', text: '#1565C0', border: '#90CAF9' },
  offer_sent:     { bg: '#F3E5F5', text: '#6A1B9A', border: '#CE93D8' },
  under_contract: { bg: '#E8F5E9', text: '#2E7D32', border: '#A5D6A7' },
  due_diligence:  { bg: '#FFF8E1', text: '#F57F17', border: '#FFE082' },
  closed_won:     { bg: '#E0F2F1', text: '#00695C', border: '#80CBC4' },
  closed_lost:    { bg: '#FFEBEE', text: '#B71C1C', border: '#EF9A9A' },
  dead:           { bg: '#F5F5F5', text: '#616161', border: '#BDBDBD' },
}

const STATUS_LABELS: Record<string, string> = {
  lead: 'Lead', prospect: 'Prospect', offer_sent: 'Offer Sent',
  under_contract: 'Under Contract', due_diligence: 'Due Diligence',
  closed_won: 'Closed Won', closed_lost: 'Closed Lost', dead: 'Dead',
}

interface Props {
  campaign: CRMCampaign
  onBack: () => void
  onCampaignUpdated: (c: CRMCampaign) => void
}

export default function CampaignDetail({ campaign, onBack, onCampaignUpdated }: Props) {
  const [stats, setStats] = useState<CRMCampaign>(campaign)
  const [properties, setProperties] = useState<CRMProperty[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Adjust price
  const [showAdjustPrice, setShowAdjustPrice] = useState(false)
  const [newPrice, setNewPrice] = useState('')
  const [adjusting, setAdjusting] = useState(false)

  const [exportingAll, setExportingAll] = useState(false)

  // All-pages selection
  const [allPagesSelected, setAllPagesSelected] = useState(false)
  // Tags + Boards filters
  const [tagFilter, setTagFilter] = useState('')
  const [boardFilter, setBoardFilter] = useState('')
  const [availableTags, setAvailableTags] = useState<{ tag: string; count: number }[]>([])
  const [tagsLoading, setTagsLoading] = useState(false)

  // Start Mailing
  const [showMailModal, setShowMailModal] = useState(false)
  const [mailHouseEmail, setMailHouseEmail] = useState(campaign.mail_house_email ?? '')
  const [mailing, setMailing] = useState(false)
  const [mailSuccess, setMailSuccess] = useState<string | null>(null)
  const [mailError, setMailError] = useState<string | null>(null)

  // Recalculate spend
  const [recalculating, setRecalculating] = useState(false)

  // LP pull
  const [lpJobId, setLpJobId] = useState<string | null>(null)
  const [lpDone, setLpDone] = useState(0)
  const [lpTotal, setLpTotal] = useState(0)
  const [lpStatus, setLpStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [lpError, setLpError] = useState<string | null>(null)
  const [lpTokenWarning, setLpTokenWarning] = useState<string | null>(null)
  const lpPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Skip trace (Batch Leads)
  const [stJobId, setStJobId] = useState<string | null>(null)
  const [stDone, setStDone] = useState(0)
  const [stTotal, setStTotal] = useState(0)
  const [stStatus, setStStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [stResult, setStResult] = useState<{ mobile: number; landline: number; no_number: number } | null>(null)
  const [stError, setStError] = useState<string | null>(null)
  const stPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Skip trace (Land Portal)
  const [lpStJobId, setLpStJobId] = useState<string | null>(null)
  const [lpStDone, setLpStDone] = useState(0)
  const [lpStTotal, setLpStTotal] = useState(0)
  const [lpStStatus, setLpStStatus] = useState<'idle' | 'running' | 'done' | 'error' | 'interrupted'>('idle')
  const [lpStResult, setLpStResult] = useState<{ mobile: number; landline: number; no_number: number } | null>(null)
  const [lpStError, setLpStError] = useState<string | null>(null)
  const lpStPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lpSt404Ref = useRef(0)

  // SMS campaign
  const [smsJobId, setSmsJobId] = useState<string | null>(null)
  const [smsDone, setSmsDone] = useState(0)
  const [smsTotal, setSmsTotal] = useState(0)
  const [smsStatus, setSmsStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [smsSent, setSmsSent] = useState(0)
  const [smsCapped, setSmsCapped] = useState(false)
  const [smsDay, setSmsDay] = useState(1)
  const [smsError, setSmsError] = useState<string | null>(null)
  const smsPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Funnel stats
  const [funnel, setFunnel] = useState<CampaignFunnelStats | null>(null)

  // Sort
  const [sortBy, setSortBy] = useState<SortBy>('offer_price')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  // Property detail drill-in
  const [viewingProperty, setViewingProperty] = useState<CRMProperty | null>(null)

  // Import
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cancelledRef = useRef(false)
  const [importPhase, setImportPhase] = useState<'idle' | 'parsing' | 'importing' | 'done'>('idle')
  const [importProgress, setImportProgress] = useState(0)
  const [importTotal, setImportTotal] = useState(0)
  const [importedCount, setImportedCount] = useState(0)
  const [importFailed, setImportFailed] = useState(0)

  useEffect(() => {
    loadProperties(1, 'all', '', '', '', 'offer_price', 'desc')
    refreshStats()
    loadFunnel()
  }, [])

  useEffect(() => {
    if (!mailSuccess) return
    const t = setTimeout(() => setMailSuccess(null), 5000)
    return () => clearTimeout(t)
  }, [mailSuccess])

  async function refreshStats() {
    try {
      const data = await getCrmCampaign(campaign.id)
      setStats(data)
      onCampaignUpdated(data)
    } catch {}
  }

  async function handleRecalculate() {
    setRecalculating(true)
    try {
      await recalculateAmountSpent(campaign.id)
      await refreshStats()
    } catch {}
    finally { setRecalculating(false) }
  }

  async function loadProperties(
    p: number, sf: string, sq: string,
    tf = tagFilter, bf = boardFilter,
    sbCol: SortBy = sortBy, sd: SortDir = sortDir,
  ) {
    setLoading(true)
    try {
      const res = await listProperties({
        page: p, limit: PAGE_SIZE,
        campaign_id: campaign.id,
        status: bf || (sf === 'all' ? undefined : sf),
        search: sq.trim() || undefined,
        tag: tf || undefined,
        sort_by: sbCol,
        sort_dir: sd,
      })
      setProperties(res.data)
      setTotalCount(res.total)
      setPage(p)
    } catch {} finally { setLoading(false) }
  }

  function handleStatusChange(sf: string) {
    setStatusFilter(sf)
    setSelectedIds(new Set())
    setAllPagesSelected(false)
    loadProperties(1, sf, search)
  }

  function handleTagChange(tf: string) {
    setTagFilter(tf)
    setSelectedIds(new Set())
    setAllPagesSelected(false)
    loadProperties(1, statusFilter, search, tf, boardFilter)
  }

  function handleBoardChange(bf: string) {
    setBoardFilter(bf)
    setSelectedIds(new Set())
    setAllPagesSelected(false)
    loadProperties(1, statusFilter, search, tagFilter, bf)
  }

  function handleSearch(sq: string) {
    setSearch(sq)
    loadProperties(1, statusFilter, sq)
  }

  function goToPage(p: number) {
    setSelectedIds(new Set())
    loadProperties(p, statusFilter, search, tagFilter, boardFilter, sortBy, sortDir)
  }

  function handleSortColumn(col: SortBy) {
    const newDir: SortDir = col === sortBy && sortDir === 'desc' ? 'asc' : 'desc'
    setSortBy(col)
    setSortDir(newDir)
    setSelectedIds(new Set())
    loadProperties(1, statusFilter, search, tagFilter, boardFilter, col, newDir)
  }

  function handleQuickSort(val: string) {
    const opt = QUICK_SORT_OPTIONS.find(o => `${o.sort_by}:${o.sort_dir}` === val)
    if (!opt) return
    setSortBy(opt.sort_by)
    setSortDir(opt.sort_dir)
    setSelectedIds(new Set())
    loadProperties(1, statusFilter, search, tagFilter, boardFilter, opt.sort_by, opt.sort_dir)
  }

  // ── Select all on current page ──────────────────────────────────────
  function toggleSelectAll() {
    if (allPagesSelected) {
      setAllPagesSelected(false)
      setSelectedIds(new Set())
    } else if (selectedIds.size === properties.length && properties.length > 0) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(properties.map(p => p.id)))
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // ── Bulk delete ─────────────────────────────────────────────────────
  async function handleDelete() {
    setDeleting(true)
    try {
      await deleteProperties(Array.from(selectedIds))
      setSelectedIds(new Set())
      setShowDeleteConfirm(false)
      await loadProperties(page, statusFilter, search)
      refreshStats()
    } finally { setDeleting(false) }
  }

  // ── Adjust price ────────────────────────────────────────────────────
  async function handleAdjustPrice() {
    const price = parseFloat(newPrice)
    if (isNaN(price) || price < 0) return
    setAdjusting(true)
    try {
      await Promise.all(Array.from(selectedIds).map(id => updateProperty(id, { offer_price: price })))
      setSelectedIds(new Set())
      setShowAdjustPrice(false)
      setNewPrice('')
      loadProperties(page, statusFilter, search)
    } finally { setAdjusting(false) }
  }

  // ── Export CSV ──────────────────────────────────────────────────────
  async function handleExport() {
    if (allPagesSelected) {
      // Export all via backend
      await handleExportAll()
      return
    }
    const selected = properties.filter(p => selectedIds.has(p.id))
    const headers = [
      'Owner Full Name', 'Owner First Name', 'Owner Last Name',
      'Mailing Address', 'Mailing City', 'Mailing State', 'Mailing Zip',
      'Property Address', 'Property City', 'Property State', 'Property Zip',
      'APN', 'County', 'State', 'Acreage',
      'Campaign Code', 'Offer Price', 'Status',
    ]
    const rows = selected.map(p => [
      p.owner_full_name ?? '',
      p.owner_first_name ?? '',
      p.owner_last_name ?? '',
      p.owner_mailing_address ?? '',
      p.owner_mailing_city ?? '',
      p.owner_mailing_state ?? '',
      p.owner_mailing_zip ?? '',
      (p as any).property_address ?? '',
      (p as any).property_city ?? '',
      p.state ?? '',
      (p as any).property_zip ?? '',
      p.apn ?? '',
      p.county ?? '',
      p.state ?? '',
      p.acreage?.toFixed(2) ?? '',
      p.campaign_code ?? '',
      p.offer_price != null ? Number(p.offer_price).toFixed(2) : '',
      p.status ?? 'lead',
    ])
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${campaign.name.replace(/[^a-z0-9]/gi, '_')}_selected.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Export all (mail house format) ─────────────────────────────────
  async function handleExportAll() {
    setExportingAll(true)
    try {
      const safeName = campaign.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()
      await exportPropertiesCsv({
        campaign_id: campaign.id,
        fmt: 'mailhouse',
        filename: `${safeName}-maillist-${new Date().toISOString().slice(0, 10)}.csv`,
      })
    } catch {} finally { setExportingAll(false) }
  }

  // ── Start Mailing ───────────────────────────────────────────────────
  async function handleSendMailing() {
    setMailing(true)
    setMailError(null)
    setMailSuccess(null)
    try {
      const result = await sendCampaignMailDrop(campaign.id, mailHouseEmail || undefined)
      setMailSuccess(`✓ Mail drop sent successfully. ${result.record_count.toLocaleString()} records mailed to ${result.mail_house_email}`)
      setShowMailModal(false)
      refreshStats()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setMailError(detail ?? 'Failed to send mail drop.')
    } finally { setMailing(false) }
  }

  // ── LP Pull ─────────────────────────────────────────────────────────
  async function handleStartLpPull() {
    if (lpStatus === 'running') return
    setLpStatus('running')
    setLpDone(0)
    setLpTotal(0)
    setLpError(null)
    try {
      const { job_id } = await startCampaignLpPull(campaign.id)
      setLpJobId(job_id)
      if (lpPollRef.current) clearInterval(lpPollRef.current)
      lpPollRef.current = setInterval(async () => {
        try {
          const s = await getCampaignLpPullStatus(campaign.id, job_id)
          setLpDone(s.done)
          setLpTotal(s.total)
          if (s.token_warning) setLpTokenWarning(s.token_warning)
          if (s.status === 'done' || s.status === 'error') {
            setLpStatus(s.status)
            if (s.status === 'error') setLpError(s.error ?? 'LP pull failed')
            if (lpPollRef.current) { clearInterval(lpPollRef.current); lpPollRef.current = null }
            if (s.status === 'done') loadProperties(page, statusFilter, search)
          }
        } catch {}
      }, 2000)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setLpError(err?.response?.data?.detail ?? 'Failed to start LP pull')
      setLpStatus('error')
    }
  }

  // ── Skip Trace ──────────────────────────────────────────────────────
  async function handleStartSkipTrace() {
    if (stStatus === 'running') return
    const ids = allPagesSelected ? [] : Array.from(selectedIds)
    const count = ids.length > 0 ? ids.length : (stats.property_count ?? 0)
    const scope = ids.length > 0 ? `${count.toLocaleString()} selected records` : `all ${count.toLocaleString()} campaign records`
    if (!confirm(`This will skip-trace ${scope} using Batch Leads credits. Continue?`)) return
    setStStatus('running')
    setStDone(0)
    setStTotal(0)
    setStResult(null)
    setStError(null)
    try {
      const { job_id, total } = await startSkipTrace(campaign.id, ids.length > 0 ? ids : undefined)
      setStJobId(job_id)
      setStTotal(total)
      if (stPollRef.current) clearInterval(stPollRef.current)
      stPollRef.current = setInterval(async () => {
        try {
          const s = await getSkipTraceStatus(campaign.id, job_id)
          setStDone(s.done)
          setStTotal(s.total)
          if (s.status === 'done' || s.status === 'error') {
            setStStatus(s.status as 'done' | 'error')
            if (s.status === 'done') setStResult({ mobile: s.mobile, landline: s.landline, no_number: s.no_number })
            if (s.status === 'error') setStError('Skip trace failed')
            if (stPollRef.current) { clearInterval(stPollRef.current); stPollRef.current = null }
            loadFunnel()
          }
        } catch {}
      }, 2000)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setStError(err?.response?.data?.detail ?? 'Failed to start skip trace')
      setStStatus('error')
    }
  }

  // ── LP Skip Trace ────────────────────────────────────────────────────
  async function handleStartLpSkipTrace() {
    if (lpStStatus === 'running') return
    const ids = allPagesSelected ? [] : Array.from(selectedIds)
    const hasSelection = ids.length > 0
    try {
      const { total, with_lp_id } = await getLpSkipTraceCount(campaign.id, hasSelection ? ids : undefined)
      const noLpId = total - with_lp_id
      const scopeLabel = hasSelection ? `${total.toLocaleString()} selected` : `all ${total.toLocaleString()}`
      const msg = [
        `Skip tracing ${scopeLabel} records.`,
        ``,
        `✓ ${with_lp_id.toLocaleString()} have Land Portal IDs → ${with_lp_id.toLocaleString()} tokens used`,
        noLpId > 0 ? `✓ ${noLpId.toLocaleString()} without LP IDs → will be skipped (use Batch Leads for those)` : '',
        ``,
        `Total cost: ${with_lp_id.toLocaleString()} LP tokens`,
        ``,
        `Continue?`,
      ].filter(Boolean).join('\n')
      if (!confirm(msg)) return
    } catch {
      if (!confirm('Could not fetch record counts. Start LP skip trace anyway?')) return
    }
    setLpStStatus('running')
    setLpStDone(0)
    setLpStTotal(0)
    setLpStResult(null)
    setLpStError(null)
    try {
      const { job_id, total } = await startLpSkipTrace(campaign.id, hasSelection ? ids : undefined)
      setLpStJobId(job_id)
      setLpStTotal(total)
      lpSt404Ref.current = 0
      if (lpStPollRef.current) clearInterval(lpStPollRef.current)
      lpStPollRef.current = setInterval(async () => {
        try {
          const s = await getLpSkipTraceStatus(campaign.id, job_id)
          lpSt404Ref.current = 0
          setLpStDone(s.done)
          setLpStTotal(s.total)
          if (s.status === 'not_found') {
            if (lpStPollRef.current) { clearInterval(lpStPollRef.current); lpStPollRef.current = null }
            setLpStStatus('interrupted')
            setLpStError('Skip trace job was interrupted. Check property records for results so far.')
            return
          }
          if (s.status === 'done' || s.status === 'error') {
            setLpStStatus(s.status as 'done' | 'error')
            if (s.status === 'done') setLpStResult({ mobile: s.mobile, landline: s.landline, no_number: s.no_number })
            if (s.status === 'error') setLpStError('LP skip trace failed')
            if (lpStPollRef.current) { clearInterval(lpStPollRef.current); lpStPollRef.current = null }
            loadFunnel()
          }
        } catch {
          lpSt404Ref.current += 1
          if (lpSt404Ref.current >= 10) {
            if (lpStPollRef.current) { clearInterval(lpStPollRef.current); lpStPollRef.current = null }
            setLpStStatus('interrupted')
            setLpStError('Skip trace job was interrupted. Check property records for results so far.')
          }
        }
      }, 2000)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setLpStError(err?.response?.data?.detail ?? 'Failed to start LP skip trace')
      setLpStStatus('error')
    }
  }

  // ── SMS Campaign ─────────────────────────────────────────────────────
  async function handleStartSms(day = 1) {
    if (smsStatus === 'running') return
    setSmsStatus('running')
    setSmsDone(0)
    setSmsTotal(0)
    setSmsSent(0)
    setSmsCapped(false)
    setSmsDay(day)
    setSmsError(null)
    try {
      const { job_id, total } = await startSmsCampaign(campaign.id, day)
      setSmsJobId(job_id)
      setSmsTotal(total)
      if (smsPollRef.current) clearInterval(smsPollRef.current)
      smsPollRef.current = setInterval(async () => {
        try {
          const s = await getSmsStatus(campaign.id, job_id)
          setSmsDone(s.done)
          setSmsTotal(s.total)
          setSmsSent(s.sent)
          setSmsCapped(!!s.capped)
          if (s.status === 'done' || s.status === 'error') {
            setSmsStatus(s.status as 'done' | 'error')
            if (s.status === 'error') setSmsError('SMS send failed')
            if (smsPollRef.current) { clearInterval(smsPollRef.current); smsPollRef.current = null }
            loadFunnel()
          }
        } catch {}
      }, 2000)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setSmsError(err?.response?.data?.detail ?? 'Failed to start SMS campaign')
      setSmsStatus('error')
    }
  }

  // ── Funnel Stats ──────────────────────────────────────────────────────
  async function loadFunnel() {
    try { setFunnel(await getCampaignFunnelStats(campaign.id)) } catch {}
  }

  // ── Import ──────────────────────────────────────────────────────────
  function triggerImport() {
    cancelledRef.current = false
    fileInputRef.current?.click()
  }

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setImportPhase('parsing')
    setImportProgress(0)
    setImportTotal(0)
    setImportedCount(0)
    setImportFailed(0)

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h: string) => h.trim(),
      complete: async (results) => {
        const rows = results.data
        if (!rows.length) { setImportPhase('idle'); return }
        setImportTotal(rows.length)
        setImportPhase('importing')
        const CHUNK = 50
        let done = 0, fail = 0
        for (let i = 0; i < rows.length; i += CHUNK) {
          if (cancelledRef.current) break
          const chunk = rows.slice(i, i + CHUNK)
          try {
            const r = await bulkInsertRows(chunk, campaign.id)
            done += r.imported
            fail += r.skipped
            if (r.errors?.length) console.warn('[import] chunk errors:', r.errors)
          } catch (e) { console.error('[import] chunk request failed:', e); fail += chunk.length }
          setImportProgress(Math.min(i + CHUNK, rows.length))
          setImportedCount(done)
          setImportFailed(fail)
        }
        setImportPhase('done')
        loadProperties(1, statusFilter, search)
        refreshStats()
      },
      error: () => { setImportPhase('idle') },
    })
  }

  async function handlePropertySave(data: Partial<CRMProperty>) {
    if (!viewingProperty) return
    await updateProperty(viewingProperty.id, data)
    loadProperties(page, statusFilter, search)
    refreshStats()
  }

  async function handlePropertyDelete() {
    if (!viewingProperty) return
    await deleteProperties([viewingProperty.id])
    setViewingProperty(null)
    loadProperties(page, statusFilter, search)
    refreshStats()
  }

  if (viewingProperty) {
    return (
      <PropertyDetail
        property={viewingProperty}
        onBack={() => setViewingProperty(null)}
        onSave={handlePropertySave}
        onDelete={handlePropertyDelete}
      />
    )
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE)
  const firstRow = totalCount === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const lastRow = Math.min(page * PAGE_SIZE, totalCount)
  const allSelected = allPagesSelected || (properties.length > 0 && selectedIds.size === properties.length)
  const someSelected = selectedIds.size > 0 && !allSelected

  const bs = stats.by_status ?? {}

  return (
    <div style={{ background: '#F9FAFB', minHeight: '100vh' }}>
      {/* Top bar */}
      <div className="page-header" style={{ borderBottom: '1px solid #E5E7EB' }}>
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-sm font-medium transition-opacity hover:opacity-70"
            style={{ color: '#4F46E5' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
            Campaigns
          </button>
          <span style={{ color: '#E5E7EB' }}>/</span>
          <h1 className="text-base font-semibold truncate" style={{ color: '#111827', maxWidth: '320px' }}>{campaign.name}</h1>
        </div>
        <div className="flex items-center gap-2">
          {/* LP pull progress */}
          {lpStatus === 'running' && lpTotal > 0 && (
            <span className="text-xs" style={{ color: '#9CA3AF' }}>
              Pulling LP data… {lpDone.toLocaleString()} of {lpTotal.toLocaleString()}
            </span>
          )}
          {lpStatus === 'running' && lpTotal === 0 && (
            <span className="text-xs" style={{ color: '#9CA3AF' }}>Starting LP pull…</span>
          )}
          {lpStatus === 'done' && (
            <span className="text-xs font-semibold" style={{ color: '#10B981' }}>
              ✓ LP data pulled: {lpDone.toLocaleString()} records
            </span>
          )}
          {lpStatus === 'error' && (
            <span className="text-xs font-semibold" style={{ color: '#DC2626' }}>
              LP pull failed: {lpError}
            </span>
          )}
          {lpTokenWarning && (
            <span className="text-xs font-semibold" style={{ color: '#D97706' }}>
              ⚠️ {lpTokenWarning}
            </span>
          )}

          {/* Skip trace status (Batch Leads) */}
          {stStatus === 'running' && (
            <span className="text-xs" style={{ color: '#9CA3AF' }}>
              🔍 BL Skip tracing… {stDone.toLocaleString()} of {stTotal.toLocaleString()}
            </span>
          )}
          {stStatus === 'done' && stResult && (
            <span className="text-xs font-semibold" style={{ color: '#10B981' }}>
              ✓ BL: {stResult.mobile.toLocaleString()} mobile · {stResult.landline.toLocaleString()} landline · {stResult.no_number.toLocaleString()} no number
            </span>
          )}
          {stStatus === 'error' && (
            <span className="text-xs font-semibold" style={{ color: '#DC2626' }}>Skip trace failed: {stError}</span>
          )}

          {/* Skip trace status (Land Portal) */}
          {lpStStatus === 'running' && (
            <span className="text-xs" style={{ color: '#9CA3AF' }}>
              🔍 LP Skip tracing… {lpStDone.toLocaleString()} of {lpStTotal.toLocaleString()}
            </span>
          )}
          {lpStStatus === 'done' && lpStResult && (
            <span className="text-xs font-semibold" style={{ color: '#10B981' }}>
              ✓ LP: {lpStResult.mobile.toLocaleString()} mobile · {lpStResult.landline.toLocaleString()} landline · {lpStResult.no_number.toLocaleString()} no number
            </span>
          )}
          {lpStStatus === 'error' && (
            <span className="text-xs font-semibold" style={{ color: '#DC2626' }}>LP skip trace failed: {lpStError}</span>
          )}
          {lpStStatus === 'interrupted' && (
            <span className="text-xs font-semibold" style={{ color: '#F59E0B' }}>⚠ {lpStError}</span>
          )}

          {/* SMS status */}
          {smsStatus === 'running' && (
            <span className="text-xs" style={{ color: '#9CA3AF' }}>
              💬 Texting Day {smsDay}… {smsDone.toLocaleString()} of {smsTotal.toLocaleString()}
            </span>
          )}
          {smsStatus === 'done' && (
            <span className="text-xs font-semibold" style={{ color: '#10B981' }}>
              ✓ Day {smsDay}: {smsSent.toLocaleString()} texts sent{smsCapped ? ' (daily limit reached — remainder queued)' : ''}
            </span>
          )}
          {smsStatus === 'error' && (
            <span className="text-xs font-semibold" style={{ color: '#DC2626' }}>SMS failed: {smsError}</span>
          )}

          {/* Import progress indicator */}
          {importPhase === 'parsing' && (
            <span className="text-xs" style={{ color: '#9CA3AF' }}>Parsing CSV…</span>
          )}
          {importPhase === 'importing' && (
            <span className="text-xs" style={{ color: '#9CA3AF' }}>
              Importing {importProgress.toLocaleString()} / {importTotal.toLocaleString()}…
            </span>
          )}
          {importPhase === 'done' && (
            <span className="text-xs font-semibold" style={{ color: '#10B981' }}>
              ✓ {importedCount.toLocaleString()} imported
            </span>
          )}
          <input ref={fileInputRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleFileSelected} />
          <button
            className="btn-secondary text-sm"
            onClick={handleStartLpPull}
            disabled={lpStatus === 'running'}
            title="Pull LP estimate, offer price, and comps for all properties in this campaign"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            {lpStatus === 'running' ? 'Pulling LP…' : 'Pull LP Data'}
          </button>
          <button
            className="btn-secondary text-sm"
            onClick={handleStartSkipTrace}
            disabled={stStatus === 'running' || lpStStatus === 'running'}
            title="Find phone numbers via Batch Leads skip trace (uses BL credits)"
          >
            🔍 {stStatus === 'running' ? `BL Tracing… ${stDone.toLocaleString()}/${stTotal.toLocaleString()}` : 'Skip Trace (BL)'}
          </button>
          <button
            className="btn-secondary text-sm"
            onClick={handleStartLpSkipTrace}
            disabled={lpStStatus === 'running' || stStatus === 'running'}
            title="Find phone numbers via Land Portal skip trace (uses LP tokens — only records with LP IDs)"
          >
            🔍 {lpStStatus === 'running' ? `LP Tracing… ${lpStDone.toLocaleString()}/${lpStTotal.toLocaleString()}` : 'Skip Trace (LP)'}
          </button>
          <button
            className="btn-secondary text-sm"
            onClick={() => handleStartSms(1)}
            disabled={smsStatus === 'running'}
            title="Send Day 1 SMS to all mobile numbers"
          >
            💬 {smsStatus === 'running' ? `Texting… ${smsDone.toLocaleString()}/${smsTotal.toLocaleString()}` : 'Start Texting'}
          </button>
          {funnel && funnel.skip_traced > 0 && (
            <button
              className="btn-secondary text-sm"
              onClick={() => handleStartSms(3)}
              disabled={smsStatus === 'running'}
              title="Send Day 3 follow-up to non-responders"
            >
              💬 Day 3 Follow-up
            </button>
          )}
          <button
            className="btn-secondary text-sm"
            onClick={handleExportAll}
            disabled={exportingAll}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            {exportingAll ? 'Exporting…' : `Export All (${(stats.property_count ?? totalCount).toLocaleString()})`}
          </button>
          <button
            className="btn-secondary text-sm"
            onClick={triggerImport}
            disabled={importPhase === 'parsing' || importPhase === 'importing'}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Import List
          </button>
          <button
            className="btn-primary text-sm flex items-center gap-1.5"
            onClick={() => { setMailError(null); setMailSuccess(null); setShowMailModal(true) }}
          >
            Start Mailing
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Campaign stats */}
      <div className="px-6 py-4" style={{ borderBottom: '1px solid #E5E7EB', background: '#FFFFFF' }}>
        <div className="flex items-center gap-8 flex-wrap">
          {[
            { label: 'Total Records', value: (stats.property_count ?? 0).toLocaleString(), accent: '#4F46E5' },
            { label: 'Deals', value: ((bs.offer_sent ?? 0) + (bs.under_contract ?? 0) + (bs.closed_won ?? 0)).toLocaleString(), accent: '#3B82F6' },
            { label: 'Response Rate', value: '0%', accent: '#9CA3AF' },
            { label: 'Offers', value: (bs.offer_sent ?? 0).toLocaleString(), accent: '#C084FC' },
            { label: 'Purchases', value: (bs.under_contract ?? 0).toLocaleString(), accent: '#10B981' },
            { label: 'Sales', value: (bs.closed_won ?? 0).toLocaleString(), accent: '#10B981' },
            ...(stats.offer_pct != null ? [{ label: 'Offer %', value: `${Number(stats.offer_pct).toFixed(1)}%`, accent: '#7C3AED' }] : []),
          ].map(s => (
            <div key={s.label} className="text-center">
              <div className="text-xl font-bold" style={{ color: s.accent }}>{s.value}</div>
              <div className="text-[10px] font-semibold uppercase tracking-wide mt-0.5" style={{ color: '#6B7280' }}>{s.label}</div>
            </div>
          ))}

          {/* Amount Spent + Budget */}
          <div className="flex flex-col gap-1 ml-auto">
            <div className="flex items-center gap-2">
              <div>
                <div className="text-xl font-bold" style={{ color: (stats.amount_spent ?? 0) > 0 ? '#1A0A2E' : '#9CA3AF' }}>
                  ${(stats.amount_spent ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div className="text-[10px] font-semibold uppercase tracking-wide mt-0.5" style={{ color: '#6B7280' }}>
                  Amount Spent
                  {(stats.amount_spent ?? 0) > 0 && stats.property_count
                    ? ` · ${stats.property_count.toLocaleString()} × $${(stats.cost_per_piece ?? 0.55).toFixed(2)}`
                    : ''}
                </div>
              </div>
              <button
                onClick={handleRecalculate}
                disabled={recalculating}
                className="text-[10px] px-2 py-0.5 rounded font-medium border disabled:opacity-50"
                style={{ color: '#4F46E5', borderColor: '#C7D2FE', background: '#EEF2FF' }}
                title="Recount all records and recalculate amount spent"
              >
                {recalculating ? '…' : 'Recalc'}
              </button>
            </div>
            <div className="text-[11px]" style={{ color: '#6B7280' }}>
              {stats.total_budget
                ? <>Budget remaining: <span style={{ color: '#1A0A2E', fontWeight: 600 }}>${Math.max(0, (stats.total_budget ?? 0) - (stats.amount_spent ?? 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> of ${(stats.total_budget ?? 0).toLocaleString()}</>
                : <span style={{ color: '#9CA3AF' }}>No budget set — go to campaign settings</span>
              }
            </div>
          </div>
        </div>
      </div>

      {/* SMS Funnel Dashboard */}
      {funnel && funnel.skip_traced > 0 && (
        <div className="px-6 py-4" style={{ borderBottom: '1px solid #E5E7EB', background: '#F0FDF4' }}>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: '#065F46' }}>SMS Funnel</span>
            <button
              className="text-[10px] px-2 py-0.5 rounded font-medium border"
              style={{ color: '#065F46', borderColor: '#A7F3D0', background: '#D1FAE5' }}
              onClick={async () => { await exportMailQueue(campaign.id) }}
            >
              Export Mail List ({funnel.mail_queue.toLocaleString()})
            </button>
          </div>
          <div className="flex items-stretch gap-0 rounded-xl overflow-hidden border" style={{ borderColor: '#A7F3D0', maxWidth: 700 }}>
            {[
              { label: 'Total', value: funnel.total, color: '#6B7280', bg: '#F9FAFB' },
              { label: 'Skip Traced', value: funnel.skip_traced, color: '#4F46E5', bg: '#EEF2FF' },
              { label: 'Mobile', value: funnel.mobile, color: '#059669', bg: '#F0FDF4' },
              { label: 'Texts Sent', value: funnel.texts_sent, color: '#0891B2', bg: '#ECFEFF' },
              { label: '🔥 HOT', value: funnel.hot, color: '#DC2626', bg: '#FEF2F2' },
              { label: 'Opted Out', value: funnel.opted_out, color: '#9CA3AF', bg: '#F9FAFB' },
              { label: 'Mail Queue', value: funnel.mail_queue, color: '#D97706', bg: '#FFFBEB' },
            ].map((s, i) => (
              <div key={s.label} className="flex-1 flex flex-col items-center justify-center py-3 px-2 text-center"
                style={{ background: s.bg, borderLeft: i > 0 ? '1px solid #E5E7EB' : 'none' }}>
                <div className="text-lg font-bold" style={{ color: s.color }}>{s.value.toLocaleString()}</div>
                <div className="text-[9px] font-semibold uppercase tracking-wide mt-0.5" style={{ color: '#9CA3AF' }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filter bar */}
      <div className="px-6 py-3 flex items-center gap-3 flex-wrap" style={{ borderBottom: '1px solid #E5E7EB', background: '#FFFFFF' }}>
        {/* Status filter */}
        <select
          className="input-base text-sm py-1.5"
          style={{ maxWidth: '160px' }}
          value={statusFilter}
          onChange={e => handleStatusChange(e.target.value)}
        >
          <option value="all">All Records</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v} ({(bs[k] ?? 0).toLocaleString()})</option>
          ))}
        </select>

        {/* Tags filter */}
        <select
          className="input-base text-sm py-1.5"
          style={{ maxWidth: '140px' }}
          value={tagFilter}
          onChange={e => handleTagChange(e.target.value)}
          onFocus={async () => {
            if (availableTags.length === 0 && !tagsLoading) {
              setTagsLoading(true)
              try { setAvailableTags(await getPropertyTags(campaign.id)) } catch {} finally { setTagsLoading(false) }
            }
          }}
        >
          <option value="">All Tags</option>
          {availableTags.length === 0 && !tagsLoading && <option disabled>No tags yet</option>}
          {availableTags.map(t => (
            <option key={t.tag} value={t.tag}>{t.tag} ({t.count})</option>
          ))}
        </select>

        {/* Boards / status filter */}
        <select
          className="input-base text-sm py-1.5"
          style={{ maxWidth: '150px' }}
          value={boardFilter}
          onChange={e => handleBoardChange(e.target.value)}
        >
          <option value="">All Boards</option>
          {[
            { label: 'New Lead', value: 'lead' },
            { label: 'Contacted', value: 'prospect' },
            { label: 'Offer Sent', value: 'offer_sent' },
            { label: 'Under Contract', value: 'under_contract' },
            { label: 'Due Diligence', value: 'due_diligence' },
            { label: 'Closed Won', value: 'closed_won' },
            { label: 'Closed Lost', value: 'closed_lost' },
          ].map(b => (
            <option key={b.value} value={b.value}>{b.label} ({(stats.by_status?.[b.value] ?? 0).toLocaleString()})</option>
          ))}
        </select>

        {/* Search */}
        <div className="flex-1 relative" style={{ maxWidth: '280px' }}>
          <svg className="absolute left-3 top-1/2 -translate-y-1/2" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="text"
            className="input-base text-sm py-1.5 pl-8"
            placeholder="Search by owner or APN…"
            value={search}
            onChange={e => handleSearch(e.target.value)}
          />
        </div>

        {/* Quick sort */}
        <select
          className="input-base text-sm py-1.5"
          style={{ maxWidth: '200px' }}
          value={`${sortBy}:${sortDir}`}
          onChange={e => handleQuickSort(e.target.value)}
        >
          {QUICK_SORT_OPTIONS.map(o => (
            <option key={`${o.sort_by}:${o.sort_dir}`} value={`${o.sort_by}:${o.sort_dir}`}>{o.label}</option>
          ))}
        </select>

        {/* Bulk action buttons — visible when rows selected */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-xs font-semibold" style={{ color: '#5C2977' }}>
              {allPagesSelected ? `${totalCount.toLocaleString()} selected` : `${selectedIds.size.toLocaleString()} selected`}
            </span>
            <button
              className="px-3 py-1.5 text-xs font-semibold rounded-lg"
              style={{ background: '#F0EBF8', color: '#5C2977', border: '1px solid #D4B8E8' }}
              onClick={() => setShowAdjustPrice(true)}
            >
              Adjust Price
            </button>
            <button
              className="px-3 py-1.5 text-xs font-semibold rounded-lg"
              style={{ background: '#F0EBF8', color: '#5C2977', border: '1px solid #D4B8E8' }}
              onClick={handleExport}
            >
              Export
            </button>
            <button
              className="px-3 py-1.5 text-xs font-semibold rounded-lg"
              style={{ background: 'rgba(183,28,28,0.07)', color: '#B71C1C', border: '1px solid rgba(183,28,28,0.2)' }}
              onClick={() => setShowDeleteConfirm(true)}
            >
              Delete
            </button>
          </div>
        )}
      </div>

      {/* Import progress bar */}
      {importPhase === 'importing' && importTotal > 0 && (
        <div style={{ background: '#5C2977', height: '3px' }}>
          <div style={{ background: '#C4A8D8', height: '100%', width: `${Math.round((importProgress / importTotal) * 100)}%`, transition: 'width 0.3s' }} />
        </div>
      )}

      {/* All-pages selection banner */}
      {!loading && selectedIds.size === properties.length && properties.length > 0 && !allPagesSelected && totalCount > PAGE_SIZE && (
        <div className="mx-6 mt-4 flex items-center justify-between px-4 py-2.5 rounded-lg text-sm" style={{ background: 'rgba(92,41,119,0.07)', border: '1px solid #D4B8E8' }}>
          <span style={{ color: '#3D2B5E' }}>All {properties.length} records on this page are selected.</span>
          <button className="font-semibold text-sm ml-3" style={{ color: '#5C2977' }} onClick={() => setAllPagesSelected(true)}>
            Select all {totalCount.toLocaleString()} records →
          </button>
        </div>
      )}
      {allPagesSelected && (
        <div className="mx-6 mt-4 flex items-center justify-between px-4 py-2.5 rounded-lg text-sm" style={{ background: 'rgba(183,28,28,0.06)', border: '1px solid rgba(183,28,28,0.25)' }}>
          <span style={{ color: '#B71C1C', fontWeight: 600 }}>All {totalCount.toLocaleString()} records selected.</span>
          <button className="font-semibold text-sm ml-3" style={{ color: '#B71C1C' }} onClick={() => { setAllPagesSelected(false); setSelectedIds(new Set()) }}>Clear ×</button>
        </div>
      )}

      {/* Table */}
      <div className="px-6 py-4">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-sm" style={{ color: '#6B5B8A' }}>Loading properties…</div>
          </div>
        ) : (
          <div className="bg-white rounded-xl overflow-hidden" style={{ border: '1px solid #EDE8F5' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: '#F8F5FC', borderBottom: '1px solid #EDE8F5' }}>
                  <th style={{ width: '36px', padding: '10px 12px' }}>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={el => { if (el) el.indeterminate = someSelected }}
                      onChange={toggleSelectAll}
                      style={{ cursor: 'pointer' }}
                    />
                  </th>
                  {([
                    { label: 'OWNER NAME', col: 'owner_full_name' as SortBy },
                    { label: 'MAILING ADDRESS', col: null },
                    { label: 'APN', col: null },
                    { label: 'COUNTY', col: 'county' as SortBy },
                    { label: 'ACRES', col: 'acreage' as SortBy },
                    { label: 'CODE', col: 'campaign_code' as SortBy },
                    { label: 'OFFER PRICE', col: 'offer_price' as SortBy },
                    { label: 'STATUS', col: 'status' as SortBy },
                  ] as { label: string; col: SortBy | null }[]).map(({ label, col }) => (
                    <th
                      key={label}
                      style={{
                        padding: '10px 12px', textAlign: 'left', fontSize: '10px',
                        fontWeight: 700, letterSpacing: '0.08em',
                        color: col && sortBy === col ? '#5C2977' : '#9B8AAE',
                        cursor: col ? 'pointer' : 'default',
                        userSelect: 'none',
                        whiteSpace: 'nowrap',
                      }}
                      onClick={() => col && handleSortColumn(col)}
                    >
                      {label}
                      {col && sortBy === col && (
                        <span style={{ marginLeft: '4px', fontSize: '11px' }}>
                          {sortDir === 'desc' ? '↓' : '↑'}
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {properties.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ padding: '40px 20px', textAlign: 'center', color: '#9B8AAE', fontSize: '13px' }}>
                      No properties found.
                    </td>
                  </tr>
                ) : properties.map((p, i) => {
                  const isSelected = selectedIds.has(p.id)
                  const sc = STATUS_COLORS[p.status ?? 'lead'] ?? STATUS_COLORS.lead
                  const mailingAddr = [p.owner_mailing_address, p.owner_mailing_city, p.owner_mailing_state, p.owner_mailing_zip]
                    .filter(Boolean).join(', ')
                  return (
                    <tr
                      key={p.id}
                      style={{
                        borderBottom: i < properties.length - 1 ? '1px solid #F5F0FC' : 'none',
                        background: isSelected ? 'rgba(92,41,119,0.04)' : 'transparent',
                        cursor: 'pointer',
                      }}
                      onClick={() => setViewingProperty(p)}
                    >
                      <td style={{ padding: '10px 12px' }} onClick={e => { e.stopPropagation(); toggleSelect(p.id) }}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(p.id)}
                          style={{ cursor: 'pointer' }}
                        />
                      </td>
                      <td style={{ padding: '10px 12px', fontWeight: 500, color: '#1A0A2E', maxWidth: '180px' }}>
                        <div className="truncate">{p.owner_full_name ?? <span style={{ color: '#C4B5D8' }}>—</span>}</div>
                      </td>
                      <td style={{ padding: '10px 12px', color: '#6B5B8A', maxWidth: '200px' }}>
                        <div className="truncate text-xs">{mailingAddr || <span style={{ color: '#C4B5D8' }}>—</span>}</div>
                      </td>
                      <td style={{ padding: '10px 12px', color: '#3D2B5E', fontFamily: 'monospace', fontSize: '11px' }}>
                        {p.apn ?? <span style={{ color: '#C4B5D8' }}>—</span>}
                      </td>
                      <td style={{ padding: '10px 12px', color: '#6B5B8A' }}>
                        {p.county ?? <span style={{ color: '#C4B5D8' }}>—</span>}
                      </td>
                      <td style={{ padding: '10px 12px', color: '#6B5B8A', textAlign: 'right' }}>
                        {p.acreage != null ? p.acreage.toFixed(2) : <span style={{ color: '#C4B5D8' }}>—</span>}
                      </td>
                      <td style={{ padding: '10px 12px', color: '#6B5B8A', fontSize: '11px', fontFamily: 'monospace' }}>
                        {p.campaign_code ?? <span style={{ color: '#C4B5D8' }}>—</span>}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: '#3D2B5E', fontWeight: 500 }}>
                        {p.offer_price != null ? new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}).format(p.offer_price) : <span style={{ color: '#C4B5D8' }}>—</span>}
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <span
                          className="px-2 py-0.5 rounded-full text-[11px] font-semibold"
                          style={{ background: sc.bg, color: sc.text, border: `1px solid ${sc.border}` }}
                        >
                          {STATUS_LABELS[p.status ?? 'lead'] ?? p.status}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {/* Pagination footer */}
            <div
              className="flex items-center justify-between px-4 py-3"
              style={{ borderTop: '1px solid #EDE8F5', background: '#FAFAFE' }}
            >
              <span className="text-xs" style={{ color: '#9B8AAE' }}>
                {totalCount === 0 ? '0 results' : `${firstRow.toLocaleString()}–${lastRow.toLocaleString()} of ${totalCount.toLocaleString()} results`}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => goToPage(page - 1)}
                  disabled={page <= 1}
                  className="p-1.5 rounded disabled:opacity-30 transition-opacity hover:opacity-70"
                  style={{ color: '#5C2977' }}
                  title="Previous page"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="15 18 9 12 15 6"/>
                  </svg>
                </button>
                <span className="text-xs px-2 font-medium" style={{ color: '#3D2B5E' }}>
                  {page} / {totalPages || 1}
                </span>
                <button
                  onClick={() => goToPage(page + 1)}
                  disabled={page >= totalPages}
                  className="p-1.5 rounded disabled:opacity-30 transition-opacity hover:opacity-70"
                  style={{ color: '#5C2977' }}
                  title="Next page"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="9 18 15 12 9 6"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Adjust Price modal */}
      {showAdjustPrice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(26,10,46,0.55)' }}>
          <div className="bg-white rounded-2xl p-6 shadow-xl" style={{ maxWidth: '360px', width: '100%' }}>
            <h2 className="section-heading mb-1">Adjust Offer Price</h2>
            <p className="text-sm mb-4" style={{ color: '#6B5B8A' }}>
              Set a new offer price for {selectedIds.size.toLocaleString()} selected {selectedIds.size === 1 ? 'property' : 'properties'}.
            </p>
            <input
              type="number"
              className="input-base w-full text-sm mb-4"
              placeholder="New offer price (e.g. 5000)"
              value={newPrice}
              onChange={e => setNewPrice(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAdjustPrice()}
              autoFocus
              min="0"
            />
            <div className="flex gap-3">
              <button className="btn-secondary flex-1" onClick={() => { setShowAdjustPrice(false); setNewPrice('') }} disabled={adjusting}>
                Cancel
              </button>
              <button className="btn-primary flex-1" onClick={handleAdjustPrice} disabled={adjusting || !newPrice}>
                {adjusting ? 'Updating…' : 'Apply Price'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mail success banner */}
      {mailSuccess && (
        <div className="fixed top-4 right-4 z-50 rounded-xl px-5 py-3 shadow-lg text-sm font-medium flex items-center gap-4" style={{ background: '#2D7A4F', color: '#fff', maxWidth: 480 }}>
          <span className="flex-1">{mailSuccess}</span>
          <button onClick={() => setMailSuccess(null)} className="text-white opacity-70 hover:opacity-100 flex-none text-lg leading-none" style={{ lineHeight: 1 }}>×</button>
        </div>
      )}

      {/* Start Mailing modal */}
      {showMailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(26,10,46,0.55)' }}>
          <div className="bg-white rounded-2xl p-6 shadow-xl" style={{ maxWidth: '440px', width: '100%' }}>
            <h2 className="section-heading mb-1">Start Mailing</h2>
            <p className="text-xs mb-4" style={{ color: '#9B8AAE' }}>
              A CSV of all {(stats.property_count ?? 0).toLocaleString()} records in this campaign will be emailed to your mail house.
            </p>
            <div className="flex flex-col gap-1 mb-4">
              <label className="label-caps">Mail House Email</label>
              <input
                type="email"
                className="input-base"
                placeholder="mailhouse@example.com"
                value={mailHouseEmail}
                onChange={e => setMailHouseEmail(e.target.value)}
              />
              <p className="text-[11px] mt-1" style={{ color: '#9B8AAE' }}>
                {stats.cost_per_piece ? `Estimated cost: $${((stats.cost_per_piece ?? 0) * (stats.property_count ?? 0)).toFixed(2)} at $${stats.cost_per_piece}/piece` : 'Set cost per piece in campaign settings to track spend.'}
              </p>
            </div>
            {mailError && <p className="text-xs mb-3" style={{ color: '#B71C1C' }}>{mailError}</p>}
            <div className="flex gap-3">
              <button className="btn-secondary flex-1" onClick={() => setShowMailModal(false)} disabled={mailing}>Cancel</button>
              <button
                className="btn-primary flex-1"
                onClick={handleSendMailing}
                disabled={mailing || !mailHouseEmail.trim()}
              >
                {mailing ? 'Sending…' : `Send to Mail House`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(26,10,46,0.55)' }}>
          <div className="bg-white rounded-2xl p-6 shadow-xl" style={{ maxWidth: '400px', width: '100%' }}>
            <h2 className="section-heading mb-2">Delete {selectedIds.size.toLocaleString()} {selectedIds.size === 1 ? 'Property' : 'Properties'}?</h2>
            <p className="text-sm mb-6" style={{ color: '#6B5B8A' }}>This cannot be undone.</p>
            <div className="flex gap-3">
              <button className="btn-secondary flex-1" onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>Cancel</button>
              <button
                className="flex-1 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60"
                style={{ background: '#B71C1C' }}
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
