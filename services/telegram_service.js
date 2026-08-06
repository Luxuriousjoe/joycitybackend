// ═══════════════════════════════════════════════════════════════
//  JOY CITY INTERNATIONAL — Telegram Service
//  Sends photos, videos, audio to the Telegram channel
//  Stores message IDs in DB for later retrieval
// ═══════════════════════════════════════════════════════════════
const axios    = require('axios');
const fs       = require('fs');
const FormData = require('form-data');
const config   = require('../config/app_config');
const logger   = require('../utils/logger');

const BASE_URL = () => `https://api.telegram.org/bot${config.telegram.botToken}`;

// ─── Build caption text ───────────────────────────────────────
const buildCaption = (media) => {
  const lines = [];
  if (media.event_name)   lines.push(`📢 *${media.event_name}*`);
  if (media.speaker_name) lines.push(`🎤 Speaker: ${media.speaker_name}`);
  if (media.sermon_topic) lines.push(`📖 Topic: ${media.sermon_topic}`);
  if (media.service_date) lines.push(`📅 Date: ${media.service_date}`);
  if (media.location)     lines.push(`📍 ${media.location}`);
  if (media.description)  lines.push(`\n${media.description.substring(0, 400)}`);
  lines.push('\n🙏 *JOY CITY INTERNATIONAL*');
  lines.push('_Bringing many sons unto glory_');
  return lines.join('\n');
};

// ─── Send Media to Telegram Channel ──────────────────────────
exports.sendMedia = async (media) => {
  const channelId = config.telegram.channelId;

  if (!channelId || !config.telegram.botToken) {
    throw new Error('Telegram bot token or channel ID not configured');
  }

  logger.info(`TG | Sending ${media.type} to channel: ${channelId}`);

  const caption = buildCaption(media);

  // If no local file, fall back to sending a text message with any link we have
  if (!media.file_path || !fs.existsSync(media.file_path)) {
    logger.warn(`TG | File not found at "${media.file_path}" — sending text message`);
    if (media.youtube_link) {
      return await exports.sendTextMessage(media, media.youtube_link);
    }
    throw new Error(`File not found at path: ${media.file_path}`);
  }

  // Map media type to Telegram endpoint and field name
  const typeMap = {
    video: { endpoint: 'sendVideo', field: 'video' },
    audio: { endpoint: 'sendAudio', field: 'audio' },
    photo: { endpoint: 'sendPhoto', field: 'photo' },
  };

  const { endpoint, field } = typeMap[media.type] || typeMap.photo;

  const formData = new FormData();
  formData.append('chat_id',    channelId);
  formData.append('caption',    caption);
  formData.append('parse_mode', 'Markdown');
  formData.append(field, fs.createReadStream(media.file_path));

  // For videos include thumbnail if available
  if (media.type === 'video' && media.thumbnail_url) {
    formData.append('supports_streaming', 'true');
  }

  const response = await axios.post(
    `${BASE_URL()}/${endpoint}`,
    formData,
    {
      headers:            formData.getHeaders(),
      maxContentLength:   Infinity,
      maxBodyLength:      Infinity,
      timeout:            5 * 60 * 1000, // 5 min for large files
    }
  );

  if (!response.data.ok) {
    throw new Error(`Telegram API error: ${response.data.description}`);
  }

  const messageId = String(response.data.result.message_id);
  logger.info(`TG | Sent ${media.type} — message_id: ${messageId}`);
  return { messageId };
};

// ─── Send text message (fallback or for audio after YT link) ─
exports.sendTextMessage = async (media, youtubeLink) => {
  const channelId = config.telegram.channelId;
  const caption   = buildCaption(media);
  const text      = youtubeLink
    ? `${caption}\n\n▶️ [Watch on YouTube](${youtubeLink})`
    : caption;

  const response = await axios.post(`${BASE_URL()}/sendMessage`, {
    chat_id:               channelId,
    text,
    parse_mode:            'Markdown',
    disable_web_page_preview: false,
  });

  if (!response.data.ok) {
    throw new Error(`Telegram API error: ${response.data.description}`);
  }

  const messageId = String(response.data.result.message_id);
  logger.info(`TG | Sent text message — message_id: ${messageId}`);
  return { messageId };
};

// ─── Test bot connection ──────────────────────────────────────
exports.testConnection = async () => {
  const response = await axios.get(`${BASE_URL()}/getMe`);
  if (!response.data.ok) throw new Error('Bot token is invalid');
  logger.info(`TG | Bot connected: @${response.data.result.username}`);
  return response.data.result;
};
