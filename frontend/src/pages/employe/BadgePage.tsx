import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { IdCard, QrCode, RefreshCw, ShieldCheck, Edit, Camera, User, Clock, Calendar, Activity } from 'lucide-react'
import { apiClient } from '../../services/apiClient'
import { useAuth } from '../../services/authService'

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

interface EmployeProfile {
  id: number
  nom?: string
  prenom?: string
  email?: string
  poste?: string
  departement?: string
  matricule?: string
  role?: string
}

const EMPLOYEE_ALLOWED_ROLES = new Set(['employe', 'chef_departement', 'stagiaire'])

const ROLE_BADGE_PRIVILEGES: Record<string, string[]> = {
  chef_departement: ['Acces planning equipe', 'Consultation tableau de service', 'Pointage securise'],
  stagiaire: ['Pointage personnel', 'Acces zones stagiaire', 'Historique personnel'],
  employe: ['Pointage personnel', 'Acces zone employe', 'Historique personnel']
}

const buildBadgeQrUrl = (token: string, size = 320) => {
  const safeToken = String(token || '').trim()
  if (!safeToken) return ''
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(safeToken)}`
}

const formatDateTime = (value?: string | null) => {
  if (!value) return '-'
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

const badgeStatusClass = (status?: BadgeAccess['status']) => {
  if (status === 'inactive') return 'is-danger'
  if (status === 'expired') return 'is-warning'
  return 'is-success'
}

const badgeStatusLabel = (status?: BadgeAccess['status']) => {
  if (status === 'inactive') return 'Badge desactive'
  if (status === 'expired') return 'Badge expire'
  return 'Badge actif'
}

const BadgePage: React.FC = () => {
  const { user, logout, isLoading: authLoading } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [regenerating, setRegenerating] = useState(false)
  const [profile, setProfile] = useState<EmployeProfile | null>(null)
  const [badge, setBadge] = useState<BadgeAccess | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const isUnauthorizedError = useCallback((error: any) => {
    const status = Number(error?.status || 0)
    if (status === 401 || status === 403) return true
    const message = String(error?.message || '').toLowerCase()
    return message.includes('401') || message.includes('403') || message.includes('token')
  }, [])

  const loadBadgeData = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const [profileResponse, badgeResponse] = await Promise.all([
        apiClient.get<{ success: boolean; employe?: EmployeProfile; user?: EmployeProfile; message?: string }>('/api/employe/profile'),
        (async () => {
          const endpoints = ['/api/employe/badge', '/api/badge/employe']
          for (const endpoint of endpoints) {
            try {
              return await apiClient.get<{ success: boolean; badge?: BadgeAccess | null }>(endpoint)
            } catch (endpointError: any) {
              if (Number(endpointError?.status || 0) === 404) continue
              throw endpointError
            }
          }
          return { success: true, badge: null }
        })()
      ])

      setProfile(profileResponse.employe || profileResponse.user || null)
      setBadge(badgeResponse.badge || null)
    } catch (loadError: any) {
      console.error('Erreur chargement badge employe:', loadError)
      if (isUnauthorizedError(loadError)) {
        logout()
        navigate('/login', { replace: true })
        return
      }
      setError(loadError?.message || 'Impossible de charger votre badge.')
      setBadge(null)
      setProfile(null)
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
    void loadBadgeData()
  }, [authLoading, loadBadgeData, navigate, user])

  const handleRegenerate = async () => {
    try {
      setRegenerating(true)
      setError(null)
      setInfo(null)
      const response = await apiClient.post<Record<string, never>, { success: boolean; message?: string; badge?: BadgeAccess }>(
        '/api/employe/badge/regenerate',
        {}
      )
      if (!response?.success || !response.badge) {
        throw new Error(response?.message || 'Regeneration impossible')
      }
      setBadge(response.badge)
      setInfo('Badge regenere avec succes.')
    } catch (regenerateError: any) {
      console.error('Erreur regeneration badge employe:', regenerateError)
      setError(regenerateError?.message || 'Erreur lors de la regeneration du badge.')
    } finally {
      setRegenerating(false)
    }
  }

  const privileges = useMemo(() => {
    const role = String(profile?.role || user?.role || 'employe').toLowerCase()
    return ROLE_BADGE_PRIVILEGES[role] || ROLE_BADGE_PRIVILEGES.employe
  }, [profile?.role, user?.role])

  const fullName = `${profile?.prenom || user?.prenom || ''} ${profile?.nom || user?.nom || ''}`.trim()

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Chargement de votre badge...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 flex items-center">
                <IdCard className="w-8 h-8 mr-3 text-blue-600" />
                Mon Badge d'Authentification
              </h1>
              <p className="text-gray-600 mt-2">Gérez votre badge QR et consultez vos privilèges</p>
            </div>
            <button
              onClick={() => navigate('/employe/profile')}
              className="px-4 py-2 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-lg hover:from-blue-700 hover:to-blue-800 transition-all duration-200 shadow-md hover:shadow-lg transform hover:-translate-y-0.5 flex items-center"
            >
              <Edit className="w-4 h-4 mr-2" />
              Modifier mon profil
            </button>
          </div>
        </div>

        {/* Messages */}
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex items-center">
              <svg className="w-5 h-5 text-red-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-red-700">{error}</span>
            </div>
          </div>
        )}

        {info && (
          <div className="mb-6 bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex items-center">
              <svg className="w-5 h-5 text-green-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-green-700">{info}</span>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Badge principal */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden hover:shadow-xl transition-shadow duration-300">
              <div className="bg-gradient-to-r from-blue-50 to-indigo-100 px-6 py-4 border-b border-gray-200">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold text-gray-900 flex items-center">
                    <QrCode className="w-6 h-6 mr-2 text-blue-600" />
                    Mon Badge QR
                  </h2>
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                    badge?.status === 'active' ? 'bg-green-100 text-green-800' :
                    badge?.status === 'inactive' ? 'bg-red-100 text-red-800' :
                    'bg-yellow-100 text-yellow-800'
                  }`}>
                    {badge?.status === 'active' ? 'Actif' :
                     badge?.status === 'inactive' ? 'Inactif' : 'Expiré'}
                  </span>
                </div>
              </div>
              
              <div className="p-8">
                <div className="flex flex-col items-center">
                  {/* Badge QR Code */}
                  <div className="relative mb-6">
                    <div className="w-80 h-80 rounded-2xl border-4 border-gray-200 bg-white shadow-xl flex items-center justify-center relative overflow-hidden">
                      {badge?.token ? (
                        <>
                          <img src={buildBadgeQrUrl(badge.token)} alt="Badge QR" className="w-[300px] h-[300px] object-contain" />
                          {/* Badge de statut */}
                          <div className={`absolute top-4 right-4 w-8 h-8 rounded-full border-2 border-white ${
                            badge.status === 'active' ? 'bg-green-500' :
                            badge.status === 'inactive' ? 'bg-red-500' : 'bg-yellow-500'
                          }`}>
                            <span className="text-white text-xs flex items-center justify-center h-full">
                              {badge.status === 'active' ? '✓' :
                               badge.status === 'inactive' ? '✗' : '!'}
                            </span>
                          </div>
                        </>
                      ) : (
                        <div className="text-center">
                          <IdCard size={80} className="text-gray-300 mx-auto mb-4" />
                          <p className="text-gray-500">Aucun badge disponible</p>
                        </div>
                      )}
                    </div>
                    
                    {/* Informations du badge */}
                    {badge?.token && (
                      <div className="absolute -bottom-3 left-1/2 transform -translate-x-1/2 bg-white rounded-lg shadow-lg border border-gray-200 px-4 py-2">
                        <p className="text-xs font-mono text-gray-600">Token: {badge.token.substring(0, 12)}...</p>
                      </div>
                    )}
                  </div>

                  {/* Informations utilisateur */}
                  <div className="text-center space-y-3 w-full">
                    <div className="bg-gray-50 rounded-lg p-4">
                      <h3 className="text-xl font-bold text-gray-900 mb-2">{fullName || 'Employé'}</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                        <div className="flex items-center justify-center space-x-2">
                          <User className="w-4 h-4 text-gray-400" />
                          <span className="text-gray-600">{profile?.poste || '-'}</span>
                        </div>
                        <div className="flex items-center justify-center space-x-2">
                          <Activity className="w-4 h-4 text-gray-400" />
                          <span className="text-gray-600">{profile?.departement || '-'}</span>
                        </div>
                        <div className="flex items-center justify-center space-x-2">
                          <IdCard className="w-4 h-4 text-gray-400" />
                          <span className="text-gray-600">Matricule: {badge?.user_matricule || profile?.matricule || user?.matricule || '-'}</span>
                        </div>
                        <div className="flex items-center justify-center space-x-2">
                          <Calendar className="w-4 h-4 text-gray-400" />
                          <span className="text-gray-600">Expire: {formatDateTime(badge?.expires_at)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Statistiques */}
                    <div className="grid grid-cols-2 gap-4 w-full">
                      <div className="bg-blue-50 rounded-lg p-3 text-center">
                        <Clock className="w-5 h-5 text-blue-600 mx-auto mb-1" />
                        <p className="text-xs text-gray-600">Dernière utilisation</p>
                        <p className="text-sm font-medium text-gray-900">{formatDateTime(badge?.last_used)}</p>
                      </div>
                      <div className="bg-green-50 rounded-lg p-3 text-center">
                        <Activity className="w-5 h-5 text-green-600 mx-auto mb-1" />
                        <p className="text-xs text-gray-600">Utilisations totales</p>
                        <p className="text-sm font-medium text-gray-900">{badge?.usage_count || 0}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Panneau latéral */}
          <div className="space-y-6">
            {/* Privilèges */}
            <div className="bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden hover:shadow-xl transition-shadow duration-300">
              <div className="bg-gradient-to-r from-purple-50 to-pink-100 px-6 py-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900 flex items-center">
                  <ShieldCheck className="w-5 h-5 mr-2 text-purple-600" />
                  Privilèges du badge
                </h2>
              </div>
              <div className="p-6">
                <div className="space-y-3">
                  {privileges.map((privilege) => (
                    <div key={privilege} className="flex items-center space-x-3 p-3 bg-purple-50 rounded-lg">
                      <div className="w-2 h-2 bg-purple-600 rounded-full"></div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{privilege}</p>
                        <p className="text-xs text-gray-600">Associé à votre rôle actuel</p>
                      </div>
                    </div>
                  ))}
                  <div className="pt-3 border-t border-gray-200">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-900">Rôle actuel</p>
                        <p className="text-xs text-gray-600">{String(profile?.role || user?.role || 'employe').replace(/_/g, ' ')}</p>
                      </div>
                      <span className="px-3 py-1 bg-purple-100 text-purple-800 text-xs rounded-full font-medium">
                        {String(profile?.role || user?.role || 'employe').replace(/_/g, ' ')}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default BadgePage
