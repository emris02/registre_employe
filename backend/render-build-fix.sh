#!/bin/bash

# Script de build pour Render.com
# Résout les problèmes de génération Prisma

echo "🚀 Démarrage du build pour Render..."

# Vérifier si Prisma est installé
if ! command -v prisma &> /dev/null; then
    echo "📦 Installation de Prisma CLI..."
    npm install -g prisma
fi

# Installer les dépendances
echo "📦 Installation des dépendances..."
npm install

# Générer le client Prisma avec gestion d'erreur
echo "🔧 Génération du client Prisma..."
if npx prisma generate; then
    echo "✅ Client Prisma généré avec succès"
else
    echo "❌ Erreur lors de la génération du client Prisma"
    
    # Tentative de réparation
    echo "🔧 Tentative de réparation..."
    
    # Vérifier le schéma
    if [ -f "prisma/schema.prisma" ]; then
        echo "✅ Fichier schema.prisma trouvé"
        
        # Recréer le client
        npx prisma generate --schema=./prisma/schema.prisma
    else
        echo "❌ Fichier schema.prisma non trouvé"
        exit 1
    fi
fi

# Vérifier que le client a été généré
if [ -d "node_modules/.prisma/client" ]; then
    echo "✅ Client Prisma vérifié et prêt"
else
    echo "❌ Client Prisma non trouvé après génération"
    exit 1
fi

echo "🎉 Build terminé avec succès!"
