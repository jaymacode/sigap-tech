import { can, type AuthUser } from '@/server/auth/rbac';
import type { Store } from '@/server/mock/store';
import { EngineError, type AttachmentInput } from '@/server/mock/ticket-engine';
import type { AttachmentRecord, TicketRecord, UploadRecord } from '@/server/mock/types';
import { deleteAttachment, isStoredKey } from '@/server/storage/attachments';

/**
 * Aturan lampiran: allowlist tipe, sanitasi nama, otorisasi unduh, penautan unggahan, dan
 * pembersihan unggahan yatim. Byte file ada di `@/server/storage/attachments`.
 */

/** Batas ukuran per berkas (`ATTACHMENT_MAX_MB`, default 10). */
export function maxAttachmentBytes(): number {
  const mb = Number(process.env.ATTACHMENT_MAX_MB);
  return (Number.isFinite(mb) && mb > 0 ? mb : 10) * 1024 * 1024;
}

/** Unggahan yang tidak ditautkan lebih lama dari ini dihapus oleh worker. */
export const ORPHAN_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const startsWith = (b: Uint8Array, sig: readonly number[], offset = 0): boolean =>
  b.length >= offset + sig.length && sig.every((v, i) => b[offset + i] === v);
const ascii = (s: string): number[] => [...s].map((ch) => ch.charCodeAt(0));

const isZip = (b: Uint8Array): boolean =>
  startsWith(b, [0x50, 0x4b, 0x03, 0x04]) || startsWith(b, [0x50, 0x4b, 0x05, 0x06]);
/** Teks: tidak ada byte NUL di 8 KB pertama. */
const isText = (b: Uint8Array): boolean => !b.subarray(0, 8192).includes(0);

interface FileType {
  mime: string;
  sniff: (bytes: Uint8Array) => boolean;
}

const OOXML = 'application/vnd.openxmlformats-officedocument';
const jpeg: FileType = { mime: 'image/jpeg', sniff: (b) => startsWith(b, [0xff, 0xd8, 0xff]) };

/** Allowlist berdasarkan ekstensi; mime yang disimpan berasal dari sini, bukan dari klien. */
export const ALLOWED_TYPES: Readonly<Record<string, FileType>> = {
  png: { mime: 'image/png', sniff: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  jpg: jpeg,
  jpeg,
  gif: { mime: 'image/gif', sniff: (b) => startsWith(b, ascii('GIF87a')) || startsWith(b, ascii('GIF89a')) },
  webp: { mime: 'image/webp', sniff: (b) => startsWith(b, ascii('RIFF')) && startsWith(b, ascii('WEBP'), 8) },
  pdf: { mime: 'application/pdf', sniff: (b) => startsWith(b, ascii('%PDF-')) },
  txt: { mime: 'text/plain', sniff: isText },
  log: { mime: 'text/plain', sniff: isText },
  csv: { mime: 'text/csv', sniff: isText },
  docx: { mime: `${OOXML}.wordprocessingml.document`, sniff: isZip },
  xlsx: { mime: `${OOXML}.spreadsheetml.sheet`, sniff: isZip },
  pptx: { mime: `${OOXML}.presentationml.presentation`, sniff: isZip },
  zip: { mime: 'application/zip', sniff: isZip },
};

/** Nilai atribut `accept` untuk input file. */
export const ATTACHMENT_ACCEPT = Object.keys(ALLOWED_TYPES)
  .map((ext) => `.${ext}`)
  .join(',');

export function extensionOf(name: string): string {
  const m = /\.([A-Za-z0-9]{1,10})$/.exec(name.trim());
  return m?.[1]?.toLowerCase() ?? '';
}

/**
 * Nama tampilan aman: tanpa path, karakter kontrol/bidi, karakter terlarang Windows; maks 120.
 */
export function sanitizeFileName(raw: string, ext: string): string {
  let name = (raw.split(/[\\/]/).pop() ?? '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069<>:"|?*]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '');
  if (name.length > 120) name = `${name.slice(0, 119 - ext.length).trimEnd()}.${ext}`;
  return name || `lampiran.${ext}`;
}

/** Header Content-Disposition dengan fallback ASCII + RFC 5987 `filename*`. */
export function contentDisposition(name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]|["\\%]/g, '_');
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/** URL unduh, atau null untuk lampiran tanpa file (data seed metadata saja). */
export function attachmentUrl(a: { id: string; storageKey: string }): string | null {
  return isStoredKey(a.storageKey) ? `/api/attachments/${encodeURIComponent(a.id)}` : null;
}

export type FoundAttachment =
  | { kind: 'pending'; record: UploadRecord }
  | { kind: 'linked'; record: AttachmentRecord; ticket: TicketRecord | undefined; internal: boolean };

/** Mencari lampiran tertaut atau unggahan tertunda berdasarkan id. */
export function findAttachment(store: Store, id: string): FoundAttachment | null {
  const pending = store.uploads.get(id);
  if (pending) return { kind: 'pending', record: pending };
  // shortcut: scan linear seluruh lampiran; tambah index id -> ticketId bila jumlahnya besar.
  for (const [ticketId, list] of store.attachments) {
    const record = list.find((a) => a.id === id);
    if (!record) continue;
    const comment = record.commentId
      ? store.comments.get(ticketId)?.find((c) => c.id === record.commentId)
      : undefined;
    return {
      kind: 'linked',
      record,
      ticket: store.tickets.get(ticketId),
      internal: comment?.visibility === 'internal',
    };
  }
  return null;
}

/** Unggahan tertunda: hanya uploader. Tertaut: RBAC baca tiket (+ baca internal untuk catatan internal). */
export function canDownload(user: AuthUser, found: FoundAttachment): boolean {
  if (found.kind === 'pending') return found.record.uploaderId === user.id;
  if (!found.ticket) return false;
  const resource = { requesterId: found.ticket.requesterId, teamId: found.ticket.teamId };
  if (!can(user, 'ticket.read', resource)) return false;
  return !found.internal || can(user, 'ticket.read_internal', resource);
}

/**
 * Mengubah `attachmentIds` menjadi input engine. Tidak mengubah store (engine yang memindahkan
 * unggahan dari `store.uploads` ke `store.attachments`).
 * @throws EngineError bila id tidak ada, bukan milik pemanggil, atau sudah ditautkan
 */
export function claimUploads(store: Store, userId: string, ids: readonly string[]): AttachmentInput[] {
  return [...new Set(ids)].map((id) => {
    const up = store.uploads.get(id);
    if (!up || up.uploaderId !== userId) {
      throw new EngineError('invalid_attachment', 'Lampiran tidak valid atau sudah dipakai; unggah ulang berkas');
    }
    return { id: up.id, fileName: up.fileName, mime: up.mime, size: up.size, storageKey: up.storageKey };
  });
}

/** Menghapus unggahan yang tidak ditautkan > 24 jam (dipanggil dari worker tick). */
export function sweepOrphanUploads(store: Store, now: Date): number {
  let removed = 0;
  for (const [id, up] of store.uploads) {
    if (now.getTime() - up.createdAt.getTime() < ORPHAN_MAX_AGE_MS) continue;
    store.uploads.delete(id);
    deleteAttachment(up.storageKey).catch((err: unknown) => {
      console.error('[attachments] gagal menghapus file yatim', err);
    });
    removed++;
  }
  return removed;
}
