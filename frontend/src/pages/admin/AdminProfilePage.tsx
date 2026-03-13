import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { UserRound, Settings, Eye, EyeOff, Activity, Calendar, Clock, IdCard, QrCode, X } from 'lucide-react'
import LayoutFix from '../../components/LayoutFix'
import { apiClient } from '../../services/apiClient'
import { useAuth } from '../../services/authService'
import { uploadService } from '../../services/uploadService'
import '../../styles/pages/dashboard-php.css'

interface AdminProfile {
  situation_matrimoniale: string
  id: number
  userType?: 'admin' | 'employe'
  nom?: string
  prenom?: string
  email?: string
  role?: string
  telephone?: string
  adresse?: string
  departement?: string
  poste?: string
  statut?: string
  matricule?: string
  photo?: string
  date_embauche?: string
  dateCreation?: string
  createdAt?: string
  created_at?: string
  lastActivity?: string
  last_activity?: string
  badgeId?: string
  badge_id?: string
}

interface BadgePreview {
  id: number
  token: string
  token_hash?: string
  user_id: number
  user_type?: 'employe' | 'admin'
  user_matricule?: string
  user_name?: string
  user_email?: string
  user_role?: string
  created_at?: string
  expires_at?: string
  status?: 'active' | 'inactive' | 'expired'
  last_used?: string | null
  usage_count?: number
  photo?: string
  badgeId?: string
  qrCode?: string
  departement?: string
  validite?: string
}

interface ProfileFormData {
  nom: string
  prenom: string
  email: string
  telephone: string
  adresse: string
  departement: string
  poste: string
  statut: string
  badge_id: string
  date_embauche: string
  photo: string
  role: string
  matricule: string
  situation_matrimoniale: string
}

const ADMIN_ALLOWED_ROLES = new Set(['admin', 'super_admin', 'manager', 'hr'])
const isBlobUrl = (value: string) => value.startsWith('blob:')

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super admin',
  admin: 'Admin',
  manager: 'Manager',
  hr: 'RH',
  chef_departement: 'Chef departement',
  comptable: 'Comptable',
  stagiaire: 'Stagiaire',
  employe: 'Employe'
}

const toDateInputValue = (value?: string) => {
  if (!value) return ''
  const asString = String(value)
  if (/^\d{4}-\d{2}-\d{2}/.test(asString)) return asString.slice(0, 10)
  const parsed = new Date(asString)
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toISOString().slice(0, 10)
}

const formatDate = (value?: string) => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('fr-FR')
}

const formatRole = (value?: string) => {
  const role = String(value || 'admin').trim().toLowerCase()
  return ROLE_LABELS[role] || role.replace(/_/g, ' ')
}

const generateMatricule = (prenom?: string, nom?: string): string => {
  // Prend les 3 premières lettres du nom et 3 premières lettres du prénom
  const nomPart = (nom || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3).padEnd(3, 'X')
  const prenomPart = (prenom || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3).padEnd(3, 'X')
  const randomPart = Math.floor(Math.random() * 1000).toString().padStart(3, '0')
  return `${nomPart}${prenomPart}${randomPart}`
}

const buildFormData = (profile: AdminProfile): ProfileFormData => ({
  nom: profile.nom || '',
  prenom: profile.prenom || '',
  email: profile.email || '',
  telephone: profile.telephone || '',
  adresse: profile.adresse || '',
  departement: profile.departement || '',
  poste: profile.poste || '',
  statut: profile.statut || 'actif',
  badge_id: profile.badge_id || profile.badgeId || profile.matricule || generateMatricule(profile.prenom, profile.nom),
  date_embauche: toDateInputValue(profile.date_embauche),
  photo: profile.photo || '',
  role: profile.role || '',
  matricule: profile.matricule || generateMatricule(profile.prenom, profile.nom),
  situation_matrimoniale: profile.situation_matrimoniale || ''
})

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

const badgeStatusClass = (status?: BadgePreview['status']) => {
  if (status === 'inactive') return 'is-danger'
  if (status === 'expired') return 'is-warning'
  return 'is-success'
}

const badgeStatusLabel = (status?: BadgePreview['status']) => {
  if (status === 'inactive') return 'Badge desactive'
  if (status === 'expired') return 'Badge expire'
  return 'Badge actif'
}

const AdminProfilePage: React.FC = () => {
  const { user, isLoading: authLoading, updateProfile } = useAuth()
  const navigate = useNavigate()

  const [profile, setProfile] = useState<AdminProfile | null>(null)
  const [formData, setFormData] = useState<ProfileFormData>({
    nom: '',
    prenom: '',
    email: '',
    telephone: '',
    adresse: '',
    departement: '',
    poste: '',
    statut: 'actif',
    badge_id: '',
    date_embauche: '',
    photo: '',
    role: '',
    matricule: '',
    situation_matrimoniale: ''
  })
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [badge, setBadge] = useState<BadgePreview | null>(null)
  const [loadingBadge, setLoadingBadge] = useState(false)
  const [badgeModalOpen, setBadgeModalOpen] = useState(false)

  const profileDate = useMemo(
    () => profile?.date_embauche || profile?.dateCreation || profile?.createdAt || profile?.created_at || '',
    [profile]
  )
  const canEditHireDate = useMemo(() => profile?.userType === 'employe', [profile?.userType])
  const isSuperAdmin = useMemo(() => profile?.role === 'super_admin', [profile?.role])
  const canEditProfessionalInfo = useMemo(() => isSuperAdmin, [isSuperAdmin])
  const lastActivity = useMemo(
    () => profile?.lastActivity || profile?.last_activity || '',
    [profile]
  )
  const badgeId = useMemo(
    () => profile?.badgeId || profile?.badge_id || profile?.matricule || '',
    [profile]
  )
  const currentPhotoSource = editing ? formData.photo : profile?.photo || formData.photo
  const resolvedPhotoUrl = useMemo(
    () => photoPreviewUrl || uploadService.resolvePhotoUrl(currentPhotoSource),
    [currentPhotoSource, photoPreviewUrl]
  )
  const initials = useMemo(
    () => `${(formData.prenom?.[0] || profile?.prenom?.[0] || 'A').toUpperCase()}${(formData.nom?.[0] || profile?.nom?.[0] || 'D').toUpperCase()}`,
    [formData.nom, formData.prenom, profile?.nom, profile?.prenom]
  )

  useEffect(() => {
    return () => {
      if (isBlobUrl(photoPreviewUrl)) {
        URL.revokeObjectURL(photoPreviewUrl)
      }
    }
  }, [photoPreviewUrl])

  const loadProfile = async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await apiClient.get<{ success: boolean; user?: AdminProfile; message?: string }>('/api/auth/validate')
      if (!response?.success || !response.user) {
        throw new Error(response?.message || 'Profil introuvable')
      }
      setProfile(response.user)
      setFormData(buildFormData(response.user))
      
      // Charger le badge de l'admin avec le profil utilisateur
      if (response.user.id) {
        await loadAdminBadge(response.user.id, response.user)
      }
    } catch (loadError: any) {
      console.error('Erreur chargement profil admin:', loadError)
      setError(loadError?.message || 'Impossible de charger le profil')
      setProfile(null)
    } finally {
      setLoading(false)
    }
  }

  const loadAdminBadge = async (adminId: number, userProfile?: AdminProfile) => {
    try {
      setLoadingBadge(true)

      const currentProfile = userProfile || profile
      const response = await apiClient.get<{ success: boolean; badge?: BadgePreview | null; message?: string }>('/api/admin/badge')
      if (!response?.success) {
        throw new Error(response?.message || 'Chargement du badge impossible')
      }

      if (!response.badge?.token) {
        setBadge(null)
        return
      }

      setBadge({
        ...response.badge,
        qrCode: buildBadgeQrUrl(response.badge.token),
        user_matricule: response.badge.user_matricule || response.badge.badgeId || currentProfile?.matricule || '',
        user_name: response.badge.user_name || `${currentProfile?.prenom} ${currentProfile?.nom}`,
        user_email: response.badge.user_email || currentProfile?.email,
        user_role: response.badge.user_role || currentProfile?.role,
        user_type: 'admin' as const
      })
    } catch (badgeError: any) {
      console.error('Erreur chargement badge admin:', badgeError)
      setBadge(null)
    } finally {
      setLoadingBadge(false)
    }
  }

  useEffect(() => {
    if (authLoading) return

    if (!user) {
      navigate('/login', { replace: true })
      return
    }

    const role = String(user.role || '').toLowerCase()
    if (!ADMIN_ALLOWED_ROLES.has(role)) {
      navigate('/employee', { replace: true })
      return
    }

    void loadProfile()
  }, [authLoading, navigate, user])

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = event.target
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  const handlePhotoChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    try {
      setUploadingPhoto(true)
      setError(null)

      const localPreviewUrl = URL.createObjectURL(file)
      setPhotoPreviewUrl((previous) => {
        if (isBlobUrl(previous)) {
          URL.revokeObjectURL(previous)
        }
        return localPreviewUrl
      })

      const uploadedPhotoUrl = await uploadService.uploadProfilePhoto(file)
      setFormData((prev) => ({ ...prev, photo: uploadedPhotoUrl }))
      setSuccess('Photo de profil mise a jour.')
    } catch (uploadError: any) {
      console.error('Erreur upload photo admin:', uploadError)
      setError(uploadError?.message || "Impossible d'ajouter la photo.")
    } finally {
      setUploadingPhoto(false)
    }
  }

  const handleRemovePhoto = () => {
    setFormData((prev) => ({ ...prev, photo: '' }))
    setPhotoPreviewUrl((previous) => {
      if (isBlobUrl(previous)) {
        URL.revokeObjectURL(previous)
      }
      return ''
    })
  }

  const handleStartEdit = () => {
    if (!profile) return
    setFormData(buildFormData(profile))
    setError(null)
    setSuccess(null)
    setEditing(true)
  }

  const handleCancel = () => {
    if (profile) {
      setFormData(buildFormData(profile))
    }
    setPhotoPreviewUrl((previous) => {
      if (isBlobUrl(previous)) {
        URL.revokeObjectURL(previous)
      }
      return ''
    })
    setEditing(false)
    setError(null)
    setSuccess(null)
  }

  const handleSave = async () => {
    try {
      if (uploadingPhoto) {
        setError('Patientez pendant le telechargement de la photo.')
        return
      }

      setSaving(true)
      setError(null)
      setSuccess(null)

      const payload: Record<string, string | null> = {
        nom: formData.nom.trim(),
        prenom: formData.prenom.trim(),
        email: formData.email.trim(),
        telephone: formData.telephone.trim(),
        adresse: formData.adresse.trim(),
        departement: formData.departement.trim(),
        poste: formData.poste.trim(),
        statut: formData.statut.trim(),
        badge_id: formData.badge_id.trim(),
        photo: formData.photo ? formData.photo.trim() : null
      }
      if (canEditHireDate) {
        payload.date_embauche = formData.date_embauche || null
      }

      const result = await updateProfile(payload)
      if (!result.success) {
        throw new Error(result.error || 'Mise a jour impossible')
      }

      await loadProfile()
      setPhotoPreviewUrl((previous) => {
        if (isBlobUrl(previous)) {
          URL.revokeObjectURL(previous)
        }
        return ''
      })
      setEditing(false)
      setSuccess('Profil mis a jour avec succes.')
    } catch (saveError: any) {
      console.error('Erreur mise a jour profil admin:', saveError)
      setError(saveError?.message || 'Erreur lors de la mise a jour du profil')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <LayoutFix title="Mon profil">
        <div className="flex justify-center items-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      </LayoutFix>
    )
  }

  if (!profile) {
    return (
      <LayoutFix title="Mon profil">
        <div className="bg-white rounded-lg shadow-sm p-6 text-center text-red-600">
          Profil introuvable.
        </div>
      </LayoutFix>
    )
  }

  return (
    <LayoutFix title="Mon profil">
      <div className="xp-form space-y-6">
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

        <section className="php-grid-2">
          <article className="php-card">
            <div className="php-card-header">
              <h2 className="php-card-title">
                <UserRound size={16} style={{ marginRight: 8, verticalAlign: 'text-bottom' }} />
                Informations personnelles
              </h2>
              {!editing ? (
                <button
                  onClick={handleStartEdit}
                  className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700"
                >
                  Modifier
                </button>
              ) : (
                <div className="flex gap-2">
                  <button
                    onClick={handleCancel}
                    disabled={saving || uploadingPhoto}
                    className="px-3 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Annuler
                  </button>
                  <button
                    onClick={() => void handleSave()}
                    disabled={saving || uploadingPhoto}
                    className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-50"
                  >
                    {saving ? 'Enregistrement...' : uploadingPhoto ? 'Upload photo...' : 'Enregistrer'}
                  </button>
                </div>
              )}
            </div>
            <div className="php-card-body">
              {/* Section Photo et Badge côte à côte */}
              <div className="flex flex-col lg:flex-row gap-6 mb-6">
                {/* Photo */}
                <div className="flex-1">
                  <label className="xp-form-label">Photo professionnelle</label>
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="w-24 h-24 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-semibold overflow-hidden">
                      {resolvedPhotoUrl ? (
                        <img
                          src={resolvedPhotoUrl}
                          alt="Photo profil admin"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="text-xl">{initials}</span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {editing ? (
                        <>
                          <label className="inline-flex cursor-pointer items-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-100">
                            {uploadingPhoto ? 'Telechargement...' : 'Choisir une photo'}
                            <input
                              type="file"
                              accept="image/png,image/jpeg,image/webp,image/gif"
                              onChange={handlePhotoChange}
                              disabled={uploadingPhoto}
                              className="hidden"
                            />
                          </label>
                          {(formData.photo || photoPreviewUrl) ? (
                            <button
                              type="button"
                              onClick={handleRemovePhoto}
                              disabled={uploadingPhoto}
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
                
                {/* Badge d'Accès */}
                <div className="flex-1">
                  <label className="xp-form-label">Badge d'Accès</label>
                  {loadingBadge ? (
                    <div className="flex flex-col items-center justify-center py-8">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mb-2"></div>
                      <p className="text-xs text-gray-600">Chargement...</p>
                    </div>
                  ) : badge?.token ? (
                    <div className="flex items-center gap-4">
                      <div className="relative group">
                        <button
                          type="button"
                          onClick={() => setBadgeModalOpen(true)}
                          className="relative rounded-lg border-2 border-gray-200 bg-white p-3 hover:shadow-lg transition-all duration-300 hover:border-purple-300 hover:scale-105"
                          title="Afficher le badge en grand format"
                        >
                          <div className="absolute -top-1 -right-1 bg-purple-600 text-white text-xs px-1.5 py-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                            +
                          </div>
                          <img
                            src={badge.qrCode || buildBadgeQrUrl(badge.token, 120)}
                            alt="Badge QR admin"
                            className="w-[120px] h-[120px] object-contain"
                          />
                        </button>
                      </div>
                      <div className="flex-1">
                        <div className="space-y-2">
                          <div className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold ${
                            badge.status === 'active' ? 'bg-green-100 text-green-800 border border-green-200' :
                            badge.status === 'inactive' ? 'bg-red-100 text-red-800 border border-red-200' : 'bg-yellow-100 text-yellow-800 border border-yellow-200'
                          }`}>
                            <div className={`w-1.5 h-1.5 rounded-full mr-1 ${
                              badge.status === 'active' ? 'bg-green-500' : 
                              badge.status === 'inactive' ? 'bg-red-500' : 'bg-yellow-500'
                            }`}></div>
                            {badge.status === 'active' ? 'Actif' :
                             badge.status === 'inactive' ? 'Inactif' : 'Expiré'}
                          </div>
                          <p className="text-xs text-gray-600">Matricule: {badge.user_matricule || badgeId || '-'}</p>
                          <p className="text-xs text-gray-500">Token: {badge.token.substring(0, 8)}...</p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-6">
                      <div className="w-16 h-16 mx-auto bg-gray-200 rounded-full flex items-center justify-center mb-3">
                        <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2" />
                        </svg>
                      </div>
                      <p className="text-sm text-gray-600 mb-2">Aucun badge</p>
                      <button
                        onClick={() => navigate('/admin/badges')}
                        className="text-xs text-purple-600 hover:text-purple-800 font-medium"
                      >
                        Demander un badge
                      </button>
                    </div>
                  )}
                </div>
              </div>
              
              {/* Champs du formulaire */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="xp-form-label">Prenom</label>
                  <input
                    name="prenom"
                    value={formData.prenom}
                    onChange={handleInputChange}
                    disabled={!editing}
                    className="xp-form-input"
                  />
                </div>
                <div>
                  <label className="xp-form-label">Nom</label>
                  <input
                    name="nom"
                    value={formData.nom}
                    onChange={handleInputChange}
                    disabled={!editing}
                    className="xp-form-input"
                  />
                </div>
                <div>
                  <label className="xp-form-label">Telephone</label>
                  <input
                    name="telephone"
                    value={formData.telephone}
                    onChange={handleInputChange}
                    disabled={!editing}
                    className="xp-form-input"
                  />
                </div>
                <div>
                  <label className="xp-form-label">Situation matrimoniale</label>
                  <select
                    name="situation_matrimoniale"
                    value={formData.situation_matrimoniale || ''}
                    onChange={handleInputChange}
                    disabled={!editing}
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
                    value={formData.adresse}
                    onChange={handleInputChange}
                    disabled={!editing}
                    rows={3}
                    className="xp-form-input"
                  />
                </div>
              </div>
            </div>
          </article>

          <article className="php-card">
            <div className="php-card-header">
              <h2 className="php-card-title">
                <Settings size={16} style={{ marginRight: 8, verticalAlign: 'text-bottom' }} />
                Informations professionnelles {canEditProfessionalInfo ? '' : '(lecture seule)'}
              </h2>
            </div>
            {canEditProfessionalInfo && editing ? (
              <div className="php-card-body grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="xp-form-label">Role</label>
                  <select
                    name="role"
                    value={formData.role}
                    onChange={handleInputChange}
                    disabled={!editing}
                    className="xp-form-input"
                  >
                    <option value="admin">Admin</option>
                    <option value="super_admin">Super Admin</option>
                  </select>
                </div>
                <div>
                  <label className="xp-form-label">Departement</label>
                  <input
                    name="departement"
                    value={formData.departement}
                    onChange={handleInputChange}
                    disabled={!editing}
                    className="xp-form-input"
                  />
                </div>
                <div>
                  <label className="xp-form-label">Poste</label>
                  <input
                    name="poste"
                    value={formData.poste}
                    onChange={handleInputChange}
                    disabled={!editing}
                    className="xp-form-input"
                  />
                </div>
                <div>
                  <label className="xp-form-label">Date d'embauche</label>
                  <input
                    type="date"
                    name="date_embauche"
                    value={formData.date_embauche}
                    onChange={handleInputChange}
                    disabled={!editing}
                    className="xp-form-input"
                  />
                </div>
                <div>
                  <label className="xp-form-label">Matricule</label>
                  <input
                    name="matricule"
                    value={formData.matricule}
                    onChange={handleInputChange}
                    disabled={!editing}
                    className="xp-form-input"
                  />
                </div>
                <div>
                  <label className="xp-form-label">Statut</label>
                  <select
                    name="statut"
                    value={formData.statut}
                    onChange={handleInputChange}
                    disabled={!editing}
                    className="xp-form-input"
                  >
                    <option value="actif">Actif</option>
                    <option value="inactif">Inactif</option>
                    <option value="suspendu">Suspendu</option>
                  </select>
                </div>
              </div>
            ) : (
              <div className="php-card-body php-list">
                <div className="php-list-item">
                  <div>
                    <strong>Role</strong>
                    <small>{formatRole(profile?.role)}</small>
                  </div>
                  <span className="php-pill is-primary">{formatRole(profile?.role)}</span>
                </div>
                <div className="php-list-item">
                  <div>
                    <strong>Departement</strong>
                    <small>{profile?.departement || '-'}</small>
                  </div>
                </div>
                <div className="php-list-item">
                  <div>
                    <strong>Poste</strong>
                    <small>{profile?.poste || '-'}</small>
                  </div>
                </div>
                <div className="php-list-item">
                  <div>
                    <strong>Date d'embauche</strong>
                    <small>{profile?.date_embauche ? formatDateTime(profile.date_embauche) : '-'}</small>
                  </div>
                </div>
                <div className="php-list-item">
                  <div>
                    <strong>Matricule</strong>
                    <small>{profile?.matricule || badgeId || '-'}</small>
                  </div>
                </div>
                <div className="php-list-item">
                  <div>
                    <strong>Email professionnel</strong>
                    <small>{profile?.email || '-'}</small>
                  </div>
                </div>
                <div className="php-list-item">
                  <div>
                    <strong>Date de creation</strong>
                    <small>{profile?.dateCreation ? formatDateTime(profile.dateCreation) : '-'}</small>
                  </div>
                </div>
                <div className="php-list-item">
                  <div>
                    <strong>Derniere activite</strong>
                    <small>{profile?.lastActivity ? formatDateTime(profile.lastActivity) : '-'}</small>
                  </div>
                </div>
              </div>
            )}
          </article>
        </section>
      </div>
      
      {/* Modal Badge - Design identique à BadgePage employé */}
      {badgeModalOpen && badge && (
        <div 
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setBadgeModalOpen(false)
            }
          }}
        >
          <div className="bg-white rounded-xl shadow-2xl border border-gray-200 max-w-lg w-full mx-4 relative overflow-hidden" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="bg-gradient-to-r from-blue-50 to-indigo-100 px-6 py-4 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-gray-900 flex items-center">
                  <QrCode className="w-6 h-6 mr-2 text-blue-600" />
                  Mon Badge QR
                </h2>
                <button
                  onClick={() => setBadgeModalOpen(false)}
                  className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded-lg hover:bg-gray-100"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
            </div>

            {/* Contenu */}
            <div className="p-8">
              <div className="flex flex-col items-center">
                {/* QR Code Container */}
                <div className="relative mb-6">
                  <div className="w-80 h-80 rounded-2xl border-4 border-gray-200 bg-white shadow-xl flex items-center justify-center relative overflow-hidden">
                    <img 
                      src={badge.qrCode || buildBadgeQrUrl(badge.token, 300)} 
                      alt="Badge QR" 
                      className="w-[300px] h-[300px] object-contain"
                    />
                    {/* Status Badge */}
                    <div className={`absolute top-4 right-4 w-10 h-10 rounded-full border-2 border-white ${
                      badge.status === 'active' ? 'bg-green-500' :
                      badge.status === 'inactive' ? 'bg-red-500' : 'bg-yellow-500'
                    }`}>
                      <span className="text-white text-sm flex items-center justify-center h-full font-bold">
                        {badge.status === 'active' ? '✓' :
                         badge.status === 'inactive' ? '✗' : '!'}
                      </span>
                    </div>
                  </div>
                  
                  {/* Token Info */}
                  <div className="absolute -bottom-3 left-1/2 transform -translate-x-1/2 bg-white rounded-lg shadow-lg border border-gray-200 px-4 py-2">
                    <p className="text-xs font-mono text-gray-600">Token: {badge.token.substring(0, 12)}...</p>
                  </div>
                </div>

                {/* User Info */}
                <div className="text-center space-y-3 w-full">
                  <div className="bg-gray-50 rounded-lg p-4">
                    <h3 className="text-xl font-bold text-gray-900 mb-2">{profile?.prenom} {profile?.nom}</h3>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div className="flex items-center justify-center space-x-2">
                        <Activity className="w-4 h-4 text-gray-400" />
                        <span className="text-gray-600">{profile?.poste || '-'}</span>
                      </div>
                      <div className="flex items-center justify-center space-x-2">
                        <Activity className="w-4 h-4 text-gray-400" />
                        <span className="text-gray-600">{profile?.departement || '-'}</span>
                      </div>
                      <div className="flex items-center justify-center space-x-2">
                        <IdCard className="w-4 h-4 text-gray-400" />
                        <span className="text-gray-600">Matricule: {badge.user_matricule || badgeId || '-'}</span>
                      </div>
                      <div className="flex items-center justify-center space-x-2">
                        <Calendar className="w-4 h-4 text-gray-400" />
                        <span className="text-gray-600">Expire: {badge.expires_at ? new Date(badge.expires_at).toLocaleDateString('fr-FR') : '-'}</span>
                      </div>
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="grid grid-cols-2 gap-4 w-full">
                    <div className="bg-blue-50 rounded-lg p-3 text-center">
                      <Clock className="w-5 h-5 text-blue-600 mx-auto mb-1" />
                      <p className="text-xs text-gray-600">Dernière utilisation</p>
                      <p className="text-sm font-medium text-gray-900">{badge.last_used ? new Date(badge.last_used).toLocaleDateString('fr-FR') : '-'}</p>
                    </div>
                    <div className="bg-green-50 rounded-lg p-3 text-center">
                      <Activity className="w-5 h-5 text-green-600 mx-auto mb-1" />
                      <p className="text-xs text-gray-600">Utilisations totales</p>
                      <p className="text-sm font-medium text-gray-900">{badge.usage_count || 0}</p>
                    </div>
                  </div>

                  {/* Status */}
                  <div className="pt-4 border-t border-gray-200">
                    <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${
                      badge.status === 'active' ? 'bg-green-100 text-green-800 border border-green-200' :
                      badge.status === 'inactive' ? 'bg-red-100 text-red-800 border border-red-200' :
                      'bg-yellow-100 text-yellow-800 border border-yellow-200'
                    }`}>
                      <div className={`w-2 h-2 rounded-full mr-2 ${
                        badge.status === 'active' ? 'bg-green-500' : 
                        badge.status === 'inactive' ? 'bg-red-500' : 'bg-yellow-500'
                      }`}></div>
                      {badge.status === 'active' ? 'Badge Actif' :
                       badge.status === 'inactive' ? 'Badge Inactif' : 'Badge Expiré'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </LayoutFix>
  )
}

export default AdminProfilePage
