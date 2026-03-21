import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

import type {
  ControlRoomEmployeeState,
  ControlRoomLocationState,
  ControlRoomRiskStatus,
} from '../../types/api'

export type ControlRoomOverviewMarkerPoint = {
  employeeId: number
  employeeName: string
  departmentName: string | null
  lat: number
  lon: number
  tsUtc: string
  label: string
  locationState: ControlRoomLocationState
  riskStatus: ControlRoomRiskStatus
  todayStatus: ControlRoomEmployeeState['today_status']
}

const clusterCellSize = (zoom: number) => {
  if (zoom >= 15) return 0
  if (zoom >= 13) return 0.012
  if (zoom >= 11) return 0.022
  if (zoom >= 9) return 0.045
  return 0.075
}

function markerIcon(point: ControlRoomOverviewMarkerPoint, selected: boolean): L.DivIcon {
  const classes = [
    'cr-map-marker',
    `is-location-${point.locationState.toLowerCase()}`,
    `is-risk-${point.riskStatus.toLowerCase()}`,
    selected ? 'is-selected' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return L.divIcon({
    className: 'cr-map-marker-shell',
    html: [
      `<div class="${classes}">`,
      '<span class="cr-map-marker__pulse" aria-hidden="true"></span>',
      '<span class="cr-map-marker__ring" aria-hidden="true"></span>',
      '<span class="cr-map-marker__core" aria-hidden="true"></span>',
      '</div>',
    ].join(''),
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  })
}

function clusterIcon(count: number, hasCritical: boolean): L.DivIcon {
  return L.divIcon({
    className: 'cr-map-cluster-shell',
    html: [
      `<div class="cr-map-cluster ${hasCritical ? 'is-critical' : ''}">`,
      `<span>${count}</span>`,
      '</div>',
    ].join(''),
    iconSize: [42, 42],
    iconAnchor: [21, 21],
  })
}

export function ControlRoomOverviewMap({
  points,
  selectedEmployeeId,
  onSelectEmployee,
}: {
  points: ControlRoomOverviewMarkerPoint[]
  selectedEmployeeId: number | null
  onSelectEmployee: (employeeId: number) => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)
  const renderedMarkersRef = useRef<Map<number, L.Marker>>(new Map())
  const hasInitialFitRef = useRef(false)
  const invalidateTimerRef = useRef<number | null>(null)
  const selectRef = useRef(onSelectEmployee)
  const [viewportVersion, setViewportVersion] = useState(0)

  useEffect(() => {
    selectRef.current = onSelectEmployee
  }, [onSelectEmployee])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = L.map(containerRef.current, {
      center: [39.0, 35.0],
      zoom: 6,
      zoomControl: true,
      attributionControl: false,
      zoomAnimation: false,
      fadeAnimation: false,
      markerZoomAnimation: false,
    })

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; OpenStreetMap katki saglayanlar',
    }).addTo(map)

    const handleViewportChange = () => setViewportVersion((current) => current + 1)
    map.on('moveend zoomend', handleViewportChange)

    mapRef.current = map
    layerRef.current = L.layerGroup().addTo(map)
    setViewportVersion((current) => current + 1)

    return () => {
      if (invalidateTimerRef.current != null) {
        window.clearTimeout(invalidateTimerRef.current)
      }
      map.off('moveend zoomend', handleViewportChange)
      map.stop()
      map.remove()
      mapRef.current = null
      layerRef.current = null
      renderedMarkersRef.current.clear()
      hasInitialFitRef.current = false
    }
  }, [])

  const clusteredPoints = useMemo(() => {
    if (!mapRef.current) {
      return points.map((point) => ({ kind: 'single' as const, point }))
    }

    const map = mapRef.current
    const zoom = map.getZoom()
    const cellSize = clusterCellSize(zoom)

    if (cellSize <= 0) {
      return points.map((point) => ({ kind: 'single' as const, point }))
    }

    const groups = new Map<string, ControlRoomOverviewMarkerPoint[]>()
    for (const point of points) {
      const key = `${Math.floor(point.lat / cellSize)}:${Math.floor(point.lon / cellSize)}`
      groups.set(key, [...(groups.get(key) ?? []), point])
    }

    return [...groups.values()].map((group) => {
      if (group.length === 1) {
        return { kind: 'single' as const, point: group[0] }
      }

      return {
        kind: 'cluster' as const,
        count: group.length,
        pointIds: group.map((item) => item.employeeId),
        centerLat: group.reduce((sum, item) => sum + item.lat, 0) / group.length,
        centerLon: group.reduce((sum, item) => sum + item.lon, 0) / group.length,
        hasCritical: group.some((item) => item.riskStatus === 'CRITICAL'),
      }
    })
  }, [points, viewportVersion])

  useEffect(() => {
    if (!mapRef.current || !layerRef.current) return

    const map = mapRef.current
    const layer = layerRef.current
    layer.clearLayers()
    renderedMarkersRef.current.clear()

    if (!points.length) {
      hasInitialFitRef.current = false
      return
    }

    const bounds = L.latLngBounds([])

    clusteredPoints.forEach((item) => {
      if (item.kind === 'single') {
        const marker = L.marker([item.point.lat, item.point.lon], {
          icon: markerIcon(item.point, selectedEmployeeId === item.point.employeeId),
        })
          .on('click', () => selectRef.current(item.point.employeeId))
          .addTo(layer)

        renderedMarkersRef.current.set(item.point.employeeId, marker)
        bounds.extend([item.point.lat, item.point.lon])
        return
      }

      const clusterMarker = L.marker([item.centerLat, item.centerLon], {
        icon: clusterIcon(item.count, item.hasCritical),
      })
        .on('click', () => {
          map.setView([item.centerLat, item.centerLon], Math.min(map.getZoom() + 2, 15), {
            animate: false,
          })
        })
        .addTo(layer)

      item.pointIds.forEach((employeeId) => renderedMarkersRef.current.set(employeeId, clusterMarker))
      bounds.extend([item.centerLat, item.centerLon])
    })

    if (!hasInitialFitRef.current && bounds.isValid()) {
      if (points.length === 1) {
        const firstPoint = points[0]
        map.setView([firstPoint.lat, firstPoint.lon], 13, { animate: false })
      } else {
        map.fitBounds(bounds, { padding: [28, 28], maxZoom: 11, animate: false })
      }
      hasInitialFitRef.current = true
    }

    if (invalidateTimerRef.current != null) {
      window.clearTimeout(invalidateTimerRef.current)
    }

    invalidateTimerRef.current = window.setTimeout(() => {
      map.invalidateSize(false)
      invalidateTimerRef.current = null
    }, 90)
  }, [clusteredPoints, points, selectedEmployeeId])

  useEffect(() => {
    if (!selectedEmployeeId || !mapRef.current) return

    const marker = renderedMarkersRef.current.get(selectedEmployeeId)
    if (!marker) return

    mapRef.current.setView(marker.getLatLng(), Math.max(mapRef.current.getZoom(), 12), { animate: false })
  }, [selectedEmployeeId])

  return (
    <div className="cr-map-panel">
      <div className="cr-map-panel__hud">
        <div className="cr-map-panel__hud-row">
          <span className="cr-map-panel__badge is-live">FLEET</span>
          <span className="cr-map-panel__badge">Marker secimi aktif</span>
        </div>
        <div className="cr-map-panel__legend">
          <span>
            <i className="cr-map-panel__legend-dot is-live" />
            Dis ring: konum durumu
          </span>
          <span>
            <i className="cr-map-panel__legend-dot is-critical" />
            Ic core: risk seviyesi
          </span>
        </div>
      </div>
      <div ref={containerRef} className="cr-map-panel__canvas" aria-label="Calisan fleet haritasi" />
    </div>
  )
}
