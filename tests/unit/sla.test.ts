import { describe, expect, it } from 'vitest';
import { create24x7Calendar, createBusinessCalendar } from '@/domain/calendar';
import {
  cancel,
  computeSlaState,
  createSlaInstances,
  elapsedAt,
  isSlaStopped,
  pause,
  rebaseline,
  reopen,
  resume,
  stop,
} from '@/domain/sla';

const jkt = (iso: string): Date => new Date(`${iso}+07:00`);
const cal = createBusinessCalendar();
const created = jkt('2026-10-21T09:00'); // Rabu
// P3: response 4 jam kerja, resolution 24 jam kerja.
const P3 = { responseMinutes: 240, resolutionMinutes: 1440 };

describe('createSlaInstances', () => {
  it('membuat response & resolution dengan warnAt 75% dan dueAt 100%', () => {
    const { response, resolution } = createSlaInstances(created, P3, cal);
    expect(response.status).toBe('running');
    expect(response.warnAt).toEqual(jkt('2026-10-21T12:00')); // 180 menit habis tepat di akhir sesi pagi
    expect(response.dueAt).toEqual(jkt('2026-10-21T14:00'));
    expect(resolution.kind).toBe('resolution');
    // 1440 menit: Rabu 420 + Kamis 480 + Jumat 480 + Senin 60 → Senin 09:00.
    expect(resolution.dueAt).toEqual(jkt('2026-10-26T09:00'));
  });

  it('menolak target negatif', () => {
    expect(() =>
      createSlaInstances(created, { responseMinutes: -1, resolutionMinutes: 1 }, cal),
    ).toThrow(RangeError);
  });
});

describe('computeSlaState thresholds', () => {
  const { response } = createSlaInstances(created, P3, cal);

  it('running di bawah 75%', () => {
    const s = computeSlaState(response, jkt('2026-10-21T10:00'), cal);
    expect(s.status).toBe('running');
    expect(s.atRisk).toBe(false);
    expect(s.remainingMinutes).toBe(180);
  });

  it('at_risk di 75%', () => {
    const s = computeSlaState(response, jkt('2026-10-21T13:00'), cal);
    expect(s.percentUsed).toBe(75);
    expect(s.atRisk).toBe(true);
    expect(s.breached).toBe(false);
  });

  it('breached di 100% dengan sisa negatif', () => {
    const s = computeSlaState(response, jkt('2026-10-21T14:35'), cal);
    expect(s.status).toBe('breached');
    expect(s.breached).toBe(true);
    expect(s.remainingMinutes).toBe(-35);
    expect(s.atRisk).toBe(false);
  });

  it('target 0 dianggap 100% terpakai', () => {
    const { response: zero } = createSlaInstances(
      created,
      { responseMinutes: 0, resolutionMinutes: 0 },
      cal,
    );
    expect(computeSlaState(zero, created, cal).percentUsed).toBe(100);
  });
});

describe('pause / resume', () => {
  const { resolution } = createSlaInstances(created, P3, cal);

  it('pause membekukan elapsed', () => {
    const paused = pause(resolution, jkt('2026-10-21T10:00'), cal);
    expect(paused.status).toBe('paused');
    expect(elapsedAt(paused, jkt('2026-10-22T10:00'), cal)).toBe(60);
    expect(computeSlaState(paused, jkt('2026-10-22T10:00'), cal).status).toBe('paused');
  });

  it('resume menggeser dueAt sebesar durasi pause (menit kerja)', () => {
    const paused = pause(resolution, jkt('2026-10-21T10:00'), cal);
    const resumed = resume(paused, jkt('2026-10-21T11:00'), cal);
    expect(resumed.status).toBe('running');
    expect(resumed.pausedMinutes).toBe(60);
    expect(resumed.dueAt.getTime() - resolution.dueAt.getTime()).toBe(60 * 60_000);
  });

  it('pause di luar jam kerja tidak menggeser dueAt', () => {
    const paused = pause(resolution, jkt('2026-10-23T17:30'), cal); // Jumat sore
    const resumed = resume(paused, jkt('2026-10-24T10:00'), cal); // Sabtu
    expect(resumed.dueAt).toEqual(resolution.dueAt);
    expect(resumed.pausedMinutes).toBe(0);
  });

  it('operasi tak berlaku mengembalikan referensi sama', () => {
    expect(resume(resolution, created, cal)).toBe(resolution);
    const paused = pause(resolution, created, cal);
    expect(pause(paused, created, cal)).toBe(paused);
  });
});

describe('stop', () => {
  it('response stop saat first response → met; resolution tidak terpengaruh', () => {
    const { response, resolution } = createSlaInstances(created, P3, cal);
    const stopped = stop(response, jkt('2026-10-21T10:30'), cal);
    expect(stopped.status).toBe('met');
    expect(stopped.elapsedMinutes).toBe(90);
    expect(stopped.stoppedAt).toEqual(jkt('2026-10-21T10:30'));
    expect(resolution.status).toBe('running');
  });

  it('stop setelah due → breached, breachedAt = dueAt', () => {
    const { response } = createSlaInstances(created, P3, cal);
    const stopped = stop(response, jkt('2026-10-21T15:00'), cal);
    expect(stopped.status).toBe('breached');
    expect(stopped.breachedAt).toEqual(response.dueAt);
  });

  it('stop dari paused menambah pausedMinutes', () => {
    const { resolution } = createSlaInstances(created, P3, cal);
    const paused = pause(resolution, jkt('2026-10-21T10:00'), cal);
    const stopped = stop(paused, jkt('2026-10-21T11:00'), cal);
    expect(stopped.pausedMinutes).toBe(60);
    expect(stopped.status).toBe('met');
  });

  it('stop pada instance berhenti = no-op', () => {
    const { response } = createSlaInstances(created, P3, cal);
    const stopped = stop(response, jkt('2026-10-21T10:00'), cal);
    expect(stop(stopped, jkt('2026-10-21T11:00'), cal)).toBe(stopped);
  });
});

describe('reopen', () => {
  it('melanjutkan elapsed sebelumnya, tidak reset', () => {
    const { resolution } = createSlaInstances(created, P3, cal);
    const resolved = stop(resolution, jkt('2026-10-21T11:00'), cal); // 120 menit
    const reopened = reopen(resolved, jkt('2026-10-22T08:00'), cal);
    expect(reopened.status).toBe('running');
    expect(elapsedAt(reopened, jkt('2026-10-22T09:00'), cal)).toBe(180);
    // Sisa 1320: Kamis 480 + Jumat 480 + Senin 240 (pagi) + 120 → Senin 15:00.
    expect(reopened.dueAt).toEqual(jkt('2026-10-26T15:00'));
  });

  it('breach tetap permanen setelah reopen', () => {
    const { response } = createSlaInstances(created, P3, cal);
    const breached = stop(response, jkt('2026-10-21T16:00'), cal);
    const reopened = reopen(breached, jkt('2026-10-22T08:00'), cal);
    expect(computeSlaState(reopened, jkt('2026-10-22T08:00'), cal).breached).toBe(true);
  });

  it('reopen instance running = no-op', () => {
    const { resolution } = createSlaInstances(created, P3, cal);
    expect(reopen(resolution, created, cal)).toBe(resolution);
  });
});

describe('rebaseline (ITSM.md §4.5)', () => {
  it('prioritas naik: target lebih pendek, dueAt maju', () => {
    const { resolution } = createSlaInstances(created, P3, cal);
    const r = rebaseline(resolution, 480, jkt('2026-10-21T10:00'), cal); // P2: 8 jam kerja
    expect(r.breachedImmediately).toBe(false);
    // Elapsed 60, sisa 420 dari Rabu 10:00 → Kamis 09:00.
    expect(r.newDueAt).toEqual(jkt('2026-10-22T09:00'));
    expect(r.previousDueAt).toEqual(resolution.dueAt);
    expect(r.instance.targetMinutes).toBe(480);
  });

  it('prioritas turun: dueAt mundur', () => {
    const { response } = createSlaInstances(created, P3, cal);
    const r = rebaseline(response, 480, jkt('2026-10-21T10:00'), cal);
    expect(r.newDueAt.getTime()).toBeGreaterThan(response.dueAt.getTime());
  });

  it('target baru sudah terlewati → langsung breached', () => {
    const { response } = createSlaInstances(created, P3, cal);
    const now = jkt('2026-10-21T10:00'); // elapsed 60 menit
    const r = rebaseline(response, 15, now, cal);
    expect(r.breachedImmediately).toBe(true);
    expect(r.instance.breachedAt).toEqual(now);
    expect(computeSlaState(r.instance, now, cal).status).toBe('breached');
  });

  it('instance berhenti tidak diubah', () => {
    const { response } = createSlaInstances(created, P3, cal);
    const met = stop(response, jkt('2026-10-21T09:30'), cal);
    const r = rebaseline(met, 15, jkt('2026-10-21T10:00'), cal);
    expect(r.instance).toBe(met);
  });

  it('menolak target negatif', () => {
    const { response } = createSlaInstances(created, P3, cal);
    expect(() => rebaseline(response, -5, created, cal)).toThrow(RangeError);
  });
});

describe('cancel', () => {
  it('cancelled dikecualikan: status cancelled, tidak at risk / breached', () => {
    const { resolution } = createSlaInstances(created, P3, cal);
    const c = cancel(resolution, jkt('2026-10-21T10:00'), cal);
    const s = computeSlaState(c, jkt('2026-10-30T10:00'), cal);
    expect(s.status).toBe('cancelled');
    expect(s.atRisk).toBe(false);
    expect(s.breached).toBe(false);
    expect(isSlaStopped(c.status)).toBe(true);
  });

  it('instance yang sudah met tidak diubah', () => {
    const { response } = createSlaInstances(created, P3, cal);
    const met = stop(response, jkt('2026-10-21T09:30'), cal);
    expect(cancel(met, jkt('2026-10-21T10:00'), cal)).toBe(met);
  });
});

describe('kalender 24x7 (P1)', () => {
  it('menghitung waktu biasa termasuk akhir pekan', () => {
    const c24 = create24x7Calendar();
    const { response } = createSlaInstances(
      jkt('2026-10-24T22:00'),
      { responseMinutes: 15, resolutionMinutes: 240 },
      c24,
    );
    expect(response.dueAt).toEqual(jkt('2026-10-24T22:15'));
    expect(computeSlaState(response, jkt('2026-10-24T22:12'), c24).atRisk).toBe(true);
  });
});
