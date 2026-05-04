import React, { useEffect, useRef, useState } from 'react'
import Papa from 'papaparse'
import type { CRMProperty, CRMCampaign, PropertyStatus } from '../types/crm'
import {
  listProperties, updateProperty, deleteProperties, bulkInsertRows, getCrmCampaign,
  exportPropertiesCsv, startCampaignLpPull, getCampaignLpPullStatus,
  sendCampaignMailDrop, updateCrmCampaign, getPropertyTags, recalculateAmountSpent,
  startSmsCampaign, getSmsStatus,
  getCampaignFunnelStats, exportMailQueue,
  getSmsPreview, importLeadSherpa, getCampaignSmsStats, createCampaignFromLeadSherpa,
  previewLeadSherpaApns,
} from '../api/crm'
import type { CampaignFunnelStats, SmsCampaignPreview, CampaignSmsStats, LeadSherpaMatchInfo, LeadSherpaCreateResult, LeadSherpaImportResult } from '../api/crm'
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
  onNavigateToCampaign?: (campaignId: string) => void
}

export default function CampaignDetail({ campaign, onBack, onCampaignUpdated, onNavigateToCampaign }: Props) {
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


  // SMS campaign
  const [smsJobId, setSmsJobId] = useState<string | null>(null)
  const [smsDone, setSmsDone] = useState(0)
  const [smsTotal, setSmsTotal] = useState(0)
  const [smsStatus, setSmsStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [smsSent, setSmsSent] = useState(0)
  const [smsCapped, setSmsCapped] = useState(false)
  const [smsDay, setSmsDay] = useState(1)
  const [smsError, setSmsError] = useState<string | null>(null)
  const [smsEta, setSmsEta] = useState(0)
  const smsPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Single-record text confirm
  const [singleTextProp, setSingleTextProp] = useState<CRMProperty | null>(null)
  const [singleTextSending, setSingleTextSending] = useState(false)
  const [singleTextResult, setSingleTextResult] = useState<string | null>(null)

  // SMS confirmation modal
  const [showSmsConfirm, setShowSmsConfirm] = useState(false)
  const [smsConfirmDay, setSmsConfirmDay] = useState(1)
  const [smsPreview, setSmsPreview] = useState<SmsCampaignPreview | null>(null)
  const [smsPreviewLoading, setSmsPreviewLoading] = useState(false)
  const [smsConfirmSelectedIds, setSmsConfirmSelectedIds] = useState<string[] | undefined>(undefined)

  // Lead Sherpa import
  const leadSherpaFileRef = useRef<HTMLInputElement>(null)
  const [showLeadSherpaModal, setShowLeadSherpaModal] = useState(false)
  const [leadSherpaParsed, setLeadSherpaParsed] = useState<{ rows: Record<string, string>[]; apnCol: string } | null>(null)
  const [leadSherpaImporting, setLeadSherpaImporting] = useState(false)
  const [leadSherpaError, setLeadSherpaError] = useState<string | null>(null)
  const [lsMatchInfo, setLsMatchInfo] = useState<LeadSherpaMatchInfo | null>(null)
  const [lsMatchLoading, setLsMatchLoading] = useState(false)
  const [lsMode, setLsMode] = useState<'update' | 'create' | null>(null)
  const [lsNewCampaignName, setLsNewCampaignName] = useState('')
  const [lsUpdateResult, setLsUpdateResult] = useState<LeadSherpaImportResult | null>(null)
  const [lsCreateResult, setLsCreateResult] = useState<LeadSherpaCreateResult | null>(null)

  // Funnel stats
  const [funnel, setFunnel] = useState<CampaignFunnelStats | null>(null)

  // SMS stats for status bar
  const [smsStats, setSmsStats] = useState<CampaignSmsStats | null>(null)

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
    loadSmsStats()
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

  // ── Lead Sherpa Import ────────────────────────────────────────────────
  function resetLeadSherpaModal() {
    setLeadSherpaParsed(null)
    setLeadSherpaError(null)
    setLsMatchInfo(null)
    setLsMatchLoading(false)
    setLsMode(null)
    setLsNewCampaignName('')
    setLsUpdateResult(null)
    setLsCreateResult(null)
  }

  function handleLeadSherpaFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    resetLeadSherpaModal()
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h: string) => h.trim(),
      complete: async (results) => {
        const rows = results.data as Record<string, string>[]
        if (!rows.length) { setLeadSherpaError('No rows found in CSV.'); return }
        const headers = Object.keys(rows[0])
        const apnCol = headers.find(h =>
          /parcel.?number|^apn$|parcel.?id|property.?parcel|property_apn/i.test(h)
        ) ?? headers[0]
        setLeadSherpaParsed({ rows, apnCol })
        // Auto-preview
        setLsMatchLoading(true)
        try {
          const apns = rows.map(r => String(r[apnCol] ?? '')).filter(Boolean)
          const info = await previewLeadSherpaApns(campaign.id, apns)
          setLsMatchInfo(info)
          setLsMode(info.recommended_mode === 'create' ? 'create' : info.recommended_mode === 'update' ? 'update' : null)
          if (info.recommended_mode === 'create') {
            const st = rows.slice(0, 100).map(r => {
              const stCol = Object.keys(r).find(k => /property.?state|situs.?state/i.test(k))
              return stCol ? String(r[stCol] || '').trim().toUpperCase() : ''
            }).filter(Boolean)
            const counts: Record<string, number> = {}
            for (const s of st) counts[s] = (counts[s] || 0) + 1
            const dom = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
            const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            setLsNewCampaignName(`${dom ? dom + ' ' : ''}Lead Sherpa ${today}`.trim())
          }
        } catch {
          setLsMatchInfo(null)
        } finally { setLsMatchLoading(false) }
      },
      error: () => { setLeadSherpaError('Failed to parse CSV.') },
    })
  }

  async function handleLeadSherpaImport() {
    if (!leadSherpaParsed || !lsMode) return
    setLeadSherpaImporting(true)
    setLeadSherpaError(null)
    try {
      if (lsMode === 'update') {
        const res = await importLeadSherpa(campaign.id, leadSherpaParsed.rows)
        setLsUpdateResult(res)
        loadFunnel()
        loadSmsStats()
        loadProperties(page, statusFilter, search)
      } else {
        const res = await createCampaignFromLeadSherpa(leadSherpaParsed.rows, lsNewCampaignName)
        setLsCreateResult(res)
      }
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setLeadSherpaError(detail ?? 'Import failed')
    } finally { setLeadSherpaImporting(false) }
  }

  // ── SMS Confirm Modal ─────────────────────────────────────────────────
  async function openSmsConfirm(day: number, ids?: string[]) {
    if (smsStatus === 'running') return
    setSmsConfirmDay(day)
    setSmsConfirmSelectedIds(ids)
    setSmsPreview(null)
    setSmsPreviewLoading(true)
    setShowSmsConfirm(true)
    try {
      const preview = await getSmsPreview(campaign.id, day)
      setSmsPreview(preview)
    } catch { setSmsPreview(null) }
    finally { setSmsPreviewLoading(false) }
  }

  // ── SMS Campaign ─────────────────────────────────────────────────────
  async function handleStartSms(day = 1, ids?: string[]) {
    if (smsStatus === 'running') return
    setSmsStatus('running')
    setSmsDone(0)
    setSmsTotal(0)
    setSmsSent(0)
    setSmsCapped(false)
    setSmsDay(day)
    setSmsError(null)
    try {
      const sendIds = ids ?? (selectedIds.size > 0 && !allPagesSelected ? Array.from(selectedIds) : undefined)
      const { job_id, total } = await startSmsCampaign(campaign.id, day, sendIds)
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
          setSmsEta(s.eta_seconds ?? 0)
          if (s.status === 'done' || s.status === 'error') {
            setSmsStatus(s.status as 'done' | 'error')
            if (s.status === 'error') setSmsError('SMS send failed')
            if (smsPollRef.current) { clearInterval(smsPollRef.current); smsPollRef.current = null }
            loadFunnel()
            loadSmsStats()
          }
        } catch {}
      }, 2000)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setSmsError(err?.response?.data?.detail ?? 'Failed to start SMS campaign')
      setSmsStatus('error')
    }
  }

  // ── Single-record text send ────────────────────────────────────────────
  async function handleSingleText(prop: CRMProperty) {
    if (!prop.phone_1) return
    setSingleTextSending(true)
    setSingleTextResult(null)
    try {
      await startSmsCampaign(campaign.id, 1, [prop.id])
      setSingleTextResult(`Text sent to ${prop.owner_first_name || prop.owner_full_name || 'owner'} at ${prop.phone_1}`)
      setTimeout(() => { setSingleTextProp(null); setSingleTextResult(null) }, 2500)
      loadFunnel()
      loadSmsStats()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setSingleTextResult(detail ?? 'Failed to send text')
    } finally { setSingleTextSending(false) }
  }

  // ── Funnel Stats ──────────────────────────────────────────────────────
  async function loadFunnel() {
    try { setFunnel(await getCampaignFunnelStats(campaign.id)) } catch {}
  }

  async function loadSmsStats() {
    try { setSmsStats(await getCampaignSmsStats(campaign.id)) } catch {}
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

  // SMS status bar computed values
  const smsRunning = smsStatus === 'running'
  const sentTotal = smsStats?.sent_total ?? 0
  const readyToText = smsStats?.ready_to_text ?? 0
  const smsPhase = smsRunning ? 'running'
    : sentTotal === 0 ? 'not_started'
    : readyToText > 0 ? 'in_progress'
    : 'complete'
  const daysLeft = Math.max(0, Math.ceil(readyToText / 1000))
  const estCompletionDate = daysLeft > 0 ? (() => {
    const d = new Date(); d.setDate(d.getDate() + daysLeft)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  })() : null
  const fmtTs = (ts?: string | null) => {
    if (!ts) return ''
    return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  }

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

          {/* SMS status */}
          {smsStatus === 'running' && (
            <span className="text-xs" style={{ color: '#9CA3AF' }}>
              💬 Sending… {smsDone.toLocaleString()} of {smsTotal.toLocaleString()}
              {smsEta > 0 && ` · ~${smsEta >= 60 ? `${Math.ceil(smsEta / 60)} min` : `${smsEta}s`} remaining`}
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
            onClick={() => { resetLeadSherpaModal(); setShowLeadSherpaModal(true) }}
            title="Import skip trace results from Lead Sherpa CSV — match by APN, update phone numbers"
          >
            📋 Import Skip Trace
          </button>
          <input ref={leadSherpaFileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleLeadSherpaFileSelected} />
          <button
            className="btn-secondary text-sm"
            onClick={() => openSmsConfirm(1)}
            disabled={smsStatus === 'running'}
            title="Send Day 1 SMS to all mobile numbers"
          >
            💬 {smsStatus === 'running' ? `Sending… ${smsDone.toLocaleString()}/${smsTotal.toLocaleString()}${smsEta > 0 ? ` · ~${Math.ceil(smsEta / 60)}m` : ''}` : 'Start Texting'}
          </button>
          {funnel && funnel.skip_traced > 0 && (
            <button
              className="btn-secondary text-sm"
              onClick={() => openSmsConfirm(3)}
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

      {/* SMS Campaign Status Bar */}
      {(totalCount > 0 || smsStats) && (
        <div style={{ borderBottom: '1px solid #E5E7EB', background: '#FAFBFF' }}>
          <div className="px-6 py-4">
            {/* Header row */}
            <div className="flex items-center justify-between mb-3">
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#374151' }}>
                SMS Campaign Status
              </span>
              <div className="flex items-center gap-2">
                {smsPhase === 'not_started' && (
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', background: '#F3F4F6', border: '1px solid #D1D5DB', borderRadius: 20, padding: '2px 10px' }}>
                    NOT STARTED
                  </span>
                )}
                {smsPhase === 'running' && (
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#1D4ED8', background: '#EFF6FF', border: '1px solid #93C5FD', borderRadius: 20, padding: '2px 10px' }}>
                    ◉ RUNNING
                  </span>
                )}
                {smsPhase === 'in_progress' && (
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#065F46', background: '#D1FAE5', border: '1px solid #6EE7B7', borderRadius: 20, padding: '2px 10px' }}>
                    ● IN PROGRESS
                  </span>
                )}
                {smsPhase === 'complete' && (
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#065F46', background: '#D1FAE5', border: '1px solid #6EE7B7', borderRadius: 20, padding: '2px 10px' }}>
                    ✓ COMPLETE
                  </span>
                )}
              </div>
            </div>

            {/* Stats grid */}
            <div className="flex flex-wrap gap-3 mb-3">
              {[
                { icon: '📱', value: smsRunning ? (smsStats?.ready_to_text ?? 0) : readyToText, label: smsRunning ? 'Queued' : 'Ready to text', color: '#059669', bg: '#F0FDF4', border: '#A7F3D0' },
                { icon: '✅', value: smsStats?.sent_today ?? 0, label: 'Sent today', color: '#1D4ED8', bg: '#EFF6FF', border: '#93C5FD' },
                { icon: '🔥', value: smsStats?.hot ?? 0, label: 'HOT', color: '#DC2626', bg: '#FEF2F2', border: '#FCA5A5' },
                { icon: '↩️', value: smsStats?.replied ?? 0, label: 'Replied', color: '#7C3AED', bg: '#F5F3FF', border: '#C4B5FD' },
                { icon: '🚫', value: smsStats?.dnc_blocked ?? 0, label: 'DNC blocked', color: '#DC2626', bg: '#FEF2F2', border: '#FCA5A5' },
                { icon: '📬', value: smsStats?.mail_only ?? 0, label: 'Mail only', color: '#D97706', bg: '#FFFBEB', border: '#FCD34D' },
              ].map(s => (
                <div key={s.label} style={{ background: s.bg, border: `1px solid ${s.border}`, borderRadius: 8, padding: '8px 14px', minWidth: 90, textAlign: 'center' }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: s.color, lineHeight: 1.2 }}>{s.value.toLocaleString()}</div>
                  <div style={{ fontSize: 10, color: '#6B7280', marginTop: 2 }}>{s.icon} {s.label}</div>
                </div>
              ))}
            </div>

            {/* Action row */}
            <div className="flex items-center gap-3 flex-wrap">
              {smsPhase === 'not_started' && (
                <button
                  className="btn-primary text-sm"
                  onClick={() => openSmsConfirm(1)}
                  disabled={smsRunning}
                >
                  💬 Start Texting
                </button>
              )}
              {(smsPhase === 'in_progress' || smsPhase === 'running') && (
                <>
                  <button
                    className="btn-primary text-sm"
                    onClick={() => openSmsConfirm(1)}
                    disabled={smsRunning}
                  >
                    {smsRunning ? `Sending… ${smsDone.toLocaleString()}/${smsTotal.toLocaleString()}${smsEta > 0 ? ` · ~${Math.ceil(smsEta / 60)}m left` : ''}` : '💬 Send Next Batch'}
                  </button>
                  {(smsStats?.sent_total ?? 0) > 0 && (
                    <button
                      className="btn-secondary text-sm"
                      onClick={() => openSmsConfirm(3)}
                      disabled={smsRunning}
                    >
                      💬 Day 3 Follow-up ({(smsStats?.day3_sent ?? 0).toLocaleString()} sent)
                    </button>
                  )}
                </>
              )}
              {smsPhase === 'complete' && (
                <button
                  className="btn-secondary text-sm"
                  onClick={() => openSmsConfirm(3)}
                  disabled={smsRunning}
                >
                  💬 Day 3 Follow-up ({(smsStats?.day3_sent ?? 0).toLocaleString()} sent)
                </button>
              )}
              <button
                className="btn-secondary text-sm"
                onClick={() => exportMailQueue(campaign.id)}
              >
                📬 Export Mail List ({(smsStats?.mail_queue ?? funnel?.mail_queue ?? 0).toLocaleString()})
              </button>
              {estCompletionDate && smsPhase !== 'complete' && (
                <span style={{ fontSize: 11, color: '#6B7280' }}>
                  Daily limit: 1,000 · Est. completion: {estCompletionDate}
                </span>
              )}
              {smsStats?.first_sent_date && (
                <span style={{ fontSize: 11, color: '#9CA3AF' }}>
                  Started {new Date(smsStats.first_sent_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
              )}
            </div>

            {/* Timeline */}
            {(smsStats?.sent_total ?? 0) > 0 && (
              <div className="flex items-center gap-4 mt-3 pt-3" style={{ borderTop: '1px solid #E5E7EB' }}>
                <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#9CA3AF' }}>Timeline</span>
                {[
                  { label: 'Day 1', desc: 'Intro texts', count: smsStats?.sent_total ?? 0, color: '#059669' },
                  { label: 'Day 3', desc: 'Follow-up', count: smsStats?.day3_sent ?? 0, color: '#0891B2' },
                  { label: 'Day 5+', desc: 'Mail queue', count: smsStats?.mail_queue ?? 0, color: '#D97706' },
                ].map((t, i) => (
                  <React.Fragment key={t.label}>
                    {i > 0 && <span style={{ color: '#D1D5DB', fontSize: 16 }}>→</span>}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: t.count > 0 ? t.color : '#D1D5DB' }}>
                        {t.label}
                      </span>
                      <span style={{ fontSize: 11, color: t.count > 0 ? '#374151' : '#9CA3AF' }}>
                        {t.count > 0 ? `${t.count.toLocaleString()} ${t.desc}` : `0 ${t.desc} yet`}
                      </span>
                    </div>
                  </React.Fragment>
                ))}
              </div>
            )}
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
              style={{ background: '#E8F5E9', color: '#1B5E20', border: '1px solid #A5D6A7' }}
              onClick={() => openSmsConfirm(1, Array.from(selectedIds))}
              disabled={smsStatus === 'running'}
              title="Send Day 1 SMS to selected records with mobile phones"
            >
              📱 Text Selected ({selectedIds.size})
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
                    { label: 'SMS', col: null },
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
                    <td colSpan={10} style={{ padding: '40px 20px', textAlign: 'center', color: '#9B8AAE', fontSize: '13px' }}>
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
                      <td style={{ padding: '10px 8px', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                        {(() => {
                          const s10: React.CSSProperties = { fontSize: 10, whiteSpace: 'nowrap' }
                          if (p.opted_out) return <span title="Replied STOP" style={{ ...s10, color: '#6B7280' }}>⛔ Opted Out</span>
                          if (p.phone_1_dnc) return <span title="Do Not Contact" style={{ ...s10, color: '#DC2626', fontWeight: 600 }}>🚫 DNC</span>
                          if (p.sms_status === 'hot') return <span title="HOT — replied with interest" style={{ ...s10, color: '#DC2626', fontWeight: 700 }}>🔥 HOT</span>
                          if (p.sms_status === 'replied') return <span title="Replied — not yet HOT" style={{ ...s10, color: '#7C3AED', fontWeight: 600 }}>↩️ Replied</span>
                          if (p.sms_status === 'day3_sent') {
                            const d = fmtTs(p.sms_day3_sent_at)
                            return <span title={`Day 3 sent${d ? ` ${d}` : ''}`} style={{ ...s10, color: '#0891B2', fontWeight: 600 }}>💬 Day 3{d ? ` · ${d}` : ''}</span>
                          }
                          if (p.sms_status === 'day1_sent') {
                            const d = fmtTs(p.sms_day1_sent_at)
                            return <span title={`Day 1 sent${d ? ` ${d}` : ''}`} style={{ ...s10, color: '#059669', fontWeight: 600 }}>✅ Sent{d ? ` ${d}` : ''}</span>
                          }
                          if (p.sms_status === 'mail_queue') return <span title="In mail queue" style={{ ...s10, color: '#D97706' }}>✉️ Mail Queue</span>
                          if (p.phone_1 && p.phone_1_type === 'mobile') return (
                            <button
                              onClick={() => { setSingleTextProp(p); setSingleTextResult(null) }}
                              title={`Text ${p.owner_first_name || 'owner'} at ${p.phone_1}`}
                              style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid #A5D6A7', background: '#E8F5E9', color: '#1B5E20', fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
                            >
                              📱 Queued
                            </button>
                          )
                          if (p.phone_1 && p.phone_1_type === 'landline') return <span title="Landline — mail only" style={{ ...s10, color: '#D97706' }}>📞 Landline</span>
                          if (!p.phone_1) return <span title="No phone found — mail only" style={{ ...s10, color: '#9CA3AF' }}>📬 No Phone</span>
                          return null
                        })()}
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

      {/* Lead Sherpa Import modal */}
      {showLeadSherpaModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(26,10,46,0.55)' }}
          onClick={() => { if (!leadSherpaImporting) { setShowLeadSherpaModal(false) } }}>
          <div className="bg-white rounded-2xl p-6 shadow-xl" style={{ maxWidth: '500px', width: '100%' }}
            onClick={e => e.stopPropagation()}>
            <h2 className="section-heading mb-1">Lead Sherpa Import</h2>

            {/* Phase 1: File select */}
            {!leadSherpaParsed && !lsUpdateResult && !lsCreateResult && (
              <>
                <p className="text-xs mb-4" style={{ color: '#9B8AAE' }}>
                  Upload a Lead Sherpa CSV. We'll detect whether to update this campaign or create a new one.
                </p>
                <button className="btn-secondary w-full text-sm mb-4" onClick={() => leadSherpaFileRef.current?.click()}>
                  Choose CSV File
                </button>
              </>
            )}

            {/* Phase 2: Preview / mode selection */}
            {leadSherpaParsed && !lsUpdateResult && !lsCreateResult && (
              <>
                <div style={{ background: '#F5F3FF', borderRadius: 8, padding: '12px 14px', marginBottom: 12 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: '#3730A3', margin: 0 }}>
                    {leadSherpaParsed.rows.length.toLocaleString()} rows · APN column: <em>{leadSherpaParsed.apnCol}</em>
                  </p>
                  {lsMatchLoading && (
                    <p style={{ fontSize: 12, color: '#6B7280', margin: '6px 0 0' }}>Analyzing matches…</p>
                  )}
                  {lsMatchInfo && !lsMatchLoading && (
                    <p style={{ fontSize: 12, color: '#6B7280', margin: '6px 0 0' }}>
                      {lsMatchInfo.matched.toLocaleString()} of {lsMatchInfo.total.toLocaleString()} APNs match this campaign ({lsMatchInfo.match_pct}%)
                    </p>
                  )}
                  <button className="text-xs mt-2 underline" style={{ color: '#4F46E5', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                    onClick={() => { resetLeadSherpaModal(); leadSherpaFileRef.current?.click() }}>
                    Choose different file
                  </button>
                </div>

                {/* Mode: ask if recommended_mode === 'ask', otherwise show auto-selected */}
                {lsMatchInfo && !lsMatchLoading && (
                  <div style={{ marginBottom: 12 }}>
                    {lsMatchInfo.recommended_mode === 'ask' && (
                      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                        <button
                          onClick={() => setLsMode('update')}
                          style={{
                            flex: 1, padding: '10px 12px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                            border: `2px solid ${lsMode === 'update' ? '#4F46E5' : '#E5E7EB'}`,
                            background: lsMode === 'update' ? '#EEF2FF' : '#fff', cursor: 'pointer', color: '#1F2937'
                          }}>
                          Update this campaign<br />
                          <span style={{ fontSize: 11, fontWeight: 400, color: '#6B7280' }}>{lsMatchInfo.matched} records will be updated</span>
                        </button>
                        <button
                          onClick={() => setLsMode('create')}
                          style={{
                            flex: 1, padding: '10px 12px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                            border: `2px solid ${lsMode === 'create' ? '#4F46E5' : '#E5E7EB'}`,
                            background: lsMode === 'create' ? '#EEF2FF' : '#fff', cursor: 'pointer', color: '#1F2937'
                          }}>
                          Create new campaign<br />
                          <span style={{ fontSize: 11, fontWeight: 400, color: '#6B7280' }}>{leadSherpaParsed.rows.length} records imported</span>
                        </button>
                      </div>
                    )}
                    {lsMatchInfo.recommended_mode === 'update' && (
                      <div style={{ background: '#F0FDF4', borderRadius: 8, padding: '10px 12px', marginBottom: 12 }}>
                        <p style={{ fontSize: 13, color: '#065F46', fontWeight: 600, margin: 0 }}>Update mode selected</p>
                        <p style={{ fontSize: 12, color: '#6B7280', margin: '4px 0 0' }}>
                          {lsMatchInfo.matched.toLocaleString()} existing records will be updated with phone numbers, DNC flags, and skip trace data.
                        </p>
                        <button className="text-xs mt-1 underline" style={{ color: '#4F46E5', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                          onClick={() => setLsMode('create')}>Switch to Create New Campaign instead</button>
                      </div>
                    )}
                    {lsMatchInfo.recommended_mode === 'create' && (
                      <div style={{ background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 8, padding: '10px 12px', marginBottom: 12 }}>
                        <p style={{ fontSize: 13, color: '#92400E', fontWeight: 600, margin: '0 0 4px' }}>
                          Only {lsMatchInfo.match_pct}% of APNs match — create new campaign?
                        </p>
                        <p style={{ fontSize: 12, color: '#6B7280', margin: '0 0 4px' }}>
                          All {leadSherpaParsed.rows.length.toLocaleString()} records will be imported as new properties.
                        </p>
                        <button className="text-xs underline" style={{ color: '#4F46E5', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                          onClick={() => setLsMode('update')}>Update this campaign instead</button>
                      </div>
                    )}

                    {lsMode === 'create' && (
                      <div style={{ marginTop: 8 }}>
                        <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Campaign name</label>
                        <input
                          type="text"
                          value={lsNewCampaignName}
                          onChange={e => setLsNewCampaignName(e.target.value)}
                          placeholder="e.g. TX Lead Sherpa May 2026"
                          style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #D1D5DB', fontSize: 13, boxSizing: 'border-box' }}
                        />
                      </div>
                    )}
                  </div>
                )}

                {!lsMatchInfo && !lsMatchLoading && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => setLsMode('update')} style={{ flex: 1, padding: '10px 12px', borderRadius: 8, fontSize: 13, fontWeight: 600, border: `2px solid ${lsMode === 'update' ? '#4F46E5' : '#E5E7EB'}`, background: lsMode === 'update' ? '#EEF2FF' : '#fff', cursor: 'pointer', color: '#1F2937' }}>
                        Update this campaign
                      </button>
                      <button onClick={() => setLsMode('create')} style={{ flex: 1, padding: '10px 12px', borderRadius: 8, fontSize: 13, fontWeight: 600, border: `2px solid ${lsMode === 'create' ? '#4F46E5' : '#E5E7EB'}`, background: lsMode === 'create' ? '#EEF2FF' : '#fff', cursor: 'pointer', color: '#1F2937' }}>
                        Create new campaign
                      </button>
                    </div>
                    {lsMode === 'create' && (
                      <div style={{ marginTop: 8 }}>
                        <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Campaign name</label>
                        <input type="text" value={lsNewCampaignName} onChange={e => setLsNewCampaignName(e.target.value)}
                          placeholder="e.g. TX Lead Sherpa May 2026"
                          style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #D1D5DB', fontSize: 13, boxSizing: 'border-box' }} />
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* Phase 3: Update result */}
            {lsUpdateResult && (
              <div style={{ background: '#F0FDF4', border: '1px solid #A7F3D0', borderRadius: 8, padding: '14px 16px', marginBottom: 12 }}>
                <p style={{ fontSize: 14, fontWeight: 700, color: '#065F46', margin: '0 0 8px' }}>Import complete</p>
                <p style={{ fontSize: 13, color: '#065F46', margin: '2px 0' }}>✓ {lsUpdateResult.updated.toLocaleString()} records updated</p>
                {(lsUpdateResult.mobile_ready ?? 0) > 0 && <p style={{ fontSize: 13, color: '#065F46', margin: '2px 0' }}>📱 {(lsUpdateResult.mobile_ready ?? 0).toLocaleString()} mobile numbers ready to text</p>}
                {(lsUpdateResult.mail_only ?? 0) > 0 && <p style={{ fontSize: 13, color: '#6B7280', margin: '2px 0' }}>📬 {(lsUpdateResult.mail_only ?? 0).toLocaleString()} mail only (landline/no phone)</p>}
                {lsUpdateResult.dnc_flagged > 0 && <p style={{ fontSize: 13, color: '#B45309', margin: '2px 0' }}>🚫 {lsUpdateResult.dnc_flagged.toLocaleString()} DNC numbers flagged</p>}
                {lsUpdateResult.deceased_skipped > 0 && <p style={{ fontSize: 13, color: '#6B7280', margin: '2px 0' }}>⚰️ {lsUpdateResult.deceased_skipped.toLocaleString()} deceased owners skipped</p>}
                {(lsUpdateResult.litigators ?? 0) > 0 && <p style={{ fontSize: 13, color: '#B91C1C', margin: '2px 0' }}>⚠️ {(lsUpdateResult.litigators ?? 0).toLocaleString()} litigators flagged</p>}
                {lsUpdateResult.not_matched > 0 && <p style={{ fontSize: 13, color: '#6B7280', margin: '2px 0' }}>— {lsUpdateResult.not_matched.toLocaleString()} records not matched in this campaign</p>}
              </div>
            )}

            {/* Phase 3: Create result */}
            {lsCreateResult && (
              <div style={{ background: '#F0FDF4', border: '1px solid #A7F3D0', borderRadius: 8, padding: '14px 16px', marginBottom: 12 }}>
                <p style={{ fontSize: 14, fontWeight: 700, color: '#065F46', margin: '0 0 8px' }}>Campaign created: {lsCreateResult.campaign_name}</p>
                <p style={{ fontSize: 13, color: '#065F46', margin: '2px 0' }}>✓ {lsCreateResult.imported.toLocaleString()} records imported</p>
                <p style={{ fontSize: 13, color: '#065F46', margin: '2px 0' }}>📱 {lsCreateResult.mobile_ready.toLocaleString()} mobile numbers ready to text</p>
                {lsCreateResult.mail_only > 0 && <p style={{ fontSize: 13, color: '#6B7280', margin: '2px 0' }}>📬 {lsCreateResult.mail_only.toLocaleString()} mail only (landline/no phone)</p>}
                {lsCreateResult.dnc_flagged > 0 && <p style={{ fontSize: 13, color: '#B45309', margin: '2px 0' }}>🚫 {lsCreateResult.dnc_flagged.toLocaleString()} DNC numbers flagged</p>}
                {lsCreateResult.deceased_skipped > 0 && <p style={{ fontSize: 13, color: '#6B7280', margin: '2px 0' }}>⚰️ {lsCreateResult.deceased_skipped.toLocaleString()} deceased owners skipped</p>}
                {lsCreateResult.litigators > 0 && <p style={{ fontSize: 13, color: '#B91C1C', margin: '2px 0' }}>⚠️ {lsCreateResult.litigators.toLocaleString()} litigators flagged</p>}
                {onNavigateToCampaign && (
                  <button
                    className="btn-primary text-sm mt-3 w-full"
                    onClick={() => { setShowLeadSherpaModal(false); onNavigateToCampaign(lsCreateResult.campaign_id) }}
                  >
                    Go to {lsCreateResult.campaign_name} →
                  </button>
                )}
              </div>
            )}

            {leadSherpaError && (
              <p className="text-xs mb-3" style={{ color: '#B71C1C' }}>{leadSherpaError}</p>
            )}

            <div className="flex gap-3">
              <button className="btn-secondary flex-1" onClick={() => setShowLeadSherpaModal(false)} disabled={leadSherpaImporting}>
                {lsUpdateResult || lsCreateResult ? 'Close' : 'Cancel'}
              </button>
              {leadSherpaParsed && !lsUpdateResult && !lsCreateResult && lsMode && (
                <button
                  className="btn-primary flex-1"
                  onClick={handleLeadSherpaImport}
                  disabled={leadSherpaImporting || lsMatchLoading || (lsMode === 'create' && !lsNewCampaignName.trim())}
                >
                  {leadSherpaImporting
                    ? 'Importing…'
                    : lsMode === 'update'
                      ? `Update ${(lsMatchInfo?.matched ?? leadSherpaParsed.rows.length).toLocaleString()} Records`
                      : `Create Campaign (${leadSherpaParsed.rows.length.toLocaleString()} records)`
                  }
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* SMS Confirmation modal */}
      {showSmsConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(26,10,46,0.55)' }}
          onClick={() => { if (smsStatus !== 'running') setShowSmsConfirm(false) }}>
          <div className="bg-white rounded-2xl p-6 shadow-xl" style={{ maxWidth: '440px', width: '100%' }}
            onClick={e => e.stopPropagation()}>
            <h2 className="section-heading mb-3">
              {smsConfirmDay === 1 ? 'Send Day 1 SMS' : 'Send Day 3 Follow-up'}
              {smsConfirmSelectedIds && ` · ${smsConfirmSelectedIds.length} selected`}
            </h2>

            {smsPreviewLoading && (
              <div className="text-sm text-center py-4" style={{ color: '#9B8AAE' }}>Loading preview…</div>
            )}

            {smsPreview && !smsPreviewLoading && (
              <div style={{ background: '#F8F5FC', borderRadius: 8, padding: '14px', marginBottom: 16 }}>
                <div className="flex justify-between text-sm mb-2">
                  <span style={{ color: '#1A0A2E' }}>📱 Mobile ready to text</span>
                  <span style={{ fontWeight: 700, color: '#059669' }}>{smsPreview.mobile_ready.toLocaleString()}</span>
                </div>
                {smsPreview.dnc > 0 && (
                  <div className="flex justify-between text-sm mb-2">
                    <span style={{ color: '#DC2626' }}>🚫 DNC flagged (will skip)</span>
                    <span style={{ fontWeight: 700, color: '#DC2626' }}>{smsPreview.dnc.toLocaleString()}</span>
                  </div>
                )}
                {smsPreview.opted_out > 0 && (
                  <div className="flex justify-between text-sm mb-2">
                    <span style={{ color: '#9CA3AF' }}>🚫 Opted out (will skip)</span>
                    <span style={{ fontWeight: 700, color: '#9CA3AF' }}>{smsPreview.opted_out.toLocaleString()}</span>
                  </div>
                )}
                {smsPreview.no_phone > 0 && (
                  <div className="flex justify-between text-sm mb-2">
                    <span style={{ color: '#9CA3AF' }}>📭 No mobile phone</span>
                    <span style={{ fontWeight: 700, color: '#9CA3AF' }}>{smsPreview.no_phone.toLocaleString()}</span>
                  </div>
                )}
                {smsPreview.already_sent > 0 && (
                  <div className="flex justify-between text-sm">
                    <span style={{ color: '#9CA3AF' }}>✅ Already sent (will skip)</span>
                    <span style={{ fontWeight: 700, color: '#9CA3AF' }}>{smsPreview.already_sent.toLocaleString()}</span>
                  </div>
                )}
              </div>
            )}

            {!smsPreview && !smsPreviewLoading && (
              <p className="text-sm mb-4" style={{ color: '#9B8AAE' }}>Ready to send Day {smsConfirmDay} messages to eligible mobile numbers.</p>
            )}

            <div className="flex gap-3">
              <button className="btn-secondary flex-1" onClick={() => setShowSmsConfirm(false)}>Cancel</button>
              <button
                className="btn-primary flex-1"
                disabled={smsPreviewLoading || (smsPreview?.mobile_ready === 0)}
                onClick={() => {
                  setShowSmsConfirm(false)
                  handleStartSms(smsConfirmDay, smsConfirmSelectedIds)
                }}
              >
                {smsPreview ? `Send to ${smsPreview.mobile_ready.toLocaleString()} Numbers` : `Start Day ${smsConfirmDay}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Single-record text confirm modal */}
      {singleTextProp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(26,10,46,0.55)' }}
          onClick={() => { if (!singleTextSending) setSingleTextProp(null) }}>
          <div className="bg-white rounded-2xl p-6 shadow-xl" style={{ maxWidth: '420px', width: '100%' }}
            onClick={e => e.stopPropagation()}>
            <h2 className="section-heading mb-3">Send Text Message</h2>
            <div style={{ background: '#F7F3FC', borderRadius: 8, padding: '12px 14px', marginBottom: 16 }}>
              <p style={{ fontSize: 13, color: '#1A0A2E', margin: 0 }}>
                <strong>{singleTextProp.owner_first_name || singleTextProp.owner_full_name || 'Owner'}</strong>
              </p>
              <p style={{ fontSize: 12, color: '#6B5B8A', margin: '3px 0 0' }}>{singleTextProp.phone_1}</p>
              {singleTextProp.property_address && (
                <p style={{ fontSize: 11, color: '#9B8AAE', margin: '3px 0 0' }}>{singleTextProp.property_address}</p>
              )}
            </div>
            <p style={{ fontSize: 12, color: '#6B5B8A', marginBottom: 20 }}>
              Sends the Day 1 introduction message via Telnyx.
            </p>
            {singleTextResult && (
              <p style={{ fontSize: 12, fontWeight: 600, color: singleTextResult.startsWith('Text sent') ? '#059669' : '#DC2626', marginBottom: 12 }}>
                {singleTextResult}
              </p>
            )}
            <div className="flex gap-3">
              <button className="btn-secondary flex-1" onClick={() => setSingleTextProp(null)} disabled={singleTextSending}>
                Cancel
              </button>
              <button
                className="flex-1 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60"
                style={{ background: singleTextSending ? '#9B8AAE' : '#1B5E20' }}
                onClick={() => handleSingleText(singleTextProp)}
                disabled={singleTextSending}
              >
                {singleTextSending ? 'Sending…' : 'Send Text'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
