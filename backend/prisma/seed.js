const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function seed() {
  console.log('🌱 Seeding default admin users...');

  const passwordHash = bcrypt.hashSync('admin123', 12);

  // Create super admin
  const superAdmin = await prisma.admin.upsert({
    where: { email: 'ouologuemoussa@gmail.com' },
    update: {
      mot_de_passe: passwordHash,
      role: 'super_admin',
      actif: true,
    },
    create: {
      email: 'ouologuemoussa@gmail.com',
      mot_de_passe: passwordHash,
      nom: 'Ouologuem',
      prenom: 'Moussa',
      role: 'super_admin',
      actif: true,
    },
  });
  console.log('✅ Super admin created/updated:', superAdmin.email);

  // Create admin
  const admin = await prisma.admin.upsert({
    where: { email: 'xpertproformation@gmail.com' },
    update: {
      mot_de_passe: passwordHash,
      role: 'admin',
      actif: true,
    },
    create: {
      email: 'xpertproformation@gmail.com',
      mot_de_passe: passwordHash,
      nom: 'Xpert',
      prenom: 'Pro',
      role: 'admin',
      actif: true,
    },
  });
  console.log('✅ Admin created/updated:', admin.email);

  console.log('🎉 Seed completed successfully!');
}

seed()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
