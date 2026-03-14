# 🚀 Déploiement en Production - Xpert Pro

Ce guide explique comment déployer l'application Xpert Pro en production avec gestion des emails uniques.

## ✅ Prérequis

### Système
- Node.js 18+ 
- PostgreSQL 15+
- Nginx (optionnel mais recommandé)
- Docker & Docker Compose (optionnel)

### Domaine et SSL
- Nom de domaine configuré
- Certificat SSL/TLS
- DNS configuré pour pointer vers le serveur

## 📧 Configuration de la Base de Données

### 1. Contraintes d'Email Unique ✅

L'application gère déjà l'unicité des emails à plusieurs niveaux:

#### **Niveau Base de Données**
```sql
-- Contraintes uniques déjà existantes
CREATE UNIQUE INDEX "admins_email_key" ON "admins"("email");
CREATE UNIQUE INDEX "employes_email_key" ON "employes"("email");
```

#### **Niveau Application**
- ✅ Validation lors de la création d'utilisateurs
- ✅ Vérification des doublons dans les deux tables (admins + employés)
- ✅ Endpoint de validation d'email `/api/admin/employes/validate-email`
- ✅ Messages d'erreur clairs : "Email déjà utilisé"

### 2. Configuration PostgreSQL

Créez votre base de données:
```sql
CREATE DATABASE pointage_production;
CREATE USER xpert_user WITH PASSWORD 'votre_mot_de_passe';
GRANT ALL PRIVILEGES ON DATABASE pointage_production TO xpert_user;
```

## 🔧 Configuration de l'Application

### 1. Variables d'Environnement

Copiez `.env.example` vers `.env.production` et configurez:

```bash
# Base de données
DATABASE_URL="postgresql://xpert_user:votre_mot_de_passe@localhost:5432/pointage_production"

# Secrets (générez-les!)
JWT_SECRET="openssl rand -base64 32"
BADGE_SECRET="openssl rand -base64 32"

# Mode production
NODE_ENV=production
SERVICE_MODE=production

# Domaine
ALLOWED_ORIGINS=https://votre-domaine.com,https://www.votre-domaine.com
FRONTEND_URL=https://votre-domaine.com

# Email (optionnel)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=votre-email@gmail.com
SMTP_PASS=votre-mot-de-passe-app
```

### 2. Génération des Secrets

```bash
# Générez des secrets sécurisés
JWT_SECRET=$(openssl rand -base64 32)
BADGE_SECRET=$(openssl rand -base64 32)

echo "JWT_SECRET=$JWT_SECRET" >> .env.production
echo "BADGE_SECRET=$BADGE_SECRET" >> .env.production
```

## 🚀 Méthodes de Déploiement

### Méthode 1: Script Automatique

```bash
# Rendez le script exécutable
chmod +x deploy-production.sh

# Exécutez le déploiement
./deploy-production.sh
```

Le script vérifie:
- ✅ Connexion à la base de données
- ✅ Absence d'emails dupliqués
- ✅ Build de l'application
- ✅ Démarrage en mode production

### Méthode 2: Docker Compose

```bash
# Créez le fichier .env avec les variables
cp .env.example .env

# Démarrez les services
docker-compose up -d

# Vérifiez les logs
docker-compose logs -f backend
```

### Méthode 3: Manuel

```bash
# Installation
npm ci --production

# Build
npm run build

# Démarrage
NODE_ENV=production SERVICE_MODE=production node server.js
```

## 🔍 Validation des Emails Uniques

Le système inclut une validation automatique:

### Test de Validation
```bash
# Vérifiez qu'il n'y a pas de doublons
node -e "
require('dotenv').config({ path: '.env.production' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkEmails() {
  const adminDupes = await prisma.\$queryRaw\`
    SELECT email, COUNT(*) as count FROM admins GROUP BY email HAVING COUNT(*) > 1
  \`;
  const empDupes = await prisma.\$queryRaw\`
    SELECT email, COUNT(*) as count FROM employes GROUP BY email HAVING COUNT(*) > 1
  \`;
  
  console.log('Admins avec emails dupliqués:', adminDupes);
  console.log('Employés avec emails dupliqués:', empDupes);
}

checkEmails();
"
```

### Endpoint de Validation
```
GET /api/admin/employes/validate-email?email=test@example.com&exclude_id=123

Response:
{
  "is_valid": false,
  "message": "Email déjà utilisé"
}
```

## 🌐 Configuration Nginx

### Reverse Proxy Configuration

Le fichier `nginx.conf` inclus configure:

- ✅ HTTPS avec SSL/TLS
- ✅ Redirection HTTP → HTTPS
- ✅ Proxy vers le backend (port 3003)
- ✅ Compression Gzip
- ✅ En-têtes de sécurité
- ✅ Cache pour les assets statiques

### Installation
```bash
# Copiez la configuration
sudo cp nginx.conf /etc/nginx/sites-available/xpert-pro

# Activez le site
sudo ln -s /etc/nginx/sites-available/xpert-pro /etc/nginx/sites-enabled/

# Testez la configuration
sudo nginx -t

# Rechargez Nginx
sudo systemctl reload nginx
```

## 📊 Monitoring et Logs

### Logs de l'Application
```bash
# Logs en temps réel
tail -f logs/app.log

# Logs d'erreurs
tail -f logs/error.log
```

### Monitoring Docker
```bash
# Statuts des conteneurs
docker-compose ps

# Logs des services
docker-compose logs -f
```

## 🔒 Sécurité en Production

### 1. Variables d'Environnement
- ✅ Utilisez des secrets forts et uniques
- ✅ Ne commitez jamais `.env.production`
- ✅ Utilisez des secrets différents pour JWT et Badge

### 2. Base de Données
- ✅ Utilisateur dédié avec droits limités
- ✅ Connexions SSL obligatoires
- ✅ Backups réguliers

### 3. Réseau
- ✅ HTTPS obligatoire
- ✅ CORS configuré pour votre domaine
- ✅ En-têtes de sécurité activés

## 🚨 Dépannage

### Erreurs Communes

#### "Email déjà utilisé"
```bash
# Vérifiez les doublons dans la base
SELECT email, COUNT(*) FROM (
  SELECT email FROM admins
  UNION ALL
  SELECT email FROM employes
) GROUP BY email HAVING COUNT(*) > 1;
```

#### "Connexion base de données refusée"
```bash
# Vérifiez les permissions
psql -h localhost -U xpert_user -d pointage_production

# Vérifiez le DATABASE_URL
echo $DATABASE_URL
```

#### "Port déjà utilisé"
```bash
# Vérifiez les processus
lsof -i :3003

# Tuez le processus si nécessaire
kill -9 <PID>
```

## 📞 Support

Pour toute question sur le déploiement:
1. Vérifiez les logs ci-dessus
2. Consultez la documentation
3. Contactez l'équipe technique

---

✅ **L'application garantit l'unicité des emails à tous les niveaux !**
