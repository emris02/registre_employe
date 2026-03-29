import React, { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../services/authService'
import '../styles/pages/LoginPage.css'

const ADMIN_PORTAL_ROLES = new Set(['admin', 'super_admin', 'manager', 'hr'])

const isAdminPortalRole = (role?: string) => ADMIN_PORTAL_ROLES.has(String(role || '').toLowerCase())

const LoginPage: React.FC = () => {
  const navigate = useNavigate()
  const { login, user, isAuthenticated, isLoading: authLoading } = useAuth()

  const [formData, setFormData] = useState({
    email: '',
    password: ''
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  useEffect(() => {
    if (authLoading || !isAuthenticated || !user) {
      return
    }
    const canAccessAdmin = isAdminPortalRole(user.role)
    navigate(canAccessAdmin ? '/admin' : '/employee', { replace: true })
  }, [authLoading, isAuthenticated, navigate, user])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setFormData((prev) => ({
      ...prev,
      [name]: value
    }))
    setError('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError('')

    try {
      const result = await login(formData.email.trim().toLowerCase(), formData.password)
      if (!result.success || !result.user) {
        setError(result.error || 'Email ou mot de passe incorrect')
        return
      }

      const canAccessAdminPortal = isAdminPortalRole(result.user.role)
      navigate(canAccessAdminPortal ? '/admin' : '/employee', { replace: true })
    } catch {
      setError('Erreur de connexion. Veuillez reessayer.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-background">
        <div className="animated-shapes">
          <div className="shape shape-1"></div>
          <div className="shape shape-2"></div>
          <div className="shape shape-3"></div>
        </div>
      </div>

      <div className="login-container">
        <div className="login-card">
          <div className="login-header">
            <div className="login-logo">
              <img src="/xpertpro.png" alt="Xpert Pro" className="login-logo-image" />
              <span>Xpert Pro</span>
            </div>
            <h2>Connexion</h2>
            <p>Accedez a votre espace de travail</p>
          </div>

          <form onSubmit={handleSubmit} className="login-form">
            <div className="form-group">
              <label htmlFor="email">
                <i className="fas fa-envelope"></i>
                Email professionnel
              </label>
              <input
                type="email"
                id="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                placeholder="prenom.nom@xpertpro.com"
                required
                disabled={submitting || authLoading}
              />
            </div>

            <div className="form-group">
              <label htmlFor="password">
                <i className="fas fa-lock"></i>
                Mot de passe
              </label>
              <div className="password-input">
                <input
                  type={showPassword ? 'text' : 'password'}
                  id="password"
                  name="password"
                  value={formData.password}
                  onChange={handleChange}
                  placeholder="Votre mot de passe"
                  required
                  disabled={submitting || authLoading}
                />
                <button
                  type="button"
                  className="toggle-password"
                  onClick={() => setShowPassword(!showPassword)}
                  disabled={submitting || authLoading}
                >
                  <i className={`fas ${showPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                </button>
              </div>
            </div>

            {error ? (
              <div className="error-message">
                <i className="fas fa-exclamation-triangle"></i>
                {error}
              </div>
            ) : null}

            <button
              type="submit"
              className="login-btn"
              disabled={submitting || authLoading}
            >
              {submitting ? (
                <>
                  <i className="fas fa-spinner fa-spin"></i>
                  Connexion en cours...
                </>
              ) : (
                <>
                  <i className="fas fa-sign-in-alt"></i>
                  Se connecter
                </>
              )}
            </button>
          </form>

          <div className="login-footer">
            <div className="forgot-password-link">
              <Link to="/forgot-password" className="forgot-password">
                <i className="fas fa-key"></i>
                Mot de passe oublié ?
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default LoginPage
