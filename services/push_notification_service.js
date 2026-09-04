const db = require('../config/db_config');
const {
  getFirebaseConfigurationStatus,
  getFirebaseMessaging,
} = require('./firebase_admin_service');
const logger = require('../utils/logger');
const {
  categoryIsEnabled,
  firebaseErrorCode,
  isInvalidTokenError,
  isWithinQuietHours,
  notificationChannelId,
} = require('../utils/push_notification_helpers');

const activeDispatches = new Set();

function positiveInteger(value, fallback, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

const batchSize = positiveInteger(process.env.PUSH_BATCH_SIZE, 500, 500);
const maxAttempts = positiveInteger(process.env.PUSH_MAX_ATTEMPTS, 8, 25);

function compactError(error) {
  const code = firebaseErrorCode(error);
  const message = String(error?.message || error || 'Unknown Firebase Messaging error')
    .replace(/\s+/g, ' ')
    .trim();
  return (code ? code + ': ' : '') + message.slice(0, 850);
}

function buildMessage(notification, devices) {
  const route = notification.action_route || '/notifications';
  const category = notification.category || 'general';
  return {
    tokens: devices.map((device) => device.token),
    notification: {
      title: String(notification.title),
      body: String(notification.body),
    },
    data: {
      notification_id: String(notification.id),
      category: String(category),
      action_route: String(route),
    },
    android: {
      priority: 'high',
      notification: {
        channelId: notificationChannelId(category),
        clickAction: 'FLUTTER_NOTIFICATION_CLICK',
        sound: 'default',
      },
    },
    apns: {
      payload: {
        aps: {
          sound: 'default',
          'content-available': 1,
        },
      },
    },
  };
}

async function loadNotification(notificationId) {
  const result = await db.pool.query(
    [
      'SELECT * FROM notifications',
      'WHERE id = $1',
      '  AND is_active = 1',
      '  AND scheduled_at <= NOW()',
      '  AND (expires_at IS NULL OR expires_at > NOW())',
      'LIMIT 1',
    ].join('\n'),
    [notificationId],
  );
  return result.rows[0] || null;
}

async function loadRecipients(notification) {
  const result = await db.pool.query(
    [
      'SELECT d.id AS device_token_id, d.token, d.platform,',
      '       d.timezone_offset_minutes, u.id AS user_id, u.department,',
      '       COALESCE(p.timely_reflections, 1) AS timely_reflections,',
      '       COALESCE(p.events, 1) AS events,',
      '       COALESCE(p.sermons, 1) AS sermons,',
      '       COALESCE(p.department_updates, 1) AS department_updates,',
      '       COALESCE(p.testimonies, 1) AS testimonies,',
      '       COALESCE(p.quiet_hours_enabled, 0) AS quiet_hours_enabled,',
      "       COALESCE(p.quiet_hours_start, TIME '22:00') AS quiet_hours_start,",
      "       COALESCE(p.quiet_hours_end, TIME '07:00') AS quiet_hours_end",
      'FROM device_push_tokens d',
      'JOIN users u ON u.id = d.user_id',
      'LEFT JOIN notification_preferences p ON p.user_id = u.id',
      'WHERE d.active = 1 AND u.is_active = 1',
      '  AND (',
      "    $1 = 'all'",
      "    OR ($1 = 'department' AND LOWER(u.department) = LOWER($2))",
      "    OR ($1 = 'user' AND CAST(u.id AS TEXT) = $2)",
      '  )',
      'ORDER BY d.id',
    ].join('\n'),
    [notification.audience_type, notification.audience_value || ''],
  );
  return result.rows;
}

async function createDeliveryRecords(notificationId, recipients) {
  if (!recipients.length) return;
  await db.pool.query(
    [
      'INSERT INTO notification_push_deliveries (notification_id, device_token_id)',
      'SELECT $1, UNNEST($2::bigint[])',
      'ON CONFLICT (notification_id, device_token_id) DO NOTHING',
    ].join('\n'),
    [notificationId, recipients.map((recipient) => recipient.device_token_id)],
  );
}

async function releaseExpiredLeases(notificationId) {
  await db.pool.query(
    [
      'UPDATE notification_push_deliveries',
      "SET status = 'failed', last_error = 'Delivery lease expired; retrying', updated_at = NOW()",
      'WHERE notification_id = $1',
      "  AND status = 'sending'",
      "  AND updated_at < NOW() - INTERVAL '5 minutes'",
    ].join('\n'),
    [notificationId],
  );
}

async function claimDeliveryBatch(notificationId) {
  const result = await db.pool.query(
    [
      'WITH candidates AS (',
      '  SELECT pd.id',
      '  FROM notification_push_deliveries pd',
      '  JOIN device_push_tokens d ON d.id = pd.device_token_id',
      '  WHERE pd.notification_id = $1',
      '    AND d.active = 1',
      "    AND pd.status IN ('pending', 'failed')",
      '    AND pd.attempts < $2',
      '    AND (',
      '      pd.last_attempt_at IS NULL',
      "      OR pd.last_attempt_at <= NOW() - INTERVAL '2 minutes'",
      '    )',
      '  ORDER BY pd.id',
      '  FOR UPDATE SKIP LOCKED',
      '  LIMIT $3',
      ')',
      'UPDATE notification_push_deliveries pd',
      "SET status = 'sending', attempts = pd.attempts + 1,",
      '    last_attempt_at = NOW(), updated_at = NOW()',
      'FROM candidates c',
      'WHERE pd.id = c.id',
      'RETURNING pd.id, pd.device_token_id,',
      '  (SELECT token FROM device_push_tokens d WHERE d.id = pd.device_token_id) AS token,',
      '  (SELECT platform FROM device_push_tokens d WHERE d.id = pd.device_token_id) AS platform',
    ].join('\n'),
    [notificationId, maxAttempts, batchSize],
  );
  return result.rows;
}

async function markBatchFailed(deliveries, error) {
  if (!deliveries.length) return;
  await db.pool.query(
    [
      'UPDATE notification_push_deliveries',
      "SET status = 'failed', last_error = $2, updated_at = NOW()",
      'WHERE id = ANY($1::bigint[])',
    ].join('\n'),
    [deliveries.map((delivery) => delivery.id), compactError(error)],
  );
}

async function saveBatchResponses(deliveries, responses) {
  let sent = 0;
  let failed = 0;
  let invalid = 0;

  for (let index = 0; index < deliveries.length; index += 1) {
    const delivery = deliveries[index];
    const response = responses[index];

    if (response?.success) {
      await db.pool.query(
        [
          'UPDATE notification_push_deliveries',
          "SET status = 'sent', sent_at = NOW(), last_error = NULL, updated_at = NOW()",
          'WHERE id = $1',
        ].join('\n'),
        [delivery.id],
      );
      sent += 1;
      continue;
    }

    const error = response?.error || new Error('Firebase returned no delivery result');
    await db.pool.query(
      [
        'UPDATE notification_push_deliveries',
        "SET status = 'failed', last_error = $2, updated_at = NOW()",
        'WHERE id = $1',
      ].join('\n'),
      [delivery.id, compactError(error)],
    );
    failed += 1;

    if (isInvalidTokenError(error)) {
      await db.pool.query(
        [
          'UPDATE device_push_tokens',
          'SET active = 0, updated_at = NOW()',
          'WHERE id = $1',
        ].join('\n'),
        [delivery.device_token_id],
      );
      invalid += 1;
    }
  }

  return { sent, failed, invalid };
}

async function finalizeNotification(notificationId, hasQuietRecipients, lastError) {
  const counts = await db.pool.query(
    [
      'SELECT',
      "  COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,",
      "  COUNT(*) FILTER (WHERE status IN ('pending', 'sending'))::int AS pending,",
      "  COUNT(*) FILTER (WHERE status = 'failed' AND attempts < $2)::int AS retryable,",
      "  COUNT(*) FILTER (WHERE status = 'failed' AND attempts >= $2)::int AS exhausted",
      'FROM notification_push_deliveries',
      'WHERE notification_id = $1',
    ].join('\n'),
    [notificationId, maxAttempts],
  );
  const summary = counts.rows[0];

  const complete = !hasQuietRecipients &&
    Number(summary.pending) === 0 &&
    Number(summary.retryable) === 0;

  await db.pool.query(
    [
      'UPDATE notifications',
      'SET push_last_attempt_at = NOW(),',
      '    push_attempts = push_attempts + 1,',
      '    push_last_error = $2,',
      '    push_sent_at = CASE WHEN $3 THEN COALESCE(push_sent_at, NOW()) ELSE push_sent_at END',
      'WHERE id = $1',
    ].join('\n'),
    [notificationId, lastError || null, complete],
  );

  return { ...summary, complete };
}

async function dispatchNotificationById(notificationId) {
  const id = Number.parseInt(notificationId, 10);
  if (!Number.isFinite(id) || id < 1) {
    return { status: 'invalid_notification_id' };
  }
  if (activeDispatches.has(id)) {
    return { status: 'already_dispatching', notificationId: id };
  }

  const configuration = getFirebaseConfigurationStatus();
  if (!configuration.enabled || !configuration.configured) {
    return {
      status: configuration.enabled ? 'not_configured' : 'disabled',
      notificationId: id,
    };
  }

  activeDispatches.add(id);
  try {
    const notification = await loadNotification(id);
    if (!notification) return { status: 'not_due', notificationId: id };

    const recipients = await loadRecipients(notification);
    const eligible = [];
    let quietRecipients = 0;
    const now = new Date();

    for (const recipient of recipients) {
      if (!categoryIsEnabled(recipient, notification.category)) continue;
      if (isWithinQuietHours({
        enabled: recipient.quiet_hours_enabled,
        start: recipient.quiet_hours_start,
        end: recipient.quiet_hours_end,
        timezoneOffsetMinutes: recipient.timezone_offset_minutes,
        now,
      })) {
        quietRecipients += 1;
      } else {
        eligible.push(recipient);
      }
    }

    await createDeliveryRecords(id, eligible);
    await releaseExpiredLeases(id);

    const messaging = getFirebaseMessaging();
    let sentThisRun = 0;
    let failedThisRun = 0;
    let invalidThisRun = 0;
    let lastError = null;

    while (true) {
      const deliveries = await claimDeliveryBatch(id);
      if (!deliveries.length) break;

      try {
        const response = await messaging.sendEachForMulticast(
          buildMessage(notification, deliveries),
        );
        const saved = await saveBatchResponses(deliveries, response.responses);
        sentThisRun += saved.sent;
        failedThisRun += saved.failed;
        invalidThisRun += saved.invalid;
        if (saved.failed) lastError = saved.failed + ' device delivery attempt(s) failed';
      } catch (error) {
        await markBatchFailed(deliveries, error);
        failedThisRun += deliveries.length;
        lastError = compactError(error);
        logger.error('Firebase multicast send failed:', lastError);
      }
    }

    const totals = await finalizeNotification(id, quietRecipients > 0, lastError);
    return {
      status: totals.complete ? 'complete' : 'pending',
      notificationId: id,
      eligible: eligible.length,
      deferredForQuietHours: quietRecipients,
      sentThisRun,
      failedThisRun,
      invalidThisRun,
      totals,
    };
  } finally {
    activeDispatches.delete(id);
  }
}

async function dispatchDueNotifications(limit = 25) {
  const configuration = getFirebaseConfigurationStatus();
  if (!configuration.enabled || !configuration.configured) {
    return { ...configuration, processed: 0 };
  }

  await db.pool.query(
    [
      'UPDATE notifications',
      "SET push_sent_at = NOW(), push_last_error = 'Expired before push delivery'",
      'WHERE push_sent_at IS NULL AND expires_at IS NOT NULL AND expires_at <= NOW()',
    ].join('\n'),
  );

  const safeLimit = positiveInteger(limit, 25, 100);
  const result = await db.pool.query(
    [
      'SELECT id FROM notifications',
      'WHERE is_active = 1',
      '  AND push_sent_at IS NULL',
      '  AND scheduled_at <= NOW()',
      '  AND (expires_at IS NULL OR expires_at > NOW())',
      'ORDER BY scheduled_at, id',
      'LIMIT $1',
    ].join('\n'),
    [safeLimit],
  );

  const results = [];
  for (const row of result.rows) {
    try {
      results.push(await dispatchNotificationById(row.id));
    } catch (error) {
      logger.error('Push dispatch failed for notification ' + row.id + ':', error.message);
      results.push({
        status: 'error',
        notificationId: row.id,
        error: compactError(error),
      });
    }
  }

  return { ...configuration, processed: results.length, results };
}

module.exports = {
  dispatchDueNotifications,
  dispatchNotificationById,
  getConfigurationStatus: getFirebaseConfigurationStatus,
};
