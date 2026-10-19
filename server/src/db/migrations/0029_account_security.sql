-- Account security is independent of the client used to sign in.
CREATE TABLE account_security (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  user_handle TEXT NOT NULL UNIQUE,
  version INTEGER NOT NULL DEFAULT 0,
  totp_secret TEXT,
  totp_last_step INTEGER NOT NULL DEFAULT -1
);
CREATE TABLE passkeys (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key BLOB NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);
CREATE INDEX passkeys_user ON passkeys(user_id);
CREATE TABLE security_challenges (
  id_hash TEXT PRIMARY KEY,
  purpose TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  binding TEXT NOT NULL,
  version INTEGER NOT NULL,
  payload TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX security_challenges_expiry ON security_challenges(expires_at);
CREATE TABLE recovery_codes (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  PRIMARY KEY (user_id, code_hash)
);
