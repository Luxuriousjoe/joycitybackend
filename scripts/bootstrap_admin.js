const bootstrapName = (process.env.BOOTSTRAP_ADMIN_NAME || '').trim();
const bootstrapEmail = (process.env.BOOTSTRAP_ADMIN_EMAIL || '').trim();
const bootstrapPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD || '';

const configured = [bootstrapName, bootstrapEmail, bootstrapPassword].filter(
  Boolean,
).length;

if (configured === 0) {
  console.log('Bootstrap admin is not configured; skipping.');
  process.exit(0);
}

if (configured !== 3) {
  console.error(
    'Set BOOTSTRAP_ADMIN_NAME, BOOTSTRAP_ADMIN_EMAIL, and ' +
      'BOOTSTRAP_ADMIN_PASSWORD together.',
  );
  process.exit(1);
}

process.env.ADMIN_NAME = bootstrapName;
process.env.ADMIN_EMAIL = bootstrapEmail;
process.env.ADMIN_PASSWORD = bootstrapPassword;

require('./create_admin');
