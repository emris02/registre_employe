import { apiClient } from './apiClient'

export interface ScanSession {
  id: string
  device_id: string
  user_id: number
  user_role: string
  unlocked_at: string
  expires_at: string
  method: 'pin' | 'admin_override' | 'mac' | 'ip' | 'token'
  is_active: boolean
}

export interface UnlockRequest {
  method: 'pin' | 'admin_override' | 'mac' | 'ip' | 'token'
  pin?: string
  reason?: string
  duration_minutes?: number
}

export interface UnlockResponse {
  success: boolean
  session_id?: string
  message: string
  expires_at?: string
  method: string
}

export interface SessionValidation {
  valid: boolean
  session?: ScanSession
  message?: string
  remaining_time?: number
}

export interface PinInfoResponse {
  success: boolean
  pin: string
  isDefault: boolean
  message?: string
}

class ScanSecurityService {
  private readonly SESSION_KEY = 'scan_session'
  private readonly DEVICE_KEY = 'scan_device_id'
  private readonly AUTHORIZED_DEVICES_KEY = 'scan_authorized_devices'

  private createLocalSession(method: UnlockRequest['method'], durationMinutes: number): ScanSession {
    const deviceId = this.getDeviceId()
    const expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000).toISOString()
    const session: ScanSession = {
      id: `local_scan_session_${Date.now()}`,
      device_id: deviceId,
      user_id: 0,
      user_role: 'unknown',
      unlocked_at: new Date().toISOString(),
      expires_at: expiresAt,
      method,
      is_active: true
    }
    this.saveSession(session)
    this.addAuthorizedDevice(deviceId)
    return session
  }

  // Générer un ID de device unique
  private getDeviceId(): string {
    let deviceId = localStorage.getItem(this.DEVICE_KEY)
    if (!deviceId) {
      deviceId = 'device_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now()
      localStorage.setItem(this.DEVICE_KEY, deviceId)
    }
    return deviceId
  }

  // Vérifier si le device est autorisé
  isDeviceAuthorized(): boolean {
    const authorizedDevices = this.getAuthorizedDevices()
    const currentDeviceId = this.getDeviceId()
    return authorizedDevices.includes(currentDeviceId)
  }

  // Obtenir la liste des devices autorisés
  private getAuthorizedDevices(): string[] {
    try {
      const stored = localStorage.getItem(this.AUTHORIZED_DEVICES_KEY)
      return stored ? JSON.parse(stored) : []
    } catch {
      return []
    }
  }

  // Ajouter un device à la liste des autorisés
  private addAuthorizedDevice(deviceId: string): void {
    try {
      const authorized = this.getAuthorizedDevices()
      if (!authorized.includes(deviceId)) {
        authorized.push(deviceId)
        localStorage.setItem(this.AUTHORIZED_DEVICES_KEY, JSON.stringify(authorized))
      }
    } catch (error) {
      console.error('Erreur lors de l\'ajout du device autorisé:', error)
    }
  }

  // Vérifier si l'utilisateur est super_admin
  isSuperAdmin(user: any): boolean {
    if (!user) return false
    const role = String(user.role || '').toLowerCase()
    return role === 'super_admin'
  }

  // Demander le déverrouillage
  async requestUnlock(request: UnlockRequest): Promise<UnlockResponse> {
    try {
      const deviceId = this.getDeviceId()
      
      // Pour les super_admin, utiliser admin override
      if (request.method === 'admin_override') {
        return this.adminOverrideUnlock(request.duration_minutes || 60)
      }
      
      // Pour les admins simples, exiger un PIN explicite
      if (request.method === 'pin') {
        if (!request.pin) {
          return {
            success: false,
            message: 'PIN requis pour accéder à la zone de scan',
            method: request.method
          }
        }
      }
      
      const payload = {
        method: 'pin',
        value: request.pin,
        deviceInfo: {
          id: deviceId,
          name: 'Appareil Web',
          userAgent: navigator.userAgent,
          platform: navigator.platform,
          type: 'web',
          timestamp: new Date().toISOString()
        },
        timestamp: new Date().toISOString(),
        deviceName: 'Appareil Web',
        duration: request.duration_minutes || 60
      }

      console.log('Payload envoyé au backend:', payload)
      const response = await apiClient.post('/api/scan/unlock/request', payload) as any
      
      if (response.success && response.session) {
        // Sauvegarder la session
        const session: ScanSession = {
          id: response.session.id,
          device_id: deviceId,
          user_id: 0, // Sera mis à jour après authentification
          user_role: 'unknown',
          unlocked_at: new Date().toISOString(),
          expires_at: response.session.expiresAt || new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          method: request.method,
          is_active: true
        }
        this.saveSession(session)
        this.addAuthorizedDevice(deviceId)
      }

      return response
    } catch (error: any) {
      console.error('Erreur lors de la demande de déverrouillage:', error)
      return {
        success: false,
        message: error.message || 'Erreur lors de la demande de déverrouillage',
        method: request.method
      }
    }
  }

  // Déverrouillage par PIN
  async unlockByPIN(pin: string, durationMinutes: number = 60): Promise<UnlockResponse> {
    return this.requestUnlock({
      method: 'pin',
      pin,
      reason: 'Déverrouillage par PIN',
      duration_minutes: durationMinutes
    })
  }

  // Déverrouillage admin override
  async adminOverrideUnlock(durationMinutes: number = 60): Promise<UnlockResponse> {
    const session = this.createLocalSession('admin_override', durationMinutes)
    return {
      success: true,
      message: 'Zone de scan déverrouillée par super_admin',
      method: 'admin_override',
      session_id: session.id,
      expires_at: session.expires_at
    }
  }

  // Sauvegarder la session
  private saveSession(session: ScanSession): void {
    try {
      localStorage.setItem(this.SESSION_KEY, JSON.stringify(session))
    } catch (error) {
      console.error('Erreur lors de la sauvegarde de la session:', error)
    }
  }

  // Obtenir la session courante
  getCurrentSession(): ScanSession | null {
    try {
      const stored = localStorage.getItem(this.SESSION_KEY)
      if (!stored) return null

      const session: ScanSession = JSON.parse(stored)
      
      // Vérifier si la session est expirée
      if (new Date(session.expires_at) <= new Date()) {
        this.clearSession()
        return null
      }

      return session
    } catch {
      return null
    }
  }

  // Valider la session avec le backend
  async validateSession(sessionId: string): Promise<SessionValidation> {
    try {
      const session = this.getCurrentSession()
      if (!session || session.id !== sessionId) {
        this.clearSession()
        return { valid: false, message: 'Session introuvable' }
      }

      const now = Date.now()
      const expires = new Date(session.expires_at).getTime()
      if (!expires || Number.isNaN(expires) || expires <= now) {
        this.clearSession()
        return { valid: false, message: 'Session expirée', remaining_time: 0 }
      }

      return {
        valid: true,
        session,
        remaining_time: expires - now
      }
    } catch (error: any) {
      console.error('Erreur lors de la validation de session:', error)
      return {
        valid: false,
        message: error.message || 'Erreur de validation de session'
      }
    }
  }

  // Effacer la session
  clearSession(): void {
    try {
      localStorage.removeItem(this.SESSION_KEY)
    } catch (error) {
      console.error('Erreur lors de la suppression de la session:', error)
    }
  }

  // Vérifier si la zone de scan est déverrouillée
  isUnlocked(): boolean {
    const session = this.getCurrentSession()
    return session !== null && session.is_active
  }

  // Obtenir le temps restant avant expiration
  getRemainingTime(): number {
    const session = this.getCurrentSession()
    if (!session) return 0

    const now = new Date().getTime()
    const expires = new Date(session.expires_at).getTime()
    return Math.max(0, expires - now)
  }

  // Formater le temps restant
  formatRemainingTime(): string {
    const remaining = this.getRemainingTime()
    if (remaining === 0) return 'Expiré'

    const minutes = Math.floor(remaining / (1000 * 60))
    const seconds = Math.floor((remaining % (1000 * 60)) / 1000)

    if (minutes > 0) {
      return `${minutes}m ${seconds}s`
    }
    return `${seconds}s`
  }

  // Forcer le verrouillage
  async lock(): Promise<boolean> {
    try {
      this.clearSession()
      return true
    } catch (error) {
      console.error('Erreur lors du verrouillage:', error)
      this.clearSession() // Forcer le verrouillage local même en cas d'erreur
      return false
    }
  }

  // Étendre la session
  async extendSession(additionalMinutes: number = 60): Promise<UnlockResponse> {
    try {
      const session = this.getCurrentSession()
      if (!session) {
        return {
          success: false,
          message: 'Aucune session active à étendre',
          method: 'extend'
        }
      }

      const now = Date.now()
      const base = Math.max(now, new Date(session.expires_at).getTime() || now)
      const newExpiresAt = new Date(base + additionalMinutes * 60 * 1000).toISOString()
      const updatedSession: ScanSession = {
        ...session,
        expires_at: newExpiresAt,
        is_active: true
      }
      this.saveSession(updatedSession)

      return {
        success: true,
        message: 'Session prolongée avec succès',
        method: 'extend',
        expires_at: newExpiresAt
      }
    } catch (error: any) {
      console.error('Erreur lors de l\'extension de session:', error)
      return {
        success: false,
        message: error.message || 'Erreur lors de l\'extension de session',
        method: 'extend'
      }
    }
  }

  // Obtenir l'historique des sessions
  async getSessionHistory(limit: number = 50): Promise<ScanSession[]> {
    try {
      const response = await apiClient.get(`/api/scan/sessions/history?limit=${limit}`) as any
      return response.sessions || []
    } catch (error) {
      console.error('Erreur lors de la récupération de l\'historique:', error)
      return []
    }
  }

  // Révoquer toutes les sessions d'un device
  async revokeDeviceSessions(deviceId?: string): Promise<boolean> {
    try {
      const targetDeviceId = deviceId || this.getDeviceId()
      await apiClient.post('/api/scan/sessions/revoke', {
        device_id: targetDeviceId
      })
      
      if (!deviceId || deviceId === this.getDeviceId()) {
        this.clearSession()
      }
      
      return true
    } catch (error) {
      console.error('Erreur lors de la révocation des sessions:', error)
      return false
    }
  }

  async getCurrentPIN(): Promise<{ pin: string; isDefault: boolean }> {
    const response = await apiClient.get<PinInfoResponse>('/api/scan/pin')
    if (!response?.success) {
      throw new Error(String((response as any)?.message || 'Impossible de récupérer le code PIN'))
    }
    return {
      pin: String(response.pin || '1234'),
      isDefault: Boolean(response.isDefault)
    }
  }

  async updatePIN(newPin: string, currentPin: string): Promise<void> {
    const response = await apiClient.put<{ newPin: string; currentPin: string }, { success: boolean; message?: string }>(
      '/api/scan/pin',
      { newPin, currentPin }
    )
    if (!response?.success) {
      throw new Error(String((response as any)?.message || 'Impossible de modifier le code PIN'))
    }
  }

  async resetPIN(): Promise<void> {
    const response = await apiClient.post<undefined, { success: boolean; message?: string }>(
      '/api/scan/pin/reset',
      undefined as any
    )
    if (!response?.success) {
      throw new Error(String((response as any)?.message || 'Impossible de réinitialiser le code PIN'))
    }
  }
}

export default new ScanSecurityService()
export { ScanSecurityService }
