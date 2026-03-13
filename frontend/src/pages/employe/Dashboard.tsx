import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { CalendarDays, Clock3, FileText, QrCode, Settings, UserRound, X, Eye, EyeOff } from 'lucide-react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import frLocale from '@fullcalendar/core/locales/fr'
import { apiClient } from '../../services/apiClient'
import { CalendarEvent, calendarService } from '../../services/calendarService'
import { useAuth } from '../../services/authService'
import { uploadService } from '../../services/uploadService'

type PointageType = 'arrivee' | 'depart' | 'pause_debut' | 'pause_fin'
type DemandeType = 'conge' | 'permission' | 'maladie'
type DemandeStatut = 'en_attente' | 'approuvee' | 'rejetee'
type JustificationReason = 'retard' | 'depart_anticipe' | 'autre'
type EmployeeSectionKey = 'dashboard' | 'pointage' | 'historique' | 'retards' | 'demandes' | 'calendrier' | 'profil'
type CalendarTimelineStatus = 'a_venir' | 'en_cours' | 'termine'

interface Pointage {
  id: number
  date_heure: string
  date?: string
  type: PointageType
  statut: 'normal' | 'retard' | 'absent'
  arrivee?: string
  depart?: string
  commentaire?: string
}

interface GroupedPointageDay {
  date: string
  arrivee: Pointage | null
  depart: Pointage | null
}

type PointageQuickTypeFilter = 'all' | 'arrivee' | 'depart' | 'complet'
type PointageQuickStatusFilter = 'all' | 'retard' | 'depart_anticipe' | 'a_l_heure'

interface Demande {
  id: number
  type: DemandeType
  date_debut: string
  date_fin: string
  motif: string
  statut: DemandeStatut
  created_at: string
}

const POINTAGES_PREVIEW_LIMIT = 10

interface UserProfile {
  id: number
  prenom: string
  nom: string
  email: string
  photo?: string
  role?: string
  matricule?: string
  departement: string
  poste: string
  statut?: string
  date_embauche?: string
  contrat_type?: string
  contrat_duree?: string
  contrat_pdf_url?: string
  telephone: string
  adresse?: string
  situation_matrimoniale?: string
  contact_urgence_nom?: string
  contact_urgence_telephone?: string
  contact_urgence_relation?: string
  contact_urgence_adresse_physique?: string
}

interface Statistique {
  total_heures: number
  jours_travailles: number
  retards: number
  absences: number
  pointages_mois: number
}

interface DashboardResponse {
  success: boolean
  user?: Partial<UserProfile>
  statistiques?: Partial<Statistique>
  pointages?: Pointage[]
  demandes?: Demande[]
  dernier_pointage?: Pointage | null
}

interface BadgeAccess {
  id: number
  token: string
  token_hash: string
  user_id: number
  user_type: string
  user_matricule?: string
  user_name?: string
  user_email?: string
  user_role?: string
  created_at?: string
  expires_at?: string
  status: 'active' | 'inactive' | 'expired'
  last_used?: string | null
  usage_count?: number
}

interface PendingJustification {
  pointageId: number
  reason: JustificationReason
  fromScan: boolean
}

const EMPTY_USER: UserProfile = {
  id: 0,
  prenom: '',
  nom: '',
  email: '',
  photo: '',
  role: '',
  matricule: '',
  departement: '',
  poste: '',
  statut: '',
  date_embauche: '',
  contrat_type: '',
  contrat_duree: '',
  contrat_pdf_url: '',
  telephone: '',
  adresse: '',
  situation_matrimoniale: '',
  contact_urgence_nom: '',
  contact_urgence_telephone: '',
  contact_urgence_relation: '',
  contact_urgence_adresse_physique: ''
}

const DEFAULT_PROFILE_FORM = {
  nom: '',
  prenom: '',
  photo: '',
  telephone: '',
  adresse: '',
  situation_matrimoniale: '',
  contact_urgence_nom: '',
  contact_urgence_telephone: '',
  contact_urgence_relation: '',
  contact_urgence_adresse_physique: ''
}

const EMPTY_STATS: Statistique = {
  total_heures: 0,
  jours_travailles: 0,
  retards: 0,
  absences: 0,
  pointages_mois: 0
}

const EMPLOYEE_ALLOWED_ROLES = new Set(['employe', 'chef_departement', 'stagiaire'])
const CALENDAR_PRIORITY_LABELS: Record<'secondaire' | 'normale' | 'importante' | 'urgente', string> = {
  secondaire: 'Secondaire',
  normale: 'Normale',
  importante: 'Importante',
  urgente: 'Urgente'
}
const CALENDAR_TIMELINE_LABELS: Record<CalendarTimelineStatus, string> = {
  a_venir: 'A venir',
  en_cours: 'En cours',
  termine: 'Terminé'
}
const JUSTIFICATION_REASON_LABELS: Record<JustificationReason, string> = {
  retard: 'Retard',
  depart_anticipe: 'Depart anticipe',
  autre: 'Autre'
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

const getSectionFromPath = (pathname: string): EmployeeSectionKey => {
  if (pathname.includes('/pointage')) return 'pointage'
  if (pathname.includes('/historique')) return 'historique'
  if (pathname.includes('/demandes')) return 'demandes'
  if (pathname.includes('/calendrier')) return 'calendrier'
  if (pathname.includes('/profil')) return 'profil'
  return 'dashboard'
}

const normalizePointageType = (value: string): PointageType => {
  const lower = String(value || '').toLowerCase().trim()
  const ascii = lower
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z_ ]/g, '')

  if (lower.includes('arriv')) return 'arrivee'
  if (lower.includes('pause')) {
    if (lower.includes('fin') || lower.includes('repr')) return 'pause_fin'
    return 'pause_debut'
  }
  if (lower.includes('dÃ©part') || ascii.includes('depart') || ascii.includes('dapart') || lower.includes('depar')) return 'depart'
  return 'arrivee'
}

const normalizeDemandeType = (value: string): DemandeType => {
  const lower = value.toLowerCase().trim()
  if (lower.includes('cong')) return 'conge'
  if (lower.includes('perm')) return 'permission'
  return 'maladie'
}

const normalizeDemandeStatut = (value: string): DemandeStatut => {
  const lower = value.toLowerCase().trim()
  if (lower.includes('approuv')) return 'approuvee'
  if (lower.includes('rejet')) return 'rejetee'
  return 'en_attente'
}

const formatDemandeType = (type: DemandeType) => {
  if (type === 'conge') return 'Conge'
  if (type === 'permission') return 'Permission'
  return 'Maladie'
}

const formatDemandeStatut = (status: DemandeStatut) => {
  if (status === 'approuvee') return 'Approuvee'
  if (status === 'rejetee') return 'Rejetee'
  return 'En attente'
}

const parseDateTimeValue = (value: string) => {
  const raw = String(value || '').trim()
  if (!raw) return null

  const dateOnlyMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1])
    const month = Number(dateOnlyMatch[2]) - 1
    const day = Number(dateOnlyMatch[3])
    const localDate = new Date(year, month, day, 0, 0, 0)
    if (!Number.isNaN(localDate.getTime())) {
      return localDate
    }
  }

  const direct = new Date(raw)
  if (!Number.isNaN(direct.getTime())) return direct

  const normalized = raw.replace(' ', 'T')
  const fallback = new Date(normalized)
  if (!Number.isNaN(fallback.getTime())) return fallback

  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2]) - 1
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6] || '0')
  const rebuilt = new Date(year, month, day, hour, minute, second)
  return Number.isNaN(rebuilt.getTime()) ? null : rebuilt
}

const formatDateTime = (value: string) => {
  const date = parseDateTimeValue(value)
  if (!date) return value || '-'
  const dateLabel = date.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  })
  const timeLabel = date.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
  return `${dateLabel} a ${timeLabel}`
}

const formatShortDateTime = (value?: string) => {
  if (!value) return '-'
  const date = parseDateTimeValue(value)
  if (!date) return value
  return date.toLocaleString('fr-FR')
}

const formatPointageType = (type: PointageType) => {
  if (type === 'arrivee') return 'Arrivee'
  if (type === 'depart') return 'Depart'
  if (type === 'pause_debut') return 'Pause (debut)'
  return 'Pause (fin)'
}

const parseTimeSetting = (value: string | undefined, fallbackHour: number, fallbackMinute: number) => {
  const match = String(value || '').trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/)
  if (!match) return { hour: fallbackHour, minute: fallbackMinute }
  return { hour: Number(match[1]), minute: Number(match[2]) }
}

const isArrivalLate = (pointage: Pointage, workStartTime: string) => {
  const date = parseDateTimeValue(pointage.date_heure)
  if (!date) return pointage.statut === 'retard'
  const { hour, minute } = parseTimeSetting(workStartTime, 9, 0)
  const threshold = new Date(date)
  threshold.setHours(hour, minute, 0, 0)
  return date.getTime() > threshold.getTime() || pointage.statut === 'retard'
}

const isDepartAnticipe = (pointage: Pointage, workEndTime: string) => {
  const date = parseDateTimeValue(pointage.date_heure)
  if (!date) return false
  const { hour, minute } = parseTimeSetting(workEndTime, 18, 0)
  const threshold = new Date(date)
  threshold.setHours(hour, minute, 0, 0)
  return date.getTime() < threshold.getTime()
}

const getPointageStatusMeta = (pointage: Pointage, workStartTime: string, workEndTime: string) => {
  if (pointage.type === 'arrivee') {
    if (pointage.statut === 'absent') {
      return { label: 'Absent', className: 'is-danger', badgeClassName: 'bg-red-100 text-red-800' }
    }
    const late = isArrivalLate(pointage, workStartTime)
    if (late) return { label: 'En retard', className: 'is-warning', badgeClassName: 'bg-yellow-100 text-yellow-800' }
    return { label: "A l'heure", className: 'is-success', badgeClassName: 'bg-green-100 text-green-800' }
  }

  if (pointage.type === 'pause_debut') {
    return { label: 'Pause en cours', className: 'is-primary', badgeClassName: 'bg-blue-100 text-blue-800' }
  }

  if (pointage.type === 'pause_fin') {
    return { label: 'Pause terminee', className: 'is-info', badgeClassName: 'bg-indigo-100 text-indigo-800' }
  }

  const early = isDepartAnticipe(pointage, workEndTime)
  if (early) return { label: 'Depart anticipe', className: 'is-warning', badgeClassName: 'bg-yellow-100 text-yellow-800' }
  return { label: 'Depart normal', className: 'is-success', badgeClassName: 'bg-green-100 text-green-800' }
}

const formatRoleLabel = (value?: string) => {
  const role = String(value || 'employe').trim().toLowerCase()
  const labels: Record<string, string> = {
    super_admin: 'Super admin',
    admin: 'Admin',
    manager: 'Manager',
    hr: 'RH',
    chef_departement: 'Chef de departement',
    stagiaire: 'Stagiaire',
    employe: 'Employe'
  }
  return labels[role] || role.replace(/_/g, ' ')
}

const normalizeJustificationReason = (value?: string | null): JustificationReason => {
  const raw = String(value || '').trim().toLowerCase()
  if (raw === 'retard') return 'retard'
  if (raw === 'depart_anticipe' || raw === 'depart-anticipe') return 'depart_anticipe'
  return 'autre'
}

const getDefaultJustificationRaison = (reason: JustificationReason) => {
  if (reason === 'retard') return 'Retard'
  if (reason === 'depart_anticipe') return 'Depart anticipe'
  return ''
}

const normalizePointageStatus = (value: string): Pointage['statut'] => {
  const lower = String(value || '').toLowerCase().trim()
  if (lower.includes('retard')) return 'retard'
  if (lower.includes('abs')) return 'absent'
  return 'normal'
}

const badgeStatusLabel = (value?: BadgeAccess['status']) => {
  if (value === 'expired') return 'Badge expire'
  if (value === 'inactive') return 'Badge inactif'
  return 'Badge actif'
}

const badgeStatusClass = (value?: BadgeAccess['status']) => {
  if (value === 'expired') return 'is-warning'
  if (value === 'inactive') return 'is-danger'
  return 'is-success'
}

const buildBadgeQrUrl = (token: string, size = 280) => {
  const safeToken = String(token || '').trim()
  if (!safeToken) return ''
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(safeToken)}`
}

const resolveDocumentUrl = (value?: string | null) => {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (
    raw.startsWith('http://')
    || raw.startsWith('https://')
    || raw.startsWith('data:')
    || raw.startsWith('blob:')
    || raw.startsWith('/api/')
    || raw.startsWith('/uploads/')
  ) {
    return raw
  }
  if (raw.startsWith('api/')) return `/${raw}`
  if (raw.startsWith('uploads/')) return `/api/${raw}`
  if (raw.startsWith('/')) return raw
  return `/api/uploads/${raw}`
}

const getMatriculeLabel = (user: UserProfile, badge?: BadgeAccess | null) =>
  user.matricule || badge?.user_matricule || (user.id ? `EMP${String(user.id).padStart(6, '0')}` : '-')

const isBlobUrl = (value: string) => value.startsWith('blob:')

const isSameCalendarDay = (left: Date, right: Date) =>
  left.getFullYear() === right.getFullYear()
  && left.getMonth() === right.getMonth()
  && left.getDate() === right.getDate()

const resolvePointageTimelineStatus = (event: CalendarEvent, now = new Date()): CalendarTimelineStatus => {
  const pointageDate = parseDateTimeValue(event.start)
  if (!pointageDate) return 'a_venir'

  if (!isSameCalendarDay(pointageDate, now)) {
    return pointageDate.getTime() > now.getTime() ? 'a_venir' : 'termine'
  }

  const normalizedType = String(event.extendedProps?.type || '').toLowerCase().trim()
  if (normalizedType.includes('depart')) return 'termine'
  if (normalizedType.includes('arriv')) return 'en_cours'
  if (normalizedType.includes('pause')) return 'en_cours'
  return 'en_cours'
}

const resolveCalendarTimelineStatus = (event: CalendarEvent, now = new Date()): CalendarTimelineStatus => {
  if (event.extendedProps?.source === 'pointage') {
    return resolvePointageTimelineStatus(event, now)
  }

  const startDate = parseDateTimeValue(event.start)
  const endDate = parseDateTimeValue(event.end || event.start)
  if (!startDate) return 'a_venir'
  if (!endDate) {
    if (startDate > now) return 'a_venir'
    return startDate < now ? 'termine' : 'en_cours'
  }

  if (now < startDate) return 'a_venir'
  if (now > endDate) return 'termine'
  return 'en_cours'
}

const calendarTimelinePillClass = (status: CalendarTimelineStatus) => {
  if (status === 'a_venir') return 'is-primary'
  if (status === 'en_cours') return 'is-success'
  return 'is-warning'
}

const EmployeeDashboard = () => {
  const navigate = useNavigate()
  const { user: authUser, logout, updateProfile, changePassword, isLoading: authLoading } = useAuth()
  const location = useLocation()
  const section = useMemo(() => getSectionFromPath(location.pathname), [location.pathname])

  const [loading, setLoading] = useState(true)
  const [savingDemande, setSavingDemande] = useState(false)
  const [showBadgeModal, setShowBadgeModal] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const [user, setUser] = useState<UserProfile>(EMPTY_USER)
  const [statistiques, setStatistiques] = useState<Statistique>(EMPTY_STATS)
  const [pointages, setPointages] = useState<Pointage[]>([])
  const [groupedPointages, setGroupedPointages] = useState<GroupedPointageDay[]>([])
  const [pointageDateFilter, setPointageDateFilter] = useState('')
  const [pointageTypeFilter, setPointageTypeFilter] = useState<PointageQuickTypeFilter>('all')
  const [pointageStatusFilter, setPointageStatusFilter] = useState<PointageQuickStatusFilter>('all')
  const [pointageSearchTerm, setPointageSearchTerm] = useState('')
  const [demandes, setDemandes] = useState<Demande[]>([])
  const [dernierPointage, setDernierPointage] = useState<Pointage | null>(null)
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([])
  const [calendarLoading, setCalendarLoading] = useState(false)
  const [calendarError, setCalendarError] = useState<string | null>(null)
  const [calendarInfo, setCalendarInfo] = useState<string | null>(null)
  const [selectedCalendarEventId, setSelectedCalendarEventId] = useState<string | null>(null)
  const [calendarRange, setCalendarRange] = useState(buildDefaultCalendarRange)
  const calendarRef = useRef<FullCalendar | null>(null)
  const calendarDatePickerRef = useRef<HTMLInputElement | null>(null)
  const [badgeData, setBadgeData] = useState<BadgeAccess | null>(null)
  const [badgeLoading, setBadgeLoading] = useState(false)
  const [profileEditing, setProfileEditing] = useState(false)
  const [profileSaving, setProfileSaving] = useState(false)
  const [profilePhotoUploading, setProfilePhotoUploading] = useState(false)
  const [profilePhotoPreview, setProfilePhotoPreview] = useState('')
  const [profileFeedback, setProfileFeedback] = useState<string | null>(null)
  const [profileFeedbackType, setProfileFeedbackType] = useState<'success' | 'error'>('success')
  const [profileForm, setProfileForm] = useState(DEFAULT_PROFILE_FORM)
  const [showDemandeModal, setShowDemandeModal] = useState(false)
  const [demandeForm, setDemandeForm] = useState({
    type: 'permission' as DemandeType,
    date_debut: '',
    date_fin: '',
    motif: ''
  })
  const [demandeFeedback, setDemandeFeedback] = useState<string | null>(null)
  const [demandeFeedbackType, setDemandeFeedbackType] = useState<'success' | 'error'>('success')
  const [passwordForm, setPasswordForm] = useState({
    current_password: 'XpertPro2026',
    new_password: '',
    confirm_password: ''
  })
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [passwordFeedback, setPasswordFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [showPasswords, setShowPasswords] = useState({
    current_password: false,
    new_password: false,
    confirm_password: false
  })
  const [pendingJustification, setPendingJustification] = useState<PendingJustification | null>(null)
  const [showJustificationModal, setShowJustificationModal] = useState(false)
  const [justificationSaving, setJustificationSaving] = useState(false)
  const [justificationFeedback, setJustificationFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [justificationForm, setJustificationForm] = useState({
    raison: '',
    details: ''
  })
  const [workStartTime, setWorkStartTime] = useState('09:00')
  const [workEndTime, setWorkEndTime] = useState('18:00')

  const isUnauthorizedError = useCallback((error: any) => {
    const status = Number(error?.status || 0)
    if (status === 401 || status === 403) return true
    const message = String(error?.message || '').toLowerCase()
    return message.includes('401') || message.includes('403') || message.includes('token')
  }, [])

  const initials = useMemo(() => `${user.prenom?.[0] || ''}${user.nom?.[0] || ''}`.toUpperCase() || 'EM', [user.nom, user.prenom])
  const resolvedProfilePhotoUrl = useMemo(
    () => profilePhotoPreview || uploadService.resolvePhotoUrl(profileForm.photo || user.photo || ''),
    [profileForm.photo, profilePhotoPreview, user.photo]
  )
  const selectedCalendarEvent = useMemo(() => {
    if (!selectedCalendarEventId) return null
    return calendarEvents.find((event) => String(event.id) === selectedCalendarEventId) || null
  }, [calendarEvents, selectedCalendarEventId])
  const selectedCalendarTimelineStatus = useMemo(() => {
    if (!selectedCalendarEvent) return null
    return resolveCalendarTimelineStatus(selectedCalendarEvent, new Date())
  }, [selectedCalendarEvent])
  const filteredGroupedPointages = useMemo(() => {
    const search = pointageSearchTerm.trim().toLowerCase()
    return groupedPointages.filter((dayPointages) => {
      if (pointageDateFilter && dayPointages.date !== pointageDateFilter) {
        return false
      }

      if (pointageTypeFilter === 'arrivee' && !dayPointages.arrivee) {
        return false
      }
      if (pointageTypeFilter === 'depart' && !dayPointages.depart) {
        return false
      }
      if (pointageTypeFilter === 'complet' && (!dayPointages.arrivee || !dayPointages.depart)) {
        return false
      }

      const hasRetard = Boolean(dayPointages.arrivee && isArrivalLate(dayPointages.arrivee, workStartTime))
      const hasDepartAnticipe = Boolean(dayPointages.depart && isDepartAnticipe(dayPointages.depart, workEndTime))

      if (pointageStatusFilter === 'retard' && !hasRetard) {
        return false
      }
      if (pointageStatusFilter === 'depart_anticipe' && !hasDepartAnticipe) {
        return false
      }
      if (pointageStatusFilter === 'a_l_heure') {
        const hasAnyPointage = Boolean(dayPointages.arrivee || dayPointages.depart)
        if (!hasAnyPointage || hasRetard || hasDepartAnticipe) {
          return false
        }
      }

      if (!search) return true

      const searchableValues = [
        dayPointages.date,
        dayPointages.arrivee?.arrivee || '',
        dayPointages.depart?.depart || '',
        dayPointages.arrivee?.commentaire || '',
        dayPointages.depart?.commentaire || '',
        dayPointages.arrivee ? getPointageStatusMeta(dayPointages.arrivee, workStartTime, workEndTime).label : '',
        dayPointages.depart ? getPointageStatusMeta(dayPointages.depart, workStartTime, workEndTime).label : ''
      ]
      return searchableValues.join(' ').toLowerCase().includes(search)
    })
  }, [groupedPointages, pointageDateFilter, pointageTypeFilter, pointageStatusFilter, pointageSearchTerm, workStartTime, workEndTime])

  const visibleGroupedPointages = useMemo(
    () => filteredGroupedPointages.slice(0, POINTAGES_PREVIEW_LIMIT),
    [filteredGroupedPointages]
  )

  useEffect(() => {
    if (profileEditing) return
    setProfileForm({
      nom: user.nom || '',
      prenom: user.prenom || '',
      photo: user.photo || '',
      telephone: user.telephone || '',
      adresse: user.adresse || '',
      situation_matrimoniale: user.situation_matrimoniale || '',
      contact_urgence_nom: user.contact_urgence_nom || '',
      contact_urgence_telephone: user.contact_urgence_telephone || '',
      contact_urgence_relation: user.contact_urgence_relation || '',
      contact_urgence_adresse_physique: user.contact_urgence_adresse_physique || ''
    })
  }, [
    profileEditing,
    user.adresse,
    user.contact_urgence_adresse_physique,
    user.contact_urgence_nom,
    user.contact_urgence_relation,
    user.contact_urgence_telephone,
    user.nom,
    user.photo,
    user.prenom,
    user.situation_matrimoniale,
    user.telephone
  ])

  useEffect(() => {
    return () => {
      if (isBlobUrl(profilePhotoPreview)) {
        URL.revokeObjectURL(profilePhotoPreview)
      }
    }
  }, [profilePhotoPreview])

  useEffect(() => {
    if (selectedCalendarEventId && !selectedCalendarEvent) {
      setSelectedCalendarEventId(null)
    }
  }, [selectedCalendarEvent, selectedCalendarEventId])

  const handleProfileInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = event.target
    setProfileForm((prev) => ({ ...prev, [name]: value }))
  }, [])

  const handleProfilePhotoChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    try {
      setProfilePhotoUploading(true)
      setProfileFeedback(null)

      const localPreviewUrl = URL.createObjectURL(file)
      setProfilePhotoPreview((previous) => {
        if (isBlobUrl(previous)) {
          URL.revokeObjectURL(previous)
        }
        return localPreviewUrl
      })

      const uploadedPhotoUrl = await uploadService.uploadProfilePhoto(file)
      setProfileForm((prev) => ({ ...prev, photo: uploadedPhotoUrl }))
      setProfileFeedbackType('success')
      setProfileFeedback('Photo professionnelle telechargee.')
    } catch (uploadError: any) {
      console.error('Erreur upload photo profil employe dashboard:', uploadError)
      setProfileFeedbackType('error')
      setProfileFeedback(uploadError?.message || "Impossible de telecharger la photo.")
    } finally {
      setProfilePhotoUploading(false)
    }
  }, [])

  const handleProfilePhotoRemove = useCallback(() => {
    setProfileForm((prev) => ({ ...prev, photo: '' }))
    setProfilePhotoPreview((previous) => {
      if (isBlobUrl(previous)) {
        URL.revokeObjectURL(previous)
      }
      return ''
    })
    setProfileFeedback(null)
  }, [])

  const handleProfileCancel = useCallback(() => {
    setProfileForm({
      nom: user.nom || '',
      prenom: user.prenom || '',
      photo: user.photo || '',
      telephone: user.telephone || '',
      adresse: user.adresse || '',
      situation_matrimoniale: user.situation_matrimoniale || '',
      contact_urgence_nom: user.contact_urgence_nom || '',
      contact_urgence_telephone: user.contact_urgence_telephone || '',
      contact_urgence_relation: user.contact_urgence_relation || '',
      contact_urgence_adresse_physique: user.contact_urgence_adresse_physique || ''
    })
    setProfilePhotoPreview((previous) => {
      if (isBlobUrl(previous)) {
        URL.revokeObjectURL(previous)
      }
      return ''
    })
    setProfileFeedback(null)
    setProfileFeedbackType('success')
    setProfileEditing(false)
  }, [
    user.adresse,
    user.contact_urgence_adresse_physique,
    user.contact_urgence_nom,
    user.contact_urgence_relation,
    user.contact_urgence_telephone,
    user.nom,
    user.photo,
    user.prenom,
    user.situation_matrimoniale,
    user.telephone
  ])

  const loadCalendarEvents = useCallback(async (params?: { start?: string; end?: string }) => {
    const start = params?.start || calendarRange.start
    const end = params?.end || calendarRange.end

    try {
      setCalendarLoading(true)
      setCalendarError(null)
      setCalendarInfo(null)
      const events = await calendarService.getEvents({ start, end, include_pointages: true })
      setCalendarEvents(events)
    } catch (loadError: any) {
      console.error('Erreur chargement calendrier employe:', loadError)
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
  }, [calendarRange.end, calendarRange.start, isUnauthorizedError, logout, navigate])

  const loadBadgeData = useCallback(async () => {
    try {
      setBadgeLoading(true)
      const candidateUrls = ['/api/badge/employe', '/api/employe/badge']

      for (const url of candidateUrls) {
        try {
          const response = await apiClient.get<{ success?: boolean; badge?: BadgeAccess | null }>(url)
          if (response && Object.prototype.hasOwnProperty.call(response, 'badge')) {
            setBadgeData(response.badge || null)
            return
          }
        } catch (error: any) {
          if (error?.status === 404) {
            continue
          }
          throw error
        }
      }

      setBadgeData(null)
    } catch (error: any) {
      console.error('Erreur chargement badge employe:', error)
      if (isUnauthorizedError(error)) {
        logout()
        navigate('/login', { replace: true })
        return
      }
      setBadgeData(null)
    } finally {
      setBadgeLoading(false)
    }
  }, [isUnauthorizedError, logout, navigate])

  useEffect(() => {
    if (authLoading || !authUser) {
      return
    }
    const role = String(authUser.role || '').toLowerCase()
    if (!EMPLOYEE_ALLOWED_ROLES.has(role)) {
      return
    }
    void loadCalendarEvents()
  }, [authLoading, authUser, loadCalendarEvents])

  const handleCalendarDatesSet = useCallback((arg: { start: Date; end: Date }) => {
    const nextRange = {
      start: arg.start.toISOString(),
      end: arg.end.toISOString()
    }
    setCalendarRange((prev) => {
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
    setCalendarInfo(`Calendrier positionne sur le ${new Date(`${value}T00:00:00`).toLocaleDateString('fr-FR')}.`)
    event.target.value = ''
  }, [])

  const handleCalendarEventClick = useCallback((arg: { event: any }) => {
    const parsedEvent = parseCalendarEventId(arg.event.id)
    const sourceLabel = arg.event.extendedProps?.source === 'pointage' ? 'Pointage' : 'Evenement'
    const priorite = String(arg.event.extendedProps?.priorite || 'normale') as 'secondaire' | 'normale' | 'importante' | 'urgente'
    const prioriteLabel = CALENDAR_PRIORITY_LABELS[priorite] || CALENDAR_PRIORITY_LABELS.normale
    const lieu = String(arg.event.extendedProps?.lieu || '').trim()
    const eventDate = arg.event.start ? formatDateTime(arg.event.start.toISOString?.() || String(arg.event.start)) : '-'
    setSelectedCalendarEventId(String(arg.event.id || ''))

    if (!parsedEvent || parsedEvent.kind !== 'evenement') {
      const retardMinutes = Number(arg.event.extendedProps?.retard_minutes || 0)
      const inferredType = normalizePointageType(String(arg.event.extendedProps?.type || arg.event.title || 'arrivee'))
      const inferredStatus = normalizePointageStatus(
        String(arg.event.extendedProps?.statut || (retardMinutes > 0 ? 'retard' : 'normal'))
      )
      const inferredPointage: Pointage = {
        id: Number(arg.event.extendedProps?.pointage_id || 0),
        date_heure: arg.event.start ? (arg.event.start.toISOString?.() || String(arg.event.start)) : new Date().toISOString(),
        type: inferredType,
        statut: inferredStatus
      }
      const statusMeta = getPointageStatusMeta(inferredPointage, workStartTime, workEndTime)
      const details = [
        `${sourceLabel}: ${arg.event.title || 'Sans titre'}`,
        `Date: ${eventDate}`,
        `Statut: ${statusMeta.label}`
      ]
      if (inferredType === 'arrivee' && retardMinutes > 0) {
        details.push(`Retard: ${retardMinutes} min`)
      }
      setCalendarInfo(details.join(' | '))
      return
    }

    const details = [
      `${sourceLabel}: ${arg.event.title || 'Sans titre'}`,
      `Date: ${eventDate}`,
      `Priorite: ${prioriteLabel}`
    ]
    if (lieu) {
      details.push(`Lieu: ${lieu}`)
    }
    setCalendarInfo(`${details.join(' | ')} | Selectionne`)
  }, [workEndTime, workStartTime])

  const loadDashboardData = useCallback(async () => {
    try {
      setLoading(true)
      setErrorMessage(null)

      const [response, settingsResponse] = await Promise.all([
        apiClient.get<DashboardResponse>('/api/employe/dashboard'),
        apiClient
          .get<{ success?: boolean; settings?: { work_start_time?: string; work_end_time?: string } }>('/api/settings/me')
          .catch(() => null)
      ])
      if (!response?.success) {
        throw new Error('Reponse dashboard invalide')
      }

      const nextWorkStartTime = String(settingsResponse?.settings?.work_start_time || '').trim()
      const nextWorkEndTime = String(settingsResponse?.settings?.work_end_time || '').trim()
      if (/^([01]\d|2[0-3]):([0-5]\d)$/.test(nextWorkStartTime)) {
        setWorkStartTime(nextWorkStartTime)
      }
      if (/^([01]\d|2[0-3]):([0-5]\d)$/.test(nextWorkEndTime)) {
        setWorkEndTime(nextWorkEndTime)
      }

      const apiUser = response.user || {}
      const apiStats = response.statistiques || {}
      const normalizedUser: UserProfile = {
        ...EMPTY_USER,
        ...apiUser,
        id: Number(apiUser.id || 0),
        contrat_type: String((apiUser as any).contrat_type || (apiUser as any).contratType || ''),
        contrat_duree: String((apiUser as any).contrat_duree || (apiUser as any).contratDuree || ''),
        contrat_pdf_url: resolveDocumentUrl(
          (apiUser as any).contrat_pdf_url
            || (apiUser as any).contrat_pdf
            || (apiUser as any).contratPdfUrl
            || (apiUser as any).contrat_url
            || ''
        )
      }

      setUser(normalizedUser)
      setStatistiques({
        ...EMPTY_STATS,
        ...apiStats,
        total_heures: Number(apiStats.total_heures || 0),
        jours_travailles: Number(apiStats.jours_travailles || 0),
        retards: Number(apiStats.retards || 0),
        absences: Number(apiStats.absences || 0),
        pointages_mois: Number(apiStats.pointages_mois || 0)
      })

      const normalizedPointages = (response.pointages || [])
        .filter((pointage) => {
          const type = String(pointage.type || '').toLowerCase()
          return type === 'arrivee' || type === 'depart'
        })
        .map((pointage) => ({
          ...pointage,
          type: normalizePointageType(String(pointage.type || 'arrivee')),
          statut: normalizePointageStatus(String(pointage.statut || 'normal'))
        }))

      // Regrouper les pointages par date pour afficher arrivée et départ sur la même ligne
      const groupedPointages = normalizedPointages.reduce((acc, pointage) => {
        const date = pointage.date || new Date(pointage.date_heure).toISOString().split('T')[0]
        if (!acc[date]) {
          acc[date] = { date, arrivee: null, depart: null }
        }
        if (pointage.type === 'arrivee') {
          acc[date].arrivee = pointage
        } else if (pointage.type === 'depart') {
          acc[date].depart = pointage
        }
        return acc
      }, {} as Record<string, { date: string; arrivee: any; depart: any }>)

      const normalizedDemandes = (response.demandes || []).map((demande) => ({
        ...demande,
        type: normalizeDemandeType(String(demande.type || 'conge')),
        statut: normalizeDemandeStatut(String(demande.statut || 'en_attente'))
      }))

      setPointages(normalizedPointages)
      setGroupedPointages(Object.values(groupedPointages).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()))
      setDemandes(normalizedDemandes)
      setDernierPointage(
            response.dernier_pointage
              ? {
                  ...response.dernier_pointage,
                  type: normalizePointageType(String(response.dernier_pointage.type || 'arrivee')),
                  statut: normalizePointageStatus(String(response.dernier_pointage.statut || 'normal'))
                }
          : normalizedPointages[0] || null
      )
    } catch (error: any) {
      console.error('Erreur dashboard employe:', error)
      if (isUnauthorizedError(error)) {
        logout()
        navigate('/login', { replace: true })
        return
      }
      setErrorMessage('Impossible de charger votre dashboard employe.')
      setUser(EMPTY_USER)
      setStatistiques(EMPTY_STATS)
      setPointages([])
      setDemandes([])
      setDernierPointage(null)
    } finally {
      setLoading(false)
    }
  }, [isUnauthorizedError, logout, navigate])

  const handleProfileSave = useCallback(async () => {
    try {
      setProfileSaving(true)
      setProfileFeedback(null)

      if (profilePhotoUploading) {
        setProfileFeedbackType('error')
        setProfileFeedback('Patientez pendant le telechargement de la photo.')
        return
      }

      const payload = {
        nom: profileForm.nom.trim(),
        prenom: profileForm.prenom.trim(),
        photo: profileForm.photo ? profileForm.photo.trim() : '',
        telephone: profileForm.telephone.trim(),
        adresse: profileForm.adresse.trim(),
        situation_matrimoniale: profileForm.situation_matrimoniale.trim(),
        contact_urgence_nom: profileForm.contact_urgence_nom.trim(),
        contact_urgence_telephone: profileForm.contact_urgence_telephone.trim(),
        contact_urgence_relation: profileForm.contact_urgence_relation.trim(),
        contact_urgence_adresse_physique: profileForm.contact_urgence_adresse_physique.trim()
      }

      if (!payload.nom || !payload.prenom) {
        setProfileFeedbackType('error')
        setProfileFeedback('Le nom et le prenom sont obligatoires.')
        return
      }

      const response = await updateProfile(payload)
      if (!response.success) {
        throw new Error(response.error || 'Mise a jour impossible')
      }

      setProfileEditing(false)
      setProfilePhotoPreview((previous) => {
        if (isBlobUrl(previous)) {
          URL.revokeObjectURL(previous)
        }
        return ''
      })
      setProfileFeedbackType('success')
      setProfileFeedback('Profil personnel mis a jour.')
      await loadDashboardData()
    } catch (saveError: any) {
      console.error('Erreur mise a jour profil employe dashboard:', saveError)
      setProfileFeedbackType('error')
      setProfileFeedback(saveError?.message || 'Erreur lors de la sauvegarde du profil.')
    } finally {
      setProfileSaving(false)
    }
  }, [loadDashboardData, profileForm, profilePhotoUploading, updateProfile])

  const handleQuickDemande = useCallback(() => {
    setDemandeFeedback(null)
    setDemandeFeedbackType('success')
    setShowDemandeModal(true)
  }, [])

  const handleDemandeInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = event.target
    if (name === 'type') {
      setDemandeForm((prev) => ({ ...prev, type: value as DemandeType }))
      return
    }
    setDemandeForm((prev) => ({ ...prev, [name]: value }))
  }, [])

  const handleDemandeCancel = useCallback(() => {
    setDemandeForm({
      type: 'permission',
      date_debut: '',
      date_fin: '',
      motif: ''
    })
    setDemandeFeedback(null)
    setDemandeFeedbackType('success')
    setShowDemandeModal(false)
  }, [])

  const handleDemandeSubmit = useCallback(async () => {
    try {
      setSavingDemande(true)
      setDemandeFeedback(null)

      const payload = {
        type: demandeForm.type,
        date_debut: demandeForm.date_debut,
        date_fin: demandeForm.date_fin,
        motif: demandeForm.motif.trim()
      }

      if (!payload.type || !payload.date_debut || !payload.date_fin || !payload.motif) {
        setDemandeFeedbackType('error')
        setDemandeFeedback('Tous les champs sont obligatoires.')
        return
      }

      const response = await apiClient.post<typeof payload, { success: boolean; demande?: Demande; message?: string }>(
        '/api/employe/demandes',
        payload
      )

      if (!response?.success || !response.demande) {
        throw new Error(response?.message || 'Demande impossible')
      }

      const newDemande: Demande = {
        ...response.demande,
        type: normalizeDemandeType(String(response.demande.type || 'permission')),
        statut: normalizeDemandeStatut(String(response.demande.statut || 'en_attente'))
      }

      setDemandes((prev) => [newDemande, ...prev])
      setDemandeFeedbackType('success')
      setDemandeFeedback('Demande envoyee avec succes.')
      setShowDemandeModal(false)
      setDemandeForm({
        type: 'permission',
        date_debut: '',
        date_fin: '',
        motif: ''
      })
      await loadDashboardData()
    } catch (demandeError: any) {
      console.error('Erreur demande employe dashboard:', demandeError)
      if (isUnauthorizedError(demandeError)) {
        logout()
        navigate('/login', { replace: true })
        return
      }
      setDemandeFeedbackType('error')
      setDemandeFeedback(demandeError?.message || 'Erreur lors de la demande.')
    } finally {
      setSavingDemande(false)
    }
  }, [demandeForm, isUnauthorizedError, loadDashboardData, logout, navigate])

  const handlePasswordInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target
    setPasswordForm((prev) => ({ ...prev, [name]: value }))
  }, [])

  const handlePasswordSave = useCallback(async () => {
    try {
      setPasswordSaving(true)
      setPasswordFeedback(null)

      const currentPassword = passwordForm.current_password.trim()
      const newPassword = passwordForm.new_password.trim()
      const confirmPassword = passwordForm.confirm_password.trim()

      if (!currentPassword || !newPassword || !confirmPassword) {
        setPasswordFeedback({ type: 'error', message: 'Tous les champs mot de passe sont obligatoires.' })
        return
      }
      if (newPassword.length < 8) {
        setPasswordFeedback({ type: 'error', message: 'Le nouveau mot de passe doit contenir au moins 8 caracteres.' })
        return
      }
      if (newPassword !== confirmPassword) {
        setPasswordFeedback({ type: 'error', message: 'La confirmation du nouveau mot de passe ne correspond pas.' })
        return
      }

      const response = await changePassword(currentPassword, newPassword)
      if (!response.success) {
        throw new Error(response.error || 'Mise a jour du mot de passe impossible')
      }

      setPasswordForm({
        current_password: '',
        new_password: '',
        confirm_password: ''
      })
      setPasswordFeedback({ type: 'success', message: 'Mot de passe modifie avec succes.' })
    } catch (error: any) {
      console.error('Erreur changement mot de passe employe:', error)
      setPasswordFeedback({
        type: 'error',
        message: error?.message || 'Erreur lors de la mise a jour du mot de passe.'
      })
    } finally {
      setPasswordSaving(false)
    }
  }, [changePassword, passwordForm.confirm_password, passwordForm.current_password, passwordForm.new_password])

  const clearJustificationQuery = useCallback(() => {
    if (!location.search) return
    const params = new URLSearchParams(location.search)
    if (!params.has('justifyPointageId') && !params.has('reason') && !params.has('fromScan')) {
      return
    }
    params.delete('justifyPointageId')
    params.delete('reason')
    params.delete('fromScan')
    const nextSearch = params.toString()
    navigate(
      `${location.pathname}${nextSearch ? `?${nextSearch}` : ''}`,
      { replace: true }
    )
  }, [location.pathname, location.search, navigate])

  const handleJustificationClose = useCallback(() => {
    if (justificationSaving) return
    setShowJustificationModal(false)
    setPendingJustification(null)
    setJustificationFeedback(null)
    setJustificationForm({ raison: '', details: '' })
    clearJustificationQuery()
  }, [clearJustificationQuery, justificationSaving])

  const handleJustificationInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = event.target
    setJustificationForm((prev) => ({ ...prev, [name]: value }))
  }, [])

  const togglePasswordVisibility = useCallback((field: 'current_password' | 'new_password' | 'confirm_password') => {
    setShowPasswords(prev => ({ ...prev, [field]: !prev[field] }))
  }, [])

  const handleJustificationSubmit = useCallback(async () => {
    if (!pendingJustification) return
    const raison = justificationForm.raison.trim()
    const details = justificationForm.details.trim()

    if (!raison) {
      setJustificationFeedback({ type: 'error', message: 'La raison est obligatoire.' })
      return
    }

    try {
      setJustificationSaving(true)
      setJustificationFeedback(null)

      const response = await apiClient.post<
        { raison: string; details?: string },
        { success: boolean; message?: string }
      >(`/api/retards/${pendingJustification.pointageId}/justifier`, {
        raison,
        details
      })

      if (!response?.success) {
        throw new Error(response?.message || 'Justification impossible')
      }

      setJustificationFeedback({
        type: 'success',
        message: response?.message || 'Justification enregistree.'
      })
      await loadDashboardData()
      window.setTimeout(() => {
        handleJustificationClose()
      }, 600)
    } catch (submitError: any) {
      console.error('Erreur justification dashboard employe:', submitError)
      if (isUnauthorizedError(submitError)) {
        logout()
        navigate('/login', { replace: true })
        return
      }
      setJustificationFeedback({
        type: 'error',
        message: submitError?.message || 'Erreur lors de la justification.'
      })
    } finally {
      setJustificationSaving(false)
    }
  }, [
    handleJustificationClose,
    isUnauthorizedError,
    justificationForm.details,
    justificationForm.raison,
    loadDashboardData,
    logout,
    navigate,
    pendingJustification
  ])

  useEffect(() => {
    if (authLoading || !authUser) return
    if (!location.search) return

    const params = new URLSearchParams(location.search)
    const pointageId = Number(params.get('justifyPointageId') || 0)
    if (!Number.isInteger(pointageId) || pointageId <= 0) return

    const reason = normalizeJustificationReason(params.get('reason'))
    const fromScan = params.get('fromScan') === '1'

    setPendingJustification({ pointageId, reason, fromScan })
    setJustificationForm((prev) => ({
      raison: prev.raison || getDefaultJustificationRaison(reason),
      details: prev.details || ''
    }))
    setJustificationFeedback(null)
    setShowJustificationModal(true)
  }, [authLoading, authUser, location.search])

  useEffect(() => {
    if (authLoading) {
      return
    }

    if (!authUser) {
      navigate('/login', { replace: true })
      return
    }

    const role = String(authUser.role || '').toLowerCase()
    if (!EMPLOYEE_ALLOWED_ROLES.has(role)) {
      if (role === 'admin' || role === 'super_admin' || role === 'manager' || role === 'hr') {
        navigate('/admin', { replace: true })
      } else {
        logout()
        navigate('/login', { replace: true })
      }
      return
    }

    void Promise.all([loadDashboardData(), loadBadgeData()])
  }, [authLoading, authUser, loadBadgeData, loadDashboardData, logout, navigate])

  if (loading) {
    return (
      <section className="php-card">
        <div className="php-card-body">Chargement du dashboard employe...</div>
      </section>
    )
  }

  const renderProfileCard = () => (
    <article className="php-profile-card">
      <div className="php-profile-head">
        <span className="php-profile-avatar php-profile-avatar-square" style={{ overflow: 'hidden' }}>
          {resolvedProfilePhotoUrl ? (
            <img
              src={resolvedProfilePhotoUrl}
              alt={`Photo de ${user.prenom || 'employe'}`}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            initials
          )}
        </span>
        <div className="php-profile-meta">
          <h3>{user.prenom} {user.nom}</h3>
          <p>{user.poste || 'Employe'} - {user.departement || 'Departement non renseigne'}</p>
        </div>
      </div>

      <div className="php-profile-details">
        <div className="php-detail">
          <small>Email</small>
          <strong>{user.email || '-'}</strong>
        </div>
        <div className="php-detail">
          <small>Telephone</small>
          <strong>{user.telephone || '-'}</strong>
        </div>
        <div className="php-detail">
          <small>Dernier pointage</small>
          <strong>
            {dernierPointage
              ? `${formatPointageType(dernierPointage.type)} - ${formatDateTime(dernierPointage.date_heure)} (${getPointageStatusMeta(dernierPointage, workStartTime, workEndTime).label})`
              : 'Aucun pointage'}
          </strong>
        </div>
        <div className="php-detail">
          <small>Pointages du mois</small>
          <strong>{statistiques.pointages_mois}</strong>
        </div>
        <div className="php-detail">
          <small>Date d'embauche</small>
          <strong>{user.date_embauche ? formatDateTime(user.date_embauche) : '-'}</strong>
        </div>
        <div className="php-detail">
          <small>Matricule</small>
          <strong>{getMatriculeLabel(user, badgeData)}</strong>
        </div>
        <div className="php-detail">
          <small>Contrat de travail (PDF)</small>
          {user.contrat_pdf_url ? (
            <a
              href={user.contrat_pdf_url}
              target="_blank"
              rel="noopener noreferrer"
              className="php-link-btn"
            >
              Ouvrir le contrat
            </a>
          ) : (
            <strong>Non disponible</strong>
          )}
          {(user.contrat_type || user.contrat_duree) ? (
            <small>{[user.contrat_type, user.contrat_duree].filter(Boolean).join(' - ')}</small>
          ) : null}
        </div>
      </div>
    </article>
  )

  const renderBadgeCard = () => (
    <article className="php-badge-card" onClick={() => setShowBadgeModal(true)} style={{ cursor: 'pointer' }}>
      <h4>
        <QrCode size={16} style={{ verticalAlign: 'text-bottom' }} /> Badge d'acces
      </h4>
      <div className="php-qr-box">
        {badgeLoading ? (
          <small>Chargement...</small>
        ) : badgeData?.token ? (
          <img
            src={buildBadgeQrUrl(badgeData.token, 120)}
            alt="QR badge"
            style={{ width: 110, height: 110, objectFit: 'contain' }}
          />
        ) : (
          <div className="php-badge-fallback">
            <QrCode size={42} />
            <small>Badge QR indisponible</small>
          </div>
        )}
      </div>
      <div className="php-badge-meta">
        <div className="php-badge-meta-row">
          <small>Statut</small>
          <span className={`php-pill ${badgeStatusClass(badgeData?.status)}`}>
            {badgeLoading ? 'Chargement...' : badgeData ? badgeStatusLabel(badgeData.status) : 'Badge indisponible'}
          </span>
        </div>
        <div className="php-badge-meta-row">
          <small>Matricule</small>
          <strong>{badgeData?.user_matricule || user.matricule || '-'}</strong>
        </div>
        <div className="php-badge-meta-row">
          <small>Expiration</small>
          <strong>{badgeData?.expires_at ? formatShortDateTime(badgeData.expires_at) : '-'}</strong>
        </div>
      </div>
    </article>
  )

  const renderBadgeModal = () => {
    if (!showBadgeModal) return null

    return (
      <div 
        className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
        onClick={() => setShowBadgeModal(false)}
      >
        <div 
          className="bg-white rounded-xl p-8 max-w-2xl w-full mx-4"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-center">
            <h3 className="text-2xl font-bold text-gray-900 mb-4">Badge d'accès</h3>
            <div className="mb-6">
              <div className="w-80 h-80 mx-auto bg-gray-100 rounded-xl flex items-center justify-center">
                {badgeData?.token ? (
                  <img
                    src={buildBadgeQrUrl(badgeData.token, 320)}
                    alt="Badge QR agrandi"
                    style={{ width: 300, height: 300, objectFit: 'contain' }}
                  />
                ) : (
                  <div className="php-badge-fallback php-badge-fallback-lg">
                    <QrCode size={76} />
                    <small>Badge QR indisponible</small>
                  </div>
                )}
              </div>
            </div>
            <div className="space-y-2 mb-6">
              <p className="text-lg font-semibold text-gray-900">{user.prenom} {user.nom}</p>
              <p className="text-sm text-gray-600">{user.poste || 'Employé'}</p>
              <p className="text-sm text-gray-600">{user.departement || 'Département'}</p>
              <p className="text-xs text-gray-500 mt-4">Matricule: {getMatriculeLabel(user, badgeData)}</p>
              {badgeData?.expires_at ? (
                <p className="text-xs text-gray-500">Expiration: {formatShortDateTime(badgeData.expires_at)}</p>
              ) : null}
              {badgeData ? (
                <span className={`php-pill ${badgeStatusClass(badgeData.status)}`}>
                  {badgeStatusLabel(badgeData.status)}
                </span>
              ) : (
                <span className="php-pill is-warning">Badge indisponible</span>
              )}
            </div>
            <div className="space-y-2">
              <button
                onClick={() => setShowBadgeModal(false)}
                className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const renderDemandeModal = () => {
    if (!showDemandeModal) return null

    return (
      <div
        className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
        onClick={handleDemandeCancel}
      >
        <div
          className="bg-white rounded-xl p-8 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="text-center mb-6">
            <h3 className="text-2xl font-bold text-gray-900 mb-2">Faire une demande</h3>
            <p className="text-sm text-gray-600">Selectionnez le type de demande puis completez les informations pour l'administration.</p>
          </div>

          {demandeFeedback ? (
            <div className="mb-4">
              <span className={`php-pill ${demandeFeedbackType === 'error' ? 'is-danger' : 'is-success'}`}>
                {demandeFeedback}
              </span>
            </div>
          ) : null}

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Type de demande</label>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {[
                  { value: 'conge', label: 'Conge', description: 'Absence planifiee' },
                  { value: 'permission', label: 'Permission', description: 'Absence courte' },
                  { value: 'maladie', label: 'Maladie', description: 'Justificatif medical' }
                ].map((typeOption) => (
                  <label key={typeOption.value} className="flex items-start gap-2 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                    <input
                      type="radio"
                      name="type"
                      value={typeOption.value}
                      checked={demandeForm.type === typeOption.value}
                      onChange={handleDemandeInputChange}
                    />
                    <div>
                      <div className="font-medium text-gray-900">{typeOption.label}</div>
                      <div className="text-xs text-gray-500">{typeOption.description}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Date de debut</label>
                <input
                  type="date"
                  name="date_debut"
                  value={demandeForm.date_debut}
                  onChange={handleDemandeInputChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Date de fin</label>
                <input
                  type="date"
                  name="date_fin"
                  value={demandeForm.date_fin}
                  onChange={handleDemandeInputChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Motif</label>
              <textarea
                name="motif"
                value={demandeForm.motif}
                onChange={handleDemandeInputChange}
                rows={4}
                placeholder="Decrivez votre demande..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-6">
            <button
              type="button"
              onClick={handleDemandeCancel}
              disabled={savingDemande}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={() => void handleDemandeSubmit()}
              disabled={savingDemande}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {savingDemande ? 'Envoi...' : 'Envoyer la demande'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  const renderJustificationModal = () => {
    if (!showJustificationModal || !pendingJustification) return null

    const reasonLabel = JUSTIFICATION_REASON_LABELS[pendingJustification.reason]

    return (
      <div
        className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
        onClick={handleJustificationClose}
      >
        <div
          className="bg-white rounded-xl p-8 max-w-xl w-full mx-4 max-h-[90vh] overflow-y-auto"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="text-center mb-6">
            <h3 className="text-2xl font-bold text-gray-900 mb-2">Justification requise</h3>
            <p className="text-sm text-gray-600">
              {pendingJustification.fromScan
                ? 'Votre pointage vient d etre enregistre depuis la zone de scan.'
                : 'Une justification est attendue pour ce pointage.'}
            </p>
          </div>

          <div className="space-y-4">
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800 text-sm">
              Motif detecte: <strong>{reasonLabel}</strong> | Pointage #{pendingJustification.pointageId}
            </div>

            {justificationFeedback ? (
              <div>
                <span className={`php-pill ${justificationFeedback.type === 'error' ? 'is-danger' : 'is-success'}`}>
                  {justificationFeedback.message}
                </span>
              </div>
            ) : null}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Raison</label>
              <input
                type="text"
                name="raison"
                value={justificationForm.raison}
                onChange={handleJustificationInputChange}
                placeholder="Ex: Transport, embouteillage, urgence..."
                maxLength={100}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Details complementaires (optionnel)</label>
              <textarea
                name="details"
                value={justificationForm.details}
                onChange={handleJustificationInputChange}
                rows={4}
                maxLength={1000}
                placeholder="Ajoutez des details utiles pour l administration..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-6">
            <button
              type="button"
              onClick={handleJustificationClose}
              disabled={justificationSaving}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Plus tard
            </button>
            <button
              type="button"
              onClick={() => void handleJustificationSubmit()}
              disabled={justificationSaving}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {justificationSaving ? 'Envoi...' : 'Envoyer la justification'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  const renderKpis = () => (
    <section className="php-kpi-grid">
      <article className="php-kpi-card">
        <small>Total heures</small>
        <strong>{statistiques.total_heures}h</strong>
      </article>
      <article className="php-kpi-card">
        <small>Jours travailles</small>
        <strong>{statistiques.jours_travailles}</strong>
      </article>
      <article className="php-kpi-card">
        <small>Retards</small>
        <strong>{statistiques.retards}</strong>
      </article>
      <article className="php-kpi-card">
        <small>Absences</small>
        <strong>{statistiques.absences}</strong>
      </article>
    </section>
  )

  const renderPointageActions = () => null

  const renderPointagesList = () => (
    <article className="php-card" style={{ minWidth: 0 }}>
      <div className="php-card-header">
        <h2 className="php-card-title">
          <Clock3 size={16} style={{ marginRight: 8, verticalAlign: 'text-bottom' }} />
          Mes pointages récents
        </h2>
        <div className="flex items-center space-x-2">
          <span className="text-sm text-gray-500">
            {filteredGroupedPointages.length} jour{filteredGroupedPointages.length > 1 ? 's' : ''} / {groupedPointages.length}
          </span>
        </div>
      </div>
      <div className="php-card-body">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          <div>
            <label className="xp-form-label">Date</label>
            <input
              type="date"
              value={pointageDateFilter}
              onChange={(event) => setPointageDateFilter(event.target.value)}
              className="xp-form-input"
            />
          </div>
          <div>
            <label className="xp-form-label">Type</label>
            <select
              value={pointageTypeFilter}
              onChange={(event) => setPointageTypeFilter(event.target.value as PointageQuickTypeFilter)}
              className="xp-form-input"
            >
              <option value="all">Tous</option>
              <option value="complet">Arrivée + départ</option>
              <option value="arrivee">Arrivée</option>
              <option value="depart">Départ</option>
            </select>
          </div>
          <div>
            <label className="xp-form-label">Statut</label>
            <select
              value={pointageStatusFilter}
              onChange={(event) => setPointageStatusFilter(event.target.value as PointageQuickStatusFilter)}
              className="xp-form-input"
            >
              <option value="all">Tous</option>
              <option value="a_l_heure">A l'heure</option>
              <option value="retard">Arrivée en retard</option>
              <option value="depart_anticipe">Départ anticipé</option>
            </select>
          </div>
          <div>
            <label className="xp-form-label">Recherche</label>
            <input
              type="text"
              value={pointageSearchTerm}
              onChange={(event) => setPointageSearchTerm(event.target.value)}
              placeholder="Commentaire, statut..."
              className="xp-form-input"
            />
          </div>
        </div>

        {filteredGroupedPointages.length === 0 ? (
          <div className="text-center py-8">
            <Clock3 size={48} className="mx-auto text-gray-300 mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">Aucun pointage correspondant</h3>
            <p className="text-sm text-gray-500">Ajustez les filtres ou retirez la recherche pour afficher des résultats.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {visibleGroupedPointages.map((dayPointages) => {
              const dateValue = new Date(`${dayPointages.date}T00:00:00`)
              const isDateValid = !Number.isNaN(dateValue.getTime())
              const arriveeMeta = dayPointages.arrivee ? getPointageStatusMeta(dayPointages.arrivee, workStartTime, workEndTime) : null
              const departMeta = dayPointages.depart ? getPointageStatusMeta(dayPointages.depart, workStartTime, workEndTime) : null

              return (
                <div key={dayPointages.date} className="bg-gray-50 rounded-lg p-3 md:p-4 border border-gray-200">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <div className="min-w-0">
                      <div className="font-semibold text-gray-900">
                        {isDateValid
                          ? dateValue.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
                          : dayPointages.date}
                      </div>
                      <div className="text-xs text-gray-500">
                        {dayPointages.arrivee && dayPointages.depart ? 'Journee complete' : 'Journee partielle'}
                      </div>
                    </div>
                    <span className="text-xs text-gray-500">
                      {dayPointages.arrivee ? 'Arrivee renseignee' : 'Arrivee manquante'} | {dayPointages.depart ? 'Depart renseigne' : 'Depart manquant'}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    <div className="min-w-0 rounded-lg border border-green-200 bg-white p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs uppercase tracking-wide text-gray-500">Arrivee</p>
                          <p className="text-base font-semibold text-gray-900">
                            {dayPointages.arrivee
                              ? (dayPointages.arrivee.arrivee || new Date(dayPointages.arrivee.date_heure).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }))
                              : 'Non pointee'}
                          </p>
                        </div>
                        {arriveeMeta ? (
                          <span className={`inline-flex max-w-full items-center rounded-full px-2 py-1 text-xs font-semibold ${arriveeMeta.badgeClassName}`}>
                            {arriveeMeta.label}
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold bg-slate-100 text-slate-600">
                            Absente
                          </span>
                        )}
                      </div>
                      {dayPointages.arrivee?.commentaire ? (
                        <p className="mt-2 text-xs text-gray-600 break-words">
                          Justification: {dayPointages.arrivee.commentaire}
                        </p>
                      ) : null}
                    </div>

                    <div className="min-w-0 rounded-lg border border-blue-200 bg-white p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs uppercase tracking-wide text-gray-500">Depart</p>
                          <p className="text-base font-semibold text-gray-900">
                            {dayPointages.depart
                              ? (dayPointages.depart.depart || new Date(dayPointages.depart.date_heure).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }))
                              : 'Non pointe'}
                          </p>
                        </div>
                        {departMeta ? (
                          <span className={`inline-flex max-w-full items-center rounded-full px-2 py-1 text-xs font-semibold ${departMeta.badgeClassName}`}>
                            {departMeta.label}
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold bg-slate-100 text-slate-600">
                            Absent
                          </span>
                        )}
                      </div>
                      {dayPointages.depart?.commentaire ? (
                        <p className="mt-2 text-xs text-gray-600 break-words">
                          Justification: {dayPointages.depart.commentaire}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {filteredGroupedPointages.length > POINTAGES_PREVIEW_LIMIT ? (
          <p className="text-xs text-gray-500">
            Affichage limite aux {POINTAGES_PREVIEW_LIMIT} journees les plus recentes. Utilisez les filtres pour affiner.
          </p>
        ) : null}
      </div>
    </article>
  )

  const renderDemandesList = () => (
    <article className="php-card">
      <div className="php-card-header">
        <h2 className="php-card-title">
          <CalendarDays size={16} style={{ marginRight: 8, verticalAlign: 'text-bottom' }} />
          Mes demandes récentes
        </h2>
        <div className="flex items-center space-x-2">
          <span className="text-sm text-gray-500">
            {demandes.length} demande{demandes.length > 1 ? 's' : ''}
          </span>
        </div>
      </div>
      <div className="php-card-body">
        {demandes.length === 0 ? (
          <div className="text-center py-8">
            <CalendarDays size={48} className="mx-auto text-gray-300 mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">Aucune demande</h3>
            <p className="text-sm text-gray-500">Vous n'avez pas encore de demande.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {demandes.slice(0, 10).map((demande) => (
              <div key={demande.id} className="bg-gray-50 rounded-lg p-4 hover:bg-gray-100 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                      demande.type === 'conge' ? 'bg-blue-100' :
                      demande.type === 'permission' ? 'bg-yellow-100' :
                      demande.type === 'maladie' ? 'bg-red-100' :
                      'bg-gray-100'
                    }`}>
                      {demande.type === 'conge' ? (
                        <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
                        </svg>
                      ) : demande.type === 'permission' ? (
                        <svg className="w-5 h-5 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path>
                        </svg>
                      ) : (
                        <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"></path>
                        </svg>
                      )}
                    </div>
                    <div>
                      <div className="font-medium text-gray-900">
                        {formatDemandeType(demande.type)}
                      </div>
                      <div className="text-sm text-gray-500">
                        {formatDateTime(demande.date_debut)} au {formatDateTime(demande.date_fin)}
                      </div>
                      {demande.motif && (
                        <div className="text-sm text-gray-600 mt-1">
                          Motif: {demande.motif}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      demande.statut === 'approuvee' ? 'bg-green-100 text-green-800' :
                      demande.statut === 'rejetee' ? 'bg-red-100 text-red-800' :
                      'bg-yellow-100 text-yellow-800'
                    }`}>
                      {demande.statut === 'approuvee' ? 'Approuvée' :
                       demande.statut === 'rejetee' ? 'Rejetée' :
                       'En attente'}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </article>
  )

  const renderDashboard = () => (
    <div>
      <header className="php-page-header">
        <h1 className="php-page-title">Mon espace de pointage</h1>
        <p className="php-page-subtitle">Consultez vos pointages et votre activité</p>
      </header>

      {errorMessage ? (
        <section className="php-card">
          <div className="php-card-body">
            <span className="php-pill is-danger">{errorMessage}</span>
          </div>
        </section>
      ) : null}

      <section className="php-employee-grid">
        {renderBadgeCard()}
        {renderProfileCard()}
      </section>
      {renderKpis()}
      <section className="php-grid-2 php-grid-equal-cards">
        {renderPointagesList()}
        {renderDemandesList()}
      </section>
    </div>
  )

  const renderPointageSection = () => (
    <div>
      <header className="php-page-header">
        <h1 className="php-page-title">Historique de pointage</h1>
        <p className="php-page-subtitle">Consultez l'historique complet de vos pointages</p>
      </header>
      {renderPointagesList()}
    </div>
  )

  const renderHistoriqueSection = () => {
  // Regrouper les pointages par date (correction du problème de date invalide)
  const groupedPointages = pointages.reduce((acc, pointage) => {
    const pointageDate = new Date(pointage.date_heure);
    // Vérifier si la date est valide
    if (isNaN(pointageDate.getTime())) {
      console.warn('Date invalide:', pointage.date_heure);
      return acc;
    }
    
    // Utiliser la date ISO comme clé pour éviter les problèmes de formatage
    const dateKey = pointageDate.toISOString().split('T')[0]; // YYYY-MM-DD
    const dateDisplay = pointageDate.toLocaleDateString('fr-FR');
    
    if (!acc[dateKey]) {
      acc[dateKey] = { dateKey, dateDisplay, arrivee: null, depart: null };
    }
    if (pointage.type === 'arrivee') {
      acc[dateKey].arrivee = pointage;
    } else if (pointage.type === 'depart') {
      acc[dateKey].depart = pointage;
    }
    return acc;
  }, {} as Record<string, { dateKey: string; dateDisplay: string; arrivee: any; depart: any }>);

  // Trier par date décroissante (correction : utiliser dateKey qui est au format ISO)
  const sortedGroupedPointages = Object.values(groupedPointages)
    .sort((a, b) => new Date(b.dateKey).getTime() - new Date(a.dateKey).getTime());

  // Fonction d'exportation des données
  const exportHistoriqueData = () => {
    const exportData = sortedGroupedPointages.map(day => {
      const row: any = {};
      
      // Ordre logique des colonnes
      row['Date'] = day.dateDisplay;
      
      // Informations arrivée
      row['Heure Arrivée'] = day.arrivee ? (day.arrivee.arrivee || new Date(day.arrivee.date_heure).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })) : 'Non pointé';
      row['Statut Arrivée'] = day.arrivee ? (day.arrivee.statut === 'retard' ? 'En retard' : 'À l\'heure') : '-';
      if (day.arrivee && day.arrivee.commentaire) {
        row['Justification Arrivée'] = day.arrivee.commentaire.trim();
      }
      
      // Informations départ
      row['Heure Départ'] = day.depart ? (day.depart.depart || new Date(day.depart.date_heure).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })) : 'Non pointé';
      row['Statut Départ'] = day.depart ? (isDepartAnticipe(day.depart, workEndTime) ? 'Départ anticipé' : 'Départ normal') : '-';
      if (day.depart && day.depart.commentaire) {
        row['Justification Départ'] = day.depart.commentaire.trim();
      }

      return row;
    });

    // Définir l'ordre des colonnes pour une meilleure lisibilité
    const orderedHeaders = [
      'Date',
      'Heure Arrivée',
      'Statut Arrivée',
      'Justification Arrivée',
      'Heure Départ',
      'Statut Départ',
      'Justification Départ'
    ];

    // Filtrer les en-têtes qui existent réellement dans les données
    const existingHeaders = orderedHeaders.filter(header => 
      exportData.some(row => row.hasOwnProperty(header))
    );

    // Créer le contenu CSV avec BOM UTF-8 pour Excel
    const csvRows = [];
    
    // Ajouter BOM UTF-8 pour une meilleure compatibilité avec Excel
    csvRows.push('\uFEFF');
    
    // En-têtes avec encodage correct
    csvRows.push(existingHeaders.map(header => `"${header}"`).join(';'));
    
    // Données avec échappement amélioré
    exportData.forEach(row => {
      const rowData = existingHeaders.map(header => {
        const value = row[header] || '';
        // Normaliser et échapper la valeur
        const normalizedValue = String(value)
          .normalize('NFC') // Normaliser Unicode
          .replace(/\r\n/g, '\n') // Normaliser les retours à la ligne
          .replace(/\r/g, '\n')
          .trim();
        
        // Échapper les guillemets et les points-virgules
        const escapedValue = normalizedValue.replace(/"/g, '""');
        return `"${escapedValue}"`;
      });
      csvRows.push(rowData.join(';'));
    });

    const csvContent = csvRows.join('\n');

    // Créer et télécharger le fichier avec encodage UTF-8
    const blob = new Blob([csvContent], { 
      type: 'text/csv;charset=utf-8' 
    });
    
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    
    // Nom de fichier plus descriptif
    const today = new Date().toISOString().split('T')[0];
    link.setAttribute('download', `historique_pointages_${today}.csv`);
    
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    // Nettoyer l'URL
    URL.revokeObjectURL(url);
  };

  return (
    <section className="php-card">
      <div className="php-card-header">
        <h2 className="php-card-title">Historique de pointage</h2>
        <div className="flex items-center space-x-2">
          <button
            onClick={exportHistoriqueData}
            disabled={sortedGroupedPointages.length === 0}
            className="px-3 py-1 rounded bg-green-600 text-white text-xs hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-1"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span>Exporter</span>
          </button>
          <span className="text-sm text-gray-500">
            {sortedGroupedPointages.length} jour{sortedGroupedPointages.length > 1 ? 's' : ''}
          </span>
        </div>
      </div>
      <div className="php-card-body">
        {sortedGroupedPointages.length === 0 ? (
          <div className="text-center py-8">
            <FileText size={48} className="mx-auto text-gray-300 mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">Aucun historique</h3>
            <p className="text-sm text-gray-500">Vous n'avez pas encore d'historique de pointage.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {sortedGroupedPointages.map((dayPointages, index) => (
              <div key={dayPointages.dateKey} className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-900">
                    {dayPointages.dateDisplay}
                  </h3>
                  <span className="text-xs text-gray-500">
                    {new Date(dayPointages.dateKey).toLocaleDateString('fr-FR', { 
                      year: 'numeric' 
                    })}
                  </span>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Arrivée */}
                  {dayPointages.arrivee ? (
                    <div className="flex items-center space-x-3 p-3 bg-white rounded-lg border border-green-200">
                      <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
                        <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"></path>
                        </svg>
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-gray-900">
                            {dayPointages.arrivee.arrivee || new Date(dayPointages.arrivee.date_heure).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                            dayPointages.arrivee.statut === 'retard' 
                              ? 'bg-yellow-100 text-yellow-800' 
                              : 'bg-green-100 text-green-800'
                          }`}>
                            {dayPointages.arrivee.statut === 'retard' ? '⚠️ En retard' : '✅ À l\'heure'}
                          </span>
                        </div>
                        <div className="text-xs text-gray-500 mt-1">Arrivée</div>
                        {dayPointages.arrivee.statut === 'retard' && dayPointages.arrivee.commentaire && (
                          <div className="text-xs text-gray-600 italic bg-gray-100 px-2 py-1 rounded mt-2">
                            📝 {dayPointages.arrivee.commentaire}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center space-x-3 p-3 bg-gray-100 rounded-lg border border-gray-200 opacity-60">
                      <div className="w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center">
                        <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"></path>
                        </svg>
                      </div>
                      <div className="flex-1">
                        <div className="text-sm text-gray-500">Pas d'arrivée</div>
                        <div className="text-xs text-gray-400 mt-1">Non pointé</div>
                      </div>
                    </div>
                  )}

                  {/* Départ */}
                  {dayPointages.depart ? (
                    <div className="flex items-center space-x-3 p-3 bg-white rounded-lg border border-blue-200">
                      <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                        <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7l5 5m0 0l-5 5m5-5H6"></path>
                        </svg>
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-gray-900">
                            {dayPointages.depart.depart || new Date(dayPointages.depart.date_heure).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                            dayPointages.depart.statut === 'retard' || isDepartAnticipe(dayPointages.depart, workEndTime)
                              ? 'bg-orange-100 text-orange-800' 
                              : 'bg-blue-100 text-blue-800'
                          }`}>
                            {isDepartAnticipe(dayPointages.depart, workEndTime) ? '🏃 Départ anticipé' : '✅ Départ normal'}
                          </span>
                        </div>
                        <div className="text-xs text-gray-500 mt-1">Départ</div>
                        {(dayPointages.depart.statut === 'retard' || isDepartAnticipe(dayPointages.depart, workEndTime)) && dayPointages.depart.commentaire && (
                          <div className="text-xs text-gray-600 italic bg-gray-100 px-2 py-1 rounded mt-2">
                            📝 {dayPointages.depart.commentaire}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center space-x-3 p-3 bg-gray-100 rounded-lg border border-gray-200 opacity-60">
                      <div className="w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center">
                        <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7l5 5m0 0l-5 5m5-5H6"></path>
                        </svg>
                      </div>
                      <div className="flex-1">
                        <div className="text-sm text-gray-500">Pas de départ</div>
                        <div className="text-xs text-gray-400 mt-1">Non pointé</div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

  const renderRetardsSection = () => {
    const retards = pointages.filter(pointage => 
      pointage.statut === 'retard' || isArrivalLate(pointage, workStartTime) || isDepartAnticipe(pointage, workEndTime)
    );

    // Regrouper les retards par date pour une meilleure organisation
    const retardsGroupedByDate = retards.reduce((acc, pointage) => {
      const dateKey = new Date(pointage.date_heure).toISOString().split('T')[0];
      const dateDisplay = new Date(pointage.date_heure).toLocaleDateString('fr-FR', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
      
      if (!acc[dateKey]) {
        acc[dateKey] = {
          dateKey,
          dateDisplay,
          retards: []
        };
      }
      acc[dateKey].retards.push(pointage);
      return acc;
    }, {} as Record<string, { dateKey: string; dateDisplay: string; retards: any[] }>);

    // Trier par date décroissante
    const sortedDates = Object.values(retardsGroupedByDate)
      .sort((a, b) => new Date(b.dateKey).getTime() - new Date(a.dateKey).getTime());

    return (
      <section className="php-card">
        <div className="php-card-header">
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center">
                <Clock3 size={16} className="text-red-600" />
              </div>
              <div>
                <h2 className="php-card-title">Pointages en retard</h2>
                <p className="text-xs text-gray-500 mt-1">
                  {retards.length} retard{retards.length > 1 ? 's' : ''} • {sortedDates.length} jour{sortedDates.length > 1 ? 's' : ''} concerné{sortedDates.length > 1 ? 's' : ''}
                </p>
              </div>
            </div>
          </div>
        </div>
        <div className="php-card-body">
          {retards.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">Excellent ! Aucun retard</h3>
              <p className="text-sm text-gray-500">Tous vos pointages sont à l'heure. Continuez comme ça !</p>
            </div>
          ) : (
            <div className="space-y-4">
              {sortedDates.map((dayData) => (
                <div key={dayData.dateKey} className="border border-red-200 rounded-lg bg-red-50/30 overflow-hidden">
                  {/* En-tête de la date */}
                  <div className="bg-red-100 px-4 py-3 border-b border-red-200">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
                        </svg>
                        <span className="font-semibold text-red-800 text-sm">
                          {dayData.dateDisplay}
                        </span>
                      </div>
                      <span className="text-xs text-red-600 font-medium bg-red-200 px-2 py-1 rounded-full">
                        {dayData.retards.length} retard{dayData.retards.length > 1 ? 's' : ''}
                      </span>
                    </div>
                  </div>
                  
                  {/* Liste des retards de la journée */}
                  <div className="p-4 space-y-3">
                    {dayData.retards.map((pointage) => (
                      <div key={pointage.id} className="bg-white rounded-lg border border-red-200 p-4 shadow-sm">
                        <div className="flex items-start justify-between">
                          {/* Informations principales */}
                          <div className="flex items-start space-x-4 flex-1">
                            {/* Icône et type */}
                            <div className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 ${
                              pointage.type === 'arrivee' ? 'bg-yellow-100' : 'bg-orange-100'
                            }`}>
                              {pointage.type === 'arrivee' ? (
                                <svg className="w-6 h-6 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"></path>
                                </svg>
                              ) : (
                                <svg className="w-6 h-6 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7l5 5m0 0l-5 5m5-5H6"></path>
                                </svg>
                              )}
                            </div>
                            
                            {/* Détails du pointage */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center space-x-3 mb-2">
                                <span className="text-lg font-bold text-gray-900">
                                  {pointage.type === 'arrivee' 
                                    ? (pointage.arrivee || new Date(pointage.date_heure).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }))
                                    : (pointage.depart || new Date(pointage.date_heure).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }))
                                  }
                                </span>
                                <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${
                                  pointage.type === 'arrivee' 
                                    ? 'bg-yellow-100 text-yellow-800' 
                                    : 'bg-orange-100 text-orange-800'
                                }`}>
                                  {pointage.type === 'arrivee' ? '⚠️ Arrivée en retard' : '🏃 Départ anticipé'}
                                </span>
                              </div>
                              
                              <div className="flex items-center space-x-4 text-sm text-gray-600">
                                <span className="flex items-center space-x-1">
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                                  </svg>
                                  <span>{new Date(pointage.date_heure).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                                </span>
                                <span className="flex items-center space-x-1">
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
                                  </svg>
                                  <span>{pointage.type === 'arrivee' ? 'Arrivée' : 'Départ'}</span>
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                        
                        {/* Justification */}
                        <div className="mt-4 pt-4 border-t border-gray-200">
                          {pointage.commentaire ? (
                            <div className="flex items-start space-x-2">
                              <svg className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                              </svg>
                              <div className="flex-1">
                                <p className="text-xs font-medium text-green-700 mb-1">Justification fournie</p>
                                <p className="text-sm text-gray-700 bg-green-50 px-3 py-2 rounded border border-green-200">
                                  {pointage.commentaire}
                                </p>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center space-x-2">
                              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
                              </svg>
                              <p className="text-sm text-gray-500 italic">Aucune justification fournie</p>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    )
  }

  const renderDemandesSection = () => (
    <div>
      <header className="php-page-header flex flex-wrap items-center justify-between gap-3">
        <h1 className="php-page-title">Mes demandes</h1>
        <div className="flex items-center gap-3">
          <p className="php-page-subtitle">Consultez le statut de vos demandes</p>
        </div>
      </header>
      {renderDemandesList()}
    </div>
  )

  const renderCalendrierSection = () => {
    const sortedEvents = [...calendarEvents]
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
      .slice(0, 8)
    const now = new Date()
    const eventsWithStatus = sortedEvents.map((event) => ({
      event,
      timelineStatus: resolveCalendarTimelineStatus(event, now)
    }))
    const timelineTotals = eventsWithStatus.reduce(
      (accumulator, current) => {
        accumulator[current.timelineStatus] += 1
        return accumulator
      },
      { a_venir: 0, en_cours: 0, termine: 0 } as Record<CalendarTimelineStatus, number>
    )
    const selectedSource = selectedCalendarEvent?.extendedProps?.source === 'pointage' ? 'Pointage' : 'Evenement'
    const selectedPriorityRaw = String(selectedCalendarEvent?.extendedProps?.priorite || 'normale') as 'secondaire' | 'normale' | 'importante' | 'urgente'
    const selectedPriorityLabel = CALENDAR_PRIORITY_LABELS[selectedPriorityRaw] || CALENDAR_PRIORITY_LABELS.normale

    return (
      <div className={`php-grid-2 php-calendar-grid ${selectedCalendarEvent ? 'is-with-panel' : 'is-full-width'}`}>
        <section className="php-card php-calendar-main-card">
          <div className="php-card-header">
            <h2 className="php-card-title">
              <CalendarDays size={16} style={{ marginRight: 8, verticalAlign: 'text-bottom' }} />
              Mon calendrier
            </h2>
          </div>

          <div className="php-card-body">
            <div style={{ marginBottom: 12 }}>
              <span className="php-pill is-warning">Calendrier en lecture seule</span>
            </div>
            {calendarError ? (
              <div style={{ marginBottom: 12 }}>
                <span className="php-pill is-danger">{calendarError}</span>
              </div>
            ) : null}
            {calendarInfo ? (
              <div style={{ marginBottom: 12 }}>
                <span className="php-pill is-success">{calendarInfo}</span>
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
                events={calendarEvents as any}
                editable={false}
                selectable={false}
                datesSet={(arg) => handleCalendarDatesSet(arg)}
                eventClick={(arg) => handleCalendarEventClick(arg)}
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

        {selectedCalendarEvent ? (
          <section className="php-card">
            <div className="php-card-header">
              <h2 className="php-card-title">Détail événement</h2>
              <button
                type="button"
                onClick={() => setSelectedCalendarEventId(null)}
                className="px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
                aria-label="Fermer le détail événement"
              >
                <X size={16} />
              </button>
            </div>
            <div className="php-card-body php-list">
              <div className="flex flex-wrap items-center gap-2">
                <span className="php-pill is-info">{CALENDAR_TIMELINE_LABELS.a_venir} {timelineTotals.a_venir}</span>
                <span className="php-pill is-success">{CALENDAR_TIMELINE_LABELS.en_cours} {timelineTotals.en_cours}</span>
                <span className="php-pill is-warning">{CALENDAR_TIMELINE_LABELS.termine} {timelineTotals.termine}</span>
              </div>

              <div className="php-detail">
                <small>Titre</small>
                <strong>{selectedCalendarEvent.title || 'Sans titre'}</strong>
              </div>
              <div className="php-detail">
                <small>Statut</small>
                <strong>
                  <span className={`php-pill ${calendarTimelinePillClass(selectedCalendarTimelineStatus || 'a_venir')}`}>
                    {CALENDAR_TIMELINE_LABELS[selectedCalendarTimelineStatus || 'a_venir']}
                  </span>
                </strong>
              </div>
              <div className="php-detail">
                <small>Date de debut</small>
                <strong>{formatDateTime(selectedCalendarEvent.start)}</strong>
              </div>
              <div className="php-detail">
                <small>Date de fin</small>
                <strong>{formatDateTime(selectedCalendarEvent.end || selectedCalendarEvent.start)}</strong>
              </div>
              <div className="php-detail">
                <small>Type</small>
                <strong>{selectedSource}</strong>
              </div>
              <div className="php-detail">
                <small>Priorite</small>
                <strong>{selectedSource === 'Pointage' ? 'Pointage' : selectedPriorityLabel}</strong>
              </div>
              <div className="php-detail">
                <small>Lieu</small>
                <strong>{String(selectedCalendarEvent.extendedProps?.lieu || '').trim() || '-'}</strong>
              </div>
              {selectedCalendarEvent.extendedProps?.description ? (
                <div className="php-detail">
                  <small>Description</small>
                  <strong>{String(selectedCalendarEvent.extendedProps.description)}</strong>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>
    )
  }

  const renderProfilSection = () => (
    <div className="xp-form space-y-6">
      {profileFeedback ? (
        <section className="php-card">
          <div className="php-card-body">
            <span className={`php-pill ${profileFeedbackType === 'error' ? 'is-danger' : 'is-success'}`}>{profileFeedback}</span>
          </div>
        </section>
      ) : null}

      <section className="php-grid-2">
        <article className="php-card">
          <div className="php-card-header">
            <h2 className="php-card-title">
              <UserRound size={16} style={{ marginRight: 8, verticalAlign: 'text-bottom' }} />
              Informations personnelles
            </h2>
            {!profileEditing ? (
              <button
                onClick={() => {
                  setProfileFeedback(null)
                  setProfileEditing(true)
                }}
                className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700"
              >
                Modifier
              </button>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={handleProfileCancel}
                  disabled={profileSaving || profilePhotoUploading}
                  className="px-3 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Annuler
                </button>
                <button
                  onClick={() => void handleProfileSave()}
                  disabled={profileSaving || profilePhotoUploading}
                  className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-50"
                >
                  {profileSaving ? 'Enregistrement...' : profilePhotoUploading ? 'Upload photo...' : 'Enregistrer'}
                </button>
              </div>
            )}
          </div>
          <div className="php-card-body grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="xp-form-label">Photo professionnelle</label>
              <div className="flex flex-wrap items-center gap-4">
                <div className="w-20 h-20 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-semibold overflow-hidden">
                  {resolvedProfilePhotoUrl ? (
                    <img
                      src={resolvedProfilePhotoUrl}
                      alt="Photo profil employe"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    initials
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {profileEditing ? (
                    <>
                      <label className="inline-flex cursor-pointer items-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-100">
                        {profilePhotoUploading ? 'Telechargement...' : 'Choisir une photo'}
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/gif"
                          onChange={handleProfilePhotoChange}
                          disabled={profilePhotoUploading}
                          className="hidden"
                        />
                      </label>
                      {(profileForm.photo || profilePhotoPreview) ? (
                        <button
                          type="button"
                          onClick={handleProfilePhotoRemove}
                          disabled={profilePhotoUploading}
                          className="px-3 py-2 rounded-lg border border-red-300 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
                        >
                          Retirer
                        </button>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-sm text-gray-500">Cliquez sur Modifier pour ajouter/changer votre photo.</span>
                  )}
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-2">Formats acceptes: JPG, PNG, WEBP, GIF (max 5 Mo).</p>
            </div>

            <div>
              <label className="xp-form-label">Prenom</label>
              <input
                name="prenom"
                value={profileForm.prenom}
                onChange={handleProfileInputChange}
                disabled={!profileEditing}
                className="xp-form-input"
              />
            </div>
            <div>
              <label className="xp-form-label">Nom</label>
              <input
                name="nom"
                value={profileForm.nom}
                onChange={handleProfileInputChange}
                disabled={!profileEditing}
                className="xp-form-input"
              />
            </div>
            <div>
              <label className="xp-form-label">Telephone</label>
              <input
                name="telephone"
                value={profileForm.telephone}
                onChange={handleProfileInputChange}
                disabled={!profileEditing}
                className="xp-form-input"
              />
            </div>
            <div>
              <label className="xp-form-label">Situation matrimoniale</label>
              <select
                name="situation_matrimoniale"
                value={profileForm.situation_matrimoniale}
                onChange={handleProfileInputChange}
                disabled={!profileEditing}
                className="xp-form-input"
              >
                <option value="">Non renseignee</option>
                <option value="celibataire">Celibataire</option>
                <option value="marie(e)">Marie(e)</option>
                <option value="divorce(e)">Divorce(e)</option>
                <option value="veuf(ve)">Veuf(ve)</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="xp-form-label">Adresse personnelle</label>
              <textarea
                name="adresse"
                value={profileForm.adresse}
                onChange={handleProfileInputChange}
                disabled={!profileEditing}
                rows={3}
                className="xp-form-input"
              />
            </div>
            <div>
              <label className="xp-form-label">Contact urgence - nom</label>
              <input
                name="contact_urgence_nom"
                value={profileForm.contact_urgence_nom}
                onChange={handleProfileInputChange}
                disabled={!profileEditing}
                className="xp-form-input"
              />
            </div>
            <div>
              <label className="xp-form-label">Contact urgence - telephone</label>
              <input
                name="contact_urgence_telephone"
                value={profileForm.contact_urgence_telephone}
                onChange={handleProfileInputChange}
                disabled={!profileEditing}
                className="xp-form-input"
              />
            </div>
            <div>
              <label className="xp-form-label">Contact urgence - relation</label>
              <input
                name="contact_urgence_relation"
                value={profileForm.contact_urgence_relation}
                onChange={handleProfileInputChange}
                disabled={!profileEditing}
                className="xp-form-input"
              />
            </div>
            <div className="md:col-span-2">
              <label className="xp-form-label">Adresse physique du contact d'urgence</label>
              <textarea
                name="contact_urgence_adresse_physique"
                value={profileForm.contact_urgence_adresse_physique}
                onChange={handleProfileInputChange}
                disabled={!profileEditing}
                rows={2}
                className="xp-form-input"
              />
            </div>
          </div>
        </article>

        <article className="php-card">
          <div className="php-card-header">
            <h2 className="php-card-title">
              <Settings size={16} style={{ marginRight: 8, verticalAlign: 'text-bottom' }} />
              Informations professionnelles (lecture seule)
            </h2>
          </div>
          <div className="php-card-body php-list">
            <div className="php-list-item">
              <div>
                <strong>Role</strong>
                <small>{formatRoleLabel(user.role)}</small>
              </div>
              <span className="php-pill is-primary">{formatRoleLabel(user.role)}</span>
            </div>
            <div className="php-list-item">
              <div>
                <strong>Departement</strong>
                <small>{user.departement || '-'}</small>
              </div>
            </div>
            <div className="php-list-item">
              <div>
                <strong>Poste</strong>
                <small>{user.poste || '-'}</small>
              </div>
            </div>
            <div className="php-list-item">
              <div>
                <strong>Date d'embauche</strong>
                <small>{user.date_embauche ? formatDateTime(user.date_embauche) : '-'}</small>
              </div>
            </div>
            <div className="php-list-item">
              <div>
                <strong>Matricule</strong>
                <small>{getMatriculeLabel(user, badgeData)}</small>
              </div>
            </div>
            <div className="php-list-item">
              <div>
                <strong>Contrat de travail</strong>
                <small>{(user.contrat_type || user.contrat_duree) ? [user.contrat_type, user.contrat_duree].filter(Boolean).join(' - ') : 'Type non renseigne'}</small>
              </div>
              {user.contrat_pdf_url ? (
                <a
                  href={user.contrat_pdf_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="php-link-btn"
                >
                  PDF
                </a>
              ) : (
                <span className="php-pill is-warning">PDF indisponible</span>
              )}
            </div>
            <div className="php-list-item">
              <div>
                <strong>Email professionnel</strong>
                <small>{user.email || '-'}</small>
              </div>
            </div>

            <div className="php-password-section">
              <h3 className="php-password-title">Securite compte</h3>
              <p className="php-password-hint">Saisissez votre mot de passe actuel (par defaut si vous ne l'avez jamais change), puis votre nouveau mot de passe.</p>
              <div className="php-password-grid">
                <div className="relative">
                  <input
                    type={showPasswords.current_password ? 'text' : 'password'}
                    name="current_password"
                    value={passwordForm.current_password}
                    onChange={handlePasswordInputChange}
                    placeholder="Mot de passe actuel / defaut"
                    className="php-password-input pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => togglePasswordVisibility('current_password')}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700"
                  >
                    {showPasswords.current_password ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                
                <div className="relative">
                  <input
                    type={showPasswords.new_password ? 'text' : 'password'}
                    name="new_password"
                    value={passwordForm.new_password}
                    onChange={handlePasswordInputChange}
                    placeholder="Nouveau mot de passe"
                    className="php-password-input pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => togglePasswordVisibility('new_password')}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700"
                  >
                    {showPasswords.new_password ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                
                <div className="relative">
                  <input
                    type={showPasswords.confirm_password ? 'text' : 'password'}
                    name="confirm_password"
                    value={passwordForm.confirm_password}
                    onChange={handlePasswordInputChange}
                    placeholder="Confirmer nouveau mot de passe"
                    className="php-password-input pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => togglePasswordVisibility('confirm_password')}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700"
                  >
                    {showPasswords.confirm_password ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <div className="php-password-actions">
                <button
                  type="button"
                  onClick={() => void handlePasswordSave()}
                  disabled={passwordSaving}
                  className="php-password-submit"
                >
                  {passwordSaving ? 'Mise a jour...' : 'Changer mon mot de passe'}
                </button>
                {passwordFeedback ? (
                  <span className={`php-pill ${passwordFeedback.type === 'error' ? 'is-danger' : 'is-success'}`}>
                    {passwordFeedback.message}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        </article>
      </section>
    </div>
  )

  if (section === 'dashboard') return (
    <>
      {renderDashboard()}
      {renderBadgeModal()}
      {renderDemandeModal()}
      {renderJustificationModal()}
    </>
  )
  if (section === 'pointage') return (
    <>
      {renderPointageSection()}
      {renderBadgeModal()}
      {renderDemandeModal()}
      {renderJustificationModal()}
    </>
  )
  if (section === 'historique') return (
    <>
      {renderHistoriqueSection()}
      {renderBadgeModal()}
      {renderDemandeModal()}
      {renderJustificationModal()}
    </>
  )
  if (section === 'retards') return (
    <>
      {renderRetardsSection()}
      {renderBadgeModal()}
      {renderDemandeModal()}
      {renderJustificationModal()}
    </>
  )
  if (section === 'demandes') return (
    <>
      {renderDemandesSection()}
      {renderBadgeModal()}
      {renderDemandeModal()}
      {renderJustificationModal()}
    </>
  )
  if (section === 'calendrier') return (
    <>
      {renderCalendrierSection()}
      {renderBadgeModal()}
      {renderDemandeModal()}
      {renderJustificationModal()}
    </>
  )
  return (
    <>
      {renderProfilSection()}
      {renderBadgeModal()}
      {renderDemandeModal()}
      {renderJustificationModal()}
    </>
  )
}

export default EmployeeDashboard
