import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiClient } from '../../services/apiClient'
import { useAuth } from '../../services/authService'
import { DashboardSettings, settingsService } from '../../services/settingsService'

interface EmployeProfile {
  nom?: string
  prenom?: string
  telephone?: string
  adresse?: string
  situation_matrimoniale?: string
  contact_urgence_nom?: string
  contact_urgence_telephone?: string
  contact_urgence_relation?: string
  contact_urgence_adresse_physique?: string
}

const EMPLOYEE_ALLOWED_ROLES = new Set(['employe', 'chef_departement', 'stagiaire'])

const DEFAULT_PROFILE_FORM = {
  nom: '',
  prenom: '',
  telephone: '',
  adresse: '',
  situation_matrimoniale: '',
  contact_urgence_nom: '',
  contact_urgence_telephone: '',
  contact_urgence_relation: '',
  contact_urgence_adresse_physique: ''
}

const SettingsPage: React.FC = () => {
  const { user, logout, updateProfile, isLoading: authLoading } = useAuth()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)
  const [profileForm, setProfileForm] = useState(DEFAULT_PROFILE_FORM)
  const [settingsForm, setSettingsForm] = useState<DashboardSettings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const isUnauthorizedError = useCallback((err: unknown) => {
    const payload = err as { status?: number; message?: string }
    const status = Number(payload?.status || 0)
    if (status === 401 || status === 403) return true
    const message = String(payload?.message || '').toLowerCase()
    return message.includes('401') || message.includes('403') || message.includes('token')
  }, [])

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const [profileResponse, settingsResponse] = await Promise.all([
        apiClient.get<{ success: boolean; user?: EmployeProfile; message?: string }>('/api/auth/validate'),
        settingsService.getMySettings()
      ])

      if (!profileResponse?.success || !profileResponse.user) {
        throw new Error(profileResponse?.message || 'Profil introuvable')
      }

      setProfileForm({
        nom: profileResponse.user.nom || '',
        prenom: profileResponse.user.prenom || '',
        telephone: profileResponse.user.telephone || '',
        adresse: profileResponse.user.adresse || '',
        situation_matrimoniale: profileResponse.user.situation_matrimoniale || '',
        contact_urgence_nom: profileResponse.user.contact_urgence_nom || '',
        contact_urgence_telephone: profileResponse.user.contact_urgence_telephone || '',
        contact_urgence_relation: profileResponse.user.contact_urgence_relation || '',
        contact_urgence_adresse_physique: profileResponse.user.contact_urgence_adresse_physique || ''
      })
      setSettingsForm(settingsResponse)
    } catch (loadError: unknown) {
      console.error('Erreur chargement parametres employe:', loadError)
      if (isUnauthorizedError(loadError)) {
        logout()
        navigate('/login', { replace: true })
        return
      }
      setError('Impossible de charger vos parametres.')
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
      if (role === 'admin' || role === 'super_admin' || role === 'manager' || role === 'hr') {
        navigate('/admin', { replace: true })
      } else {
        navigate('/login', { replace: true })
      }
      return
    }

    void loadData()
  }, [authLoading, loadData, navigate, user])

  const handleSaveProfile = async () => {
    try {
      setSavingProfile(true)
      setError(null)
      setSuccess(null)

      const payload = {
        nom: profileForm.nom.trim(),
        prenom: profileForm.prenom.trim(),
        telephone: profileForm.telephone.trim(),
        adresse: profileForm.adresse.trim(),
        situation_matrimoniale: profileForm.situation_matrimoniale.trim(),
        contact_urgence_nom: profileForm.contact_urgence_nom.trim(),
        contact_urgence_telephone: profileForm.contact_urgence_telephone.trim(),
        contact_urgence_relation: profileForm.contact_urgence_relation.trim(),
        contact_urgence_adresse_physique: profileForm.contact_urgence_adresse_physique.trim()
      }

      const result = await updateProfile(payload)
      if (!result.success) {
        throw new Error(result.error || 'Mise a jour impossible')
      }

      setSuccess('Informations personnelles mises a jour.')
    } catch (saveError: unknown) {
      console.error('Erreur sauvegarde profil employe:', saveError)
      setError('Erreur lors de la sauvegarde du profil.')
    } finally {
      setSavingProfile(false)
    }
  }

  const handleSaveSettings = async () => {
    if (!settingsForm) return

    try {
      setSavingSettings(true)
      setError(null)
      setSuccess(null)
      const updated = await settingsService.updateMySettings(settingsForm)
      setSettingsForm(updated)
      window.localStorage.setItem('dashboard_sidebar_collapsed', updated.compact_sidebar ? '1' : '0')
      window.dispatchEvent(new Event('dashboard-sidebar-collapsed-change'))
      setSuccess('Parametres employe enregistres.')
    } catch (saveError: unknown) {
      console.error('Erreur sauvegarde parametres employe:', saveError)
      setError('Erreur lors de la sauvegarde des parametres.')
    } finally {
      setSavingSettings(false)
    }
  }

  if (loading || !settingsForm) {
    return (
      <section className="php-card">
        <div className="php-card-body">Chargement des parametres...</div>
      </section>
    )
  }

  return (
    <div className="space-y-6">
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

      <section className="php-card">
        <div className="php-card-header">
          <h2 className="php-card-title">Mon profil personnel</h2>
          <button
            onClick={() => void handleSaveProfile()}
            disabled={savingProfile}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {savingProfile ? 'Enregistrement...' : 'Enregistrer profil'}
          </button>
        </div>
        <div className="php-card-body grid grid-cols-1 md:grid-cols-2 gap-4">
          <input
            value={profileForm.prenom}
            onChange={(event) => setProfileForm((prev) => ({ ...prev, prenom: event.target.value }))}
            placeholder="Prenom"
            className="px-3 py-2 border border-gray-300 rounded-lg"
          />
          <input
            value={profileForm.nom}
            onChange={(event) => setProfileForm((prev) => ({ ...prev, nom: event.target.value }))}
            placeholder="Nom"
            className="px-3 py-2 border border-gray-300 rounded-lg"
          />
          <input
            value={profileForm.telephone}
            onChange={(event) => setProfileForm((prev) => ({ ...prev, telephone: event.target.value }))}
            placeholder="Telephone"
            className="px-3 py-2 border border-gray-300 rounded-lg"
          />
          <input
            value={profileForm.situation_matrimoniale}
            onChange={(event) => setProfileForm((prev) => ({ ...prev, situation_matrimoniale: event.target.value }))}
            placeholder="Situation matrimoniale"
            className="px-3 py-2 border border-gray-300 rounded-lg"
          />
          <input
            value={profileForm.contact_urgence_nom}
            onChange={(event) => setProfileForm((prev) => ({ ...prev, contact_urgence_nom: event.target.value }))}
            placeholder="Contact urgence - nom"
            className="px-3 py-2 border border-gray-300 rounded-lg"
          />
          <input
            value={profileForm.contact_urgence_telephone}
            onChange={(event) => setProfileForm((prev) => ({ ...prev, contact_urgence_telephone: event.target.value }))}
            placeholder="Contact urgence - telephone"
            className="px-3 py-2 border border-gray-300 rounded-lg"
          />
          <input
            value={profileForm.contact_urgence_relation}
            onChange={(event) => setProfileForm((prev) => ({ ...prev, contact_urgence_relation: event.target.value }))}
            placeholder="Contact urgence - relation"
            className="px-3 py-2 border border-gray-300 rounded-lg"
          />
          <input
            value={profileForm.contact_urgence_adresse_physique}
            onChange={(event) => setProfileForm((prev) => ({ ...prev, contact_urgence_adresse_physique: event.target.value }))}
            placeholder="Contact urgence - adresse"
            className="px-3 py-2 border border-gray-300 rounded-lg"
          />
          <textarea
            value={profileForm.adresse}
            onChange={(event) => setProfileForm((prev) => ({ ...prev, adresse: event.target.value }))}
            placeholder="Adresse personnelle"
            className="md:col-span-2 px-3 py-2 border border-gray-300 rounded-lg"
            rows={3}
          />
        </div>
      </section>

      <section className="php-card">
        <div className="php-card-header">
          <h2 className="php-card-title">Preferences utilisateur</h2>
          <button
            onClick={() => void handleSaveSettings()}
            disabled={savingSettings}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {savingSettings ? 'Enregistrement...' : 'Enregistrer preferences'}
          </button>
        </div>
        <div className="php-card-body php-list">
          <div className="php-list-item">
            <div>
              <strong>Sidebar compacte</strong>
              <small>Affichage réduit en mode icones</small>
            </div>
            <input
              type="checkbox"
              checked={settingsForm.compact_sidebar}
              onChange={(event) => setSettingsForm((prev) => prev ? { ...prev, compact_sidebar: event.target.checked } : prev)}
            />
          </div>
          <div className="php-list-item">
            <div>
              <strong>Notifications e-mail</strong>
              <small>Alertes de pointage et demandes</small>
            </div>
            <input
              type="checkbox"
              checked={settingsForm.notifications_email}
              onChange={(event) => setSettingsForm((prev) => prev ? { ...prev, notifications_email: event.target.checked } : prev)}
            />
          </div>
          <div className="php-list-item">
            <div>
              <strong>Rapport quotidien</strong>
              <small>Recevoir un resume quotidien</small>
            </div>
            <input
              type="checkbox"
              checked={settingsForm.daily_reports}
              onChange={(event) => setSettingsForm((prev) => prev ? { ...prev, daily_reports: event.target.checked } : prev)}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <select
              value={settingsForm.language}
              onChange={(event) =>
                setSettingsForm((prev) => prev ? { ...prev, language: event.target.value === 'en' ? 'en' : 'fr' } : prev)
              }
              className="px-3 py-2 border border-gray-300 rounded-lg"
            >
              <option value="fr">Francais</option>
              <option value="en">English</option>
            </select>
            <select
              value={settingsForm.theme}
              onChange={(event) =>
                setSettingsForm((prev) => {
                  if (!prev) return prev
                  const value = event.target.value
                  if (value === 'sombre' || value === 'systeme') return { ...prev, theme: value }
                  return { ...prev, theme: 'clair' }
                })
              }
              className="px-3 py-2 border border-gray-300 rounded-lg"
            >
              <option value="clair">Theme clair</option>
              <option value="sombre">Theme sombre</option>
              <option value="systeme">Theme systeme</option>
            </select>
            <input
              type="number"
              min={30}
              max={600}
              step={30}
              value={settingsForm.dashboard_auto_refresh_seconds}
              onChange={(event) =>
                setSettingsForm((prev) => prev
                  ? { ...prev, dashboard_auto_refresh_seconds: Number(event.target.value || 60) }
                  : prev)
              }
              className="px-3 py-2 border border-gray-300 rounded-lg"
              placeholder="Auto-refresh (sec)"
            />
          </div>
        </div>
      </section>

      <section className="php-card">
        <div className="php-card-header">
          <h2 className="php-card-title">Actions compte</h2>
        </div>
        <div className="php-card-body">
          <button
            onClick={() => {
              logout()
              navigate('/login', { replace: true })
            }}
            className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm hover:bg-red-700"
          >
            Se deconnecter
          </button>
        </div>
      </section>
    </div>
  )
}

export default SettingsPage
