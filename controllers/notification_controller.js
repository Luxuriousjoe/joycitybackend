const db = require('../config/db_config');
const logger = require('../utils/logger');

const preferenceFields = [
  'login_welcome', 'timely_reflections', 'events', 'sermons',
  'department_updates', 'testimonies', 'quiet_hours_enabled',
];
const asFlag = (value) => value === true || value === 1 || value === '1' ? 1 : 0;

async function ensurePreferences(userId) {
  await db.promise().query(
    `INSERT INTO notification_preferences (user_id) VALUES (?)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId],
  );
}

exports.getPreferences = async (req, res, next) => {
  try {
    await ensurePreferences(req.user.id);
    const [rows] = await db.promise().query(
      'SELECT * FROM notification_preferences WHERE user_id = ?',
      [req.user.id],
    );
    return res.json({ success: true, data: rows[0] });
  } catch (error) {
    logger.error('getNotificationPreferences error:', error.message);
    next(error);
  }
};

exports.updatePreferences = async (req, res, next) => {
  try {
    await ensurePreferences(req.user.id);
    const values = preferenceFields.map((field) => asFlag(req.body[field]));
    const quietStart = /^([01]\d|2[0-3]):[0-5]\d$/.test(req.body.quiet_hours_start || '')
      ? req.body.quiet_hours_start : '22:00';
    const quietEnd = /^([01]\d|2[0-3]):[0-5]\d$/.test(req.body.quiet_hours_end || '')
      ? req.body.quiet_hours_end : '07:00';
    await db.promise().query(
      `UPDATE notification_preferences SET
       login_welcome=?, timely_reflections=?, events=?, sermons=?,
       department_updates=?, testimonies=?, quiet_hours_enabled=?,
       quiet_hours_start=?, quiet_hours_end=? WHERE user_id=?`,
      [...values, quietStart, quietEnd, req.user.id],
    );
    return exports.getPreferences(req, res, next);
  } catch (error) {
    logger.error('updateNotificationPreferences error:', error.message);
    next(error);
  }
};

exports.getNotifications = async (req, res, next) => {
  try {
    await ensurePreferences(req.user.id);
    const [rows] = await db.promise().query(
      `SELECT n.*, CASE WHEN nr.user_id IS NULL THEN 0 ELSE 1 END AS is_read
       FROM notifications n
       JOIN notification_preferences p ON p.user_id = ?
       LEFT JOIN notification_reads nr ON nr.notification_id = n.id AND nr.user_id = ?
       WHERE n.is_active = 1
         AND n.scheduled_at <= NOW()
         AND (n.expires_at IS NULL OR n.expires_at > NOW())
         AND (
           n.audience_type = 'all'
           OR (n.audience_type = 'department' AND LOWER(n.audience_value) = LOWER(?))
           OR (n.audience_type = 'user' AND n.audience_value = ?)
         )
         AND (
           n.category = 'general'
           OR (n.category = 'reflection' AND p.timely_reflections = 1)
           OR (n.category = 'event' AND p.events = 1)
           OR (n.category = 'sermon' AND p.sermons = 1)
           OR (n.category = 'department' AND p.department_updates = 1)
           OR (n.category = 'testimony' AND p.testimonies = 1)
         )
       ORDER BY n.scheduled_at DESC LIMIT 100`,
      [req.user.id, req.user.id, req.user.department || 'None', String(req.user.id)],
    );
    return res.json({
      success: true,
      data: rows,
      unread_count: rows.filter((item) => !item.is_read).length,
    });
  } catch (error) {
    logger.error('getNotifications error:', error.message);
    next(error);
  }
};

exports.markRead = async (req, res, next) => {
  try {
    await db.promise().query(
      `INSERT INTO notification_reads (notification_id, user_id) VALUES (?, ?)
       ON CONFLICT (notification_id, user_id) DO UPDATE SET read_at = NOW()`,
      [req.params.id, req.user.id],
    );
    return res.json({ success: true });
  } catch (error) {
    logger.error('markNotificationRead error:', error.message);
    next(error);
  }
};

exports.markAllRead = async (req, res, next) => {
  try {
    await ensurePreferences(req.user.id);
    await db.pool.query(
      `INSERT INTO notification_reads (notification_id, user_id)
       SELECT n.id, $1 FROM notifications n
       WHERE n.is_active = 1 AND n.scheduled_at <= NOW()
       ON CONFLICT (notification_id, user_id) DO UPDATE SET read_at = NOW()`,
      [req.user.id],
    );
    return res.json({ success: true });
  } catch (error) {
    logger.error('markAllNotificationsRead error:', error.message);
    next(error);
  }
};

exports.getAllForAdmin = async (_req, res, next) => {
  try {
    const [rows] = await db.promise().query(
      `SELECT n.*, u.name AS created_by_name,
        (SELECT COUNT(*) FROM notification_reads nr WHERE nr.notification_id = n.id) AS read_count
       FROM notifications n LEFT JOIN users u ON u.id = n.created_by
       ORDER BY n.scheduled_at DESC LIMIT 200`,
    );
    return res.json({ success: true, data: rows });
  } catch (error) {
    logger.error('getAdminNotifications error:', error.message);
    next(error);
  }
};

exports.createNotification = async (req, res, next) => {
  const {
    title, body, category = 'general', audience_type = 'all', audience_value,
    action_route, scheduled_at, expires_at,
  } = req.body;
  try {
    const categories = ['general', 'reflection', 'event', 'sermon', 'department', 'testimony'];
    const audiences = ['all', 'department', 'user'];
    if (!title?.trim() || !body?.trim()) {
      return res.status(400).json({ success: false, message: 'Notification title and message are required' });
    }
    if (!categories.includes(category) || !audiences.includes(audience_type)) {
      return res.status(400).json({ success: false, message: 'Invalid notification category or audience' });
    }
    if (audience_type !== 'all' && !audience_value?.toString().trim()) {
      return res.status(400).json({ success: false, message: 'Choose a department or member for this audience' });
    }
    const [result] = await db.promise().query(
      `INSERT INTO notifications
        (title, body, category, audience_type, audience_value, action_route,
         scheduled_at, expires_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [title.trim(), body.trim(), category, audience_type,
       audience_type === 'all' ? null : audience_value.toString().trim(),
       action_route || null, scheduled_at || new Date().toISOString(),
       expires_at || null, req.user.id],
    );
    const [rows] = await db.promise().query('SELECT * FROM notifications WHERE id = ?', [result.insertId]);
    return res.status(201).json({ success: true, message: 'Notification scheduled', data: rows[0] });
  } catch (error) {
    logger.error('createNotification error:', error.message);
    next(error);
  }
};

exports.deleteNotification = async (req, res, next) => {
  try {
    const [result] = await db.promise().query('DELETE FROM notifications WHERE id = ?', [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ success: false, message: 'Notification not found' });
    return res.json({ success: true, message: 'Notification deleted' });
  } catch (error) {
    logger.error('deleteNotification error:', error.message);
    next(error);
  }
};
