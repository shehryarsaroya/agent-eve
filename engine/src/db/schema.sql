-- THE COMPACT — schema, migration 001.
--
-- Three write artifacts, two projections (SPEC §15.1):
--   state tables   what is true now              → agent `observe`
--   event          append-only, immutable        → viewer, audit, dataset
--   action_log     every submission incl. rejected → replay
--
-- The correction that matters: replay's input is
-- (snapshot_T, action_log_T, seed_T) → snapshot_T+1. **Events are output, not
-- input.** "Observations are projections of one event stream" gets built as
-- fold-events-per-request, which is the canonical event-sourcing cliff and makes
-- expected_state_version incoherent.
--
-- The database is created with LC_COLLATE=C so text ordering is byte-order on
-- every host. That is the real fix for the collation determinism killer
-- (SPEC §15.5) — it makes the bug impossible rather than something every
-- ORDER BY has to remember. Ordering keys still say COLLATE "C" explicitly
-- where it is cheap, as documentation.

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migration (
  version      integer PRIMARY KEY,
  applied_at   timestamptz NOT NULL DEFAULT now(),
  description  text NOT NULL
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Identity
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS principal (
  id                text PRIMARY KEY,
  handle            text NOT NULL UNIQUE,
  -- Ed25519 public key, raw 32 bytes. The principal generates its own keypair;
  -- we never hold the private half. A record of who kept their word cannot rest
  -- on "trust our server", so a signature must be the agent's own.
  public_key        bytea NOT NULL,
  enrolled_at_tick  integer NOT NULL,
  -- Attribution only. Unlocks nothing competitive (§6.4, §13B): one catch-all
  -- domain gives one person unlimited verified addresses, so email bonds
  -- nothing and capital does (A15).
  owner_email       text,
  owner_verified    boolean NOT NULL DEFAULT false,
  CONSTRAINT principal_handle_shape CHECK (handle ~ '^[a-z][a-z0-9_]{2,31}$'),
  CONSTRAINT principal_key_len CHECK (octet_length(public_key) = 32)
);

-- An owner's published disposition. Public, disposition-only, and read by the
-- agent as advice it may disregard (§13B). Deliberately NOT an observe key:
-- stable text does not belong in a per-tick payload.
CREATE TABLE IF NOT EXISTS mandate (
  principal_id  text PRIMARY KEY REFERENCES principal(id),
  version       integer NOT NULL DEFAULT 1,
  body          text NOT NULL,
  updated_tick  integer NOT NULL,
  CONSTRAINT mandate_len CHECK (length(body) <= 4000)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Value. `posting` is authoritative; nothing else may claim to hold a balance.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  -- CREATE TYPE has no IF NOT EXISTS, and this file runs on every deploy, so the
  -- guard is what makes the migration idempotent rather than first-run-only.
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'account_kind') THEN
    CREATE TYPE account_kind AS ENUM ('STORES', 'ESCROW', 'FAUCET', 'SINK');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS account (
  id            text PRIMARY KEY,
  kind          account_kind NOT NULL,
  principal_id  text REFERENCES principal(id),
  -- Faucets and sinks are world-owned and named, so every unit entering or
  -- leaving the economy is attributable (INV-1's ISSUE/RETIRE branch).
  name          text,
  CONSTRAINT account_owner CHECK (
    (kind IN ('STORES', 'ESCROW') AND principal_id IS NOT NULL) OR
    (kind IN ('FAUCET', 'SINK')   AND principal_id IS NULL AND name IS NOT NULL)
  )
);

-- ─────────────────────────────────────────────────────────────────────────────
-- The event ledger. Partitioned by range on tick from the first migration,
-- because retrofitting partitioning onto a live append-only table is a rewrite.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  -- CREATE TYPE has no IF NOT EXISTS, and this file runs on every deploy, so the
  -- guard is what makes the migration idempotent rather than first-run-only.
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'provenance_class') THEN
    CREATE TYPE provenance_class AS ENUM ('FACT', 'ASSERTION', 'ESTIMATE');
  END IF;
END $$;
-- INTENT, not STANDING: §3 gives STANDING to the public factual vectors, and
-- both would ship in the same payload. A3's word for a durable pre-set decision
-- is "intent".
DO $$ BEGIN
  -- CREATE TYPE has no IF NOT EXISTS, and this file runs on every deploy, so the
  -- guard is what makes the migration idempotent rather than first-run-only.
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'decision_source') THEN
    CREATE TYPE decision_source AS ENUM ('LIVE', 'INTENT', 'DELEGATE', 'HEURISTIC', 'FALLBACK');
  END IF;
END $$;

-- The §11.2 ladder, as a type. Five rungs, and the order below is the order the spec
-- states them in — an enum's declaration order is its sort order in Postgres, so a
-- reordering here would silently change `ORDER BY visibility` anywhere it is used.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'visibility') THEN
    CREATE TYPE visibility AS ENUM ('PUBLIC', 'PARTIES', 'SENSED', 'SEALED', 'PRIVATE');
  END IF;
END $$;

-- Why a principal is in an event's audience. `admitAudience`'s door checks this, so a
-- restored world needs it to re-check rather than trust.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'audience_basis') THEN
    CREATE TYPE audience_basis AS ENUM ('SELF', 'PARTY', 'IN_RANGE', 'INTEL');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS event (
  id                        text        NOT NULL,
  tick                      integer     NOT NULL,
  seq_in_tick               integer     NOT NULL,
  kind                      text        NOT NULL,
  -- Accepted obligations pin the version they quoted, or a balance patch
  -- retroactively rewrites history.
  rules_version             integer     NOT NULL,
  actor_principal_id        text,
  -- Columns, not payload keys: the A6 replay has to join on these, and the A4
  -- audit has to group by them.
  on_behalf_of_principal_id text,
  grant_id                  text,
  event_family_id           text        NOT NULL,
  -- Causality. One flat field cannot express both cohort and cause.
  parent_event_id           text,
  -- ── THE §11.2 TIER, WHICH THIS TABLE COULD NOT EXPRESS ──────────────────
  --
  -- `is_public` is a boolean and the ladder has five rungs: PUBLIC · PARTIES · SENSED ·
  -- SEALED · PRIVATE. So a durable record could say whether an event was public and
  -- could not say which of the other four it was, and `hydrateEventsForSnapshot`
  -- correctly REFUSED to adopt a checkpoint it could not re-check the ladder from —
  -- which meant production could never take a bounded boot and replayed from genesis
  -- every restart, a cost growing with the age of the world.
  --
  -- `is_public` is kept rather than derived on read: it carries the partial index that
  -- makes the public feed a range scan, and INV-14's structural CHECK below is written
  -- against it. Two columns for one fact is normally scar #5 — here the boolean is an
  -- index key and the enum is the fact, and the constraint at the bottom of this table
  -- asserts they cannot disagree.
  visibility                visibility,
  -- Keys that survive a FLAG_ONLY projection. An array, not jsonb: it is read as a set
  -- and never queried into.
  flag_keys                 text[]      NOT NULL DEFAULT '{}',
  is_public                 boolean     NOT NULL,
  public_at                 integer,
  declassify_at             integer,
  provenance_class          provenance_class NOT NULL,
  acted_on_state_version    bigint,
  decision_source           decision_source,
  payload                   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (tick, seq_in_tick),
  -- seq_in_tick is dense and gapless per tick (INV-11); the unique key above
  -- prevents duplicates, and the engine asserts density at tick close.
  CONSTRAINT event_seq_nonneg CHECK (seq_in_tick >= 0),
  CONSTRAINT event_tick_nonneg CHECK (tick >= 0),
  -- Visibility monotonicity, the structural half of INV-14.
  CONSTRAINT event_public_at_consistent CHECK (
    (is_public AND public_at IS NOT NULL AND public_at <= tick) OR (NOT is_public)
  ),
  CONSTRAINT event_declassify_after CHECK (declassify_at IS NULL OR declassify_at >= tick),
  -- The two spellings of one fact cannot disagree. Without this, `is_public` and
  -- `visibility` are scar #5 — one quantity with two homes and no referee.
  --
  -- Permits NULL, and that is the migration's whole shape: rows written before the column
  -- existed genuinely DO NOT KNOW their tier, because `is_public` cannot distinguish PARTIES
  -- from SEALED. Backfilling a guess would be worse than the gap — it would put a fabricated
  -- tier in the permanent record, which is A5′ with our own migration as the cause. So old rows
  -- stay NULL, the hydrate refuses to adopt a checkpoint that spans them, and the refusal
  -- narrows by itself as the world moves past the migration.
  CONSTRAINT event_visibility_agrees CHECK (
    visibility IS NULL OR (visibility = 'PUBLIC') = is_public
  )
) PARTITION BY RANGE (tick);

CREATE UNIQUE INDEX IF NOT EXISTS event_id_uq ON event (id, tick);
CREATE INDEX IF NOT EXISTS event_actor_idx  ON event (actor_principal_id, tick DESC);
CREATE INDEX IF NOT EXISTS event_family_idx ON event (event_family_id, tick);
CREATE INDEX IF NOT EXISTS event_public_idx ON event (tick DESC) WHERE is_public;
CREATE INDEX IF NOT EXISTS event_grant_idx  ON event (grant_id, tick) WHERE grant_id IS NOT NULL;

-- The audience fan-out. A TABLE, deliberately, not a jsonb ACL on the event:
-- a jsonb ACL is un-indexable and turns private-feed paging into a sequential
-- scan (SPEC §15.1). PARTIES events carry >=2 rows here, SENSED >=1 (INV-13).
CREATE TABLE IF NOT EXISTS event_audience (
  tick          integer NOT NULL,
  seq_in_tick   integer NOT NULL,
  principal_id  text    NOT NULL,
  -- WHY this principal may read it. Without the basis a restored world knows the
  -- allow-list and not the rule behind it, so `admitAudience`'s door cannot be re-run
  -- and the hydrate has to trust the rows instead of re-checking them.
  basis         audience_basis,
  -- The tick the admission was MADE, which is not always the event's own tick: a late
  -- admission has to replay in the order it happened or its reveal ordinal moves.
  -- Defaults to the event's tick, which is what every admission in the engine does today.
  admitted_at_tick integer,
  PRIMARY KEY (tick, seq_in_tick, principal_id),
  CONSTRAINT event_audience_not_before CHECK (
    admitted_at_tick IS NULL OR admitted_at_tick >= tick
  )
) PARTITION BY RANGE (tick);

CREATE INDEX IF NOT EXISTS event_audience_principal_idx
  ON event_audience (principal_id, tick DESC);

-- Value moves here and only here. The invariant is >=2 postings summing to zero
-- per value-moving event, or exactly one ISSUE/RETIRE against a named
-- faucet/sink, asserted at tick close (INV-1).
--
-- Note what is absent: balance columns on `event`. Putting balanced totals there
-- duplicates this table — scar #5 inside the field list that exists to prevent
-- scar #5.
--
-- ── WHY THERE IS NO FOREIGN KEY ON account_id ────────────────────────────────
--
-- There was one, and it is the reason this table sat EMPTY for the whole of the
-- live world's first season. `posting -> account -> principal.public_key NOT NULL
-- (32 bytes)`, and the house cast is seated keyless on purpose (the enrol-takeover
-- guard depends on it), so cast-owned accounts could never be inserted and neither
-- could any posting that touched one. The authoritative value log was unwritable.
--
-- The FK is dropped rather than worked around, because it was wrong on its own
-- terms, independently of the keyless cast:
--
--   * It points from an APPEND-ONLY, partitioned history table into a MUTABLE
--     state table (SPEC §15.1 keeps those two artifacts separate). History that
--     depends on a current-state row still existing is history a DELETE elsewhere
--     can invalidate, and it pins every partition against DETACH — the schema
--     already refuses exactly this shape for `idempotency -> action_log`.
--   * It enforces nothing this record needs. What must be true is that a posting's
--     account is one the LEDGER knows, and that is asserted twice already:
--     `Ledger.apply` refuses a posting against an unknown account at write time
--     (INV-1's form check), and the boot hydrate refuses any posting whose account
--     is absent from the snapshot's own captured account set — a strictly stronger
--     test, because it compares against the accounts as they were AT that tick
--     rather than as they are today.
--
-- `account` and `principal` are left exactly as they are: the schema/implementation
-- mismatch they carry (keyless cast, hyphenated handles) is real and is still
-- reported, but it is an identity question and it no longer blocks the value log.
CREATE TABLE IF NOT EXISTS posting (
  tick          integer NOT NULL,
  seq_in_tick   integer NOT NULL,
  posting_index integer NOT NULL,
  account_id    text    NOT NULL,
  good_id       text,
  -- Integer minor units. There are no floats in this column's world; a numeric
  -- with a scale would invite one.
  amount_minor  bigint  NOT NULL,
  amount_qty    bigint,
  PRIMARY KEY (tick, seq_in_tick, posting_index),
  CONSTRAINT posting_qty_needs_good CHECK (
    (amount_qty IS NULL AND good_id IS NULL) OR (amount_qty IS NOT NULL AND good_id IS NOT NULL)
  )
) PARTITION BY RANGE (tick);

CREATE INDEX IF NOT EXISTS posting_account_idx ON posting (account_id, tick DESC);

-- The batch's own three fields, repeated on each of its rows.
--
-- A batch (`AppliedBatch`) has no table: `seq_in_tick` here is the batch's ordinal
-- within the tick, so a batch is the group of rows sharing `(tick, seq_in_tick)`.
-- These three are what makes that group re-checkable — INV-1's form check needs the
-- kind and the NAMED faucet or sink, and `checkInv7`'s third mirror recomputes the
-- faucet/sink accumulators from them. "Which faucet" is not recoverable from the
-- kind, so it is stored. The reader refuses a group whose rows disagree, which is
-- what keeps a denormalised column from becoming a second home for the fact.
--
-- Nullable, and NOT retro-constrained: these are ALTERs that run on a live database
-- on every deploy, and a constraint that has to validate existing rows is a deploy
-- that can fail closed on a table the world is writing to. The writer always supplies
-- all three and the hydrate refuses a null, which puts the check where a failure is a
-- refusal to boot rather than a refusal to migrate.
-- ── THE FOUR COLUMNS A BOUNDED BOOT NEEDED ────────────────────────────────────
--
-- `hydrateEventsForSnapshot` refuses to adopt a checkpoint it cannot re-check the §11.2
-- ladder from, so production replayed from genesis on every restart at a cost that grew
-- with the age of the world. These are the columns it was missing. Added by ALTER as well
-- as in the CREATE above, because `CREATE TABLE IF NOT EXISTS` does nothing to a table
-- that already exists — the mistake that would leave a live database silently unmigrated
-- while the schema file looked correct.
ALTER TABLE event ADD COLUMN IF NOT EXISTS visibility visibility;
ALTER TABLE event ADD COLUMN IF NOT EXISTS flag_keys  text[] NOT NULL DEFAULT '{}';
ALTER TABLE event_audience ADD COLUMN IF NOT EXISTS basis            audience_basis;
ALTER TABLE event_audience ADD COLUMN IF NOT EXISTS admitted_at_tick integer;

ALTER TABLE posting ADD COLUMN IF NOT EXISTS event_id          text;
ALTER TABLE posting ADD COLUMN IF NOT EXISTS batch_kind        text;
ALTER TABLE posting ADD COLUMN IF NOT EXISTS supply_account_id text;

-- Drop the FK on an already-migrated database. `CREATE TABLE IF NOT EXISTS` above is
-- a no-op there, so removing the clause from the DDL alone would leave production
-- unable to write a single posting while every fresh database could.
ALTER TABLE posting DROP CONSTRAINT IF EXISTS posting_account_id_fkey;

-- ─────────────────────────────────────────────────────────────────────────────
-- The action log. Every submission including rejected ones, with arrival and
-- resolution order, because replay reads this and rejected actions are part of
-- what an agent did.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS action_log (
  tick                   integer NOT NULL,
  resolution_order       integer NOT NULL,
  principal_id           text    NOT NULL,
  client_sequence        integer NOT NULL,
  -- Ordering is (priority, principal_id, client_sequence), NEVER arrival
  -- (SPEC §15.2). arrival_ms is recorded for the A4 audit — to prove response
  -- speed bought nothing — and must never be an ordering key.
  arrival_ms             bigint  NOT NULL,
  priority               integer NOT NULL,
  verb                   text    NOT NULL,
  params                 jsonb   NOT NULL,
  idempotency_key        text,
  expected_state_version bigint,
  accepted               boolean NOT NULL,
  reject_reason          text,
  decision_source        decision_source,
  PRIMARY KEY (tick, resolution_order),
  CONSTRAINT action_reject_has_reason CHECK (accepted OR reject_reason IS NOT NULL)
) PARTITION BY RANGE (tick);

-- Idempotency lives in its OWN table, deliberately not on `action_log`.
--
-- The obvious index — UNIQUE (principal_id, idempotency_key) on action_log — is
-- rejected outright by Postgres: a unique index on a partitioned table must include
-- every partitioning column, and `tick` is the partition key. Adding `tick` compiles
-- and is WRONG: it makes a key unique *per tick*, so a client retrying across a tick
-- boundary — the exact case idempotency exists for, since a retry happens after a
-- timeout and a timeout is usually longer than a tick — would insert a second action
-- and the world would apply it twice.
--
-- So the key is a LOOKUP rather than part of the append-only record. Unpartitioned,
-- globally unique per principal, and prunable: once a tick falls out of the replay
-- window the row has no reader, which is what stops this from being scar #3 in slow
-- motion.
CREATE TABLE IF NOT EXISTS idempotency (
  principal_id     text    NOT NULL,
  idempotency_key  text    NOT NULL,
  -- Where the original landed, so a repeat can be answered with the first result
  -- rather than re-executed. Not a foreign key: `action_log` is partitioned and a
  -- reference into it would pin every partition against DETACH.
  tick             integer NOT NULL,
  resolution_order integer NOT NULL,
  PRIMARY KEY (principal_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idempotency_tick_idx ON idempotency (tick);

-- ─────────────────────────────────────────────────────────────────────────────
-- Wake accounting. SPEC §15.1: "Two tables the design requires and nobody
-- named: wake_offer and observation_fetch, without which §5.1's wake guarantee
-- is unenforceable."
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wake_offer (
  principal_id  text    NOT NULL,
  tick          integer NOT NULL,
  reason        text    NOT NULL,
  -- A party to a resolving item is offered exactly one wake before it; after
  -- one offer it resolves regardless, or going offline defers settlement
  -- forever (SPEC §5.1).
  about_ref     text,
  PRIMARY KEY (principal_id, tick, reason)
);

CREATE TABLE IF NOT EXISTS observation_fetch (
  principal_id  text    NOT NULL,
  tick          integer NOT NULL,
  fetched_ms    bigint  NOT NULL,
  -- Outside a wake, observe returns the cached snapshot with no fresh
  -- affordances and no new quote_id: legal, free, and useless (SPEC §12.4).
  within_wake   boolean NOT NULL,
  bytes         integer NOT NULL,
  PRIMARY KEY (principal_id, tick, fetched_ms)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Snapshots. Replay's actual input, hashed at tick boundaries only — per-event
-- state hashing was dropped deliberately (SPEC §15.1).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS snapshot (
  tick           integer PRIMARY KEY,
  state_hash     text    NOT NULL,
  -- The seed for tick T, whose hash publishes BEFORE actions for T are
  -- accepted. A seed revealed early is an oracle.
  seed           text    NOT NULL,
  seed_hash      text    NOT NULL,
  state_version  bigint  NOT NULL,
  body           jsonb   NOT NULL,
  created_ms     bigint  NOT NULL
);

-- ─────────────────────────────────────────────────────────────────────────────
-- World status. A world that stops with no resume path is an outage in front of
-- an audience, so PAUSED has defined semantics (SPEC §15.2).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS world_status (
  singleton     boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  status        text    NOT NULL CHECK (status IN ('RUNNING', 'PAUSED')),
  current_tick  integer NOT NULL,
  paused_reason text,
  paused_at_ms  bigint,
  CONSTRAINT paused_has_reason CHECK (status = 'RUNNING' OR paused_reason IS NOT NULL)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- The journal's own boot inputs (src/persist/**). Added when the game learned to
-- WRITE to Postgres at all — until then the "permanent public record" was process
-- memory and every restart reset the world to tick 0. All additive
-- (CREATE ... IF NOT EXISTS), so an existing database gets them on the next migrate.
-- ─────────────────────────────────────────────────────────────────────────────

-- The run's master seed, write-once. Boot reads it and REFUSES to resume under a
-- different seed, because replaying a persisted world under another seed diverges
-- every hash. A key/value table so other write-once run facts have a home too.
CREATE TABLE IF NOT EXISTS journal_meta (
  key    text PRIMARY KEY,
  value  text NOT NULL
);

-- seed(T) and its commitment, per committed tick. Redundant with the master seed
-- (seed(T) is derived from it) but stored so the commit/reveal discipline — that
-- hash(seed(T)) published BEFORE actions for T were accepted (DET-6) — is
-- re-verifiable from durable data alone, without recomputing anything.
CREATE TABLE IF NOT EXISTS tick_seed (
  tick       integer PRIMARY KEY,
  seed       text NOT NULL,
  seed_hash  text NOT NULL,
  CONSTRAINT tick_seed_tick_nonneg CHECK (tick >= 0)
);

-- Externally-enrolled identities (POST /enroll), so boot can re-seat them in the
-- same order and the world reaches the same state at each tick. The house cast is
-- re-seated deterministically from the master seed and is deliberately NOT here.
--
-- Deliberately NOT the `principal` table above: that one requires a 32-byte key and
-- an underscore-only handle grammar, neither of which matches the live model (the
-- house cast is keyless; the API's handle grammar allows hyphens). Those are
-- pre-existing schema/implementation mismatches reported by the persistence work;
-- until they are reconciled the journal keeps its boot inputs in its own table with
-- no such constraints. `public_key` is base64url text for the same reason.
CREATE TABLE IF NOT EXISTS journal_enrollment (
  seq               bigserial,
  principal         text PRIMARY KEY,
  handle            text    NOT NULL,
  public_key        text    NOT NULL,
  enrolled_at_tick  integer NOT NULL,
  owner_email       text
);

CREATE INDEX IF NOT EXISTS journal_enrollment_order_idx
  ON journal_enrollment (enrolled_at_tick, seq);

-- A DECLARED DISCONTINUITY IN THE RECORD.
--
-- A5 says the record must never be wrong, and a code change that makes a past tick
-- compute differently makes replay disagree with the bytes already written. Boot's
-- default answer is to refuse to serve the world at all. An operator may instead
-- declare the change — naming the tick, the rules version the old ticks were written
-- under and the one running now — and this table is that declaration.
--
-- Append-only by grant like the rest of history (see APPEND_ONLY_UNPARTITIONED in
-- migrate.ts): the door annotates, it never rewrites. Unpartitioned because there
-- should be a handful of these in a world's whole life; if this table ever grows
-- fast, that is the finding, not the storage.
CREATE TABLE IF NOT EXISTS journal_divergence (
  seq                 bigserial PRIMARY KEY,
  tick                integer NOT NULL,
  kind                text    NOT NULL,
  -- Null on a journal written before rules_version was recorded at genesis.
  from_rules_version  integer,
  to_rules_version    integer NOT NULL,
  detail              text    NOT NULL,
  expected_hash       text,
  actual_hash         text,
  tolerated_after     integer NOT NULL DEFAULT 0,
  accepted_at_ms      bigint  NOT NULL,
  CONSTRAINT journal_divergence_tick_nonneg CHECK (tick >= 0),
  CONSTRAINT journal_divergence_kind CHECK (kind IN ('APPLIED_REFUSED', 'STATE_HASH_MISMATCH')),
  CONSTRAINT journal_divergence_detail_len CHECK (length(detail) <= 2000)
);

CREATE INDEX IF NOT EXISTS journal_divergence_tick_idx
  ON journal_divergence (tick, seq);

COMMIT;
