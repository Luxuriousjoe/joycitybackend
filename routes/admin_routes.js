const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin_controller');
const { adminMiddleware } = require('../middleware/auth_middleware');

router.get('/users', adminMiddleware, adminController.getAllUsers);
router.post('/users', adminMiddleware, adminController.createUser);
router.post('/admins', adminMiddleware, adminController.createAdmin);
router.patch('/users/:id/toggle', adminMiddleware, adminController.toggleUser);
router.get('/logs', adminMiddleware, adminController.getLogs);
router.get('/stats', adminMiddleware, adminController.getDashboardStats);

module.exports = router;
