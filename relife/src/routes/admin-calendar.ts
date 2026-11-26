import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { DB_ERROR_RESULT, persistOrFail } from '@/server/actions/persist';
import { requireApiUser } from '@/server/auth/session';
import { getStore } from '@/server/mock/db';
import { CAL_BUSINESS } from '@/server/mock/reference-data';
import type { Store } from '@/server/mock/store';
import type { HolidayRecord, SlaTargetRecord } from '@/server/mock/types';

/** Batas wajar target SLA: 30 hari kalender (menit). */
export const MAX_SLA_MINUTES = 30 * 24 * 60;
const CUTI_PREFIX = 'Cuti Bersama';
const MAX_IMPORT_LINES = 500;

export type HolidayType = 'libur_nasional' | 'cuti_bersama';

/** Validasi tanggal kalender nyata `YYYY-MM-DD` (tolak 2026-02-30) dalam rentang 2000-2100. */
export function isValidDateKey(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 2000 || y > 2100) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Tipe libur diturunkan dari nama (tanpa kolom baru): awalan "Cuti Bersama" = cuti bersama. */
export function holidayTypeOf(name: string): HolidayType {
  return name.toLowerCase().startsWith(CUTI_PREFIX.toLowerCase()) ? 'cuti_bersama' : 'libur_nasional';
}

function nameForType(name: string, type: HolidayType): string {
  const n = name.trim();
  return type === 'cuti_bersama' && holidayTypeOf(n) !== 'cuti_bersama' ? `${CUTI_PREFIX} ${n}` : n;
}

export interface ParsedHolidayLine {
  line: number;
  date: string;
  name: string;
  error: string | null;
}

/** Parse paste "YYYY-MM-DD Nama" per baris. Baris kosong dilewati; duplikat (dalam paste / sudah ada) = error. */
export function parseHolidayLines(text: string, existingDates: Iterable<string>): ParsedHolidayLine[] {
  const seen = new Set(existingDates);
  const out: ParsedHolidayLine[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const s = raw.trim();
    if (!s) return;
    const m = /^(\d{4}-\d{2}-\d{2})[\s,;:-]+(.+)$/.exec(s);
    const date = m?.[1] ?? s.slice(0, 10);
    const name = (m?.[2] ?? '').trim();
    let error: string | null = null;
    if (!m) error = 'Format harus "YYYY-MM-DD Nama"';
    else if (!isValidDateKey(date)) error = 'Tanggal tidak valid';
    else if (name.length > 80) error = 'Nama maksimal 80 karakter';
    else if (seen.has(date)) error = 'Tanggal sudah terdaftar';
    if (!error) seen.add(date);
    out.push({ line: i + 1, date, name, error });
  });
  return out;
}

const nameSchema = z.string().trim().min(2, 'Nama libur minimal 2 karakter').max(80, 'Nama libur maksimal 80 karakter');
const dateSchema = z.string().refine(isValidDateKey, 'Tanggal tidak valid (format YYYY-MM-DD)');
const addSchema = z.object({
  date: dateSchema,
  name: nameSchema,
  type: z.enum(['libur_nasional', 'cuti_bersama']).default('libur_nasional'),
});
const editSchema = z.object({ name: nameSchema });
const importSchema = z.object({
  text: z.string().max(50_000, 'Teks terlalu panjang'),
  dryRun: z.boolean().default(false),
});

const minutes = (label: string) =>
  z
    .number({ error: `Target ${label} harus angka` })
    .int('Target harus bilangan bulat menit')
    .positive('Target harus lebih dari 0');

const targetsSchema = z.object({
  targets: z
    .array(
      z.object({
        priority: z.enum(['P1', 'P2', 'P3', 'P4']),
        responseMinutes: minutes('respons'),
        resolutionMinutes: minutes('resolusi'),
        calendarId: z.string().min(1, 'Kalender wajib dipilih'),
      }),
    )
    .min(1, 'Target SLA wajib diisi'),
});

async function parseBody<T extends z.ZodTypeAny>(
  c: Context,
  schema: T,
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; res: Response }> {
  const raw = await c.req.json().catch(() => null);
  if (raw === null) return { ok: false, res: c.json({ ok: false, error: 'Body JSON tidak valid' }, 400) };
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, res: c.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Permintaan tidak valid' }, 400) };
  }
  return { ok: true, data: parsed.data };
}

function insertHoliday(store: Store, date: string, name: string): HolidayRecord {
  const rec: HolidayRecord = { id: `hol-${date}`, calendarId: CAL_BUSINESS, date, name };
  store.holidays.push(rec);
  store.holidays.sort((a, b) => a.date.localeCompare(b.date));
  return rec;
}

export const adminCalendarRoutes = new Hono();

// Setiap perubahan libur membuang calendarCache agar tiket baru langsung memakai daftar terbaru.
adminCalendarRoutes.post('/admin/holidays', async (c) => {
  const session = requireApiUser(c, ['admin']);
  if (session instanceof Response) return session;
  const body = await parseBody(c, addSchema);
  if (!body.ok) return body.res;

  const store = getStore();
  const { date, name, type } = body.data;
  if (store.holidays.some((h) => h.date === date)) {
    return c.json({ ok: false, error: `Tanggal ${date} sudah terdaftar sebagai hari libur` }, 409);
  }
  const rec = insertHoliday(store, date, nameForType(name, type));
  store.calendarCache.clear();
  console.info(`[audit] ${session.id} menambah hari libur ${rec.date} "${rec.name}"`);
  if (!(await persistOrFail())) return c.json(DB_ERROR_RESULT, 500);
  return c.json({ ok: true, data: rec }, 201);
});

adminCalendarRoutes.post('/admin/holidays/import', async (c) => {
  const session = requireApiUser(c, ['admin']);
  if (session instanceof Response) return session;
  const body = await parseBody(c, importSchema);
  if (!body.ok) return body.res;

  const store = getStore();
  const rows = parseHolidayLines(body.data.text, store.holidays.map((h) => h.date));
  if (rows.length === 0) return c.json({ ok: false, error: 'Tidak ada baris untuk diimpor' }, 400);
  if (rows.length > MAX_IMPORT_LINES) {
    return c.json({ ok: false, error: `Maksimal ${MAX_IMPORT_LINES} baris per impor` }, 400);
  }
  const errors = rows.filter((r) => r.error).length;
  if (body.data.dryRun) return c.json({ ok: true, data: { rows, valid: rows.length - errors, errors } });
  if (errors > 0) return c.json({ ok: false, error: `${errors} baris bermasalah, perbaiki dulu sebelum menyimpan` }, 400);

  for (const r of rows) insertHoliday(store, r.date, r.name);
  store.calendarCache.clear();
  console.info(`[audit] ${session.id} mengimpor ${rows.length} hari libur`);
  if (!(await persistOrFail())) return c.json(DB_ERROR_RESULT, 500);
  return c.json({ ok: true, data: { added: rows.length } }, 201);
});

adminCalendarRoutes.patch('/admin/holidays/:id', async (c) => {
  const session = requireApiUser(c, ['admin']);
  if (session instanceof Response) return session;
  const body = await parseBody(c, editSchema);
  if (!body.ok) return body.res;

  const store = getStore();
  const rec = store.holidays.find((h) => h.id === c.req.param('id'));
  if (!rec) return c.json({ ok: false, error: 'Hari libur tidak ditemukan' }, 404);
  rec.name = body.data.name;
  console.info(`[audit] ${session.id} mengubah nama hari libur ${rec.date} menjadi "${rec.name}"`);
  if (!(await persistOrFail())) return c.json(DB_ERROR_RESULT, 500);
  return c.json({ ok: true, data: rec });
});

adminCalendarRoutes.delete('/admin/holidays/:id', async (c) => {
  const session = requireApiUser(c, ['admin']);
  if (session instanceof Response) return session;

  const store = getStore();
  const idx = store.holidays.findIndex((h) => h.id === c.req.param('id'));
  if (idx < 0) return c.json({ ok: false, error: 'Hari libur tidak ditemukan' }, 404);
  const [rec] = store.holidays.splice(idx, 1);
  store.calendarCache.clear();
  console.info(`[audit] ${session.id} menghapus hari libur ${rec?.date} "${rec?.name}"`);
  if (!(await persistOrFail())) return c.json(DB_ERROR_RESULT, 500);
  return c.json({ ok: true, data: true });
});

/** Target baru hanya berlaku untuk tiket BARU; instance SLA yang berjalan menyimpan target sendiri. */
adminCalendarRoutes.patch('/admin/sla-policies/:id/targets', async (c) => {
  const session = requireApiUser(c, ['admin']);
  if (session instanceof Response) return session;
  const body = await parseBody(c, targetsSchema);
  if (!body.ok) return body.res;

  const store = getStore();
  const policy = store.policies.get(c.req.param('id'));
  if (!policy) return c.json({ ok: false, error: 'SLA policy tidak ditemukan' }, 404);

  const incoming = body.data.targets;
  const priorities = incoming.map((t) => t.priority);
  if (new Set(priorities).size !== priorities.length) return c.json({ ok: false, error: 'Prioritas duplikat' }, 400);
  const expected = policy.targets.map((t) => t.priority).sort().join(', ');
  if ([...priorities].sort().join(', ') !== expected) {
    return c.json({ ok: false, error: `Policy ini harus memuat tepat prioritas ${expected}` }, 400);
  }
  for (const t of incoming) {
    if (!store.calendars.has(t.calendarId)) return c.json({ ok: false, error: `Kalender ${t.calendarId} tidak ditemukan` }, 400);
    if (t.responseMinutes >= t.resolutionMinutes) {
      return c.json({ ok: false, error: `${t.priority}: target respons harus lebih kecil dari target resolusi` }, 400);
    }
    if (t.resolutionMinutes > MAX_SLA_MINUTES) {
      return c.json({ ok: false, error: `${t.priority}: target resolusi maksimal 30 hari (${MAX_SLA_MINUTES} menit)` }, 400);
    }
  }

  const order = ['P1', 'P2', 'P3', 'P4'];
  policy.targets = incoming
    .map((t): SlaTargetRecord => ({ ...t }))
    .sort((a, b) => order.indexOf(a.priority) - order.indexOf(b.priority));
  policy.version += 1;
  policy.updatedAt = new Date();
  console.info(`[audit] ${session.id} mengubah target SLA ${policy.id} menjadi versi ${policy.version}`);
  if (!(await persistOrFail())) return c.json(DB_ERROR_RESULT, 500);
  return c.json({ ok: true, data: { version: policy.version, updatedAt: policy.updatedAt } });
});
