import React, { useEffect, useRef, useState } from 'react'
import LoadingSpinner from './LoadingSpinner'
import type { CompLocation } from '../types'

const CHART_COLORS = [
  '#3b82f6','#6366f1','#8b5cf6','#a855f7','#ec4899',
  '#f59e0b','#10b981','#06b6d4','#f97316','#14b8a6',
  '#84cc16','#e879f9','#ef4444','#0ea5e9','#d946ef',
]

interface Props {
  comps: CompLocation[]
  availableZips: string[]
  visibleZips: string[]          // empty = show all
  onZipToggle: (zip: string) => void
}

export default function CompMap({ comps, availableZips, visibleZips, onZipToggle }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const layerGroupsRef = useRef<Record<string, any>>({})
  const heatLayerRef = useRef<any>(null)

  const [loading] = useState(false)
  const [showHeatmap, setShowHeatmap] = useState(false)

  const safeComps = Array.isArray(comps) ? comps : []
  const safeAvailableZips = Array.isArray(availableZips) ? availableZips : []
  const safeVisibleZips = Array.isArray(visibleZips) ? visibleZips : []

  // Build ZIP → color map
  const zipColorMap: Record<string, string> = {}
  safeAvailableZips.forEach((zip, i) => {
    zipColorMap[zip] = CHART_COLORS[i % CHART_COLORS.length]
  })

  const effectiveVisibleZips = safeVisibleZips.length === 0 ? safeAvailableZips : safeVisibleZips

  // Initialize map (once)
  useEffect(() => {
    const L = (window as any).L
    if (!containerRef.current || mapRef.current || !L) return

    const map = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: true,
    })

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map)

    // Default view — will be overridden when markers load
    map.setView([34.0, -78.0], 10)
    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Update markers when comps or visible ZIPs change
  useEffect(() => {
    const L = (window as any).L
    if (!mapRef.current || !L || safeComps.length === 0) return

    // Clear old layer groups
    Object.values(layerGroupsRef.current).forEach((lg: any) => lg.remove())
    layerGroupsRef.current = {}

    const allBounds: [number, number][] = []

    console.log(`[CompMap] Received ${safeComps.length} comp locations`)

    effectiveVisibleZips.forEach((zip) => {
      const zipComps = safeComps.filter((c) => c.zip === zip)
      if (zipComps.length === 0) return

      const color = zipColorMap[zip] || '#C9A84C'

      // Use markerClusterGroup if available, else fall back to layerGroup
      const group = L.markerClusterGroup
        ? L.markerClusterGroup({
            maxClusterRadius: 40,
            iconCreateFunction: (_cluster: any) =>
              L.divIcon({
                html: `<div style="
                  background:${color}cc;
                  border:2px solid ${color};
                  border-radius:50%;
                  width:32px;height:32px;
                  display:flex;align-items:center;justify-content:center;
                  font-size:11px;font-weight:700;color:#fff;
                  box-shadow:0 2px 8px ${color}66;
                ">${_cluster.getChildCount()}</div>`,
                className: '',
                iconSize: [32, 32],
              }),
            spiderfyOnMaxZoom: true,
            showCoverageOnHover: false,
            zoomToBoundsOnClick: true,
          })
        : L.layerGroup()

      zipComps
        .filter((c) => c.lat && c.lng)
        .forEach((c) => {
          const radius = Math.max(3, Math.min(8, c.sale_price / 150000))
          const marker = L.circleMarker([c.lat, c.lng], {
            radius,
            color,
            fillColor: color,
            fillOpacity: 0.55,
            weight: 0.5,
          })
          marker.bindPopup(
            `<div style="font-family:Inter,sans-serif;font-size:12px;min-width:180px">
              <div style="font-weight:600;color:#C9A84C;margin-bottom:6px">ZIP ${c.zip}</div>
              ${c.apn ? `<div><span style="color:#8A8070">APN:</span> ${c.apn}</div>` : ''}
              <div><span style="color:#8A8070">Sale Price:</span> <strong>$${Math.round(c.sale_price).toLocaleString()}</strong></div>
              <div><span style="color:#8A8070">Lot Size:</span> ${c.lot_acres.toFixed(2)} acres</div>
              <div><span style="color:#8A8070">Price/Acre:</span> $${Math.round(c.price_per_acre).toLocaleString()}</div>
              ${c.sale_date ? `<div><span style="color:#8A8070">Sale Date:</span> ${c.sale_date}</div>` : ''}
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
      try {
        mapRef.current.fitBounds(L.latLngBounds(allBounds), { padding: [40, 40] })
      } catch (_) { /* ignore invalid bounds */ }
    } else {
      mapRef.current.setView([34.0, -78.2], 11)
    }
  }, [safeComps, effectiveVisibleZips.join(',')])

  // Heatmap toggle
  useEffect(() => {
    const L = (window as any).L
    if (!mapRef.current || !L || safeComps.length === 0) return

    if (heatLayerRef.current) {
      heatLayerRef.current.remove()
      heatLayerRef.current = null
    }

    if (showHeatmap && L.heatLayer) {
      const points = safeComps
        .filter((c) => effectiveVisibleZips.includes(c.zip))
        .map((c) => [c.lat, c.lng, c.sale_price / 500000] as [number, number, number])
      heatLayerRef.current = L.heatLayer(points, {
        radius: 20,
        blur: 15,
        maxZoom: 17,
        max: 1.0,
        gradient: { 0.4: '#3b82f6', 0.65: '#8b5cf6', 1: '#f59e0b' },
      }).addTo(mapRef.current)
    }
  }, [showHeatmap, safeComps, effectiveVisibleZips.join(',')])

  if (loading) {
    return (
      <div className="flex items-center justify-center" style={{ height: 500, background: '#0d1421', borderRadius: 12 }}>
        <LoadingSpinner size="lg" label="Loading comp locations…" />
      </div>
    )
  }

  const withCoords = safeComps.filter((c) => effectiveVisibleZips.includes(c.zip)).length
  const leafletReady = Boolean((window as any).L)

  return (
    <div className="relative">
      {/* Map controls */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs" style={{ color: '#8A8070' }}>
            {withCoords.toLocaleString()} comp locations shown
          </span>
          {safeComps.length > 0 && safeComps.length >= 7999 && (
            <span className="text-xs" style={{ color: '#f59e0b' }}>
              (sample of 8,000 — full dataset larger)
            </span>
          )}
        </div>
        <button
          className={`btn-secondary text-xs ${showHeatmap ? 'border-purple-500 text-purple-400' : ''}`}
          onClick={() => setShowHeatmap((v) => !v)}
          style={showHeatmap ? { borderColor: '#8b5cf6', color: '#a78bfa' } : {}}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z"/>
            <path d="M8.56 2.75c4.37 6.03 6.02 9.42 8.03 17.72m2.54-15.38c-3.72 4.35-8.94 5.66-16.88 5.85m19.5 1.9c-3.5-.93-6.63-.82-8.94 0-2.58.92-5.01 2.86-7.44 6.32"/>
          </svg>
          {showHeatmap ? 'Hide Heatmap' : 'Show Heatmap'}
        </button>
      </div>

      <div style={{ position: 'relative' }}>
        {/* Map container */}
        <div
          ref={containerRef}
          style={{ width: '100%', height: 500, borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(201,168,76,0.15)' }}
        />

        {/* Legend */}
        {safeAvailableZips.length > 0 && (
          <div
            style={{
              position: 'absolute', top: 10, right: 10, zIndex: 1000,
              background: 'rgba(13,20,33,0.9)', border: '1px solid rgba(201,168,76,0.2)',
              borderRadius: 8, padding: '8px 12px', maxHeight: 220, overflowY: 'auto',
              backdropFilter: 'blur(10px)',
            }}
          >
            <p style={{ color: '#8A8070', fontSize: 10, fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>ZIP Legend</p>
            {safeAvailableZips.map((zip) => (
              <div
                key={zip}
                className="flex items-center gap-1.5 cursor-pointer py-0.5"
                style={{ opacity: effectiveVisibleZips.includes(zip) ? 1 : 0.35 }}
                onClick={() => onZipToggle(zip)}
              >
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: zipColorMap[zip] || '#C9A84C', flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: '#F5F0E8' }}>{zip}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {!leafletReady && (
        <div
          className="flex items-center justify-center"
          style={{ marginTop: -500, height: 500, pointerEvents: 'none' }}
        >
          <p style={{ color: '#8A8070', fontSize: 14 }}>Map library failed to load. Refresh the page to retry.</p>
        </div>
      )}

      {safeComps.length === 0 && !loading && leafletReady && (
        <div
          className="flex items-center justify-center"
          style={{ marginTop: -500, height: 500, pointerEvents: 'none' }}
        >
          <p style={{ color: '#8A8070', fontSize: 14 }}>No comp locations available (CSV may be missing Latitude/Longitude columns)</p>
        </div>
      )}
    </div>
  )
}
