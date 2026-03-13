import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AlertTriangle, CalendarDays, Clock, Clock3, FileText, QrCode, Settings, TrendingUp, UserCheck, Users, X } from 'lucide-react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import frLocale from '@fullcalendar/core/locales/fr'
import { adminService, AdminNotification, Demande, Employe, PointageEntry } from '../../services/adminService'
import { CalendarEvent, calendarService } from '../../services/calendarService'
import { apiClient } from '../../services/apiClient'
import { useAuth } from '../../services/authService'
import AdminPointageSection from './AdminPointageSection'

interface AdminBadgePreview {
  id: number
  token: string
  created_at?: string
  expires_at?: string
  status?: 'active' | 'inactive' | 'expired'
  last_used?: string | null
  usage_count?: number
  user_matricule?: string
  user_name?: string
  user_email?: string
  user_role?: string
}

const buildBadgeQrUrl = (token: string, size = 140) => {
  const safeToken = String(token || '').trim()
  if (!safeToken) return ''
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(safeToken)}`
}

interface DashboardStats {
  total_employes: number
  presents: number
  absents: number
  retards: number
  total_heures_jour: number
  taux_presence: number
}

const EMPTY_STATS: DashboardStats = {
  total_employes: 0,
  presents: 0,
  absents: 0,
  retards: 0,
  total_heures_jour: 0,
  taux_presence: 0
}

type AdminSectionKey = 'dashboard' | 'employes' | 'pointages' | 'demandes' | 'calendrier' | 'rapports' | 'parametres'
type CalendarTimelineStatus = 'a_venir' | 'en_cours' | 'termine'

const ADMIN_ALLOWED_ROLES = new Set(['admin', 'super_admin', 'manager', 'hr'])
const CALENDAR_PRIORITY_LABELS: Record<'secondaire' | 'normale' | 'importante' | 'urgente', string> = {
  secondaire: 'Secondaire',
  normale: 'Normale',
  importante: 'Importante',
  urgente: 'Urgente'
}
const CALENDAR_TIMELINE_LABELS: Record<CalendarTimelineStatus, string> = {
  a_venir: 'A venir',
  en_cours: 'En cours',
  termine: 'Termine'
}

const padNumber = (value: number) => String(value).padStart(2, '0')
const toDateInput = (date: Date) => `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())}`
const toTimeInput = (date: Date) => `${padNumber(date.getHours())}:${padNumber(date.getMinutes())}`
const DEFAULT_WORK_END_TIME = '18:00'

const toMinutes = (value: string | null | undefined): number | null => {
  const raw = String(value || '').trim()
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(raw)
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

const getInitials = (fullName: string) => {
  const cleaned = String(fullName || '').trim()
  if (!cleaned) return 'EM'
  return cleaned
    .split(/\s+/)
    .map((part) => part.charAt(0))
    .join('')
    .slice(0, 3)
    .toUpperCase()
}

const buildDashboardMonthRange = (monthOffset = 0) => {
  const now = new Date()
  const startDate = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1)
  const endDate = new Date(now.getFullYear(), now.getMonth() + monthOffset + 1, 0)
  return {
    start: toDateInput(startDate),
    end: toDateInput(endDate),
    label: startDate.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
  }
}

const buildDefaultCalendarRange = () => {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  return {
    start: start.toISOString(),
    end: end.toISOString()
  }
}

const parseCalendarEventId = (value: string | number) => {
  const raw = String(value || '')
  if (raw.startsWith('event-')) {
    const parsed = Number(raw.replace('event-', ''))
    if (Number.isInteger(parsed)) {
      return { kind: 'evenement' as const, id: parsed }
    }
  }
  if (raw.startsWith('pointage-')) {
    const parsed = Number(raw.replace('pointage-', ''))
    if (Number.isInteger(parsed)) {
      return { kind: 'pointage' as const, id: parsed }
    }
  }
  return null
}

const isSameCalendarDay = (left: Date, right: Date) =>
  left.getFullYear() === right.getFullYear()
  && left.getMonth() === right.getMonth()
  && left.getDate() === right.getDate()

const resolveAdminPointageTimelineStatus = (event: CalendarEvent, now = new Date()): CalendarTimelineStatus => {
  const pointageDate = new Date(event.start)
  if (Number.isNaN(pointageDate.getTime())) return 'a_venir'
  if (!isSameCalendarDay(pointageDate, now)) {
    return pointageDate.getTime() < now.getTime() ? 'termine' : 'a_venir'
  }
  return pointageDate.getTime() > now.getTime() ? 'a_venir' : 'en_cours'
}

const resolveAdminCalendarTimelineStatus = (event: CalendarEvent, now = new Date()): CalendarTimelineStatus => {
  const source = String(event.extendedProps?.source || '').toLowerCase()
  if (source === 'pointage') {
    return resolveAdminPointageTimelineStatus(event, now)
  }

  const start = new Date(event.start)
  const end = new Date(event.end || event.start)
  if (Number.isNaN(start.getTime())) return 'a_venir'
  if (now.getTime() < start.getTime()) return 'a_venir'
  if (Number.isNaN(end.getTime())) return 'en_cours'
  if (now.getTime() > end.getTime()) return 'termine'
  return 'en_cours'
}

const getSectionFromPath = (pathname: string): AdminSectionKey => {
  if (pathname.includes('/employes')) return 'employes'
  if (pathname.includes('/pointages')) return 'pointages'
  if (pathname.includes('/demandes')) return 'demandes'
  if (pathname.includes('/calendrier')) return 'calendrier'
  if (pathname.includes('/rapports')) return 'rapports'
  if (pathname.includes('/parametres')) return 'parametres'
  return 'dashboard'
}

const AdminDashboard = () => {
  const { user, logout, isLoading: authLoading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const section = useMemo(() => getSectionFromPath(location.pathname), [location.pathname])

  const [stats, setStats] = useState<DashboardStats>(EMPTY_STATS)
  const [employes, setEmployes] = useState<Employe[]>([])
  const [pointages, setPointages] = useState<any[]>([])
  const [demandes, setDemandes] = useState<Demande[]>([])
  const [notifications, setNotifications] = useState<AdminNotification[]>([])
  const [notificationCounts, setNotificationCounts] = useState({ pointage: 0, retard: 0, absence: 0, demande: 0, badge: 0 })
  const [selectedNotification, setSelectedNotification] = useState<AdminNotification | null>(null)
  const [processingNotificationDelete, setProcessingNotificationDelete] = useState(false)
  const [selectedDemande, setSelectedDemande] = useState<Demande | null>(null)
  const [demandeDecision, setDemandeDecision] = useState<'approuve' | 'rejete'>('approuve')
  const [demandeCommentaire, setDemandeCommentaire] = useState('')
  const [demandeFeedback, setDemandeFeedback] = useState<string | null>(null)
  const [traiteursCache, setTraiteursCache] = useState<Record<string, { nom: string; role: string; matricule: string }>>({})

  // Fonction pour parser le commentaire et extraire le nom de l'utilisateur
  const parseTraiterPar = (commentaire: string) => {
    if (!commentaire) return null
    
    // Format attendu: "[Manager#5 2026-02-19T14:10:12.122Z]: ok depuis test"
    const match = commentaire.match(/^\[([a-zA-Z]+)#(\d+)\s*(.+?)\]:(.+)$/);
    if (!match) return { username: '', action: '', comment: '' }
    
    const [, role, id, action, comment] = match;
    return {
      username: `${role}#${id}`,
      action: action.trim(),
      comment: comment.trim()
    };
  }

  // Fonction pour obtenir le nom de l'utilisateur qui a traité la demande
  const getTraiterParInfo = async (traitePar: string) => {
    if (!traitePar) return null
    
    // Vérifier si déjà en cache
    if (traiteursCache[traitePar]) {
      return traiteursCache[traitePar]
    }
    
    try {
      const response = await apiClient.get(`/api/employes/${traitePar}`) as any
      if (response?.success && response?.employe) {
        const info = {
          nom: `${response.employe.prenom} ${response.employe.nom}`,
          role: response.employe.role || '',
          matricule: response.employe.matricule || ''
        }
        // Mettre en cache
        setTraiteursCache(prev => ({ ...prev, [traitePar]: info }))
        return info
      }
      return null
    } catch (error) {
      console.error('Erreur lors de la récupération des infos du traiteur:', error)
      return null
    }
  }

  // Fonction synchrone pour obtenir le nom depuis le cache ou l'ID
  const getTraiterParNom = (traitePar?: number | string | null, traiteParNom?: string | null) => {
    const name = String(traiteParNom || '').trim()
    if (name) return name

    const id = Number(traitePar || 0)
    if (!Number.isInteger(id) || id <= 0) return 'Non spécifié'
    return `ID: ${id}`
  }
  const [processingDemande, setProcessingDemande] = useState(false)
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([])
  const [calendarLoading, setCalendarLoading] = useState(false)
  const [calendarError, setCalendarError] = useState<string | null>(null)
  const [calendarNotice, setCalendarNotice] = useState<string | null>(null)
  const [calendarQuery, setCalendarQuery] = useState(buildDefaultCalendarRange)
  const [calendarEmployeId, setCalendarEmployeId] = useState<number | null>(null)
  const [activeCalendarEventId, setActiveCalendarEventId] = useState<number | null>(null)
  const [showCalendarPanel, setShowCalendarPanel] = useState(false)
  const [savingCalendarEvent, setSavingCalendarEvent] = useState(false)
  const [calendarTimelineFilter, setCalendarTimelineFilter] = useState<CalendarTimelineStatus | null>(null)
  const calendarRef = useRef<FullCalendar | null>(null)
  const calendarDatePickerRef = useRef<HTMLInputElement | null>(null)
  const [calendarForm, setCalendarForm] = useState({
    titre: '',
    description: '',
    dateDebut: new Date().toISOString().slice(0, 10),
    dateFin: new Date().toISOString().slice(0, 10),
    heureDebut: '09:00',
    heureFin: '10:00',
    type: 'reunion' as 'reunion' | 'formation' | 'autre',
    priorite: 'normale' as 'secondaire' | 'normale' | 'importante' | 'urgente',
    lieu: '',
    employeId: '' as string
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [adminBadge, setAdminBadge] = useState<AdminBadgePreview | null>(null)
  const [adminBadgeLoading, setAdminBadgeLoading] = useState(false)
  const [adminBadgeModalOpen, setAdminBadgeModalOpen] = useState(false)

  const isUnauthorizedError = useCallback((err: any) => {
    const status = Number(err?.status || 0)
    if (status === 401 || status === 403) return true
    const message = String(err?.message || '').toLowerCase()
    return message.includes('401') || message.includes('403') || message.includes('token')
  }, [])

  const getNotificationPillClass = useCallback((notification: AdminNotification) => {
    const level = String(notification.level || '').toLowerCase()
    if (level === 'danger') return 'is-danger'
    if (level === 'warning') return 'is-warning'
    if (level === 'info') return 'is-info'

    if (notification.type === 'absence') return 'is-danger'
    if (notification.type === 'retard' || notification.type === 'demande') return 'is-warning'
    if (notification.type === 'badge') return 'is-info'
    return 'is-success'
  }, [])

  const openDemandeModal = useCallback((demande: Demande, decision: 'approuve' | 'rejete' = 'approuve') => {
    setSelectedDemande(demande)
    setDemandeDecision(decision)
    setDemandeCommentaire('')
    setDemandeFeedback(null)
  }, [])

  const closeDemandeModal = useCallback(() => {
    if (processingDemande) return
    setSelectedDemande(null)
    setDemandeCommentaire('')
    setDemandeFeedback(null)
  }, [processingDemande])

  const closeNotificationModal = useCallback(() => {
    if (processingNotificationDelete) return
    setSelectedNotification(null)
  }, [processingNotificationDelete])

  const handleDeleteNotification = useCallback(async () => {
    if (!selectedNotification) return
    try {
      setProcessingNotificationDelete(true)
      await adminService.deleteNotification(selectedNotification.id)
      setNotifications((previous) => previous.filter((item) => item.id !== selectedNotification.id))
      setSelectedNotification(null)
    } catch (deleteError: any) {
      setDemandeFeedback(deleteError?.message || 'Suppression de notification impossible.')
    } finally {
      setProcessingNotificationDelete(false)
    }
  }, [selectedNotification])

  const refreshDemandesAndNotifications = useCallback(async () => {
    const [demandesResult, notificationsResult] = await Promise.allSettled([
      adminService.getDemandes({ page: 1, per_page: 20 }),
      adminService.getNotifications({ limit: 20 })
    ])

    const rejected = [demandesResult, notificationsResult]
      .filter((item): item is PromiseRejectedResult => item.status === 'rejected')
      .map((item) => item.reason)

    if (rejected.some((reason) => isUnauthorizedError(reason))) {
      logout()
      navigate('/login', { replace: true })
      return false
    }

    if (demandesResult.status === 'fulfilled') {
      setDemandes(demandesResult.value.items || [])
    }

    if (notificationsResult.status === 'fulfilled') {
      setNotifications(notificationsResult.value.items || [])
      setNotificationCounts(notificationsResult.value.counts || { pointage: 0, retard: 0, absence: 0, demande: 0, badge: 0 })
    }

    return true
  }, [isUnauthorizedError, logout, navigate])

  const handleDemandeDecision = useCallback(async () => {
    if (!selectedDemande) return

    if (demandeDecision === 'rejete' && !demandeCommentaire.trim()) {
      setDemandeFeedback('Le motif de refus est obligatoire.')
      return
    }

    try {
      setProcessingDemande(true)
      setDemandeFeedback(null)
      await adminService.updateDemandeStatus(selectedDemande.id, demandeDecision, demandeCommentaire.trim())

      await refreshDemandesAndNotifications()
      setSelectedDemande(null)
      setDemandeCommentaire('')
      setDemandeFeedback(`Demande ${demandeDecision === 'approuve' ? 'approuvee' : 'rejetee'} avec succes.`)
    } catch (decisionError: any) {
      console.error('Erreur traitement demande admin:', decisionError)
      if (isUnauthorizedError(decisionError)) {
        logout()
        navigate('/login', { replace: true })
        return
      }
      setDemandeFeedback(decisionError?.message || 'Impossible de traiter la demande.')
    } finally {
      setProcessingDemande(false)
    }
  }, [demandeCommentaire, demandeDecision, isUnauthorizedError, logout, navigate, refreshDemandesAndNotifications, selectedDemande])

  const loadCalendarEvents = useCallback(async (params?: { start?: string; end?: string; employeId?: number | null }) => {
    const start = params?.start || calendarQuery.start
    const end = params?.end || calendarQuery.end
    // Pour le calendrier admin, on utilise toujours l'ID de l'admin connecté pour ses pointages
    // mais on permet de filtrer les événements par employéId si spécifié
    const employeId = params?.employeId !== undefined ? params.employeId : calendarEmployeId

    try {
      setCalendarLoading(true)
      setCalendarError(null)
      const events = await calendarService.getEvents({
        start,
        end,
        include_pointages: true, // Inclure les pointages
        // Toujours inclure les pointages de l'admin connecté
        admin_id: user?.id,
        // Permettre de filtrer les événements par employé si spécifié
        ...(Number.isInteger(employeId) ? { employe_id: employeId as number } : {})
      })
      setCalendarEvents(events)
    } catch (loadError: any) {
      console.error('Erreur chargement calendrier admin:', loadError)
      setCalendarEvents([])
      if (isUnauthorizedError(loadError)) {
        logout()
        navigate('/login', { replace: true })
        return
      }
      setCalendarError('Impossible de charger le calendrier.')
    } finally {
      setCalendarLoading(false)
    }
  }, [calendarEmployeId, calendarQuery.end, calendarQuery.start, isUnauthorizedError, logout, navigate, user?.id])

  const resetCalendarForm = useCallback(() => {
    setActiveCalendarEventId(null)
    setCalendarForm({
      titre: '',
      description: '',
      dateDebut: new Date().toISOString().slice(0, 10),
      dateFin: new Date().toISOString().slice(0, 10),
      heureDebut: '09:00',
      heureFin: '10:00',
      type: 'reunion',
      priorite: 'normale',
      lieu: '',
      employeId: ''
    })
  }, [])

  const handleCloseCalendarPanel = useCallback(() => {
    resetCalendarForm()
    setShowCalendarPanel(false)
  }, [resetCalendarForm])

  const handleSaveCalendarEvent = async () => {
    if (!calendarForm.titre.trim()) {
      setCalendarError('Le titre de evenement est obligatoire.')
      return
    }

    try {
      setSavingCalendarEvent(true)
      setCalendarError(null)
      setCalendarNotice(null)

      if (!calendarForm.dateDebut || !calendarForm.dateFin) {
        setCalendarError('Les dates de debut et de fin sont obligatoires.')
        return
      }

      const startDate = `${calendarForm.dateDebut}T${calendarForm.heureDebut}:00`
      const endDate = `${calendarForm.dateFin}T${calendarForm.heureFin}:00`
      if (new Date(endDate).getTime() < new Date(startDate).getTime()) {
        setCalendarError('La date/heure de fin doit etre posterieure a la date/heure de debut.')
        return
      }

      const payload = {
        titre: calendarForm.titre.trim(),
        description: calendarForm.description.trim(),
        start_date: startDate,
        end_date: endDate,
        type: calendarForm.type,
        priorite: calendarForm.priorite,
        lieu: calendarForm.lieu.trim(),
        employe_id: calendarForm.employeId ? Number(calendarForm.employeId) : null
      }

      if (activeCalendarEventId) {
        await calendarService.updateEvent(activeCalendarEventId, payload)
        setCalendarNotice('Evenement mis a jour.')
      } else {
        await calendarService.createEvent(payload)
        setCalendarNotice('Evenement cree.')
      }

      resetCalendarForm()
      await loadCalendarEvents()
    } catch (saveError: any) {
      console.error('Erreur sauvegarde evenement:', saveError)
      if (isUnauthorizedError(saveError)) {
        logout()
        navigate('/login', { replace: true })
        return
      }
      setCalendarError(saveError?.message || 'Erreur lors de la sauvegarde de evenement.')
    } finally {
      setSavingCalendarEvent(false)
    }
  }

  const handleDeleteCalendarEvent = async () => {
    if (!activeCalendarEventId) return
    if (!window.confirm('Supprimer cet evenement du calendrier ?')) return

    try {
      setSavingCalendarEvent(true)
      setCalendarError(null)
      setCalendarNotice(null)
      await calendarService.deleteEvent(activeCalendarEventId)
      resetCalendarForm()
      setCalendarNotice('Evenement supprime.')
      await loadCalendarEvents()
    } catch (deleteError: any) {
      console.error('Erreur suppression evenement:', deleteError)
      if (isUnauthorizedError(deleteError)) {
        logout()
        navigate('/login', { replace: true })
        return
      }
      setCalendarError(deleteError?.message || 'Erreur lors de la suppression de evenement.')
    } finally {
      setSavingCalendarEvent(false)
    }
  }

  const handleCalendarDatesSet = useCallback((arg: { start: Date; end: Date }) => {
    const nextRange = {
      start: arg.start.toISOString(),
      end: arg.end.toISOString()
    }
    setCalendarQuery((prev) => {
      if (prev.start === nextRange.start && prev.end === nextRange.end) {
        return prev
      }
      return nextRange
    })
  }, [])

  const openCalendarDatePicker = useCallback(() => {
    const picker = calendarDatePickerRef.current
    if (!picker) return

    picker.value = new Date().toISOString().slice(0, 10)
    const pickerWithShow = picker as HTMLInputElement & { showPicker?: () => void }
    if (typeof pickerWithShow.showPicker === 'function') {
      pickerWithShow.showPicker()
      return
    }
    picker.click()
  }, [])

  const handleCalendarDatePickerChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value
    if (!value) return

    const calendarApi = calendarRef.current?.getApi?.()
    if (!calendarApi) return

    calendarApi.gotoDate(value)
    setCalendarNotice(`Calendrier positionne sur le ${new Date(`${value}T00:00:00`).toLocaleDateString('fr-FR')}.`)
    event.target.value = ''
  }, [])

  const handleCalendarDateClick = useCallback((arg: { date: Date }) => {
    const endDate = new Date(arg.date.getTime() + 60 * 60 * 1000)
    setActiveCalendarEventId(null)
    setShowCalendarPanel(true)
    setCalendarForm((prev) => ({
      ...prev,
      dateDebut: toDateInput(arg.date),
      dateFin: toDateInput(arg.date),
      heureDebut: toTimeInput(arg.date),
      heureFin: toTimeInput(endDate)
    }))
    setCalendarNotice('Nouvel evenement prepare a la date selectionnee.')
  }, [])

  const handleCalendarEventClick = useCallback((arg: { event: any }) => {
    const parsedEvent = parseCalendarEventId(arg.event.id)
    if (!parsedEvent || parsedEvent.kind !== 'evenement') {
      // Afficher les détails du pointage
      const event = arg.event
      const pointageDetails = {
        employe: event.extendedProps?.employe_nom || 'Inconnu',
        type: event.title,
        date: event.start ? new Date(event.start).toLocaleDateString('fr-FR') : 'Inconnue',
        heure: event.start ? new Date(event.start).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : 'Inconnue',
        statut: event.extendedProps?.statut || 'normal',
        retard: event.extendedProps?.retard_minutes || 0
      }
      
      const detailsMessage = `
        Employé: ${pointageDetails.employe}
        Type: ${pointageDetails.type}
        Date: ${pointageDetails.date}
        Heure: ${pointageDetails.heure}
        Statut: ${pointageDetails.statut}
        ${pointageDetails.retard > 0 ? `Retard: ${pointageDetails.retard} minutes` : ''}
      `.trim()
      
      setCalendarNotice(detailsMessage)
      return
    }
    const startDate = arg.event.start ? new Date(arg.event.start) : new Date()
    const endDate = arg.event.end ? new Date(arg.event.end) : new Date(startDate.getTime() + 60 * 60 * 1000)
    const priorite = String(arg.event.extendedProps?.priorite || 'normale') as 'secondaire' | 'normale' | 'importante' | 'urgente'

    setActiveCalendarEventId(parsedEvent.id)
    setCalendarForm({
      titre: String(arg.event.title || ''),
      description: String(arg.event.extendedProps?.description || ''),
      dateDebut: toDateInput(startDate),
      dateFin: toDateInput(endDate),
      heureDebut: toTimeInput(startDate),
      heureFin: toTimeInput(endDate),
      type: (['reunion', 'formation', 'autre'].includes(String(arg.event.extendedProps?.type || ''))
        ? arg.event.extendedProps.type
        : 'autre') as 'reunion' | 'formation' | 'autre',
      priorite: ['secondaire', 'normale', 'importante', 'urgente'].includes(priorite) ? priorite : 'normale',
      lieu: String(arg.event.extendedProps?.lieu || ''),
      employeId: arg.event.extendedProps?.employe_id ? String(arg.event.extendedProps.employe_id) : ''
    })
    setShowCalendarPanel(true)
    setCalendarNotice('Evenement charge dans le formulaire.')
  }, [])

  const handleCalendarEventScheduleUpdate = useCallback(async (arg: { event: any; revert: () => void }) => {
    const parsedEvent = parseCalendarEventId(arg.event.id)
    if (!parsedEvent || parsedEvent.kind !== 'evenement') {
      arg.revert()
      setCalendarNotice('Le glisser-deposer est reserve aux evenements metier.')
      return
    }

    try {
      const startDate = arg.event.start ? new Date(arg.event.start) : null
      const endDate = arg.event.end ? new Date(arg.event.end) : startDate
      if (!startDate || !endDate) {
        arg.revert()
        return
      }

      await calendarService.updateEvent(parsedEvent.id, {
        start_date: startDate.toISOString(),
        end_date: endDate.toISOString()
      })
      setCalendarNotice('Planning evenement mis a jour.')
      await loadCalendarEvents()
    } catch (updateError: any) {
      console.error('Erreur maj planning calendrier:', updateError)
      arg.revert()
      if (isUnauthorizedError(updateError)) {
        logout()
        navigate('/login', { replace: true })
        return
      }
      setCalendarError(updateError?.message || 'Impossible de deplacer cet evenement.')
    }
  }, [isUnauthorizedError, loadCalendarEvents, logout, navigate])

  useEffect(() => {
    if (authLoading) {
      return
    }
    if (!user) {
      navigate('/login', { replace: true })
      return
    }
    const currentRole = String(user.role || '').toLowerCase()
    if (!ADMIN_ALLOWED_ROLES.has(currentRole)) {
      navigate('/employee', { replace: true })
      return
    }

    const loadData = async () => {
      try {
        setLoading(true)
        setError(null)

        const [statsResult, employesResult, demandesResult, notificationsResult] = await Promise.allSettled([
          adminService.getStats(),
          adminService.getEmployes({ page: 1, per_page: 20 }),
          adminService.getDemandes({ page: 1, per_page: 20 }),
          adminService.getNotifications({ limit: 20 })
        ])

        const rejectedReasons = [statsResult, employesResult, demandesResult, notificationsResult]
          .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
          .map((result) => result.reason)

        if (rejectedReasons.some((reason) => isUnauthorizedError(reason))) {
          logout()
          navigate('/login', { replace: true })
          return
        }

        if (statsResult.status === 'fulfilled') {
          const response = statsResult.value
          setStats({
            total_employes: Number(response?.total_employes || 0),
            presents: Number(response?.presents || 0),
            absents: Number(response?.absents || 0),
            retards: Number(response?.retards || 0),
            total_heures_jour: Number(response?.total_heures_jour || 0),
            taux_presence: Number(response?.taux_presence || 0)
          })
        } else {
          setStats(EMPTY_STATS)
        }

        const employesLoaded = employesResult.status === 'fulfilled' ? employesResult.value.items || [] : []
        setEmployes(employesLoaded)
        
        setDemandes(demandesResult.status === 'fulfilled' ? demandesResult.value.items || [] : [])

        if (notificationsResult.status === 'fulfilled') {
          setNotifications(notificationsResult.value.items || [])
          setNotificationCounts(notificationsResult.value.counts || { pointage: 0, retard: 0, absence: 0, demande: 0, badge: 0 })
        } else {
          setNotifications([])
          setNotificationCounts({ pointage: 0, retard: 0, absence: 0, demande: 0, badge: 0 })
        }
      } catch (err: any) {
        console.error('Erreur dashboard admin:', err)
        if (isUnauthorizedError(err)) {
          logout()
          navigate('/login', { replace: true })
          return
        }
        setError('Impossible de charger les donnees administrateur.')
      } finally {
        setLoading(false)
      }
    }

    void loadData()
  }, [authLoading, isUnauthorizedError, logout, navigate, user])

  useEffect(() => {
    if (authLoading || !user) {
      return
    }
    void loadCalendarEvents()
  }, [authLoading, loadCalendarEvents, user])

  useEffect(() => {
    const loadAdminBadge = async () => {
      if (authLoading || !user) return
      if (!ADMIN_ALLOWED_ROLES.has(String(user.role || '').toLowerCase())) return

      try {
        setAdminBadgeLoading(true)
        const response = await apiClient.get<{ success: boolean; badge?: AdminBadgePreview | null; message?: string }>('/api/admin/badge')
        if (response?.success) {
          setAdminBadge(response.badge?.token ? response.badge : null)
        } else {
          setAdminBadge(null)
        }
      } catch (badgeError) {
        console.error('Erreur chargement badge admin dashboard:', badgeError)
        setAdminBadge(null)
      } finally {
        setAdminBadgeLoading(false)
      }
    }

    void loadAdminBadge()
  }, [authLoading, user])

  const todayLabel = useMemo(
    () => new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }),
    []
  )

  const tauxPresenceDisplay = useMemo(() => {
    const value = Number(stats.taux_presence || 0)
    return value > 1 ? value : value * 100
  }, [stats.taux_presence])

  if (loading) {
    return (
      <section className="php-card">
        <div className="php-card-body">Chargement des donnees administrateur...</div>
      </section>
    )
  }

  if (error) {
    return (
      <section className="php-card">
        <div className="php-card-body">
          <div className="php-pill is-danger">
            <AlertTriangle size={14} />
            {error}
          </div>
        </div>
      </section>
    )
  }

  const renderSectionDashboard = () => (
    <div style={{ minHeight: 'auto', display: 'flex', flexDirection: 'column' }}>
      <header className="php-page-header">
        <h1 className="php-page-title">Tableau de bord</h1>
        <p className="php-page-subtitle">Vue d'ensemble de l'activite du {todayLabel}</p>
      </header>

      <section className="php-stats-grid" style={{ gap: '1.5rem', marginBottom: '2rem' }}>
        <article className="php-stat-card is-primary" style={{ background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)', border: 'none', borderRadius: '1rem', boxShadow: '0 4px 6px -1px rgba(59, 130, 246, 0.3)', transition: 'all 0.3s ease', transform: 'translateY(0)' }}>
          <div className="php-stat-head" style={{ color: '#ffffff', opacity: 0.9 }}>
            <Users size={24} />
          </div>
          <p className="php-stat-value" style={{ color: '#ffffff', fontSize: '2rem', fontWeight: '700' }}>{stats.total_employes}</p>
          <p className="php-stat-label" style={{ color: '#ffffff', opacity: 0.8, fontSize: '0.875rem' }}>Total employés</p>
        </article>

        <article className="php-stat-card is-success" style={{ background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', border: 'none', borderRadius: '1rem', boxShadow: '0 4px 6px -1px rgba(16, 185, 129, 0.3)', transition: 'all 0.3s ease', transform: 'translateY(0)' }}>
          <div className="php-stat-head" style={{ color: '#ffffff', opacity: 0.9 }}>
            <UserCheck size={24} />
          </div>
          <p className="php-stat-value" style={{ color: '#ffffff', fontSize: '2rem', fontWeight: '700' }}>{stats.presents}</p>
          <p className="php-stat-label" style={{ color: '#ffffff', opacity: 0.8, fontSize: '0.875rem' }}>Présents aujourd'hui</p>
        </article>

        <article className="php-stat-card is-warning" style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', border: 'none', borderRadius: '1rem', boxShadow: '0 4px 6px -1px rgba(245, 158, 11, 0.3)', transition: 'all 0.3s ease', transform: 'translateY(0)' }}>
          <div className="php-stat-head" style={{ color: '#ffffff', opacity: 0.9 }}>
            <AlertTriangle size={24} />
          </div>
          <p className="php-stat-value" style={{ color: '#ffffff', fontSize: '2rem', fontWeight: '700' }}>{stats.absents}</p>
          <p className="php-stat-label" style={{ color: '#ffffff', opacity: 0.8, fontSize: '0.875rem' }}>Absents aujourd'hui</p>
        </article>

        <article className="php-stat-card is-danger" style={{ background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)', border: 'none', borderRadius: '1rem', boxShadow: '0 4px 6px -1px rgba(239, 68, 68, 0.3)', transition: 'all 0.3s ease', transform: 'translateY(0)' }}>
          <div className="php-stat-head" style={{ color: '#ffffff', opacity: 0.9 }}>
            <Clock3 size={24} />
          </div>
          <p className="php-stat-value" style={{ color: '#ffffff', fontSize: '2rem', fontWeight: '700' }}>{stats.retards}</p>
          <p className="php-stat-label" style={{ color: '#ffffff', opacity: 0.8, fontSize: '0.875rem' }}>Retards du jour</p>
        </article>
      </section>

      {/* Section Badge Admin */}
      <section className="php-card" style={{ marginBottom: '2rem' }}>
        <div className="php-card-header">
          <h2 className="php-card-title">Mon Badge Admin</h2>
          <button 
            onClick={() => navigate('/admin/profil')}
            className="php-btn php-btn-primary php-btn-sm"
          >
            Voir mon profil
          </button>
        </div>
        <div className="php-card-body">
          <div className="flex flex-wrap items-center gap-4">
            <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold text-xl">
              {user?.prenom?.[0]}{user?.nom?.[0]}
            </div>

            <div className="min-w-[220px]">
              <p className="font-semibold text-gray-900">{user?.prenom} {user?.nom}</p>
              <p className="text-sm text-gray-600">{user?.role === 'super_admin' ? 'Super Admin' : 'Administrateur'}</p>
              {adminBadgeLoading ? (
                <span className="inline-flex items-center px-2 py-1 bg-slate-100 text-slate-700 rounded-md text-xs font-medium mt-1">Chargement badge...</span>
              ) : adminBadge?.token ? (
                <span className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium mt-1 ${
                  adminBadge.status === 'inactive'
                    ? 'bg-red-100 text-red-800'
                    : adminBadge.status === 'expired'
                      ? 'bg-yellow-100 text-yellow-800'
                      : 'bg-green-100 text-green-800'
                }`}>
                  {adminBadge.status === 'inactive'
                    ? 'Badge inactif'
                    : adminBadge.status === 'expired'
                      ? 'Badge expiré'
                      : 'Badge actif'}
                </span>
              ) : (
                <span className="inline-flex items-center px-2 py-1 bg-red-50 text-red-700 rounded-md text-xs font-medium mt-1">Aucun badge</span>
              )}
            </div>

            {adminBadge?.token ? (
              <button
                type="button"
                className="ml-auto flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2 hover:bg-gray-50"
                onClick={() => setAdminBadgeModalOpen(true)}
                title="Afficher le badge"
              >
                <img
                  src={buildBadgeQrUrl(adminBadge.token, 90)}
                  alt="Badge QR"
                  className="w-[90px] h-[90px] object-contain"
                />
                <span className="text-sm text-gray-700">Aperçu</span>
              </button>
            ) : null}
          </div>
        </div>
      </section>

      {adminBadgeModalOpen && adminBadge?.token ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setAdminBadgeModalOpen(false)} aria-hidden="true" />
          <div className="relative w-full max-w-lg rounded-xl border border-gray-200 bg-white shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-indigo-100">
              <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <QrCode size={18} />
                Mon badge admin
              </h3>
              <button
                type="button"
                className="px-3 py-2 rounded border border-gray-300 text-sm text-gray-700 hover:bg-gray-50"
                onClick={() => setAdminBadgeModalOpen(false)}
              >
                Fermer
              </button>
            </div>
            <div className="p-6 flex flex-col items-center gap-4">
              <div className="w-80 h-80 rounded-2xl border-4 border-gray-200 bg-white shadow-xl flex items-center justify-center overflow-hidden">
                <img
                  src={buildBadgeQrUrl(adminBadge.token, 320)}
                  alt="Badge QR"
                  className="w-[300px] h-[300px] object-contain"
                />
              </div>
              <div className="text-xs font-mono text-gray-600 break-all text-center">
                {adminBadge.token}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <section className="php-grid-2 php-grid-equal-cards" style={{ minHeight: '500px', gap: '1.5rem' }}>
        <article className="php-card">
          <div className="php-card-header">
            <h2 className="php-card-title">Synthese du jour</h2>
          </div>
          <div className="php-card-body php-list">
            <div className="php-list-item">
              <div>
                <strong>Heures travaillees</strong>
                <small>Total cumule aujourd'hui</small>
              </div>
              <strong>{stats.total_heures_jour}h</strong>
            </div>
            <div className="php-list-item">
              <div>
                <strong>Taux de presence</strong>
                <small>Objectif interne 95%</small>
              </div>
              <strong>{tauxPresenceDisplay.toFixed(1)}%</strong>
            </div>
          </div>
        </article>

        <article className="php-card" style={{ height: '500px', display: 'flex', flexDirection: 'column', position: 'relative', background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '0.75rem', boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)', transition: 'all 0.3s ease' }}>
          <div className="php-card-header" style={{ borderBottom: '1px solid #f3f4f6', padding: '1rem 1.5rem' }}>
            <h2 className="php-card-title" style={{ fontSize: '1.125rem', fontWeight: '600', color: '#111827', margin: 0 }}>Notifications</h2>
            <span className="php-pill is-warning" style={{ position: 'absolute', right: '1.5rem', top: '1rem', fontSize: '0.875rem', padding: '0.25rem 0.5rem' }}>{notifications.length}</span>
            <button 
              onClick={() => navigate('/admin/notifications')}
              className="php-btn php-btn-primary php-btn-sm"
              style={{ position: 'absolute', right: '5rem', top: '1rem', fontSize: '0.75rem', padding: '0.375rem 0.75rem', borderRadius: '0.5rem', background: '#3b82f6', border: 'none', color: 'white', cursor: 'pointer', transition: 'all 0.2s ease' }}
              onMouseEnter={(e) => e.currentTarget.style.background = '#2563eb'}
              onMouseLeave={(e) => e.currentTarget.style.background = '#3b82f6'}
            >
              Voir plus
            </button>
          </div>
          <div className="php-card-body php-list" style={{ flex: 1, overflow: 'auto', padding: '1rem 1.5rem' }}>
            <div className="php-list-item">
              <div>
                <strong>Pointages</strong>
                <small>Activites de pointage detectees</small>
              </div>
              <span className="php-pill is-success">{notificationCounts.pointage}</span>
            </div>
            <div className="php-list-item">
              <div>
                <strong>Retards et absences</strong>
                <small>Suivi des retards et absences du jour</small>
              </div>
              <span className="php-pill is-danger">{notificationCounts.retard + notificationCounts.absence}</span>
            </div>
            <div className="php-list-item">
              <div>
                <strong>Demandes en attente</strong>
                <small>Validation RH/manager requise</small>
              </div>
              <span className="php-pill is-warning">{notificationCounts.demande}</span>
            </div>
            <div className="php-list-item">
              <div>
                <strong>Badges regeneres</strong>
                <small>Regeneration badge detectee aujourd'hui</small>
              </div>
              <span className="php-pill is-info">{notificationCounts.badge}</span>
            </div>
            {notifications.length === 0 ? (
              <div className="php-list-item">
                <div>
                  <strong>Aucune notification</strong>
                  <small>Aucune alerte pour le moment.</small>
                </div>
              </div>
            ) : (
              notifications.slice(0, 6).map((notification) => (
                <button
                  key={notification.id}
                  type="button"
                  className="php-list-item php-list-item-button"
                  onClick={() => {
                    setSelectedNotification(notification)
                  }}
                >
                  <div>
                    <strong>{notification.title}</strong>
                    <small>{notification.message}</small>
                    <small>{new Date(notification.created_at).toLocaleString('fr-FR')}</small>
                  </div>
                  <span className={`php-pill ${getNotificationPillClass(notification)}`}>
                    {notification.type === 'badge' ? 'badge' : notification.type}
                  </span>
                </button>
              ))
            )}
          </div>
        </article>
      </section>

      {selectedNotification ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/50" onClick={closeNotificationModal} aria-hidden="true" />
          <div className="relative w-full max-w-2xl rounded-xl border border-gray-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-gray-200">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Detail notification</h3>
                <p className="text-sm text-gray-500">{new Date(selectedNotification.created_at).toLocaleString('fr-FR')}</p>
              </div>
              <button
                type="button"
                className="px-3 py-2 rounded border border-gray-300 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                onClick={closeNotificationModal}
                disabled={processingNotificationDelete}
              >
                Fermer
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <div className="text-sm text-gray-500">Type</div>
                <div className="text-sm font-semibold text-gray-900 mt-1">{selectedNotification.type}</div>
              </div>
              <div className="rounded-lg border border-gray-200 p-4">
                <div className="text-sm text-gray-500">Titre</div>
                <div className="text-sm font-semibold text-gray-900 mt-1">{selectedNotification.title}</div>
              </div>
              <div className="rounded-lg border border-gray-200 p-4">
                <div className="text-sm text-gray-500">Message</div>
                <div className="text-sm text-gray-800 mt-1 whitespace-pre-wrap">{selectedNotification.message || '-'}</div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-2">
              <button
                type="button"
                className="px-4 py-2 rounded border border-gray-300 text-sm text-gray-700 hover:bg-gray-50"
                onClick={() => {
                  const normalizedType = String(selectedNotification.type || '').trim().toLowerCase()
                  navigate(`/admin/notifications?type=${encodeURIComponent(normalizedType || 'all')}`)
                }}
                disabled={processingNotificationDelete}
              >
                Voir toutes
              </button>
              <button
                type="button"
                className="px-4 py-2 rounded bg-red-600 text-white text-sm hover:bg-red-700 disabled:opacity-60"
                onClick={() => { void handleDeleteNotification() }}
                disabled={processingNotificationDelete}
              >
                {processingNotificationDelete ? 'Suppression...' : 'Supprimer'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )

  const renderSectionEmployes = () => (
    <section className="php-card">
      <div className="php-card-header">
        <h2 className="php-card-title">Liste des employes</h2>
      </div>
      <div className="php-card-body php-table-wrap">
        <table className="php-table">
          <thead>
            <tr>
              <th>Nom</th>
              <th>Email</th>
              <th>Poste</th>
              <th>Departement</th>
              <th>Statut</th>
            </tr>
          </thead>
          <tbody>
            {employes.length === 0 ? (
              <tr>
                <td colSpan={5}>Aucun employe trouve.</td>
              </tr>
            ) : (
              employes.map((employe) => (
                <tr key={employe.id}>
                  <td>{employe.prenom} {employe.nom}</td>
                  <td>{employe.email}</td>
                  <td>{employe.poste}</td>
                  <td>{employe.departement || '-'}</td>
                  <td>
                    <span className={`php-pill ${employe.statut === 'actif' ? 'is-success' : 'is-warning'}`}>
                      {employe.statut || 'inconnu'}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  )

  const renderSectionPointages = () => {
    // Récupérer les paramètres système pour les heures de travail
    const workStartTime = '09:00' // TODO: Récupérer depuis les paramètres système
    const workEndTime = '18:00'   // TODO: Récupérer depuis les paramètres système
    
    return (
      <AdminPointageSection 
        pointages={pointages as PointageEntry[]}
        workStartTime={workStartTime}
        workEndTime={workEndTime}
      />
    )
  }

  const renderSectionDemandes = () => (
    <>
      <section className="php-card">
        <div className="php-card-header">
          <h2 className="php-card-title">Demandes collaborateurs</h2>
          <span className="php-pill is-warning">{demandes.filter((demande) => demande.statut === 'en_attente').length} en attente</span>
        </div>
        {demandeFeedback && !selectedDemande ? (
          <div className="php-card-body">
            <span className={`php-pill ${demandeFeedback.toLowerCase().includes('impossible') || demandeFeedback.toLowerCase().includes('obligatoire') ? 'is-danger' : 'is-success'}`}>
              {demandeFeedback}
            </span>
          </div>
        ) : null}
        <div className="php-card-body php-table-wrap">
          <table className="php-table">
            <thead>
              <tr>
                <th>Employe</th>
                <th>Type</th>
                <th>Periode</th>
                <th>Statut</th>
                <th>Traité par</th>
              </tr>
            </thead>
            <tbody>
                {demandes.length === 0 ? (
                  <tr>
                    <td colSpan={5}>Aucune demande trouvee.</td>
                  </tr>
                ) : (
                  demandes.map((demande) => (
                    <tr key={demande.id} onClick={() => openDemandeModal(demande)} style={{ cursor: 'pointer' }}>
                    <td>{demande.prenom} {demande.nom}</td>
                    <td>{demande.type}</td>
                    <td>{demande.date_debut || '-'} - {demande.date_fin || '-'}</td>
                    <td>
                      <span
                        className={`php-pill ${
                          demande.statut === 'approuve' ? 'is-success' : demande.statut === 'rejete' ? 'is-danger' : 'is-warning'
                        }`}
                      >
                        {demande.statut}
                      </span>
                    </td>
                    <td>{getTraiterParNom(demande.traite_par, demande.traite_par_nom)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {selectedDemande ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/50" onClick={closeDemandeModal} aria-hidden="true" />
          <div className="relative w-full max-w-3xl rounded-xl border border-gray-200 bg-white shadow-2xl max-h-[90vh] overflow-auto">
            <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-gray-200">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Demande #{selectedDemande.id}</h3>
                <p className="text-sm text-gray-500">Traitement de la demande collaborateur</p>
              </div>
              <button
                type="button"
                className="px-3 py-2 rounded border border-gray-300 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                onClick={closeDemandeModal}
                disabled={processingDemande}
              >
                Fermer
              </button>
            </div>

            <div className="p-6 space-y-5">
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <div>
                  <strong>Nom complet:</strong> {selectedDemande.prenom} {selectedDemande.nom}
                </div>
                <div>
                  <strong>Email:</strong> {selectedDemande.email || '-'}
                </div>
                <div>
                  <strong>Matricule:</strong> {selectedDemande.matricule || '-'}
                </div>
                <div>
                  <strong>Poste:</strong> {selectedDemande.poste || '-'}
                </div>
                <div>
                  <strong>Departement:</strong> {selectedDemande.departement || '-'}
                </div>
                <div>
                  <strong>Date demande:</strong> {selectedDemande.date_demande ? new Date(selectedDemande.date_demande).toLocaleString('fr-FR') : '-'}
                </div>
                <div>
                  <strong>Type:</strong> {selectedDemande.type || '-'}
                </div>
                <div>
                  <strong>Periode:</strong> {selectedDemande.date_debut || '-'} - {selectedDemande.date_fin || '-'}
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 p-4 text-sm">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <strong>Statut</strong>
                  <span className={`php-pill ${selectedDemande.statut === 'approuve' ? 'is-success' : selectedDemande.statut === 'rejete' ? 'is-danger' : 'is-warning'}`}>
                    {selectedDemande.statut}
                  </span>
                </div>
                <div>
                  <strong>Motif employé:</strong> {selectedDemande.motif || '-'}
                </div>
                {selectedDemande.commentaire ? (
                  <div className="mt-2 text-gray-600 whitespace-pre-wrap">
                    <strong>Commentaire:</strong> {selectedDemande.commentaire}
                  </div>
                ) : null}
                {selectedDemande.traite_par ? (
                  <div className="mt-2">
                    <strong>Traité par:</strong> {getTraiterParNom(selectedDemande.traite_par, selectedDemande.traite_par_nom)}
                  </div>
                ) : null}
              </div>

              {selectedDemande.statut === 'en_attente' ? (
                <>
                  <div className="rounded-lg border border-gray-200 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className={`px-3 py-1 rounded text-xs ${demandeDecision === 'approuve' ? 'bg-green-600 text-white' : 'border border-gray-300 text-gray-700'}`}
                        onClick={() => setDemandeDecision('approuve')}
                        disabled={processingDemande}
                      >
                        Accepter
                      </button>
                      <button
                        type="button"
                        className={`px-3 py-1 rounded text-xs ${demandeDecision === 'rejete' ? 'bg-red-600 text-white' : 'border border-gray-300 text-gray-700'}`}
                        onClick={() => setDemandeDecision('rejete')}
                        disabled={processingDemande}
                      >
                        Refuser
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      {demandeDecision === 'approuve' ? 'Commentaire (optionnel)' : 'Motif de refus (obligatoire)'}
                    </label>
                    <textarea
                      value={demandeCommentaire}
                      onChange={(event) => setDemandeCommentaire(event.target.value)}
                      rows={4}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      placeholder={demandeDecision === 'approuve' ? 'Commentaire interne...' : 'Precisez le motif de refus'}
                    />
                  </div>

                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      className="px-4 py-2 rounded border border-gray-300 text-sm text-gray-700 hover:bg-gray-50"
                      onClick={closeDemandeModal}
                      disabled={processingDemande}
                    >
                      Annuler
                    </button>
                    <button
                      type="button"
                      className={`px-4 py-2 rounded text-sm text-white ${demandeDecision === 'approuve' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'} disabled:opacity-60`}
                      onClick={() => { void handleDemandeDecision() }}
                      disabled={processingDemande || (demandeDecision === 'rejete' && !demandeCommentaire.trim())}
                    >
                      {processingDemande ? 'Traitement...' : demandeDecision === 'approuve' ? 'Valider' : 'Refuser'}
                    </button>
                  </div>
                </>
              ) : (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
                  {selectedDemande.date_traitement
                    ? `Demande traitee le ${new Date(selectedDemande.date_traitement).toLocaleString('fr-FR')}`
                    : 'Demande deja traitee.'}
                </div>
              )}

              {demandeFeedback ? (
                <span className={`php-pill ${demandeFeedback.toLowerCase().includes('impossible') || demandeFeedback.toLowerCase().includes('obligatoire') ? 'is-danger' : 'is-success'}`}>
                  {demandeFeedback}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  )

  const renderSectionCalendrier = () => {
    const sortedEvents = [...calendarEvents]
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
      .slice(0, 8)
    const now = new Date()
    const eventsWithStatus = sortedEvents.map((event) => ({
      event,
      timelineStatus: resolveAdminCalendarTimelineStatus(event, now)
    }))
    const timelineTotals = eventsWithStatus.reduce(
      (accumulator, current) => {
        accumulator[current.timelineStatus] += 1
        return accumulator
      },
      { a_venir: 0, en_cours: 0, termine: 0 } as Record<CalendarTimelineStatus, number>
    )
    
    // Filtrer les événements par statut si un filtre est sélectionné
    const filteredEvents = calendarTimelineFilter 
      ? eventsWithStatus.filter(({ timelineStatus }) => timelineStatus === calendarTimelineFilter).map(({ event }) => event)
      : sortedEvents

    const isEditingEvent = activeCalendarEventId !== null

    return (
      <div className={`php-grid-2 php-calendar-grid ${showCalendarPanel ? 'is-with-panel' : 'is-full-width'}`}>
        <section className="php-card php-calendar-main-card">
          <div className="php-card-header">
            <h2 className="php-card-title">
              <CalendarDays size={16} style={{ marginRight: 8, verticalAlign: 'text-bottom' }} />
              Calendrier administratif
            </h2>
            <div className="flex items-center gap-2">
              <select
                value={calendarEmployeId === null ? '' : String(calendarEmployeId)}
                onChange={(event) => setCalendarEmployeId(event.target.value ? Number(event.target.value) : null)}
                className="px-2 py-1 border border-gray-300 rounded text-sm"
              >
                <option value="">Mes événements et pointages</option>
                {employes.map((employe) => (
                  <option key={employe.id} value={employe.id}>
                    Événements de {employe.prenom} {employe.nom} ({employe.role || 'Employe'})
                  </option>
                ))}
              </select>
              <button
                onClick={() => void loadCalendarEvents()}
                className="px-3 py-1 rounded bg-blue-600 text-white text-xs hover:bg-blue-700"
              >
                Charger
              </button>
            </div>
          </div>
          <div className="php-card-body">
            {calendarError ? (
              <div style={{ marginBottom: 12 }}>
                <div className="php-pill is-danger">
                  <AlertTriangle size={14} />
                  {calendarError}
                </div>
              </div>
            ) : null}
            {calendarNotice ? (
              <div style={{ marginBottom: 12 }}>
                <span className="php-pill is-success">{calendarNotice}</span>
              </div>
            ) : null}
            {calendarLoading ? (
              <div style={{ marginBottom: 12 }}>
                <span className="php-pill is-warning">Chargement du calendrier...</span>
              </div>
            ) : null}

            <input
              ref={calendarDatePickerRef}
              type="date"
              onChange={handleCalendarDatePickerChange}
              aria-label="Choisir une date du calendrier"
              style={{ position: 'absolute', opacity: 0, width: 1, height: 1, pointerEvents: 'none' }}
              tabIndex={-1}
            />

            <div className="php-calendar-shell">
              <FullCalendar
                ref={calendarRef}
                plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
                locale={frLocale}
                initialView="dayGridMonth"
                customButtons={{
                  pickDate: {
                    text: "Aujourd'hui",
                    click: openCalendarDatePicker
                  }
                }}
                headerToolbar={{
                  left: 'prev,next pickDate',
                  center: 'title',
                  right: 'dayGridMonth,timeGridWeek,timeGridDay'
                }}
                height="auto"
                events={filteredEvents as any}
                editable
                selectable
                eventAllow={(_dropInfo, draggedEvent) => !draggedEvent || draggedEvent.extendedProps?.source !== 'pointage'}
                datesSet={(arg) => handleCalendarDatesSet(arg)}
                dateClick={(arg) => handleCalendarDateClick({ date: arg.date })}
                eventClick={(arg) => handleCalendarEventClick(arg)}
                eventDrop={(arg) => { void handleCalendarEventScheduleUpdate(arg) }}
                eventResize={(arg) => { void handleCalendarEventScheduleUpdate(arg) }}
                eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
              />
            </div>

            <div className="php-calendar-legend">
              <span className="php-calendar-chip is-priority-urgente">Urgente</span>
              <span className="php-calendar-chip is-priority-importante">Importante</span>
              <span className="php-calendar-chip is-priority-normale">Normale</span>
              <span className="php-calendar-chip is-priority-secondaire">Secondaire</span>
              <span className="php-calendar-chip is-pointage">Pointage</span>
            </div>
          </div>
        </section>

        {showCalendarPanel ? (
          <section className="php-card">
            <div className="php-card-header">
              <h2 className="php-card-title">{isEditingEvent ? 'Modifier evenement' : 'Nouvel evenement'}</h2>
              <button
                type="button"
                onClick={handleCloseCalendarPanel}
                className="px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
                aria-label="Fermer le panneau evenement"
              >
                <X size={16} />
              </button>
            </div>
            <div className="php-card-body php-list">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setCalendarTimelineFilter(calendarTimelineFilter === 'a_venir' ? null : 'a_venir')}
                  className={`php-pill ${calendarTimelineFilter === 'a_venir' ? 'is-info' : 'is-info'} cursor-pointer hover:opacity-80`}
                  style={{ border: 'none', background: calendarTimelineFilter === 'a_venir' ? '#3b82f6' : undefined }}
                >
                  {CALENDAR_TIMELINE_LABELS.a_venir} {timelineTotals.a_venir}
                </button>
                <button
                  onClick={() => setCalendarTimelineFilter(calendarTimelineFilter === 'en_cours' ? null : 'en_cours')}
                  className={`php-pill ${calendarTimelineFilter === 'en_cours' ? 'is-success' : 'is-success'} cursor-pointer hover:opacity-80`}
                  style={{ border: 'none', background: calendarTimelineFilter === 'en_cours' ? '#10b981' : undefined }}
                >
                  {CALENDAR_TIMELINE_LABELS.en_cours} {timelineTotals.en_cours}
                </button>
                <button
                  onClick={() => setCalendarTimelineFilter(calendarTimelineFilter === 'termine' ? null : 'termine')}
                  className={`php-pill ${calendarTimelineFilter === 'termine' ? 'is-warning' : 'is-warning'} cursor-pointer hover:opacity-80`}
                  style={{ border: 'none', background: calendarTimelineFilter === 'termine' ? '#f59e0b' : undefined }}
                >
                  {CALENDAR_TIMELINE_LABELS.termine} {timelineTotals.termine}
                </button>
                {calendarTimelineFilter && (
                  <button
                    onClick={() => setCalendarTimelineFilter(null)}
                    className="php-pill cursor-pointer hover:opacity-80"
                    style={{ border: 'none', background: '#6b7280' }}
                  >
                    Tout afficher
                  </button>
                )}
              </div>

              <input
                value={calendarForm.titre}
                onChange={(event) => setCalendarForm((prev) => ({ ...prev, titre: event.target.value }))}
                placeholder="Titre de l evenement"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              />
              <textarea
                value={calendarForm.description}
                onChange={(event) => setCalendarForm((prev) => ({ ...prev, description: event.target.value }))}
                placeholder="Description"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                rows={3}
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="date"
                  value={calendarForm.dateDebut}
                  onChange={(event) => setCalendarForm((prev) => ({ ...prev, dateDebut: event.target.value }))}
                  className="px-3 py-2 border border-gray-300 rounded-lg"
                />
                <input
                  type="date"
                  value={calendarForm.dateFin}
                  onChange={(event) => setCalendarForm((prev) => ({ ...prev, dateFin: event.target.value }))}
                  className="px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>
              <div className="grid grid-cols-1 gap-2">
                <select
                  value={calendarForm.type}
                  onChange={(event) =>
                    setCalendarForm((prev) => ({ ...prev, type: event.target.value as 'reunion' | 'formation' | 'autre' }))
                  }
                  className="px-3 py-2 border border-gray-300 rounded-lg"
                >
                  <option value="reunion">Reunion</option>
                  <option value="formation">Formation</option>
                  <option value="autre">Autre</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={calendarForm.priorite}
                  onChange={(event) =>
                    setCalendarForm((prev) => ({
                      ...prev,
                      priorite: event.target.value as 'secondaire' | 'normale' | 'importante' | 'urgente'
                    }))
                  }
                  className="px-3 py-2 border border-gray-300 rounded-lg"
                >
                  <option value="secondaire">{CALENDAR_PRIORITY_LABELS.secondaire}</option>
                  <option value="normale">{CALENDAR_PRIORITY_LABELS.normale}</option>
                  <option value="importante">{CALENDAR_PRIORITY_LABELS.importante}</option>
                  <option value="urgente">{CALENDAR_PRIORITY_LABELS.urgente}</option>
                </select>
                <input
                  value={calendarForm.lieu}
                  onChange={(event) => setCalendarForm((prev) => ({ ...prev, lieu: event.target.value }))}
                  placeholder="Lieu"
                  className="px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="time"
                  value={calendarForm.heureDebut}
                  onChange={(event) => setCalendarForm((prev) => ({ ...prev, heureDebut: event.target.value }))}
                  className="px-3 py-2 border border-gray-300 rounded-lg"
                />
                <input
                  type="time"
                  value={calendarForm.heureFin}
                  onChange={(event) => setCalendarForm((prev) => ({ ...prev, heureFin: event.target.value }))}
                  className="px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>
              <select
                value={calendarForm.employeId}
                onChange={(event) => setCalendarForm((prev) => ({ ...prev, employeId: event.target.value }))}
                className="px-3 py-2 border border-gray-300 rounded-lg"
              >
                <option value="">Evenement global (tous)</option>
                {employes.map((employe) => (
                  <option key={employe.id} value={employe.id}>
                    {employe.prenom} {employe.nom}
                  </option>
                ))}
              </select>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => void handleSaveCalendarEvent()}
                  disabled={savingCalendarEvent}
                  className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-50"
                >
                  {savingCalendarEvent ? 'Enregistrement...' : isEditingEvent ? 'Mettre a jour' : 'Creer evenement'}
                </button>
                <button
                  onClick={() => resetCalendarForm()}
                  className="px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50"
                >
                  Reinitialiser
                </button>
                {isEditingEvent ? (
                  <button
                    onClick={() => void handleDeleteCalendarEvent()}
                    disabled={savingCalendarEvent}
                    className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm hover:bg-red-700 disabled:opacity-50"
                  >
                    Supprimer
                  </button>
                ) : null}
              </div>

              <div className="php-list">
                {sortedEvents.length === 0 ? (
                  <div className="php-list-item">
                    <div>
                      <strong>Aucun evenement</strong>
                      <small>Aucun element planifie sur la vue active.</small>
                    </div>
                  </div>
                ) : (
                  sortedEvents.map((event) => (
                    <div key={event.id} className="php-list-item">
                      <div>
                        <strong>{event.title}</strong>
                        <small>{new Date(event.start).toLocaleString('fr-FR')}</small>
                        {event.extendedProps?.employe_nom ? <small>{event.extendedProps.employe_nom}</small> : null}
                      </div>
                      <span className={`php-pill ${event.extendedProps?.source === 'pointage' ? 'is-success' : 'is-warning'}`}>
                        {event.extendedProps?.source === 'pointage'
                          ? 'Pointage'
                          : CALENDAR_PRIORITY_LABELS[
                              (event.extendedProps?.priorite || 'normale') as 'secondaire' | 'normale' | 'importante' | 'urgente'
                            ]}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
        ) : null}
      </div>
    )
  }

  const renderSectionRapports = () => (
    <>
      <section className="php-stats-grid">
        <article className="php-stat-card is-primary">
          <div className="php-stat-head">
            <TrendingUp size={22} />
          </div>
	          <p className="php-stat-value">{tauxPresenceDisplay.toFixed(1)}%</p>
          <p className="php-stat-label">Taux de presence</p>
        </article>
        <article className="php-stat-card is-success">
          <div className="php-stat-head">
            <Clock3 size={22} />
          </div>
          <p className="php-stat-value">{stats.total_heures_jour}h</p>
          <p className="php-stat-label">Heures du jour</p>
        </article>
        <article className="php-stat-card is-warning">
          <div className="php-stat-head">
            <AlertTriangle size={22} />
          </div>
          <p className="php-stat-value">{stats.retards}</p>
          <p className="php-stat-label">Retards</p>
        </article>
        <article className="php-stat-card is-danger">
          <div className="php-stat-head">
            <FileText size={22} />
          </div>
          <p className="php-stat-value">{demandes.length}</p>
          <p className="php-stat-label">Demandes suivies</p>
        </article>
      </section>

      <section className="php-card">
        <div className="php-card-header">
          <h2 className="php-card-title">Apercu rapports</h2>
        </div>
        <div className="php-card-body php-list">
          <div className="php-list-item">
            <div>
              <strong>Presence mensuelle</strong>
              <small>Evolution sur 30 jours</small>
            </div>
	            <strong>{Math.max(0, Math.min(100, tauxPresenceDisplay)).toFixed(1)}%</strong>
          </div>
          <div className="php-list-item">
            <div>
              <strong>Heures cumulees</strong>
              <small>Volume de travail global</small>
            </div>
            <strong>{stats.total_heures_jour}h</strong>
          </div>
        </div>
      </section>
    </>
  )

  const renderSectionParametres = () => (
    <section className="php-card">
      <div className="php-card-header">
        <h2 className="php-card-title">
          <Settings size={16} style={{ marginRight: 8, verticalAlign: 'text-bottom' }} />
          Parametres administration
        </h2>
      </div>
      <div className="php-card-body php-list">
        <div className="php-list-item">
          <div>
            <strong>Notifications e-mail</strong>
            <small>Recevoir les alertes demandes et retards</small>
          </div>
          <span className="php-pill is-success">Active</span>
        </div>
        <div className="php-list-item">
          <div>
            <strong>Validation automatique</strong>
            <small>Appliquer des regles automatiques de validation</small>
          </div>
          <span className="php-pill is-warning">Desactive</span>
        </div>
        <div className="php-list-item">
          <div>
            <strong>Export planifie</strong>
            <small>Generer un rapport hebdomadaire</small>
          </div>
          <span className="php-pill is-success">Configure</span>
        </div>
      </div>
    </section>
  )

  if (section === 'dashboard') return <div>{renderSectionDashboard()}</div>
  if (section === 'employes') return <div>{renderSectionEmployes()}</div>
  if (section === 'pointages') return <div>{renderSectionPointages()}</div>
  if (section === 'demandes') return <div>{renderSectionDemandes()}</div>
  if (section === 'calendrier') return <div>{renderSectionCalendrier()}</div>
  if (section === 'rapports') return <div>{renderSectionRapports()}</div>
  return <div>{renderSectionParametres()}</div>
}

export default AdminDashboard
