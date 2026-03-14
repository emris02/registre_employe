// Serveur backend complet pour Xpert Pro avec PostgreSQL
const express = require('express');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const multer = require('multer');
const bcrypt = require('bcrypt');
const { sendCredentialsEmail } = require('./services/emailService');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 3003;
const JWT_SECRET = process.env.JWT_SECRET || 'xpert-pro-secret';
const BADGE_SECRET = process.env.BADGE_SECRET || JWT_SECRET;
const MAX_PROFILE_PHOTO_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_CONTRACT_PDF_SIZE_BYTES = 10 * 1024 * 1024;
const PROFILE_UPLOADS_DIR = path.join(__dirname, 'uploads', 'profile-photos');
const CONTRACT_UPLOADS_DIR = path.join(__dirname, 'uploads', 'contracts');
const ADMIN_PROFILE_META_KEY = 'admin_profile_meta';
const ADMIN_NOTIFICATIONS_DISMISSED_KEY = 'admin_notifications_dismissed';
const ADMIN_NOTIFICATIONS_READ_KEY = 'admin_notifications_read';

if (!fs.existsSync(PROFILE_UPLOADS_DIR)) {
  fs.mkdirSync(PROFILE_UPLOADS_DIR, { recursive: true });
}
if (!fs.existsSync(CONTRACT_UPLOADS_DIR)) {
  fs.mkdirSync(CONTRACT_UPLOADS_DIR, { recursive: true });
}

const PROFILE_MIME_EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif'
};
const CONTRACT_MIME_EXTENSIONS = {
  'application/pdf': '.pdf'
};

const profilePhotoStorage = multer.diskStorage({
  destination: (_req, _file, callback) => {
    callback(null, PROFILE_UPLOADS_DIR);
  },
  filename: (_req, file, callback) => {
    const extension = PROFILE_MIME_EXTENSIONS[file.mimetype] || path.extname(file.originalname || '').toLowerCase() || '.jpg';
    const safeExtension = /^[a-z0-9.]+$/i.test(extension) ? extension : '.jpg';
    const fileName = `profile-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${safeExtension}`;
    callback(null, fileName);
  }
});

const profilePhotoUpload = multer({
  storage: profilePhotoStorage,
  limits: { fileSize: MAX_PROFILE_PHOTO_SIZE_BYTES },
  fileFilter: (_req, file, callback) => {
    if (!Object.prototype.hasOwnProperty.call(PROFILE_MIME_EXTENSIONS, file.mimetype)) {
      callback(new Error('Type de fichier non supporte'));
      return;
    }
    callback(null, true);
  }
});

const contractPdfStorage = multer.diskStorage({
  destination: (_req, _file, callback) => {
    callback(null, CONTRACT_UPLOADS_DIR);
  },
  filename: (_req, file, callback) => {
    const extension = CONTRACT_MIME_EXTENSIONS[file.mimetype] || '.pdf';
    const fileName = `contract-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${extension}`;
    callback(null, fileName);
  }
});

const contractPdfUpload = multer({
  storage: contractPdfStorage,
  limits: { fileSize: MAX_CONTRACT_PDF_SIZE_BYTES },
  fileFilter: (_req, file, callback) => {
    if (!Object.prototype.hasOwnProperty.call(CONTRACT_MIME_EXTENSIONS, file.mimetype)) {
      callback(new Error('Type de fichier non supporte'));
      return;
    }
    callback(null, true);
  }
});

const ROLE_CATALOG = [
  { id: 'super_admin', label: 'Super Administrateur', scope: 'admin' },
  { id: 'admin', label: 'Administrateur', scope: 'admin' },
  { id: 'manager', label: 'Manager', scope: 'employee' },
  { id: 'chef_departement', label: 'Chef de departement', scope: 'employee' },
  { id: 'comptable', label: 'Comptable', scope: 'employee' },
  { id: 'stagiaire', label: 'Stagiaire', scope: 'employee' },
  { id: 'employe', label: 'Employe', scope: 'employee' }
];

const EMPLOYEE_ROLE_SET = new Set(
  ROLE_CATALOG
    .filter((role) => role.scope === 'employee')
    .map((role) => role.id)
);
const KNOWN_ROLE_SET = new Set([...ROLE_CATALOG.map((role) => role.id), 'hr']);
const DEFAULT_DB_EMPLOYEE_ROLE = 'employe';
const DEFAULT_DB_ROLE_VALUES = new Set(['employe', 'admin', 'super_admin']);
let supportedDbRoleValues = new Set(DEFAULT_DB_ROLE_VALUES);
const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173'
];
const configuredCorsOrigins = String(process.env.CORS_ALLOWED_ORIGINS || process.env.FRONTEND_URL || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedCorsOrigins = new Set([...DEFAULT_ALLOWED_ORIGINS, ...configuredCorsOrigins]);

const isAllowedCorsOrigin = (origin) => {
  if (!origin) return true;
  if (allowedCorsOrigins.has('*')) return true;
  if (allowedCorsOrigins.has(origin)) return true;
  try {
    const hostname = new URL(origin).hostname.toLowerCase();
    if (hostname.endsWith('.netlify.app')) {
      return true;
    }
  } catch (_error) {
    return false;
  }
  return false;
};

// Middleware
app.use(cors({
  origin: (origin, callback) => {
    if (isAllowedCorsOrigin(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error(`CORS origin non autorisee: ${origin}`));
  },
  credentials: true
}));
app.use(express.json());
app.use('/api/uploads', express.static(path.join(__dirname, 'uploads')));

// Import models
const EmployeModel = require('./models/EmployeModel');
const AdminModel = require('./models/AdminModel');
const BadgeModel = require('./models/BadgeModel');
const DemandeModel = require('./models/DemandeModel');
const EvenementModel = require('./models/EvenementModel');

// Initialize models
const employeModel = new EmployeModel();
const adminModel = new AdminModel();
const badgeModel = new BadgeModel();
const demandeModel = new DemandeModel();
const evenementModel = new EvenementModel();
const prisma = employeModel.prisma;

const ACTIVE_ACCOUNT_STATUS = 'actif';
const SUPPORTED_SESSION_USER_TYPES = new Set(['admin', 'employe']);

const normalizeAccountStatus = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'active') return ACTIVE_ACCOUNT_STATUS;
  if (normalized === 'inactive') return 'inactif';
  return normalized || 'inactif';
};

const resolveDashboardPathForSession = ({ userType, role }) => {
  if (String(userType || '').trim().toLowerCase() === 'admin') {
    return '/admin';
  }
  const normalizedRole = String(role || '').trim().toLowerCase();
  if (normalizedRole === 'admin' || normalizedRole === 'super_admin') {
    return '/admin';
  }
  return '/employee';
};

const resolveBadgeAccessMessage = (code) => {
  if (code === 'ACCOUNT_INACTIVE') {
    return 'Acces refuse: compte desactive. Votre badge n est pas valide.';
  }
  if (code === 'BADGE_EXPIRED') {
    return 'Acces refuse: badge expire. Votre badge n est pas valide.';
  }
  if (code === 'BADGE_INACTIVE') {
    return 'Acces refuse: badge inactif. Votre badge n est pas valide.';
  }
  if (code === 'BADGE_NOT_FOUND') {
    return 'Acces refuse: aucun badge actif associe a ce compte.';
  }
  return 'Acces refuse: badge non valide.';
};

const resolveUserSnapshotForBadgeAccess = async ({ userType, userId }) => {
  if (userType === 'admin') {
    return prisma.admin.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        statut: true,
        badgeActif: true,
        badgeId: true
      }
    });
  }

  return prisma.employe.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      statut: true,
      badgeActif: true,
      badgeId: true
    }
  });
};

const resolveLatestBadgeTokenForUser = async ({ userType, userId }) => {
  const where = userType === 'admin' ? { adminId: userId } : { employeId: userId };
  return prisma.badgeToken.findFirst({
    where,
    include: { employe: true, admin: true },
    orderBy: { createdAt: 'desc' }
  });
};

const resolveUserBadgeAccess = async ({
  userType,
  userId,
  userSnapshot = null
}) => {
  const normalizedType = String(userType || '').trim().toLowerCase();
  const numericUserId = Number(userId || 0);
  if (!SUPPORTED_SESSION_USER_TYPES.has(normalizedType) || !Number.isInteger(numericUserId) || numericUserId <= 0) {
    return {
      allowed: false,
      code: 'SESSION_INVALID',
      message: 'Session invalide.',
      badgeStatus: 'inactive',
      dashboardPath: normalizedType === 'admin' ? '/admin' : '/employee',
      user: null,
      badgeToken: null
    };
  }

  const user = userSnapshot || await resolveUserSnapshotForBadgeAccess({
    userType: normalizedType,
    userId: numericUserId
  });

  if (!user) {
    return {
      allowed: false,
      code: 'USER_NOT_FOUND',
      message: 'Utilisateur introuvable.',
      badgeStatus: 'inactive',
      dashboardPath: resolveDashboardPathForSession({ userType: normalizedType }),
      user: null,
      badgeToken: null
    };
  }

  const dashboardPath = resolveDashboardPathForSession({
    userType: normalizedType,
    role: user.role
  });

  if (normalizeAccountStatus(user.statut) !== ACTIVE_ACCOUNT_STATUS) {
    return {
      allowed: false,
      code: 'ACCOUNT_INACTIVE',
      message: resolveBadgeAccessMessage('ACCOUNT_INACTIVE'),
      badgeStatus: 'inactive',
      dashboardPath,
      user,
      badgeToken: null
    };
  }

  const latestBadgeToken = await resolveLatestBadgeTokenForUser({
    userType: normalizedType,
    userId: numericUserId
  });

  if (!latestBadgeToken) {
    return {
      allowed: false,
      code: 'BADGE_NOT_FOUND',
      message: resolveBadgeAccessMessage('BADGE_NOT_FOUND'),
      badgeStatus: 'inactive',
      dashboardPath,
      user,
      badgeToken: null
    };
  }

  const expiredByDate = latestBadgeToken.expiresAt
    ? new Date(latestBadgeToken.expiresAt).getTime() <= Date.now()
    : false;
  if (expiredByDate) {
    return {
      allowed: false,
      code: 'BADGE_EXPIRED',
      message: resolveBadgeAccessMessage('BADGE_EXPIRED'),
      badgeStatus: 'expired',
      dashboardPath,
      user,
      badgeToken: latestBadgeToken
    };
  }

  if (latestBadgeToken.status !== 'active') {
    return {
      allowed: false,
      code: 'BADGE_INACTIVE',
      message: resolveBadgeAccessMessage('BADGE_INACTIVE'),
      badgeStatus: 'inactive',
      dashboardPath,
      user,
      badgeToken: latestBadgeToken
    };
  }

  return {
    allowed: true,
    code: 'BADGE_ACTIVE',
    message: 'Badge actif.',
    badgeStatus: 'active',
    dashboardPath,
    user,
    badgeToken: latestBadgeToken
  };
};

// Helper JWT validation
const validateToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Token manquant' });
  }
  try {
    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Token invalide' });
  }
};

const requireAdmin = (req, res, next) => {
  if (req.user?.userType !== 'admin') {
    return res.status(403).json({ success: false, message: 'Accès réservé aux administrateurs' });
  }
  next();
};

const requireAuthenticatedSessionWithActiveBadge = async (req, res, next) => {
  try {
    const requester = req.user?.user;
    const requesterType = String(req.user?.userType || '').trim().toLowerCase();
    const requesterId = Number(requester?.id || 0);

    if (!SUPPORTED_SESSION_USER_TYPES.has(requesterType) || !Number.isInteger(requesterId) || requesterId <= 0) {
      return res.status(401).json({
        success: false,
        message: 'Session invalide.',
        code: 'SESSION_INVALID'
      });
    }

    const access = await resolveUserBadgeAccess({
      userType: requesterType,
      userId: requesterId
    });

    if (!access.allowed) {
      const status = access.code === 'USER_NOT_FOUND' || access.code === 'SESSION_INVALID' ? 401 : 403;
      return res.status(status).json({
        success: false,
        message: access.message,
        code: access.code,
        badge_status: access.badgeStatus,
        redirect_to: access.dashboardPath
      });
    }

    req.badgeAccess = access;
    req.user = {
      ...req.user,
      user: {
        ...(req.user?.user || {}),
        ...(access.user || {})
      },
      userType: requesterType
    };
    next();
  } catch (error) {
    console.error('Erreur validation badge session:', error);
    return res.status(500).json({
      success: false,
      message: 'Erreur lors de la validation du badge'
    });
  }
};

// Certains endpoints (ex: zone de scan admin) doivent rester accessibles aux admins
// même s'ils n'ont pas encore de badge actif associé.
const requireBadgeForEmployeOnly = async (req, res, next) => {
  const requesterType = String(req.user?.userType || '').trim().toLowerCase();
  if (requesterType === 'admin') {
    return next();
  }
  return requireAuthenticatedSessionWithActiveBadge(req, res, next);
};

const normalizePhotoPath = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return null;

  if (
    raw.startsWith('http://')
    || raw.startsWith('https://')
    || raw.startsWith('data:')
    || raw.startsWith('blob:')
    || raw.startsWith('/api/')
    || raw.startsWith('/uploads/')
  ) {
    return raw;
  }

  if (raw.startsWith('api/')) {
    return `/${raw}`;
  }

  if (raw.startsWith('uploads/')) {
    return `/api/${raw}`;
  }

  if (raw.startsWith('/')) {
    return raw;
  }

  return `/api/uploads/profile-photos/${raw}`;
};

const removePassword = (user) => {
  if (!user) return null;
  const { password, ...rest } = user;
  const safeUser = { ...rest };
  if (Object.prototype.hasOwnProperty.call(safeUser, 'photo')) {
    safeUser.photo = normalizePhotoPath(safeUser.photo);
  }
  return safeUser;
};

const EMPLOYE_EXTRA_FIELDS = [
  'situation_matrimoniale',
  'contact_urgence_nom',
  'contact_urgence_telephone',
  'contact_urgence_relation',
  'contact_urgence_adresse_physique',
  'contrat_pdf_url'
];

const EMPLOYE_PROFESSIONAL_FIELDS = new Set([
  'email',
  'emailPro',
  'matricule',
  'role',
  'statut',
  'departement',
  'poste',
  'dateEmbauche',
  'contratType',
  'contratDuree',
  'salaire'
]);

const EMPLOYE_PROFESSIONAL_EXTRA_FIELDS = new Set(['contrat_pdf_url']);

const EMPLOYE_ALLOWED_MUTABLE_FIELDS = new Set([
  'nom',
  'prenom',
  'email',
  'emailPro',
  'password',
  'role',
  'statut',
  'dateEmbauche',
  'anciennete',
  'poste',
  'salaire',
  'telephone',
  'photo',
  'matricule',
  'adresse',
  'departement',
  'badgeActif',
  'contratType',
  'contratDuree'
]);

const EMPLOYE_FIELD_MAX_LENGTHS = {
  nom: 20,
  prenom: 20,
  email: 100,
  emailPro: 100,
  password: 255,
  anciennete: 20,
  poste: 50,
  telephone: 20,
  photo: 255,
  matricule: 20,
  adresse: 255,
  departement: 100,
  contratType: 50,
  contratDuree: 50
};

const EMPLOYE_EXTRA_FIELD_MAX_LENGTHS = {
  situation_matrimoniale: 64,
  contact_urgence_nom: 120,
  contact_urgence_telephone: 40,
  contact_urgence_relation: 80,
  contact_urgence_adresse_physique: 255,
  contrat_pdf_url: 512
};

const ADMIN_FIELD_MAX_LENGTHS = {
  nom: 50,
  prenom: 50,
  telephone: 20,
  adresse: 25,
  departement: 20,
  poste: 20,
  photo: 255
};

const ADMIN_META_FIELD_MAX_LENGTHS = {
  email_pro: 100,
  contrat_type: 50
};

const parseJsonObject = (value) => {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
    return {};
  } catch {
    return {};
  }
};

const truncateToMaxLength = (value, maxLength) => {
  if (typeof value !== 'string') return value;
  if (!Number.isFinite(maxLength) || maxLength <= 0) return value;
  return value.length > maxLength ? value.slice(0, maxLength) : value;
};

const normalizeNullableString = (value, maxLength) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const normalized = String(value).trim();
  if (!normalized.length) return null;
  return truncateToMaxLength(normalized, maxLength);
};

const normalizeDateOnlyString = (value) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
};

const extractEmployeExtraFields = (payload = {}, options = {}) => {
  const { allowProfessionalExtra = true } = options;
  const extras = {};

  EMPLOYE_EXTRA_FIELDS.forEach((field) => {
    if (!allowProfessionalExtra && EMPLOYE_PROFESSIONAL_EXTRA_FIELDS.has(field)) {
      return;
    }

    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      extras[field] = normalizeNullableString(payload[field], EMPLOYE_EXTRA_FIELD_MAX_LENGTHS[field]);
    }
  });

  return extras;
};

const mergeEmployeInfosSup = (currentInfosSup, extraUpdates = {}) => {
  const current = parseJsonObject(currentInfosSup);
  const merged = { ...current };
  Object.entries(extraUpdates).forEach(([key, value]) => {
    if (value === null || value === '') {
      delete merged[key];
      return;
    }
    if (value !== undefined) {
      merged[key] = value;
    }
  });
  return Object.keys(merged).length ? JSON.stringify(merged) : null;
};

const mapPrismaMutationError = (error) => {
  const code = String(error?.code || '').trim();
  if (code === 'P2000') {
    return {
      status: 400,
      message: 'Une ou plusieurs valeurs depassent la taille maximale autorisee.'
    };
  }
  if (code === 'P2002') {
    return {
      status: 409,
      message: 'Une valeur unique existe deja (email, matricule ou badge).'
    };
  }
  if (code === 'P2025') {
    return {
      status: 404,
      message: 'Enregistrement introuvable.'
    };
  }
  return null;
};

const getAdminProfileMeta = async (adminId) => {
  const userId = Number(adminId);
  if (!Number.isInteger(userId) || userId <= 0) return {};
  const record = await prisma.parametreUtilisateur.findUnique({
    where: {
      userId_cle: {
        userId,
        cle: ADMIN_PROFILE_META_KEY
      }
    }
  });
  return parseJsonObject(record?.valeur);
};

const saveAdminProfileMeta = async (adminId, updates = {}) => {
  const userId = Number(adminId);
  if (!Number.isInteger(userId) || userId <= 0) return {};

  const current = await getAdminProfileMeta(userId);
  const merged = { ...current };

  Object.entries(updates || {}).forEach(([key, value]) => {
    if (value === undefined) return;
    if (value === null || value === '') {
      delete merged[key];
      return;
    }
    merged[key] = value;
  });

  await prisma.parametreUtilisateur.upsert({
    where: {
      userId_cle: {
        userId,
        cle: ADMIN_PROFILE_META_KEY
      }
    },
    create: {
      userId,
      userType: 'admin',
      cle: ADMIN_PROFILE_META_KEY,
      valeur: Object.keys(merged).length ? JSON.stringify(merged) : null,
      employeId: null
    },
    update: {
      userType: 'admin',
      valeur: Object.keys(merged).length ? JSON.stringify(merged) : null,
      employeId: null
    }
  });

  return merged;
};

const parseDismissedAdminNotificationIds = (value) => {
  if (!value) return [];
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (Array.isArray(parsed)) {
      return parsed
        .map((entry) => String(entry || '').trim())
        .filter(Boolean);
    }
    if (Array.isArray(parsed?.ids)) {
      return parsed.ids
        .map((entry) => String(entry || '').trim())
        .filter(Boolean);
    }
    return [];
  } catch {
    return [];
  }
};

const getDismissedAdminNotificationIds = async (adminId) => {
  const userId = Number(adminId || 0);
  if (!Number.isInteger(userId) || userId <= 0) return [];

  const record = await prisma.parametreUtilisateur.findUnique({
    where: {
      userId_cle: {
        userId,
        cle: ADMIN_NOTIFICATIONS_DISMISSED_KEY
      }
    }
  });

  return parseDismissedAdminNotificationIds(record?.valeur);
};

const saveDismissedAdminNotificationIds = async (adminId, ids = []) => {
  const userId = Number(adminId || 0);
  if (!Number.isInteger(userId) || userId <= 0) return [];

  const normalizedIds = ids
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
  const unique = Array.from(new Set(normalizedIds)).slice(-1000);
  const payload = unique.length > 0
    ? JSON.stringify({ ids: unique, updated_at: new Date().toISOString() })
    : null;

  await prisma.parametreUtilisateur.upsert({
    where: {
      userId_cle: {
        userId,
        cle: ADMIN_NOTIFICATIONS_DISMISSED_KEY
      }
    },
    create: {
      userId,
      userType: 'admin',
      cle: ADMIN_NOTIFICATIONS_DISMISSED_KEY,
      valeur: payload,
      employeId: null
    },
    update: {
      userType: 'admin',
      valeur: payload,
      employeId: null
    }
  });

  return unique;
};

const parseAdminNotificationReadState = (value) => {
  if (!value) return {};
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== 'object') return {};

    const source = parsed.ids && typeof parsed.ids === 'object'
      ? parsed.ids
      : parsed;

    const normalized = {};
    Object.entries(source).forEach(([key, dateValue]) => {
      const id = String(key || '').trim();
      if (!id) return;
      const parsedDate = new Date(dateValue || '');
      normalized[id] = Number.isNaN(parsedDate.getTime())
        ? new Date().toISOString()
        : parsedDate.toISOString();
    });
    return normalized;
  } catch {
    return {};
  }
};

const getAdminNotificationReadState = async (adminId) => {
  const userId = Number(adminId || 0);
  if (!Number.isInteger(userId) || userId <= 0) return {};

  const record = await prisma.parametreUtilisateur.findUnique({
    where: {
      userId_cle: {
        userId,
        cle: ADMIN_NOTIFICATIONS_READ_KEY
      }
    }
  });

  return parseAdminNotificationReadState(record?.valeur);
};

const saveAdminNotificationReadState = async (adminId, readState = {}) => {
  const userId = Number(adminId || 0);
  if (!Number.isInteger(userId) || userId <= 0) return {};

  const entries = Object.entries(readState || {})
    .map(([rawId, rawDate]) => {
      const id = String(rawId || '').trim();
      if (!id) return null;
      const parsedDate = new Date(rawDate || '');
      return [
        id,
        Number.isNaN(parsedDate.getTime())
          ? new Date().toISOString()
          : parsedDate.toISOString()
      ];
    })
    .filter(Boolean)
    .slice(-2000);

  const normalizedState = Object.fromEntries(entries);
  const payload = Object.keys(normalizedState).length > 0
    ? JSON.stringify({ ids: normalizedState, updated_at: new Date().toISOString() })
    : null;

  await prisma.parametreUtilisateur.upsert({
    where: {
      userId_cle: {
        userId,
        cle: ADMIN_NOTIFICATIONS_READ_KEY
      }
    },
    create: {
      userId,
      userType: 'admin',
      cle: ADMIN_NOTIFICATIONS_READ_KEY,
      valeur: payload,
      employeId: null
    },
    update: {
      userType: 'admin',
      valeur: payload,
      employeId: null
    }
  });

  return normalizedState;
};

const normalizeAdminMutationPayload = (payload = {}) => {
  const updates = {};
  const source = payload && typeof payload === 'object' ? payload : {};
  const allowedFields = ['nom', 'prenom', 'telephone', 'adresse', 'departement', 'poste'];

  allowedFields.forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(source, field)) return;

    const raw = source[field];
    if (raw === undefined) return;

    const maxLength = ADMIN_FIELD_MAX_LENGTHS[field];
    if (field === 'nom' || field === 'prenom') {
      const normalized = normalizeNullableString(raw, maxLength);
      if (normalized !== null && normalized !== undefined) {
        updates[field] = normalized;
      }
      return;
    }

    updates[field] = normalizeNullableString(raw, maxLength);
  });

  return updates;
};

const normalizeAdminProfessionalMutationPayload = (payload = {}) => {
  const updates = {};
  const source = payload && typeof payload === 'object' ? { ...payload } : {};

  if (source.badge_id !== undefined && source.badgeId === undefined) {
    source.badgeId = source.badge_id;
  }

  if (Object.prototype.hasOwnProperty.call(source, 'email')) {
    const email = normalizeNullableString(source.email, 100);
    if (email !== null && email !== undefined) {
      updates.email = email.toLowerCase();
    }
  }

  if (Object.prototype.hasOwnProperty.call(source, 'departement')) {
    updates.departement = normalizeNullableString(source.departement, ADMIN_FIELD_MAX_LENGTHS.departement);
  }

  if (Object.prototype.hasOwnProperty.call(source, 'poste')) {
    updates.poste = normalizeNullableString(source.poste, ADMIN_FIELD_MAX_LENGTHS.poste);
  }

  if (Object.prototype.hasOwnProperty.call(source, 'badgeId')) {
    updates.badgeId = normalizeNullableString(source.badgeId, 50);
  }

  if (Object.prototype.hasOwnProperty.call(source, 'statut')) {
    const statut = String(source.statut || '').trim().toLowerCase();
    if (statut === 'actif' || statut === 'inactif') {
      updates.statut = statut;
    }
  }

  if (Object.prototype.hasOwnProperty.call(source, 'role')) {
    const role = String(source.role || '').trim().toLowerCase();
    if (role === 'admin' || role === 'super_admin') {
      updates.role = role;
    }
  }

  return updates;
};

const normalizeAdminProfessionalMetaPayload = (payload = {}) => {
  const updates = {};
  const source = payload && typeof payload === 'object' ? { ...payload } : {};

  if (source.emailPro !== undefined && source.email_pro === undefined) {
    source.email_pro = source.emailPro;
  }
  if (source.dateEmbauche !== undefined && source.date_embauche === undefined) {
    source.date_embauche = source.dateEmbauche;
  }
  if (source.contratType !== undefined && source.contrat_type === undefined) {
    source.contrat_type = source.contratType;
  }

  if (Object.prototype.hasOwnProperty.call(source, 'email_pro')) {
    const emailPro = normalizeNullableString(source.email_pro, ADMIN_META_FIELD_MAX_LENGTHS.email_pro);
    updates.email_pro = emailPro ? emailPro.toLowerCase() : null;
  }

  if (Object.prototype.hasOwnProperty.call(source, 'date_embauche')) {
    updates.date_embauche = normalizeDateOnlyString(source.date_embauche);
  }

  if (Object.prototype.hasOwnProperty.call(source, 'contrat_type')) {
    updates.contrat_type = normalizeNullableString(source.contrat_type, ADMIN_META_FIELD_MAX_LENGTHS.contrat_type);
  }

  if (Object.prototype.hasOwnProperty.call(source, 'salaire')) {
    if (source.salaire === null || String(source.salaire).trim() === '') {
      updates.salaire = null;
    } else {
      const salary = Number.parseFloat(String(source.salaire).replace(',', '.'));
      updates.salaire = Number.isFinite(salary) ? Number(salary.toFixed(2)) : null;
    }
  }

  return updates;
};

const mapAdminForApi = async (admin) => {
  const safeAdmin = removePassword(admin);
  if (!safeAdmin) return null;

  const adminMeta = await getAdminProfileMeta(safeAdmin.id);
  const professionalEmail = String(adminMeta.email_pro || safeAdmin.email || '').trim();
  const hireDate = normalizeDateOnlyString(adminMeta.date_embauche);
  const contratType = normalizeNullableString(adminMeta.contrat_type, ADMIN_META_FIELD_MAX_LENGTHS.contrat_type);
  const salaryValue = adminMeta.salaire;
  const salaire = salaryValue === null || salaryValue === undefined || String(salaryValue).trim?.() === ''
    ? null
    : Number.parseFloat(String(salaryValue).replace(',', '.'));
  return {
    ...safeAdmin,
    photo: normalizePhotoPath(adminMeta.photo || safeAdmin.photo),
    email_pro: professionalEmail || null,
    emailPro: professionalEmail || null,
    date_embauche: hireDate || null,
    contrat_type: contratType || null,
    salaire: Number.isFinite(salaire) ? Number(salaire.toFixed(2)) : null,
    userType: 'admin'
  };
};

const ROLE_MATRICULE_PREFIX = {
  super_admin: 'SAD',
  admin: 'ADM',
  manager: 'MGR',
  hr: 'RHS',
  chef_departement: 'CHD',
  comptable: 'CPT',
  stagiaire: 'STG',
  employe: 'EMP'
};

const normalizeRoleForMatricule = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'employe';
  if (raw === 'chef de departement' || raw === 'chef-departement' || raw === 'chefdepartement') {
    return 'chef_departement';
  }
  return raw;
};

const buildMatriculeFromIdentity = ({ id, role, dateCreation }) => {
  const numericId = Number(id) || 0;
  const normalizedRole = normalizeRoleForMatricule(role);
  const prefix = ROLE_MATRICULE_PREFIX[normalizedRole] || 'EMP';
  const creationDate = dateCreation ? new Date(dateCreation) : new Date();
  const year = Number.isNaN(creationDate.getTime()) ? new Date().getFullYear() : creationDate.getFullYear();
  return `${prefix}-${year}-${String(numericId).padStart(4, '0')}`;
};

const ensureEmployeMatriculeById = async (employeId) => {
  const id = Number(employeId);
  if (!Number.isInteger(id)) return null;

  const employe = await prisma.employe.findUnique({
    where: { id },
    select: { id: true, role: true, matricule: true, dateCreation: true }
  });

  if (!employe) return null;
  if (employe.matricule && String(employe.matricule).trim().length > 0) {
    return employe.matricule;
  }

  const base = buildMatriculeFromIdentity({
    id: employe.id,
    role: employe.role,
    dateCreation: employe.dateCreation
  });

  let candidate = base;
  let suffix = 1;
  // Extra safety in case of historical duplicates in imported data.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    // eslint-disable-next-line no-await-in-loop
    const conflict = await prisma.employe.findFirst({
      where: { matricule: candidate, id: { not: employe.id } },
      select: { id: true }
    });
    if (!conflict) break;
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }

  await prisma.employe.update({
    where: { id: employe.id },
    data: { matricule: candidate }
  });
  return candidate;
};

const ensureAllEmployeMatricules = async () => {
  const missing = await prisma.employe.findMany({
    where: {
      OR: [{ matricule: null }, { matricule: '' }]
    },
    select: { id: true }
  });

  for (const employe of missing) {
    // Sequential by design to avoid unique constraint races.
    // eslint-disable-next-line no-await-in-loop
    await ensureEmployeMatriculeById(employe.id);
  }
};

const getNextEmployeIdentifierPreview = async (role) => {
  const latestEmploye = await prisma.employe.findFirst({
    orderBy: { id: 'desc' },
    select: { id: true }
  });

  const nextId = Math.max(1, Number(latestEmploye?.id || 0) + 1);
  return {
    id: nextId,
    matricule: buildMatriculeFromIdentity({
      id: nextId,
      role: normalizeRoleForMatricule(role),
      dateCreation: new Date()
    })
  };
};

const mapEmployeForApi = (employe) => {
  const safeEmploye = removePassword(employe);
  if (!safeEmploye) return null;
  const infosSup = parseJsonObject(safeEmploye.infosSup);
  const metierRole = normalizeRole(infosSup.role_metier || '');
  const effectiveRole = metierRole && EMPLOYEE_ROLE_SET.has(metierRole) ? metierRole : normalizeRole(safeEmploye.role);

  return {
    ...safeEmploye,
    role: effectiveRole,
    photo: normalizePhotoPath(safeEmploye.photo),
    date_embauche: safeEmploye.dateEmbauche || null,
    matricule:
      safeEmploye.matricule
      || buildMatriculeFromIdentity({
        id: safeEmploye.id,
        role: effectiveRole,
        dateCreation: safeEmploye.dateCreation
      }),
    situation_matrimoniale: String(infosSup.situation_matrimoniale || ''),
    contact_urgence_nom: String(infosSup.contact_urgence_nom || ''),
    contact_urgence_telephone: String(infosSup.contact_urgence_telephone || ''),
    contact_urgence_relation: String(infosSup.contact_urgence_relation || ''),
    contact_urgence_adresse_physique: String(infosSup.contact_urgence_adresse_physique || ''),
    contrat_type: safeEmploye.contratType || null,
    contrat_duree: safeEmploye.contratDuree || null,
    contrat_pdf_url:
      String(
        infosSup.contrat_pdf_url
        || infosSup.contrat_pdf
        || infosSup.contratPdfUrl
        || infosSup.contratPdf
        || ''
      ).trim() || null
  };
};

const normalizeEmployeMutationPayload = (payload = {}, options = {}) => {
  const { allowProfessional = true, allowRole = true, allowProfessionalExtra = allowProfessional } = options;
  const input = { ...(payload || {}) };

  if (input.date_embauche !== undefined && input.dateEmbauche === undefined) {
    input.dateEmbauche = input.date_embauche;
  }
  delete input.date_embauche;

  if (input.badge_actif !== undefined && input.badgeActif === undefined) {
    input.badgeActif = input.badge_actif;
  }
  delete input.badge_actif;

  const extraUpdates = extractEmployeExtraFields(input, { allowProfessionalExtra });
  EMPLOYE_EXTRA_FIELDS.forEach((field) => {
    delete input[field];
  });

  const data = {};

  Object.entries(input).forEach(([key, value]) => {
    if (!EMPLOYE_ALLOWED_MUTABLE_FIELDS.has(key)) return;
    if (!allowProfessional && EMPLOYE_PROFESSIONAL_FIELDS.has(key)) return;
    if (!allowRole && key === 'role') return;

    if (key === 'dateEmbauche') {
      if (value === null || value === '') {
        data.dateEmbauche = null;
        return;
      }
      const parsedDate = new Date(value);
      if (!Number.isNaN(parsedDate.getTime())) {
        data.dateEmbauche = parsedDate;
      }
      return;
    }

    if (key === 'salaire') {
      if (value === null || value === '') {
        data.salaire = null;
        return;
      }
      const parsedSalary = Number(value);
      if (Number.isFinite(parsedSalary)) {
        data.salaire = parsedSalary;
      }
      return;
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed === '') {
        data[key] = null;
        return;
      }
      const maxLength = EMPLOYE_FIELD_MAX_LENGTHS[key];
      data[key] = truncateToMaxLength(trimmed, maxLength);
      return;
    }

    data[key] = value;
  });

  if (data.role !== undefined && data.role !== null) {
    data.role = normalizeRole(data.role);
  }

  return { data, extraUpdates };
};

const normalizePointageType = (value) => {
  const raw = String(value || '').toLowerCase().trim();
  if (raw === 'arrivee' || raw === 'arrivée' || raw === 'arrive') return 'arrivee';
  if (raw === 'depart' || raw === 'départ' || raw === 'departs') return 'depart';
  return null;
};

const normalizeDemandeType = (value) => {
  const raw = String(value || '').toLowerCase().trim();
  if (raw.includes('cong')) return 'conge';
  if (raw === 'retard') return 'retard';
  if (raw === 'badge') return 'badge';
  return 'absence';
};

const mapDemandeStatutForUi = (value) => {
  if (value === 'approuve') return 'approuvée';
  if (value === 'rejete') return 'rejetée';
  return 'en_attente';
};

const formatDateTime = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().slice(0, 19).replace('T', ' ');
};

const formatDateOnly = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().slice(0, 10);
};
const NOTIFICATION_LEVEL_TO_PILL_CLASS = {
  success: 'is-success',
  warning: 'is-warning',
  danger: 'is-danger',
  info: 'is-info'
};

const NOTIFICATION_LEVEL_TO_COLOR = {
  success: '#16a34a',
  warning: '#d97706',
  danger: '#dc2626',
  info: '#2563eb'
};

const normalizeNotificationLevel = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'success') return 'success';
  if (raw === 'warning') return 'warning';
  if (raw === 'danger') return 'danger';
  return 'info';
};

const normalizeNotificationType = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (raw.includes('retard')) return 'retard';
  if (raw.includes('absence')) return 'absence';
  if (raw.includes('demande')) return 'demande';
  if (raw.includes('badge')) return 'badge';
  if (raw.includes('event') || raw.includes('evenement')) return 'evenement';
  return 'pointage';
};

const mapNotificationTypeToLevel = (type) => {
  const normalized = normalizeNotificationType(type);
  if (normalized === 'retard') return 'warning';
  if (normalized === 'absence') return 'danger';
  if (normalized === 'demande') return 'warning';
  if (normalized === 'badge') return 'info';
  if (normalized === 'evenement') return 'info';
  return 'success';
};

const buildDisplayName = (prenom, nom, fallback = 'Employe') => {
  const fullName = `${prenom || ''} ${nom || ''}`.trim();
  return fullName || fallback;
};

const mapNotificationForApi = (notification) => {
  const level = normalizeNotificationLevel(
    notification.level || mapNotificationTypeToLevel(notification.type)
  );
  const type = normalizeNotificationType(notification.type);
  const createdAt = notification.created_at || notification.createdAt || notification.dateCreation || notification.date || new Date();
  const read = Boolean(notification.lue ?? notification.read ?? false);
  const dateLectureRaw = notification.date_lecture || notification.dateLecture || null;
  const dateLecture = dateLectureRaw ? new Date(dateLectureRaw) : null;

  return {
    id: String(notification.id || `${type}-${Date.now()}`),
    type,
    level,
    color: NOTIFICATION_LEVEL_TO_COLOR[level],
    pill_class: NOTIFICATION_LEVEL_TO_PILL_CLASS[level],
    title: String(notification.title || notification.titre || '').trim() || 'Notification',
    message: String(notification.message || notification.contenu || '').trim(),
    created_at: createdAt instanceof Date ? createdAt.toISOString() : createdAt,
    entity_id: Number(notification.entity_id || 0) || null,
    entity_kind: notification.entity_kind || type,
    employe_id: Number(notification.employe_id || notification.employeId || 0) || null,
    lue: read,
    read,
    date_lecture: dateLecture && !Number.isNaN(dateLecture.getTime()) ? dateLecture.toISOString() : null
  };
};

const createEmployeNotification = async ({
  employeId,
  title,
  message,
  type = 'pointage',
  level = undefined,
  pointageId = null,
  lien = null,
  date = new Date()
}) => {
  const normalizedEmployeId = Number(employeId || 0);
  if (!Number.isInteger(normalizedEmployeId) || normalizedEmployeId <= 0) {
    return null;
  }

  const normalizedType = normalizeNotificationType(type);
  const payloadTitle = truncateToMaxLength(String(title || '').trim() || 'Notification', 255);
  const payloadMessage = String(message || '').trim();

  if (!payloadTitle || !payloadMessage) return null;

  try {
    return await prisma.notification.create({
      data: {
        employeId: normalizedEmployeId,
        titre: payloadTitle,
        contenu: payloadMessage,
        message: payloadMessage,
        type: normalizedType,
        lien: lien ? String(lien) : null,
        lue: false,
        dateCreation: date,
        date,
        pointageId: Number.isInteger(pointageId) ? pointageId : null
      }
    });
  } catch (error) {
    console.warn('Notification employe non creee:', error?.message || error);
    return null;
  }
};

const getBadgeRegenerationReasonLabel = (reason, isAutomatic = false) => {
  const normalized = String(reason || '').trim().toLowerCase();
  if (normalized.includes('midnight') || normalized.includes('rollover') || normalized.includes('minuit')) {
    return 'Regeneration automatique de debut de jour';
  }
  if (normalized.includes('scan')) {
    return 'Regeneration automatique lors du scan';
  }
  if (normalized.includes('view')) {
    return 'Regeneration automatique lors de la consultation';
  }
  if (isAutomatic) {
    return 'Regeneration automatique du badge';
  }
  return 'Regeneration du badge';
};

const notifyBadgeRegenerated = async ({
  employeId,
  requestedBy,
  token,
  reason = 'manual'
}) => {
  const normalizedEmployeId = Number(employeId || 0);
  if (!Number.isInteger(normalizedEmployeId) || normalizedEmployeId <= 0) {
    return;
  }

  const isAutomatic = String(requestedBy || '').startsWith('system');
  const reasonLabel = getBadgeRegenerationReasonLabel(reason, isAutomatic);
  const expiresAt = token?.expiresAt ? new Date(token.expiresAt).toLocaleString('fr-FR') : null;
  const details = expiresAt
    ? `${reasonLabel}. Nouveau badge valide jusqu'au ${expiresAt}.`
    : `${reasonLabel}.`;

  await createEmployeNotification({
    employeId: normalizedEmployeId,
    title: 'Badge regenere',
    message: details,
    type: 'badge',
    level: 'info',
    lien: '/employee/badge'
  });
};

const notifyPointageCreated = async ({
  employeId,
  pointageId,
  pointageType,
  retardMinutes = 0,
  departAnticipeMinutes = 0,
  dateHeure = new Date()
}) => {
  const normalizedEmployeId = Number(employeId || 0);
  if (!Number.isInteger(normalizedEmployeId) || normalizedEmployeId <= 0) return;

  const normalizedType = normalizePointageType(pointageType) || String(pointageType || '').trim().toLowerCase();
  let title = 'Pointage enregistre';
  let message = 'Votre pointage a ete enregistre.';
  let level = 'success';

  if (normalizedType === 'arrivee') {
    if (Number(retardMinutes) > 0) {
      title = 'Arrivee en retard';
      message = `Arrivee enregistree avec ${retardMinutes} min de retard. Une justification est requise.`;
      level = 'warning';
    } else {
      title = 'Arrivee enregistree';
      message = 'Votre arrivee a ete enregistree a l heure.';
    }
  } else if (normalizedType === 'depart') {
    if (Number(departAnticipeMinutes) > 0) {
      title = 'Depart anticipe';
      message = `Depart enregistre ${departAnticipeMinutes} min avant l heure de fin. Une justification est requise.`;
      level = 'warning';
    } else {
      title = 'Depart enregistre';
      message = 'Votre depart a ete enregistre.';
    }
  } else if (normalizedType === 'pause_debut') {
    title = 'Pause demarree';
    message = 'Votre debut de pause a ete enregistre.';
    level = 'info';
  } else if (normalizedType === 'pause_fin') {
    title = 'Pause terminee';
    message = 'Votre fin de pause a ete enregistree.';
    level = 'info';
  }

  await createEmployeNotification({
    employeId: normalizedEmployeId,
    title,
    message,
    type: normalizedType.includes('pause') ? 'pointage' : (level === 'warning' ? 'retard' : 'pointage'),
    level,
    pointageId,
    date: dateHeure,
    lien: '/employee/historique'
  });
};

const notifyEmployeesAboutCalendarEvent = async ({
  event,
  actorLabel = 'Administration'
}) => {
  const eventId = Number(event?.id || 0);
  if (!Number.isInteger(eventId) || eventId <= 0) return;

  const title = truncateToMaxLength(`Nouvel evenement: ${String(event?.titre || 'Calendrier').trim()}`, 255);
  const startLabel = event?.startDate ? new Date(event.startDate).toLocaleString('fr-FR') : null;
  const endLabel = event?.endDate ? new Date(event.endDate).toLocaleString('fr-FR') : null;
  const periodLabel = startLabel && endLabel
    ? `${startLabel} - ${endLabel}`
    : startLabel || endLabel || 'periode a definir';
  const message = `${actorLabel} a ajoute "${String(event?.titre || 'un evenement').trim()}". ${periodLabel}.`;
  const normalizedEmployeId = Number(event?.employeId || 0);
  const now = new Date();

  if (Number.isInteger(normalizedEmployeId) && normalizedEmployeId > 0) {
    await createEmployeNotification({
      employeId: normalizedEmployeId,
      title,
      message,
      type: 'evenement',
      level: 'info',
      lien: '/employee/calendrier',
      date: now
    });
    return;
  }

  const targetEmployes = await prisma.employe.findMany({
    where: { statut: 'actif' },
    select: { id: true },
    take: 5000
  });

  if (!targetEmployes.length) return;

  try {
    await prisma.notification.createMany({
      data: targetEmployes.map((employe) => ({
        employeId: employe.id,
        titre: title,
        contenu: message,
        message,
        type: 'evenement',
        lien: '/employee/calendrier',
        lue: false,
        dateCreation: now,
        date: now
      }))
    });
  } catch (error) {
    console.warn('Creation notifications evenement globale echouee:', error?.message || error);
  }
};

const mapPointageForDashboard = (pointage) => {
  const pointageDate = pointage.dateHeure instanceof Date ? pointage.dateHeure : new Date(pointage.dateHeure);
  const isRetard = (pointage.retardMinutes || 0) > 0 || pointage.etat === 'retard';
  const parsedDateValid = !Number.isNaN(pointageDate.getTime());
  
  let retardMinutes = Number(pointage.retardMinutes || 0);
  if (
    parsedDateValid
    && String(pointage.type || '').toLowerCase() === 'arrivee'
    && retardMinutes <= 0
  ) {
    // Calcul du retard si non déjà défini
    const runtimeSettings = getSystemRuntimeSettings();
    const arrivalThreshold = buildThresholdDateFromTime(
      pointageDate,
      runtimeSettings.work_start_time,
      9,
      0
    );
    if (pointageDate.getTime() > arrivalThreshold.getTime()) {
      retardMinutes = Math.floor((pointageDate.getTime() - arrivalThreshold.getTime()) / 60000);
    }
  }

  const statut = String(pointage.etat || '').toLowerCase() === 'retard'
    || retardMinutes > 0
    ? 'retard'
    : String(pointage.type || '').toLowerCase() === 'absence'
      ? 'absent'
      : 'normal';

  return {
    id: pointage.id,
    date: pointageDate.toISOString().split('T')[0],
    date_heure: pointageDate.toISOString(),
    type: pointage.type,
    arrivee: pointage.type === 'arrivee' ? pointageDate.toISOString().substr(11, 5) : null,
    depart: pointage.type === 'depart' ? pointageDate.toISOString().substr(11, 5) : null,
    retard_minutes: retardMinutes,
    statut,
    lieu: pointage.deviceInfo || 'Bureau',
    commentaire: pointage.commentaire || null,
    source: extractScanSourceFromDeviceInfo(pointage.deviceInfo)
  };
};

const parseDemandeMeta = (commentaire) => {
  if (!commentaire) return {};
  const raw = String(commentaire || '').trim();
  if (!raw) return {};

  const candidates = [raw];
  const firstLine = raw.split('\n')[0]?.trim();
  if (firstLine && firstLine !== raw) {
    candidates.push(firstLine);
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (typeof parsed === 'object' && parsed !== null) {
        return parsed;
      }
    } catch {
      // ignore malformed candidate and continue
    }
  }

  return {};
};

const toIsoDateOnly = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const directMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (directMatch) {
    return `${directMatch[1]}-${directMatch[2]}-${directMatch[3]}`;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  return formatDateOnly(parsed);
};

const isRetardDemande = (demande, meta = {}) => {
  const candidates = [
    meta?.originalType,
    meta?.type,
    demande?.type
  ]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean);

  return candidates.some((value) => value.includes('retard'));
};

const extractDemandeDateRange = (demande, meta = {}) => {
  const fallbackDate = toIsoDateOnly(demande?.dateDemande) || formatDateOnly(new Date());
  const start = toIsoDateOnly(meta?.dateDebut || meta?.date_debut) || fallbackDate;
  const rawEnd = toIsoDateOnly(meta?.dateFin || meta?.date_fin) || start;
  return start <= rawEnd
    ? { start, end: rawEnd }
    : { start: rawEnd, end: start };
};

const findApprovedRetardDemandeForPointage = async ({ employeId, pointageDate }) => {
  const safeEmployeId = Number(employeId || 0);
  const targetDate = toIsoDateOnly(pointageDate);
  if (!Number.isInteger(safeEmployeId) || safeEmployeId <= 0 || !targetDate) return null;

  const approvedDemandes = await prisma.demande.findMany({
    where: {
      employeId: safeEmployeId,
      statut: 'approuve'
    },
    orderBy: [
      { dateTraitement: 'desc' },
      { dateDemande: 'desc' }
    ],
    take: 200
  });

  for (const demande of approvedDemandes) {
    const meta = parseDemandeMeta(demande.commentaire);
    if (!isRetardDemande(demande, meta)) continue;
    const range = extractDemandeDateRange(demande, meta);
    if (targetDate >= range.start && targetDate <= range.end) {
      return { demande, meta, range };
    }
  }

  return null;
};

const mapRetardDecisionToStatus = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (['approuve', 'approuver', 'approve', 'approved', 'valide', 'valider'].includes(raw)) return 'approuve';
  if (['refuse', 'refuser', 'reject', 'rejected', 'rejete', 'rejeter'].includes(raw)) return 'refuse';
  return null;
};

const syncRetardsWithDemandeDecision = async ({ demande, decision, managerId }) => {
  const normalizedDecision = mapRetardDecisionToStatus(decision);
  if (!normalizedDecision) return { updated: 0, pointageIds: [] };

  const meta = parseDemandeMeta(demande.commentaire);
  if (!isRetardDemande(demande, meta)) return { updated: 0, pointageIds: [] };

  const range = extractDemandeDateRange(demande, meta);
  const start = new Date(`${range.start}T00:00:00`);
  const end = new Date(`${range.end}T23:59:59.999`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { updated: 0, pointageIds: [] };
  }

  const pointages = await prisma.pointage.findMany({
    where: {
      employeId: Number(demande.employeId || 0),
      type: 'arrivee',
      dateHeure: { gte: start, lte: end },
      OR: [
        { retardMinutes: { gt: 0 } },
        { etat: 'retard' }
      ]
    },
    select: { id: true }
  });

  const pointageIds = pointages
    .map((pointage) => Number(pointage.id || 0))
    .filter((id) => Number.isInteger(id) && id > 0);

  if (pointageIds.length === 0) return { updated: 0, pointageIds: [] };

  const existingRetards = await prisma.retard.findMany({
    where: { pointageId: { in: pointageIds } },
    select: { pointageId: true }
  });

  const mappedPointageIds = existingRetards
    .map((retard) => Number(retard.pointageId || 0))
    .filter((id) => Number.isInteger(id) && id > 0);

  if (mappedPointageIds.length === 0) return { updated: 0, pointageIds: [] };

  const now = new Date();
  const adminTraitantId = Number(managerId || 0) > 0 ? Number(managerId) : null;

  const updatedRetards = await prisma.retard.updateMany({
    where: { pointageId: { in: mappedPointageIds } },
    data: {
      statut: normalizedDecision,
      adminTraitantId,
      dateTraitement: now
    }
  });

  await prisma.pointage.updateMany({
    where: { id: { in: mappedPointageIds } },
    data: { estJustifie: normalizedDecision === 'approuve' }
  });

  return { updated: Number(updatedRetards?.count || 0), pointageIds: mappedPointageIds };
};

const mapDemandeForDashboard = (demande) => {
  const meta = parseDemandeMeta(demande.commentaire);
  const rawType = String(meta.originalType || demande.type || '').toLowerCase();
  const type =
    rawType.includes('cong') ? 'congé'
      : rawType.includes('malad') ? 'maladie'
        : rawType.includes('permi') ? 'permission'
          : demande.type === 'conge' ? 'congé'
            : demande.type === 'retard' ? 'permission'
              : 'maladie';

  return {
    id: demande.id,
    type,
    date_debut: meta.dateDebut || formatDateOnly(demande.dateDemande),
    date_fin: meta.dateFin || meta.dateDebut || formatDateOnly(demande.dateDemande),
    motif: demande.raison || '',
    statut: mapDemandeStatutForUi(demande.statut),
    created_at: formatDateOnly(demande.dateDemande)
  };
};

const calculateTotalHours = (pointages) => {
  const byDay = new Map();
  for (const p of pointages) {
    if (p.type !== 'arrivee' && p.type !== 'depart') continue;
    const day = formatDateOnly(p.dateHeure);
    const list = byDay.get(day) || [];
    list.push(p);
    byDay.set(day, list);
  }

  let totalMs = 0;
  for (const list of byDay.values()) {
    const sorted = [...list].sort((a, b) => new Date(a.dateHeure) - new Date(b.dateHeure));
    let openArrival = null;
    for (const p of sorted) {
      if (p.type === 'arrivee') {
        openArrival = p;
      } else if (p.type === 'depart' && openArrival) {
        totalMs += Math.max(0, new Date(p.dateHeure) - new Date(openArrival.dateHeure));
        openArrival = null;
      }
    }
  }

  return Math.round(totalMs / (1000 * 60 * 60));
};

const normalizeRole = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'employe';
  if (raw === 'chef de departement' || raw === 'chef-departement' || raw === 'chefdepartement') {
    return 'chef_departement';
  }
  return raw;
};

const resolvePersistedEmployeRole = (requestedRole) => {
  const normalized = normalizeRole(requestedRole);
  if (supportedDbRoleValues.has(normalized)) {
    return {
      persistedRole: normalized,
      metierRole: null
    };
  }

  if (EMPLOYEE_ROLE_SET.has(normalized)) {
    return {
      persistedRole: DEFAULT_DB_EMPLOYEE_ROLE,
      metierRole: normalized
    };
  }

  return {
    persistedRole: normalized,
    metierRole: null
  };
};

const applyEmployeRolePersistence = (data, extraUpdates = {}) => {
  if (data?.role === undefined || data?.role === null || String(data.role).trim() === '') {
    return extraUpdates;
  }

  const normalizedRole = normalizeRole(data.role);
  const { persistedRole, metierRole } = resolvePersistedEmployeRole(normalizedRole);
  data.role = persistedRole;

  const nextExtraUpdates = { ...(extraUpdates || {}) };
  nextExtraUpdates.role_metier = metierRole;
  return nextExtraUpdates;
};

const resolveRequestedRoleFilter = (rawValue) => {
  const hasValue = rawValue !== undefined && rawValue !== null && String(rawValue).trim() !== '';
  if (!hasValue) {
    return {
      hasRoleFilter: false,
      normalizedRole: '',
      persistedRole: '',
      invalidRole: false
    };
  }

  const normalizedRole = normalizeRole(rawValue);
  if (!KNOWN_ROLE_SET.has(normalizedRole)) {
    return {
      hasRoleFilter: true,
      normalizedRole,
      persistedRole: '',
      invalidRole: true
    };
  }

  const { persistedRole } = resolvePersistedEmployeRole(normalizedRole);
  return {
    hasRoleFilter: true,
    normalizedRole,
    persistedRole,
    invalidRole: false
  };
};

const hasProfessionalProfileEditAccess = (req) => {
  return req.user?.userType === 'admin';
};

const hasRoleManagementAccess = (req) => {
  if (req.user?.userType !== 'admin') return false;
  const role = normalizeRole(req.user?.user?.role);
  return role === 'admin' || role === 'super_admin';
};

const hasSuperAdminAccess = (req) => {
  if (req.user?.userType !== 'admin') return false;
  return normalizeRole(req.user?.user?.role) === 'super_admin';
};

const isSuperAdminRequest = (req) => hasSuperAdminAccess(req);

const requireSuperAdmin = (req, res, next) => {
  if (!hasSuperAdminAccess(req)) {
    return res.status(403).json({ success: false, message: 'Acces reserve au super administrateur' });
  }
  next();
};

const requireRoleManagementAccess = (req, res, next) => {
  if (!hasRoleManagementAccess(req)) {
    return res.status(403).json({ success: false, message: 'Acces reserve aux administrateurs' });
  }
  next();
};

const canManageAdminBadges = (req) => hasSuperAdminAccess(req);

const isBadgeManagedByRequester = (req, token) => {
  if (!token) return false;
  if (canManageAdminBadges(req)) return true;
  return Number(token?.employeId || 0) > 0 && Number(token?.adminId || 0) <= 0;
};

const buildBadgeVisibilityWhere = (req, where = {}) => {
  if (canManageAdminBadges(req)) return where;
  return {
    ...where,
    adminId: null
  };
};

const canMutateCalendarEvent = (req, eventEmployeId = null) => {
  void eventEmployeId;
  return hasRoleManagementAccess(req);
};

const isAllowedEmployeRole = (value) => EMPLOYEE_ROLE_SET.has(normalizeRole(value));

const mapBadgeStatusFromDb = (value) => {
  if (value === 'active') return 'active';
  if (value === 'expired') return 'expired';
  return 'inactive';
};

const mapBadgeStatusToDb = (value) => {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'active') return 'active';
  if (normalized === 'expired') return 'expired';
  return 'revoked';
};

const getLocalDateKey = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
};

const hasBadgeDayRolledOver = (token, now = new Date()) => {
  if (!token?.createdAt) return false;
  const tokenDay = getLocalDateKey(token.createdAt);
  const currentDay = getLocalDateKey(now);
  if (!tokenDay || !currentDay) return false;
  return tokenDay !== currentDay;
};

const computeBadgeExpiry = (now = new Date(), options = {}) => {
  const local = new Date(now);
  const badgeExpirationHours = Number(options.badgeExpirationHours);
  if (Number.isFinite(badgeExpirationHours) && badgeExpirationHours > 0) {
    return new Date(local.getTime() + badgeExpirationHours * 60 * 60 * 1000);
  }
  const day = local.getDay(); // 0 sunday, 6 saturday
  let cutoff = null;

  if (day >= 1 && day <= 5) {
    cutoff = new Date(local);
    cutoff.setHours(18, 0, 0, 0);
    if (local > cutoff) {
      return new Date(local.getTime() + 60 * 60 * 1000);
    }
    const expiry = new Date(local);
    expiry.setHours(19, 0, 0, 0);
    return expiry;
  }

  if (day === 6) {
    cutoff = new Date(local);
    cutoff.setHours(14, 0, 0, 0);
    if (local > cutoff) {
      return new Date(local.getTime() + 60 * 60 * 1000);
    }
    const expiry = new Date(local);
    expiry.setHours(15, 0, 0, 0);
    return expiry;
  }

  return new Date(local.getTime() + 2 * 60 * 60 * 1000);
};

const generateBadgeTokenData = (userId, userType, options = {}) => {
  const random = crypto.randomBytes(16).toString('hex');
  const timestamp = Date.now();
  const version = 3;
  const payload = `${userType}|${userId}|${random}|${timestamp}|${version}`;
  const signature = crypto
    .createHmac('sha256', BADGE_SECRET)
    .update(payload)
    .digest('hex');
  const token = `${payload}|${signature}`;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = computeBadgeExpiry(new Date(), {
    badgeExpirationHours: options.badgeExpirationHours
  });

  return { token, tokenHash, expiresAt };
};

const isLikelyTokenHash = (value) => /^[a-f0-9]{64}$/i.test(String(value || '').trim());

const secureCompareHex = (left, right) => {
  try {
    const leftHex = String(left || '').trim();
    const rightHex = String(right || '').trim();
    if (leftHex.length === 0 || rightHex.length === 0) return false;
    if (leftHex.length !== rightHex.length) return false;
    return crypto.timingSafeEqual(Buffer.from(leftHex, 'hex'), Buffer.from(rightHex, 'hex'));
  } catch {
    return false;
  }
};

const parseBadgeRawToken = (rawToken) => {
  const token = String(rawToken || '').trim();
  if (!token || !token.includes('|')) return null;

  const parts = token.split('|');
  if (parts.length === 6) {
    const [userTypeRaw, userIdRaw, random, timestampRaw, versionRaw, signature] = parts;
    const userType = String(userTypeRaw || '').trim().toLowerCase();
    const userId = parseInt(userIdRaw, 10);
    const timestamp = Number(timestampRaw);
    const version = Number(versionRaw);

    if (!['admin', 'employe'].includes(userType)) return null;
    if (!Number.isInteger(userId) || userId <= 0) return null;
    if (!random || !signature) return null;
    if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
    if (!Number.isFinite(version) || version <= 0) return null;

    const payload = parts.slice(0, 5).join('|');
    const expectedSignature = crypto
      .createHmac('sha256', BADGE_SECRET)
      .update(payload)
      .digest('hex');

    if (!secureCompareHex(signature, expectedSignature)) {
      return null;
    }

    return {
      userType,
      userId,
      tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
      token
    };
  }

  // Legacy registrar format: user_id|random|timestamp|version|signature
  if (parts.length === 5) {
    const [userIdRaw, random, timestampRaw, versionRaw, signature] = parts;
    const userId = parseInt(userIdRaw, 10);
    const timestamp = Number(timestampRaw);
    const version = Number(versionRaw);

    if (!Number.isInteger(userId) || userId <= 0) return null;
    if (!random || !signature) return null;
    if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
    if (!Number.isFinite(version) || version <= 0) return null;

    const payload = parts.slice(0, 4).join('|');
    const expectedSignature = crypto
      .createHmac('sha256', BADGE_SECRET)
      .update(payload)
      .digest('hex');

    if (!secureCompareHex(signature, expectedSignature)) {
      return null;
    }

    return {
      userType: null,
      userId,
      tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
      token
    };
  }

  return null;
};

const getPointageUserScope = (userType, userId) => {
  if (userType === 'admin') {
    return { adminId: userId };
  }
  return { employeId: userId };
};

const inferPointageTypeForToday = async ({ userType, userId, startOfDay, endOfDay }) => {
  const scope = getPointageUserScope(userType, userId);
  const todayPointages = await prisma.pointage.findMany({
    where: {
      ...scope,
      dateHeure: { gte: startOfDay, lte: endOfDay }
    },
    select: { type: true },
    orderBy: { dateHeure: 'asc' }
  });

  const arrivals = todayPointages.filter((item) => item.type === 'arrivee').length;
  const departures = todayPointages.filter((item) => item.type === 'depart').length;
  return arrivals > departures ? 'depart' : 'arrivee';
};

const ensureRoleEnumValues = async () => {
  const values = ['manager', 'hr', 'chef_departement', 'comptable', 'stagiaire'];
  
  // Utiliser une approche plus sécurisée avec SET ROLE temporaire
  try {
    // Désactiver temporairement les vérifications de permissions
    
    // Vérifier d'abord si les valeurs existent déjà
    const existingValues = await prisma.$queryRawUnsafe(`
      SELECT e.enumlabel AS value
      FROM pg_type t
      JOIN pg_enum e ON t.oid = e.enumtypid
      WHERE LOWER(t.typname) = LOWER('Role')
    `);
    
    if (Array.isArray(existingValues) && existingValues.length > 0) {
      const existing = new Set(
        existingValues
          .map((row) => normalizeRole(row?.value))
          .filter((value) => typeof value === 'string' && value.length > 0)
      );
      
      // Ajouter seulement les valeurs qui n'existent pas déjà
      for (const value of values) {
        if (!existing.has(value)) {
          try {
            await prisma.$executeRawUnsafe(`ALTER TYPE "Role" ADD VALUE IF NOT EXISTS '${value}'`);
            console.log(`Role enum value '${value}' added successfully`);
          } catch (error) {
            if (String(error?.code || '') === '42501') {
              console.warn(`Role enum update skipped (insufficient privilege): ${value}`);
              break;
            }
            console.warn(`Role enum update warning for "${value}":`, error?.message || error);
          }
        }
      }
    } else {
      // Si aucune valeur n'existe, créer toutes les valeurs
      for (const value of values) {
        try {
          await prisma.$executeRawUnsafe(`ALTER TYPE "Role" ADD VALUE IF NOT EXISTS '${value}'`);
          console.log(`Role enum value '${value}' added successfully`);
        } catch (error) {
          if (String(error?.code || '') === '42501') {
            console.warn(`Role enum update skipped (insufficient privilege): ${value}`);
            break;
          }
          console.warn(`Role enum update warning for "${value}":`, error?.message || error);
        }
      }
    }
    
    // Rétablir le rôle normal
    
  } catch (error) {
    console.warn('Error ensuring Role enum values:', error?.message || error);
  }
};

const loadSupportedDbRoleValues = async () => {
  try {
    const rows = await prisma.$queryRawUnsafe(`
      SELECT e.enumlabel AS value
      FROM pg_type t
      JOIN pg_enum e ON t.oid = e.enumtypid
      WHERE LOWER(t.typname) = LOWER('Role')
      ORDER BY e.enumsortorder
    `);

    if (Array.isArray(rows) && rows.length > 0) {
      const detected = new Set(
        rows
          .map((row) => normalizeRole(row?.value))
          .filter((value) => typeof value === 'string' && value.length > 0)
      );
      if (detected.size > 0) {
        supportedDbRoleValues = detected;
      }
    }
  } catch (error) {
    console.warn('Role enum detection warning:', error?.message || error);
  }

  console.log('Role enum values detectees:', Array.from(supportedDbRoleValues).join(', '));
};

const regenerateBadgeToken = async ({
  employeId,
  adminId,
  requestedBy,
  ipAddress,
  userAgent,
  runtimeSettings = null,
  reason = 'manual'
}) => {
  const userType = employeId ? 'employe' : 'admin';
  const userId = employeId || adminId;
  if (!userId) {
    throw new Error('Utilisateur cible introuvable');
  }

  const effectiveRuntimeSettings = runtimeSettings || await getSystemRuntimeSettings();
  const generated = generateBadgeTokenData(userId, userType, {
    badgeExpirationHours: effectiveRuntimeSettings.badge_expiration_hours
  });

  const token = await prisma.$transaction(async (tx) => {
    await tx.badgeToken.updateMany({
      where: {
        ...(employeId ? { employeId } : { adminId }),
        status: 'active'
      },
      data: {
        status: 'revoked',
        revokedAt: new Date()
      }
    });

    return tx.badgeToken.create({
      data: {
        ...(employeId ? { employeId } : { adminId }),
        token: generated.token,
        tokenHash: generated.tokenHash,
        expiresAt: generated.expiresAt,
        ipAddress: ipAddress || 'unknown',
        userAgent: userAgent || null,
        deviceInfo: userAgent || null,
        status: 'active',
        createdBy: requestedBy ? String(requestedBy) : 'system',
        type: userType
      },
      include: {
        employe: true,
        admin: true
      }
    });
  });

  await notifyBadgeRegenerated({
    employeId: token?.employeId || null,
    requestedBy,
    token,
    reason
  });

  return token;
};

const previousLocalDay = new Date();
previousLocalDay.setDate(previousLocalDay.getDate() - 1);
let lastDailyBadgeRegenerationDate = getLocalDateKey(previousLocalDay);
let dailyBadgeRegenerationRunning = false;

const createAutoDepartureForOpenShiftsOnDay = async ({
  targetDayStart,
  employeId = null,
  runtimeSettings = null,
  reason = 'daily-rollover-auto-departure',
  notifyEmploye = true
} = {}) => {
  const dayStart = targetDayStart instanceof Date ? new Date(targetDayStart) : new Date(targetDayStart || Date.now());
  if (Number.isNaN(dayStart.getTime())) return 0;

  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setHours(23, 59, 59, 999);

  const where = {
    employeId: { not: null },
    dateHeure: { gte: dayStart, lte: dayEnd }
  };

  const normalizedEmployeId = Number(employeId || 0);
  if (Number.isInteger(normalizedEmployeId) && normalizedEmployeId > 0) {
    where.employeId = normalizedEmployeId;
  }

  const rows = await prisma.pointage.findMany({
    where,
    select: {
      employeId: true,
      type: true,
      dateHeure: true
    },
    orderBy: [{ employeId: 'asc' }, { dateHeure: 'asc' }]
  });

  if (!rows.length) return 0;

  const grouped = new Map();
  rows.forEach((row) => {
    const rowEmployeId = Number(row.employeId || 0);
    if (!Number.isInteger(rowEmployeId) || rowEmployeId <= 0) return;

    const current = grouped.get(rowEmployeId) || {
      arrivees: 0,
      departs: 0,
      latestArrivee: null
    };

    if (row.type === 'arrivee') {
      current.arrivees += 1;
      current.latestArrivee = row.dateHeure ? new Date(row.dateHeure) : current.latestArrivee;
    } else if (row.type === 'depart') {
      current.departs += 1;
    }

    grouped.set(rowEmployeId, current);
  });

  if (grouped.size === 0) return 0;

  const effectiveRuntimeSettings = runtimeSettings || await getSystemRuntimeSettings();
  const departureThreshold = buildThresholdDateFromTime(
    dayStart,
    effectiveRuntimeSettings?.work_end_time,
    18,
    0
  );

  let fixedCount = 0;

  for (const [rowEmployeId, snapshot] of grouped.entries()) {
    if (snapshot.arrivees <= snapshot.departs) continue;

    const latestArriveeTs = snapshot.latestArrivee instanceof Date && !Number.isNaN(snapshot.latestArrivee.getTime())
      ? snapshot.latestArrivee.getTime()
      : null;
    const thresholdTs = departureThreshold.getTime();
    const finalDepartureTs = latestArriveeTs && latestArriveeTs >= thresholdTs
      ? latestArriveeTs + 60 * 1000
      : thresholdTs;
    const autoDepartureDate = new Date(finalDepartureTs);

    try {
      const createdPointage = await prisma.pointage.create({
        data: {
          employeId: rowEmployeId,
          type: 'depart',
          dateHeure: autoDepartureDate,
          datePointage: dayStart,
          etat: 'normal',
          statut: 'present',
          retardMinutes: 0,
          estJustifie: true,
          commentaire: `Depart renseigne automatiquement (${reason})`
        }
      });

      fixedCount += 1;

      if (notifyEmploye) {
        await createEmployeNotification({
          employeId: rowEmployeId,
          title: 'Depart complete automatiquement',
          message: `Aucun pointage depart n'a ete enregistre le ${formatDateOnly(dayStart)}. Le systeme a applique l'heure normale (${effectiveRuntimeSettings?.work_end_time || '18:00'}).`,
          type: 'pointage',
          level: 'info',
          pointageId: createdPointage.id,
          lien: '/employee/historique',
          date: new Date()
        });
      }
    } catch (error) {
      console.warn(`Auto-cloture depart employe #${rowEmployeId} echouee:`, error?.message || error);
    }
  }

  return fixedCount;
};

const createAutoDepartureForOpenShifts = async ({
  dayStart,
  runtimeSettings = null,
  reason = 'daily-rollover-auto-departure'
} = {}) => {
  const start = dayStart instanceof Date ? new Date(dayStart) : new Date(dayStart || Date.now());
  if (Number.isNaN(start.getTime())) return 0;

  const previousDayStart = new Date(start);
  previousDayStart.setDate(previousDayStart.getDate() - 1);
  return createAutoDepartureForOpenShiftsOnDay({
    targetDayStart: previousDayStart,
    runtimeSettings,
    reason,
    notifyEmploye: true
  });
};

const backfillAutoDeparturesForEmployeRange = async ({
  employeId,
  startDate,
  endDate,
  runtimeSettings = null,
  reason = 'employee-history-auto-departure'
} = {}) => {
  const normalizedEmployeId = Number(employeId || 0);
  if (!Number.isInteger(normalizedEmployeId) || normalizedEmployeId <= 0) return 0;

  const from = startDate instanceof Date ? new Date(startDate) : new Date(startDate || Date.now());
  const to = endDate instanceof Date ? new Date(endDate) : new Date(endDate || Date.now());
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;

  const startDay = new Date(from);
  startDay.setHours(0, 0, 0, 0);

  const endDay = new Date(to);
  endDay.setHours(0, 0, 0, 0);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  if (startDay.getTime() >= todayStart.getTime()) return 0;

  const finalEnd = endDay.getTime() >= todayStart.getTime()
    ? new Date(todayStart.getTime() - 24 * 60 * 60 * 1000)
    : endDay;

  if (finalEnd.getTime() < startDay.getTime()) return 0;

  const effectiveRuntimeSettings = runtimeSettings || await getSystemRuntimeSettings();

  let fixedCount = 0;
  let cursor = new Date(startDay);
  while (cursor.getTime() <= finalEnd.getTime()) {
    // Sequential by design to avoid creating duplicates under concurrency.
    // eslint-disable-next-line no-await-in-loop
    fixedCount += await createAutoDepartureForOpenShiftsOnDay({
      targetDayStart: cursor,
      employeId: normalizedEmployeId,
      runtimeSettings: effectiveRuntimeSettings,
      reason,
      notifyEmploye: false
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  return fixedCount;
};

const regenerateBadgesForDayRollover = async ({ referenceDate = new Date(), reason = 'daily-rollover' } = {}) => {
  const now = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
  if (Number.isNaN(now.getTime())) return 0;

  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);

  const oldActiveTokens = await prisma.badgeToken.findMany({
    where: {
      status: 'active',
      createdAt: { lt: startOfDay },
      OR: [{ employeId: { not: null } }, { adminId: { not: null } }]
    },
    select: { employeId: true, adminId: true },
    orderBy: { id: 'desc' }
  });

  const runtimeSettings = await getSystemRuntimeSettings();
  const autoDepartures = await createAutoDepartureForOpenShifts({
    dayStart: startOfDay,
    runtimeSettings,
    reason
  });
  if (autoDepartures > 0) {
    console.log(`Pointages depart auto-completes avant regeneration: ${autoDepartures}`);
  }
  if (!oldActiveTokens.length) return 0;

  const dedupTargets = new Map();

  oldActiveTokens.forEach((token) => {
    if (Number.isInteger(token.employeId) && token.employeId > 0) {
      dedupTargets.set(`employe-${token.employeId}`, { employeId: token.employeId, adminId: null });
      return;
    }
    if (Number.isInteger(token.adminId) && token.adminId > 0) {
      dedupTargets.set(`admin-${token.adminId}`, { employeId: null, adminId: token.adminId });
    }
  });

  let regeneratedCount = 0;
  for (const target of dedupTargets.values()) {
    // Sequential by design to keep transaction pressure low.
    // eslint-disable-next-line no-await-in-loop
    await regenerateBadgeToken({
      employeId: target.employeId,
      adminId: target.adminId,
      requestedBy: `system-${reason}`,
      ipAddress: 'system',
      userAgent: `system/${reason}`,
      runtimeSettings,
      reason
    });
    regeneratedCount += 1;
  }

  return regeneratedCount;
};

const scheduleDailyBadgeRegeneration = () => {
  setInterval(async () => {
    const now = new Date();
    const todayKey = getLocalDateKey(now);
    if (!todayKey || todayKey === lastDailyBadgeRegenerationDate || dailyBadgeRegenerationRunning) {
      return;
    }

    dailyBadgeRegenerationRunning = true;
    try {
      const regenerated = await regenerateBadgesForDayRollover({
        referenceDate: now,
        reason: 'midnight-auto'
      });
      lastDailyBadgeRegenerationDate = todayKey;
      if (regenerated > 0) {
        console.log(`Badges regeneres automatiquement a minuit: ${regenerated}`);
      }
    } catch (error) {
      console.error('Erreur regeneration badges minuit:', error);
    } finally {
      dailyBadgeRegenerationRunning = false;
    }
  }, 60 * 1000);
};

const mapBadgeTokenForUi = (token) => {
  const user = token.employe || token.admin;
  const userName = user ? `${user.prenom || ''} ${user.nom || ''}`.trim() : 'Utilisateur';
  const role = user?.role || (token.adminId ? 'admin' : 'employe');
  const safeToken = token.token || token.tokenHash || '';
  const userMatricule = token.employe
    ? token.employe.matricule
      || buildMatriculeFromIdentity({
        id: token.employe.id,
        role: token.employe.role,
        dateCreation: token.employe.dateCreation
      })
    : buildMatriculeFromIdentity({
      id: token.adminId || user?.id || 0,
      role: role || 'admin',
      dateCreation: user?.dateCreation || token.createdAt
    });
  const expiredByDate = token.expiresAt ? new Date(token.expiresAt).getTime() <= Date.now() : false;
  const status = token.status === 'active' && expiredByDate
    ? 'expired'
    : mapBadgeStatusFromDb(token.status);

  return {
    id: token.id,
    token: safeToken,
    token_hash: token.tokenHash,
    user_id: token.employeId || token.adminId,
    user_type: token.employeId ? 'employe' : 'admin',
    user_matricule: userMatricule,
    user_name: userName,
    user_email: user?.email || '',
    user_role: role,
    created_at: token.createdAt,
    expires_at: token.expiresAt,
    status,
    last_used: token.lastUsedAt,
    usage_count: token.usageCount || 0
  };
};

const parseCalendarDate = (value, fallback) => {
  if (!value) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return parsed;
};

const EVENT_PRIORITIES = ['secondaire', 'normale', 'importante', 'urgente'];

const normalizeEventPriority = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  return EVENT_PRIORITIES.includes(raw) ? raw : 'normale';
};

const extractCalendarMetaFromDescription = (value) => {
  if (!value) {
    return { description: '', priorite: 'normale', lieu: '' };
  }

  const asString = String(value);
  try {
    const parsed = JSON.parse(asString);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return {
        description: String(parsed.description || ''),
        priorite: normalizeEventPriority(parsed.priorite),
        lieu: String(parsed.lieu || '')
      };
    }
  } catch {
    // Fallback to plain text description.
  }

  return { description: asString, priorite: 'normale', lieu: '' };
};

const buildCalendarDescriptionPayload = ({ description, priorite, lieu }) =>
  JSON.stringify({
    description: String(description || ''),
    priorite: normalizeEventPriority(priorite),
    lieu: String(lieu || '')
  });

const SETTINGS_STORAGE_KEY = 'dashboard_preferences';
const DEFAULT_DASHBOARD_SETTINGS = Object.freeze({
  language: 'fr',
  timezone: 'Africa/Abidjan',
  theme: 'clair',
  compact_sidebar: false,
  notifications_email: true,
  notifications_push: false,
  notifications_retards: true,
  notifications_demandes: true,
  daily_reports: false,
  calendar_show_weekends: true,
  dashboard_auto_refresh_seconds: 60,
  work_start_time: '09:00',
  work_end_time: '18:00',
  pause_duration_minutes: 60,
  session_duration_minutes: 1440,
  badge_expiration_hours: 0,
  badge_regeneration_hours: 0
});
const ADMIN_RUNTIME_SETTING_KEYS = new Set([
  'work_start_time',
  'work_end_time',
  'pause_duration_minutes',
  'session_duration_minutes',
  'badge_expiration_hours',
  'badge_regeneration_hours'
]);
const RUNTIME_SETTINGS_CACHE_TTL_MS = 60 * 1000;
let runtimeSettingsCache = {
  value: { ...DEFAULT_DASHBOARD_SETTINGS },
  expiresAt: 0
};

const normalizeBooleanSetting = (value, fallback) => {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1' || value === 1) return true;
  if (value === 'false' || value === '0' || value === 0) return false;
  return fallback;
};

const normalizeIntegerSetting = (value, fallback, min, max) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
};

const normalizeTimeSetting = (value, fallback) => {
  const raw = String(value || '').trim();
  const match = raw.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return fallback;
  return `${match[1]}:${match[2]}`;
};

const normalizeDashboardSettings = (input = {}) => {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const language = ['fr', 'en'].includes(String(source.language || '').trim().toLowerCase())
    ? String(source.language).trim().toLowerCase()
    : DEFAULT_DASHBOARD_SETTINGS.language;
  const theme = ['clair', 'sombre', 'systeme'].includes(String(source.theme || '').trim().toLowerCase())
    ? String(source.theme).trim().toLowerCase()
    : DEFAULT_DASHBOARD_SETTINGS.theme;
  const timezone = String(source.timezone || '').trim() || DEFAULT_DASHBOARD_SETTINGS.timezone;

  return {
    language,
    timezone,
    theme,
    compact_sidebar: normalizeBooleanSetting(source.compact_sidebar, DEFAULT_DASHBOARD_SETTINGS.compact_sidebar),
    notifications_email: normalizeBooleanSetting(source.notifications_email, DEFAULT_DASHBOARD_SETTINGS.notifications_email),
    notifications_push: normalizeBooleanSetting(source.notifications_push, DEFAULT_DASHBOARD_SETTINGS.notifications_push),
    notifications_retards: normalizeBooleanSetting(source.notifications_retards, DEFAULT_DASHBOARD_SETTINGS.notifications_retards),
    notifications_demandes: normalizeBooleanSetting(source.notifications_demandes, DEFAULT_DASHBOARD_SETTINGS.notifications_demandes),
    daily_reports: normalizeBooleanSetting(source.daily_reports, DEFAULT_DASHBOARD_SETTINGS.daily_reports),
    calendar_show_weekends: normalizeBooleanSetting(source.calendar_show_weekends, DEFAULT_DASHBOARD_SETTINGS.calendar_show_weekends),
    dashboard_auto_refresh_seconds: normalizeIntegerSetting(
      source.dashboard_auto_refresh_seconds,
      DEFAULT_DASHBOARD_SETTINGS.dashboard_auto_refresh_seconds,
      30,
      600
    ),
    work_start_time: normalizeTimeSetting(source.work_start_time, DEFAULT_DASHBOARD_SETTINGS.work_start_time),
    work_end_time: normalizeTimeSetting(source.work_end_time, DEFAULT_DASHBOARD_SETTINGS.work_end_time),
    pause_duration_minutes: normalizeIntegerSetting(
      source.pause_duration_minutes,
      DEFAULT_DASHBOARD_SETTINGS.pause_duration_minutes,
      0,
      240
    ),
    session_duration_minutes: normalizeIntegerSetting(
      source.session_duration_minutes,
      DEFAULT_DASHBOARD_SETTINGS.session_duration_minutes,
      15,
      10080
    ),
    badge_expiration_hours: normalizeIntegerSetting(
      source.badge_expiration_hours,
      DEFAULT_DASHBOARD_SETTINGS.badge_expiration_hours,
      0,
      168
    ),
    badge_regeneration_hours: normalizeIntegerSetting(
      source.badge_regeneration_hours,
      DEFAULT_DASHBOARD_SETTINGS.badge_regeneration_hours,
      0,
      168
    )
  };
};

const parseDashboardSettingsRecord = (value) => {
  if (!value) return { ...DEFAULT_DASHBOARD_SETTINGS };
  try {
    const parsed = JSON.parse(String(value));
    return normalizeDashboardSettings({
      ...DEFAULT_DASHBOARD_SETTINGS,
      ...(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {})
    });
  } catch {
    return { ...DEFAULT_DASHBOARD_SETTINGS };
  }
};

const extractTimeParts = (value, fallbackHour, fallbackMinute) => {
  const normalized = normalizeTimeSetting(value, `${String(fallbackHour).padStart(2, '0')}:${String(fallbackMinute).padStart(2, '0')}`);
  const [hours, minutes] = normalized.split(':').map((item) => Number(item));
  return {
    hours: Number.isInteger(hours) ? hours : fallbackHour,
    minutes: Number.isInteger(minutes) ? minutes : fallbackMinute
  };
};

const buildThresholdDateFromTime = (baseDate, timeLabel, fallbackHour, fallbackMinute) => {
  const sourceDate = baseDate instanceof Date ? baseDate : new Date();
  const { hours, minutes } = extractTimeParts(timeLabel, fallbackHour, fallbackMinute);
  return new Date(
    sourceDate.getFullYear(),
    sourceDate.getMonth(),
    sourceDate.getDate(),
    hours,
    minutes,
    0,
    0
  );
};

const getSystemRuntimeSettings = async ({ forceRefresh = false } = {}) => {
  const now = Date.now();
  if (!forceRefresh && runtimeSettingsCache.value && runtimeSettingsCache.expiresAt > now) {
    return runtimeSettingsCache.value;
  }

  try {
    const record = await prisma.parametreUtilisateur.findFirst({
      where: {
        userType: 'admin',
        cle: SETTINGS_STORAGE_KEY
      },
      select: { valeur: true },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }]
    });

    const nextValue = record
      ? parseDashboardSettingsRecord(record.valeur)
      : { ...DEFAULT_DASHBOARD_SETTINGS };

    runtimeSettingsCache = {
      value: nextValue,
      expiresAt: now + RUNTIME_SETTINGS_CACHE_TTL_MS
    };

    return nextValue;
  } catch (error) {
    console.warn('Runtime settings warning:', error?.message || error);
    return runtimeSettingsCache.value || { ...DEFAULT_DASHBOARD_SETTINGS };
  }
};

const handleProfilePhotoUpload = (req, res) => {
  profilePhotoUpload.single('photo')(req, res, (uploadError) => {
    if (uploadError) {
      if (uploadError instanceof multer.MulterError && uploadError.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          message: 'Image trop volumineuse (max 5 Mo).'
        });
      }

      return res.status(400).json({
        success: false,
        message: uploadError.message || 'Erreur upload photo.'
      });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Aucun fichier photo recu.' });
    }

    const photoUrl = `/api/uploads/profile-photos/${req.file.filename}`;
    return res.status(201).json({
      success: true,
      message: 'Photo telechargee avec succes.',
      photo_url: photoUrl
    });
  });
};

app.post('/api/uploads/profile-photo', validateToken, handleProfilePhotoUpload);
app.post('/api/upload/profile-photo', validateToken, handleProfilePhotoUpload);

const handleContractPdfUpload = (req, res) => {
  contractPdfUpload.single('contrat')(req, res, (uploadError) => {
    if (uploadError) {
      if (uploadError instanceof multer.MulterError && uploadError.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          message: 'PDF trop volumineux (max 10 Mo).'
        });
      }

      return res.status(400).json({
        success: false,
        message: uploadError.message || 'Erreur upload contrat PDF.'
      });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Aucun fichier contrat recu.' });
    }

    const contractUrl = `/api/uploads/contracts/${req.file.filename}`;
    return res.status(201).json({
      success: true,
      message: 'Contrat telecharge avec succes.',
      contract_url: contractUrl
    });
  });
};

app.post('/api/uploads/contract-pdf', validateToken, requireRoleManagementAccess, handleContractPdfUpload);
app.post('/api/upload/contract-pdf', validateToken, requireRoleManagementAccess, handleContractPdfUpload);

// Health endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    service: 'xpert-pro-backend',
    database: 'pointage'
  });
});

// Auth endpoints
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email et mot de passe requis' });
    }
    
    // Check admin
    let user = await adminModel.authenticate(email, password);
    let userType = 'admin';
    
    if (!user) {
      // Check employee
      user = await employeModel.authenticate(email, password);
      userType = 'employe';
    }
    
    if (!user) {
      return res.status(401).json({ success: false, message: 'Identifiants incorrects' });
    }

    if (userType === 'employe') {
      if (!user.matricule) {
        const generatedMatricule = await ensureEmployeMatriculeById(user.id);
        if (generatedMatricule) {
          user.matricule = generatedMatricule;
        }
      }
      user = mapEmployeForApi(user);
    } else {
      user = await mapAdminForApi(user);
    }
    
    const runtimeSettings = await getSystemRuntimeSettings();
    const sessionDurationMinutes = normalizeIntegerSetting(
      runtimeSettings.session_duration_minutes,
      DEFAULT_DASHBOARD_SETTINGS.session_duration_minutes,
      15,
      10080
    );

    const token = jwt.sign(
      { user, userType },
      JWT_SECRET,
      { expiresIn: `${sessionDurationMinutes}m` }
    );
    
    res.json({
      success: true,
      message: 'Connexion réussie',
      user: { ...user, userType },
      token
    });
  } catch (error) {
    console.error('Erreur login:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

app.get('/api/auth/validate', validateToken, async (req, res) => {
  try {
    const tokenUser = req.user?.user;
    const userType = req.user?.userType;
    if (!tokenUser?.id || !userType) {
      return res.status(401).json({ success: false, message: 'Session invalide', valid: false });
    }

    if (userType === 'admin') {
      const admin = await adminModel.getById(tokenUser.id);
      if (!admin) {
        return res.status(401).json({ success: false, message: 'Utilisateur introuvable', valid: false });
      }
      return res.json({
        success: true,
        user: { ...(await mapAdminForApi(admin)), userType: 'admin' },
        valid: true
      });
    }

    const employe = await employeModel.getById(tokenUser.id);
    if (!employe) {
      return res.status(401).json({ success: false, message: 'Utilisateur introuvable', valid: false });
    }

    if (!employe.matricule) {
      const generatedMatricule = await ensureEmployeMatriculeById(employe.id);
      if (generatedMatricule) {
        employe.matricule = generatedMatricule;
      }
    }

    return res.json({
      success: true,
      user: { ...mapEmployeForApi(employe), userType: 'employe' },
      valid: true
    });
  } catch (error) {
    console.error('Erreur auth/validate:', error);
    return res.status(500).json({ success: false, message: 'Erreur serveur', valid: false });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.json({ success: true, message: 'Déconnexion réussie' });
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { nom, prenom, email, password, telephone, departement } = req.body || {};

    if (!nom || !prenom || !email || !password) {
      return res.status(400).json({ success: false, message: 'Nom, prénom, email et mot de passe requis' });
    }

    const existingEmploye = await employeModel.getByEmail(email);
    const existingAdmin = await adminModel.getByEmail(email);
    if (existingEmploye || existingAdmin) {
      return res.status(409).json({ success: false, message: 'Email déjà utilisé' });
    }

    const created = await employeModel.create({
      nom,
      prenom,
      email,
      password,
      telephone: telephone || null,
      departement: departement || null,
      role: 'employe',
      statut: 'actif'
    });

    if (!created.matricule) {
      const generatedMatricule = await ensureEmployeMatriculeById(created.id);
      if (generatedMatricule) {
        created.matricule = generatedMatricule;
      }
    }

    res.status(201).json({
      success: true,
      message: 'Compte créé avec succès',
      user: mapEmployeForApi(created)
    });
  } catch (error) {
    console.error('Erreur auth/register:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

app.put('/api/auth/profile', validateToken, async (req, res) => {
  try {
    const tokenUser = req.user?.user;
    const userType = req.user?.userType;
    if (!tokenUser?.id || !userType) {
      return res.status(401).json({ success: false, message: 'Session invalide' });
    }

    let updatedUser;
    if (userType === 'admin') {
      const payload = req.body || {};
      const updates = {
        ...normalizeAdminProfessionalMutationPayload(payload),
        ...normalizeAdminMutationPayload(payload)
      };
      const metaUpdates = normalizeAdminProfessionalMetaPayload(payload);
      if (Object.prototype.hasOwnProperty.call(payload, 'photo')) {
        const nextPhoto = normalizeNullableString(payload?.photo, ADMIN_FIELD_MAX_LENGTHS.photo);
        metaUpdates.photo = nextPhoto ? normalizePhotoPath(nextPhoto) : null;
      }

      if (Object.keys(updates).length > 0) {
        updatedUser = await adminModel.update(tokenUser.id, updates);
      } else {
        updatedUser = await adminModel.getById(tokenUser.id);
      }

      if (!updatedUser) {
        return res.status(404).json({ success: false, message: 'Profil administrateur introuvable' });
      }

      if (Object.keys(metaUpdates).length > 0) {
        await saveAdminProfileMeta(tokenUser.id, metaUpdates);
      }

      updatedUser = await mapAdminForApi(updatedUser);
    } else {
      const { data, extraUpdates } = normalizeEmployeMutationPayload(req.body || {}, {
        allowProfessional: hasProfessionalProfileEditAccess(req),
        allowRole: false
      });

      if (Object.keys(extraUpdates).length > 0) {
        const currentEmploye = await prisma.employe.findUnique({
          where: { id: tokenUser.id },
          select: { infosSup: true }
        });
        data.infosSup = mergeEmployeInfosSup(currentEmploye?.infosSup, extraUpdates);
      }

      const employe = await employeModel.update(tokenUser.id, data);
      if (!employe.matricule) {
        const generatedMatricule = await ensureEmployeMatriculeById(employe.id);
        if (generatedMatricule) {
          employe.matricule = generatedMatricule;
        }
      }
      updatedUser = mapEmployeForApi(employe);
    }

    res.json({
      success: true,
      message: 'Profil mis a jour',
      user: updatedUser
    });
  } catch (error) {
    const mappedError = mapPrismaMutationError(error);
    if (mappedError) {
      return res.status(mappedError.status).json({ success: false, message: mappedError.message });
    }
    console.error('Erreur auth/profile:', error);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

app.put('/api/auth/password', validateToken, async (req, res) => {
  try {
    const tokenUser = req.user?.user;
    const userType = String(req.user?.userType || '').trim().toLowerCase();
    const userId = Number(tokenUser?.id || 0);
    if (!userId || !['admin', 'employe'].includes(userType)) {
      return res.status(401).json({ success: false, message: 'Session invalide' });
    }

    const currentPassword = String(req.body?.current_password || req.body?.currentPassword || '').trim();
    const newPassword = String(req.body?.new_password || req.body?.newPassword || '').trim();
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Mot de passe actuel et nouveau mot de passe requis'
      });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Le nouveau mot de passe doit contenir au moins 8 caracteres'
      });
    }
    if (currentPassword === newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Le nouveau mot de passe doit etre different de l ancien'
      });
    }

    const dbUser =
      userType === 'admin'
        ? await adminModel.getById(userId)
        : await employeModel.getById(userId);

    if (!dbUser) {
      return res.status(404).json({ success: false, message: 'Utilisateur introuvable' });
    }

    const passwordHash = String(dbUser.password || '');
    const isCurrentPasswordValid = passwordHash
      ? await bcrypt.compare(currentPassword, passwordHash)
      : false;

    if (!isCurrentPasswordValid) {
      return res.status(400).json({
        success: false,
        message: 'Mot de passe actuel incorrect (saisissez votre mot de passe par defaut si vous ne l avez jamais change)'
      });
    }

    if (userType === 'admin') {
      await adminModel.update(userId, { password: newPassword });
    } else {
      await employeModel.update(userId, { password: newPassword });
    }

    return res.json({
      success: true,
      message: 'Mot de passe mis a jour avec succes'
    });
  } catch (error) {
    console.error('Erreur auth/password:', error);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

app.get('/api/settings/me', validateToken, async (req, res) => {
  try {
    const tokenUser = req.user?.user;
    const userType = String(req.user?.userType || '').trim().toLowerCase();
    const userId = Number(tokenUser?.id || 0);
    if (!userId || !['admin', 'employe'].includes(userType)) {
      return res.status(401).json({ success: false, message: 'Session invalide' });
    }

    const record = await prisma.parametreUtilisateur.findUnique({
      where: {
        userId_cle: {
          userId,
          cle: SETTINGS_STORAGE_KEY
        }
      }
    });

    const settings = record
      ? parseDashboardSettingsRecord(record.valeur)
      : {
          ...DEFAULT_DASHBOARD_SETTINGS,
          ...(userType === 'employe' && tokenUser?.rapportQuotidiens !== undefined
            ? { daily_reports: Boolean(tokenUser.rapportQuotidiens) }
            : {})
        };

    return res.json({ success: true, settings });
  } catch (error) {
    console.error('Erreur settings/me GET:', error);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

app.put('/api/settings/me', validateToken, async (req, res) => {
  try {
    const tokenUser = req.user?.user;
    const userType = String(req.user?.userType || '').trim().toLowerCase();
    const userId = Number(tokenUser?.id || 0);
    if (!userId || !['admin', 'employe'].includes(userType)) {
      return res.status(401).json({ success: false, message: 'Session invalide' });
    }

    const existingRecord = await prisma.parametreUtilisateur.findUnique({
      where: {
        userId_cle: {
          userId,
          cle: SETTINGS_STORAGE_KEY
        }
      }
    });
    const existingSettings = parseDashboardSettingsRecord(existingRecord?.valeur);
    const payloadSettingsRaw = req.body?.settings && typeof req.body.settings === 'object' && !Array.isArray(req.body.settings)
      ? req.body.settings
      : {};
    const payloadSettings = userType === 'admin'
      ? payloadSettingsRaw
      : Object.fromEntries(
        Object.entries(payloadSettingsRaw).filter(([key]) => !ADMIN_RUNTIME_SETTING_KEYS.has(key))
      );
    const nextSettings = normalizeDashboardSettings({
      ...existingSettings,
      ...payloadSettings
    });

    await prisma.parametreUtilisateur.upsert({
      where: {
        userId_cle: {
          userId,
          cle: SETTINGS_STORAGE_KEY
        }
      },
      create: {
        userId,
        userType,
        cle: SETTINGS_STORAGE_KEY,
        valeur: JSON.stringify(nextSettings),
        employeId: userType === 'employe' ? userId : null
      },
      update: {
        userType,
        valeur: JSON.stringify(nextSettings),
        employeId: userType === 'employe' ? userId : null
      }
    });

    if (userType === 'employe') {
      await prisma.employe.update({
        where: { id: userId },
        data: { rapportQuotidiens: Boolean(nextSettings.daily_reports) }
      });
    } else if (userType === 'admin') {
      runtimeSettingsCache = {
        value: { ...nextSettings },
        expiresAt: Date.now() + RUNTIME_SETTINGS_CACHE_TTL_MS
      };
    }

    return res.json({ success: true, settings: nextSettings });
  } catch (error) {
    console.error('Erreur settings/me PUT:', error);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

app.post('/api/admin/settings/purge', validateToken, requireSuperAdmin, async (req, res) => {
  try {
    const rawTargets = Array.isArray(req.body?.targets) ? req.body.targets : [];
    const normalizedTargets = rawTargets
      .map((entry) => String(entry || '').trim().toLowerCase())
      .filter(Boolean);

    const requested = new Set(normalizedTargets);
    const includeAll = requested.has('all');
    const purgeNotifications = includeAll || requested.has('notifications');
    const purgeDemandes = includeAll || requested.has('demandes');
    const purgePointages = includeAll || requested.has('pointages');
    const purgeEvenements = includeAll || requested.has('evenements') || requested.has('events');
    const purgeRetards = includeAll || requested.has('retards');
    const purgePauses = includeAll || requested.has('pauses');
    const purgeBadges = includeAll || requested.has('badges');
    const purgeAbsences = includeAll || requested.has('absences');
    const purgeConges = includeAll || requested.has('conges');
    const purgeLogs = includeAll || requested.has('logs');
    const purgeMessages = includeAll || requested.has('messages');
    const purgeQrCodes = includeAll || requested.has('qr_codes') || requested.has('qrcodes');

    if (
      !purgeNotifications
      && !purgeDemandes
      && !purgePointages
      && !purgeEvenements
      && !purgeRetards
      && !purgePauses
      && !purgeBadges
      && !purgeAbsences
      && !purgeConges
      && !purgeLogs
      && !purgeMessages
      && !purgeQrCodes
    ) {
      return res.status(400).json({ success: false, message: 'Aucune cible de purge valide.' });
    }

    const deleted = {
      notifications: 0,
      demandes: 0,
      demandes_badge: 0,
      retards: 0,
      pauses: 0,
      pointages: 0,
      evenements: 0,
      absences: 0,
      conges: 0,
      badge_scans: 0,
      badge_logs: 0,
      badge_journalier: 0,
      badge_tokens: 0,
      admin_logs: 0,
      messages: 0,
      message_destinataires: 0,
      qr_codes: 0
    };

    const countOf = (result) => Number(result?.count || 0);

    await prisma.$transaction(async (tx) => {
      if (purgeNotifications) {
        deleted.notifications += countOf(await tx.notification.deleteMany({}));
      } else if (purgePointages) {
        deleted.notifications += countOf(await tx.notification.deleteMany({
          where: {
            OR: [
              { pointageId: { not: null } },
              { type: { in: ['pointage', 'retard', 'absence'] } }
            ]
          }
        }));
      }

      if (purgeDemandes) {
        deleted.demandes_badge += countOf(await tx.demandeBadge.deleteMany({}));
        deleted.demandes += countOf(await tx.demande.deleteMany({}));
      }

      if (purgeRetards || purgePointages) {
        deleted.retards += countOf(await tx.retard.deleteMany({}));
      }

      if (purgePauses || purgePointages) {
        deleted.pauses += countOf(await tx.pause.deleteMany({}));
      }

      if (purgeAbsences || purgePointages) {
        deleted.absences += countOf(await tx.absence.deleteMany({}));
      }

      if (purgeConges) {
        deleted.conges += countOf(await tx.conge.deleteMany({}));
      }

      if (purgePointages) {
        deleted.pointages += countOf(await tx.pointage.deleteMany({}));
      }

      if (purgeEvenements) {
        deleted.evenements += countOf(await tx.evenement.deleteMany({}));
      }

      if (purgeBadges) {
        if (!purgePointages) {
          await tx.pointage.updateMany({
            where: { badgeTokenId: { not: null } },
            data: { badgeTokenId: null }
          });
        }
        deleted.badge_scans += countOf(await tx.badgeScan.deleteMany({}));
        deleted.badge_logs += countOf(await tx.badgeLog.deleteMany({}));
        deleted.badge_journalier += countOf(await tx.badge.deleteMany({}));
        deleted.badge_tokens += countOf(await tx.badgeToken.deleteMany({}));
      }

      if (purgeLogs) {
        deleted.admin_logs += countOf(await tx.adminLog.deleteMany({}));
      }

      if (purgeMessages) {
        deleted.message_destinataires += countOf(await tx.messageDestinataire.deleteMany({}));
        deleted.messages += countOf(await tx.message.deleteMany({}));
      }

      if (purgeQrCodes) {
        deleted.qr_codes += countOf(await tx.qrCode.deleteMany({}));
      }
    });

    return res.json({
      success: true,
      message: 'Purge admin terminee.',
      deleted
    });
  } catch (error) {
    console.error('Erreur admin/settings/purge:', error);
    const mapped = mapPrismaMutationError(error);
    if (mapped) {
      return res.status(mapped.status).json({ success: false, message: mapped.message });
    }
    return res.status(500).json({ success: false, message: 'Erreur serveur lors de la purge.' });
  }
});

// Admin endpoints
app.get('/api/roles', validateToken, requireSuperAdmin, async (req, res) => {
  const scope = String(req.query.scope || '').trim().toLowerCase();
  const roles = scope ? ROLE_CATALOG.filter((role) => role.scope === scope) : ROLE_CATALOG;
  res.json({
    success: true,
    roles
  });
});

app.get(['/api/admins', '/api/admin/admins'], validateToken, requireSuperAdmin, async (req, res) => {
  try {
    const admins = await prisma.admin.findMany({
      orderBy: { id: 'asc' }
    });
    const mappedAdmins = await Promise.all(admins.map((admin) => mapAdminForApi(admin)));
    res.json({ success: true, admins: mappedAdmins.filter(Boolean) });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

app.post(['/api/admins', '/api/admin/admins'], validateToken, requireSuperAdmin, async (req, res) => {
  try {
    const payload = req.body || {};
    const personalUpdates = normalizeAdminMutationPayload(payload);
    const professionalUpdates = normalizeAdminProfessionalMutationPayload(payload);
    const metaUpdates = normalizeAdminProfessionalMetaPayload(payload);

    if (Object.prototype.hasOwnProperty.call(payload, 'photo')) {
      const nextPhoto = normalizeNullableString(payload?.photo, ADMIN_FIELD_MAX_LENGTHS.photo);
      metaUpdates.photo = nextPhoto ? normalizePhotoPath(nextPhoto) : null;
    }

    const nom = String(personalUpdates.nom || payload.nom || '').trim();
    const prenom = String(personalUpdates.prenom || payload.prenom || '').trim();
    const email = String(professionalUpdates.email || payload.email || '').trim().toLowerCase();
    const role = String(professionalUpdates.role || payload.role || 'admin').trim().toLowerCase();
    const statut = normalizeAccountStatus(professionalUpdates.statut || payload.statut || ACTIVE_ACCOUNT_STATUS);
    
    // Mot de passe par défaut selon le rôle
    let defaultPassword = 'admin123';
    if (role === 'super_admin') {
      defaultPassword = 'admin123';
    } else if (role === 'admin') {
      defaultPassword = 'admin123';
    } else if (role === 'manager' || role === 'hr') {
      defaultPassword = 'admin123';
    }
    
    const password = String(payload.password || '').trim() || defaultPassword;
    const shouldSendCredentialsEmail = normalizeBooleanSetting(payload.sendEmail, true);
    const credentialsEmail = { attempted: false, sent: false, error: null };

    if (!nom || !prenom || !email) {
      return res.status(400).json({
        success: false,
        message: 'Nom, prenom et email sont obligatoires pour creer un admin'
      });
    }

    if (!['admin', 'super_admin'].includes(role)) {
      return res.status(400).json({ success: false, message: 'Role admin invalide' });
    }

    const emailConflict = await prisma.admin.findUnique({
      where: { email },
      select: { id: true }
    });
    if (emailConflict) {
      return res.status(409).json({ success: false, message: 'Email deja utilise' });
    }

    const creatorId = Number(req.user?.user?.id || 0);
    const createdAdmin = await adminModel.create({
      nom,
      prenom,
      email,
      password,
      role,
      statut: statut === ACTIVE_ACCOUNT_STATUS ? 'actif' : 'inactif',
      telephone: personalUpdates.telephone ?? null,
      adresse: personalUpdates.adresse ?? null,
      departement: professionalUpdates.departement ?? null,
      poste: professionalUpdates.poste ?? null,
      badgeId: professionalUpdates.badgeId ?? null,
      badgeActif: true,
      createdBy: Number.isInteger(creatorId) && creatorId > 0 ? creatorId : null
    });

    if (Object.keys(metaUpdates).length > 0) {
      await saveAdminProfileMeta(createdAdmin.id, metaUpdates);
    }

    const badgeToken = await regenerateBadgeToken({
      employeId: null,
      adminId: createdAdmin.id,
      requestedBy: req.user?.user?.id,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      reason: 'admin-create'
    });

    const mappedAdmin = await mapAdminForApi(createdAdmin);
    if (shouldSendCredentialsEmail) {
      credentialsEmail.attempted = true;
      try {
        await sendCredentialsEmail({
          to: email,
          recipientName: `${prenom} ${nom}`.trim(),
          loginEmail: email,
          password,
          roleLabel: role
        });
        credentialsEmail.sent = true;
      } catch (mailError) {
        console.error('Erreur envoi email identifiants admin:', mailError);
        credentialsEmail.error = String(mailError?.message || mailError);
      }
    }
    return res.status(201).json({
      success: true,
      message: 'Administrateur cree avec badge associe',
      admin: mappedAdmin,
      badge: mapBadgeTokenForUi(badgeToken),
      credentials_email: credentialsEmail
    });
  } catch (error) {
    console.error('Erreur admins create:', error);
    const mapped = mapPrismaMutationError(error);
    if (mapped) {
      return res.status(mapped.status).json({ success: false, message: mapped.message });
    }
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

app.get(['/api/admins/:id', '/api/admin/admins/:id'], validateToken, requireSuperAdmin, async (req, res) => {
  try {
    const adminId = Number(req.params.id);
    if (!Number.isInteger(adminId) || adminId <= 0) {
      return res.status(400).json({ success: false, message: 'Identifiant admin invalide' });
    }

    const admin = await prisma.admin.findUnique({ where: { id: adminId } });
    if (!admin) {
      return res.status(404).json({ success: false, message: 'Administrateur introuvable' });
    }

    const [mappedAdmin, totalPointages] = await Promise.all([
      mapAdminForApi(admin),
      prisma.pointage.count({ where: { adminId } })
    ]);

    return res.json({
      success: true,
      admin: {
        ...(mappedAdmin || {}),
        date_embauche: mappedAdmin?.date_embauche || normalizeDateOnlyString(admin.dateCreation) || null,
        dernier_connexion: admin.lastActivity || null,
        total_pointages: Number(totalPointages || 0),
        total_heures: 0
      }
    });
  } catch (error) {
    console.error('Erreur admins/:id:', error);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

app.put(['/api/admins/:id', '/api/admin/admins/:id'], validateToken, requireSuperAdmin, async (req, res) => {
  try {
    const adminId = Number(req.params.id);
    if (!Number.isInteger(adminId) || adminId <= 0) {
      return res.status(400).json({ success: false, message: 'Identifiant admin invalide' });
    }

    const existingAdmin = await prisma.admin.findUnique({ where: { id: adminId } });
    if (!existingAdmin) {
      return res.status(404).json({ success: false, message: 'Administrateur introuvable' });
    }

    const personalUpdates = normalizeAdminMutationPayload(req.body || {});
    const professionalUpdates = normalizeAdminProfessionalMutationPayload(req.body || {});
    const metaUpdates = normalizeAdminProfessionalMetaPayload(req.body || {});
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'photo')) {
      const nextPhoto = normalizeNullableString(req.body?.photo, ADMIN_FIELD_MAX_LENGTHS.photo);
      metaUpdates.photo = nextPhoto ? normalizePhotoPath(nextPhoto) : null;
    }
    const updates = {
      ...personalUpdates,
      ...professionalUpdates
    };

    if (updates.email) {
      const emailConflict = await prisma.admin.findFirst({
        where: {
          email: updates.email,
          id: { not: adminId }
        },
        select: { id: true }
      });
      if (emailConflict) {
        return res.status(409).json({ success: false, message: 'Email deja utilise' });
      }
    }

    if (updates.role === 'super_admin') {
      const actorRole = normalizeRole(req.user?.user?.role);
      if (actorRole !== 'super_admin') {
        return res.status(403).json({ success: false, message: 'Seul un super admin peut attribuer ce role' });
      }
    }

    if (Object.keys(updates).length === 0 && Object.keys(metaUpdates).length === 0) {
      const mappedAdmin = await mapAdminForApi(existingAdmin);
      return res.json({ success: true, admin: mappedAdmin });
    }

    let updatedAdmin = existingAdmin;
    if (Object.keys(updates).length > 0) {
      updatedAdmin = await prisma.admin.update({
        where: { id: adminId },
        data: updates
      });
    }

    if (Object.keys(metaUpdates).length > 0) {
      await saveAdminProfileMeta(adminId, metaUpdates);
    }

    const mappedAdmin = await mapAdminForApi(updatedAdmin);

    return res.json({
      success: true,
      admin: mappedAdmin
    });
  } catch (error) {
    console.error('Erreur admins/:id update:', error);
    const mapped = mapPrismaMutationError(error);
    if (mapped) {
      return res.status(mapped.status).json({ success: false, message: mapped.message });
    }
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

app.delete(['/api/admins/:id', '/api/admin/admins/:id'], validateToken, requireSuperAdmin, async (req, res) => {
  try {
    const adminId = Number(req.params.id);
    if (!Number.isInteger(adminId) || adminId <= 0) {
      return res.status(400).json({ success: false, message: 'Identifiant admin invalide' });
    }

    const requesterId = Number(req.user?.user?.id || 0);
    if (requesterId === adminId) {
      return res.status(400).json({ success: false, message: 'Suppression de votre propre compte impossible' });
    }

    const existingAdmin = await prisma.admin.findUnique({
      where: { id: adminId },
      select: { id: true, role: true }
    });
    if (!existingAdmin) {
      return res.status(404).json({ success: false, message: 'Administrateur introuvable' });
    }

    const actorRole = normalizeRole(req.user?.user?.role);
    if (String(existingAdmin.role || '').toLowerCase() === 'super_admin' && actorRole !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Seul un super admin peut supprimer ce compte' });
    }

    await prisma.admin.delete({ where: { id: adminId } });
    return res.json({ success: true });
  } catch (error) {
    console.error('Erreur admins/:id delete:', error);
    const mapped = mapPrismaMutationError(error);
    if (mapped) {
      return res.status(mapped.status).json({ success: false, message: mapped.message });
    }
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// Structured admin endpoints used by the React migration
app.get('/api/admin/employes/departements', validateToken, requireRoleManagementAccess, async (req, res) => {
  try {
    const deps = await prisma.employe.findMany({
      where: { departement: { not: null } },
      distinct: ['departement'],
      select: { departement: true },
      orderBy: { departement: 'asc' }
    });
    res.json(deps.map((d) => d.departement).filter(Boolean));
  } catch (error) {
    console.error('Erreur admin/employes/departements:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

app.get('/api/admin/employes/postes', validateToken, requireRoleManagementAccess, async (req, res) => {
  try {
    const departement = String(req.query.departement || '').trim();
    const where = {
      poste: { not: null },
      ...(departement ? { departement } : {})
    };

    const postes = await prisma.employe.findMany({
      where,
      distinct: ['poste'],
      select: { poste: true },
      orderBy: { poste: 'asc' }
    });

    res.json(postes.map((p) => p.poste).filter(Boolean));
  } catch (error) {
    console.error('Erreur admin/employes/postes:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

app.get('/api/admin/employes/validate-email', validateToken, requireRoleManagementAccess, async (req, res) => {
  try {
    const email = String(req.query.email || '').trim();
    const excludeId = parseInt(req.query.exclude_id, 10);
    if (!email) {
      return res.status(400).json({ is_valid: false, message: 'Email requis' });
    }

    const found = await prisma.employe.findUnique({ where: { email } });
    const isValid = !found || (Number.isInteger(excludeId) && found.id === excludeId);
    res.json({
      is_valid: isValid,
      message: isValid ? undefined : 'Email déjà utilisé'
    });
  } catch (error) {
    console.error('Erreur admin/employes/validate-email:', error);
    res.status(500).json({ is_valid: false, message: 'Erreur serveur' });
  }
});

app.get('/api/admin/employes/identifier-preview', validateToken, requireRoleManagementAccess, async (req, res) => {
  try {
    const requestedRole = String(req.query.role || 'employe').trim();
    const preview = await getNextEmployeIdentifierPreview(requestedRole);
    return res.json({
      success: true,
      id: preview.id,
      matricule: preview.matricule
    });
  } catch (error) {
    console.error('Erreur admin/employes/identifier-preview:', error);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

app.get('/api/admin/employes', validateToken, requireRoleManagementAccess, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const perPage = Math.max(1, parseInt(req.query.per_page, 10) || 10);
    const search = String(req.query.search || '').trim();
    const departement = String(req.query.departement || '').trim();
    const statut = String(req.query.statut || '').trim();
    const role = String(req.query.role || '').trim();

    const roleFilter = resolveRequestedRoleFilter(role);
    if (roleFilter.invalidRole) {
      return res.json({
        items: [],
        total: 0,
        total_pages: 1,
        current_page: page,
        per_page: perPage
      });
    }

    const where = {
      ...(departement ? { departement } : {}),
      ...(statut ? { statut } : {}),
      ...(roleFilter.hasRoleFilter && roleFilter.persistedRole ? { role: roleFilter.persistedRole } : {})
    };

    const dbItems = await prisma.employe.findMany({
      where,
      orderBy: [{ prenom: 'asc' }, { nom: 'asc' }],
      take: 5000
    });

    let mappedItems = dbItems.map(mapEmployeForApi).filter(Boolean);

    if (roleFilter.hasRoleFilter) {
      mappedItems = mappedItems.filter((item) => normalizeRole(item.role) === roleFilter.normalizedRole);
    }

    if (search) {
      const searchLower = search.toLowerCase();
      mappedItems = mappedItems.filter((item) => {
        return (
          String(item.nom || '').toLowerCase().includes(searchLower)
          || String(item.prenom || '').toLowerCase().includes(searchLower)
          || String(item.email || '').toLowerCase().includes(searchLower)
          || String(item.departement || '').toLowerCase().includes(searchLower)
          || String(item.poste || '').toLowerCase().includes(searchLower)
          || String(item.role || '').toLowerCase().includes(searchLower)
          || String(item.matricule || '').toLowerCase().includes(searchLower)
        );
      });
    }

    const total = mappedItems.length;
    const startIndex = (page - 1) * perPage;
    const items = mappedItems.slice(startIndex, startIndex + perPage);

    return res.json({
      items,
      total,
      total_pages: Math.max(1, Math.ceil(total / perPage)),
      current_page: page,
      per_page: perPage
    });
  } catch (error) {
    console.error('Erreur admin/employes:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

app.post('/api/admin/employes', validateToken, requireRoleManagementAccess, async (req, res) => {
  try {
    const shouldSendCredentialsEmail = normalizeBooleanSetting(req.body?.sendEmail, true);
    const credentialsEmail = { attempted: false, sent: false, error: null };
    const normalizedPayload = normalizeEmployeMutationPayload(req.body || {}, {
      allowProfessional: true,
      allowRole: true
    });
    const data = normalizedPayload.data;
    let extraUpdates = normalizedPayload.extraUpdates;

    if (data.role !== undefined) {
      if (!isAllowedEmployeRole(data.role)) {
        return res.status(400).json({ success: false, message: 'Role non valide' });
      }
      extraUpdates = applyEmployeRolePersistence(data, extraUpdates);
    }

    if (Object.keys(extraUpdates).length > 0) {
      data.infosSup = mergeEmployeInfosSup(null, extraUpdates);
    }

    if (!data.password) {
      // Mot de passe par défaut pour les employés
      data.password = 'employe123';
    }
    const plainPassword = String(data.password || '').trim();

    const created = await employeModel.create(data);
    if (!created.matricule) {
      const generatedMatricule = await ensureEmployeMatriculeById(created.id);
      if (generatedMatricule) {
        created.matricule = generatedMatricule;
      }
    }
    if (shouldSendCredentialsEmail) {
      credentialsEmail.attempted = true;
      try {
        await sendCredentialsEmail({
          to: String(data.email || '').trim(),
          recipientName: `${String(data.prenom || '').trim()} ${String(data.nom || '').trim()}`.trim(),
          loginEmail: String(data.email || '').trim(),
          password: plainPassword,
          roleLabel: String(data.role || 'employe').trim()
        });
        credentialsEmail.sent = true;
      } catch (mailError) {
        console.error('Erreur envoi email identifiants employe:', mailError);
        credentialsEmail.error = String(mailError?.message || mailError);
      }
    }
    res.status(201).json({
      ...(mapEmployeForApi(created) || {}),
      credentials_email: credentialsEmail
    });
  } catch (error) {
    const mappedError = mapPrismaMutationError(error);
    if (mappedError) {
      return res.status(mappedError.status).json({ success: false, message: mappedError.message });
    }
    console.error('Erreur admin/employes POST:', error);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

app.get('/api/admin/employes/:id', validateToken, requireRoleManagementAccess, async (req, res) => {
  try {
    const employe = await employeModel.getById(req.params.id);
    if (!employe) {
      return res.status(404).json({ success: false, message: 'Employé non trouvé' });
    }
    res.json(mapEmployeForApi(employe));
  } catch (error) {
    console.error('Erreur admin/employes/:id GET:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

app.put('/api/admin/employes/:id', validateToken, requireRoleManagementAccess, async (req, res) => {
  try {
    const normalizedPayload = normalizeEmployeMutationPayload(req.body || {}, {
      allowProfessional: true,
      allowRole: true
    });
    const data = normalizedPayload.data;
    let extraUpdates = normalizedPayload.extraUpdates;

    if (data.role !== undefined && data.role !== null) {
      if (!isAllowedEmployeRole(data.role)) {
        return res.status(400).json({ success: false, message: 'Role non valide' });
      }
      extraUpdates = applyEmployeRolePersistence(data, extraUpdates);
    }

    if (Object.keys(extraUpdates).length > 0) {
      const currentEmploye = await prisma.employe.findUnique({
        where: { id: parseInt(req.params.id, 10) },
        select: { infosSup: true }
      });
      data.infosSup = mergeEmployeInfosSup(currentEmploye?.infosSup, extraUpdates);
    }

    const updated = await employeModel.update(req.params.id, data);
    if (!updated.matricule) {
      const generatedMatricule = await ensureEmployeMatriculeById(updated.id);
      if (generatedMatricule) {
        updated.matricule = generatedMatricule;
      }
    }
    res.json(mapEmployeForApi(updated));
  } catch (error) {
    const mappedError = mapPrismaMutationError(error);
    if (mappedError) {
      return res.status(mappedError.status).json({ success: false, message: mappedError.message });
    }
    console.error('Erreur admin/employes/:id PUT:', error);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

app.delete('/api/admin/employes/:id', validateToken, requireRoleManagementAccess, async (req, res) => {
  try {
    await employeModel.delete(req.params.id);
    res.status(204).send();
  } catch (error) {
    console.error('Erreur admin/employes/:id DELETE:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// Compatibility: paged employes and admins for frontend
app.get('/api/get_employes', validateToken, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const perPage = Math.max(1, parseInt(req.query.per_page, 10) || 10);
    const role = String(req.query.role || '').trim();
    const statut = String(req.query.statut || '').trim();
    const departement = String(req.query.departement || '').trim();
    const search = String(req.query.search || '').trim();

    const roleFilter = resolveRequestedRoleFilter(role);
    if (roleFilter.invalidRole) {
      return res.json({
        success: true,
        employes: [],
        total: 0,
        current_page: page,
        per_page: perPage,
        total_pages: 1
      });
    }

    const where = {
      ...(statut ? { statut } : {}),
      ...(departement ? { departement } : {}),
      ...(roleFilter.hasRoleFilter && roleFilter.persistedRole ? { role: roleFilter.persistedRole } : {})
    };

    const dbItems = await employeModel.prisma.employe.findMany({
      where,
      orderBy: [{ prenom: 'asc' }, { nom: 'asc' }],
      take: 5000
    });

    let mappedItems = dbItems.map(mapEmployeForApi).filter(Boolean);

    if (roleFilter.hasRoleFilter) {
      mappedItems = mappedItems.filter((item) => normalizeRole(item.role) === roleFilter.normalizedRole);
    }

    if (search) {
      const searchLower = search.toLowerCase();
      mappedItems = mappedItems.filter((item) => {
        return (
          String(item.nom || '').toLowerCase().includes(searchLower)
          || String(item.prenom || '').toLowerCase().includes(searchLower)
          || String(item.email || '').toLowerCase().includes(searchLower)
          || String(item.departement || '').toLowerCase().includes(searchLower)
          || String(item.poste || '').toLowerCase().includes(searchLower)
          || String(item.role || '').toLowerCase().includes(searchLower)
          || String(item.matricule || '').toLowerCase().includes(searchLower)
        );
      });
    }

    const total = mappedItems.length;
    const startIndex = (page - 1) * perPage;
    const employes = mappedItems.slice(startIndex, startIndex + perPage);

    return res.json({
      success: true,
      employes,
      total,
      current_page: page,
      per_page: perPage,
      total_pages: Math.max(1, Math.ceil(total / perPage))
    });
  } catch (error) {
    console.error('Erreur get_employes:', error);
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

app.get('/api/get_admins', validateToken, requireSuperAdmin, async (req, res) => {
  try {
    const admins = await adminModel.getAll();
    const mappedAdmins = await Promise.all(admins.map((admin) => mapAdminForApi(admin)));
    res.json({ success: true, admins: mappedAdmins.filter(Boolean) });
  } catch (error) {
    console.error('Erreur get_admins:', error);
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

// Employe endpoints
app.get('/api/employes', validateToken, async (req, res) => {
  try {
    const role = String(req.query.role || '').trim();
    const statut = String(req.query.statut || '').trim();
    const search = String(req.query.search || '').trim();

    const roleFilter = resolveRequestedRoleFilter(role);
    if (roleFilter.invalidRole) {
      return res.json({ success: true, employes: [] });
    }

    const where = {
      ...(statut ? { statut } : {}),
      ...(roleFilter.hasRoleFilter && roleFilter.persistedRole ? { role: roleFilter.persistedRole } : {})
    };

    const dbItems = await employeModel.getAll(where);
    let employes = dbItems.map(mapEmployeForApi).filter(Boolean);

    if (roleFilter.hasRoleFilter) {
      employes = employes.filter((item) => normalizeRole(item.role) === roleFilter.normalizedRole);
    }

    if (search) {
      const searchLower = search.toLowerCase();
      employes = employes.filter((item) => {
        return (
          String(item.nom || '').toLowerCase().includes(searchLower)
          || String(item.prenom || '').toLowerCase().includes(searchLower)
          || String(item.email || '').toLowerCase().includes(searchLower)
          || String(item.departement || '').toLowerCase().includes(searchLower)
          || String(item.poste || '').toLowerCase().includes(searchLower)
          || String(item.role || '').toLowerCase().includes(searchLower)
          || String(item.matricule || '').toLowerCase().includes(searchLower)
        );
      });
    }

    return res.json({ success: true, employes });
  } catch (error) {
    console.error('Erreur GET /api/employes:', error);
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

app.post('/api/employes', validateToken, requireRoleManagementAccess, async (req, res) => {
  try {
    const shouldSendCredentialsEmail = normalizeBooleanSetting(req.body?.sendEmail, true);
    const credentialsEmail = { attempted: false, sent: false, error: null };
    const normalizedPayload = normalizeEmployeMutationPayload(req.body || {}, {
      allowProfessional: true,
      allowRole: true
    });
    const data = normalizedPayload.data;
    let extraUpdates = normalizedPayload.extraUpdates;

    if (data.role !== undefined) {
      if (!isAllowedEmployeRole(data.role)) {
        return res.status(400).json({ success: false, message: 'Role non valide' });
      }
      extraUpdates = applyEmployeRolePersistence(data, extraUpdates);
    }

    if (Object.keys(extraUpdates).length > 0) {
      data.infosSup = mergeEmployeInfosSup(null, extraUpdates);
    }

    if (!data.password) data.password = 'XpertPro2026';
    const plainPassword = String(data.password || '').trim();
    const employe = await employeModel.create(data);
    if (!employe.matricule) {
      const generatedMatricule = await ensureEmployeMatriculeById(employe.id);
      if (generatedMatricule) {
        employe.matricule = generatedMatricule;
      }
    }
    if (shouldSendCredentialsEmail) {
      credentialsEmail.attempted = true;
      try {
        await sendCredentialsEmail({
          to: String(data.email || '').trim(),
          recipientName: `${String(data.prenom || '').trim()} ${String(data.nom || '').trim()}`.trim(),
          loginEmail: String(data.email || '').trim(),
          password: plainPassword,
          roleLabel: String(data.role || 'employe').trim()
        });
        credentialsEmail.sent = true;
      } catch (mailError) {
        console.error('Erreur envoi email identifiants employe:', mailError);
        credentialsEmail.error = String(mailError?.message || mailError);
      }
    }
    res.status(201).json({ success: true, employe: mapEmployeForApi(employe), credentials_email: credentialsEmail });
  } catch (error) {
    const mappedError = mapPrismaMutationError(error);
    if (mappedError) {
      return res.status(mappedError.status).json({ success: false, message: mappedError.message });
    }
    console.error('Erreur POST /api/employes:', error);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

app.get('/api/employes/:id', validateToken, async (req, res) => {
  try {
    const employe = await employeModel.getById(req.params.id);
    if (!employe) {
      return res.status(404).json({ success: false, message: 'Employé non trouvé' });
    }
    res.json({ success: true, employe: mapEmployeForApi(employe) });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

app.put('/api/employes/:id', validateToken, requireRoleManagementAccess, async (req, res) => {
  try {
    const normalizedPayload = normalizeEmployeMutationPayload(req.body || {}, {
      allowProfessional: true,
      allowRole: true
    });
    const data = normalizedPayload.data;
    let extraUpdates = normalizedPayload.extraUpdates;

    if (data.role !== undefined && data.role !== null) {
      if (!isAllowedEmployeRole(data.role)) {
        return res.status(400).json({ success: false, message: 'Role non valide' });
      }
      extraUpdates = applyEmployeRolePersistence(data, extraUpdates);
    }

    if (Object.keys(extraUpdates).length > 0) {
      const currentEmploye = await prisma.employe.findUnique({
        where: { id: parseInt(req.params.id, 10) },
        select: { infosSup: true }
      });
      data.infosSup = mergeEmployeInfosSup(currentEmploye?.infosSup, extraUpdates);
    }

    const employe = await employeModel.update(req.params.id, data);
    if (!employe.matricule) {
      const generatedMatricule = await ensureEmployeMatriculeById(employe.id);
      if (generatedMatricule) {
        employe.matricule = generatedMatricule;
      }
    }
    res.json({ success: true, employe: mapEmployeForApi(employe) });
  } catch (error) {
    const mappedError = mapPrismaMutationError(error);
    if (mappedError) {
      return res.status(mappedError.status).json({ success: false, message: mappedError.message });
    }
    console.error('Erreur PUT /api/employes/:id:', error);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

app.delete('/api/employes/:id', validateToken, requireRoleManagementAccess, async (req, res) => {
  try {
    await employeModel.delete(req.params.id);
    res.json({ success: true, message: 'Employé supprimé' });
  } catch (error) {
    console.error('Erreur DELETE /api/employes/:id:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// Pointage endpoints
app.get('/api/pointages/latest', validateToken, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const where = req.user?.userType === 'employe'
      ? { employeId: req.user.user.id, type: { in: ['arrivee', 'depart'] } }
      : { type: { in: ['arrivee', 'depart'] } };
    const pointages = await prisma.pointage.findMany({
      where,
      include: { employe: true },
      take: limit,
      orderBy: { dateHeure: 'desc' }
    });
    res.json({ success: true, pointages });
  } catch (error) {
    console.error('Erreur pointages/latest:', error);
    res.status(500).json({ success: false, message: 'Erreur lors de la récupération des pointages' });
  }
});

// Compatibility endpoints for frontend
app.get('/api/get_departements', validateToken, async (req, res) => {
  try {
    const deps = await employeModel.prisma.employe.findMany({
      where: { departement: { not: null } },
      distinct: ['departement'],
      select: { departement: true }
    });
    const list = deps.map(d => d.departement).filter(Boolean);
    res.json(list);
  } catch (error) {
    console.error('Erreur get_departements:', error);
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

// Endpoint pour le départ automatique
app.post('/api/pointages/auto-depart', validateToken, async (req, res) => {
  try {
    const { user_id, user_type, date, heure, auto_generated, reason } = req.body;
    
    if (!user_id || !user_type || !date || !heure) {
      return res.status(400).json({ success: false, message: 'Paramètres requis manquants' });
    }

    // Vérifier si un départ existe déjà pour cet utilisateur/date
    const existingDepart = await prisma.pointage.findFirst({
      where: {
        dateHeure: {
          gte: new Date(`${date}T00:00:00`),
          lte: new Date(`${date}T23:59:59`)
        },
        type: 'depart',
        ...(user_type === 'admin' ? { adminId: user_id } : { employeId: user_id })
      }
    });

    if (existingDepart) {
      return res.status(400).json({ success: false, message: 'Un départ existe déjà pour cette date' });
    }

    // Créer le pointage de départ automatique
    const [hours, minutes] = heure.split(':').map(Number);
    const departDateTime = new Date(`${date}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`);

    const pointageData = {
      dateHeure: departDateTime,
      type: 'depart',
      statut: 'normal',
      commentaire: reason || 'Départ automatique généré par le système',
      source: 'auto_generate',
      ...(user_type === 'admin' ? { adminId: user_id } : { employeId: user_id })
    };

    const newPointage = await prisma.pointage.create({
      data: pointageData
    });

    res.json({ 
      success: true, 
      message: 'Départ automatique enregistré avec succès',
      pointage: {
        id: newPointage.id,
        date: date,
        heure: heure,
        type: 'depart',
        auto_generated: true
      }
    });

  } catch (error) {
    console.error('Erreur lors de la création du départ automatique:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

 // Modèles Prisma pour la gestion des appareils et sessions
 const scanDevice = prisma.scanDevice
 const scanSession = prisma.scanSession
 const DEFAULT_SCAN_PIN = '1234'

// Endpoint pour vérifier si un appareil est enregistré
app.post('/api/scan/device/check', validateToken, async (req, res) => {
  try {
    const { fingerprint, userAgent } = req.body;
    
    if (!fingerprint || !userAgent) {
      return res.status(400).json({ success: false, message: 'Fingerprint et userAgent requis' });
    }

    const existingDevice = await scanDevice.findFirst({
      where: {
        fingerprint,
        userAgent
      }
    });

    res.json({
      success: true,
      registered: !!existingDevice,
      device: existingDevice
    });
  } catch (error) {
    console.error('Erreur lors de la vérification de l\'appareil:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// Endpoint pour enregistrer un nouvel appareil
 app.post('/api/scan/device/register', validateToken, async (req, res) => {
  try {
    const { fingerprint, userAgent, platform, type, name } = req.body;
    const tokenPayload = req.user || {};
    const tokenUserType = String(tokenPayload.userType || '').trim().toLowerCase();
    const admin = tokenPayload.user || tokenPayload;
    const adminId = Number(admin?.id || 0);
    
    if (tokenUserType && tokenUserType !== 'admin') {
      return res.status(403).json({ success: false, message: 'Acces reserve aux administrateurs' });
    }

    if (!fingerprint || !userAgent || !Number.isInteger(adminId) || adminId <= 0) {
      return res.status(400).json({ success: false, message: 'Informations requises manquantes' });
    }

    // Vérifier si l'appareil existe déjà
    const existingDevice = await scanDevice.findFirst({
      where: { fingerprint, adminId }
    });

    if (existingDevice) {
      return res.json({
        success: true,
        device: existingDevice,
        message: 'Appareil déjà enregistré'
      });
    }

    // Créer le nouvel appareil
    const newDevice = await scanDevice.create({
      data: {
        fingerprint,
        userAgent,
        platform: platform || 'unknown',
        type: type || 'unknown',
        name: name || 'Appareil inconnu',
        adminId,
        trusted: false,
        lastSeen: new Date()
      }
    });

    res.json({
      success: true,
      device: newDevice,
      message: 'Appareil enregistré avec succès'
    });
  } catch (error) {
    console.error('Erreur lors de l\'enregistrement de l\'appareil:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// Endpoint pour demander le déverrouillage
app.post('/api/scan/unlock/request', validateToken, async (req, res) => {
  try {
    const { method, value, deviceInfo, timestamp, deviceName } = req.body || {};
    const rawDuration = req.body?.duration ?? req.body?.duration_minutes ?? 60;

    const tokenPayload = req.user || {};
    const tokenUserType = String(tokenPayload.userType || '').trim().toLowerCase();
    const admin = tokenPayload.user || tokenPayload;
    const adminId = Number(admin?.id || 0);

    if (tokenUserType && tokenUserType !== 'admin') {
      return res.status(403).json({ success: false, message: 'Acces reserve aux administrateurs' });
    }

    if (!Number.isInteger(adminId) || adminId <= 0) {
      return res.status(401).json({ success: false, message: 'Session invalide' });
    }

    const normalizedMethod = String(method || '').trim().toLowerCase() || 'pin';
    const unlockValue = String(value || '').trim();
    const durationMinutesRaw = Number.parseInt(String(rawDuration ?? 60).trim(), 10);
    const durationMinutes = Number.isInteger(durationMinutesRaw)
      ? Math.max(5, Math.min(durationMinutesRaw, 8 * 60))
      : 60;

    const effectiveDeviceInfo = deviceInfo && typeof deviceInfo === 'object' ? deviceInfo : null;
    if (!effectiveDeviceInfo) {
      return res.status(400).json({ success: false, message: 'Informations requises manquantes' });
    }

    // Autoriser super_admin sans PIN si méthode admin_override
    const role = normalizeRole(admin?.role);
    if (normalizedMethod === 'admin_override') {
      if (role !== 'super_admin') {
        return res.status(403).json({ success: false, message: 'Acces reserve au super_admin' });
      }
    } else if (!unlockValue) {
      return res.status(400).json({ success: false, message: 'Informations requises manquantes' });
    }

    let isValid = false;

    switch (normalizedMethod) {
      case 'admin_override':
        isValid = role === 'super_admin';
        break;

      case 'pin': {
        if (!/^[0-9]{4}$/.test(unlockValue)) {
          isValid = false;
          break;
        }

        const pinParam = await prisma.parametreUtilisateur.findFirst({
          where: {
            userId: adminId,
            userType: 'admin',
            cle: 'scan_pin_code'
          }
        });

        if (!pinParam?.valeur) {
          isValid = unlockValue === DEFAULT_SCAN_PIN;
          break;
        }

        const bcrypt = require('bcrypt');
        isValid = await bcrypt.compare(unlockValue, String(pinParam.valeur || ''));
        break;
      }

      case 'token': {
        const tokenParam = await prisma.parametreUtilisateur.findFirst({
          where: {
            userId: adminId,
            userType: 'admin',
            cle: 'scan_unlock_token'
          }
        });
        isValid = Boolean(tokenParam?.valeur) && unlockValue === String(tokenParam.valeur || '');
        break;
      }

      case 'ip':
        // À affiner si besoin: pour l'instant on autorise.
        isValid = true;
        break;

      case 'mac':
        // À affiner si besoin: pour l'instant on autorise.
        isValid = true;
        break;

      default:
        return res.status(400).json({ success: false, message: 'Méthode de déverrouillage non supportée' });
    }

    if (!isValid) {
      return res.status(403).json({ success: false, message: 'Code pin incorrect déverrouillage non autorisé' });
    }

    const fingerprintSeed = String(effectiveDeviceInfo?.fingerprint || effectiveDeviceInfo?.id || '').trim()
      || `device-${Math.random().toString(36).slice(2)}-${Date.now()}`;
    const fingerprint = `${adminId}:${fingerprintSeed}`;
    const expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000);

    let sessionPayload = null;

    // La persistance en base est optionnelle (certaines instances n'ont pas encore les tables de scan).
    try {
      const deviceRecord = await scanDevice.upsert({
        where: {
          fingerprint_method: {
            fingerprint,
            method: 'fingerprint'
          }
        },
        update: {
          lastSeen: new Date(),
          userAgent: String(effectiveDeviceInfo?.userAgent || req.get('user-agent') || '') || null,
          platform: String(effectiveDeviceInfo?.platform || '') || null,
          type: String(effectiveDeviceInfo?.type || 'web'),
          name: String(deviceName || effectiveDeviceInfo?.name || 'Appareil Web'),
          adminId
        },
        create: {
          fingerprint,
          method: 'fingerprint',
          userAgent: String(effectiveDeviceInfo?.userAgent || req.get('user-agent') || '') || null,
          platform: String(effectiveDeviceInfo?.platform || '') || null,
          type: String(effectiveDeviceInfo?.type || 'web'),
          name: String(deviceName || effectiveDeviceInfo?.name || 'Appareil Web'),
          adminId,
          trusted: false,
          lastSeen: new Date()
        }
      });

      const session = await scanSession.create({
        data: {
          deviceId: deviceRecord.id,
          adminId,
          adminName: `${String(admin?.prenom || '').trim()} ${String(admin?.nom || '').trim()}`.trim() || 'Admin',
          method: normalizedMethod,
          deviceInfo: JSON.stringify({
            ...(effectiveDeviceInfo || {}),
            deviceName: deviceName || effectiveDeviceInfo?.name || null,
            requestedAt: timestamp || new Date().toISOString()
          }),
          expiresAt,
          active: true
        }
      });

      sessionPayload = {
        id: session.id,
        expiresAt: session.expiresAt.toISOString(),
        method: session.method
      };
    } catch (dbError) {
      console.error('Erreur persistance session scan (fallback local):', dbError);
      sessionPayload = {
        id: `local_scan_${Date.now()}`,
        expiresAt: expiresAt.toISOString(),
        method: normalizedMethod
      };
    }

    return res.json({
      success: true,
      session: sessionPayload,
      message: 'Zone de scan déverrouillée avec succès'
    });
  } catch (error) {
    console.error('Erreur lors de la demande de déverrouillage:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// Endpoint pour valider une session
 app.get('/api/scan/session/:sessionId/validate', validateToken, async (req, res) => {
  try {
    const sessionId = Number.parseInt(String(req.params?.sessionId || '').trim(), 10);
    
    if (!Number.isInteger(sessionId) || sessionId <= 0) {
      return res.status(400).json({ success: false, message: 'ID de session requis' });
    }

    const session = await scanSession.findFirst({
      where: {
        id: sessionId,
        active: true
      },
      include: {
        device: true
      }
    });

    if (!session) {
      return res.json({ valid: false, message: 'Session non trouvée ou inactive' });
    }

    // Vérifier si la session n'est pas expirée
    if (new Date() > new Date(session.expiresAt)) {
      await scanSession.update({
        where: { id: sessionId },
        data: { active: false }
      });
      return res.json({ valid: false, message: 'Session expirée' });
    }

    res.json({
      valid: true,
      session: {
        id: session.id,
        deviceId: session.deviceId,
        adminId: session.adminId,
        adminName: session.adminName,
        expiresAt: session.expiresAt.toISOString(),
        active: session.active,
        method: session.method,
        deviceInfo: session.deviceInfo,
        device: session.device
          ? {
            id: session.device.id,
            name: session.device.name,
            type: session.device.type,
            userAgent: session.device.userAgent,
            platform: session.device.platform,
            fingerprint: session.device.fingerprint,
            trusted: session.device.trusted,
            lastSeen: session.device.lastSeen.toISOString(),
            createdAt: session.device.createdAt.toISOString()
          }
          : null
      }
    });
  } catch (error) {
    console.error('Erreur lors de la validation de la session:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// Endpoint pour verrouiller une session
app.post('/api/scan/session/:sessionId/lock', validateToken, async (req, res) => {
  try {
    const sessionId = Number.parseInt(String(req.params?.sessionId || '').trim(), 10);
    const tokenPayload = req.user || {};
    const tokenUserType = String(tokenPayload.userType || '').trim().toLowerCase();
    const admin = tokenPayload.user || tokenPayload;
    const adminId = Number(admin?.id || 0);
    
    if (tokenUserType && tokenUserType !== 'admin') {
      return res.status(403).json({ success: false, message: 'Acces reserve aux administrateurs' });
    }

    if (!Number.isInteger(adminId) || adminId <= 0) {
      return res.status(401).json({ success: false, message: 'Session invalide' });
    }

    if (!Number.isInteger(sessionId) || sessionId <= 0) {
      return res.status(400).json({ success: false, message: 'ID de session requis' });
    }

    const session = await scanSession.findFirst({
      where: { id: sessionId }
    });

    if (!session) {
      return res.status(404).json({ success: false, message: 'Session non trouvée' });
    }

    // Vérifier que l'admin est le propriétaire de la session
    if (session.adminId !== adminId) {
      return res.status(403).json({ success: false, message: 'Non autorisé' });
    }

    await scanSession.update({
      where: { id: sessionId },
      data: { active: false }
    });

    res.json({
      success: true,
      message: 'Session verrouillée avec succès'
    });
  } catch (error) {
    console.error('Erreur lors du verrouillage de la session:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// Endpoint pour prolonger une session
app.post('/api/scan/session/:sessionId/extend', validateToken, async (req, res) => {
  try {
    const sessionId = Number.parseInt(String(req.params?.sessionId || '').trim(), 10);
    const { duration = 60 } = req.body;
    const tokenPayload = req.user || {};
    const tokenUserType = String(tokenPayload.userType || '').trim().toLowerCase();
    const admin = tokenPayload.user || tokenPayload;
    const adminId = Number(admin?.id || 0);
    
    if (tokenUserType && tokenUserType !== 'admin') {
      return res.status(403).json({ success: false, message: 'Acces reserve aux administrateurs' });
    }

    if (!Number.isInteger(adminId) || adminId <= 0) {
      return res.status(401).json({ success: false, message: 'Session invalide' });
    }

    if (!Number.isInteger(sessionId) || sessionId <= 0) {
      return res.status(400).json({ success: false, message: 'ID de session requis' });
    }

    const session = await scanSession.findFirst({
      where: { 
        id: sessionId,
        active: true 
      }
    });

    if (!session) {
      return res.status(404).json({ success: false, message: 'Session non trouvée ou inactive' });
    }

    // Vérifier que l'admin est le propriétaire de la session
    if (session.adminId !== adminId) {
      return res.status(403).json({ success: false, message: 'Non autorisé' });
    }

    // Prolonger la session
    const newExpiresAt = new Date();
    newExpiresAt.setMinutes(newExpiresAt.getMinutes() + duration);

    const updatedSession = await scanSession.update({
      where: { id: sessionId },
      data: { expiresAt: newExpiresAt }
    });

    res.json({
      success: true,
      expiresAt: updatedSession.expiresAt.toISOString(),
      message: 'Session prolongée avec succès'
    });
  } catch (error) {
    console.error('Erreur lors de la prolongation de la session:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// Endpoint pour gérer les méthodes de déverrouillage de scan
app.post('/api/admin/scan-security/update', validateToken, async (req, res) => {
  try {
    const admin = req.user;
    const { pinCode, unlockToken, deviceMac, deviceFingerprint } = req.body;
    
    if (!admin?.id) {
      return res.status(400).json({ success: false, message: 'Admin non identifié' });
    }

    // Pour l'instant, stocker dans les paramètres utilisateur
    const updates = {};
    
    if (pinCode && pinCode.length === 6) {
      // Stocker le code PIN hashé
      const bcrypt = require('bcrypt');
      const hashedPin = await bcrypt.hash(pinCode, 10);
      updates.scan_pin_code = hashedPin;
    }
    
    if (unlockToken && unlockToken.length >= 8) {
      updates.scan_unlock_token = unlockToken;
    }
    
    if (deviceMac) {
      updates.device_mac = deviceMac;
    }
    
    if (deviceFingerprint) {
      updates.device_fingerprint = deviceFingerprint;
    }

    // Mettre à jour les paramètres de l'admin
    if (Object.keys(updates).length > 0) {
      // Utiliser une table de paramètres pour stocker ces valeurs
      for (const [key, value] of Object.entries(updates)) {
        await prisma.parametreUtilisateur.upsert({
          where: {
            userId_cle: {
              userId: admin.id,
              cle: key
            }
          },
          update: { valeur: String(value) },
          create: {
            userId: admin.id,
            userType: 'admin',
            cle: key,
            valeur: String(value)
          }
        });
      }
    }

    res.json({
      success: true,
      message: 'Méthodes de déverrouillage mises à jour avec succès'
    });
  } catch (error) {
    console.error('Erreur lors de la mise à jour des méthodes de déverrouillage:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// Endpoint pour récupérer les méthodes de déverrouillage
app.get('/api/admin/scan-security', validateToken, async (req, res) => {
  try {
    const admin = req.user;
    
    if (!admin?.id) {
      return res.status(400).json({ success: false, message: 'Admin non identifié' });
    }

    // Récupérer les paramètres de sécurité
    const securityParams = await prisma.parametreUtilisateur.findMany({
      where: {
        userId: admin.id,
        userType: 'admin',
        cle: {
          in: ['scan_pin_code', 'scan_unlock_token', 'device_mac', 'device_fingerprint']
        }
      }
    });

    const securityData = {};
    securityParams.forEach(param => {
      securityData[param.cle] = param.valeur;
    });

    res.json({
      success: true,
      data: {
        pinCode: securityData.scan_pin_code ? '****' : null, // Masquer le PIN réel
        unlockToken: securityData.scan_unlock_token || null,
        deviceMac: securityData.device_mac || null,
        deviceFingerprint: securityData.device_fingerprint || null,
        hasPinCode: !!securityData.scan_pin_code,
        hasUnlockToken: !!securityData.scan_unlock_token
      }
    });
  } catch (error) {
    console.error('Erreur lors de la récupération des méthodes de déverrouillage:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// Endpoint pour vérifier le code PIN
app.post('/api/admin/scan-security/verify-pin', validateToken, async (req, res) => {
  try {
    const admin = req.user;
    const { pinCode } = req.body;
    
    if (!admin?.id || !pinCode) {
      return res.status(400).json({ success: false, message: 'PIN requis' });
    }

    // Récupérer le PIN hashé
    const pinParam = await prisma.parametreUtilisateur.findFirst({
      where: {
        userId: admin.id,
        userType: 'admin',
        cle: 'scan_pin_code'
      }
    });

    if (!pinParam) {
      return res.status(404).json({ success: false, message: 'Aucun code PIN configuré' });
    }

    // Vérifier le PIN
    const bcrypt = require('bcrypt');
    const isValid = await bcrypt.compare(pinCode, pinParam.valeur);

    if (isValid) {
      res.json({ success: true, message: 'PIN vérifié avec succès' });
    } else {
      res.status(401).json({ success: false, message: 'PIN incorrect' });
    }
  } catch (error) {
    console.error('Erreur lors de la vérification du PIN:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// Endpoint pour obtenir le PIN de scan actuel
app.get('/api/scan/pin', validateToken, async (req, res) => {
  try {
    const tokenPayload = req.user || {};
    const tokenUserType = String(tokenPayload.userType || '').trim().toLowerCase();
    const admin = tokenPayload.user || tokenPayload;
    const adminId = Number(admin?.id || 0);

    if (tokenUserType && tokenUserType !== 'admin') {
      return res.status(403).json({ success: false, message: 'Acces reserve aux administrateurs' });
    }

    if (!Number.isInteger(adminId) || adminId <= 0) {
      return res.status(401).json({ success: false, message: 'Session invalide' });
    }

    const pinParam = await prisma.parametreUtilisateur.findFirst({
      where: {
        userId: adminId,
        userType: 'admin',
        cle: 'scan_pin_code'
      }
    });

    if (!pinParam?.valeur) {
      return res.json({ success: true, pin: DEFAULT_SCAN_PIN, isDefault: true });
    }

    return res.json({ success: true, pin: '****', isDefault: false });
  } catch (error) {
    console.error('Erreur lors de la récupération du PIN:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// Endpoint pour modifier le PIN de scan
app.put('/api/scan/pin', validateToken, async (req, res) => {
  try {
    const tokenPayload = req.user || {};
    const tokenUserType = String(tokenPayload.userType || '').trim().toLowerCase();
    const admin = tokenPayload.user || tokenPayload;
    const adminId = Number(admin?.id || 0);

    if (tokenUserType && tokenUserType !== 'admin') {
      return res.status(403).json({ success: false, message: 'Acces reserve aux administrateurs' });
    }

    if (!Number.isInteger(adminId) || adminId <= 0) {
      return res.status(401).json({ success: false, message: 'Session invalide' });
    }

    const currentPin = String(req.body?.currentPin || '').trim();
    const newPin = String(req.body?.newPin || '').trim();

    if (!/^[0-9]{4}$/.test(newPin)) {
      return res.status(400).json({ success: false, message: 'Le PIN doit être composé de 4 chiffres' });
    }

    const pinParam = await prisma.parametreUtilisateur.findFirst({
      where: {
        userId: adminId,
        userType: 'admin',
        cle: 'scan_pin_code'
      }
    });

    let currentMatches = false;
    if (!pinParam?.valeur) {
      currentMatches = currentPin === DEFAULT_SCAN_PIN;
    } else {
      if (!/^[0-9]{4}$/.test(currentPin)) {
        return res.status(400).json({ success: false, message: 'PIN actuel requis pour la modification' });
      }
      const bcrypt = require('bcrypt');
      currentMatches = await bcrypt.compare(currentPin, String(pinParam.valeur || ''));
    }

    if (!currentMatches) {
      return res.status(401).json({ success: false, message: 'PIN actuel incorrect' });
    }

    // Revenir au PIN par défaut: on supprime le paramètre custom.
    if (newPin === DEFAULT_SCAN_PIN) {
      await prisma.parametreUtilisateur.deleteMany({
        where: {
          userId: adminId,
          userType: 'admin',
          cle: 'scan_pin_code'
        }
      });
      return res.json({ success: true, message: 'PIN réinitialisé au défaut' });
    }

    const bcrypt = require('bcrypt');
    const hashedPin = await bcrypt.hash(newPin, 10);

    await prisma.parametreUtilisateur.upsert({
      where: {
        userId_cle: {
          userId: adminId,
          cle: 'scan_pin_code'
        }
      },
      update: { valeur: hashedPin, userType: 'admin' },
      create: {
        userId: adminId,
        userType: 'admin',
        cle: 'scan_pin_code',
        valeur: hashedPin
      }
    });

    return res.json({ success: true, message: 'PIN modifié avec succès' });
  } catch (error) {
    console.error('Erreur lors de la modification du PIN:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// Endpoint pour réinitialiser le PIN de scan
app.post('/api/scan/pin/reset', validateToken, async (req, res) => {
  try {
    const tokenPayload = req.user || {};
    const tokenUserType = String(tokenPayload.userType || '').trim().toLowerCase();
    const admin = tokenPayload.user || tokenPayload;
    const adminId = Number(admin?.id || 0);

    if (tokenUserType && tokenUserType !== 'admin') {
      return res.status(403).json({ success: false, message: 'Acces reserve aux administrateurs' });
    }

    if (!Number.isInteger(adminId) || adminId <= 0) {
      return res.status(401).json({ success: false, message: 'Session invalide' });
    }

    await prisma.parametreUtilisateur.deleteMany({
      where: {
        userId: adminId,
        userType: 'admin',
        cle: 'scan_pin_code'
      }
    });

    return res.json({ success: true, message: 'PIN réinitialisé avec succès' });
  } catch (error) {
    console.error('Erreur lors de la réinitialisation du PIN:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

app.get('/api/scan/devices', validateToken, async (req, res) => {
  try {
    const admin = req.user;
    
    if (!admin?.id) {
      return res.status(401).json({ success: false, message: 'Admin non authentifié' });
    }

    const devices = await prisma.badgeScan.findMany({
      orderBy: { scanTime: 'desc' }
    });
    
    const formattedDevices = devices.map(device => ({
      id: device.id,
      name: `Appareil ${device.id}`, // Nom générique
      type: device.scanType || 'unknown',
      userAgent: device.deviceInfo || 'unknown',
      fingerprint: device.tokenHash || 'unknown',
      ipAddress: device.ipAddress || 'unknown',
      isValid: device.isValid || false,
      lastSeen: device.scanTime,
      scanTime: device.scanTime,
      validationDetails: device.validationDetails || null,
      // Champs additionnels avec valeurs par défaut
      latitude: device.latitude || null,
      longitude: device.longitude || null,
      deviceId: device.tokenId ? `token_${device.tokenId}` : 'unknown',
      tokenHash: device.tokenHash || null,
      scanType: device.scanType || 'unknown',
      token: device.token ? {
        id: device.token.id,
        employeId: device.token.employeId,
        token: device.token.token,
        tokenHash: device.token.tokenHash,
        createdAt: device.token.createdAt,
        expiresAt: device.token.expiresAt,
        ipAddress: device.token.ipAddress,
        userAgent: device.token.userAgent,
        deviceInfo: device.token.deviceInfo,
        status: device.token.status
      } : null
    }));
    
    res.json({ success: true, devices: formattedDevices });
  } catch (error) {
    console.error('Erreur lors de la récupération des appareils:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// Endpoint pour révoquer un appareil
app.delete('/api/scan/device/:deviceId', validateToken, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const admin = req.user;
    
    if (!deviceId) {
      return res.status(400).json({ success: false, message: 'ID d\'appareil requis' });
    }

    const device = await prisma.badgeScan.findFirst({
      where: { id: deviceId }
    });

    if (!device) {
      return res.status(404).json({ success: false, message: 'Appareil non trouvé' });
    }

    // Supprimer l'appareil (pas de vérification adminId car BadgeScan n'a pas ce champ)
    await prisma.badgeScan.delete({
      where: { id: deviceId }
    });

    res.json({
      success: true,
      message: 'Appareil révoqué avec succès'
    });
  } catch (error) {
    console.error('Erreur lors de la révocation de l\'appareil:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// Fonction utilitaire pour générer un token sécurisé
function generateSecureToken() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 32; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

app.get('/api/get_pointages', validateToken, async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const departement = req.query.departement || null;
    const employeId = req.query.employe_id || null;
    const dateDebut = req.query.date_debut || null;
    const dateFin = req.query.date_fin || null;
    const typeFilter = req.query.type || null;
    const statutFilter = req.query.statut || null;
    const page = Math.max(1, parseInt(req.query.page_pointage) || parseInt(req.query.page) || 1);
    const perPage = Math.max(1, parseInt(req.query.per_page) || parseInt(req.query.perPage) || 10);

    let start, end;
    
    // Gestion des filtres de date
    if (dateDebut && dateFin) {
      start = new Date(dateDebut + 'T00:00:00');
      end = new Date(dateFin + 'T23:59:59');
    } else if (date) {
      start = new Date(date + 'T00:00:00');
      end = new Date(date + 'T23:59:59');
    } else {
      start = new Date(new Date().toISOString().split('T')[0] + 'T00:00:00');
      end = new Date(new Date().toISOString().split('T')[0] + 'T23:59:59');
    }

    const where = {
      dateHeure: { gte: start, lte: end },
      type: { in: ['arrivee', 'depart'] }
    };
    
    if (departement) {
      where.employe = { departement };
    }
    
    if (employeId) {
      where.employeId = parseInt(employeId);
    }
    
    if (typeFilter) {
      where.type = typeFilter;
    }

    const total = await prisma.pointage.count({ where });
    const items = await prisma.pointage.findMany({
      where,
      include: { 
        employe: true,
        admin: true
      },
      orderBy: { dateHeure: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage
    });
    const runtimeSettings = await getSystemRuntimeSettings();

    const total_pages = Math.max(1, Math.ceil(total / perPage));

    const mappedPointages = items.map((p) => {
      const pointageDate = p.dateHeure instanceof Date ? p.dateHeure : new Date(p.dateHeure);
      const parsedDateValid = !Number.isNaN(pointageDate.getTime());
      let retardMinutes = Number(p.retardMinutes || 0);

      if (
        parsedDateValid
        && String(p.type || '').toLowerCase() === 'arrivee'
        && retardMinutes <= 0
      ) {
        const arrivalThreshold = buildThresholdDateFromTime(
          pointageDate,
          runtimeSettings.work_start_time,
          9,
          0
        );
        if (pointageDate.getTime() > arrivalThreshold.getTime()) {
          retardMinutes = Math.floor((pointageDate.getTime() - arrivalThreshold.getTime()) / 60000);
        }
      }

      const statut = String(p.etat || '').toLowerCase() === 'retard'
        || retardMinutes > 0
        ? 'retard'
        : String(p.type || '').toLowerCase() === 'absence'
          ? 'absent'
          : 'normal';

      // Déterminer si c'est un pointage d'admin ou d'employé
      const isAdmin = p.adminId && !p.employeId;
      const user = isAdmin ? p.admin : p.employe;
      const userId = isAdmin ? p.adminId : p.employeId;
      const userType = isAdmin ? 'admin' : 'employe';

      // Debug logging
      console.log('Pointage mapping:', {
        id: p.id,
        adminId: p.adminId,
        employeId: p.employeId,
        isAdmin,
        user: user ? { prenom: user.prenom, nom: user.nom, role: user.role } : null,
        userType
      });

      return {
        id: p.id,
        employe_id: p.employeId,
        admin_id: p.adminId,
        user_type: userType,
        matricule: user?.matricule
          || (userId
            ? buildMatriculeFromIdentity({
              id: userId,
              role: user?.role || userType,
              dateCreation: user?.dateCreation
            })
            : null),
        prenom: user?.prenom || '',
        nom: user?.nom || '',
        role: user?.role || '',
        departement: user?.departement || '',
        date: pointageDate.toISOString().split('T')[0],
        date_heure: pointageDate.toISOString(),
        type: p.type,
        arrivee: p.type === 'arrivee' ? pointageDate.toISOString().substr(11, 5) : null,
        depart: p.type === 'depart' ? pointageDate.toISOString().substr(11, 5) : null,
        retard_minutes: retardMinutes,
        statut,
        commentaire: p.commentaire || null,
        source: extractScanSourceFromDeviceInfo(p.deviceInfo),
        photo: normalizePhotoPath(user?.photo)
      };
    });

    // Filtrage par statut après mapping
    let filteredPointages = mappedPointages;
    if (statutFilter) {
      filteredPointages = mappedPointages.filter(p => p.statut === statutFilter);
    }

    res.json({ success: true, pointages: filteredPointages, total: filteredPointages.length, total_pages });
  } catch (error) {
    console.error('Erreur get_pointages:', error);
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

app.get('/api/get_demandes', validateToken, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page_demandes) || parseInt(req.query.page) || 1);
    const perPage = Math.max(1, parseInt(req.query.per_page) || 10);
    const where = req.user?.userType === 'employe'
      ? { employeId: req.user.user.id }
      : {};

    const total = await prisma.demande.count({ where });
    const items = await prisma.demande.findMany({
      where,
      include: { employe: true },
      orderBy: { dateDemande: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage
    });

    const traiterAdminIds = Array.from(
      new Set(
        items
          .map((item) => Number(item?.traitePar || 0))
          .filter((id) => Number.isInteger(id) && id > 0)
      )
    );
    const traiteParAdmins = traiterAdminIds.length > 0
      ? await prisma.admin.findMany({
        where: { id: { in: traiterAdminIds } },
        select: { id: true, prenom: true, nom: true, role: true }
      })
      : [];
    const traiteParById = new Map(
      traiteParAdmins.map((admin) => [
        admin.id,
        {
          nom: buildDisplayName(admin.prenom, admin.nom),
          role: String(admin.role || '').trim()
        }
      ])
    );

    const statsRaw = await prisma.demande.groupBy({
      by: ['statut'],
      where,
      _count: { statut: true }
    });

    const stats = { total, en_attente: 0, approuve: 0, rejete: 0 };
    statsRaw.forEach((row) => {
      const rawStatut = String(row.statut || '').toLowerCase();
      if (rawStatut === 'en_attente') {
        stats.en_attente = row._count.statut;
      } else if (rawStatut.includes('approuv')) {
        stats.approuve = row._count.statut;
      } else {
        stats.rejete = row._count.statut;
      }
    });

    const isUsefulDemandValue = (value) => {
      const raw = String(value ?? '').trim();
      if (!raw) return false;
      const lowered = raw.toLowerCase();
      return lowered !== '-' && lowered !== 'null' && lowered !== 'undefined' && lowered !== 'n/a';
    };

    const toIsoDemandDate = (value) => {
      const raw = String(value ?? '').trim();
      if (!isUsefulDemandValue(raw)) return null;

      if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        return raw;
      }

      const frMatch = raw.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
      if (frMatch) {
        const day = Number(frMatch[1]);
        const month = Number(frMatch[2]);
        const year = Number(frMatch[3]);
        const candidate = new Date(year, month - 1, day);
        if (
          !Number.isNaN(candidate.getTime())
          && candidate.getFullYear() === year
          && candidate.getMonth() + 1 === month
          && candidate.getDate() === day
        ) {
          return formatDateOnly(candidate);
        }
      }

      const parsed = new Date(raw);
      if (Number.isNaN(parsed.getTime())) return null;
      return formatDateOnly(parsed);
    };

    const demandes = items.map((demande) => {
      const meta = {
        ...parseDemandeMeta(demande.raison),
        ...parseDemandeMeta(demande.commentaire)
      };
      const fallbackDate = toIsoDemandDate(demande.dateDemande) || formatDateOnly(new Date());
      const dateDebut = toIsoDemandDate(
        meta.dateDebut
        || meta.date_debut
        || meta.debut
        || meta.start
        || meta.from
      ) || fallbackDate;
      const dateFin = toIsoDemandDate(
        meta.dateFin
        || meta.date_fin
        || meta.fin
        || meta.end
        || meta.to
      ) || dateDebut;
      const rawCommentaire = String(demande.commentaire || '').trim();
      const commentaire = rawCommentaire.startsWith('{')
        ? rawCommentaire.split('\n').slice(1).join('\n').trim()
        : rawCommentaire;
      const rawStatut = String(demande.statut || '').toLowerCase();
      const traiteParId = Number(demande.traitePar || 0);
      const traiteParInfo = traiteParId > 0 ? traiteParById.get(traiteParId) : null;

      const fallbackMatricule = demande.employe?.id || demande.employeId
        ? buildMatriculeFromIdentity({
          id: demande.employe?.id || demande.employeId,
          role: demande.employe?.role || meta.role || 'employe',
          dateCreation: demande.employe?.dateCreation || demande.dateDemande
        })
        : '';

      return {
        id: demande.id,
        employe_id: demande.employeId || null,
        prenom: String(demande.employe?.prenom || meta.prenom || meta.user_prenom || '').trim(),
        nom: String(demande.employe?.nom || meta.nom || meta.user_nom || '').trim(),
        poste: String(demande.employe?.poste || meta.poste || '').trim(),
        departement: String(demande.employe?.departement || meta.departement || '').trim(),
        email: [
          demande.employe?.email,
          demande.employe?.emailPro,
          meta.email,
          meta.emailPro,
          meta.email_pro
        ].map((value) => String(value || '').trim()).find(isUsefulDemandValue) || '',
        matricule: [
          demande.employe?.matricule,
          meta.matricule,
          meta.user_matricule,
          fallbackMatricule
        ].map((value) => String(value || '').trim()).find(isUsefulDemandValue) || '',
        type: String(meta.originalType || meta.type || demande.type || ''),
        date_demande: demande.dateDemande,
        date_debut: dateDebut,
        date_fin: dateFin,
        periode: `${dateDebut} - ${dateFin}`,
        motif: demande.raison || '',
        statut: rawStatut.includes('approuv')
          ? 'approuve'
          : rawStatut.includes('rejet')
            ? 'rejete'
            : 'en_attente',
        commentaire,
        traite_par: demande.traitePar || null,
        traite_par_nom: traiteParInfo?.nom || null,
        traite_par_role: traiteParInfo?.role || null,
        date_traitement: demande.dateTraitement || null,
        heures_ecoulees: null,
        photo: normalizePhotoPath(demande.employe?.photo)
      };
    });

    res.json({
      success: true,
      demandes,
      total,
      total_pages: Math.max(1, Math.ceil(total / perPage)),
      stats
    });
  } catch (error) {
    console.error('Erreur get_demandes:', error);
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

const hasBadgeExpiredOrRegeneratedToday = async (employeId, referenceDate = new Date()) => {
  const normalizedEmployeId = Number(employeId || 0);
  if (!Number.isInteger(normalizedEmployeId) || normalizedEmployeId <= 0) {
    return false;
  }

  const startOfDay = new Date(referenceDate);
  startOfDay.setHours(0, 0, 0, 0);
  
  const endOfDay = new Date(referenceDate);
  endOfDay.setHours(23, 59, 59, 999);

  try {
    // Vérifier si le badge a expiré aujourd'hui
    const expiredBadges = await prisma.badgeScan.findMany({
      where: {
        token: {
          employeId: normalizedEmployeId,
          expiresAt: { lte: endOfDay }
        },
        scanTime: { gte: startOfDay, lte: endOfDay }
      },
      include: {
        token: {
          include: {
            employe: true
          }
        }
      }
    });

    if (expiredBadges.length > 0) {
      return true;
    }

    // Vérifier si le badge a été régénéré aujourd'hui
    const regeneratedBadges = await prisma.badgeToken.findMany({
      where: {
        employeId: normalizedEmployeId,
        createdAt: { gte: startOfDay, lte: endOfDay }
      }
    });

    if (regeneratedBadges.length > 0) {
      return true;
    }

    // Vérifier si le badge actif est expiré
    const activeBadge = await prisma.badgeToken.findFirst({
      where: {
        employeId: normalizedEmployeId,
        status: 'active'
      },
      orderBy: { createdAt: 'desc' }
    });

    if (activeBadge && activeBadge.expiresAt) {
      const expiredByDate = new Date(activeBadge.expiresAt).getTime() <= Date.now();
      if (expiredByDate) {
        return true;
      }
    }

    return false;
  } catch (error) {
    console.warn('Erreur vérification badge expiré/régénéré:', error?.message || error);
    return false;
  }
};

const buildAdminNotifications = async ({ limit = 20, date = '', adminUserId = null } = {}) => {
  const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const dateRaw = String(date || '').trim();
  const referenceDate = dateRaw ? new Date(`${dateRaw}T00:00:00`) : new Date();
  const baseDate = Number.isNaN(referenceDate.getTime()) ? new Date() : referenceDate;
  baseDate.setHours(0, 0, 0, 0);

  const start = new Date(baseDate);
  const end = new Date(baseDate);
  end.setHours(23, 59, 59, 999);

  const [todayPointages, pendingDemandes, activeEmployes, arrivalsToday, badgeTokens] = await Promise.all([
    prisma.pointage.findMany({
      where: {
        dateHeure: { gte: start, lte: end },
        OR: [{ type: 'arrivee' }, { type: 'depart' }]
      },
      include: { employe: true },
      orderBy: { dateHeure: 'desc' },
      take: 150
    }),
    prisma.demande.findMany({
      where: { statut: 'en_attente' },
      include: { employe: true },
      orderBy: { dateDemande: 'desc' },
      take: 50
    }),
    prisma.employe.findMany({
      where: { statut: 'actif' },
      select: { id: true, prenom: true, nom: true }
    }),
    prisma.pointage.findMany({
      where: {
        dateHeure: { gte: start, lte: end },
        type: 'arrivee',
        employeId: { not: null }
      },
      select: { employeId: true }
    }),
    prisma.badgeToken.findMany({
      where: {
        createdAt: { gte: start, lte: end },
        OR: [{ employeId: { not: null } }, { adminId: { not: null } }]
      },
      include: {
        employe: { select: { id: true, nom: true, prenom: true, role: true } },
        admin: { select: { id: true, nom: true, prenom: true, role: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: 120
    })
  ]);

  const arrivedTodayIds = new Set(
    arrivalsToday
      .map((item) => Number(item.employeId))
      .filter((value) => Number.isInteger(value) && value > 0)
  );

  const absents = activeEmployes
    .filter((employe) => !arrivedTodayIds.has(Number(employe.id)))
    .slice(0, 80);

  // Vérifier pour chaque employé absent si son badge a expiré ou été régénéré aujourd'hui
  const absentsWithBadgeCheck = [];
  for (const absent of absents) {
    const hasBadgeEvent = await hasBadgeExpiredOrRegeneratedToday(absent.id, baseDate);
    if (hasBadgeEvent) {
      absentsWithBadgeCheck.push(absent);
    }
  }

  const notifications = [];

  for (const pointage of todayPointages) {
    const fullName = buildDisplayName(pointage.employe?.prenom, pointage.employe?.nom);
    const pointageTypeLabel = pointage.type === 'arrivee' ? 'arrivee' : 'depart';
    const isRetard = pointage.type === 'arrivee'
      && (Number(pointage.retardMinutes || 0) > 0 || String(pointage.etat || '').toLowerCase() === 'retard');

    notifications.push(mapNotificationForApi({
      id: `pointage-${pointage.id}`,
      type: 'pointage',
      level: isRetard ? 'warning' : (pointage.type === 'depart' ? 'info' : 'success'),
      title: `Pointage ${pointageTypeLabel}`,
      message: `${fullName} a enregistre un pointage ${pointageTypeLabel}${isRetard ? ' (en retard)' : ''}.`,
      created_at: pointage.dateHeure,
      entity_id: pointage.id,
      entity_kind: 'pointage',
      employe_id: pointage.employeId || null
    }));

    if (isRetard) {
      const minutes = Number(pointage.retardMinutes || 0);
      notifications.push(mapNotificationForApi({
        id: `retard-${pointage.id}`,
        type: 'retard',
        level: 'warning',
        title: 'Retard detecte',
        message: `${fullName} est en retard${minutes > 0 ? ` (${minutes} min)` : ''}.`,
        created_at: pointage.dateHeure,
        entity_id: pointage.id,
        entity_kind: 'pointage',
        employe_id: pointage.employeId || null
      }));
    }
  }

  for (const absent of absentsWithBadgeCheck) {
    const fullName = buildDisplayName(absent.prenom, absent.nom, `Employe #${absent.id}`);
    notifications.push(mapNotificationForApi({
      id: `absence-${absent.id}`,
      type: 'absence',
      level: 'danger',
      title: 'Absence de pointage',
      message: `${fullName} n'a pas enregistre d'arrivee aujourd'hui.`,
      created_at: end,
      entity_id: absent.id,
      entity_kind: 'absence',
      employe_id: absent.id
    }));
  }

  for (const demande of pendingDemandes) {
    const fullName = buildDisplayName(demande.employe?.prenom, demande.employe?.nom);
    notifications.push(mapNotificationForApi({
      id: `demande-${demande.id}`,
      type: 'demande',
      level: 'warning',
      title: 'Nouvelle demande',
      message: `${fullName} a soumis une demande (${demande.type}).`,
      created_at: demande.dateDemande,
      entity_id: demande.id,
      entity_kind: 'demande',
      employe_id: demande.employeId || null
    }));
  }

  for (const token of badgeTokens) {
    const target = token.employe || token.admin;
    const targetName = buildDisplayName(target?.prenom, target?.nom, token.employeId ? 'Employe' : 'Admin');
    const createdBy = String(token.createdBy || '').trim();
    const reasonLabel = getBadgeRegenerationReasonLabel(createdBy, createdBy.startsWith('system'));
    notifications.push(mapNotificationForApi({
      id: `badge-${token.id}`,
      type: 'badge',
      level: 'info',
      title: 'Badge regenere',
      message: `${reasonLabel}: ${targetName}.`,
      created_at: token.createdAt,
      entity_id: token.id,
      entity_kind: 'badge',
      employe_id: token.employeId || null
    }));
  }

  notifications.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  let filteredNotifications = notifications;
  let readByNotificationId = {};
  const adminId = Number(adminUserId || 0);
  if (Number.isInteger(adminId) && adminId > 0) {
    const [dismissedIds, readState] = await Promise.all([
      getDismissedAdminNotificationIds(adminId),
      getAdminNotificationReadState(adminId)
    ]);
    readByNotificationId = readState || {};
    if (dismissedIds.length > 0) {
      const dismissedSet = new Set(dismissedIds.map((value) => String(value || '').trim()).filter(Boolean));
      filteredNotifications = notifications.filter((notification) => !dismissedSet.has(String(notification.id || '').trim()));
    }
  }

  filteredNotifications = filteredNotifications.map((notification) => {
    const id = String(notification.id || '').trim();
    const readAt = id ? String(readByNotificationId[id] || '').trim() : '';
    const read = Boolean(readAt);
    return {
      ...notification,
      lue: read,
      read,
      date_lecture: read ? readAt : null
    };
  });

  const counts = filteredNotifications.reduce((acc, notification) => {
    if (notification.type === 'pointage') acc.pointage += 1;
    if (notification.type === 'retard') acc.retard += 1;
    if (notification.type === 'absence') acc.absence += 1;
    if (notification.type === 'demande') acc.demande += 1;
    if (notification.type === 'badge') acc.badge += 1;
    return acc;
  }, { pointage: 0, retard: 0, absence: 0, demande: 0, badge: 0 });

  return {
    items: filteredNotifications.slice(0, safeLimit),
    counts,
    date: formatDateOnly(start),
    unread_count: filteredNotifications.filter((notification) => !notification.lue).length
  };
};

const parsePersistedNotificationId = (rawValue) => {
  const raw = String(rawValue || '').trim();
  if (!raw) return null;

  if (/^\d+$/.test(raw)) {
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  const prefixed = raw.match(/^(?:notification|notif)-(\d+)$/i);
  if (!prefixed) return null;
  const parsed = Number(prefixed[1]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

app.get(
  ['/api/admin/notifications', '/api/admin/notifications/', '/api/admin/notifications/list', '/api/notifications/admin'],
  validateToken,
  requireRoleManagementAccess,
  async (req, res) => {
  try {
    const summary = await buildAdminNotifications({
      limit: req.query.limit,
      date: req.query.date,
      adminUserId: req.user?.user?.id
    });
    return res.json({ success: true, ...summary });
  } catch (error) {
    console.error('Erreur admin/notifications:', error);
    return res.status(500).json({ success: false, message: 'Erreur lors de la recuperation des notifications' });
  }
});

app.get('/api/notifications', validateToken, async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const date = String(req.query.date || '').trim();

    if (req.user?.userType === 'admin') {
      const summary = await buildAdminNotifications({
        limit,
        date,
        adminUserId: req.user?.user?.id
      });
      return res.json({
        success: true,
        notifications: summary.items,
        counts: summary.counts,
        date: summary.date,
        unread_count: Number(summary.unread_count || 0)
      });
    }

    const employeId = Number(req.user?.user?.id || 0);
    if (!Number.isInteger(employeId) || employeId <= 0) {
      return res.status(401).json({ success: false, message: 'Session invalide' });
    }

    const rows = await prisma.notification.findMany({
      where: { employeId },
      orderBy: { dateCreation: 'desc' },
      take: limit
    });

    const notifications = rows.map((row) => {
      const mapped = mapNotificationForApi({
        id: `notification-${row.id}`,
        type: row.type || 'pointage',
        title: row.titre,
        message: row.message || row.contenu || '',
        created_at: row.dateCreation || row.date,
        employe_id: row.employeId,
        entity_id: row.pointageId || row.id,
        entity_kind: row.pointageId ? 'pointage' : 'notification'
      });

      return {
        ...mapped,
        db_id: row.id,
        lue: Boolean(row.lue),
        read: Boolean(row.lue),
        date_lecture: row.dateLecture || null,
        lien: row.lien || null
      };
    });

    const unreadCount = notifications.filter((item) => !item.lue).length;

    return res.json({
      success: true,
      notifications,
      unread_count: unreadCount
    });
  } catch (error) {
    console.error('Erreur notifications:', error);
    return res.status(500).json({ success: false, message: 'Erreur lors de la recuperation des notifications' });
  }
});

const dismissAdminNotificationHandler = async (req, res) => {
  try {
    if (!hasRoleManagementAccess(req)) {
      return res.status(403).json({ success: false, message: 'Acces refuse' });
    }

    const adminId = Number(req.user?.user?.id || 0);
    if (!Number.isInteger(adminId) || adminId <= 0) {
      return res.status(401).json({ success: false, message: 'Session invalide' });
    }

    const rawNotificationId = decodeURIComponent(String(req.params.notificationId || '')).trim();
    if (!rawNotificationId) {
      return res.status(400).json({ success: false, message: 'Identifiant notification invalide' });
    }

    const persistedNotificationId = parsePersistedNotificationId(rawNotificationId);
    if (Number.isInteger(persistedNotificationId) && persistedNotificationId > 0) {
      const deleted = await prisma.notification.deleteMany({
        where: { id: persistedNotificationId }
      });
      if (deleted.count === 0) {
        return res.status(404).json({ success: false, message: 'Notification introuvable' });
      }
      return res.json({ success: true, deleted: deleted.count });
    }

    const current = await getDismissedAdminNotificationIds(adminId);
    const next = Array.from(new Set([...current, rawNotificationId]));
    const readState = await getAdminNotificationReadState(adminId);
    if (readState[rawNotificationId]) {
      delete readState[rawNotificationId];
    }

    await Promise.all([
      saveDismissedAdminNotificationIds(adminId, next),
      saveAdminNotificationReadState(adminId, readState)
    ]);

    return res.json({
      success: true,
      dismissed_id: rawNotificationId
    });
  } catch (error) {
    console.error('Erreur admin/notifications dismiss:', error);
    return res.status(500).json({
      success: false,
      message: 'Erreur lors de la suppression de notification'
    });
  }
};

app.delete('/api/admin/notifications/:notificationId', validateToken, requireRoleManagementAccess, dismissAdminNotificationHandler);

const markNotificationAsReadHandler = async (req, res) => {
  try {
    const rawNotificationId = decodeURIComponent(String(req.params.id || '')).trim();
    if (!rawNotificationId) {
      return res.status(400).json({ success: false, message: 'Identifiant notification invalide' });
    }

    const read = req.body?.read === undefined ? true : Boolean(req.body?.read);

    if (req.user?.userType === 'admin') {
      if (!hasRoleManagementAccess(req)) {
        return res.status(403).json({ success: false, message: 'Acces refuse' });
      }

      const adminId = Number(req.user?.user?.id || 0);
      if (!Number.isInteger(adminId) || adminId <= 0) {
        return res.status(401).json({ success: false, message: 'Session invalide' });
      }

      const readState = await getAdminNotificationReadState(adminId);
      if (read) {
        readState[rawNotificationId] = new Date().toISOString();
      } else {
        delete readState[rawNotificationId];
      }
      const saved = await saveAdminNotificationReadState(adminId, readState);
      const readAt = read ? saved[rawNotificationId] || new Date().toISOString() : null;
      return res.json({ success: true, read, notification_id: rawNotificationId, date_lecture: readAt });
    }

    const notificationId = parsePersistedNotificationId(rawNotificationId);
    if (!Number.isInteger(notificationId) || notificationId <= 0) {
      return res.status(400).json({ success: false, message: 'Identifiant notification invalide' });
    }

    const employeId = Number(req.user?.user?.id || 0);
    if (!Number.isInteger(employeId) || employeId <= 0) {
      return res.status(401).json({ success: false, message: 'Session invalide' });
    }

    const updated = await prisma.notification.updateMany({
      where: {
        id: notificationId,
        employeId
      },
      data: {
        lue: read,
        dateLecture: read ? new Date() : null
      }
    });

    if (updated.count === 0) {
      return res.status(404).json({ success: false, message: 'Notification introuvable' });
    }

    return res.json({ success: true, read });
  } catch (error) {
    console.error('Erreur notifications/read:', error);
    return res.status(500).json({ success: false, message: 'Erreur lors de la mise a jour de notification' });
  }
};

const markAllNotificationsAsReadHandler = async (req, res) => {
  try {
    if (req.user?.userType === 'admin') {
      if (!hasRoleManagementAccess(req)) {
        return res.status(403).json({ success: false, message: 'Acces refuse' });
      }

      const adminId = Number(req.user?.user?.id || 0);
      if (!Number.isInteger(adminId) || adminId <= 0) {
        return res.status(401).json({ success: false, message: 'Session invalide' });
      }

      const inputIds = Array.isArray(req.body?.notification_ids)
        ? req.body.notification_ids
        : [];

      const normalizedIds = inputIds
        .map((value) => String(value || '').trim())
        .filter(Boolean);

      const notificationIds = normalizedIds.length > 0
        ? Array.from(new Set(normalizedIds))
        : (await buildAdminNotifications({
            limit: 500,
            date: req.body?.date || req.query?.date,
            adminUserId: adminId
          })).items
            .map((item) => String(item?.id || '').trim())
            .filter(Boolean);

      if (notificationIds.length === 0) {
        return res.json({ success: true, updated: 0 });
      }

      const readState = await getAdminNotificationReadState(adminId);
      const readAt = new Date().toISOString();
      notificationIds.forEach((notificationId) => {
        readState[notificationId] = readAt;
      });
      await saveAdminNotificationReadState(adminId, readState);
      return res.json({ success: true, updated: notificationIds.length, date_lecture: readAt });
    }

    if (req.user?.userType !== 'employe') {
      return res.status(403).json({ success: false, message: 'Acces refuse' });
    }

    const employeId = Number(req.user?.user?.id || 0);
    if (!Number.isInteger(employeId) || employeId <= 0) {
      return res.status(401).json({ success: false, message: 'Session invalide' });
    }

    const updated = await prisma.notification.updateMany({
      where: {
        employeId,
        lue: false
      },
      data: {
        lue: true,
        dateLecture: new Date()
      }
    });

    return res.json({ success: true, updated: updated.count });
  } catch (error) {
    console.error('Erreur notifications/read-all:', error);
    return res.status(500).json({ success: false, message: 'Erreur lors de la mise a jour globale des notifications' });
  }
};

app.put('/api/notifications/read-all', validateToken, markAllNotificationsAsReadHandler);
app.put('/api/api/notifications/read-all', validateToken, markAllNotificationsAsReadHandler);
app.put('/api/admin/notifications/read-all', validateToken, requireRoleManagementAccess, markAllNotificationsAsReadHandler);

app.put('/api/notifications/:id/read', validateToken, markNotificationAsReadHandler);
app.put('/api/api/notifications/:id/read', validateToken, markNotificationAsReadHandler);
app.put('/api/admin/notifications/:notificationId/read', validateToken, requireRoleManagementAccess, async (req, res) => {
  try {
    const rawNotificationId = decodeURIComponent(String(req.params.notificationId || '')).trim();
    if (!rawNotificationId) {
      return res.status(400).json({ success: false, message: 'Identifiant notification invalide' });
    }

    const adminId = Number(req.user?.user?.id || 0);
    if (!Number.isInteger(adminId) || adminId <= 0) {
      return res.status(401).json({ success: false, message: 'Session invalide' });
    }

    const read = req.body?.read === undefined ? true : Boolean(req.body?.read);
    const readState = await getAdminNotificationReadState(adminId);
    if (read) {
      readState[rawNotificationId] = new Date().toISOString();
    } else {
      delete readState[rawNotificationId];
    }
    const saved = await saveAdminNotificationReadState(adminId, readState);
    return res.json({
      success: true,
      notification_id: rawNotificationId,
      read,
      date_lecture: read ? saved[rawNotificationId] || new Date().toISOString() : null
    });
  } catch (error) {
    console.error('Erreur admin/notifications/read:', error);
    return res.status(500).json({ success: false, message: 'Erreur lors de la mise a jour de notification' });
  }
});

const deleteNotificationHandler = async (req, res) => {
  try {
    const rawNotificationId = decodeURIComponent(String(req.params.id || '')).trim();
    const notificationId = parsePersistedNotificationId(rawNotificationId);

    if (req.user?.userType === 'admin') {
      if (!hasRoleManagementAccess(req)) {
        return res.status(403).json({ success: false, message: 'Acces refuse' });
      }

      const adminId = Number(req.user?.user?.id || 0);
      if (!Number.isInteger(adminId) || adminId <= 0) {
        return res.status(401).json({ success: false, message: 'Session invalide' });
      }

      if (Number.isInteger(notificationId) && notificationId > 0) {
        const deleted = await prisma.notification.deleteMany({
          where: { id: notificationId }
        });
        if (deleted.count === 0) {
          return res.status(404).json({ success: false, message: 'Notification introuvable' });
        }
        return res.json({ success: true, deleted: deleted.count });
      }

      if (!rawNotificationId) {
        return res.status(400).json({ success: false, message: 'Notification invalide' });
      }

      const current = await getDismissedAdminNotificationIds(adminId);
      const next = Array.from(new Set([...current, rawNotificationId]));
      const readState = await getAdminNotificationReadState(adminId);
      if (readState[rawNotificationId]) {
        delete readState[rawNotificationId];
      }

      await Promise.all([
        saveDismissedAdminNotificationIds(adminId, next),
        saveAdminNotificationReadState(adminId, readState)
      ]);
      return res.json({ success: true, deleted: 1, dismissed_id: rawNotificationId });
    }

    if (req.user?.userType !== 'employe') {
      return res.status(403).json({ success: false, message: 'Acces refuse' });
    }

    if (!Number.isInteger(notificationId) || notificationId <= 0) {
      return res.status(400).json({ success: false, message: 'Notification invalide' });
    }

    const employeId = Number(req.user?.user?.id || 0);
    if (!Number.isInteger(employeId) || employeId <= 0) {
      return res.status(401).json({ success: false, message: 'Session invalide' });
    }

    const deleted = await prisma.notification.deleteMany({
      where: {
        id: notificationId,
        employeId
      }
    });

    if (deleted.count === 0) {
      return res.status(404).json({ success: false, message: 'Notification introuvable' });
    }

    return res.json({ success: true, deleted: deleted.count });
  } catch (error) {
    console.error('Erreur notifications/delete:', error);
    return res.status(500).json({ success: false, message: 'Erreur lors de la suppression de notification' });
  }
};

app.delete('/api/notifications/:id', validateToken, deleteNotificationHandler);
app.delete('/api/api/notifications/:id', validateToken, deleteNotificationHandler);
// Traitement d'une demande par un manager (approuver / rejeter) avec commentaire
app.post('/api/traiter-demande', validateToken, async (req, res) => {
  try {
    if (!hasRoleManagementAccess(req)) {
      return res.status(403).json({ success: false, message: 'Acces reserve aux administrateurs et managers' });
    }

    const body = req.body || {};
    const { commentaire, motif } = body;
    const rawDemandeId = body.id ?? body.demande_id ?? body.demandeId;
    const demandeId = Number(rawDemandeId);
    if (!Number.isInteger(demandeId) || demandeId <= 0) {
      return res.status(400).json({ success: false, message: 'Identifiant de demande invalide' });
    }

    const rawAction = String(body.action ?? body.statut ?? body.status ?? body.decision ?? '')
      .trim()
      .toLowerCase();

    const normalizedAction = rawAction === 'approuver'
      || rawAction === 'approuve'
      || rawAction === 'accepter'
      || rawAction === 'accepte'
      || rawAction === 'accept'
      || rawAction === 'approve'
      || rawAction === 'approved'
      ? 'approuve'
      : rawAction === 'refuser'
        || rawAction === 'refuse'
        || rawAction === 'rejeter'
        || rawAction === 'rejete'
        || rawAction === 'reject'
        || rawAction === 'rejected'
        ? 'rejete'
        : rawAction;

    if (!['approuve', 'rejete'].includes(normalizedAction)) {
      return res.status(400).json({ success: false, message: 'Action invalide' });
    }

    const managerId = Number(req.user?.user?.id || 0);
    if (!Number.isInteger(managerId) || managerId <= 0) {
      return res.status(401).json({ success: false, message: 'Session invalide' });
    }

    const managerComment = String(commentaire ?? motif ?? '').trim();
    if (normalizedAction === 'rejete' && !managerComment) {
      return res.status(400).json({ success: false, message: 'Le motif de refus est obligatoire' });
    }

    const existing = await prisma.demande.findUnique({
      where: { id: demandeId },
      include: {
        employe: {
          select: { id: true, prenom: true, nom: true }
        }
      }
    });

    if (!existing) {
      return res.status(404).json({ success: false, message: 'Demande introuvable' });
    }

    const currentStatut = String(existing.statut || '').trim().toLowerCase();
    if (currentStatut !== 'en_attente') {
      return res.status(409).json({
        success: false,
        message: 'Cette demande a deja ete traitee'
      });
    }

    const statut = normalizedAction === 'approuve' ? 'approuve' : 'rejete';
    const commentPrefix = managerComment
      ? `[Manager#${managerId}|${new Date().toISOString()}]: ${managerComment}`
      : null;

    const newCommentaire = [existing.commentaire || '']
      .concat(commentPrefix ? [commentPrefix] : [])
      .filter(Boolean)
      .join('\n');

    const mutationCandidates = [
      {
        statut,
        commentaire: newCommentaire || null,
        traitePar: managerId,
        dateTraitement: new Date()
      },
      {
        statut,
        commentaire: newCommentaire || null
      },
      { statut }
    ];

    let updated = null;
    let lastUpdateError = null;

    for (const payload of mutationCandidates) {
      try {
        // eslint-disable-next-line no-await-in-loop
        updated = await prisma.demande.update({
          where: { id: demandeId },
          data: payload
        });
        break;
      } catch (updateError) {
        lastUpdateError = updateError;
        const updateCode = String(updateError?.code || '').trim();
        const updateMessage = String(updateError?.message || '');
        const canFallback =
          updateCode === 'P2022'
          || updateCode === 'P2009'
          || updateMessage.includes('Unknown arg')
          || updateMessage.includes('dateTraitement')
          || updateMessage.includes('traitePar')
          || updateMessage.includes('commentaire');

        if (!canFallback) {
          throw updateError;
        }
      }
    }

    if (!updated) {
      throw lastUpdateError || new Error('Mise a jour de demande impossible');
    }

    const employeName = buildDisplayName(existing.employe?.prenom, existing.employe?.nom);
    try {
      await createEmployeNotification({
        employeId: existing.employeId,
        title: statut === 'approuve' ? 'Demande approuvee' : 'Demande rejetee',
        message: statut === 'approuve'
          ? `Votre demande (${existing.type}) a ete approuvee par l'administration.`
          : `Votre demande (${existing.type}) a ete rejetee.${managerComment ? ` Motif: ${managerComment}` : ''}`,
        type: 'demande',
        level: statut === 'approuve' ? 'success' : 'warning',
        lien: '/employee/demandes'
      });
    } catch (notificationError) {
      console.warn('Notification demande non creee:', notificationError?.message || notificationError);
    }

    return res.json({
      success: true,
      message: `Demande de ${employeName} ${statut === 'approuve' ? 'approuvee' : 'rejetee'}`,
      demande: {
        id: updated.id,
        statut: updated.statut,
        commentaire: updated.commentaire,
        traite_par: updated.traitePar,
        date_traitement: updated.dateTraitement,
        updated_at: updated.updatedAt
      }
    });
  } catch (error) {
    console.error('Erreur traiter-demande:', error);
    const mapped = mapPrismaMutationError(error);
    if (mapped) {
      return res.status(mapped.status).json({ success: false, message: mapped.message });
    }
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

app.get('/api/get_retards', validateToken, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page_retard) || parseInt(req.query.page) || 1);
    const perPage = Math.max(1, parseInt(req.query.per_page) || 10);
    const date = String(req.query.date_retard || req.query.date || '').trim();
    const departement = String(req.query.dep_retard || req.query.departement || '').trim();
    const justifieRaw = String(req.query.justifie ?? '').trim().toLowerCase();
    const justifie =
      justifieRaw === ''
        ? undefined
        : ['1', 'true', 'oui', 'yes'].includes(justifieRaw)
          ? true
          : ['0', 'false', 'non', 'no'].includes(justifieRaw)
            ? false
            : undefined;

    const start = date ? new Date(`${date}T00:00:00`) : null;
    const end = date ? new Date(`${date}T23:59:59`) : null;

    const where = {
      AND: [
        { type: 'arrivee' },
        {
          OR: [
            { retardMinutes: { gt: 0 } },
            { etat: 'retard' }
          ]
        }
      ]
    };

    if (start && end && !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
      where.AND.push({ dateHeure: { gte: start, lte: end } });
    }

    if (req.user?.userType === 'employe') {
      where.AND.push({ employeId: Number(req.user?.user?.id || 0) });
    }

    if (departement) {
      where.AND.push({
        employe: {
          is: {
            departement: { contains: departement, mode: 'insensitive' }
          }
        }
      });
    }

    if (justifie === true) {
      where.AND.push({
        OR: [
          { estJustifie: true },
          { retards: { is: { statut: 'approuve' } } }
        ]
      });
    } else if (justifie === false) {
      where.AND.push({ estJustifie: false });
    }

    const total = await prisma.pointage.count({ where });
    const items = await prisma.pointage.findMany({
      where,
      include: { employe: true, retards: true },
      orderBy: { dateHeure: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage
    });

    res.json({
      success: true,
      retards: items.map((pointage) => ({
        id: pointage.id,
        employe_id: pointage.employeId,
        prenom: pointage.employe?.prenom || '',
        nom: pointage.employe?.nom || '',
        departement: pointage.employe?.departement || '',
        date_heure: pointage.dateHeure,
        retard_minutes: Number(pointage.retardMinutes || 0),
        statut: pointage.retards?.statut || (pointage.estJustifie ? 'approuve' : 'en_attente'),
        retard_raison: pointage.retards?.raison || pointage.commentaire || '',
        est_justifie: Boolean(pointage.estJustifie || pointage.retards?.statut === 'approuve'),
        created_at: pointage.retards?.dateSoumission || pointage.createdAt
      })),
      total,
      current_page: page,
      per_page: perPage,
      total_pages: Math.max(1, Math.ceil(total / perPage))
    });
  } catch (error) {
    console.error('Erreur get_retards:', error);
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

app.post('/api/retards/:pointageId/justifier', validateToken, async (req, res) => {
  try {
    const pointageId = parseInt(req.params.pointageId, 10);
    if (!Number.isInteger(pointageId) || pointageId <= 0) {
      return res.status(400).json({ success: false, message: 'Pointage invalide' });
    }

    const raison = normalizeNullableString(req.body?.raison, 100);
    const details = normalizeNullableString(req.body?.details, 1000);
    if (!raison) {
      return res.status(400).json({ success: false, message: 'Raison obligatoire' });
    }

    const pointage = await prisma.pointage.findUnique({
      where: { id: pointageId },
      include: { retards: true }
    });

    if (!pointage || !pointage.employeId) {
      return res.status(404).json({ success: false, message: 'Pointage introuvable' });
    }

    const requesterId = Number(req.user?.user?.id || 0);
    const requesterType = String(req.user?.userType || '').trim().toLowerCase();
    const isOwner = requesterType === 'employe' && requesterId > 0 && requesterId === pointage.employeId;
    const canManage = requesterType === 'admin' && hasRoleManagementAccess(req);
    if (!isOwner && !canManage) {
      return res.status(403).json({ success: false, message: 'Acces refuse' });
    }

    const hasRetardContext = Boolean(
      pointage.retards
      || Number(pointage.retardMinutes || 0) > 0
      || String(pointage.etat || '').toLowerCase() === 'retard'
      || pointage.type === 'depart'
    );
    if (!hasRetardContext) {
      return res.status(400).json({ success: false, message: 'Aucun retard ou depart anticipe a justifier.' });
    }

    const nextStatus = canManage ? 'approuve' : 'en_attente';
    const now = new Date();

    const retard = await prisma.retard.upsert({
      where: { pointageId },
      create: {
        pointageId,
        employeId: pointage.employeId,
        raison,
        details,
        statut: nextStatus,
        adminTraitantId: canManage ? requesterId : null,
        dateTraitement: canManage ? now : null,
        dateSoumission: now
      },
      update: {
        raison,
        details,
        statut: nextStatus,
        adminTraitantId: canManage ? requesterId : null,
        dateTraitement: canManage ? now : null,
        dateSoumission: now
      }
    });

    await prisma.pointage.update({
      where: { id: pointageId },
      data: { estJustifie: canManage ? true : false, commentaire: details || pointage.commentaire || null }
    });

    return res.json({
      success: true,
      message: canManage
        ? 'Retard justifie et approuve.'
        : 'Justification enregistree et en attente de validation.',
      retard: {
        id: retard.id,
        pointage_id: retard.pointageId,
        employe_id: retard.employeId,
        raison: retard.raison,
        details: retard.details || '',
        statut: retard.statut,
        date_soumission: retard.dateSoumission
      }
    });
  } catch (error) {
    const mappedError = mapPrismaMutationError(error);
    if (mappedError) {
      return res.status(mappedError.status).json({ success: false, message: mappedError.message });
    }
    console.error('Erreur retards/justifier:', error);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

app.get('/api/get_pointage_admin_day', validateToken, async (req, res) => {
  try {
    const today = req.query.date || new Date().toISOString().split('T')[0];
    const start = new Date(today + 'T00:00:00');
    const end = new Date(today + 'T23:59:59');

    const totalEmployes = await prisma.employe.count();

    // number of distinct employees with an arrivee today
    const grouped = await prisma.pointage.groupBy({
      by: ['employeId'],
      where: { dateHeure: { gte: start, lte: end }, type: 'arrivee' }
    });
    const presents = grouped.length;

    const groupedRetards = await prisma.pointage.groupBy({
      by: ['employeId'],
      where: {
        dateHeure: { gte: start, lte: end },
        type: 'arrivee',
        employeId: { not: null },
        OR: [
          { retardMinutes: { gt: 0 } },
          { etat: 'retard' }
        ]
      }
    });
    const retards = groupedRetards.length;

    const absents = Math.max(0, totalEmployes - presents);

    res.json({ total_employes: totalEmployes, presents, absents, retards });
  } catch (error) {
    console.error('Erreur get_pointage_admin_day:', error);
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

app.get('/api/pointages/period', validateToken, async (req, res) => {
  try {
    const { start, end } = req.query;
    if (!start || !end) {
      return res.status(400).json({ success: false, message: 'Dates start et end requises' });
    }
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return res.status(400).json({ success: false, message: 'Dates invalides' });
    }

    if (req.user?.userType === 'employe') {
      const runtimeSettings = await getSystemRuntimeSettings();
      await backfillAutoDeparturesForEmployeRange({
        employeId: req.user.user.id,
        startDate,
        endDate,
        runtimeSettings,
        reason: 'employee-period-auto-close'
      });
    }

    const where = {
      dateHeure: {
        gte: startDate,
        lte: endDate
      },
      type: { in: ['arrivee', 'depart'] }, // Filtrer pour n'inclure que les arrivées et départs
      ...(req.user?.userType === 'employe' ? { employeId: req.user.user.id } : {})
    };
    const pointages = await prisma.pointage.findMany({
      where,
      include: { employe: true },
      orderBy: { dateHeure: 'desc' }
    });
    res.json({ success: true, pointages });
  } catch (error) {
    console.error('Erreur pointages/period:', error);
    res.status(500).json({ success: false, message: 'Erreur lors de la récupération des pointages' });
  }
});

// Employee-focused endpoints (dashboard migration)
app.get('/api/employe/profile', validateToken, async (req, res) => {
  try {
    if (req.user?.userType !== 'employe') {
      return res.status(403).json({ success: false, message: 'Accès réservé aux employés' });
    }

    const employe = await prisma.employe.findUnique({
      where: { id: req.user.user.id }
    });

    if (!employe) {
      return res.status(404).json({ success: false, message: 'Employé introuvable' });
    }

    res.json({ success: true, employe: mapEmployeForApi(employe) });
  } catch (error) {
    console.error('Erreur employe/profile:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

app.get('/api/pointages/today/:date', validateToken, async (req, res) => {
  try {
    if (req.user?.userType !== 'employe') {
      return res.status(403).json({ success: false, message: 'Accès réservé aux employés' });
    }

    const date = req.params.date;
    const start = new Date(`${date}T00:00:00`);
    const end = new Date(`${date}T23:59:59`);

    const pointages = await prisma.pointage.findMany({
      where: {
        employeId: req.user.user.id,
        dateHeure: { gte: start, lte: end },
        type: { in: ['arrivee', 'depart'] } // Filtrer pour n'inclure que les arrivées et départs
      },
      orderBy: { dateHeure: 'desc' }
    });

    res.json({ success: true, pointages });
  } catch (error) {
    console.error('Erreur pointages/today:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

app.get('/api/stats/employe', validateToken, async (req, res) => {
  try {
    if (req.user?.userType !== 'employe') {
      return res.status(403).json({ success: false, message: 'Accès réservé aux employés' });
    }

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    const runtimeSettings = await getSystemRuntimeSettings();
    await backfillAutoDeparturesForEmployeRange({
      employeId: req.user.user.id,
      startDate: monthStart,
      endDate: now,
      runtimeSettings,
      reason: 'employee-stats-auto-close'
    });

    const monthPointages = await prisma.pointage.findMany({
      where: {
        employeId: req.user.user.id,
        dateHeure: { gte: monthStart, lte: monthEnd }
      },
      orderBy: { dateHeure: 'asc' }
    });

    const stats = {
      presences: new Set(monthPointages.filter((p) => p.type === 'arrivee').map((p) => formatDateOnly(p.dateHeure))).size,
      retards: monthPointages.filter((p) => p.type === 'arrivee' && (p.retardMinutes || 0) > 0).length,
      absences: 0,
      heures: `${calculateTotalHours(monthPointages)}h`
    };

    res.json({ success: true, stats });
  } catch (error) {
    console.error('Erreur stats/employe:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

app.get('/api/employe/dashboard', validateToken, async (req, res) => {
  try {
    if (req.user?.userType !== 'employe') {
      return res.status(403).json({ success: false, message: 'Accès réservé aux employés' });
    }

    const employeId = req.user.user.id;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    const runtimeSettings = await getSystemRuntimeSettings();
    await backfillAutoDeparturesForEmployeRange({
      employeId,
      startDate: monthStart,
      endDate: now,
      runtimeSettings,
      reason: 'employee-dashboard-auto-close'
    });

    const [employe, latestPointages, latestDemandes, monthPointages] = await Promise.all([
      prisma.employe.findUnique({ where: { id: employeId } }),
      prisma.pointage.findMany({
        where: { 
          employeId,
          type: { in: ['arrivee', 'depart'] } // Filtrer pour exclure les pauses
        },
        orderBy: { dateHeure: 'desc' },
        take: 10
      }),
      prisma.demande.findMany({
        where: { employeId },
        orderBy: { dateDemande: 'desc' },
        take: 10
      }),
      prisma.pointage.findMany({
        where: {
          employeId,
          dateHeure: { gte: monthStart, lte: monthEnd }
        },
        orderBy: { dateHeure: 'asc' }
      })
    ]);

    if (!employe) {
      return res.status(404).json({ success: false, message: 'Employé introuvable' });
    }

    const mappedPointages = latestPointages.map(mapPointageForDashboard);
    const mappedDemandes = latestDemandes.map(mapDemandeForDashboard);
    const joursTravailles = new Set(
      monthPointages
        .filter((p) => p.type === 'arrivee' || p.type === 'depart')
        .map((p) => formatDateOnly(p.dateHeure))
    ).size;

    const statistiques = {
      total_heures: calculateTotalHours(monthPointages),
      jours_travailles: joursTravailles,
      retards: monthPointages.filter((p) => p.type === 'arrivee' && (p.retardMinutes || 0) > 0).length,
      absences: 0,
      pointages_mois: monthPointages.length
    };

    res.json({
      success: true,
      user: mapEmployeForApi(employe),
      statistiques,
      pointages: mappedPointages,
      demandes: mappedDemandes,
      dernier_pointage: mappedPointages[0] || null
    });
  } catch (error) {
    console.error('Erreur employe/dashboard:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

app.post('/api/employe/pointages', validateToken, requireAuthenticatedSessionWithActiveBadge, async (req, res) => {
  try {
    if (req.user?.userType !== 'employe') {
      return res.status(403).json({ success: false, message: 'Accès réservé aux employés' });
    }

    const normalizedType = normalizePointageType(req.body?.type);
    if (!normalizedType) {
      return res.status(400).json({ success: false, message: 'Type de pointage invalide' });
    }

    const now = new Date();
    const runtimeSettings = await getSystemRuntimeSettings();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let retardMinutes = 0;
    let departAnticipeMinutes = 0;
    const providedJustification = normalizeJustificationText(
      req.body?.justification
      ?? req.body?.motif
      ?? req.body?.raison
      ?? req.body?.commentaire
    );

    if (normalizedType === 'arrivee') {
      const threshold = buildThresholdDateFromTime(
        now,
        runtimeSettings.work_start_time,
        9,
        0
      );
      retardMinutes = now > threshold ? Math.floor((now - threshold) / (1000 * 60)) : 0;
    } else if (normalizedType === 'depart') {
      const departureThreshold = buildThresholdDateFromTime(
        now,
        runtimeSettings.work_end_time,
        18,
        0
      );
      departAnticipeMinutes = now < departureThreshold
        ? Math.floor((departureThreshold.getTime() - now.getTime()) / 60000)
        : 0;
    }

    if (normalizedType === 'depart' && departAnticipeMinutes > 0 && providedJustification.length < JUSTIFICATION_MIN_LENGTH) {
      return res.status(422).json({
        success: false,
        message: `Justification obligatoire (${JUSTIFICATION_MIN_LENGTH} caracteres minimum) pour un depart anticipe.`,
        code: 'JUSTIFICATION_REQUIRED',
        data: {
          required_reason: 'depart_anticipe',
          min_length: JUSTIFICATION_MIN_LENGTH,
          pointage_type: 'depart',
          depart_anticipe_minutes: departAnticipeMinutes
        }
      });
    }

    const pointage = await prisma.pointage.create({
      data: {
        employeId: req.user.user.id,
        type: normalizedType,
        dateHeure: now,
        datePointage: startOfDay,
        etat: retardMinutes > 0 ? 'retard' : 'normal',
        retardMinutes,
        estJustifie: normalizedType === 'depart' && departAnticipeMinutes > 0 ? false : true,
        commentaire: providedJustification || null,
        ipAddress: req.ip || null,
        deviceInfo: req.get('user-agent') || null
      }
    });

    await notifyPointageCreated({
      employeId: req.user.user.id,
      pointageId: pointage.id,
      pointageType: normalizedType,
      retardMinutes,
      departAnticipeMinutes,
      dateHeure: now
    });

    if (normalizedType === 'depart' && departAnticipeMinutes > 0) {
      await prisma.retard.create({
        data: {
          pointageId: pointage.id,
          employeId: req.user.user.id,
          raison: 'depart_anticipe',
          details: `Depart anticipe de ${departAnticipeMinutes} minute(s). Justification: ${providedJustification || 'non fournie'}`,
          statut: 'en_attente'
        }
      });
    }

    res.status(201).json({
      success: true,
      message: 'Pointage enregistré',
      pointage: mapPointageForDashboard(pointage)
    });
  } catch (error) {
    console.error('Erreur employe/pointages:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

const buildDayRange = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  const end = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
  return { start, end };
};

const listEmployePointagesForDay = async (employeId, value = new Date()) => {
  const { start, end } = buildDayRange(value);
  return prisma.pointage.findMany({
    where: {
      employeId,
      dateHeure: { gte: start, lte: end }
    },
    orderBy: { dateHeure: 'asc' },
    select: { id: true, type: true, dateHeure: true }
  });
};

const computePauseStatusFromPointages = ({
  pointages = [],
  runtimeSettings,
  now = new Date()
}) => {
  const pauseLimitMinutes = Math.max(0, Number(runtimeSettings?.pause_duration_minutes || 0));
  const arrivalsCount = pointages.filter((item) => item.type === 'arrivee').length;
  const departuresCount = pointages.filter((item) => item.type === 'depart').length;
  const hasOpenShift = arrivalsCount > departuresCount;

  const pauseStarts = pointages
    .filter((item) => item.type === 'pause_debut')
    .map((item) => new Date(item.dateHeure))
    .filter((date) => !Number.isNaN(date.getTime()));
  const pauseEnds = pointages
    .filter((item) => item.type === 'pause_fin')
    .map((item) => new Date(item.dateHeure))
    .filter((date) => !Number.isNaN(date.getTime()));

  let usedPauseMs = 0;
  let pauseEndIndex = 0;
  let hasOpenPause = false;
  let openPauseStartedAt = null;

  pauseStarts.forEach((startDate) => {
    while (pauseEndIndex < pauseEnds.length && pauseEnds[pauseEndIndex].getTime() <= startDate.getTime()) {
      pauseEndIndex += 1;
    }

    if (pauseEndIndex < pauseEnds.length) {
      const endDate = pauseEnds[pauseEndIndex];
      usedPauseMs += Math.max(0, endDate.getTime() - startDate.getTime());
      pauseEndIndex += 1;
      return;
    }

    hasOpenPause = true;
    openPauseStartedAt = startDate;
    usedPauseMs += Math.max(0, now.getTime() - startDate.getTime());
  });

  const usedPauseMinutes = Math.max(0, Math.floor(usedPauseMs / 60000));
  const remainingPauseMinutes = Math.max(0, pauseLimitMinutes - usedPauseMinutes);

  return {
    has_open_shift: hasOpenShift,
    has_open_pause: hasOpenPause,
    pause_limit_minutes: pauseLimitMinutes,
    used_pause_minutes: usedPauseMinutes,
    remaining_pause_minutes: remainingPauseMinutes,
    work_end_time: runtimeSettings?.work_end_time || DEFAULT_DASHBOARD_SETTINGS.work_end_time,
    open_pause_started_at: openPauseStartedAt ? openPauseStartedAt.toISOString() : null
  };
};

const MINIMUM_WORK_DURATION_MINUTES = 4 * 60;
const SECOND_SCAN_MODAL_CUTOFF = '18:00';
const JUSTIFICATION_MIN_LENGTH = 3;

const normalizeJustificationText = (value) => String(value || '').trim();

const isJustificationRequiredForPointage = ({
  pointageType,
  retardMinutes = 0,
  departAnticipeMinutes = 0
}) => {
  const normalized = String(pointageType || '').trim().toLowerCase();
  if (normalized === 'pause_debut') return true;
  if (normalized === 'depart' && Number(departAnticipeMinutes) > 0) return true;
  // Les retards ne nécessitent plus de justification obligatoire
  if (normalized === 'arrivee' && Number(retardMinutes) > 0) return false;
  return false;
};

const getRequiredJustificationReason = ({
  pointageType,
  retardMinutes = 0,
  departAnticipeMinutes = 0
}) => {
  const normalized = String(pointageType || '').trim().toLowerCase();
  if (normalized === 'pause_debut') return 'pause_start';
  if (normalized === 'depart' && Number(departAnticipeMinutes) > 0) return 'depart_anticipe';
  if (normalized === 'arrivee' && Number(retardMinutes) > 0) return 'retard';
  return null;
};

const getMinutesFromOpenShiftStart = (pointages = [], now = new Date()) => {
  const openShiftStart = findOpenShiftStartFromPointages(pointages);
  if (!openShiftStart || Number.isNaN(openShiftStart.getTime())) return 0;
  return Math.max(0, Math.floor((now.getTime() - openShiftStart.getTime()) / 60000));
};

const isPastSecondScanCutoff = (now = new Date()) => {
  const cutoffDate = buildThresholdDateFromTime(
    now,
    SECOND_SCAN_MODAL_CUTOFF,
    18,
    0
  );
  return now.getTime() >= cutoffDate.getTime();
};

const findOpenShiftStartFromPointages = (pointages = []) => {
  let openShiftStart = null;

  for (const row of pointages) {
    const normalizedType = String(row?.type || '').trim().toLowerCase();
    const date = row?.dateHeure ? new Date(row.dateHeure) : null;
    if (!date || Number.isNaN(date.getTime())) continue;

    if (normalizedType === 'arrivee') {
      openShiftStart = date;
      continue;
    }

    if (normalizedType === 'depart' && openShiftStart) {
      openShiftStart = null;
    }
  }

  return openShiftStart;
};

const buildScanUserPayload = ({
  targetType,
  targetUser,
  targetUserId,
  targetMatricule,
  badgeStatus = 'active'
}) => {
  if (!targetUser || !targetUserId) return null;

  const infosSup = parseJsonObject(targetUser.infosSup);
  const dateEmbauche = targetUser.dateEmbauche
    ? new Date(targetUser.dateEmbauche).toISOString().slice(0, 10)
    : null;
  const contratPdf = String(
    infosSup.contrat_pdf_url
    || infosSup.contrat_pdf
    || infosSup.contratPdfUrl
    || infosSup.contratPdf
    || ''
  ).trim();

  return {
    id: targetUserId,
    user_type: targetType,
    matricule: targetMatricule,
    nom: targetUser.nom || '',
    prenom: targetUser.prenom || '',
    role: targetUser.role || (targetType === 'admin' ? 'admin' : 'employe'),
    statut: String(targetUser.statut || '').trim() || null,
    badge_status: badgeStatus,
    email: String(targetUser.email || '').trim() || null,
    email_pro: String(targetUser.emailPro || '').trim() || null,
    telephone: String(targetUser.telephone || '').trim() || null,
    poste: String(targetUser.poste || '').trim() || null,
    departement: String(targetUser.departement || '').trim() || null,
    adresse: String(targetUser.adresse || '').trim() || null,
    photo: normalizePhotoPath(targetUser.photo),
    date_embauche: dateEmbauche,
    contrat_type: String(targetUser.contratType || '').trim() || null,
    contrat_duree: String(targetUser.contratDuree || '').trim() || null,
    contrat_pdf_url: contratPdf || null,
    salaire: targetUser.salaire !== null && targetUser.salaire !== undefined
      ? Number(targetUser.salaire)
      : null
  };
};

const buildPublicScanUserPayload = (payload) => {
  const mapped = buildScanUserPayload(payload);
  if (!mapped) return null;
  return {
    ...mapped,
    salaire: undefined
  };
};

const previewBadgeTokenValue = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '-';
  if (raw.length <= 18) return raw;
  return `${raw.slice(0, 9)}...${raw.slice(-6)}`;
};

const extractScanSourceFromDeviceInfo = (value) => {
  if (!value) return 'manual';
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    const candidate = String(parsed?.source || parsed?.scanSource || '').trim().toLowerCase();
    if (candidate === 'camera' || candidate === 'manual' || candidate === 'image') {
      return candidate;
    }
  } catch {
    // Keep fallback below.
  }
  const raw = String(value).toLowerCase();
  if (raw.includes('camera')) return 'camera';
  if (raw.includes('image')) return 'image';
  return 'manual';
};

const normalizeScanHistoryPeriod = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'day' || raw === 'week' || raw === 'month') return raw;
  return 'week';
};

const buildScanHistoryRange = (period, now = new Date()) => {
  const end = new Date(now);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  if (period === 'week') {
    const mondayOffset = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - mondayOffset);
  } else if (period === 'month') {
    start.setDate(1);
  }

  return { start, end };
};

const resolveScanHistoryStatus = ({ arriveeAt, retardMinutes }) => {
  if (!arriveeAt) return { key: 'indetermine', label: '-' };
  if (Number(retardMinutes || 0) > 0) {
    return {
      key: 'en_retard',
      label: `En retard (${Number(retardMinutes || 0)} min)`
    };
  }
  return {
    key: 'a_l_heure',
    label: "A l'heure"
  };
};

const formatTimeOnly = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
};

const buildScanTypeLabel = ({ arriveeAt, departAt, pauseCount }) => {
  const arrivee = arriveeAt ? formatTimeOnly(arriveeAt) : '';
  const depart = departAt ? formatTimeOnly(departAt) : '';

  if (arrivee && depart) return `Arrivee ${arrivee} - Depart ${depart}`;
  if (arrivee) return `Arrivee ${arrivee}`;
  if (depart) return `Depart ${depart}`;
  if (Number(pauseCount || 0) > 0) return 'Pause';
  return '-';
};

app.get('/api/scan/access', validateToken, async (req, res) => {
  try {
    const requesterType = String(req.user?.userType || '').trim().toLowerCase();
    const requesterId = Number(req.user?.user?.id || 0);

    if (!SUPPORTED_SESSION_USER_TYPES.has(requesterType) || !Number.isInteger(requesterId) || requesterId <= 0) {
      return res.status(401).json({
        success: false,
        code: 'SESSION_INVALID',
        message: 'Session invalide.',
        badge_status: 'inactive',
        redirect_to: requesterType === 'admin' ? '/admin' : '/employee'
      });
    }

    const access = await resolveUserBadgeAccess({
      userType: requesterType,
      userId: requesterId
    });

    if (!access.allowed) {
      const status = access.code === 'SESSION_INVALID' || access.code === 'USER_NOT_FOUND' ? 401 : 403;
      return res.status(status).json({
        success: false,
        code: access.code,
        message: access.message,
        badge_status: access.badgeStatus,
        redirect_to: access.dashboardPath
      });
    }

    return res.json({
      success: true,
      code: access.code,
      message: access.message,
      badge_status: access.badgeStatus,
      redirect_to: access.dashboardPath,
      access: {
        user_id: Number(access.user?.id || requesterId),
        user_type: requesterType,
        role: access.user?.role || null,
        dashboard_path: access.dashboardPath
      }
    });
  } catch (error) {
    console.error('Erreur scan/access:', error);
    return res.status(500).json({
      success: false,
      message: "Erreur lors de la verification d acces scan"
    });
  }
});

app.get(
  [
    '/api/public/scan_history',
    '/api/public/scan_history/',
    '/api/public/scan-history',
    '/api/scan_qr/history',
    '/api/scan/history'
  ],
  validateToken,
  requireBadgeForEmployeOnly,
  async (req, res) => {
  try {
    const requesterType = String(req.user?.userType || '').trim().toLowerCase();
    const requesterId = Number(req.user?.user?.id || 0);
    const period = normalizeScanHistoryPeriod(req.query.period);
    const search = String(req.query.search || '').trim().toLowerCase();
    const { start, end } = buildScanHistoryRange(period, new Date());
    const runtimeSettings = await getSystemRuntimeSettings();

    const scanHistoryWhere = {
      dateHeure: { gte: start, lte: end },
      type: { in: ['arrivee', 'depart', 'pause_debut', 'pause_fin'] }
    };
    if (requesterType === 'employe' && Number.isInteger(requesterId) && requesterId > 0) {
      scanHistoryWhere.employeId = requesterId;
    }

    const rows = await prisma.pointage.findMany({
      where: scanHistoryWhere,
      include: {
        employe: true,
        admin: true,
        badgeToken: true
      },
      orderBy: { dateHeure: 'desc' }
    });

    const employeIds = Array.from(
      new Set(
        rows
          .map((row) => Number(row.employeId || 0))
          .filter((value) => Number.isInteger(value) && value > 0)
      )
    );
    const adminIds = Array.from(
      new Set(
        rows
          .map((row) => Number(row.adminId || 0))
          .filter((value) => Number.isInteger(value) && value > 0)
      )
    );

    const latestBadgeTokens = employeIds.length > 0 || adminIds.length > 0
      ? await prisma.badgeToken.findMany({
        where: {
          OR: [
            ...(employeIds.length > 0 ? [{ employeId: { in: employeIds } }] : []),
            ...(adminIds.length > 0 ? [{ adminId: { in: adminIds } }] : [])
          ]
        },
        orderBy: { createdAt: 'desc' }
      })
      : [];
    const latestBadgeTokenByUser = new Map();
    latestBadgeTokens.forEach((token) => {
      const userKey = Number(token.employeId || 0) > 0
        ? `employe-${Number(token.employeId)}`
        : Number(token.adminId || 0) > 0
          ? `admin-${Number(token.adminId)}`
          : '';
      if (!userKey || latestBadgeTokenByUser.has(userKey)) return;
      latestBadgeTokenByUser.set(userKey, token);
    });

    const pointageIds = rows
      .map((row) => Number(row.id || 0))
      .filter((id) => Number.isInteger(id) && id > 0);

    const retardRows = pointageIds.length > 0
      ? await prisma.retard.findMany({
        where: { pointageId: { in: pointageIds } },
        orderBy: { dateSoumission: 'desc' }
      })
      : [];
    const retardByPointageId = new Map();
    retardRows.forEach((retard) => {
      const key = Number(retard.pointageId || 0);
      if (!Number.isInteger(key) || key <= 0 || retardByPointageId.has(key)) return;
      retardByPointageId.set(key, retard);
    });

    const mapActionType = (pointageType) => {
      const raw = String(pointageType || '').trim().toLowerCase();
      if (raw === 'arrivee') return { key: 'arrivee', label: 'Arrivee' };
      if (raw === 'depart') return { key: 'depart', label: 'Depart' };
      if (raw === 'pause_debut' || raw === 'pause_fin') return { key: 'pause', label: 'Pause' };
      return { key: raw || 'pointage', label: raw || 'Pointage' };
    };

    const mapStatusForScanRow = ({ type, pointageDate, retardMinutes = 0 }) => {
      const normalizedType = String(type || '').trim().toLowerCase();
      if (normalizedType === 'pause_debut') {
        return {
          key: 'pause_en_cours',
          label: 'En cours'
        };
      }
      if (normalizedType === 'pause_fin') {
        return {
          key: 'pause_terminee',
          label: 'Terminee'
        };
      }
      if (normalizedType === 'arrivee') {
        if (Number(retardMinutes || 0) > 0) {
          return {
            key: 'en_retard',
            label: `En retard (${Number(retardMinutes || 0)} min)`
          };
        }
        return {
          key: 'a_l_heure',
          label: "A l'heure"
        };
      }

      if (normalizedType === 'depart') {
        const threshold = buildThresholdDateFromTime(
          pointageDate,
          runtimeSettings.work_end_time,
          18,
          0
        );
        if (pointageDate.getTime() < threshold.getTime()) {
          const minutes = Math.max(0, Math.floor((threshold.getTime() - pointageDate.getTime()) / 60000));
          return {
            key: 'depart_anticipe',
            label: minutes > 0 ? `Depart anticipe (${minutes} min)` : 'Depart anticipe'
          };
        }
        return {
          key: 'depart_normal',
          label: 'Depart normal'
        };
      }

      return {
        key: 'indetermine',
        label: 'Indetermine'
      };
    };

    const buildRowJustification = (pointage, retardRecord) => {
      const values = [];
      const commentaire = String(pointage?.commentaire || '').trim();
      if (commentaire) values.push(commentaire);
      const retardDetails = String(retardRecord?.details || '').trim();
      if (retardDetails && !values.includes(retardDetails)) values.push(retardDetails);
      return values.length > 0 ? values.join(' | ') : '-';
    };

    const joinUniqueValues = (values, separator = ' | ') => {
      const unique = Array.from(new Set(
        values
          .map((value) => String(value || '').trim())
          .filter((value) => value.length > 0)
      ));
      return unique.join(separator);
    };

    const rawItems = rows
      .map((row) => {
        const userType = row.employeId ? 'employe' : row.adminId ? 'admin' : '';
        const userId = Number(row.employeId || row.adminId || 0);
        const user = row.employe || row.admin;
        if (!userType || !user || !Number.isInteger(userId) || userId <= 0) return null;

        const pointageDate = new Date(row.dateHeure);
        if (Number.isNaN(pointageDate.getTime())) return null;

        const infosSup = parseJsonObject(user.infosSup);
        const action = mapActionType(row.type);
        const normalizedType = String(row.type || '').trim().toLowerCase();
        const userKey = `${userType}-${userId}`;
        const fallbackBadgeToken = latestBadgeTokenByUser.get(userKey) || null;
        const badgeTokenToUse = row.badgeToken || fallbackBadgeToken;
        const threshold = buildThresholdDateFromTime(
          pointageDate,
          runtimeSettings.work_start_time,
          9,
          0
        );
        const computedRetardMinutes = action.key === 'arrivee'
          ? Math.max(
            Number(row.retardMinutes || 0),
            pointageDate.getTime() > threshold.getTime()
              ? Math.floor((pointageDate.getTime() - threshold.getTime()) / 60000)
              : 0
          )
          : Number(row.retardMinutes || 0);
        const status = mapStatusForScanRow({
          type: row.type,
          pointageDate,
          retardMinutes: computedRetardMinutes
        });
        const retardRecord = retardByPointageId.get(Number(row.id || 0));

        return {
          id: String(row.id || `${userType}-${userId}-${pointageDate.toISOString()}`),
          date: formatDateOnly(pointageDate),
          heure: formatTimeOnly(pointageDate),
          date_time: pointageDate.toISOString(),
          nom_complet: buildDisplayName(user.prenom, user.nom, `${userType} #${userId}`),
          matricule: userType === 'employe'
            ? (user.matricule || buildMatriculeFromIdentity({ id: userId, role: user.role, dateCreation: user.dateCreation }))
            : buildMatriculeFromIdentity({ id: userId, role: user.role || 'admin', dateCreation: user.dateCreation }),
          badge: badgeTokenToUse
            ? previewBadgeTokenValue(badgeTokenToUse.token || badgeTokenToUse.tokenHash)
            : (String(user.badgeId || '').trim() ? previewBadgeTokenValue(user.badgeId) : '-'),
          type: action.label,
          action_type: action.key,
          pointage_type: normalizedType,
          status: status.key,
          status_label: status.label,
          retard_minutes: Number(computedRetardMinutes || 0),
          source: extractScanSourceFromDeviceInfo(row.deviceInfo),
          justification: buildRowJustification(row, retardRecord),
          user_type: userType,
          user_id: userId,
          role: user.role || userType,
          poste: String(user.poste || '').trim() || null,
          departement: String(user.departement || '').trim() || null,
          telephone: String(user.telephone || '').trim() || null,
          email: String(user.email || '').trim() || null,
          email_pro: String(user.emailPro || '').trim() || null,
          adresse: String(user.adresse || '').trim() || null,
          date_embauche: user.dateEmbauche ? new Date(user.dateEmbauche).toISOString().slice(0, 10) : null,
          contrat_type: String(user.contratType || '').trim() || null,
          contrat_duree: String(user.contratDuree || '').trim() || null,
          contrat_pdf_url: String(
            infosSup.contrat_pdf_url
            || infosSup.contrat_pdf
            || infosSup.contratPdfUrl
            || infosSup.contratPdf
            || ''
          ).trim() || null,
          badge_status: badgeTokenToUse?.status === 'active'
            ? 'active'
            : badgeTokenToUse?.status === 'expired'
              ? 'expired'
              : user.badgeActif
                ? 'active'
                : 'inactive',
          photo: normalizePhotoPath(user.photo)
        };
      })
      .filter(Boolean);

    const byUserDay = new Map();
    rawItems.forEach((item) => {
      const timestamp = new Date(item.date_time).getTime();
      if (!Number.isFinite(timestamp)) return;
      const key = `${item.user_type}-${item.user_id}-${item.date}`;

      const current = byUserDay.get(key) || {
        id: `scan-${key}`,
        date: item.date,
        date_time: item.date_time,
        latest_ts: timestamp,
        latest_action_type: item.action_type,
        nom_complet: item.nom_complet,
        matricule: item.matricule,
        badge: item.badge,
        user_type: item.user_type,
        user_id: item.user_id,
        role: item.role,
        poste: item.poste,
        departement: item.departement,
        telephone: item.telephone,
        email: item.email,
        email_pro: item.email_pro,
        adresse: item.adresse,
        date_embauche: item.date_embauche,
        contrat_type: item.contrat_type,
        contrat_duree: item.contrat_duree,
        contrat_pdf_url: item.contrat_pdf_url,
        badge_status: item.badge_status,
        photo: item.photo,
        has_arrivee: false,
        has_pause: false,
        has_depart: false,
        arrivee_ts: null,
        depart_ts: null,
        pause_start_ts: null,
        pause_end_ts: null,
        heure_arrivee: null,
        heure_depart: null,
        heure_pause_debut: null,
        heure_pause_fin: null,
        arrival_status_key: null,
        arrival_status_label: null,
        arrival_retard_minutes: 0,
        depart_status_key: null,
        depart_status_label: null,
        sources: new Set(),
        justifications: new Set()
      };

      if (timestamp >= Number(current.latest_ts || 0)) {
        current.date_time = item.date_time;
        current.latest_ts = timestamp;
        current.latest_action_type = item.action_type;
      }

      if ((!current.badge || current.badge === '-') && item.badge && item.badge !== '-') {
        current.badge = item.badge;
      }

      const source = String(item.source || '').trim();
      if (source) {
        current.sources.add(source);
      }

      const justification = String(item.justification || '').trim();
      if (justification && justification !== '-') {
        current.justifications.add(justification);
      }

      if (item.action_type === 'arrivee') {
        current.has_arrivee = true;
        if (current.arrivee_ts === null || timestamp < current.arrivee_ts) {
          current.arrivee_ts = timestamp;
          current.heure_arrivee = item.heure || null;
          current.arrival_status_key = item.status || null;
          current.arrival_status_label = item.status_label || null;
        }
        current.arrival_retard_minutes = Math.max(
          Number(current.arrival_retard_minutes || 0),
          Number(item.retard_minutes || 0)
        );
      }

      if (item.action_type === 'depart') {
        current.has_depart = true;
        if (current.depart_ts === null || timestamp > current.depart_ts) {
          current.depart_ts = timestamp;
          current.heure_depart = item.heure || null;
          current.depart_status_key = item.status || null;
          current.depart_status_label = item.status_label || null;
        }
      }

      if (item.action_type === 'pause') {
        current.has_pause = true;
        if (item.pointage_type === 'pause_debut') {
          if (current.pause_start_ts === null || timestamp > current.pause_start_ts) {
            current.pause_start_ts = timestamp;
            current.heure_pause_debut = item.heure || null;
          }
        }
        if (item.pointage_type === 'pause_fin') {
          if (current.pause_end_ts === null || timestamp > current.pause_end_ts) {
            current.pause_end_ts = timestamp;
            current.heure_pause_fin = item.heure || null;
          }
        }
      }

      byUserDay.set(key, current);
    });

    let items = Array.from(byUserDay.values()).map((snapshot) => {
      const actionTypes = [];
      if (snapshot.has_arrivee) actionTypes.push('arrivee');
      if (snapshot.has_pause) actionTypes.push('pause');
      if (snapshot.has_depart) actionTypes.push('depart');

      let pauseStatusKey = null;
      let pauseStatusLabel = null;
      let pauseHeureLabel = null;
      if (snapshot.has_pause) {
        const hasStart = Boolean(snapshot.heure_pause_debut);
        const hasEnd = Boolean(snapshot.heure_pause_fin);
        if (hasStart && hasEnd) {
          pauseHeureLabel = `${snapshot.heure_pause_debut} - ${snapshot.heure_pause_fin}`;
          const pauseStartTs = Number(snapshot.pause_start_ts || 0);
          const pauseEndTs = Number(snapshot.pause_end_ts || 0);
          if (pauseEndTs >= pauseStartTs) {
            pauseStatusKey = 'pause_terminee';
            pauseStatusLabel = 'Terminee';
          } else {
            pauseStatusKey = 'pause_en_cours';
            pauseStatusLabel = 'En cours';
          }
        } else if (hasStart) {
          pauseHeureLabel = String(snapshot.heure_pause_debut || '');
          pauseStatusKey = 'pause_en_cours';
          pauseStatusLabel = 'En cours';
        } else if (hasEnd) {
          pauseHeureLabel = String(snapshot.heure_pause_fin || '');
          pauseStatusKey = 'pause_terminee';
          pauseStatusLabel = 'Terminee';
        } else {
          pauseStatusKey = 'indetermine';
          pauseStatusLabel = 'Indetermine';
        }
      }

      const typeParts = [];
      const heureParts = [];
      const statusParts = [];

      if (snapshot.has_arrivee) {
        typeParts.push('Arrivee');
        heureParts.push(`A ${snapshot.heure_arrivee || '-'}`);
        statusParts.push(`A ${snapshot.arrival_status_label || 'Indetermine'}`);
      }

      if (snapshot.has_pause) {
        typeParts.push('Pause');
        heureParts.push(`P ${pauseHeureLabel || '-'}`);
        statusParts.push(`P ${pauseStatusLabel || 'Indetermine'}`);
      }

      if (snapshot.has_depart) {
        const departTypeLabel = snapshot.depart_status_key === 'depart_anticipe'
          ? 'Depart anticipe'
          : 'Depart normal';
        typeParts.push(departTypeLabel);
        heureParts.push(`D ${snapshot.heure_depart || '-'}`);
        statusParts.push(`D ${snapshot.depart_status_label || departTypeLabel}`);
      }

      let statusKey = 'indetermine';
      if (snapshot.arrival_status_key === 'en_retard') {
        statusKey = 'en_retard';
      } else if (snapshot.depart_status_key === 'depart_anticipe') {
        statusKey = 'depart_anticipe';
      } else if (snapshot.depart_status_key === 'depart_normal') {
        statusKey = 'depart_normal';
      } else if (snapshot.arrival_status_key === 'a_l_heure') {
        statusKey = 'a_l_heure';
      }

      const sourceLabel = joinUniqueValues(Array.from(snapshot.sources.values()), ' | ') || '-';
      const justification = joinUniqueValues(Array.from(snapshot.justifications.values()), ' | ') || '-';
      const statusLabel = statusParts.length > 0 ? statusParts.join(' | ') : '-';
      const latestActionType = String(snapshot.latest_action_type || '').trim();

      return {
        id: snapshot.id,
        date: snapshot.date,
        heure: heureParts.join(' | ') || '-',
        date_time: snapshot.date_time,
        nom_complet: snapshot.nom_complet,
        matricule: snapshot.matricule,
        badge: snapshot.badge || '-',
        type: typeParts.join(' | ') || '-',
        action_type: latestActionType || (actionTypes[0] || null),
        action_types: actionTypes,
        status: statusKey,
        status_label: statusLabel,
        retard_minutes: Number(snapshot.arrival_retard_minutes || 0),
        source: sourceLabel,
        justification,
        heure_arrivee: snapshot.heure_arrivee || null,
        heure_pause: pauseHeureLabel || null,
        heure_depart: snapshot.heure_depart || null,
        user_type: snapshot.user_type,
        user_id: snapshot.user_id,
        role: snapshot.role,
        poste: snapshot.poste,
        departement: snapshot.departement,
        telephone: snapshot.telephone,
        email: snapshot.email,
        email_pro: snapshot.email_pro,
        adresse: snapshot.adresse,
        date_embauche: snapshot.date_embauche,
        contrat_type: snapshot.contrat_type,
        contrat_duree: snapshot.contrat_duree,
        contrat_pdf_url: snapshot.contrat_pdf_url,
        badge_status: snapshot.badge_status,
        photo: snapshot.photo
      };
    });

    if (search) {
      items = items.filter((item) => {
        const haystack = [
          item.nom_complet,
          item.matricule,
          item.badge,
          item.type,
          item.heure,
          item.status_label,
          item.justification,
          item.source,
          item.poste || '',
          item.departement || ''
        ].join(' ').toLowerCase();
        return haystack.includes(search);
      });
    }

    items.sort((left, right) => new Date(right.date_time).getTime() - new Date(left.date_time).getTime());

    const latest = items[0] || null;
    let lastUser = null;
    if (latest) {
      const [prenom = '', ...rest] = String(latest.nom_complet || '').split(' ');
      lastUser = {
        id: latest.user_id,
        user_type: latest.user_type,
        nom_complet: latest.nom_complet,
        matricule: latest.matricule,
        prenom,
        nom: rest.join(' '),
        role: latest.role,
        badge_status: latest.badge_status,
        email: latest.email,
        email_pro: latest.email_pro,
        telephone: latest.telephone,
        poste: latest.poste,
        departement: latest.departement,
        adresse: latest.adresse,
        date_embauche: latest.date_embauche,
        contrat_type: latest.contrat_type,
        contrat_duree: latest.contrat_duree,
        contrat_pdf_url: latest.contrat_pdf_url,
        photo: latest.photo
      };
    }

    return res.json({
      success: true,
      period,
      range: {
        start: start.toISOString(),
        end: end.toISOString()
      },
      total: items.length,
      items,
      last_user: lastUser,
      last_pointage: latest
    });
  } catch (error) {
    console.error('Erreur public/scan_history:', error);
    return res.status(500).json({
      success: false,
      message: "Erreur lors de la recuperation de l'historique des scans"
    });
  }
});

const handleScanQrRequest = async (req, res) => {
  try {
    const requester = req.user?.user;
    const requesterType = String(req.user?.userType || '').trim().toLowerCase();
    const requesterId = Number(requester?.id || 0);
    const hasAuthenticatedRequester =
      requesterId > 0
      && ['admin', 'employe'].includes(requesterType);

    if (!hasAuthenticatedRequester) {
      return res.status(401).json({ success: false, message: 'Session invalide' });
    }

    const badgeAccess = req.badgeAccess;
    if (!badgeAccess?.badgeToken) {
      return res.status(403).json({
        success: false,
        message: resolveBadgeAccessMessage('BADGE_NOT_FOUND'),
        code: 'BADGE_NOT_FOUND',
        badge_status: 'inactive',
        redirect_to: badgeAccess?.dashboardPath || resolveDashboardPathForSession({
          userType: requesterType,
          role: requester?.role
        })
      });
    }

    const badgeData = String(req.body?.badge_data || req.body?.badge || req.body?.token || '').trim();
    if (!badgeData) {
      return res.status(400).json({ success: false, message: 'Donnees badge manquantes' });
    }

    const parsedToken = parseBadgeRawToken(badgeData);
    const tokenHash = parsedToken
      ? parsedToken.tokenHash
      : isLikelyTokenHash(badgeData)
        ? badgeData.toLowerCase()
        : null;

    if (!tokenHash) {
      return res.status(400).json({ success: false, message: 'Format de badge invalide' });
    }

    const ipAddress = req.ip || 'unknown';
    const deviceInfoPayload = req.body?.device_info
      ? JSON.stringify(req.body.device_info)
      : (req.get('user-agent') || null);

    const activeToken = badgeAccess.badgeToken;
    const targetType = requesterType;
    const targetUser = requester || badgeAccess.user;
    const targetUserId = requesterId;
    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'Utilisateur du badge introuvable' });
    }

    const targetMatricule = targetType === 'employe'
      ? (targetUser.matricule
        || buildMatriculeFromIdentity({
          id: targetUser.id,
          role: targetUser.role,
          dateCreation: targetUser.dateCreation
        }))
      : buildMatriculeFromIdentity({
        id: targetUser.id,
        role: targetUser.role || 'admin',
        dateCreation: targetUser.dateCreation
      });

    if (parsedToken) {
      if (parsedToken.userId !== targetUserId) {
        return res.status(403).json({ success: false, message: 'Badge invalide' });
      }
      if (parsedToken.userType && parsedToken.userType !== targetType) {
        return res.status(403).json({ success: false, message: 'Badge invalide' });
      }
    }

    if (tokenHash !== activeToken.tokenHash) {
      try {
        await prisma.badgeScan.create({
          data: {
            tokenId: activeToken.id,
            tokenHash,
            ipAddress,
            deviceInfo: deviceInfoPayload,
            isValid: false,
            validationDetails: { reason: 'token_mismatch' },
            scanType: 'access'
          }
        });
      } catch {
        // Ignore badge scan log failures.
      }
      return res.status(403).json({
        success: false,
        message: 'Badge non associe a votre session.',
        code: 'BADGE_NOT_ASSOCIATED',
        badge_status: 'inactive'
      });
    }

    const scannedToken = await prisma.badgeToken.findUnique({
      where: { id: activeToken.id },
      include: {
        employe: true,
        admin: true
      }
    });

    if (!scannedToken) {
      return res.status(404).json({
        success: false,
        message: 'Badge introuvable',
        code: 'BADGE_NOT_FOUND',
        badge_status: 'unknown'
      });
    }

    const runtimeSettings = await getSystemRuntimeSettings();
    const now = new Date();

    let expiredByDate = scannedToken.expiresAt ? new Date(scannedToken.expiresAt).getTime() <= now.getTime() : false;

    if (scannedToken.status !== 'active' || expiredByDate) {
      const badgeStatus = scannedToken.status !== 'active' ? 'inactive' : 'expired';
      const statusCode = badgeStatus === 'inactive' ? 'BADGE_INACTIVE' : 'BADGE_EXPIRED';
      try {
        await prisma.badgeScan.create({
          data: {
            tokenId: scannedToken.id,
            tokenHash: scannedToken.tokenHash,
            ipAddress,
            deviceInfo: deviceInfoPayload,
            isValid: false,
            validationDetails: {
              reason: badgeStatus
            },
            scanType: 'access'
          }
        });
      } catch {
        // Ignore badge scan log failures.
      }
      return res.status(403).json({
        success: false,
        message: badgeStatus === 'inactive' ? 'Badge desactive' : 'Badge expire',
        code: statusCode,
        badge_status: badgeStatus,
        data: {
          badge_status: badgeStatus,
          user: buildPublicScanUserPayload({
            targetType,
            targetUser,
            targetUserId,
            targetMatricule,
            badgeStatus
          })
        }
      });
    }

    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const userScope = getPointageUserScope(targetType, targetUserId);
    const todayPointages = await prisma.pointage.findMany({
      where: {
        ...userScope,
        dateHeure: { gte: startOfDay, lte: endOfDay }
      },
      select: {
        type: true,
        dateHeure: true
      },
      orderBy: { dateHeure: 'asc' }
    });

    const pauseStatus = computePauseStatusFromPointages({
      pointages: todayPointages,
      runtimeSettings,
      now
    });
    const hasOpenShift = Boolean(pauseStatus.has_open_shift);
    const hasOpenPause = Boolean(pauseStatus.has_open_pause);
    const hasReachedPauseQuota = Number(pauseStatus.remaining_pause_minutes || 0) <= 0;
    const afterCutoff = isPastSecondScanCutoff(now);

    const normalizeScanAction = (value) => {
      const raw = String(value || '').trim().toLowerCase();
      if (!raw) return null;
      if (raw === 'pause' || raw === 'aller_en_pause' || raw === 'pause_debut') return 'pause';
      if (
        raw === 'depart_anticipe'
        || raw === 'depart-anticipe'
        || raw === 'depart anticipe'
        || raw === 'depart'
      ) return 'depart_anticipe';
      if (raw === 'annuler' || raw === 'cancel') return 'annuler';
      return null;
    };
    const scanAction = normalizeScanAction(req.body?.scan_action || req.body?.action);
    let pointageType = hasOpenShift ? 'depart' : 'arrivee';

    if (targetType === 'employe' && hasOpenShift) {
      const availableActions = [];
      if (!afterCutoff && !hasOpenPause && !hasReachedPauseQuota) {
        availableActions.push('pause');
      }
      availableActions.push('depart_anticipe');

      if (!scanAction || scanAction === 'annuler') {
        if (!afterCutoff) {
          return res.status(409).json({
            success: false,
            message: 'Arrivee deja enregistree aujourd hui. Choisissez: aller en pause ou depart anticipe.',
            code: 'SECOND_SCAN_ACTION_REQUIRED',
            error_type: 'ACTION_REQUIRED',
            badge_status: 'active',
            data: {
              badge_status: 'active',
              type: 'arrivee',
              available_actions: availableActions,
              pause_status: pauseStatus,
              user: buildPublicScanUserPayload({
                targetType,
                targetUser,
                targetUserId,
                targetMatricule,
                badgeStatus: 'active'
              })
            }
          });
        }

        pointageType = 'depart';
      }

      if (scanAction && scanAction !== 'annuler') {
        if (scanAction === 'pause') {
          if (afterCutoff) {
            return res.status(409).json({
              success: false,
              message: 'Apres 18:00, la pause n est plus autorisee. Enregistrez un depart.',
              code: 'PAUSE_NOT_ALLOWED_AFTER_CUTOFF',
              error_type: 'ACTION_FORBIDDEN',
              badge_status: 'active',
              data: {
                available_actions: ['depart_anticipe'],
                pause_status: pauseStatus
              }
            });
          }

          if (hasOpenPause) {
            return res.status(409).json({
              success: false,
              message: 'Une pause est deja active. Reprenez dabord avant une nouvelle pause.',
              code: 'PAUSE_ALREADY_ACTIVE',
              error_type: 'POINTAGE_DUPLICATE',
              badge_status: 'active',
              data: { pause_status: pauseStatus }
            });
          }

          if (hasReachedPauseQuota) {
            return res.status(409).json({
              success: false,
              message: 'Quota de pause journalier atteint. Seul le depart anticipe est autorise.',
              code: 'PAUSE_QUOTA_EXCEEDED',
              error_type: 'ACTION_FORBIDDEN',
              badge_status: 'active',
              data: {
                available_actions: ['depart_anticipe'],
                pause_status: pauseStatus
              }
            });
          }

          pointageType = 'pause_debut';
        } else if (scanAction === 'depart_anticipe') {
          pointageType = 'depart';
        } else {
          return res.status(400).json({
            success: false,
            message: 'Action de scan invalide.',
            code: 'INVALID_SCAN_ACTION'
          });
        }
      }
    } else if (scanAction === 'pause') {
      if (!hasOpenShift) {
        return res.status(409).json({
          success: false,
          message: "Impossible de demarrer une pause sans pointage d'arrivee actif.",
          code: 'SHIFT_NOT_OPEN'
        });
      }
      if (hasOpenPause) {
        return res.status(409).json({
          success: false,
          message: 'Une pause est deja active.',
          code: 'PAUSE_ALREADY_ACTIVE'
        });
      }
      if (hasReachedPauseQuota) {
        return res.status(409).json({
          success: false,
          message: 'Quota de pause journalier atteint.',
          code: 'PAUSE_QUOTA_EXCEEDED'
        });
      }
      pointageType = 'pause_debut';
    }

    const duplicateSince = new Date(now.getTime() - 30 * 60 * 1000);
    const duplicate = await prisma.pointage.findFirst({
      where: {
        ...userScope,
        type: pointageType,
        dateHeure: { gte: duplicateSince }
      },
      orderBy: { dateHeure: 'desc' }
    });

    if (duplicate) {
      const lastTime = new Date(duplicate.dateHeure).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      const duplicateCode = pointageType === 'depart'
        ? 'DEPART_ALREADY_REGISTERED'
        : pointageType === 'pause_debut'
          ? 'PAUSE_ALREADY_REGISTERED'
          : 'ARRIVEE_ALREADY_REGISTERED';
      return res.status(409).json({
        success: false,
        message: `Pointage ${pointageType} deja enregistre a ${lastTime} (moins de 30 minutes).`,
        code: duplicateCode,
        error_type: 'POINTAGE_DUPLICATE',
        duplicate_type: pointageType,
        badge_status: 'active',
        data: {
          badge_status: 'active',
          type: pointageType,
          user: buildPublicScanUserPayload({
            targetType,
            targetUser,
            targetUserId,
            targetMatricule,
            badgeStatus: 'active'
          })
        }
      });
    }

    let retardMinutes = 0;
    let departAnticipeMinutes = 0;
    let needsJustification = false;
    let justificationReason = null;

    if (pointageType === 'arrivee') {
      const arrivalThreshold = buildThresholdDateFromTime(
        now,
        runtimeSettings.work_start_time,
        9,
        0
      );
      retardMinutes = now > arrivalThreshold ? Math.floor((now.getTime() - arrivalThreshold.getTime()) / 60000) : 0;
      if (retardMinutes > 0 && targetType === 'employe') {
        needsJustification = true;
        justificationReason = 'retard';
      }
    }

    if (pointageType === 'depart') {
      const departureThreshold = buildThresholdDateFromTime(
        now,
        runtimeSettings.work_end_time,
        18,
        0
      );
      departAnticipeMinutes = now < departureThreshold ? Math.floor((departureThreshold.getTime() - now.getTime()) / 60000) : 0;
      if (departAnticipeMinutes > 0 && targetType === 'employe') {
        needsJustification = true;
        justificationReason = 'depart_anticipe';
      }
    }

    if (pointageType === 'depart') {
      const workedMinutes = getMinutesFromOpenShiftStart(todayPointages, now);
      if (workedMinutes < MINIMUM_WORK_DURATION_MINUTES) {
        const remainingMinutes = MINIMUM_WORK_DURATION_MINUTES - workedMinutes;
        return res.status(409).json({
          success: false,
          message: `Depart refuse: duree minimale de 4h non atteinte (reste ${remainingMinutes} min).`,
          code: 'MINIMUM_SHIFT_DURATION_NOT_REACHED',
          error_type: 'BUSINESS_RULE_VIOLATION',
          data: {
            badge_status: 'active',
            minimum_minutes: MINIMUM_WORK_DURATION_MINUTES,
            worked_minutes: workedMinutes,
            remaining_minutes: remainingMinutes,
            user: buildPublicScanUserPayload({
              targetType,
              targetUser,
              targetUserId,
              targetMatricule,
              badgeStatus: 'active'
            })
          }
        });
      }
    }

    const providedJustification = normalizeJustificationText(
      req.body?.justification
      ?? req.body?.motif
      ?? req.body?.raison
      ?? req.body?.commentaire
    );
    const requiredReason = getRequiredJustificationReason({
      pointageType,
      retardMinutes,
      departAnticipeMinutes
    });
    const justificationIsRequired = isJustificationRequiredForPointage({
      pointageType,
      retardMinutes,
      departAnticipeMinutes
    });

    if (justificationIsRequired && providedJustification.length < JUSTIFICATION_MIN_LENGTH) {
      return res.status(422).json({
        success: false,
        message: `Justification obligatoire (${JUSTIFICATION_MIN_LENGTH} caracteres minimum).`,
        code: 'JUSTIFICATION_REQUIRED',
        error_type: 'VALIDATION_ERROR',
        data: {
          badge_status: 'active',
          required_reason: requiredReason,
          min_length: JUSTIFICATION_MIN_LENGTH,
          pointage_type: pointageType,
          user: buildPublicScanUserPayload({
            targetType,
            targetUser,
            targetUserId,
            targetMatricule,
            badgeStatus: 'active'
          })
        }
      });
    }

    const createdPointage = await prisma.pointage.create({
      data: {
        ...userScope,
        type: pointageType,
        dateHeure: now,
        datePointage: startOfDay,
        etat: pointageType === 'pause_debut' ? 'normal' : retardMinutes > 0 ? 'retard' : 'normal',
        statut: 'present',
        retardMinutes,
        estJustifie: justificationIsRequired ? false : !needsJustification,
        commentaire: providedJustification || null,
        badgeTokenId: scannedToken.id,
        ipAddress,
        deviceInfo: deviceInfoPayload
      }
    });

    await prisma.badgeToken.update({
      where: { id: scannedToken.id },
      data: {
        lastUsedAt: now,
        usageCount: { increment: 1 }
      }
    });

    try {
      await prisma.badgeScan.create({
        data: {
          tokenId: scannedToken.id,
          tokenHash: scannedToken.tokenHash,
          ipAddress,
          deviceInfo: deviceInfoPayload,
          isValid: true,
          validationDetails: {
            pointage_id: createdPointage.id,
            type: pointageType,
            retard_minutes: retardMinutes,
            depart_anticipe_minutes: departAnticipeMinutes
          },
          scanType: pointageType === 'arrivee' ? 'arrival' : pointageType === 'depart' ? 'departure' : 'access'
        }
      });
    } catch {
      // Ignore badge scan log failures.
    }

    if ((needsJustification || requiredReason) && targetType === 'employe') {
      const details = justificationReason === 'retard'
        ? `Retard de ${retardMinutes} minute(s). Justification: ${providedJustification || 'non fournie'}`
        : justificationReason === 'depart_anticipe'
          ? `Depart anticipe de ${departAnticipeMinutes} minute(s). Justification: ${providedJustification || 'non fournie'}`
          : `Justification (${requiredReason || 'pointage'}): ${providedJustification || 'non fournie'}`;

      await prisma.retard.create({
        data: {
          pointageId: createdPointage.id,
          employeId: targetUserId,
          raison: requiredReason || justificationReason || 'justification',
          details,
          statut: 'en_attente'
        }
      });
    }

    if (targetType === 'employe') {
      await notifyPointageCreated({
        employeId: targetUserId,
        pointageId: createdPointage.id,
        pointageType,
        retardMinutes,
        departAnticipeMinutes,
        dateHeure: now
      });
    }

    return res.status(201).json({
      success: true,
      message: pointageType === 'pause_debut'
        ? 'Pause enregistree avec succes'
        : 'Pointage enregistre avec succes',
      pointage: mapPointageForDashboard(createdPointage),
      data: {
        badge_status: 'active',
        type: pointageType,
        retard_minutes: retardMinutes,
        depart_anticipe_minutes: departAnticipeMinutes,
        needs_justification: false,
        justification_reason: requiredReason || justificationReason,
        date: formatDateOnly(now),
        heure: now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
        user: buildPublicScanUserPayload({
          targetType,
          targetUser,
          targetUserId,
          targetMatricule,
          badgeStatus: 'active'
        })
      }
    });
  } catch (error) {
    console.error('Erreur scan_qr:', error);
    return res.status(500).json({ success: false, message: 'Erreur lors du scan du badge' });
  }
};

app.post('/api/public/scan_qr', validateToken, requireAuthenticatedSessionWithActiveBadge, handleScanQrRequest);
app.post('/api/scan_qr/public', validateToken, requireAuthenticatedSessionWithActiveBadge, handleScanQrRequest);
app.post('/api/scan_qr', validateToken, requireAuthenticatedSessionWithActiveBadge, handleScanQrRequest);
app.post('/api/employe/scan_qr', validateToken, requireAuthenticatedSessionWithActiveBadge, handleScanQrRequest);

app.get('/api/employe/pause/status', validateToken, requireAuthenticatedSessionWithActiveBadge, async (req, res) => {
  try {
    if (req.user?.userType !== 'employe') {
      return res.status(403).json({ success: false, message: 'Acces reserve aux employes' });
    }

    const employeId = Number(req.user?.user?.id || 0);
    if (!Number.isInteger(employeId) || employeId <= 0) {
      return res.status(401).json({ success: false, message: 'Session invalide' });
    }

    const [runtimeSettings, pointages] = await Promise.all([
      getSystemRuntimeSettings(),
      listEmployePointagesForDay(employeId, new Date())
    ]);

    const pauseStatus = computePauseStatusFromPointages({
      pointages,
      runtimeSettings,
      now: new Date()
    });

    return res.json({
      success: true,
      pause_status: pauseStatus
    });
  } catch (error) {
    console.error('Erreur employe/pause/status:', error);
    return res.status(500).json({ success: false, message: 'Erreur lors du chargement du statut de pause' });
  }
});

app.post('/api/employe/pause/toggle', validateToken, requireAuthenticatedSessionWithActiveBadge, async (req, res) => {
  try {
    if (req.user?.userType !== 'employe') {
      return res.status(403).json({ success: false, message: 'Acces reserve aux employes' });
    }

    const employeId = Number(req.user?.user?.id || 0);
    if (!Number.isInteger(employeId) || employeId <= 0) {
      return res.status(401).json({ success: false, message: 'Session invalide' });
    }

    const rawAction = String(req.body?.action || req.body?.type || '').trim().toLowerCase();
    const normalizedAction = rawAction === 'start'
      || rawAction === 'pause'
      || rawAction === 'pause_debut'
      || rawAction === 'aller_en_pause'
      || rawAction === 'debut'
      ? 'start'
      : rawAction === 'end'
        || rawAction === 'resume'
        || rawAction === 'pause_fin'
        || rawAction === 'fin'
        || rawAction === 'reprendre'
        ? 'end'
        : 'toggle';
    const requestedMinutesRaw = Number.parseInt(String(req.body?.requested_minutes ?? req.body?.pause_minutes ?? '').trim(), 10);
    const requestedMinutes = Number.isInteger(requestedMinutesRaw) && requestedMinutesRaw > 0
      ? requestedMinutesRaw
      : null;
    const pauseReason = normalizeJustificationText(
      req.body?.pause_reason
      ?? req.body?.reason
      ?? req.body?.commentaire
      ?? req.body?.motif
    );

    const now = new Date();
    const [runtimeSettings, pointages] = await Promise.all([
      getSystemRuntimeSettings(),
      listEmployePointagesForDay(employeId, now)
    ]);

    const currentPauseStatus = computePauseStatusFromPointages({
      pointages,
      runtimeSettings,
      now
    });

    const wantsStart = normalizedAction === 'start'
      || (normalizedAction === 'toggle' && !currentPauseStatus.has_open_pause);
    const nextType = wantsStart ? 'pause_debut' : 'pause_fin';

    if (wantsStart) {
      if (!currentPauseStatus.has_open_shift) {
        return res.status(409).json({
          success: false,
          message: "Impossible de demarrer une pause sans pointage d'arrivee actif.",
          code: 'PAUSE_SHIFT_REQUIRED',
          pause_status: currentPauseStatus
        });
      }
      if (currentPauseStatus.has_open_pause) {
        return res.status(409).json({
          success: false,
          message: 'Une pause est deja active.',
          code: 'PAUSE_ALREADY_ACTIVE',
          pause_status: currentPauseStatus
        });
      }
      if (currentPauseStatus.remaining_pause_minutes <= 0) {
        return res.status(409).json({
          success: false,
          message: 'Limite de pause journaliere atteinte.',
          code: 'PAUSE_LIMIT_REACHED',
          pause_status: currentPauseStatus
        });
      }
      if (requestedMinutes !== null && requestedMinutes > Number(currentPauseStatus.remaining_pause_minutes || 0)) {
        return res.status(409).json({
          success: false,
          message: `Temps de pause demande superieur au quota restant (${currentPauseStatus.remaining_pause_minutes} min).`,
          code: 'PAUSE_REQUEST_EXCEEDS_QUOTA',
          pause_status: currentPauseStatus
        });
      }
    } else if (!currentPauseStatus.has_open_pause) {
      return res.status(409).json({
        success: false,
        message: 'Aucune pause active a terminer.',
        code: 'PAUSE_NOT_ACTIVE',
        pause_status: currentPauseStatus
      });
    }

    const duplicateSince = new Date(now.getTime() - 60 * 1000);
    const duplicate = await prisma.pointage.findFirst({
      where: {
        employeId,
        type: nextType,
        dateHeure: { gte: duplicateSince }
      },
      orderBy: { dateHeure: 'desc' }
    });
    if (duplicate) {
      return res.status(409).json({
        success: false,
        message: 'Action de pause deja enregistree il y a moins de 1 minute.',
        code: 'PAUSE_DUPLICATE',
        pause_status: currentPauseStatus
      });
    }

    const { start: startOfDay } = buildDayRange(now);
    const createdPointage = await prisma.pointage.create({
      data: {
        employeId,
        type: nextType,
        dateHeure: now,
        datePointage: startOfDay,
        etat: 'normal',
        statut: 'present',
        retardMinutes: 0,
        estJustifie: true,
        commentaire: wantsStart
          ? [
            requestedMinutes ? `Pause demandee: ${requestedMinutes} min` : null,
            pauseReason ? `Motif: ${pauseReason}` : null
          ].filter(Boolean).join(' | ') || null
          : null,
        ipAddress: req.ip || null,
        deviceInfo: req.get('user-agent') || null
      }
    });

    await notifyPointageCreated({
      employeId,
      pointageId: createdPointage.id,
      pointageType: nextType,
      retardMinutes: 0,
      departAnticipeMinutes: 0,
      dateHeure: now
    });

    const refreshedPointages = await listEmployePointagesForDay(employeId, now);
    const pauseStatus = computePauseStatusFromPointages({
      pointages: refreshedPointages,
      runtimeSettings,
      now: new Date()
    });

    return res.status(201).json({
      success: true,
      message: nextType === 'pause_debut'
        ? 'Pause demarree avec succes.'
        : 'Pause terminee avec succes.',
      action: nextType === 'pause_debut' ? 'start' : 'end',
      requested_minutes: requestedMinutes,
      pointage: mapPointageForDashboard(createdPointage),
      pause_status: pauseStatus
    });
  } catch (error) {
    console.error('Erreur employe/pause/toggle:', error);
    return res.status(500).json({ success: false, message: 'Erreur lors de la gestion de la pause' });
  }
});

const listOpenPauseSnapshotsForDay = async ({ referenceDate = new Date(), runtimeSettings = null } = {}) => {
  const now = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
  const { start, end } = buildDayRange(now);
  const effectiveRuntimeSettings = runtimeSettings || await getSystemRuntimeSettings();

  const rows = await prisma.pointage.findMany({
    where: {
      employeId: { not: null },
      dateHeure: { gte: start, lte: end },
      type: { in: ['arrivee', 'depart', 'pause_debut', 'pause_fin'] }
    },
    include: {
      employe: {
        select: {
          id: true,
          prenom: true,
          nom: true,
          matricule: true,
          role: true,
          departement: true
        }
      }
    },
    orderBy: [{ employeId: 'asc' }, { dateHeure: 'asc' }]
  });

  const grouped = new Map();
  rows.forEach((row) => {
    const employeId = Number(row.employeId || 0);
    if (!Number.isInteger(employeId) || employeId <= 0) return;
    const current = grouped.get(employeId) || { employe: row.employe || null, pointages: [] };
    current.pointages.push(row);
    grouped.set(employeId, current);
  });

  const snapshots = [];
  for (const [employeId, group] of grouped.entries()) {
    const pauseStatus = computePauseStatusFromPointages({
      pointages: group.pointages,
      runtimeSettings: effectiveRuntimeSettings,
      now
    });
    if (!pauseStatus.has_open_pause) continue;

    const startedAt = pauseStatus.open_pause_started_at
      ? new Date(pauseStatus.open_pause_started_at)
      : null;

    snapshots.push({
      employe_id: employeId,
      employe: group.employe,
      pause_status: pauseStatus,
      open_pause_started_at: startedAt && !Number.isNaN(startedAt.getTime()) ? startedAt.toISOString() : null
    });
  }

  snapshots.sort((left, right) => {
    const leftTs = left.open_pause_started_at ? new Date(left.open_pause_started_at).getTime() : 0;
    const rightTs = right.open_pause_started_at ? new Date(right.open_pause_started_at).getTime() : 0;
    return leftTs - rightTs;
  });

  return snapshots;
};

app.get('/api/admin/pause/status', validateToken, requireRoleManagementAccess, requireAuthenticatedSessionWithActiveBadge, async (req, res) => {
  try {
    if (req.user?.userType !== 'admin') {
      return res.status(403).json({ success: false, message: 'Acces reserve aux administrateurs' });
    }

    const runtimeSettings = await getSystemRuntimeSettings();
    const snapshots = await listOpenPauseSnapshotsForDay({
      referenceDate: new Date(),
      runtimeSettings
    });

    return res.json({
      success: true,
      has_open_pause: snapshots.length > 0,
      current_pause: snapshots[0] || null,
      open_pauses: snapshots,
      count: snapshots.length
    });
  } catch (error) {
    console.error('Erreur admin/pause/status:', error);
    return res.status(500).json({ success: false, message: 'Erreur lors du chargement des pauses actives' });
  }
});

app.post('/api/admin/pause/force-end', validateToken, requireRoleManagementAccess, requireAuthenticatedSessionWithActiveBadge, async (req, res) => {
  try {
    if (req.user?.userType !== 'admin') {
      return res.status(403).json({ success: false, message: 'Acces reserve aux administrateurs' });
    }

    const adminId = Number(req.user?.user?.id || 0);
    if (!Number.isInteger(adminId) || adminId <= 0) {
      return res.status(401).json({ success: false, message: 'Session invalide' });
    }

    const requestedEmployeId = Number(req.body?.employe_id ?? req.body?.employeId ?? 0) || null;
    const now = new Date();
    const runtimeSettings = await getSystemRuntimeSettings();
    const snapshots = await listOpenPauseSnapshotsForDay({
      referenceDate: now,
      runtimeSettings
    });

    const targetSnapshot = Number.isInteger(requestedEmployeId) && requestedEmployeId > 0
      ? snapshots.find((item) => item.employe_id === requestedEmployeId)
      : snapshots[0];

    if (!targetSnapshot) {
      return res.status(409).json({
        success: false,
        message: 'Aucune pause active a forcer.',
        code: 'PAUSE_NOT_ACTIVE'
      });
    }

    const employeId = Number(targetSnapshot.employe_id || 0);
    const duplicateSince = new Date(now.getTime() - 60 * 1000);
    const duplicate = await prisma.pointage.findFirst({
      where: {
        employeId,
        type: 'pause_fin',
        dateHeure: { gte: duplicateSince }
      },
      orderBy: { dateHeure: 'desc' }
    });
    if (duplicate) {
      return res.status(409).json({
        success: false,
        message: 'Une fin de pause a deja ete enregistree il y a moins d une minute.',
        code: 'PAUSE_DUPLICATE'
      });
    }

    const { start: startOfDay } = buildDayRange(now);
    const createdPointage = await prisma.pointage.create({
      data: {
        employeId,
        adminId,
        type: 'pause_fin',
        dateHeure: now,
        datePointage: startOfDay,
        etat: 'normal',
        statut: 'present',
        retardMinutes: 0,
        estJustifie: true,
        commentaire: `Fin de pause forcee par admin #${adminId}`,
        ipAddress: req.ip || null,
        deviceInfo: req.get('user-agent') || null
      }
    });

    await notifyPointageCreated({
      employeId,
      pointageId: createdPointage.id,
      pointageType: 'pause_fin',
      retardMinutes: 0,
      departAnticipeMinutes: 0,
      dateHeure: now
    });

    await createEmployeNotification({
      employeId,
      title: 'Pause terminee par l administration',
      message: 'Votre pause active a ete cloturee par un administrateur.',
      type: 'pointage',
      level: 'info',
      pointageId: createdPointage.id,
      lien: '/employee/historique',
      date: now
    });

    const refreshedPointages = await listEmployePointagesForDay(employeId, now);
    const pauseStatus = computePauseStatusFromPointages({
      pointages: refreshedPointages,
      runtimeSettings,
      now
    });

    return res.status(201).json({
      success: true,
      message: 'Pause terminee manuellement.',
      employe: targetSnapshot.employe || null,
      action: 'force_end',
      pointage: mapPointageForDashboard(createdPointage),
      pause_status: pauseStatus
    });
  } catch (error) {
    console.error('Erreur admin/pause/force-end:', error);
    return res.status(500).json({ success: false, message: 'Erreur lors de la cloture de pause' });
  }
});

app.post('/api/employe/demandes', validateToken, async (req, res) => {
  try {
    if (req.user?.userType !== 'employe') {
      return res.status(403).json({ success: false, message: 'Accès réservé aux employés' });
    }

    const { type, date_debut, date_fin, motif } = req.body || {};
    if (!type || !date_debut || !motif) {
      return res.status(400).json({ success: false, message: 'Type, date de début et motif requis' });
    }

    const demande = await prisma.demande.create({
      data: {
        employeId: req.user.user.id,
        type: normalizeDemandeType(type),
        raison: motif,
        commentaire: JSON.stringify({
          originalType: type,
          dateDebut: date_debut,
          dateFin: date_fin || date_debut
        })
      }
    });

    res.status(201).json({
      success: true,
      message: 'Demande soumise',
      demande: mapDemandeForDashboard(demande)
    });
  } catch (error) {
    console.error('Erreur employe/demandes:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// Badge endpoints
app.get('/api/badges', validateToken, requireRoleManagementAccess, async (req, res) => {
  try {
    const status = String(req.query.status || '').trim().toLowerCase();
    const userRole = String(req.query.user_role || '').trim().toLowerCase();
    const search = String(req.query.search || '').trim().toLowerCase();
    const includeHistory = String(req.query.history || '').trim().toLowerCase() === 'all';

    const where = buildBadgeVisibilityWhere(req, {});
    if (status === 'active') {
      where.status = 'active';
      where.expiresAt = { gt: new Date() };
    } else if (status === 'expired') {
      where.OR = [
        { status: 'expired' },
        { status: 'active', expiresAt: { lte: new Date() } }
      ];
    } else if (status === 'inactive') {
      where.status = 'revoked';
    }

    const tokens = await prisma.badgeToken.findMany({
      where,
      include: {
        employe: true,
        admin: true
      },
      orderBy: { createdAt: 'desc' },
      take: 500
    });

    let mapped = tokens.map(mapBadgeTokenForUi);
    if (!includeHistory) {
      const latestByUser = new Map();
      for (const item of mapped) {
        const key = `${item.user_type}-${item.user_id}`;
        if (!latestByUser.has(key)) {
          latestByUser.set(key, item);
        }
      }
      mapped = Array.from(latestByUser.values());
    }

    if (userRole) {
      mapped = mapped.filter((item) => String(item.user_role || '').toLowerCase() === userRole);
    }

    if (search) {
      mapped = mapped.filter((item) => {
        return (
          String(item.user_name || '').toLowerCase().includes(search) ||
          String(item.user_email || '').toLowerCase().includes(search) ||
          String(item.token || '').toLowerCase().includes(search) ||
          String(item.token_hash || '').toLowerCase().includes(search)
        );
      });
    }

    res.json({ success: true, badges: mapped, total: mapped.length });
  } catch (error) {
    console.error('Erreur badges list:', error);
    res.status(500).json({ success: false, message: 'Erreur lors de la recuperation des badges' });
  }
});

app.put('/api/badges/status-all', validateToken, requireRoleManagementAccess, async (req, res) => {
  try {
    const requestedStatus = String(req.body?.status || '').trim().toLowerCase();
    if (!['active', 'inactive'].includes(requestedStatus)) {
      return res.status(400).json({ success: false, message: 'Statut global invalide' });
    }

    const allTokens = await prisma.badgeToken.findMany({
      where: buildBadgeVisibilityWhere(req, {}),
      include: { employe: true, admin: true },
      orderBy: { createdAt: 'desc' },
      take: 2000
    });

    const latestByUser = new Map();
    for (const token of allTokens) {
      const key = token.employeId ? `employe-${token.employeId}` : `admin-${token.adminId}`;
      if (!latestByUser.has(key)) {
        latestByUser.set(key, token);
      }
    }

    const latestTokens = Array.from(latestByUser.values());
    const mapped = [];
    const runtimeSettings = await getSystemRuntimeSettings();

    for (const token of latestTokens) {
      // Sequential by design to avoid race conditions on active token revocation.
      // eslint-disable-next-line no-await-in-loop
      const updatedToken = await prisma.$transaction(async (tx) => {
        const now = new Date();
        const status = requestedStatus === 'active' ? 'active' : 'revoked';
        const row = await tx.badgeToken.update({
          where: { id: token.id },
          data: {
            status,
            revokedAt: status === 'revoked' ? now : null,
            ...(status === 'active'
              ? {
                expiresAt: computeBadgeExpiry(now, {
                  badgeExpirationHours: runtimeSettings.badge_expiration_hours
                })
              }
              : {})
          },
          include: { employe: true, admin: true }
        });

        if (status === 'active') {
          await tx.badgeToken.updateMany({
            where: {
              id: { not: row.id },
              status: 'active',
              ...(row.employeId ? { employeId: row.employeId } : { adminId: row.adminId })
            },
            data: {
              status: 'revoked',
              revokedAt: new Date()
            }
          });
        }

        return row;
      });

      mapped.push(mapBadgeTokenForUi(updatedToken));
    }

    res.json({
      success: true,
      message: requestedStatus === 'active'
        ? 'Tous les badges ont ete actives'
        : 'Tous les badges ont ete desactives',
      updated_count: mapped.length,
      badges: mapped
    });
  } catch (error) {
    console.error('Erreur badges status-all:', error);
    res.status(500).json({ success: false, message: 'Erreur lors de la mise a jour globale des badges' });
  }
});

app.put('/api/badges/:id/status', validateToken, requireRoleManagementAccess, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ success: false, message: 'Identifiant badge invalide' });
    }

    const requestedStatus = String(req.body?.status || '').trim().toLowerCase();
    if (!['active', 'inactive', 'expired'].includes(requestedStatus)) {
      return res.status(400).json({ success: false, message: 'Statut badge invalide' });
    }

    const existing = await prisma.badgeToken.findUnique({
      where: { id },
      include: { employe: true, admin: true }
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Badge non trouve' });
    }
    if (!isBadgeManagedByRequester(req, existing)) {
      return res.status(403).json({ success: false, message: 'Acces refuse: badge reserve au super administrateur' });
    }

    const nextStatus = mapBadgeStatusToDb(requestedStatus);
    const runtimeSettings = await getSystemRuntimeSettings();
    const updated = await prisma.$transaction(async (tx) => {
      const now = new Date();
      const row = await tx.badgeToken.update({
        where: { id },
        data: {
          status: nextStatus,
          revokedAt: nextStatus === 'revoked' ? now : null,
          ...(nextStatus === 'active'
            ? {
              expiresAt: computeBadgeExpiry(now, {
                badgeExpirationHours: runtimeSettings.badge_expiration_hours
              })
            }
            : {})
        },
        include: { employe: true, admin: true }
      });

      if (nextStatus === 'active') {
        await tx.badgeToken.updateMany({
          where: {
            id: { not: id },
            status: 'active',
            ...(row.employeId ? { employeId: row.employeId } : { adminId: row.adminId })
          },
          data: {
            status: 'revoked',
            revokedAt: new Date()
          }
        });
      }

      return row;
    });

    res.json({ success: true, badge: mapBadgeTokenForUi(updated) });
  } catch (error) {
    console.error('Erreur badge status:', error);
    res.status(500).json({ success: false, message: 'Erreur lors de la mise a jour du statut' });
  }
});

app.post('/api/badges/:id/regenerate', validateToken, requireRoleManagementAccess, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ success: false, message: 'Identifiant badge invalide' });
    }

    const existing = await prisma.badgeToken.findUnique({
      where: { id },
      select: { id: true, employeId: true, adminId: true }
    });

    if (!existing) {
      return res.status(404).json({ success: false, message: 'Badge non trouve' });
    }
    if (!isBadgeManagedByRequester(req, existing)) {
      return res.status(403).json({ success: false, message: 'Acces refuse: badge reserve au super administrateur' });
    }

    const token = await regenerateBadgeToken({
      employeId: existing.employeId,
      adminId: existing.adminId,
      requestedBy: req.user?.user?.id,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      reason: 'employee-manual'
    });

    res.json({
      success: true,
      message: 'Badge regenere avec succes',
      badge: mapBadgeTokenForUi(token)
    });
  } catch (error) {
    console.error('Erreur badge regenerate:', error);
    res.status(500).json({ success: false, message: 'Erreur lors de la regeneration du badge' });
  }
});

app.post('/api/badges/regenerate-all', validateToken, requireRoleManagementAccess, async (req, res) => {
  try {
    const [employes, admins] = await Promise.all([
      prisma.employe.findMany({ where: { statut: 'actif' }, select: { id: true } }),
      canManageAdminBadges(req)
        ? prisma.admin.findMany({ where: { statut: 'actif' }, select: { id: true } })
        : Promise.resolve([])
    ]);

    const allTargets = [
      ...employes.map((item) => ({ employeId: item.id, adminId: null })),
      ...admins.map((item) => ({ employeId: null, adminId: item.id }))
    ];

    const regenerated = [];
    for (const target of allTargets) {
      // Sequential by design to keep transaction pressure low.
      // eslint-disable-next-line no-await-in-loop
      const token = await regenerateBadgeToken({
        employeId: target.employeId,
        adminId: target.adminId,
        requestedBy: req.user?.user?.id,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        reason: 'admin-bulk'
      });
      regenerated.push(mapBadgeTokenForUi(token));
    }

    res.json({
      success: true,
      message: 'Regeneration terminee',
      badges: regenerated
    });
  } catch (error) {
    console.error('Erreur badges regenerate-all:', error);
    res.status(500).json({ success: false, message: 'Erreur lors de la regeneration globale' });
  }
});

const resolveEmployeBadgeForView = async ({ employeId, requestedBy, ipAddress, userAgent }) => {
  void requestedBy;
  void ipAddress;
  void userAgent;

  const token = await prisma.badgeToken.findFirst({
    where: { employeId },
    include: { employe: true, admin: true },
    orderBy: { createdAt: 'desc' }
  });

  if (!token) {
    const employe = await prisma.employe.findUnique({
      where: { id: employeId },
      select: { id: true }
    });
    if (!employe) {
      return null;
    }
    return null;
  }

  return token ? mapBadgeTokenForUi(token) : null;
};

const resolveAdminBadgeForView = async ({ adminId, requestedBy, ipAddress, userAgent }) => {
  void requestedBy;
  void ipAddress;
  void userAgent;

  const token = await prisma.badgeToken.findFirst({
    where: { adminId },
    include: { employe: true, admin: true },
    orderBy: { createdAt: 'desc' }
  });

  if (!token) {
    const admin = await prisma.admin.findUnique({
      where: { id: adminId },
      select: { id: true }
    });
    if (!admin) {
      return null;
    }
    return null;
  }

  return token ? mapBadgeTokenForUi(token) : null;
};

app.get('/api/employe/badge', validateToken, async (req, res) => {
  try {
    if (req.user?.userType !== 'employe') {
      return res.status(403).json({ success: false, message: 'Acces reserve aux employes' });
    }

    const employeId = req.user.user.id;
    res.json({
      success: true,
      badge: await resolveEmployeBadgeForView({
        employeId,
        requestedBy: req.user?.user?.id,
        ipAddress: req.ip,
        userAgent: req.get('user-agent')
      })
    });
  } catch (error) {
    console.error('Erreur employe badge:', error);
    res.status(500).json({ success: false, message: 'Erreur lors du chargement du badge' });
  }
});

app.get('/api/badge/employe', validateToken, async (req, res) => {
  try {
    if (req.user?.userType !== 'employe') {
      return res.status(403).json({ success: false, message: 'Acces reserve aux employes' });
    }
    res.json({
      success: true,
      badge: await resolveEmployeBadgeForView({
        employeId: req.user.user.id,
        requestedBy: req.user?.user?.id,
        ipAddress: req.ip,
        userAgent: req.get('user-agent')
      })
    });
  } catch (error) {
    console.error('Erreur badge/employe:', error);
    res.status(500).json({ success: false, message: 'Erreur lors du chargement du badge' });
  }
});

app.get('/api/admin/badge', validateToken, async (req, res) => {
  try {
    if (req.user?.userType !== 'admin') {
      return res.status(403).json({ success: false, message: 'Acces reserve aux administrateurs' });
    }

    const adminId = req.user.user.id;
    res.json({
      success: true,
      badge: await resolveAdminBadgeForView({
        adminId,
        requestedBy: req.user?.user?.id,
        ipAddress: req.ip,
        userAgent: req.get('user-agent')
      })
    });
  } catch (error) {
    console.error('Erreur admin badge:', error);
    res.status(500).json({ success: false, message: 'Erreur lors du chargement du badge' });
  }
});

app.get('/api/badge/employe/:id', validateToken, async (req, res) => {
  try {
    const requestedId = parseInt(req.params.id, 10);
    if (!Number.isInteger(requestedId)) {
      return res.status(400).json({ success: false, message: 'Identifiant employe invalide' });
    }

    if (req.user?.userType === 'employe' && req.user?.user?.id !== requestedId) {
      return res.status(403).json({ success: false, message: 'Acces refuse' });
    }

    res.json({
      success: true,
      badge: await resolveEmployeBadgeForView({
        employeId: requestedId,
        requestedBy: req.user?.user?.id,
        ipAddress: req.ip,
        userAgent: req.get('user-agent')
      })
    });
  } catch (error) {
    console.error('Erreur badge/employe/:id:', error);
    res.status(500).json({ success: false, message: 'Erreur lors du chargement du badge' });
  }
});

app.post('/api/badge/generate', validateToken, async (req, res) => {
  try {
    const admin = req.user;
    
    if (!admin?.id) {
      return res.status(401).json({ success: false, message: 'Admin non authentifié' });
    }

    // Vérifier que l'utilisateur est admin ou super_admin
    const role = String(admin.role || '').toLowerCase();
    if (!['admin', 'super_admin'].includes(role)) {
      return res.status(403).json({ success: false, message: 'Régénération de badge réservée aux administrateurs' });
    }

    // Récupérer l'admin avec son badge actuel
    const adminData = await prisma.admin.findFirst({
      where: { id: admin.id },
      include: { badgeToken: true }
    });

    if (!adminData) {
      return res.status(404).json({ success: false, message: 'Admin non trouvé' });
    }

    // Désactiver l'ancien badge s'il existe
    if (adminData.badgeToken) {
      await prisma.badgeToken.update({
        where: { id: adminData.badgeToken.id },
        data: { 
          status: 'inactive',
          expiresAt: new Date()
        }
      });
    }

    // Générer le nouveau badge
    const newToken = generateSecureToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // Valide 30 jours

    const newBadgeToken = await prisma.badgeToken.create({
      data: {
        employeId: admin.id,
        token: newToken,
        tokenHash: hashToken(newToken),
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        deviceInfo: JSON.stringify({
          platform: req.get('user-agent'),
          regeneratedAt: new Date().toISOString(),
          regeneratedBy: 'admin'
        }),
        status: 'active',
        createdAt: new Date(),
        expiresAt
      }
    });

    res.json({
      success: true,
      message: 'Badge régénéré avec succès',
      badge: {
        id: newBadgeToken.id,
        token: newToken,
        expiresAt: newBadgeToken.expiresAt.toISOString(),
        status: 'active'
      }
    });
  } catch (error) {
    console.error('Erreur badge/generate:', error);
    res.status(500).json({ success: false, message: 'Erreur lors de la régénération du badge' });
  }
});

app.post('/api/employe/badge/regenerate', validateToken, async (req, res) => {
  try {
    const user = req.user;
    
    if (!user?.id) {
      return res.status(401).json({ success: false, message: 'Utilisateur non authentifié' });
    }

    // Vérifier que l'utilisateur est un employé (pas admin)
    const role = String(user.role || '').toLowerCase();
    if (['admin', 'super_admin'].includes(role)) {
      return res.status(403).json({ success: false, message: 'Utilisez /api/badge/generate pour les administrateurs' });
    }

    // Récupérer l'employé avec son badge actuel
    const employeData = await prisma.employe.findFirst({
      where: { id: user.id },
      include: { badgeToken: true }
    });

    if (!employeData) {
      return res.status(404).json({ success: false, message: 'Employé non trouvé' });
    }

    // Désactiver l'ancien badge s'il existe
    if (employeData.badgeToken) {
      await prisma.badgeToken.update({
        where: { id: employeData.badgeToken.id },
        data: { 
          status: 'inactive',
          expiresAt: new Date()
        }
      });
    }

    // Générer le nouveau badge
    const newToken = generateSecureToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // Valide 30 jours

    const newBadgeToken = await prisma.badgeToken.create({
      data: {
        employeId: user.id,
        token: newToken,
        tokenHash: hashToken(newToken),
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        deviceInfo: JSON.stringify({
          platform: req.get('user-agent'),
          regeneratedAt: new Date().toISOString(),
          regeneratedBy: 'employe'
        }),
        status: 'active',
        createdAt: new Date(),
        expiresAt
      }
    });

    res.json({
      success: true,
      message: 'Badge régénéré avec succès',
      badge: {
        id: newBadgeToken.id,
        token: newToken,
        expiresAt: newBadgeToken.expiresAt.toISOString(),
        status: 'active'
      }
    });
  } catch (error) {
    console.error('Erreur employe badge regenerate:', error);
    res.status(500).json({ success: false, message: 'Erreur lors de la régénération du badge' });
  }
});

const calendarTypeColor = (type, priorite = 'normale') => {
  const normalizedPriority = normalizeEventPriority(priorite);
  if (normalizedPriority === 'urgente') return '#dc2626';
  if (normalizedPriority === 'importante') return '#ea580c';
  if (normalizedPriority === 'secondaire') return '#64748b';
  if (type === 'reunion') return '#2563eb';
  if (type === 'formation') return '#d97706';
  return '#475569';
};

const mapEventForCalendar = (event) => {
  const meta = extractCalendarMetaFromDescription(event.description);
  return {
    id: `event-${event.id}`,
    title: event.titre,
    start: event.startDate,
    end: event.endDate,
    allDay: false,
    color: calendarTypeColor(event.type, meta.priorite),
    extendedProps: {
      source: 'evenement',
      type: event.type,
      description: meta.description,
      priorite: meta.priorite,
      lieu: meta.lieu,
      employe_id: event.employeId || null,
      employe_nom: event.employe ? `${event.employe.prenom} ${event.employe.nom}` : null
    }
  };
};

const mapPointageEventForCalendar = (pointage, compactTitle = false) => {
  const baseTitle = pointage.type === 'arrivee' ? 'Arrivee' : pointage.type === 'depart' ? 'Depart' : 'Pointage';
  
  // Déterminer si c'est un pointage d'admin ou d'employé
  const isAdmin = pointage.adminId && !pointage.employeId;
  const user = isAdmin ? pointage.admin : pointage.employe;
  const fullName = user ? `${user.prenom} ${user.nom}`.trim() : '';
  const userId = isAdmin ? pointage.adminId : pointage.employeId;
  
  return {
    id: `pointage-${pointage.id}`,
    title: compactTitle ? baseTitle : `${baseTitle}${fullName ? ` - ${fullName}` : ''}`,
    start: pointage.dateHeure,
    end: pointage.dateHeure,
    allDay: false,
    color: pointage.type === 'arrivee' ? '#16a34a' : '#ea580c',
    extendedProps: {
      source: 'pointage',
      type: pointage.type,
      priorite: 'normale',
      employe_id: pointage.employeId || null,
      admin_id: pointage.adminId || null,
      employe_nom: fullName,
      retard_minutes: pointage.retardMinutes || 0
    }
  };
};

// Calendar endpoints
app.get('/api/calendrier/events', validateToken, async (req, res) => {
  try {
    const now = new Date();
    const startDefault = new Date(now.getFullYear(), now.getMonth(), 1);
    const endDefault = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    const startDate = parseCalendarDate(req.query.start, startDefault);
    const endDate = parseCalendarDate(req.query.end, endDefault);
    const requestedEmployeId = parseInt(req.query.employe_id, 10);
    const requestedAdminId = parseInt(req.query.admin_id, 10);
    const canManageCalendar = hasRoleManagementAccess(req);
    const includePointages = req.user?.userType === 'employe'
      || String(req.query.include_pointages || '').trim().toLowerCase() === '1';

    const eventWhere = {
      startDate: { lte: endDate },
      endDate: { gte: startDate }
    };

    if (req.user?.userType === 'employe' && !canManageCalendar) {
      eventWhere.OR = [{ employeId: null }, { employeId: req.user.user.id }];
    } else if (Number.isInteger(requestedEmployeId)) {
      eventWhere.OR = [{ employeId: null }, { employeId: requestedEmployeId }];
    }

    const events = await prisma.evenement.findMany({
      where: eventWhere,
      include: { employe: true },
      orderBy: { startDate: 'asc' }
    });

    let pointages = [];
    if (includePointages) {
      const pointageWhere = {
        dateHeure: { gte: startDate, lte: endDate },
        type: { in: ['arrivee', 'depart'] } // Filtrer pour exclure les pauses
      };
      
      // Pour les admins, on récupère uniquement leurs pointages ou ceux de l'admin spécifié
      if (req.user?.userType === 'admin') {
        if (Number.isInteger(requestedAdminId)) {
          // Pointages d'un admin spécifique
          pointageWhere.adminId = requestedAdminId;
        } else {
          // Pointages de l'admin connecté par défaut
          pointageWhere.adminId = req.user.user.id;
        }
      } else if (req.user?.userType === 'employe' && !canManageCalendar) {
        pointageWhere.employeId = req.user.user.id;
      } else if (Number.isInteger(requestedEmployeId)) {
        pointageWhere.employeId = requestedEmployeId;
      }

      pointages = await prisma.pointage.findMany({
        where: pointageWhere,
        include: { 
          employe: true,
          admin: true
        },
        orderBy: { dateHeure: 'asc' },
        take: 1000
      });
    }

    const compactTitles = req.user?.userType === 'employe' && !canManageCalendar;
    const payload = [
      ...events.map(mapEventForCalendar),
      ...pointages.map((item) => mapPointageEventForCalendar(item, compactTitles))
    ];

    res.json({ success: true, events: payload });
  } catch (error) {
    console.error('Erreur calendrier events:', error);
    res.status(500).json({ success: false, message: 'Erreur lors du chargement du calendrier' });
  }
});

app.post('/api/calendrier/events', validateToken, async (req, res) => {
  try {
    const canManageAllCalendar = hasRoleManagementAccess(req);
    if (!canManageAllCalendar) {
      return res.status(403).json({ success: false, message: 'Acces refuse pour creer un evenement' });
    }
    const titre = String(req.body?.titre || '').trim();
    const description = String(req.body?.description || '').trim();
    const priorite = normalizeEventPriority(req.body?.priorite || req.body?.priority);
    const lieu = String(req.body?.lieu || req.body?.location || '').trim();
    const startDate = parseCalendarDate(req.body?.start_date, null);
    const endDate = parseCalendarDate(req.body?.end_date, null);
    const typeRaw = String(req.body?.type || 'autre').toLowerCase();
    const requestedEmployeId = req.body?.employe_id === null || req.body?.employe_id === undefined || req.body?.employe_id === ''
      ? null
      : parseInt(req.body.employe_id, 10);
    const employeId = Number.isInteger(requestedEmployeId) ? requestedEmployeId : null;
    const type = ['reunion', 'formation', 'autre'].includes(typeRaw) ? typeRaw : 'autre';

    if (!titre || !startDate || !endDate) {
      return res.status(400).json({ success: false, message: 'Titre, date de debut et date de fin requis' });
    }
    if (endDate < startDate) {
      return res.status(400).json({ success: false, message: 'La date de fin doit etre posterieure a la date de debut' });
    }
    if (Number.isInteger(employeId)) {
      const employe = await prisma.employe.findUnique({
        where: { id: employeId },
        select: { id: true }
      });
      if (!employe) {
        return res.status(404).json({ success: false, message: 'Employe cible introuvable' });
      }
    }

    const created = await prisma.evenement.create({
      data: {
        titre,
        description: buildCalendarDescriptionPayload({ description, priorite, lieu }),
        startDate,
        endDate,
        type,
        employeId: Number.isInteger(employeId) ? employeId : null
      },
      include: { employe: true }
    });

    const actorPrenom = String(req.user?.user?.prenom || '').trim();
    const actorNom = String(req.user?.user?.nom || '').trim();
    const actorLabel = `${actorPrenom} ${actorNom}`.trim() || 'Administration';

    try {
      await notifyEmployeesAboutCalendarEvent({
        event: created,
        actorLabel
      });
    } catch (notificationError) {
      console.warn('Notification evenement non creee:', notificationError?.message || notificationError);
    }

    res.status(201).json({ success: true, event: mapEventForCalendar(created) });
  } catch (error) {
    console.error('Erreur calendrier create:', error);
    res.status(500).json({ success: false, message: 'Erreur lors de la creation de evenement' });
  }
});

app.put('/api/calendrier/events/:id', validateToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ success: false, message: 'Identifiant evenement invalide' });
    }

    const canManageAllCalendar = hasRoleManagementAccess(req);
    const existingEvent = await prisma.evenement.findUnique({
      where: { id },
      select: { id: true, startDate: true, endDate: true, description: true, employeId: true }
    });
    if (!existingEvent) {
      return res.status(404).json({ success: false, message: 'Evenement introuvable' });
    }
    if (!canMutateCalendarEvent(req, existingEvent.employeId)) {
      return res.status(403).json({ success: false, message: 'Acces refuse pour modifier cet evenement' });
    }

    const data = {};
    if (req.body?.titre !== undefined) data.titre = String(req.body.titre || '').trim();
    const existingMeta = extractCalendarMetaFromDescription(existingEvent.description);
    const hasDescriptionUpdate = req.body?.description !== undefined;
    const hasPriorityUpdate = req.body?.priorite !== undefined || req.body?.priority !== undefined;
    const hasLocationUpdate = req.body?.lieu !== undefined || req.body?.location !== undefined;

    const effectiveDescription = hasDescriptionUpdate
      ? String(req.body.description || '').trim()
      : existingMeta.description;
    const effectivePriority = hasPriorityUpdate
      ? normalizeEventPriority(req.body?.priorite || req.body?.priority)
      : existingMeta.priorite;
    const effectiveLocation = hasLocationUpdate
      ? String(req.body?.lieu || req.body?.location || '').trim()
      : existingMeta.lieu;
    if (req.body?.start_date !== undefined) {
      const parsedStartDate = parseCalendarDate(req.body.start_date, null);
      if (!parsedStartDate) {
        return res.status(400).json({ success: false, message: 'Date de debut invalide' });
      }
      data.startDate = parsedStartDate;
    }
    if (req.body?.end_date !== undefined) {
      const parsedEndDate = parseCalendarDate(req.body.end_date, null);
      if (!parsedEndDate) {
        return res.status(400).json({ success: false, message: 'Date de fin invalide' });
      }
      data.endDate = parsedEndDate;
    }
    if (req.body?.type !== undefined) {
      const typeRaw = String(req.body.type || '').toLowerCase();
      data.type = ['reunion', 'formation', 'autre'].includes(typeRaw) ? typeRaw : 'autre';
    }
    if (req.body?.employe_id !== undefined) {
      if (req.user?.userType === 'employe' && !canManageAllCalendar) {
        data.employeId = req.user.user.id;
      } else {
        const employeId = parseInt(req.body.employe_id, 10);
        data.employeId = Number.isInteger(employeId) ? employeId : null;
      }
    }
    if (hasDescriptionUpdate || hasPriorityUpdate || hasLocationUpdate) {
      data.description = buildCalendarDescriptionPayload({
        description: effectiveDescription,
        priorite: effectivePriority,
        lieu: effectiveLocation
      });
    }
    const effectiveStart = data.startDate || existingEvent.startDate;
    const effectiveEnd = data.endDate || existingEvent.endDate;
    if (effectiveStart && effectiveEnd && effectiveEnd < effectiveStart) {
      return res.status(400).json({ success: false, message: 'La date de fin doit etre posterieure a la date de debut' });
    }
    if (Number.isInteger(data.employeId)) {
      const employe = await prisma.employe.findUnique({
        where: { id: data.employeId },
        select: { id: true }
      });
      if (!employe) {
        return res.status(404).json({ success: false, message: 'Employe cible introuvable' });
      }
    }

    const updated = await prisma.evenement.update({
      where: { id },
      data,
      include: { employe: true }
    });

    res.json({ success: true, event: mapEventForCalendar(updated) });
  } catch (error) {
    console.error('Erreur calendrier update:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la mise a jour de evenement',
      detail: error?.message || String(error || ''),
      code: error?.code || null
    });
  }
});

app.delete('/api/calendrier/events/:id', validateToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ success: false, message: 'Identifiant evenement invalide' });
    }

    const existingEvent = await prisma.evenement.findUnique({
      where: { id },
      select: { id: true, employeId: true }
    });
    if (!existingEvent) {
      return res.status(404).json({ success: false, message: 'Evenement introuvable' });
    }
    if (!canMutateCalendarEvent(req, existingEvent.employeId)) {
      return res.status(403).json({ success: false, message: 'Acces refuse pour supprimer cet evenement' });
    }

    await prisma.evenement.delete({ where: { id } });
    res.json({ success: true, message: 'Evenement supprime' });
  } catch (error) {
    console.error('Erreur calendrier delete:', error);
    res.status(500).json({ success: false, message: 'Erreur lors de la suppression de evenement' });
  }
});

// Evenement compatibility endpoints
app.get('/api/evenements', validateToken, async (req, res) => {
  try {
    const response = await prisma.evenement.findMany({
      orderBy: { startDate: 'asc' },
      include: { employe: true },
      take: 200
    });
    res.json({ success: true, evenements: response });
  } catch (error) {
    console.error('Erreur evenements list:', error);
    res.status(500).json({ success: false, message: 'Erreur lors du chargement des evenements' });
  }
});

app.post('/api/evenements', validateToken, requireAdmin, async (req, res) => {
  try {
    const employeIdRaw = req.body?.employeId ?? req.body?.employe_id;
    const parsedEmployeId = employeIdRaw === null || employeIdRaw === undefined || employeIdRaw === ''
      ? null
      : parseInt(employeIdRaw, 10);
    const startDate = parseCalendarDate(req.body?.startDate || req.body?.start_date, new Date());
    const endDate = parseCalendarDate(req.body?.endDate || req.body?.end_date, new Date());

    if (endDate < startDate) {
      return res.status(400).json({ success: false, message: 'La date de fin doit etre posterieure a la date de debut' });
    }
    if (Number.isInteger(parsedEmployeId)) {
      const employe = await prisma.employe.findUnique({
        where: { id: parsedEmployeId },
        select: { id: true }
      });
      if (!employe) {
        return res.status(404).json({ success: false, message: 'Employe cible introuvable' });
      }
    }

    const evenement = await prisma.evenement.create({
      data: {
        titre: String(req.body?.titre || 'Evenement').trim(),
        description: req.body?.description || null,
        startDate,
        endDate,
        type: ['reunion', 'formation', 'autre'].includes(String(req.body?.type || '').toLowerCase())
          ? String(req.body.type).toLowerCase()
          : 'autre',
        employeId: Number.isInteger(parsedEmployeId) ? parsedEmployeId : null
      }
    });
    res.status(201).json({ success: true, evenement });
  } catch (error) {
    console.error('Erreur evenements create:', error);
    res.status(500).json({ success: false, message: 'Erreur lors de la creation de evenement' });
  }
});

const startServer = async () => {
  await ensureRoleEnumValues();
  await loadSupportedDbRoleValues();
  
  try {
    await ensureAllEmployeMatricules();
  } catch (error) {
    if (String(error?.code || '') === 'P2021') {
      console.warn('Employe table missing during startup matricule check; continuing startup.');
    } else {
      throw error;
    }
  }
  await getSystemRuntimeSettings({ forceRefresh: true });

  try {
    const startupRegenerated = await regenerateBadgesForDayRollover({
      referenceDate: new Date(),
      reason: 'startup-check'
    });
    if (startupRegenerated > 0) {
      console.log(`Badges regeneres au demarrage: ${startupRegenerated}`);
    }
  } catch (error) {
    console.warn('Verification regeneration badges au demarrage echouee:', error?.message || error);
  }

  // Initialiser la base de données
  await initializeDatabase();
  
  app.listen(PORT, () => {
    console.log(`Serveur Xpert Pro demarre sur http://localhost:${PORT}`);
    console.log('Mode: PostgreSQL avec Prisma');
    console.log('JWT Secret configure');
    scheduleDailyBadgeRegeneration();
  });
};

// Fonction pour créer la table BadgeScan si elle n'existe pas
const createBadgeScanTable = async () => {
  try {
    console.log('Vérification de la table badge_scans...');
    
    // Utiliser une requête SQL simple pour créer la table
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS badge_scans (
        id SERIAL PRIMARY KEY,
        token_id INTEGER,
        token_hash VARCHAR(128),
        scan_time TIMESTAMP DEFAULT NOW(),
        ip_address VARCHAR(45),
        device_info TEXT,
        is_valid BOOLEAN DEFAULT false,
        validation_details JSON,
        latitude DECIMAL(10,8),
        longitude DECIMAL(11,8),
        scan_type VARCHAR(50) DEFAULT 'unknown',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    
    console.log('Table badge_scans vérifiée/créée');
  } catch (error) {
    console.error('Erreur lors de la création de la table badge_scans:', error);
  }
};

// Initialiser la base de données au démarrage
const initializeDatabase = async () => {
  try {
    console.log('Initialisation de la base de données...');
    
    // Créer la table BadgeScan si nécessaire
    await createBadgeScanTable();
    
    console.log('Base de données initialisée avec succès');
  } catch (error) {
    console.error('Erreur lors de l\'initialisation de la base de données:', error);
  }
}

startServer().catch((error) => {
  console.error('Erreur demarrage serveur:', error);
  process.exit(1);
});
