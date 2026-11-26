import { addBusinessMinutes, businessMinutesBetween, type BusinessCalendar } from './calendar';
import type { SlaKind, SlaStatus } from './types';

/**
 * SLA engine (ITSM.md §4.3–4.6). Semua fungsi murni & immutable: mengembalikan instance baru.
 *
 * Model: `elapsedMinutes` = akumulasi menit kalender policy sampai `runningSince`.
 * Dengan begitu state tidak perlu dihitung ulang dari nol setiap request (ITSM.md §4.3),
 * dan `warnAt`/`dueAt` absolut membuat query worker murah (ADR-001).
 *
 * Konvensi no-op: operasi yang tidak berlaku untuk status saat ini mengembalikan
 * **referensi objek yang sama**, sehingga service bisa mendeteksi perubahan dengan `next !== prev`
 * dan hanya menulis event bila ada perubahan.
 */

export const WARN_RATIO = 0.75;

export interface SlaInstance {
  kind: SlaKind;
  targetMinutes: number;
  status: SlaStatus;
  startedAt: Date;
  /** null saat paused/stopped. */
  runningSince: Date | null;
  /** Waktu mulai pause terakhir (lihat ADR-006). */
  pausedAt: Date | null;
  stoppedAt: Date | null;
  elapsedMinutes: number;
  pausedMinutes: number;
  warnAt: Date;
  dueAt: Date;
  warnedAt: Date | null;
  breachedAt: Date | null;
}

export interface SlaTargets {
  responseMinutes: number;
  resolutionMinutes: number;
}

export type SlaDisplayStatus = 'running' | 'paused' | 'met' | 'breached' | 'cancelled';

export interface SlaState {
  status: SlaDisplayStatus;
  percentUsed: number;
  /** Negatif bila sudah lewat target. */
  remainingMinutes: number;
  elapsedMinutes: number;
  /** ≥ 75% dan belum breach, clock masih aktif (running/paused). */
  atRisk: boolean;
  /** Breach bersifat permanen (ITSM.md §4.4). */
  breached: boolean;
}

function newInstance(
  kind: SlaKind,
  targetMinutes: number,
  start: Date,
  calendar: BusinessCalendar,
): SlaInstance {
  return {
    kind,
    targetMinutes,
    status: 'running',
    startedAt: start,
    runningSince: start,
    pausedAt: null,
    stoppedAt: null,
    elapsedMinutes: 0,
    pausedMinutes: 0,
    warnAt: addBusinessMinutes(start, targetMinutes * WARN_RATIO, calendar),
    dueAt: addBusinessMinutes(start, targetMinutes, calendar),
    warnedAt: null,
    breachedAt: null,
  };
}

/**
 * Membuat dua SLA instance (response & resolution) saat tiket dibuat.
 * @param createdAt - waktu tiket dibuat
 * @param targets - snapshot target menit dari policy (ITSM.md §4.6)
 * @param calendar - kalender policy
 * @throws RangeError jika target negatif
 */
export function createSlaInstances(
  createdAt: Date,
  targets: SlaTargets,
  calendar: BusinessCalendar,
): { response: SlaInstance; resolution: SlaInstance } {
  if (targets.responseMinutes < 0 || targets.resolutionMinutes < 0) {
    throw new RangeError('Target SLA tidak boleh negatif');
  }
  return {
    response: newInstance('response', targets.responseMinutes, createdAt, calendar),
    resolution: newInstance('resolution', targets.resolutionMinutes, createdAt, calendar),
  };
}

/**
 * Menit kerja yang sudah terpakai pada `now`.
 * @param instance - SLA instance
 * @param now - waktu sekarang (diinjeksi)
 * @param calendar - kalender policy
 */
export function elapsedAt(instance: SlaInstance, now: Date, calendar: BusinessCalendar): number {
  if (instance.status === 'running' && instance.runningSince) {
    return instance.elapsedMinutes + businessMinutesBetween(instance.runningSince, now, calendar);
  }
  return instance.elapsedMinutes;
}

function percentOf(elapsed: number, target: number): number {
  if (target <= 0) return 100;
  return (elapsed / target) * 100;
}

/**
 * Menghitung state SLA untuk ditampilkan / dievaluasi worker.
 * @param instance - SLA instance
 * @param now - waktu sekarang
 * @param calendar - kalender policy
 * @returns status, persen terpakai, sisa menit
 */
export function computeSlaState(
  instance: SlaInstance,
  now: Date,
  calendar: BusinessCalendar,
): SlaState {
  const elapsed = elapsedAt(instance, now, calendar);
  const percentUsed = percentOf(elapsed, instance.targetMinutes);
  const clockActive = instance.status === 'running' || instance.status === 'paused';
  const breached =
    instance.status === 'breached' ||
    instance.breachedAt !== null ||
    (clockActive && percentUsed >= 100);

  let status: SlaDisplayStatus;
  switch (instance.status) {
    case 'running':
      status = breached ? 'breached' : 'running';
      break;
    default:
      status = instance.status;
  }

  return {
    status,
    percentUsed,
    remainingMinutes: instance.targetMinutes - elapsed,
    elapsedMinutes: elapsed,
    atRisk: clockActive && !breached && percentUsed >= WARN_RATIO * 100,
    breached,
  };
}

/**
 * Menjeda clock (status → Pending). Hanya berlaku untuk instance `running`.
 * @returns instance baru, atau referensi sama bila tidak berlaku
 */
export function pause(instance: SlaInstance, now: Date, calendar: BusinessCalendar): SlaInstance {
  if (instance.status !== 'running') return instance;
  return {
    ...instance,
    status: 'paused',
    elapsedMinutes: elapsedAt(instance, now, calendar),
    runningSince: null,
    pausedAt: now,
  };
}

/** Menghitung ulang warnAt/dueAt dari titik `now` berdasarkan sisa menit. */
function rescheduleFrom(
  now: Date,
  targetMinutes: number,
  elapsedMinutes: number,
  calendar: BusinessCalendar,
): Pick<SlaInstance, 'warnAt' | 'dueAt'> {
  return {
    warnAt: addBusinessMinutes(now, targetMinutes * WARN_RATIO - elapsedMinutes, calendar),
    dueAt: addBusinessMinutes(now, targetMinutes - elapsedMinutes, calendar),
  };
}

/**
 * Melanjutkan clock setelah Pending. `dueAt` bergeser sebesar durasi pause dalam menit kalender
 * (pause di luar jam kerja tidak menggeser).
 * @returns instance baru, atau referensi sama bila tidak berlaku
 */
export function resume(instance: SlaInstance, now: Date, calendar: BusinessCalendar): SlaInstance {
  if (instance.status !== 'paused') return instance;
  const pausedFor = instance.pausedAt
    ? businessMinutesBetween(instance.pausedAt, now, calendar)
    : 0;
  return {
    ...instance,
    status: 'running',
    runningSince: now,
    pausedAt: null,
    pausedMinutes: instance.pausedMinutes + pausedFor,
    ...rescheduleFrom(now, instance.targetMinutes, instance.elapsedMinutes, calendar),
  };
}

/**
 * Menghentikan clock (first response / Resolved). Hasil `met` atau `breached`.
 * @returns instance baru, atau referensi sama bila clock sudah berhenti
 */
export function stop(instance: SlaInstance, now: Date, calendar: BusinessCalendar): SlaInstance {
  if (instance.status !== 'running' && instance.status !== 'paused') return instance;
  const elapsed = elapsedAt(instance, now, calendar);
  const pausedFor =
    instance.status === 'paused' && instance.pausedAt
      ? businessMinutesBetween(instance.pausedAt, now, calendar)
      : 0;
  const breached =
    instance.breachedAt !== null || percentOf(elapsed, instance.targetMinutes) >= 100;
  const breachedAt =
    instance.breachedAt ??
    (breached ? new Date(Math.min(instance.dueAt.getTime(), now.getTime())) : null);
  return {
    ...instance,
    status: breached ? 'breached' : 'met',
    elapsedMinutes: elapsed,
    pausedMinutes: instance.pausedMinutes + pausedFor,
    runningSince: null,
    pausedAt: null,
    stoppedAt: now,
    breachedAt,
  };
}

/**
 * Membatalkan clock (tiket Cancelled) — dikecualikan dari compliance.
 * Instance yang sudah berhenti (met/breached) tidak diubah.
 */
export function cancel(instance: SlaInstance, now: Date, calendar: BusinessCalendar): SlaInstance {
  if (instance.status !== 'running' && instance.status !== 'paused') return instance;
  return {
    ...instance,
    status: 'cancelled',
    elapsedMinutes: elapsedAt(instance, now, calendar),
    runningSince: null,
    pausedAt: null,
    stoppedAt: now,
  };
}

/**
 * Reopen: melanjutkan dari elapsed sebelumnya (tidak reset). Breach tetap permanen.
 * @returns instance baru, atau referensi sama bila instance belum berhenti
 */
export function reopen(instance: SlaInstance, now: Date, calendar: BusinessCalendar): SlaInstance {
  if (instance.status !== 'met' && instance.status !== 'breached') return instance;
  return {
    ...instance,
    status: 'running',
    runningSince: now,
    stoppedAt: null,
    ...rescheduleFrom(now, instance.targetMinutes, instance.elapsedMinutes, calendar),
  };
}

export interface RebaselineResult {
  instance: SlaInstance;
  previousDueAt: Date;
  newDueAt: Date;
  /** true bila target baru sudah terlewati sehingga langsung breached. */
  breachedImmediately: boolean;
}

/**
 * Rebaseline karena perubahan prioritas (ITSM.md §4.5): target baru dihitung dari awal tiket
 * dikurangi pause (= elapsed kerja saat ini). Jika sudah terlewati → langsung breached.
 * Instance yang sudah berhenti tidak diubah.
 * @param newTargetMinutes - target untuk prioritas baru
 * @throws RangeError jika target negatif
 */
export function rebaseline(
  instance: SlaInstance,
  newTargetMinutes: number,
  now: Date,
  calendar: BusinessCalendar,
): RebaselineResult {
  if (newTargetMinutes < 0) throw new RangeError('Target SLA tidak boleh negatif');
  const previousDueAt = instance.dueAt;
  if (instance.status !== 'running' && instance.status !== 'paused') {
    return { instance, previousDueAt, newDueAt: previousDueAt, breachedImmediately: false };
  }
  const elapsed = elapsedAt(instance, now, calendar);
  const exceeded = percentOf(elapsed, newTargetMinutes) >= 100;
  const breachedImmediately = exceeded && instance.breachedAt === null;
  const schedule = rescheduleFrom(now, newTargetMinutes, elapsed, calendar);
  const next: SlaInstance = {
    ...instance,
    targetMinutes: newTargetMinutes,
    ...schedule,
    breachedAt: instance.breachedAt ?? (exceeded ? now : null),
  };
  return { instance: next, previousDueAt, newDueAt: schedule.dueAt, breachedImmediately };
}

/** true bila status SLA sudah final (tidak lagi berjalan). */
export function isSlaStopped(status: SlaStatus): boolean {
  return status === 'met' || status === 'breached' || status === 'cancelled';
}
