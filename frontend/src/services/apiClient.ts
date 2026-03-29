export interface ApiError {
  message: string;
  status?: number;
  [key: string]: unknown;
}

const resolveDefaultBaseUrl = (): string => {
  // En production, utiliser toujours l'URL relative pour éviter d'exposer les secrets
  if (import.meta.env.PROD) {
    return '/api';
  }
  
  // En développement, utiliser la variable d'environnement si disponible
  const rawEnvValue = String(import.meta.env?.VITE_API_URL ?? '').trim();
  if (!rawEnvValue) return '/api';

  const normalized = rawEnvValue.replace(/\/+$/, '');
  const isBrowser = typeof window !== 'undefined';
  const runningOnLocalhost = isBrowser
    ? ['localhost', '127.0.0.1'].includes(window.location.hostname)
    : false;
  const envTargetsLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(normalized);

  // Prevent production builds from using a localhost API URL accidentally.
  if (isBrowser && !runningOnLocalhost && envTargetsLocalhost) {
    return '/api';
  }

  if (/^https?:\/\//i.test(normalized)) {
    return /\/api$/i.test(normalized) ? normalized : `${normalized}/api`;
  }

  return normalized.startsWith('/api') ? normalized : '/api';
};

const DEFAULT_BASE_URL = resolveDefaultBaseUrl();

export class ApiClient {
  constructor(private readonly baseUrl: string = DEFAULT_BASE_URL) {}

  private buildHeaders(initHeaders?: HeadersInit): Headers {
    const headers = new Headers(initHeaders);
    const token = localStorage.getItem('auth_token');
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    return headers;
  }

  private buildUrl(path: string): string {
    if (path.startsWith('http://') || path.startsWith('https://')) {
      return path;
    }

    const normalizedBase = this.baseUrl.replace(/\/+$/, '');
    const normalizedPath = path.replace(/^\/+/, '');
    const isAbsoluteBase = /^https?:\/\//i.test(normalizedBase);

    if (isAbsoluteBase) {
      const pathWithoutApiPrefix = normalizedPath.startsWith('api/')
        ? normalizedPath.slice(4)
        : normalizedPath === 'api'
          ? ''
          : normalizedPath;

      return pathWithoutApiPrefix ? `${normalizedBase}/${pathWithoutApiPrefix}` : normalizedBase;
    }

    if (normalizedPath.startsWith('api/')) {
      return `/${normalizedPath}`;
    }

    if (normalizedPath === 'api') {
      return '/api';
    }

    return `${normalizedBase}/${normalizedPath}`;
  }

  async get<T>(path: string): Promise<T> {
    const response = await fetch(this.buildUrl(path), {
      credentials: 'include',
      headers: this.buildHeaders()
    });
    return this.handleResponse<T>(response);
  }

  async post<TPayload, TResponse>(path: string, payload: TPayload | FormData, options?: RequestInit): Promise<TResponse> {
    const isFormData = payload instanceof FormData;
    const headers = this.buildHeaders(options?.headers);
    if (!isFormData && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(this.buildUrl(path), {
      method: 'POST',
      headers,
      credentials: 'include',
      body: isFormData ? payload : JSON.stringify(payload),
      ...options
    });
    return this.handleResponse<TResponse>(response);
  }

  async put<TPayload, TResponse>(path: string, payload: TPayload): Promise<TResponse> {
    const headers = this.buildHeaders({ 'Content-Type': 'application/json' });
    const response = await fetch(this.buildUrl(path), {
      method: 'PUT',
      headers,
      credentials: 'include',
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

  private async handleResponse<T>(response: Response): Promise<T> {
    const contentType = response.headers.get('content-type') ?? '';
    const isJson = contentType.includes('application/json');

    if (!response.ok) {
      let message = `Erreur HTTP ${response.status}`;
      let errorBody: any = null;

      if (isJson) {
        try {
          errorBody = await response.json();
          if (typeof errorBody?.message === 'string') {
            message = errorBody.message;
          }
        } catch {
          // ignore JSON parse error
        }
      }

      const error: ApiError = {
        message,
        status: response.status,
        ...(errorBody && typeof errorBody === 'object' ? errorBody : {})
      };
      throw error;
    }

    if (!isJson) {
      return (await response.text()) as unknown as T;
    }

    return (await response.json()) as T;
  }
}

export const apiClient = new ApiClient();
