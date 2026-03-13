import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import LayoutFix from '../../components/LayoutFix'
import { useAuth } from '../../services/authService'
import { apiClient } from '../../services/apiClient'
import { uploadService } from '../../services/uploadService'
import '../../styles/components/identifiers-ultra.css'

interface NewEmploye {
  id?: number
  matricule?: string
  nom: string
  prenom: string
  email: string
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
}

interface RoleDefinition {
  id: string
  label: string
  scope?: 'admin' | 'employee'
}

const FALLBACK_EMPLOYEE_ROLES: RoleDefinition[] = [
  { id: 'manager', label: 'Manager', scope: 'employee' },
  { id: 'chef_departement', label: 'Chef de departement', scope: 'employee' },
  { id: 'comptable', label: 'Comptable', scope: 'employee' },
  { id: 'stagiaire', label: 'Stagiaire', scope: 'employee' },
  { id: 'employe', label: 'Employe', scope: 'employee' }
]

const isBlobUrl = (value: string) => value.startsWith('blob:')

const generateRandomPassword = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*'
  let password = ''
  for (let i = 0; i < 12; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return password
}
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
  const normalizedRole = String(role || '').trim().toLowerCase() || 'employe'
  const prefix = PREVIEW_ROLE_PREFIX[normalizedRole] || 'EMP'
  return `${prefix}-${year}-${String(Math.max(1, id)).padStart(4, '0')}`
}

export default function EmployeNewPage() {
  const { user, isLoading } = useAuth()
  const navigate = useNavigate()

  const [formData, setFormData] = useState<NewEmploye>({
    nom: '',
    prenom: '',
    email: '',
    role: 'employe',
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
    photo: ''
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
  const [roles, setRoles] = useState<RoleDefinition[]>(FALLBACK_EMPLOYEE_ROLES)
  const [sendCredentialsEmail, setSendCredentialsEmail] = useState(true)
  const [useCustomPassword, setUseCustomPassword] = useState(false)
  const [customPassword, setCustomPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [generatedPassword, setGeneratedPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  const resolvedPhotoUrl = useMemo(
    () => photoPreviewUrl || uploadService.resolvePhotoUrl(formData.photo),
    [formData.photo, photoPreviewUrl]
  )

  const resolvedContractUrl = useMemo(() => String(formData.contrat_pdf_url || '').trim(), [formData.contrat_pdf_url])

  const loadRoles = async () => {
    try {
      const response = await apiClient.get<{ success: boolean; roles?: RoleDefinition[] }>('/api/roles?scope=employee')
      if (response?.success && Array.isArray(response.roles) && response.roles.length > 0) {
        setRoles(response.roles)
      } else {
        setRoles(FALLBACK_EMPLOYEE_ROLES)
      }
    } catch (rolesError) {
      console.error('Erreur chargement roles creation employe:', rolesError)
      setRoles(FALLBACK_EMPLOYEE_ROLES)
    }
  }

  const loadIdentifierPreview = useCallback(async (roleValue: string) => {
    const normalizedRole = String(roleValue || '').trim().toLowerCase() || 'employe'
    try {
      setLoadingIdentifiers(true)
      const query = new URLSearchParams()
      query.set('role', normalizedRole)
      const response = await apiClient.get<{ success?: boolean; id?: number; matricule?: string }>(
        `/api/admin/employes/identifier-preview?${query.toString()}`
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
      console.error('Erreur chargement apercu identifiants employe:', identifierError)
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
    setFormData((prev) => ({
      ...prev,
      [name]: value
    }))
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
      setSuccess('Photo de profil ajoutee.')
    } catch (uploadError: any) {
      console.error('Erreur upload photo employe:', uploadError)
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

  const handleOpenContractPicker = () => {
    if (uploadingContract) return
    contractFileInputRef.current?.click()
  }

  const handleContractChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    try {
      setUploadingContract(true)
      setError(null)
      const contractUrl = await uploadService.uploadContractPdf(file)
      setFormData((prev) => ({ ...prev, contrat_pdf_url: contractUrl }))
      setContractFileName(file.name)
      setSuccess('Contrat PDF ajoute.')
    } catch (uploadError: any) {
      console.error('Erreur upload contrat employe:', uploadError)
      setError(uploadError?.message || "Impossible d'ajouter le contrat PDF.")
    } finally {
      setUploadingContract(false)
    }
  }

  const handleRemoveContract = () => {
    setFormData((prev) => ({ ...prev, contrat_pdf_url: '' }))
    setContractFileName('')
  }

  const handleSave = async () => {
    try {
      setSaving(true)
      setError(null)

      if (!formData.nom || !formData.prenom || !formData.email) {
        setError('Les champs nom, prenom et email sont obligatoires.')
        return
      }

      if (uploadingPhoto || uploadingContract) {
        setError('Patientez, un telechargement est en cours.')
        return
      }

      let passwordToUse = ''
      let passwordGenerated = false
      if (useCustomPassword) {
        const trimmedPassword = customPassword.trim()
        if (!trimmedPassword) {
          setError('Le mot de passe est obligatoire.')
          return
        }
        if (trimmedPassword.length < 8) {
          setError('Le mot de passe doit contenir au moins 8 caracteres.')
          return
        }
        if (trimmedPassword !== confirmPassword) {
          setError('Les mots de passe ne correspondent pas.')
          return
        }
        passwordToUse = trimmedPassword
        setGeneratedPassword('')
      } else {
        passwordToUse = generateRandomPassword()
        passwordGenerated = true
        setGeneratedPassword(passwordToUse)
      }

      const response = await apiClient.post<NewEmploye, any>(
        '/api/admin/employes',
        { ...formData, password: passwordToUse, sendEmail: sendCredentialsEmail }
      )
      const created = response?.employe || response
      if (!created || !created.id) {
        throw new Error(response?.message || "Erreur lors de la creation de l'employe.")
      }

      const emailStatus = created?.credentials_email
      const emailSent = Boolean(emailStatus?.sent)
      const emailError = String(emailStatus?.error || '').trim()
      const emailInfo = sendCredentialsEmail
        ? emailSent
          ? `Email envoye a ${formData.email}`
          : emailError
            ? `Email non envoye: ${emailError}`
            : `Email non envoye`
        : 'Email non demande'

      const passwordInfo = passwordGenerated ? `Mot de passe genere: ${passwordToUse}` : 'Mot de passe enregistre.'
      setSuccess(`Employe cree avec succes. ${passwordInfo} ${emailInfo}`)
      window.setTimeout(() => {
        navigate('/admin/employes')
      }, 2000)
    } catch (createError) {
      console.error('Erreur creation employe:', createError)
      setError("Erreur lors de la creation de l'employe.")
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = () => {
    navigate('/admin/employes')
  }

  return (
    <LayoutFix title="Nouvel employe">
      <div className="xp-form max-w-5xl mx-auto space-y-6">
        <div className="bg-white rounded-xl shadow-sm p-7">
          <div className="flex flex-wrap justify-between items-center gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Ajouter un nouvel employe</h1>
              <p className="text-gray-600">Remplissez les informations pour creer un nouvel employe.</p>
            </div>
            <div className="flex space-x-2">
              <button
                onClick={handleCancel}
                disabled={saving || uploadingPhoto || uploadingContract}
                className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                Annuler
              </button>
              <button
                onClick={handleSave}
                disabled={saving || uploadingPhoto || uploadingContract}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {saving ? 'Creation...' : uploadingPhoto ? 'Upload photo...' : uploadingContract ? 'Upload contrat...' : "Creer l'employe"}
              </button>
            </div>
          </div>
        </div>

        {error ? (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
            {error}
          </div>
        ) : null}
        {success ? (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-6">
            {success}
          </div>
        ) : null}

        <div className="bg-white rounded-xl shadow-sm p-7">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold text-gray-900">Informations de base</h3>
            <div className="flex items-center space-x-2">
              <div className="w-3 h-3 bg-blue-500 rounded-full animate-pulse"></div>
              <span className="text-sm text-gray-600">Generation automatique en direct</span>
            </div>
          </div>

          <div className="mb-6 rounded-lg border border-gray-200 p-4 bg-gray-50">
            <label className="xp-form-label">Photo de profil</label>
            <div className="flex flex-wrap items-center gap-4">
              <div className="w-24 h-24 rounded-lg bg-gray-200 overflow-hidden flex items-center justify-center text-2xl font-semibold text-gray-500">
                {resolvedPhotoUrl ? (
                  <img src={resolvedPhotoUrl} alt="Photo employe" className="w-full h-full object-cover" />
                ) : (
                  `${(formData.prenom?.[0] || 'E').toUpperCase()}${(formData.nom?.[0] || 'M').toUpperCase()}`
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
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
                {formData.photo || photoPreviewUrl ? (
                  <button
                    type="button"
                    onClick={handleRemovePhoto}
                    className="px-3 py-2 rounded-lg border border-red-300 text-sm text-red-700 hover:bg-red-50"
                  >
                    Retirer
                  </button>
                ) : null}
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-2">Formats: JPG, PNG, WEBP, GIF. Taille max: 5 Mo.</p>
          </div>

          <div className="identifiers-container">
            <div className="particles">
              <div className="particle"></div>
              <div className="particle"></div>
              <div className="particle"></div>
              <div className="particle"></div>
              <div className="particle"></div>
            </div>
            <div className="identifiers-grid">
              <div className="identifier-card id-card">
                <div className="identifier-label">ID (genere automatiquement)</div>
                <div className="identifier-value-container">
                  <div className="identifier-value">{loadingIdentifiers ? '...' : (generatedIds?.id || '---')}</div>
                </div>
                <p className="identifier-description">Apercu base en temps reel pendant la saisie.</p>
              </div>

              <div className="identifier-card matricule-card">
                <div className="identifier-label">Matricule (genere automatiquement)</div>
                <div className="identifier-value-container">
                  <div className="identifier-value">{loadingIdentifiers ? '...' : (generatedIds?.matricule || '---')}</div>
                </div>
                <p className="identifier-description">Regeneration live selon role + sequence actuelle.</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-7">
            <div>
              <label className="xp-form-label">Nom *</label>
              <input
                type="text"
                name="nom"
                value={formData.nom}
                onChange={handleInputChange}
                required
                className="xp-form-input"
                placeholder="Dupont"
              />
              <p className="text-xs text-gray-500 mt-1">Obligatoire</p>
            </div>
            <div>
              <label className="xp-form-label">Prenom *</label>
              <input
                type="text"
                name="prenom"
                value={formData.prenom}
                onChange={handleInputChange}
                required
                className="xp-form-input"
                placeholder="Jean"
              />
              <p className="text-xs text-gray-500 mt-1">Obligatoire</p>
            </div>
            <div>
              <label className="xp-form-label">Email professionnel *</label>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleInputChange}
                required
                className="xp-form-input"
                placeholder="jean.dupont@xpertpro.com"
              />
              <p className="text-xs text-gray-500 mt-1">Obligatoire - utilise pour la connexion.</p>
            </div>
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
              <p className="text-xs text-gray-500 mt-1">Determine les permissions de l'utilisateur.</p>
            </div>
          </div>

          <div className="mt-6 rounded-lg border border-gray-200 p-4 bg-gray-50">
            <label className="xp-form-label">Contrat de travail (PDF)</label>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleOpenContractPicker}
                disabled={uploadingContract}
                className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {uploadingContract ? 'Telechargement...' : 'Choisir un PDF'}
              </button>
              <input
                ref={contractFileInputRef}
                type="file"
                accept="application/pdf"
                onChange={handleContractChange}
                onClick={(event) => {
                  event.currentTarget.value = ''
                }}
                disabled={uploadingContract}
                className="hidden"
              />
              {resolvedContractUrl ? (
                <a
                  href={resolvedContractUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-2 rounded-lg border border-blue-300 text-sm text-blue-700 hover:bg-blue-50"
                >
                  Ouvrir le PDF
                </a>
              ) : null}
              {resolvedContractUrl ? (
                <button
                  type="button"
                  onClick={handleRemoveContract}
                  className="px-3 py-2 rounded-lg border border-red-300 text-sm text-red-700 hover:bg-red-50"
                >
                  Retirer
                </button>
              ) : null}
            </div>
            <p className="text-xs text-gray-500 mt-2">
              {contractFileName ? `Fichier: ${contractFileName}` : 'Format: PDF. Taille max: 10 Mo.'}
            </p>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-7">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Informations professionnelles</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-7">
            <div>
              <label className="xp-form-label">Departement</label>
              <input
                type="text"
                name="departement"
                value={formData.departement}
                onChange={handleInputChange}
                className="xp-form-input"
                placeholder="IT, RH, Ventes..."
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
                placeholder="Developpeur, Manager..."
              />
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
              <input
                type="text"
                name="contratType"
                value={formData.contratType || ''}
                onChange={handleInputChange}
                className="xp-form-input"
                placeholder="CDI, CDD, Stage..."
              />
            </div>
            <div>
              <label className="xp-form-label">Duree contrat</label>
              <input
                type="text"
                name="contratDuree"
                value={formData.contratDuree || ''}
                onChange={handleInputChange}
                className="xp-form-input"
                placeholder="12 mois, indefini..."
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
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-7">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Securite</h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-7">
            <div className="flex items-center gap-2">
              <input
                id="send_credentials_email"
                type="checkbox"
                checked={sendCredentialsEmail}
                onChange={(event) => setSendCredentialsEmail(event.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor="send_credentials_email" className="text-sm text-gray-700">
                Envoyer les identifiants par email
              </label>
            </div>

            <div className="flex items-center gap-2">
              <input
                id="use_custom_password"
                type="checkbox"
                checked={useCustomPassword}
                onChange={(event) => {
                  const checked = event.target.checked
                  setUseCustomPassword(checked)
                  setCustomPassword('')
                  setConfirmPassword('')
                  setShowPassword(false)
                  setShowConfirmPassword(false)
                  if (checked) setGeneratedPassword('')
                }}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor="use_custom_password" className="text-sm text-gray-700">
                Definir un mot de passe manuellement
              </label>
            </div>
          </div>

          {useCustomPassword ? (
            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-7">
              <div>
                <label className="xp-form-label">Mot de passe</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={customPassword}
                    onChange={(event) => setCustomPassword(event.target.value)}
                    className="xp-form-input pr-10"
                    placeholder="Minimum 8 caracteres"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((previous) => !previous)}
                    className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-500 hover:text-gray-700"
                    aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-2">Minimum 8 caracteres.</p>
              </div>

              <div>
                <label className="xp-form-label">Confirmer le mot de passe</label>
                <div className="relative">
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    className="xp-form-input pr-10"
                    placeholder="Doit correspondre"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword((previous) => !previous)}
                    className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-500 hover:text-gray-700"
                    aria-label={showConfirmPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                  >
                    {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-6 rounded-lg border border-gray-200 p-4 bg-gray-50">
              <p className="text-sm text-gray-700">
                Un mot de passe aleatoire sera genere lors de la creation.
              </p>
              {generatedPassword ? (
                <div className="mt-3 rounded-md border border-gray-200 bg-white p-3 font-mono text-sm break-all">
                  {generatedPassword}
                </div>
              ) : (
                <p className="text-xs text-gray-500 mt-2">Le mot de passe sera affiche ici apres creation.</p>
              )}
            </div>
          )}

          <p className="text-xs text-gray-500 mt-4">
            Conseil: l'utilisateur pourra changer son mot de passe apres la premiere connexion.
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-7">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Informations personnelles</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-7">
            <div>
              <label className="xp-form-label">Telephone</label>
              <input
                type="tel"
                name="telephone"
                value={formData.telephone}
                onChange={handleInputChange}
                className="xp-form-input"
                placeholder="0612345678"
              />
            </div>
            <div>
              <label className="xp-form-label">Situation matrimoniale</label>
              <select
                name="situation_matrimoniale"
                value={formData.situation_matrimoniale}
                onChange={handleInputChange}
                className="xp-form-input"
              >
                <option value="">Non renseignee</option>
                <option value="celibataire">Celibataire</option>
                <option value="marie(e)">Marie(e)</option>
                <option value="divorce(e)">Divorce(e)</option>
                <option value="veuf(ve)">Veuf(ve)</option>
              </select>
            </div>
            <div>
              <label className="xp-form-label">Adresse</label>
              <textarea
                name="adresse"
                value={formData.adresse}
                onChange={handleInputChange}
                rows={3}
                className="xp-form-input"
                placeholder="123 Rue de la Tech, 75001 Paris"
              />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-7">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Contact d'urgence</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-7">
            <div>
              <label className="xp-form-label">Nom du contact</label>
              <input
                type="text"
                name="contact_urgence_nom"
                value={formData.contact_urgence_nom}
                onChange={handleInputChange}
                className="xp-form-input"
                placeholder="Marie Dupont"
              />
            </div>
            <div>
              <label className="xp-form-label">Telephone du contact</label>
              <input
                type="tel"
                name="contact_urgence_telephone"
                value={formData.contact_urgence_telephone}
                onChange={handleInputChange}
                className="xp-form-input"
                placeholder="0987654321"
              />
            </div>
            <div>
              <label className="xp-form-label">Relation</label>
              <input
                type="text"
                name="contact_urgence_relation"
                value={formData.contact_urgence_relation}
                onChange={handleInputChange}
                placeholder="Ex: Conjoint, Frere, Mere..."
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
                placeholder="Adresse complete du contact en cas d'urgence"
                className="xp-form-input"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end space-x-4 pt-2">
          <button
            onClick={handleCancel}
            disabled={saving || uploadingPhoto || uploadingContract}
            className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            onClick={handleSave}
            disabled={saving || uploadingPhoto || uploadingContract}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {saving ? 'Creation...' : uploadingPhoto ? 'Upload photo...' : uploadingContract ? 'Upload contrat...' : "Creer l'employe"}
          </button>
        </div>
      </div>
    </LayoutFix>
  )
}
