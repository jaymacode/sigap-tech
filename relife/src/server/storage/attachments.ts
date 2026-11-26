import { randomBytes } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/**
 * Penyimpanan byte lampiran. Disk lokal di `ATTACHMENT_DIR` (default `data/uploads`).
 * Nama file di disk = key acak (hex), tidak pernah nama asli dari user.
 * shortcut: disk lokal satu instance; ganti modul ini dengan S3/MinIO (save/read/delete sama)
 * bila aplikasi dijalankan lebih dari satu replika.
 */

const KEY_RE = /^[a-f0-9]{32}$/;

function baseDir(): string {
  return resolve(process.env.ATTACHMENT_DIR || join(import.meta.dir, '..', '..', '..', 'data', 'uploads'));
}

function pathFor(key: string): string | null {
  return KEY_RE.test(key) ? join(baseDir(), key) : null;
}

/** Menyimpan byte dan mengembalikan storage key acak. */
export async function saveAttachment(bytes: Uint8Array): Promise<string> {
  const key = randomBytes(16).toString('hex');
  await mkdir(baseDir(), { recursive: true });
  await Bun.write(join(baseDir(), key), bytes);
  return key;
}

/** File untuk di-stream, atau null bila key tidak valid / file tidak ada (mis. data seed). */
export async function readAttachment(key: string): Promise<Blob | null> {
  const path = pathFor(key);
  if (!path) return null;
  const file = Bun.file(path);
  return (await file.exists()) ? file : null;
}

/** Menghapus file (diam bila sudah tidak ada). */
export async function deleteAttachment(key: string): Promise<void> {
  const path = pathFor(key);
  if (path) await rm(path, { force: true });
}

/** true bila key menunjuk ke byte tersimpan (seed lama memakai key `mock/...`). */
export function isStoredKey(key: string): boolean {
  return KEY_RE.test(key);
}
