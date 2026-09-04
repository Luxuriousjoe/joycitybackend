const { applicationDefault, cert, getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getMessaging } = require('firebase-admin/messaging');

const firebaseProjectId =
  process.env.FIREBASE_PROJECT_ID || 'joycityinternational-8bbd0';

let canCheckRevocation = false;
let messagingConfigured = false;
let credentialMode = 'project_id_only';
let credentialError = null;

function parseServiceAccount() {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) return null;

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(serviceAccountJson);
  } catch (_) {
    credentialError = 'FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON';
    return null;
  }

  const normalized = {
    projectId:
      serviceAccount.project_id ||
      serviceAccount.projectId ||
      serviceAccount.product_id,
    clientEmail: serviceAccount.client_email || serviceAccount.clientEmail,
    privateKey: String(
      serviceAccount.private_key || serviceAccount.privateKey || '',
    ).replace(/\\n/g, '\n'),
  };

  if (!normalized.projectId || !normalized.clientEmail || !normalized.privateKey) {
    credentialError = 'Firebase service account is missing project_id, client_email, or private_key';
    return null;
  }
  return normalized;
}

function getFirebaseApp() {
  if (getApps().length) return getApps()[0];

  const serviceAccount = parseServiceAccount();
  if (serviceAccount) {
    try {
      const app = initializeApp({
        credential: cert(serviceAccount),
        projectId: serviceAccount.projectId,
      });
      canCheckRevocation = true;
      messagingConfigured = true;
      credentialMode = 'service_account';
      return app;
    } catch (error) {
      credentialError = 'Firebase service account could not be initialized: ' + error.message;
    }
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    try {
      const app = initializeApp({
        credential: applicationDefault(),
        projectId: firebaseProjectId,
      });
      canCheckRevocation = true;
      messagingConfigured = true;
      credentialMode = 'application_default';
      return app;
    } catch (error) {
      credentialError = 'Firebase application-default credentials failed: ' + error.message;
    }
  }

  return initializeApp({ projectId: firebaseProjectId });
}

function pushIsEnabled() {
  return String(process.env.PUSH_NOTIFICATIONS_ENABLED || 'true').toLowerCase() !== 'false';
}

function getFirebaseConfigurationStatus() {
  getFirebaseApp();
  return {
    enabled: pushIsEnabled(),
    configured: messagingConfigured,
    projectId: firebaseProjectId,
    credentialMode,
    error: credentialError,
  };
}

function getFirebaseMessaging() {
  const status = getFirebaseConfigurationStatus();
  if (!status.enabled || !status.configured) return null;
  return getMessaging(getFirebaseApp());
}

async function verifyFirebaseIdToken(idToken) {
  if (!idToken || typeof idToken !== 'string') {
    const error = new Error('Firebase ID token is required');
    error.code = 'AUTH_TOKEN_REQUIRED';
    throw error;
  }
  return getAuth(getFirebaseApp()).verifyIdToken(idToken, canCheckRevocation);
}

module.exports = {
  getFirebaseConfigurationStatus,
  getFirebaseMessaging,
  verifyFirebaseIdToken,
};
