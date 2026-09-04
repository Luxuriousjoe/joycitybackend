const assert = require('assert');
const {
  categoryIsEnabled,
  chunk,
  isInvalidTokenError,
  isWithinQuietHours,
  normalizePlatform,
  normalizeTimezoneOffset,
  notificationChannelId,
} = require('../utils/push_notification_helpers');

const at2330Utc = new Date('2026-09-04T23:30:00.000Z');
assert.strictEqual(isWithinQuietHours({
  enabled: 1,
  start: '22:00:00',
  end: '07:00:00',
  timezoneOffsetMinutes: 60,
  now: at2330Utc,
}), true);

const at0700Utc = new Date('2026-09-04T07:00:00.000Z');
assert.strictEqual(isWithinQuietHours({
  enabled: true,
  start: '22:00',
  end: '07:00',
  timezoneOffsetMinutes: 60,
  now: at0700Utc,
}), false);

assert.strictEqual(categoryIsEnabled({ timely_reflections: 0 }, 'reflection'), false);
assert.strictEqual(categoryIsEnabled({}, 'general'), true);
assert.strictEqual(normalizePlatform(' Android '), 'android');
assert.strictEqual(normalizePlatform('web'), null);
assert.strictEqual(normalizeTimezoneOffset(2000), 840);
assert.strictEqual(notificationChannelId('reflection'), 'joy_city_reflection');
assert.deepStrictEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
assert.strictEqual(isInvalidTokenError({
  code: 'messaging/registration-token-not-registered',
}), true);

console.log('Push notification helper tests passed.');
