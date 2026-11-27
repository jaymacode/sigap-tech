/**
 * Konfigurasi autentikasi dari environment. Dibaca per panggilan (bukan di-cache) agar test bisa
 * mengganti `AUTH_MODE` / `SESSION_SECRET` tanpa me-reload modul.
 */

export type AuthMode = 'demo' | 'ims';

const MIN_SECRET_LENGTH = 32;
// Hanya untuk development: rahasia tetap agar sesi bertahan saat `bun --watch` me-restart server.
const DEV_FALLBACK_SECRET = 'sigap-dev-only-session-secret-do-not-use-in-prod';

let warnedFallback = false;

/** Mode autentikasi aktif: `demo` (default, dev) atau `ims` (produksi, SSO perusahaan). */
export function authMode(): AuthMode {
  if (process.env.AUTH_MODE === 'ims') return 'ims';
  if (process.env.AUTH_MODE === 'demo') return 'demo';
  return process.env.NODE_ENV === 'production' ? 'ims' : 'demo';
}

/** true bila login demo (1-klik, email+password, ganti akun) diizinkan. */
export function isDemoAuth(): boolean {
  return authMode() === 'demo';
}

function strictSecretRequired(): boolean {
  return process.env.NODE_ENV === 'production' || authMode() === 'ims';
}

/** Rahasia HMAC cookie sesi. Melempar error bila wajib (produksi / ims) tetapi tidak valid. */
export function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET ?? '';
  if (secret.length >= MIN_SECRET_LENGTH) return secret;
  if (strictSecretRequired()) {
    throw new Error(
      `SESSION_SECRET wajib diisi minimal ${MIN_SECRET_LENGTH} karakter saat NODE_ENV=production atau AUTH_MODE=ims`,
    );
  }
  if (!warnedFallback) {
    warnedFallback = true;
    console.warn('[auth] SESSION_SECRET tidak diset / terlalu pendek — memakai rahasia dev bawaan (JANGAN dipakai di produksi)');
  }
  return DEV_FALLBACK_SECRET;
}

/** Cek konfigurasi saat startup; melempar error agar server menolak start bila salah konfigurasi. */
export function assertAuthConfig(): void {
  const raw = process.env.AUTH_MODE;
  if (raw !== undefined && raw !== '' && raw !== 'demo' && raw !== 'ims') {
    throw new Error(`AUTH_MODE tidak dikenal: "${raw}" (pakai "demo" atau "ims")`);
  }
  sessionSecret();
}
