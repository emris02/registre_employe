const { PrismaClient } = require('@prisma/client');

async function checkAndAddLastActivity() {
  const prisma = new PrismaClient();
  
  try {
    console.log('🔍 Vérification du champ lastActivity dans la table employes...');
    
    // Vérifier si la colonne existe
    const result = await prisma.$queryRaw`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'employes' 
      AND column_name = 'last_activity'
    `;
    
    if (result.length === 0) {
      console.log('❌ Le champ last_activity n\'existe pas. Tentative d\'ajout...');
      
      // Ajouter la colonne manuellement
      await prisma.$executeRaw`ALTER TABLE employes ADD COLUMN last_activity TIMESTAMP`;
      
      console.log('✅ Champ last_activity ajouté avec succès!');
    } else {
      console.log('✅ Le champ last_activity existe déjà.');
    }
    
    // Tester une requête simple
    console.log('🧪 Test de connexion à la table employes...');
    const testEmploye = await prisma.employe.findFirst({
      select: { id: true, email: true, nom: true }
    });
    
    if (testEmploye) {
      console.log(`✅ Connexion réussie! Employé trouvé: ${testEmploye.nom} (${testEmploye.email})`);
    } else {
      console.log('ℹ️  Aucun employé trouvé dans la base de données.');
    }
    
  } catch (error) {
    console.error('❌ Erreur:', error.message);
    
    // Si l'erreur parle de 'colonne', c'est probablement un problème de schéma
    if (error.message.includes('colonne') || error.message.includes('column')) {
      console.log('🔧 Tentative de régénération du client Prisma...');
      try {
        const { execSync } = require('child_process');
        execSync('npx prisma generate', { 
          stdio: 'inherit',
          env: { ...process.env, PRISMA_CLIENT_ENGINE_TYPE: 'binary' }
        });
        console.log('✅ Client Prisma régénéré!');
      } catch (genError) {
        console.error('❌ Impossible de régénérer le client Prisma:', genError.message);
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

checkAndAddLastActivity();
