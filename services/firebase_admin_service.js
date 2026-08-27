const { applicationDefault, cert, getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

function getFirebaseApp() {
  if (getApps().length) return getApps()[0];

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (serviceAccountJson) {
    let serviceAccount;
    try {
      serviceAccount = JSON.parse(serviceAccountJson);
    } catch (_) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON');
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
      throw new Error(
        'FIREBASE_SERVICE_ACCOUNT_JSON must be the Firebase Admin private-key JSON file',
      );
    }

    return initializeApp({ credential: cert(normalized) });
  }

  return initializeApp({ credential: applicationDefault() });
}

async function verifyFirebaseIdToken(idToken) {
  if (!idToken || typeof idToken !== 'string') {
    const error = new Error('Firebase ID token is required');
    error.code = 'AUTH_TOKEN_REQUIRED';
    throw error;
  }
  return getAuth(getFirebaseApp()).verifyIdToken(idToken, true);
}

module.exports = { verifyFirebaseIdToken };
