/**
 * Format waktu & durasi untuk UI. Konversi zona waktu HANYA dilakukan di sini:
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

const keyFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const toDate = (value: Date | string): Date =>
  typeof value === 'string' ? new Date(value) : value;

/** "21 Okt 2026 14.05" — dipakai di tooltip waktu absolut. */
export function formatDateTime(value: Date | string): string {
  return absoluteFmt.format(toDate(value)).replace(',', '');
}

/** "21 Okt 2026" */
export function formatDate(value: Date | string): string {
  return dateFmt.format(toDate(value));
}

/** "14.05" */
/** "21 Okt" untuk sumbu chart. */
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

/**
 * Format sisa waktu SLA dengan memperhitungkan tipe kalender:
 * - business_hours: 1 hari kerja = 8 jam kerja = 480 menit kerja (08:00–17:00 tanpa istirahat 12:00–13:00)
 * - 24x7: 1 hari = 24 jam = 1440 menit
 */
export function formatSlaRemaining(
  minutes: number,
  calendarKind: 'business_hours' | '24x7' = 'business_hours',
): string {
  const total = Math.max(0, Math.round(Math.abs(minutes)));
  if (calendarKind === 'business_hours') {
    const workDays = Math.floor(total / 480);
    const workHours = Math.floor((total % 480) / 60);
    const workMins = total % 60;

    if (workDays > 0) {
      return workHours > 0 ? `${workDays}h kerja ${workHours}j` : `${workDays} hari kerja`;
    }
    if (workHours > 0) {
      return workMins > 0 ? `${workHours}j ${workMins}m kerja` : `${workHours}j kerja`;
    }
    return `${workMins}m kerja`;
  }

  // 24x7
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const mins = total % 60;
  if (days > 0) return hours > 0 ? `${days}h ${hours}j` : `${days}h`;
  if (hours > 0) return mins > 0 ? `${hours}j ${mins}m` : `${hours}j`;
  return `${mins}m`;
}

/**
 * Format target SLA yang memperjelas basis perhitungan (mis. "5 hari kerja (40 jam kerja)"):
 */
export function formatSlaTarget(
  minutes: number,
  calendarKind: 'business_hours' | '24x7' = 'business_hours',
): string {
  if (calendarKind === 'business_hours') {
    if (minutes >= 480) {
      const workDays = Math.floor(minutes / 480);
      const remHours = Math.floor((minutes % 480) / 60);
      const totalHours = Math.round(minutes / 60);
      if (remHours > 0) {
        return `${workDays} hari kerja ${remHours} jam (${totalHours} jam kerja)`;
      }
      return `${workDays} hari kerja (${totalHours} jam kerja)`;
    }
    if (minutes >= 60) {
      const h = Math.floor(minutes / 60);
      const m = minutes % 60;
      return m > 0 ? `${h} jam ${m} menit kerja` : `${h} jam kerja`;
    }
    return `${minutes} menit kerja`;
  }

  // 24x7
  if (minutes >= 1440) {
    const days = Math.floor(minutes / 1440);
    return `${days} hari (24x7)`;
  }
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${hours} jam ${m} menit` : `${hours} jam (24x7)`;
  }
  return `${minutes} menit (24x7)`;
}

/** Durasi dalam jam dengan 1 desimal: "3,4 j" (untuk MTTA/MTTR). */
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
/** Angka dengan pemisah ribuan lokal. */
/** Inisial nama untuk avatar: "Rina Kusuma" → "RK". */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
