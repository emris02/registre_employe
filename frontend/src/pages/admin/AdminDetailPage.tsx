import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import LayoutFix from '../../components/LayoutFix'
import { apiClient } from '../../services/apiClient'
import { useAuth } from '../../services/authService'
import { uploadService } from '../../services/uploadService'

interface AdminDetail {
  id: number
  matricule?: string
  nom: string
  prenom: string
  email: string
  emailPro?: string
  email_pro?: string
  role: string
  departement: string
  poste: string
  telephone?: string
  adresse?: string
  date_embauche?: string
  contrat_type?: string
  contrat_duree?: string
  contrat_pdf_url?: string
  salaire?: number | string | null
  statut: string
  photo?: string
  contact_urgence_nom?: string
  contact_urgence_telephone?: string
  contact_urgence_relation?: string
  contact_urgence_adresse_physique?: string
  situation_matrimoniale?: string
  badgeId?: string | null
  badge_id?: string | null
  dernier_connexion?: string
  total_pointages?: number
  total_heures?: number
}

interface RoleDefinition {
  id: string
  label: string
  scope?: 'admin' | 'employee'
}

interface AdminFormData {
  id: number
  matricule: string
  email: string
  email_pro: string
  nom: string
  prenom: string
  telephone: string
  adresse: string
  date_embauche: string
  photo: string
  role: string
  departement: string
  poste: string
  statut: string
  contrat_type: string
  contrat_duree: string
  contrat_pdf_url?: string
  salaire: string
  contact_urgence_nom: string
  contact_urgence_telephone: string
  contact_urgence_relation: string
  contact_urgence_adresse_physique: string
  situation_matrimoniale: string
}

interface BadgePreview {
  id: number
  user_id: number
  user_type: 'employe' | 'admin'
  token: string
  badgeId: string
  user_matricule?: string
  user_name?: string
  user_email?: string
  user_role?: string
  created_at: string
  expires_at?: string
  last_used?: string | null
  usage_count?: number
  status?: 'active' | 'inactive' | 'expired'
  qrCode?: string
  photo?: string
}

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super admin',
  admin: 'Admin',
  manager: 'Manager',
  hr: 'RH',
  chef_departement: 'Chef de département',
  employe: 'Employé',
  stagiaire: 'Stagiaire'
}

const ADMIN_ALLOWED_ROLES = new Set(['admin', 'super_admin', 'manager', 'hr'])
const ADMIN_EDIT_ROLES = new Set(['admin', 'super_admin'])

const formatRoleLabel = (role?: string) => {
  const key = String(role || 'admin').trim().toLowerCase()
  return ROLE_LABELS[key] || key.replace(/_/g, ' ')
}

const buildBadgeQrUrl = (token?: string, size = 260) => {
  const safeToken = String(token || '').trim()
  if (!safeToken) return ''
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(safeToken)}`
}

const badgeStatusClass = (status?: BadgePreview['status']) => {
  if (status === 'inactive') return 'bg-red-100 text-red-700 border-red-200'
  if (status === 'expired') return 'bg-yellow-100 text-yellow-700 border-yellow-200'
  return 'bg-green-100 text-green-700 border-green-200'
}

const badgeStatusLabel = (status?: BadgePreview['status']) => {
  if (status === 'inactive') return 'Inactif'
  if (status === 'expired') return 'Expire'
  return 'Actif'
}

const formatDateTime = (value?: string | null) => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('fr-FR')
}

const toDateInputValue = (value?: string) => {
  if (!value) return ''
  const asString = String(value)
  if (/^\d{4}-\d{2}-\d{2}/.test(asString)) {
    return asString.slice(0, 10)
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toISOString().slice(0, 10)
}

const extractFileName = (value?: string | null) => {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const clean = raw.split('?')[0]
  const parts = clean.split('/')
  return decodeURIComponent(parts[parts.length - 1] || '')
}

const buildFormDataFromAdmin = (admin: AdminDetail): AdminFormData => ({
  id: admin.id,
  matricule: admin.matricule || '',
  email: admin.email,
  email_pro: admin.emailPro || admin.email_pro || '',
  nom: admin.nom,
  prenom: admin.prenom,
  telephone: admin.telephone || '',
  adresse: admin.adresse || '',
  date_embauche: toDateInputValue(admin.date_embauche),
  photo: admin.photo || '',
  role: admin.role,
  departement: admin.departement,
  poste: admin.poste,
  statut: admin.statut,
  contrat_type: admin.contrat_type || '',
  contrat_duree: admin.contrat_duree || '',
  contrat_pdf_url: admin.contrat_pdf_url || '',
  salaire: admin.salaire === null ? '' : String(admin.salaire || ''),
  contact_urgence_nom: admin.contact_urgence_nom || '',
  contact_urgence_telephone: admin.contact_urgence_telephone || '',
  contact_urgence_relation: admin.contact_urgence_relation || '',
  contact_urgence_adresse_physique: admin.contact_urgence_adresse_physique || '',
  situation_matrimoniale: admin.situation_matrimoniale || ''
})

const AdminDetailPage: React.FC = () => {
  const { user, isLoading: authLoading } = useAuth()
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const location = useLocation()

  const [admin, setAdmin] = useState<AdminDetail | null>(null)
  const [formData, setFormData] = useState<AdminFormData>({
    id: 0,
    matricule: '',
    email: '',
    email_pro: '',
    nom: '',
    prenom: '',
    telephone: '',
    adresse: '',
    date_embauche: '',
    photo: '',
    role: '',
    departement: '',
    poste: '',
    statut: '',
    contrat_type: '',
    contrat_duree: '',
    contrat_pdf_url: '',
    salaire: '',
    contact_urgence_nom: '',
    contact_urgence_telephone: '',
    contact_urgence_relation: '',
    contact_urgence_adresse_physique: '',
    situation_matrimoniale: ''
  })
  const [roles, setRoles] = useState<RoleDefinition[]>([])
  const [badge, setBadge] = useState<BadgePreview | null>(null)
  const [badgeModalOpen, setBadgeModalOpen] = useState(false)
  
  const [loading, setLoading] = useState(true)
  const [loadingBadge, setLoadingBadge] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [uploadingContract, setUploadingContract] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [contractFileName, setContractFileName] = useState<string>('')
  const [idValidationError, setIdValidationError] = useState<string | null>(null)

  const contractFileInputRef = useRef<HTMLInputElement | null>(null)
  const canEditProfessional = useMemo(() => {
    const role = String(user?.role || '').toLowerCase()
    return ADMIN_EDIT_ROLES.has(role)
  }, [user?.role])

  const canEditPersonal = useMemo(() => {
    const role = String(user?.role || '').toLowerCase()
    return ADMIN_EDIT_ROLES.has(role) && role !== 'super_admin'
  }, [user?.role])

  const canEditId = useMemo(() => {
    const role = String(user?.role || '').toLowerCase()
    return role === 'super_admin'
  }, [user?.role])

  const resolvedPhotoUrl = useMemo(() => uploadService.resolvePhotoUrl(admin?.photo || ''), [admin?.photo])
  const initials = useMemo(
    () => `${admin?.prenom?.[0] || ''}${admin?.nom?.[0] || ''}`.toUpperCase(),
    [admin?.prenom, admin?.nom]
  )

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

    if (!id) {
      setError('Identifiant admin manquant.')
      setLoading(false)
      return
    }

    void Promise.all([loadRoles(), loadAdminDetail(Number(id)), loadAdminBadge(Number(id), undefined)])
  }, [authLoading, user, id, navigate])

  const loadRoles = async () => {
    try {
      const response = await apiClient.get<{ success: boolean; roles?: RoleDefinition[] }>('/admin/roles')
      if (response?.success && Array.isArray(response.roles)) {
        setRoles(response.roles.filter(r => r.scope === 'admin'))
      }
    } catch (error) {
      console.error('Erreur chargement rôles:', error)
    }
  }

  const loadAdminDetail = async (adminId: number) => {
    try {
      setLoading(true)
      setError(null)
      setSuccess(null)

      const response = await apiClient.get<any>(`/admins/${adminId}`)
      const current = response?.admin || response
      if (!current || !current.id) {
        throw new Error(response?.message || 'Admin introuvable')
      }
      setAdmin(current)
      setFormData(buildFormDataFromAdmin(current))
      setContractFileName(extractFileName(current.contrat_pdf_url || ''))
      
      // Charger le badge de l'admin avec le profil utilisateur
      await loadAdminBadge(adminId, current)
    } catch (loadError: any) {
      console.error('Erreur chargement detail admin:', loadError)
      setError('Impossible de charger les informations de cet admin.')
      setAdmin(null)
    } finally {
      setLoading(false)
    }
  }

  const loadAdminBadge = async (adminId: number, userProfile?: AdminDetail, retryCount = 0) => {
    try {
      setLoadingBadge(true)
      console.log(`🔄 Chargement du badge pour l'admin ID: ${adminId} (tentative ${retryCount + 1})`)

      // Utiliser le profil utilisateur passé en paramètre ou celui de l'état
      const currentProfile = userProfile || admin
      
      // Essayer les endpoints spécifiques pour les admins
      const endpoints = ['/api/admin/badge', '/api/badge/admin']
      let badgeFound = false
      
      for (const endpoint of endpoints) {
        try {
          console.log(`📡 Tentative endpoint: ${endpoint}`)
          const response = await apiClient.get<{ success: boolean; badge?: BadgePreview | null; message?: string }>(endpoint)
          console.log(`📋 Réponse de ${endpoint}:`, { success: response?.success, hasBadge: !!response?.badge })
          
          if (response?.success && response.badge?.token) {
            console.log(`✅ Badge trouvé via ${endpoint}:`, { 
              id: response.badge.id, 
              token: response.badge.token.substring(0, 10) + '...', 
              status: response.badge.status 
            })
            
            // Nettoyer et enrichir les données du badge
            const cleanedBadge = {
              ...response.badge,
              qrCode: buildBadgeQrUrl(response.badge.token),
              user_matricule: response.badge.user_matricule || response.badge.badgeId || currentProfile?.matricule || '',
              user_name: response.badge.user_name || `${currentProfile?.prenom} ${currentProfile?.nom}`,
              user_email: response.badge.user_email || currentProfile?.email,
              user_role: response.badge.user_role || currentProfile?.role,
              user_type: 'admin' as const
            }
            
            setBadge(cleanedBadge)
            console.log('🎯 Badge admin récupéré et nettoyé avec succès via endpoints admin')
            badgeFound = true
            return
          }
        } catch (endpointError: any) {
          console.log(`❌ Erreur endpoint ${endpoint}:`, endpointError?.message || endpointError?.status || 'Erreur inconnue')
          if (Number(endpointError?.status || 0) === 404) {
            console.log(`📍 Endpoint ${endpoint} non trouvé (404), essai suivant`)
            continue
          }
          console.log(`📍 Erreur autre que 404, continuation`)
        }
      }

      if (!badgeFound) {
        console.log('❌ Aucun badge trouvé via endpoints spécifiques, tentative fallback')
        
        // Fallback : chercher dans tous les badges
        try {
          const fallbackResponse = await apiClient.get<{ success: boolean; badges?: BadgePreview[]; message?: string }>('/api/badges?history=all')
          console.log(`📋 Réponse fallback:`, { success: fallbackResponse?.success, badgesCount: fallbackResponse?.badges?.length || 0 })
          
          if (fallbackResponse?.success && Array.isArray(fallbackResponse.badges)) {
            console.log(`📋 Recherche parmi ${fallbackResponse.badges.length} badges`)
            const fallbackBadge = fallbackResponse.badges
              .filter((entry) => Number(entry.user_id) === adminId && String(entry.user_type || 'admin') === 'admin')
              .sort((left, right) => {
                const leftTime = new Date(left.created_at || 0).getTime()
                const rightTime = new Date(right.created_at || 0).getTime()
                return rightTime - leftTime
              })[0] || null

            if (fallbackBadge && fallbackBadge.token) {
              console.log('✅ Badge trouvé via fallback:', { 
                id: fallbackBadge.id, 
                token: fallbackBadge.token.substring(0, 10) + '...', 
                status: fallbackBadge.status 
              })
              
              // Nettoyer et enrichir les données du badge
              const cleanedBadge = {
                ...fallbackBadge,
                qrCode: buildBadgeQrUrl(fallbackBadge.token),
                user_matricule: fallbackBadge.user_matricule || fallbackBadge.badgeId || currentProfile?.matricule || '',
                user_name: fallbackBadge.user_name || `${currentProfile?.prenom} ${currentProfile?.nom}`,
                user_email: fallbackBadge.user_email || currentProfile?.email,
                user_role: fallbackBadge.user_role || currentProfile?.role,
                user_type: 'admin' as const
              }
              
              setBadge(cleanedBadge)
              console.log('🎯 Badge admin récupéré et nettoyé avec succès via fallback')
              badgeFound = true
              return
            }
          }
        } catch (fallbackError: any) {
          console.log('❌ Erreur fallback:', fallbackError?.message || fallbackError?.status || 'Erreur inconnue')
        }
      }

      if (!badgeFound) {
        console.log('❌ Aucun badge trouvé pour cet admin après toutes les tentatives')
        setBadge(null)
        
        // Si aucun badge trouvé et que nous n'avons pas encore réessayé, attendre un peu et réessayer
        if (retryCount < 2) {
          console.log(`🔄 Aucun badge trouvé, nouvel essai dans 2 secondes...`)
          setTimeout(() => {
            loadAdminBadge(adminId, userProfile, retryCount + 1)
          }, 2000)
          return
        } else {
          console.log('❌ Nombre maximum de tentatives atteint, abandon')
        }
      }
    } catch (badgeError: any) {
      console.error('💥 Erreur générale chargement badge admin:', badgeError)
      
      // En cas d'erreur et si nous n'avons pas encore réessayé, attendre un peu et réessayer
      if (retryCount < 2) {
        console.log(`🔄 Erreur de chargement, nouvel essai dans 2 secondes...`)
        setTimeout(() => {
          loadAdminBadge(adminId, userProfile, retryCount + 1)
        }, 2000)
        return
      }
      
      setBadge(null)
    } finally {
      setLoadingBadge(false)
      console.log('🏁 Fin du chargement du badge admin')
    }
  }

  const validateIdUniqueness = async (newId: number, currentAdminId: number): Promise<boolean> => {
    try {
      const response = await apiClient.get<{ success: boolean; admins?: any[]; message?: string }>('/admins')
      if (response?.success && Array.isArray(response.admins)) {
        const duplicate = response.admins.find(admin => admin.id === newId && admin.id !== currentAdminId)
        if (duplicate) {
          setIdValidationError(`Cet ID admin (${newId}) est déjà attribué à ${duplicate.prenom} ${duplicate.nom}.`)
          return false
        }
      }
      setIdValidationError(null)
      return true
    } catch (error) {
      console.error('Erreur validation ID:', error)
      setIdValidationError('Impossible de vérifier l\'unicité de l\'ID.')
      return false
    }
  }

  const handleSave = async () => {
    if (!admin) return

    try {
      setSaving(true)
      setError(null)
      setIdValidationError(null)

      if (!canEditProfessional) {
        setError('Vous n avez pas les droits pour modifier les informations professionnelles.')
        return
      }

      // Validate ID uniqueness if ID is being changed and user has permission
      const newId = Number(formData.id)
      if (canEditId && newId !== admin.id) {
        const isIdUnique = await validateIdUniqueness(newId, admin.id)
        if (!isIdUnique) {
          setSaving(false)
          return
        }
      }

      if (uploadingContract) {
        setError('Patientez pendant le telechargement du contrat PDF.')
        setSaving(false)
        return
      }

      const payload = {
        ...formData,
        id: newId,
        salaire: formData.salaire === '' ? null : Number(formData.salaire)
      }

      // Validation basique
      if (!payload.email) {
        setError('L email professionnel est obligatoire.')
        setSaving(false)
        return
      }
      if (payload.salaire !== null && !Number.isFinite(payload.salaire)) {
        setError('Le salaire doit etre un nombre valide.')
        setSaving(false)
        return
      }

      const response = await apiClient.put<typeof payload, any>(
        `/admins/${admin.id}`,
        payload
      )

      if (response?.success) {
        setSuccess('Informations mises à jour avec succès.')
        await loadAdminDetail(admin.id)
        setIsEditing(false)
      } else {
        throw new Error(response?.message || 'Echec de la mise à jour')
      }
    } catch (saveError: any) {
      console.error('Erreur sauvegarde admin:', saveError)
      setError(saveError?.message || 'Impossible de sauvegarder les modifications.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!admin) return

    try {
      setDeleting(true)
      setError(null)

      const confirmed = window.confirm(`Supprimer ${admin.prenom} ${admin.nom} ? Cette action est irreversible.`)
      if (!confirmed) return

      const response = await apiClient.delete<{ success: boolean; message?: string }>(`/admins/${admin.id}`)
      if (response?.success) {
        setSuccess('Admin supprimé avec succès.')
        setTimeout(() => {
          navigate('/admin/admins')
        }, 1500)
      } else {
        throw new Error(response?.message || 'Echec de la suppression')
      }
    } catch (deleteError: any) {
      console.error('Erreur suppression admin:', deleteError)
      setError(deleteError?.message || 'Impossible de supprimer cet admin.')
    } finally {
      setDeleting(false)
    }
  }

  const handleCancel = () => {
    setIsEditing(false)
    if (admin) {
      setFormData(buildFormDataFromAdmin(admin))
    }
    setError(null)
    setSuccess(null)
    setIdValidationError(null)
  }

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !admin) return

    try {
      setUploadingContract(true)
      // Pour l'instant, on utilise le même endpoint que pour le contrat
      // TODO: Implémenter un endpoint spécifique pour les photos
      setError('Upload photo non encore implémenté pour les admins.')
    } catch (uploadError: any) {
      console.error('Erreur upload photo:', uploadError)
      setError('Impossible de telecharger la photo.')
    } finally {
      setUploadingContract(false)
    }
  }

  const handleContractUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !admin) return

    // Validate file type
    if (file.type !== 'application/pdf') {
      setError('Veuillez sélectionner un fichier PDF.')
      return
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      setError('Le fichier PDF ne doit pas dépasser 10MB.')
      return
    }

    try {
      setUploadingContract(true)
      setError(null)

      const formData = new FormData()
      formData.append('contract', file)
      formData.append('adminId', String(admin.id))

      const response = await apiClient.post<FormData, { success: boolean; contract_url?: string; message?: string }>(
        '/admins/upload-contract',
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data'
          }
        }
      )

      if (response?.success && response.contract_url) {
        setFormData(prev => ({ ...prev, contrat_pdf_url: response.contract_url }))
        setContractFileName(file.name)
        setSuccess('Contrat téléchargé avec succès.')
      } else {
        throw new Error(response?.message || 'Échec du téléchargement du contrat')
      }
    } catch (uploadError: any) {
      console.error('Erreur upload contrat:', uploadError)
      setError(uploadError?.message || 'Impossible de télécharger le contrat.')
    } finally {
      setUploadingContract(false)
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  if (authLoading || loading) {
    return (
      <LayoutFix title="Detail admin">
        <div className="flex justify-center items-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      </LayoutFix>
    )
  }

  if (!admin) {
    return (
      <LayoutFix title="Detail admin">
        <div className="bg-white rounded-xl shadow-sm p-7 text-center text-red-600">
          Admin introuvable.
        </div>
      </LayoutFix>
    )
  }

  return (
    <LayoutFix title="Detail admin">
      <div className="xp-form max-w-5xl mx-auto space-y-7">
        <section className="bg-white rounded-xl shadow-sm p-7">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate('/admin/admins')}
                className="px-3 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50"
              >
                Retour liste
              </button>

              <div className="w-16 h-16 rounded-lg bg-purple-100 text-purple-700 overflow-hidden flex items-center justify-center text-xl font-semibold">
                {resolvedPhotoUrl ? (
                  <img src={resolvedPhotoUrl} alt="Photo admin" className="w-full h-full object-cover" />
                ) : (
                  initials
                )}
              </div>

              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  {admin.prenom} {admin.nom}
                </h1>
                <p className="text-sm text-gray-500">
                  {formatRoleLabel(admin.role)} • {admin.departement || 'Non spécifié'}
                </p>
              </div>
            </div>

            {!isEditing ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm hover:bg-red-700 disabled:opacity-50"
                >
                  {deleting ? 'Suppression...' : 'Supprimer'}
                </button>
                {canEditProfessional ? (
                  <button
                    onClick={() => setIsEditing(true)}
                    className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700"
                  >
                    Modifier
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCancel}
                  disabled={saving}
                  className="px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Annuler
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? 'Enregistrement...' : 'Enregistrer'}
                </button>
              </div>
            )}
          </div>
        </section>

        {error ? (
          <section className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
            {error}
          </section>
        ) : null}

        {idValidationError ? (
          <section className="bg-yellow-50 border border-yellow-200 text-yellow-700 px-4 py-3 rounded-lg">
            {idValidationError}
          </section>
        ) : null}

        {success ? (
          <section className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg">
            {success}
          </section>
        ) : null}

        <section className="bg-white rounded-xl shadow-sm p-7">
          <div className="flex items-center justify-between gap-4 mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Badge d'authentification</h2>
            {badge ? (
              <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${badgeStatusClass(badge.status)}`}>
                {badgeStatusLabel(badge.status)}
              </span>
            ) : null}
          </div>

          {loadingBadge ? (
            <div className="text-sm text-gray-500">Chargement du badge...</div>
          ) : badge?.token ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 flex items-center justify-center">
                <button
                  type="button"
                  onClick={() => setBadgeModalOpen(true)}
                  className="rounded-lg border border-gray-200 bg-white p-3 hover:shadow-md transition-shadow"
                  title="Afficher le badge en grand"
                >
                  <img
                    src={badge.qrCode || buildBadgeQrUrl(badge.token, 220)}
                    alt="Badge QR admin"
                    className="w-[220px] h-[220px] object-contain"
                  />
                </button>
              </div>

              <div>
                <div className="space-y-2">
                  <p className="text-sm font-bold text-gray-900">{badge.badgeId || admin.badgeId || `Badge-${badge.id}`}</p>
                  <div className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${badgeStatusClass(badge.status)}`}>
                    {badgeStatusLabel(badge.status)}
                  </div>
                </div>
                
                {/* Informations du badge */}
                <div className="space-y-2 text-sm text-gray-700 mt-4">
                  <p><strong>Matricule:</strong> {badge.user_matricule || admin.matricule || '-'}</p>
                  <p><strong>Token:</strong> <span className="font-mono break-all">{badge.token}</span></p>
                  <p><strong>Dernière utilisation:</strong> {formatDateTime(badge.last_used)}</p>
                  <p><strong>Expiration:</strong> {formatDateTime(badge.expires_at)}</p>
                  <p><strong>Utilisations:</strong> {Number(badge.usage_count || 0)}</p>
                  <p className="text-xs text-gray-500 mt-2">Cliquez sur l'aperçu QR pour ouvrir le badge en grand.</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-8">
              <div className="w-20 h-20 mx-auto bg-gray-200 rounded-full flex items-center justify-center mb-4">
                <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2" />
                </svg>
              </div>
              <p className="text-sm text-gray-500 font-medium">Aucun badge associé</p>
              <p className="text-xs text-gray-400 mt-1">Contactez l'administrateur pour créer un badge</p>
              <button
                onClick={() => navigate('/admin/badges')}
                className="mt-4 px-4 py-2 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 transition-colors duration-200 text-sm font-medium"
              >
                Gérer les badges
              </button>
            </div>
          )}
        </section>

        <section className="bg-white rounded-xl shadow-sm p-7">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Informations personnelles</h2>
          <fieldset disabled={!isEditing} className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="xp-form-label">ID admin</label>
              <input
                type="text"
                name="id"
                value={formData.id ? String(formData.id) : ''}
                onChange={handleInputChange}
                className="xp-form-input"
                disabled={!isEditing || !canEditId}
              />
              {!canEditId && (
                <p className="text-xs text-gray-500 mt-1">Identifiant modifiable uniquement par le super admin.</p>
              )}
            </div>

            <div>
              <label className="xp-form-label">Matricule</label>
              <input
                type="text"
                name="matricule"
                value={formData.matricule}
                onChange={handleInputChange}
                className="xp-form-input"
                disabled={!isEditing || !canEditProfessional}
              />
              {!canEditProfessional && (
                <p className="text-xs text-gray-500 mt-1">Modifiable uniquement par les administrateurs autorisés.</p>
              )}
            </div>

            <div>
              <label className="xp-form-label">Nom</label>
              <input
                type="text"
                name="nom"
                value={formData.nom}
                onChange={handleInputChange}
                className="xp-form-input"
                disabled={!canEditPersonal}
              />
            </div>

            <div>
              <label className="xp-form-label">Prenom</label>
              <input
                type="text"
                name="prenom"
                value={formData.prenom}
                onChange={handleInputChange}
                className="xp-form-input"
                disabled={!canEditPersonal}
              />
            </div>

            <div>
              <label className="xp-form-label">Email personnel</label>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleInputChange}
                className="xp-form-input"
                disabled={!canEditPersonal}
              />
            </div>

            <div>
              <label className="xp-form-label">Email professionnel</label>
              <input
                type="email"
                name="email_pro"
                value={formData.email_pro}
                onChange={handleInputChange}
                className="xp-form-input"
                disabled={!canEditPersonal}
              />
            </div>

            <div>
              <label className="xp-form-label">Telephone</label>
              <input
                type="tel"
                name="telephone"
                value={formData.telephone}
                onChange={handleInputChange}
                className="xp-form-input"
                disabled={!canEditPersonal}
              />
            </div>

            <div>
              <label className="xp-form-label">Situation matrimoniale</label>
              <select
                name="situation_matrimoniale"
                value={formData.situation_matrimoniale}
                onChange={handleInputChange}
                className="xp-form-input"
                disabled={!canEditPersonal}
              >
                <option value="">Non renseignee</option>
                <option value="celibataire">Celibataire</option>
                <option value="marie(e)">Marie(e)</option>
                <option value="divorce(e)">Divorce(e)</option>
                <option value="veuf(ve)">Veuf(ve)</option>
              </select>
            </div>

            <div className="md:col-span-2">
              <label className="xp-form-label">Adresse</label>
              <textarea
                name="adresse"
                value={formData.adresse}
                onChange={handleInputChange}
                rows={3}
                className="xp-form-input"
                disabled={!canEditPersonal}
              />
            </div>
          </fieldset>
        </section>

        <section className="bg-white rounded-xl shadow-sm p-7">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Contact d'urgence (lecture seule)</h2>
          <fieldset disabled className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="xp-form-label">Nom</label>
              <input
                type="text"
                name="contact_urgence_nom"
                value={formData.contact_urgence_nom}
                onChange={handleInputChange}
                className="xp-form-input"
              />
            </div>

            <div>
              <label className="xp-form-label">Telephone</label>
              <input
                type="tel"
                name="contact_urgence_telephone"
                value={formData.contact_urgence_telephone}
                onChange={handleInputChange}
                className="xp-form-input"
              />
            </div>

            <div>
              <label className="xp-form-label">Relation</label>
              <input
                type="text"
                name="contact_urgence_relation"
                value={formData.contact_urgence_relation}
                onChange={handleInputChange}
                className="xp-form-input"
              />
            </div>

            <div className="md:col-span-2">
              <label className="xp-form-label">Adresse physique du contact d'urgence</label>
              <textarea
                name="contact_urgence_adresse_physique"
                value={formData.contact_urgence_adresse_physique}
                onChange={handleInputChange}
                rows={2}
                className="xp-form-input"
              />
            </div>
          </fieldset>
        </section>

        <section className="bg-white rounded-xl shadow-sm p-7">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Informations professionnelles</h2>
            <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${canEditProfessional ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
              {canEditProfessional ? 'Edition reservee aux roles administration' : 'Lecture seule'}
            </span>
          </div>

          <fieldset disabled={!isEditing || !canEditProfessional} className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="xp-form-label">Role</label>
              <select
                name="role"
                value={formData.role}
                onChange={handleInputChange}
                className="xp-form-input"
              >
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="xp-form-label">Departement</label>
              <input
                type="text"
                name="departement"
                value={formData.departement}
                onChange={handleInputChange}
                className="xp-form-input"
              />
            </div>

            <div>
              <label className="xp-form-label">Poste</label>
              <input
                type="text"
                name="poste"
                value={formData.poste}
                onChange={handleInputChange}
                className="xp-form-input"
              />
            </div>

            <div>
              <label className="xp-form-label">Statut</label>
              <select
                name="statut"
                value={formData.statut}
                onChange={handleInputChange}
                className="xp-form-input"
              >
                <option value="actif">Actif</option>
                <option value="inactif">Inactif</option>
                <option value="suspendu">Suspendu</option>
              </select>
            </div>

            <div>
              <label className="xp-form-label">Date d'embauche</label>
              <input
                type="date"
                name="date_embauche"
                value={formData.date_embauche}
                onChange={handleInputChange}
                className="xp-form-input"
              />
            </div>

            <div>
              <label className="xp-form-label">Type de contrat</label>
              <select
                name="contrat_type"
                value={formData.contrat_type}
                onChange={handleInputChange}
                className="xp-form-input"
              >
                <option value="">Non specifie</option>
                <option value="cdi">CDI</option>
                <option value="cdd">CDD</option>
                <option value="stage">Stage</option>
                <option value="alternance">Alternance</option>
                <option value="freelance">Freelance</option>
              </select>
            </div>

            <div>
              <label className="xp-form-label">Duree du contrat</label>
              <input
                type="text"
                name="contrat_duree"
                value={formData.contrat_duree}
                onChange={handleInputChange}
                placeholder="ex: 6 mois, 1 an, etc."
                className="xp-form-input"
              />
            </div>

            <div>
              <label className="xp-form-label">Salaire</label>
              <input
                type="number"
                name="salaire"
                value={formData.salaire === null ? '' : formData.salaire}
                onChange={handleInputChange}
                placeholder="Salaire mensuel brut"
                className="xp-form-input"
              />
            </div>

            <div className="md:col-span-2">
              <label className="xp-form-label">Contrat PDF</label>
              <div className="space-y-3">
                {formData.contrat_pdf_url ? (
                  <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center space-x-3 flex-1 min-w-0">
                        <div className="w-10 h-10 rounded-lg bg-red-100 flex items-center justify-center flex-shrink-0">
                          <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                          </svg>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {extractFileName(formData.contrat_pdf_url)}
                          </p>
                          <p className="text-xs text-gray-500">Contrat de travail</p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2 flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => formData.contrat_pdf_url && window.open(formData.contrat_pdf_url, '_blank')}
                          className="px-3 py-1.5 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors flex items-center space-x-1"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          </svg>
                          <span>Aperçu</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const link = document.createElement('a')
                            if (formData.contrat_pdf_url) {
                              link.href = formData.contrat_pdf_url
                              link.download = extractFileName(formData.contrat_pdf_url)
                              document.body.appendChild(link)
                              link.click()
                              document.body.removeChild(link)
                            }
                          }}
                          className="px-3 py-1.5 text-sm bg-green-100 text-green-700 rounded hover:bg-green-200 transition-colors flex items-center space-x-1"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          <span>Télécharger</span>
                        </button>
                      </div>
                    </div>
                    <div className="text-xs text-gray-500">
                      Taille maximale: 10MB • Format: PDF
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8 border-2 border-dashed border-gray-300 rounded-lg">
                    <div className="w-12 h-12 mx-auto bg-gray-200 rounded-full flex items-center justify-center mb-3">
                      <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <p className="text-sm text-gray-500 mb-1">Aucun contrat PDF téléchargé</p>
                    <p className="text-xs text-gray-400">Téléchargez le contrat de travail de l'administrateur</p>
                  </div>
                )}
                
                {isEditing && canEditProfessional && (
                  <div>
                    <input
                      type="file"
                      accept=".pdf"
                      onChange={handleContractUpload}
                      className="hidden"
                      id="contract-upload"
                      disabled={uploadingContract}
                    />
                    <label
                      htmlFor="contract-upload"
                      className={`inline-flex items-center px-4 py-2 text-sm rounded-lg cursor-pointer transition-colors ${
                        uploadingContract
                          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                          : 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                      }`}
                    >
                      <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                      {uploadingContract ? 'Téléchargement...' : formData.contrat_pdf_url ? 'Remplacer le contrat' : 'Télécharger un contrat'}
                    </label>
                    <p className="text-xs text-gray-500 mt-1">
                      {uploadingContract ? 'Veuillez patienter...' : 'PDF uniquement • Maximum 10MB'}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </fieldset>
        </section>
      </div>

      {/* Modal Badge */}
      {badgeModalOpen && badge && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setBadgeModalOpen(false)
            }
          }}
        >
          <div className="bg-white rounded-xl p-8 max-w-md w-full mx-4 relative" onClick={(e) => e.stopPropagation()}>
            {/* Bouton fermer en haut à droite */}
            <button
              onClick={() => setBadgeModalOpen(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors duration-200"
              title="Fermer"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            {/* Contenu principal du badge */}
            <div className="text-center space-y-6">
              {/* Photo et informations principales */}
              <div className="flex flex-col items-center space-y-4">
                {/* Photo de profil */}
                <div className="w-24 h-24 bg-gradient-to-br from-purple-600 to-pink-600 rounded-full flex items-center justify-center shadow-lg">
                  {badge.photo ? (
                    <img src={badge.photo} alt="Badge" className="w-full h-full rounded-full object-cover" />
                  ) : (
                    <span className="text-3xl font-bold text-white">{initials}</span>
                  )}
                </div>
                
                {/* Nom et rôle */}
                <div>
                  <h3 className="text-xl font-bold text-gray-900">{admin.prenom} {admin.nom}</h3>
                  <p className="text-sm text-gray-600 mt-1">{formatRoleLabel(admin.role)}</p>
                </div>
              </div>

              {/* Carte d'informations du badge */}
              <div className="bg-gray-50 rounded-xl p-6 space-y-4 border border-gray-200">
                <div className="text-center mb-4">
                  <div className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${badgeStatusClass(badge.status)}`}>
                    {badgeStatusLabel(badge.status)}
                  </div>
                </div>

                {/* QR Code centré */}
                <div className="flex justify-center">
                  <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
                    <img 
                      src={badge.qrCode || buildBadgeQrUrl(badge.token, 200)} 
                      alt="QR Code" 
                      className="w-32 h-32"
                    />
                  </div>
                </div>

                {/* Informations détaillées */}
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between items-center py-2 border-b border-gray-200">
                    <span className="text-gray-600 font-medium">Matricule</span>
                    <span className="font-mono text-gray-900 font-semibold">{badge.user_matricule || admin.matricule || '-'}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-gray-200">
                    <span className="text-gray-600 font-medium">Token</span>
                    <span className="font-mono text-gray-900 text-xs break-all max-w-[200px]">{badge.token}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-gray-200">
                    <span className="text-gray-600 font-medium">Département</span>
                    <span className="text-gray-900">{admin.departement || '-'}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-gray-200">
                    <span className="text-gray-600 font-medium">Poste</span>
                    <span className="text-gray-900">{admin.poste || '-'}</span>
                  </div>
                  <div className="flex justify-between items-center py-2">
                    <span className="text-gray-600 font-medium">Email</span>
                    <span className="text-gray-900 text-xs break-all max-w-[200px]">{admin.email || '-'}</span>
                  </div>
                </div>
              </div>

              {/* Bouton Fermer */}
              <div>
                <button
                  onClick={() => setBadgeModalOpen(false)}
                  className="w-full px-4 py-3 bg-gradient-to-r from-gray-600 to-gray-700 text-white rounded-lg hover:from-gray-700 hover:to-gray-800 transition-all duration-200 shadow-md hover:shadow-lg font-medium"
                >
                  Fermer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </LayoutFix>
  )
}

export default AdminDetailPage
