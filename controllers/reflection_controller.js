const db = require('../config/db_config');
const logger = require('../utils/logger');

const SELECT_FIELDS = `
  SELECT r.id, r.title, r.scripture_reference, r.scripture_text,
         r.reflection_text, r.prayer, r.author_name, r.publish_date,
         r.is_published, r.created_at, r.updated_at,
         creator.name AS created_by_name, editor.name AS updated_by_name
  FROM timely_reflections r
  LEFT JOIN users creator ON creator.id = r.created_by
  LEFT JOIN users editor ON editor.id = r.updated_by
`;

function normalizeText(value, maxLength, required = false) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (required && !text) return null;
  return text ? text.slice(0, maxLength) : null;
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

function reflectionPayload(body) {
  const title = normalizeText(body.title, 200, true);
  const scriptureReference = normalizeText(
    body.scripture_reference,
    150,
    true,
  );
  const scriptureText = normalizeText(body.scripture_text, 10000);
  const reflectionText = normalizeText(body.reflection_text, 30000, true);
  const prayer = normalizeText(body.prayer, 10000);
  const authorName = normalizeText(body.author_name, 150);
  const publishDate = body.publish_date;
  const isPublished = body.is_published === false || body.is_published === 0
    ? 0
    : 1;

  if (!title || !scriptureReference || !reflectionText) {
    return {
      error: 'Title, scripture reference, and reflection message are required.',
    };
  }
  if (!validDate(publishDate)) {
    return { error: 'A valid publish date in YYYY-MM-DD format is required.' };
  }

  return {
    title,
    scriptureReference,
    scriptureText,
    reflectionText,
    prayer,
    authorName,
    publishDate,
    isPublished,
  };
}

exports.getCurrentReflection = async (_req, res, next) => {
  try {
    const [rows] = await db.promise().query(
      `${SELECT_FIELDS}
       WHERE r.is_published = 1 AND r.publish_date <= CURRENT_DATE
       ORDER BY r.publish_date DESC, r.updated_at DESC
       LIMIT 1`,
    );
    return res.json({ success: true, data: rows[0] || null });
  } catch (error) {
    logger.error('getCurrentReflection error:', error.message);
    next(error);
  }
};

exports.getLatestReflectionForAdmin = async (req, res, next) => {
  try {
    const [rows] = await db.promise().query(
      `${SELECT_FIELDS}
       ORDER BY r.publish_date DESC, r.updated_at DESC
       LIMIT 1`,
    );
    logger.info(`REFLECTION | Admin latest requested by ${req.user?.email}`);
    return res.json({ success: true, data: rows[0] || null });
  } catch (error) {
    logger.error('getLatestReflectionForAdmin error:', error.message);
    next(error);
  }
};

exports.getAllReflectionsForAdmin = async (req, res, next) => {
  try {
    const requestedLimit = Number.parseInt(req.query.limit || '50', 10);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), 100)
      : 50;
    const [rows] = await db.promise().query(
      `${SELECT_FIELDS}
       ORDER BY r.publish_date DESC, r.updated_at DESC
       LIMIT ?`,
      [limit],
    );
    logger.info(
      `REFLECTION | Admin list requested by ${req.user?.email}; count:${rows.length}`,
    );
    return res.json({ success: true, data: rows });
  } catch (error) {
    logger.error('getAllReflectionsForAdmin error:', error.message);
    next(error);
  }
};

exports.upsertReflection = async (req, res, next) => {
  const payload = reflectionPayload(req.body);
  if (payload.error) {
    return res.status(400).json({
      success: false,
      message: payload.error,
    });
  }
  const {
    title,
    scriptureReference,
    scriptureText,
    reflectionText,
    prayer,
    authorName,
    publishDate,
    isPublished,
  } = payload;

  try {
    const [existingRows] = await db.promise().query(
      'SELECT id, is_published FROM timely_reflections WHERE publish_date = ?',
      [publishDate],
    );
    const shouldNotify = !existingRows[0] || Number(existingRows[0].is_published) !== 1;

    const [result] = await db.promise().query(
      `INSERT INTO timely_reflections
        (title, scripture_reference, scripture_text, reflection_text, prayer,
         author_name, publish_date, is_published, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (publish_date) DO UPDATE SET
         title = EXCLUDED.title,
         scripture_reference = EXCLUDED.scripture_reference,
         scripture_text = EXCLUDED.scripture_text,
         reflection_text = EXCLUDED.reflection_text,
         prayer = EXCLUDED.prayer,
         author_name = EXCLUDED.author_name,
         is_published = EXCLUDED.is_published,
         updated_by = EXCLUDED.updated_by
       RETURNING id`,
      [
        title,
        scriptureReference,
        scriptureText,
        reflectionText,
        prayer,
        authorName,
        publishDate,
        isPublished,
        req.user.id,
        req.user.id,
      ],
    );
    const reflectionId = result.rows[0].id;

    if (isPublished && shouldNotify) {
      try {
        await db.promise().query(
          `INSERT INTO notifications
            (title, body, category, audience_type, action_route, scheduled_at, created_by)
           VALUES (?, ?, 'reflection', 'all', '/', ?, ?)`,
          [
            `Timely Reflection: ${title}`,
            `${scriptureReference} — Your reflection for today is ready.`,
            `${publishDate}T07:30:00+01:00`,
            req.user.id,
          ],
        );
      } catch (notificationError) {
        logger.warn(`REFLECTION | Notification skipped: ${notificationError.message}`);
      }
    }

    await db.promise().query(
      'INSERT INTO logs (action, user_id, details) VALUES (?, ?, ?)',
      [
        'TIMELY_REFLECTION_SAVED',
        req.user.id,
        `Timely Reflection saved for ${publishDate}${isPublished ? ' and published' : ' as draft'}`,
      ],
    );

    const [rows] = await db.promise().query(
      `${SELECT_FIELDS} WHERE r.id = ?`,
      [reflectionId],
    );
    logger.info(
      `REFLECTION | Saved id:${reflectionId} date:${publishDate} by ${req.user.email}`,
    );
    return res.json({
      success: true,
      message: isPublished
        ? 'Timely Reflection published successfully.'
        : 'Timely Reflection saved as a draft.',
      data: rows[0],
    });
  } catch (error) {
    logger.error('upsertReflection error:', error.message);
    next(error);
  }
};

exports.updateReflection = async (req, res, next) => {
  const reflectionId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(reflectionId) || reflectionId < 1) {
    return res.status(400).json({
      success: false,
      message: 'A valid reflection ID is required.',
    });
  }

  const payload = reflectionPayload(req.body);
  if (payload.error) {
    return res.status(400).json({ success: false, message: payload.error });
  }

  try {
    const [result] = await db.promise().query(
      `UPDATE timely_reflections SET
         title = ?, scripture_reference = ?, scripture_text = ?,
         reflection_text = ?, prayer = ?, author_name = ?, publish_date = ?,
         is_published = ?, updated_by = ?
       WHERE id = ?
       RETURNING id`,
      [
        payload.title,
        payload.scriptureReference,
        payload.scriptureText,
        payload.reflectionText,
        payload.prayer,
        payload.authorName,
        payload.publishDate,
        payload.isPublished,
        req.user.id,
        reflectionId,
      ],
    );
    if (!result.affectedRows) {
      return res.status(404).json({
        success: false,
        message: 'Timely Reflection not found.',
      });
    }

    if (payload.isPublished) {
      try {
        await db.promise().query(
          `INSERT INTO notifications
            (title, body, category, audience_type, action_route, scheduled_at, created_by)
           VALUES (?, ?, 'reflection', 'all', '/', ?, ?)`,
          [
            `Timely Reflection: ${payload.title}`,
            `${payload.scriptureReference} — Your reflection for today is ready.`,
            `${payload.publishDate}T06:00:00+01:00`,
            req.user.id,
          ],
        );
      } catch (notificationError) {
        logger.warn(`REFLECTION | Notification skipped: ${notificationError.message}`);
      }
    }

    await db.promise().query(
      'INSERT INTO logs (action, user_id, details) VALUES (?, ?, ?)',
      [
        'TIMELY_REFLECTION_UPDATED',
        req.user.id,
        `Timely Reflection ${reflectionId} updated for ${payload.publishDate}`,
      ],
    );
    const [rows] = await db.promise().query(
      `${SELECT_FIELDS} WHERE r.id = ?`,
      [reflectionId],
    );
    logger.info(
      `REFLECTION | Updated id:${reflectionId} by ${req.user.email}`,
    );
    return res.json({
      success: true,
      message: payload.isPublished
        ? 'Timely Reflection updated and published.'
        : 'Timely Reflection updated as a draft.',
      data: rows[0],
    });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({
        success: false,
        message: 'Another Timely Reflection already uses that publish date.',
      });
    }
    logger.error('updateReflection error:', error.message);
    next(error);
  }
};

exports.deleteReflection = async (req, res, next) => {
  const reflectionId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(reflectionId) || reflectionId < 1) {
    return res.status(400).json({
      success: false,
      message: 'A valid reflection ID is required.',
    });
  }

  try {
    const [result] = await db.promise().query(
      `DELETE FROM timely_reflections
       WHERE id = ?
       RETURNING id, title, publish_date`,
      [reflectionId],
    );
    if (!result.affectedRows) {
      return res.status(404).json({
        success: false,
        message: 'Timely Reflection not found.',
      });
    }

    const deleted = result.rows[0];
    await db.promise().query(
      'INSERT INTO logs (action, user_id, details) VALUES (?, ?, ?)',
      [
        'TIMELY_REFLECTION_DELETED',
        req.user.id,
        `Timely Reflection ${reflectionId} deleted: ${deleted.title}`,
      ],
    );
    logger.info(
      `REFLECTION | Deleted id:${reflectionId} by ${req.user.email}`,
    );
    return res.json({
      success: true,
      message: 'Timely Reflection deleted successfully.',
      data: deleted,
    });
  } catch (error) {
    logger.error('deleteReflection error:', error.message);
    next(error);
  }
};

