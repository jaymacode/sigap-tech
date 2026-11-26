-- Durable outbox untuk email notifikasi (dikirim oleh worker; retry dengan backoff).
CREATE TABLE mail_outbox (
  id              TEXT PRIMARY KEY,
  ord             INTEGER NOT NULL,
  to_email        TEXT NOT NULL,
  subject         TEXT NOT NULL,
  text            TEXT NOT NULL,
  html            TEXT,
  ticket_id       TEXT,
  status          TEXT NOT NULL CHECK (status IN ('queued', 'sent', 'failed')),
  attempts        INTEGER NOT NULL,
  last_error      TEXT,
  created_at      TEXT NOT NULL,
  sent_at         TEXT,
  next_attempt_at TEXT NOT NULL
);
CREATE INDEX mail_outbox_status_idx ON mail_outbox (status, ord);
