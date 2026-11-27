import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { apiRoutes } from '@/routes/api';
import { authRoutes } from '@/routes/auth';
import { bootstrapDatabase } from '@/server/db/bootstrap';
import { closeSqlite, getSqlite } from '@/server/db/sqlite';
import { toSessionUser } from '@/server/auth/session';
import { getTicketDetail } from '@/server/queries/tickets';
import { getStore,installDatabaseStore } from '@/server/mock/db';
import { createTicket as engineCreateTicket } from '@/server/mock/ticket-engine';

const app = new Hono();
app.route('/api/auth', authRoutes);
app.route('/api', apiRoutes);

function cookieFrom(res: Response): string {
  const setCookie = res.headers.get('set-cookie') ?? '';
  const pair = setCookie.split(';')[0] ?? '';
  if (!pair) throw new Error('Missing Set-Cookie header');
  return pair;
}

async function loginAs(role: 'requester' | 'agent' | 'lead' | 'admin'): Promise<string> {
  const res = await app.request('/api/auth/demo', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ role }),
  });
  expect(res.status).toBe(200);
  const json = (await res.json()) as { ok: boolean; data: { redirect: string } };
  expect(json.ok).toBe(true);
  return cookieFrom(res);
}

async function jsonReq(
  path: string,
  method: string,
  body?: unknown,
  cookie?: string,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...extraHeaders,
  };
  if (cookie) headers.cookie = cookie;
  return await app.request(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('Relife API routes', () => {
  beforeAll(() => {
    process.env.DB_PATH = ':memory:';
    closeSqlite();
    const db = getSqlite();
    const { store, snapshot } = bootstrapDatabase(db);
    installDatabaseStore(store, snapshot);
  });

  afterAll(() => {
    closeSqlite();
  });

  it('health endpoint reports healthy store', async () => {
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      db: string;
      database: { enabled: boolean; ok?: boolean };
      uptime_seconds: number;
      worker_last_tick: string | null;
    };
    expect(body.status).toBe('healthy');
    expect(body.db).toBe('ready');
    expect(body.database.enabled).toBe(true);
    expect(body.database.ok).toBe(true);
    expect(typeof body.uptime_seconds).toBe('number');
  });

  it('requires auth for /api/search and returns hits when logged in', async () => {
    const unauth = await app.request('/api/search?q=VPN');
    expect(unauth.status).toBe(401);
    const unauthBody = (await unauth.json()) as { hits: unknown[] };
    expect(unauthBody.hits).toEqual([]);

    const agentCookie = await loginAs('agent');
    const authRes = await app.request('/api/search?q=VPN', {
      headers: { cookie: agentCookie },
    });
    expect(authRes.status).toBe(200);
    const authBody = (await authRes.json()) as { hits: Array<{ number: string }> };
    expect(authBody.hits.length).toBeGreaterThan(0);
  });

  it('supports ticket lifecycle, ADR-008 assignment, priority override, and CSAT', async () => {
    const reqCookie = await loginAs('requester');
    const agentCookie = await loginAs('agent');
    const leadCookie = await loginAs('lead');

    // 1. Requester creates ticket in Service Desk L1 (autoAssign=false, so assigneeId=null)
    const createRes = await jsonReq(
      '/api/tickets',
      'POST',
      {
        catalogItemId: 'cat-item-pc-server',
        title: 'Laptop sangat lambat saat buka Core System',
        description: 'Setiap buka aplikasi Core System CPU langsung 100% dan macet.',
        urgency: 'medium',
        formData: { service_request_type: 'Problem' },
      },
      reqCookie,
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as {
      ok: boolean;
      data: { id: string; number: string };
    };
    expect(created.ok).toBe(true);
    expect(created.data.number).toMatch(/^INC-/);
    const ticketId = created.data.id;

    // 1b. Selecting Access Rights on the same catalog item generates a REQ- service request
    const accessReqRes = await jsonReq(
      '/api/tickets',
      'POST',
      {
        catalogItemId: 'cat-item-pc-server',
        title: 'Permintaan hak akses admin lokal PC lab',
        description: 'Membutuhkan akses instalasi tool audit pada PC khusus.',
        urgency: 'low',
        formData: { service_request_type: 'Access Rights' },
      },
      reqCookie,
    );
    expect(accessReqRes.status).toBe(201);
    const accessReq = (await accessReqRes.json()) as {
      ok: boolean;
      data: { id: string; number: string };
    };
    expect(accessReq.data.number).toMatch(/^REQ-/);

    // 2. Requester cannot write internal note
    const badNote = await jsonReq(
      `/api/tickets/${ticketId}/comments`,
      'POST',
      { body: 'Catatan rahasia', visibility: 'internal' },
      reqCookie,
    );
    expect(badNote.status).toBe(403);

    // 3. ADR-008: Agent cannot assign unassigned ticket to another agent
    const stealAttempt = await jsonReq(
      `/api/tickets/${ticketId}/assign`,
      'POST',
      { assigneeId: 'usr-agent2' },
      agentCookie,
    );
    expect(stealAttempt.status).toBe(403);

    // 4. ADR-008: Agent claims unassigned ticket for self
    const claimRes = await jsonReq(
      `/api/tickets/${ticketId}/assign`,
      'POST',
      { assigneeId: 'usr-agent' },
      agentCookie,
    );
    expect(claimRes.status).toBe(200);

    // 5. ADR-008: Another agent (usr-agent2) cannot steal usr-agent's ticket
    const switchRes = await jsonReq('/api/auth/switch', 'POST', { userId: 'usr-agent2' });
    expect(switchRes.status).toBe(200);
    const agent2Cookie = cookieFrom(switchRes);

    const stealOwned = await jsonReq(
      `/api/tickets/${ticketId}/assign`,
      'POST',
      { assigneeId: 'usr-agent2' },
      agent2Cookie,
    );
    expect(stealOwned.status).toBe(403);

    // 6. Agent cannot override priority; Lead can
    const agentOverride = await jsonReq(
      `/api/tickets/${ticketId}/priority`,
      'POST',
      { priority: 'P1', reason: 'VIP user needs urgent fix today' },
      agentCookie,
    );
    expect(agentOverride.status).toBe(403);

    const leadOverride = await jsonReq(
      `/api/tickets/${ticketId}/priority`,
      'POST',
      { priority: 'P2', reason: 'Berdampak ke penutupan buku keuangan bulan ini' },
      leadCookie,
    );
    expect(leadOverride.status).toBe(200);

    // 7. Agent comments publicly, transitions assigned -> in_progress -> resolved
    const cmtRes = await jsonReq(
      `/api/tickets/${ticketId}/comments`,
      'POST',
      { body: 'Sedang kami cek penggunaan memorinya ya.', visibility: 'public' },
      agentCookie,
    );
    expect(cmtRes.status).toBe(200);

    const startRes = await jsonReq(
      `/api/tickets/${ticketId}/transition`,
      'POST',
      { to: 'in_progress' },
      agentCookie,
    );
    expect(startRes.status).toBe(200);

    const resolveRes = await jsonReq(
      `/api/tickets/${ticketId}/transition`,
      'POST',
      {
        to: 'resolved',
        resolutionCode: 'fixed',
        resolutionNotes: 'Menutup service sync yang bocor memori dan restart.',
      },
      agentCookie,
    );
    expect(resolveRes.status).toBe(200);

    // 8. Requester submits CSAT
    const csatRes = await jsonReq(
      `/api/tickets/${ticketId}/csat`,
      'POST',
      { score: 5, comment: 'Cepat dan ramah' },
      reqCookie,
    );
    expect(csatRes.status).toBe(200);
  });

  it('validates IT request form extras on ticket creation', async () => {
    const reqCookie = await loginAs('requester');
    const base = {
      catalogItemId: 'cat-item-pc-server',
      title: 'Permintaan layanan uji validasi',
      description: 'Deskripsi cukup panjang untuk validasi.',
      urgency: 'low',
    };
    const post = async (over: Record<string, unknown>) => {
      const res = await jsonReq('/api/tickets', 'POST', { ...base, ...over }, reqCookie);
      return { status: res.status, body: (await res.json()) as { ok: boolean; error?: string; data?: { number: string } } };
    };

    const noOther = await post({ catalogItemId: 'cat-item-others', formData: { service_other: '   ' } });
    expect(noOther.status).toBe(400);
    expect(noOther.body.error).toBe('Sebutkan layanan lainnya');

    const noType = await post({ formData: { service_request_type: 'Others' } });
    expect(noType.status).toBe(400);
    expect(noType.body.error).toBe('Sebutkan jenis permintaan lainnya');

    const badEmail = await post({ formData: { hod_email: 'bukan-email' } });
    expect(badEmail.status).toBe(400);
    expect(badEmail.body.error).toBe('Email HOD tidak valid');

    const badType = await post({ formData: { service_request_type: 'Bogus' } });
    expect(badType.status).toBe(400);

    const ok = await post({
      catalogItemId: 'cat-item-others',
      formData: {
        service_other: ' Perangkat khusus ',
        service_request_type: 'Others',
        request_type_other: 'Kalibrasi',
        hod_name: 'Budi Santoso',
        hod_email: 'budi@example.com',
        requester_ack: 'Ya',
        empty: '  ',
      },
    });
    expect(ok.status).toBe(201);

    const store = getStore();
    const t = [...store.tickets.values()].find((x) => x.number === ok.body.data?.number)!;
    expect(t.formData.service_other).toBe('Perangkat khusus');
    expect('empty' in t.formData).toBe(false);

    const user = toSessionUser(store, store.users.get(t.requesterId)!);
    const res = getTicketDetail(store, user, t.number);
    expect(res.kind).toBe('ok');
    if (res.kind === 'ok') {
      const labels = res.detail.formFields.map((f) => f.label);
      expect(labels).toContain('Acknowledge by HOD');
      expect(labels).toContain('Layanan Lainnya');
      expect(labels).toContain('Jenis Permintaan Lainnya');
      expect(res.detail.formFields.find((f) => f.label === 'Email HOD')?.value).toBe('budi@example.com');
    }
  });

  it('supports admin SLA tick, user toggle, and changes webhook auth & lifecycle', async () => {
    const adminCookie = await loginAs('admin');

    // Create a fresh ticket directly in store to verify SLA tick runs cleanly
    const store = getStore();
    const requester = store.users.get('usr-user')!;
    engineCreateTicket(
      store,
      {
        catalogItemId: 'cat-item-network',
        title: 'VPN putus saat meeting penting',
        description: 'Koneksi VPN selalu putus tiap 5 menit.',
        urgency: 'high',
        formData: { service_request_type: 'Problem', connection_type: 'VPN Remote' },
      },
      requester,
      new Date(Date.now() - 120 * 60_000),
    );

    const tickRes = await jsonReq('/api/admin/sla-tick', 'POST', { advanceMinutes: 60 }, adminCookie);
    expect(tickRes.status).toBe(200);
    const tickBody = (await tickRes.json()) as {
      ok: boolean;
      data: { simulatedNow: string; totalRunning: number };
    };
    expect(tickBody.ok).toBe(true);
    expect(typeof tickBody.data.simulatedNow).toBe('string');

    const toggleRes = await jsonReq('/api/admin/users/usr-req-01/toggle', 'POST', undefined, adminCookie);
    expect(toggleRes.status).toBe(200);
    const toggled = (await toggleRes.json()) as { ok: boolean; data: boolean };
    expect(toggled.ok).toBe(true);
    expect(toggled.data).toBe(false);

    // Restore active state
    const toggleBack = await jsonReq('/api/admin/users/usr-req-01/toggle', 'POST', undefined, adminCookie);
    expect(toggleBack.status).toBe(200);

    // Changes webhook: unauth -> 401, auth -> 201 + PATCH -> 200
    const unauthChg = await jsonReq('/api/changes', 'POST', {
      title: 'Deploy v0.2.0',
    });
    expect(unauthChg.status).toBe(401);

    const tokenHeader = { authorization: 'Bearer local-change-token' };
    const createChg = await jsonReq(
      '/api/changes',
      'POST',
      { title: 'Deploy v0.2.0', commitSha: 'abc1234' },
      undefined,
      tokenHeader,
    );
    expect(createChg.status).toBe(201);
    const chgBody = (await createChg.json()) as {
      ok: boolean;
      data: { id: string; status: string };
    };
    expect(chgBody.ok).toBe(true);
    expect(chgBody.data.status).toBe('in_progress');

    const patchChg = await jsonReq(
      `/api/changes/${chgBody.data.id}`,
      'PATCH',
      { status: 'succeeded' },
      undefined,
      tokenHeader,
    );
    expect(patchChg.status).toBe(200);
    const patchedBody = (await patchChg.json()) as {
      ok: boolean;
      data: { status: string; finishedAt: string | null };
    };
    expect(patchedBody.data.status).toBe('succeeded');
    expect(patchedBody.data.finishedAt).not.toBeNull();
  });

  it('enforces worker tick auth, strips requester impact, validates transition assignee, and runs bulk-assign atomically', async () => {
    const reqCookie = await loginAs('requester');
    const leadCookie = await loginAs('lead');
    const adminCookie = await loginAs('admin');

    expect((await jsonReq('/api/worker/tick', 'POST', {})).status).toBe(401);
    expect((await jsonReq('/api/worker/tick', 'POST', {}, reqCookie)).status).toBe(403);
    expect((await jsonReq('/api/worker/tick', 'POST', {}, adminCookie)).status).toBe(200);
    expect(
      (await jsonReq('/api/worker/tick', 'POST', {}, undefined, { authorization: 'Bearer local-change-token' })).status,
    ).toBe(200);

    // Requester cannot force impact
    const cat = getStore().catalog.get('cat-item-network')!;
    const createRes = await jsonReq(
      '/api/tickets',
      'POST',
      {
        catalogItemId: cat.id,
        title: 'Uji dampak tidak boleh dipaksa requester',
        description: 'Memastikan nilai impact mengikuti katalog.',
        urgency: 'high',
        impact: cat.defaultImpact === 'high' ? 'low' : 'high',
        formData: { service_request_type: 'Problem' },
      },
      reqCookie,
    );
    expect(createRes.status).toBe(201);
    const createdJson = (await createRes.json()) as { data: { id: string } };
    const createdTicket = getStore().tickets.get(createdJson.data.id)!;
    expect(createdTicket.impact).toBe(cat.defaultImpact);

    // Transition to assigned rejects non-staff requester assignee
    const badAssign = await jsonReq(
      `/api/tickets/${createdTicket.id}/transition`,
      'POST',
      { to: 'assigned', assigneeId: 'usr-user' },
      leadCookie,
    );
    expect(badAssign.status).toBe(400);

    // Bulk assign deduplicates IDs and aborts cleanly before mutating if a batch contains a closed ticket
    const closedRes = await jsonReq(
      '/api/tickets',
      'POST',
      {
        catalogItemId: cat.id,
        title: 'Tiket akan ditutup sebelum bulk',
        description: 'Untuk menguji atomicity bulk assign.',
        urgency: 'low',
        formData: { service_request_type: 'Problem' },
      },
      reqCookie,
    );
    const closedId = ((await closedRes.json()) as { data: { id: string } }).data.id;
    await jsonReq(
      `/api/tickets/${closedId}/transition`,
      'POST',
      { to: 'cancelled', cancellationReason: 'Batal uji' },
      leadCookie,
    );

    const beforeAssignee = createdTicket.assigneeId;
    const atomicFail = await jsonReq(
      '/api/tickets/bulk-assign',
      'POST',
      { ticketIds: [createdTicket.id, closedId], assigneeId: 'usr-agent' },
      leadCookie,
    );
    expect(atomicFail.status).toBe(400);
    expect(getStore().tickets.get(createdTicket.id)!.assigneeId).toBe(beforeAssignee);

    const dedupeOk = await jsonReq(
      '/api/tickets/bulk-assign',
      'POST',
      { ticketIds: [createdTicket.id, createdTicket.id], assigneeId: 'usr-agent' },
      leadCookie,
    );
    expect(dedupeOk.status).toBe(200);
    const dedupeJson = (await dedupeOk.json()) as { data: { count: number } };
    expect(dedupeJson.data.count).toBe(1);
  });
});
