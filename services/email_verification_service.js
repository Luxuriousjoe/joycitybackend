const crypto = require('crypto');
const db = require('../config/db_config');
const config = require('../config/app_config');

const CODE_TTL_MS = 5 * 60 * 1000;
const RESEND_COOLDOWN_MS = 2 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function normalizeSender(value) {
  let sender = String(value || '').trim();
  sender = sender.replace(/^RESEND_FROM_EMAIL\s*=\s*/i, '').trim();
  if ((sender.startsWith('"') && sender.endsWith('"')) ||
      (sender.startsWith("'") && sender.endsWith("'"))) {
    sender = sender.slice(1, -1).trim();
  }

  const emailMatch = sender.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (!emailMatch) {
    throw new Error('RESEND_FROM_EMAIL must contain a valid email address');
  }

  const email = emailMatch[0];
  const angleFormat = sender.match(/^\s*([^<>]+?)\s*<[^<>]+>\s*$/);
  const displayName = angleFormat?.[1]?.trim() || 'Joy City International';
  return `${displayName} <${email}>`;
}

function cleanDeviceId(value) {
  const deviceId = String(value || '').trim();
  if (!/^[A-Za-z0-9._:-]{16,100}$/.test(deviceId)) {
    const error = new Error('A valid device ID is required');
    error.code = 'INVALID_DEVICE';
    throw error;
  }
  return deviceId;
}

function hashCode(challengeId, code) {
  return crypto
    .createHmac('sha256', config.emailVerification.secret)
    .update(`${challengeId}:${code}`)
    .digest('hex');
}

async function sendCode(email, code) {
  const subject = 'Your Joy City verification code';
  const text = `Your Joy City verification code is ${code}. It expires in 5 minutes.`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:28px"><h2>Verify your email</h2><p>Enter this code in the Joy City app:</p><p style="font-size:34px;font-weight:700;letter-spacing:8px">${code}</p><p>This code expires in 5 minutes. Never share it with anyone.</p></div>`;

  if (config.smtp.user && config.smtp.appPassword) {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: config.smtp.user, pass: config.smtp.appPassword },
    });
    await transporter.sendMail({
      from: `${config.smtp.fromName} <${config.smtp.user}>`,
      to: email,
      subject,
      text,
      html,
    });
    return;
  }

  if (config.resend.apiKey && config.resend.from) {
    const from = normalizeSender(config.resend.from);
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.resend.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: [email], subject, text, html }),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Resend email failed (${response.status}): ${detail}`);
    }
    return;
  }

  throw new Error('Configure Gmail SMTP or a verified Resend sender');
}

async function isTrustedDevice(userId, rawDeviceId) {
  const deviceId = cleanDeviceId(rawDeviceId);
  const [rows] = await db.promise().query(
    'SELECT 1 FROM trusted_devices WHERE user_id = ? AND device_id = ?',
    [userId, deviceId],
  );
  if (rows.length) {
    await db.promise().query(
      'UPDATE trusted_devices SET last_used_at = NOW() WHERE user_id = ? AND device_id = ?',
      [userId, deviceId],
    );
  }
  return rows.length > 0;
}

async function issueChallenge({ userId, email, deviceId: rawDeviceId, authMethod, requiresProfile }) {
  if ((!config.smtp.user || !config.smtp.appPassword) &&
      (!config.resend.apiKey || !config.resend.from)) {
    throw new Error('Configure Gmail SMTP or Resend before sending verification codes');
  }
  const deviceId = cleanDeviceId(rawDeviceId);
  const id = crypto.randomUUID();
  const code = String(crypto.randomInt(100000, 1000000));
  const now = Date.now();
  await db.promise().query(
    `INSERT INTO email_verification_challenges
       (id, user_id, email, device_id, code_hash, auth_method, requires_profile,
        expires_at, resend_available_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, email, deviceId, hashCode(id, code), authMethod,
      requiresProfile ? 1 : 0, new Date(now + CODE_TTL_MS),
      new Date(now + RESEND_COOLDOWN_MS)],
  );
  await sendCode(email, code);
  return {
    challengeId: id,
    email,
    expiresInSeconds: 300,
    resendAfterSeconds: 120,
    requiresProfile: Boolean(requiresProfile),
  };
}

async function resendChallenge(challengeId) {
  const [rows] = await db.promise().query(
    'SELECT * FROM email_verification_challenges WHERE id = ? AND verified_at IS NULL',
    [challengeId],
  );
  if (!rows.length) throw Object.assign(new Error('Verification request not found'), { code: 'NOT_FOUND' });
  const challenge = rows[0];
  const waitMs = new Date(challenge.resend_available_at).getTime() - Date.now();
  if (waitMs > 0) {
    const error = new Error('Please wait before requesting another code');
    error.code = 'RESEND_COOLDOWN';
    error.retryAfterSeconds = Math.ceil(waitMs / 1000);
    throw error;
  }
  const code = String(crypto.randomInt(100000, 1000000));
  const now = Date.now();
  await db.promise().query(
    `UPDATE email_verification_challenges
     SET code_hash = ?, expires_at = ?, resend_available_at = ?, attempts = 0
     WHERE id = ?`,
    [hashCode(challengeId, code), new Date(now + CODE_TTL_MS),
      new Date(now + RESEND_COOLDOWN_MS), challengeId],
  );
  await sendCode(challenge.email, code);
  return { expiresInSeconds: 300, resendAfterSeconds: 120 };
}

async function verifyChallenge(challengeId, code) {
  const [rows] = await db.promise().query(
    'SELECT * FROM email_verification_challenges WHERE id = ? AND verified_at IS NULL',
    [challengeId],
  );
  if (!rows.length) throw Object.assign(new Error('Verification request not found'), { code: 'NOT_FOUND' });
  const challenge = rows[0];
  if (new Date(challenge.expires_at).getTime() <= Date.now()) {
    throw Object.assign(new Error('Verification code has expired'), { code: 'CODE_EXPIRED' });
  }
  if (challenge.attempts >= MAX_ATTEMPTS) {
    throw Object.assign(new Error('Too many incorrect attempts. Request a new code.'), { code: 'TOO_MANY_ATTEMPTS' });
  }
  const expected = Buffer.from(challenge.code_hash, 'hex');
  const supplied = Buffer.from(hashCode(challengeId, String(code || '').trim()), 'hex');
  if (!crypto.timingSafeEqual(expected, supplied)) {
    await db.promise().query(
      'UPDATE email_verification_challenges SET attempts = attempts + 1 WHERE id = ?',
      [challengeId],
    );
    throw Object.assign(new Error('Incorrect verification code'), { code: 'INVALID_CODE' });
  }
  await db.promise().query(
    'UPDATE email_verification_challenges SET verified_at = NOW() WHERE id = ?',
    [challengeId],
  );
  return challenge;
}

async function trustChallengeDevice(challenge) {
  await db.promise().query(
    `INSERT INTO trusted_devices (user_id, device_id)
     VALUES (?, ?) ON CONFLICT (user_id, device_id)
     DO UPDATE SET verified_at = NOW(), last_used_at = NOW()`,
    [challenge.user_id, challenge.device_id],
  );
}

module.exports = {
  issueChallenge,
  isTrustedDevice,
  resendChallenge,
  trustChallengeDevice,
  verifyChallenge,
};
