#!/usr/bin/env node

// Script de diagnostic pour le déploiement Render
// À exécuter directement sur Render ou via les logs

console.log('🚀 Diagnostic Backend Render - ' + new Date().toISOString());

// Test 1: Variables d'environnement
console.log('\n📋 Variables d\'environnement:');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('PORT:', process.env.PORT);
console.log('DATABASE_URL:', process.env.DATABASE_URL ? '***CONFIGURÉ***' : '❌ MANQUANT');
console.log('JWT_SECRET:', process.env.JWT_SECRET ? '***CONFIGURÉ***' : '❌ MANQUANT');
console.log('CORS_ORIGIN:', process.env.CORS_ORIGIN);

// Test 2: Import des modules
try {
  console.log('\n📦 Modules:');
  console.log('✅ Prisma:', require('@prisma/client'));
  console.log('✅ Express:', require('express'));
  console.log('✅ JWT:', require('jsonwebtoken'));
  console.log('✅ Bcrypt:', require('bcrypt'));
} catch (error) {
  console.error('❌ Erreur import modules:', error.message);
}

// Test 3: Connexion base de données
async function testDatabase() {
  try {
    const { PrismaClient } = require('@prisma/client');
    
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL non configuré');
    }
    
    const prisma = new PrismaClient({
      datasources: {
        db: {
          url: process.env.DATABASE_URL
        }
      }
    });
    
    console.log('\n🗄️ Test connexion base de données...');
    await prisma.$connect();
    console.log('✅ Connexion réussie');
    
    // Test de requêtes simples
    const adminCount = await prisma.admin.count();
    console.log(`📊 Admins: ${adminCount}`);
    
    const employeCount = await prisma.employe.count();
    console.log(`📊 Employés: ${employeCount}`);
    
    await prisma.$disconnect();
    console.log('✅ Déconnexion réussie');
    
  } catch (error) {
    console.error('❌ Erreur base de données:', error.message);
    console.error('Code:', error.code);
    
    if (error.message.includes('Can\'t reach database server')) {
      console.log('\n💡 Solutions possibles:');
      console.log('1. Vérifiez que la base de données est en ligne sur Render');
      console.log('2. Vérifiez l\'URL DATABASE_URL dans les variables Render');
      console.log('3. Vérifiez les permissions de l\'utilisateur PostgreSQL');
      console.log('4. Assurez-vous que SSL est activé (required pour Render)');
    }
  }
}

// Test 4: Endpoint de santé
async function testHealthEndpoint() {
  try {
    console.log('\n🏥 Test endpoint /api/health');
    
    const response = await fetch('http://localhost:' + (process.env.PORT || 3003) + '/api/health');
    const data = await response.json();
    
    console.log('✅ Health endpoint:', data);
  } catch (error) {
    console.error('❌ Health endpoint error:', error.message);
  }
}

// Test 5: Configuration CORS
function testCORS() {
  console.log('\n🌐 Configuration CORS:');
  console.log('CORS_ORIGIN:', process.env.CORS_ORIGIN || '❌ NON CONFIGURÉ');
  console.log('FRONTEND_URL:', process.env.FRONTEND_URL || '❌ NON CONFIGURÉ');
  
  if (!process.env.CORS_ORIGIN) {
    console.log('\n⚠️  ATTENTION: CORS non configuré');
    console.log('   Le frontend ne pourra pas appeler l\'API');
    console.log('   Ajoutez CORS_ORIGIN=https://votre-frontend.netlify.app');
  }
}

// Exécution des tests
async function runDiagnostics() {
  await testDatabase();
  await testHealthEndpoint();
  testCORS();
  
  console.log('\n🎯 Actions recommandées:');
  console.log('1. Vérifiez les variables d\'environnement dans Render Dashboard');
  console.log('2. Assurez-vous que la base de données PostgreSQL est en ligne');
  console.log('3. Vérifiez les logs de votre service Render');
  console.log('4. Testez manuellement: curl https://votre-service.onrender.com/api/health');
}

if (require.main === module) {
  runDiagnostics().catch(console.error);
}
