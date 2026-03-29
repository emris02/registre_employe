#!/usr/bin/env node

// Script de test pour diagnostiquer l'erreur 500 sur Render
// Exécutez ce script localement pour simuler l'environnement Render

console.log('🔍 Diagnostic Erreur 500 - Auth Login');
console.log('=====================================');

// Test 1: Simulation de la requête login
async function testLoginEndpoint() {
  try {
    console.log('\n📡 Test de l\'endpoint /api/auth/login...');
    
    const response = await fetch('https://registre-employe.onrender.com/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://registre-employe.netlify.app'
      },
      body: JSON.stringify({
        email: 'test@example.com',
        password: 'testpassword'
      })
    });
    
    console.log('Status:', response.status);
    console.log('Headers:', Object.fromEntries(response.headers.entries()));
    
    const text = await response.text();
    console.log('Response body:', text);
    
    if (response.status === 500) {
      console.log('\n❌ Erreur 500 confirmée');
      console.log('💡 Le problème vient du backend Render');
    }
    
  } catch (error) {
    console.error('❌ Erreur réseau:', error.message);
  }
}

// Test 2: Vérification de l'endpoint health
async function testHealthEndpoint() {
  try {
    console.log('\n🏥 Test de l\'endpoint /api/health...');
    
    const response = await fetch('https://registre-employe.onrender.com/api/health');
    const data = await response.json();
    
    console.log('Status:', response.status);
    console.log('Response:', data);
    
    if (response.ok) {
      console.log('✅ Backend accessible');
    } else {
      console.log('❌ Backend inaccessible');
    }
    
  } catch (error) {
    console.error('❌ Erreur health endpoint:', error.message);
  }
}

// Test 3: Vérification des CORS headers
async function testCORS() {
  try {
    console.log('\n🌐 Test des CORS headers...');
    
    const response = await fetch('https://registre-employe.onrender.com/api/health', {
      method: 'OPTIONS',
      headers: {
        'Origin': 'https://registre-employe.netlify.app',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type'
      }
    });
    
    console.log('OPTIONS Status:', response.status);
    console.log('CORS Headers:');
    console.log('  Access-Control-Allow-Origin:', response.headers.get('Access-Control-Allow-Origin'));
    console.log('  Access-Control-Allow-Methods:', response.headers.get('Access-Control-Allow-Methods'));
    console.log('  Access-Control-Allow-Headers:', response.headers.get('Access-Control-Allow-Headers'));
    
  } catch (error) {
    console.error('❌ Erreur CORS test:', error.message);
  }
}

// Test 4: Analyse des erreurs possibles
function analyzePossibleCauses() {
  console.log('\n🎯 Analyse des causes possibles:');
  console.log('================================');
  
  const causes = [
    {
      issue: 'Base de données inaccessible',
      symptoms: ['PrismaClientInitializationError', 'Can\'t reach database server'],
      solution: 'Vérifier DATABASE_URL et connexion PostgreSQL'
    },
    {
      issue: 'Variables d\'environnement manquantes',
      symptoms: ['JWT_SECRET undefined', 'process.env.DATABASE_URL undefined'],
      solution: 'Configurer toutes les variables dans Render Dashboard'
    },
    {
      issue: 'Migrations non exécutées',
      symptoms: ['Table doesn\'t exist', 'relation "admin" does not exist'],
      solution: 'Exécuter npx prisma migrate deploy'
    },
    {
      issue: 'CORS mal configuré',
      symptoms: ['CORS policy error', 'Origin not allowed'],
      solution: 'Configurer CORS_ORIGIN=https://registre-employe.netlify.app'
    },
    {
      issue: 'Memory/CPU limit dépassé',
      symptoms: ['JavaScript heap out of memory', 'Timeout'],
      solution: 'Upgrader le plan Render ou optimiser le code'
    }
  ];
  
  causes.forEach((cause, index) => {
    console.log(`\n${index + 1}. ${cause.issue}`);
    console.log(`   Symptômes: ${cause.symptoms.join(', ')}`);
    console.log(`   Solution: ${cause.solution}`);
  });
}

// Actions recommandées
function showRecommendedActions() {
  console.log('\n🚀 Actions recommandées IMMÉDIATES:');
  console.log('=====================================');
  
  console.log('\n1. 📋 Vérifiez les logs Render:');
  console.log('   - Allez sur dashboard.render.com');
  console.log('   - Sélectionnez votre service "registre-employe"');
  console.log('   - Cliquez sur "Logs"');
  console.log('   - Cherchez les erreurs rouges');
  
  console.log('\n2. 🔧 Vérifiez les variables d\'environnement:');
  console.log('   - Dans Render Dashboard → Environment');
  console.log('   - Assurez-vous que DATABASE_URL est correcte');
  console.log('   - Vérifiez JWT_SECRET et CORS_ORIGIN');
  
  console.log('\n3. 🗄️ Testez la base de données:');
  console.log('   - Connectez-vous à PostgreSQL sur Render');
  console.log('   - Vérifiez que les tables existent');
  console.log('   - Exécutez: npx prisma migrate deploy');
  
  console.log('\n4. 🔄 Redémarrez le service:');
  console.log('   - Dans Render Dashboard → Manual Deploy');
  console.log('   - Ou "Restart Service"');
  
  console.log('\n5. 🧪 Testez manuellement:');
  console.log('   curl -X POST https://registre-employe.onrender.com/api/health');
  console.log('   curl -X POST https://registre-employe.onrender.com/api/auth/login -H "Content-Type: application/json" -d \'{"email":"test","password":"test"}\'');
}

// Exécution principale
async function main() {
  await testHealthEndpoint();
  await testLoginEndpoint();
  await testCORS();
  analyzePossibleCauses();
  showRecommendedActions();
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { testLoginEndpoint, testHealthEndpoint };
