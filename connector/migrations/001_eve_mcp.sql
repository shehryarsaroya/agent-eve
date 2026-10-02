-- Agent Eve MCP connector: accounts, hosted agent keys, and the per-account signing log.
--
-- These tables live in their own schema (eve_mcp) of the engine's database, owned by the
-- connector's own role (eve_mcp_app), which has no access to the engine's tables and which the
-- engine's role has no access to. NOTHING HERE IS PART OF THE GAME RECORD: the journal is the
-- record. Dropping this schema would strand every hosted principal (its key is gone, and
-- identity is never re-minted, A10) but could never change a past tick.

-- One row per Supabase account that has ever called a tool that needs an account.
CREATE TABLE IF NOT EXISTS eve_mcp.account (
  account_id   uuid PRIMARY KEY,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

-- The account's one principal (one principal per account), and its Ed25519 key, encrypted with
-- AES-256-GCM under a master key that exists only in the service's environment file. A row
-- exists from the moment the key is generated, BEFORE the enrolment request leaves: a lost
-- response must never lose a key.
CREATE TABLE IF NOT EXISTS eve_mcp.hosted_principal (
  account_id         uuid PRIMARY KEY REFERENCES eve_mcp.account (account_id),
  -- Unique only among ENROLLED rows (indexes below): a pending row must not squat a handle the
  -- world never gave it (A15 — accounts are free). The engine decides who gets a handle.
  handle             text NOT NULL
                       CHECK (handle ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' AND char_length(handle) <= 32),
  principal_id       text NOT NULL,
  keyid              text NOT NULL UNIQUE,
  public_key         text NOT NULL,
  encrypted_key      bytea NOT NULL,
  key_version        smallint NOT NULL,
  enrolled           boolean NOT NULL DEFAULT false,
  enrolled_at        timestamptz,
  -- HTTP status of the last enrolment attempt; NULL while one has no definitive answer.
  last_enroll_status smallint,
  next_sequence      integer NOT NULL DEFAULT 1 CHECK (next_sequence >= 1),
  -- The wake-budget facts of the last observation this service fetched for the principal:
  -- {tick, reckoning, wakes_remaining, next_decision_at, observed_at}. What eve_wake_status reads.
  last_observation   jsonb,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- Every request this service signed (or sent unsigned, for enrolment) on an account's behalf.
-- Metadata only: never a body, a parameter, a text an agent wrote, or a signature.
CREATE TABLE IF NOT EXISTS eve_mcp.signing_log (
  id              bigserial PRIMARY KEY,
  account_id      uuid NOT NULL REFERENCES eve_mcp.account (account_id),
  at              timestamptz NOT NULL DEFAULT now(),
  method          text NOT NULL,
  path            text NOT NULL,
  signed          boolean NOT NULL,
  keyid           text NOT NULL,
  verbs           jsonb NOT NULL DEFAULT '[]'::jsonb,
  action_count    smallint NOT NULL DEFAULT 0,
  idempotency_key text,
  -- sha-256 of the canonical tool arguments: how a host retry is recognised.
  content_hash    text,
  -- NULL until the engine answers; stays NULL if it never did (a retry then re-sends the same key).
  http_status     smallint,
  -- For act: which verbs were accepted or corrected, by clientSequence. Never params, hints or text.
  outcome         jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS hosted_principal_handle_enrolled
  ON eve_mcp.hosted_principal (handle) WHERE enrolled;
CREATE UNIQUE INDEX IF NOT EXISTS hosted_principal_principal_enrolled
  ON eve_mcp.hosted_principal (principal_id) WHERE enrolled;

CREATE INDEX IF NOT EXISTS signing_log_account_at
  ON eve_mcp.signing_log (account_id, at DESC, id DESC);
CREATE INDEX IF NOT EXISTS signing_log_account_key
  ON eve_mcp.signing_log (account_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS signing_log_account_content
  ON eve_mcp.signing_log (account_id, content_hash, at DESC)
  WHERE content_hash IS NOT NULL;
