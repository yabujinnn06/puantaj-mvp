import { Suspense, lazy, type ComponentType } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import { AppLayout } from './components/AppLayout'
import { LoadingBlock } from './components/LoadingBlock'
import { AuthGuard } from './auth/AuthGuard'
import { DefaultAdminRoute, PermissionRoute } from './auth/PermissionRoute'
import { PublicOnlyRoute } from './auth/PublicOnlyRoute'

function lazyPage<T extends ComponentType>(
  loader: () => Promise<{ default: T }>,
) {
  return lazy(loader)
}

const AdminDeviceClaimPage = lazyPage(() =>
  import('./pages/AdminDeviceClaimPage').then((module) => ({ default: module.AdminDeviceClaimPage })),
)
const AttendanceEventsPage = lazyPage(() =>
  import('./pages/AttendanceEventsPage').then((module) => ({ default: module.AttendanceEventsPage })),
)
const DepartmentSummaryReportPage = lazyPage(() =>
  import('./pages/DepartmentSummaryReportPage').then((module) => ({ default: module.DepartmentSummaryReportPage })),
)
const DepartmentsPage = lazyPage(() =>
  import('./pages/DepartmentsPage').then((module) => ({ default: module.DepartmentsPage })),
)
const DevicesPage = lazyPage(() =>
  import('./pages/DevicesPage').then((module) => ({ default: module.DevicesPage })),
)
const ComplianceSettingsPage = lazyPage(() =>
  import('./pages/ComplianceSettingsPage').then((module) => ({ default: module.ComplianceSettingsPage })),
)
const ArchivePasswordDownloadPage = lazyPage(() =>
  import('./pages/ArchivePasswordDownloadPage').then((module) => ({ default: module.ArchivePasswordDownloadPage })),
)
const AttendanceExtraCheckinApprovalPage = lazyPage(() =>
  import('./pages/AttendanceExtraCheckinApprovalPage').then((module) => ({ default: module.AttendanceExtraCheckinApprovalPage })),
)
const AdminUsersPage = lazyPage(() =>
  import('./pages/AdminUsersPage').then((module) => ({ default: module.AdminUsersPage })),
)
const CommunicationsPage = lazyPage(() =>
  import('./pages/CommunicationsPage').then((module) => ({ default: module.CommunicationsPage })),
)
const EmployeeDetailPage = lazyPage(() =>
  import('./pages/EmployeeDetailPage').then((module) => ({ default: module.EmployeeDetailPage })),
)
const EmployeeMonthlyReportPage = lazyPage(() =>
  import('./pages/EmployeeMonthlyReportPage').then((module) => ({ default: module.EmployeeMonthlyReportPage })),
)
const EmployeesPage = lazyPage(() =>
  import('./pages/EmployeesPage').then((module) => ({ default: module.EmployeesPage })),
)
const LeavesPage = lazyPage(() =>
  import('./pages/LeavesPage').then((module) => ({ default: module.LeavesPage })),
)
const LoginPage = lazyPage(() =>
  import('./pages/LoginPage').then((module) => ({ default: module.LoginPage })),
)
const LocationMonitorPage = lazyPage(() =>
  import('./pages/LocationMonitorPage').then((module) => ({ default: module.LocationMonitorPage })),
)
const NotFoundPage = lazyPage(() =>
  import('./pages/NotFoundPage').then((module) => ({ default: module.NotFoundPage })),
)
const PuantajExportPage = lazyPage(() =>
  import('./pages/PuantajExportPage').then((module) => ({ default: module.PuantajExportPage })),
)
const QrCodesPage = lazyPage(() =>
  import('./pages/QrCodesPage').then((module) => ({ default: module.QrCodesPage })),
)
const QuickSetupPage = lazyPage(() =>
  import('./pages/QuickSetupPage').then((module) => ({ default: module.QuickSetupPage })),
)
const RegionsPage = lazyPage(() =>
  import('./pages/RegionsPage').then((module) => ({ default: module.RegionsPage })),
)
const NotificationsPage = lazyPage(() =>
  import('./pages/NotificationsPage').then((module) => ({ default: module.NotificationsPage })),
)
const SystemLogsPage = lazyPage(() =>
  import('./pages/SystemLogsPage').then((module) => ({ default: module.SystemLogsPage })),
)
const WelcomePage = lazyPage(() =>
  import('./pages/WelcomePage').then((module) => ({ default: module.WelcomePage })),
)
const WorkRulesPage = lazyPage(() =>
  import('./pages/WorkRulesPage').then((module) => ({ default: module.WorkRulesPage })),
)

function renderLazyPage(PageComponent: ComponentType, label = 'Sayfa yukleniyor...') {
  return (
    <Suspense fallback={<LoadingBlock label={label} />}>
      <PageComponent />
    </Suspense>
  )
}

function App() {
  return (
    <Routes>
      <Route element={<PublicOnlyRoute />}>
        <Route path="/login" element={renderLazyPage(LoginPage)} />
      </Route>

      <Route path="/device-claim" element={renderLazyPage(AdminDeviceClaimPage)} />
      <Route path="/archive-download" element={renderLazyPage(ArchivePasswordDownloadPage)} />
      <Route path="/attendance-extra-checkin-approval" element={renderLazyPage(AttendanceExtraCheckinApprovalPage)} />

      <Route element={<AuthGuard />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<DefaultAdminRoute />} />
          <Route path="/welcome" element={renderLazyPage(WelcomePage)} />
          <Route path="/management-console" element={<Navigate to="/log" replace />} />
          <Route
            path="/log"
            element={
              <PermissionRoute permission="log">
                {renderLazyPage(LocationMonitorPage)}
              </PermissionRoute>
            }
          />
          <Route path="/location-monitor" element={<Navigate to="/log" replace />} />
          <Route path="/control-room" element={<Navigate to="/log" replace />} />
          <Route path="/dashboard" element={<Navigate to="/welcome" replace />} />
          <Route
            path="/regions"
            element={
              <PermissionRoute permission="regions">
                {renderLazyPage(RegionsPage)}
              </PermissionRoute>
            }
          />
          <Route
            path="/departments"
            element={
              <PermissionRoute permission="departments">
                {renderLazyPage(DepartmentsPage)}
              </PermissionRoute>
            }
          />
          <Route
            path="/employees"
            element={
              <PermissionRoute permission="employees">
                {renderLazyPage(EmployeesPage)}
              </PermissionRoute>
            }
          />
          <Route
            path="/employees/:id"
            element={
              <PermissionRoute permission="employees">
                {renderLazyPage(EmployeeDetailPage)}
              </PermissionRoute>
            }
          />
          <Route
            path="/quick-setup"
            element={
              <PermissionRoute permission="schedule">
                {renderLazyPage(QuickSetupPage)}
              </PermissionRoute>
            }
          />
          <Route
            path="/work-rules"
            element={
              <PermissionRoute permission="work_rules">
                {renderLazyPage(WorkRulesPage)}
              </PermissionRoute>
            }
          />
          <Route
            path="/attendance-events"
            element={
              <PermissionRoute permission="attendance_events">
                {renderLazyPage(AttendanceEventsPage)}
              </PermissionRoute>
            }
          />
          <Route
            path="/devices"
            element={
              <PermissionRoute permission="devices">
                {renderLazyPage(DevicesPage)}
              </PermissionRoute>
            }
          />
          <Route
            path="/compliance-settings"
            element={
              <PermissionRoute permission="compliance">
                {renderLazyPage(ComplianceSettingsPage)}
              </PermissionRoute>
            }
          />
          <Route
            path="/leaves"
            element={
              <PermissionRoute permission="leaves">
                {renderLazyPage(LeavesPage)}
              </PermissionRoute>
            }
          />
          <Route
            path="/qr-kodlar"
            element={
              <PermissionRoute permission="qr_codes">
                {renderLazyPage(QrCodesPage)}
              </PermissionRoute>
            }
          />
          <Route
            path="/reports/employee-monthly"
            element={
              <PermissionRoute permission="reports">
                {renderLazyPage(EmployeeMonthlyReportPage)}
              </PermissionRoute>
            }
          />
          <Route
            path="/reports/department-summary"
            element={
              <PermissionRoute permission="reports">
                {renderLazyPage(DepartmentSummaryReportPage)}
              </PermissionRoute>
            }
          />
          <Route
            path="/reports/excel-export"
            element={
              <PermissionRoute permission="reports">
                {renderLazyPage(PuantajExportPage)}
              </PermissionRoute>
            }
          />
          <Route
            path="/notifications"
            element={
              <PermissionRoute permission="notifications">
                {renderLazyPage(NotificationsPage)}
              </PermissionRoute>
            }
          />
          <Route
            path="/communications"
            element={
              <PermissionRoute permission="notifications">
                {renderLazyPage(CommunicationsPage)}
              </PermissionRoute>
            }
          />
          <Route
            path="/audit-logs"
            element={
              <PermissionRoute permission="audit_logs">
                {renderLazyPage(SystemLogsPage)}
              </PermissionRoute>
            }
          />
          <Route
            path="/admin-users"
            element={
              <PermissionRoute permission="admin_users">
                {renderLazyPage(AdminUsersPage)}
              </PermissionRoute>
            }
          />
        </Route>
      </Route>

      <Route path="*" element={renderLazyPage(NotFoundPage)} />
    </Routes>
  )
}

export default App

