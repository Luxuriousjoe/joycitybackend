const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');
const multer = require('multer');

const config = require('../config/app_config');

const uploadDirectory = path.join(os.tmpdir(), 'joy-city-uploads');
fs.mkdirSync(uploadDirectory, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, uploadDirectory),
  filename: (_req, file, callback) => {
    const extension = path.extname(file.originalname || '').slice(0, 12);
    callback(null, `${randomUUID()}${extension.toLowerCase()}`);
  },
});

const allowedMimeType = /^(image|video|audio)\//;

const mediaUpload = multer({
  storage,
  limits: {
    files: 1,
    fileSize: config.upload.maxFileSizeMB * 1024 * 1024,
    fields: 20,
  },
  fileFilter: (_req, file, callback) => {
    if (!allowedMimeType.test(file.mimetype || '')) {
      const error = new Error('Only image, video, or audio files can be uploaded');
      error.status = 415;
      return callback(error);
    }
    return callback(null, true);
  },
});

async function removeTemporaryFile(filePath) {
  if (!filePath) return;
  await fs.promises.unlink(filePath).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
}

module.exports = { mediaUpload, removeTemporaryFile };
