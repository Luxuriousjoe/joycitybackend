const express = require('express');
const reflectionController = require('../controllers/reflection_controller');
const { authMiddleware } = require('../middleware/auth_middleware');

const router = express.Router();

router.get('/current', authMiddleware, reflectionController.getCurrentReflection);

module.exports = router;
