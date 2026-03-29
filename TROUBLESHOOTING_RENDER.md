# Guide de Dépannage Render - Erreur 500

## 🔍 **Problème identifié**
Erreur `POST https://registre-employe.onrender.com/api/auth/login 500 (Internal Server Error)`

## 🎯 **Causes possibles et solutions**

### 1. **Base de données inaccessible** ❌
**Symptôme** : Le backend ne peut pas se connecter à PostgreSQL

**Solution** :
1. Vérifiez que la base de données est en ligne sur Render
2. Vérifiez l'URL `DATABASE_URL` dans les variables Render
3. Assurez-vous que SSL est activé (obligatoire pour Render)

**Variables à vérifier dans Render Dashboard** :
```bash
DATABASE_URL=postgresql://username:password@host:5432/database
NODE_ENV=production
PORT=3003
```

### 2. **Variables d'environnement manquantes** ❌
**Symptôme** : Le backend démarre mais ne trouve pas les configurations

**Solution** : Ajoutez ces variables dans Render Dashboard :
```bash
# Base de données
DATABASE_URL=postgresql://moha:wrnfpiygQPZAeTxw8AkgmTbMGIXFWGC0@dpg-d707rvndiees73dfq7og-a:5432/pointage_319l

# Configuration
NODE_ENV=production
PORT=3003
SERVICE_MODE=production

# Secrets
JWT_SECRET=k7P8xQ2zR5vN9mF3hJ6tW1yG4cV8bX2zS5dE9gH4jK7pL3nO6qR1uY8iA0sD4fG
BADGE_SECRET=mN9vB2xQ5wZ8cF1hJ4kL7pO3rT6yU9iA2sD5eG8gH1jK4nQ7pV0bX3zS6dF9c

# CORS pour Netlify
CORS_ORIGIN=https://registre-employe.netlify.app
FRONTEND_URL=https://registre-employe.netlify.app
```

### 3. **CORS mal configuré** ❌
**Symptôme** : Le frontend ne peut pas appeler l'API

**Solution** : Ajoutez l'URL Netlify dans CORS :
```bash
CORS_ORIGIN=https://registre-employe.netlify.app
CORS_ALLOWED_ORIGINS=https://registre-employe.netlify.app
```

### 4. **Migrations non exécutées** ❌
**Symptôme** : Les tables n'existent pas dans la base

**Solution** : Exécutez les migrations sur Render :
1. Connectez-vous en SSH à votre service Render
2. Exécutez : `npx prisma migrate deploy`
3. Ou ajoutez `npx prisma migrate deploy` au build script

## 🔧 **Actions immédiates**

### 1. Vérifiez les logs Render
Allez dans votre dashboard Render → Logs du service "registre-employe"

### 2. Testez l'endpoint de santé
```bash
curl https://registre-employe.onrender.com/api/health
```

### 3. Exécutez le diagnostic
Ajoutez ce script dans votre build et vérifiez les logs :
```javascript
// Dans server.js au démarrage
console.log('🚀 Backend démarré avec:');
console.log('DATABASE_URL:', process.env.DATABASE_URL ? 'CONFIGURÉ' : 'MANQUANT');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('PORT:', process.env.PORT);
```

## 📋 **Checklist de déploiement**

- [ ] Base de données PostgreSQL en ligne sur Render
- [ ] Variables d'environnement configurées dans Render
- [ ] DATABASE_URL correcte avec SSL
- [ ] JWT_SECRET et BADGE_SECRET configurés
- [ ] CORS_ORIGIN pointe vers Netlify
- [ ] Migrations Prisma exécutées
- [ ] Service Render redémarré après configuration

## 🚨 **Si le problème persiste**

1. **Redémarrez le service** Render
2. **Re-créez le service** Render si nécessaire
3. **Vérifiez la région** du serveur et de la base
4. **Contactez le support Render** avec les logs d'erreur

## 📞 **Support Render**
- Dashboard : https://dashboard.render.com
- Documentation : https://render.com/docs
- Status : https://status.render.com
