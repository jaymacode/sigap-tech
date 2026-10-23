import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Role } from '@/domain/types';
import { getStore } from '@/server/mock/db';
import type { Store } from '@/server/mock/store';
import type { UserRecord } from '@/server/mock/types';
import type { AuthUser } from './rbac';

/**
 * Sesi mock berbasis cookie httpOnly berisi id user (ADR-005).
 * Backend asli memakai Auth.js + session DB (ARCHITECTURE.md §1); API publik modul ini
 * (`getSessionUser`, `requireUser`) sengaja dibuat sama agar halaman tidak perlu diubah.
 */

export const SESSION_COOKIE = 'sigap_session';

export interface SessionUser extends AuthUser {
  name: string;
  email: string;
  department: string;
}

/**
 * Membangun konteks otorisasi (keanggotaan tim) dari record user.
 * @param store - store
 * @param user - record user
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

/** User yang sedang login, atau null. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const id = jar.get(SESSION_COOKIE)?.value;
  if (!id) return null;
  const store = getStore();
  const user = store.users.get(id);
  if (!user?.isActive) return null;
  return toSessionUser(store, user);
}

/**
 * Mewajibkan login (dan role tertentu bila diberikan). Dicek di server, bukan hanya di UI.
 * @param roles - role yang diizinkan; kosong = semua role
 * @returns user sesi
 */
export async function requireUser(roles?: readonly Role[]): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (roles && !roles.includes(user.role)) redirect(homeFor(user.role));
  return user;
}

/** Record user lengkap dari store untuk dipakai engine. */
export function userRecord(store: Store, session: SessionUser): UserRecord {
  const record = store.users.get(session.id);
  if (!record) throw new Error('Sesi tidak valid');
  return record;
}
