const driveService = require('../services/google_drive_service');
const db = require('../config/db_config');
const logger = require('../utils/logger');
const { removeTemporaryFile } = require('../middleware/media_upload_middleware');

const testimonySelect = `
  SELECT t.*, u.name AS member_name, u.department,
    reviewer.name AS reviewed_by_name
  FROM testimonies t
  JOIN users u ON u.id = t.user_id
  LEFT JOIN users reviewer ON reviewer.id = t.reviewed_by
`;

const kindFromMime = (mime = '') => {
  if (mime.startsWith('image/')) return 'photo';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  return 'written';
};

exports.createTestimony = async (req, res, next) => {
  let driveFile = null;
  try {
    const title = req.body.title?.trim();
    const content = req.body.content?.trim() || null;
    if (!title) return res.status(400).json({ success: false, message: 'Testimony title is required' });
    if (!content && !req.file) {
      return res.status(400).json({ success: false, message: 'Write your testimony or attach a photo, audio, or video file' });
    }

    const kind = req.file ? kindFromMime(req.file.mimetype) : 'written';
    let mediaUrl = null;
    if (req.file) {
      driveFile = await driveService.uploadFile({
        localPath: req.file.path,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        mediaType: kind,
      });
      const apiBaseUrl = `${req.protocol}://${req.get('host')}/api`;
      mediaUrl = `${apiBaseUrl}/testimonies/drive/${encodeURIComponent(driveFile.id)}`;
    }

    const [result] = await db.promise().query(
      `INSERT INTO testimonies
        (user_id, title, content, kind, media_file_id, media_url, mime_type)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, title, content, kind, driveFile?.id || null, mediaUrl,
       driveFile?.mimeType || req.file?.mimetype || null],
    );
    const [rows] = await db.promise().query(`${testimonySelect} WHERE t.id = ?`, [result.insertId]);
    return res.status(201).json({
      success: true,
      message: 'Your testimony was submitted for admin review',
      data: rows[0],
    });
  } catch (error) {
    if (driveFile?.id) await driveService.deleteFile(driveFile.id).catch(() => {});
    logger.error('createTestimony error:', error.message);
    next(error);
  } finally {
    await removeTemporaryFile(req.file?.path).catch(() => {});
  }
};

exports.getMyTestimonies = async (req, res, next) => {
  try {
    const [rows] = await db.promise().query(
      `${testimonySelect} WHERE t.user_id = ? ORDER BY t.created_at DESC`,
      [req.user.id],
    );
    return res.json({ success: true, data: rows });
  } catch (error) {
    logger.error('getMyTestimonies error:', error.message);
    next(error);
  }
};

exports.getPublishedTestimonies = async (req, res, next) => {
  try {
    const featuredOnly = req.query.featured === 'true';
    const [rows] = await db.promise().query(
      `${testimonySelect}
       WHERE t.status = 'published'
       ${featuredOnly ? `AND t.is_featured = 1
         AND (t.featured_from IS NULL OR t.featured_from <= CURRENT_DATE)
         AND (t.featured_until IS NULL OR t.featured_until >= CURRENT_DATE)` : ''}
       ORDER BY t.is_featured DESC, t.reviewed_at DESC, t.created_at DESC
       LIMIT ?`,
      [featuredOnly ? 1 : 50],
    );
    return res.json({ success: true, data: rows });
  } catch (error) {
    logger.error('getPublishedTestimonies error:', error.message);
    next(error);
  }
};

exports.getAllForAdmin = async (req, res, next) => {
  try {
    const status = ['pending', 'published', 'rejected'].includes(req.query.status)
      ? req.query.status : null;
    const [rows] = await db.promise().query(
      `${testimonySelect} ${status ? 'WHERE t.status = ?' : ''}
       ORDER BY CASE WHEN t.status = 'pending' THEN 0 ELSE 1 END, t.created_at DESC`,
      status ? [status] : [],
    );
    return res.json({ success: true, data: rows });
  } catch (error) {
    logger.error('getAllTestimoniesForAdmin error:', error.message);
    next(error);
  }
};

exports.reviewTestimony = async (req, res, next) => {
  const { status, admin_feedback, is_featured, featured_from, featured_until } = req.body;
  try {
    if (!['pending', 'published', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'A valid review status is required' });
    }
    const [existing] = await db.promise().query('SELECT * FROM testimonies WHERE id = ?', [req.params.id]);
    if (!existing.length) return res.status(404).json({ success: false, message: 'Testimony not found' });
    const feature = status === 'published' && (is_featured === true || is_featured === 1 || is_featured === '1') ? 1 : 0;
    if (feature) {
      await db.promise().query('UPDATE testimonies SET is_featured = 0 WHERE is_featured = 1 AND id <> ?', [req.params.id]);
    }
    await db.promise().query(
      `UPDATE testimonies SET status=?, admin_feedback=?, reviewed_by=?, reviewed_at=NOW(),
       is_featured=?, featured_from=?, featured_until=? WHERE id=?`,
      [status, admin_feedback || null, req.user.id, feature,
       feature ? (featured_from || new Date().toISOString().slice(0, 10)) : null,
       feature ? (featured_until || null) : null, req.params.id],
    );
    if (feature) {
      try {
        await db.promise().query(
          `INSERT INTO notifications
            (title, body, category, audience_type, action_route, created_by)
           VALUES (?, ?, 'testimony', 'all', '/testimonies', ?)`,
          ['Featured testimony of the week', existing[0].title, req.user.id],
        );
      } catch (notificationError) {
        logger.warn(`TESTIMONY | Notification skipped: ${notificationError.message}`);
      }
    }
    const [rows] = await db.promise().query(`${testimonySelect} WHERE t.id = ?`, [req.params.id]);
    return res.json({ success: true, message: 'Testimony review saved', data: rows[0] });
  } catch (error) {
    logger.error('reviewTestimony error:', error.message);
    next(error);
  }
};

exports.deleteMyTestimony = async (req, res, next) => {
  try {
    const [rows] = await db.promise().query(
      `SELECT * FROM testimonies WHERE id = ? AND user_id = ? AND status <> 'published'`,
      [req.params.id, req.user.id],
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Editable testimony not found' });
    await driveService.deleteFile(rows[0].media_file_id);
    await db.promise().query('DELETE FROM testimonies WHERE id = ?', [req.params.id]);
    return res.json({ success: true, message: 'Testimony removed' });
  } catch (error) {
    logger.error('deleteMyTestimony error:', error.message);
    next(error);
  }
};

exports.deleteTestimonyForAdmin = async (req, res, next) => {
  try {
    const [rows] = await db.promise().query('SELECT * FROM testimonies WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Testimony not found' });
    await driveService.deleteFile(rows[0].media_file_id);
    await db.promise().query('DELETE FROM testimonies WHERE id = ?', [req.params.id]);
    return res.json({ success: true, message: 'Testimony deleted' });
  } catch (error) {
    logger.error('deleteTestimonyForAdmin error:', error.message);
    next(error);
  }
};

exports.streamTestimonyFile = async (req, res, next) => {
  try {
    const [rows] = await db.promise().query(
      `SELECT mime_type, user_id, status FROM testimonies WHERE media_file_id = ?`,
      [req.params.fileId],
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Testimony media not found' });
    const testimony = rows[0];
    const canView = testimony.status === 'published' || testimony.user_id === req.user.id || req.user.role === 'admin';
    if (!canView) return res.status(403).json({ success: false, message: 'This testimony is awaiting review' });
    const response = await driveService.getFileStream(req.params.fileId, req.headers.range);
    const headers = response.headers || {};
    res.status(response.status || 200);
    res.setHeader('Content-Type', headers['content-type'] || testimony.mime_type || 'application/octet-stream');
    res.setHeader('Accept-Ranges', headers['accept-ranges'] || 'bytes');
    if (headers['content-length']) res.setHeader('Content-Length', headers['content-length']);
    if (headers['content-range']) res.setHeader('Content-Range', headers['content-range']);
    response.data.on('error', next);
    response.data.pipe(res);
  } catch (error) {
    next(error);
  }
};
