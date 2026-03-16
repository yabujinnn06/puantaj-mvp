import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import type { GeoJSONSource, Map as MapLibreMap, MapGeoJSONFeature } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

import type { LocationMonitorMapPoint } from '../../types/api'

const DEFAULT_CENTER: [number, number] = [28.97953, 41.015137]
const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'
const ROUTE_SOURCE_ID = 'location-monitor-route-source'
const POINT_SOURCE_ID = 'location-monitor-point-source'
const ROUTE_SHADOW_LAYER_ID = 'location-monitor-route-shadow-layer'
const ROUTE_LAYER_ID = 'location-monitor-route-layer'
const ROUTE_DIRECTION_LAYER_ID = 'location-monitor-route-direction-layer'
const POINT_LAYER_ID = 'location-monitor-point-layer'
const POINT_RING_LAYER_ID = 'location-monitor-point-ring-layer'
const POINT_TIME_LAYER_ID = 'location-monitor-point-time-layer'
const DENSE_POINT_RADIUS_M = 18
const NEAR_POINT_RADIUS_M = 42
const LOCAL_DATE_TIME_FORMAT = new Intl.DateTimeFormat('tr-TR', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Europe/Istanbul',
})
const LOCAL_CLOCK_FORMAT = new Intl.DateTimeFormat('tr-TR', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Istanbul',
})
const DISTANCE_FORMAT = new Intl.NumberFormat('tr-TR', {
  maximumFractionDigits: 1,
})

type PointVisibilityGroup = 'SHIFT' | 'APP' | 'DEMO' | 'TRACK'

type PointMetric = {
  pointId: string
  stepIndex: number
  totalSteps: number
  timestampLabel: string
  clockLabel: string
  sincePreviousMeters: number | null
  sincePreviousMs: number | null
  sincePreviousDistanceLabel: string
  sincePreviousGapLabel: string
  cumulativeDistanceMeters: number
  cumulativeDistanceLabel: string
}

type PointMetricsResult = {
  byId: Map<string, PointMetric>
  totalDistanceMeters: number
  totalDurationMs: number
}

type VisibilityOption = {
  key: PointVisibilityGroup
  label: string
}

const VISIBILITY_OPTIONS: VisibilityOption[] = [
  { key: 'SHIFT', label: 'Mesai' },
  { key: 'APP', label: 'Uygulama' },
  { key: 'DEMO', label: 'Demo' },
  { key: 'TRACK', label: 'Son konum' },
]

const DEFAULT_VISIBILITY: Record<PointVisibilityGroup, boolean> = {
  SHIFT: true,
  APP: true,
  DEMO: true,
  TRACK: true,
}

function isMapRenderingSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.WebGLRenderingContext !== 'undefined'
}

function pointColor(point: Pick<LocationMonitorMapPoint, 'source'>): string {
  if (point.source === 'CHECKIN') return '#22c55e'
  if (point.source === 'CHECKOUT') return '#f43f5e'
  if (point.source === 'APP_OPEN') return '#f59e0b'
  if (point.source === 'APP_CLOSE') return '#818cf8'
  if (point.source === 'DEMO_START' || point.source === 'DEMO_MARK') return '#22d3ee'
  if (point.source === 'DEMO_END') return '#a78bfa'
  return '#38bdf8'
}

function pointSourceLabel(source: LocationMonitorMapPoint['source']): string {
  if (source === 'CHECKIN') return 'Mesai girisi'
  if (source === 'CHECKOUT') return 'Mesai cikisi'
  if (source === 'APP_OPEN') return 'Uygulama girisi'
  if (source === 'APP_CLOSE') return 'Uygulama cikisi'
  if (source === 'DEMO_START' || source === 'DEMO_MARK') return 'Demo baslangici'
  if (source === 'DEMO_END') return 'Demo bitisi'
  return 'Konum noktasi'
}

function pointVisibilityGroup(source: LocationMonitorMapPoint['source']): PointVisibilityGroup {
  if (source === 'CHECKIN' || source === 'CHECKOUT') {
    return 'SHIFT'
  }
  if (source === 'APP_OPEN' || source === 'APP_CLOSE') {
    return 'APP'
  }
  if (source === 'DEMO_START' || source === 'DEMO_END' || source === 'DEMO_MARK') {
    return 'DEMO'
  }
  return 'TRACK'
}

function parsePointDate(value: string): Date | null {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function formatLocalDateTime(value: string): string {
  const parsed = parsePointDate(value)
  return parsed ? LOCAL_DATE_TIME_FORMAT.format(parsed) : value
}

function formatLocalClock(value: string): string {
  const parsed = parsePointDate(value)
  return parsed ? LOCAL_CLOCK_FORMAT.format(parsed) : value
}

function formatDistance(meters: number | null): string {
  if (meters == null || !Number.isFinite(meters) || meters <= 0) {
    return '-'
  }
  if (meters >= 1_000) {
    return `${DISTANCE_FORMAT.format(meters / 1_000)} km`
  }
  return `${Math.round(meters)} m`
}

function formatDuration(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) {
    return '-'
  }
  const totalMinutes = Math.round(ms / 60_000)
  if (totalMinutes < 60) {
    return `${totalMinutes} dk`
  }
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return minutes ? `${hours} sa ${minutes} dk` : `${hours} sa`
}

function markerBadgeLabel(source: LocationMonitorMapPoint['source']): string {
  if (source === 'CHECKIN') return 'MESAI GIRIS'
  if (source === 'CHECKOUT') return 'MESAI BITIS'
  if (source === 'APP_OPEN') return 'APP GIRIS'
  if (source === 'APP_CLOSE') return 'APP CIKIS'
  if (source === 'DEMO_START' || source === 'DEMO_MARK') return 'DEMO BASLA'
  if (source === 'DEMO_END') return 'DEMO BITIR'
  return 'KONUM'
}

function buildPointMetrics(points: LocationMonitorMapPoint[]): PointMetricsResult {
  const sorted = [...points].sort((left, right) => new Date(left.ts_utc).getTime() - new Date(right.ts_utc).getTime())
  const byId = new Map<string, PointMetric>()
  let cumulativeDistanceMeters = 0

  for (let index = 0; index < sorted.length; index += 1) {
    const point = sorted[index]
    const previousPoint = index > 0 ? sorted[index - 1] : null
    const currentDate = parsePointDate(point.ts_utc)
    const previousDate = previousPoint ? parsePointDate(previousPoint.ts_utc) : null
    const sincePreviousMeters = previousPoint ? distanceMeters(previousPoint, point) : null
    const sincePreviousMs =
      currentDate && previousDate ? Math.max(0, currentDate.getTime() - previousDate.getTime()) : null

    if (sincePreviousMeters != null) {
      cumulativeDistanceMeters += sincePreviousMeters
    }

    byId.set(point.id, {
      pointId: point.id,
      stepIndex: index + 1,
      totalSteps: sorted.length,
      timestampLabel: formatLocalDateTime(point.ts_utc),
      clockLabel: formatLocalClock(point.ts_utc),
      sincePreviousMeters,
      sincePreviousMs,
      sincePreviousDistanceLabel: formatDistance(sincePreviousMeters),
      sincePreviousGapLabel: formatDuration(sincePreviousMs),
      cumulativeDistanceMeters,
      cumulativeDistanceLabel: formatDistance(cumulativeDistanceMeters),
    })
  }

  const firstPoint = sorted[0]
  const lastPoint = sorted[sorted.length - 1]
  const totalDurationMs =
    firstPoint && lastPoint
      ? Math.max(
          0,
          (parsePointDate(lastPoint.ts_utc)?.getTime() ?? 0) - (parsePointDate(firstPoint.ts_utc)?.getTime() ?? 0),
        )
      : 0

  return {
    byId,
    totalDistanceMeters: cumulativeDistanceMeters,
    totalDurationMs,
  }
}

function distanceMeters(left: LocationMonitorMapPoint, right: LocationMonitorMapPoint): number {
  const toRadians = (value: number) => (value * Math.PI) / 180
  const earthRadius = 6_371_000
  const latDelta = toRadians(right.lat - left.lat)
  const lonDelta = toRadians(right.lon - left.lon)
  const leftLat = toRadians(left.lat)
  const rightLat = toRadians(right.lat)

  const haversine =
    Math.sin(latDelta / 2) * Math.sin(latDelta / 2) +
    Math.cos(leftLat) * Math.cos(rightLat) * Math.sin(lonDelta / 2) * Math.sin(lonDelta / 2)

  return 2 * earthRadius * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
}

function compactScaleForPoint(points: LocationMonitorMapPoint[], pointIndex: number): number {
  const point = points[pointIndex]
  let denseNeighborCount = 0
  let nearNeighborCount = 0
  let nearestDistance = Number.POSITIVE_INFINITY

  for (let index = 0; index < points.length; index += 1) {
    if (index === pointIndex) {
      continue
    }

    const distance = distanceMeters(point, points[index])
    nearestDistance = Math.min(nearestDistance, distance)

    if (distance <= DENSE_POINT_RADIUS_M) {
      denseNeighborCount += 1
      continue
    }
    if (distance <= NEAR_POINT_RADIUS_M) {
      nearNeighborCount += 1
    }
  }

  if (denseNeighborCount >= 3 || nearestDistance <= 10) {
    return 0.54
  }
  if (denseNeighborCount >= 2 || nearNeighborCount >= 3 || nearestDistance <= 18) {
    return 0.68
  }
  if (denseNeighborCount >= 1 || nearNeighborCount >= 1 || nearestDistance <= 32) {
    return 0.82
  }
  return 1
}

function createMarkerElement(point: LocationMonitorMapPoint, focused: boolean): HTMLDivElement {
  const color = pointColor(point)
  const wrapper = document.createElement('div')
  wrapper.style.position = 'relative'
  wrapper.style.width = focused ? '98px' : '90px'
  wrapper.style.height = focused ? '50px' : '46px'
  wrapper.style.transform = 'translate(-50%, -100%)'
  wrapper.style.cursor = 'pointer'
  wrapper.style.zIndex = focused ? '6' : '4'
  wrapper.style.pointerEvents = 'auto'
  wrapper.title = point.label

  const badge = document.createElement('div')
  badge.textContent = markerBadgeLabel(point.source)
  badge.style.position = 'absolute'
  badge.style.left = '50%'
  badge.style.top = '0'
  badge.style.transform = 'translateX(-50%)'
  badge.style.maxWidth = focused ? '96px' : '86px'
  badge.style.padding = focused ? '4px 8px' : '3px 7px'
  badge.style.borderRadius = '999px'
  badge.style.border = `1px solid ${focused ? `${color}cc` : `${color}aa`}`
  badge.style.background = focused ? 'rgba(15, 23, 42, 0.96)' : 'rgba(15, 23, 42, 0.9)'
  badge.style.color = 'rgba(248, 250, 252, 0.98)'
  badge.style.fontSize = focused ? '10px' : '9px'
  badge.style.fontWeight = '800'
  badge.style.letterSpacing = '0.07em'
  badge.style.lineHeight = '1'
  badge.style.whiteSpace = 'nowrap'
  badge.style.textOverflow = 'ellipsis'
  badge.style.overflow = 'hidden'
  badge.style.boxShadow = focused
    ? `0 0 0 1px ${color}40, 0 10px 20px rgba(15,23,42,0.28)`
    : `0 0 0 1px ${color}2a, 0 8px 16px rgba(15,23,42,0.22)`

  const pulse = document.createElement('div')
  pulse.style.position = 'absolute'
  pulse.style.left = '50%'
  pulse.style.top = focused ? '28px' : '27px'
  pulse.style.width = focused ? '18px' : '15px'
  pulse.style.height = focused ? '18px' : '15px'
  pulse.style.borderRadius = '999px'
  pulse.style.transform = 'translate(-50%, -50%)'
  pulse.style.background = `${color}33`
  pulse.style.boxShadow = focused ? `0 0 0 8px ${color}24` : `0 0 0 6px ${color}20`

  const pin = document.createElement('div')
  pin.style.position = 'absolute'
  pin.style.left = '50%'
  pin.style.top = focused ? '20px' : '20px'
  pin.style.width = focused ? '17px' : '14px'
  pin.style.height = focused ? '17px' : '14px'
  pin.style.borderRadius = '999px'
  pin.style.transform = 'translateX(-50%)'
  pin.style.background = color
  pin.style.border = '2px solid rgba(255,255,255,0.98)'
  pin.style.boxShadow = focused
    ? `0 0 0 6px ${color}26, 0 10px 20px rgba(15,23,42,0.42)`
    : `0 0 0 4px ${color}1f, 0 8px 18px rgba(15,23,42,0.32)`
  pin.style.transition = 'transform 140ms ease, box-shadow 140ms ease'
  pin.style.transform += focused ? ' scale(1.08)' : ' scale(1)'

  const core = document.createElement('div')
  core.style.position = 'absolute'
  core.style.left = '50%'
  core.style.top = '50%'
  core.style.width = focused ? '4px' : '3px'
  core.style.height = focused ? '4px' : '3px'
  core.style.borderRadius = '999px'
  core.style.transform = 'translate(-50%, -50%)'
  core.style.background = 'rgba(255,255,255,0.98)'

  const tail = document.createElement('div')
  tail.style.position = 'absolute'
  tail.style.left = '50%'
  tail.style.top = focused ? '31px' : '29px'
  tail.style.width = '0'
  tail.style.height = '0'
  tail.style.transform = 'translateX(-50%)'
  tail.style.borderLeft = focused ? '6px solid transparent' : '5px solid transparent'
  tail.style.borderRight = focused ? '6px solid transparent' : '5px solid transparent'
  tail.style.borderTop = focused ? `12px solid ${color}` : `10px solid ${color}`
  tail.style.filter = 'drop-shadow(0 6px 10px rgba(15,23,42,0.34))'

  pin.appendChild(core)
  wrapper.appendChild(badge)
  wrapper.appendChild(pulse)
  wrapper.appendChild(tail)
  wrapper.appendChild(pin)
  return wrapper
}

function buildRouteData(points: LocationMonitorMapPoint[]) {
  const sorted = [...points].sort((left, right) => new Date(left.ts_utc).getTime() - new Date(right.ts_utc).getTime())
  if (sorted.length < 2) {
    return {
      type: 'FeatureCollection' as const,
      features: [],
    }
  }

  return {
    type: 'FeatureCollection' as const,
    features: [
      {
        type: 'Feature' as const,
        properties: {},
        geometry: {
          type: 'LineString' as const,
          coordinates: sorted.map((point) => [point.lon, point.lat]),
        },
      },
    ],
  }
}

function buildPointData(
  points: LocationMonitorMapPoint[],
  highlightedPointId: string | null,
  metricsById: Map<string, PointMetric>,
) {
  const sorted = [...points].sort((left, right) => new Date(left.ts_utc).getTime() - new Date(right.ts_utc).getTime())
  const compactScales = sorted.map((_, index) => compactScaleForPoint(sorted, index))

  return {
    type: 'FeatureCollection' as const,
    features: sorted.map((point, index) => ({
      type: 'Feature' as const,
      properties: {
        id: point.id,
        label: point.label,
        source: point.source,
        timestamp: point.ts_utc,
        timestampLabel: metricsById.get(point.id)?.timestampLabel ?? formatLocalDateTime(point.ts_utc),
        accuracy: point.accuracy_m == null ? '-' : `${Math.round(point.accuracy_m)} m`,
        locationStatus: point.location_status ?? '-',
        deviceId: point.device_id == null ? '-' : `#${point.device_id}`,
        ip: point.ip ?? '-',
        timeLabel: metricsById.get(point.id)?.clockLabel ?? formatLocalClock(point.ts_utc),
        stepLabel: metricsById.has(point.id)
          ? `${metricsById.get(point.id)?.stepIndex}/${metricsById.get(point.id)?.totalSteps}`
          : `${index + 1}/${sorted.length}`,
        prevDistanceLabel: metricsById.get(point.id)?.sincePreviousDistanceLabel ?? '-',
        prevGapLabel: metricsById.get(point.id)?.sincePreviousGapLabel ?? '-',
        cumulativeDistanceLabel: metricsById.get(point.id)?.cumulativeDistanceLabel ?? '-',
        compactScale: point.id === highlightedPointId ? 1.18 : compactScales[index],
        emphasis: point.id === highlightedPointId ? 1 : 0,
        pointOpacity: point.id === highlightedPointId ? 1 : compactScales[index] < 0.7 ? 0.76 : 0.9,
        showTimeLabel:
          point.id === highlightedPointId ||
          index === 0 ||
          index === sorted.length - 1 ||
          point.source === 'CHECKIN' ||
          point.source === 'CHECKOUT' ||
          point.source === 'DEMO_START' ||
          point.source === 'DEMO_END' ||
          (index > 0 &&
            (distanceMeters(sorted[index - 1], point) >= 85 ||
              Math.abs(
                (parsePointDate(point.ts_utc)?.getTime() ?? 0) - (parsePointDate(sorted[index - 1].ts_utc)?.getTime() ?? 0),
              ) >=
                25 * 60 * 1000))
            ? 1
            : 0,
      },
      geometry: {
        type: 'Point' as const,
        coordinates: [point.lon, point.lat],
      },
    })),
  }
}

function fitToPoints(map: MapLibreMap, points: LocationMonitorMapPoint[]) {
  if (!points.length) {
    map.easeTo({
      center: DEFAULT_CENTER,
      zoom: 10.8,
      pitch: 62,
      bearing: -18,
      duration: 0,
    })
    return
  }

  if (points.length === 1) {
    map.easeTo({
      center: [points[0].lon, points[0].lat],
      zoom: 16.2,
      pitch: 62,
      bearing: -18,
      duration: 0,
    })
    return
  }

  const bounds = new maplibregl.LngLatBounds()
  for (const point of points) {
    bounds.extend([point.lon, point.lat])
  }

  map.fitBounds(bounds, {
    padding: { top: 60, right: 48, bottom: 60, left: 48 },
    maxZoom: 16.2,
    duration: 0,
  })

  map.easeTo({
    pitch: 62,
    bearing: -18,
    duration: 0,
  })
}

function syncDomMarkers(map: MapLibreMap, points: LocationMonitorMapPoint[], highlightedPointId: string | null) {
  const highlightedPoints = highlightedPointId
    ? points.filter((point) => point.id === highlightedPointId)
    : points.length
      ? [points[points.length - 1]]
      : []
  const metricsById = buildPointMetrics(points).byId

  const markers = highlightedPoints.map((point) => {
    const marker = new maplibregl.Marker({
      element: createMarkerElement(point, point.id === highlightedPointId),
      anchor: 'bottom',
      pitchAlignment: 'viewport',
      rotationAlignment: 'viewport',
    })
      .setLngLat([point.lon, point.lat])
      .setPopup(
        new maplibregl.Popup({
          closeButton: false,
          offset: 18,
          maxWidth: '320px',
        }).setHTML(popupHtmlForPoint(point, metricsById.get(point.id))),
      )

    marker.addTo(map)
    return marker
  })

  return markers
}

function ensure3DLayers(map: MapLibreMap) {
  if (!map.getSource(ROUTE_SOURCE_ID)) {
    map.addSource(ROUTE_SOURCE_ID, {
      type: 'geojson',
      data: buildRouteData([]),
      lineMetrics: true,
    })
  }

  if (!map.getSource(POINT_SOURCE_ID)) {
    map.addSource(POINT_SOURCE_ID, {
      type: 'geojson',
      data: buildPointData([], null, new Map()),
    })
  }

  if (!map.getLayer(ROUTE_SHADOW_LAYER_ID)) {
    map.addLayer({
      id: ROUTE_SHADOW_LAYER_ID,
      type: 'line',
      source: ROUTE_SOURCE_ID,
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': '#020617',
        'line-opacity': 0.26,
        'line-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          10,
          5,
          16,
          12,
        ],
      },
    })
  }

  if (!map.getLayer(ROUTE_LAYER_ID)) {
    map.addLayer({
      id: ROUTE_LAYER_ID,
      type: 'line',
      source: ROUTE_SOURCE_ID,
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': '#38bdf8',
        'line-opacity': 0.94,
        'line-gradient': [
          'interpolate',
          ['linear'],
          ['line-progress'],
          0,
          '#f59e0b',
          0.28,
          '#38bdf8',
          0.68,
          '#22d3ee',
          1,
          '#22c55e',
        ],
        'line-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          10,
          3.5,
          16,
          8.5,
        ],
      },
    })
  }

  if (!map.getLayer(ROUTE_DIRECTION_LAYER_ID)) {
    map.addLayer({
      id: ROUTE_DIRECTION_LAYER_ID,
      type: 'symbol',
      source: ROUTE_SOURCE_ID,
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 84,
        'text-field': '›',
        'text-size': [
          'interpolate',
          ['linear'],
          ['zoom'],
          10,
          11,
          16,
          15,
        ] as any,
        'text-keep-upright': false,
        'text-ignore-placement': false,
        'text-allow-overlap': false,
      },
      paint: {
        'text-color': 'rgba(15, 23, 42, 0.62)',
        'text-halo-color': 'rgba(255,255,255,0.86)',
        'text-halo-width': 1.2,
        'text-opacity': 0.92,
      },
    })
  }

  if (!map.getLayer(POINT_RING_LAYER_ID)) {
    map.addLayer({
      id: POINT_RING_LAYER_ID,
      type: 'circle',
      source: POINT_SOURCE_ID,
      filter: ['==', ['get', 'emphasis'], 1],
      paint: {
        'circle-pitch-scale': 'viewport',
        'circle-pitch-alignment': 'viewport',
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          9,
          10,
          12,
          12.5,
          16,
          16,
        ],
        'circle-color': '#ffffff',
        'circle-opacity': 0.34,
      },
    })
  }

  if (!map.getLayer(POINT_LAYER_ID)) {
    const baseRadiusExpression = [
      'match',
      ['get', 'source'],
      'CHECKIN',
      6.5,
      'CHECKOUT',
      7,
      'APP_OPEN',
      5.75,
      'APP_CLOSE',
      5.75,
      'DEMO_START',
      6,
      'DEMO_END',
      6,
      'DEMO_MARK',
      6,
      6,
    ] as const

    map.addLayer({
      id: POINT_LAYER_ID,
      type: 'circle',
      source: POINT_SOURCE_ID,
      paint: {
        'circle-pitch-scale': 'viewport',
        'circle-pitch-alignment': 'viewport',
        'circle-radius': [
          '*',
          baseRadiusExpression,
          ['coalesce', ['get', 'compactScale'], 1],
          ['case', ['==', ['get', 'emphasis'], 1], 1.15, 1],
        ] as any,
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
        'circle-opacity': ['coalesce', ['get', 'pointOpacity'], 0.9],
        'circle-color': [
          'match',
          ['get', 'source'],
          'CHECKIN',
          '#22c55e',
          'CHECKOUT',
          '#f43f5e',
          'APP_OPEN',
          '#f59e0b',
          'APP_CLOSE',
          '#818cf8',
          'DEMO_START',
          '#22d3ee',
          'DEMO_END',
          '#a78bfa',
          'DEMO_MARK',
          '#22d3ee',
          '#38bdf8',
        ],
      },
    })
  }

  if (!map.getLayer(POINT_TIME_LAYER_ID)) {
    map.addLayer({
      id: POINT_TIME_LAYER_ID,
      type: 'symbol',
      source: POINT_SOURCE_ID,
      filter: ['==', ['get', 'showTimeLabel'], 1],
      layout: {
        'text-field': ['get', 'timeLabel'] as any,
        'text-size': [
          'interpolate',
          ['linear'],
          ['zoom'],
          10,
          10,
          14,
          11,
          17,
          13,
        ] as any,
        'text-offset': [0, 1.35],
        'text-anchor': 'top',
        'text-ignore-placement': false,
        'text-allow-overlap': false,
        'text-optional': true,
      },
      paint: {
        'text-color': '#0f172a',
        'text-halo-color': 'rgba(255,255,255,0.94)',
        'text-halo-width': 1.4,
        'text-opacity': ['case', ['==', ['get', 'emphasis'], 1], 1, 0.84] as any,
      },
    })
  }

  if (map.getLayer('building-3d')) {
    map.setLayoutProperty('building-3d', 'visibility', 'visible')
  }
}

function popupHtml(feature: MapGeoJSONFeature): string {
  const properties = feature.properties ?? {}
  const label = typeof properties.label === 'string' ? properties.label : 'Konum noktasi'
  const source =
    typeof properties.source === 'string'
      ? pointSourceLabel(properties.source as LocationMonitorMapPoint['source'])
      : '-'
  const timestamp =
    typeof properties.timestampLabel === 'string'
      ? properties.timestampLabel
      : typeof properties.timestamp === 'string'
        ? formatLocalDateTime(properties.timestamp)
        : '-'
  const accuracy = typeof properties.accuracy === 'string' ? properties.accuracy : '-'
  const locationStatus = typeof properties.locationStatus === 'string' ? properties.locationStatus : '-'
  const deviceId = typeof properties.deviceId === 'string' ? properties.deviceId : '-'
  const ip = typeof properties.ip === 'string' ? properties.ip : '-'
  const stepLabel = typeof properties.stepLabel === 'string' ? properties.stepLabel : '-'
  const prevDistanceLabel = typeof properties.prevDistanceLabel === 'string' ? properties.prevDistanceLabel : '-'
  const prevGapLabel = typeof properties.prevGapLabel === 'string' ? properties.prevGapLabel : '-'
  const cumulativeDistanceLabel =
    typeof properties.cumulativeDistanceLabel === 'string' ? properties.cumulativeDistanceLabel : '-'

  return [
    `<strong style="display:block;font-size:13px;margin-bottom:4px;">${label}</strong>`,
    `<div style="font-size:12px;line-height:1.45;">`,
    `<div><strong>Iz sirasi:</strong> ${stepLabel}</div>`,
    `<div><strong>Tip:</strong> ${source}</div>`,
    `<div><strong>Zaman:</strong> ${timestamp}</div>`,
    `<div><strong>Onceki gecis:</strong> ${prevGapLabel} / ${prevDistanceLabel}</div>`,
    `<div><strong>Toplam iz:</strong> ${cumulativeDistanceLabel}</div>`,
    `<div><strong>Dogruluk:</strong> ${accuracy}</div>`,
    `<div><strong>Durum:</strong> ${locationStatus}</div>`,
    `<div><strong>Cihaz:</strong> ${deviceId}</div>`,
    `<div><strong>IP:</strong> ${ip}</div>`,
    `</div>`,
  ].join('')
}

function popupHtmlForPoint(point: LocationMonitorMapPoint, metrics?: PointMetric): string {
  return [
    `<strong style="display:block;font-size:13px;margin-bottom:4px;">${point.label}</strong>`,
    `<div style="font-size:12px;line-height:1.45;">`,
    `<div><strong>Iz sirasi:</strong> ${metrics ? `${metrics.stepIndex}/${metrics.totalSteps}` : '-'}</div>`,
    `<div><strong>Tip:</strong> ${pointSourceLabel(point.source)}</div>`,
    `<div><strong>Zaman:</strong> ${metrics?.timestampLabel ?? formatLocalDateTime(point.ts_utc)}</div>`,
    `<div><strong>Onceki gecis:</strong> ${metrics?.sincePreviousGapLabel ?? '-'} / ${metrics?.sincePreviousDistanceLabel ?? '-'}</div>`,
    `<div><strong>Toplam iz:</strong> ${metrics?.cumulativeDistanceLabel ?? '-'}</div>`,
    `<div><strong>Dogruluk:</strong> ${point.accuracy_m == null ? '-' : `${Math.round(point.accuracy_m)} m`}</div>`,
    `<div><strong>Durum:</strong> ${point.location_status ?? '-'}</div>`,
    `<div><strong>Cihaz:</strong> ${point.device_id == null ? '-' : `#${point.device_id}`}</div>`,
    `<div><strong>IP:</strong> ${point.ip ?? '-'}</div>`,
    `</div>`,
  ].join('')
}

export function LocationMonitor3DView({
  points,
  focusedPointId = null,
}: {
  points: LocationMonitorMapPoint[]
  focusedPointId?: string | null
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const mapLoadedRef = useRef(false)
  const markersRef = useRef<maplibregl.Marker[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [visibleGroups, setVisibleGroups] = useState<Record<PointVisibilityGroup, boolean>>(DEFAULT_VISIBILITY)
  const isSupported = isMapRenderingSupported()
  const orderedPoints = useMemo(
    () => [...points].sort((left, right) => new Date(left.ts_utc).getTime() - new Date(right.ts_utc).getTime()),
    [points],
  )
  const filteredPoints = useMemo(
    () => orderedPoints.filter((point) => visibleGroups[pointVisibilityGroup(point.source)]),
    [orderedPoints, visibleGroups],
  )
  const metrics = useMemo(() => buildPointMetrics(filteredPoints), [filteredPoints])

  const focusedPoint = useMemo(
    () => (focusedPointId ? filteredPoints.find((point) => point.id === focusedPointId) ?? null : null),
    [filteredPoints, focusedPointId],
  )

  const highlightedPointId = focusedPointId ?? filteredPoints[filteredPoints.length - 1]?.id ?? null
  const traceSummary = useMemo(() => {
    const firstPoint = filteredPoints[0]
    const lastPoint = filteredPoints[filteredPoints.length - 1]
    return {
      firstPoint,
      lastPoint,
      pointCount: filteredPoints.length,
      totalDistanceLabel: formatDistance(metrics.totalDistanceMeters),
      totalDurationLabel: formatDuration(metrics.totalDurationMs),
    }
  }, [filteredPoints, metrics.totalDistanceMeters, metrics.totalDurationMs])

  useEffect(() => {
    if (!containerRef.current || mapRef.current || !isSupported) {
      return
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URL,
      center: DEFAULT_CENTER,
      zoom: 10.8,
      pitch: 62,
      bearing: -18,
    })

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
    mapRef.current = map
    markersRef.current = syncDomMarkers(map, filteredPoints, highlightedPointId)
    setLoadError(null)

    const clickHandler = (event: maplibregl.MapMouseEvent & { features?: MapGeoJSONFeature[] }) => {
      const feature = event.features?.[0]
      if (!feature || feature.geometry.type !== 'Point') {
        return
      }
      const coordinates = feature.geometry.coordinates as [number, number]
      new maplibregl.Popup({
        closeButton: false,
        offset: 18,
        maxWidth: '320px',
      })
        .setLngLat(coordinates)
        .setHTML(popupHtml(feature))
        .addTo(map)
    }

    const enterHandler = () => {
      map.getCanvas().style.cursor = 'pointer'
    }

    const leaveHandler = () => {
      map.getCanvas().style.cursor = ''
    }

    map.on('load', () => {
      setLoadError(null)
      mapLoadedRef.current = true
      ensure3DLayers(map)
      const routeSource = map.getSource(ROUTE_SOURCE_ID) as GeoJSONSource | undefined
      routeSource?.setData(buildRouteData(filteredPoints))
      const pointSource = map.getSource(POINT_SOURCE_ID) as GeoJSONSource | undefined
      pointSource?.setData(buildPointData(filteredPoints, highlightedPointId, metrics.byId))
      map.on('click', POINT_LAYER_ID, clickHandler)
      map.on('mouseenter', POINT_LAYER_ID, enterHandler)
      map.on('mouseleave', POINT_LAYER_ID, leaveHandler)
      fitToPoints(map, filteredPoints)
    })

    map.on('error', (event) => {
      const message =
        typeof event?.error?.message === 'string' && event.error.message.trim()
          ? event.error.message.trim()
          : null
      if (message?.includes('404') || message?.includes('style')) {
        setLoadError('3D harita katmani yuklenemedi. Sayfayi yenileyip tekrar deneyin.')
      }
    })

    return () => {
      for (const marker of markersRef.current) {
        marker.remove()
      }
      markersRef.current = []
      mapLoadedRef.current = false
      map.remove()
      mapRef.current = null
    }
  }, [filteredPoints, highlightedPointId, isSupported, metrics.byId])

  useEffect(() => {
    const map = mapRef.current
    if (!map) {
      return
    }

    for (const marker of markersRef.current) {
      marker.remove()
    }
    markersRef.current = syncDomMarkers(map, filteredPoints, highlightedPointId)

    if (!mapLoadedRef.current) {
      return
    }

    ensure3DLayers(map)

    const routeSource = map.getSource(ROUTE_SOURCE_ID) as GeoJSONSource | undefined
    routeSource?.setData(buildRouteData(filteredPoints))

    const pointSource = map.getSource(POINT_SOURCE_ID) as GeoJSONSource | undefined
    pointSource?.setData(buildPointData(filteredPoints, highlightedPointId, metrics.byId))

    fitToPoints(map, filteredPoints)
  }, [filteredPoints, highlightedPointId, metrics.byId])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoadedRef.current || !focusedPoint) {
      return
    }

    map.easeTo({
      center: [focusedPoint.lon, focusedPoint.lat],
      zoom: Math.max(map.getZoom(), filteredPoints.length > 1 ? 16 : 16.8),
      pitch: 68,
      bearing: -18,
      duration: 550,
      essential: true,
    })
  }, [filteredPoints.length, focusedPoint])

  if (!isSupported) {
    return (
      <div className="flex h-[26rem] items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 text-sm text-slate-500">
        Bu tarayicida WebGL tabanli 3D harita desteklenmiyor.
      </div>
    )
  }

  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-950 shadow-sm">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 p-3">
        <div className="pointer-events-auto flex flex-wrap gap-2">
          {VISIBILITY_OPTIONS.map((option) => {
            const active = visibleGroups[option.key]
            return (
              <button
                key={option.key}
                type="button"
                onClick={() =>
                  setVisibleGroups((current) => ({
                    ...current,
                    [option.key]: !current[option.key],
                  }))
                }
                className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-[0.14em] ${
                  active
                    ? 'border-white/70 bg-slate-950/82 text-white'
                    : 'border-white/16 bg-slate-900/42 text-slate-300'
                }`}
              >
                {option.label}
              </button>
            )
          })}
        </div>

        <div className="mt-2 flex flex-wrap gap-2">
          <span className="rounded-full border border-white/14 bg-slate-950/72 px-2.5 py-1 text-[11px] font-medium text-slate-100">
            {traceSummary.pointCount} nokta
          </span>
          <span className="rounded-full border border-white/14 bg-slate-950/72 px-2.5 py-1 text-[11px] font-medium text-slate-100">
            Iz: {traceSummary.totalDistanceLabel}
          </span>
          <span className="rounded-full border border-white/14 bg-slate-950/72 px-2.5 py-1 text-[11px] font-medium text-slate-100">
            Sure: {traceSummary.totalDurationLabel}
          </span>
          {traceSummary.firstPoint ? (
            <span className="rounded-full border border-white/14 bg-slate-950/72 px-2.5 py-1 text-[11px] font-medium text-slate-100">
              Baslangic {formatLocalClock(traceSummary.firstPoint.ts_utc)}
            </span>
          ) : null}
          {traceSummary.lastPoint ? (
            <span className="rounded-full border border-white/14 bg-slate-950/72 px-2.5 py-1 text-[11px] font-medium text-slate-100">
              Son {formatLocalClock(traceSummary.lastPoint.ts_utc)}
            </span>
          ) : null}
        </div>
      </div>
      <div ref={containerRef} className="h-[26rem] w-full" />
      {loadError ? (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/84 px-6 text-center text-sm font-medium text-slate-200">
          {loadError}
        </div>
      ) : null}
    </div>
  )
}
