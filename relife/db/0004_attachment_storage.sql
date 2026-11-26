-- Unggahan lampiran yang belum ditautkan ke tiket/komentar (milik uploader).
-- Byte file disimpan di storage (ATTACHMENT_DIR) dengan key acak; baris attachments lama
-- (seed, key `mock/...`) tetap dirender sebagai "tidak tersedia".
CREATE TABLE attachment_uploads (
  id          TEXT PRIMARY KEY,
  ord         INTEGER NOT NULL,
  uploader_id TEXT NOT NULL REFERENCES users (id) DEFERRABLE INITIALLY DEFERRED,
  file_name   TEXT NOT NULL,
  mime        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  storage_key TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX attachment_uploads_created_idx ON attachment_uploads (created_at);
