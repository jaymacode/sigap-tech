import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Role } from '@/domain/types';
import { getStore } from '@/server/mock/db';
import type { Store } from '@/server/mock/store';
import type { UserRecord } from '@/server/mock/types';
import { sessionSecret } from './config';
import type { AuthUser } from './rbac';

export const SESSION_COOKIE = 'sigap_session';

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export interface SessionUser extends AuthUser {
  name: string;
  email: string;
  department: string;
}

/**
 * Membangun konteks otorisasi (keanggotaan tim) dari record user.
 */
export function toSessionUser(store: Store, user: UserRecord): SessionUser {
  const teams = [...store.teams.values()];
  return {
    id: user.id,
    role: user.role,
    name: user.name,
    email: user.email,
    department: user.department,
    teamIds: teams
      .filter((t) => t.memberIds.includes(user.id) || t.leadId === user.id)
      .map((t) => t.id),
    ledTeamIds: teams.filter((t) => t.leadId === user.id).map((t) => t.id),
  };
}

/** Halaman awal per role. */
export function homeFor(role: Role): string {
  return role === 'requester' ? '/portal' : '/queue';
}

/** Record user lengkap dari store untuk dipakai engine. */
export function userRecord(store: Store, session: SessionUser): UserRecord {
  const record = store.users.get(session.id);
  if (!record) throw new Error('Sesi tidak valid');
  return record;
}

function signature(payload: string): string {
  return createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
}

/** Nilai cookie sesi: `<userId>.<expSec>.<hmac-sha256 base64url>`. */
export function signSessionValue(
  userId: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): string {
  const payload = `${userId}.${nowSec + COOKIE_MAX_AGE_SECONDS}`;
  return `${payload}.${signature(payload)}`;
}

/** Memverifikasi nilai cookie & kedaluwarsa; mengembalikan userId atau null bila tidak sah. */
export function verifySessionValue(
  value: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): string | null {
  const sigDot = value.lastIndexOf('.');
  if (sigDot <= 0) return null;
  const payload = value.slice(0, sigDot);
  const given = Buffer.from(value.slice(sigDot + 1));
  const expected = Buffer.from(signature(payload));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const expDot = payload.lastIndexOf('.');
  if (expDot <= 0) return null;
  const userId = payload.slice(0, expDot);
  const exp = Number(payload.slice(expDot + 1));
  if (!userId || !Number.isFinite(exp) || exp <= nowSec) return null;
  return userId;
}

/** Membaca user yang sedang login dari cookie Hono, atau null (cookie palsu / user nonaktif). */
export function getSessionUser(c: Context): SessionUser | null {
  const raw = getCookie(c, SESSION_COOKIE);
  const id = raw ? verifySessionValue(raw) : null;
  if (!id) return null;
  const store = getStore();
  const user = store.users.get(id);
  if (!user?.isActive) return null;
  return toSessionUser(store, user);
}

/** Menyimpan cookie sesi httpOnly pada response Hono. */
export function setSessionCookie(c: Context, userId: string): void {
  setCookie(c, SESSION_COOKIE, signSessionValue(userId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
}

/** Menghapus cookie sesi pada response Hono. */
export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
}

/**
 * Guard API route: mengembalikan SessionUser atau JSON Response 401/403.
 */
export function requireApiUser(c: Context, roles?: readonly Role[]): SessionUser | Response {
  const user = getSessionUser(c);
  if (!user) return c.json({ ok: false, error: 'Unauthorized' }, 401);
  if (roles && !roles.includes(user.role)) return c.json({ ok: false, error: 'Forbidden' }, 403);
  return user;
}

/**
 * Guard halaman HTML: mengembalikan SessionUser atau redirect ke /login atau homeFor(role).
 */
export function requirePageUser(c: Context, roles?: readonly Role[]): SessionUser | Response {
  const user = getSessionUser(c);
  if (!user) {
    const url = new URL(c.req.url);
    const next = `${url.pathname}${url.search}`;
    return c.redirect(`/login?next=${encodeURIComponent(next)}`);
  }
  if (roles && !roles.includes(user.role)) return c.redirect(homeFor(user.role));
  return user;
}
