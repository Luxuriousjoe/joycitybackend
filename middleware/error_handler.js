const logger = require('../utils/logger');

const errorHandler = (error, req, res, _next) => {
  const status = error.status || 500;
  const message = error.message || 'Internal server error';

  logger.error(
    `ERROR_HANDLER | ${status} | ${req.method} ${req.originalUrl} | ` +
      `${error.code || 'none'} | ${message}`,
  );

  // PostgreSQL unique constraint violation.
  if (error.code === '23505') {
    return res.status(409).json({
      success: false,
      message: 'This record already exists',
    });
  }

  // PostgreSQL foreign key and check constraint violations.
  if (error.code === '23503' || error.code === '23514') {
    return res.status(400).json({
      success: false,
      message: 'The supplied data violates a database constraint',
    });
  }

  if (error.code === '42P01') {
    return res.status(500).json({
      success: false,
      message: 'A required database table is missing. Run npm run db:migrate.',
      code: 'DB_TABLE_MISSING',
    });
  }

  if (error.code === '42703') {
    return res.status(500).json({
      success: false,
      message: 'The PostgreSQL schema is out of date. Run npm run db:migrate.',
      code: 'DB_COLUMN_ERROR',
    });
  }

  if (
    error.code === 'ECONNREFUSED' ||
    error.code === '28P01' ||
    error.code === '3D000'
  ) {
    return res.status(503).json({
      success: false,
      message: 'Cannot connect to PostgreSQL. Please try again shortly.',
      code: 'DB_CONNECTION_ERROR',
    });
  }

  if (error.code === '53300') {
    return res.status(503).json({
      success: false,
      message: 'The database is busy. Please try again shortly.',
      code: 'SERVER_BUSY',
    });
  }

  if (error.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      message: 'Invalid session token',
    });
  }

  if (error.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: 'Session expired',
      code: 'TOKEN_EXPIRED',
    });
  }

  if (error.name === 'ValidationError') {
    return res.status(400).json({ success: false, message });
  }

  return res.status(status).json({ success: false, message });
};

module.exports = errorHandler;
