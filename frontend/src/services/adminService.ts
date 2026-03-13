import { apiClient } from './apiClient'

// ============================================
// TYPES ADMIN SERVICE
// ============================================

export interface AdminStats {
  total_employes: number
  presents: number
  absents: number
  retards: number
  total_heures_jour: number
  taux_presence: number
}

export interface PointageEntry {
  id: number
  employe_id?: number
  admin_id?: number
  user_type?: 'employe' | 'admin'
  matricule?: string
  prenom: string
  nom: string
  role?: string
  departement: string
  date: string
  date_heure?: string
  type?: string
  arrivee: string | null
  depart: string | null
  source?: string
  commentaire?: string | null
  photo?: string
  retard_minutes?: number
  statut?: 'normal' | 'retard' | 'absent'
}

export interface TempsTotal {
  id: number
  prenom: string
  nom: string
  email: string
  departement: string
  total_travail: string
  photo?: string
  heures_sup?: number
}

export interface Demande {
  id: number
  employe_id?: number | null
  prenom: string
  nom: string
  poste: string
  departement: string
  email?: string
  matricule?: string
  type: string
  date_demande: string
  date_debut?: string
  date_fin?: string
  motif?: string
  statut: "en_attente" | "approuve" | "rejete"
  commentaire?: string
  traite_par?: number | null
  traite_par_nom?: string | null
  traite_par_role?: string | null
  date_traitement?: string | null
  heures_ecoulees?: number
  photo?: string
  urgent?: boolean
}


export interface AdminNotification {
  id: string
  db_id?: number | null
  type: 'pointage' | 'retard' | 'absence' | 'demande' | 'badge' | 'evenement'
  level?: 'info' | 'warning' | 'danger' | string
  title: string
  message: string
  created_at: string
  entity_id?: number
  entity_kind?: string
  employe_id?: number | null
  read?: boolean
  lue?: boolean
  date_lecture?: string | null
}

export interface AdminNotificationSummary {
  items: AdminNotification[]
  counts: {
    pointage: number
    retard: number
    absence: number
    demande: number
    badge: number
  }
  date?: string
  unread_count?: number
}
export interface DemandeStats {
  total: number
  en_attente: number
  approuve: number
  rejete: number
  en_retard: number
}

export interface Employe {
  id: number
  matricule?: string
  prenom: string
  nom: string
  email: string
  role?: string
  telephone?: string
  poste: string
  departement: string
  statut: string
  date_embauche?: string
  contrat_type?: string
  contrat_duree?: string
  contrat_pdf_url?: string
  salaire?: number
  adresse?: string
  photo?: string
  manager_id?: number
  taux_horaire?: number
}

export interface Admin {
  id: number
  prenom: string
  nom: string
  email: string
  telephone?: string
  role: string
  adresse?: string
  last_activity?: string
  status?: string
  photo?: string
  is_super_admin?: boolean
  permissions?: string[]
}

export interface Retard {
  id: number
  employe_id: number
  prenom: string
  nom: string
  departement: string
  date_heure: string
  retard_minutes: number
  statut?: string
  retard_raison?: string
  est_justifie?: boolean
  created_at?: string
}

export interface ApiResponse<T> {
  success: boolean
  data?: T
  message?: string
  total?: number
  total_pages?: number
  current_page?: number
}

export interface PaginatedResponse<T> {
  success: boolean
  items: T[]
  total: number
  total_pages: number
  current_page: number
  per_page: number
}

// ============================================
// ADMIN SERVICE CLASS
// ============================================

class AdminService {
  private baseUrl = '/api/admin'

  private isUnauthorized(error: any): boolean {
    const status = Number(error?.status || 0)
    if (status === 401 || status === 403) return true
    const message = String(error?.message || '').toLowerCase()
    return message.includes('401') || message.includes('403') || message.includes('token')
  }

  // ============================================
  // STATISTIQUES
  // ============================================

  async getStats(): Promise<AdminStats> {
    try {
      const response = await apiClient.get<any>('get_pointage_admin_day')
      const source = response?.data && typeof response.data === 'object' ? response.data : response

      const totalEmployes = Number(source?.total_employes || 0)
      const presents = Number(source?.presents || 0)
      const absents = Number(source?.absents || Math.max(0, totalEmployes - presents))
      const retards = Number(source?.retards || 0)
      const totalHeuresJour = Number(source?.total_heures_jour || 0)
      const tauxPresence = Number(
        source?.taux_presence !== undefined
          ? source.taux_presence
          : totalEmployes > 0
            ? (presents / totalEmployes) * 100
            : 0
      )

      return {
        total_employes: totalEmployes,
        presents,
        absents,
        retards,
        total_heures_jour: totalHeuresJour,
        taux_presence: tauxPresence
      }
    } catch (error) {
      if (this.isUnauthorized(error)) {
        throw error
      }
      console.error('Erreur lors de la rï¿½cupï¿½ration des statistiques:', error)
      return {
        total_employes: 0,
        presents: 0,
        absents: 0,
        retards: 0,
        total_heures_jour: 0,
        taux_presence: 0
      }
    }
  }

  async getTodayStats(): Promise<AdminStats> {
    try {
      return await this.getStats()
    } catch (error) {
      console.error('Erreur lors de la rï¿½cupï¿½ration des statistiques du jour:', error)
      throw error
    }
  }

  // ============================================
  // POINTAGES
  // ============================================

  async getPointages(params: {
    page?: number
    per_page?: number
    date?: string
    date_debut?: string
    date_fin?: string
    departement?: string
    search?: string
    employe_id?: number | string
    type?: string
    statut?: string
  } = {}): Promise<PaginatedResponse<PointageEntry>> {
    try {
      const searchParams = new URLSearchParams()

      if (params.page) searchParams.append('page_pointage', params.page.toString())
      if (params.per_page) searchParams.append('per_page', params.per_page.toString())
      if (params.date) searchParams.append('date', params.date)
      if (params.date_debut) searchParams.append('date_debut', params.date_debut)
      if (params.date_fin) searchParams.append('date_fin', params.date_fin)
      if (params.departement) searchParams.append('departement', params.departement)
      if (params.search) searchParams.append('search', params.search)
      if (params.employe_id !== undefined && params.employe_id !== null && String(params.employe_id).trim() !== '') {
        searchParams.append('employe_id', String(params.employe_id))
      }
      if (params.type) searchParams.append('type', params.type)
      if (params.statut) searchParams.append('statut', params.statut)

      const response = await apiClient.get<any>(`/api/get_pointages?${searchParams.toString()}`)
      const source = response?.data && typeof response.data === 'object' ? response.data : response

      const items = Array.isArray(source?.items)
        ? source.items
        : Array.isArray(source?.pointages)
          ? source.pointages
          : []

      const normalizeType = (value: unknown) => {
        const raw = String(value ?? '').trim().toLowerCase()
        if (raw.includes('arrivee')) return 'arrivee'
        if (raw.includes('depart')) return 'depart'
        if (raw.includes('pause')) return 'pause'
        return raw
      }

      const normalizeStatut = (rawStatut: unknown, retardMinutes: number) => {
        const raw = String(rawStatut ?? '').trim().toLowerCase()
        if (retardMinutes > 0 || raw.includes('retard')) return 'retard'
        if (raw.includes('abs')) return 'absent'
        return 'normal'
      }

      const normalizedItems: PointageEntry[] = items.map((raw: any, index: number) => {
        const id = Number(raw?.id || index + 1)
        const type = normalizeType(raw?.type)
        const dateHeureRaw = String(raw?.date_heure || '').trim()
        const dateHeure = dateHeureRaw || String(raw?.date || '')
        const parsedDate = dateHeure ? new Date(dateHeure.includes('T') ? dateHeure : `${dateHeure}T00:00:00`) : null
        const heure = parsedDate && !Number.isNaN(parsedDate.getTime())
          ? `${String(parsedDate.getHours()).padStart(2, '0')}:${String(parsedDate.getMinutes()).padStart(2, '0')}`
          : ''
        const retardMinutes = Number(raw?.retard_minutes ?? raw?.retardMinutes ?? 0) || 0

        const arrivee = String(raw?.arrivee ?? '').trim() || (type === 'arrivee' ? heure : null)
        const depart = String(raw?.depart ?? '').trim() || (type === 'depart' ? heure : null)

        return {
          id: Number.isInteger(id) && id > 0 ? id : index + 1,
          employe_id: Number(raw?.employe_id ?? raw?.employeId ?? 0) || undefined,
          admin_id: Number(raw?.admin_id ?? raw?.adminId ?? 0) || undefined,
          user_type: String(raw?.user_type ?? '').trim() as 'employe' | 'admin' || undefined,
          matricule: String(raw?.matricule ?? '').trim() || undefined,
          prenom: String(raw?.prenom ?? '').trim(),
          nom: String(raw?.nom ?? '').trim(),
          role: String(raw?.role ?? '').trim() || undefined,
          departement: String(raw?.departement ?? '').trim(),
          date: String(raw?.date ?? '').trim()
            || (parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString().slice(0, 10) : ''),
          date_heure: dateHeureRaw || undefined,
          type: type || undefined,
          arrivee,
          depart,
          source: String(raw?.source ?? '').trim() || undefined,
          commentaire: String(raw?.commentaire ?? '').trim() || null,
          photo: String(raw?.photo ?? '').trim() || undefined,
          retard_minutes: retardMinutes,
          statut: normalizeStatut(raw?.statut, retardMinutes)
        }
      })

      // Si une ligne "depart" ne porte pas son retard, reutiliser le retard de l'arrivee du meme employe/jour.
      const retardByEmployeDay = new Map<string, number>()
      normalizedItems.forEach((entry) => {
        const key = `${Number(entry.employe_id || 0)}-${String(entry.date || '')}`
        if (!key || !entry.type || entry.type !== 'arrivee') return
        const current = Number(retardByEmployeDay.get(key) || 0)
        const next = Number(entry.retard_minutes || 0)
        if (next > current) {
          retardByEmployeDay.set(key, next)
        }
      })

      const normalizedWithRetard: PointageEntry[] = normalizedItems.map((entry) => {
        const currentRetard = Number(entry.retard_minutes || 0)
        if (currentRetard > 0) return entry
        const key = `${Number(entry.employe_id || 0)}-${String(entry.date || '')}`
        const fallbackRetard = Number(retardByEmployeDay.get(key) || 0)
        if (fallbackRetard <= 0) return entry
        return {
          ...entry,
          retard_minutes: fallbackRetard,
          statut: 'retard'
        }
      })

      const total = Number(source?.total || items.length || 0)
      const perPage = Number(source?.per_page || params.per_page || 10)
      const currentPage = Number(source?.current_page || params.page || 1)
      const totalPages = Number(source?.total_pages || Math.max(1, Math.ceil(total / Math.max(1, perPage))))

      return {
        success: true,
        items: normalizedWithRetard,
        total,
        total_pages: totalPages,
        current_page: currentPage,
        per_page: perPage
      }
    } catch (error) {
      console.error('Erreur lors de la rï¿½cupï¿½ration des pointages:', error)
      throw error
    }
  }

  async exportPointages(params: {
    format: 'pdf' | 'excel'
    date_debut?: string
    date_fin?: string
    departement?: string
  }): Promise<Blob> {
    try {
      const searchParams = new URLSearchParams()
      searchParams.append('format', params.format)
      if (params.date_debut) searchParams.append('date_debut', params.date_debut)
      if (params.date_fin) searchParams.append('date_fin', params.date_fin)
      if (params.departement) searchParams.append('departement', params.departement)

      const response = await fetch(`${this.baseUrl}/pointages/export?${searchParams.toString()}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
      })

      if (!response.ok) {
        throw new Error('Erreur lors de l\'exportation')
      }

      return response.blob()
    } catch (error) {
      console.error('Erreur lors de l\'exportation des pointages:', error)
      throw error
    }
  }

  // ============================================
  // TEMPS TRAVAILLÃ‰S
  // ============================================

  async getTempsTotaux(params: {
    page?: number
    per_page?: number
    month?: string
    year?: string
    departement?: string
  } = {}): Promise<PaginatedResponse<TempsTotal>> {
    try {
      const searchParams = new URLSearchParams()
      
      if (params.page) searchParams.append('page_heures', params.page.toString())
      if (params.per_page) searchParams.append('per_page', params.per_page.toString())
      if (params.month) searchParams.append('month', params.month)
      if (params.year) searchParams.append('year', params.year)
      if (params.departement) searchParams.append('departement', params.departement)

      const response = await apiClient.get<PaginatedResponse<TempsTotal>>(
        `get_temps_totaux?${searchParams.toString()}`
      )
      
      return response
    } catch (error) {
      console.error('Erreur lors de la rÃ©cupÃ©ration des temps totaux:', error)
      throw error
    }
  }

  // ============================================
  // DEMANDES
  // ============================================

  async getDemandes(params: {
    page?: number
    per_page?: number
    statut?: string
    type?: string
    departement?: string
    urgent?: boolean
  } = {}): Promise<PaginatedResponse<Demande>> {
    try {
      const searchParams = new URLSearchParams()

      if (params.page) searchParams.append('page_demandes', params.page.toString())
      if (params.per_page) searchParams.append('per_page', params.per_page.toString())
      if (params.statut) searchParams.append('statut', params.statut)
      if (params.type) searchParams.append('type', params.type)
      if (params.departement) searchParams.append('departement', params.departement)
      if (params.urgent !== undefined) searchParams.append('urgent', params.urgent.toString())

      const response = await apiClient.get<any>(`get_demandes?${searchParams.toString()}`)
      const source = response?.data && typeof response.data === 'object' ? response.data : response

      const rawItems = Array.isArray(source?.items)
        ? source.items
        : Array.isArray(source?.demandes)
          ? source.demandes
          : []

      const isUsableValue = (value: unknown) => {
        const raw = String(value ?? '').trim()
        if (!raw) return false
        const lower = raw.toLowerCase()
        return lower !== '-' && lower !== 'null' && lower !== 'undefined' && lower !== 'n/a'
      }

      const normalizeDateValue = (value: unknown): string | undefined => {
        const raw = String(value ?? '').trim()
        if (!isUsableValue(raw)) return undefined

        if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
          return raw
        }

        const frenchDate = raw.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/)
        if (frenchDate) {
          const day = Number(frenchDate[1])
          const month = Number(frenchDate[2])
          const year = Number(frenchDate[3])
          const candidate = new Date(year, month - 1, day)
          if (
            !Number.isNaN(candidate.getTime())
            && candidate.getFullYear() === year
            && candidate.getMonth() + 1 === month
            && candidate.getDate() === day
          ) {
            return candidate.toISOString().slice(0, 10)
          }
        }

        const parsed = new Date(raw)
        if (Number.isNaN(parsed.getTime())) return undefined
        return parsed.toISOString().slice(0, 10)
      }

      const normalizeStatut = (value: unknown): Demande['statut'] => {
        const raw = String(value ?? '').trim().toLowerCase()
        if (raw.includes('approuv')) return 'approuve'
        if (raw.includes('rejet') || raw.includes('refus')) return 'rejete'
        return 'en_attente'
      }

      const items: Demande[] = rawItems
        .map((raw: any) => {
          const employeId = Number(raw?.employe_id ?? raw?.employeId ?? raw?.user_id ?? 0) || null
          const prenom = String(raw?.prenom ?? raw?.employe?.prenom ?? raw?.first_name ?? '').trim()
          const nom = String(raw?.nom ?? raw?.employe?.nom ?? raw?.last_name ?? '').trim()
          const dateDemande = String(raw?.date_demande || raw?.dateDemande || raw?.created_at || raw?.createdAt || '').trim()
          const fallbackDate = normalizeDateValue(dateDemande) || new Date().toISOString().slice(0, 10)
          const periodeRaw = String(raw?.periode ?? raw?.period ?? '').trim()
          const periodeTokens = periodeRaw
            ? periodeRaw
              .split(/\s*-\s*|\s+au\s+/i)
              .map((entry) => normalizeDateValue(entry))
              .filter((entry): entry is string => Boolean(entry))
            : []

          const periodStart = periodeTokens[0]
          const periodEnd = periodeTokens[1] || periodStart

          const dateDebut = normalizeDateValue(
            raw?.date_debut
            ?? raw?.dateDebut
            ?? raw?.periode_debut
            ?? raw?.start_date
            ?? raw?.startDate
          ) || periodStart || fallbackDate
          const dateFin = normalizeDateValue(
            raw?.date_fin
            ?? raw?.dateFin
            ?? raw?.periode_fin
            ?? raw?.end_date
            ?? raw?.endDate
          ) || periodEnd || dateDebut

          const email = [
            raw?.email,
            raw?.employe_email,
            raw?.user_email,
            raw?.employe?.email,
            raw?.email_pro,
            raw?.emailPro,
            raw?.employe?.email_pro,
            raw?.employe?.emailPro
          ].map((value) => String(value ?? '').trim()).find(isUsableValue) || ''

          const matricule = [
            raw?.matricule,
            raw?.user_matricule,
            raw?.employe?.matricule,
            raw?.employe_matricule,
            employeId ? `EMP-${String(employeId).padStart(4, '0')}` : ''
          ].map((value) => String(value ?? '').trim()).find(isUsableValue) || ''

          const traiteParNom = String(raw?.traite_par_nom ?? raw?.traiteParNom ?? '').trim()
          const traiteParRole = String(raw?.traite_par_role ?? raw?.traiteParRole ?? '').trim()

          return {
            id: Number(raw?.id || 0),
            employe_id: employeId,
            prenom,
            nom,
            poste: String(raw?.poste ?? raw?.employe?.poste ?? raw?.job_title ?? '').trim(),
            departement: String(raw?.departement ?? raw?.employe?.departement ?? raw?.department ?? '').trim(),
            email,
            matricule,
            type: String(raw?.type ?? raw?.demande_type ?? '').trim(),
            date_demande: isUsableValue(dateDemande) ? dateDemande : new Date().toISOString(),
            date_debut: dateDebut,
            date_fin: dateFin,
            motif: String(raw?.motif ?? raw?.raison ?? '').trim(),
            statut: normalizeStatut(raw?.statut),
            commentaire: String(raw?.commentaire ?? raw?.comment ?? '').trim() || undefined,
            traite_par: Number(raw?.traite_par ?? raw?.traitePar ?? 0) || null,
            traite_par_nom: traiteParNom || null,
            traite_par_role: traiteParRole || null,
            date_traitement: String(raw?.date_traitement ?? raw?.dateTraitement ?? '').trim() || null,
            heures_ecoulees: Number(raw?.heures_ecoulees ?? raw?.elapsed_hours ?? 0) || undefined,
            photo: String(raw?.photo ?? raw?.employe?.photo ?? '').trim() || undefined,
            urgent: Boolean(raw?.urgent)
          } as Demande
        })
        .filter((item: Demande) => Number.isInteger(item.id) && item.id > 0)

      const total = Number(source?.total || items.length || 0)
      const perPage = Number(source?.per_page || params.per_page || 10)
      const currentPage = Number(source?.current_page || params.page || 1)
      const totalPages = Number(source?.total_pages || Math.max(1, Math.ceil(total / Math.max(1, perPage))))

      return {
        success: true,
        items,
        total,
        total_pages: totalPages,
        current_page: currentPage,
        per_page: perPage
      }
    } catch (error) {
      console.error('Erreur lors de la rÃ©cupÃ©ration des demandes:', error)
      throw error
    }
  }


  async getNotifications(params: { limit?: number; date?: string } = {}): Promise<AdminNotificationSummary> {
    try {
      const searchParams = new URLSearchParams()
      if (params.limit) searchParams.append('limit', String(params.limit))
      if (params.date) searchParams.append('date', params.date)
      const query = searchParams.toString()

      // Utiliser seulement l'endpoint qui existe dans le backend
      const endpoint = query ? `notifications?${query}` : 'notifications'

      const response = await apiClient.get<any>(endpoint)
      const source = response?.data && typeof response.data === 'object' ? response.data : response

      if (!source) {
        return {
          items: [],
          counts: { pointage: 0, retard: 0, absence: 0, demande: 0, badge: 0 },
          date: params.date
        }
      }

      const normalizeType = (value: unknown): AdminNotification['type'] => {
        const raw = String(value ?? '').trim().toLowerCase()
        if (raw.includes('retard')) return 'retard'
        if (raw.includes('absence')) return 'absence'
        if (raw.includes('demande')) return 'demande'
        if (raw.includes('badge')) return 'badge'
        if (raw.includes('event') || raw.includes('evenement') || raw.includes('calendrier')) return 'evenement'
        return 'pointage'
      }

      const normalizeLevel = (value: unknown, type: AdminNotification['type']): AdminNotification['level'] => {
        const raw = String(value ?? '').trim().toLowerCase()
        if (raw === 'danger' || raw === 'warning' || raw === 'info' || raw === 'success') {
          return raw
        }
        if (type === 'absence') return 'danger'
        if (type === 'retard' || type === 'demande') return 'warning'
        if (type === 'badge' || type === 'evenement') return 'info'
        return 'success'
      }

      const rawItems = Array.isArray(source?.items)
        ? source.items
        : Array.isArray(source?.notifications)
          ? source.notifications
          : []

      const items: AdminNotification[] = rawItems.map((raw: any, index: number) => {
        const type = normalizeType(raw?.type)
        const read = Boolean(raw?.lue ?? raw?.read ?? false)
        return {
          id: String(raw?.id ?? `notif-${index}`),
          db_id: Number(raw?.db_id ?? raw?.dbId ?? 0) || null,
          type,
          level: normalizeLevel(raw?.level, type),
          title: String(raw?.title ?? raw?.titre ?? 'Notification').trim(),
          message: String(raw?.message ?? raw?.contenu ?? '').trim(),
          created_at: String(raw?.created_at ?? raw?.date_creation ?? raw?.date ?? new Date().toISOString()),
          entity_id: Number(raw?.entity_id ?? raw?.pointage_id ?? raw?.demande_id ?? 0) || undefined,
          entity_kind: String(raw?.entity_kind ?? raw?.entityKind ?? type).trim(),
          employe_id: Number(raw?.employe_id ?? raw?.employeId ?? 0) || null,
          read,
          lue: read,
          date_lecture: String(raw?.date_lecture ?? raw?.dateLecture ?? '').trim() || null
        }
      })

      const computedCounts = items.reduce(
        (acc, item) => {
          if (item.type === 'pointage') acc.pointage += 1
          if (item.type === 'retard') acc.retard += 1
          if (item.type === 'absence') acc.absence += 1
          if (item.type === 'demande') acc.demande += 1
          if (item.type === 'badge') acc.badge += 1
          return acc
        },
        { pointage: 0, retard: 0, absence: 0, demande: 0, badge: 0 }
      )

      const counts = {
        pointage: Number(source?.counts?.pointage ?? computedCounts.pointage),
        retard: Number(source?.counts?.retard ?? computedCounts.retard),
        absence: Number(source?.counts?.absence ?? computedCounts.absence),
        demande: Number(source?.counts?.demande ?? computedCounts.demande),
        badge: Number(source?.counts?.badge ?? computedCounts.badge)
      }

      return {
        items,
        counts,
        date: source?.date,
        unread_count: Number(source?.unread_count ?? items.filter((item) => !item.read).length)
      }
    } catch (error) {
      if (this.isUnauthorized(error)) {
        throw error
      }
      console.error('Erreur lors de la récupération des notifications admin:', error)
      return {
        items: [],
        counts: { pointage: 0, retard: 0, absence: 0, demande: 0, badge: 0 },
        date: params.date
      }
    }
  }

  async deleteNotification(notificationId: string | number): Promise<boolean> {
    const raw = String(notificationId ?? '').trim()
    if (!raw) {
      throw new Error('Identifiant notification invalide')
    }

    const encoded = encodeURIComponent(raw)
    const candidates = [
      `admin/notifications/${encoded}`,
      `notifications/${encoded}`
    ]

    let lastError: any = null
    for (const endpoint of candidates) {
      try {
        const response = await apiClient.delete<ApiResponse<any>>(endpoint)
        if (response?.success !== false) {
          return true
        }
        lastError = new Error(response?.message || 'Suppression impossible')
      } catch (candidateError: any) {
        lastError = candidateError
        const status = Number(candidateError?.status || 0)
        if (status === 404 || status === 405 || status === 500 || status === 502 || status === 503 || status === 504) {
          continue
        }
        throw candidateError
      }
    }

    throw lastError || new Error('Suppression impossible')
  }

  async markNotificationAsRead(notificationId: string | number, read = true): Promise<boolean> {
    const raw = String(notificationId ?? '').trim()
    if (!raw) {
      throw new Error('Identifiant notification invalide')
    }

    const encoded = encodeURIComponent(raw)
    const payload = { read: Boolean(read) }
    const candidates = [
      `admin/notifications/${encoded}/read`,
      `notifications/${encoded}/read`
    ]

    let lastError: any = null
    for (const endpoint of candidates) {
      try {
        const response = await apiClient.put<typeof payload, ApiResponse<any>>(endpoint, payload)
        if (response?.success !== false) {
          return true
        }
        lastError = new Error(response?.message || 'Mise a jour impossible')
      } catch (candidateError: any) {
        lastError = candidateError
        const status = Number(candidateError?.status || 0)
        if (status === 404 || status === 405 || status === 500 || status === 502 || status === 503 || status === 504) {
          continue
        }
        throw candidateError
      }
    }

    throw lastError || new Error('Mise a jour impossible')
  }


  async getDemandeStats(): Promise<DemandeStats> {
    try {
      const response = await apiClient.get<ApiResponse<DemandeStats>>('demandes/stats')
      return response.data || {
        total: 0,
        en_attente: 0,
        approuve: 0,
        rejete: 0,
        en_retard: 0
      }
    } catch (error) {
      console.error('Erreur lors de la rÃ©cupÃ©ration des statistiques des demandes:', error)
      throw error
    }
  }

    async updateDemandeStatus(id: number, action: 'approuve' | 'rejete', motif?: string): Promise<boolean> {
    try {
      const commentaire = String(motif || '').trim()
      const candidates: Array<{ endpoint: string; payload: Record<string, unknown> }> = [
        {
          endpoint: 'traiter-demande',
          payload: { id, action, commentaire, motif: commentaire }
        },
        {
          endpoint: 'traiter-demande',
          payload: { demande_id: id, statut: action, commentaire, motif: commentaire }
        },
        {
          endpoint: `admin/demandes/${id}/traiter`,
          payload: { id, action, commentaire, motif: commentaire }
        },
        {
          endpoint: `admin/demandes/${id}/status`,
          payload: { statut: action, commentaire, motif: commentaire }
        }
      ]

      let lastError: any = null
      for (const candidate of candidates) {
        try {
          const response = await apiClient.post<Record<string, unknown>, ApiResponse<any>>(candidate.endpoint, candidate.payload)
          if (response?.success) {
            return true
          }
          lastError = new Error(response?.message || 'Impossible de traiter la demande.')
        } catch (candidateError: any) {
          lastError = candidateError
          const status = Number(candidateError?.status || 0)
          if (status === 401 || status === 403) {
            throw candidateError
          }
          if (status === 404 || status === 405 || status === 500) {
            continue
          }
          throw candidateError
        }
      }

      throw lastError || new Error('Impossible de traiter la demande.')
    } catch (error) {
      console.error('Erreur lors de la mise Ã  jour du statut de la demande:', error)
      throw error
    }
  }


  // ============================================
  // EMPLOYÃ‰S
  // ============================================

  async getEmployes(params: {
    page?: number
    per_page?: number
    search?: string
    departement?: string
    role?: string
    statut?: string
  } = {}): Promise<PaginatedResponse<Employe>> {
    try {
      const searchParams = new URLSearchParams()
      
      if (params.page) searchParams.append('page', params.page.toString())
      if (params.per_page) searchParams.append('per_page', params.per_page.toString())
      if (params.search) searchParams.append('search', params.search)
      if (params.departement) searchParams.append('departement', params.departement)
      if (params.role) searchParams.append('role', params.role)
      if (params.statut) searchParams.append('statut', params.statut)

      const query = searchParams.toString()
      const preferredUrl = query ? `admin/employes?${query}` : 'admin/employes'
      const fallbackUrl = query ? `get_employes?${query}` : 'get_employes'

      const normalizePaginated = (payload: any): PaginatedResponse<Employe> | null => {
        if (!payload || typeof payload !== 'object') {
          return null
        }

        const items = Array.isArray(payload.items)
          ? payload.items
          : Array.isArray(payload.employes)
            ? payload.employes
            : Array.isArray(payload.data)
              ? payload.data
              : null

        if (!items) {
          return null
        }

        const total = Number(payload.total ?? payload.count ?? items.length ?? 0)
        const perPage = Number(payload.per_page ?? payload.perPage ?? params.per_page ?? items.length ?? 10)
        const currentPage = Number(payload.current_page ?? payload.page ?? params.page ?? 1)
        const totalPages = Number(payload.total_pages ?? payload.last_page ?? Math.max(1, Math.ceil(total / Math.max(1, perPage))))

        return {
          success: true,
          items,
          total,
          total_pages: totalPages,
          current_page: currentPage,
          per_page: perPage
        }
      }

      try {
        const preferredResponse = await apiClient.get<any>(preferredUrl)
        const normalizedPreferred = normalizePaginated(preferredResponse)
        if (normalizedPreferred) {
          return normalizedPreferred
        }
      } catch (primaryError: any) {
        if (this.isUnauthorized(primaryError)) {
          throw primaryError
        }
        console.warn('Fallback getEmployes -> /api/get_employes', primaryError)
      }

      const fallbackResponse = await apiClient.get<any>(fallbackUrl)
      const normalizedFallback = normalizePaginated(fallbackResponse?.data || fallbackResponse)
      if (normalizedFallback) {
        return normalizedFallback
      }

      return {
        success: true,
        items: [],
        total: 0,
        total_pages: 1,
        current_page: Number(params.page || 1),
        per_page: Number(params.per_page || 10)
      }
    } catch (error) {
      console.error('Erreur lors de la rÃ©cupÃ©ration des employÃ©s:', error)
      throw error
    }
  }

  async createEmploye(employe: Omit<Employe, 'id'>): Promise<Employe> {
    try {
      const response = await apiClient.post<Omit<Employe, 'id'>, any>(
        'admin/employes',
        employe
      )
      if (response?.employe) return response.employe
      if (response?.id) return response as Employe
      if (response?.data) return response.data as Employe
      throw new Error(response?.message || 'Creation employe impossible')
    } catch (error) {
      console.error('Erreur lors de la crÃ©ation de l\'employÃ©:', error)
      throw error
    }
  }

  async updateEmploye(id: number, employe: Partial<Employe>): Promise<Employe> {
    try {
      const response = await apiClient.put<Partial<Employe>, any>(
        `admin/employes/${id}`,
        employe
      )
      if (response?.employe) return response.employe
      if (response?.id) return response as Employe
      if (response?.data) return response.data as Employe
      throw new Error(response?.message || 'Mise a jour employe impossible')
    } catch (error) {
      console.error('Erreur lors de la mise Ã  jour de l\'employÃ©:', error)
      throw error
    }
  }

  async deleteEmploye(id: number): Promise<boolean> {
    try {
      await apiClient.delete<any>(`admin/employes/${id}`)
      return true
    } catch (error) {
      console.error('Erreur lors de la suppression de l\'employÃ©:', error)
      throw error
    }
  }

  // ============================================
  // ADMINISTRATEURS
  // ============================================

  async getAdmins(): Promise<{ admins: Admin[]; is_super_admin: boolean }> {
    try {
      const response = await apiClient.get<ApiResponse<{ admins: Admin[]; is_super_admin: boolean }>>(
        'get_admins'
      )
      return response.data || { admins: [], is_super_admin: false }
    } catch (error) {
      console.error('Erreur lors de la rÃ©cupÃ©ration des administrateurs:', error)
      throw error
    }
  }

  async createAdmin(admin: Omit<Admin, 'id'>): Promise<Admin> {
    try {
      const response = await apiClient.post<Omit<Admin, 'id'>, ApiResponse<Admin>>(
        'admins',
        admin
      )
      return response.data!
    } catch (error) {
      console.error('Erreur lors de la crÃ©ation de l\'administrateur:', error)
      throw error
    }
  }

  async updateAdmin(id: number, admin: Partial<Admin>): Promise<Admin> {
    try {
      const response = await apiClient.put<{ id: number; data: Partial<Admin> }, ApiResponse<Admin>>(
        `admins/${id}`,
        { id, data: admin }
      )
      return response.data!
    } catch (error) {
      console.error('Erreur lors de la mise Ã  jour de l\'administrateur:', error)
      throw error
    }
  }

  // ============================================
  // RETARDS
  // ============================================

  async getRetards(params: {
    page?: number
    per_page?: number
    date?: string
    departement?: string
    justifie?: boolean
  } = {}): Promise<PaginatedResponse<Retard>> {
    try {
      const searchParams = new URLSearchParams()
      
      if (params.page) searchParams.append('page_retard', params.page.toString())
      if (params.per_page) searchParams.append('per_page', params.per_page.toString())
      if (params.date) searchParams.append('date_retard', params.date)
      if (params.departement) searchParams.append('dep_retard', params.departement)
      if (params.justifie !== undefined) searchParams.append('justifie', params.justifie.toString())

      const response = await apiClient.get<PaginatedResponse<Retard>>(
        `get_retards?${searchParams.toString()}`
      )
      
      return response
    } catch (error) {
      console.error('Erreur lors de la rÃ©cupÃ©ration des retards:', error)
      throw error
    }
  }

  async justifierRetard(id: number, raison: string): Promise<boolean> {
    try {
      const response = await apiClient.post<{ id: number; raison: string }, ApiResponse<any>>(
        'retards/justifier',
        { id, raison }
      )
      return response.success
    } catch (error) {
      console.error('Erreur lors de la justification du retard:', error)
      throw error
    }
  }

  // ============================================
  // DÃ‰PARTEMENTS
  // ============================================

  async getDepartements(): Promise<string[]> {
    try {
      const response = await apiClient.get<ApiResponse<string[]>>('get_departements')
      return response.data || []
    } catch (error) {
      console.error('Erreur lors de la rÃ©cupÃ©ration des dÃ©partements:', error)
      return []
    }
  }

  // ============================================
  // EXPORTS
  // ============================================

  async exportData(type: string, params: {
    format: 'pdf' | 'excel'
    date_debut?: string
    date_fin?: string
    departement?: string
  }): Promise<Blob> {
    try {
      const searchParams = new URLSearchParams()
      searchParams.append('format', params.format)
      if (params.date_debut) searchParams.append('date_debut', params.date_debut)
      if (params.date_fin) searchParams.append('date_fin', params.date_fin)
      if (params.departement) searchParams.append('departement', params.departement)

      const response = await fetch(`${this.baseUrl}/export/${type}?${searchParams.toString()}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
        },
      })

      if (!response.ok) {
        throw new Error('Erreur lors de l\'exportation')
      }

      return response.blob()
    } catch (error) {
      console.error('Erreur lors de l\'exportation:', error)
      throw error
    }
  }
}

// Export singleton instance
export const adminService = new AdminService()
export default adminService


