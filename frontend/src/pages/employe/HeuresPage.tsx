import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiClient } from '../../services/apiClient'
import { useAuth } from '../../services/authService'

interface PeriodPointage {
  id: number
  type: 'arrivee' | 'depart' | 'pause_debut' | 'pause_fin' | 'absence'
  dateHeure: string
  retardMinutes?: number
  pauseDebut?: string | null
  pauseFin?: string | null
  etat?: string
  statut?: string
}

interface DashboardResponse {
  success: boolean
  statistiques?: {
    absences?: number
    total_heures?: number
  }
}

const EMPLOYEE_ALLOWED_ROLES = new Set(['employe', 'chef_departement', 'stagiaire'])
const toDateInput = (date: Date) => date.toISOString().slice(0, 10)

const parseDate = (value?: string | null) => {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const formatDate = (value?: string | null) => {
  const parsed = parseDate(value)
  if (!parsed) return '-'
  return parsed.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  })
}

const formatTime = (value?: string | null) => {
  const parsed = parseDate(value)
  if (!parsed) return '-'
  return parsed.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

const HeuresPage: React.FC = () => {
  const { user, logout, isLoading: authLoading } = useAuth()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [fromDate, setFromDate] = useState(() => {
    const now = new Date()
    return toDateInput(new Date(now.getFullYear(), now.getMonth(), 1))
  })
  const [toDate, setToDate] = useState(() => toDateInput(new Date()))
  const [pointages, setPointages] = useState<PeriodPointage[]>([])
  const [absences, setAbsences] = useState(0)

  const isUnauthorizedError = useCallback((loadError: any) => {
    const status = Number(loadError?.status || 0)
    if (status === 401 || status === 403) return true
    const message = String(loadError?.message || '').toLowerCase()
    return message.includes('401') || message.includes('403') || message.includes('token')
  }, [])

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const startIso = new Date(`${fromDate}T00:00:00`).toISOString()
      const endIso = new Date(`${toDate}T23:59:59`).toISOString()

      const [periodResponse, dashboardResponse] = await Promise.all([
        apiClient.get<{ success: boolean; pointages?: PeriodPointage[] }>(
          `/api/pointages/period?start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}`
        ),
        apiClient.get<DashboardResponse>('/api/employe/dashboard')
      ])

      setPointages(Array.isArray(periodResponse.pointages) ? periodResponse.pointages : [])
      setAbsences(Number(dashboardResponse?.statistiques?.absences || 0))
    } catch (loadError: any) {
      console.error('Erreur chargement heures employe:', loadError)
      if (isUnauthorizedError(loadError)) {
        logout()
        navigate('/login', { replace: true })
        return
      }
      setError(loadError?.message || 'Impossible de charger les heures de travail.')
      setPointages([])
      setAbsences(0)
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
      navigate('/admin', { replace: true })
      return
    }
    void loadData()
  }, [authLoading, loadData, navigate, user])

  const dailySummary = useMemo(() => {
    const grouped = new Map<string, PeriodPointage[]>()
    for (const pointage of pointages) {
      const date = parseDate(pointage.dateHeure)
      if (!date) continue
      const key = date.toISOString().slice(0, 10)
      const list = grouped.get(key) || []
      list.push(pointage)
      grouped.set(key, list)
    }

    return [...grouped.entries()]
      .map(([day, entries]) => {
        const sorted = [...entries].sort((a, b) => new Date(a.dateHeure).getTime() - new Date(b.dateHeure).getTime())
        const firstArrival = sorted.find((entry) => entry.type === 'arrivee')
        const lastDeparture = [...sorted].reverse().find((entry) => entry.type === 'depart')

        let workedMs = 0
        let pauseMs = 0
        let openArrival: Date | null = null
        let openPause: Date | null = null

        for (const entry of sorted) {
          const pointageDate = parseDate(entry.dateHeure)
          if (!pointageDate) continue

          if (entry.type === 'arrivee') {
            openArrival = pointageDate
            openPause = null
          } else if (entry.type === 'pause_debut') {
            if (openPause === null) openPause = pointageDate
          } else if (entry.type === 'pause_fin') {
            if (openPause) {
              pauseMs += Math.max(0, pointageDate.getTime() - openPause.getTime())
              openPause = null
            }
          } else if (entry.type === 'depart') {
            if (openPause) {
              pauseMs += Math.max(0, pointageDate.getTime() - openPause.getTime())
              openPause = null
            }
            if (openArrival) {
              workedMs += Math.max(0, pointageDate.getTime() - openArrival.getTime())
              openArrival = null
            }
          }
        }

        const retardMinutes = sorted
          .filter((entry) => entry.type === 'arrivee')
          .reduce((sum, entry) => sum + Number(entry.retardMinutes || 0), 0)

        return {
          day,
          firstArrival: firstArrival?.dateHeure || null,
          lastDeparture: lastDeparture?.dateHeure || null,
          workedHours: Math.round((workedMs / (1000 * 60 * 60)) * 100) / 100,
          pauseMinutes: Math.round(pauseMs / (1000 * 60)),
          retardMinutes
        }
      })
      .sort((a, b) => new Date(b.day).getTime() - new Date(a.day).getTime())
  }, [pointages])

  const totals = useMemo(() => {
    return dailySummary.reduce(
      (acc, day) => {
        acc.workedHours += day.workedHours
        acc.pauseMinutes += day.pauseMinutes
        acc.retardMinutes += day.retardMinutes
        return acc
      },
      { workedHours: 0, pauseMinutes: 0, retardMinutes: 0 }
    )
  }, [dailySummary])

  return (
    <div className="space-y-6">
      <section className="php-card">
        <div className="php-card-header">
          <h2 className="php-card-title">Mes heures de travail</h2>
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
              onClick={() => void loadData()}
              className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700"
            >
              Actualiser
            </button>
          </div>
        </div>
        <div className="php-card-body">
          {loading ? <span className="php-pill is-warning">Chargement des heures...</span> : null}
          {error ? <span className="php-pill is-danger">{error}</span> : null}
        </div>
      </section>

      <section className="php-kpi-grid">
        <article className="php-kpi-card">
          <small>Heures travaillees</small>
          <strong>{totals.workedHours.toFixed(2)}h</strong>
        </article>
        <article className="php-kpi-card">
          <small>Temps de pause</small>
          <strong>{totals.pauseMinutes} min</strong>
        </article>
        <article className="php-kpi-card">
          <small>Retard cumule</small>
          <strong>{totals.retardMinutes} min</strong>
        </article>
        <article className="php-kpi-card">
          <small>Absences</small>
          <strong>{absences}</strong>
        </article>
      </section>

      <section className="php-card">
        <div className="php-card-header">
          <h2 className="php-card-title">Detail journalier</h2>
        </div>
        <div className="php-card-body php-table-wrap">
          <table className="php-table">
            <thead>
              <tr>
                <th>Jour</th>
                <th>Arrivee</th>
                <th>Depart</th>
                <th>Heures</th>
                <th>Pause</th>
                <th>Retard</th>
              </tr>
            </thead>
            <tbody>
              {dailySummary.length === 0 ? (
                <tr>
                  <td colSpan={6}>Aucune donnee sur cette periode.</td>
                </tr>
              ) : (
                dailySummary.map((day) => (
                  <tr key={day.day}>
                    <td>{formatDate(`${day.day}T00:00:00`)}</td>
                    <td>{formatTime(day.firstArrival)}</td>
                    <td>{formatTime(day.lastDeparture)}</td>
                    <td>{day.workedHours.toFixed(2)}h</td>
                    <td>{day.pauseMinutes} min</td>
                    <td>
                      <span className={`php-pill ${day.retardMinutes > 0 ? 'is-warning' : 'is-success'}`}>
                        {day.retardMinutes > 0 ? `${day.retardMinutes} min` : 'A l heure'}
                      </span>
                    </td>
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

export default HeuresPage
