const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');
const { pipeline } = require('stream/promises');
const { google } = require('googleapis');

const config = require('../config/app_config');
const logger = require('../utils/logger');

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';

function parseServiceAccountJson(rawValue) {
  if (!rawValue) return null;

  let parsed = JSON.parse(rawValue.trim());
  if (typeof parsed === 'string') parsed = JSON.parse(parsed);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON must contain a JSON object');
  }
  if (parsed.private_key) {
    parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
  }
  return parsed;
}

function hasOAuthCredentials() {
  const drive = config.googleDrive;
  return Boolean(drive.clientId && drive.clientSecret && drive.refreshToken);
}

function hasServiceAccountCredentials() {
  return Boolean(config.googleDrive.serviceAccountJson);
}

function getAuthMode() {
  const requested = config.googleDrive.authMode;
  if (requested && !['oauth', 'service_account'].includes(requested)) {
    throw new Error(
      'GOOGLE_DRIVE_AUTH_MODE must be either "oauth" or "service_account"',
    );
  }
  if (requested) return requested;

  // User OAuth is preferred for normal My Drive folders. Service accounts do
  // not own storage and should normally target a Google Workspace Shared Drive.
  if (hasOAuthCredentials()) return 'oauth';
  if (hasServiceAccountCredentials()) return 'service_account';
  return null;
}

function getConfigurationStatus() {
  let authMode = null;
  let configurationError = null;
  try {
    authMode = getAuthMode();
  } catch (error) {
    configurationError = error.message;
  }

  const hasFolder = Boolean(
    config.googleDrive.mediaFolderId ||
    config.googleDrive.rootFolderId ||
    config.googleDrive.photoFolderId ||
    config.googleDrive.videoFolderId ||
    config.googleDrive.audioFolderId,
  );
  const credentialsReady =
    authMode === 'oauth'
      ? hasOAuthCredentials()
      : authMode === 'service_account'
        ? hasServiceAccountCredentials()
        : false;

  return {
    enabled: config.googleDrive.enabled,
    configured:
      config.googleDrive.enabled &&
      credentialsReady &&
      hasFolder &&
      !configurationError,
    authMode,
    publicFiles: config.googleDrive.publicFiles,
    configurationError,
  };
}

function assertConfigured() {
  const status = getConfigurationStatus();
  if (!status.enabled) {
    const error = new Error('Google Drive storage is disabled');
    error.status = 503;
    throw error;
  }
  if (!status.configured) {
    const details = status.configurationError ||
      'configure Drive credentials and GOOGLE_DRIVE_MEDIA_FOLDER_ID or GOOGLE_DRIVE_FOLDER_ID';
    const error = new Error(`Google Drive storage is not configured: ${details}`);
    error.status = 503;
    throw error;
  }
  return status;
}

function createAuthClient() {
  const { authMode } = assertConfigured();
  const drive = config.googleDrive;

  if (authMode === 'oauth') {
    const oauthClient = new google.auth.OAuth2(
      drive.clientId,
      drive.clientSecret,
      drive.redirectUri,
    );
    oauthClient.setCredentials({ refresh_token: drive.refreshToken });
    return oauthClient;
  }

  let credentials;
  try {
    credentials = parseServiceAccountJson(drive.serviceAccountJson);
  } catch (error) {
    const configError = new Error(
      `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON is invalid: ${error.message}`,
    );
    configError.status = 503;
    throw configError;
  }

  return new google.auth.GoogleAuth({ credentials, scopes: [DRIVE_SCOPE] });
}

function getDriveClient() {
  return google.drive({ version: 'v3', auth: createAuthClient() });
}

function resolveFolderId(mediaType) {
  const drive = config.googleDrive;
  const typedFolders = {
    photo: drive.photoFolderId,
    video: drive.videoFolderId,
    audio: drive.audioFolderId,
    thumbnail: drive.thumbnailFolderId,
  };
  return typedFolders[mediaType] || drive.mediaFolderId || drive.rootFolderId;
}

function sanitizeFileName(fileName) {
  const extension = path.extname(fileName || '').slice(0, 12);
  const baseName = path.basename(fileName || 'media', extension)
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._ -]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 120) || 'media';
  return `${Date.now()}-${baseName}${extension.toLowerCase()}`;
}

function buildDriveUrls(fileId, apiBaseUrl) {
  const encodedId = encodeURIComponent(fileId);
  return {
    webViewLink: `https://drive.google.com/file/d/${encodedId}/view`,
    publicContentUrl: `https://drive.google.com/uc?export=download&id=${encodedId}`,
    apiContentUrl: apiBaseUrl
      ? `${apiBaseUrl.replace(/\/$/, '')}/media/drive/${encodedId}`
      : null,
  };
}

async function uploadFile({ localPath, originalName, mimeType, mediaType }) {
  assertConfigured();
  const folderId = resolveFolderId(mediaType);
  if (!folderId) {
    const error = new Error(`No Google Drive folder is configured for ${mediaType}`);
    error.status = 503;
    throw error;
  }

  const drive = getDriveClient();
  const name = sanitizeFileName(originalName);
  let fileId;
  let publiclyReadable = false;

  try {
    const response = await drive.files.create({
      requestBody: { name, parents: [folderId] },
      media: {
        mimeType: mimeType || 'application/octet-stream',
        body: fs.createReadStream(localPath),
      },
      fields: 'id,name,mimeType,size,webViewLink,webContentLink,thumbnailLink',
      supportsAllDrives: true,
    });

    fileId = response.data.id;
    if (!fileId) throw new Error('Google Drive did not return a file ID');

    if (config.googleDrive.publicFiles) {
      try {
        await drive.permissions.create({
          fileId,
          requestBody: { type: 'anyone', role: 'reader' },
          supportsAllDrives: true,
        });
        publiclyReadable = true;
      } catch (permissionError) {
        // Some Workspace policies prohibit public links. Storage should still
        // succeed; the API will stream the private file to the mobile app.
        logger.warn(
          `DRIVE | Public link unavailable for file id:${fileId}; using API proxy`,
        );
      }
    }

    const urls = buildDriveUrls(fileId);
    logger.info(`DRIVE | Uploaded ${mediaType} file id:${fileId}`);
    return {
      id: fileId,
      name: response.data.name || name,
      mimeType: response.data.mimeType || mimeType,
      size: response.data.size ? Number(response.data.size) : null,
      webViewLink: response.data.webViewLink || urls.webViewLink,
      contentUrl: publiclyReadable
        ? (response.data.webContentLink || urls.publicContentUrl)
        : null,
      thumbnailLink: response.data.thumbnailLink || null,
    };
  } catch (error) {
    if (fileId) {
      await drive.files.delete({ fileId, supportsAllDrives: true }).catch(() => {});
    }
    const status = error.response?.status;
    const detail = error.response?.data?.error?.message || error.message;
    const uploadError = new Error(`Google Drive upload failed: ${detail}`);
    uploadError.status = status && status < 500 ? 400 : 502;
    throw uploadError;
  }
}

async function downloadToTemp(fileId, extension = '') {
  assertConfigured();
  const safeExtension = /^\.[a-zA-Z0-9]{1,10}$/.test(extension) ? extension : '';
  const localPath = path.join(os.tmpdir(), `joy-city-drive-${randomUUID()}${safeExtension}`);
  try {
    const response = await getDriveClient().files.get(
      { fileId, alt: 'media', supportsAllDrives: true },
      { responseType: 'stream' },
    );
    await pipeline(response.data, fs.createWriteStream(localPath));
    return localPath;
  } catch (error) {
    await fs.promises.unlink(localPath).catch(() => {});
    throw error;
  }
}

async function getFileStream(fileId, range) {
  assertConfigured();
  return getDriveClient().files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    {
      responseType: 'stream',
      headers: range ? { Range: range } : undefined,
    },
  );
}

async function deleteFile(fileId) {
  if (!fileId) return;
  try {
    await getDriveClient().files.delete({ fileId, supportsAllDrives: true });
    logger.info(`DRIVE | Deleted file id:${fileId}`);
  } catch (error) {
    if (error.response?.status === 404) return;
    throw error;
  }
}

async function verifyConfiguration() {
  const status = assertConfigured();
  const drive = getDriveClient();
  const folderTypes = ['media', 'photo', 'video', 'audio', 'thumbnail'];
  const checked = new Map();

  for (const type of folderTypes) {
    const folderId = resolveFolderId(type);
    if (!folderId || checked.has(folderId)) continue;
    const response = await drive.files.get({
      fileId: folderId,
      fields: 'id,name,mimeType',
      supportsAllDrives: true,
    });
    if (response.data.mimeType !== FOLDER_MIME_TYPE) {
      throw new Error(`Configured Drive ID for ${type} is not a folder`);
    }
    checked.set(folderId, response.data.name);
  }

  return { ...status, folderCount: checked.size };
}

module.exports = {
  buildDriveUrls,
  deleteFile,
  downloadToTemp,
  getFileStream,
  getConfigurationStatus,
  parseServiceAccountJson,
  resolveFolderId,
  sanitizeFileName,
  uploadFile,
  verifyConfiguration,
};
