import { User } from './authService';

export interface Role {
  id: string;
  name: string;
  permissions: string[];
  description: string;
}

export interface Permission {
  id: string;
  name: string;
  resource: string;
  action: string;
  description: string;
}

export const ROLES: Role[] = [
  {
    id: 'super_admin',
    name: 'Super Administrateur',
    permissions: ['*'], // Accès à tout
    description: 'Accès complet à toutes les fonctionnalités et gestion des administrateurs'
  },
  {
    id: 'admin',
    name: 'Administrateur',
    permissions: [
      'dashboard.view',
      'employees.view',
      'employees.create',
      'employees.edit',
      'employees.delete',
      'pointage.view',
      'pointage.manage',
      'conges.view',
      'conges.manage',
      'reports.view',
      'reports.export',
      'settings.view',
      'settings.manage',
      'roles.manage' // Permission pour gérer les rôles
    ],
    description: 'Gestion complète de l\'entreprise'
  },
  {
    id: 'manager',
    name: 'Manager',
    permissions: [
      'dashboard.view',
      'employees.view',
      'employees.edit',
      'pointage.view',
      'pointage.manage',
      'reports.view',
      'reports.export'
    ],
    description: 'Gestion des équipes et rapports'
  },
  {
    id: 'chef_departement',
    name: 'Chef de departement',
    permissions: [
      'dashboard.view',
      'employees.view',
      'pointage.view',
      'pointage.manage',
      'reports.view'
    ],
    description: 'Pilotage d un departement et validation locale'
  },
  {
    id: 'stagiaire',
    name: 'Stagiaire',
    permissions: [
      'dashboard.view',
      'profile.view',
      'pointage.view_own',
      'calendar.view_own',
      'notifications.view_own'
    ],
    description: 'Acces limite aux fonctions personnelles'
  },
  
  {
    id: 'employe',
    name: 'Employé',
    permissions: [
      'dashboard.view',
      'profile.view',
      'profile.edit',
      'badge.view',
      'badge.regenerate',
      'pointage.view_own',
      'calendar.view_own',
      'notifications.view_own'
    ],
    description: 'Accès limité à ses propres informations'
  }
];

export const PERMISSIONS: Permission[] = [
  // Dashboard
  { id: 'dashboard.view', name: 'Voir dashboard', resource: 'dashboard', action: 'view', description: 'Accéder au tableau de bord' },
  
  // Employés
  { id: 'employees.view', name: 'Voir employés', resource: 'employees', action: 'view', description: 'Voir la liste des employés' },
  { id: 'employees.create', name: 'Créer employé', resource: 'employees', action: 'create', description: 'Ajouter un nouvel employé' },
  { id: 'employees.edit', name: 'Modifier employé', resource: 'employees', action: 'edit', description: 'Modifier les informations d\'un employé' },
  { id: 'employees.delete', name: 'Supprimer employé', resource: 'employees', action: 'delete', description: 'Supprimer un employé' },
  
  // Pointage
  { id: 'pointage.view', name: 'Voir pointages', resource: 'pointage', action: 'view', description: 'Voir tous les pointages' },
  { id: 'pointage.view_own', name: 'Voir ses pointages', resource: 'pointage', action: 'view_own', description: 'Voir ses propres pointages' },
  { id: 'pointage.manage', name: 'Gérer pointages', resource: 'pointage', action: 'manage', description: 'Gérer les pointages (validation, correction)' },
  
  // Profil
  { id: 'profile.view', name: 'Voir profil', resource: 'profile', action: 'view', description: 'Voir son profil' },
  { id: 'profile.edit', name: 'Modifier profil', resource: 'profile', action: 'edit', description: 'Modifier son profil' },
  
  // Badge
  { id: 'badge.view', name: 'Voir badge', resource: 'badge', action: 'view', description: 'Voir son badge' },
  { id: 'badge.regenerate', name: 'Régénérer badge', resource: 'badge', action: 'regenerate', description: 'Régénérer son badge' },
  
  // Calendrier
  { id: 'calendar.view', name: 'Voir calendrier', resource: 'calendar', action: 'view', description: 'Voir le calendrier' },
  { id: 'calendar.view_own', name: 'Voir son calendrier', resource: 'calendar', action: 'view_own', description: 'Voir son propre calendrier' },
  
  // Notifications
  { id: 'notifications.view', name: 'Voir notifications', resource: 'notifications', action: 'view', description: 'Voir toutes les notifications' },
  { id: 'notifications.view_own', name: 'Voir ses notifications', resource: 'notifications', action: 'view_own', description: 'Voir ses propres notifications' },
  
  // Congés
  { id: 'conges.view', name: 'Voir congés', resource: 'conges', action: 'view', description: 'Voir les demandes de congés' },
  { id: 'conges.manage', name: 'Gérer congés', resource: 'conges', action: 'manage', description: 'Approuver/refuser les congés' },
  
  // Rapports
  { id: 'reports.view', name: 'Voir rapports', resource: 'reports', action: 'view', description: 'Voir les rapports' },
  { id: 'reports.export', name: 'Exporter rapports', resource: 'reports', action: 'export', description: 'Exporter les rapports' },
  
  // Paramètres
  { id: 'settings.view', name: 'Voir paramètres', resource: 'settings', action: 'view', description: 'Voir les paramètres de l\'application' },
  { id: 'settings.manage', name: 'Gérer paramètres', resource: 'settings', action: 'manage', description: 'Modifier les paramètres de l\'application' }
];

export class RoleService {
  static hasPermission(userRole: string, permission: string): boolean {
    const role = ROLES.find(r => r.id === userRole);
    if (!role) return false;
    
    // Admin a toutes les permissions
    if (role.permissions.includes('*')) return true;
    
    return role.permissions.includes(permission);
  }

  static getRolePermissions(userRole: string): string[] {
    const role = ROLES.find(r => r.id === userRole);
    return role ? role.permissions : [];
  }

  static canAccessResource(userRole: string, resource: string, action: string = 'view'): boolean {
    const permission = `${resource}.${action}`;
    return this.hasPermission(userRole, permission);
  }

  static getAvailablePanels(userRole: string): any[] {
    const allPanels = [
      {
        id: 'dashboard',
        label: 'Dashboard',
        icon: '📊',
        permission: 'dashboard.view',
        component: () => import('../components/panels/DashboardPanel').then(module => module.default)
      },
      {
        id: 'employees',
        label: 'Employés',
        icon: '👥',
        permission: 'employees.view',
        component: () => import('../components/panels/EmployeesPanel').then(module => module.default)
      },
      {
        id: 'profile',
        label: 'Profil',
        icon: '👤',
        permission: 'profile.view',
        component: () => import('../components/panels/ProfilePanel').then(module => module.default)
      },
      {
        id: 'badge',
        label: 'Badge',
        icon: '🎫',
        permission: 'badge.view',
        component: () => import('../components/panels/BadgePanelComponent').then(module => module.default)
      },
      {
        id: 'pointage',
        label: 'Pointage',
        icon: '⏰',
        permission: 'pointage.view',
        component: () => import('../components/panels/PointageManagementPanel').then(module => module.default)
      },
      {
        id: 'calendar',
        label: 'Calendrier',
        icon: '📅',
        permission: 'calendar.view',
        component: () => import('../components/panels/CalendarManagementPanel').then(module => module.default)
      },
      {
        id: 'notifications',
        label: 'Notifications',
        icon: '🔔',
        permission: 'notifications.view',
        component: () => import('../components/panels/NotificationsPanel').then(module => module.default)
      },
      {
        id: 'conges',
        label: 'Congés',
        icon: '🏖️',
        permission: 'conges.view',
        component: () => import('../components/panels/CongesPanel').then(module => module.default)
      },
      {
        id: 'reports',
        label: 'Rapports',
        icon: '📊',
        permission: 'reports.view',
        component: () => import('../components/panels/ReportsPanel').then(module => module.default)
      },
      {
        id: 'settings',
        label: 'Paramètres',
        icon: '⚙️',
        permission: 'settings.view',
        component: () => import('../components/panels/SettingsPanel').then(module => module.default)
      },
      {
        id: 'roles',
        label: 'Rôles',
        icon: '👥',
        permission: 'roles.manage',
        component: () => import('../components/panels/RolesManagementPanel').then(module => module.default)
      }
    ];

    return allPanels.filter(panel => 
      this.hasPermission(userRole, panel.permission)
    );
  }

  // Nouvelles méthodes pour la gestion dynamique des rôles
  static async createRole(roleData: Omit<Role, 'id'>): Promise<Role | null> {
    try {
      // Simuler l'appel API pour créer un rôle
      const newRole: Role = {
        id: roleData.name.toLowerCase().replace(/\s+/g, '_'),
        ...roleData
      };
      
      // Ajouter le rôle à la liste (en pratique, cela serait fait via l'API)
      ROLES.push(newRole);
      
      console.log('Nouveau rôle créé:', newRole);
      return newRole;
    } catch (error) {
      console.error('Erreur lors de la création du rôle:', error);
      return null;
    }
  }

  static async updateRole(roleId: string, roleData: Partial<Role>): Promise<Role | null> {
    try {
      const roleIndex = ROLES.findIndex(r => r.id === roleId);
      if (roleIndex === -1) return null;
      
      // Mettre à jour le rôle
      ROLES[roleIndex] = { ...ROLES[roleIndex], ...roleData };
      
      console.log('Rôle mis à jour:', ROLES[roleIndex]);
      return ROLES[roleIndex];
    } catch (error) {
      console.error('Erreur lors de la mise à jour du rôle:', error);
      return null;
    }
  }

  static async deleteRole(roleId: string): Promise<boolean> {
    try {
      const roleIndex = ROLES.findIndex(r => r.id === roleId);
      if (roleIndex === -1) return false;
      
      // Empêcher la suppression des rôles système critiques
      const criticalRoles = ['super_admin', 'admin', 'employe'];
      if (criticalRoles.includes(roleId)) {
        throw new Error('Impossible de supprimer un rôle système critique');
      }
      
      // Supprimer le rôle
      ROLES.splice(roleIndex, 1);
      
      console.log('Rôle supprimé:', roleId);
      return true;
    } catch (error) {
      console.error('Erreur lors de la suppression du rôle:', error);
      return false;
    }
  }

  static async assignRoleToUser(userId: number, roleId: string): Promise<boolean> {
    try {
      // Simuler l'appel API
      await new Promise(resolve => setTimeout(resolve, 1000));
      console.log(`Role ${roleId} assigned to user ${userId}`);
      return true;
    } catch (error) {
      console.error('Error assigning role:', error);
      return false;
    }
  }

  static async updateUserPermissions(userId: number, permissions: string[]): Promise<boolean> {
    try {
      // Simuler l'appel API
      await new Promise(resolve => setTimeout(resolve, 1000));
      console.log(`Permissions updated for user ${userId}:`, permissions);
      return true;
    } catch (error) {
      console.error('Error updating permissions:', error);
      return false;
    }
  }

  // Méthode pour obtenir les rôles disponibles pour les employés
  static getEmployeeRoles(): Role[] {
    return ROLES.filter(role => 
      ['employe', 'chef_departement', 'stagiaire', 'manager'].includes(role.id)
    );
  }

  // Méthode pour obtenir les rôles administratifs
  static getAdminRoles(): Role[] {
    return ROLES.filter(role => 
      ['admin', 'super_admin', 'hr'].includes(role.id)
    );
  }
}
