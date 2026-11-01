import { beforeAll, describe, expect, it } from 'vitest';
import {
  authenticate,
  hashPassword,
  INVALID_CREDENTIALS_ERROR,
  verifyPassword,
} from '@/server/auth/credentials';
import { DEMO_PASSWORD } from '@/domain/demo';
import { getStore } from '@/server/mock/db';
import type { Store } from '@/server/mock/store';

describe('password hashing', () => {
  it('verifies the original password and rejects others', () => {
    const stored = hashPassword('Rahasia123!');
    expect(verifyPassword('Rahasia123!', stored)).toBe(true);
    expect(verifyPassword('rahasia123!', stored)).toBe(false);
  });

  it('uses a per-hash salt so identical passwords produce different hashes', () => {
    expect(hashPassword(DEMO_PASSWORD)).not.toBe(hashPassword(DEMO_PASSWORD));
  });

  it('rejects malformed stored hashes', () => {
    expect(verifyPassword(DEMO_PASSWORD, '')).toBe(false);
    expect(verifyPassword(DEMO_PASSWORD, 'md5$abc$def')).toBe(false);
    expect(verifyPassword(DEMO_PASSWORD, 'scrypt$00$00')).toBe(false);
  });
});

describe('authenticate (akun mock)', () => {
  let store: Store;

  beforeAll(() => {
    // Seeding menghitung hash scrypt untuk setiap user mock, sehingga butuh waktu lebih lama.
    store = getStore();
  }, 60_000);

  it('succeeds with the correct password', () => {
    const result = authenticate(store, 'agent@sigap.demo', DEMO_PASSWORD);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.user.id).toBe('usr-agent');
  });

  it('matches email case-insensitively and ignores surrounding spaces', () => {
    const result = authenticate(store, '  Admin@Sigap.Demo ', DEMO_PASSWORD);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.user.role).toBe('admin');
  });

  it('fails with the generic error when the password is wrong', () => {
    const result = authenticate(store, 'lead@sigap.demo', 'salah-password');
    expect(result).toEqual({ ok: false, error: INVALID_CREDENTIALS_ERROR });
  });

  it('fails with the same generic error when the email is unknown', () => {
    const unknown = authenticate(store, 'tidak.ada@sigap.demo', DEMO_PASSWORD);
    const wrongPassword = authenticate(store, 'lead@sigap.demo', 'salah-password');
    expect(unknown).toEqual({ ok: false, error: INVALID_CREDENTIALS_ERROR });
    expect(unknown).toEqual(wrongPassword);
  });

  it('rejects an inactive account even with the correct password', () => {
    const inactive = store.users.get('usr-req-39');
    expect(inactive?.isActive).toBe(false);
    const result = authenticate(store, inactive?.email ?? '', DEMO_PASSWORD);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('dinonaktifkan');
  });
});
