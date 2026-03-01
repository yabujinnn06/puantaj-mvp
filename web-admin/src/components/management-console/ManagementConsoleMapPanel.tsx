import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'

import { getAttendanceEvents } from '../../api/admin'
import type { LocationStatus } from '../../types/api'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import { MAP_EVENT_PAGE_SIZE } from './types'
import { formatDate, formatDateTime, locationStatusLabel } from './utils'
import {
  ManagementConsoleMap,
  type ManagementConsoleMapEvent,
} from './ManagementConsoleMap'

export function ManagementConsoleMapPanel({
  selectedEmployeeId,
  departmentId,
  regionId,
  startDate,
  endDate,
  onSelectEmployee,
}: {
  selectedEmployeeId: number | null
  departmentId?: number
  regionId?: number
  startDate?: string
  endDate?: string
  onSelectEmployee: (employeeId: number) => void
}) {
  const [searchText, setSearchText] = useState('')
  const [eventType, setEventType] = useState<'' | 'IN' | 'OUT'>('')
  const [locationStatus, setLocationStatus] = useState<LocationStatus | ''>('')
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false)
  const [selectedOnly, setSelectedOnly] = useState(false)
  const [playbackIndex, setPlaybackIndex] = useState(0)
  const debouncedSearch = useDebouncedValue(searchText, 250)
  const deferredSearch = useDeferredValue(debouncedSearch)

  const eventsQuery = useInfiniteQuery({
    queryKey: [
      'management-console-map-events',
      {
        employeeId: selectedOnly ? selectedEmployeeId : null,
        departmentId,
        regionId,
        startDate,
        endDate,
        eventType,
        locationStatus,
      },
    ],
    queryFn: ({ pageParam }) =>
      getAttendanceEvents({
        employee_id: selectedOnly ? selectedEmployeeId ?? undefined : undefined,
        department_id: departmentId,
        region_id: regionId,
        start_date: startDate,
        end_date: endDate,
        type: eventType || undefined,
        location_status: locationStatus || undefined,
        offset: pageParam,
        limit: MAP_EVENT_PAGE_SIZE,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < MAP_EVENT_PAGE_SIZE ? undefined : allPages.length * MAP_EVENT_PAGE_SIZE,
    staleTime: 30_000,
  })

  const loadedEvents = useMemo(
    () =>
      (eventsQuery.data?.pages.flat() ?? []).filter(
        (event) => event.lat != null && event.lon != null,
      ),
    [eventsQuery.data?.pages],
  )

  const filteredEvents = useMemo(() => {
    const normalizedQuery = deferredSearch.trim().toLocaleLowerCase('tr-TR')
    return loadedEvents.filter((event) => {
      if (normalizedQuery) {
        const haystack = [event.employee_name ?? '', event.department_name ?? '', String(event.employee_id)]
          .join(' ')
          .toLocaleLowerCase('tr-TR')
        if (!haystack.includes(normalizedQuery)) {
          return false
        }
      }
      return true
    })
  }, [deferredSearch, loadedEvents])

  const mapEvents = useMemo<ManagementConsoleMapEvent[]>(
    () =>
      filteredEvents.map((event) => ({
        id: event.id,
        employeeId: event.employee_id,
        employeeName: event.employee_name ?? `Personel #${event.employee_id}`,
        departmentName: event.department_name,
        lat: event.lat as number,
        lon: event.lon as number,
        accuracyM: event.accuracy_m,
        eventType: event.type,
        locationStatus: event.location_status,
        tsUtc: event.ts_utc,
        deviceId: event.device_id,
        source: event.source,
        note: event.note,
      })),
    [filteredEvents],
  )

  const selectedEmployeeEvents = useMemo(
    () =>
      selectedEmployeeId == null
        ? []
        : mapEvents
            .filter((event) => event.employeeId === selectedEmployeeId)
            .sort((left, right) => new Date(left.tsUtc).getTime() - new Date(right.tsUtc).getTime()),
    [mapEvents, selectedEmployeeId],
  )

  useEffect(() => {
    if (!selectedEmployeeEvents.length) {
      setPlaybackIndex(0)
      return
    }
    setPlaybackIndex(selectedEmployeeEvents.length - 1)
  }, [selectedEmployeeEvents])

  const playbackEvent = selectedEmployeeEvents[playbackIndex] ?? null
  const focusedEventId =
    playbackEvent?.id ??
    (selectedEmployeeId == null
      ? null
      : mapEvents.find((event) => event.employeeId === selectedEmployeeId)?.id ?? null)

  return (
    <section className="mc-panel">
      <div className="mc-panel__head">
        <div>
          <p className="mc-kicker">HARİTA İZLEME</p>
          <h3 className="mc-panel__title">Personel konum geçmişi ve giriş-çıkış hareketleri</h3>
        </div>
        <div className="mc-meta">
          <span>{mapEvents.length} koordinatlı kayıt</span>
          <span>{startDate ? `${formatDate(startDate)} - ${formatDate(endDate ?? startDate)}` : 'Tarih seçilmedi'}</span>
        </div>
      </div>

      <div className="mc-map-panel__filters">
        <label className="mc-field">
          <span>Personel ara</span>
          <input
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Ad, soyad veya ID"
          />
        </label>
        <label className="mc-field">
          <span>Olay tipi</span>
          <select value={eventType} onChange={(event) => setEventType(event.target.value as '' | 'IN' | 'OUT')}>
            <option value="">Tüm hareketler</option>
            <option value="IN">Giriş</option>
            <option value="OUT">Çıkış</option>
          </select>
        </label>
        <label className="mc-field">
          <span>Konum durumu</span>
          <select
            value={locationStatus}
            onChange={(event) => setLocationStatus(event.target.value as LocationStatus | '')}
          >
            <option value="">Tüm durumlar</option>
            <option value="VERIFIED_HOME">Doğrulandı</option>
            <option value="UNVERIFIED_LOCATION">Sapma</option>
            <option value="NO_LOCATION">Konum yok</option>
          </select>
        </label>
      </div>

      <div className="mc-map-panel__toolbar">
        <label className="mc-check">
          <input
            type="checkbox"
            checked={selectedOnly}
            onChange={(event) => setSelectedOnly(event.target.checked)}
            disabled={selectedEmployeeId == null}
          />
          <span>Seçili personeli filtrele</span>
        </label>
        <label className="mc-check">
          <input
            type="checkbox"
            checked={showTechnicalDetails}
            onChange={(event) => setShowTechnicalDetails(event.target.checked)}
          />
          <span>Teknik detayları göster</span>
        </label>
      </div>

      {eventsQuery.isError ? (
        <div className="mc-empty-state">Harita olayları yüklenemedi.</div>
      ) : mapEvents.length ? (
        <ManagementConsoleMap
          events={mapEvents}
          focusedEventId={focusedEventId}
          showTechnicalDetails={showTechnicalDetails}
          onSelectEmployee={onSelectEmployee}
        />
      ) : (
        <div className="mc-empty-state">
          {eventsQuery.isLoading ? 'Harita olayları yükleniyor...' : 'Seçilen kapsam için koordinatlı hareket bulunamadı.'}
        </div>
      )}

      {selectedEmployeeEvents.length > 1 ? (
        <div className="mc-playback">
          <div className="mc-playback__head">
            <div>
              <strong>Zaman oynatma</strong>
              <span>Seçili personelin tarihsel hareketleri arasında gezin</span>
            </div>
            <div className="mc-playback__meta">
              <strong>{formatDateTime(playbackEvent?.tsUtc)}</strong>
              <span>{playbackEvent ? locationStatusLabel(playbackEvent.locationStatus) : '-'}</span>
            </div>
          </div>
          <input
            type="range"
            min={0}
            max={selectedEmployeeEvents.length - 1}
            step={1}
            value={playbackIndex}
            onChange={(event) => setPlaybackIndex(Number(event.target.value))}
          />
        </div>
      ) : null}

      <div className="mc-map-panel__footer">
        <div className="mc-legend">
          <span className="mc-legend__item">
            <i className="mc-legend__dot mc-legend__dot--entry" />
            Giriş
          </span>
          <span className="mc-legend__item">
            <i className="mc-legend__dot mc-legend__dot--exit" />
            Çıkış
          </span>
        </div>
        <div className="mc-meta">
          {eventsQuery.hasNextPage ? (
            <button
              type="button"
              className="mc-button mc-button--secondary"
              onClick={() => void eventsQuery.fetchNextPage()}
              disabled={eventsQuery.isFetchingNextPage}
            >
              {eventsQuery.isFetchingNextPage ? 'Yükleniyor...' : 'Daha fazla veri yükle'}
            </button>
          ) : (
            <span>Tüm yüklenebilir kayıtlar getirildi</span>
          )}
          <span>Son örnek: {loadedEvents[0] ? formatDateTime(loadedEvents[0].ts_utc) : '-'}</span>
        </div>
      </div>
    </section>
  )
}
