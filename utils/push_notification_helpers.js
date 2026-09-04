const categoryPreferenceFields = Object.freeze({
  reflection: 'timely_reflections',
  event: 'events',
  sermon: 'sermons',
  department: 'department_updates',
  testimony: 'testimonies',
});

const validPlatforms = new Set(['android', 'ios']);

function asBoolean(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  return value === true || value === 1 || value === '1' || value === 'true';
}

function normalizePlatform(value) {
  const platform = String(value || '').trim().toLowerCase();
  return validPlatforms.has(platform) ? platform : null;
}

function normalizeTimezoneOffset(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(-840, Math.min(840, parsed));
}

function parseClockMinutes(value) {
  const match = String(value || '').match(/^([01]\d|2[0-3]):([0-5]\d)/);
  if (!match) return null;
  return (Number.parseInt(match[1], 10) * 60) + Number.parseInt(match[2], 10);
}

function isWithinQuietHours({
  enabled,
  start,
  end,
  timezoneOffsetMinutes = 0,
  now = new Date(),
}) {
  if (!asBoolean(enabled)) return false;
  const startMinutes = parseClockMinutes(start);
  const endMinutes = parseClockMinutes(end);
  if (startMinutes === null || endMinutes === null || startMinutes === endMinutes) {
    return false;
  }

  const localTime = new Date(
    now.getTime() + (normalizeTimezoneOffset(timezoneOffsetMinutes) * 60 * 1000),
  );
  const currentMinutes = (localTime.getUTCHours() * 60) + localTime.getUTCMinutes();

  if (startMinutes < endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }
  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

function categoryIsEnabled(recipient, category) {
  const field = categoryPreferenceFields[category];
  return !field || asBoolean(recipient[field], true);
}

function firebaseErrorCode(error) {
  return String(error?.code || error?.errorInfo?.code || '').trim();
}

function isInvalidTokenError(error) {
  return new Set([
    'messaging/registration-token-not-registered',
    'messaging/invalid-registration-token',
    'messaging/mismatched-credential',
    'messaging/invalid-argument',
  ]).has(firebaseErrorCode(error));
}

function notificationChannelId(category) {
  const normalized = categoryPreferenceFields[category] ? category : 'general';
  return 'joy_city_' + normalized;
}

function chunk(items, size) {
  const safeSize = Math.max(1, Number.parseInt(size, 10) || 1);
  const chunks = [];
  for (let index = 0; index < items.length; index += safeSize) {
    chunks.push(items.slice(index, index + safeSize));
  }
  return chunks;
}

module.exports = {
  asBoolean,
  categoryIsEnabled,
  chunk,
  firebaseErrorCode,
  isInvalidTokenError,
  isWithinQuietHours,
  normalizePlatform,
  normalizeTimezoneOffset,
  notificationChannelId,
  parseClockMinutes,
};
