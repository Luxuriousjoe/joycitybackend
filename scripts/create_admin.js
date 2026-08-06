const bcrypt = require('bcryptjs');

require('dotenv').config();

const db = require('../config/db_config');

async function createAdmin() {
  const name = (process.env.ADMIN_NAME || '').trim();
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';

  if (!name || !email || !password) {
    throw new Error(
      'Set ADMIN_NAME, ADMIN_EMAIL, and ADMIN_PASSWORD before running this command.',
    );
  }

  if (!/^\S+@\S+\.\S+$/.test(email)) {
    throw new Error('ADMIN_EMAIL is not a valid email address.');
  }

  if (password.length < 12) {
    throw new Error('ADMIN_PASSWORD must contain at least 12 characters.');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const result = await db.pool.query(
    `INSERT INTO users (name, email, role, password_hash, is_active)
     VALUES ($1, $2, 'admin', $3, 1)
     ON CONFLICT (email) DO UPDATE SET
       name = EXCLUDED.name,
       role = 'admin',
       password_hash = EXCLUDED.password_hash,
       is_active = 1
     RETURNING id, name, email, role, is_active, created_at`,
    [name, email, passwordHash],
  );

  console.table(result.rows);
  console.log('Joy City administrator is ready.');
}

createAdmin()
  .catch((error) => {
    console.error('Admin creation failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => db.end());
