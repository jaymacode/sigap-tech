-- Sigap SQLite initial schema. Mirrors db/migrations/0001_init.sql.
-- Foreign keys are DEFERRABLE INITIALLY DEFERRED so one persistence transaction can write
-- parents and children (including self-references) in any order.

CREATE TABLE IF NOT EXISTS schema_migrations (
  id         TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  ord           INTEGER NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('requester', 'agent', 'lead', 'admin')),
  department    TEXT NOT NULL,
  is_active     INTEGER NOT NULL,
  password_hash TEXT NOT NULL,
  last_login_at TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE teams (
  id          TEXT PRIMARY KEY,
  ord         INTEGER NOT NULL,
  name        TEXT NOT NULL,
  description TEXT NOT NULL,
  lead_id     TEXT REFERENCES users (id) DEFERRABLE INITIALLY DEFERRED,
  auto_assign INTEGER NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE team_members (
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  user_id TEXT NOT NULL REFERENCES users (id) DEFERRABLE INITIALLY DEFERRED,
  ord     INTEGER NOT NULL,
  PRIMARY KEY (team_id, user_id)
);

CREATE TABLE categories (
  id              TEXT PRIMARY KEY,
  ord             INTEGER NOT NULL,
  name            TEXT NOT NULL,
  parent_id       TEXT REFERENCES categories (id) DEFERRABLE INITIALLY DEFERRED,
  default_team_id TEXT REFERENCES teams (id) DEFERRABLE INITIALLY DEFERRED,
  is_active       INTEGER NOT NULL
);

CREATE TABLE calendars (
  id         TEXT PRIMARY KEY,
  ord        INTEGER NOT NULL,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL,
  timezone   TEXT NOT NULL,
  work_hours TEXT NOT NULL
);

CREATE TABLE holidays (
  id          TEXT PRIMARY KEY,
  ord         INTEGER NOT NULL,
  calendar_id TEXT NOT NULL REFERENCES calendars (id) DEFERRABLE INITIALLY DEFERRED,
  date        TEXT NOT NULL,
  name        TEXT NOT NULL
);

CREATE TABLE sla_policies (
  id          TEXT PRIMARY KEY,
  ord         INTEGER NOT NULL,
  name        TEXT NOT NULL,
  ticket_type TEXT NOT NULL CHECK (ticket_type IN ('incident', 'service_request')),
  is_default  INTEGER NOT NULL,
  version     INTEGER NOT NULL,
  targets     TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE catalog_items (
  id             TEXT PRIMARY KEY,
  ord            INTEGER NOT NULL,
  name           TEXT NOT NULL,
  description    TEXT NOT NULL,
  icon           TEXT NOT NULL,
  ticket_type    TEXT NOT NULL CHECK (ticket_type IN ('incident', 'service_request')),
  category_id    TEXT NOT NULL REFERENCES categories (id) DEFERRABLE INITIALLY DEFERRED,
  default_impact TEXT NOT NULL,
  form_schema    TEXT NOT NULL,
  sla_policy_id  TEXT REFERENCES sla_policies (id) DEFERRABLE INITIALLY DEFERRED,
  is_active      INTEGER NOT NULL,
  keywords       TEXT NOT NULL
);

CREATE TABLE tickets (
  id                  TEXT PRIMARY KEY,
  ord                 INTEGER NOT NULL,
  number              TEXT NOT NULL UNIQUE,
  type                TEXT NOT NULL CHECK (type IN ('incident', 'service_request')),
  title               TEXT NOT NULL,
  description         TEXT NOT NULL,
  catalog_item_id     TEXT REFERENCES catalog_items (id) DEFERRABLE INITIALLY DEFERRED,
  category_id         TEXT NOT NULL REFERENCES categories (id) DEFERRABLE INITIALLY DEFERRED,
  form_data           TEXT NOT NULL,
  requester_id        TEXT NOT NULL REFERENCES users (id) DEFERRABLE INITIALLY DEFERRED,
  team_id             TEXT REFERENCES teams (id) DEFERRABLE INITIALLY DEFERRED,
  assignee_id         TEXT REFERENCES users (id) DEFERRABLE INITIALLY DEFERRED,
  impact              TEXT NOT NULL,
  urgency             TEXT NOT NULL,
  priority            TEXT NOT NULL CHECK (priority IN ('P1', 'P2', 'P3', 'P4')),
  priority_overridden INTEGER NOT NULL,
  status              TEXT NOT NULL,
  pending_reason      TEXT,
  resolution_code     TEXT,
  resolution_notes    TEXT,
  first_response_at   TEXT,
  resolved_at         TEXT,
  closed_at           TEXT,
  reopen_count        INTEGER NOT NULL,
  escalation_level    INTEGER NOT NULL,
  problem_id          TEXT,
  is_major            INTEGER NOT NULL,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX tickets_status_idx ON tickets (status);
CREATE INDEX tickets_assignee_idx ON tickets (assignee_id);
CREATE INDEX tickets_requester_idx ON tickets (requester_id);

CREATE TABLE sla_instances (
  id              TEXT PRIMARY KEY,
  ticket_id       TEXT NOT NULL REFERENCES tickets (id) DEFERRABLE INITIALLY DEFERRED,
  kind            TEXT NOT NULL CHECK (kind IN ('response', 'resolution')),
  policy_id       TEXT NOT NULL REFERENCES sla_policies (id) DEFERRABLE INITIALLY DEFERRED,
  calendar_id     TEXT NOT NULL REFERENCES calendars (id) DEFERRABLE INITIALLY DEFERRED,
  target_minutes  REAL NOT NULL,
  status          TEXT NOT NULL,
  started_at      TEXT NOT NULL,
  running_since   TEXT,
  paused_at       TEXT,
  stopped_at      TEXT,
  elapsed_minutes REAL NOT NULL,
  paused_minutes  REAL NOT NULL,
  warn_at         TEXT NOT NULL,
  due_at          TEXT NOT NULL,
  warned_at       TEXT,
  breached_at     TEXT,
  UNIQUE (ticket_id, kind)
);

-- Audit trail. Append-only (ADR-003): UPDATE and DELETE blocked by triggers below.
CREATE TABLE ticket_events (
  id         TEXT PRIMARY KEY,
  ticket_id  TEXT NOT NULL REFERENCES tickets (id) DEFERRABLE INITIALLY DEFERRED,
  ord        INTEGER NOT NULL,
  actor_id   TEXT REFERENCES users (id) DEFERRABLE INITIALLY DEFERRED,
  type       TEXT NOT NULL,
  data       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX ticket_events_ticket_idx ON ticket_events (ticket_id, ord);

CREATE TRIGGER ticket_events_no_update
  BEFORE UPDATE ON ticket_events
BEGIN
  SELECT RAISE(ABORT, 'ticket_events is append-only: UPDATE is not allowed');
END;

CREATE TRIGGER ticket_events_no_delete
  BEFORE DELETE ON ticket_events
BEGIN
  SELECT RAISE(ABORT, 'ticket_events is append-only: DELETE is not allowed');
END;

CREATE TABLE comments (
  id         TEXT PRIMARY KEY,
  ticket_id  TEXT NOT NULL REFERENCES tickets (id) DEFERRABLE INITIALLY DEFERRED,
  ord        INTEGER NOT NULL,
  author_id  TEXT NOT NULL REFERENCES users (id) DEFERRABLE INITIALLY DEFERRED,
  body       TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('public', 'internal')),
  created_at TEXT NOT NULL
);
CREATE INDEX comments_ticket_idx ON comments (ticket_id, ord);

CREATE TABLE attachments (
  id          TEXT PRIMARY KEY,
  ticket_id   TEXT NOT NULL REFERENCES tickets (id) DEFERRABLE INITIALLY DEFERRED,
  ord         INTEGER NOT NULL,
  comment_id  TEXT REFERENCES comments (id) DEFERRABLE INITIALLY DEFERRED,
  uploader_id TEXT NOT NULL REFERENCES users (id) DEFERRABLE INITIALLY DEFERRED,
  file_name   TEXT NOT NULL,
  mime        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  storage_key TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE csat (
  id         TEXT PRIMARY KEY,
  ticket_id  TEXT NOT NULL UNIQUE REFERENCES tickets (id) DEFERRABLE INITIALLY DEFERRED,
  ord        INTEGER NOT NULL,
  score      INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  comment    TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE notifications (
  id         TEXT PRIMARY KEY,
  ord        INTEGER NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users (id) DEFERRABLE INITIALLY DEFERRED,
  type       TEXT NOT NULL,
  ticket_id  TEXT REFERENCES tickets (id) DEFERRABLE INITIALLY DEFERRED,
  title      TEXT NOT NULL,
  read_at    TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX notifications_user_idx ON notifications (user_id, ord);

CREATE TABLE changes (
  id          TEXT PRIMARY KEY,
  ord         INTEGER NOT NULL,
  number      TEXT NOT NULL UNIQUE,
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  status      TEXT NOT NULL,
  source      TEXT NOT NULL,
  commit_sha  TEXT NOT NULL,
  environment TEXT NOT NULL,
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  metadata    TEXT NOT NULL
);

-- Scalar store fields: sequences, idCounter, seededAt, workerLastTick, failedJobs, listKeys.
CREATE TABLE app_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
