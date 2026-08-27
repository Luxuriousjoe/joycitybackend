const { Pool, types } = require('pg');
const logger = require('../utils/logger');
const { normalizeSql } = require('../utils/sql_compat');

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is required. Set it to the Render PostgreSQL internal URL.',
  );
}

// PostgreSQL returns BIGINT/COUNT values as strings by default. The API and
// Flutter models expect JSON numbers, so parse safe application counts as JS numbers.
types.setTypeParser(types.builtins.INT8, (value) => Number.parseInt(value, 10));
types.setTypeParser(types.builtins.NUMERIC, (value) => Number.parseFloat(value));

const useSsl =
  process.env.DATABASE_SSL === 'true' ||
  /[?&]sslmode=(require|verify-ca|verify-full)/i.test(databaseUrl);

const poolOptions = {
  connectionString: databaseUrl,
  max: Number.parseInt(process.env.DB_POOL_MAX || '10', 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  keepAlive: true,
};

if (useSsl) {
  poolOptions.ssl = { rejectUnauthorized: false };
}

const pool = new Pool(poolOptions);

pool.on('connect', (client) => {
  logger.db('CONNECT', 'postgres', `process id:${client.processID}`);
});

pool.on('error', (error) => {
  logger.error('PostgreSQL pool error:', error.message);
});

async function query(input, values = []) {
  let sql = normalizeSql(input).trim();
  const command = sql.split(/\s+/, 1)[0].toUpperCase();

  if (command === 'INSERT' && !/\bRETURNING\b/i.test(sql)) {
    sql = `${sql.replace(/;$/, '')} RETURNING id`;
  }

  const result = await pool.query(sql, values);

  if (command === 'SELECT' || command === 'WITH') {
    return [result.rows, result.fields];
  }

  return [
    {
      insertId: result.rows[0]?.id,
      affectedRows: result.rowCount,
      rows: result.rows,
    },
    result.fields,
  ];
}

const promiseApi = {
  query,
  execute: query,
  end: () => pool.end(),
};

module.exports = {
  pool,
  query,
  promise: () => promiseApi,
  getConnection(callback) {
    pool
      .connect()
      .then((client) => {
        callback(null, {
          threadId: client.processID,
          release: () => client.release(),
        });
      })
      .catch((error) => callback(error));
  },
  end: () => pool.end(),
};
