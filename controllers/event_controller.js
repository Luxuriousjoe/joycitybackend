const db = require('../config/db_config');
const logger = require('../utils/logger');

const asFlag = (value, fallback = 1) => {
  if (value === undefined) return fallback;
  return value === true || value === 1 || value === '1' ? 1 : 0;
};

const eventSelect = `
  SELECT e.*, creator.name AS created_by_name, editor.name AS updated_by_name
  FROM church_events e
  LEFT JOIN users creator ON creator.id = e.created_by
  LEFT JOIN users editor ON editor.id = e.updated_by
`;

exports.getPublishedEvents = async (req, res, next) => {
  try {
    const includePast = req.query.include_past === 'true';
    const [rows] = await db.promise().query(
      `${eventSelect}
       WHERE e.is_published = 1
         ${includePast ? '' : 'AND COALESCE(e.ends_at, e.starts_at) >= NOW()'}
       ORDER BY e.starts_at ASC`,
    );
    return res.json({ success: true, data: rows });
  } catch (error) {
    logger.error('getPublishedEvents error:', error.message);
    next(error);
  }
};

exports.getAllEventsForAdmin = async (req, res, next) => {
  try {
    const [rows] = await db.promise().query(`${eventSelect} ORDER BY e.starts_at DESC`);
    return res.json({ success: true, data: rows });
  } catch (error) {
    logger.error('getAllEventsForAdmin error:', error.message);
    next(error);
  }
};

exports.createEvent = async (req, res, next) => {
  const {
    title, description, category, location, starts_at, ends_at,
    image_url, registration_url, is_published,
  } = req.body;
  try {
    if (!title?.trim() || !starts_at || Number.isNaN(Date.parse(starts_at))) {
      return res.status(400).json({ success: false, message: 'Event title and a valid start date are required' });
    }
    if (ends_at && Number.isNaN(Date.parse(ends_at))) {
      return res.status(400).json({ success: false, message: 'Event end date is invalid' });
    }
    if (ends_at && new Date(ends_at).getTime() < new Date(starts_at).getTime()) {
      return res.status(400).json({ success: false, message: 'Event end cannot be before its start' });
    }
    const [result] = await db.promise().query(
      `INSERT INTO church_events
        (title, description, category, location, starts_at, ends_at, image_url,
         registration_url, is_published, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [title.trim(), description || null, category || null, location || null,
       starts_at, ends_at || null, image_url || null, registration_url || null,
       asFlag(is_published), req.user.id, req.user.id],
    );
    const [rows] = await db.promise().query(`${eventSelect} WHERE e.id = ?`, [result.insertId]);

    if (asFlag(is_published) === 1) {
      try {
        await db.promise().query(
          `INSERT INTO notifications
            (title, body, category, audience_type, action_route, created_by)
           VALUES (?, ?, 'event', 'all', ?, ?)`,
          ['New event: ' + title.trim(), description || `Save the date for ${title.trim()}.`,
           '/events', req.user.id],
        );
        const reminderAt = new Date(new Date(starts_at).getTime() - 24 * 60 * 60 * 1000);
        if (reminderAt.getTime() > Date.now()) {
          await db.promise().query(
            `INSERT INTO notifications
              (title, body, category, audience_type, action_route, scheduled_at, created_by)
             VALUES (?, ?, 'event', 'all', '/events', ?, ?)`,
            [`Tomorrow: ${title.trim()}`,
             `${location || 'Joy City International'} • Your event reminder is ready.`,
             reminderAt.toISOString(), req.user.id],
          );
        }
      } catch (notificationError) {
        logger.warn(`EVENT | Notification skipped: ${notificationError.message}`);
      }
    }
    return res.status(201).json({ success: true, message: 'Event created', data: rows[0] });
  } catch (error) {
    logger.error('createEvent error:', error.message);
    next(error);
  }
};

exports.updateEvent = async (req, res, next) => {
  const { id } = req.params;
  const {
    title, description, category, location, starts_at, ends_at,
    image_url, registration_url, is_published,
  } = req.body;
  try {
    const [existing] = await db.promise().query('SELECT * FROM church_events WHERE id = ?', [id]);
    if (!existing.length) return res.status(404).json({ success: false, message: 'Event not found' });
    const current = existing[0];
    const nextStart = starts_at ?? current.starts_at;
    const suppliedEnd = Object.prototype.hasOwnProperty.call(req.body, 'ends_at');
    const nextEnd = suppliedEnd ? (ends_at || null) : current.ends_at;
    if (!title?.trim() || Number.isNaN(Date.parse(nextStart))) {
      return res.status(400).json({ success: false, message: 'Event title and a valid start date are required' });
    }
    if (nextEnd && Number.isNaN(Date.parse(nextEnd))) {
      return res.status(400).json({ success: false, message: 'Event end date is invalid' });
    }
    if (nextEnd && new Date(nextEnd).getTime() < new Date(nextStart).getTime()) {
      return res.status(400).json({ success: false, message: 'Event end cannot be before its start' });
    }
    await db.promise().query(
      `UPDATE church_events SET title=?, description=?, category=?, location=?,
       starts_at=?, ends_at=?, image_url=?, registration_url=?, is_published=?, updated_by=?
       WHERE id=?`,
      [title.trim(), description ?? current.description, category ?? current.category,
       location ?? current.location, nextStart, nextEnd,
       image_url === '' ? null : (image_url ?? current.image_url),
       registration_url === '' ? null : (registration_url ?? current.registration_url),
       asFlag(is_published, current.is_published), req.user.id, id],
    );
    const [rows] = await db.promise().query(`${eventSelect} WHERE e.id = ?`, [id]);
    return res.json({ success: true, message: 'Event updated', data: rows[0] });
  } catch (error) {
    logger.error('updateEvent error:', error.message);
    next(error);
  }
};

exports.deleteEvent = async (req, res, next) => {
  try {
    const [result] = await db.promise().query('DELETE FROM church_events WHERE id = ?', [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ success: false, message: 'Event not found' });
    return res.json({ success: true, message: 'Event deleted' });
  } catch (error) {
    logger.error('deleteEvent error:', error.message);
    next(error);
  }
};
