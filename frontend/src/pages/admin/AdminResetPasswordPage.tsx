import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiClient } from '../../services/apiClient';
import { Key, Save, X, AlertTriangle, CheckCircle } from 'lucide-react';

interface AdminResetPasswordData {
  newPassword: string;
  confirmPassword: string;
}

const AdminResetPasswordPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [formData, setFormData] = useState<AdminResetPasswordData>({
    newPassword: '',
    confirmPassword: ''
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
    
    if (!id) {
      setMessage({
        type: 'error',
        text: 'ID administrateur manquant.'
      });
      return;
    }

    if (formData.newPassword.length < 8) {
      setMessage({
        type: 'error',
        text: 'Le mot de passe doit contenir au moins 8 caractères.'
      });
      return;
    }

    if (formData.newPassword !== formData.confirmPassword) {
      setMessage({
        type: 'error',
        text: 'Les mots de passe ne correspondent pas.'
      });
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      const response = await apiClient.post<AdminResetPasswordData & { adminId: string }, { success: boolean; message: string }>(
        '/admins/reset-password',
        {
          adminId: id,
          newPassword: formData.newPassword,
          confirmPassword: formData.confirmPassword
        }
      );

      if (response.success) {
        setMessage({
          type: 'success',
          text: 'Mot de passe réinitialisé avec succès.'
        });
        
        // Rediriger vers le dashboard admin après 2 secondes
        setTimeout(() => {
          navigate('/admin/dashboard?panel=admins');
        }, 2000);
      } else {
        setMessage({
          type: 'error',
          text: response.message || 'Erreur lors de la réinitialisation.'
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

  const handleCancel = () => {
    navigate('/admin/dashboard?panel=admins');
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white shadow-lg rounded-lg overflow-hidden">
          {/* Header */}
          <div className="bg-yellow-500 text-white px-6 py-4">
            <div className="flex items-center">
              <Key className="h-6 w-6 mr-3" />
              <h3 className="text-xl font-semibold">
                Réinitialisation du mot de passe administrateur
              </h3>
            </div>
          </div>

          {/* Body */}
          <div className="p-6">
            {message && (
              <div className={`mb-4 p-4 rounded-md flex items-center ${
                message.type === 'success' 
                  ? 'bg-green-50 border border-green-200 text-green-800' 
                  : 'bg-red-50 border border-red-200 text-red-800'
              }`}>
                {message.type === 'success' ? (
                  <CheckCircle className="h-5 w-5 mr-2 flex-shrink-0" />
                ) : (
                  <AlertTriangle className="h-5 w-5 mr-2 flex-shrink-0" />
                )}
                <span className="text-sm">{message.text}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label htmlFor="newPassword" className="block text-sm font-medium text-gray-700">
                  Nouveau mot de passe
                </label>
                <div className="mt-1">
                  <input
                    id="newPassword"
                    name="newPassword"
                    type="password"
                    required
                    value={formData.newPassword}
                    onChange={handleChange}
                    className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md placeholder-gray-400 focus:outline-none focus:ring-yellow-500 focus:border-yellow-500 sm:text-sm"
                    placeholder="Minimum 8 caractères"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Minimum 8 caractères
                  </p>
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
                    className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md placeholder-gray-400 focus:outline-none focus:ring-yellow-500 focus:border-yellow-500 sm:text-sm"
                    placeholder="Confirmez le mot de passe"
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div className="space-y-3">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex justify-center items-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-yellow-500 hover:bg-yellow-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-yellow-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <div className="flex items-center">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      Enregistrement en cours...
                    </div>
                  ) : (
                    <>
                      <Save className="h-4 w-4 mr-2" />
                      Enregistrer
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleCancel}
                  className="w-full flex justify-center items-center py-2 px-4 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
                >
                  <X className="h-4 w-4 mr-2" />
                  Annuler
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Info Section */}
        <div className="mt-6 bg-blue-50 border border-blue-200 rounded-md p-4">
          <div className="flex">
            <AlertTriangle className="h-5 w-5 text-blue-600 mr-2 flex-shrink-0" />
            <div className="text-sm text-blue-800">
              <h4 className="font-medium mb-1">Important</h4>
              <ul className="list-disc list-inside space-y-1">
                <li>Le mot de passe doit contenir au moins 8 caractères</li>
                <li>L'administrateur concerné devra utiliser son nouveau mot de passe lors de sa prochaine connexion</li>
                <li>Cette action est enregistrée dans les logs de sécurité</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminResetPasswordPage;
