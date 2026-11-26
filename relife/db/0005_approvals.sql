-- Rantai persetujuan formulir IT Request: HOD -> Head IT -> Presiden Direktur.
-- Token link email hanya disimpan sebagai hash sha256 (hex).
ALTER TABLE tickets ADD COLUMN action_plan TEXT;
ALTER TABLE tickets ADD COLUMN impact_analysis TEXT;

CREATE TABLE approvals (
  id                 TEXT PRIMARY KEY,
  ord                INTEGER NOT NULL,
  ticket_id          TEXT NOT NULL REFERENCES tickets (id) DEFERRABLE INITIALLY DEFERRED,
  step               TEXT NOT NULL CHECK (step IN ('hod', 'it_hod', 'presdir')),
  status             TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'skipped')),
  approver_name      TEXT NOT NULL,
  approver_email     TEXT,
  decided_by_user_id TEXT REFERENCES users (id) DEFERRABLE INITIALLY DEFERRED,
  note               TEXT NOT NULL,
  token_hash         TEXT UNIQUE,
  expires_at         TEXT,
  created_at         TEXT NOT NULL,
  decided_at         TEXT
);
CREATE INDEX approvals_ticket_idx ON approvals (ticket_id, ord);
