const isProduction = process.env.NODE_ENV === 'production';

function enabled(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function secret(name, developmentFallback) {
  const value = process.env[name];
  if (value) return value;
  if (isProduction) {
    throw new Error(`${name} must be configured in production.`);
  }
  return developmentFallback;
}

module.exports = {
  youtube: {
    clientId: process.env.YOUTUBE_CLIENT_ID,
    clientSecret: process.env.YOUTUBE_CLIENT_SECRET,
    redirectUri: process.env.YOUTUBE_REDIRECT_URI,
    refreshToken: process.env.YOUTUBE_REFRESH_TOKEN,
    channelId: process.env.YOUTUBE_CHANNEL_ID,
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    channelId: process.env.TELEGRAM_CHANNEL_ID,
  },
  jwt: {
    secret: secret('JWT_SECRET', 'joy_city_development_secret'),
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    refreshSecret: secret(
      'JWT_REFRESH_SECRET',
      'joy_city_development_refresh_secret',
    ),
    refreshExpires: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  },
  upload: {
    maxFileSizeMB: Number.parseInt(process.env.MAX_FILE_SIZE_MB || '500', 10),
  },
  googleDrive: {
    enabled: enabled('GOOGLE_DRIVE_ENABLED'),
    authMode: process.env.GOOGLE_DRIVE_AUTH_MODE?.trim().toLowerCase(),
    clientId: process.env.GOOGLE_DRIVE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_DRIVE_CLIENT_SECRET,
    refreshToken: process.env.GOOGLE_DRIVE_REFRESH_TOKEN,
    redirectUri:
      process.env.GOOGLE_DRIVE_REDIRECT_URI ||
      'https://developers.google.com/oauthplayground',
    serviceAccountJson: process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON,
    rootFolderId: process.env.GOOGLE_DRIVE_FOLDER_ID,
    mediaFolderId: process.env.GOOGLE_DRIVE_MEDIA_FOLDER_ID,
    photoFolderId: process.env.GOOGLE_DRIVE_PHOTO_FOLDER_ID,
    videoFolderId: process.env.GOOGLE_DRIVE_VIDEO_FOLDER_ID,
    audioFolderId: process.env.GOOGLE_DRIVE_AUDIO_FOLDER_ID,
    thumbnailFolderId: process.env.GOOGLE_DRIVE_THUMBNAIL_FOLDER_ID,
    publicFiles: enabled('GOOGLE_DRIVE_PUBLIC_FILES', true),
  },
};
