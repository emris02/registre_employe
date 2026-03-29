const http = require('http');

// Test de modification d'employé avec différents payloads
const testCases = [
  {
    name: "Test avec rôle 'employe'",
    data: {
      nom: "Test",
      prenom: "User",
      email: "test@example.com",
      role: "employe",
      departement: "informatique",
      poste: "developpeur"
    }
  },
  {
    name: "Test avec rôle 'developpeur'",
    data: {
      nom: "Test",
      prenom: "User", 
      email: "test@example.com",
      role: "developpeur",
      departement: "informatique",
      poste: "Développeur"
    }
  },
  {
    name: "Test sans rôle",
    data: {
      nom: "Test",
      prenom: "User",
      email: "test@example.com",
      departement: "informatique",
      poste: "Développeur"
    }
  }
];

function testCase(testCase, index) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(testCase.data);
    
    const options = {
      hostname: 'localhost',
      port: 3004,
      path: '/api/admin/employes/4',
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'Authorization': 'Bearer fake-token-for-testing'
      }
    };
    
    console.log(`\n🧪 ${index + 1}. ${testCase.name}`);
    console.log(`   Payload:`, JSON.stringify(testCase.data, null, 2));
    
    const req = http.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          console.log(`   ✅ Status: ${res.statusCode}`);
          console.log(`   📄 Response:`, JSON.stringify(response, null, 2));
          resolve({ status: res.statusCode, response });
        } catch (error) {
          console.log(`   ❌ Status: ${res.statusCode}`);
          console.log(`   📄 Raw Response:`, data);
          resolve({ status: res.statusCode, rawResponse: data });
        }
      });
    });
    
    req.on('error', (error) => {
      console.error(`   ❌ Erreur de requête:`, error.message);
      reject(error);
    });
    
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
    
    req.write(postData);
    req.end();
  });
}

async function runTests() {
  console.log('🔍 Diagnostic de l\'API de modification d\'employé\n');
  
  for (let i = 0; i < testCases.length; i++) {
    try {
      await testCase(testCases[i], i);
    } catch (error) {
      console.error(`   ❌ Erreur:`, error.message);
    }
    
    // Pause entre les tests
    if (i < testCases.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  console.log('\n🏁 Tests terminés');
}

runTests().catch(console.error);
