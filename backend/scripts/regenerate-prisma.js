const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🔄 Régénération du client Prisma...');

try {
  // Supprimer le dossier .prisma s'il existe
  const prismaDir = path.join(__dirname, 'node_modules', '.prisma');
  if (fs.existsSync(prismaDir)) {
    console.log('📁 Suppression du dossier .prisma...');
    fs.rmSync(prismaDir, { recursive: true, force: true });
  }

  // Régénérer avec le flag binary
  console.log('⚙️  Génération du client Prisma...');
  execSync('npx prisma generate', { 
    stdio: 'inherit',
    env: { ...process.env, PRISMA_CLIENT_ENGINE_TYPE: 'binary' }
  });

  console.log('✅ Client Prisma régénéré avec succès!');
} catch (error) {
  console.error('❌ Erreur lors de la régénération:', error.message);
  process.exit(1);
}
