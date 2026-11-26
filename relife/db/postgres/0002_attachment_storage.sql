-- Unggahan lampiran yang belum ditautkan ke tiket/komentar (milik uploader).
CREATE TABLE attachment_uploads (
  id          text PRIMARY KEY,
  ord         integer NOT NULL,
  uploader_id text NOT NULL REFERENCES users (id) DEFERRABLE INITIALLY DEFERRED,
  file_name   text NOT NULL,
  mime        text NOT NULL,
  size        integer NOT NULL,
  storage_key text NOT NULL,
  created_at  timestamptz NOT NULL
);
CREATE INDEX attachment_uploads_created_idx ON attachment_uploads (created_at);
