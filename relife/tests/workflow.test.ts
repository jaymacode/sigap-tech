import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { createApp } from '@/index';
import { bootstrapDatabase } from '@/server/db/bootstrap';
import { closeSqlite, getSqlite } from '@/server/db/sqlite';
import { getStore, installDatabaseStore } from '@/server/mock/db';

const app = createApp();

beforeAll(() => {
  closeSqlite();
  process.env.DB_PATH = ':memory:';
  const outcome = bootstrapDatabase(getSqlite());
  installDatabaseStore(outcome.store, outcome.snapshot);
});
afterAll(() => closeSqlite());

const json = { 'content-type': 'application/json' };
async function cookieOf(path: string, body: unknown): Promise<string> {
  const res = await app.request(path, { method: 'POST', headers: json, body: JSON.stringify(body) });
  return res.headers.get('set-cookie')?.split(';')[0] ?? '';
}
const login = (role: string) => cookieOf('/api/auth/demo', { role });
const switchTo = (userId: string) => cookieOf('/api/auth/switch', { userId });
async function post(path: string, cookie: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: 'POST',
    headers: { ...json, cookie },
    body: JSON.stringify(body),
  });
}
async function create(cookie: string, type: string) {
  const res = await post('/api/tickets', cookie, {
    catalogItemId: 'cat-item-pc-server',
    title: `Tiket uji ${type}`,
    description: 'Deskripsi tiket uji alur kerja.',
    urgency: 'medium',
    formData: { service_request_type: type },
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { data: { id: string; number: string } }).data;
}

describe('ticket workflow end-to-end', () => {
  it('runs create → assign → work → pending/resume → resolve → reopen → close', async () => {
    const req = await login('requester');
    const agent = await login('agent');
    const t = await create(req, 'Problem');
    expect(t.number).toMatch(/^INC-/);
    expect((await create(req, 'Access Rights')).number).toMatch(/^REQ-/);

    const store = getStore();
    const rec = store.tickets.get(t.id)!;
    expect(rec.teamId).toBe(store.categories.get(rec.categoryId)!.defaultTeamId ?? null);
    expect(rec.status).toBe('new');

    // new → in_progress is not a valid jump
    expect((await post(`/api/tickets/${t.id}/transition`, agent, { to: 'in_progress' })).status).toBe(400);
    expect((await post(`/api/tickets/${t.id}/assign`, agent, { assigneeId: 'usr-agent' })).status).toBe(200);
    expect(store.tickets.get(t.id)!.status).toBe('assigned');
    expect(
      (await post(`/api/tickets/${t.id}/transition`, agent, { to: 'resolved', resolutionCode: 'fixed', resolutionNotes: 'x' })).status,
    ).toBe(400);
    expect((await post(`/api/tickets/${t.id}/transition`, agent, { to: 'in_progress' })).status).toBe(200);

    // internal note hidden from requester, public reply visible and sets first response
    await post(`/api/tickets/${t.id}/comments`, agent, { body: 'RAHASIA-INTERNAL', visibility: 'internal' });
    await post(`/api/tickets/${t.id}/comments`, agent, { body: 'Balasan-publik-ok', visibility: 'public' });
    expect(store.tickets.get(t.id)!.firstResponseAt).not.toBeNull();
    const html = await (await app.request(`/portal/tickets/${t.number}`, { headers: { cookie: req } })).text();
    expect(html).toContain('Balasan-publik-ok');
    expect(html).not.toContain('RAHASIA-INTERNAL');

    // pending requires reason; requester reply resumes awaiting_user
    expect((await post(`/api/tickets/${t.id}/transition`, agent, { to: 'pending' })).status).toBe(400);
    expect((await post(`/api/tickets/${t.id}/transition`, agent, { to: 'pending', pendingReason: 'awaiting_user' })).status).toBe(200);
    await post(`/api/tickets/${t.id}/comments`, req, { body: 'Ini jawaban saya', visibility: 'public' });
    expect(store.tickets.get(t.id)!.status).toBe('in_progress');

    // resolve needs code + notes; CSAT only after resolved, once
    expect((await post(`/api/tickets/${t.id}/csat`, req, { score: 5, comment: '' })).status).toBe(400);
    expect((await post(`/api/tickets/${t.id}/transition`, agent, { to: 'resolved' })).status).toBe(400);
    expect(
      (await post(`/api/tickets/${t.id}/transition`, agent, { to: 'resolved', resolutionCode: 'fixed', resolutionNotes: 'Sudah beres' })).status,
    ).toBe(200);
    expect((await post(`/api/tickets/${t.id}/csat`, req, { score: 4, comment: 'ok' })).status).toBe(200);
    expect((await post(`/api/tickets/${t.id}/csat`, req, { score: 4, comment: 'ok' })).status).toBe(400);

    // reopen needs reason and bumps reopenCount; agent cannot close
    expect((await post(`/api/tickets/${t.id}/transition`, agent, { to: 'closed' })).status).toBe(403);
    expect((await post(`/api/tickets/${t.id}/transition`, req, { to: 'in_progress' })).status).toBe(400);
    expect((await post(`/api/tickets/${t.id}/transition`, req, { to: 'in_progress', reopenReason: 'Masih error' })).status).toBe(200);
    expect(store.tickets.get(t.id)!.reopenCount).toBe(1);

    // reopen after window rejected; confirm closes; final tickets reject comments
    await post(`/api/tickets/${t.id}/transition`, agent, { to: 'resolved', resolutionCode: 'fixed', resolutionNotes: 'Lagi' });
    store.tickets.get(t.id)!.resolvedAt = new Date(Date.now() - 8 * 86_400_000);
    expect((await post(`/api/tickets/${t.id}/transition`, req, { to: 'in_progress', reopenReason: 'Terlambat' })).status).toBe(400);
    expect((await post(`/api/tickets/${t.id}/transition`, req, { to: 'closed' })).status).toBe(200);
    expect((await post(`/api/tickets/${t.id}/comments`, req, { body: 'halo lagi', visibility: 'public' })).status).toBe(400);
  });

  it('enforces RBAC', async () => {
    const req = await login('requester');
    const other = await switchTo('usr-req-01');
    const agent = await login('agent');
    const lead = await login('lead');
    const member = await switchTo('usr-agent6'); // satu Tim IT: semua anggota boleh mengerjakan
    const t = await create(req, 'Problem'); // Tim IT

    const page = await app.request(`/portal/tickets/${t.number}`, { headers: { cookie: other } });
    expect(page.status).toBe(403);
    expect((await post(`/api/tickets/${t.id}/comments`, other, { body: 'intip', visibility: 'public' })).status).toBe(403);
    expect((await post(`/api/tickets/${t.id}/comments`, req, { body: 'rahasia', visibility: 'internal' })).status).toBe(403);
    expect((await post(`/api/tickets/${t.id}/transition`, req, { to: 'assigned', assigneeId: 'usr-agent' })).status).toBe(403);
    expect((await post(`/api/tickets/${t.id}/transition`, req, { to: 'cancelled', cancellationReason: 'batal' })).status).toBe(403);

    // any Tim IT member may work the ticket, but an agent cannot assign others
    expect((await post(`/api/tickets/${t.id}/comments`, member, { body: 'catatan anggota', visibility: 'internal' })).status).toBe(200);
    expect((await post(`/api/tickets/${t.id}/transition`, agent, { to: 'assigned', assigneeId: 'usr-agent2' })).status).toBe(403);

    // priority: agent 403, lead ok
    expect((await post(`/api/tickets/${t.id}/priority`, agent, { priority: 'P1', reason: 'alasan cukup panjang' })).status).toBe(403);
    expect((await post(`/api/tickets/${t.id}/priority`, lead, { priority: 'P1', reason: 'alasan cukup panjang' })).status).toBe(200);

    // releasing an assigned ticket returns it to new
    await post(`/api/tickets/${t.id}/assign`, agent, { assigneeId: 'usr-agent' });
    expect(getStore().tickets.get(t.id)!.status).toBe('assigned');
    await post(`/api/tickets/${t.id}/assign`, agent, { assigneeId: null });
    expect(getStore().tickets.get(t.id)!.status).toBe('new');
    expect((await post('/api/tickets/bulk-assign', agent, { ticketIds: [t.id], assigneeId: 'usr-agent2' })).status).toBe(403);

    // cancel needs reason; then final
    expect((await post(`/api/tickets/${t.id}/transition`, agent, { to: 'cancelled' })).status).toBe(400);
    expect((await post(`/api/tickets/${t.id}/transition`, agent, { to: 'cancelled', cancellationReason: 'Duplikat tiket' })).status).toBe(200);
    expect((await post(`/api/tickets/${t.id}/transition`, agent, { to: 'new' })).status).toBe(400);
  });

  it('agent detail page offers only valid actions', async () => {
    const req = await login('requester');
    const agent = await login('agent');
    const t = await create(req, 'Problem');
    const detail = async () =>
      (await app.request(`/tickets/${t.number}`, { headers: { cookie: agent } })).text();
    let h = await detail();
    expect(h).not.toContain('Mulai Kerjakan');
    expect(h).not.toContain('data-open-dialog="dlg-resolve"');
    await post(`/api/tickets/${t.id}/assign`, agent, { assigneeId: 'usr-agent' });
    h = await detail();
    expect(h).toContain('Mulai Kerjakan');
    expect(h).not.toContain('data-open-dialog="dlg-resolve"');
    await post(`/api/tickets/${t.id}/transition`, agent, { to: 'in_progress' });
    h = await detail();
    expect(h).toContain('data-open-dialog="dlg-resolve"');
    expect(h).not.toContain('Mulai Kerjakan');
  });
});
