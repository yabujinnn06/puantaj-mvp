import type {
  ControlRoomOverviewParams,
  LocationMonitorMapPointsParams,
  LocationMonitorSummaryParams,
  LocationMonitorTimelineEventsParams,
} from '../../api/admin'

export const controlRoomQueryKeys = {
  employees: ['control-room', 'employees'] as const,
  regions: ['control-room', 'regions'] as const,
  departments: ['control-room', 'departments'] as const,
  overview: (params: ControlRoomOverviewParams) => ['control-room-overview', params] as const,
  focusSummary: (employeeId: number, params: LocationMonitorSummaryParams) =>
    ['control-room-focus', 'summary', employeeId, params] as const,
  focusMap: (employeeId: number, params: LocationMonitorMapPointsParams) =>
    ['control-room-focus', 'map', employeeId, params] as const,
  focusTimeline: (employeeId: number, params: LocationMonitorTimelineEventsParams) =>
    ['control-room-focus', 'timeline', employeeId, params] as const,
}
