import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

import type {
  ControlRoomEmployeeState,
  ControlRoomLocationState,
  ControlRoomRiskStatus,
} from '../../types/api'
import {
  controlRoomLocationLabel,
  controlRoomRiskLabel,
  formatDateTime,
  formatRelative,
} from './utils'

type OverviewMarkerPoint = {
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

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

function markerIcon(point: OverviewMarkerPoint, selected: boolean): L.DivIcon {
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
    popupAnchor: [0, -14],
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

function popupHtml(point: OverviewMarkerPoint): string {
  return [
    '<div class="cr-map-popup">',
    `<strong>${escapeHtml(point.employeeName)}</strong>`,
    `<p>${escapeHtml(point.departmentName ?? 'Departman yok')} / ${escapeHtml(point.label)}</p>`,
    '<div class="cr-map-popup__meta">',
    `<span>${escapeHtml(controlRoomLocationLabel(point.locationState))}</span>`,
    `<span>${escapeHtml(controlRoomRiskLabel(point.riskStatus))}</span>`,
    `<span>${escapeHtml(formatRelative(point.tsUtc))}</span>`,
    '</div>',
    `<div class="cr-map-popup__time">${escapeHtml(formatDateTime(point.tsUtc))}</div>`,
    '<div class="cr-map-popup__actions">',
    `<button type="button" data-cr-map-action="focus" data-employee-id="${point.employeeId}">Rota odagi</button>`,
    `<button type="button" data-cr-map-action="detail" data-employee-id="${point.employeeId}">Dosya</button>`,
    '</div>',
    '</div>',
  ].join('')
}

export function ControlRoomOverviewMap({
  points,
  selectedEmployeeId,
  onSelectEmployee,
  onOpenEmployeeDetail,
}: {
  points: OverviewMarkerPoint[]
  selectedEmployeeId: number | null
  onSelectEmployee: (employeeId: number) => void
  onOpenEmployeeDetail: (employeeId: number) => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)
  const renderedMarkersRef = useRef<Map<number, L.Marker>>(new Map())
  const hasInitialFitRef = useRef(false)
  const invalidateTimerRef = useRef<number | null>(null)
  const selectRef = useRef(onSelectEmployee)
  const detailRef = useRef(onOpenEmployeeDetail)
  const [viewportVersion, setViewportVersion] = useState(0)

  useEffect(() => {
    selectRef.current = onSelectEmployee
    detailRef.current = onOpenEmployeeDetail
  }, [onOpenEmployeeDetail, onSelectEmployee])

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
    const handlePopupOpen = (event: L.PopupEvent) => {
      const popupElement = event.popup.getElement()
      if (!popupElement) return
      const handleClick = (nativeEvent: Event) => {
        const target = nativeEvent.target as HTMLElement | null
        const actionButton = target?.closest<HTMLElement>('[data-cr-map-action]')
        if (!actionButton) return
        nativeEvent.preventDefault()
        nativeEvent.stopPropagation()

        const employeeId = Number(actionButton.dataset.employeeId)
        if (!Number.isFinite(employeeId)) return
        if (actionButton.dataset.crMapAction === 'detail') {
          detailRef.current(employeeId)
          return
        }
        selectRef.current(employeeId)
      }

      popupElement.addEventListener('click', handleClick)
    }

    map.on('moveend zoomend', handleViewportChange)
    map.on('popupopen', handlePopupOpen)

    mapRef.current = map
    layerRef.current = L.layerGroup().addTo(map)
    setViewportVersion((current) => current + 1)

    return () => {
      if (invalidateTimerRef.current != null) {
        window.clearTimeout(invalidateTimerRef.current)
      }
      map.off('moveend zoomend', handleViewportChange)
      map.off('popupopen', handlePopupOpen)
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

    const groups = new Map<string, OverviewMarkerPoint[]>()
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
          .bindPopup(popupHtml(item.point), {
            className: 'cr-map-popup-shell',
            closeButton: false,
            autoPanPadding: [24, 24],
          })
          .addTo(layer)

        renderedMarkersRef.current.set(item.point.employeeId, marker)
        bounds.extend([item.point.lat, item.point.lon])
        return
      }

      const clusterMarker = L.marker([item.centerLat, item.centerLon], {
        icon: clusterIcon(item.count, item.hasCritical),
      })
        .bindPopup(
          `<div class="cr-map-popup"><strong>${item.count} personel</strong><p>Yogun saha kumesi</p></div>`,
          {
            className: 'cr-map-popup-shell',
            closeButton: false,
            autoPanPadding: [24, 24],
          },
        )
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
    marker.openPopup()
  }, [selectedEmployeeId])

  return (
    <div className="cr-map-panel">
      <div className="cr-map-panel__hud">
        <div className="cr-map-panel__hud-row">
          <span className="cr-map-panel__badge is-live">LIVE OVERVIEW</span>
          <span className="cr-map-panel__badge">Route polyline yok</span>
        </div>
        <div className="cr-map-panel__legend">
          <span>
            <i className="cr-map-panel__legend-dot is-live" />
            Konum durumu
          </span>
          <span>
            <i className="cr-map-panel__legend-dot is-critical" />
            Risk cekirdegi
          </span>
        </div>
      </div>
      <div ref={containerRef} className="cr-map-panel__canvas" aria-label="Calisan overview haritasi" />
    </div>
  )
}
