import { ErrorBlock } from '../ErrorBlock'
import { LoadingBlock } from '../LoadingBlock'
import { LocationMonitorMap } from '../location-monitor/LocationMonitorMap'
import type { LocationMonitorMapResponse, LocationMonitorTimelineEvent } from '../../types/api'
import { formatDate, formatDistance } from './utils'
import { EmployeeDayEventMiniList } from './EmployeeDayEventMiniList'
import {
  ControlRoomOverviewMap,
  type ControlRoomOverviewMarkerPoint,
} from './ControlRoomOverviewMap'

type MapMode = 'fleet' | 'employeeDay'

export function ControlRoomUnifiedMap({
  mapMode,
  selectedEmployeeId,
  selectedEmployeeName,
  selectedDay,
  overviewPoints,
  dayMapData,
  dayEvents,
  dayLoading,
  dayError,
  dayEventsLoading,
  dayEventsError,
  selectedEventId,
  onSelectEmployee,
  onSelectEvent,
}: {
  mapMode: MapMode
  selectedEmployeeId: number | null
  selectedEmployeeName: string | null
  selectedDay: string | null
  overviewPoints: ControlRoomOverviewMarkerPoint[]
  dayMapData: LocationMonitorMapResponse | null
  dayEvents: LocationMonitorTimelineEvent[]
  dayLoading: boolean
  dayError: boolean
  dayEventsLoading: boolean
  dayEventsError: boolean
  selectedEventId: string | null
  onSelectEmployee: (employeeId: number) => void
  onSelectEvent: (eventId: string) => void
}) {
  if (mapMode === 'employeeDay' && selectedEmployeeId != null && selectedDay) {
    return (
      <div className="cr-map-panel">
        <div className="cr-map-panel__hud">
          <div className="cr-map-panel__hud-row">
            <span className="cr-map-panel__badge is-live">EMPLOYEE DAY</span>
            <span className="cr-map-panel__badge">
              {selectedEmployeeName ?? `#${selectedEmployeeId}`}
            </span>
            <span className="cr-map-panel__badge">{formatDate(selectedDay)}</span>
            {dayMapData ? (
              <span className="cr-map-panel__badge">
                {dayMapData.route_stats.event_count} nokta / {formatDistance(dayMapData.route_stats.total_distance_m)}
              </span>
            ) : null}
          </div>
          <div className="cr-map-panel__legend">
            <span>Secilen gunun tum noktalarini gosterir</span>
            <span>Polyline + repeated group + geofence aktif</span>
          </div>
        </div>

        {dayLoading && !dayMapData ? (
          <div className="cr-map-panel__state">
            <LoadingBlock label="Secili gunun rota haritasi yukleniyor..." />
          </div>
        ) : dayError || !dayMapData ? (
          <div className="cr-map-panel__state">
            <ErrorBlock message="Secili gunun rota haritasi yuklenemedi." />
          </div>
        ) : (
          <div className="cr-map-panel__route-shell">
            <LocationMonitorMap
              points={dayMapData.points}
              simplifiedPoints={dayMapData.simplified_points}
              repeatedGroups={dayMapData.repeated_groups}
              geofence={dayMapData.geofence}
              focusedPointId={selectedEventId ?? dayMapData.points[dayMapData.points.length - 1]?.id ?? null}
              className="cr-map-panel__route-canvas"
            />
            <div className="cr-map-panel__mini-rail">
              <EmployeeDayEventMiniList
                events={dayEvents}
                selectedEventId={selectedEventId}
                loading={dayEventsLoading}
                error={dayEventsError}
                onSelectEvent={onSelectEvent}
              />
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <ControlRoomOverviewMap
      points={overviewPoints}
      selectedEmployeeId={selectedEmployeeId}
      onSelectEmployee={onSelectEmployee}
    />
  )
}
