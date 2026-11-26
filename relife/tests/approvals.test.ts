import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { apiRoutes } from '@/routes/api';
import { approvalRoutes } from '@/routes/approvals';
import { authRoutes } from '@/routes/auth';
import pageRoutes from '@/routes/pages';
import { bootstrapDatabase } from '@/server/db/bootstrap';
import { closeSqlite, getSqlite } from '@/server/db/sqlite';
import { getStore, installDatabaseStore } from '@/server/mock/db';

const app = new Hono();
app.route('/api/auth', authRoutes);
app.route('/', approvalRoutes);
app.route('/api', apiRoutes);
app.route('/', pageRoutes);

type Role = 'requester' | 'agent' | 'lead' | 'admin';
const cookies = {} as Record<Role, string>;

async function login(role: Role): Promise<string> {
  const res = await app.request('/api/auth/demo', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ role }),
  });
  expect(res.status).toBe(200);
  return (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
}

function post(path: string, role: Role, body: unknown = {}): Promise<Response> {
  return Promise.resolve(
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookies[role] },
      body: JSON.stringify(body),
    }),
  );
}

function postForm(path: string, fields: Record<string, string>): Promise<Response> {
  return Promise.resolve(
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(),
    }),
  );
}

async function createRequest(formData: Record<string, string>, title = 'Permintaan modul laporan baru'): Promise<string> {
  const res = await post('/api/tickets', 'requester', {
    catalogItemId: 'cat-item-pc-server',
    title,
    description: 'Mohon dibuatkan modul laporan stok untuk divisi gudang.',
    urgency: 'medium',
    formData: { hod_name: 'Bapak Hartono', ...formData },
  });
  expect(res.status).toBe(201);
  const id = ((await res.json()) as { data: { id: string } }).data.id;
  // Pastikan ditugaskan ke agent demo (auto-assign bisa nonaktif).
  const store = getStore();
  if (!store.tickets.get(id)?.assigneeId) {
    expect((await post(`/api/tickets/${id}/assign`, 'lead', { assigneeId: 'usr-agent' })).status).toBe(200);
  }
  return id;
}

function tokenFor(ticketId: string, to: string): string {
  const mail = [...getStore().mailOutbox].reverse().find((m) => m.ticketId === ticketId && m.toEmail === to);
  const token = mail?.text.match(/\/approve\/([A-Za-z0-9_-]+)/)?.[1];
  if (!token) throw new Error('approval link not found');
  return token;
}

const rows = (ticketId: string) => getStore().approvals.filter((a) => a.ticketId === ticketId);
const sla = (ticketId: string) => getStore().sla.get(ticketId)!;
const start = (id: string) => post(`/api/tickets/${id}/transition`, 'agent', { to: 'in_progress' });
const IT_PART = { actionPlan: 'Bangun modul laporan stok', impactAnalysis: 'Tidak ada downtime; risiko rendah' };

describe('Approval chain', () => {
  beforeAll(async () => {
    process.env.DB_PATH = ':memory:';
    delete process.env.MAIL_ENABLED;
    delete process.env.PRESDIR_EMAIL;
    closeSqlite();
    const { store, snapshot } = bootstrapDatabase(getSqlite());
    installDatabaseStore(store, snapshot);
    for (const r of ['requester', 'agent', 'lead', 'admin'] as const) cookies[r] = await login(r);
  });

  afterAll(() => {
    delete process.env.PRESDIR_EMAIL;
  });

  it('HOD email → pending + mail + SLA paused; token approve resumes; token single-use; IT HOD gate', async () => {
    const id = await createRequest({ service_request_type: 'Enhancement', hod_email: 'hartono@ctii.test' });
    const [hod] = rows(id);
    expect(hod?.step).toBe('hod');
    expect(hod?.status).toBe('pending');
    expect(hod?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(sla(id).response.status).toBe('paused');
    expect(sla(id).resolution.status).toBe('paused');
    const token = tokenFor(id, 'hartono@ctii.test');
    expect(hod?.tokenHash).not.toContain(token);

    expect((await start(id)).status).toBe(400); // approval_pending

    const page = await app.request(`/approve/${token}`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Setujui');
    const done = await postForm(`/approve/${token}`, { decision: 'approve', note: 'OK' });
    expect(done.status).toBe(200);
    expect(rows(id)[0]?.status).toBe('approved');
    expect(sla(id).resolution.status).toBe('running');
    expect(sla(id).response.status).toBe('running');

    // Reuse → invalid
    expect((await app.request(`/approve/${token}`)).status).toBe(404);
    expect((await postForm(`/approve/${token}`, { decision: 'reject', note: 'telat' })).status).toBe(404);

    // Enhancement wajib IT HOD
    const blocked = await start(id);
    expect(blocked.status).toBe(400);
    expect(((await blocked.json()) as { code: string }).code).toBe('it_hod_required');
    expect((await post(`/api/tickets/${id}/approvals/it-hod`, 'agent')).status).toBe(400); // IT part kosong
    expect((await post(`/api/tickets/${id}/it-part`, 'agent', IT_PART)).status).toBe(200);
    expect((await post(`/api/tickets/${id}/approvals/it-hod`, 'agent')).status).toBe(200);
    const itHod = rows(id).find((a) => a.step === 'it_hod')!;
    expect(itHod.status).toBe('pending');
    expect(sla(id).resolution.status).toBe('running'); // internal step tidak menjeda SLA
    expect((await post(`/api/tickets/${id}/it-part`, 'agent', IT_PART)).status).toBe(400); // terkunci

    // Agent tidak boleh menyetujui
    expect((await post(`/api/approvals/${itHod.id}/decide`, 'agent', { decision: 'approve' })).status).toBe(403);
    expect((await post(`/api/approvals/${itHod.id}/decide`, 'lead', { decision: 'approve' })).status).toBe(200);
    expect((await start(id)).status).toBe(200);

    const types = (getStore().events.get(id) ?? []).map((e) => e.type);
    expect(types).toContain('approval_requested');
    expect(types).toContain('approval_approved');
  });

  it('expired token is rejected', async () => {
    const id = await createRequest({ service_request_type: 'New Request', hod_email: 'hod2@ctii.test' });
    const token = tokenFor(id, 'hod2@ctii.test');
    rows(id)[0]!.expiresAt = new Date(Date.now() - 1000);
    expect((await app.request(`/approve/${token}`)).status).toBe(410);
    expect((await postForm(`/approve/${token}`, { decision: 'approve' })).status).toBe(410);
    expect(rows(id)[0]?.status).toBe('pending');
  });

  it('HOD reject → ticket cancelled with reason, requester notified', async () => {
    const id = await createRequest({ service_request_type: 'Access Rights', hod_email: 'hod3@ctii.test' });
    const token = tokenFor(id, 'hod3@ctii.test');
    expect((await postForm(`/approve/${token}`, { decision: 'reject', note: '' })).status).toBe(400);
    expect((await postForm(`/approve/${token}`, { decision: 'reject', note: 'Tidak sesuai anggaran' })).status).toBe(200);
    const store = getStore();
    const t = store.tickets.get(id)!;
    expect(t.status).toBe('cancelled');
    const cancel = (store.events.get(id) ?? []).find((e) => e.type === 'status_changed' && e.data.to === 'cancelled');
    expect(String(cancel?.data.reason)).toContain('Tidak sesuai anggaran');
    expect(store.notifications.some((n) => n.userId === t.requesterId && n.ticketId === id)).toBe(true);
  });

  it('manual HOD record + optional Presdir path', async () => {
    process.env.PRESDIR_EMAIL = 'presdir@ctii.test';
    const id = await createRequest({ service_request_type: 'Data Extraction' });
    const hod = rows(id)[0]!;
    expect(hod.status).toBe('pending');
    expect(hod.tokenHash).toBeNull();
    expect(sla(id).resolution.status).toBe('paused');
    // catatan wajib
    expect((await post(`/api/approvals/${hod.id}/manual`, 'agent', { decision: 'approve', channel: 'telepon', note: '' })).status).toBe(400);
    expect((await post(`/api/approvals/${hod.id}/manual`, 'agent', { decision: 'approve', channel: 'telepon', note: 'Disetujui lisan' })).status).toBe(200);
    expect(rows(id)[0]?.note).toContain('Dicatat manual: dikonfirmasi via telepon');

    await post(`/api/tickets/${id}/it-part`, 'agent', IT_PART);
    await post(`/api/tickets/${id}/approvals/it-hod`, 'agent');
    const itHod = rows(id).find((a) => a.step === 'it_hod')!;
    expect((await post(`/api/approvals/${itHod.id}/decide`, 'admin', { decision: 'approve', presdirRequired: true })).status).toBe(200);
    const presdir = rows(id).find((a) => a.step === 'presdir')!;
    expect(presdir.status).toBe('pending');
    expect(sla(id).resolution.status).toBe('paused');
    expect((await start(id)).status).toBe(400);

    const token = tokenFor(id, 'presdir@ctii.test');
    expect((await postForm(`/approve/${token}`, { decision: 'approve' })).status).toBe(200);
    expect(sla(id).resolution.status).toBe('running');
    expect((await start(id)).status).toBe(200);
  });

  it('incident (Problem) is not blocked; HOD recorded as information', async () => {
    const before = getStore().mailOutbox.length;
    const id = await createRequest({ service_request_type: 'Problem', hod_email: 'hod4@ctii.test' }, 'Laptop mati total pagi ini');
    const [hod] = rows(id);
    expect(hod?.status).toBe('skipped');
    expect(getStore().mailOutbox.slice(before).some((m) => m.toEmail === 'hod4@ctii.test')).toBe(false);
    expect(sla(id).resolution.status).toBe('running');
    expect((await start(id)).status).toBe(200);
  });
});

describe('Approval UI', () => {
  it('shows actions only to allowed roles and the chain on the portal', async () => {
    const id = await createRequest({ service_request_type: 'Enhancement' });
    const hod = rows(id)[0]!;
    await post(`/api/approvals/${hod.id}/manual`, 'agent', { decision: 'approve', channel: 'WhatsApp', note: 'OK via WA' });
    await post(`/api/tickets/${id}/it-part`, 'agent', IT_PART);
    await post(`/api/tickets/${id}/approvals/it-hod`, 'agent');
    const number = getStore().tickets.get(id)!.number;
    const page = async (path: string, role: Role) =>
      (await app.request(path, { headers: { cookie: cookies[role] } })).text();

    const lead = await page(`/tickets/${number}`, 'lead');
    expect(lead).toContain('Setujui / Tolak (Head IT)');
    const agent = await page(`/tickets/${number}`, 'agent');
    expect(agent).toContain('Approval by IT HOD');
    expect(agent).not.toContain('Setujui / Tolak (Head IT)');
    expect(agent).not.toContain('Start Progress');
    const portal = await page(`/portal/tickets/${number}`, 'requester');
    expect(portal).toContain('Acknowledge by HOD');
    expect(portal).toContain('Dicatat manual');
    const queue = await page('/queue?view=approval', 'lead');
    expect(queue).toContain(number);
  });
});

afterAll(() => {
  closeSqlite();
});
