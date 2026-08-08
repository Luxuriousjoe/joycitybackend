const express = require('express');
const controller = require('../controllers/testimony_controller');
const { authMiddleware, adminMiddleware } = require('../middleware/auth_middleware');
const { mediaUpload } = require('../middleware/media_upload_middleware');

const router = express.Router();
router.get('/published', authMiddleware, controller.getPublishedTestimonies);
router.get('/mine', authMiddleware, controller.getMyTestimonies);
router.get('/drive/:fileId', authMiddleware, controller.streamTestimonyFile);
router.get('/admin', adminMiddleware, controller.getAllForAdmin);
router.patch('/admin/:id', adminMiddleware, controller.reviewTestimony);
router.delete('/admin/:id', adminMiddleware, controller.deleteTestimonyForAdmin);
router.post('/', authMiddleware, mediaUpload.single('file'), controller.createTestimony);
router.delete('/:id', authMiddleware, controller.deleteMyTestimony);

module.exports = router;
