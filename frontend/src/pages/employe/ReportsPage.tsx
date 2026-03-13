import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiClient } from '../../services/apiClient'
import { useAuth } from '../../services/authService'

interface DashboardPointage {
  id: number
  date_heure: string
  type: 'arrivee' | 'depart'
  statut: 'normal' | 'retard' | 'absent'
}

interface DashboardDemande {
  id: number
  type: string
  date_debut: string
  date_fin: string
  motif: string
  statut: string
  created_at: string
}

interface DashboardStats {
  total_heures: number
  jours_travailles: number
  retards: number
  absences: number
  pointages_mois: number
}

interface DashboardResponse {
  success: boolean
  statistiques?: Partial<DashboardStats>
  demandes?: DashboardDemande[]
}

interface PeriodPointage {
  id: number
  type: string
  dateHeure: string
  retardMinutes?: number
  etat?: string
}

interface PointagePeriodResponse {
  success: boolean
  pointages?: PeriodPointage[]
}

const EMPLOYEE_ALLOWED_ROLES = new Set(['employe', 'chef_departement', 'stagiaire'])

const toDateInput = (date: Date) => date.toISOString().slice(0, 10)

const formatDateTime = (value: string) => {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString('fr-FR')
}

const ReportsPage: React.FC = () => {
  const { user, logout, isLoading: authLoading } = useAuth()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [fromDate, setFromDate] = useState(() => {
    const now = new Date()
    return toDateInput(new Date(now.getFullYear(), now.getMonth(), 1))
  })
  const [toDate, setToDate] = useState(() => toDateInput(new Date()))
  const [stats, setStats] = useState<DashboardStats>({
    total_heures: 0,
    jours_travailles: 0,
    retards: 0,
    absences: 0,
    pointages_mois: 0
  })
  const [pointages, setPointages] = useState<PeriodPointage[]>([])
  const [demandes, setDemandes] = useState<DashboardDemande[]>([])

  const isUnauthorizedError = useCallback((err: unknown) => {
    const payload = err as { status?: number; message?: string }
    const status = Number(payload?.status || 0)
    if (status === 401 || status === 403) return true
    const message = String(payload?.message || '').toLowerCase()
    return message.includes('401') || message.includes('403') || message.includes('token')
  }, [])

  const loadReports = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const startIso = new Date(`${fromDate}T00:00:00`).toISOString()
      const endIso = new Date(`${toDate}T23:59:59`).toISOString()

      const [dashboard, pointagePeriod] = await Promise.all([
        apiClient.get<DashboardResponse>('/api/employe/dashboard'),
        apiClient.get<PointagePeriodResponse>(
          `/api/pointages/period?start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}`
        )
      ])

      if (!dashboard?.success) {
        throw new Error('Reponse dashboard invalide')
      }

      setStats({
        total_heures: Number(dashboard.statistiques?.total_heures || 0),
        jours_travailles: Number(dashboard.statistiques?.jours_travailles || 0),
        retards: Number(dashboard.statistiques?.retards || 0),
        absences: Number(dashboard.statistiques?.absences || 0),
        pointages_mois: Number(dashboard.statistiques?.pointages_mois || 0)
      })
      setDemandes(Array.isArray(dashboard.demandes) ? dashboard.demandes : [])
      setPointages(Array.isArray(pointagePeriod.pointages) ? pointagePeriod.pointages : [])
    } catch (loadError: unknown) {
      console.error('Erreur rapports employe:', loadError)
      if (isUnauthorizedError(loadError)) {
        logout()
        navigate('/login', { replace: true })
        return
      }
      setError('Impossible de charger vos rapports.')
      setPointages([])
      setDemandes([])
    } finally {
      setLoading(false)
    }
  }, [fromDate, isUnauthorizedError, logout, navigate, toDate])

  useEffect(() => {
    if (authLoading) return
    if (!user) {
      navigate('/login', { replace: true })
      return
    }
    const role = String(user.role || '').toLowerCase()
    if (!EMPLOYEE_ALLOWED_ROLES.has(role)) {
      if (role === 'admin' || role === 'super_admin' || role === 'manager' || role === 'hr') {
        navigate('/admin', { replace: true })
      } else {
        navigate('/login', { replace: true })
      }
      return
    }
    void loadReports()
  }, [authLoading, loadReports, navigate, user])

  const pointageResume = useMemo(() => {
    let arrivees = 0
    let departs = 0
    let retards = 0
    for (const pointage of pointages) {
      if (String(pointage.type).toLowerCase() === 'arrivee') arrivees += 1
      if (String(pointage.type).toLowerCase() === 'depart') departs += 1
      if (Number(pointage.retardMinutes || 0) > 0 || String(pointage.etat || '').toLowerCase() === 'retard') retards += 1
    }
    return { arrivees, departs, retards }
  }, [pointages])

  const demandesPeriode = useMemo(() => {
    return demandes.filter((demande) => {
      const reference = new Date(demande.created_at || demande.date_debut)
      if (Number.isNaN(reference.getTime())) return false
      return reference >= new Date(`${fromDate}T00:00:00`) && reference <= new Date(`${toDate}T23:59:59`)
    })
  }, [demandes, fromDate, toDate])

  return (
    <div className="space-y-6">
      <section className="php-card">
        <div className="php-card-header">
          <h2 className="php-card-title">Mes rapports</h2>
          <div className="flex flex-wrap gap-2">
            <input
              type="date"
              value={fromDate}
              onChange={(event) => setFromDate(event.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
            <input
              type="date"
              value={toDate}
              onChange={(event) => setToDate(event.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
            <button
              onClick={() => void loadReports()}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700"
            >
              Actualiser
            </button>
          </div>
        </div>
        <div className="php-card-body">
          {error ? <span className="php-pill is-danger">{error}</span> : null}
          {loading ? <span className="php-pill is-warning">Chargement des rapports...</span> : null}
        </div>
      </section>

      <section className="php-stats-grid">
        <article className="php-stat-card is-primary">
          <p className="php-stat-value">{stats.total_heures}h</p>
          <p className="php-stat-label">Heures totales (mois)</p>
        </article>
        <article className="php-stat-card is-success">
          <p className="php-stat-value">{pointageResume.arrivees}</p>
          <p className="php-stat-label">Arrivees (periode)</p>
        </article>
        <article className="php-stat-card is-warning">
          <p className="php-stat-value">{pointageResume.departs}</p>
          <p className="php-stat-label">Departs (periode)</p>
        </article>
        <article className="php-stat-card is-danger">
          <p className="php-stat-value">{pointageResume.retards}</p>
          <p className="php-stat-label">Retards (periode)</p>
        </article>
      </section>

      <section className="php-grid-2">
        <article className="php-card">
          <div className="php-card-header">
            <h2 className="php-card-title">Pointages sur la periode</h2>
          </div>
          <div className="php-card-body php-table-wrap">
            <table className="php-table">
              <thead>
                <tr>
                  <th>Date/heure</th>
                  <th>Type</th>
                  <th>Retard</th>
                </tr>
              </thead>
              <tbody>
                {pointages.length === 0 ? (
                  <tr>
                    <td colSpan={3}>Aucun pointage sur la periode.</td>
                  </tr>
                ) : (
                  pointages.map((pointage) => (
                    <tr key={pointage.id}>
                      <td>{formatDateTime(pointage.dateHeure)}</td>
                      <td>{pointage.type}</td>
                      <td>{Number(pointage.retardMinutes || 0)} min</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </article>

        <article className="php-card">
          <div className="php-card-header">
            <h2 className="php-card-title">Demandes sur la periode</h2>
          </div>
          <div className="php-card-body php-list">
            {demandesPeriode.length === 0 ? (
              <div className="php-list-item">
                <div>
                  <strong>Aucune demande</strong>
                  <small>Aucune demande sur la periode selectionnee.</small>
                </div>
              </div>
            ) : (
              demandesPeriode.slice(0, 12).map((demande) => (
                <div key={demande.id} className="php-list-item">
                  <div>
                    <strong>{demande.type}</strong>
                    <small>{formatDateTime(demande.created_at || demande.date_debut)}</small>
                  </div>
                  <span
                    className={`php-pill ${
                      demande.statut === 'approuve' || demande.statut === 'approuvee'
                        ? 'is-success'
                        : demande.statut === 'rejete' || demande.statut === 'rejetee'
                          ? 'is-danger'
                          : 'is-warning'
                    }`}
                  >
                    {demande.statut}
                  </span>
                </div>
              ))
            )}
          </div>
        </article>
      </section>
    </div>
  )
}

export default ReportsPage
