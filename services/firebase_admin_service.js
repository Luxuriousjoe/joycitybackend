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
    return initializeApp({ credential: cert(serviceAccount) });
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
