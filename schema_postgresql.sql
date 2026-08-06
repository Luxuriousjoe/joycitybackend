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

COMMIT;
