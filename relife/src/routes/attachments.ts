import { Hono, type Context } from 'hono';
import { DB_ERROR_RESULT, persistOrFail } from '@/server/actions/persist';
import {
  ALLOWED_TYPES,
  canDownload,
  contentDisposition,
  extensionOf,
  findAttachment,
  maxAttachmentBytes,
  sanitizeFileName,
} from '@/server/attachments';
import { requireApiUser } from '@/server/auth/session';
import { getStore } from '@/server/mock/db';
import { nextId } from '@/server/mock/store';
import type { UploadRecord } from '@/server/mock/types';
import { deleteAttachment, readAttachment, saveAttachment } from '@/server/storage/attachments';

/** Lampiran: unggah (tertunda sampai ditautkan lewat `attachmentIds`), unduh, batalkan unggahan. */
export const attachmentRoutes = new Hono();

function notFound(c: Context, message: string): Response {
  if ((c.req.header('accept') ?? '').includes('text/html')) {
    return c.html(
      `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Lampiran tidak tersedia — Sigap</title></head><body><h1>Lampiran tidak tersedia</h1><p>${message}</p><p><a href="/">Kembali ke beranda</a></p></body></html>`,
      404,
    );
  }
  return c.json({ ok: false, error: message }, 404);
}

attachmentRoutes.post('/', async (c) => {
  const session = requireApiUser(c);
  if (session instanceof Response) return session;

  const max = maxAttachmentBytes();
  const tooLarge = `Ukuran lampiran maksimal ${Math.round(max / 1024 / 1024)} MB`;
  // Tolak lebih awal sebelum membaca body besar (64 KB kelonggaran untuk overhead multipart).
  if (Number(c.req.header('content-length') ?? 0) > max + 64 * 1024) {
    return c.json({ ok: false, error: tooLarge }, 413);
  }
  const form = await c.req.formData().catch(() => null);
  const files = form?.getAll('file') ?? [];
  const file = files[0];
  if (files.length !== 1 || !(file instanceof File)) {
    return c.json({ ok: false, error: 'Kirim tepat satu berkas pada field "file"' }, 400);
  }
  if (file.size === 0) return c.json({ ok: false, error: 'Berkas kosong' }, 400);
  if (file.size > max) return c.json({ ok: false, error: tooLarge }, 413);

  const ext = extensionOf(file.name);
  const type = ALLOWED_TYPES[ext];
  if (!type) {
    return c.json(
      { ok: false, error: 'Jenis berkas tidak diizinkan (gambar, PDF, teks/CSV/log, Office, ZIP)' },
      415,
    );
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!type.sniff(bytes)) {
    return c.json({ ok: false, error: 'Isi berkas tidak sesuai dengan ekstensinya' }, 415);
  }

  const storageKey = await saveAttachment(bytes);
  const store = getStore();
  const record: UploadRecord = {
    id: nextId(store, 'att'),
    uploaderId: session.id,
    fileName: sanitizeFileName(file.name, ext),
    mime: type.mime,
    size: bytes.byteLength,
    storageKey,
    createdAt: new Date(),
  };
  store.uploads.set(record.id, record);
  if (!(await persistOrFail())) {
    await deleteAttachment(storageKey);
    return c.json(DB_ERROR_RESULT, 500);
  }
  const { id, fileName, size, mime } = record;
  return c.json({ ok: true, data: { id, fileName, size, mime } }, 201);
});

attachmentRoutes.get('/:id', async (c) => {
  const session = requireApiUser(c);
  if (session instanceof Response) return session;
  const found = findAttachment(getStore(), c.req.param('id'));
  // Tanpa izin = 404 juga, agar id lampiran orang lain tidak bisa ditebak.
  if (!found || !canDownload(session, found)) return notFound(c, 'Lampiran tidak ditemukan.');

  const blob = await readAttachment(found.record.storageKey);
  if (!blob) {
    return notFound(c, 'Berkas lampiran ini tidak tersimpan di server (data contoh/lama tanpa file).');
  }
  const { mime, fileName } = found.record;
  return new Response(blob, {
    headers: {
      'Content-Type': mime.startsWith('text/') ? `${mime}; charset=utf-8` : mime,
      'Content-Length': String(blob.size),
      'Content-Disposition': contentDisposition(fileName),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, no-store',
    },
  });
});

/** Membatalkan unggahan yang belum ditautkan (tombol hapus chip). */
attachmentRoutes.delete('/:id', async (c) => {
  const session = requireApiUser(c);
  if (session instanceof Response) return session;
  const store = getStore();
  const up = store.uploads.get(c.req.param('id'));
  if (!up || up.uploaderId !== session.id) return c.json({ ok: false, error: 'Lampiran tidak ditemukan' }, 404);
  store.uploads.delete(up.id);
  if (!(await persistOrFail())) return c.json(DB_ERROR_RESULT, 500);
  await deleteAttachment(up.storageKey);
  return c.json({ ok: true, data: true });
});
