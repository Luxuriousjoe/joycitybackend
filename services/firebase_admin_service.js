const { applicationDefault, cert, getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

const firebaseProjectId =
  process.env.FIREBASE_PROJECT_ID || 'joycityinternational-8bbd0';
let canCheckRevocation = false;

function getFirebaseApp() {
  if (getApps().length) return getApps()[0];

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (serviceAccountJson) {
    let serviceAccount;
    try {
      serviceAccount = JSON.parse(serviceAccountJson);
    } catch (_) {
      return initializeApp({ projectId: firebaseProjectId });
    }

    // Accept values copied through dashboards that renamed fields or escaped
    // the private-key newlines. Firebase Admin ultimately requires these three
    // canonical service-account properties.
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
      return initializeApp({ projectId: firebaseProjectId });
    }

    try {
      const app = initializeApp({
        credential: cert(normalized),
        projectId: normalized.projectId,
      });
      canCheckRevocation = true;
      return app;
    } catch (_) {
      return initializeApp({ projectId: firebaseProjectId });
    }
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    canCheckRevocation = true;
    return initializeApp({
      credential: applicationDefault(),
      projectId: firebaseProjectId,
    });
  }

  return initializeApp({ projectId: firebaseProjectId });
}

async function verifyFirebaseIdToken(idToken) {
  if (!idToken || typeof idToken !== 'string') {
    const error = new Error('Firebase ID token is required');
    error.code = 'AUTH_TOKEN_REQUIRED';
    throw error;
  }
  return getAuth(getFirebaseApp()).verifyIdToken(idToken, canCheckRevocation);
}

module.exports = { verifyFirebaseIdToken };
