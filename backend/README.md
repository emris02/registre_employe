# Xpert Pro Backend

## Scripts disponibles

### Développement local
```bash
npm start          # Démarre le serveur en local (sans migrations)
npm run dev        # Démarre le serveur en mode développement
```

### Production
```bash
npm run start:prod # Démarre le serveur avec migrations et génération Prisma
```

### Base de données
```bash
npm run db:migrate # Applique les migrations et génère le client Prisma
npm run db:generate # Génère uniquement le client Prisma
npm run db:check    # Vérifie la connexion à la base de données
npm run db:users    # Liste les utilisateurs dans la base
npm run db:pull     # Synchronise le schéma depuis la base de données
npm run db:sync     # Synchronisation sécurisée des données
```

### Prisma
```bash
npm run prisma:generate # Génère le client Prisma
npm run prisma:migrate   # Crée de nouvelles migrations
npm run prisma:seed     # Exécute le seeding des données
```

### Utilisation

#### Pour le développement local :
1. Assurez-vous que votre base de données PostgreSQL est configurée
2. Exécutez `npm run db:migrate` une première fois pour créer les tables
3. Lancez le serveur avec `npm start` ou `npm run dev`

#### Pour la production :
1. Utilisez `npm run start:prod` qui exécute les migrations avant de démarrer

## Variables d'environnement

Créez un fichier `.env` à la racine du projet avec :

```env
DATABASE_URL="postgresql://username:password@localhost:5432/database_name"
JWT_SECRET="your-super-secret-jwt-key-here"
PORT=3003
NODE_ENV=development
```

## Architecture

- `server.js` : Point d'entrée principal du serveur
- `prisma/` : Schéma de base de données et migrations
- `models/` : Modèles de données (Employe, Admin, etc.)
- `scripts/` : Scripts utilitaires pour la base de données
