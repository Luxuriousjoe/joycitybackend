const isProduction = process.env.NODE_ENV === 'production';

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
};
