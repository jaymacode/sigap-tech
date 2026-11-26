import { type Context, Hono, type Next } from 'hono';
import { html } from 'hono/html';
import { z } from 'zod';
import { DEMO_PASSWORD } from '@/domain/demo';
import { ROLES, type Role } from '@/domain/types';
import { persistOrFail } from '@/server/actions/persist';
import { isDemoAuth } from '@/server/auth/config';
import { authenticate } from '@/server/auth/credentials';
import { handleCallback, ImsNotConfiguredError, provisionUser, startLogin } from '@/server/auth/ims';
import { clearSessionCookie, homeFor, setSessionCookie } from '@/server/auth/session';
import { getStore } from '@/server/mock/db';

const DEMO_USER_BY_ROLE: Record<Role, string> = {
  requester: 'usr-user',
  agent: 'usr-agent',
  lead: 'usr-lead',
  admin: 'usr-admin',
};

const demoSchema = z.object({
  role: z.enum(ROLES),
});

const loginSchema = z.object({
  email: z.string().trim().min(1, 'Email wajib diisi'),
  password: z.string().min(1, 'Password wajib diisi'),
});

const switchSchema = z.object({
  userId: z.string().min(1, 'User tujuan tidak valid'),
});

export const authRoutes = new Hono();

// Login demo, password, dan ganti akun hanya ada di AUTH_MODE=demo. Di mode ims semuanya 404.
authRoutes.use('/demo', demoOnly);
authRoutes.use('/login', demoOnly);
authRoutes.use('/switch', demoOnly);

async function demoOnly(c: Context, next: Next): Promise<Response | void> {
  if (!isDemoAuth()) return c.json({ ok: false, error: 'Not found' }, 404);
  await next();
}

authRoutes.post('/demo', async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = demoSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Role tidak valid' }, 400);
  }

  const store = getStore();
  const account = store.users.get(DEMO_USER_BY_ROLE[parsed.data.role]);
  const result = account ? authenticate(store, account.email, DEMO_PASSWORD) : null;
  if (!result?.ok) {
    return c.json(
      { ok: false, error: result?.error ?? 'Akun demo tidak ditemukan atau dinonaktifkan' },
      401,
    );
  }

  setSessionCookie(c, result.user.id);
  return c.json({ ok: true, data: { redirect: homeFor(result.user.role) } });
});

authRoutes.post('/login', async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'Email dan password wajib diisi' },
      400,
    );
  }

  const store = getStore();
  const result = authenticate(store, parsed.data.email, parsed.data.password);
  if (!result.ok) {
    return c.json({ ok: false, error: result.error }, 401);
  }

  setSessionCookie(c, result.user.id);
  return c.json({ ok: true, data: { redirect: homeFor(result.user.role) } });
});

authRoutes.post('/switch', async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = switchSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ ok: false, error: 'User tujuan tidak valid' }, 400);
  }

  const store = getStore();
  const user = store.users.get(parsed.data.userId);
  if (!user || !user.isActive) {
    return c.json({ ok: false, error: 'User tujuan tidak valid' }, 400);
  }

  setSessionCookie(c, user.id);
  return c.json({ ok: true, data: { redirect: homeFor(user.role) } });
});

authRoutes.post('/logout', (c) => {
  clearSessionCookie(c);
  return c.json({ ok: true, data: { redirect: '/login' } });
});

/** Login SSO via IMS perusahaan; di-mount di `/auth/ims`. */
export const imsRoutes = new Hono();

function imsErrorPage(c: Context, status: 401 | 403 | 500 | 501, message: string): Response | Promise<Response> {
  return c.html(
    html`<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Login IMS — Sigap</title></head><body><h1>Login IMS gagal</h1><p>${message}</p><p><a href="/login">Kembali ke halaman masuk</a></p></body></html>`,
    status,
  );
}

imsRoutes.get('/login', async (c) => {
  try {
    return c.redirect(await startLogin(c));
  } catch (err: unknown) {
    if (err instanceof ImsNotConfiguredError) return imsErrorPage(c, 501, err.message);
    console.error('[auth] gagal memulai login IMS', err);
    return imsErrorPage(c, 500, 'Gagal menghubungi IMS');
  }
});

imsRoutes.get('/callback', async (c) => {
  let profile;
  try {
    profile = await handleCallback(c);
  } catch (err: unknown) {
    if (err instanceof ImsNotConfiguredError) return imsErrorPage(c, 501, err.message);
    console.error('[auth] callback IMS ditolak', err);
    return imsErrorPage(c, 401, 'Respons IMS tidak valid atau kedaluwarsa');
  }

  const result = provisionUser(getStore(), profile, new Date());
  if (!result.ok) return imsErrorPage(c, 403, result.error);
  if (!(await persistOrFail())) return imsErrorPage(c, 500, 'Gagal menyimpan ke database');

  setSessionCookie(c, result.user.id);
  return c.redirect(homeFor(result.user.role));
});
