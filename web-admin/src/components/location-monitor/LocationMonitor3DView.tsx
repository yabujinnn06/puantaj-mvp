import { useEffect, useMemo, useRef } from 'react'
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
const POINT_LAYER_ID = 'location-monitor-point-layer'
const POINT_RING_LAYER_ID = 'location-monitor-point-ring-layer'

function isMapRenderingSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.WebGLRenderingContext !== 'undefined'
}

function pointColor(point: Pick<LocationMonitorMapPoint, 'source'>): string {
  if (point.source === 'CHECKIN') return '#22c55e'
  if (point.source === 'CHECKOUT') return '#f43f5e'
  if (point.source === 'APP_OPEN') return '#f59e0b'
  if (point.source === 'APP_CLOSE') return '#818cf8'
  return '#38bdf8'
}

function createMarkerElement(point: LocationMonitorMapPoint, focused: boolean): HTMLDivElement {
  const element = document.createElement('div')
  const color = pointColor(point)
  element.style.width = focused ? '18px' : '14px'
  element.style.height = focused ? '18px' : '14px'
  element.style.borderRadius = '999px'
  element.style.background = color
  element.style.border = '3px solid rgba(255,255,255,0.96)'
  element.style.boxShadow = focused
    ? `0 0 0 8px ${color}33, 0 8px 24px rgba(15,23,42,0.45)`
    : `0 0 0 5px ${color}26, 0 6px 18px rgba(15,23,42,0.32)`
  element.style.transition = 'transform 140ms ease, box-shadow 140ms ease'
  element.style.transform = focused ? 'scale(1.14)' : 'scale(1)'
  element.title = point.label
  return element
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

function buildPointData(points: LocationMonitorMapPoint[]) {
  const sorted = [...points].sort((left, right) => new Date(left.ts_utc).getTime() - new Date(right.ts_utc).getTime())
  return {
    type: 'FeatureCollection' as const,
    features: sorted.map((point) => ({
      type: 'Feature' as const,
      properties: {
        id: point.id,
        label: point.label,
        source: point.source,
        timestamp: point.ts_utc,
        accuracy: point.accuracy_m == null ? '-' : `${Math.round(point.accuracy_m)} m`,
        locationStatus: point.location_status ?? '-',
        deviceId: point.device_id == null ? '-' : `#${point.device_id}`,
        ip: point.ip ?? '-',
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

function ensure3DLayers(map: MapLibreMap) {
  if (!map.getSource(ROUTE_SOURCE_ID)) {
    map.addSource(ROUTE_SOURCE_ID, {
      type: 'geojson',
      data: buildRouteData([]),
    })
  }

  if (!map.getSource(POINT_SOURCE_ID)) {
    map.addSource(POINT_SOURCE_ID, {
      type: 'geojson',
      data: buildPointData([]),
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
        'line-opacity': 0.9,
        'line-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          10,
          3,
          16,
          8,
        ],
      },
    })
  }

  if (!map.getLayer(POINT_RING_LAYER_ID)) {
    map.addLayer({
      id: POINT_RING_LAYER_ID,
      type: 'circle',
      source: POINT_SOURCE_ID,
      paint: {
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          10,
          7,
          16,
          12,
        ],
        'circle-color': '#ffffff',
        'circle-opacity': 0.38,
      },
    })
  }

  if (!map.getLayer(POINT_LAYER_ID)) {
    map.addLayer({
      id: POINT_LAYER_ID,
      type: 'circle',
      source: POINT_SOURCE_ID,
      paint: {
        'circle-radius': [
          'match',
          ['get', 'source'],
          'CHECKIN',
          6.5,
          'CHECKOUT',
          7.5,
          'APP_OPEN',
          6,
          'APP_CLOSE',
          6,
          6.5,
        ],
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
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
          '#38bdf8',
        ],
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
  const source = typeof properties.source === 'string' ? properties.source : '-'
  const timestamp = typeof properties.timestamp === 'string' ? properties.timestamp : '-'
  const accuracy = typeof properties.accuracy === 'string' ? properties.accuracy : '-'
  const locationStatus = typeof properties.locationStatus === 'string' ? properties.locationStatus : '-'
  const deviceId = typeof properties.deviceId === 'string' ? properties.deviceId : '-'
  const ip = typeof properties.ip === 'string' ? properties.ip : '-'

  return [
    `<strong style="display:block;font-size:13px;margin-bottom:4px;">${label}</strong>`,
    `<div style="font-size:12px;line-height:1.45;">`,
    `<div><strong>Tip:</strong> ${source}</div>`,
    `<div><strong>Zaman:</strong> ${timestamp}</div>`,
    `<div><strong>Dogruluk:</strong> ${accuracy}</div>`,
    `<div><strong>Durum:</strong> ${locationStatus}</div>`,
    `<div><strong>Cihaz:</strong> ${deviceId}</div>`,
    `<div><strong>IP:</strong> ${ip}</div>`,
    `</div>`,
  ].join('')
}

function popupHtmlForPoint(point: LocationMonitorMapPoint): string {
  return [
    `<strong style="display:block;font-size:13px;margin-bottom:4px;">${point.label}</strong>`,
    `<div style="font-size:12px;line-height:1.45;">`,
    `<div><strong>Tip:</strong> ${point.source}</div>`,
    `<div><strong>Zaman:</strong> ${point.ts_utc}</div>`,
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
  const isSupported = isMapRenderingSupported()
  const orderedPoints = useMemo(
    () => [...points].sort((left, right) => new Date(left.ts_utc).getTime() - new Date(right.ts_utc).getTime()),
    [points],
  )

  const focusedPoint = useMemo(
    () => (focusedPointId ? orderedPoints.find((point) => point.id === focusedPointId) ?? null : null),
    [focusedPointId, orderedPoints],
  )

  const highlightedPointId = focusedPointId ?? orderedPoints[orderedPoints.length - 1]?.id ?? null

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
      mapLoadedRef.current = true
      ensure3DLayers(map)
      map.on('click', POINT_LAYER_ID, clickHandler)
      map.on('mouseenter', POINT_LAYER_ID, enterHandler)
      map.on('mouseleave', POINT_LAYER_ID, leaveHandler)
      fitToPoints(map, orderedPoints)
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
  }, [isSupported, orderedPoints])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoadedRef.current) {
      return
    }

    ensure3DLayers(map)

    const routeSource = map.getSource(ROUTE_SOURCE_ID) as GeoJSONSource | undefined
    routeSource?.setData(buildRouteData(orderedPoints))

    const pointSource = map.getSource(POINT_SOURCE_ID) as GeoJSONSource | undefined
    pointSource?.setData(buildPointData(orderedPoints))

    fitToPoints(map, orderedPoints)

    for (const marker of markersRef.current) {
      marker.remove()
    }
    markersRef.current = orderedPoints.map((point) => {
      const marker = new maplibregl.Marker({
        element: createMarkerElement(point, point.id === highlightedPointId),
        anchor: 'center',
      })
        .setLngLat([point.lon, point.lat])
        .setPopup(
          new maplibregl.Popup({
            closeButton: false,
            offset: 18,
            maxWidth: '320px',
          }).setHTML(popupHtmlForPoint(point)),
        )
        .addTo(map)

      return marker
    })
  }, [highlightedPointId, orderedPoints])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoadedRef.current || !focusedPoint) {
      return
    }

    map.easeTo({
      center: [focusedPoint.lon, focusedPoint.lat],
      zoom: Math.max(map.getZoom(), orderedPoints.length > 1 ? 16 : 16.8),
      pitch: 68,
      bearing: -18,
      duration: 550,
      essential: true,
    })
  }, [focusedPoint, orderedPoints.length])

  if (!isSupported) {
    return (
      <div className="flex h-[26rem] items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 text-sm text-slate-500">
        Bu tarayicida WebGL tabanli 3D harita desteklenmiyor.
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-950 shadow-sm">
      <div ref={containerRef} className="h-[26rem] w-full" />
      <div className="border-t border-slate-800 bg-slate-950/95 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300">
        OpenFreeMap Liberty stili uzerinde gercek 3D bina katmani, rota izi ve olay noktalarini gosterir.
      </div>
    </div>
  )
}
