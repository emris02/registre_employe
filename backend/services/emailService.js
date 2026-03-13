const nodemailer = require('nodemailer');

const normalizeBoolean = (value, fallback = false) => {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1' || value === 1) return true;
  if (value === 'false' || value === '0' || value === 0) return false;
  return fallback;
};

const getFrontendUrl = () => {
  const value = String(process.env.FRONTEND_URL || '').trim();
  return value || 'http://localhost:5173';
};

const getSmtpSettings = () => {
  const host = String(process.env.SMTP_HOST || '').trim();
  const port = Number(process.env.SMTP_PORT || 0) || 587;
  const secure = normalizeBoolean(process.env.SMTP_SECURE, port === 465);
  const user = String(process.env.SMTP_USER || '').trim();
  const pass = String(process.env.SMTP_PASS || '').trim();
  const from = String(process.env.SMTP_FROM || process.env.EMAIL_FROM || '').trim();
  const tlsRejectUnauthorized = normalizeBoolean(process.env.SMTP_TLS_REJECT_UNAUTHORIZED, true);

  return {
    host,
    port,
    secure,
    user,
    pass,
    from,
    tlsRejectUnauthorized
  };
};

const isEmailConfigured = () => {
  const settings = getSmtpSettings();
  return Boolean(settings.host);
};

let cachedTransporter = null;

const getTransporter = () => {
  if (cachedTransporter) return cachedTransporter;

  const settings = getSmtpSettings();
  if (!settings.host) {
    throw new Error('SMTP non configure (SMTP_HOST manquant)');
  }

  cachedTransporter = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    ...(settings.user && settings.pass
      ? { auth: { user: settings.user, pass: settings.pass } }
      : {}),
    tls: {
      rejectUnauthorized: settings.tlsRejectUnauthorized
    }
  });

  return cachedTransporter;
};

const buildCredentialsEmail = ({ recipientName, loginEmail, password, roleLabel }) => {
  const name = String(recipientName || '').trim() || 'Bonjour';
  const url = getFrontendUrl();
  const safeRole = String(roleLabel || '').trim();

  const subject = 'Vos identifiants Xpert Pro';
  const text = [
    `Bonjour ${name},`,
    '',
    'Votre compte Xpert Pro a ete cree.',
    safeRole ? `Profil: ${safeRole}` : null,
    '',
    `Identifiant (email): ${loginEmail}`,
    `Mot de passe: ${password}`,
    '',
    `Connexion: ${url}`,
    '',
    "Pour votre securite, changez votre mot de passe apres la premiere connexion.",
    '',
    'Equipe Xpert Pro'
  ]
    .filter(Boolean)
    .join('\n');

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5;">
      <p>Bonjour <strong>${escapeHtml(name)}</strong>,</p>
      <p>Votre compte Xpert Pro a ete cree.</p>
      ${safeRole ? `<p><strong>Profil:</strong> ${escapeHtml(safeRole)}</p>` : ''}
      <hr />
      <p><strong>Identifiant (email):</strong> ${escapeHtml(loginEmail)}</p>
      <p><strong>Mot de passe:</strong> ${escapeHtml(password)}</p>
      <p><strong>Connexion:</strong> <a href="${escapeAttribute(url)}">${escapeHtml(url)}</a></p>
      <p style="color:#555;">Pour votre securite, changez votre mot de passe apres la premiere connexion.</p>
      <p>Equipe Xpert Pro</p>
    </div>
  `.trim();

  return { subject, text, html };
};

const escapeHtml = (value) => {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const escapeAttribute = (value) => {
  // Keep it minimal; URL is already controlled by config.
  return escapeHtml(value);
};

const sendCredentialsEmail = async ({ to, recipientName, loginEmail, password, roleLabel }) => {
  const settings = getSmtpSettings();
  if (!settings.host) {
    throw new Error('SMTP non configure (SMTP_HOST manquant)');
  }

  const transporter = getTransporter();
  const { subject, text, html } = buildCredentialsEmail({
    recipientName,
    loginEmail,
    password,
    roleLabel
  });

  const from = settings.from || 'Xpert Pro <no-reply@xpertpro.local>';
  const info = await transporter.sendMail({
    from,
    to,
    subject,
    text,
    html
  });

  return {
    messageId: info?.messageId,
    accepted: Array.isArray(info?.accepted) ? info.accepted : [],
    rejected: Array.isArray(info?.rejected) ? info.rejected : []
  };
};

module.exports = {
  isEmailConfigured,
  sendCredentialsEmail
};

