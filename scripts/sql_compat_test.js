const assert = require('assert');
const { normalizeSql } = require('../utils/sql_compat');

assert.strictEqual(
  normalizeSql('SELECT * FROM users WHERE email = ? AND is_active = 1'),
  'SELECT * FROM users WHERE email = $1 AND is_active = 1',
);

assert.strictEqual(
  normalizeSql('UPDATE media SET status = "uploaded" WHERE id = ?'),
  "UPDATE media SET status = 'uploaded' WHERE id = $1",
);

assert.strictEqual(
  normalizeSql(
    'UPDATE uploads SET upload_status = ?, youtube_link = COALESCE(?, youtube_link) WHERE media_id = ?',
  ),
  'UPDATE uploads SET upload_status = $1, youtube_link = COALESCE($2, youtube_link) WHERE media_id = $3',
);

console.log('PostgreSQL compatibility tests passed.');
