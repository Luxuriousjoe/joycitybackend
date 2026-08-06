BEGIN;

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  role VARCHAR(20) NOT NULL DEFAULT 'user'
    CHECK (role IN ('admin', 'user')),
  password_hash VARCHAR(255) NOT NULL,
  avatar_url VARCHAR(500),
  is_active SMALLINT NOT NULL DEFAULT 1
    CHECK (is_active IN (0, 1)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS media (
  id BIGSERIAL PRIMARY KEY,
  type VARCHAR(20) NOT NULL
    CHECK (type IN ('video', 'photo', 'audio')),
  file_path VARCHAR(500),
  title VARCHAR(200),
  thumbnail_url VARCHAR(500),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'uploading', 'uploaded', 'failed')),
  uploaded_by BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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
    CHECK (platform IN ('telegram', 'youtube')),
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

CREATE UNIQUE INDEX IF NOT EXISTS saved_videos_user_media_unique
  ON saved_videos (user_id, media_id)
  WHERE media_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS saved_videos_user_video_unique
  ON saved_videos (user_id, video_id)
  WHERE video_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS media_created_at_idx ON media (created_at DESC);
CREATE INDEX IF NOT EXISTS media_type_status_idx ON media (type, status);
CREATE INDEX IF NOT EXISTS uploads_media_id_idx ON uploads (media_id);
CREATE INDEX IF NOT EXISTS logs_timestamp_idx ON logs (timestamp DESC);
CREATE INDEX IF NOT EXISTS refresh_tokens_user_id_idx ON refresh_tokens (user_id);

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

COMMIT;
