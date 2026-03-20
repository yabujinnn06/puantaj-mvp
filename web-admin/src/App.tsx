import { Navigate, Route, Routes } from 'react-router-dom'

import { AppLayout } from './components/AppLayout'
import { AuthGuard } from './auth/AuthGuard'
import { DefaultAdminRoute, PermissionRoute } from './auth/PermissionRoute'
import { PublicOnlyRoute } from './auth/PublicOnlyRoute'
import { AdminDeviceClaimPage } from './pages/AdminDeviceClaimPage'
import { AttendanceEventsPage } from './pages/AttendanceEventsPage'
import { DepartmentSummaryReportPage } from './pages/DepartmentSummaryReportPage'
import { DepartmentsPage } from './pages/DepartmentsPage'
import { DevicesPage } from './pages/DevicesPage'
import { ComplianceSettingsPage } from './pages/ComplianceSettingsPage'
import { ArchivePasswordDownloadPage } from './pages/ArchivePasswordDownloadPage'
import { AttendanceExtraCheckinApprovalPage } from './pages/AttendanceExtraCheckinApprovalPage'
import { AdminUsersPage } from './pages/AdminUsersPage'
import { EmployeeDetailPage } from './pages/EmployeeDetailPage'
import { EmployeeMonthlyReportPage } from './pages/EmployeeMonthlyReportPage'
import { EmployeesPage } from './pages/EmployeesPage'
import { LeavesPage } from './pages/LeavesPage'
import { LoginPage } from './pages/LoginPage'
import { LocationMonitorPage } from './pages/LocationMonitorPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { PuantajExportPage } from './pages/PuantajExportPage'
import { QrCodesPage } from './pages/QrCodesPage'
import { QuickSetupPage } from './pages/QuickSetupPage'
import { RegionsPage } from './pages/RegionsPage'
import { NotificationsPage } from './pages/NotificationsPage'
import { SystemLogsPage } from './pages/SystemLogsPage'
import { WorkRulesPage } from './pages/WorkRulesPage'

function App() {
  return (
    <Routes>
      <Route element={<PublicOnlyRoute />}>
        <Route path="/login" element={<LoginPage />} />
      </Route>

      <Route path="/device-claim" element={<AdminDeviceClaimPage />} />
      <Route path="/archive-download" element={<ArchivePasswordDownloadPage />} />
      <Route path="/attendance-extra-checkin-approval" element={<AttendanceExtraCheckinApprovalPage />} />

      <Route element={<AuthGuard />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<DefaultAdminRoute />} />
          <Route path="/management-console" element={<Navigate to="/log" replace />} />
          <Route
            path="/log"
            element={
              <PermissionRoute permission="log">
                <LocationMonitorPage />
              </PermissionRoute>
            }
          />
          <Route path="/location-monitor" element={<Navigate to="/log" replace />} />
          <Route path="/control-room" element={<Navigate to="/log" replace />} />
          <Route path="/dashboard" element={<Navigate to="/log" replace />} />
          <Route
            path="/regions"
            element={
              <PermissionRoute permission="regions">
                <RegionsPage />
              </PermissionRoute>
            }
          />
          <Route
            path="/departments"
            element={
              <PermissionRoute permission="departments">
                <DepartmentsPage />
              </PermissionRoute>
            }
          />
          <Route
            path="/employees"
            element={
              <PermissionRoute permission="employees">
                <EmployeesPage />
              </PermissionRoute>
            }
          />
          <Route
            path="/employees/:id"
            element={
              <PermissionRoute permission="employees">
                <EmployeeDetailPage />
              </PermissionRoute>
            }
          />
          <Route
            path="/quick-setup"
            element={
              <PermissionRoute permission="schedule">
                <QuickSetupPage />
              </PermissionRoute>
            }
          />
          <Route
            path="/work-rules"
            element={
              <PermissionRoute permission="work_rules">
                <WorkRulesPage />
              </PermissionRoute>
            }
          />
          <Route
            path="/attendance-events"
            element={
              <PermissionRoute permission="attendance_events">
                <AttendanceEventsPage />
              </PermissionRoute>
            }
          />
          <Route
            path="/devices"
            element={
              <PermissionRoute permission="devices">
                <DevicesPage />
              </PermissionRoute>
            }
          />
          <Route
            path="/compliance-settings"
            element={
              <PermissionRoute permission="compliance">
                <ComplianceSettingsPage />
              </PermissionRoute>
            }
          />
          <Route
            path="/leaves"
            element={
              <PermissionRoute permission="leaves">
                <LeavesPage />
              </PermissionRoute>
            }
          />
          <Route
            path="/qr-kodlar"
            element={
              <PermissionRoute permission="qr_codes">
                <QrCodesPage />
              </PermissionRoute>
            }
          />
          <Route
            path="/reports/employee-monthly"
            element={
              <PermissionRoute permission="reports">
                <EmployeeMonthlyReportPage />
              </PermissionRoute>
            }
          />
          <Route
            path="/reports/department-summary"
            element={
              <PermissionRoute permission="reports">
                <DepartmentSummaryReportPage />
              </PermissionRoute>
            }
          />
          <Route
            path="/reports/excel-export"
            element={
              <PermissionRoute permission="reports">
                <PuantajExportPage />
              </PermissionRoute>
            }
          />
          <Route
            path="/notifications"
            element={
              <PermissionRoute permission="notifications">
                <NotificationsPage />
              </PermissionRoute>
            }
          />
          <Route
            path="/audit-logs"
            element={
              <PermissionRoute permission="audit_logs">
                <SystemLogsPage />
              </PermissionRoute>
            }
          />
          <Route
            path="/admin-users"
            element={
              <PermissionRoute permission="admin_users">
                <AdminUsersPage />
              </PermissionRoute>
            }
          />
        </Route>
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}

export default App

