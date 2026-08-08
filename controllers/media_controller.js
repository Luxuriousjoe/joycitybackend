const db     = require('../config/db_config');
const config = require('../config/app_config');
const driveService = require('../services/google_drive_service');
const { removeTemporaryFile } = require('../middleware/media_upload_middleware');
const logger = require('../utils/logger');

// ─── GET ALL MEDIA ────────────────────────────────────────────
exports.getAllMedia = async (req, res, next) => {
  const { type, page = 1, limit = 20, search } = req.query;
  logger.info(`MEDIA | getAllMedia | type:${type||'all'} page:${page} search:${search||'none'}`);
  try {
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let query = `
      SELECT m.id, m.type, m.title, m.file_path, m.thumbnail_url, m.status,
        m.drive_file_id, m.drive_web_view_link, m.mime_type, m.file_size,
        m.created_at,
        u.name AS uploaded_by_name,
        mm.event_name, mm.location, mm.description, mm.speaker_name,
        mm.sermon_topic, mm.series_name, mm.scripture_reference, mm.service_date,
        up_yt.youtube_link, up_yt.youtube_video_id,
        up_tg.telegram_msg_id
      FROM media m
      LEFT JOIN users u ON m.uploaded_by = u.id
      LEFT JOIN media_metadata mm ON m.id = mm.media_id
      LEFT JOIN uploads up_yt ON m.id = up_yt.media_id AND up_yt.platform = 'youtube' AND up_yt.upload_status = 'success'
      LEFT JOIN uploads up_tg ON m.id = up_tg.media_id AND up_tg.platform = 'telegram' AND up_tg.upload_status = 'success'
      WHERE m.status = 'uploaded'
    `;
    const params = [];
    const countParams = [];
    const countConditions = [];
    if (type && ['video', 'photo', 'audio'].includes(type)) {
      query += ' AND m.type = ?'; params.push(type);
      countConditions.push('m.type = ?'); countParams.push(type);
    }
    if (search) {
      query += ` AND (mm.event_name ILIKE ? OR mm.description ILIKE ? OR
        mm.speaker_name ILIKE ? OR mm.sermon_topic ILIKE ? OR
        mm.series_name ILIKE ? OR mm.scripture_reference ILIKE ? OR m.title ILIKE ?)`;
      const s = `%${search}%`; params.push(s, s, s, s, s, s, s);
      countConditions.push(`(mm.event_name ILIKE ? OR mm.description ILIKE ? OR
        mm.speaker_name ILIKE ? OR mm.sermon_topic ILIKE ? OR
        mm.series_name ILIKE ? OR mm.scripture_reference ILIKE ? OR m.title ILIKE ?)`);
      countParams.push(s, s, s, s, s, s, s);
    }
    query += ' ORDER BY m.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), offset);

    const [rows] = await db.promise().query(query, params);
    const [[{ total }]] = await db.promise().query(
      `SELECT COUNT(*) AS total FROM media m LEFT JOIN media_metadata mm ON m.id = mm.media_id
       WHERE m.status = 'uploaded' ${countConditions.length ? `AND ${countConditions.join(' AND ')}` : ''}`,
      countParams
    );

    logger.db('SELECT', 'media', `returned ${rows.length} of ${total} items`);
    return res.json({
      success: true, data: rows,
      pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / limit) },
    });
  } catch (err) { logger.error('getAllMedia error:', err.message); next(err); }
};

// ─── GET MEDIA BY ID ──────────────────────────────────────────
exports.getMediaById = async (req, res, next) => {
  const { id } = req.params;
  logger.info(`MEDIA | getMediaById | id:${id}`);
  try {
    const [rows] = await db.promise().query(
      `SELECT m.id, m.type, m.file_path, m.title, m.thumbnail_url, m.status,
        m.drive_file_id, m.drive_web_view_link, m.mime_type, m.file_name,
        m.file_size, m.created_at,
        u.name AS uploaded_by_name,
        mm.event_name, mm.location, mm.description, mm.participants,
        mm.speaker_name, mm.sermon_topic, mm.series_name,
        mm.scripture_reference, mm.service_date,
        up_yt.youtube_link, up_yt.youtube_video_id, up_tg.telegram_msg_id
       FROM media m
       LEFT JOIN users u ON m.uploaded_by = u.id
       LEFT JOIN media_metadata mm ON m.id = mm.media_id
       LEFT JOIN uploads up_yt ON m.id = up_yt.media_id AND up_yt.platform = 'youtube'
       LEFT JOIN uploads up_tg ON m.id = up_tg.media_id AND up_tg.platform = 'telegram'
       WHERE m.id = ?`,
      [id]
    );
    if (!rows.length) {
      logger.warn(`MEDIA | id:${id} not found`);
      return res.status(404).json({ success: false, message: 'Media not found' });
    }
    logger.db('SELECT', 'media', `found media id:${id} type:${rows[0].type}`);
    return res.json({ success: true, data: rows[0] });
  } catch (err) { logger.error('getMediaById error:', err.message); next(err); }
};

// Stream private Drive files through the API when public Drive permissions are
// disabled. File IDs are checked against PostgreSQL before any Drive request.
exports.streamDriveFile = async (req, res, next) => {
  try {
    const [rows] = await db.promise().query(
      `SELECT mime_type FROM media
       WHERE drive_file_id = ? AND status = 'uploaded'`,
      [req.params.fileId],
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Media not found' });
    }

    const response = await driveService.getFileStream(
      req.params.fileId,
      req.headers.range,
    );
    const headers = response.headers || {};
    res.status(response.status || 200);
    res.setHeader('Content-Type', headers['content-type'] || rows[0].mime_type || 'application/octet-stream');
    res.setHeader('Accept-Ranges', headers['accept-ranges'] || 'bytes');
    if (headers['content-length']) res.setHeader('Content-Length', headers['content-length']);
    if (headers['content-range']) res.setHeader('Content-Range', headers['content-range']);
    response.data.on('error', next);
    response.data.pipe(res);
  } catch (error) {
    next(error);
  }
};

// ─── CREATE MEDIA (Admin) ─────────────────────────────────────
exports.createMedia = async (req, res, next) => {
  const { type, title, metadata } = req.body;
  logger.info(`MEDIA | createMedia | type:${type} title:${title} by user:${req.user?.id}`);
  let driveFile = null;
  let transactionClient = null;

  try {
    if (!type || !['video', 'photo', 'audio'].includes(type)) {
      return res.status(400).json({ success: false, message: 'Valid media type required (video/photo/audio)' });
    }
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'A media file is required. Send it in the multipart field named "file".',
      });
    }

    const expectedMimePrefix = `${type}/`;
    const actualMimePrefix = type === 'photo' ? 'image/' : expectedMimePrefix;
    if (!req.file.mimetype.startsWith(actualMimePrefix)) {
      return res.status(400).json({
        success: false,
        message: `The selected ${type} does not match the uploaded file type.`,
      });
    }

    driveFile = await driveService.uploadFile({
      localPath: req.file.path,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      mediaType: type,
    });

    const apiBaseUrl = `${req.protocol}://${req.get('host')}/api`;
    const urls = driveService.buildDriveUrls(driveFile.id, apiBaseUrl);
    const contentUrl = driveFile.contentUrl || urls.apiContentUrl;
    const thumbnailUrl = type === 'photo' ? contentUrl : null;

    const parsedMetadata = typeof metadata === 'string' ? (() => {
      try { return JSON.parse(metadata); } catch (_error) { return {}; }
    })() : (metadata || {});

    transactionClient = await db.pool.connect();
    await transactionClient.query('BEGIN');

    const mediaResult = await transactionClient.query(
      `INSERT INTO media
        (type, title, file_path, thumbnail_url, status, uploaded_by,
         drive_file_id, drive_web_view_link, mime_type, file_name, file_size)
       VALUES ($1, $2, $3, $4, 'uploaded', $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        type,
        title || null,
        contentUrl,
        thumbnailUrl,
        req.user.id,
        driveFile.id,
        driveFile.webViewLink,
        driveFile.mimeType || req.file.mimetype,
        driveFile.name || req.file.originalname,
        driveFile.size || req.file.size,
      ],
    );
    const mediaId = mediaResult.rows[0].id;
    logger.db('INSERT', 'media', `created Drive-backed media id:${mediaId}`);

    await transactionClient.query(
      `INSERT INTO media_metadata
        (media_id, event_name, location, description, participants,
         speaker_name, sermon_topic, series_name, scripture_reference, service_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        mediaId,
        parsedMetadata.event_name || null,
        parsedMetadata.location || null,
        parsedMetadata.description || null,
        parsedMetadata.participants || null,
        parsedMetadata.speaker_name || null,
        parsedMetadata.sermon_topic || null,
        parsedMetadata.series_name || null,
        parsedMetadata.scripture_reference || null,
        parsedMetadata.service_date || null,
      ],
    );

    await transactionClient.query(
      `INSERT INTO uploads
        (media_id, platform, upload_status, upload_date)
       VALUES ($1, 'google_drive', 'success', NOW())`,
      [mediaId],
    );

    if (config.telegram.botToken && config.telegram.channelId) {
      await transactionClient.query(
        `INSERT INTO uploads (media_id, platform) VALUES ($1, 'telegram')`,
        [mediaId],
      );
    }
    if (
      type !== 'photo' &&
      config.youtube.clientId &&
      config.youtube.clientSecret &&
      config.youtube.refreshToken
    ) {
      await transactionClient.query(
        `INSERT INTO uploads (media_id, platform) VALUES ($1, 'youtube')`,
        [mediaId],
      );
    }

    await transactionClient.query(
      'INSERT INTO logs (action, user_id, details) VALUES ($1, $2, $3)',
      ['MEDIA_CREATED', req.user.id, `${type} media stored in Google Drive: ${title || driveFile.name}`],
    );
    await transactionClient.query('COMMIT');

    if (type === 'audio' || type === 'video') {
      try {
        await db.promise().query(
          `INSERT INTO notifications
            (title, body, category, audience_type, action_route, created_by)
           VALUES (?, ?, 'sermon', 'all', ?, ?)`,
          [
            `New ${type === 'audio' ? 'audio' : 'video'} sermon`,
            title || parsedMetadata.sermon_topic || 'A new Joy City teaching is ready.',
            `/media/${mediaId}`,
            req.user.id,
          ],
        );
      } catch (notificationError) {
        logger.warn(`MEDIA | Notification skipped for id:${mediaId}: ${notificationError.message}`);
      }
    }

    logger.media('DRIVE_STORED', type, mediaId, `by user:${req.user.id}`);
    return res.status(201).json({
      success: true,
      message: 'Media uploaded to Google Drive',
      data: {
        id: mediaId,
        status: 'uploaded',
        file_path: contentUrl,
        thumbnail_url: thumbnailUrl,
        drive_file_id: driveFile.id,
        drive_web_view_link: driveFile.webViewLink,
      },
    });
  } catch (err) {
    if (transactionClient) await transactionClient.query('ROLLBACK').catch(() => {});
    if (driveFile?.id) await driveService.deleteFile(driveFile.id).catch(() => {});
    logger.error('createMedia error:', err.message);
    next(err);
  } finally {
    transactionClient?.release();
    await removeTemporaryFile(req.file?.path).catch((error) => {
      logger.warn(`TEMP | Could not remove ${req.file?.path}: ${error.message}`);
    });
  }
};

// ─── UPDATE MEDIA (Admin) ─────────────────────────────────────
exports.updateMedia = async (req, res, next) => {
  const { id } = req.params;
  logger.info(`MEDIA | updateMedia | id:${id} by user:${req.user?.id}`);
  try {
    const { title, metadata } = req.body;
    if (title) {
      await db.promise().query('UPDATE media SET title = ? WHERE id = ?', [title, id]);
      logger.db('UPDATE', 'media', `title updated for id:${id}`);
    }
    if (metadata) {
      await db.promise().query(
        `UPDATE media_metadata SET event_name=?, location=?, description=?, participants=?,
         speaker_name=?, sermon_topic=?, series_name=?, scripture_reference=?, service_date=? WHERE media_id=?`,
        [metadata.event_name, metadata.location, metadata.description, metadata.participants,
         metadata.speaker_name, metadata.sermon_topic, metadata.series_name,
         metadata.scripture_reference, metadata.service_date, id]
      );
      logger.db('UPDATE', 'media_metadata', `metadata updated for media id:${id}`);
    }
    return res.json({ success: true, message: 'Media updated' });
  } catch (err) { logger.error('updateMedia error:', err.message); next(err); }
};

// ─── DELETE MEDIA (Admin) ─────────────────────────────────────
exports.deleteMedia = async (req, res, next) => {
  const { id } = req.params;
  logger.info(`MEDIA | deleteMedia | id:${id} by user:${req.user?.id}`);
  try {
    const [rows] = await db.promise().query('SELECT * FROM media WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Media not found' });
    await driveService.deleteFile(rows[0].drive_file_id);
    await db.promise().query('DELETE FROM media WHERE id = ?', [id]);
    await db.promise().query('INSERT INTO logs (action, user_id, details) VALUES (?, ?, ?)',
      ['MEDIA_DELETED', req.user.id, `Deleted media id:${id}`]);
    logger.media('DELETED', rows[0].type, id, `by user:${req.user.id}`);
    return res.json({ success: true, message: 'Media deleted' });
  } catch (err) { logger.error('deleteMedia error:', err.message); next(err); }
};

// ─── ADMIN QUEUE ──────────────────────────────────────────────
exports.getAdminQueue = async (req, res, next) => {
  logger.info(`MEDIA | getAdminQueue | for user:${req.user?.id}`);
  try {
    const [rows] = await db.promise().query(
      `SELECT m.*, mm.event_name, mm.speaker_name,
        up_yt.upload_status AS youtube_status, up_yt.youtube_link,
        up_tg.upload_status AS telegram_status, up_tg.telegram_msg_id
       FROM media m
       LEFT JOIN media_metadata mm ON m.id = mm.media_id
       LEFT JOIN uploads up_yt ON m.id = up_yt.media_id AND up_yt.platform = 'youtube'
       LEFT JOIN uploads up_tg ON m.id = up_tg.media_id AND up_tg.platform = 'telegram'
       WHERE m.uploaded_by = ? ORDER BY m.created_at DESC LIMIT 50`,
      [req.user.id]
    );
    logger.db('SELECT', 'media+uploads', `admin queue: ${rows.length} items for user:${req.user.id}`);
    return res.json({ success: true, data: rows });
  } catch (err) { logger.error('getAdminQueue error:', err.message); next(err); }
};

// ─── UPDATE THUMBNAIL ─────────────────────────────────────────
exports.updateThumbnail = async (req, res, next) => {
  const { id } = req.params;
  const { thumbnail_url } = req.body;
  logger.info(`MEDIA | updateThumbnail | id:${id}`);
  try {
    await db.promise().query('UPDATE media SET thumbnail_url = ? WHERE id = ?', [thumbnail_url, id]);
    logger.db('UPDATE', 'media', `thumbnail updated for id:${id}`);
    return res.json({ success: true, message: 'Thumbnail updated' });
  } catch (err) { logger.error('updateThumbnail error:', err.message); next(err); }
};
