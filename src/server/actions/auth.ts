'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Role } from '@/domain/types';
import { SESSION_COOKIE, homeFor } from '@/server/auth/session';
import { getStore } from '@/server/mock/db';

const DEMO_USER_BY_ROLE: Record<Role, string> = {
  requester: 'usr-user',
  agent: 'usr-agent',
  lead: 'usr-lead',
  admin: 'usr-admin',
};

/**
 * Login instan dengan akun demo.
 * @param role - role demo
 */
export async function loginWithDemo(role: Role): Promise<void> {
  const store = getStore();
  const userId = DEMO_USER_BY_ROLE[role];
  const user = store.users.get(userId);
  if (!user || !user.isActive) {
    throw new Error('Akun demo tidak ditemukan atau dinonaktifkan');
  }

  const jar = await cookies();
  jar.set(SESSION_COOKIE, user.id, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });

  redirect(homeFor(user.role));
}

/**
 * Login dengan alamat email (dan opsional password demo).
 * @param email - email terdaftar
 */
export async function loginWithEmail(email: string): Promise<{ ok: boolean; error?: string }> {
  const store = getStore();
  const normalized = email.trim().toLowerCase();
  const user = [...store.users.values()].find((u) => u.email.toLowerCase() === normalized);

  if (!user) {
    return { ok: false, error: 'Email tidak terdaftar dalam sistem Sigap' };
  }
  if (!user.isActive) {
    return { ok: false, error: 'Akun Anda sedang dinonaktifkan oleh Administrator' };
  }

  const jar = await cookies();
  jar.set(SESSION_COOKIE, user.id, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });

  redirect(homeFor(user.role));
}

/**
 * Cepat ganti akun untuk simulasi/testing multi-role langsung dari UI topbar.
 * @param userId - ID user tujuan
 */
export async function switchUser(userId: string): Promise<void> {
  const store = getStore();
  const user = store.users.get(userId);
  if (!user || !user.isActive) {
    throw new Error('User tujuan tidak valid');
  }

  const jar = await cookies();
  jar.set(SESSION_COOKIE, user.id, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });

  redirect(homeFor(user.role));
}

/**
 * Keluar dari sesi.
 */
export async function logout(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  redirect('/login');
}
