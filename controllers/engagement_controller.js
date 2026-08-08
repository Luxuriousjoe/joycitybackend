const db = require('../config/db_config');
const logger = require('../utils/logger');

const progressSelect = `
  SELECT lp.*, COALESCE(m.title, lp.title, mm.event_name, 'Joy City Sermon') AS display_title,
    COALESCE(m.thumbnail_url, lp.thumbnail_url) AS display_thumbnail,
    COALESCE(m.file_path, lp.source_url, up.youtube_link) AS playback_url,
    mm.speaker_name, mm.sermon_topic, mm.series_name, mm.scripture_reference
  FROM listening_progress lp
  LEFT JOIN media m ON m.id = lp.media_id
  LEFT JOIN media_metadata mm ON mm.media_id = m.id
  LEFT JOIN uploads up ON up.media_id = m.id AND up.platform = 'youtube' AND up.upload_status = 'success'
`;

exports.getContinueListening = async (req, res, next) => {
  try {
    const [rows] = await db.promise().query(
      `${progressSelect}
       WHERE lp.user_id = ? AND lp.completed = 0 AND lp.position_seconds >= 5
       ORDER BY lp.last_played_at DESC LIMIT 10`,
      [req.user.id],
    );
    return res.json({ success: true, data: rows });
  } catch (error) {
    logger.error('getContinueListening error:', error.message);
    next(error);
  }
};

exports.saveProgress = async (req, res, next) => {
  const {
    media_id, video_id, title, thumbnail_url, source_url, media_type,
    position_seconds = 0, duration_seconds = 0,
  } = req.body;
  try {
    if (!media_id && !video_id) {
      return res.status(400).json({ success: false, message: 'media_id or video_id is required' });
    }
    const position = Math.max(0, Number.parseInt(position_seconds, 10) || 0);
    const duration = Math.max(0, Number.parseInt(duration_seconds, 10) || 0);
    const completed = duration > 0 && (position / duration >= 0.95) ? 1 : 0;
    const conflictTarget = media_id
      ? '(user_id, media_id) WHERE media_id IS NOT NULL'
      : '(user_id, video_id) WHERE video_id IS NOT NULL';
    const [result] = await db.promise().query(
      `INSERT INTO listening_progress
        (user_id, media_id, video_id, title, thumbnail_url, source_url, media_type,
         position_seconds, duration_seconds, completed, last_played_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
       ON CONFLICT ${conflictTarget} DO UPDATE SET
         title=EXCLUDED.title, thumbnail_url=EXCLUDED.thumbnail_url,
         source_url=EXCLUDED.source_url, media_type=EXCLUDED.media_type,
         position_seconds=EXCLUDED.position_seconds,
         duration_seconds=EXCLUDED.duration_seconds, completed=EXCLUDED.completed,
         last_played_at=NOW()
       RETURNING id`,
      [req.user.id, media_id || null, video_id || null, title || null,
       thumbnail_url || null, source_url || null,
       media_type === 'video' ? 'video' : 'audio', position, duration, completed],
    );
    const [rows] = await db.promise().query(`${progressSelect} WHERE lp.id = ?`, [result.rows?.[0]?.id || result.insertId]);
    return res.json({ success: true, data: rows[0] });
  } catch (error) {
    logger.error('saveProgress error:', error.message);
    next(error);
  }
};

exports.getNotes = async (req, res, next) => {
  try {
    const conditions = ['n.user_id = ?'];
    const params = [req.user.id];
    if (req.query.media_id) { conditions.push('n.media_id = ?'); params.push(req.query.media_id); }
    if (req.query.video_id) { conditions.push('n.video_id = ?'); params.push(req.query.video_id); }
    const [rows] = await db.promise().query(
      `SELECT n.*, COALESCE(m.title, n.sermon_title, mm.event_name, 'Personal note') AS display_title,
        m.thumbnail_url, mm.speaker_name, mm.sermon_topic
       FROM sermon_notes n
       LEFT JOIN media m ON m.id = n.media_id
       LEFT JOIN media_metadata mm ON mm.media_id = m.id
       WHERE ${conditions.join(' AND ')} ORDER BY n.updated_at DESC`,
      params,
    );
    return res.json({ success: true, data: rows });
  } catch (error) {
    logger.error('getNotes error:', error.message);
    next(error);
  }
};

exports.createNote = async (req, res, next) => {
  const { media_id, video_id, sermon_title, note_title, content, position_seconds } = req.body;
  try {
    if (!content?.trim()) {
      return res.status(400).json({ success: false, message: 'Note content is required' });
    }
    const [result] = await db.promise().query(
      `INSERT INTO sermon_notes
        (user_id, media_id, video_id, sermon_title, note_title, content, position_seconds)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, media_id || null, video_id || null, sermon_title?.trim() || 'Personal note',
       note_title?.trim() || 'My note', content.trim(), position_seconds ?? null],
    );
    const [rows] = await db.promise().query('SELECT * FROM sermon_notes WHERE id = ?', [result.insertId]);
    return res.status(201).json({ success: true, data: rows[0] });
  } catch (error) {
    logger.error('createNote error:', error.message);
    next(error);
  }
};

exports.updateNote = async (req, res, next) => {
  try {
    const { note_title, content, position_seconds } = req.body;
    if (!content?.trim()) return res.status(400).json({ success: false, message: 'Note content is required' });
    const [result] = await db.promise().query(
      `UPDATE sermon_notes SET note_title=?, content=?, position_seconds=?
       WHERE id=? AND user_id=?`,
      [note_title?.trim() || 'Sermon note', content.trim(), position_seconds ?? null,
       req.params.id, req.user.id],
    );
    if (!result.affectedRows) return res.status(404).json({ success: false, message: 'Note not found' });
    const [rows] = await db.promise().query('SELECT * FROM sermon_notes WHERE id = ?', [req.params.id]);
    return res.json({ success: true, data: rows[0] });
  } catch (error) {
    logger.error('updateNote error:', error.message);
    next(error);
  }
};

exports.deleteNote = async (req, res, next) => {
  try {
    const [result] = await db.promise().query(
      'DELETE FROM sermon_notes WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id],
    );
    if (!result.affectedRows) return res.status(404).json({ success: false, message: 'Note not found' });
    return res.json({ success: true, message: 'Note deleted' });
  } catch (error) {
    logger.error('deleteNote error:', error.message);
    next(error);
  }
};
