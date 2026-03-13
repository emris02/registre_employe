import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { apiClient } from '../../services/apiClient'
import { useAuth } from '../../services/authService'

const EMPLOYEE_ALLOWED_ROLES = new Set(['employe', 'chef_departement', 'stagiaire'])
const FILTERS = ['all', 'pointage', 'retard', 'absence', 'demande', 'badge', 'evenement'] as const
type FilterType = typeof FILTERS[number]

interface EmployeeNotification {
  id: string
  db_id?: number
  type: string
  title?: string
  message?: string
  created_at?: string
  lue?: boolean
  lien?: string | null
}

const normalizeType = (value: unknown): Exclude<FilterType, 'all'> => {
  const raw = String(value || '').trim().toLowerCase()
  if (raw.includes('retard')) return 'retard'
  if (raw.includes('absence')) return 'absence'
  if (raw.includes('demande')) return 'demande'
  if (raw.includes('badge')) return 'badge'
  if (raw.includes('event') || raw.includes('evenement') || raw.includes('calendrier')) return 'evenement'
  return 'pointage'
}

const filterLabel = (value: FilterType) => {
  if (value === 'all') return 'Tous'
  if (value === 'retard') return 'Retards'
  if (value === 'absence') return 'Absences'
  if (value === 'demande') return 'Demandes'
  if (value === 'badge') return 'Badges'
  if (value === 'evenement') return 'Evenements'
  return 'Pointages'
}

const resolveNotificationDbId = (notification: EmployeeNotification) => {
  const dbId = Number(notification.db_id || 0)
  if (Number.isInteger(dbId) && dbId > 0) return dbId
  const rawId = String(notification.id || '').trim()
  if (rawId.startsWith('notification-')) {
    const parsed = Number(rawId.replace('notification-', ''))
    if (Number.isInteger(parsed) && parsed > 0) return parsed
  }
  const parsed = Number(rawId)
  if (Number.isInteger(parsed) && parsed > 0) return parsed
  return null
}

const NotificationsPage: React.FC = () => {
  const { user, logout, isLoading: authLoading } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [notifications, setNotifications] = useState<EmployeeNotification[]>([])
  const [selected, setSelected] = useState<EmployeeNotification | null>(null)

  const activeFilter = useMemo<FilterType>(() => {
    const value = String(searchParams.get('type') || 'all').trim().toLowerCase()
    return (FILTERS as readonly string[]).includes(value) ? (value as FilterType) : 'all'
  }, [searchParams])

  const isUnauthorizedError = useCallback((err: unknown) => {
    const errorObject = err as { status?: number; message?: string }
    const status = Number(errorObject?.status || 0)
    if (status === 401 || status === 403) return true
    const message = String(errorObject?.message || '').toLowerCase()
    return message.includes('401') || message.includes('403') || message.includes('token')
  }, [])

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await apiClient.get<{ notifications?: EmployeeNotification[] }>('/api/notifications?limit=200')
      setNotifications(Array.isArray(response?.notifications) ? response.notifications : [])
    } catch (loadError: any) {
      if (isUnauthorizedError(loadError)) {
        logout()
        navigate('/login', { replace: true })
        return
      }
      setNotifications([])
      setError(loadError?.message || 'Impossible de charger les notifications.')
    } finally {
      setLoading(false)
    }
  }, [isUnauthorizedError, logout, navigate])

  useEffect(() => {
    if (authLoading) return
    if (!user) {
      navigate('/login', { replace: true })
      return
    }
    const role = String(user.role || '').toLowerCase()
    if (!EMPLOYEE_ALLOWED_ROLES.has(role)) {
      navigate('/admin', { replace: true })
      return
    }
    void loadData()
  }, [authLoading, loadData, navigate, user])

  const filteredNotifications = useMemo(() => {
    if (activeFilter === 'all') return notifications
    return notifications.filter((item) => normalizeType(item.type) === activeFilter)
  }, [activeFilter, notifications])

  const handleDelete = useCallback(async (notification: EmployeeNotification) => {
    const dbId = resolveNotificationDbId(notification)
    if (!dbId) {
      setError("Impossible de supprimer cette notification (identifiant invalide).")
      return
    }
    try {
      setDeleting(true)
      setError(null)
      try {
        await apiClient.delete(`/api/notifications/${dbId}`)
      } catch {
        await apiClient.delete(`/api/notifications/${dbId}`)
      }
      setNotifications((previous) => previous.filter((item) => item.id !== notification.id))
      setSelected(null)
      await loadData()
    } catch (deleteError: any) {
      setError(deleteError?.message || 'Suppression impossible.')
    } finally {
      setDeleting(false)
    }
  }, [loadData])

  const handleMarkRead = useCallback(async (notification: EmployeeNotification) => {
    const dbId = resolveNotificationDbId(notification)
    if (!dbId) return
    try {
      try {
        await apiClient.put(`/api/notifications/${dbId}/read`, { read: true })
      } catch {
        await apiClient.put(`/api/notifications/${dbId}/read`, { read: true })
      }
      setNotifications((previous) => previous.map((item) => (item.id === notification.id ? { ...item, lue: true } : item)))
      setSelected((previous) => (previous && previous.id === notification.id ? { ...previous, lue: true } : previous))
    } catch (markError: any) {
      setError(markError?.message || 'Mise a jour impossible.')
    }
  }, [])

  return (
    <div className="space-y-6">
      <section className="php-card">
        <div className="php-card-header">
          <h2 className="php-card-title">Mes notifications</h2>
          <button type="button" onClick={() => void loadData()} className="px-3 py-1 rounded bg-blue-600 text-white text-xs hover:bg-blue-700">
            Actualiser
          </button>
        </div>
        <div className="php-card-body">
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => setSearchParams(filter === 'all' ? {} : { type: filter })}
                className={`px-3 py-1 rounded-full text-xs font-semibold border ${activeFilter === filter ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}
              >
                {filterLabel(filter)}
              </button>
            ))}
          </div>
          {error ? <span className="php-pill is-danger">{error}</span> : null}
          {loading ? (
            <span className="php-pill is-warning">Chargement...</span>
          ) : (
            <p className="text-sm text-slate-600">{filteredNotifications.length} notification(s) sur {notifications.length}</p>
          )}
        </div>
      </section>

      <section className="php-card">
        <div className="php-card-body php-list">
          {loading ? null : filteredNotifications.length === 0 ? (
            <div className="php-list-item">
              <div>
                <strong>Aucune notification</strong>
                <small>Aucun element pour ce filtre.</small>
              </div>
            </div>
          ) : (
            filteredNotifications.map((notification) => (
              <button
                key={notification.id}
                type="button"
                className="php-list-item php-list-item-button"
                onClick={() => setSelected(notification)}
              >
                <div>
                  <strong>{notification.title || 'Notification'}</strong>
                  <small>{notification.message || '-'}</small>
                  <small>{notification.created_at ? new Date(notification.created_at).toLocaleString('fr-FR') : '-'}</small>
                </div>
                <span className={`php-pill ${notification.lue ? 'is-info' : 'is-warning'}`}>
                  {filterLabel(normalizeType(notification.type))}
                </span>
              </button>
            ))
          )}
        </div>
      </section>

      {selected ? (
        <div className="php-modal-backdrop" role="dialog" aria-modal="true">
          <div className="php-modal-sheet">
            <div className="php-modal-head">
              <strong>Détail notification</strong>
              <button type="button" className="php-modal-close" onClick={() => setSelected(null)} aria-label="Fermer">
                ×
              </button>
            </div>
            <div className="php-modal-body">
              <div className="php-detail">
                <small>Titre</small>
                <strong>{selected.title || 'Notification'}</strong>
              </div>
              <div className="php-detail">
                <small>Type</small>
                <strong>{filterLabel(normalizeType(selected.type))}</strong>
              </div>
              <div className="php-detail">
                <small>Date</small>
                <strong>{selected.created_at ? new Date(selected.created_at).toLocaleString('fr-FR') : '-'}</strong>
              </div>
              <div className="php-detail">
                <small>Message</small>
                <strong>{selected.message || '-'}</strong>
              </div>
            </div>
            <div className="php-modal-foot">
              {!selected.lue ? (
                <button type="button" className="php-modal-btn" onClick={() => void handleMarkRead(selected)}>
                  Marquer lu
                </button>
              ) : null}
              <button type="button" className="php-modal-btn" onClick={() => setSelected(null)}>
                Fermer
              </button>
              <button type="button" className="php-modal-btn is-primary" onClick={() => void handleDelete(selected)} disabled={deleting}>
                {deleting ? 'Suppression...' : 'Supprimer'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default NotificationsPage
