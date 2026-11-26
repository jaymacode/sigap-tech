import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { apiRoutes } from '@/routes/api';
import { authRoutes } from '@/routes/auth';
import { sanitizeFileName, sweepOrphanUploads } from '@/server/attachments';
import { SESSION_COOKIE, signSessionValue, toSessionUser } from '@/server/auth/session';
import { bootstrapDatabase } from '@/server/db/bootstrap';
import { closeSqlite, getSqlite } from '@/server/db/sqlite';
import { getStore, installDatabaseStore } from '@/server/mock/db';
import { getTicketDetail } from '@/server/queries/tickets';

const app = new Hono();
app.route('/api/auth', authRoutes);
app.route('/api', apiRoutes);

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
let dir = '';

function cookieFor(userId: string): string {
  return `${SESSION_COOKIE}=${signSessionValue(userId)}`;
}

function userOfRole(role: string, skip = 0): string {
  return [...getStore().users.values()].filter((u) => u.role === role && u.isActive)[skip]!.id;
}

async function upload(cookie: string, name: string, bytes: Uint8Array<ArrayBuffer> | string): Promise<Response> {
  const body = new FormData();
  body.append('file', new File([bytes], name));
  return app.request('/api/attachments', { method: 'POST', body, headers: { cookie } });
}

async function uploadId(cookie: string, name = 'screenshot.png', bytes: Uint8Array<ArrayBuffer> | string = PNG) {
  const res = await upload(cookie, name, bytes);
  expect(res.status).toBe(201);
  return ((await res.json()) as { data: { id: string; fileName: string } }).data;
}

async function json(path: string, body: unknown, cookie: string): Promise<Response> {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  });
}

async function createTicket(cookie: string, attachmentIds: string[]): Promise<Response> {
  return json(
    '/api/tickets',
    {
      catalogItemId: 'cat-item-pc-server',
      title: 'Uji lampiran tiket',
      description: 'Deskripsi cukup panjang untuk uji lampiran.',
      urgency: 'low',
      attachmentIds,
    },
    cookie,
  );
}

describe('attachments', () => {
  let requester = '';
  let other = '';
  let agent = '';

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'sigap-att-'));
    process.env.ATTACHMENT_DIR = dir;
    process.env.DB_PATH = ':memory:';
    closeSqlite();
    const { store, snapshot } = bootstrapDatabase(getSqlite());
    installDatabaseStore(store, snapshot);
    requester = cookieFor(userOfRole('requester'));
    other = cookieFor(userOfRole('requester', 1));
    agent = cookieFor('usr-lead');
  });

  afterAll(() => {
    closeSqlite();
    delete process.env.ATTACHMENT_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it('requires auth', async () => {
    const body = new FormData();
    body.append('file', new File([PNG], 'a.png'));
    const res = await app.request('/api/attachments', { method: 'POST', body });
    expect(res.status).toBe(401);
  });

  it('uploads a valid file and sanitizes the display name', async () => {
    const res = await upload(requester, '..\\..\\evil<script>‮.png', PNG);
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as { data: { id: string; fileName: string; size: number; mime: string } };
    expect(data).toEqual({ id: data.id, fileName: 'evilscript.png', size: PNG.length, mime: 'image/png' });
    const stored = getStore().uploads.get(data.id)!;
    expect(stored.storageKey).toMatch(/^[a-f0-9]{32}$/);
    expect(sanitizeFileName('a/b/ .hidden.txt ', 'txt')).toBe('hidden.txt');
  });

  it('rejects too-large files', async () => {
    process.env.ATTACHMENT_MAX_MB = '0.001'; // ~1 KB
    try {
      const res = await upload(requester, 'big.txt', 'x'.repeat(4096));
      expect(res.status).toBe(413);
    } finally {
      delete process.env.ATTACHMENT_MAX_MB;
    }
  });

  it('rejects disallowed types and mismatched magic bytes', async () => {
    expect((await upload(requester, 'setup.exe', 'MZ...')).status).toBe(415);
    expect((await upload(requester, 'fake.png', 'not really a png')).status).toBe(415);
    expect((await upload(requester, 'fake.pdf', PNG)).status).toBe(415);
    expect((await upload(requester, 'notes.txt', 'halo\nsigap')).status).toBe(201);
  });

  it('links uploads on ticket create and comment; rejects foreign or reused ids', async () => {
    const mine = await uploadId(requester);
    const foreign = await uploadId(other);

    expect((await createTicket(requester, [foreign.id])).status).toBe(400);

    const res = await createTicket(requester, [mine.id]);
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as { data: { id: string; number: string } };
    const store = getStore();
    expect(store.uploads.has(mine.id)).toBe(false);
    expect(store.attachments.get(data.id)?.map((a) => a.id)).toEqual([mine.id]);

    // Already linked -> cannot be linked again.
    expect((await createTicket(requester, [mine.id])).status).toBe(400);

    const second = await uploadId(requester, 'log.txt', 'baris log');
    const cRes = await json(
      `/api/tickets/${data.id}/comments`,
      { body: 'Tambahan log', visibility: 'public', attachmentIds: [second.id] },
      requester,
    );
    expect(cRes.status).toBe(200);
    const linked = store.attachments.get(data.id)!.find((a) => a.id === second.id)!;
    expect(linked.commentId).not.toBeNull();

    const user = toSessionUser(store, store.users.get(userOfRole('requester'))!);
    const detail = getTicketDetail(store, user, data.number);
    expect(detail.kind).toBe('ok');
    if (detail.kind === 'ok') {
      expect(detail.detail.attachments[0]?.url).toBe(`/api/attachments/${mine.id}`);
    }
  });

  it('enforces download authorization and sets safe headers', async () => {
    const up = await uploadId(requester, 'laporan ü.pdf', '%PDF-1.4 test');
    const res = await createTicket(requester, [up.id]);
    const created = ((await res.json()) as { data: { id: string; number: string } }).data;
    const ticketId = created.id;

    const dl = await app.request(`/api/attachments/${up.id}`, { headers: { cookie: requester } });
    expect(dl.status).toBe(200);
    expect(dl.headers.get('content-type')).toBe('application/pdf');
    expect(dl.headers.get('x-content-type-options')).toBe('nosniff');
    expect(dl.headers.get('content-disposition')).toBe(
      `attachment; filename="laporan _.pdf"; filename*=UTF-8''laporan%20%C3%BC.pdf`,
    );
    expect(await dl.text()).toBe('%PDF-1.4 test');

    // Another requester: 404 (no existence leak). Staff: allowed.
    expect((await app.request(`/api/attachments/${up.id}`, { headers: { cookie: other } })).status).toBe(404);
    expect((await app.request(`/api/attachments/${up.id}`, { headers: { cookie: agent } })).status).toBe(200);

    // Internal-note attachment: staff only, even for the ticket's own requester.
    const note = await uploadId(agent, 'internal.txt', 'rahasia');
    const nRes = await json(
      `/api/tickets/${ticketId}/comments`,
      { body: 'Catatan internal', visibility: 'internal', attachmentIds: [note.id] },
      agent,
    );
    expect(nRes.status).toBe(200);
    expect((await app.request(`/api/attachments/${note.id}`, { headers: { cookie: requester } })).status).toBe(404);
    expect((await app.request(`/api/attachments/${note.id}`, { headers: { cookie: agent } })).status).toBe(200);
    const store = getStore();
    const user = toSessionUser(store, store.users.get(userOfRole('requester'))!);
    const detail = getTicketDetail(store, user, created.number);
    if (detail.kind === 'ok') expect(detail.detail.attachments.map((a) => a.id)).not.toContain(note.id);

    // Pending upload: only the uploader.
    const pending = await uploadId(requester);
    expect((await app.request(`/api/attachments/${pending.id}`, { headers: { cookie: agent } })).status).toBe(404);
    expect((await app.request(`/api/attachments/${pending.id}`, { headers: { cookie: requester } })).status).toBe(200);

    expect((await app.request('/api/attachments/att-nope', { headers: { cookie: agent } })).status).toBe(404);
  });

  it('metadata-only seed attachments render as unavailable and 404 with a friendly message', async () => {
    const store = getStore();
    const seeded = [...store.attachments.values()].flat().find((a) => a.storageKey.startsWith('mock/'));
    expect(seeded).toBeDefined();
    const res = await app.request(`/api/attachments/${seeded!.id}`, {
      headers: { cookie: agent, accept: 'text/html' },
    });
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('tidak tersimpan di server');
  });

  it('removes pending uploads on delete and sweeps orphans older than 24h', async () => {
    const a = await uploadId(requester);
    expect((await app.request(`/api/attachments/${a.id}`, { method: 'DELETE', headers: { cookie: other } })).status).toBe(404);
    expect((await app.request(`/api/attachments/${a.id}`, { method: 'DELETE', headers: { cookie: requester } })).status).toBe(200);
    expect(getStore().uploads.has(a.id)).toBe(false);

    const b = await uploadId(requester);
    const store = getStore();
    const later = new Date(store.uploads.get(b.id)!.createdAt.getTime() + 25 * 60 * 60 * 1000);
    expect(sweepOrphanUploads(store, later)).toBeGreaterThan(0);
    expect(store.uploads.has(b.id)).toBe(false);
  });
});
