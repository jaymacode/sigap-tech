import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
import { createApp } from '@/index';
import { setImsProvider, parseRoleMap, provisionUser, type ImsProfile } from '@/server/auth/ims';
import { authMode } from '@/server/auth/config';
import { signSessionValue, verifySessionValue } from '@/server/auth/session';
import { bootstrapDatabase } from '@/server/db/bootstrap';
import { closeSqlite, getSqlite } from '@/server/db/sqlite';
import { getStore, installDatabaseStore } from '@/server/mock/db';

const app = createApp();

function cookieFrom(res: Response): string {
  const pair = (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  if (!pair) throw new Error('Missing Set-Cookie header');
  return pair;
}

async function post(path: string, body: unknown, cookie?: string): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  return await app.request(path, { method: 'POST', headers, body: JSON.stringify(body) });
}

const me = (cookie: string) => app.request('/api/search?q=x', { headers: { cookie } });

function profile(over: Partial<ImsProfile> = {}): ImsProfile {
  return {
    externalId: 'EMP-1',
    email: 'Budi.Santoso@corp.example',
    name: 'Budi Santoso',
    department: 'Finance',
    groups: [],
    ...over,
  };
}

describe('auth: sesi bertanda tangan', () => {
  beforeAll(() => {
    process.env.DB_PATH = ':memory:';
    closeSqlite();
    const { store, snapshot } = bootstrapDatabase(getSqlite());
    installDatabaseStore(store, snapshot);
  });

  afterAll(() => {
    closeSqlite();
  });

  afterEach(() => {
    delete process.env.AUTH_MODE;
    delete process.env.SESSION_SECRET;
    delete process.env.IMS_ROLE_MAP;
    process.env.NODE_ENV = 'test';
    setImsProvider(null);
  });

  it('menolak cookie mentah (unsigned) yang dipalsukan', async () => {
    expect((await me('sigap_session=usr-admin')).status).toBe(401);
  });

  it('menolak cookie dengan tanda tangan yang diubah', async () => {
    const forged = signSessionValue('usr-user').replace('usr-user', 'usr-admin');
    expect((await me(`sigap_session=${forged}`)).status).toBe(401);
  });

  it('menerima cookie bertanda tangan dari login demo', async () => {
    const res = await post('/api/auth/demo', { role: 'admin' });
    expect(res.status).toBe(200);
    const cookie = cookieFrom(res);
    expect(cookie).toContain('.');
    expect((await me(cookie)).status).toBe(200);
  });

  it('cookie tidak berlaku bila SESSION_SECRET berganti', async () => {
    const cookie = cookieFrom(await post('/api/auth/demo', { role: 'agent' }));
    process.env.SESSION_SECRET = 'x'.repeat(40);
    expect((await me(cookie)).status).toBe(401);
  });

  it('user nonaktif ditolak walau cookie valid', async () => {
    const cookie = `sigap_session=${signSessionValue('usr-agent')}`;
    const user = getStore().users.get('usr-agent')!;
    user.isActive = false;
    try {
      expect((await me(cookie)).status).toBe(401);
    } finally {
      user.isActive = true;
    }
  });

  it('menolak cookie sesi yang sudah kedaluwarsa dan default ims di produksi', () => {
    const token = signSessionValue('usr-user', 1_000);
    expect(verifySessionValue(token, 1_000 + 60)).toBe('usr-user');
    expect(verifySessionValue(token, 1_000 + 7 * 24 * 60 * 60 + 1)).toBeNull();

    process.env.NODE_ENV = 'production';
    expect(authMode()).toBe('ims');
  });

  it('AUTH_MODE=ims mewajibkan SESSION_SECRET', () => {
    process.env.AUTH_MODE = 'ims';
    expect(() => signSessionValue('usr-user')).toThrow('SESSION_SECRET');
  });

  it('AUTH_MODE=ims menonaktifkan login demo, password, dan switch', async () => {
    process.env.AUTH_MODE = 'ims';
    process.env.SESSION_SECRET = 's'.repeat(40);
    expect((await post('/api/auth/demo', { role: 'admin' })).status).toBe(404);
    expect((await post('/api/auth/login', { email: 'admin@sigap.demo', password: 'x' })).status).toBe(404);
    expect((await post('/api/auth/switch', { userId: 'usr-admin' })).status).toBe(404);

    const page = await (await app.request('/login')).text();
    expect(page).toContain('/auth/ims/login');
    expect(page).not.toContain('/api/auth/demo');
  });

  it('halaman login mode demo tetap menampilkan kartu demo', async () => {
    const page = await (await app.request('/login')).text();
    expect(page).toContain('/api/auth/demo');
    expect(page).not.toContain('/auth/ims/login');
  });

  it('route IMS mengembalikan 501 sebelum dikonfigurasi', async () => {
    const res = await app.request('/auth/ims/login');
    expect(res.status).toBe(501);
    expect(await res.text()).toContain('Integrasi IMS belum dikonfigurasi');
    expect((await app.request('/auth/ims/callback')).status).toBe(501);
  });

  it('callback IMS dengan provider stub membuat sesi', async () => {
    process.env.IMS_ROLE_MAP = 'IT-STAFF:agent';
    setImsProvider({
      startLogin: () => 'https://ims.example/authorize',
      handleCallback: () => profile({ email: 'stub@corp.example', groups: ['IT-STAFF'] }),
    });
    const start = await app.request('/auth/ims/login');
    expect(start.status).toBe(302);
    expect(start.headers.get('location')).toBe('https://ims.example/authorize');

    const res = await app.request('/auth/ims/callback?code=abc');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/queue');
    expect((await me(cookieFrom(res))).status).toBe(200);
  });
});

describe('auth: provisionUser', () => {
  const now = new Date('2026-11-26T03:00:00Z');

  beforeAll(() => {
    process.env.DB_PATH = ':memory:';
    closeSqlite();
    const { store, snapshot } = bootstrapDatabase(getSqlite());
    installDatabaseStore(store, snapshot);
  });

  afterAll(() => {
    closeSqlite();
  });

  it('membuat user baru sebagai requester tanpa password', () => {
    const store = getStore();
    const r = provisionUser(store, profile(), now, new Map());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.created).toBe(true);
    expect(r.user.email).toBe('budi.santoso@corp.example');
    expect(r.user.role).toBe('requester');
    expect(r.user.passwordHash).toBe('');
    expect(store.users.get(r.user.id)).toBe(r.user);
  });

  it('memperbarui user lama berdasarkan email, id tetap', () => {
    const store = getStore();
    const first = provisionUser(store, profile(), now, new Map());
    const again = provisionUser(
      store,
      profile({ email: 'BUDI.santoso@corp.example', name: 'Budi S.', department: 'Accounting' }),
      now,
      new Map(),
    );
    expect(first.ok && again.ok).toBe(true);
    if (!first.ok || !again.ok) return;
    expect(again.created).toBe(false);
    expect(again.user.id).toBe(first.user.id);
    expect(again.user.name).toBe('Budi S.');
    expect(again.user.department).toBe('Accounting');
  });

  it('memetakan grup IMS ke role tertinggi', () => {
    const map = parseRoleMap('IT-HEAD:lead, IT-STAFF:agent ,IT-ADMIN:admin,bad,X:superuser');
    expect(map.size).toBe(3);
    const r = provisionUser(
      getStore(),
      profile({ email: 'it@corp.example', groups: ['it-staff', 'IT-HEAD'] }),
      now,
      map,
    );
    expect(r.ok && r.user.role).toBe('lead');
  });

  it('dengan IMS_ROLE_MAP, IMS menjadi sumber role; tanpa map, role lama dipertahankan', () => {
    const store = getStore();
    const admin = store.users.get('usr-admin')!;
    const p = profile({ email: admin.email, groups: [] });
    expect(provisionUser(store, p, now, new Map()).ok).toBe(true);
    expect(admin.role).toBe('admin');
    expect(provisionUser(store, p, now, parseRoleMap('IT-ADMIN:admin')).ok).toBe(true);
    expect(admin.role).toBe('requester');
    admin.role = 'admin';
  });

  it('user nonaktif tidak bisa login via IMS', () => {
    const store = getStore();
    const user = store.users.get('usr-user')!;
    user.isActive = false;
    try {
      const r = provisionUser(store, profile({ email: user.email, name: 'Diubah' }), now, new Map());
      expect(r.ok).toBe(false);
      expect(user.name).not.toBe('Diubah');
    } finally {
      user.isActive = true;
    }
  });
});
