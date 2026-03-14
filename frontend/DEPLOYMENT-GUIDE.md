# 🚀 Guide de Déploiement - Solutions aux erreurs communes

## ❌ Erreur: `npm error code ENEEDAUTH`

### Cause
L'erreur `ENEEDAUTH` se produit quand npm essaie d'installer un package qui nécessite une authentification (package privé ou payant).

### Solution
Le script `start` a été simplifié pour éviter cette erreur:

```json
{
  "scripts": {
    "start": "npm run build"
  }
}
```

## 🏗️ Plateformes de Déploiement

### 1. Render.com
```yaml
# render.yaml
version: "1"
buildCommand: "npm ci && npm run build"
startCommand: "npm start"
outputDirectory: "dist"
nodeVersion: "18"
framework: "vite"
```

### 2. Vercel
```json
// vercel.json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "vite",
  "nodeVersion": "18"
}
```

### 3. Netlify
```toml
# netlify.toml
[build]
  publish = "dist"
  command = "npm run build"

[build.environment]
  NODE_VERSION = "18"
```

### 4. Railway
```yaml
# railway.toml
[build]
  builder = "NIXPACKS"
  buildCommand = "npm run build"

[deploy]
  startCommand = "npm start"
  healthcheckPath = "/loading.html"
  healthcheckTimeout = 100
  restartPolicyType = "ON_FAILURE"
  restartPolicyMaxRetries = 10
```

### 5. Heroku
```json
// package.json (déjà configuré)
{
  "scripts": {
    "start": "npm run build",
    "heroku-postbuild": "npm run build"
  },
  "engines": {
    "node": "18.x"
  }
}
```

## 🔧 Configuration des Variables d'Environnement

### Variables requises pour toutes les plateformes
```bash
NODE_ENV=production
VITE_API_URL=https://votre-backend-url.com
VITE_APP_TITLE=Xpert Pro
VITE_APP_DESCRIPTION=Système de Pointage
```

### Configuration du backend
```bash
DATABASE_URL=postgresql://user:password@host:5432/database
JWT_SECRET=votre-secret-jwt
BADGE_SECRET=votre-secret-badge
SERVICE_MODE=production
PORT=3003
```

## 🌐 Configuration du Reverse Proxy

### Nginx
```nginx
server {
    listen 80;
    server_name votre-domaine.com;
    
    # Frontend
    location / {
        root /path/to/dist;
        try_files $uri $uri/ /index.html;
    }
    
    # API Backend
    location /api/ {
        proxy_pass http://localhost:3003;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### Apache
```apache
<VirtualHost *:80>
    ServerName votre-domaine.com
    DocumentRoot /path/to/dist
    
    # API Backend
    ProxyPass /api/ http://localhost:3003/
    ProxyPassReverse /api/ http://localhost:3003/
    
    # Frontend
    <Directory /path/to/dist>
        RewriteEngine On
        RewriteCond %{REQUEST_FILENAME} !-f
        RewriteCond %{REQUEST_FILENAME} !-d
        RewriteRule . /index.html [L]
    </Directory>
</VirtualHost>
```

## 🔍 Dépannage

### Vérifier le build
```bash
# Build local
npm run build

# Vérifier les fichiers
ls -la dist/

# Servir localement
npm run preview
```

### Logs de déploiement
```bash
# Render
render logs

# Vercel
vercel logs

# Netlify
netlify logs

# Railway
railway logs
```

### Erreurs communes et solutions

| Erreur | Cause | Solution |
|--------|--------|----------|
| `ENEEDAUTH` | Package privé requis | Simplifier le script start |
| `MODULE_NOT_FOUND` | Dépendance manquante | `npm install` |
| `BUILD_FAILED` | Erreur de compilation | Vérifier la syntaxe TypeScript |
| `PORT_IN_USE` | Port déjà utilisé | Changer de port |
| `DB_CONNECTION` | Base de données inaccessible | Vérifier DATABASE_URL |

## 📱 Tests de déploiement

### Test local
```bash
# Simuler l'environnement de production
NODE_ENV=production npm run build

# Servir avec un serveur simple
python -m http.server 8000 --directory dist
```

### Test de l'API
```bash
# Vérifier que l'API répond
curl https://votre-domaine.com/api/health

# Vérifier les CORS
curl -H "Origin: https://votre-domaine.com" \
     -H "Access-Control-Request-Method: GET" \
     -H "Access-Control-Request-Headers: X-Requested-With" \
     -X OPTIONS \
     https://votre-domaine.com/api/some-endpoint
```

## 🚀 Déploiement Automatisé

### Script CI/CD
```bash
#!/bin/bash
# deploy.sh
set -e

echo "🔨 Build de l'application..."
npm ci
npm run build

echo "🚀 Déploiement..."
# Commande spécifique à la plateforme
# Ex: netlify deploy --prod --dir=dist
# Ex: vercel --prod
# Ex: git push heroku main

echo "✅ Déploiement terminé!"
```

### GitHub Actions
```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: npm run build
      - name: Deploy
        uses: votre-action-de-deploiement
        with:
          path: dist
```

---

🎯 **Recommandation**: Utilisez toujours le script `start` le plus simple possible pour éviter les erreurs d'authentification npm.
