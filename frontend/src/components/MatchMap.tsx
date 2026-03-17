import React, { useEffect, useRef, useState, useCallback } from 'react'
import type { MatchedParcel, CompLocation } from '../types'
import { getConfidence } from '../types'

const SCORE_COLORS: Record<number, string> = {
  5: '#2D7A4F',
  4: '#06b6d4',
  3: '#f59e0b',
  2: '#f97316',
  1: '#ef4444',
  0: '#6B5B8A',
}

interface Props {
  targets: MatchedParcel[]
  comps?: CompLocation[]
  radiusMiles?: number
  onSelectionChange?: (selected: MatchedParcel[]) => void
}

export default function MatchMap({ targets, comps = [], radiusMiles = 10, onSelectionChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const scoreLayersRef = useRef<Record<number, any>>({})
  const compLayerRef = useRef<any>(null)
  const radiusCircleRef = useRef<any>(null)
  const drawLayerRef = useRef<any>(null)
  const drawControlRef = useRef<any>(null)

  const [selectMode, setSelectMode] = useState(false)
  const [selectedParcels, setSelectedParcels] = useState<MatchedParcel[]>([])
  const [showComps, setShowComps] = useState(true)
  const [showRadius, setShowRadius] = useState(true)
  const [visibleCount, setVisibleCount] = useState(0)
  const [avgOffer, setAvgOffer] = useState<number | null>(null)
  const [highestScore, setHighestScore] = useState<number>(0)
  const [activeScores, setActiveScores] = useState<Set<number>>(new Set([5, 4, 3, 2, 1]))

  // Initialize map
  useEffect(() => {
    const L = (window as any).L
    if (!containerRef.current || mapRef.current || !L) return

    const map = L.map(containerRef.current, { zoomControl: true })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map)
    map.setView([34.0, -78.0], 10)
    mapRef.current = map

    if (L.FeatureGroup) {
      drawLayerRef.current = new L.FeatureGroup()
      map.addLayer(drawLayerRef.current)
    }

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Render background comp dots
  useEffect(() => {
    const L = (window as any).L
    if (!mapRef.current || !L) return

    compLayerRef.current?.remove()
    compLayerRef.current = null

    if (!showComps || comps.length === 0) return

    const markers = comps.slice(0, 3000).map((c) =>
      L.circleMarker([c.lat, c.lng], {
        radius: 3,
        color: '#9B8AAE',
        fillColor: '#9B8AAE',
        fillOpacity: 0.3,
        weight: 0,
      })
    )
    compLayerRef.current = L.layerGroup(markers).addTo(mapRef.current)
  }, [comps, showComps])

  // Render target markers with clustering per score
  useEffect(() => {
    const L = (window as any).L
    if (!mapRef.current || !L || targets.length === 0) return

    // Remove old score layers
    Object.values(scoreLayersRef.current).forEach((lg: any) => lg.remove())
    scoreLayersRef.current = {}

    const withCoords = targets.filter((t) => t.latitude && t.longitude)
    setVisibleCount(withCoords.length)

    const offers = withCoords.map((t) => t.suggested_offer_mid).filter((v): v is number => v != null)
    setAvgOffer(offers.length > 0 ? offers.reduce((a, b) => a + b, 0) / offers.length : null)
    setHighestScore(withCoords.length > 0 ? Math.max(...withCoords.map((t) => t.match_score)) : 0)

    const bounds: [number, number][] = []

    // Group by score and create a cluster group per score
    ;[5, 4, 3, 2, 1].forEach((score) => {
      const scoreTargets = withCoords.filter((t) => t.match_score === score)
      if (scoreTargets.length === 0) return

      const color = SCORE_COLORS[score]
      const group = L.markerClusterGroup
        ? L.markerClusterGroup({
            maxClusterRadius: 35,
            iconCreateFunction: (_cluster: any) =>
              L.divIcon({
                html: `<div style="
                  background:${color}cc;border:2px solid ${color};
                  border-radius:50%;width:30px;height:30px;
                  display:flex;align-items:center;justify-content:center;
                  font-size:11px;font-weight:700;color:#fff;
                  box-shadow:0 2px 8px ${color}66;
                ">${_cluster.getChildCount()}</div>`,
                className: '',
                iconSize: [30, 30],
              }),
            spiderfyOnMaxZoom: true,
            showCoverageOnHover: false,
          })
        : L.layerGroup()

      scoreTargets.forEach((t) => {
        const conf = getConfidence(t.matched_comp_count)
        const m = L.circleMarker([t.latitude!, t.longitude!], {
          radius: 7,
          color,
          fillColor: color,
          fillOpacity: 0.85,
          weight: 1.5,
        })
        m.bindPopup(
          `<div style="font-family:Montserrat,sans-serif;font-size:12px;min-width:190px">
            <div style="font-weight:700;margin-bottom:6px;color:${color}">${t.owner_name || 'Unknown Owner'}</div>
            <div><span style="color:#6B5B8A">APN:</span> <span style="font-family:monospace">${t.apn}</span></div>
            <div><span style="color:#6B5B8A">Acres:</span> ${t.lot_acres?.toFixed(2) ?? '—'}</div>
            <div><span style="color:#6B5B8A">Score:</span> <strong style="color:${color}">${t.match_score}/5</strong></div>
            <div><span style="color:#6B5B8A">Confidence:</span> <strong>${conf}</strong> (${t.matched_comp_count} comps)</div>
            ${t.suggested_offer_mid != null ? `<div><span style="color:#6B5B8A">Offer Mid:</span> <strong style="color:#2D7A4F">$${Math.round(t.suggested_offer_mid).toLocaleString()}</strong></div>` : ''}
          </div>`,
          { maxWidth: 240 }
        )
        group.addLayer(m)
        bounds.push([t.latitude!, t.longitude!])
      })

      scoreLayersRef.current[score] = group
      if (activeScores.has(score)) {
        group.addTo(mapRef.current)
      }
    })

    if (bounds.length > 0) {
      try {
        mapRef.current.fitBounds(L.latLngBounds(bounds), { padding: [40, 40] })
      } catch (_) {}

      if (showRadius) {
        const source = comps.length > 0
          ? comps.map((c) => [c.lat, c.lng] as [number, number])
          : bounds
        const centLat = source.reduce((s, b) => s + b[0], 0) / source.length
        const centLon = source.reduce((s, b) => s + b[1], 0) / source.length
        radiusCircleRef.current?.remove()
        radiusCircleRef.current = L.circle([centLat, centLon], {
          radius: radiusMiles * 1609.34,
          color: '#D5A940',
          weight: 1,
          dashArray: '6 4',
          fillOpacity: 0.03,
        }).addTo(mapRef.current)
      }
    } else {
      mapRef.current.setView([34.0, -78.2], 11)
    }
  }, [targets, radiusMiles, showRadius])

  // Toggle score layer visibility
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    ;[5, 4, 3, 2, 1].forEach((score) => {
      const layer = scoreLayersRef.current[score]
      if (!layer) return
      if (activeScores.has(score)) {
        if (!map.hasLayer(layer)) layer.addTo(map)
      } else {
        if (map.hasLayer(layer)) map.removeLayer(layer)
      }
    })
    // Update visible count
    const showing = targets.filter(
      (t) => t.latitude && t.longitude && activeScores.has(t.match_score)
    ).length
    setVisibleCount(showing)
  }, [activeScores])

  // Toggle radius circle
  useEffect(() => {
    if (!mapRef.current) return
    if (!showRadius) {
      radiusCircleRef.current?.remove()
      radiusCircleRef.current = null
    }
  }, [showRadius])

  // Rectangle selection mode
  useEffect(() => {
    const L = (window as any).L
    const map = mapRef.current
    if (!map || !L) return

    function clearDrawControl() {
      if (drawControlRef.current) {
        map.removeControl(drawControlRef.current)
        drawControlRef.current = null
      }
    }

    function onCreated(e: any) {
      if (drawLayerRef.current) {
        drawLayerRef.current.clearLayers()
        drawLayerRef.current.addLayer(e.layer)
      }
      const bounds = e.layer.getBounds()
      const selected = targets.filter(
        (t) => t.latitude && t.longitude && bounds.contains([t.latitude, t.longitude])
      )
      setSelectedParcels(selected)
      onSelectionChange?.(selected)
      setSelectMode(false)
    }

    clearDrawControl()

    if (selectMode && L.Control?.Draw && drawLayerRef.current) {
      drawControlRef.current = new L.Control.Draw({
        draw: {
          polyline: false, polygon: false, circle: false,
          marker: false, circlemarker: false,
          rectangle: { shapeOptions: { color: '#5C2977', weight: 2, dashArray: '4 2' } },
        },
        edit: { featureGroup: drawLayerRef.current, edit: false, remove: true },
      })
      map.addControl(drawControlRef.current)
      map.getContainer().style.cursor = 'crosshair'
    } else {
      map.getContainer().style.cursor = ''
    }

    map.on('draw:created', onCreated)
    return () => {
      map.off('draw:created', onCreated)
      clearDrawControl()
    }
  }, [selectMode, targets])

  function toggleScore(s: number) {
    setActiveScores((prev) => {
      const next = new Set(prev)
      if (next.has(s)) { next.delete(s) } else { next.add(s) }
      return next
    })
  }

  function downloadSelected() {
    if (selectedParcels.length === 0) return
    const headers = ['APN', 'Owner Name', 'Mail Address', 'City', 'State', 'ZIP', 'Acres', 'Score', 'Acreage Band', 'Confidence', 'Comp Count', 'Retail Estimate', 'Offer Low', 'Offer Mid', 'Offer High', 'Median Comp Sale Price', 'Median PPA', 'Min Comp Price', 'Max Comp Price', 'Outliers Removed', 'TLP Estimate', 'TLP Capped']
    const rows = selectedParcels.map((p) => [
      p.apn, p.owner_name, p.mail_address, p.mail_city, p.mail_state, p.mail_zip,
      p.lot_acres ?? '', p.match_score, p.acreage_band ?? '', p.confidence || getConfidence(p.matched_comp_count),
      p.matched_comp_count, p.retail_estimate ?? '',
      p.suggested_offer_low ?? '', p.suggested_offer_mid ?? '', p.suggested_offer_high ?? '',
      p.median_comp_sale_price ?? '', p.median_ppa ?? '', p.min_comp_price ?? '', p.max_comp_price ?? '',
      p.outliers_removed ?? 0, p.tlp_estimate ?? '', p.tlp_capped ? 'Yes' : 'No',
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
    const csv = [headers.join(','), ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `map-selected-${selectedParcels.length}-parcels.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      {/* Score filter toggles */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="text-xs" style={{ color: '#6B5B8A' }}>Filter by score:</span>
        {[5, 4, 3, 2, 1].map((s) => {
          const color = SCORE_COLORS[s]
          const active = activeScores.has(s)
          const cnt = targets.filter((t) => t.match_score === s && t.latitude && t.longitude).length
          if (cnt === 0) return null
          return (
            <button
              key={s}
              onClick={() => toggleScore(s)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                border: `1px solid ${active ? color : 'rgba(255,255,255,0.1)'}`,
                background: active ? `${color}22` : 'transparent',
                color: active ? color : '#6B5B8A',
                cursor: 'pointer', transition: 'all 0.15s ease',
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: active ? color : '#555', display: 'inline-block' }} />
              {s} · {cnt}
            </button>
          )
        })}
        <div className="ml-auto flex items-center gap-2">
          <button className={`btn-secondary text-xs ${showComps ? '' : 'opacity-50'}`} onClick={() => setShowComps((v) => !v)}>
            {showComps ? 'Hide' : 'Show'} Comps
          </button>
          <button className={`btn-secondary text-xs ${showRadius ? '' : 'opacity-50'}`} onClick={() => setShowRadius((v) => !v)}>
            {showRadius ? 'Hide' : 'Show'} Radius
          </button>
          <button
            className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-all ${selectMode ? 'text-white' : 'btn-secondary'}`}
            style={selectMode ? { background: '#5C2977', border: '1px solid #3D1A55', color: 'white' } : {}}
            onClick={() => { setSelectMode((v) => !v); if (selectMode) setSelectedParcels([]) }}
          >
            {selectMode ? 'Cancel Draw' : 'Draw Rectangle'}
          </button>
          {selectedParcels.length > 0 && (
            <button className="btn-primary text-xs" onClick={downloadSelected}>
              Download ({selectedParcels.length})
            </button>
          )}
        </div>
      </div>

      {/* Map */}
      <div
        ref={containerRef}
        style={{ width: '100%', height: 520, borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)' }}
      />

      {/* Mini stats bar */}
      <div className="flex items-center gap-6 mt-3 px-4 py-2.5 rounded-lg" style={{ background: '#F0EBF8', border: '1px solid #E8E0F0' }}>
        <div>
          <span className="text-xs" style={{ color: '#6B5B8A' }}>Parcels shown: </span>
          <span className="text-sm font-bold" style={{ color: '#D5A940' }}>{visibleCount.toLocaleString()}</span>
        </div>
        {avgOffer != null && (
          <div>
            <span className="text-xs" style={{ color: '#6B5B8A' }}>Avg offer: </span>
            <span className="text-sm font-bold" style={{ color: '#2D7A4F' }}>${Math.round(avgOffer).toLocaleString()}</span>
          </div>
        )}
        {highestScore > 0 && (
          <div>
            <span className="text-xs" style={{ color: '#6B5B8A' }}>Highest score: </span>
            <span className="text-sm font-bold" style={{ color: SCORE_COLORS[highestScore] }}>{highestScore}/5</span>
          </div>
        )}
        {selectedParcels.length > 0 && (
          <div>
            <span className="text-xs" style={{ color: '#6B5B8A' }}>Selected: </span>
            <span className="text-sm font-bold" style={{ color: '#f59e0b' }}>{selectedParcels.length}</span>
          </div>
        )}
        <div className="ml-auto">
          <div className="flex items-center gap-3">
            {[5, 4, 3, 2, 1].map((s) => (
              <div key={s} className="flex items-center gap-1">
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: SCORE_COLORS[s] }} />
                <span style={{ fontSize: 10, color: '#6B5B8A' }}>{s}</span>
              </div>
            ))}
            {comps.length > 0 && (
              <div className="flex items-center gap-1">
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#9B8AAE' }} />
                <span style={{ fontSize: 10, color: '#6B5B8A' }}>Comp</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
