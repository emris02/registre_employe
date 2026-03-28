import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../../services/apiClient';
import { Mail, ArrowLeft, CheckCircle, AlertCircle } from 'lucide-react';

interface ForgotPasswordData {
  email: string;
}

const ForgotPasswordPage: React.FC = () => {
  const [formData, setFormData] = useState<ForgotPasswordData>({
    email: ''
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      const response = await apiClient.post<ForgotPasswordData, { success: boolean; message: string }>(
        '/auth/forgot-password',
        formData
      );

      if (response.success) {
        setMessage({
          type: 'success',
          text: 'Un email de réinitialisation a été envoyé à votre adresse email.'
        });
        setFormData({ email: '' });
      } else {
        setMessage({
          type: 'error',
          text: response.message || 'Une erreur est survenue. Veuillez réessayer.'
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

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <div className="mx-auto h-12 w-12 flex items-center justify-center rounded-full bg-blue-100">
            <Mail className="h-6 w-6 text-blue-600" />
          </div>
          <h2 className="mt-6 text-3xl font-extrabold text-gray-900">
            Mot de passe oublié
          </h2>
          <p className="mt-2 text-sm text-gray-600">
            Entrez votre adresse email pour recevoir un lien de réinitialisation
          </p>
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

          <form className="space-y-6" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                Adresse email
              </label>
              <div className="mt-1">
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={formData.email}
                  onChange={handleChange}
                  className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  placeholder="exemple@email.com"
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
                    Envoi en cours...
                  </div>
                ) : (
                  <>
                    <Mail className="h-4 w-4 mr-2" />
                    Envoyer le lien
                  </>
                )}
              </button>
            </div>
          </form>

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

        <div className="text-center text-xs text-gray-500">
          <p>
            Le lien de réinitialisation expirera dans 1 heure.
          </p>
          <p className="mt-1">
            Si vous ne recevez pas l'email, vérifiez votre dossier spam.
          </p>
        </div>
      </div>
    </div>
  );
};

export default ForgotPasswordPage;
