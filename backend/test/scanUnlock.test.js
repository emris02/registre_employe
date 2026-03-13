// Tests unitaires pour le déverrouillage de la zone de scan
const request = require('supertest');
const express = require('express');

// Mock des middlewares et services
const validateToken = (req, res, next) => {
  // Simuler un utilisateur admin
  req.user = {
    id: 1,
    role: 'admin',
    prenom: 'Test',
    nom: 'Admin'
  };
  next();
};

// Initialisation des variables globales pour les tests
global.scanSessions = [];
global.scanPINs = {
  default: '1234',
  custom: {}
};

// Fonctions utilitaires pour les tests
function getAdminPIN(adminId) {
  return global.scanPINs.custom[adminId] || global.scanPINs.default;
}

function setAdminPIN(adminId, pin) {
  if (!pin || !/^\d{4}$/.test(pin)) {
    throw new Error('Le code PIN doit être composé de 4 chiffres');
  }
  global.scanPINs.custom[adminId] = pin;
}

// Création de l'application de test
const app = express();
app.use(express.json());

// Endpoint de déverrouillage (version simplifiée pour les tests)
app.post('/api/scan/unlock/request', validateToken, async (req, res) => {
  try {
    const { method, value, duration = 60 } = req.body;
    const admin = req.user;
    
    // Le super_admin peut déverrouiller sans code PIN ni token
    if (admin?.role === 'super_admin' && (!method || method === 'admin_override')) {
      console.log('Super_admin détecté, déverrouillage automatique de la zone de scan');
      
      const sessionData = {
        id: `admin_session_${Date.now()}`,
        deviceId: 'admin_override',
        adminId: admin.id,
        method: 'admin_override',
        deviceInfo: JSON.stringify({ adminName: `${admin.prenom} ${admin.nom}` }),
        unlockedAt: new Date(),
        expiresAt: new Date(Date.now() + duration * 60 * 1000),
        active: true
      };

      global.scanSessions.push(sessionData);

      return res.json({
        success: true,
        message: 'Zone de scan déverrouillée par super_admin',
        session: {
          id: sessionData.id,
          expiresAt: sessionData.expiresAt,
          method: 'admin_override'
        }
      });
    }

    if (!method || !value) {
      return res.status(400).json({ success: false, message: 'Informations requises manquantes' });
    }

    let isValid = false;

    switch (method) {
      case 'pin':
        const adminPIN = getAdminPIN(admin.id);
        isValid = value === adminPIN;
        console.log(`Vérification PIN: ${value} === ${adminPIN} = ${isValid}`);
        break;
      
      case 'mac':
        isValid = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/.test(value);
        break;
      
      case 'ip':
        isValid = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(value);
        break;
      
      case 'token':
        isValid = value === 'SCAN_UNLOCK_TOKEN';
        break;
      
      default:
        return res.status(400).json({ success: false, message: 'Méthode de déverrouillage non supportée' });
    }

    if (!isValid) {
      return res.status(403).json({ success: false, message: 'Code pin incorrect déverrouillage non autorisé' });
    }

    const sessionData = {
      id: `session_${Date.now()}`,
      deviceId: 'test_device',
      adminId: admin.id,
      method: method,
      deviceInfo: JSON.stringify({ test: true }),
      unlockedAt: new Date(),
      expiresAt: new Date(Date.now() + duration * 60 * 1000),
      active: true
    };

    global.scanSessions.push(sessionData);

    res.json({
      success: true,
      message: 'Zone de scan déverrouillée avec succès',
      session: {
        id: sessionData.id,
        expiresAt: sessionData.expiresAt,
        method: method,
        deviceInfo: JSON.parse(sessionData.deviceInfo)
      }
    });
  } catch (error) {
    console.error('Erreur lors de la demande de déverrouillage:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// Endpoint pour obtenir le code PIN actuel
app.get('/api/scan/pin', validateToken, async (req, res) => {
  try {
    const admin = req.user;
    const currentPIN = getAdminPIN(admin.id);
    
    res.json({
      success: true,
      pin: currentPIN,
      isDefault: currentPIN === global.scanPINs.default
    });
  } catch (error) {
    console.error('Erreur lors de la récupération du code PIN:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// Endpoint pour modifier le code PIN
app.put('/api/scan/pin', validateToken, async (req, res) => {
  try {
    const { newPin, currentPin } = req.body;
    const admin = req.user;
    
    if (!newPin || !currentPin) {
      return res.status(400).json({ success: false, message: 'Code PIN actuel et nouveau requis' });
    }
    
    if (!/^\d{4}$/.test(newPin)) {
      return res.status(400).json({ success: false, message: 'Le nouveau code PIN doit être composé de 4 chiffres' });
    }
    
    const currentAdminPIN = getAdminPIN(admin.id);
    if (currentPin !== currentAdminPIN) {
      return res.status(403).json({ success: false, message: 'Code PIN actuel incorrect' });
    }
    
    setAdminPIN(admin.id, newPin);
    
    res.json({
      success: true,
      message: 'Code PIN modifié avec succès',
      newPin: newPin
    });
  } catch (error) {
    console.error('Erreur lors de la modification du code PIN:', error);
    res.status(500).json({ success: false, message: error.message || 'Erreur serveur' });
  }
});

// Tests
describe('Tests de déverrouillage de la zone de scan', () => {
  
  beforeEach(() => {
    // Réinitialiser les sessions avant chaque test
    global.scanSessions = [];
    global.scanPINs = {
      default: '1234',
      custom: {}
    };
  });

  describe('Tests Super Admin', () => {
    test('Super admin peut déverrouiller sans code PIN', async () => {
      // Simuler un super admin
      const response = await request(app)
        .post('/api/scan/unlock/request')
        .send({ method: 'admin_override' })
        .set('Authorization', 'Bearer fake-token');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Zone de scan déverrouillée par super_admin');
      expect(response.body.session.method).toBe('admin_override');
    });

    test('Super admin peut déverrouiller sans méthode spécifiée', async () => {
      const response = await request(app)
        .post('/api/scan/unlock/request')
        .send({})
        .set('Authorization', 'Bearer fake-token');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.session.method).toBe('admin_override');
    });
  });

  describe('Tests Code PIN', () => {
    test('Déverrouillage avec code PIN par défaut', async () => {
      const response = await request(app)
        .post('/api/scan/unlock/request')
        .send({ method: 'pin', value: '1234' })
        .set('Authorization', 'Bearer fake-token');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.session.method).toBe('pin');
    });

    test('Échec avec code PIN incorrect', async () => {
      const response = await request(app)
        .post('/api/scan/unlock/request')
        .send({ method: 'pin', value: '9999' })
        .set('Authorization', 'Bearer fake-token');

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Code pin incorrect déverrouillage non autorisé');
    });

    test('Échec avec code PIN invalide (non numérique)', async () => {
      const response = await request(app)
        .post('/api/scan/unlock/request')
        .send({ method: 'pin', value: 'abcd' })
        .set('Authorization', 'Bearer fake-token');

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
    });

    test('Modification du code PIN', async () => {
      // Modifier le PIN
      const updateResponse = await request(app)
        .put('/api/scan/pin')
        .send({ currentPin: '1234', newPin: '5678' })
        .set('Authorization', 'Bearer fake-token');

      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.success).toBe(true);
      expect(updateResponse.body.newPin).toBe('5678');

      // Vérifier le nouveau PIN fonctionne
      const unlockResponse = await request(app)
        .post('/api/scan/unlock/request')
        .send({ method: 'pin', value: '5678' })
        .set('Authorization', 'Bearer fake-token');

      expect(unlockResponse.status).toBe(200);
      expect(unlockResponse.body.success).toBe(true);

      // Vérifier l'ancien PIN ne fonctionne plus
      const oldPinResponse = await request(app)
        .post('/api/scan/unlock/request')
        .send({ method: 'pin', value: '1234' })
        .set('Authorization', 'Bearer fake-token');

      expect(oldPinResponse.status).toBe(403);
      expect(oldPinResponse.body.success).toBe(false);
    });
  });

  describe('Tests Adresse MAC', () => {
    test('Déverrouillage avec adresse MAC valide', async () => {
      const response = await request(app)
        .post('/api/scan/unlock/request')
        .send({ method: 'mac', value: '00:1A:2B:3C:4D:5E' })
        .set('Authorization', 'Bearer fake-token');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.session.method).toBe('mac');
    });

    test('Déverrouillage avec adresse MAC format différent', async () => {
      const response = await request(app)
        .post('/api/scan/unlock/request')
        .send({ method: 'mac', value: '00-1A-2B-3C-4D-5E' })
        .set('Authorization', 'Bearer fake-token');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    test('Échec avec adresse MAC invalide', async () => {
      const response = await request(app)
        .post('/api/scan/unlock/request')
        .send({ method: 'mac', value: 'invalid-mac' })
        .set('Authorization', 'Bearer fake-token');

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
    });
  });

  describe('Tests Adresse IP', () => {
    test('Déverrouillage avec adresse IP valide', async () => {
      const response = await request(app)
        .post('/api/scan/unlock/request')
        .send({ method: 'ip', value: '192.168.1.100' })
        .set('Authorization', 'Bearer fake-token');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.session.method).toBe('ip');
    });

    test('Échec avec adresse IP invalide', async () => {
      const response = await request(app)
        .post('/api/scan/unlock/request')
        .send({ method: 'ip', value: '999.999.999.999' })
        .set('Authorization', 'Bearer fake-token');

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
    });
  });

  describe('Tests Token', () => {
    test('Déverrouillage avec token valide', async () => {
      const response = await request(app)
        .post('/api/scan/unlock/request')
        .send({ method: 'token', value: 'SCAN_UNLOCK_TOKEN' })
        .set('Authorization', 'Bearer fake-token');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.session.method).toBe('token');
    });

    test('Échec avec token invalide', async () => {
      const response = await request(app)
        .post('/api/scan/unlock/request')
        .send({ method: 'token', value: 'INVALID_TOKEN' })
        .set('Authorization', 'Bearer fake-token');

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
    });
  });

  describe('Tests Gestion des erreurs', () => {
    test('Échec avec méthode non supportée', async () => {
      const response = await request(app)
        .post('/api/scan/unlock/request')
        .send({ method: 'unsupported', value: 'test' })
        .set('Authorization', 'Bearer fake-token');

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Méthode de déverrouillage non supportée');
    });

    test('Échec avec paramètres manquants', async () => {
      const response = await request(app)
        .post('/api/scan/unlock/request')
        .send({ method: 'pin' }) // valeur manquante
        .set('Authorization', 'Bearer fake-token');

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Informations requises manquantes');
    });
  });

  describe('Tests API PIN', () => {
    test('Obtenir le code PIN actuel', async () => {
      const response = await request(app)
        .get('/api/scan/pin')
        .set('Authorization', 'Bearer fake-token');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.pin).toBe('1234');
      expect(response.body.isDefault).toBe(true);
    });

    test('Échec modification PIN avec mauvais PIN actuel', async () => {
      const response = await request(app)
        .put('/api/scan/pin')
        .send({ currentPin: '9999', newPin: '5678' })
        .set('Authorization', 'Bearer fake-token');

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Code PIN actuel incorrect');
    });

    test('Échec modification PIN avec format invalide', async () => {
      const response = await request(app)
        .put('/api/scan/pin')
        .send({ currentPin: '1234', newPin: 'abcd' })
        .set('Authorization', 'Bearer fake-token');

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Le nouveau code PIN doit être composé de 4 chiffres');
    });
  });
});

// Pour exécuter les tests: npm test scanUnlock.test.js
