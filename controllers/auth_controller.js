// ═══════════════════════════════════════════════════════════════
//  JOY CITY INTERNATIONAL — Auth Controller
//  Passwords are stored as bcrypt hashes in PostgreSQL.
// ═══════════════════════════════════════════════════════════════
const jwt    = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db     = require('../config/db_config');
const config = require('../config/app_config');
const logger = require('../utils/logger');
const { validateRegistration } = require('../utils/registration_validation');
const { verifyFirebaseIdToken } = require('../services/firebase_admin_service');

// ─── Helper: Generate Tokens ──────────────────────────────────
const generateTokens = (user) => {
  const payload = {
    id:    user.id,
    email: user.email,
    role:  user.role,
    name:  user.name,
    department: user.department || 'None',
  };
  const accessToken  = jwt.sign(payload, config.jwt.secret,        { expiresIn: config.jwt.expiresIn });
  const refreshToken = jwt.sign({ id: user.id }, config.jwt.refreshSecret, { expiresIn: config.jwt.refreshExpires });
  return { accessToken, refreshToken };
};

// Public member registration. New accounts are always regular users.
exports.register = async (req, res, next) => {
  const validation = validateRegistration(req.body);
  if (validation.error) {
    return res.status(400).json({
      success: false,
      message: validation.error,
    });
  }

  const { name, email, password, department } = validation.value;
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const [result] = await db.promise().query(
      `INSERT INTO users
         (name, email, role, department, password_hash, is_active)
       VALUES (?, ?, 'user', ?, ?, 1)`,
      [name, email, department, passwordHash]
    );

    const user = {
      id: result.insertId,
      name,
      email,
      role: 'user',
      department,
      avatar_url: null,
    };
    const { accessToken, refreshToken } = generateTokens(user);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await db.promise().query(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
      [user.id, refreshToken, expiresAt]
    );

    await db.promise().query(
      'INSERT INTO logs (action, user_id, details, ip_addr) VALUES (?, ?, ?, ?)',
      ['USER_REGISTERED', user.id, `Member registered in ${department}`, ip]
    );

    logger.auth('REGISTER_SUCCESS', email, 'user', ip);
    return res.status(201).json({
      success: true,
      message: `Welcome to Joy City International, ${name}!`,
      data: {
        accessToken,
        refreshToken,
        user,
      },
    });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({
        success: false,
        message: 'An account already exists with this email address.',
      });
    }
    logger.error(`REGISTER_ERROR | ${error.message} | email:${email}`);
    return next(error);
  }
};

// ─── LOGIN ────────────────────────────────────────────────────
exports.login = async (req, res, next) => {
  const { email, password } = req.body;
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';

  logger.auth('LOGIN_ATTEMPT', email || 'NO_EMAIL', '?', ip);

  try {
    if (!email || !password) {
      logger.warn(`LOGIN_FAIL | Missing email or password | ip:${ip}`);
      return res.status(400).json({
        success: false,
        message: 'Email and password are required',
      });
    }

    const cleanEmail = email.toLowerCase().trim();
    logger.db('SELECT', 'users', `looking up email: ${cleanEmail}`);

    const [rows] = await db.promise().query(
      'SELECT * FROM users WHERE email = ? AND is_active = 1',
      [cleanEmail]
    );

    logger.db('RESULT', 'users', `found ${rows.length} user(s) for email: ${cleanEmail}`);

    if (!rows.length) {
      logger.warn(`LOGIN_FAIL | User not found: ${cleanEmail} | ip:${ip}`);
      return res.status(401).json({
        success: false,
        message: 'No account found with that email address',
      });
    }

    const user = rows[0];
    logger.info(`LOGIN | User found: id:${user.id} name:${user.name} role:${user.role}`);

    // Read the stored password hash. Legacy plaintext values are upgraded below.
    logger.info(`LOGIN | Checking password for user id:${user.id}...`);

    const storedPassword = user.password_hash;

    logger.info(`LOGIN | stored length:${storedPassword?.length} incoming length:${password?.length}`);

    if (!storedPassword) {
      logger.error(`LOGIN_FAIL | password_hash is null/undefined for user id:${user.id}`);
      return res.status(500).json({
        success: false,
        message: 'Account password not configured. Please contact the administrator.',
      });
    }

    const isBcryptHash = /^\$2[aby]\$/.test(storedPassword);
    const isMatch = isBcryptHash
      ? await bcrypt.compare(password, storedPassword)
      : storedPassword === password;

    if (!isMatch) {
      logger.warn(`LOGIN_FAIL | Wrong password for: ${cleanEmail} | ip:${ip}`);
      return res.status(401).json({
        success: false,
        message: 'Incorrect password. Please try again.',
      });
    }

    logger.info(`LOGIN | Password matched for user id:${user.id}`);

    // Transparently secure a legacy plaintext password after a valid login.
    if (!isBcryptHash) {
      const upgradedHash = await bcrypt.hash(password, 12);
      await db.promise().query(
        'UPDATE users SET password_hash = ? WHERE id = ?',
        [upgradedHash, user.id]
      );
      logger.info(`LOGIN | Upgraded legacy password hash for user id:${user.id}`);
    }

    const { accessToken, refreshToken } = generateTokens(user);
    logger.info(`LOGIN | Tokens generated for user id:${user.id}`);

    // Save refresh token
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await db.promise().query(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
      [user.id, refreshToken, expiresAt]
    );
    logger.db('INSERT', 'refresh_tokens', `saved for user id:${user.id}`);

    // Log the login event
    try {
      await db.promise().query(
        'INSERT INTO logs (action, user_id, details, ip_addr) VALUES (?, ?, ?, ?)',
        ['USER_LOGIN', user.id, `Successful login by ${user.email}`, ip]
      );
    } catch (logErr) {
      // ip_addr column may not exist in all schema versions
      if (logErr.message?.includes("Unknown column 'ip_addr'")) {
        await db.promise().query(
          'INSERT INTO logs (action, user_id, details) VALUES (?, ?, ?)',
          ['USER_LOGIN', user.id, `Successful login by ${user.email}`]
        );
      } else {
        logger.warn(`LOGIN | Could not write log: ${logErr.message}`);
      }
    }

    logger.auth('LOGIN_SUCCESS', user.email, user.role, ip);

    return res.json({
      success: true,
      message: `Welcome back, ${user.name}!`,
      data: {
        accessToken,
        refreshToken,
        user: {
          id:         user.id,
          name:       user.name,
          email:      user.email,
          role:       user.role,
          department: user.department || 'None',
          avatar_url: user.avatar_url || null,
        },
      },
    });

  } catch (err) {
    logger.error(`LOGIN_ERROR | ${err.message} | email:${email} | ip:${ip}`);
    logger.error('Stack:', err.stack);
    next(err);
  }
};

// Exchanges a verified Firebase identity for the app's own JWT session.
// Roles always come from this database, never from client/Firebase input.
exports.firebaseLogin = async (req, res, next) => {
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  try {
    const decoded = await verifyFirebaseIdToken(req.body?.idToken);
    const provider = decoded.firebase?.sign_in_provider;
    if (provider !== 'google.com') {
      return res.status(401).json({
        success: false,
        message: 'A Google-authenticated Firebase account is required.',
      });
    }

    if (!decoded.email || decoded.email_verified !== true) {
      return res.status(401).json({
        success: false,
        message: 'Google account email is not verified.',
      });
    }

    const email = decoded.email.toLowerCase().trim();
    const name = String(decoded.name || email.split('@')[0]).trim().slice(0, 100);
    const avatarUrl = typeof decoded.picture === 'string'
      ? decoded.picture.slice(0, 500)
      : null;

    let [rows] = await db.promise().query(
      'SELECT * FROM users WHERE email = ?',
      [email]
    );

    if (!rows.length) {
      // A random, unknown bcrypt value satisfies the legacy password column;
      // Google-created accounts authenticate through Firebase, not this value.
      const unusablePasswordHash = await bcrypt.hash(
        `${decoded.uid}:${Date.now()}:${Math.random()}`,
        12
      );
      const [result] = await db.promise().query(
        `INSERT INTO users
           (name, email, role, department, password_hash, avatar_url, is_active)
         VALUES (?, ?, 'user', 'None', ?, ?, 1)`,
        [name, email, unusablePasswordHash, avatarUrl]
      );
      rows = [{
        id: result.insertId,
        name,
        email,
        role: 'user',
        department: 'None',
        avatar_url: avatarUrl,
        is_active: 1,
      }];
    }

    const user = rows[0];
    if (Number(user.is_active) !== 1) {
      return res.status(403).json({
        success: false,
        message: 'This account has been disabled.',
      });
    }

    const { accessToken, refreshToken } = generateTokens(user);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await db.promise().query(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
      [user.id, refreshToken, expiresAt]
    );

    logger.auth('GOOGLE_LOGIN_SUCCESS', user.email, user.role, ip);
    return res.json({
      success: true,
      data: {
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          department: user.department || 'None',
          avatar_url: user.avatar_url || avatarUrl,
        },
      },
    });
  } catch (error) {
    if (error.code === 'AUTH_TOKEN_REQUIRED') {
      return res.status(400).json({ success: false, message: error.message });
    }
    if (String(error.code || '').startsWith('auth/')) {
      logger.warn(`GOOGLE_LOGIN_REJECTED | ${error.code} | ip:${ip}`);
      return res.status(401).json({
        success: false,
        message: 'Google session is invalid or expired. Please sign in again.',
      });
    }
    if (error.message?.includes('FIREBASE_SERVICE_ACCOUNT_JSON') ||
        error.message?.includes('default credentials')) {
      logger.error(`FIREBASE_CONFIG_ERROR | ${error.message}`);
      return res.status(503).json({
        success: false,
        message: 'Google sign-in is not configured on the server yet.',
      });
    }
    return next(error);
  }
};

// ─── REFRESH TOKEN ─────────────────────────────────────────────
exports.refreshToken = async (req, res, next) => {
  logger.info('REFRESH_TOKEN | Request received');
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ success: false, message: 'Refresh token required' });
    }

    let decoded;
    try {
      decoded = jwt.verify(refreshToken, config.jwt.refreshSecret);
    } catch (jwtErr) {
      logger.warn(`REFRESH_TOKEN | JWT verify failed: ${jwtErr.message}`);
      return res.status(401).json({ success: false, message: 'Session expired — please log in again' });
    }

    const [tokenRows] = await db.promise().query(
      'SELECT * FROM refresh_tokens WHERE token = ? AND expires_at > NOW()',
      [refreshToken]
    );

    if (!tokenRows.length) {
      logger.warn(`REFRESH_TOKEN | Token not found or expired for user id:${decoded.id}`);
      return res.status(401).json({ success: false, message: 'Session expired — please log in again' });
    }

    const [userRows] = await db.promise().query('SELECT * FROM users WHERE id = ?', [decoded.id]);
    if (!userRows.length) {
      return res.status(401).json({ success: false, message: 'User not found' });
    }

    const user = userRows[0];
    const { accessToken, refreshToken: newRefreshToken } = generateTokens(user);

    await db.promise().query('DELETE FROM refresh_tokens WHERE token = ?', [refreshToken]);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await db.promise().query(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
      [user.id, newRefreshToken, expiresAt]
    );

    logger.auth('TOKEN_REFRESH', user.email, user.role, req.ip);
    return res.json({ success: true, data: { accessToken, refreshToken: newRefreshToken } });

  } catch (err) {
    logger.error('REFRESH_TOKEN_ERROR:', err.message);
    next(err);
  }
};

// ─── LOGOUT ───────────────────────────────────────────────────
exports.logout = async (req, res, next) => {
  logger.info('LOGOUT | Request received');
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      const [result] = await db.promise().query(
        'DELETE FROM refresh_tokens WHERE token = ?',
        [refreshToken]
      );
      logger.db('DELETE', 'refresh_tokens', `removed ${result.affectedRows} token(s)`);
    }
    logger.auth('LOGOUT', req.user?.email || 'unknown', req.user?.role || '?', req.ip);
    return res.json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    logger.error('LOGOUT_ERROR:', err.message);
    next(err);
  }
};

// ─── GET ME ───────────────────────────────────────────────────
exports.getMe = async (req, res, next) => {
  logger.info(`GET_ME | user id:${req.user?.id}`);
  try {
    const [rows] = await db.promise().query(
      'SELECT id, name, email, role, department, avatar_url, created_at FROM users WHERE id = ?',
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'User not found' });
    logger.info(`GET_ME | Returned profile for ${rows[0].email}`);
    return res.json({ success: true, data: rows[0] });
  } catch (err) {
    logger.error('GET_ME_ERROR:', err.message);
    next(err);
  }
};

// ─── CHANGE PASSWORD ──────────────────────────────────────────
// Reads and writes bcrypt password hashes.
exports.changePassword = async (req, res, next) => {
  logger.info(`CHANGE_PASSWORD | user id:${req.user?.id}`);
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Both passwords required' });
    }
    if (newPassword.length < 12) {
      return res.status(400).json({ success: false, message: 'New password must be at least 12 characters' });
    }

    const [rows] = await db.promise().query('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'User not found' });

    const user = rows[0];

    const isBcryptHash = /^\$2[aby]\$/.test(user.password_hash);
    const currentPasswordMatches = isBcryptHash
      ? await bcrypt.compare(currentPassword, user.password_hash)
      : user.password_hash === currentPassword;

    if (!currentPasswordMatches) {
      logger.warn(`CHANGE_PASSWORD | Wrong current password for user id:${user.id}`);
      return res.status(400).json({ success: false, message: 'Current password is incorrect' });
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 12);
    await db.promise().query(
      'UPDATE users SET password_hash = ? WHERE id = ?',
      [newPasswordHash, user.id]
    );
    logger.auth('PWD_CHANGED', user.email, user.role, req.ip);
    return res.json({ success: true, message: 'Password updated successfully' });

  } catch (err) {
    logger.error('CHANGE_PASSWORD_ERROR:', err.message);
    next(err);
  }
};
