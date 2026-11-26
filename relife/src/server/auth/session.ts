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

function signature(userId: string): string {
  return createHmac('sha256', sessionSecret()).update(userId).digest('base64url');
}

/** Nilai cookie sesi: `<userId>.<hmac-sha256 base64url>`. */
export function signSessionValue(userId: string): string {
  return `${userId}.${signature(userId)}`;
}

/** Memverifikasi nilai cookie; mengembalikan userId atau null bila tidak bertanda tangan / dipalsukan. */
export function verifySessionValue(value: string): string | null {
  const dot = value.lastIndexOf('.');
  if (dot <= 0) return null;
  const userId = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1));
  const expected = Buffer.from(signature(userId));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
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
