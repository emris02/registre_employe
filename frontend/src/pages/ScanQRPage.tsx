import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import QrScanner from 'qr-scanner'
import {
  AlertTriangle,
  Camera,
  CameraOff,
  CheckCircle2,
  Clock,
  Clock3,
  Download,
  FileText,
  HelpCircle,
  ImageUp,
  LogOut,
  Mail,
  MapPin,
  Phone,
  QrCode,
  RefreshCw,
  Search,
  ServerCrash,
  ShieldCheck,
  ShieldX,
  User,
  Wifi,
  WifiOff,
  XCircle
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { apiClient } from '../services/apiClient'
import { useAuth } from '../services/authService'
import ScanLockScreen from '../components/ScanLockScreen'
import scanSecurityService from '../services/scanSecurityService'

type ScanSource = 'camera' | 'manual' | 'image'
type ScanActionType = 'arrivee' | 'depart' | 'pause' | null
type UiBadgeStatus = 'active' | 'inactive' | 'expired' | 'depart_done' | 'action_required' | 'unknown'
type HistoryPeriod = 'day' | 'week' | 'month'
type RequiredAction = 'pause' | 'depart_anticipe'
type HistoryStatusFilter = '' | 'a_l_heure' | 'en_retard' | 'indetermine'
type HistoryActionFilter = '' | 'arrivee' | 'depart' | 'pause'

interface LastScannedUser {
  id: number
  user_type?: string
  nom_complet?: string
  matricule?: string
  nom?: string
  prenom?: string
  role?: string | null
  badge_status?: string | null
  email?: string | null
  email_pro?: string | null
  telephone?: string | null
  poste?: string | null
  departement?: string | null
  adresse?: string | null
  date_embauche?: string | null
  contrat_type?: string | null
  contrat_duree?: string | null
  contrat_pdf_url?: string | null
  photo?: string | null
}

interface ScanHistoryApiItem {
  id: string | number
  date?: string
  heure?: string
  date_time: string
  nom_complet: string
  matricule: string
  badge: string
  type: string
  action_type?: string
  action_types?: string[]
  status: string
  status_label: string
  heure_arrivee?: string | null
  heure_pause?: string | null
  heure_depart?: string | null
  source?: string
  justification?: string
  user_type?: string
  user_id?: number
  role?: string
  poste?: string | null
  departement?: string | null
  telephone?: string | null
  email?: string | null
  email_pro?: string | null
  adresse?: string | null
  date_embauche?: string | null
  contrat_type?: string | null
  contrat_duree?: string | null
  contrat_pdf_url?: string | null
  badge_status?: string | null
  photo?: string | null
}

interface ScanHistoryApiResponse {
  success: boolean
  items?: ScanHistoryApiItem[]
  last_user?: LastScannedUser | null
}

interface LegacyPointageItem {
  id?: number | string
  date?: string
  date_heure?: string
  prenom?: string
  nom?: string
  matricule?: string
  badge?: string
  type?: string
  statut?: string
  retard_minutes?: number
  source?: string
  arrivee?: string
  depart?: string
  commentaire?: string
  justification?: string
}

interface LegacyPointageResponse {
  success?: boolean
  items?: LegacyPointageItem[]
  pointages?: LegacyPointageItem[]
  data?: {
    items?: LegacyPointageItem[]
    pointages?: LegacyPointageItem[]
  }
}

interface ScanApiResponse {
  success: boolean
  message?: string
  code?: string
  duplicate_type?: 'arrivee' | 'depart'
  badge_status?: 'active' | 'inactive' | 'expired' | 'unknown'
  data?: {
    type?: 'arrivee' | 'depart' | 'pause_debut' | 'pause_fin'
    available_actions?: RequiredAction[]
    user?: LastScannedUser
    min_length?: number
    justification_reason?: string | null
    required_reason?: string
    badge_status?: 'active' | 'inactive' | 'expired' | 'unknown'
  }
}

interface ScanAttempt {
  id: string
  at: string
  dateLabel: string
  heureLabel: string
  heureArrivee?: string | null
  heurePause?: string | null
  heureDepart?: string | null
  source: ScanSource
  sourceText: string
  actionType: ScanActionType
  actionTypes: (HistoryActionFilter | null)[]
  status: UiBadgeStatus
  statusLabel: string
  userName: string
  userMatricule: string
  tokenPreview: string
  pointageLabel: string
  justification: string
}

interface ActionDecisionState {
  token: string
  source: ScanSource
  message: string
  availableActions: RequiredAction[]
}

interface JustificationDecisionState {
  token: string
  source: ScanSource
  scanAction?: RequiredAction
  message: string
  reason: string
  minLength: number
  value: string
  error: string | null
}

const STATUS_STYLE: Record<UiBadgeStatus, string> = {
  active: 'bg-green-100 text-green-700 border-green-200',
  inactive: 'bg-red-100 text-red-700 border-red-200',
  expired: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  depart_done: 'bg-orange-100 text-orange-800 border-orange-200',
  action_required: 'bg-indigo-100 text-indigo-800 border-indigo-200',
  unknown: 'bg-gray-100 text-gray-700 border-gray-200'
}

const STATUS_LABEL: Record<UiBadgeStatus, string> = {
  active: 'Badge actif',
  inactive: 'Badge inactif',
  expired: 'Badge expire',
  depart_done: 'Depart deja enregistre',
  action_required: 'Action requise',
  unknown: 'Statut inconnu'
}

const JUSTIFICATION_REASON_LABELS: Record<string, string> = {
  retard: "Retard d'arrivee",
  pause_start: 'Demarrage de pause',
  depart_anticipe: 'Depart anticipe'
}

const normalizeSource = (value: unknown): ScanSource => {
  const raw = String(value || '').trim().toLowerCase()
  if (raw === 'camera' || raw === 'manual' || raw === 'image') return raw
  return 'manual'
}

const sourceLabel = (value: ScanSource) => (value === 'camera' ? 'Camera' : value === 'image' ? 'Image' : 'Manuel')
const sourceClass = (value: ScanSource) =>
  value === 'camera'
    ? 'bg-blue-100 text-blue-800 border-blue-200'
    : value === 'image'
      ? 'bg-purple-100 text-purple-800 border-purple-200'
      : 'bg-gray-100 text-gray-800 border-gray-200'

const sourceFromText = (value: string): ScanSource => {
  const raw = String(value || '').trim().toLowerCase()
  if (raw.includes('camera')) return 'camera'
  if (raw.includes('image')) return 'image'
  return 'manual'
}

const sourceClassFromText = (value: string) => {
  const raw = String(value || '').trim().toLowerCase()
  const hasCamera = raw.includes('camera')
  const hasImage = raw.includes('image')
  const hasManual = raw.includes('manuel') || raw.includes('manual')
  const kinds = Number(hasCamera) + Number(hasImage) + Number(hasManual)
  if (kinds > 1) return 'bg-slate-100 text-slate-800 border-slate-200'
  return sourceClass(sourceFromText(raw))
}

const formatDateTime = (value?: string | null) => {
  const date = new Date(String(value || ''))
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('fr-FR')
}

const formatDateOnly = (value?: string | null) => {
  const date = new Date(String(value || ''))
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleDateString('fr-FR')
}

const formatTimeOnly = (value?: string | null) => {
  const date = new Date(String(value || ''))
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

const formatDateLabel = (value?: string | null) => {
  const raw = String(value || '').trim()
  if (!raw) return '-'
  const date = raw.length <= 10 ? new Date(`${raw}T00:00:00`) : new Date(raw)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
}

const tokenPreview = (value: string) => {
  const raw = String(value || '').trim()
  if (!raw) return '-'
  if (raw.length <= 18) return raw
  return `${raw.slice(0, 10)}...${raw.slice(-6)}`
}

const toDateInput = (value: Date) => value.toISOString().slice(0, 10)

const getHistoryDateRange = (period: HistoryPeriod) => {
  const now = new Date()
  if (period === 'day') {
    return { start: toDateInput(now), end: toDateInput(now) }
  }
  if (period === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1)
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    return { start: toDateInput(start), end: toDateInput(end) }
  }
  const start = new Date(now)
  start.setDate(now.getDate() - 6)
  return { start: toDateInput(start), end: toDateInput(now) }
}

const asLegacyItems = (payload: LegacyPointageResponse | null | undefined) => {
  if (!payload || typeof payload !== 'object') return []
  if (Array.isArray(payload.items)) return payload.items
  if (Array.isArray(payload.pointages)) return payload.pointages
  if (Array.isArray(payload.data?.items)) return payload.data.items
  if (Array.isArray(payload.data?.pointages)) return payload.data.pointages
  return []
}

const parseDateTimeValue = (value: string) => {
  const raw = String(value || '').trim()
  if (!raw) return null
  const direct = new Date(raw)
  if (!Number.isNaN(direct.getTime())) return direct
  const normalized = raw.replace(' ', 'T')
  const fallback = new Date(normalized)
  return Number.isNaN(fallback.getTime()) ? null : fallback
}

const buildDateTimeFromLegacy = (row: LegacyPointageItem) => {
  const explicit = String(row.date_heure || '').trim()
  if (explicit) return explicit

  const datePart = String(row.date || '').trim()
  const departPart = String(row.depart || '').trim()
  const arriveePart = String(row.arrivee || '').trim()
  const timePart = departPart || arriveePart
  if (datePart && timePart) {
    return `${datePart}T${timePart}`
  }
  if (datePart) {
    return `${datePart}T00:00:00`
  }
  return new Date().toISOString()
}

const buildLegacyPointageLabel = (row: LegacyPointageItem) => {
  const arrivee = String(row.arrivee || '').trim()
  const depart = String(row.depart || '').trim()
  if (arrivee && depart) return `Arrivee ${arrivee} - Depart ${depart}`
  if (arrivee) return `Arrivee ${arrivee}`
  if (depart) return `Depart ${depart}`
  const rawType = String(row.type || '').trim()
  return rawType || '-'
}

const buildLegacyStatusLabel = (row: LegacyPointageItem) => {
  const typeRaw = String(row.type || '').trim().toLowerCase()
  if (typeRaw.includes('pause_debut') || typeRaw === 'pause' || typeRaw === 'pause debut') return 'En cours'
  if (typeRaw.includes('pause_fin') || typeRaw === 'pause fin') return 'Terminee'
  const raw = String(row.statut || '').trim().toLowerCase()
  const retardMinutes = Number(row.retard_minutes || 0)
  if (retardMinutes > 0 || raw.includes('retard')) return 'En retard'
  if (raw.includes('abs')) return 'Absent'
  if (raw.includes("a l'heure") || raw.includes('a l heure') || raw.includes('normal')) return "A l'heure"
  return 'Indetermine'
}

const mapLegacyPointageToScanAttempt = (row: LegacyPointageItem, index: number): ScanAttempt => {
  const statusLabel = buildLegacyStatusLabel(row)
  const fullName = `${String(row.prenom || '').trim()} ${String(row.nom || '').trim()}`.trim()
  const at = buildDateTimeFromLegacy(row)
  const actionType = resolveActionType(String(row.type || buildLegacyPointageLabel(row)))
  const dateLabel = formatDateOnly(at)
  const heureLabel = formatTimeOnly(at)
  const arrivee = String(row.arrivee || '').trim() || null
  const depart = String(row.depart || '').trim() || null
  const normalizedSource = normalizeSource(row.source)
  return {
    id: String(row.id ?? `legacy-${index}`),
    at,
    dateLabel,
    heureLabel,
    heureArrivee: arrivee,
    heurePause: null,
    heureDepart: depart,
    source: normalizedSource,
    sourceText: sourceLabel(normalizedSource),
    actionType,
    actionTypes: actionType ? [actionType] : [],
    status: statusLabel.toLowerCase().includes('retard') ? 'action_required' : statusLabel.toLowerCase().includes("a l'heure") ? 'active' : 'unknown',
    statusLabel,
    userName: fullName || '-',
    userMatricule: String(row.matricule || '').trim() || '-',
    tokenPreview: tokenPreview(String(row.badge || '').trim()),
    pointageLabel: buildLegacyPointageLabel(row),
    justification: String(row.justification || row.commentaire || '').trim() || '-'
  }
}

const resolveResultStatus = (payload: Partial<ScanApiResponse>): UiBadgeStatus => {
  const code = String(payload.code || '').trim().toUpperCase()
  const duplicateType = String(payload.duplicate_type || '').trim().toLowerCase()
  const badgeStatus = String(payload.badge_status || payload.data?.badge_status || '').trim().toLowerCase()
  if (code === 'BADGE_INACTIVE' || badgeStatus === 'inactive') return 'inactive'
  if (code === 'BADGE_EXPIRED' || badgeStatus === 'expired') return 'expired'
  if (code === 'SECOND_SCAN_ACTION_REQUIRED' || code === 'JUSTIFICATION_REQUIRED') return 'action_required'
  if (code === 'DEPART_ALREADY_REGISTERED' || (code === 'POINTAGE_DUPLICATE' && duplicateType === 'depart')) return 'depart_done'
  if (payload.success) return 'active'
  return 'unknown'
}

const resolveActionType = (value: string): ScanActionType => {
  const raw = String(value || '').trim().toLowerCase()
  if (raw.includes('arrivee')) return 'arrivee'
  if (raw.includes('depart')) return 'depart'
  if (raw.includes('pause')) return 'pause'
  return null
}

const buildEffectiveStatusLabel = (entry: ScanAttempt) => {
  const typeLabel = String(entry.pointageLabel || '').trim().toLowerCase()
  const knownActionTypes = Array.isArray(entry.actionTypes) && entry.actionTypes.length > 0
    ? entry.actionTypes
    : (entry.actionType ? [entry.actionType] : [])

  const hasPause = knownActionTypes.includes('pause') || typeLabel.includes('pause')
  const hasArrivee = knownActionTypes.includes('arrivee') || typeLabel.includes('arrivee')
  const hasDepart = knownActionTypes.includes('depart') || typeLabel.includes('depart')
  const isPauseOnly = hasPause && !hasArrivee && !hasDepart

  if (isPauseOnly) {
    if (typeLabel.includes('fin')) return 'Terminee'
    return 'En cours'
  }

  return String(entry.statusLabel || '').trim() || 'Indetermine'
}

const statusDisplay = (entry: ScanAttempt) => {
  const effectiveStatusLabel = buildEffectiveStatusLabel(entry)
  const label = effectiveStatusLabel.toLowerCase()
  if (label.includes('retard')) {
    return { text: effectiveStatusLabel || 'En retard', className: 'text-red-600 bg-red-50 border-red-200', Icon: AlertTriangle }
  }
  if (label.includes('depart anticipe')) {
    return { text: effectiveStatusLabel || 'Depart anticipe', className: 'text-orange-700 bg-orange-50 border-orange-200', Icon: AlertTriangle }
  }
  if (label.includes('depart normal')) {
    return { text: effectiveStatusLabel || 'Depart normal', className: 'text-green-600 bg-green-50 border-green-200', Icon: CheckCircle2 }
  }
  if (label.includes('en cours')) {
    return { text: effectiveStatusLabel || 'En cours', className: 'text-blue-700 bg-blue-50 border-blue-200', Icon: Clock3 }
  }
  if (label.includes('terminee')) {
    return { text: effectiveStatusLabel || 'Terminee', className: 'text-indigo-700 bg-indigo-50 border-indigo-200', Icon: CheckCircle2 }
  }
  if (label.includes("a l'heure") || label.includes('a l heure')) {
    return { text: effectiveStatusLabel || "A l'heure", className: 'text-green-600 bg-green-50 border-green-200', Icon: CheckCircle2 }
  }
  return { text: effectiveStatusLabel || 'Indetermine', className: 'text-orange-600 bg-orange-50 border-orange-200', Icon: XCircle }
}

const formatHistoryHourLabel = (entry: Pick<ScanAttempt, 'heureLabel' | 'heureArrivee' | 'heurePause' | 'heureDepart'>) => {
  const parts: string[] = []
  if (entry.heureArrivee) parts.push(`A ${entry.heureArrivee}`)
  if (entry.heurePause) parts.push(`P ${entry.heurePause}`)
  if (entry.heureDepart) parts.push(`D ${entry.heureDepart}`)
  if (parts.length > 0) return parts.join(' | ')
  return entry.heureLabel
}

const badgeStatusLabel = (value: string | null | undefined) => {
  const raw = String(value || '').trim().toLowerCase()
  if (raw === 'active') return 'Badge actif'
  if (raw === 'inactive' || raw === 'revoked') return 'Badge inactif'
  if (raw === 'expired') return 'Badge expire'
  return 'Badge inconnu'
}

const getJustificationReasonLabel = (value: string) =>
  JUSTIFICATION_REASON_LABELS[String(value || '').trim().toLowerCase()] || 'Justification'

const buildUserFullName = (user: LastScannedUser | null) => {
  if (!user) return '-'
  const fromParts = `${String(user.prenom || '').trim()} ${String(user.nom || '').trim()}`.trim()
  if (fromParts) return fromParts
  return String(user.nom_complet || '').trim() || '-'
}

const mapHistoryItemToLastScannedUser = (item: ScanHistoryApiItem): LastScannedUser => {
  const rawFullName = String(item.nom_complet || '').trim()
  const [prenom = '', ...rest] = rawFullName.split(' ')
  return {
    id: Number(item.user_id || 0) || 0,
    user_type: String(item.user_type || '').trim() || undefined,
    nom_complet: rawFullName || '-',
    prenom,
    nom: rest.join(' ').trim() || '',
    matricule: String(item.matricule || '').trim() || '-',
    role: String(item.role || '').trim() || null,
    badge_status: String(item.badge_status || '').trim() || null,
    email: String(item.email || '').trim() || null,
    email_pro: String(item.email_pro || '').trim() || null,
    telephone: String(item.telephone || '').trim() || null,
    poste: String(item.poste || '').trim() || null,
    departement: String(item.departement || '').trim() || null,
    adresse: String(item.adresse || '').trim() || null,
    date_embauche: String(item.date_embauche || '').trim() || null,
    contrat_type: String(item.contrat_type || '').trim() || null,
    contrat_duree: String(item.contrat_duree || '').trim() || null,
    contrat_pdf_url: String(item.contrat_pdf_url || '').trim() || null,
    photo: String(item.photo || '').trim() || null
  }
}

export default function ScanQRPage() {
  const { user, isLoading } = useAuth()
  const navigate = useNavigate()
  
  // TOUS les hooks doivent être déclarés au début, avant tout return conditionnel
  // État de verrouillage de la zone de scan
  const [isScanUnlocked, setIsScanUnlocked] = useState(false)
  const [sessionCheckLoading, setSessionCheckLoading] = useState(true)
  const [remainingSessionMs, setRemainingSessionMs] = useState(0)

  // Hooks pour le scan
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const scannerRef = useRef<QrScanner | null>(null)
  const lastDetectedRef = useRef<{ token: string; at: number }>({ token: '', at: 0 })
  const isSubmittingRef = useRef(false)
  const unavailableHistoryEndpointsRef = useRef<Set<string>>(new Set())
  const preferredHistoryEndpointRef = useRef<string | null>(null)

  const [currentTime, setCurrentTime] = useState(new Date())
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [manualToken, setManualToken] = useState('')
  const [cameraRunning, setCameraRunning] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [lastResult, setLastResult] = useState<{ status: UiBadgeStatus; actionType: ScanActionType; message: string; source: ScanSource; at: string } | null>(null)
  const [history, setHistory] = useState<ScanAttempt[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [historyPeriod, setHistoryPeriod] = useState<HistoryPeriod>('week')
  const [actionDecision, setActionDecision] = useState<ActionDecisionState | null>(null)
  const [justificationDecision, setJustificationDecision] = useState<JustificationDecisionState | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<HistoryStatusFilter>('')
  const [actionFilter, setActionFilter] = useState<HistoryActionFilter>('')
  const [lastScannedUser, setLastScannedUser] = useState<LastScannedUser | null>(null)
  const [showEmployeDetails, setShowEmployeDetails] = useState(false)

  // Vérification des permissions admin
  const ADMIN_ALLOWED_ROLES = new Set(['admin', 'super_admin', 'manager', 'hr'])
  const isAdmin = useMemo(() => {
    if (!user) return false
    return ADMIN_ALLOWED_ROLES.has(String(user.role || '').toLowerCase())
  }, [user])

  const canSubmit = useMemo(() => manualToken.trim().length > 0 && !submitting, [manualToken, submitting])

  // Rediriger si non admin
  useEffect(() => {
    if (!isLoading && !isAdmin) {
      navigate('/login')
    }
  }, [isAdmin, isLoading, navigate])

  // Vérifier si la zone de scan est déverrouillée
  useEffect(() => {
    const checkScanSecurity = async () => {
      try {
        // Si l'utilisateur est super_admin, déverrouiller automatiquement
        if (scanSecurityService.isSuperAdmin(user)) {
          console.log('Super_admin détecté, déverrouillage automatique de la zone de scan')
          try {
            await scanSecurityService.adminOverrideUnlock(60) // 60 minutes
            setIsScanUnlocked(true)
          } catch (error) {
            console.error('Erreur lors du déverrouillage admin:', error)
            setIsScanUnlocked(false)
          }
          setSessionCheckLoading(false)
          return
        }

        // Pour les autres utilisateurs, vérifier la session existante
        const session = scanSecurityService.getCurrentSession()
        if (session) {
          const validation = await scanSecurityService.validateSession(session.id)
          if (!validation.valid) {
            setIsScanUnlocked(false)
            setRemainingSessionMs(0)
            return
          }
          setIsScanUnlocked(true)
          setRemainingSessionMs(Number(validation.remaining_time || 0))
        } else {
          setIsScanUnlocked(false)
          setRemainingSessionMs(0)
        }
      } catch (error) {
        console.error('Erreur lors de la vérification de sécurité:', error)
        setIsScanUnlocked(false)
        setRemainingSessionMs(0)
      } finally {
        setSessionCheckLoading(false)
      }
    }

    checkScanSecurity()
  }, [user])

  useEffect(() => {
    if (!isScanUnlocked) return

    const update = () => {
      const remaining = scanSecurityService.getRemainingTime()
      setRemainingSessionMs(remaining)
      if (remaining <= 0) {
        setIsScanUnlocked(false)
      }
    }

    update()
    const interval = window.setInterval(update, 1000)
    return () => window.clearInterval(interval)
  }, [isScanUnlocked])

  // Clock update
  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  // Online status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  // Redirect non-admin users
  useEffect(() => {
    if (!isLoading && !isAdmin) {
      navigate('/login')
    }
  }, [isAdmin, isLoading, navigate])

  // Camera cleanup
  const stopCamera = useCallback(() => {
    const scanner = scannerRef.current
    scannerRef.current = null
    if (scanner) {
      scanner.stop()
      scanner.destroy()
    }
    setCameraRunning(false)
  }, [])

  useEffect(() => {
    return () => stopCamera()
  }, [stopCamera])

  // History loading
  const loadHistory = useCallback(async () => {
    try {
      setHistoryLoading(true)
      setHistoryError(null)

      const { start, end } = getHistoryDateRange(historyPeriod)
      const baseEndpoints = [
        '/api/public/scan-history',
        '/api/public/scan_history',
        `/api/get_pointages?page_pointage=1&per_page=300&date_debut=${start}&date_fin=${end}`,
        `/api/get_pointages?page_pointage=1&per_page=300`
      ]

      const preferredEndpoint = preferredHistoryEndpointRef.current
      const orderedBaseEndpoints = preferredEndpoint
        ? [preferredEndpoint, ...baseEndpoints.filter((endpoint) => endpoint !== preferredEndpoint)]
        : baseEndpoints

      const endpoints = orderedBaseEndpoints.map((endpoint) =>
        endpoint.includes('?') ? endpoint : `${endpoint}?period=${historyPeriod}`
      )

      let lastError: any = null
      let loaded = false

      for (const endpoint of endpoints) {
        const endpointKey = String(endpoint.split('?')[0] || '').trim()
        if (unavailableHistoryEndpointsRef.current.has(endpointKey)) continue

        try {
          if (endpoint.includes('/scan_history') || endpoint.includes('/scan-history') || endpoint.includes('/scan/history')) {
            const response = await apiClient.get<ScanHistoryApiResponse>(endpoint)
            const rows = Array.isArray(response?.items) ? response.items : []
            const mapped = rows.map((item, index): ScanAttempt => {
              const statusKey = String(item.status || '').toLowerCase()
              const rawActionTypes = Array.isArray(item.action_types) ? item.action_types : []
              const actionTypes = Array.from(new Set(
                [...rawActionTypes, item.action_type]
                  .map((value) => {
                    const resolved = resolveActionType(String(value || ''))
                    return resolved === 'arrivee' || resolved === 'depart' || resolved === 'pause' ? resolved : ''
                  })
                  .filter((value): value is HistoryActionFilter =>
                    value === 'arrivee' || value === 'depart' || value === 'pause' || value === ''
                  )
              ))
              const normalizedActionType = actionTypes[actionTypes.length - 1] || resolveActionType(String(item.action_type || item.type))
              const pointageLabel = String(item.type || '').trim() || (
                normalizedActionType === 'arrivee' ? 'Arrivée' : normalizedActionType === 'depart' ? 'Départ' : normalizedActionType === 'pause' ? 'Pause' : '-'
              )
              const dateTimeValue = String(item.date_time || '').trim()
              const rawSourceText = String(item.source || '').trim()
              const source = sourceFromText(rawSourceText)

              return {
                id: String(item.id ?? `row-${index}`),
                at: dateTimeValue,
                dateLabel: String(item.date || '').trim() || formatDateOnly(dateTimeValue),
                heureLabel: String(item.heure || '').trim() || formatTimeOnly(dateTimeValue),
                heureArrivee: String(item.heure_arrivee || '').trim() || null,
                heurePause: String(item.heure_pause || '').trim() || null,
                heureDepart: String(item.heure_depart || '').trim() || null,
                source,
                sourceText: rawSourceText || sourceLabel(source),
                actionType: normalizedActionType,
                actionTypes,
                status: statusKey === 'en_retard' || statusKey === 'depart_anticipe' ? 'action_required' : statusKey === 'a_l_heure' || statusKey === 'depart_normal' ? 'active' : 'unknown',
                statusLabel: String(item.status_label || '').trim() || '-',
                userName: String(item.nom_complet || '').trim() || '-',
                userMatricule: String(item.matricule || '').trim() || '-',
                tokenPreview: tokenPreview(item.badge),
                pointageLabel,
                justification: String(item.justification || '').trim() || '-'
              }
            })

            setHistory(mapped)
            if (mapped.length > 0) {
              const latest = mapped[0]
              setLastResult({
                status: latest.status,
                actionType: latest.actionType,
                message: `${latest.pointageLabel} enregistré`,
                source: latest.source,
                at: latest.at
              })
            }

            if (response?.last_user) {
              setLastScannedUser(response.last_user)
            } else if (rows.length > 0) {
              setLastScannedUser(mapHistoryItemToLastScannedUser(rows[0]))
            }

            preferredHistoryEndpointRef.current = endpointKey
            loaded = true
            break
          }

          const response = await apiClient.get<LegacyPointageResponse>(endpoint)
          const rows = asLegacyItems(response)
          const mapped = rows.map((item, index) => mapLegacyPointageToScanAttempt(item, index))
          mapped.sort((left, right) => {
            const leftTs = parseDateTimeValue(left.at)?.getTime() || 0
            const rightTs = parseDateTimeValue(right.at)?.getTime() || 0
            return rightTs - leftTs
          })

          setHistory(mapped)
          if (mapped.length > 0) {
            const latest = mapped[0]
            setLastResult({
              status: latest.status,
              actionType: latest.actionType,
              message: `${latest.pointageLabel} enregistré`,
              source: latest.source,
              at: latest.at
            })
          }

          preferredHistoryEndpointRef.current = endpointKey
          loaded = true
          break
        } catch (error: any) {
          lastError = error
          const status = Number(error?.status || 0)
          if (status === 404 || status === 405) {
            unavailableHistoryEndpointsRef.current.add(endpointKey)
          }
          if (!status || status === 401 || status === 403 || status === 404 || status === 405 || status === 500 || status === 502 || status === 503 || status === 504) {
            continue
          }
          throw error
        }
      }

      if (!loaded) {
        throw lastError || new Error('Historique indisponible')
      }
    } catch (error: any) {
      console.error('History loading error:', error)
      setHistory([])
      setHistoryError(error?.message || 'Historique indisponible')
    } finally {
      setHistoryLoading(false)
    }
  }, [historyPeriod])

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  // Filtered history based on search and filters
  const filteredHistory = useMemo(() => {
    return history.filter((entry) => {
      const matchesSearch = !searchQuery ||
        entry.userName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        entry.userMatricule.toLowerCase().includes(searchQuery.toLowerCase()) ||
        entry.tokenPreview.toLowerCase().includes(searchQuery.toLowerCase())

      const matchesStatus = !statusFilter ||
        (statusFilter === 'a_l_heure' && entry.status === 'active') ||
        (statusFilter === 'en_retard' && entry.status === 'action_required') ||
        (statusFilter === 'indetermine' && entry.status === 'unknown')

      const matchesAction = !actionFilter || entry.actionType === actionFilter

      return matchesSearch && matchesStatus && matchesAction
    })
  }, [history, searchQuery, statusFilter, actionFilter])

  // Scan submission
  const submitScan = useCallback(async (rawToken: string, source: ScanSource, scanAction?: RequiredAction, justification?: string): Promise<void> => {
    const token = String(rawToken || '').trim()
    if (!token || isSubmittingRef.current) return

    // Permettre les scans de badges même sans session active
    // Le badge sera validé par le backend indépendamment de la session frontend
    isSubmittingRef.current = true
    setSubmitting(true)
    setCameraError(null)

    const nowIso = new Date().toISOString()
    const payloadJustification = String(justification || '').trim()

    try {
      const payload = await apiClient.post<{ badge_data: string; scan_action?: RequiredAction; justification?: string; device_info: Record<string, string> }, ScanApiResponse>(
        '/api/public/scan_qr',
        {
          badge_data: token,
          ...(scanAction ? { scan_action: scanAction } : {}),
          ...(payloadJustification ? { justification: payloadJustification } : {}),
          device_info: {
            source,
            userAgent: navigator.userAgent,
            platform: navigator.platform,
            language: navigator.language,
            timestamp: nowIso
          }
        }
      )

      setActionDecision(null)
      setJustificationDecision(null)
      if (payload.data?.user) setLastScannedUser(payload.data.user)

      setLastResult({
        status: resolveResultStatus(payload),
        actionType: resolveActionType(String(payload.data?.type || payload.duplicate_type || '')),
        message: String(payload.message || 'Pointage enregistré.'),
        source,
        at: nowIso
      })

      await loadHistory()
    } catch (error: any) {
      console.error('Erreur de scan QR:', error)
      
      // Gestion spécifique des erreurs HTTP
      let errorMessage = String(error?.message || 'Erreur de scan')
      let errorCode = typeof error?.code === 'string' ? error.code : undefined
      
      if (error?.status === 403) {
        errorMessage = 'Accès refusé : Votre badge n\'est pas reconnu ou a expiré. Veuillez contacter votre administrateur.'
        errorCode = 'ACCESS_DENIED'
      } else if (error?.status === 401) {
        errorMessage = 'Session expirée : Veuillez vous reconnecter pour continuer.'
        errorCode = 'SESSION_EXPIRED'
      } else if (error?.status === 404) {
        errorMessage = 'Service indisponible : Le service de pointage n\'est pas accessible.'
        errorCode = 'SERVICE_UNAVAILABLE'
      } else if (error?.status >= 500) {
        errorMessage = 'Erreur serveur : Veuillez réessayer dans quelques instants.'
        errorCode = 'SERVER_ERROR'
      }
      
      const payload: ScanApiResponse = {
        success: false,
        message: errorMessage,
        code: errorCode,
        duplicate_type: error?.duplicate_type,
        badge_status: error?.badge_status,
        data: error?.data && typeof error.data === 'object' ? error.data : undefined
      }

      const finalErrorCode = String(payload.code || '').toUpperCase()
      if (finalErrorCode === 'SECOND_SCAN_ACTION_REQUIRED') {
        setActionDecision({
          token,
          source,
          message: String(payload.message || 'Choisissez une action.'),
          availableActions: Array.isArray(payload.data?.available_actions) && payload.data.available_actions.length > 0
            ? payload.data.available_actions
            : ['pause', 'depart_anticipe']
        })
      } else if (finalErrorCode === 'JUSTIFICATION_REQUIRED' || 
                 (payload.data?.type && payload.data.type.includes('retard') && 
                  (finalErrorCode === 'SUCCESS' || finalErrorCode === 'ACTIVE'))) {
        // Afficher le modal de justification si retard détecté, même si non obligatoire
        const reason = String(payload.data?.justification_reason || payload.data?.required_reason || payload.data?.type || 'retard').trim()
        const minLength = Number(payload.data?.min_length || 5)
        const pointageType = String(payload.data?.type || '').trim().toLowerCase()
        const inferredAction: RequiredAction | undefined = pointageType === 'depart' ? 'depart_anticipe' : pointageType.startsWith('pause') ? 'pause' : scanAction

        setJustificationDecision({
          token,
          source,
          scanAction: inferredAction,
          message: finalErrorCode === 'JUSTIFICATION_REQUIRED' 
            ? String(payload.message || 'Justification obligatoire.')
            : `Retard détecté - Voulez-vous ajouter une justification ?`,
          reason,
          minLength: Number.isInteger(minLength) && minLength > 0 ? minLength : 5,
          value: payloadJustification,
          error: null
        })
      }

      if (payload.data?.user) setLastScannedUser(payload.data.user)

      setLastResult({
        status: resolveResultStatus(payload),
        actionType: resolveActionType(String(payload.data?.type || payload.duplicate_type || '')),
        message: String(payload.message || 'Erreur de scan'),
        source,
        at: nowIso
      })
    } finally {
      setSubmitting(false)
      isSubmittingRef.current = false
    }
  }, [loadHistory, setActionDecision, setJustificationDecision, setLastScannedUser, setLastResult, resolveResultStatus, resolveActionType])

  // Fonction de détection améliorée
  const handleDetectedToken = useCallback((token: string, source: ScanSource) => {
    const now = Date.now()
    const lastDetected = lastDetectedRef.current
    
    // Éviter les doublons rapides (même token dans les 2 secondes)
    if (token === lastDetected.token && (now - lastDetected.at) < 2000) {
      return
    }
    
    // Mettre à jour la référence
    lastDetectedRef.current = { token, at: now }
    
    // Validation du token
    const cleanToken = String(token || '').trim()
    if (!cleanToken || cleanToken.length < 10) {
      setLastResult({
        status: 'unknown',
        actionType: null,
        message: 'Token QR invalide ou trop court',
        source,
        at: new Date().toISOString()
      })
      return
    }
    
    // Soumettre le scan
    void submitScan(cleanToken, source)
  }, [submitScan, setLastResult])

  // Démarrer la caméra
  const startCamera = useCallback(async () => {
    const isLocalHost = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)
    if (!window.isSecureContext && !isLocalHost) {
      setCameraError('Caméra uniquement disponible en HTTPS ou localhost.')
      return
    }

    if (!videoRef.current) {
      setCameraError('Référence vidéo non disponible.')
      return
    }

    try {
      setCameraError(null)
      stopCamera()

      const scanner = new QrScanner(
        videoRef.current!,
        (result: any) => {
          const extracted = typeof result === 'string' ? result : result?.data
          if (extracted) handleDetectedToken(extracted, 'camera')
        },
        {
          preferredCamera: 'environment',
          returnDetailedScanResult: true,
          maxScansPerSecond: 1, // Réduit pour éviter les doublons
          highlightCodeOutline: true,
          highlightScanRegion: true,
          // Améliorer la détection
          calculateScanRegion: (video) => {
            // Utiliser 80% de la vidéo pour la région de scan
            const smallestDimension = Math.min(video.videoWidth, video.videoHeight);
            const scanRegionSize = Math.floor(smallestDimension * 0.8);
            const scanRegionX = (video.videoWidth - scanRegionSize) / 2;
            const scanRegionY = (video.videoHeight - scanRegionSize) / 2;
            return {
              x: scanRegionX,
              y: scanRegionY,
              width: scanRegionSize,
              height: scanRegionSize,
            };
          }
        }
      )

      scannerRef.current = scanner
      await scanner.start()
      setCameraRunning(true)
    } catch (error: any) {
      console.error('Camera error:', error)
      stopCamera()
      setCameraError(error?.message || 'Impossible de démarrer la caméra.')
    }
  }, [handleDetectedToken, stopCamera])

  // Event handlers
  const handleManualSubmit = useCallback(() => {
    if (!canSubmit) return
    void submitScan(manualToken.trim(), 'manual')
  }, [canSubmit, manualToken, submitScan])

  const handleImageScan = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    try {
      const result: any = await QrScanner.scanImage(file, { returnDetailedScanResult: true })
      const scannedValue = typeof result === 'string' ? result : result?.data
      if (!scannedValue) throw new Error('Aucun QR valide détecté.')
      setManualToken(scannedValue)
      void submitScan(scannedValue, 'image')
    } catch (error: any) {
      setLastResult({ status: 'unknown', actionType: null, message: error?.message || 'Impossible de lire le QR.', source: 'image', at: new Date().toISOString() })
    }
  }, [submitScan, setLastResult, setManualToken])

  const handleExportCsv = useCallback(() => {
    if (filteredHistory.length === 0) return

    const escapeCsv = (value: string | number | boolean | null | undefined) => {
      const text = String(value ?? '')
      if (text.includes('"') || text.includes(';') || text.includes('\n')) return `"${text.replace(/"/g, '""')}"`
      return text
    }

    const rows = [
      ['Date', 'Nom complet', 'Matricule', 'Badge', 'Type', 'Heure', 'Statut', 'Source', 'Justification'],
      ...filteredHistory.map((entry) => {
        const status = statusDisplay(entry)
        const heureAffichee = formatHistoryHourLabel(entry)
        return [entry.dateLabel || formatDateOnly(entry.at), entry.userName, entry.userMatricule, entry.tokenPreview, entry.pointageLabel, heureAffichee, status.text, entry.sourceText, entry.justification]
      })
    ]

    const csv = rows.map((row) => row.map((cell) => escapeCsv(cell)).join(';')).join('\n')
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `historique_scan_${historyPeriod}_${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }, [filteredHistory, historyPeriod])

  const handleActionDecision = useCallback((choice: 'annuler' | RequiredAction) => {
    if (!actionDecision) return
    if (choice === 'annuler') {
      setActionDecision(null)
      return
    }
    const { token, source } = actionDecision
    setActionDecision(null)
    void submitScan(token, source, choice)
  }, [actionDecision, submitScan])

  const handleJustificationDecisionClose = useCallback(() => {
    if (submitting) return
    setJustificationDecision(null)
  }, [submitting])

  const handleJustificationDecisionChange = useCallback((value: string) => {
    setJustificationDecision((previous) => {
      if (!previous) return previous
      return { ...previous, value, error: null }
    })
  }, [])

  const handleJustificationDecisionSubmit = useCallback(() => {
    if (!justificationDecision || submitting) return
    const value = String(justificationDecision.value || '').trim()
    if (value.length < justificationDecision.minLength) {
      setJustificationDecision((previous) => {
        if (!previous) return previous
        return { ...previous, error: `Veuillez saisir au moins ${justificationDecision.minLength} caractères.` }
      })
      return
    }
    void submitScan(justificationDecision.token, justificationDecision.source, justificationDecision.scanAction, value)
  }, [justificationDecision, submitting, submitScan])

  const formatRemainingSession = useCallback((ms: number) => {
    if (!ms || ms <= 0) return '0s'
    const totalSeconds = Math.floor(ms / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    if (minutes > 0) return `${minutes}m ${seconds}s`
    return `${seconds}s`
  }, [])

  const handleExtendScanSession = useCallback(async () => {
    const response = await scanSecurityService.extendSession(60)
    if (response.success) {
      setRemainingSessionMs(scanSecurityService.getRemainingTime())
    }
  }, [])

  const handleLockScanSession = useCallback(async () => {
    await scanSecurityService.lock()
    setIsScanUnlocked(false)
    setRemainingSessionMs(0)
  }, [])

  // All hooks and callbacks are now declared
  // Now we can do conditional rendering
  if (isLoading || sessionCheckLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Vérification des permissions...</p>
        </div>
      </div>
    )
  }

  // Afficher accès refusé
  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center p-8">
          <ShieldCheck className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Accès refusé</h1>
          <p className="text-gray-600 mb-6">Seuls les administrateurs peuvent accéder à cette zone.</p>
          <button onClick={() => navigate('/admin')} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            Retour
          </button>
        </div>
      </div>
    )
  }

  // Locked - show lock screen
  if (!isScanUnlocked) {
    return (
      <ScanLockScreen
        onUnlocked={() => {
          setIsScanUnlocked(true)
          setRemainingSessionMs(scanSecurityService.getRemainingTime())
        }}
      />
    )
  }

  // Main render - unlocked state
  return (
    <>
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center"><QrCode size={22} /></div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Zone de scan badge</h1>
              <p className="text-sm text-slate-600">Enregistrement des pointages hebdomadaires avec donnees reelles.</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-sm font-medium text-slate-700">{currentTime.toLocaleTimeString('fr-FR')}</div>
            <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${isOnline ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-red-100 text-red-700 border-red-200'}`}>
              {isOnline ? <Wifi size={13} className="mr-1" /> : <WifiOff size={13} className="mr-1" />}
              {isOnline ? 'En ligne' : 'Hors ligne'}
            </span>

            <span className="inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold bg-slate-100 text-slate-700 border-slate-200">
              <Clock size={13} className="mr-1" />
              Temps restant: {formatRemainingSession(remainingSessionMs)}
            </span>

            <button
              type="button"
              onClick={() => void handleExtendScanSession()}
              className="inline-flex items-center px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm text-slate-700 hover:bg-slate-50"
            >
              <Clock3 size={15} className="mr-1.5" /> Prolonger
            </button>
            <button
              type="button"
              onClick={() => void handleLockScanSession()}
              className="inline-flex items-center px-3 py-2 rounded-lg bg-red-600 text-white text-sm hover:bg-red-700"
            >
              Verrouiller
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 grid grid-cols-1 xl:grid-cols-3 gap-6">
        <section className="xl:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-slate-900">Scanner un badge</h2>
            <div className="flex gap-2">
              {!cameraRunning ? (
                <button type="button" onClick={() => void startCamera()} className="inline-flex items-center px-3 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700">
                  <Camera size={15} className="mr-1.5" /> Demarrer camera
                </button>
              ) : (
                <button type="button" onClick={stopCamera} className="inline-flex items-center px-3 py-2 rounded-lg bg-red-600 text-white text-sm hover:bg-red-700">
                  <CameraOff size={15} className="mr-1.5" /> Arreter camera
                </button>
              )}
              {/* <label className="inline-flex cursor-pointer items-center px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm text-slate-700 hover:bg-slate-50">
                <ImageUp size={15} className="mr-1.5" /> Scanner image
                <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleImageScan} />
              </label> */}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-900/95 overflow-hidden relative">
            <video ref={videoRef} autoPlay playsInline muted className="w-full aspect-[16/9] object-cover" />
            {!cameraRunning ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="rounded-lg border border-slate-700 bg-slate-800/90 px-4 py-2 text-slate-200 text-sm">Camera arretee. Demarrez la camera ou utilisez la saisie manuelle.</div>
              </div>
            ) : null}
          </div>

          {cameraError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2 flex items-start gap-2"><AlertTriangle size={16} className="mt-0.5" /> {cameraError}</div>
          ) : null}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Valeur badge QR (scan manuel)</label>
            <div className="flex flex-col sm:flex-row gap-2">
              <textarea value={manualToken} onChange={(event) => setManualToken(event.target.value)} rows={3} placeholder="Collez ou scannez ici la valeur QR du badge..." className="flex-1 px-3 py-2 border border-slate-300 rounded-lg font-mono text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200" />
              <div className="flex sm:flex-col gap-2">
                <button type="button" onClick={handleManualSubmit} disabled={!canSubmit} className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm hover:bg-emerald-700 disabled:opacity-50">
                  {submitting ? <RefreshCw size={15} className="mr-1.5 animate-spin" /> : <ShieldCheck size={15} className="mr-1.5" />} Verifier
                </button>
                <button type="button" onClick={() => { setManualToken(''); setLastResult(null) }} className="inline-flex items-center justify-center px-4 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm hover:bg-slate-50">Reinitialiser</button>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-slate-900">Dernier utilisateur scanne</h2>
            <button type="button" onClick={() => setShowEmployeDetails((previous) => !previous)} className="inline-flex items-center px-3 py-1.5 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50"><User className="h-4 w-4 mr-1.5" />{showEmployeDetails ? 'Masquer les details' : 'Afficher les details'}</button>
          </div>

          {lastScannedUser ? (
            <>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-lg font-semibold text-slate-900">{buildUserFullName(lastScannedUser)}</div>
                <div className="text-sm text-slate-600 mt-1">Matricule: <span className="font-mono text-slate-900">{lastScannedUser.matricule || '-'}</span></div>
                <div className="text-sm text-slate-600">{lastScannedUser.role || '-'} | {badgeStatusLabel(lastScannedUser.badge_status)}</div>
              </div>

              {showEmployeDetails ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="rounded-lg border border-slate-200 px-3 py-2"><div className="text-xs text-slate-500 flex items-center gap-1"><Mail size={12} /> Email</div><div className="text-sm text-slate-900 mt-1 break-all">{lastScannedUser.email || lastScannedUser.email_pro || '-'}</div></div>
                    <div className="rounded-lg border border-slate-200 px-3 py-2"><div className="text-xs text-slate-500 flex items-center gap-1"><Phone size={12} /> Telephone</div><div className="text-sm text-slate-900 mt-1 break-words">{lastScannedUser.telephone || '-'}</div></div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="rounded-lg border border-slate-200 px-3 py-2"><div className="text-xs text-slate-500">Poste</div><div className="text-sm text-slate-900 mt-1 break-words">{lastScannedUser.poste || '-'}</div></div>
                    <div className="rounded-lg border border-slate-200 px-3 py-2"><div className="text-xs text-slate-500">Departement</div><div className="text-sm text-slate-900 mt-1 break-words">{lastScannedUser.departement || '-'}</div></div>
                  </div>
                  <div className="rounded-lg border border-slate-200 px-3 py-2"><div className="text-xs text-slate-500 flex items-center gap-1"><MapPin size={12} /> Adresse</div><div className="text-sm text-slate-900 mt-1 break-words">{lastScannedUser.adresse || '-'}</div></div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="rounded-lg border border-slate-200 px-3 py-2"><div className="text-xs text-slate-500">Date embauche</div><div className="text-sm text-slate-900 mt-1">{formatDateLabel(lastScannedUser.date_embauche)}</div></div>
                    <div className="rounded-lg border border-slate-200 px-3 py-2"><div className="text-xs text-slate-500">Contrat</div><div className="text-sm text-slate-900 mt-1 break-words">{lastScannedUser.contrat_type || '-'}{lastScannedUser.contrat_duree ? ` (${lastScannedUser.contrat_duree})` : ''}</div></div>
                  </div>
                  {lastScannedUser.contrat_pdf_url ? <a href={lastScannedUser.contrat_pdf_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm text-blue-700 hover:text-blue-800"><FileText size={14} /> Ouvrir le contrat PDF</a> : null}
                </div>
              ) : null}
            </>
          ) : (
            <div className="text-center py-8 text-slate-500"><User className="h-12 w-12 mx-auto mb-3 text-slate-400" />Aucun utilisateur scanne pour le moment</div>
          )}

          <div className="rounded-xl border border-slate-200 p-4 space-y-2">
            <h3 className="text-sm font-semibold text-slate-900">Dernier resultat</h3>
            {!lastResult ? (
              <div className="text-center py-4">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mb-3">
                  <QrCode className="w-8 h-8 text-gray-400" />
                </div>
                <div className="text-sm text-slate-600">Aucun scan effectue pour le moment.</div>
                <div className="text-xs text-slate-500 mt-1">Scannez un badge pour commencer</div>
              </div>
            ) : (
              <div className={`p-4 rounded-lg border-2 ${
                lastResult.status === 'active' ? 'bg-green-50 border-green-200' :
                lastResult.status === 'inactive' ? 'bg-red-50 border-red-200' :
                lastResult.status === 'expired' ? 'bg-yellow-50 border-yellow-200' :
                lastResult.status === 'depart_done' ? 'bg-orange-50 border-orange-200' :
                lastResult.status === 'action_required' ? 'bg-indigo-50 border-indigo-200' :
                'bg-gray-50 border-gray-200'
              }`}>
                <div className="flex items-center justify-center mb-3">
                  {lastResult.status === 'active' && (
                    <div className="flex items-center justify-center w-12 h-12 bg-green-100 rounded-full">
                      <CheckCircle2 className="w-6 h-6 text-green-600" />
                    </div>
                  )}
                  {lastResult.status === 'inactive' && (
                    <div className="flex items-center justify-center w-12 h-12 bg-red-100 rounded-full">
                      <XCircle className="w-6 h-6 text-red-600" />
                    </div>
                  )}
                  {lastResult.status === 'expired' && (
                    <div className="flex items-center justify-center w-12 h-12 bg-yellow-100 rounded-full">
                      <AlertTriangle className="w-6 h-6 text-yellow-600" />
                    </div>
                  )}
                  {lastResult.status === 'depart_done' && (
                    <div className="flex items-center justify-center w-12 h-12 bg-orange-100 rounded-full">
                      <Clock3 className="w-6 h-6 text-orange-600" />
                    </div>
                  )}
                  {lastResult.status === 'action_required' && (
                    <div className="flex items-center justify-center w-12 h-12 bg-indigo-100 rounded-full">
                      <AlertTriangle className="w-6 h-6 text-indigo-600" />
                    </div>
                  )}
                  {lastResult.status === 'unknown' && (
                    <div className="flex items-center justify-center w-12 h-12 bg-gray-100 rounded-full">
                      <AlertTriangle className="w-6 h-6 text-gray-600" />
                    </div>
                  )}
                </div>
                <div className={`text-center ${
                  lastResult.message?.includes('Accès refusé') || lastResult.message?.includes('403') ? 'text-red-700 font-semibold' :
                  lastResult.message?.includes('Session expirée') || lastResult.message?.includes('401') ? 'text-orange-700 font-semibold' :
                  lastResult.message?.includes('Service indisponible') || lastResult.message?.includes('404') ? 'text-yellow-700 font-semibold' :
                  lastResult.message?.includes('Erreur serveur') ? 'text-red-600 font-semibold' :
                  'text-gray-700'
                }`}>
                  {lastResult.message?.includes('Accès refusé') && (
                    <div className="flex items-center justify-center mb-2">
                      <ShieldX className="w-5 h-5 text-red-600 mr-2" />
                      <span className="text-lg">⚠️ Erreur d'autorisation</span>
                    </div>
                  )}
                  {lastResult.message?.includes('Session expirée') && (
                    <div className="flex items-center justify-center mb-2">
                      <LogOut className="w-5 h-5 text-orange-600 mr-2" />
                      <span className="text-lg">🔐 Session expirée</span>
                    </div>
                  )}
                  {lastResult.message?.includes('Service indisponible') && (
                    <div className="flex items-center justify-center mb-2">
                      <WifiOff className="w-5 h-5 text-yellow-600 mr-2" />
                      <span className="text-lg">📡 Service indisponible</span>
                    </div>
                  )}
                  {lastResult.message?.includes('Erreur serveur') && (
                    <div className="flex items-center justify-center mb-2">
                      <ServerCrash className="w-5 h-5 text-red-600 mr-2" />
                      <span className="text-lg">🔴 Erreur serveur</span>
                    </div>
                  )}
                  <div className="text-base leading-relaxed">
                    {lastResult.message}
                  </div>
                  
                  {/* Actions suggestions pour les erreurs spécifiques */}
                  {lastResult.message?.includes('Accès refusé') && (
                    <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                      <div className="flex items-center mb-2">
                        <HelpCircle className="w-4 h-4 text-red-600 mr-2" />
                        <span className="text-sm font-medium text-red-800">Que faire ?</span>
                      </div>
                      <ul className="text-sm text-red-700 space-y-1">
                        <li>• Vérifiez que votre badge est valide et actif</li>
                        <li>• Contactez votre administrateur pour vérifier votre accès</li>
                        <li>• Assurez-vous que votre badge n'a pas expiré</li>
                      </ul>
                    </div>
                  )}
                  
                  {lastResult.message?.includes('Session expirée') && (
                    <div className="mt-4 p-3 bg-orange-50 border border-orange-200 rounded-lg">
                      <div className="flex items-center mb-2">
                        <RefreshCw className="w-4 h-4 text-orange-600 mr-2" />
                        <span className="text-sm font-medium text-orange-800">Solution rapide :</span>
                      </div>
                      <ul className="text-sm text-orange-700 space-y-1">
                        <li>• Cliquez sur "Se déconnecter" puis reconnectez-vous</li>
                        <li>• Votre session sera renouvelée pour 24 heures</li>
                      </ul>
                    </div>
                  )}
                </div>
                <div className="text-xs text-slate-500 mt-2 text-center">
                  Source: {sourceLabel(lastResult.source)} | {formatDateTime(lastResult.at)}
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="xl:col-span-3 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-900">Historique des scans</h2>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => setHistoryPeriod('day')} className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${historyPeriod === 'day' ? 'bg-blue-500 text-white border-blue-500' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>Jour</button>
                <button type="button" onClick={() => setHistoryPeriod('week')} className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${historyPeriod === 'week' ? 'bg-blue-500 text-white border-blue-500' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>Semaine</button>
                <button type="button" onClick={() => setHistoryPeriod('month')} className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${historyPeriod === 'month' ? 'bg-blue-500 text-white border-blue-500' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>Mois</button>
              </div>
            </div>

            <div className="flex flex-wrap gap-3 items-center justify-between">
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative">
                  <input type="text" placeholder="Rechercher par nom, matricule, badge..." value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} className="pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-64" />
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                </div>
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as HistoryStatusFilter)} className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"><option value="">Tous les statuts</option><option value="a_l_heure">A l'heure</option><option value="en_retard">En retard</option><option value="indetermine">Indetermine</option></select>
                <select value={actionFilter} onChange={(event) => setActionFilter(event.target.value as HistoryActionFilter)} className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"><option value="">Toutes les actions</option><option value="arrivee">Arrivee</option><option value="depart">Depart</option><option value="pause">Pause</option></select>
              </div>

              <div className="flex items-center gap-2">
                <button type="button" onClick={handleExportCsv} disabled={filteredHistory.length === 0} className="px-4 py-2 bg-emerald-500 text-white rounded-lg text-sm font-semibold hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"><Download className="h-4 w-4" /> Exporter CSV</button>
                <div className="inline-flex items-center rounded-full bg-blue-100 text-blue-700 px-3 py-1.5 text-xs font-semibold"><Clock3 size={13} className="mr-1" /> {filteredHistory.length} entree(s)</div>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200"><tr><th className="px-4 py-3 text-left font-medium text-slate-500">Date</th><th className="px-4 py-3 text-left font-medium text-slate-500">Nom complet</th><th className="px-4 py-3 text-left font-medium text-slate-500">Matricule</th><th className="px-4 py-3 text-left font-medium text-slate-500">Badge</th><th className="px-4 py-3 text-left font-medium text-slate-500">Type</th><th className="px-4 py-3 text-left font-medium text-slate-500">Heure</th><th className="px-4 py-3 text-left font-medium text-slate-500">Statut</th><th className="px-4 py-3 text-left font-medium text-slate-500">Source</th><th className="px-4 py-3 text-left font-medium text-slate-500">Justification</th></tr></thead>
              <tbody>
                {historyLoading ? (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-500">Chargement...</td></tr>
                ) : historyError ? (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-red-600">{historyError}</td></tr>
                ) : filteredHistory.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-500">{searchQuery || statusFilter || actionFilter ? 'Aucun scan trouve avec les filtres appliques.' : 'Aucun scan enregistre sur cette periode.'}</td></tr>
                ) : (
                  filteredHistory.map((entry) => {
                    const status = statusDisplay(entry)
                    const heureAffichee = formatHistoryHourLabel(entry)
                    return (
                      <tr key={entry.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3 text-slate-700 font-medium">{entry.dateLabel || formatDateOnly(entry.at)}</td>
                        <td className="px-4 py-3 text-slate-900 font-medium">{entry.userName}</td>
                        <td className="px-4 py-3 text-slate-700"><span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-slate-100 text-slate-800 border border-slate-200">{entry.userMatricule}</span></td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-600"><span className="inline-flex items-center px-2 py-1 rounded-md bg-slate-100 text-slate-800 border border-slate-200 max-w-40 truncate">{entry.tokenPreview}</span></td>
                        <td className="px-4 py-3 text-blue-700 font-medium">{entry.pointageLabel}</td>
                        <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{heureAffichee}</td>
                        <td className="px-4 py-3"><span className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium border ${status.className}`}><status.Icon className="h-3 w-3 mr-1" />{status.text}</span></td>
                        <td className="px-4 py-3"><span className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium border ${sourceClassFromText(entry.sourceText)}`}>{entry.sourceText}</span></td>
                        <td className="px-4 py-3 text-slate-700 max-w-xs"><span className="line-clamp-2">{entry.justification}</span></td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {actionDecision ? (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="w-full max-w-md bg-white rounded-xl shadow-2xl border border-slate-200 p-6 space-y-4 transform transition-all duration-300 scale-100 opacity-100">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                <div className="flex items-center justify-center w-10 h-10 bg-amber-100 rounded-full">
                  <AlertTriangle className="w-5 h-5 text-amber-600" />
                </div>
                Action requise
              </h3>
              <button
                onClick={() => setActionDecision(null)}
                className="text-slate-400 hover:text-slate-600 transition-colors p-1 rounded-lg hover:bg-slate-100"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>
            
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <p className="text-amber-800 font-medium mb-4">{actionDecision.message}</p>
              <p className="text-sm text-amber-700 mb-4">Choisissez l'action a effectuer pour ce pointage :</p>
            </div>
            
            <div className="flex flex-col sm:flex-row gap-3">
              {actionDecision.availableActions.includes('pause') && (
                <button
                  onClick={() => handleActionDecision('pause')}
                  className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
                >
                  <Clock3 className="w-4 h-4" />
                  Aller en pause
                </button>
              )}
              {actionDecision.availableActions.includes('depart_anticipe') && (
                <button
                  onClick={() => handleActionDecision('depart_anticipe')}
                  className="flex-1 px-4 py-3 bg-orange-600 text-white rounded-lg font-medium hover:bg-orange-700 transition-colors flex items-center justify-center gap-2"
                >
                  <Clock3 className="w-4 h-4" />
                  Depart anticipe
                </button>
              )}
              <button
                onClick={() => setActionDecision(null)}
                className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg font-medium hover:bg-slate-50 transition-colors"
              >
                Annuler
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {justificationDecision ? (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="w-full max-w-md bg-white rounded-xl shadow-2xl border border-slate-200 p-6 space-y-4 transform transition-all duration-300 scale-100 opacity-100">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                <div className="flex items-center justify-center w-10 h-10 bg-yellow-100 rounded-full">
                  <FileText className="w-5 h-5 text-yellow-600" />
                </div>
                {justificationDecision.message.includes('obligatoire') ? 'Justification requise' : 'Justification optionnelle'}
              </h3>
              <button
                onClick={() => setJustificationDecision(null)}
                className="text-slate-400 hover:text-slate-600 transition-colors p-1 rounded-lg hover:bg-slate-100"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>
            
            <div className={`${justificationDecision.message.includes('obligatoire') ? 'bg-red-50 border-red-200' : 'bg-yellow-50 border-yellow-200'} border rounded-lg p-4`}>
              <p className={`${justificationDecision.message.includes('obligatoire') ? 'text-red-800' : 'text-yellow-800'} font-medium mb-4`}>{justificationDecision.message}</p>
              <div className="bg-white rounded-lg p-3 border border-red-200">
                <p className="text-sm text-red-700 font-medium mb-2">
                  Motif: <span className="inline-flex items-center px-2 py-1 bg-red-100 text-red-800 rounded-md text-xs">{getJustificationReasonLabel(justificationDecision.reason)}</span>
                </p>
                <p className="text-xs text-slate-500 mb-3">Minimum {justificationDecision.minLength} caracteres.</p>
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Votre justification</label>
              <textarea 
                value={justificationDecision.value} 
                onChange={(event) => handleJustificationDecisionChange(event.target.value)} 
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none" 
                rows={4} 
                placeholder="Expliquez la raison..." 
              />
              {justificationDecision.error ? (
                <div className="mt-2 flex items-center gap-2 text-red-600">
                  <AlertTriangle className="w-4 h-4" />
                  <span className="text-sm">{justificationDecision.error}</span>
                </div>
              ) : null}
            </div>
            
            <div className="flex gap-2">
              {!justificationDecision.message.includes('obligatoire') && (
                <button 
                  onClick={handleJustificationDecisionClose} 
                  className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors" 
                >
                  Continuer sans justification
                </button>
              )}
              <button 
                onClick={handleJustificationDecisionClose} 
                className={`${justificationDecision.message.includes('obligatoire') ? 'flex-1' : ''} px-4 py-2 border border-slate-300 text-slate-700 rounded-lg font-medium hover:bg-slate-50 transition-colors`} 
              >
                {justificationDecision.message.includes('obligatoire') ? 'Annuler' : 'Plus tard'}
              </button>
              <button 
                onClick={handleJustificationDecisionSubmit} 
                disabled={submitting} 
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Validation...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    Valider
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
