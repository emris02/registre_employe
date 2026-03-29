const http = require('http');

const testData = {
  email: 'moussa.coulibaly@xpertpro.local',
  password: 'test123'
};

const postData = JSON.stringify(testData);

const options = {
  hostname: 'localhost',
  port: 3004,
  path: '/api/auth/login',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData)
  }
};

console.log('🧪 Test de connexion à l\'API...');

const req = http.request(options, (res) => {
  console.log(`Status: ${res.statusCode}`);
  console.log(`Headers: ${JSON.stringify(res.headers)}`);
  
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    try {
      const response = JSON.parse(data);
      console.log('✅ Réponse reçue:', JSON.stringify(response, null, 2));
      
      if (response.success) {
        console.log('🎉 Connexion réussie ! Le serveur fonctionne correctement.');
      } else {
        console.log('❌ Erreur de connexion:', response.message);
      }
    } catch (error) {
      console.log('Réponse brute:', data);
    }
  });
});

req.on('error', (error) => {
  console.error('❌ Erreur de requête:', error.message);
});

req.write(postData);
req.end();
