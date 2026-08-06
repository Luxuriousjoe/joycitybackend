// ═══════════════════════════════════════════════════════════════
//  JOY CITY INTERNATIONAL — Upload Controller
//  Handles: queue display, upload triggering, retry, saved videos,
//           YouTube channel video caching
// ═══════════════════════════════════════════════════════════════
const db              = require('../config/db_config');
const youtubeService  = require('../services/youtube_service');
const telegramService = require('../services/telegram_service');
const logger          = require('../utils/logger');

// ─── GET Upload Queue (with full media details) ───────────────
exports.getUploadQueue = async (req, res, next) => {
  logger.info(`UPLOADS | getUploadQueue | by ${req.user?.email}`);
  try {
    const [rows] = await db.promise().query(
      `SELECT
         u.id, u.media_id, u.platform, u.upload_status,
         u.telegram_msg_id, u.youtube_link, u.youtube_video_id,
         u.retry_count, u.error_message, u.upload_date,
         u.created_at,
         m.type, m.title, m.file_path, m.status AS media_status,
         m.thumbnail_url,
         mm.event_name, mm.speaker_name, mm.sermon_topic
       FROM uploads u
       JOIN media m ON u.media_id = m.id
       LEFT JOIN media_metadata mm ON m.id = mm.media_id
       ORDER BY u.created_at DESC
       LIMIT 100`
    );
    logger.db('SELECT', 'uploads', `returned ${rows.length} records`);
    return res.json({ success: true, data: rows });
  } catch (err) { logger.error('getUploadQueue error:', err.message); next(err); }
};

// ─── UPDATE Upload Status ─────────────────────────────────────
exports.updateUploadStatus = async (req, res, next) => {
  const { mediaId } = req.params;
  const { platform, upload_status, telegram_msg_id, youtube_link, youtube_video_id, error_message } = req.body;
  logger.info(`UPLOADS | updateStatus | media:${mediaId} platform:${platform} → ${upload_status}`);
  try {
    await db.promise().query(
      `UPDATE uploads SET
         upload_status    = ?,
         telegram_msg_id  = COALESCE(?, telegram_msg_id),
         youtube_link     = COALESCE(?, youtube_link),
         youtube_video_id = COALESCE(?, youtube_video_id),
         error_message    = COALESCE(?, error_message),
         upload_date      = CASE WHEN ? = 'success' THEN NOW() ELSE upload_date END
       WHERE media_id = ? AND platform = ?`,
      [upload_status,
       telegram_msg_id  || null,
       youtube_link     || null,
       youtube_video_id || null,
       error_message    || null,
       upload_status, mediaId, platform]
    );

    // Update overall media status
    const [uploads]  = await db.promise().query('SELECT platform, upload_status FROM uploads WHERE media_id = ?', [mediaId]);
    const allSuccess = uploads.every(u => u.upload_status === 'success');
    const anyFailed  = uploads.some(u => u.upload_status === 'failed');
    const newStatus  = allSuccess ? 'uploaded' : anyFailed ? 'failed' : 'uploading';
    await db.promise().query('UPDATE media SET status = ? WHERE id = ?', [newStatus, mediaId]);

    logger.media('STATUS_UPD', platform, mediaId, `→ ${upload_status} | media → ${newStatus}`);
    return res.json({ success: true, message: 'Status updated' });
  } catch (err) { logger.error('updateUploadStatus error:', err.message); next(err); }
};

// ─── TRIGGER Upload (async — responds immediately) ────────────
exports.triggerUpload = async (req, res, next) => {
  const { mediaId } = req.params;
  logger.media('TRIGGER', '?', mediaId, `by ${req.user?.email}`);

  try {
    const [mediaRows] = await db.promise().query(
      `SELECT m.*, mm.event_name, mm.description, mm.speaker_name,
              mm.sermon_topic, mm.service_date, mm.location
       FROM media m
       LEFT JOIN media_metadata mm ON m.id = mm.media_id
       WHERE m.id = ?`,
      [mediaId]
    );
    if (!mediaRows.length) {
      return res.status(404).json({ success: false, message: 'Media not found' });
    }

    const media = mediaRows[0];
    logger.info(`TRIGGER | Found media: type=${media.type} title=${media.title} path=${media.file_path}`);

    // Respond immediately — upload runs in background
    res.json({ success: true, message: 'Upload started', data: { mediaId, type: media.type } });

    // ── Async upload process ──────────────────────────────────
    await db.promise().query('UPDATE media SET status = "uploading" WHERE id = ?', [mediaId]);
    await db.promise().query('UPDATE uploads SET upload_status = "in_progress" WHERE media_id = ?', [mediaId]);

    let youtubeLink    = null;
    let youtubeVideoId = null;
    let telegramMsgId  = null;
    let ytError        = null;
    let tgError        = null;

    // ── YouTube Upload (videos and audio only) ────────────────
    if (media.type !== 'photo') {
      try {
        logger.media('YT_START', media.type, mediaId, 'uploading to YouTube...');
        const ytResult  = await youtubeService.uploadMedia(media);
        youtubeLink     = ytResult.link;
        youtubeVideoId  = ytResult.videoId;

        await db.promise().query(
          `UPDATE uploads SET upload_status = 'success', youtube_link = ?, youtube_video_id = ?, upload_date = NOW()
           WHERE media_id = ? AND platform = 'youtube'`,
          [youtubeLink, youtubeVideoId, mediaId]
        );
        // Also save thumbnail URL from YouTube
        const thumbUrl = `https://img.youtube.com/vi/${youtubeVideoId}/hqdefault.jpg`;
        await db.promise().query('UPDATE media SET thumbnail_url = ? WHERE id = ?', [thumbUrl, mediaId]);

        logger.media('YT_DONE', media.type, mediaId, youtubeLink);
      } catch (err) {
        ytError = err.message;
        logger.error(`YT_FAIL | media:${mediaId} | ${err.message}`);
        await db.promise().query(
          `UPDATE uploads SET upload_status = 'failed', error_message = ? WHERE media_id = ? AND platform = 'youtube'`,
          [err.message, mediaId]
        );
      }
    } else {
      // Photos skip YouTube — mark as success immediately
      await db.promise().query(
        `UPDATE uploads SET upload_status = 'success', upload_date = NOW() WHERE media_id = ? AND platform = 'youtube'`,
        [mediaId]
      );
    }

    // ── Telegram Upload (all types) ───────────────────────────
    try {
      logger.media('TG_START', media.type, mediaId, 'sending to Telegram...');
      // For video/audio, pass youtube link so Telegram message includes it
      const mediaWithLink = { ...media, youtube_link: youtubeLink };
      const tgResult      = await telegramService.sendMedia(mediaWithLink);
      telegramMsgId       = tgResult.messageId;

      await db.promise().query(
        `UPDATE uploads SET upload_status = 'success', telegram_msg_id = ?, upload_date = NOW()
         WHERE media_id = ? AND platform = 'telegram'`,
        [telegramMsgId, mediaId]
      );
      logger.media('TG_DONE', media.type, mediaId, `msg_id:${telegramMsgId}`);
    } catch (err) {
      tgError = err.message;
      logger.error(`TG_FAIL | media:${mediaId} | ${err.message}`);
      await db.promise().query(
        `UPDATE uploads SET upload_status = 'failed', error_message = ? WHERE media_id = ? AND platform = 'telegram'`,
        [err.message, mediaId]
      );
    }

    // ── Set final media status ────────────────────────────────
    const bothFailed = ytError && tgError;
    const anySuccess = !ytError || !tgError || media.type === 'photo';
    const finalStatus = bothFailed ? 'failed' : (anySuccess ? 'uploaded' : 'failed');
    await db.promise().query('UPDATE media SET status = ? WHERE id = ?', [finalStatus, mediaId]);
    logger.media('COMPLETE', media.type, mediaId, `final status: ${finalStatus}`);

    // ── Auto-refresh YouTube channel cache after upload ───────
    if (!ytError && media.type !== 'photo') {
      setTimeout(async () => {
        try {
          await youtubeService.fetchChannelVideos();
          logger.info('YT | Channel video cache refreshed after upload');
        } catch (e) {
          logger.warn('YT | Cache refresh failed:', e.message);
        }
      }, 10000); // Wait 10s for YouTube to process
    }

  } catch (err) {
    logger.error('triggerUpload error:', err.message);
    await db.promise().query('UPDATE media SET status = "failed" WHERE id = ?', [mediaId]).catch(() => {});
  }
};

// ─── RETRY Failed Uploads (cron) ─────────────────────────────
exports.retryFailedUploads = async () => {
  logger.info('CRON | Checking for failed uploads...');
  try {
    const [failed] = await db.promise().query(
      `SELECT u.*, m.file_path, m.type, m.title, m.thumbnail_url,
              mm.event_name, mm.description, mm.speaker_name, mm.sermon_topic, mm.service_date
       FROM uploads u
       JOIN media m ON u.media_id = m.id
       LEFT JOIN media_metadata mm ON m.id = mm.media_id
       WHERE u.upload_status = 'failed' AND u.retry_count < 3`
    );
    if (!failed.length) { logger.info('CRON | No failed uploads'); return; }
    logger.info(`CRON | Retrying ${failed.length} failed upload(s)`);

    for (const upload of failed) {
      await db.promise().query(
        'UPDATE uploads SET upload_status = "in_progress", retry_count = retry_count + 1 WHERE id = ?',
        [upload.id]
      );
      try {
        if (upload.platform === 'youtube' && upload.type !== 'photo') {
          const ytResult = await youtubeService.uploadMedia(upload);
          await db.promise().query(
            `UPDATE uploads SET upload_status = 'success', youtube_link = ?, youtube_video_id = ?, upload_date = NOW() WHERE id = ?`,
            [ytResult.link, ytResult.videoId, upload.id]
          );
          logger.media('RETRY_OK', 'youtube', upload.media_id, ytResult.link);
        } else if (upload.platform === 'telegram') {
          const tgResult = await telegramService.sendMedia(upload);
          await db.promise().query(
            `UPDATE uploads SET upload_status = 'success', telegram_msg_id = ?, upload_date = NOW() WHERE id = ?`,
            [tgResult.messageId, upload.id]
          );
          logger.media('RETRY_OK', 'telegram', upload.media_id, tgResult.messageId);
        }
      } catch (err) {
        await db.promise().query(
          'UPDATE uploads SET upload_status = "failed", error_message = ? WHERE id = ?',
          [err.message, upload.id]
        );
        logger.error(`RETRY_FAIL | id:${upload.id} | ${err.message}`);
      }
    }
  } catch (err) { logger.error('retryFailedUploads:', err.message); }
};

// ─── GET YouTube Channel Videos (for home screen) ────────────
exports.getChannelVideos = async (req, res, next) => {
  logger.info('UPLOADS | getChannelVideos');
  try {
    const videos = await youtubeService.getCachedChannelVideos(20);
    return res.json({ success: true, data: videos });
  } catch (err) { logger.error('getChannelVideos error:', err.message); next(err); }
};

// ─── REFRESH YouTube Channel Videos (admin trigger) ──────────
exports.refreshChannelVideos = async (req, res, next) => {
  logger.info(`UPLOADS | refreshChannelVideos | by ${req.user?.email}`);
  try {
    const videos = await youtubeService.fetchChannelVideos();
    return res.json({ success: true, message: `Fetched ${videos.length} videos`, data: videos });
  } catch (err) { logger.error('refreshChannelVideos error:', err.message); next(err); }
};

// ─── SAVE Video for later (user action) ──────────────────────
exports.saveVideo = async (req, res, next) => {
  const userId = req.user.id;
  const { media_id, video_id, title, thumbnail_url, youtube_url } = req.body;
  logger.info(`UPLOADS | saveVideo | user:${userId} media:${media_id} ytVid:${video_id}`);
  try {
    if (!media_id && !video_id) {
      return res.status(400).json({ success: false, message: 'media_id or video_id required' });
    }
    const conflictTarget = media_id
      ? '(user_id, media_id) WHERE media_id IS NOT NULL'
      : '(user_id, video_id) WHERE video_id IS NOT NULL';

    await db.promise().query(
      `INSERT INTO saved_videos (user_id, media_id, video_id, title, thumbnail_url, youtube_url)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT ${conflictTarget} DO UPDATE SET
         title = EXCLUDED.title,
         thumbnail_url = EXCLUDED.thumbnail_url,
         youtube_url = EXCLUDED.youtube_url,
         saved_at = NOW()`,
      [userId, media_id || null, video_id || null, title || null, thumbnail_url || null, youtube_url || null]
    );
    logger.info(`UPLOADS | Video saved for user:${userId}`);
    return res.json({ success: true, message: 'Saved for later' });
  } catch (err) { logger.error('saveVideo error:', err.message); next(err); }
};

// ─── UNSAVE Video ─────────────────────────────────────────────
exports.unsaveVideo = async (req, res, next) => {
  const userId = req.user.id;
  const { media_id, video_id } = req.body;
  try {
    if (media_id) {
      await db.promise().query('DELETE FROM saved_videos WHERE user_id = ? AND media_id = ?', [userId, media_id]);
    } else if (video_id) {
      await db.promise().query('DELETE FROM saved_videos WHERE user_id = ? AND video_id = ?', [userId, video_id]);
    }
    return res.json({ success: true, message: 'Removed from saved' });
  } catch (err) { logger.error('unsaveVideo error:', err.message); next(err); }
};

// ─── GET Saved Videos for user ────────────────────────────────
exports.getSavedVideos = async (req, res, next) => {
  const userId = req.user.id;
  logger.info(`UPLOADS | getSavedVideos | user:${userId}`);
  try {
    const [rows] = await db.promise().query(
      `SELECT sv.*, m.type, m.status AS media_status,
              up.youtube_link, up.telegram_msg_id,
              mm.event_name, mm.speaker_name, mm.sermon_topic
       FROM saved_videos sv
       LEFT JOIN media m ON sv.media_id = m.id
       LEFT JOIN uploads up ON m.id = up.media_id AND up.platform = 'youtube'
       LEFT JOIN media_metadata mm ON m.id = mm.media_id
       WHERE sv.user_id = ?
       ORDER BY sv.saved_at DESC`,
      [userId]
    );
    return res.json({ success: true, data: rows });
  } catch (err) { logger.error('getSavedVideos error:', err.message); next(err); }
};
