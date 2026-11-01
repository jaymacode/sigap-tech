import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Store } from '@/server/mock/store';
import type { UserRecord } from '@/server/mock/types';

/**
 * Verifikasi kredensial untuk akun mock (ADR-005). Password disimpan sebagai hash scrypt dengan
 * salt per-user. Ini bukan autentikasi produksi; backend asli memakai Auth.js (ARCHITECTURE.md §1).
 */

const KEY_LENGTH = 64;
const SCRYPT_PREFIX = 'scrypt';
// Biaya scrypt sengaja rendah agar seeding ~50 user mock tetap cepat. Password demo bersifat publik,
// jadi kekuatan hash bukan tujuan di sini; backend asli memakai parameter produksi.
const SCRYPT_OPTIONS = { N: 4096, r: 8, p: 1 } as const;
export const INVALID_CREDENTIALS_ERROR = 'Email atau password salah';

/**
 * Membuat hash password dengan salt acak. Format: `scrypt$<saltHex>$<hashHex>`.
 * @param password - password plaintext
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, KEY_LENGTH, SCRYPT_OPTIONS);
  return `${SCRYPT_PREFIX}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

/**
 * Memeriksa password terhadap hash tersimpan secara constant-time.
 * @param password - password yang diketik
 * @param stored - hash dari `hashPassword`
 */
export function verifyPassword(password: string, stored: string): boolean {
  const [prefix, saltHex, hashHex] = stored.split('$');
  if (prefix !== SCRYPT_PREFIX || !saltHex || !hashHex) return false;

  const expected = Buffer.from(hashHex, 'hex');
  if (expected.length !== KEY_LENGTH) return false;

  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), KEY_LENGTH, SCRYPT_OPTIONS);
  return timingSafeEqual(actual, expected);
}

// Hash dummy untuk email yang tidak terdaftar, agar waktu respons tidak membocorkan keberadaan akun.
let dummyHash: string | null = null;

/**
 * Mengautentikasi email + password terhadap store mock.
 * Email tidak terdaftar dan password salah menghasilkan pesan error yang sama.
 * @param store - store mock
 * @param email - email yang diketik
 * @param password - password yang diketik
 */
export function authenticate(
  store: Store,
  email: string,
  password: string,
): { ok: true; user: UserRecord } | { ok: false; error: string } {
  const normalized = email.trim().toLowerCase();
  const user = [...store.users.values()].find((u) => u.email.toLowerCase() === normalized);

  if (!user) {
    dummyHash ??= hashPassword('dummy-password');
    verifyPassword(password, dummyHash);
    return { ok: false, error: INVALID_CREDENTIALS_ERROR };
  }
  if (!verifyPassword(password, user.passwordHash)) {
    return { ok: false, error: INVALID_CREDENTIALS_ERROR };
  }
  if (!user.isActive) {
    return { ok: false, error: 'Akun Anda sedang dinonaktifkan oleh Administrator' };
  }
  return { ok: true, user };
}
