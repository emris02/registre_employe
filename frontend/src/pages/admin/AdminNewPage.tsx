import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import LayoutFix from '../../components/LayoutFix'
import { useAuth } from '../../services/authService'
import { apiClient } from '../../services/apiClient'
import { uploadService } from '../../services/uploadService'
import '../../styles/components/identifiers-ultra.css'

interface NewAdmin {
  id?: number
  matricule?: string
  nom: string
  prenom: string
  email: string
  email_pro?: string
  role: string
  departement: string
  poste: string
  telephone?: string
  adresse?: string
  situation_matrimoniale?: string
  date_embauche: string
  contratType?: string
  contratDuree?: string
  contrat_pdf_url?: string
  statut: string
  contact_urgence_nom?: string
  contact_urgence_telephone?: string
  contact_urgence_relation?: string
  contact_urgence_adresse_physique?: string
  photo?: string
  password?: string
  confirm_password?: string
}

interface RoleDefinition {
  id: string
  label: string
  scope?: 'admin' | 'employee'
}

const FALLBACK_ADMIN_ROLES: RoleDefinition[] = [
  { id: 'super_admin', label: 'Super admin', scope: 'admin' },
  { id: 'admin', label: 'Admin', scope: 'admin' },
  { id: 'manager', label: 'Manager', scope: 'admin' },
  { id: 'hr', label: 'RH', scope: 'admin' },
  { id: 'chef_departement', label: 'Chef de departement', scope: 'admin' },
  { id: 'comptable', label: 'Comptable', scope: 'admin' }
]

const isBlobUrl = (value: string) => value.startsWith('blob:')
const PREVIEW_ROLE_PREFIX: Record<string, string> = {
  super_admin: 'SAD',
  admin: 'ADM',
  manager: 'MGR',
  hr: 'RHS',
  chef_departement: 'CHD',
  comptable: 'CPT',
  stagiaire: 'STG',
  employe: 'EMP'
}

const buildPreviewMatricule = (id: number, role: string) => {
  const year = new Date().getFullYear()
  const normalizedRole = String(role || '').trim().toLowerCase() || 'admin'
  const prefix = PREVIEW_ROLE_PREFIX[normalizedRole] || 'ADM'
  return `${prefix}-${year}-${String(Math.max(1, id)).padStart(4, '0')}`
}

export default function AdminNewPage() {
  const { user, isLoading } = useAuth()
  const navigate = useNavigate()

  const canEditPersonal = useMemo(() => {
    const role = String(user?.role || '').toLowerCase()
    // En création, tous les admins peuvent modifier les infos personnelles
    return ['admin', 'super_admin', 'manager', 'hr'].includes(role)
  }, [user?.role])

  const canEditProfessional = useMemo(() => {
    const role = String(user?.role || '').toLowerCase()
    return ['admin', 'super_admin', 'manager', 'hr'].includes(role)
  }, [user?.role])

  const [formData, setFormData] = useState<NewAdmin>({
    nom: '',
    prenom: '',
    email: '',
    email_pro: '',
    role: 'admin',
    departement: '',
    poste: '',
    telephone: '',
    adresse: '',
    date_embauche: new Date().toISOString().split('T')[0],
    contratType: '',
    contratDuree: '',
    contrat_pdf_url: '',
    statut: 'actif',
    situation_matrimoniale: '',
    contact_urgence_nom: '',
    contact_urgence_telephone: '',
    contact_urgence_relation: '',
    contact_urgence_adresse_physique: '',
    photo: '',
    password: '',
    confirm_password: ''
  })
  const [saving, setSaving] = useState(false)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [uploadingContract, setUploadingContract] = useState(false)
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState('')
  const [contractFileName, setContractFileName] = useState('')
  const contractFileInputRef = useRef<HTMLInputElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [generatedIds, setGeneratedIds] = useState<{ id: number; matricule: string } | null>(null)
  const [loadingIdentifiers, setLoadingIdentifiers] = useState(false)
  const [roles, setRoles] = useState<RoleDefinition[]>(FALLBACK_ADMIN_ROLES)

  const resolvedPhotoUrl = useMemo(
    () => photoPreviewUrl || uploadService.resolvePhotoUrl(formData.photo),
    [formData.photo, photoPreviewUrl]
  )

  const resolvedContractUrl = useMemo(() => String(formData.contrat_pdf_url || '').trim(), [formData.contrat_pdf_url])

  const loadRoles = async () => {
    try {
      const response = await apiClient.get<{ success: boolean; roles?: RoleDefinition[] }>('/api/roles?scope=admin')
      if (response?.success && Array.isArray(response.roles) && response.roles.length > 0) {
        setRoles(response.roles)
      } else {
        setRoles(FALLBACK_ADMIN_ROLES)
      }
    } catch (rolesError) {
      console.error('Erreur chargement roles creation admin:', rolesError)
      setRoles(FALLBACK_ADMIN_ROLES)
    }
  }

  const loadIdentifierPreview = useCallback(async (roleValue: string) => {
    const normalizedRole = String(roleValue || '').trim().toLowerCase() || 'admin'
    try {
      setLoadingIdentifiers(true)
      const query = new URLSearchParams()
      query.set('role', normalizedRole)
      const response = await apiClient.get<{ success?: boolean; id?: number; matricule?: string }>(
        `/api/admin/admins/identifier-preview?${query.toString()}`
      )

      const previewId = Number(response?.id || 0)
      const previewMatricule = String(response?.matricule || '').trim()
      if (Number.isInteger(previewId) && previewId > 0 && previewMatricule) {
        setGeneratedIds({
          id: previewId,
          matricule: previewMatricule
        })
        return
      }
    } catch (identifierError) {
      console.error('Erreur chargement apercu identifiants admin:', identifierError)
    } finally {
      setLoadingIdentifiers(false)
    }

    setGeneratedIds((previous) => {
      const fallbackId = Math.max(1, Number(previous?.id || 1))
      return {
        id: fallbackId,
        matricule: buildPreviewMatricule(fallbackId, normalizedRole)
      }
    })
  }, [])

  useEffect(() => {
    if (isLoading) return

    if (!user || !['admin', 'super_admin', 'manager', 'hr'].includes(user.role)) {
      navigate('/admin')
      return
    }

    void loadRoles()
  }, [isLoading, navigate, user])

  useEffect(() => {
    if (isLoading) return
    if (!user || !['admin', 'super_admin', 'manager', 'hr'].includes(user.role)) return

    const previewRefresh = window.setTimeout(() => {
      void loadIdentifierPreview(formData.role)
    }, 180)

    return () => {
      window.clearTimeout(previewRefresh)
    }
  }, [
    formData.role,
    formData.nom,
    formData.prenom,
    formData.departement,
    formData.poste,
    isLoading,
    loadIdentifierPreview,
    user
  ])

  useEffect(() => {
    return () => {
      if (isBlobUrl(photoPreviewUrl)) {
        URL.revokeObjectURL(photoPreviewUrl)
      }
    }
  }, [photoPreviewUrl])

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = event.target
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  const handlePhotoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      setUploadingPhoto(true)
      setError(null)

      const previewUrl = URL.createObjectURL(file)
      setPhotoPreviewUrl(previewUrl)

      // Utiliser la méthode correcte du service upload
      const uploadUrl = await uploadService.uploadProfilePhoto(file)
      setFormData(prev => ({ ...prev, photo: uploadUrl }))
    } catch (uploadError: any) {
      console.error('Erreur upload photo admin:', uploadError)
      setError('Impossible de télécharger la photo.')
      setPhotoPreviewUrl('')
    } finally {
      setUploadingPhoto(false)
    }
  }

  const handleContractUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      setUploadingContract(true)
      setError(null)

      // Utiliser la méthode correcte du service upload
      const uploadUrl = await uploadService.uploadContractPdf(file)
      setFormData(prev => ({ ...prev, contrat_pdf_url: uploadUrl }))
      setContractFileName(file.name)
    } catch (uploadError: any) {
      console.error('Erreur upload contrat admin:', uploadError)
      setError('Impossible de télécharger le contrat.')
    } finally {
      setUploadingContract(false)
    }
  }

  const validateForm = (): string | null => {
    if (!formData.nom.trim()) return 'Le nom est obligatoire.'
    if (!formData.prenom.trim()) return 'Le prénom est obligatoire.'
    if (!formData.email.trim()) return 'L\'email est obligatoire.'
    if (!formData.email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) return 'L\'email n\'est pas valide.'
    if (!formData.role) return 'Le rôle est obligatoire.'
    if (!formData.departement.trim()) return 'Le département est obligatoire.'
    if (!formData.poste.trim()) return 'Le poste est obligatoire.'
    if (!formData.date_embauche) return 'La date d\'embauche est obligatoire.'
    if (!formData.password) return 'Le mot de passe est obligatoire.'
    if (formData.password.length < 8) return 'Le mot de passe doit contenir au moins 8 caractères.'
    if (formData.password !== formData.confirm_password) return 'Les mots de passe ne correspondent pas.'

    return null
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()

    const validationError = validateForm()
    if (validationError) {
      setError(validationError)
      return
    }

    try {
      setSaving(true)
      setError(null)

      const payload = {
        nom: formData.nom.trim(),
        prenom: formData.prenom.trim(),
        email: formData.email.trim(),
        email_pro: formData.email_pro?.trim() || undefined,
        role: formData.role,
        departement: formData.departement.trim(),
        poste: formData.poste.trim(),
        telephone: formData.telephone?.trim() || undefined,
        adresse: formData.adresse?.trim() || undefined,
        situation_matrimoniale: formData.situation_matrimoniale || undefined,
        date_embauche: formData.date_embauche,
        contrat_type: formData.contratType || undefined,
        contrat_duree: formData.contratDuree || undefined,
        contrat_pdf_url: resolvedContractUrl || undefined,
        statut: formData.statut,
        contact_urgence_nom: formData.contact_urgence_nom?.trim() || undefined,
        contact_urgence_telephone: formData.contact_urgence_telephone?.trim() || undefined,
        contact_urgence_relation: formData.contact_urgence_relation || undefined,
        contact_urgence_adresse_physique: formData.contact_urgence_adresse_physique?.trim() || undefined,
        photo: formData.photo || undefined,
        password: formData.password,
        sendEmail: true
      }

      const response = await apiClient.post('/admins', payload) as any
      
      if (response?.success) {
        const emailStatus = response?.credentials_email
        const emailSent = Boolean(emailStatus?.sent)
        const emailError = String(emailStatus?.error || '').trim()
        const emailInfo = emailSent
          ? `Identifiants envoyes par email a ${formData.email.trim()}.`
          : emailError
            ? `Email non envoye: ${emailError}`
            : 'Email non envoye.'

        setSuccess(`Admin cree avec succes! ${emailInfo}`)
        setGeneratedIds({
          id: response.admin?.id || 0,
          matricule: response.admin?.matricule || ''
        })
        
        setTimeout(() => {
          navigate('/admin/admins')
        }, 2000)
      } else {
        throw new Error(response?.message || 'Échec de la création')
      }
    } catch (createError: any) {
      console.error('Erreur creation admin:', createError)
      setError(createError?.message || 'Impossible de créer cet admin.')
    } finally {
      setSaving(false)
    }
  }

  const initials = useMemo(
    () => `${(formData.prenom?.[0] || 'A').toUpperCase()}${(formData.nom?.[0] || 'D').toUpperCase()}`,
    [formData.nom, formData.prenom]
  )

  if (isLoading) {
    return (
      <LayoutFix>
        <div className="flex items-center justify-center min-h-screen">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      </LayoutFix>
    )
  }

  return (
    <LayoutFix>
      <div className="min-h-screen bg-gray-50 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Header */}
          <div className="mb-8">
            <div className="flex items-center space-x-4">
              <button
                onClick={() => navigate('/admin/admins')}
                className="p-2 text-gray-600 hover:text-gray-900 transition-colors duration-200"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <div>
                <h1 className="text-2xl font-bold text-gray-900 flex items-center">
                  <svg className="w-6 h-6 mr-2 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                  </svg>
                  Nouvel admin
                </h1>
                <p className="text-sm text-gray-500">Ajouter un nouvel administrateur au système</p>
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-8">
            {/* Section Identifiants - Style EmployeNewPage */}
            <div className="identifiers-section">
              <div className="identifiers-header">
                <h2 className="identifiers-title">Identifiants générés automatiquement</h2>
                <p className="identifiers-subtitle">Prévisualisation en temps réel pendant la saisie</p>
              </div>
              <div className="identifiers-particles">
                <div className="particle"></div>
                <div className="particle"></div>
                <div className="particle"></div>
                <div className="particle"></div>
                <div className="particle"></div>
                <div className="particle"></div>
              </div>
              <div className="identifiers-grid">
                <div className="identifier-card id-card">
                  <div className="identifier-label">ID (généré automatiquement)</div>
                  <div className="identifier-value-container">
                    <div className="identifier-value">{loadingIdentifiers ? '...' : (generatedIds?.id || '---')}</div>
                  </div>
                  <p className="identifier-description">Aperçu base en temps réel pendant la saisie.</p>
                </div>

                <div className="identifier-card matricule-card">
                  <div className="identifier-label">Matricule (généré automatiquement)</div>
                  <div className="identifier-value-container">
                    <div className="identifier-value">{loadingIdentifiers ? '...' : (generatedIds?.matricule || '---')}</div>
                  </div>
                  <p className="identifier-description">Régénération live selon rôle + séquence actuelle.</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
              {/* Colonne gauche - Photo et Aperçu */}
              <div className="lg:col-span-1 space-y-6">
                {/* Photo */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                  <div className="p-6">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Photo</h3>
                    <div className="text-center">
                      <div className="w-32 h-32 mx-auto bg-gray-200 rounded-full flex items-center justify-center mb-4">
                        {resolvedPhotoUrl ? (
                          <img src={resolvedPhotoUrl} alt="Photo" className="w-full h-full rounded-full object-cover" />
                        ) : (
                          <span className="text-3xl font-bold text-gray-600">{initials}</span>
                        )}
                      </div>
                      <div>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handlePhotoUpload}
                          className="hidden"
                          id="photo-upload"
                        />
                        <label
                          htmlFor="photo-upload"
                          className="inline-block px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 cursor-pointer"
                        >
                          {uploadingPhoto ? 'Upload...' : 'Ajouter une photo'}
                        </label>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Aperçu */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                  <div className="p-6">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Aperçu</h3>
                    <div className="space-y-3">
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-500">ID prévu:</span>
                        <span className="text-sm font-medium">
                          {loadingIdentifiers ? '...' : generatedIds?.id || '-'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-500">Matricule prévu:</span>
                        <span className="text-sm font-medium font-mono">
                          {loadingIdentifiers ? '...' : generatedIds?.matricule || '-'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-500">Rôle:</span>
                        <span className="text-sm font-medium">
                          {roles.find(r => r.id === formData.role)?.label || formData.role}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Colonne droite - Formulaire */}
              <div className="lg:col-span-3 space-y-6">
                {/* Informations personnelles */}
                <div className="bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden hover:shadow-xl transition-shadow duration-300">
                  <div className="bg-gradient-to-r from-gray-50 to-gray-100 px-6 py-4 border-b border-gray-200">
                    <h3 className="text-lg font-semibold text-gray-900 flex items-center">
                      <svg className="w-5 h-5 mr-2 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      Informations personnelles
                      {user?.role === 'super_admin' && (
                        <span className="ml-2 px-2 py-1 bg-orange-100 text-orange-700 text-xs rounded-full">Non modifiable</span>
                      )}
                    </h3>
                  </div>
                  <div className="p-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div>
                        <label className="xp-form-label">Nom *</label>
                        <input
                          type="text"
                          name="nom"
                          value={formData.nom}
                          onChange={handleInputChange}
                          className="xp-form-input"
                          required
                          disabled={!canEditPersonal}
                          placeholder="Dupont"
                        />
                        <p className="text-xs text-gray-500 mt-1">Obligatoire</p>
                      </div>

                      <div>
                        <label className="xp-form-label">Prénom *</label>
                        <input
                          type="text"
                          name="prenom"
                          value={formData.prenom}
                          onChange={handleInputChange}
                          className="xp-form-input"
                          required
                          disabled={!canEditPersonal}
                          placeholder="Jean"
                        />
                        <p className="text-xs text-gray-500 mt-1">Obligatoire</p>
                      </div>

                      <div>
                        <label className="xp-form-label">Email *</label>
                        <input
                          type="email"
                          name="email"
                          value={formData.email}
                          onChange={handleInputChange}
                          className="xp-form-input"
                          required
                          disabled={!canEditPersonal}
                          placeholder="jean.dupont@xpertpro.com"
                        />
                        <p className="text-xs text-gray-500 mt-1">Obligatoire - utilisé pour la connexion.</p>
                      </div>

                      <div>
                        <label className="xp-form-label">Téléphone</label>
                        <input
                          type="tel"
                          name="telephone"
                          value={formData.telephone}
                          onChange={handleInputChange}
                          className="xp-form-input"
                          disabled={!canEditPersonal}
                          placeholder="+33 6 12 34 56 78"
                        />
                        <p className="text-xs text-gray-500 mt-1">Optionnel</p>
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
                          <option value="">Non renseignée</option>
                          <option value="celibataire">Célibataire</option>
                          <option value="marie(e)">Marié(e)</option>
                          <option value="divorce(e)">Divorcé(e)</option>
                          <option value="veuf(ve)">Veuf(ve)</option>
                        </select>
                        <p className="text-xs text-gray-500 mt-1">Optionnel</p>
                      </div>

                      <div className="md:col-span-3">
                        <label className="xp-form-label">Adresse</label>
                        <textarea
                          name="adresse"
                          value={formData.adresse}
                          onChange={handleInputChange}
                          rows={3}
                          className="xp-form-input"
                          disabled={!canEditPersonal}
                          placeholder="123 Rue de la République, 75001 Paris"
                        />
                        <p className="text-xs text-gray-500 mt-1">Optionnel</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Contact d'urgence */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                  <div className="p-6">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Contact d'urgence</h3>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
                        <label className="xp-form-label">Téléphone</label>
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
                        <select
                          name="contact_urgence_relation"
                          value={formData.contact_urgence_relation}
                          onChange={handleInputChange}
                          className="xp-form-input"
                        >
                          <option value="">Sélectionner</option>
                          <option value="conjoint">Conjoint</option>
                          <option value="parent">Parent</option>
                          <option value="frere">Frère</option>
                          <option value="soeur">Sœur</option>
                          <option value="ami">Ami</option>
                          <option value="autre">Autre</option>
                        </select>
                      </div>

                      <div className="md:col-span-2">
                        <label className="xp-form-label">Adresse</label>
                        <textarea
                          name="contact_urgence_adresse_physique"
                          value={formData.contact_urgence_adresse_physique}
                          onChange={handleInputChange}
                          rows={2}
                          className="xp-form-input"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Informations professionnelles */}
                <div className="bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden hover:shadow-xl transition-shadow duration-300">
                  <div className="bg-gradient-to-r from-blue-50 to-indigo-100 px-6 py-4 border-b border-gray-200">
                    <h3 className="text-lg font-semibold text-gray-900 flex items-center">
                      <svg className="w-5 h-5 mr-2 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                      Informations professionnelles
                      {canEditProfessional && (
                        <span className="ml-2 px-2 py-1 bg-green-100 text-green-700 text-xs rounded-full">Modifiable</span>
                      )}
                    </h3>
                  </div>
                  <div className="p-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div>
                        <label className="xp-form-label">Rôle *</label>
                        <select
                          name="role"
                          value={formData.role}
                          onChange={handleInputChange}
                          className="xp-form-input"
                          required
                          disabled={!canEditProfessional}
                        >
                          {roles.map((role) => (
                            <option key={role.id} value={role.id}>
                              {role.label}
                            </option>
                          ))}
                        </select>
                        <p className="text-xs text-gray-500 mt-1">Détermine les permissions de l'utilisateur.</p>
                      </div>

                      <div>
                        <label className="xp-form-label">Département *</label>
                        <input
                          type="text"
                          name="departement"
                          value={formData.departement}
                          onChange={handleInputChange}
                          className="xp-form-input"
                          required
                          disabled={!canEditProfessional}
                          placeholder="Direction Générale"
                        />
                        <p className="text-xs text-gray-500 mt-1">Obligatoire</p>
                      </div>

                      <div>
                        <label className="xp-form-label">Poste *</label>
                        <input
                          type="text"
                          name="poste"
                          value={formData.poste}
                          onChange={handleInputChange}
                          className="xp-form-input"
                          required
                          disabled={!canEditProfessional}
                          placeholder="Administrateur Système"
                        />
                        <p className="text-xs text-gray-500 mt-1">Obligatoire</p>
                      </div>

                      <div>
                        <label className="xp-form-label">Statut</label>
                        <select
                          name="statut"
                          value={formData.statut}
                          onChange={handleInputChange}
                          className="xp-form-input"
                          disabled={!canEditProfessional}
                        >
                          <option value="actif">Actif</option>
                          <option value="inactif">Inactif</option>
                          <option value="suspendu">Suspendu</option>
                        </select>
                        <p className="text-xs text-gray-500 mt-1">Statut de l'administrateur</p>
                      </div>

                      <div>
                        <label className="xp-form-label">Email professionnel</label>
                        <input
                          type="email"
                          name="email_pro"
                          value={formData.email_pro}
                          onChange={handleInputChange}
                          className="xp-form-input"
                          disabled={!canEditProfessional}
                          placeholder="jean.dupont@entreprise.com"
                        />
                        <p className="text-xs text-gray-500 mt-1">Optionnel</p>
                        {user?.role === 'super_admin' && (
                          <p className="text-xs text-blue-600 mt-1">✓ Modifiable par super_admin</p>
                        )}
                      </div>

                      <div>
                        <label className="xp-form-label">Date d'embauche</label>
                        <input
                          type="date"
                          name="date_embauche"
                          value={formData.date_embauche}
                          onChange={handleInputChange}
                          className="xp-form-input"
                          disabled={!canEditProfessional}
                        />
                        <p className="text-xs text-gray-500 mt-1">Optionnel</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Sécurité */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                  <div className="p-6">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Sécurité</h3>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="md:col-span-2">
                        <label className="xp-form-label">Mot de passe *</label>
                        <input
                          type="password"
                          name="password"
                          value={formData.password}
                          onChange={handleInputChange}
                          className="xp-form-input"
                          required
                          placeholder="••••••••"
                        />
                        <p className="text-xs text-gray-500 mt-1">Obligatoire - minimum 8 caractères</p>
                      </div>

                      <div className="md:col-span-2">
                        <label className="xp-form-label">Confirmer le mot de passe *</label>
                        <input
                          type="password"
                          name="confirm_password"
                          value={formData.confirm_password}
                          onChange={handleInputChange}
                          className="xp-form-input"
                          required
                          placeholder="••••••••"
                        />
                        <p className="text-xs text-gray-500 mt-1">Obligatoire - doit correspondre au mot de passe</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Messages */}
            {error && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-red-700">{error}</p>
              </div>
            )}

            {success && (
              <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-green-700">{success}</p>
                {generatedIds && (
                  <div className="mt-2 text-sm">
                    <p>ID: {generatedIds.id}</p>
                    <p>Matricule: {generatedIds.matricule}</p>
                  </div>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end space-x-4">
              <button
                type="button"
                onClick={() => navigate('/admin/admins')}
                className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-all duration-200 flex items-center"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Annuler
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-6 py-2 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-lg hover:from-blue-700 hover:to-blue-800 disabled:opacity-50 transition-all duration-200 shadow-md hover:shadow-lg transform hover:-translate-y-0.5 flex items-center"
              >
                {saving ? (
                  <>
                    <svg className="w-4 h-4 mr-2 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Création...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Créer l'admin
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </LayoutFix>
  )
}
