-- Sigap initial schema. Mirrors the record types in src/server/mock/types.ts (snake_case).
-- Every table has `ord`: the record's position in the in-memory Map/array, so hydration
-- restores the exact iteration order the queries were written against.
-- Foreign keys are DEFERRABLE INITIALLY DEFERRED so one persistence transaction can write
-- parents and children (including self-references) in any order.

CREATE TABLE users (
  id            text PRIMARY KEY,
  ord           integer NOT NULL,
  email         text NOT NULL UNIQUE,
  name          text NOT NULL,
  role          text NOT NULL CHECK (role IN ('requester', 'agent', 'lead', 'admin')),
  department    text NOT NULL,
  is_active     boolean NOT NULL,
  password_hash text NOT NULL,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL
);

CREATE TABLE teams (
  id          text PRIMARY KEY,
  ord         integer NOT NULL,
  name        text NOT NULL,
  description text NOT NULL,
  lead_id     text REFERENCES users (id) DEFERRABLE INITIALLY DEFERRED,
  auto_assign boolean NOT NULL,
  created_at  timestamptz NOT NULL
);

CREATE TABLE team_members (
  team_id text NOT NULL REFERENCES teams (id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  user_id text NOT NULL REFERENCES users (id) DEFERRABLE INITIALLY DEFERRED,
  ord     integer NOT NULL,
  PRIMARY KEY (team_id, user_id)
);

CREATE TABLE categories (
  id              text PRIMARY KEY,
  ord             integer NOT NULL,
  name            text NOT NULL,
  parent_id       text REFERENCES categories (id) DEFERRABLE INITIALLY DEFERRED,
  default_team_id text REFERENCES teams (id) DEFERRABLE INITIALLY DEFERRED,
  is_active       boolean NOT NULL
);

CREATE TABLE calendars (
  id         text PRIMARY KEY,
  ord        integer NOT NULL,
  name       text NOT NULL,
  kind       text NOT NULL,
  timezone   text NOT NULL,
  work_hours jsonb NOT NULL
);

CREATE TABLE holidays (
  id          text PRIMARY KEY,
  ord         integer NOT NULL,
  calendar_id text NOT NULL REFERENCES calendars (id) DEFERRABLE INITIALLY DEFERRED,
  date        date NOT NULL,
  name        text NOT NULL
);

CREATE TABLE sla_policies (
  id          text PRIMARY KEY,
  ord         integer NOT NULL,
  name        text NOT NULL,
  ticket_type text NOT NULL CHECK (ticket_type IN ('incident', 'service_request')),
  is_default  boolean NOT NULL,
  version     integer NOT NULL,
  targets     jsonb NOT NULL,
  updated_at  timestamptz NOT NULL
);

CREATE TABLE catalog_items (
  id             text PRIMARY KEY,
  ord            integer NOT NULL,
  name           text NOT NULL,
  description    text NOT NULL,
  icon           text NOT NULL,
  ticket_type    text NOT NULL CHECK (ticket_type IN ('incident', 'service_request')),
  category_id    text NOT NULL REFERENCES categories (id) DEFERRABLE INITIALLY DEFERRED,
  default_impact text NOT NULL,
  form_schema    jsonb NOT NULL,
  sla_policy_id  text REFERENCES sla_policies (id) DEFERRABLE INITIALLY DEFERRED,
  is_active      boolean NOT NULL,
  keywords       jsonb NOT NULL
);

CREATE TABLE tickets (
  id                  text PRIMARY KEY,
  ord                 integer NOT NULL,
  number              text NOT NULL UNIQUE,
  type                text NOT NULL CHECK (type IN ('incident', 'service_request')),
  title               text NOT NULL,
  description         text NOT NULL,
  catalog_item_id     text REFERENCES catalog_items (id) DEFERRABLE INITIALLY DEFERRED,
  category_id         text NOT NULL REFERENCES categories (id) DEFERRABLE INITIALLY DEFERRED,
  form_data           jsonb NOT NULL,
  requester_id        text NOT NULL REFERENCES users (id) DEFERRABLE INITIALLY DEFERRED,
  team_id             text REFERENCES teams (id) DEFERRABLE INITIALLY DEFERRED,
  assignee_id         text REFERENCES users (id) DEFERRABLE INITIALLY DEFERRED,
  impact              text NOT NULL,
  urgency             text NOT NULL,
  priority            text NOT NULL CHECK (priority IN ('P1', 'P2', 'P3', 'P4')),
  priority_overridden boolean NOT NULL,
  status              text NOT NULL,
  pending_reason      text,
  resolution_code     text,
  resolution_notes    text,
  first_response_at   timestamptz,
  resolved_at         timestamptz,
  closed_at           timestamptz,
  reopen_count        integer NOT NULL,
  escalation_level    integer NOT NULL,
  problem_id          text,
  is_major            boolean NOT NULL,
  created_at          timestamptz NOT NULL,
  updated_at          timestamptz NOT NULL
);
CREATE INDEX tickets_status_idx ON tickets (status);
CREATE INDEX tickets_assignee_idx ON tickets (assignee_id);
CREATE INDEX tickets_requester_idx ON tickets (requester_id);

CREATE TABLE sla_instances (
  id              text PRIMARY KEY,
  ticket_id       text NOT NULL REFERENCES tickets (id) DEFERRABLE INITIALLY DEFERRED,
  kind            text NOT NULL CHECK (kind IN ('response', 'resolution')),
  policy_id       text NOT NULL REFERENCES sla_policies (id) DEFERRABLE INITIALLY DEFERRED,
  calendar_id     text NOT NULL REFERENCES calendars (id) DEFERRABLE INITIALLY DEFERRED,
  target_minutes  double precision NOT NULL,
  status          text NOT NULL,
  started_at      timestamptz NOT NULL,
  running_since   timestamptz,
  paused_at       timestamptz,
  stopped_at      timestamptz,
  elapsed_minutes double precision NOT NULL,
  paused_minutes  double precision NOT NULL,
  warn_at         timestamptz NOT NULL,
  due_at          timestamptz NOT NULL,
  warned_at       timestamptz,
  breached_at     timestamptz,
  UNIQUE (ticket_id, kind)
);

-- Audit trail. Append-only: see the trigger below.
CREATE TABLE ticket_events (
  id         text PRIMARY KEY,
  ticket_id  text NOT NULL REFERENCES tickets (id) DEFERRABLE INITIALLY DEFERRED,
  ord        integer NOT NULL,
  actor_id   text REFERENCES users (id) DEFERRABLE INITIALLY DEFERRED,
  type       text NOT NULL,
  data       jsonb NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX ticket_events_ticket_idx ON ticket_events (ticket_id, ord);

CREATE FUNCTION ticket_events_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ticket_events is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ticket_events_no_update_delete
  BEFORE UPDATE OR DELETE ON ticket_events
  FOR EACH ROW EXECUTE FUNCTION ticket_events_append_only();

CREATE TRIGGER ticket_events_no_truncate
  BEFORE TRUNCATE ON ticket_events
  FOR EACH STATEMENT EXECUTE FUNCTION ticket_events_append_only();

CREATE TABLE comments (
  id         text PRIMARY KEY,
  ticket_id  text NOT NULL REFERENCES tickets (id) DEFERRABLE INITIALLY DEFERRED,
  ord        integer NOT NULL,
  author_id  text NOT NULL REFERENCES users (id) DEFERRABLE INITIALLY DEFERRED,
  body       text NOT NULL,
  visibility text NOT NULL CHECK (visibility IN ('public', 'internal')),
  created_at timestamptz NOT NULL
);
CREATE INDEX comments_ticket_idx ON comments (ticket_id, ord);

CREATE TABLE attachments (
  id          text PRIMARY KEY,
  ticket_id   text NOT NULL REFERENCES tickets (id) DEFERRABLE INITIALLY DEFERRED,
  ord         integer NOT NULL,
  comment_id  text REFERENCES comments (id) DEFERRABLE INITIALLY DEFERRED,
  uploader_id text NOT NULL REFERENCES users (id) DEFERRABLE INITIALLY DEFERRED,
  file_name   text NOT NULL,
  mime        text NOT NULL,
  size        integer NOT NULL,
  storage_key text NOT NULL,
  created_at  timestamptz NOT NULL
);

CREATE TABLE csat (
  id         text PRIMARY KEY,
  ticket_id  text NOT NULL UNIQUE REFERENCES tickets (id) DEFERRABLE INITIALLY DEFERRED,
  ord        integer NOT NULL,
  score      integer NOT NULL CHECK (score BETWEEN 1 AND 5),
  comment    text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE notifications (
  id         text PRIMARY KEY,
  ord        integer NOT NULL,
  user_id    text NOT NULL REFERENCES users (id) DEFERRABLE INITIALLY DEFERRED,
  type       text NOT NULL,
  ticket_id  text REFERENCES tickets (id) DEFERRABLE INITIALLY DEFERRED,
  title      text NOT NULL,
  read_at    timestamptz,
  created_at timestamptz NOT NULL
);
CREATE INDEX notifications_user_idx ON notifications (user_id, ord);

CREATE TABLE changes (
  id          text PRIMARY KEY,
  ord         integer NOT NULL,
  number      text NOT NULL UNIQUE,
  type        text NOT NULL,
  title       text NOT NULL,
  status      text NOT NULL,
  source      text NOT NULL,
  commit_sha  text NOT NULL,
  environment text NOT NULL,
  started_at  timestamptz NOT NULL,
  finished_at timestamptz,
  metadata    jsonb NOT NULL
);

-- Scalar store fields: sequences, idCounter, seededAt, workerLastTick, failedJobs.
CREATE TABLE app_state (
  key   text PRIMARY KEY,
  value jsonb NOT NULL
);
