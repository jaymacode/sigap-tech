/**
 * Format waktu & durasi untuk UI. Konversi zona waktu HANYA dilakukan di sini (AGENTS.md):
 * data disimpan/dikirim sebagai UTC ISO string.
 */

export const APP_TZ = 'Asia/Jakarta';
const LOCALE = 'id-ID';

const absoluteFmt = new Intl.DateTimeFormat(LOCALE, {
  timeZone: APP_TZ,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const dateFmt = new Intl.DateTimeFormat(LOCALE, {
  timeZone: APP_TZ,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

const dayHeadingFmt = new Intl.DateTimeFormat(LOCALE, {
  timeZone: APP_TZ,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const timeFmt = new Intl.DateTimeFormat(LOCALE, {
  timeZone: APP_TZ,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const shortDayFmt = new Intl.DateTimeFormat(LOCALE, {
  timeZone: APP_TZ,
  day: '2-digit',
  month: 'short',
});

const keyFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const toDate = (value: Date | string): Date => (typeof value === 'string' ? new Date(value) : value);

/** "21 Okt 2026 14.05" — dipakai di tooltip waktu absolut. */
export function formatDateTime(value: Date | string): string {
  return absoluteFmt.format(toDate(value)).replace(',', '');
}

/** "21 Okt 2026" */
export function formatDate(value: Date | string): string {
  return dateFmt.format(toDate(value));
}

/** "14.05" */
export function formatTime(value: Date | string): string {
  return timeFmt.format(toDate(value));
}

/** "21 Okt" untuk sumbu chart. */
export function formatShortDay(value: Date | string): string {
  return shortDayFmt.format(toDate(value));
}

/** "Rabu, 21 Oktober 2026" untuk heading grup timeline. */
export function formatDayHeading(value: Date | string): string {
  return dayHeadingFmt.format(toDate(value));
}

/** Kunci tanggal lokal `YYYY-MM-DD` di zona aplikasi (untuk grouping). */
export function localDateKey(value: Date | string): string {
  return keyFmt.format(toDate(value));
}

/**
 * Durasi ringkas berbahasa Indonesia: "2j 14m", "45m", "3h 2j" (h = hari).
 * @param minutes - durasi dalam menit (nilai absolut yang dipakai)
 */
export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(Math.abs(minutes)));
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const mins = total % 60;
  if (days > 0) return hours > 0 ? `${days}h ${hours}j` : `${days}h`;
  if (hours > 0) return mins > 0 ? `${hours}j ${mins}m` : `${hours}j`;
  return `${mins}m`;
}

/** Durasi dalam jam dengan 1 desimal: "3,4 j" (untuk MTTA/MTTR). */
export function formatHours(minutes: number): string {
  return `${(minutes / 60).toLocaleString(LOCALE, { maximumFractionDigits: 1, minimumFractionDigits: 1 })} j`;
}

const rtf = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });

/**
 * Waktu relatif: "3 jam yang lalu", "kemarin".
 * @param value - waktu yang diformat
 * @param now - waktu acuan (diinjeksi agar deterministik di SSR/test)
 */
export function formatRelative(value: Date | string, now: Date): string {
  const diffMs = toDate(value).getTime() - now.getTime();
  const abs = Math.abs(diffMs);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (abs < minute) return 'baru saja';
  if (abs < hour) return rtf.format(Math.round(diffMs / minute), 'minute');
  if (abs < day) return rtf.format(Math.round(diffMs / hour), 'hour');
  if (abs < 30 * day) return rtf.format(Math.round(diffMs / day), 'day');
  return formatDate(value);
}

/** Persentase "94,2%". */
export function formatPercent(value: number, digits = 1): string {
  return `${value.toLocaleString(LOCALE, { maximumFractionDigits: digits, minimumFractionDigits: digits })}%`;
}

/** Angka dengan pemisah ribuan lokal. */
export function formatNumber(value: number): string {
  return value.toLocaleString(LOCALE);
}

/** Inisial nama untuk avatar: "Rina Kusuma" → "RK". */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
