BEGIN;

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  role VARCHAR(20) NOT NULL DEFAULT 'user'
    CHECK (role IN ('admin', 'user')),
  department VARCHAR(100) NOT NULL DEFAULT 'None',
  password_hash VARCHAR(255) NOT NULL,
  avatar_url VARCHAR(500),
  is_active SMALLINT NOT NULL DEFAULT 1
    CHECK (is_active IN (0, 1)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS department VARCHAR(100) NOT NULL DEFAULT 'None';

CREATE TABLE IF NOT EXISTS media (
  id BIGSERIAL PRIMARY KEY,
  type VARCHAR(20) NOT NULL
    CHECK (type IN ('video', 'photo', 'audio')),
  file_path VARCHAR(500),
  title VARCHAR(200),
  thumbnail_url VARCHAR(500),
  drive_file_id VARCHAR(255),
  drive_web_view_link VARCHAR(1000),
  mime_type VARCHAR(150),
  file_name VARCHAR(255),
  file_size BIGINT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'uploading', 'uploaded', 'failed')),
  uploaded_by BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE media
  ADD COLUMN IF NOT EXISTS drive_file_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS drive_web_view_link VARCHAR(1000),
  ADD COLUMN IF NOT EXISTS mime_type VARCHAR(150),
  ADD COLUMN IF NOT EXISTS file_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS file_size BIGINT;

ALTER TABLE media ALTER COLUMN file_path TYPE VARCHAR(1000);
ALTER TABLE media ALTER COLUMN thumbnail_url TYPE VARCHAR(1000);

CREATE TABLE IF NOT EXISTS media_metadata (
  id BIGSERIAL PRIMARY KEY,
  media_id BIGINT NOT NULL UNIQUE REFERENCES media(id) ON DELETE CASCADE,
  event_name VARCHAR(200),
  location VARCHAR(200),
  description TEXT,
  participants TEXT,
  sermon_topic VARCHAR(200),
  speaker_name VARCHAR(150),
  service_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE media_metadata
  ADD COLUMN IF NOT EXISTS series_name VARCHAR(200),
  ADD COLUMN IF NOT EXISTS scripture_reference VARCHAR(200);

CREATE TABLE IF NOT EXISTS uploads (
  id BIGSERIAL PRIMARY KEY,
  media_id BIGINT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  platform VARCHAR(20) NOT NULL
    CHECK (platform IN ('google_drive', 'telegram', 'youtube')),
  upload_status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (upload_status IN ('pending', 'in_progress', 'success', 'failed')),
  telegram_msg_id VARCHAR(100),
  youtube_link VARCHAR(500),
  youtube_video_id VARCHAR(100),
  retry_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  upload_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (media_id, platform)
);

ALTER TABLE uploads DROP CONSTRAINT IF EXISTS uploads_platform_check;
ALTER TABLE uploads
  ADD CONSTRAINT uploads_platform_check
  CHECK (platform IN ('google_drive', 'telegram', 'youtube'));

CREATE TABLE IF NOT EXISTS logs (
  id BIGSERIAL PRIMARY KEY,
  action VARCHAR(200) NOT NULL,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  details TEXT,
  ip_addr VARCHAR(64)
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token VARCHAR(512) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS youtube_channel_videos (
  id BIGSERIAL PRIMARY KEY,
  video_id VARCHAR(50) NOT NULL UNIQUE,
  title VARCHAR(300) NOT NULL,
  description TEXT,
  thumbnail_url VARCHAR(500),
  published_at TIMESTAMPTZ,
  duration VARCHAR(20),
  view_count BIGINT NOT NULL DEFAULT 0,
  youtube_url VARCHAR(500) NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS saved_videos (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_id BIGINT REFERENCES media(id) ON DELETE SET NULL,
  video_id VARCHAR(50),
  title VARCHAR(300),
  thumbnail_url VARCHAR(500),
  youtube_url VARCHAR(500),
  saved_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS timely_reflections (
  id BIGSERIAL PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  scripture_reference VARCHAR(150) NOT NULL,
  scripture_text TEXT,
  reflection_text TEXT NOT NULL,
  prayer TEXT,
  author_name VARCHAR(150),
  publish_date DATE NOT NULL UNIQUE,
  is_published SMALLINT NOT NULL DEFAULT 1
    CHECK (is_published IN (0, 1)),
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS church_events (
  id BIGSERIAL PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  category VARCHAR(100),
  location VARCHAR(250),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  image_url VARCHAR(1000),
  registration_url VARCHAR(1000),
  is_published SMALLINT NOT NULL DEFAULT 1
    CHECK (is_published IN (0, 1)),
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (ends_at IS NULL OR ends_at >= starts_at)
);

CREATE TABLE IF NOT EXISTS listening_progress (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_id BIGINT REFERENCES media(id) ON DELETE CASCADE,
  video_id VARCHAR(50),
  title VARCHAR(300),
  thumbnail_url VARCHAR(1000),
  source_url VARCHAR(1000),
  media_type VARCHAR(20) NOT NULL DEFAULT 'audio'
    CHECK (media_type IN ('audio', 'video')),
  position_seconds INTEGER NOT NULL DEFAULT 0 CHECK (position_seconds >= 0),
  duration_seconds INTEGER NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
  completed SMALLINT NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
  last_played_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (media_id IS NOT NULL OR video_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS sermon_notes (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_id BIGINT REFERENCES media(id) ON DELETE CASCADE,
  video_id VARCHAR(50),
  sermon_title VARCHAR(300),
  note_title VARCHAR(200) NOT NULL DEFAULT 'Sermon note',
  content TEXT NOT NULL,
  position_seconds INTEGER CHECK (position_seconds IS NULL OR position_seconds >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Notes can be attached to a sermon or kept as personal/Bible study notes.
-- Drop the automatically named legacy constraint for existing deployments.
ALTER TABLE sermon_notes DROP CONSTRAINT IF EXISTS sermon_notes_check;

CREATE TABLE IF NOT EXISTS testimonies (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  content TEXT,
  kind VARCHAR(20) NOT NULL DEFAULT 'written'
    CHECK (kind IN ('written', 'photo', 'audio', 'video')),
  media_file_id VARCHAR(255),
  media_url VARCHAR(1000),
  mime_type VARCHAR(150),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'published', 'rejected')),
  admin_feedback TEXT,
  reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  is_featured SMALLINT NOT NULL DEFAULT 0 CHECK (is_featured IN (0, 1)),
  featured_from DATE,
  featured_until DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (content IS NOT NULL OR media_file_id IS NOT NULL),
  CHECK (featured_until IS NULL OR featured_from IS NULL OR featured_until >= featured_from)
);

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  login_welcome SMALLINT NOT NULL DEFAULT 1 CHECK (login_welcome IN (0, 1)),
  timely_reflections SMALLINT NOT NULL DEFAULT 1 CHECK (timely_reflections IN (0, 1)),
  events SMALLINT NOT NULL DEFAULT 1 CHECK (events IN (0, 1)),
  sermons SMALLINT NOT NULL DEFAULT 1 CHECK (sermons IN (0, 1)),
  department_updates SMALLINT NOT NULL DEFAULT 1 CHECK (department_updates IN (0, 1)),
  testimonies SMALLINT NOT NULL DEFAULT 1 CHECK (testimonies IN (0, 1)),
  quiet_hours_enabled SMALLINT NOT NULL DEFAULT 0 CHECK (quiet_hours_enabled IN (0, 1)),
  quiet_hours_start TIME NOT NULL DEFAULT '22:00',
  quiet_hours_end TIME NOT NULL DEFAULT '07:00',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY,
  title VARCHAR(160) NOT NULL,
  body TEXT NOT NULL,
  category VARCHAR(30) NOT NULL DEFAULT 'general'
    CHECK (category IN ('general', 'reflection', 'event', 'sermon', 'department', 'testimony')),
  audience_type VARCHAR(20) NOT NULL DEFAULT 'all'
    CHECK (audience_type IN ('all', 'department', 'user')),
  audience_value VARCHAR(200),
  action_route VARCHAR(500),
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ,
  is_active SMALLINT NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (audience_type = 'all' OR audience_value IS NOT NULL),
  CHECK (expires_at IS NULL OR expires_at >= scheduled_at)
);

CREATE TABLE IF NOT EXISTS notification_reads (
  notification_id BIGINT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (notification_id, user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS saved_videos_user_media_unique
  ON saved_videos (user_id, media_id)
  WHERE media_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS saved_videos_user_video_unique
  ON saved_videos (user_id, video_id)
  WHERE video_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS media_created_at_idx ON media (created_at DESC);
CREATE INDEX IF NOT EXISTS media_type_status_idx ON media (type, status);
CREATE UNIQUE INDEX IF NOT EXISTS media_drive_file_id_unique
  ON media (drive_file_id)
  WHERE drive_file_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS uploads_media_id_idx ON uploads (media_id);
CREATE INDEX IF NOT EXISTS logs_timestamp_idx ON logs (timestamp DESC);
CREATE INDEX IF NOT EXISTS refresh_tokens_user_id_idx ON refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS timely_reflections_published_idx
  ON timely_reflections (is_published, publish_date DESC);
CREATE INDEX IF NOT EXISTS church_events_published_date_idx
  ON church_events (is_published, starts_at);
CREATE UNIQUE INDEX IF NOT EXISTS church_events_title_start_unique
  ON church_events (title, starts_at);
CREATE UNIQUE INDEX IF NOT EXISTS listening_progress_user_media_unique
  ON listening_progress (user_id, media_id) WHERE media_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS listening_progress_user_video_unique
  ON listening_progress (user_id, video_id) WHERE video_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS listening_progress_recent_idx
  ON listening_progress (user_id, last_played_at DESC);
CREATE INDEX IF NOT EXISTS sermon_notes_user_updated_idx
  ON sermon_notes (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS testimonies_status_featured_idx
  ON testimonies (status, is_featured, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_schedule_idx
  ON notifications (is_active, scheduled_at DESC);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_set_updated_at ON users;
CREATE TRIGGER users_set_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS media_set_updated_at ON media;
CREATE TRIGGER media_set_updated_at
BEFORE UPDATE ON media
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS uploads_set_updated_at ON uploads;
CREATE TRIGGER uploads_set_updated_at
BEFORE UPDATE ON uploads
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS youtube_channel_videos_set_updated_at
  ON youtube_channel_videos;
CREATE TRIGGER youtube_channel_videos_set_updated_at
BEFORE UPDATE ON youtube_channel_videos
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS timely_reflections_set_updated_at
  ON timely_reflections;
CREATE TRIGGER timely_reflections_set_updated_at
BEFORE UPDATE ON timely_reflections
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS church_events_set_updated_at ON church_events;
CREATE TRIGGER church_events_set_updated_at
BEFORE UPDATE ON church_events
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO church_events
  (title, description, category, location, starts_at, is_published)
VALUES
  ('Global Prophetic Summit',
   'A strategic prophetic congress with impartation, declarations, and divine alignments.',
   'Summit', 'Abuja, Nigeria', '2026-08-14T09:00:00+01:00', 1),
  ('Decoding the Prophetic Live',
   'Live teaching with interactive questions, answers, and prophetic activation.',
   'Teaching', 'Lagos, Nigeria', '2026-09-06T09:00:00+01:00', 1),
  ('Uncommon Expressions Conference',
   'A multi-day immersive prophetic teaching experience for believers across Europe.',
   'Conference', 'London, United Kingdom', '2026-10-21T09:00:00+01:00', 1),
  ('Year-End Prophetic Convocation',
   'A year-end gathering to receive declarations and direction for the coming season.',
   'Convocation', 'Port Harcourt, Nigeria', '2026-11-15T09:00:00+01:00', 1)
ON CONFLICT (title, starts_at) DO NOTHING;

DROP TRIGGER IF EXISTS listening_progress_set_updated_at ON listening_progress;
CREATE TRIGGER listening_progress_set_updated_at
BEFORE UPDATE ON listening_progress
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS sermon_notes_set_updated_at ON sermon_notes;
CREATE TRIGGER sermon_notes_set_updated_at
BEFORE UPDATE ON sermon_notes
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS testimonies_set_updated_at ON testimonies;
CREATE TRIGGER testimonies_set_updated_at
BEFORE UPDATE ON testimonies
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS notification_preferences_set_updated_at ON notification_preferences;
CREATE TRIGGER notification_preferences_set_updated_at
BEFORE UPDATE ON notification_preferences
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS notifications_set_updated_at ON notifications;
CREATE TRIGGER notifications_set_updated_at
BEFORE UPDATE ON notifications
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
