#!/bin/bash

# Script de build pour Render.com v2
# Résout les problèmes de génération Prisma et de fichiers manquants

echo "🚀 Démarrage du build v2 pour Render..."

# Vérifier si on est dans le bon répertoire
if [ ! -d "backend" ]; then
    echo "❌ Erreur: Dossier backend non trouvé. Vérifiez le Root Directory sur Render."
    exit 1
fi

cd backend

# Vérifier la structure des dossiers
echo "📁 Vérification de la structure..."
ls -la

# Vérifier si le dossier prisma existe
if [ ! -d "prisma" ]; then
    echo "❌ Erreur: Dossier prisma non trouvé"
    exit 1
fi

# Vérifier si schema.prisma existe
if [ ! -f "prisma/schema.prisma" ]; then
    echo "❌ Erreur: Fichier schema.prisma non trouvé"
    echo "📁 Contenu du dossier prisma:"
    ls -la prisma/
    exit 1
fi

# Installer les dépendances
echo "📦 Installation des dépendances..."
npm install

# Vérifier si Prisma est installé
if ! npx prisma --version > /dev/null 2>&1; then
    echo "❌ Prisma n'est pas installé correctement"
    exit 1
fi

# Générer le client Prisma
echo "🔧 Génération du client Prisma..."
echo "📄 Schema file: prisma/schema.prisma"
echo "📂 Working directory: $(pwd)"

if npx prisma generate --schema=./prisma/schema.prisma; then
    echo "✅ Client Prisma généré avec succès"
else
    echo "❌ Erreur lors de la génération du client Prisma"
    
    # Tentative avec chemin relatif
    echo "🔄 Tentative avec chemin relatif..."
    npx prisma generate
    
    if [ $? -eq 0 ]; then
        echo "✅ Client Prisma généré avec succès (chemin relatif)"
    else
        echo "❌ Échec de la génération du client Prisma"
        exit 1
    fi
fi

# Vérifier que le client a été généré
if [ -d "node_modules/.prisma/client" ]; then
    echo "✅ Client Prisma vérifié et prêt"
    echo "📁 Contenu de node_modules/.prisma:"
    ls -la node_modules/.prisma/
else
    echo "❌ Client Prisma non trouvé après génération"
    echo "📁 Contenu de node_modules:"
    ls -la node_modules/ | head -10
    exit 1
fi

echo "🎉 Build terminé avec succès!"
