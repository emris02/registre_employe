import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiClient } from '../../services/apiClient'
import { useAuth } from '../../services/authService'

interface RetardEntry {
  id: number
  employe_id: number
  prenom: string
  nom: string
  departement: string
  date_heure: string
  retard_minutes: number
  statut: 'en_attente' | 'approuve' | 'rejete' | string
  retard_raison?: string
  est_justifie?: boolean
  created_at?: string
}

const EMPLOYEE_ALLOWED_ROLES = new Set(['employe', 'chef_departement', 'stagiaire'])
const toDateInput = (date: Date) => date.toISOString().slice(0, 10)

const formatDateTime = (value: string) => {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString('fr-FR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

const normalizeStatus = (value?: string) => {
  const normalized = String(value || '').toLowerCase().trim()
  if (normalized === 'approuve' || normalized === 'approuvee') return 'approuve'
  if (normalized === 'rejete' || normalized === 'rejetee') return 'rejete'
  return 'en_attente'
}

const statusLabel = (value?: string) => {
  const normalized = normalizeStatus(value)
  if (normalized === 'approuve') return 'Justifie'
  if (normalized === 'rejete') return 'Rejete'
  return 'En attente'
}

const statusClass = (value?: string) => {
  const normalized = normalizeStatus(value)
  if (normalized === 'approuve') return 'is-success'
  if (normalized === 'rejete') return 'is-danger'
  return 'is-warning'
}

const RetardsPage: React.FC = () => {
  const { user, logout, isLoading: authLoading } = useAuth()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [dateFilter, setDateFilter] = useState(() => toDateInput(new Date()))
  const [statusFilter, setStatusFilter] = useState<'all' | 'en_attente' | 'approuve' | 'rejete'>('all')
  const [retards, setRetards] = useState<RetardEntry[]>([])
  const [allRetards, setAllRetards] = useState<RetardEntry[]>([]) // Tous les retards pour les 5 derniers

  const isUnauthorizedError = useCallback((loadError: any) => {
    const status = Number(loadError?.status || 0)
    if (status === 401 || status === 403) return true
    const message = String(loadError?.message || '').toLowerCase()
    return message.includes('401') || message.includes('403') || message.includes('token')
  }, [])

  const loadRetards = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      
      // Charger les 5 derniers retards (sans filtre)
      const recentQuery = new URLSearchParams({
        page_retard: '1',
        per_page: '5',
        sort: 'date_heure',
        order: 'desc'
      })
      const recentResponse = await apiClient.get<{ success: boolean; retards?: RetardEntry[] }>(`/api/get_retards?${recentQuery.toString()}`)
      const recentRetards = Array.isArray(recentResponse.retards) ? recentResponse.retards : []
      
      // Charger les retards filtrés par date/statut si nécessaire
      let allFilteredRetards = recentRetards
      if (dateFilter || statusFilter !== 'all') {
        const query = new URLSearchParams({
          page_retard: '1',
          per_page: '100',
          ...(dateFilter && { date_retard: dateFilter }),
          ...(statusFilter !== 'all' && { statut: statusFilter })
        })
        const response = await apiClient.get<{ success: boolean; retards?: RetardEntry[] }>(`/api/get_retards?${query.toString()}`)
        allFilteredRetards = Array.isArray(response.retards) ? response.retards : []
      }
      
      setAllRetards(recentRetards)
      setRetards(allFilteredRetards)
    } catch (loadError: any) {
      console.error('Erreur chargement retards employe:', loadError)
      if (isUnauthorizedError(loadError)) {
        logout()
        navigate('/login', { replace: true })
        return
      }
      setError(loadError?.message || 'Impossible de charger vos retards.')
      setAllRetards([])
      setRetards([])
    } finally {
      setLoading(false)
    }
  }, [dateFilter, statusFilter, isUnauthorizedError, logout, navigate])

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
    void loadRetards()
  }, [authLoading, loadRetards, navigate, user])

  // Filtrer les retards par statut
  const filteredRetards = useMemo(() => {
    // Commencer par les 5 derniers retards
    let baseRetards = allRetards.slice(0, 5)
    
    // Si des filtres sont appliqués, ajouter les résultats filtrés
    if (dateFilter || statusFilter !== 'all') {
      // Éviter les doublons avec les 5 premiers
      const existingIds = new Set(baseRetards.map(r => r.id))
      const additionalRetards = retards.filter(r => !existingIds.has(r.id))
      
      // Appliquer les filtres sur les retards additionnels
      const filteredAdditional = additionalRetards.filter(entry => {
        const matchesStatus = statusFilter === 'all' || normalizeStatus(entry.statut) === statusFilter
        const matchesDate = !dateFilter || entry.date_heure.startsWith(dateFilter)
        return matchesStatus && matchesDate
      })
      
      baseRetards = [...baseRetards, ...filteredAdditional]
    }
    
    return baseRetards
  }, [allRetards, retards, dateFilter, statusFilter])

  // 5 derniers retards (toujours affichés)
  const lastFiveRetards = useMemo(() => {
    return allRetards.slice(0, 5)
  }, [allRetards])

  const handleJustification = async (entry: RetardEntry) => {
    // Vérifier si le retard est déjà justifié
    const status = normalizeStatus(entry.statut)
    if (status === 'approuve') {
      setError('Ce retard est déjà justifié et ne peut plus être modifié.')
      return
    }
    
    // Vérifier si le retard est déjà enregistré (pas un retard en temps réel)
    const now = new Date()
    const retardDate = new Date(entry.date_heure)
    const timeDiff = now.getTime() - retardDate.getTime()
    
    // Si le retard date de plus de 5 minutes, il ne peut pas être justifié
    if (timeDiff > 5 * 60 * 1000) { // 5 minutes
      setError('Ce retard est déjà enregistré et ne peut plus être justifié. La justification doit se faire lors du pointage.')
      return
    }
    
    try {
      const raison = window.prompt('Raison du retard (obligatoire) :', entry.retard_raison || '')
      if (!raison || !raison.trim()) return

      const details = window.prompt('Details complementaires (optionnel) :', '')

      setSaving(entry.id)
      setError(null)
      setInfo(null)

      const response = await apiClient.post<
        { raison: string; details?: string },
        { success: boolean; message?: string }
      >(`/api/retards/${entry.id}/justifier`, {
        raison: raison.trim(),
        details: String(details || '').trim()
      })

      if (!response?.success) {
        throw new Error(response?.message || 'Justification impossible')
      }

      setInfo(response.message || 'Justification enregistree.')
      await loadRetards()
    } catch (saveError: any) {
      console.error('Erreur justification retard:', saveError)
      setError(saveError?.message || 'Erreur lors de la justification.')
    } finally {
      setSaving(null)
    }
  }

  const stats = useMemo(() => {
    return filteredRetards.reduce(
      (acc, entry) => {
        acc.total += 1
        const status = normalizeStatus(entry.statut)
        if (status === 'approuve') acc.justifies += 1
        if (status === 'en_attente') acc.pending += 1
        acc.minutes += Number(entry.retard_minutes || 0)
        return acc
      },
      { total: 0, justifies: 0, pending: 0, minutes: 0 }
    )
  }, [filteredRetards])

  return (
    <div className="space-y-6">
      {/* Section des 5 derniers retards - intégrée dans la liste principale */}
      <section className="php-card">
        <div className="php-card-header">
          <h2 className="php-card-title">Mes retards récents</h2>
          <div className="flex gap-2">
            <input
              type="date"
              value={dateFilter}
              onChange={(event) => setDateFilter(event.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as any)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              <option value="all">Tous les statuts</option>
              <option value="en_attente">En attente</option>
              <option value="approuve">Justifiés</option>
              <option value="rejete">Rejetés</option>
            </select>
            <button
              onClick={() => void loadRetards()}
              className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700"
            >
              Actualiser
            </button>
          </div>
        </div>
        <div className="php-card-body">
          {loading ? <span className="php-pill is-warning">Chargement des retards...</span> : null}
          {error ? <span className="php-pill is-danger">{error}</span> : null}
          {info ? <span className="php-pill is-success">{info}</span> : null}
        </div>
      </section>

      {/* Statistiques */}
      <section className="php-kpi-grid">
        <article className="php-kpi-card">
          <small>Nombre de retards</small>
          <strong>{stats.total}</strong>
        </article>
        <article className="php-kpi-card">
          <small>Minutes cumulees</small>
          <strong>{stats.minutes} min</strong>
        </article>
        <article className="php-kpi-card">
          <small>Justifies</small>
          <strong>{stats.justifies}</strong>
        </article>
        <article className="php-kpi-card">
          <small>En attente</small>
          <strong>{stats.pending}</strong>
        </article>
      </section>

      {/* Liste des retards - commence par les 5 plus récents */}
      <section className="php-card">
        <div className="php-card-header">
          <h2 className="php-card-title">Liste des retards ({filteredRetards.length})</h2>
          <div className="text-sm text-gray-500">
            {dateFilter ? `Filtré par date: ${new Date(dateFilter).toLocaleDateString('fr-FR')}` : 'Toutes les dates'}
          </div>
        </div>
        <div className="php-card-body php-table-wrap">
          <table className="php-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Retard</th>
                <th>Statut</th>
                <th>Raison</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredRetards.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    {dateFilter ? 'Aucun retard détecté pour cette date.' : 'Aucun retard détecté.'}
                  </td>
                </tr>
              ) : (
                filteredRetards.map((entry) => (
                  <tr key={entry.id}>
                    <td>{formatDateTime(entry.date_heure)}</td>
                    <td>{Number(entry.retard_minutes || 0)} min</td>
                    <td>
                      <span className={`php-pill ${statusClass(entry.statut)}`}>{statusLabel(entry.statut)}</span>
                    </td>
                    <td>{entry.retard_raison || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

export default RetardsPage
