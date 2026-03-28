import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { apiClient } from '../../services/apiClient';
import { Key, CheckCircle, AlertCircle, ArrowLeft } from 'lucide-react';

interface ResetPasswordData {
  password: string;
  confirmPassword: string;
}

const ResetPasswordPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [formData, setFormData] = useState<ResetPasswordData>({
    password: '',
    confirmPassword: ''
  });
  const [loading, setLoading] = useState(false);
  const [validToken, setValidToken] = useState<boolean | null>(null);
  const [message, setMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  useEffect(() => {
    if (!token) {
      setValidToken(false);
      setMessage({
        type: 'error',
        text: 'Aucun token fourni.'
      });
      return;
    }

    // Vérifier la validité du token
    const validateToken = async () => {
      try {
        const response = await apiClient.post<{ token: string }, { valid: boolean; message: string }>(
          '/auth/validate-reset-token',
          { token }
        );
        setValidToken(response.valid);
        if (!response.valid) {
          setMessage({
            type: 'error',
            text: response.message || 'Lien invalide ou expiré.'
          });
        }
      } catch (error) {
        setValidToken(false);
        setMessage({
          type: 'error',
          text: 'Erreur lors de la validation du lien.'
        });
      }
    };

    validateToken();
  }, [token]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (formData.password !== formData.confirmPassword) {
      setMessage({
        type: 'error',
        text: 'Les mots de passe ne correspondent pas.'
      });
      return;
    }

    if (formData.password.length < 8) {
      setMessage({
        type: 'error',
        text: 'Le mot de passe doit contenir au moins 8 caractères.'
      });
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      const response = await apiClient.post<ResetPasswordData & { token: string }, { success: boolean; message: string }>(
        '/auth/reset-password',
        {
          token: token!,
          password: formData.password,
          confirmPassword: formData.confirmPassword
        }
      );

      if (response.success) {
        setMessage({
          type: 'success',
          text: 'Votre mot de passe a été réinitialisé avec succès.'
        });
        
        // Rediriger vers la page de connexion après 2 secondes
        setTimeout(() => {
          navigate('/login');
        }, 2000);
      } else {
        setMessage({
          type: 'error',
          text: response.message || 'Une erreur est survenue.'
        });
      }
    } catch (error: any) {
      setMessage({
        type: 'error',
        text: error.message || 'Une erreur est survenue. Veuillez réessayer.'
      });
    } finally {
      setLoading(false);
    }
  };

  if (validToken === null) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Validation du lien en cours...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <div className="mx-auto h-12 w-12 flex items-center justify-center rounded-full bg-blue-100">
            <Key className="h-6 w-6 text-blue-600" />
          </div>
          <h2 className="mt-6 text-3xl font-extrabold text-gray-900">
            Réinitialiser le mot de passe
          </h2>
        </div>

        <div className="bg-white py-8 px-6 shadow-lg rounded-lg">
          {message && (
            <div className={`mb-4 p-4 rounded-md flex items-center ${
              message.type === 'success' 
                ? 'bg-green-50 border border-green-200 text-green-800' 
                : 'bg-red-50 border border-red-200 text-red-800'
            }`}>
              {message.type === 'success' ? (
                <CheckCircle className="h-5 w-5 mr-2" />
              ) : (
                <AlertCircle className="h-5 w-5 mr-2" />
              )}
              <span className="text-sm">{message.text}</span>
            </div>
          )}

          {validToken ? (
            <form className="space-y-6" onSubmit={handleSubmit}>
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                  Nouveau mot de passe
                </label>
                <div className="mt-1">
                  <input
                    id="password"
                    name="password"
                    type="password"
                    required
                    value={formData.password}
                    onChange={handleChange}
                    className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    placeholder="Minimum 8 caractères"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700">
                  Confirmer le mot de passe
                </label>
                <div className="mt-1">
                  <input
                    id="confirmPassword"
                    name="confirmPassword"
                    type="password"
                    required
                    value={formData.confirmPassword}
                    onChange={handleChange}
                    className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    placeholder="Confirmez le mot de passe"
                  />
                </div>
              </div>

              <div>
                <button
                  type="submit"
                  disabled={loading}
                  className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <div className="flex items-center">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      Réinitialisation en cours...
                    </div>
                  ) : (
                    <>
                      <Key className="h-4 w-4 mr-2" />
                      Réinitialiser le mot de passe
                    </>
                  )}
                </button>
              </div>
            </form>
          ) : (
            <div className="text-center">
              <p className="text-gray-600 mb-4">
                Le lien de réinitialisation est invalide ou a expiré.
              </p>
              <a
                href="/forgot-password"
                className="inline-flex items-center text-sm text-blue-600 hover:text-blue-500 font-medium"
              >
                Demander un nouveau lien
              </a>
            </div>
          )}

          <div className="mt-6 text-center">
            <Link
              to="/login"
              className="inline-flex items-center text-sm text-blue-600 hover:text-blue-500 font-medium"
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Retour à la connexion
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ResetPasswordPage;
