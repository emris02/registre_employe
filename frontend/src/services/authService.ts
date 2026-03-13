// Service d'authentification pour Xpert Pro
import { useEffect, useMemo, useState } from 'react'
import { apiClient } from './apiClient'

export interface User {
  id: number
  matricule?: string
  nom: string
  prenom: string
  email: string
  role: 'admin' | 'super_admin' | 'manager' | 'chef_departement' | 'stagiaire' | 'hr' | 'employe'
  departement?: string
  telephone?: string
  adresse?: string
  photo?: string
  statut?: string
  poste?: string
  date_embauche?: string
  contrat_type?: string
  contrat_duree?: string
  contrat_pdf_url?: string
  situation_matrimoniale?: string
  contact_urgence_nom?: string
  contact_urgence_telephone?: string
  contact_urgence_relation?: string
  contact_urgence_adresse_physique?: string
  created_at?: string
  updated_at?: string
}

export interface AuthState {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null
}

class AuthService {
  private static instance: AuthService
  private authState: AuthState = {
    user: null,
    isAuthenticated: false,
    isLoading: true,
    error: null
  }
  private listeners: ((state: AuthState) => void)[] = []

  private constructor() {
    this.initializeAuth()
  }

  static getInstance(): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService()
    }
    return AuthService.instance
  }

  private async initializeAuth() {
    try {
      // VÃ©rifier le token dans localStorage
      const token = localStorage.getItem('auth_token')
      if (token) {
        // Valider le token avec le backend
        const data = await apiClient.get<{ success: boolean; user?: User; message?: string }>('/api/auth/validate')
        if (data?.success && data.user) {
          this.setUser(data.user)
          return
        }
        
        // Token invalide, le supprimer
        localStorage.removeItem('auth_token')
      }
    } catch (error) {
      console.error('Erreur initialisation auth:', error)
      localStorage.removeItem('auth_token')
    } finally {
      this.setLoading(false)
    }
  }

  private setUser(user: User | null) {
    this.authState = {
      ...this.authState,
      user,
      isAuthenticated: !!user,
      isLoading: false,
      error: null
    }
    this.notifyListeners()
  }

  private setLoading(loading: boolean) {
    this.authState = {
      ...this.authState,
      isLoading: loading
    }
    this.notifyListeners()
  }

  private setError(error: string | null) {
    this.authState = {
      ...this.authState,
      error,
      isLoading: false
    }
    this.notifyListeners()
  }

  private notifyListeners() {
    this.listeners.forEach(listener => listener(this.authState))
  }

  // MÃ©thodes publiques
  subscribe(listener: (state: AuthState) => void) {
    this.listeners.push(listener)
    listener(this.authState)
    
    // Retourner fonction de dÃ©sabonnement
    return () => {
      const index = this.listeners.indexOf(listener)
      if (index > -1) {
        this.listeners.splice(index, 1)
      }
    }
  }

  getState(): AuthState {
    return { ...this.authState }
  }

  async login(email: string, password: string): Promise<{ success: boolean; user?: User; error?: string }> {
    try {
      this.setLoading(true)

      const data = await apiClient.post<{ email: string; password: string }, any>('/api/auth/login', { email, password })

      if (data.success && data.user && data.token) {
        // Sauvegarder le token
        localStorage.setItem('auth_token', data.token)
        
        // Mettre Ã  jour l'Ã©tat
        this.setUser(data.user)
        
        return { success: true, user: data.user }
      } else {
        const error = data.message || 'Email ou mot de passe incorrect'
        this.setError(error)
        return { success: false, error }
      }
    } catch (error) {
      const errorMessage =
        typeof (error as any)?.message === 'string'
          ? (error as any).message
          : 'Erreur de connexion au serveur'
      this.setError(errorMessage)
      return { success: false, error: errorMessage }
    }
  }

  async register(userData: {
    nom: string
    prenom: string
    email: string
    password: string
    telephone?: string
    departement?: string
  }): Promise<{ success: boolean; error?: string }> {
    try {
      this.setLoading(true)
      
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(userData)
      })

      const data = await response.json()

      if (data.success) {
        return { success: true }
      } else {
        const error = data.message || 'Erreur lors de l\'inscription'
        this.setError(error)
        return { success: false, error }
      }
    } catch (error) {
      const errorMessage = 'Erreur de connexion au serveur'
      this.setError(errorMessage)
      return { success: false, error: errorMessage }
    }
  }

  logout(): void {
    // Supprimer le token
    localStorage.removeItem('auth_token')
    
    // RÃ©initialiser l'Ã©tat
    this.setUser(null)
  }

  // VÃ©rifier si l'utilisateur est admin
  isAdmin(): boolean {
    return this.authState.user?.role === 'admin' || this.authState.user?.role === 'super_admin'
  }

  // VÃ©rifier si l'utilisateur est super admin
  isSuperAdmin(): boolean {
    return this.authState.user?.role === 'super_admin'
  }

  // VÃ©rifier si l'utilisateur est manager
  isManager(): boolean {
    return this.authState.user?.role === 'manager'
  }

  // VÃ©rifier si l'utilisateur est HR
  isHR(): boolean {
    return this.authState.user?.role === 'hr'
  }

  // VÃ©rifier si l'utilisateur est employÃ© (uniquement le rÃ´le employÃ©)
  isEmploye(): boolean {
    return this.authState.user?.role === 'employe'
  }

  // VÃ©rifier si l'utilisateur est un admin (tous les rÃ´les sauf employÃ©)
  isAnyAdmin(): boolean {
    return this.authState.user?.role === 'admin' || 
           this.authState.user?.role === 'super_admin' || 
           this.authState.user?.role === 'manager' || 
           this.authState.user?.role === 'hr'
  }

  // VÃ©rifier si l'utilisateur a accÃ¨s aux paramÃ¨tres
  hasSettingsAccess(): boolean {
    return this.authState.user?.role === 'admin' || 
           this.authState.user?.role === 'super_admin'
  }

  // Obtenir l'ID de l'utilisateur
  getUserId(): number | null {
    return this.authState.user?.id || null
  }

  // Mettre Ã  jour le profil utilisateur
  async updateProfile(updates: Partial<User>): Promise<{ success: boolean; error?: string }> {
    try {
      if (!localStorage.getItem('auth_token')) {
        return { success: false, error: 'Non authentifiÃ©' }
      }

      const data = await apiClient.put<Partial<User>, { success: boolean; user?: User; message?: string }>(
        '/api/auth/profile',
        updates
      )

      if (data.success && data.user) {
        // Mettre Ã  jour l'utilisateur dans l'Ã©tat
        this.setUser(data.user)
        return { success: true }
      } else {
        const error = data.message || 'Erreur lors de la mise Ã  jour'
        return { success: false, error }
      }
    } catch (error: any) {
      const errorMessage =
        typeof error?.message === 'string' && error.message.trim()
          ? error.message
          : 'Erreur de connexion au serveur'
      return { success: false, error: errorMessage }
    }
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<{ success: boolean; error?: string }> {
    try {
      if (!localStorage.getItem('auth_token')) {
        return { success: false, error: 'Non authentifie' }
      }

      const payload = {
        current_password: currentPassword,
        new_password: newPassword
      }

      const data = await apiClient.put<typeof payload, { success: boolean; message?: string }>(
        '/api/auth/password',
        payload
      )

      if (data.success) {
        return { success: true }
      }

      return { success: false, error: data.message || 'Erreur lors du changement de mot de passe' }
    } catch (error: any) {
      const errorMessage =
        typeof error?.message === 'string' && error.message.trim()
          ? error.message
          : 'Erreur de connexion au serveur'
      return { success: false, error: errorMessage }
    }
  }
}

// Hook React pour utiliser l'authentification
export function useAuth() {
  const authService = AuthService.getInstance()
  const [authState, setAuthState] = useState<AuthState>(authService.getState())

  useEffect(() => {
    const unsubscribe = authService.subscribe(setAuthState)
    return unsubscribe
  }, [])

  const actions = useMemo(() => ({
    login: (email: string, password: string) => authService.login(email, password),
    register: (userData: {
      nom: string
      prenom: string
      email: string
      password: string
      telephone?: string
      departement?: string
    }) => authService.register(userData),
    logout: () => authService.logout(),
    updateProfile: (updates: Partial<User>) => authService.updateProfile(updates),
    changePassword: (currentPassword: string, newPassword: string) => authService.changePassword(currentPassword, newPassword),
    isAdmin: () => authService.isAdmin(),
    isSuperAdmin: () => authService.isSuperAdmin(),
    isManager: () => authService.isManager(),
    isHR: () => authService.isHR(),
    isEmploye: () => authService.isEmploye(),
    isAnyAdmin: () => authService.isAnyAdmin(),
    hasSettingsAccess: () => authService.hasSettingsAccess(),
    getUserId: () => authService.getUserId()
  }), [authService])

  return {
    ...authState,
    ...actions
  }
}

export default AuthService

