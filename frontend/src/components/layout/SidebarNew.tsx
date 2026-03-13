import React from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  Calendar,
  Bell,
  Clock,
  FileText,
  IdCard,
  LayoutDashboard,
  LogOut,
  Settings,
  ShieldCheck,
  TrendingUp,
  UserCheck,
  Users,
  UserCog,
  X,
  QrCode
} from 'lucide-react'
import { cn } from '../../utils/cn'
import { useAuth } from '../../services/authService'

interface SidebarItem {
  id: string
  label: string
  icon: React.ReactNode
  path: string
  badge?: string | number
}

interface SidebarSection {
  title: string
  items: SidebarItem[]
}

interface SidebarProps {
  isOpen: boolean
  onClose: () => void
  variant?: 'desktop' | 'mobile'
  collapsed?: boolean
}

const adminSections: SidebarSection[] = [
  {
    title: 'Principal',
    items: [
      { id: 'dashboard', label: 'Tableau de bord', icon: <LayoutDashboard className="php-nav-icon" />, path: '/admin' },
      { id: 'employes', label: 'Employes', icon: <Users className="php-nav-icon" />, path: '/admin/employes' },
      { id: 'pointages', label: 'Pointages', icon: <Clock className="php-nav-icon" />, path: '/admin/pointages' },
      { id: 'scan', label: 'Zone de scan', icon: <QrCode className="php-nav-icon" />, path: '/scan' },
      { id: 'demandes', label: 'Demandes', icon: <FileText className="php-nav-icon" />, path: '/admin/demandes' },
      { id: 'notifications', label: 'Notifications', icon: <Bell className="php-nav-icon" />, path: '/admin/notifications' }
    ]
  },
  {
    title: 'Pilotage',
    items: [
      { id: 'calendrier', label: 'Calendrier', icon: <Calendar className="php-nav-icon" />, path: '/admin/calendrier' },
      { id: 'rapports', label: 'Rapports', icon: <TrendingUp className="php-nav-icon" />, path: '/admin/rapports' }
    ]
  },
  {
    title: 'Administration',
    items: [
      { id: 'badges', label: 'Badges', icon: <IdCard className="php-nav-icon" />, path: '/admin/badges' },
      { id: 'roles', label: 'Roles', icon: <ShieldCheck className="php-nav-icon" />, path: '/admin/roles' },
      { id: 'admins', label: 'Admins', icon: <UserCog className="php-nav-icon" />, path: '/admin/admins' },
      { id: 'profil', label: 'Mon profil', icon: <UserCheck className="php-nav-icon" />, path: '/admin/profil' },
      { id: 'parametres', label: 'Parametres', icon: <Settings className="php-nav-icon" />, path: '/admin/parametres' }
    ]
  }
]

const employeeSections: SidebarSection[] = [
  {
    title: 'Mon Espace',
    items: [
      { id: 'dashboard', label: 'Tableau de bord', icon: <UserCheck className="php-nav-icon" />, path: '/employee' },
      { id: 'pointage', label: 'Pointage', icon: <Clock className="php-nav-icon" />, path: '/employee/pointage' },
      { id: 'demandes', label: 'Mes demandes', icon: <Calendar className="php-nav-icon" />, path: '/employee/demandes' },
      { id: 'calendrier', label: 'Calendrier', icon: <Calendar className="php-nav-icon" />, path: '/employee/calendrier' },
      { id: 'profil', label: 'Mon profil', icon: <UserCog className="php-nav-icon" />, path: '/employee/profil' },
      { id: 'historique', label: 'Historique', icon: <FileText className="php-nav-icon" />, path: '/employee/historique' },
      { id: 'notifications', label: 'Notifications', icon: <Bell className="php-nav-icon" />, path: '/employee/notifications' }
    ]
  },
  {
    title: 'Compte',
    items: [
      { id: 'badge', label: 'Mon badge QR', icon: <IdCard className="php-nav-icon" />, path: '/employee/badge' },
      { id: 'rapports', label: 'Rapports', icon: <TrendingUp className="php-nav-icon" />, path: '/employee/rapports' },
      { id: 'heures', label: 'Mes heures', icon: <TrendingUp className="php-nav-icon" />, path: '/employee/heures' },
      { id: 'retards', label: 'Retards', icon: <Clock className="php-nav-icon" />, path: '/employee/retards' },
      { id: 'settings', label: 'Parametres', icon: <Settings className="php-nav-icon" />, path: '/employee/settings' }
    ]
  }
]

const Sidebar = ({ isOpen, onClose, variant = 'desktop', collapsed = false }: SidebarProps) => {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const isAdminRoute = location.pathname.startsWith('/admin')
  const sections = isAdminRoute ? adminSections : employeeSections

  const isItemActive = (path: string) => {
    if (path === '/admin' || path === '/employee') {
      return location.pathname === path || location.pathname === `${path}/dashboard`
    }

    return location.pathname === path || location.pathname.startsWith(`${path}/`)
  }

  const initials = `${user?.prenom?.[0] || ''}${user?.nom?.[0] || ''}`.toUpperCase() || 'XP'

  const handleNavigate = () => {
    if (variant === 'mobile') {
      onClose()
    }
  }

  return (
    <>
      {variant === 'mobile' && isOpen && <div className="php-sidebar-overlay" onClick={onClose} aria-hidden="true" />}

      <aside
        className={cn(
          'php-sidebar',
          variant === 'desktop' ? 'php-sidebar-desktop' : 'php-sidebar-mobile',
          variant === 'desktop' && collapsed && 'is-collapsed',
          variant === 'mobile' && isOpen && 'is-open'
        )}
      >
        <div className="php-sidebar-header">
          <div className="php-sidebar-brand">
            <span className="php-sidebar-logo">XP</span>
            <div>
              <h1>Xpert Pro</h1>
              <small>{isAdminRoute ? 'Administration' : 'Espace employe'}</small>
            </div>
          </div>

          {variant === 'mobile' && (
            <button className="php-menu-button" onClick={onClose} aria-label="Fermer la navigation">
              <X size={16} />
            </button>
          )}
        </div>

        <nav className="php-sidebar-nav">
          {sections.map((section) => (
            <div className="php-nav-section" key={section.title}>
              <div className="php-nav-section-title">{section.title}</div>
              {section.items.map((item) => (
                <NavLink
                  key={item.id}
                  to={item.path}
                  target={item.id === 'scan' ? '_blank' : undefined}
                  rel={item.id === 'scan' ? 'noopener noreferrer' : undefined}
                  onClick={handleNavigate}
                  className={cn('php-nav-link', isItemActive(item.path) && 'is-active')}
                  title={collapsed ? item.label : undefined}
                >
                  {item.icon}
                  <span className="php-nav-label">{item.label}</span>
                  {item.badge ? <span className="php-nav-badge">{item.badge}</span> : null}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="php-sidebar-footer">
          <div className="php-sidebar-user">
            <span className="php-sidebar-avatar">{initials}</span>
            <div>
              <strong>{user?.prenom || 'Utilisateur'} {user?.nom || ''}</strong>
              <small>{isAdminRoute ? 'Admin' : 'Employe'}</small>
            </div>
          </div>

          <button
            className="php-sidebar-logout"
            type="button"
            onClick={() => {
              const confirmed = window.confirm('Voulez-vous vraiment vous deconnecter ?')
              if (!confirmed) return
              logout()
              navigate('/login')
            }}
            aria-label="Deconnexion"
          >
            <LogOut size={15} />
            <span>Deconnexion</span>
          </button>
        </div>
      </aside>
    </>
  )
}

export default Sidebar
