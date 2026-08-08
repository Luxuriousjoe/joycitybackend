const express = require('express');
const controller = require('../controllers/notification_controller');
const { authMiddleware, adminMiddleware } = require('../middleware/auth_middleware');

const router = express.Router();
router.get('/preferences', authMiddleware, controller.getPreferences);
router.put('/preferences', authMiddleware, controller.updatePreferences);
router.get('/', authMiddleware, controller.getNotifications);
router.post('/read-all', authMiddleware, controller.markAllRead);
router.post('/:id/read', authMiddleware, controller.markRead);
router.get('/admin/all', adminMiddleware, controller.getAllForAdmin);
router.post('/admin', adminMiddleware, controller.createNotification);
router.delete('/admin/:id', adminMiddleware, controller.deleteNotification);

module.exports = router;
