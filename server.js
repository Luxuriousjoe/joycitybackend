require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');

const db = require('./config/db_config');
const logger = require('./utils/logger');
const errorHandler = require('./middleware/error_handler');
const driveService = require('./services/google_drive_service');

const authRoutes = require('./routes/auth_routes');
const mediaRoutes = require('./routes/media_routes');
const uploadRoutes = require('./routes/upload_routes');
const adminRoutes = require('./routes/admin_routes');
const reflectionRoutes = require('./routes/reflection_routes');

const app = express();
const port = Number.parseInt(process.env.PORT || '5000', 10);
const configuredOrigins = (process.env.ALLOWED_ORIGINS || '*')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.set('trust proxy', 1);
app.use(helmet());
app.use(
  cors({
    origin: configuredOrigins.includes('*') ? true : configuredOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  }),
);
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    message: { success: false, message: 'Too many requests. Try again later.' },
  }),
);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on('finish', () => {
    logger.request(
      req.method,
      req.originalUrl,
      res.statusCode,
      Date.now() - startedAt,
      req.user?.email,
    );
  });
  next();
});

app.get('/health', async (_req, res) => {
  try {
    await db.pool.query('SELECT 1');
    return res.json({
      success: true,
      message: 'Joy City International API is alive',
      database: 'connected',
      storage: {
        provider: 'google_drive',
        ...driveService.getConfigurationStatus(),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Health check database error:', error.message);
    return res.status(503).json({
      success: false,
      message: 'API is running but PostgreSQL is unavailable',
      database: 'error',
      timestamp: new Date().toISOString(),
    });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/reflections', reflectionRoutes);

app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.originalUrl}`,
  });
});
app.use(errorHandler);

cron.schedule('*/2 * * * *', async () => {
  try {
    const deliveryController = require('./controllers/delivery_controller');
    await deliveryController.retryFailedDeliveries();
  } catch (error) {
    logger.error('Upload retry cron error:', error.message);
  }
});

cron.schedule('*/30 * * * *', async () => {
  try {
    const youtubeService = require('./services/youtube_service');
    await youtubeService.fetchChannelVideos();
  } catch (error) {
    logger.error('YouTube cache cron error:', error.message);
  }
});

async function start() {
  logger.startup('Joy City International API booting...');
  logger.startup(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.startup(`Port: ${port}`);
  logger.startup(`PostgreSQL configured: ${Boolean(process.env.DATABASE_URL)}`);
  const driveStatus = driveService.getConfigurationStatus();
  logger.startup(
    `Google Drive configured: ${driveStatus.configured} (${driveStatus.authMode || 'no auth mode'})`,
  );

  await db.pool.query('SELECT 1');
  const userCount = await db.pool.query('SELECT COUNT(*) AS count FROM users');
  logger.startup(`PostgreSQL connected; ${userCount.rows[0].count} user(s)`);

  app.listen(port, '0.0.0.0', () => {
    logger.startup(`Joy City API listening on port ${port}`);
    logger.startup('Health endpoint: /health');
  });

  setTimeout(async () => {
    try {
      const youtubeService = require('./services/youtube_service');
      await youtubeService.fetchChannelVideos();
      logger.startup('YouTube channel cache warmed up');
    } catch (error) {
      logger.warn(`YouTube cache warmup skipped: ${error.message}`);
    }
  }, 5000);
}

if (require.main === module) {
  start().catch((error) => {
    logger.error('API startup failed:', error.message);
    process.exit(1);
  });
}

module.exports = app;
