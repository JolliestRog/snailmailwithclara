ALTER TABLE users ADD COLUMN newsletter_opt_in INTEGER NOT NULL DEFAULT 0
  CHECK (newsletter_opt_in IN (0, 1));

CREATE TABLE member_messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('welcome', 'system')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX member_messages_user_idx ON member_messages(user_id, created_at);

CREATE TABLE announcements (
  id TEXT PRIMARY KEY,
  author_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('newsletter', 'update', 'warning')),
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE announcement_recipients (
  announcement_id TEXT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at TEXT,
  email_status TEXT NOT NULL DEFAULT 'none'
    CHECK (email_status IN ('none', 'pending', 'sent', 'failed')),
  email_attempts INTEGER NOT NULL DEFAULT 0,
  email_error TEXT,
  resend_id TEXT,
  PRIMARY KEY (announcement_id, user_id)
);
CREATE INDEX announcement_recipients_user_idx
  ON announcement_recipients(user_id, announcement_id);
CREATE INDEX announcement_email_status_idx
  ON announcement_recipients(email_status, email_attempts);

CREATE TABLE feedback_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('bug', 'feature')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  steps TEXT NOT NULL DEFAULT '',
  expected TEXT NOT NULL DEFAULT '',
  actual TEXT NOT NULL DEFAULT '',
  page_url TEXT NOT NULL DEFAULT '',
  build_sha TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'triaged', 'planned', 'closed')),
  n8n_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (n8n_status IN ('pending', 'delivered', 'failed')),
  n8n_attempts INTEGER NOT NULL DEFAULT 0,
  n8n_last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX feedback_status_idx ON feedback_items(status, created_at);
CREATE INDEX feedback_n8n_idx ON feedback_items(n8n_status, n8n_attempts);
