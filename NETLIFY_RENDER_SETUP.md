# Configuration Frontend → Backend
# Netlify → Render Connection Guide

## Architecture

```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│   Netlify       │ ──────▶ │   Render         │ ──────▶ │   PostgreSQL    │
│   (Frontend)    │  HTTPS  │   (Backend)      │         │   (Database)    │
│                 │         │   Node/Express   │         │                 │
└─────────────────┘         └──────────────────┘         └─────────────────┘
        │                           │
        │    CORS Configuré         │
        │    JWT Auth               │
        │    API REST               │
        └───────────────────────────┘
```

## 1. Configuration CORS Backend (server.js)

```javascript
// CORS Configuration pour Netlify
const corsOptions = {
  origin: [
    'https://votre-site-netlify.app',           // URL Netlify production
    'https://votre-site--preview.netlify.app',  // URL Netlify preview
    'http://localhost:5173',                     // Dev local Vite
    'http://localhost:3000',                     // Dev local alternative
  ],
  credentials: true,  // Important pour les cookies/sessions
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin'
  ],
  exposedHeaders: ['Authorization'],
  maxAge: 86400  // 24 heures
};

app.use(cors(corsOptions));
```

## 2. Variables d'environnement Backend (.env)

```
# Backend URL
PORT=3003
NODE_ENV=production

# Database
DATABASE_URL=postgresql://user:password@host:5432/dbname

# Security
JWT_SECRET=votre_secret_jwt_tres_long_et_aleatoire
BADGE_SECRET=votre_secret_badge

# CORS - Domaines autorisés (séparés par virgule)
ALLOWED_ORIGINS=https://votre-site-netlify.app,https://votre-site--preview.netlify.app
```

## 3. Variables d'environnement Frontend (.env)

```
# API URL - Remplacer par votre URL Render
VITE_API_URL=https://registre-employe.onrender.com/api

# Autres configs
VITE_APP_NAME=Registre Employé
VITE_APP_VERSION=1.0.0
```

## 4. Service API Frontend (apiClient.ts)

```typescript
// src/services/apiClient.ts
export interface ApiError {
  message: string;
  status?: number;
  [key: string]: unknown;
}

// URL de l'API depuis les variables d'environnement
const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

export class ApiClient {
  private baseUrl: string;

  constructor() {
    this.baseUrl = API_BASE_URL;
  }

  private buildHeaders(initHeaders?: HeadersInit): Headers {
    const headers = new Headers(initHeaders);
    const token = localStorage.getItem('auth_token');
    
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    
    return headers;
  }

  private buildUrl(path: string): string {
    // Si le chemin commence déjà par http(s), l'utiliser tel quel
    if (path.startsWith('http://') || path.startsWith('https://')) {
      return path;
    }
    
    // Construire l'URL complète
    const normalizedBase = this.baseUrl.replace(/\/+$/, '');
    const normalizedPath = path.replace(/^\/+/, '');
    
    return `${normalizedBase}/${normalizedPath}`;
  }

  private async handleResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      const error: ApiError = {
        message: `Erreur HTTP ${response.status}`,
        status: response.status
      };
      
      try {
        const errorData = await response.json();
        error.message = errorData.message || error.message;
        Object.assign(error, errorData);
      } catch {
        // Si pas de JSON dans la réponse d'erreur
      }
      
      throw error;
    }
    
    return response.json() as Promise<T>;
  }

  async get<T>(path: string): Promise<T> {
    const response = await fetch(this.buildUrl(path), {
      method: 'GET',
      credentials: 'include',
      headers: this.buildHeaders()
    });
    
    return this.handleResponse<T>(response);
  }

  async post<TPayload, TResponse>(
    path: string, 
    payload: TPayload
  ): Promise<TResponse> {
    const headers = this.buildHeaders({
      'Content-Type': 'application/json'
    });
    
    const response = await fetch(this.buildUrl(path), {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify(payload)
    });
    
    return this.handleResponse<TResponse>(response);
  }

  async put<TPayload, TResponse>(
    path: string, 
    payload: TPayload
  ): Promise<TResponse> {
    const response = await fetch(this.buildUrl(path), {
      method: 'PUT',
      credentials: 'include',
      headers: this.buildHeaders({
        'Content-Type': 'application/json'
      }),
      body: JSON.stringify(payload)
    });
    
    return this.handleResponse<TResponse>(response);
  }

  async delete<TResponse>(path: string): Promise<TResponse> {
    const response = await fetch(this.buildUrl(path), {
      method: 'DELETE',
      credentials: 'include',
      headers: this.buildHeaders()
    });
    
    return this.handleResponse<TResponse>(response);
  }
}

// Instance globale
export const apiClient = new ApiClient();
```

## 5. Exemple d'utilisation (React/Vite)

```typescript
// src/services/authService.ts
import { apiClient } from './apiClient';

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface User {
  id: number;
  email: string;
  nom: string;
  prenom: string;
  role: string;
}

export const authService = {
  async login(credentials: LoginCredentials): Promise<{ user: User; token: string }> {
    const response = await apiClient.post<
      LoginCredentials, 
      { success: boolean; user: User; token: string; message?: string }
    >('/api/auth/login', credentials);
    
    if (!response.success) {
      throw new Error(response.message || 'Échec de la connexion');
    }
    
    // Stocker le token
    localStorage.setItem('auth_token', response.token);
    
    return { user: response.user, token: response.token };
  },

  async getCurrentUser(): Promise<User | null> {
    try {
      const response = await apiClient.get<
        { success: boolean; user?: User; message?: string }
      >('/api/auth/me');
      
      return response.success && response.user ? response.user : null;
    } catch {
      return null;
    }
  },

  logout(): void {
    localStorage.removeItem('auth_token');
  }
};
```

## 6. Hook React pour les données API

```typescript
// src/hooks/useApi.ts
import { useState, useEffect, useCallback } from 'react';
import { apiClient, ApiError } from '../services/apiClient';

interface UseApiOptions<T> {
  path: string;
  immediate?: boolean;
}

interface UseApiResult<T> {
  data: T | null;
  loading: boolean;
  error: ApiError | null;
  refetch: () => Promise<void>;
}

export function useApi<T>({ path, immediate = true }: UseApiOptions<T>): UseApiResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      const result = await apiClient.get<T>(path);
      setData(result);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    if (immediate) {
      fetchData();
    }
  }, [fetchData, immediate]);

  return { data, loading, error, refetch: fetchData };
}

// Exemple d'utilisation dans un composant
function EmployeeList() {
  const { data, loading, error, refetch } = useApi<any[]>({ 
    path: '/api/get_employes' 
  });

  if (loading) return <div>Chargement...</div>;
  if (error) return <div>Erreur: {error.message}</div>;
  
  return (
    <div>
      <button onClick={refetch}>Rafraîchir</button>
      <ul>
        {data?.map(emp => (
          <li key={emp.id}>{emp.prenom} {emp.nom}</li>
        ))}
      </ul>
    </div>
  );
}
```

## 7. Bonnes Pratiques CORS

### Erreurs CORS courantes et solutions :

| Erreur | Cause | Solution |
|--------|-------|----------|
| `No 'Access-Control-Allow-Origin'` | Origine non autorisée | Ajouter l'URL Netlify dans `corsOptions.origin` |
| `Credentials flag is true, but Access-Control-Allow-Credentials is not` | `credentials: true` sans CORS config | Ajouter `credentials: true` dans le backend |
| `Method DELETE is not allowed` | Méthode non autorisée | Ajouter les méthodes dans `corsOptions.methods` |
| `Request header field Authorization is not allowed` | Header non autorisé | Ajouter `Authorization` dans `allowedHeaders` |

### Checklist déploiement :

- [ ] Backend : CORS configuré avec URL Netlify
- [ ] Backend : `credentials: true` dans CORS
- [ ] Frontend : `VITE_API_URL` pointe vers Render
- [ ] Frontend : `credentials: 'include'` dans fetch
- [ ] Environment : Variables d'env configurées sur Render
- [ ] Environment : Variables d'env configurées sur Netlify
- [ ] HTTPS : Les deux services utilisent HTTPS
- [ ] JWT Secret : Identique sur les deux environnements

## 8. Configuration Render (Environment Variables)

Dans le dashboard Render, ajouter :

```
PORT=3003
NODE_ENV=production
DATABASE_URL=postgresql://...
JWT_SECRET=votre_secret
BADGE_SECRET=votre_secret
ALLOWED_ORIGINS=https://votre-site-netlify.app
```

## 9. Configuration Netlify (Environment Variables)

Dans le dashboard Netlify, ajouter :

```
VITE_API_URL=https://registre-employe.onrender.com/api
```

## 10. Exemple complet de requête avec gestion d'erreur

```typescript
// Exemple avec gestion complète
async function fetchEmployeeData(employeeId: string) {
  try {
    const data = await apiClient.get<Employee>(`/api/employes/${employeeId}`);
    return { success: true, data };
  } catch (error: any) {
    if (error.status === 404) {
      return { success: false, error: 'Employé non trouvé' };
    }
    if (error.status === 401) {
      // Redirection vers login
      window.location.href = '/login';
      return { success: false, error: 'Session expirée' };
    }
    if (error.status === 403) {
      return { success: false, error: 'Accès non autorisé' };
    }
    return { success: false, error: error.message || 'Erreur serveur' };
  }
}
```

## Ressources

- [CORS MDN](https://developer.mozilla.org/fr/docs/Web/HTTP/CORS)
- [Render Environment Variables](https://render.com/docs/environment-variables)
- [Netlify Environment Variables](https://docs.netlify.com/environment-variables/overview/)
