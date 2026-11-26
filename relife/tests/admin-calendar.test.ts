import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { addBusinessMinutes } from '@/domain/calendar';
import { apiRoutes } from '@/routes/api';
import { authRoutes } from '@/routes/auth';
import { parseHolidayLines } from '@/routes/admin-calendar';
import { bootstrapDatabase } from '@/server/db/bootstrap';
import { closeSqlite, getSqlite } from '@/server/db/sqlite';
import { getStore, installDatabaseStore } from '@/server/mock/db';
import { CAL_BUSINESS } from '@/server/mock/reference-data';
import { businessCalendar } from '@/server/mock/store';
import { createTicket } from '@/server/mock/ticket-engine';

const app = new Hono();
app.route('/api/auth', authRoutes);
app.route('/api', apiRoutes);

async function loginAs(role: 'requester' | 'admin'): Promise<string> {
  const res = await app.request('/api/auth/demo', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ role }),
  });
  return (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
}

function req(path: string, method: string, body: unknown, cookie: string): Promise<Response> {
  return Promise.resolve(
    app.request(path, {
      method,
      headers: { 'content-type': 'application/json', cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

describe('admin calendar & SLA', () => {
  let admin = '';
  let requester = '';

  beforeAll(async () => {
    process.env.DB_PATH = ':memory:';
    closeSqlite();
    const { store, snapshot } = bootstrapDatabase(getSqlite());
    installDatabaseStore(store, snapshot);
    admin = await loginAs('admin');
    requester = await loginAs('requester');
  });
  afterAll(() => closeSqlite());

  it('non-admin gets 403 on every endpoint', async () => {
    const calls: Array<[string, string, unknown]> = [
      ['/api/admin/holidays', 'POST', { date: '2030-01-01', name: 'Uji' }],
      ['/api/admin/holidays/import', 'POST', { text: '2030-01-01 Uji' }],
      ['/api/admin/holidays/hol-2026-01-01', 'PATCH', { name: 'Uji' }],
      ['/api/admin/holidays/hol-2026-01-01', 'DELETE', undefined],
      ['/api/admin/sla-policies/pol-incident/targets', 'PATCH', { targets: [] }],
    ];
    for (const [path, method, body] of calls) {
      expect((await req(path, method, body, requester)).status).toBe(403);
    }
  });

  it('adding and deleting a holiday changes business-time computation', async () => {
    const store = getStore();
    // Senin 2030-03-04 08:00 WIB; 960 menit kerja = 2 hari kerja.
    const start = new Date('2030-03-04T01:00:00Z');
    const due = () => addBusinessMinutes(start, 960, businessCalendar(getStore(), CAL_BUSINESS));
    const before = due().toISOString();
    expect(before).toBe('2030-03-05T10:00:00.000Z'); // Selasa 17:00 WIB

    const add = await req('/api/admin/holidays', 'POST', { date: '2030-03-05', name: 'Uji Libur', type: 'cuti_bersama' }, admin);
    expect(add.status).toBe(201);
    expect(store.holidays.find((h) => h.date === '2030-03-05')?.name).toBe('Cuti Bersama Uji Libur');
    expect(due().toISOString()).toBe('2030-03-06T10:00:00.000Z'); // Rabu 17:00 WIB

    const dup = await req('/api/admin/holidays', 'POST', { date: '2030-03-05', name: 'Lagi' }, admin);
    expect(dup.status).toBe(409);

    const del = await req('/api/admin/holidays/hol-2030-03-05', 'DELETE', undefined, admin);
    expect(del.status).toBe(200);
    expect(due().toISOString()).toBe(before);
  });

  it('patches holiday name and rejects bad input', async () => {
    expect((await req('/api/admin/holidays/hol-2026-12-25', 'PATCH', { name: 'Natal' }, admin)).status).toBe(200);
    expect(getStore().holidays.find((h) => h.id === 'hol-2026-12-25')?.name).toBe('Natal');
    expect((await req('/api/admin/holidays/nope', 'PATCH', { name: 'Natal' }, admin)).status).toBe(404);
    expect((await req('/api/admin/holidays', 'POST', { date: '2030-02-30', name: 'Uji' }, admin)).status).toBe(400);
  });

  it('bulk import reports parse errors and only saves a clean paste', async () => {
    const rows = parseHolidayLines(
      ['2031-01-01 Tahun Baru', 'bukan tanggal', '2031-02-30 Salah', '2031-01-01 Dobel', '', '2026-01-01 Sudah ada'].join('\n'),
      getStore().holidays.map((h) => h.date),
    );
    expect(rows.map((r) => r.error === null)).toEqual([true, false, false, false, false]);

    const text = '2031-01-01 Tahun Baru\n2031-05-01 Hari Buruh';
    const dry = await req('/api/admin/holidays/import', 'POST', { text: `${text}\nxx`, dryRun: true }, admin);
    const dj = (await dry.json()) as { data: { valid: number; errors: number } };
    expect(dj.data).toMatchObject({ valid: 2, errors: 1 });
    expect(getStore().holidays.some((h) => h.date === '2031-01-01')).toBe(false);

    expect((await req('/api/admin/holidays/import', 'POST', { text: `${text}\nxx` }, admin)).status).toBe(400);
    expect((await req('/api/admin/holidays/import', 'POST', { text }, admin)).status).toBe(201);
    expect(getStore().holidays.some((h) => h.date === '2031-05-01')).toBe(true);
  });

  it('validates SLA targets', async () => {
    const path = '/api/admin/sla-policies/pol-request/targets';
    const t = (r: number, s: number) => ({
      targets: [
        { priority: 'P3', responseMinutes: r, resolutionMinutes: s, calendarId: CAL_BUSINESS },
        { priority: 'P4', responseMinutes: 60, resolutionMinutes: 120, calendarId: CAL_BUSINESS },
      ],
    });
    expect((await req(path, 'PATCH', t(0, 60), admin)).status).toBe(400);
    expect((await req(path, 'PATCH', t(60, 60), admin)).status).toBe(400);
    expect((await req(path, 'PATCH', t(60, 60 * 24 * 31), admin)).status).toBe(400);
    expect((await req(path, 'PATCH', { targets: [t(1, 2).targets[0]] }, admin)).status).toBe(400); // prioritas kurang
    expect((await req('/api/admin/sla-policies/x/targets', 'PATCH', t(1, 2), admin)).status).toBe(404);
  });

  it('new ticket uses new target, existing ticket keeps old', async () => {
    const store = getStore();
    const input = {
      catalogItemId: 'cat-item-network',
      title: 'VPN putus saat meeting penting',
      description: 'Koneksi VPN selalu putus tiap 5 menit.',
      urgency: 'high' as const,
      formData: { service_request_type: 'Problem', connection_type: 'VPN Remote' },
    };
    const user = store.users.get('usr-user')!;
    const old = createTicket(store, input, user, new Date());
    const oldSla = store.sla.get(old.id)!;
    const policyId = oldSla.resolution.policyId;
    const oldTarget = oldSla.resolution.targetMinutes;

    const policy = store.policies.get(policyId)!;
    const version = policy.version;
    const res = await req(
      `/api/admin/sla-policies/${policyId}/targets`,
      'PATCH',
      {
        targets: policy.targets.map((x) => ({
          ...x,
          responseMinutes: x.responseMinutes,
          resolutionMinutes: x.resolutionMinutes * 2,
        })),
      },
      admin,
    );
    expect(res.status).toBe(200);
    expect(store.policies.get(policyId)!.version).toBe(version + 1);

    const fresh = createTicket(store, input, user, new Date());
    expect(store.sla.get(fresh.id)!.resolution.targetMinutes).toBe(oldTarget * 2);
    expect(store.sla.get(old.id)!.resolution.targetMinutes).toBe(oldTarget);
  });
});
