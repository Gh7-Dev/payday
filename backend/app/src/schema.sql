PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  organizer_wallet TEXT NOT NULL,
  programme_id TEXT,
  programme_address TEXT,
  start_date INTEGER NOT NULL,
  end_date INTEGER NOT NULL,
  start_ts INTEGER NOT NULL,
  day_len_seconds INTEGER NOT NULL,
  days INTEGER NOT NULL,
  max_participants INTEGER NOT NULL,
  decimals INTEGER NOT NULL,
  token_mint TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'created', 'funded', 'ended')),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS trainers (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  username TEXT,
  phone_e164 TEXT NOT NULL,
  wallet_address TEXT,
  encrypted_key_blob TEXT,
  password_hash TEXT,
  state TEXT NOT NULL CHECK (state IN ('invited', 'signed_up', 'funded', 'registered')),
  topped_up_at INTEGER,
  topped_up_lamports TEXT,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE(event_id, phone_e164),
  UNIQUE(event_id, username)
);

CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone_e164 TEXT NOT NULL,
  wallet_address TEXT,
  encrypted_key_blob TEXT,
  pin_hash TEXT,
  claim_code_hash TEXT,
  amounts TEXT NOT NULL,
  claim_state TEXT NOT NULL CHECK (claim_state IN ('unclaimed', 'pending', 'enrolled')),
  enroll_signature TEXT,
  claimed_at INTEGER,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE(event_id, phone_e164),
  UNIQUE(event_id, wallet_address)
);

CREATE TABLE IF NOT EXISTS claim_links (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  link_type TEXT NOT NULL CHECK (link_type IN ('trainee', 'trainer')),
  code TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pending_checkins (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  half_signed_tx TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  wallet_address TEXT,
  nonce TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
