import { MINUTE_MS } from './types';

/**
 * Kalender bisnis (ITSM.md §4.2).
 *
 * Kenapa diimplementasikan dengan iterasi per hari lokal + konversi tiap batas jam kerja ke UTC:
 * - Tidak bergantung pada offset tetap (+07:00), jadi tetap benar untuk zona dengan DST.
 * - Hari libur & akhir pekan cukup dicek per tanggal lokal.
 * - Kompleksitas O(jumlah hari yang dilalui), cukup murah untuk target SLA (maks. beberapa minggu).
 */

export type CalendarKind = 'business_hours' | '24x7';

/** Interval jam kerja lokal, format "HH:MM" (24 jam). `end` eksklusif. */
export interface WorkInterval {
  start: string;
  end: string;
}

/** Jam kerja per hari dalam minggu: 0 = Minggu … 6 = Sabtu. Hari tanpa entri = libur. */
export type WeeklyHours = Readonly<Partial<Record<number, readonly WorkInterval[]>>>;

export interface BusinessCalendar {
  kind: CalendarKind;
  /** IANA timezone, mis. `Asia/Jakarta`. */
  timezone: string;
  workHours: WeeklyHours;
  /** Tanggal libur lokal format `YYYY-MM-DD`. */
  holidays: readonly string[];
}

const WEEKDAY_HOURS: readonly WorkInterval[] = [
  { start: '08:00', end: '12:00' },
  { start: '13:00', end: '17:00' },
];

/** Default: Senin–Jumat 08:00–17:00, istirahat 12:00–13:00 tidak dihitung. */
export const DEFAULT_WORK_HOURS: WeeklyHours = {
  1: WEEKDAY_HOURS,
  2: WEEKDAY_HOURS,
  3: WEEKDAY_HOURS,
  4: WEEKDAY_HOURS,
  5: WEEKDAY_HOURS,
};

export const DEFAULT_TIMEZONE = 'Asia/Jakarta';

/** Batas pencarian hari agar kalender tanpa jam kerja tidak membuat loop tak berujung. */
const MAX_DAYS = 3660;

interface LocalDate {
  y: number;
  m: number; // 1–12
  d: number;
}

// ---------------------------------------------------------------------------
// Zona waktu (Intl) — di-cache karena pembuatan formatter relatif mahal.
// ---------------------------------------------------------------------------

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timezone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(timezone, formatter);
  }
  return formatter;
}

interface ZonedParts extends LocalDate {
  hour: number;
  minute: number;
  second: number;
}

function zonedParts(epochMs: number, timezone: string): ZonedParts {
  const parts = getFormatter(timezone).formatToParts(new Date(epochMs));
  const pick = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value ?? NaN);
  return {
    y: pick('year'),
    m: pick('month'),
    d: pick('day'),
    hour: pick('hour'),
    minute: pick('minute'),
    second: pick('second'),
  };
}

/** Offset zona (ms) pada instant tertentu: waktuLokal − UTC. */
function timezoneOffsetMs(epochMs: number, timezone: string): number {
  const p = zonedParts(epochMs, timezone);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hour, p.minute, p.second);
  const truncated = Math.floor(epochMs / 1000) * 1000;
  return asUtc - truncated;
}

const boundaryCache = new Map<string, number>();
const BOUNDARY_CACHE_LIMIT = 50_000;

/** Mengonversi waktu lokal (tanggal + "HH:MM") di `timezone` menjadi epoch ms UTC. */
function zonedTimeToEpoch(date: LocalDate, hhmm: string, timezone: string): number {
  const key = `${timezone}|${date.y}-${date.m}-${date.d}|${hhmm}`;
  const cached = boundaryCache.get(key);
  if (cached !== undefined) return cached;

  const [hours, minutes] = parseHhmm(hhmm);
  const guess = Date.UTC(date.y, date.m - 1, date.d, hours, minutes);
  const firstOffset = timezoneOffsetMs(guess, timezone);
  let result = guess - firstOffset;
  // Koreksi sekali untuk transisi DST (offset berbeda di sekitar guess vs hasil).
  const secondOffset = timezoneOffsetMs(result, timezone);
  if (secondOffset !== firstOffset) result = guess - secondOffset;

  if (boundaryCache.size >= BOUNDARY_CACHE_LIMIT) boundaryCache.clear();
  boundaryCache.set(key, result);
  return result;
}

function parseHhmm(hhmm: string): [number, number] {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!match) throw new RangeError(`Format jam tidak valid: "${hhmm}" (harus HH:MM)`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 24 || minutes > 59 || (hours === 24 && minutes !== 0)) {
    throw new RangeError(`Jam di luar rentang: "${hhmm}"`);
  }
  return [hours, minutes];
}

// ---------------------------------------------------------------------------
// Tanggal lokal
// ---------------------------------------------------------------------------

function localDateOf(epochMs: number, timezone: string): LocalDate {
  const { y, m, d } = zonedParts(epochMs, timezone);
  return { y, m, d };
}

function addDays(date: LocalDate, days: number): LocalDate {
  const next = new Date(Date.UTC(date.y, date.m - 1, date.d + days));
  return { y: next.getUTCFullYear(), m: next.getUTCMonth() + 1, d: next.getUTCDate() };
}

function weekdayOf(date: LocalDate): number {
  return new Date(Date.UTC(date.y, date.m - 1, date.d)).getUTCDay();
}

/** Format `YYYY-MM-DD` (zero-padded sehingga bisa dibandingkan secara leksikografis). */
export function toDateKey(date: LocalDate): string {
  const mm = String(date.m).padStart(2, '0');
  const dd = String(date.d).padStart(2, '0');
  return `${date.y}-${mm}-${dd}`;
}

const holidaySetCache = new WeakMap<readonly string[], ReadonlySet<string>>();

function holidaySet(calendar: BusinessCalendar): ReadonlySet<string> {
  let set = holidaySetCache.get(calendar.holidays);
  if (!set) {
    set = new Set(calendar.holidays);
    holidaySetCache.set(calendar.holidays, set);
  }
  return set;
}

/** Interval kerja (epoch ms, [start, end)) untuk satu tanggal lokal. */
function workIntervalsFor(calendar: BusinessCalendar, date: LocalDate): Array<[number, number]> {
  if (holidaySet(calendar).has(toDateKey(date))) return [];
  const intervals = calendar.workHours[weekdayOf(date)] ?? [];
  return intervals.map(({ start, end }) => [
    zonedTimeToEpoch(date, start, calendar.timezone),
    zonedTimeToEpoch(date, end, calendar.timezone),
  ]);
}

function assertFiniteMinutes(minutes: number): void {
  if (!Number.isFinite(minutes))
    throw new RangeError(`Menit harus angka hingga, diterima ${minutes}`);
}

// ---------------------------------------------------------------------------
// API publik
// ---------------------------------------------------------------------------

/**
 * Menambahkan menit kerja ke sebuah instant.
 * @param start - titik awal (UTC instant)
 * @param minutes - menit kerja yang ditambahkan; ≤ 0 mengembalikan `start` apa adanya
 * @param calendar - kalender bisnis
 * @returns instant saat menit kerja habis
 * @throws RangeError jika `minutes` tidak hingga atau kalender tidak punya jam kerja dalam horizon
 */
export function addBusinessMinutes(start: Date, minutes: number, calendar: BusinessCalendar): Date {
  assertFiniteMinutes(minutes);
  const cursor = start.getTime();
  if (minutes <= 0) return new Date(cursor);
  if (calendar.kind === '24x7') return new Date(cursor + minutes * MINUTE_MS);

  let remaining = minutes * MINUTE_MS;
  let day = localDateOf(cursor, calendar.timezone);
  for (let i = 0; i < MAX_DAYS; i++) {
    for (const [intervalStart, intervalEnd] of workIntervalsFor(calendar, day)) {
      if (intervalEnd <= cursor) continue;
      const from = Math.max(intervalStart, cursor);
      const available = intervalEnd - from;
      if (remaining <= available) return new Date(from + remaining);
      remaining -= available;
    }
    day = addDays(day, 1);
  }
  throw new RangeError('Kalender tidak memiliki jam kerja dalam horizon pencarian');
}

/**
 * Menghitung menit kerja di antara dua instant.
 * @param a - awal
 * @param b - akhir
 * @param calendar - kalender bisnis
 * @returns menit kerja (bisa pecahan); 0 jika `b <= a`
 */
export function businessMinutesBetween(a: Date, b: Date, calendar: BusinessCalendar): number {
  const from = a.getTime();
  const to = b.getTime();
  if (to <= from) return 0;
  if (calendar.kind === '24x7') return (to - from) / MINUTE_MS;

  let total = 0;
  let day = localDateOf(from, calendar.timezone);
  const lastKey = toDateKey(localDateOf(to, calendar.timezone));
  for (let i = 0; i < MAX_DAYS; i++) {
    for (const [intervalStart, intervalEnd] of workIntervalsFor(calendar, day)) {
      const overlap = Math.min(intervalEnd, to) - Math.max(intervalStart, from);
      if (overlap > 0) total += overlap;
    }
    if (toDateKey(day) >= lastKey) break;
    day = addDays(day, 1);
  }
  return total / MINUTE_MS;
}

/**
 * Mengecek apakah sebuah instant berada di dalam jam kerja.
 * @param at - instant yang dicek
 * @param calendar - kalender bisnis
 */
export function isWithinBusinessHours(at: Date, calendar: BusinessCalendar): boolean {
  if (calendar.kind === '24x7') return true;
  const t = at.getTime();
  return workIntervalsFor(calendar, localDateOf(t, calendar.timezone)).some(
    ([s, e]) => t >= s && t < e,
  );
}

/**
 * Membuat kalender 24×7 (dipakai P1).
 * @param timezone - zona tampilan
 */
export function create24x7Calendar(timezone: string = DEFAULT_TIMEZONE): BusinessCalendar {
  return { kind: '24x7', timezone, workHours: {}, holidays: [] };
}

/**
 * Membuat kalender jam kerja default (Senin–Jumat 08–17, istirahat 12–13).
 * @param holidays - daftar tanggal libur `YYYY-MM-DD`
 * @param timezone - zona kalender
 */
export function createBusinessCalendar(
  holidays: readonly string[] = [],
  timezone: string = DEFAULT_TIMEZONE,
  workHours: WeeklyHours = DEFAULT_WORK_HOURS,
): BusinessCalendar {
  return { kind: 'business_hours', timezone, workHours, holidays };
}
