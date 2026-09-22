PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT,
  bio TEXT,
  country_code TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'suspended', 'deleted')),
  roles_json TEXT NOT NULL DEFAULT '["member"]',
  age_attested_at TEXT NOT NULL,
  public_encryption_key TEXT NOT NULL,
  encrypted_private_key_json TEXT NOT NULL,
  recovery_wrapped_master_key_json TEXT NOT NULL,
  email TEXT,
  email_notifications INTEGER NOT NULL DEFAULT 0 CHECK (email_notifications IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_at TEXT,
  approved_by TEXT REFERENCES users(id),
  deleted_at TEXT
);

CREATE TABLE webauthn_credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key BLOB NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports_json TEXT NOT NULL DEFAULT '[]',
  device_type TEXT,
  backed_up INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TEXT
);
CREATE INDEX credentials_user_idx ON webauthn_credentials(user_id);

CREATE TABLE webauthn_challenges (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('register', 'login', 'recover')),
  challenge TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

CREATE TABLE invitations (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL REFERENCES users(id),
  roles_json TEXT NOT NULL DEFAULT '["member"]',
  expires_at TEXT NOT NULL,
  used_at TEXT,
  used_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE invitation_redemptions (
  invitation_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  redeemed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE recovery_invitations (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE recovery_redemptions (
  recovery_id TEXT PRIMARY KEY,
  credential_id TEXT NOT NULL UNIQUE,
  redeemed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE address_vaults (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  encrypted_address_json TEXT NOT NULL,
  address_schema_version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE mail_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  roulette_enabled INTEGER NOT NULL DEFAULT 0 CHECK (roulette_enabled IN (0, 1)),
  anonymous_enabled INTEGER NOT NULL DEFAULT 0 CHECK (anonymous_enabled IN (0, 1)),
  monthly_limit INTEGER NOT NULL DEFAULT 1 CHECK (monthly_limit BETWEEN 1 AND 4),
  destination_mode TEXT NOT NULL DEFAULT 'anywhere' CHECK (destination_mode IN ('domestic', 'selected', 'anywhere')),
  destination_countries_json TEXT NOT NULL DEFAULT '[]',
  paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE mail_requests (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL REFERENCES users(id),
  recipient_id TEXT NOT NULL REFERENCES users(id),
  encrypted_note_json TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'expired', 'cancelled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at TEXT,
  expires_at TEXT NOT NULL,
  CHECK (sender_id <> recipient_id)
);
CREATE INDEX requests_recipient_idx ON mail_requests(recipient_id, status);
CREATE INDEX requests_sender_idx ON mail_requests(sender_id, status);

CREATE TABLE roulette_matches (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL REFERENCES users(id),
  recipient_id TEXT NOT NULL REFERENCES users(id),
  anonymous INTEGER NOT NULL DEFAULT 1 CHECK (anonymous IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'pending_release' CHECK (status IN ('pending_release', 'released', 'completed', 'expired', 'cancelled', 'reported')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  release_expires_at TEXT NOT NULL,
  released_at TEXT,
  CHECK (sender_id <> recipient_id)
);
CREATE INDEX roulette_recipient_idx ON roulette_matches(recipient_id, status);
CREATE INDEX roulette_sender_idx ON roulette_matches(sender_id, status);
CREATE UNIQUE INDEX roulette_one_open_per_sender_idx
  ON roulette_matches(sender_id) WHERE status IN ('pending_release', 'released');

CREATE TABLE address_grants (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL REFERENCES users(id),
  recipient_id TEXT NOT NULL REFERENCES users(id),
  source_type TEXT NOT NULL CHECK (source_type IN ('targeted', 'roulette')),
  source_id TEXT NOT NULL,
  encrypted_address_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'sent', 'revoked', 'expired')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  sent_at TEXT
);
CREATE INDEX grants_sender_idx ON address_grants(sender_id, status);
CREATE INDEX grants_recipient_idx ON address_grants(recipient_id, status);

CREATE TABLE blocks (
  blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL REFERENCES users(id),
  subject_user_id TEXT REFERENCES users(id),
  match_id TEXT REFERENCES roulette_matches(id),
  category TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewing', 'resolved', 'dismissed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  resolved_by TEXT REFERENCES users(id)
);
CREATE INDEX reports_status_idx ON reports(status, created_at);

CREATE TABLE landing_revisions (
  id TEXT PRIMARY KEY,
  content_json TEXT NOT NULL,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TEXT,
  is_draft INTEGER NOT NULL DEFAULT 1 CHECK (is_draft IN (0, 1))
);

CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  actor_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX audit_created_idx ON audit_log(created_at);

INSERT INTO landing_revisions (id, content_json, is_draft, published_at)
VALUES (
  'initial-public',
  '{"theme":"signal-red","blocks":[{"id":"hero","type":"hero","eyebrow":"A tiny postal uprising","title":"Snail Mail with Clara","body":"Real letters. Thoughtful surprises. Addresses kept out of the spreadsheet.","ctaLabel":"I have an invitation","ctaHref":"/join"},{"id":"welcome","type":"text","title":"Made for our Riot Fest people","body":"This is Clara’s corner of the internet for sending actual mail—with consent, a little mystery, and zero public address lists."},{"id":"how","type":"faq","title":"How does it work?","items":[{"question":"Can I ask a specific person?","answer":"Yes. They see who asked and choose whether to share an encrypted mailing label."},{"question":"What is roulette mail?","answer":"Members who opt in can receive a surprise letter from another verified member."},{"question":"Can the site read my address?","answer":"Postal addresses are encrypted in your browser. The service stores ciphertext, not a readable address."}]}]}',
  0,
  CURRENT_TIMESTAMP
);
INSERT INTO app_settings (key, value) VALUES ('published_landing_revision', 'initial-public');
