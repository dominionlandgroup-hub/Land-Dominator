import React, { useEffect, useRef, useState } from 'react'
import LoadingSpinner from './LoadingSpinner'
import type { CompLocation } from '../types'

// Color scheme: green = top 10, yellow = good, red = avoid
const TOP_COLOR = '#2D7A4F'
const GOOD_COLOR = '#D5A940'
const AVOID_COLOR = '#dc2626'

interface Props {
  comps: CompLocation[]
  availableZips: string[]
  visibleZips: string[]          // empty = show all
  onZipToggle: (zip: string) => void
  topZips?: string[]             // green markers (top 10 by sales)
  avoidZips?: string[]           // red markers (outliers / thin data)
}

export default function CompMap({ comps, availableZips, visibleZips, onZipToggle, topZips = [], avoidZips = [] }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const layerGroupsRef = useRef<Record<string, any>>({})
  const heatLayerRef = useRef<any>(null)
  const [showHeatmap, setShowHeatmap] = useState(false)

  const safeComps = Array.isArray(comps) ? comps : []
  const safeAvailableZips = Array.isArray(availableZips) ? availableZips : []
  const safeVisibleZips = Array.isArray(visibleZips) ? visibleZips : []
  const topSet = new Set(topZips)
  const avoidSet = new Set(avoidZips)

  const effectiveVisibleZips = safeVisibleZips.length === 0 ? safeAvailableZips : safeVisibleZips

  function markerColor(zip: string): string {
    if (topSet.size > 0 || avoidSet.size > 0) {
      if (topSet.has(zip)) return TOP_COLOR
      if (avoidSet.has(zip)) return AVOID_COLOR
      return GOOD_COLOR
    }
    // fallback: no category info — use gold
    return '#D5A940'
  }

  // Initialize map once
  useEffect(() => {
    const L = (window as any).L
    if (!containerRef.current || mapRef.current || !L) return
    const map = L.map(containerRef.current, { zoomControl: true, attributionControl: true })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map)
    map.setView([34.0, -78.0], 10)
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [])

  // Update markers
  useEffect(() => {
    const L = (window as any).L
    if (!mapRef.current || !L || safeComps.length === 0) return

    Object.values(layerGroupsRef.current).forEach((lg: any) => lg.remove())
    layerGroupsRef.current = {}
    const allBounds: [number, number][] = []

    effectiveVisibleZips.forEach((zip) => {
      const zipComps = safeComps.filter(c => c.zip === zip)
      if (zipComps.length === 0) return
      const color = markerColor(zip)

      const group = L.markerClusterGroup
        ? L.markerClusterGroup({
            maxClusterRadius: 40,
            iconCreateFunction: (_cluster: any) =>
              L.divIcon({
                html: `<div style="background:${color}cc;border:2px solid ${color};border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;box-shadow:0 2px 8px ${color}66">${_cluster.getChildCount()}</div>`,
                className: '',
                iconSize: [32, 32],
              }),
            spiderfyOnMaxZoom: true,
            showCoverageOnHover: false,
            zoomToBoundsOnClick: true,
          })
        : L.layerGroup()

      zipComps.filter(c => c.lat && c.lng).forEach((c) => {
        const radius = Math.max(3, Math.min(8, c.sale_price / 150000))
        const marker = L.circleMarker([c.lat, c.lng], {
          radius,
          color,
          fillColor: color,
          fillOpacity: topSet.has(zip) ? 0.65 : avoidSet.has(zip) ? 0.35 : 0.5,
          weight: 0.5,
        })
        marker.bindPopup(
          `<div style="font-family:Montserrat,sans-serif;font-size:12px;min-width:180px">
            <div style="font-weight:600;color:#D5A940;margin-bottom:6px">ZIP ${c.zip}</div>
            ${c.apn ? `<div><span style="color:#6B5B8A">APN:</span> ${c.apn}</div>` : ''}
            <div><span style="color:#6B5B8A">Sale Price:</span> <strong>${new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}).format(c.sale_price)}</strong></div>
            <div><span style="color:#6B5B8A">Lot Size:</span> ${c.lot_acres.toFixed(2)} acres</div>
            <div><span style="color:#6B5B8A">Price/Acre:</span> ${new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}).format(c.price_per_acre)}</div>
            ${c.sale_date ? `<div><span style="color:#6B5B8A">Sale Date:</span> ${c.sale_date}</div>` : ''}
          </div>`,
          { maxWidth: 220 }
        )
        group.addLayer(marker)
        allBounds.push([c.lat, c.lng])
      })

      if (allBounds.length > 0) {
        layerGroupsRef.current[zip] = group
        group.addTo(mapRef.current)
      }
    })

    if (allBounds.length > 0) {
      try { mapRef.current.fitBounds((window as any).L.latLngBounds(allBounds), { padding: [40, 40] }) }
      catch (_) { /* ignore */ }
    } else {
      mapRef.current.setView([34.0, -78.2], 11)
    }
  }, [safeComps, effectiveVisibleZips.join(','), topZips.join(','), avoidZips.join(',')])

  // Heatmap
  useEffect(() => {
    const L = (window as any).L
    if (!mapRef.current || !L || safeComps.length === 0) return
    if (heatLayerRef.current) { heatLayerRef.current.remove(); heatLayerRef.current = null }
    if (showHeatmap && L.heatLayer) {
      const points = safeComps.filter(c => effectiveVisibleZips.includes(c.zip)).map(c => [c.lat, c.lng, c.sale_price / 500000] as [number, number, number])
      heatLayerRef.current = L.heatLayer(points, { radius: 20, blur: 15, maxZoom: 17, max: 1.0, gradient: { 0.4: '#5C2977', 0.65: '#8B4DB8', 1: '#D5A940' } }).addTo(mapRef.current)
    }
  }, [showHeatmap, safeComps, effectiveVisibleZips.join(',')])

  const withCoords = safeComps.filter(c => effectiveVisibleZips.includes(c.zip)).length
  const leafletReady = Boolean((window as any).L)

  return (
    <div className="relative">
      {/* Controls */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-4">
          <span className="text-xs" style={{ color: '#6B5B8A' }}>
            {withCoords.toLocaleString()} comp locations
            {safeComps.length >= 7999 && <span style={{ color: '#f59e0b' }}> (sample of 8,000)</span>}
          </span>
          {/* Simple 3-item legend */}
          {(topSet.size > 0 || avoidSet.size > 0) && (
            <div className="flex items-center gap-3 text-xs" style={{ color: '#6B5B8A' }}>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: TOP_COLOR, display: 'inline-block' }} />Top 10 ZIPs</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: GOOD_COLOR, display: 'inline-block' }} />Good ZIPs</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: AVOID_COLOR, display: 'inline-block' }} />Avoid</span>
            </div>
          )}
        </div>
        <button
          className={`btn-secondary text-xs`}
          onClick={() => setShowHeatmap(v => !v)}
          style={showHeatmap ? { borderColor: '#8b5cf6', color: '#a78bfa' } : {}}
        >
          {showHeatmap ? 'Hide Heatmap' : 'Show Heatmap'}
        </button>
      </div>

      <div style={{ position: 'relative' }}>
        <div
          ref={containerRef}
          style={{ width: '100%', height: 500, borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(213,169,64,0.15)' }}
        />
      </div>

      {!leafletReady && (
        <div className="flex items-center justify-center" style={{ marginTop: -500, height: 500, pointerEvents: 'none' }}>
          <p style={{ color: '#6B5B8A', fontSize: 14 }}>Map library failed to load. Refresh the page to retry.</p>
        </div>
      )}

      {safeComps.length === 0 && leafletReady && (
        <div className="flex items-center justify-center" style={{ marginTop: -500, height: 500, pointerEvents: 'none' }}>
          <p style={{ color: '#6B5B8A', fontSize: 14 }}>No comp locations available (CSV may be missing Latitude/Longitude columns)</p>
        </div>
      )}
    </div>
  )
}
