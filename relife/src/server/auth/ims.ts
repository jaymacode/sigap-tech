import type { Context } from 'hono';
import { ROLES, type Role } from '@/domain/types';
import { nextId, type Store } from '@/server/mock/store';
import type { UserRecord } from '@/server/mock/types';

/**
 * Seam integrasi IMS (sistem identitas/karyawan perusahaan). Protokol final belum diketahui
 * (OIDC/SAML SSO, LDAP/AD, atau REST API); modul ini hanya mendefinisikan kontraknya.
 */

/** Profil karyawan yang dikembalikan IMS setelah login berhasil. */
export interface ImsProfile {
  externalId: string;
  email: string;
  name: string;
  department: string;
  groups: string[];
}

/** Kontrak yang wajib diisi implementasi IMS sungguhan. */
export interface ImsProvider {
  /** URL tujuan redirect untuk memulai login di IMS. */
  startLogin(c: Context): Promise<string> | string;
  /** Memvalidasi respons IMS di callback dan mengembalikan profil karyawan. */
  handleCallback(c: Context): Promise<ImsProfile> | ImsProfile;
}

export class ImsNotConfiguredError extends Error {
  constructor() {
    super('Integrasi IMS belum dikonfigurasi');
  }
}

// shortcut: belum ada provider IMS sungguhan. Implementasi protokol (OIDC: redirect ke authorize
// endpoint + tukar code/validasi id_token; SAML: AuthnRequest + validasi assertion; LDAP/REST: form
// login sendiri lalu bind/lookup) dibuat sebagai ImsProvider dan didaftarkan lewat setImsProvider()
// saat startup (src/index.ts). State/nonce/PKCE menjadi tanggung jawab provider tersebut.
let provider: ImsProvider | null = null;

/** Mendaftarkan provider IMS (implementasi sungguhan, atau stub di test). `null` = belum dikonfigurasi. */
export function setImsProvider(next: ImsProvider | null): void {
  provider = next;
}

export async function startLogin(c: Context): Promise<string> {
  if (!provider) throw new ImsNotConfiguredError();
  return await provider.startLogin(c);
}

export async function handleCallback(c: Context): Promise<ImsProfile> {
  if (!provider) throw new ImsNotConfiguredError();
  return await provider.handleCallback(c);
}

// Urutan hak akses: bila user ada di beberapa grup, role tertinggi yang dipakai.
const ROLE_RANK: Record<Role, number> = { requester: 0, agent: 1, lead: 2, admin: 3 };

/** Parse `IMS_ROLE_MAP`, mis. `IT-HEAD:lead,IT-STAFF:agent,IT-ADMIN:admin`. Entri tidak valid diabaikan. */
export function parseRoleMap(raw: string | undefined = process.env.IMS_ROLE_MAP): Map<string, Role> {
  const map = new Map<string, Role>();
  for (const entry of (raw ?? '').split(',')) {
    const idx = entry.lastIndexOf(':');
    if (idx <= 0) continue;
    const group = entry.slice(0, idx).trim().toLowerCase();
    const role = entry.slice(idx + 1).trim().toLowerCase() as Role;
    if (group && (ROLES as readonly string[]).includes(role)) map.set(group, role);
  }
  return map;
}

/** Role tertinggi dari grup IMS yang dipetakan, atau null bila tidak ada grup yang cocok. */
export function roleFromGroups(groups: readonly string[], map: Map<string, Role>): Role | null {
  let best: Role | null = null;
  for (const g of groups) {
    const role = map.get(g.trim().toLowerCase());
    if (role && (best === null || ROLE_RANK[role] > ROLE_RANK[best])) best = role;
  }
  return best;
}

/**
 * Upsert user dari profil IMS (dicocokkan lewat email). User baru dibuat sebagai requester kecuali
 * grupnya dipetakan; user lama dipertahankan id-nya, nama/departemen diperbarui. Bila `IMS_ROLE_MAP`
 * diisi, IMS menjadi sumber kebenaran role (tanpa grup cocok = requester); bila kosong, role user lama
 * tetap dikelola Administrator di aplikasi. User nonaktif ditolak. Pemanggil wajib `persistOrFail()`.
 */
export function provisionUser(
  store: Store,
  profile: ImsProfile,
  now: Date,
  roleMap: Map<string, Role> = parseRoleMap(),
): { ok: true; user: UserRecord; created: boolean } | { ok: false; error: string } {
  const email = profile.email.trim().toLowerCase();
  if (!email) return { ok: false, error: 'Profil IMS tidak memiliki email' };
  const mapped = roleFromGroups(profile.groups, roleMap);
  const name = profile.name.trim() || email;
  const department = profile.department.trim();

  const existing = [...store.users.values()].find((u) => u.email.toLowerCase() === email);
  if (existing) {
    if (!existing.isActive) {
      return { ok: false, error: 'Akun Anda sedang dinonaktifkan oleh Administrator' };
    }
    existing.name = name;
    if (department) existing.department = department;
    if (roleMap.size > 0) existing.role = mapped ?? 'requester';
    existing.lastLoginAt = now;
    return { ok: true, user: existing, created: false };
  }

  const user: UserRecord = {
    id: nextId(store, 'usr'),
    email,
    name,
    role: mapped ?? 'requester',
    department,
    isActive: true,
    // Kosong = tidak bisa login dengan password (verifyPassword selalu false); login hanya via IMS.
    passwordHash: '',
    lastLoginAt: now,
    createdAt: now,
  };
  store.users.set(user.id, user);
  return { ok: true, user, created: true };
}
