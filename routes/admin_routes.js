const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin_controller');
const reflectionController = require('../controllers/reflection_controller');
const { adminMiddleware } = require('../middleware/auth_middleware');

router.get('/users', adminMiddleware, adminController.getAllUsers);
router.post('/users', adminMiddleware, adminController.createUser);
router.post('/admins', adminMiddleware, adminController.createAdmin);
router.patch('/users/:id/toggle', adminMiddleware, adminController.toggleUser);
router.get('/logs', adminMiddleware, adminController.getLogs);
router.get('/stats', adminMiddleware, adminController.getDashboardStats);
router.get(
  '/reflections/latest',
  adminMiddleware,
  reflectionController.getLatestReflectionForAdmin,
);
router.get(
  '/reflections',
  adminMiddleware,
  reflectionController.getAllReflectionsForAdmin,
);
router.put(
  '/reflections',
  adminMiddleware,
  reflectionController.upsertReflection,
);
router.put(
  '/reflections/:id',
  adminMiddleware,
  reflectionController.updateReflection,
);
router.delete(
  '/reflections/:id',
  adminMiddleware,
  reflectionController.deleteReflection,
);

module.exports = router;
