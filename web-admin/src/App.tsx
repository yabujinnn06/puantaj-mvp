import { Navigate, Route, Routes } from 'react-router-dom'

import { AppLayout } from './components/AppLayout'
import { AuthGuard } from './auth/AuthGuard'
import { PublicOnlyRoute } from './auth/PublicOnlyRoute'
import { AdminDeviceClaimPage } from './pages/AdminDeviceClaimPage'
import { AttendanceEventsPage } from './pages/AttendanceEventsPage'
import { DashboardPage } from './pages/DashboardPage'
import { DepartmentSummaryReportPage } from './pages/DepartmentSummaryReportPage'
import { DepartmentsPage } from './pages/DepartmentsPage'
import { DevicesPage } from './pages/DevicesPage'
import { ComplianceSettingsPage } from './pages/ComplianceSettingsPage'
import { ArchivePasswordDownloadPage } from './pages/ArchivePasswordDownloadPage'
import { AdminUsersPage } from './pages/AdminUsersPage'
import { EmployeeDetailPage } from './pages/EmployeeDetailPage'
import { EmployeeMonthlyReportPage } from './pages/EmployeeMonthlyReportPage'
import { EmployeesPage } from './pages/EmployeesPage'
import { LeavesPage } from './pages/LeavesPage'
import { LoginPage } from './pages/LoginPage'
import { ManagementConsolePage } from './pages/ManagementConsolePage'
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

      <Route element={<AuthGuard />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/management-console" element={<ManagementConsolePage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/regions" element={<RegionsPage />} />
          <Route path="/departments" element={<DepartmentsPage />} />
          <Route path="/employees" element={<EmployeesPage />} />
          <Route path="/employees/:id" element={<EmployeeDetailPage />} />
          <Route path="/quick-setup" element={<QuickSetupPage />} />
          <Route path="/work-rules" element={<WorkRulesPage />} />
          <Route path="/attendance-events" element={<AttendanceEventsPage />} />
          <Route path="/devices" element={<DevicesPage />} />
          <Route path="/compliance-settings" element={<ComplianceSettingsPage />} />
          <Route path="/leaves" element={<LeavesPage />} />
          <Route path="/qr-kodlar" element={<QrCodesPage />} />
          <Route path="/reports/employee-monthly" element={<EmployeeMonthlyReportPage />} />
          <Route path="/reports/department-summary" element={<DepartmentSummaryReportPage />} />
          <Route path="/reports/excel-export" element={<PuantajExportPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/audit-logs" element={<SystemLogsPage />} />
          <Route path="/admin-users" element={<AdminUsersPage />} />
        </Route>
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}

export default App

