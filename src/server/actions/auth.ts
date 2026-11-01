'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Role } from '@/domain/types';
import { DEMO_PASSWORD } from '@/domain/demo';
import { authenticate } from '@/server/auth/credentials';
import { SESSION_COOKIE, homeFor } from '@/server/auth/session';
import { getStore } from '@/server/mock/db';

const DEMO_USER_BY_ROLE: Record<Role, string> = {
  requester: 'usr-user',
  agent: 'usr-agent',
  lead: 'usr-lead',
  admin: 'usr-admin',
};

/**
 * Login instan dengan akun demo. Tetap melewati verifikasi password yang sama dengan form login,
 * menggunakan password demo publik.
 * @param role - role demo
 */
export async function loginWithDemo(role: Role): Promise<void> {
  const store = getStore();
  const account = store.users.get(DEMO_USER_BY_ROLE[role]);
  const result = account ? authenticate(store, account.email, DEMO_PASSWORD) : null;
  if (!result?.ok) {
    throw new Error('Akun demo tidak ditemukan atau dinonaktifkan');
  }
  const user = result.user;

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
 * Login dengan alamat email dan password. Email tidak terdaftar dan password salah
 * menghasilkan error yang sama.
 * @param email - email terdaftar
 * @param password - password akun
 */
export async function loginWithEmail(
  email: string,
  password: string,
): Promise<{ ok: boolean; error?: string }> {
  const store = getStore();
  const result = authenticate(store, email, password);
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  const user = result.user;

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
