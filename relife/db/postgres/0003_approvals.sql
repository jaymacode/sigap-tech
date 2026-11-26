-- Rantai persetujuan formulir IT Request: HOD -> Head IT -> Presiden Direktur.
-- Token link email hanya disimpan sebagai hash sha256 (hex).
ALTER TABLE tickets ADD COLUMN action_plan text;
ALTER TABLE tickets ADD COLUMN impact_analysis text;

CREATE TABLE approvals (
  id                 text PRIMARY KEY,
  ord                integer NOT NULL,
  ticket_id          text NOT NULL REFERENCES tickets (id) DEFERRABLE INITIALLY DEFERRED,
  step               text NOT NULL CHECK (step IN ('hod', 'it_hod', 'presdir')),
  status             text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'skipped')),
  approver_name      text NOT NULL,
  approver_email     text,
  decided_by_user_id text REFERENCES users (id) DEFERRABLE INITIALLY DEFERRED,
  note               text NOT NULL,
  token_hash         text UNIQUE,
  expires_at         timestamptz,
  created_at         timestamptz NOT NULL,
  decided_at         timestamptz
);
CREATE INDEX approvals_ticket_idx ON approvals (ticket_id, ord);
