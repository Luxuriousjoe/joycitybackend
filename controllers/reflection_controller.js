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

exports.upsertReflection = async (req, res, next) => {
  const title = normalizeText(req.body.title, 200, true);
  const scriptureReference = normalizeText(
    req.body.scripture_reference,
    150,
    true,
  );
  const scriptureText = normalizeText(req.body.scripture_text, 10000);
  const reflectionText = normalizeText(req.body.reflection_text, 30000, true);
  const prayer = normalizeText(req.body.prayer, 10000);
  const authorName = normalizeText(req.body.author_name, 150);
  const publishDate = req.body.publish_date;
  const isPublished = req.body.is_published === false || req.body.is_published === 0
    ? 0
    : 1;

  if (!title || !scriptureReference || !reflectionText) {
    return res.status(400).json({
      success: false,
      message: 'Title, scripture reference, and reflection message are required.',
    });
  }
  if (!validDate(publishDate)) {
    return res.status(400).json({
      success: false,
      message: 'A valid publish date in YYYY-MM-DD format is required.',
    });
  }

  try {
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
