import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlignJustify, Bell, Coffee, Menu, X } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../services/authService'
import { adminService } from '../../services/adminService'
import { apiClient } from '../../services/apiClient'

interface TopbarProps {
  onMenuClick: () => void
  onToggleSidebar: () => void
  sidebarCollapsed: boolean
  title?: string
  subtitle?: string
}

type NotificationLevel = 'success' | 'warning' | 'danger' | 'info'

interface TopbarNotification {
  id: string
  dbId: number | null
  type: string
  title: string
  message: string
  createdAt: string
  level: NotificationLevel
  read: boolean
  lien: string | null
  entityKind: string | null
  entityId: number | null
}

interface ToastItem {
  id: string
  title: string
  message: string
  level: NotificationLevel
}

interface PauseStatusPayload {
  has_open_shift: boolean
  has_open_pause: boolean
  pause_limit_minutes: number
  used_pause_minutes: number
  remaining_pause_minutes: number
  work_end_time: string
}

const ADMIN_ROLES = new Set(['admin', 'super_admin', 'manager', 'hr'])
const EMPLOYEE_ROLES = new Set(['employe', 'chef_departement', 'comptable', 'stagiaire'])

const normalizeLevel = (value: unknown, type?: unknown): NotificationLevel => {
  const raw = String(value || '').trim().toLowerCase()
  if (raw === 'danger') return 'danger'
  if (raw === 'warning') return 'warning'
  if (raw === 'info') return 'info'
  if (raw === 'success') return 'success'

  const normalizedType = String(type || '').trim().toLowerCase()
  if (normalizedType.includes('absence')) return 'danger'
  if (normalizedType.includes('retard') || normalizedType.includes('demande')) return 'warning'
  if (normalizedType.includes('badge')) return 'info'
  if (normalizedType.includes('event') || normalizedType.includes('evenement') || normalizedType.includes('calendrier')) return 'info'
  return 'success'
}

const parseDbNotificationId = (rawId: unknown, rawDbId: unknown) => {
  const directDbId = Number(rawDbId || 0)
  if (Number.isInteger(directDbId) && directDbId > 0) return directDbId

  const id = String(rawId || '').trim()
  if (id.startsWith('notification-')) {
    const parsed = Number(id.replace('notification-', ''))
    if (Number.isInteger(parsed) && parsed > 0) return parsed
  }

  const numeric = Number(id)
  if (Number.isInteger(numeric) && numeric > 0) return numeric
  return null
}

const normalizeNotificationType = (value: unknown) => {
  const raw = String(value || '').trim().toLowerCase()
  if (raw.includes('retard')) return 'retard'
  if (raw.includes('demande')) return 'demande'
  if (raw.includes('absence')) return 'absence'
  if (raw.includes('badge')) return 'badge'
  if (raw.includes('event') || raw.includes('evenement') || raw.includes('calendrier')) return 'evenement'
  return 'pointage'
}

const Topbar = ({ onMenuClick, onToggleSidebar, sidebarCollapsed, title, subtitle }: TopbarProps) => {
  const { user } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [now, setNow] = useState(new Date())
  const [showNotifications, setShowNotifications] = useState(false)
  const [loadingNotifications, setLoadingNotifications] = useState(false)
  const [notificationError, setNotificationError] = useState<string | null>(null)
  const [notifications, setNotifications] = useState<TopbarNotification[]>([])
  const [selectedNotification, setSelectedNotification] = useState<TopbarNotification | null>(null)
  const [deletingNotification, setDeletingNotification] = useState(false)
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [pauseStatus, setPauseStatus] = useState<PauseStatusPayload | null>(null)
  const [pauseBusy, setPauseBusy] = useState(false)
  const [pauseError, setPauseError] = useState<string | null>(null)
  const [showPauseModal, setShowPauseModal] = useState(false)
  const [pauseDurationInput, setPauseDurationInput] = useState('15')
  const [pauseReasonInput, setPauseReasonInput] = useState('')
  const notificationRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!showNotifications) return
      const target = event.target as Node | null
      if (notificationRef.current && target && !notificationRef.current.contains(target)) {
        setShowNotifications(false)
      }
    }
    window.addEventListener('mousedown', handleClickOutside)
    return () => window.removeEventListener('mousedown', handleClickOutside)
  }, [showNotifications])

  const initials = useMemo(() => {
    return `${user?.prenom?.[0] || ''}${user?.nom?.[0] || ''}`.toUpperCase() || 'XP'
  }, [user?.nom, user?.prenom])

  const role = String(user?.role || '').trim().toLowerCase()
  const isAdminRoute = location.pathname.startsWith('/admin')
  const isEmployeeRoute = location.pathname.startsWith('/employee')
  const isAdminUser = ADMIN_ROLES.has(role)
  const isEmployeeUser = EMPLOYEE_ROLES.has(role)
  const canManageNotifications = (isAdminRoute && isAdminUser) || (isEmployeeRoute && isEmployeeUser)
  const canManagePause = isEmployeeRoute && isEmployeeUser
  const unreadCount = notifications.filter((item) => !item.read).length
  const maxPauseMinutes = Number(pauseStatus?.remaining_pause_minutes || 0)

  const enqueueToast = useCallback((toast: ToastItem) => {
    setToasts((previous) => {
      if (previous.some((item) => item.id === toast.id)) return previous
      return [toast, ...previous].slice(0, 4)
    })

    window.setTimeout(() => {
      setToasts((previous) => previous.filter((item) => item.id !== toast.id))
    }, 6000)
  }, [])

  const fetchNotifications = useCallback(async () => {
    if (!canManageNotifications) {
      setNotifications([])
      return
    }

    try {
      setLoadingNotifications(true)
      setNotificationError(null)
      let mappedNotifications: TopbarNotification[] = []

      if (isAdminRoute && isAdminUser) {
        const summary = await adminService.getNotifications({ limit: 20 })
        mappedNotifications = (summary.items || []).map((item, index) => ({
          id: String(item.id || `admin-notification-${index}`),
          dbId: parseDbNotificationId(item.id, null),
          type: String(item.type || 'pointage'),
          title: String(item.title || 'Notification'),
          message: String(item.message || ''),
          createdAt: String(item.created_at || new Date().toISOString()),
          level: normalizeLevel(item.level, item.type),
          read: Boolean(item.lue ?? item.read ?? false),
          lien: null,
          entityKind: String(item.entity_kind || item.type || ''),
          entityId: Number(item.entity_id || 0) || null
        }))
      } else {
        const response = await apiClient.get<any>('/api/notifications?limit=20')
        const rows = Array.isArray(response?.notifications)
          ? response.notifications
          : Array.isArray(response?.items)
            ? response.items
            : []

        mappedNotifications = rows.map((row: any, index: number) => ({
          id: String(row?.id || `employee-notification-${index}`),
          dbId: parseDbNotificationId(row?.id, row?.db_id ?? row?.dbId),
          type: String(row?.type || 'pointage'),
          title: String(row?.title || row?.titre || 'Notification'),
          message: String(row?.message || row?.contenu || ''),
          createdAt: String(row?.created_at || row?.date_creation || row?.date || new Date().toISOString()),
          level: normalizeLevel(row?.level, row?.type),
          read: Boolean(row?.lue ?? row?.read ?? false),
          lien: row?.lien ? String(row.lien) : null,
          entityKind: row?.entity_kind ? String(row.entity_kind) : null,
          entityId: Number(row?.entity_id || row?.pointage_id || 0) || null
        }))
      }

      mappedNotifications.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())

      setNotifications(mappedNotifications.slice(0, 40))
    } catch (error: any) {
      const status = Number(error?.status || 0)
      if (status === 404) {
        setNotificationError(null)
        setNotifications([])
        return
      }
      console.error('Erreur chargement notifications topbar:', error)
      setNotificationError(error?.message || 'Notifications indisponibles')
    } finally {
      setLoadingNotifications(false)
    }
  }, [canManageNotifications, isAdminRoute, isAdminUser])

  const fetchPauseStatus = useCallback(async () => {
    if (!canManagePause) {
      setPauseStatus(null)
      setPauseError(null)
      return
    }

    try {
      setPauseError(null)
      const response = await apiClient.get<{ success?: boolean; pause_status?: PauseStatusPayload }>('/api/employe/pause/status')
      setPauseStatus(response?.pause_status || null)
    } catch (error: any) {
      console.error('Erreur chargement pause status:', error)
      setPauseStatus(null)
      setPauseError(error?.message || 'Etat de pause indisponible')
    }
  }, [canManagePause])

  useEffect(() => {
    void fetchNotifications()
    if (!canManageNotifications) return
    const interval = window.setInterval(() => {
      void fetchNotifications()
    }, 25000)
    return () => window.clearInterval(interval)
  }, [canManageNotifications, fetchNotifications])

  useEffect(() => {
    void fetchPauseStatus()
    if (!canManagePause) return
    const interval = window.setInterval(() => {
      void fetchPauseStatus()
    }, 15000)
    return () => window.clearInterval(interval)
  }, [canManagePause, fetchPauseStatus])

  const markNotificationAsRead = useCallback(async (notification: TopbarNotification) => {
    if (notification.read) return
    setNotifications((previous) => previous.map((item) => (
      item.id === notification.id ? { ...item, read: true } : item
    )))

    if (isAdminRoute && isAdminUser) {
      try {
        await adminService.markNotificationAsRead(notification.id, true)
      } catch (adminReadError) {
        setNotifications((previous) => previous.map((item) => (
          item.id === notification.id ? { ...item, read: false } : item
        )))
        console.error('Erreur maj notification admin/read:', adminReadError)
      }
      return
    }

    const targetId = Number(notification.dbId || 0)
    if (!Number.isInteger(targetId) || targetId <= 0) return

    try {
      await apiClient.put(`/api/notifications/${targetId}/read`, { read: true })
    } catch (firstError: any) {
      try {
        await apiClient.put(`/api/notifications/${targetId}/read`, { read: true })
      } catch (secondError) {
        console.error('Erreur maj notification read:', secondError || firstError)
      }
    }
  }, [isAdminRoute, isAdminUser])

  const handleNotificationClick = useCallback(async (notification: TopbarNotification) => {
    await markNotificationAsRead(notification)
    setSelectedNotification(notification)
    setShowNotifications(false)
  }, [markNotificationAsRead])

  const handleOpenNotificationsPage = useCallback(() => {
    setShowNotifications(false)
    const basePath = isAdminRoute && isAdminUser ? '/admin/notifications' : '/employee/notifications'
    navigate(basePath)
  }, [isAdminRoute, isAdminUser, navigate])

  const handleOpenNotificationListForType = useCallback((notification: TopbarNotification) => {
    const normalizedType = normalizeNotificationType(notification.entityKind || notification.type)
    const basePath = isAdminRoute && isAdminUser ? '/admin/notifications' : '/employee/notifications'
    navigate(`${basePath}?type=${encodeURIComponent(normalizedType)}`)
    setSelectedNotification(null)
  }, [isAdminRoute, isAdminUser, navigate])

  const handleDeleteNotification = useCallback(async (notification: TopbarNotification) => {
    try {
      setDeletingNotification(true)
      setNotificationError(null)

      if (isAdminRoute && isAdminUser) {
        await adminService.deleteNotification(notification.id)
      } else {
        const targetId = Number(notification.dbId || 0)
        if (!Number.isInteger(targetId) || targetId <= 0) {
          throw new Error('Identifiant notification invalide')
        }
        try {
          await apiClient.delete(`/api/admin/notifications/${targetId}`)
        } catch {
          await apiClient.delete(`/api/notifications/${targetId}`)
        }
      }

      setNotifications((previous) => previous.filter((item) => item.id !== notification.id))
      setSelectedNotification(null)
      await fetchNotifications()
    } catch (deleteError: any) {
      setNotificationError(deleteError?.message || 'Suppression impossible')
    } finally {
      setDeletingNotification(false)
    }
  }, [fetchNotifications, isAdminRoute, isAdminUser])

  const handleMarkAllAsRead = useCallback(async () => {
    const unread = notifications.filter((item) => !item.read)
    if (unread.length === 0) return
    try {
      setNotificationError(null)

      if (isAdminRoute && isAdminUser) {
        try {
          await apiClient.put<{ notification_ids: string[] }, { success?: boolean }>(
            '/api/admin/notifications/read-all',
            { notification_ids: notifications.map((item) => item.id) }
          )
        } catch {
          await Promise.all(unread.map((item) => markNotificationAsRead(item)))
        }
      } else {
        await Promise.all(unread.map((item) => markNotificationAsRead(item)))
      }

      setNotifications((previous) => previous.map((item) => ({ ...item, read: true })))
      await fetchNotifications()
    } catch (error: any) {
      setNotificationError(error?.message || 'Lecture globale impossible')
    }
  }, [fetchNotifications, isAdminRoute, isAdminUser, markNotificationAsRead, notifications])

  const handleTogglePause = useCallback(async (options?: { forcedAction?: 'start' | 'end'; durationMinutes?: number; reason?: string }) => {
    if (!canManagePause || pauseBusy) return
    try {
      setPauseBusy(true)
      setPauseError(null)
      const action = options?.forcedAction || (pauseStatus?.has_open_pause ? 'end' : 'start')
      const requestedMinutes = Number(options?.durationMinutes || 0)
      const safeMinutes = Number.isInteger(requestedMinutes) && requestedMinutes > 0 ? requestedMinutes : undefined
      const reason = String(options?.reason || '').trim()
      const response = await apiClient.post<
      {
        action: string
        requested_minutes?: number
        pause_reason?: string
      },
      any
      >('/api/employe/pause/toggle', {
        action,
        ...(safeMinutes ? { requested_minutes: safeMinutes } : {}),
        ...(reason ? { pause_reason: reason } : {})
      })
      if (response?.pause_status) {
        setPauseStatus(response.pause_status as PauseStatusPayload)
      } else {
        await fetchPauseStatus()
      }
      enqueueToast({
        id: `toast-pause-${Date.now()}`,
        title: pauseStatus?.has_open_pause ? 'Pause terminee' : 'Pause demarree',
        message: String(response?.message || 'Mise a jour pause effectuee.'),
        level: 'info'
      })
      setShowPauseModal(false)
      setPauseDurationInput('15')
      setPauseReasonInput('')
      void fetchNotifications()
    } catch (error: any) {
      const message = error?.message || "Impossible de gerer la pause."
      setPauseError(message)
      enqueueToast({
        id: `toast-pause-error-${Date.now()}`,
        title: 'Pause indisponible',
        message,
        level: 'danger'
      })
    } finally {
      setPauseBusy(false)
    }
  }, [canManagePause, enqueueToast, fetchNotifications, fetchPauseStatus, pauseBusy, pauseStatus?.has_open_pause])

  const openPauseModal = useCallback(() => {
    if (!canManagePause) return
    const remaining = Number(pauseStatus?.remaining_pause_minutes || 15)
    const defaultMinutes = Math.max(1, Math.min(15, remaining))
    setPauseDurationInput(String(defaultMinutes))
    setPauseReasonInput('')
    setPauseError(null)
    setShowPauseModal(true)
    if (!pauseStatus) {
      void fetchPauseStatus()
    }
  }, [canManagePause, fetchPauseStatus, pauseStatus])

  const handlePauseModalSubmit = useCallback(async () => {
    if (!pauseStatus) return
    if (pauseStatus.has_open_pause) {
      await handleTogglePause({ forcedAction: 'end' })
      return
    }

    if (!pauseStatus.has_open_shift) {
      setPauseError("Aucune arrivee active. Pointez d'abord votre arrivee.")
      return
    }

    const parsedMinutes = Number.parseInt(String(pauseDurationInput || '').trim(), 10)
    if (!Number.isInteger(parsedMinutes) || parsedMinutes <= 0) {
      setPauseError('Le temps de pause doit etre un nombre positif en minutes.')
      return
    }

    if (parsedMinutes > Number(pauseStatus.remaining_pause_minutes || 0)) {
      setPauseError(`Le quota disponible est ${pauseStatus.remaining_pause_minutes} min.`)
      return
    }

    await handleTogglePause({
      forcedAction: 'start',
      durationMinutes: parsedMinutes,
      reason: pauseReasonInput
    })
  }, [handleTogglePause, pauseDurationInput, pauseReasonInput, pauseStatus])

  const pauseLabel = useMemo(() => {
    if (!pauseStatus) return 'Pause'
    if (pauseStatus.has_open_pause) {
      return `Pause ${pauseStatus.used_pause_minutes}/${pauseStatus.pause_limit_minutes} min`
    }
    if (!pauseStatus.has_open_shift) return 'Pause'
    return `Pause ${pauseStatus.remaining_pause_minutes} min rest.`
  }, [pauseStatus])

  const getLevelClassName = (level: NotificationLevel) => {
    if (level === 'danger') return 'is-danger'
    if (level === 'warning') return 'is-warning'
    if (level === 'info') return 'is-info'
    return 'is-success'
  }

  const getNotificationTypeLabel = (type: string) => {
    const normalized = normalizeNotificationType(type)
    if (normalized === 'retard') return 'Retard'
    if (normalized === 'demande') return 'Demande'
    if (normalized === 'absence') return 'Absence'
    if (normalized === 'badge') return 'Badge'
    if (normalized === 'evenement') return 'Evenement'
    return 'Pointage'
  }

  return (
    <>
      <header className="php-topbar">
        <div className="php-topbar-left">
          <button
            className="php-menu-button php-topbar-collapse-btn"
            onClick={onToggleSidebar}
            aria-label={sidebarCollapsed ? 'Etendre la navigation' : 'Retracter la navigation'}
            title={sidebarCollapsed ? 'Etendre la navigation' : 'Retracter la navigation'}
          >
            <AlignJustify size={16} />
          </button>
          <button className="php-menu-button php-topbar-menu-btn" onClick={onMenuClick} aria-label="Ouvrir la navigation">
            <Menu size={16} />
          </button>
          <div>
            {title ? <h1 className="php-topbar-title">{title}</h1> : null}
            {subtitle ? <p className="php-topbar-subtitle">{subtitle}</p> : null}
          </div>
        </div>

        <div className="php-topbar-right">
          {canManagePause ? (
            <button
              type="button"
              onClick={openPauseModal}
              className={`php-topbar-coffee-btn ${pauseStatus?.has_open_pause ? 'is-active' : ''}`}
              disabled={pauseBusy}
              title={pauseLabel}
            >
              <Coffee size={14} />
            </button>
          ) : null}

          {canManagePause ? (
            <button
              type="button"
              className="php-topbar-clock php-topbar-clock-btn"
              onClick={openPauseModal}
              title={pauseLabel}
              disabled={pauseBusy}
            >
              {now.toLocaleTimeString('fr-FR')}
            </button>
          ) : (
            <span className="php-topbar-clock">{now.toLocaleTimeString('fr-FR')}</span>
          )}
          <div className="php-topbar-notif" ref={notificationRef}>
            <button
              className="php-menu-button"
              aria-label="Notifications"
              onClick={() => setShowNotifications((prev) => !prev)}
            >
              <Bell size={16} />
              {unreadCount > 0 ? <span className="php-topbar-notif-count">{Math.min(unreadCount, 99)}</span> : null}
            </button>

            {showNotifications ? (
              <div className="php-topbar-notif-popup">
                <div className="php-topbar-notif-head">
                  <strong>Notifications</strong>
                  <div className="php-topbar-notif-head-actions">
                    <button type="button" onClick={handleMarkAllAsRead}>Tout lire</button>
                    <button type="button" onClick={() => void fetchNotifications()}>Actualiser</button>
                    <button type="button" onClick={handleOpenNotificationsPage}>Voir tout</button>
                  </div>
                </div>

                {pauseError ? (
                  <div className="php-topbar-notif-inline">
                    <span className="php-pill is-warning">{pauseError}</span>
                  </div>
                ) : null}

                {notificationError ? (
                  <div className="php-topbar-notif-inline">
                    <span className="php-pill is-danger">{notificationError}</span>
                  </div>
                ) : null}

                {loadingNotifications ? (
                  <div className="php-topbar-notif-empty">Chargement...</div>
                ) : notifications.length === 0 ? (
                  <div className="php-topbar-notif-empty">Aucune notification.</div>
                ) : (
                  <div className="php-topbar-notif-list">
                    {notifications.slice(0, 20).map((notification) => (
                      <button
                        key={notification.id}
                        type="button"
                        className={`php-topbar-notif-item ${notification.read ? '' : 'is-unread'}`}
                        onClick={() => { void handleNotificationClick(notification) }}
                      >
                        <span className={`php-topbar-notif-dot ${getLevelClassName(notification.level)}`} />
                        <div className="php-topbar-notif-content">
                          <strong>{notification.title}</strong>
                          <small>{notification.message}</small>
                          <div className="php-topbar-notif-meta">
                            <span className={`php-pill ${getLevelClassName(notification.level)}`}>
                              {getNotificationTypeLabel(notification.type)}
                            </span>
                            <small>{new Date(notification.createdAt).toLocaleString('fr-FR')}</small>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {selectedNotification ? (
        <div className="php-modal-backdrop" role="dialog" aria-modal="true">
          <div className="php-modal-sheet">
            <div className="php-modal-head">
              <strong>Detail notification</strong>
              <button
                type="button"
                className="php-modal-close"
                onClick={() => setSelectedNotification(null)}
                aria-label="Fermer"
              >
                <X size={14} />
              </button>
            </div>
            <div className="php-modal-body">
              <div className="php-detail">
                <small>Titre</small>
                <strong>{selectedNotification.title}</strong>
              </div>
              <div className="php-detail">
                <small>Type</small>
                <strong>{getNotificationTypeLabel(selectedNotification.type)}</strong>
              </div>
              <div className="php-detail">
                <small>Date</small>
                <strong>{new Date(selectedNotification.createdAt).toLocaleString('fr-FR')}</strong>
              </div>
              <div className="php-detail">
                <small>Message</small>
                <strong>{selectedNotification.message || '-'}</strong>
              </div>
            </div>
            <div className="php-modal-foot">
              <button
                type="button"
                className="php-modal-btn"
                onClick={() => setSelectedNotification(null)}
              >
                Fermer
              </button>
              <button
                type="button"
                className="php-modal-btn"
                onClick={() => handleOpenNotificationListForType(selectedNotification)}
              >
                Voir la liste
              </button>
              <button
                type="button"
                className="php-modal-btn is-primary"
                onClick={() => { void handleDeleteNotification(selectedNotification) }}
                disabled={deletingNotification}
              >
                {deletingNotification ? 'Suppression...' : 'Supprimer'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showPauseModal && canManagePause ? (
        <div className="php-modal-backdrop" role="dialog" aria-modal="true">
          <div className="php-modal-sheet">
            <div className="php-modal-head">
              <strong>{pauseStatus?.has_open_pause ? 'Terminer la pause' : 'Prendre une pause'}</strong>
              <button type="button" className="php-modal-close" onClick={() => setShowPauseModal(false)} aria-label="Fermer">
                <X size={14} />
              </button>
            </div>
            <div className="php-modal-body">
              {!pauseStatus ? (
                <span className="php-pill is-warning">Etat de pause indisponible.</span>
              ) : pauseStatus.has_open_pause ? (
                <p className="text-sm text-slate-600">
                  Pause active depuis quelques minutes. Cliquez sur <strong>Terminer pause</strong> pour reprendre.
                </p>
              ) : (
                <>
                  <label className="block text-sm text-slate-600 mb-1">Temps de pause (minutes)</label>
                  <input
                    type="number"
                    min={1}
                    max={Math.max(1, maxPauseMinutes)}
                    value={pauseDurationInput}
                    onChange={(event) => setPauseDurationInput(event.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                  <p className="text-xs text-slate-500 mt-1">Quota restant: {maxPauseMinutes} min</p>
                  <label className="block text-sm text-slate-600 mt-3 mb-1">Motif (optionnel)</label>
                  <textarea
                    rows={3}
                    value={pauseReasonInput}
                    onChange={(event) => setPauseReasonInput(event.target.value)}
                    placeholder="Ex: pause dejeuner / pause personnelle"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </>
              )}
              {pauseError ? <span className="php-pill is-danger">{pauseError}</span> : null}
            </div>
            <div className="php-modal-foot">
              <button
                type="button"
                className="php-modal-btn"
                onClick={() => setShowPauseModal(false)}
                disabled={pauseBusy}
              >
                Annuler
              </button>
              <button
                type="button"
                className="php-modal-btn is-primary"
                onClick={() => { void handlePauseModalSubmit() }}
                disabled={pauseBusy || !pauseStatus}
              >
                {pauseBusy ? 'Traitement...' : pauseStatus?.has_open_pause ? 'Terminer pause' : 'Demarrer pause'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {toasts.length > 0 ? (
        <div className="php-toast-stack">
          {toasts.map((toast) => (
            <div key={toast.id} className={`php-toast-item ${getLevelClassName(toast.level)}`}>
              <div className="php-toast-content">
                <strong>{toast.title}</strong>
                <small>{toast.message}</small>
              </div>
              <button
                type="button"
                className="php-toast-close"
                onClick={() => setToasts((previous) => previous.filter((item) => item.id !== toast.id))}
                aria-label="Fermer la notification"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </>
  )
}

export default Topbar
