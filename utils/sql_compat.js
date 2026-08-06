/**
 * Convert the small amount of legacy SQL syntax retained by the controllers
 * into PostgreSQL syntax. This keeps the public API stable during migration.
 */
function normalizeSql(input) {
  let parameterIndex = 0;
  let sql = input.replace(/\?/g, () => `$${++parameterIndex}`);

  // Legacy queries used double-quoted string values.
  sql = sql.replace(/"([^"\\]*(?:\\.[^"\\]*)*)"/g, (_, value) => {
    return `'${value.replace(/'/g, "''")}'`;
  });

  return sql;
}

module.exports = { normalizeSql };
