// Service de génération d'ID et matricules pour Xpert Pro

export interface GeneratedIdentifiers {
  id: number;
  matricule: string;
}

export class IdentifierGenerator {
  private static lastId: number = 1000; // ID de départ
  
  /**
   * Génère un nouvel ID unique
   */
  static generateId(): number {
    this.lastId++;
    return this.lastId;
  }
  
  /**
   * Génère un matricule basé sur l'ID et la date
   */
  static generateMatricule(id: number, date: Date = new Date()): string {
    const year = date.getFullYear().toString().slice(-2); // 2 derniers chiffres de l'année
    const month = (date.getMonth() + 1).toString().padStart(2, '0'); // Mois sur 2 chiffres
    const sequence = id.toString().padStart(4, '0'); // ID sur 4 chiffres avec zéros devant
    
    return `XP-${year}${month}-${sequence}`;
  }
  
  /**
   * Génère un matricule basé sur le rôle
   */
  static generateMatriculeByRole(role: string, id: number, date: Date = new Date()): string {
    const year = date.getFullYear().toString().slice(-2);
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const sequence = id.toString().padStart(4, '0');
    
    // Préfixe selon le rôle
    const ROLE_PREFIXES: Record<string, string> = {
      'super_admin': 'SA',
      'admin': 'AD',
      'manager': 'MG',
      'chef_departement': 'CD',
      'stagiaire': 'ST',
      'hr': 'RH',
      'employe': 'EM'
    };
    
    const prefix = ROLE_PREFIXES[role] || 'EM';
    return `${prefix}-${year}${month}-${sequence}`;
  }
  
  /**
   * Génère un matricule avec format personnalisé
   */
  static generateCustomMatricule(
    prefix: string, 
    id: number, 
    date: Date = new Date(),
    separator: string = '-'
  ): string {
    const year = date.getFullYear().toString().slice(-2);
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const sequence = id.toString().padStart(4, '0');
    
    return `${prefix}${separator}${year}${month}${separator}${sequence}`;
  }
  
  /**
   * Génère un identifiant complet (ID + matricule)
   */
  static generateIdentifiers(role: string): GeneratedIdentifiers {
    const id = this.generateId();
    const matricule = this.generateMatriculeByRole(role, id);
    
    return {
      id,
      matricule
    };
  }
  
  /**
   * Valide le format d'un matricule
   */
  static validateMatricule(matricule: string): boolean {
    // Format attendu: PREFIX-YYMM-XXXX
    const pattern = /^[A-Z]{2}-\d{4}-\d{4}$/;
    return pattern.test(matricule);
  }
  
  /**
   * Extrait les informations d'un matricule
   */
  static parseMatricule(matricule: string): {
    prefix: string;
    year: string;
    month: string;
    sequence: string;
  } | null {
    if (!this.validateMatricule(matricule)) {
      return null;
    }
    
    const [prefix, yearMonth, sequence] = matricule.split('-');
    const year = yearMonth.slice(0, 2);
    const month = yearMonth.slice(2, 4);
    
    return {
      prefix,
      year,
      month,
      sequence
    };
  }
  
  /**
   * Réinitialise le compteur d'ID (pour les tests)
   */
  static resetIdCounter(startId: number = 1000): void {
    this.lastId = startId - 1;
  }
  
  /**
   * Définit le dernier ID connu (pour la synchronisation)
   */
  static setLastId(id: number): void {
    this.lastId = id;
  }
  
  /**
   * Obtient le prochain ID sans l'incrémenter
   */
  static getNextId(): number {
    return this.lastId + 1;
  }
}

export default IdentifierGenerator;
