import { ErrorBlock } from '../ErrorBlock'
import { LoadingBlock } from '../LoadingBlock'
import { LocationMonitorMap } from '../location-monitor/LocationMonitorMap'
import type { LocationMonitorMapResponse } from '../../types/api'
import { formatDistance } from './utils'
import {
  ControlRoomOverviewMap,
  type ControlRoomOverviewMarkerPoint,
} from './ControlRoomOverviewMap'

type MapMode = 'fleet' | 'employeeRoute'

export function ControlRoomUnifiedMap({
  mapMode,
  selectedEmployeeId,
  selectedEmployeeName,
  overviewPoints,
  routeData,
  routeLoading,
  routeError,
  onSelectEmployee,
}: {
  mapMode: MapMode
  selectedEmployeeId: number | null
  selectedEmployeeName: string | null
  overviewPoints: ControlRoomOverviewMarkerPoint[]
  routeData: LocationMonitorMapResponse | null
  routeLoading: boolean
  routeError: boolean
  onSelectEmployee: (employeeId: number) => void
}) {
  if (mapMode === 'employeeRoute' && selectedEmployeeId != null) {
    return (
      <div className="cr-map-panel">
        <div className="cr-map-panel__hud">
          <div className="cr-map-panel__hud-row">
            <span className="cr-map-panel__badge is-live">EMPLOYEE ROUTE</span>
            <span className="cr-map-panel__badge">
              {selectedEmployeeName ?? `#${selectedEmployeeId}`}
            </span>
            {routeData ? (
              <span className="cr-map-panel__badge">
                {routeData.route_stats.event_count} nokta / {formatDistance(routeData.route_stats.total_distance_m)}
              </span>
            ) : null}
          </div>
          <div className="cr-map-panel__legend">
            <span>Tek personel rota overlay</span>
            <span>Repeated group + geofence aktif</span>
          </div>
        </div>

        {routeLoading && !routeData ? (
          <div className="cr-map-panel__state">
            <LoadingBlock label="Secili personelin rota overlay'i yukleniyor..." />
          </div>
        ) : routeError || !routeData ? (
          <div className="cr-map-panel__state">
            <ErrorBlock message="Secili personelin rota overlay'i yuklenemedi." />
          </div>
        ) : (
          <LocationMonitorMap
            points={routeData.points}
            simplifiedPoints={routeData.simplified_points}
            repeatedGroups={routeData.repeated_groups}
            geofence={routeData.geofence}
            focusedPointId={routeData.points[routeData.points.length - 1]?.id ?? null}
            className="cr-map-panel__route-canvas"
          />
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
