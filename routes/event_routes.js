const express = require('express');
const controller = require('../controllers/event_controller');
const { authMiddleware, adminMiddleware } = require('../middleware/auth_middleware');

const router = express.Router();
router.get('/', authMiddleware, controller.getPublishedEvents);
router.get('/admin', adminMiddleware, controller.getAllEventsForAdmin);
router.post('/admin', adminMiddleware, controller.createEvent);
router.put('/admin/:id', adminMiddleware, controller.updateEvent);
router.delete('/admin/:id', adminMiddleware, controller.deleteEvent);

module.exports = router;
