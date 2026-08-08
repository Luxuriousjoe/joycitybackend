const express = require('express');
const controller = require('../controllers/engagement_controller');
const { authMiddleware } = require('../middleware/auth_middleware');

const router = express.Router();
router.use(authMiddleware);
router.get('/progress/continue', controller.getContinueListening);
router.put('/progress', controller.saveProgress);
router.get('/notes', controller.getNotes);
router.post('/notes', controller.createNote);
router.put('/notes/:id', controller.updateNote);
router.delete('/notes/:id', controller.deleteNote);

module.exports = router;
