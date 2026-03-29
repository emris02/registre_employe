import React from 'react'
import { BrowserRouter as Router, Navigate, Route, Routes } from 'react-router-dom'
import DashboardLayout from './components/layout/DashboardLayout'
import ProtectedRoute from './components/ProtectedRoute'
// import LandingPage from './pages/LandingPage'
import LoginPage from './pages/LoginPage'
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage'
import ResetPasswordPage from './pages/auth/ResetPasswordPage'
import AdminResetPasswordPage from './pages/admin/AdminResetPasswordPage'

import AdminDashboard from './pages/admin/Dashboard'
import AdminProfilePage from './pages/admin/AdminProfilePage'
import AdminDetailPage from './pages/admin/AdminDetailPage'
import AdminListPage from './pages/admin/AdminListPage'
import AdminNewPage from './pages/admin/AdminNewPage'
import BadgeManagementPage from './pages/admin/BadgeManagementPage'
import EmployeDetailPage from './pages/admin/EmployeDetailPage'
import EmployeListPage from './pages/admin/EmployeListPage'
import EmployeNewPage from './pages/admin/EmployeNewPage'
import PointageViewPage from './pages/admin/PointageViewPage'
import PointageListPage from './pages/admin/PointageListPage'
import TestPointagePage from './pages/admin/TestPointagePage'
import DebugPointage from './pages/admin/DebugPointage'
import AdminReportsPage from './pages/admin/AdminReportsPage'
import AdminSettingsPage from './pages/admin/AdminSettingsPage'
import AdminNotificationsPage from './pages/admin/AdminNotificationsPage'
import RolesManagementPage from './pages/admin/RolesManagementPage'

import EmployeeDashboard from './pages/employe/Dashboard'
import BadgePage from './pages/employe/BadgePage'
import HeuresPage from './pages/employe/HeuresPage'
import EmployeeReportsPage from './pages/employe/ReportsPage'
import RetardsPage from './pages/employe/RetardsPage'
import NotificationsPage from './pages/employe/NotificationsPage'
import ScanQRPage from './pages/ScanQRPage'
import SettingsPage from './pages/employe/SettingsPage'

const adminSectionRoutes = ['demandes', 'calendrier']
const employeeSectionRoutes = ['pointage', 'historique', 'demandes', 'profil', 'calendrier']
const employeLegacyRoutes = ['dashboard', 'pointage', 'historique', 'demandes', 'profil', 'calendrier', 'badge', 'heures', 'retards', 'settings', 'parametres', 'rapports']
const adminPortalRoles = ['admin', 'super_admin', 'manager', 'hr'] as const
const employeePortalRoles = ['employe', 'chef_departement', 'stagiaire'] as const
const mapLegacyEmployePath = (path: string) => {
  if (path === 'parametres') return 'settings'
  return path
}

function App() {
  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        {/* <Route path="/" element={<LandingPage />} /> */}
        <Route path="/" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route 
          path="/scan" 
          element={
            <ProtectedRoute requiredRoles={['admin', 'super_admin', 'manager', 'hr']}>
              <ScanQRPage />
            </ProtectedRoute>
          } 
        />
        <Route path="/scan-qr" element={<Navigate to="/scan" replace />} />

        <Route
          path="/admin"
          element={(
            <ProtectedRoute requiredRoles={[...adminPortalRoles]}>
              <DashboardLayout />
            </ProtectedRoute>
          )}
        >
          <Route index element={<AdminDashboard />} />
          <Route path="dashboard" element={<Navigate to="/admin" replace />} />

          <Route path="employes" element={<EmployeListPage />} />
          <Route path="employes/new" element={<EmployeNewPage />} />
          <Route path="employes/:id" element={<EmployeDetailPage />} />
          <Route path="employes/:id/edit" element={<EmployeDetailPage />} />

          <Route path="employe" element={<Navigate to="/admin/employes" replace />} />
          <Route path="employe/new" element={<Navigate to="/admin/employes/new" replace />} />
          <Route path="employe/:id" element={<EmployeDetailPage />} />
          <Route path="employe/:id/edit" element={<EmployeDetailPage />} />

          <Route path="pointages" element={<PointageListPage />} />
          <Route path="pointages/:id" element={<PointageViewPage />} />
          <Route path="test-pointage" element={<TestPointagePage />} />
          <Route path="debug-pointage" element={<DebugPointage />} />

          {adminSectionRoutes.map((path) => (
            <Route key={path} path={path} element={<AdminDashboard />} />
          ))}

          <Route path="badges" element={<BadgeManagementPage />} />
          <Route path="roles" element={<RolesManagementPage />} />
          <Route path="admins/:id" element={<AdminDetailPage />} />
          <Route path="admins" element={<AdminListPage />} />
          <Route path="admins/new" element={<AdminNewPage />} />
          <Route path="profil" element={<AdminProfilePage />} />
          <Route path="rapports" element={<AdminReportsPage />} />
          <Route path="parametres" element={<AdminSettingsPage />} />
          <Route path="notifications" element={<AdminNotificationsPage />} />
          <Route path="reset-password" element={<AdminResetPasswordPage />} />

          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Route>

        <Route
          path="/employee"
          element={(
            <ProtectedRoute requiredRoles={[...employeePortalRoles]}>
              <DashboardLayout />
            </ProtectedRoute>
          )}
        >
          <Route index element={<EmployeeDashboard />} />
          <Route path="dashboard" element={<Navigate to="/employee" replace />} />

          {employeeSectionRoutes.map((path) => (
            <Route key={path} path={path} element={<EmployeeDashboard />} />
          ))}

          <Route path="badge" element={<BadgePage />} />
          <Route path="scan-qr" element={<Navigate to="/scan" replace />} />
          <Route path="heures" element={<HeuresPage />} />
          <Route path="rapports" element={<EmployeeReportsPage />} />
          <Route path="retards" element={<RetardsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="parametres" element={<Navigate to="/employee/settings" replace />} />

          <Route path="*" element={<Navigate to="/employee" replace />} />
        </Route>

        <Route path="/admin/dashboard" element={<Navigate to="/admin" replace />} />
        <Route path="/employe" element={<Navigate to="/employee" replace />} />
        <Route path="/employeee" element={<Navigate to="/employee" replace />} />
        <Route path="/employe/scan" element={<Navigate to="/scan" replace />} />
        {employeLegacyRoutes.map((path) => (
          <Route key={path} path={`/employe/${path}`} element={<Navigate to={`/employee/${mapLegacyEmployePath(path)}`} replace />} />
        ))}

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  )
}

export default App
