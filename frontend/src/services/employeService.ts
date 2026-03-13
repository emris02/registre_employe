// Service pour les données du dashboard employé
import { apiClient } from './apiClient';

export interface Employe {
  id: number;
  nom: string;
  prenom: string;
  email: string;
  role: string;
  statut: string;
  date_embauche: string;
  poste: string;
  telephone: string;
  adresse: string;
  photo: string;
  created_at: string;
  updated_at: string;
}

export interface Pointage {
  id: number;
  employe_id: number;
  date: string;
  date_heure: string;
  type: 'arrivee' | 'depart';
  retard_minutes: number;
  created_at: string;
}

export interface BadgeToken {
  id: number;
  token: string;
  token_hash: string;
  expires_at: string;
  status: 'active' | 'expired' | 'inactive';
  created_at: string;
}

export interface RetardData {
  pointage_id: number;
  date_heure: string;
  retard_minutes: number;
  heure_limite: string;
  from_existing?: boolean;
}

export interface EmployeStats {
  presences: number;
  retards: number;
  absences: number;
  heures: string;
}

export interface MonthlyStats {
  jours_presents: number;
  jours_retards: number;
  jours_absents: number;
  absences_autorisees: number;
  absences_non_autorisees: number;
  retards_justifies: number;
  retards_non_justifies: number;
  temps_travail_mois: string;
}

export interface Notification {
  id: number;
  titre: string;
  message: string;
  type: 'information' | 'warning' | 'error' | 'success';
  lue: boolean;
  created_at: string;
}

export interface Evenement {
  id: number;
  titre: string;
  description: string;
  date_evenement: string;
  type: string;
  lieu: string;
  organisateur: string;
  created_at: string;
}

export interface JustificationData {
  pointage_id: number;
  raison: string;
  details: string;
  piece_jointe?: File;
}

class EmployeService {
  // Récupérer les données de l'employé connecté
  async getEmployeData(): Promise<Employe> {
    const response = await apiClient.get<{ employe: Employe }>('/api/employe/profile');
    return response.employe;
  }

  // Mettre à jour le profil de l'employé
  async updateProfile(field: string, value: string): Promise<{ success: boolean; message?: string }> {
    try {
      await apiClient.put<{ [key: string]: string }, { success: boolean }>('/auth/profile', { [field]: value });
      return { success: true };
    } catch (error: any) {
      return { success: false, message: error.message || 'Erreur lors de la mise à jour' };
    }
  }

  // Récupérer les statistiques de l'employé
  async getEmployeStats(): Promise<EmployeStats> {
    const response = await apiClient.get<{ stats: EmployeStats }>('/api/stats/employe');
    return response.stats;
  }

  // Récupérer les pointages du jour
  async getTodayPointages(): Promise<Pointage[]> {
    const today = new Date().toISOString().split('T')[0];
    const response = await apiClient.get<{ pointages: Pointage[] }>(`/api/pointages/today/${today}`);
    return response.pointages || [];
  }

  // Récupérer les pointages d'une période
  async getPointagesPeriod(startDate: string, endDate: string): Promise<Pointage[]> {
    const response = await apiClient.get<{ pointages: Pointage[] }>(`/api/pointages/period?start=${startDate}&end=${endDate}`);
    return response.pointages || [];
  }

  // Récupérer les derniers pointages
  async getLatestPointages(limit: number = 10): Promise<Pointage[]> {
    const response = await apiClient.get<{ pointages: Pointage[] }>(`/api/pointages/latest?limit=${limit}`);
    return response.pointages || [];
  }

  // Récupérer le badge de l'employé
  async getBadgeToken(): Promise<BadgeToken | null> {
    const response = await apiClient.get<{ badge: BadgeToken | null }>('/api/badge/employe');
    return response.badge;
  }

  // Régénérer le badge
  async regenerateBadge(): Promise<BadgeToken> {
    const response = await apiClient.post<{}, { badge: BadgeToken }>('/api/badge/generate', {});
    return response.badge;
  }

  // Soumettre une justification de retard
  async submitJustification(data: JustificationData): Promise<{ success: boolean; message?: string }> {
    try {
      const formData = new FormData();
      formData.append('pointage_id', data.pointage_id.toString());
      formData.append('raison', data.raison);
      formData.append('details', data.details);
      
      if (data.piece_jointe) {
        formData.append('piece_jointe', data.piece_jointe);
      }

      await apiClient.post<FormData, { success: boolean }>('/api/api/retards/justify', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      
      return { success: true };
    } catch (error: any) {
      return { success: false, message: error.message || 'Erreur lors de la soumission' };
    }
  }

  // Ignorer un retard
  async ignoreRetard(pointageId: number): Promise<{ success: boolean; message?: string }> {
    try {
      await apiClient.post<{}, { success: boolean }>(`/api/retards/${pointageId}/ignore`, {});
      return { success: true };
    } catch (error: any) {
      return { success: false, message: error.message || 'Erreur lors de l\'ignorance du retard' };
    }
  }

  // Récupérer les notifications
  async getNotifications(): Promise<Notification[]> {
    const response = await apiClient.get<{ notifications: Notification[] }>('/api/notifications');
    return response.notifications || [];
  }

  // Marquer une notification comme lue
  async markNotificationAsRead(notificationId: number): Promise<void> {
    await apiClient.put<{ read: boolean }, { success: boolean }>(`/api/notifications/${notificationId}/read`, { read: true });
  }

  // Marquer toutes les notifications comme lues
  async markAllNotificationsAsRead(): Promise<void> {
    try {
      await apiClient.put<Record<string, never>, { success: boolean }>('/api/notifications/read-all', {});
    } catch {
      await apiClient.put<Record<string, never>, { success: boolean }>('/api/notifications/read-all', {});
    }
  }

  // Récupérer les événements
  async getEvenements(): Promise<Evenement[]> {
    const response = await apiClient.get<{ evenements: Evenement[] }>('/api/evenements');
    return response.evenements || [];
  }

  // Créer un événement
  async createEvenement(payload: Omit<Evenement, 'id' | 'created_at'>): Promise<Evenement> {
    const response = await apiClient.post<Omit<Evenement, 'id' | 'created_at'>, { evenement: Evenement }>(
      '/api/evenements',
      payload
    );
    return response.evenement;
  }

  // Récupérer les statistiques mensuelles
  async getMonthlyStats(year: number, month: number): Promise<MonthlyStats> {
    const response = await apiClient.get<{ stats: MonthlyStats }>(`/api/stats/monthly?year=${year}&month=${month}`);
    return response.stats;
  }

  // Vérifier les retards non justifiés
  async checkUnjustifiedRetards(): Promise<RetardData | null> {
    try {
      const response = await apiClient.get<{ retard: RetardData | null }>('/api/api/retards/unjustified');
      return response.retard || null;
    } catch (error) {
      return null;
    }
  }

  // Récupérer les raisons de retard prédéfinies
  async getLateReasons(): Promise<Array<{ id: number; titre: string; description: string }>> {
    const response = await apiClient.get<{ reasons: Array<{ id: number; titre: string; description: string }> }>('/api/late-reasons');
    return response.reasons || [];
  }

  // Calculer les statistiques à partir des pointages
  calculateStatsFromPointages(pointages: Pointage[], workingDays: string[]): {
    jours_presents: number;
    jours_retards: number;
    jours_absents: number;
    retards_justifies: number;
    retards_non_justifies: number;
  } {
    const stats = {
      jours_presents: 0,
      jours_retards: 0,
      jours_absents: 0,
      retards_justifies: 0,
      retards_non_justifies: 0,
    };

    const pointedDates = new Set<string>();
    
    // Organiser les pointages par jour
    const pointagesByDay: { [date: string]: { arrivee?: string; depart?: string } } = {};
    
    pointages.forEach(pointage => {
      const date = pointage.date_heure.split('T')[0];
      pointedDates.add(date);
      
      if (!pointagesByDay[date]) {
        pointagesByDay[date] = {};
      }
      
      const time = pointage.date_heure.split('T')[1].substring(0, 5);
      if (pointage.type === 'arrivee') {
        pointagesByDay[date].arrivee = time;
      } else if (pointage.type === 'depart') {
        pointagesByDay[date].depart = time;
      }
    });

    // Calculer les statistiques
    workingDays.forEach(date => {
      const dayOfWeek = new Date(date).getDay();
      
      if (dayOfWeek === 0 || dayOfWeek === 6) { // Week-end
        return;
      }

      const dayPointages = pointagesByDay[date];
      
      if (dayPointages?.arrivee) {
        stats.jours_presents++;
        
        // Vérifier si c'est un retard (après 09:00)
        const arriveeTime = dayPointages.arrivee;
        if (arriveeTime > '09:00') {
          stats.jours_retards++;
        }
      } else {
        stats.jours_absents++;
      }
    });

    return stats;
  }

  // Formater le temps de travail
  formatWorkTime(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}min`;
  }

  // Générer l'URL du QR code
  generateQRUrl(token: string, size: number = 200): string {
    return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(token)}`;
  }

  // Obtenir les initiales d'un employé
  getInitials(nom: string, prenom: string): string {
    return (prenom.charAt(0) + nom.charAt(0)).toUpperCase();
  }

  // Obtenir la couleur du département
  getDepartmentColor(departement: string): string {
    const colors: { [key: string]: string } = {
      'depart_formation': 'info',
      'depart_communication': 'warning',
      'depart_informatique': 'primary',
      'depart_grh': 'success',
      'administration': 'secondary',
    };
    return colors[departement] || 'dark';
  }
}

export const employeService = new EmployeService();
