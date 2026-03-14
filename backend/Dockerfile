# Dockerfile pour la production
FROM node:18-alpine

# Définition du répertoire de travail
WORKDIR /app

# Copie des fichiers package
COPY package*.json ./

# Installation des dépendances de production
RUN npm ci --only=production

# Copie du code source
COPY . .

# Génération de Prisma Client
RUN npx prisma generate

# Création du répertoire des logs
RUN mkdir -p logs

# Exposition du port
EXPOSE 3003

# Variables d'environnement par défaut
ENV NODE_ENV=production
ENV SERVICE_MODE=production

# Commande de démarrage
CMD ["node", "server.js"]
