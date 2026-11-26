-- Durable outbox untuk email notifikasi (dikirim oleh worker; retry dengan backoff).
CREATE TABLE mail_outbox (
  id              text PRIMARY KEY,
  ord             integer NOT NULL,
  to_email        text NOT NULL,
  subject         text NOT NULL,
  text            text NOT NULL,
  html            text,
  ticket_id       text,
  status          text NOT NULL CHECK (status IN ('queued', 'sent', 'failed')),
  attempts        integer NOT NULL,
  last_error      text,
  created_at      timestamptz NOT NULL,
  sent_at         timestamptz,
  next_attempt_at timestamptz NOT NULL
);
CREATE INDEX mail_outbox_status_idx ON mail_outbox (status, ord);
