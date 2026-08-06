require('dotenv').config();

const driveService = require('../services/google_drive_service');

async function verify() {
  const result = await driveService.verifyConfiguration();
  console.log('Google Drive connection verified.');
  console.log(`Auth mode: ${result.authMode}`);
  console.log(`Configured folders checked: ${result.folderCount}`);
  console.log(`Public app links: ${result.publicFiles}`);
}

verify().catch((error) => {
  console.error(`Google Drive verification failed: ${error.message}`);
  process.exitCode = 1;
});
