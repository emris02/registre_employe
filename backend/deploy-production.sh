#!/bin/bash

# Script de déploiement pour la production
# Auteur: Xpert Pro Team

echo "🚀 Déploiement en production de Xpert Pro"

# Vérification des variables d'environnement
if [ ! -f ".env.production" ]; then
    echo "❌ Erreur: Fichier .env.production non trouvé"
    echo "📝 Créez le fichier .env.production avec vos configurations de production"
    exit 1
fi

# Installation des dépendances
echo "📦 Installation des dépendances..."
npm ci --production

# Vérification de la base de données
echo "🗄️ Vérification de la connexion à la base de données..."
node -e "
require('dotenv').config({ path: '.env.production' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.\$connect()
  .then(() => {
    console.log('✅ Connexion à la base de données réussie');
    return prisma.\$disconnect();
  })
  .catch((error) => {
    console.error('❌ Erreur de connexion à la base de données:', error.message);
    process.exit(1);
  });
"

# Build de l'application
echo "🔨 Build de l'application..."
npm run build

# Vérification des contraintes d'email unique
echo "🔍 Vérification des contraintes d'email unique..."
node -e "
require('dotenv').config({ path: '.env.production' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkEmailConstraints() {
  try {
    // Vérification des contraintes sur les admins
    const adminsWithDuplicateEmails = await prisma.\$queryRaw\`
      SELECT email, COUNT(*) as count 
      FROM admins 
      GROUP BY email 
      HAVING COUNT(*) > 1
    \`;
    
    // Vérification des contraintes sur les employés
    const employesWithDuplicateEmails = await prisma.\$queryRaw\`
      SELECT email, COUNT(*) as count 
      FROM employes 
      GROUP BY email 
      HAVING COUNT(*) > 1
    \`;
    
    if (adminsWithDuplicateEmails.length > 0 || employesWithDuplicateEmails.length > 0) {
      console.log('⚠️ Emails dupliqués détectés:');
      console.log('Admins:', adminsWithDuplicateEmails);
      console.log('Employés:', employesWithDuplicateEmails);
      console.log('❌ Déploiement annulé - Corrigez les duplications d\'emails');
      process.exit(1);
    }
    
    console.log('✅ Aucune duplication d\'email détectée');
    await prisma.\$disconnect();
  } catch (error) {
    console.error('❌ Erreur lors de la vérification:', error.message);
    process.exit(1);
  }
}

checkEmailConstraints();
"

# Démarrage du serveur en mode production
echo "🌐 Démarrage du serveur en mode production..."
NODE_ENV=production SERVICE_MODE=production node server.js

echo "✅ Déploiement terminé avec succès!"
echo "🌍 Serveur disponible sur le port configuré"
