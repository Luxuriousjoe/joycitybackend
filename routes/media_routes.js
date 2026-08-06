const express = require('express');
const router = express.Router();
const mediaController = require('../controllers/media_controller');
const { authMiddleware, adminMiddleware } = require('../middleware/auth_middleware');

// Public routes (authenticated users)
router.get('/', authMiddleware, mediaController.getAllMedia);

// Admin-only routes
router.get('/admin/queue', adminMiddleware, mediaController.getAdminQueue);
router.post('/', adminMiddleware, mediaController.createMedia);
router.put('/:id', adminMiddleware, mediaController.updateMedia);
router.delete('/:id', adminMiddleware, mediaController.deleteMedia);
router.patch('/:id/thumbnail', adminMiddleware, mediaController.updateThumbnail);

// Keep the dynamic ID route last so it cannot shadow /admin/queue.
router.get('/:id', authMiddleware, mediaController.getMediaById);

module.exports = router;
