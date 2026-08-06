const fs = require('fs');
const path = require('path');

require('dotenv').config();

const db = require('../config/db_config');

async function migrate() {
  const schemaPath = path.join(__dirname, '..', 'schema_postgresql.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');

  console.log('Applying Joy City PostgreSQL schema...');
  await db.pool.query(schema);
  console.log('PostgreSQL schema is ready.');
}

migrate()
  .catch((error) => {
    console.error('Database migration failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => db.end());
