const { PrismaClient } = require('@prisma/client');

async function testConnection() {
  const prisma = new PrismaClient();
  
  try {
    console.log('🔍 Test de connexion à la base de données...');
    
    // Tester une requête simple sans utiliser le champ lastActivity
    const testEmploye = await prisma.employe.findFirst({
      select: { 
        id: true, 
        email: true, 
        nom: true, 
        prenom: true,
        statut: true,
        role: true
      }
    });
    
    if (testEmploye) {
      console.log(`✅ Connexion réussie! Employé trouvé: ${testEmploye.prenom} ${testEmploye.nom} (${testEmploye.email})`);
      console.log(`   Rôle: ${testEmploye.role}, Statut: ${testEmploye.statut}`);
    } else {
      console.log('ℹ️  Aucun employé trouvé dans la base de données.');
      
      // Créer un employé de test si aucun n'existe
      console.log('👤 Création d\'un employé de test...');
      const bcrypt = require('bcrypt');
      const hashedPassword = await bcrypt.hash('test123', 10);
      
      const newEmploye = await prisma.employe.create({
        data: {
          nom: 'Test',
          prenom: 'User',
          email: 'test@example.com',
          password: hashedPassword,
          role: 'employe',
          statut: 'actif'
        }
      });
      
      console.log(`✅ Employé de test créé: ${newEmploye.prenom} ${newEmploye.nom}`);
    }
    
    // Maintenant tester si l'erreur persiste
    console.log('🧪 Test de la fonction getByEmail...');
    const testEmail = await prisma.employe.findUnique({
      where: { email: 'test@example.com' },
      select: { 
        id: true, 
        email: true, 
        nom: true, 
        prenom: true
      }
    });
    
    console.log(`✅ Test getByEmail réussi: ${testEmail?.prenom} ${testEmail?.nom}`);
    
  } catch (error) {
    console.error('❌ Erreur:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await prisma.$disconnect();
  }
}

testConnection();
