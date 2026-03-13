// Service pour la gestion des badges
import { apiClient } from './apiClient';

export interface Badge {
  id: number;
  token: string;
  token_hash: string;
  user_id: number;
  user_name: string;
  user_email: string;
  user_role: string;
  created_at: string;
  expires_at: string;
  status: 'active' | 'inactive' | 'expired';
  last_used?: string;
  usage_count: number;
}

export interface User {
  id: number;
  nom: string;
  prenom: string;
  email: string;
  role: string;
  departement?: string;
  poste?: string;
  statut: string;
}

class BadgeService {
  // Récupérer tous les badges
  async getAllBadges(): Promise<Badge[]> {
    try {
      const response = await apiClient.get<{ success: boolean; badges: Badge[]; total: number }>('/badges');
      if (response.success) {
        return response.badges;
      }
      return [];
    } catch (error) {
      console.error('Erreur lors de la récupération des badges:', error);
      throw error;
    }
  }

  // Récupérer un badge par ID
  async getBadgeById(id: number): Promise<Badge | null> {
    try {
      const response = await apiClient.get<{ success: boolean; badge: Badge }>(`/badges/${id}`);
      if (response.success) {
        return response.badge;
      }
      return null;
    } catch (error) {
      console.error('Erreur lors de la récupération du badge:', error);
      throw error;
    }
  }

  // Régénérer un badge spécifique
  async regenerateBadge(badgeId: number): Promise<Badge> {
    try {
      const response = await apiClient.post<{}, { success: boolean; badge: Badge; message: string }>(`/badges/${badgeId}/regenerate`, {});
      if (response.success) {
        return response.badge;
      }
      throw new Error(response.message || 'Erreur lors de la régénération du badge');
    } catch (error) {
      console.error('Erreur lors de la régénération du badge:', error);
      throw error;
    }
  }

  // Mettre à jour le statut d'un badge
  async updateBadgeStatus(badgeId: number, status: 'active' | 'inactive' | 'expired'): Promise<Badge> {
    try {
      const response = await apiClient.put<{ status: string }, { success: boolean; badge: Badge; message: string }>(`/badges/${badgeId}/status`, { status });
      if (response.success) {
        return response.badge;
      }
      throw new Error(response.message || 'Erreur lors de la mise à jour du statut');
    } catch (error) {
      console.error('Erreur lors de la mise à jour du statut:', error);
      throw error;
    }
  }

  // Régénérer tous les badges
  async regenerateAllBadges(): Promise<Badge[]> {
    try {
      const response = await apiClient.post<{}, { success: boolean; badges: Badge[]; message: string }>('/badges/regenerate-all', {});
      if (response.success) {
        return response.badges;
      }
      throw new Error(response.message || 'Erreur lors de la régénération des badges');
    } catch (error) {
      console.error('Erreur lors de la régénération des badges:', error);
      throw error;
    }
  }

  // Régénérer les badges d'un utilisateur spécifique
  async regenerateUserBadges(userId: number): Promise<Badge[]> {
    try {
      const response = await apiClient.post<{}, { success: boolean; badges: Badge[]; message: string }>(`/badges/user/${userId}/regenerate`, {});
      if (response.success) {
        return response.badges;
      }
      throw new Error(response.message || 'Erreur lors de la régénération des badges de l\'utilisateur');
    } catch (error) {
      console.error('Erreur lors de la régénération des badges de l\'utilisateur:', error);
      throw error;
    }
  }

  // Désactiver tous les badges actifs
  async deactivateAllActiveBadges(): Promise<Badge[]> {
    try {
      const response = await apiClient.post<{}, { success: boolean; badges: Badge[]; message: string }>('/badges/deactivate-all-active', {});
      if (response.success) {
        return response.badges;
      }
      throw new Error(response.message || 'Erreur lors de la désactivation des badges');
    } catch (error) {
      console.error('Erreur lors de la désactivation des badges:', error);
      throw error;
    }
  }

  // Obtenir les statistiques des badges
  async getBadgeStats(): Promise<{
    total: number;
    active: number;
    inactive: number;
    expired: number;
    today_generated: number;
    today_used: number;
  }> {
    try {
      const response = await apiClient.get<{ success: boolean; stats: any }>('/badges/stats');
      if (response.success) {
        return response.stats;
      }
      return {
        total: 0,
        active: 0,
        inactive: 0,
        expired: 0,
        today_generated: 0,
        today_used: 0
      };
    } catch (error) {
      console.error('Erreur lors de la récupération des statistiques:', error);
      throw error;
    }
  }

  // Obtenir le badge d'un employé
  async getEmployeBadge(employeId: number): Promise<Badge | null> {
    try {
      const response = await apiClient.get<{ success: boolean; badge: Badge | null }>(`/badges/employe/${employeId}`);
      if (response.success) {
        return response.badge;
      }
      return null;
    } catch (error) {
      console.error('Erreur lors de la récupération du badge de l\'employé:', error);
      throw error;
    }
  }

  // Générer un nouveau badge pour un employé
  async generateEmployeBadge(employeId: number): Promise<Badge> {
    try {
      const response = await apiClient.post<{ employe_id: number }, { success: boolean; badge: Badge; message: string }>('/badges/generate', { employe_id: employeId });
      if (response.success) {
        return response.badge;
      }
      throw new Error(response.message || 'Erreur lors de la génération du badge');
    } catch (error) {
      console.error('Erreur lors de la génération du badge:', error);
      throw error;
    }
  }

  // Valider un token de badge
  async validateBadgeToken(token: string): Promise<{
    valid: boolean;
    badge?: Badge;
    user?: User;
    message?: string;
  }> {
    try {
      const response = await apiClient.post<{ token: string }, { success: boolean; valid: boolean; badge?: Badge; user?: User; message: string }>('/badges/validate', { token });
      if (response.success) {
        return {
          valid: response.valid,
          badge: response.badge,
          user: response.user,
          message: response.message
        };
      }
      return {
        valid: false,
        message: response.message || 'Token invalide'
      };
    } catch (error) {
      console.error('Erreur lors de la validation du token:', error);
      return {
        valid: false,
        message: 'Erreur lors de la validation'
      };
    }
  }

  // Obtenir l'historique d'utilisation d'un badge
  async getBadgeUsageHistory(badgeId: number, limit: number = 50): Promise<Array<{
    id: number;
    scan_time: string;
    ip_address: string;
    device_info?: string;
    location?: {
      latitude: number;
      longitude: number;
    };
    type: 'arrival' | 'departure' | 'access';
    success: boolean;
  }>> {
    try {
      const response = await apiClient.get<{ success: boolean; history: Array<any> }>(`/badges/${badgeId}/history?limit=${limit}`);
      if (response.success) {
        return response.history;
      }
      return [];
    } catch (error) {
      console.error('Erreur lors de la récupération de l\'historique:', error);
      throw error;
    }
  }

  // Exporter les badges en CSV
  async exportBadges(filters?: {
    status?: string;
    user_role?: string;
    date_from?: string;
    date_to?: string;
  }): Promise<Blob> {
    try {
      const params = new URLSearchParams();
      if (filters?.status) params.append('status', filters.status);
      if (filters?.user_role) params.append('user_role', filters.user_role);
      if (filters?.date_from) params.append('date_from', filters.date_from);
      if (filters?.date_to) params.append('date_to', filters.date_to);

      const response = await fetch(`/api/badges/export?${params.toString()}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      });

      if (!response.ok) {
        throw new Error('Erreur lors de l\'export des badges');
      }

      return response.blob();
    } catch (error) {
      console.error('Erreur lors de l\'export des badges:', error);
      throw error;
    }
  }

  // Obtenir les initiales d'un utilisateur
  getInitials(nom: string, prenom: string): string {
    return `${prenom?.[0] || ''}${nom?.[0] || ''}`.toUpperCase();
  }

  // Obtenir la couleur du statut
  getStatusColor(status: string): string {
    switch (status) {
      case 'active':
        return 'bg-green-100 text-green-800';
      case 'inactive':
        return 'bg-red-100 text-red-800';
      case 'expired':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  }

  // Obtenir le texte du statut
  getStatusText(status: string): string {
    switch (status) {
      case 'active':
        return 'Actif';
      case 'inactive':
        return 'Inactif';
      case 'expired':
        return 'Expiré';
      default:
        return 'Inconnu';
    }
  }

  // Obtenir la couleur du rôle
  getRoleColor(role: string): string {
    switch (role) {
      case 'admin':
        return 'bg-red-100 text-red-800';
      case 'super_admin':
        return 'bg-purple-100 text-purple-800';
      case 'manager':
        return 'bg-yellow-100 text-yellow-800';
      case 'chef_departement':
        return 'bg-indigo-100 text-indigo-800';
      case 'stagiaire':
        return 'bg-slate-100 text-slate-800';
      case 'hr':
        return 'bg-blue-100 text-blue-800';
      case 'employe':
      default:
        return 'bg-gray-100 text-gray-800';
    }
  }

  // Obtenir le texte du rôle
  getRoleText(role: string): string {
    switch (role) {
      case 'admin':
        return 'Admin';
      case 'super_admin':
        return 'Super Admin';
      case 'manager':
        return 'Manager';
      case 'chef_departement':
        return 'Chef de departement';
      case 'stagiaire':
        return 'Stagiaire';
      case 'hr':
        return 'RH';
      case 'employe':
      default:
        return 'Employé';
    }
  }

  // Formater la date
  formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  // Formater la date courte
  formatDateShort(dateString: string): string {
    return new Date(dateString).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  }

  // Vérifier si un badge est expiré
  isBadgeExpired(expiresAt: string): boolean {
    return new Date(expiresAt) < new Date();
  }

  // Calculer les jours restants avant expiration
  getDaysUntilExpiration(expiresAt: string): number {
    const now = new Date();
    const expiry = new Date(expiresAt);
    const diffTime = expiry.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return Math.max(0, diffDays);
  }

  // Générer l'URL du QR code
  generateQRUrl(token: string, size: number = 200): string {
    return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(token)}`;
  }
}

export const badgeService = new BadgeService();
export default badgeService;
