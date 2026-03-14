#!/bin/bash

# Script de build pour Render.com v3 - Solution Prisma config
# Résout les problèmes de génération Prisma avec prisma.config.ts

echo "🚀 Démarrage du build v3 pour Render..."

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

# Vérifier les fichiers prisma
echo "📄 Fichiers Prisma trouvés :"
ls -la prisma/

# Installer les dépendances
echo "📦 Installation des dépendances..."
npm install

# Vérifier si Prisma est installé
if ! npx prisma --version > /dev/null 2>&1; then
    echo "❌ Prisma n'est pas installé correctement"
    exit 1
fi

# Générer le client Prisma avec prisma.config.ts (méthode recommandée)
echo "🔧 Génération du client Prisma avec prisma.config.ts..."

# Méthode 1: Utiliser prisma.config.ts (recommandé)
if npx prisma generate; then
    echo "✅ Client Prisma généré avec succès (prisma.config.ts)"
else
    echo "⚠️ Échec avec prisma.config.ts, tentative avec schema explicite..."
    
    # Méthode 2: Spécifier le schema explicitement
    if npx prisma generate --schema=./prisma/schema.prisma; then
        echo "✅ Client Prisma généré avec succès (schema explicite)"
    else
        echo "⚠️ Échec avec schema explicite, tentative avec chemin relatif..."
        
        # Méthode 3: Chemin relatif
        if npx prisma generate --schema=prisma/schema.prisma; then
            echo "✅ Client Prisma généré avec succès (chemin relatif)"
        else
            echo "❌ Échec de toutes les méthodes de génération"
            echo "📁 Contenu du dossier prisma :"
            ls -la prisma/
            echo "📄 Contenu de schema.prisma (premières lignes) :"
            head -10 prisma/schema.prisma
            exit 1
        fi
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

# Supprimer la propriété dépréciée package.json#prisma
echo "🔧 Nettoyage de la configuration dépréciée..."
npm pkg delete prisma 2>/dev/null || true

echo "🎉 Build terminé avec succès!"
