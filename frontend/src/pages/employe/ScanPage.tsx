import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import LayoutFix from '../../components/LayoutFix'
import { apiClient } from '../../services/apiClient'
import { useAuth } from '../../services/authService'

interface SelfBadge {
  id: number
  token: string
  status: 'active' | 'inactive' | 'expired'
  expires_at?: string
}

interface ScanResponsePayload {
  success: boolean
  message?: string
  pointage?: {
    id: number
    date_heure: string
    type: string
    statut: string
  }
  data?: {
    type: 'arrivee' | 'depart'
    retard_minutes?: number
    depart_anticipe_minutes?: number
    needs_justification?: boolean
    justification_reason?: string | null
    date?: string
    heure?: string
    user?: {
      id: number
      matricule?: string
      nom?: string
      prenom?: string
      role?: string
    }
  }
}

const EMPLOYEE_ALLOWED_ROLES = new Set(['employe', 'chef_departement', 'stagiaire'])

const reasonLabel = (value?: string | null) => {
  if (value === 'retard') return 'Retard a justifier'
  if (value === 'depart_anticipe') return 'Depart anticipe a justifier'
  return 'Justification requise'
}

export default function ScanPage() {
  const navigate = useNavigate()
  const { user, isLoading } = useAuth()

  const [badgeData, setBadgeData] = useState('')
  const [loadingBadge, setLoadingBadge] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [scanResult, setScanResult] = useState<ScanResponsePayload | null>(null)

  const initials = useMemo(() => `${user?.prenom?.[0] || ''}${user?.nom?.[0] || ''}`.toUpperCase() || 'EM', [user?.nom, user?.prenom])

  useEffect(() => {
    if (isLoading) return
    if (!user) {
      navigate('/login', { replace: true })
      return
    }

    const role = String(user.role || '').toLowerCase()
    if (!EMPLOYEE_ALLOWED_ROLES.has(role)) {
      navigate('/admin', { replace: true })
    }
  }, [isLoading, navigate, user])

  const loadOwnBadge = async () => {
    try {
      setLoadingBadge(true)
      setError(null)
      const response = await apiClient.get<{ success: boolean; badge?: SelfBadge | null; message?: string }>('/api/employe/badge')
      if (!response?.success || !response.badge?.token) {
        throw new Error(response?.message || 'Aucun badge actif detecte')
      }
      setBadgeData(response.badge.token)
      setSuccess('Badge charge. Lancez le scan pour pointer.')
    } catch (loadError: any) {
      console.error('Erreur chargement badge scan:', loadError)
      setError(loadError?.message || 'Impossible de charger votre badge')
    } finally {
      setLoadingBadge(false)
    }
  }

  const handleScan = async () => {
    const value = badgeData.trim()
    if (!value) {
      setError('Veuillez scanner ou coller les donnees du badge.')
      return
    }

    try {
      setSubmitting(true)
      setError(null)
      setSuccess(null)
      setScanResult(null)

      const deviceInfo = {
        userAgent: navigator.userAgent,
        language: navigator.language,
        platform: navigator.platform,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
      }

      const response = await apiClient.post<{ badge_data: string; device_info: Record<string, string> }, ScanResponsePayload>(
        '/api/scan_qr',
        {
          badge_data: value,
          device_info: deviceInfo
        }
      )

      if (!response?.success) {
        throw new Error(response?.message || 'Scan invalide')
      }

      setScanResult(response)
      setSuccess(response.message || 'Scan valide, pointage enregistre.')
    } catch (scanError: any) {
      console.error('Erreur scan badge:', scanError)
      setError(scanError?.message || 'Erreur lors du scan')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <LayoutFix title="Scanner badge">
      <div className="max-w-4xl mx-auto space-y-6">
        <section className="php-card">
          <div className="php-card-header">
            <h2 className="php-card-title">Scan QR de pointage</h2>
            <button
              onClick={() => void loadOwnBadge()}
              className="px-4 py-2 rounded-lg bg-gray-100 text-gray-800 text-sm hover:bg-gray-200 disabled:opacity-50"
              disabled={loadingBadge}
            >
              {loadingBadge ? 'Chargement...' : 'Charger mon badge'}
            </button>
          </div>
          <div className="php-card-body space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center">{initials}</div>
              <div>
                <p className="font-semibold text-gray-900">{user?.prenom} {user?.nom}</p>
                <p className="text-sm text-gray-600">Le type de pointage (arrivee/depart) est detecte automatiquement.</p>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Donnees badge scannees</label>
              <textarea
                value={badgeData}
                onChange={(event) => setBadgeData(event.target.value)}
                rows={4}
                placeholder="Scannez ou collez la valeur du badge QR..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => void handleScan()}
                disabled={submitting}
                className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-50"
              >
                {submitting ? 'Scan en cours...' : 'Valider le scan'}
              </button>
              <button
                onClick={() => {
                  setBadgeData('')
                  setScanResult(null)
                  setError(null)
                  setSuccess(null)
                }}
                className="px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50"
              >
                Reinitialiser
              </button>
            </div>
          </div>
        </section>

        {error ? (
          <section className="php-card">
            <div className="php-card-body">
              <span className="php-pill is-danger">{error}</span>
            </div>
          </section>
        ) : null}

        {success ? (
          <section className="php-card">
            <div className="php-card-body">
              <span className="php-pill is-success">{success}</span>
            </div>
          </section>
        ) : null}

        {scanResult?.success && scanResult?.data ? (
          <section className="php-card">
            <div className="php-card-header">
              <h2 className="php-card-title">Resultat du pointage</h2>
            </div>
            <div className="php-card-body php-list">
              <div className="php-list-item">
                <div>
                  <strong>Type detecte</strong>
                  <small>{scanResult.data.type === 'arrivee' ? 'Arrivee' : 'Depart'}</small>
                </div>
                <span className="php-pill is-primary">{scanResult.data.heure || '-'}</span>
              </div>

              <div className="php-list-item">
                <div>
                  <strong>Date</strong>
                  <small>{scanResult.data.date || '-'}</small>
                </div>
                <span className="php-pill is-success">{scanResult.data.user?.matricule || 'Matricule indisponible'}</span>
              </div>

              {Number(scanResult.data.retard_minutes || 0) > 0 ? (
                <div className="php-list-item">
                  <div>
                    <strong>Retard detecte</strong>
                    <small>{scanResult.data.retard_minutes} minute(s)</small>
                  </div>
                  <span className="php-pill is-warning">A justifier</span>
                </div>
              ) : null}

              {Number(scanResult.data.depart_anticipe_minutes || 0) > 0 ? (
                <div className="php-list-item">
                  <div>
                    <strong>Depart anticipe detecte</strong>
                    <small>{scanResult.data.depart_anticipe_minutes} minute(s) avant 18h</small>
                  </div>
                  <span className="php-pill is-warning">A justifier</span>
                </div>
              ) : null}

              {scanResult.data.needs_justification ? (
                <div className="php-list-item">
                  <div>
                    <strong>{reasonLabel(scanResult.data.justification_reason)}</strong>
                    <small>Une entree de justification a ete ouverte automatiquement.</small>
                  </div>
                  <button
                    onClick={() => navigate('/employee/demandes')}
                    className="px-3 py-1 rounded bg-blue-600 text-white text-xs hover:bg-blue-700"
                  >
                    Aller aux demandes
                  </button>
                </div>
              ) : (
                <div className="php-list-item">
                  <div>
                    <strong>Aucune justification requise</strong>
                    <small>Pointage valide sans anomalie.</small>
                  </div>
                  <span className="php-pill is-success">OK</span>
                </div>
              )}
            </div>
          </section>
        ) : null}
      </div>
    </LayoutFix>
  )
}
