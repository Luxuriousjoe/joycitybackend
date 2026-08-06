const fs = require('fs');
const path = require('path');

const db = require('../config/db_config');
const driveService = require('../services/google_drive_service');
const telegramService = require('../services/telegram_service');
const youtubeService = require('../services/youtube_service');
const logger = require('../utils/logger');

async function setFailure(mediaId, platform, message, incrementRetry = true) {
  await db.promise().query(
    `UPDATE uploads
     SET upload_status = 'failed', error_message = ?,
         retry_count = retry_count + ?
     WHERE media_id = ? AND platform = ?`,
    [message, incrementRetry ? 1 : 0, mediaId, platform],
  );
}

async function getMedia(mediaId) {
  const [rows] = await db.promise().query(
    `SELECT m.*, mm.event_name, mm.description, mm.speaker_name,
            mm.sermon_topic, mm.service_date, mm.location
     FROM media m
     LEFT JOIN media_metadata mm ON m.id = mm.media_id
     WHERE m.id = ?`,
    [mediaId],
  );
  return rows[0] || null;
}

async function deliver(media, targets) {
  let localPath = null;
  let youtubeLink = null;

  try {
    localPath = await driveService.downloadToTemp(
      media.drive_file_id,
      path.extname(media.file_name || ''),
    );
    const localMedia = { ...media, file_path: localPath };

    if (targets.some((target) => target.platform === 'youtube')) {
      try {
        const result = await youtubeService.uploadMedia(localMedia);
        youtubeLink = result.link;
        await db.promise().query(
          `UPDATE uploads
           SET upload_status = 'success', youtube_link = ?, youtube_video_id = ?,
               error_message = NULL, upload_date = NOW()
           WHERE media_id = ? AND platform = 'youtube'`,
          [result.link, result.videoId, media.id],
        );
        await db.promise().query(
          'UPDATE media SET thumbnail_url = ? WHERE id = ?',
          [`https://img.youtube.com/vi/${result.videoId}/hqdefault.jpg`, media.id],
        );
      } catch (error) {
        logger.error(`YT_FAIL | media:${media.id} | ${error.message}`);
        await setFailure(media.id, 'youtube', error.message);
      }
    }

    if (targets.some((target) => target.platform === 'telegram')) {
      try {
        const result = await telegramService.sendMedia({
          ...localMedia,
          youtube_link: youtubeLink,
        });
        await db.promise().query(
          `UPDATE uploads
           SET upload_status = 'success', telegram_msg_id = ?,
               error_message = NULL, upload_date = NOW()
           WHERE media_id = ? AND platform = 'telegram'`,
          [result.messageId, media.id],
        );
      } catch (error) {
        logger.error(`TG_FAIL | media:${media.id} | ${error.message}`);
        await setFailure(media.id, 'telegram', error.message);
      }
    }
  } catch (error) {
    logger.error(`DELIVERY_DOWNLOAD_FAIL | media:${media.id} | ${error.message}`);
    for (const target of targets) {
      await setFailure(media.id, target.platform, error.message).catch(() => {});
    }
  } finally {
    if (localPath) await fs.promises.unlink(localPath).catch(() => {});
    await db.promise().query(
      "UPDATE media SET status = 'uploaded' WHERE id = ?",
      [media.id],
    ).catch(() => {});
  }
}

exports.triggerDelivery = async (req, res, next) => {
  const { mediaId } = req.params;
  logger.media('DELIVERY_TRIGGER', '?', mediaId, `by ${req.user?.email}`);

  try {
    const media = await getMedia(mediaId);
    if (!media) {
      return res.status(404).json({ success: false, message: 'Media not found' });
    }
    if (!media.drive_file_id) {
      return res.status(409).json({
        success: false,
        message: 'This legacy media item is not stored in Google Drive.',
      });
    }

    const [targets] = await db.promise().query(
      `SELECT platform, upload_status FROM uploads
       WHERE media_id = ? AND platform IN ('youtube', 'telegram')
         AND upload_status <> 'success'`,
      [mediaId],
    );
    if (!targets.length) {
      return res.json({
        success: true,
        message: 'Media is stored in Google Drive; no additional destinations are pending.',
        data: { mediaId: Number(mediaId), status: 'uploaded' },
      });
    }

    await db.promise().query(
      `UPDATE uploads SET upload_status = 'in_progress', error_message = NULL
       WHERE media_id = ? AND platform IN ('youtube', 'telegram')
         AND upload_status <> 'success'`,
      [mediaId],
    );

    res.status(202).json({
      success: true,
      message: 'Optional delivery started; the original is already safe in Google Drive.',
      data: { mediaId: Number(mediaId), status: 'uploaded' },
    });

    await deliver(media, targets);
  } catch (error) {
    logger.error('triggerDelivery error:', error.message);
    if (!res.headersSent) next(error);
  }
};

exports.retryFailedDeliveries = async () => {
  try {
    const [failedMedia] = await db.promise().query(
      `SELECT DISTINCT m.id
       FROM media m
       JOIN uploads u ON u.media_id = m.id
       WHERE m.drive_file_id IS NOT NULL
         AND u.platform IN ('youtube', 'telegram')
         AND u.upload_status = 'failed'
         AND u.retry_count < 3`,
    );

    for (const row of failedMedia) {
      const media = await getMedia(row.id);
      if (!media) continue;
      const [targets] = await db.promise().query(
        `SELECT platform FROM uploads
         WHERE media_id = ? AND platform IN ('youtube', 'telegram')
           AND upload_status = 'failed' AND retry_count < 3`,
        [row.id],
      );
      if (!targets.length) continue;
      await db.promise().query(
        `UPDATE uploads SET upload_status = 'in_progress', error_message = NULL
         WHERE media_id = ? AND platform IN ('youtube', 'telegram')
           AND upload_status = 'failed' AND retry_count < 3`,
        [row.id],
      );
      await deliver(media, targets);
    }
  } catch (error) {
    logger.error('retryFailedDeliveries:', error.message);
  }
};
