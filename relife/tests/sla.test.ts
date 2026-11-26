import { describe, expect, it } from 'bun:test';
import {
  addBusinessMinutes,
  businessMinutesBetween,
  create24x7Calendar,
  createBusinessCalendar,
} from '@/domain/calendar';
import { calculatePriority, calculateTicketPriority } from '@/domain/priority';
import { computeSlaState, createSlaInstances, pause, reopen, resume, stop } from '@/domain/sla';
import { CAL_24X7 } from '@/server/mock/reference-data';
import { seedStore } from '@/server/mock/seed';
import { createEmptyStore } from '@/server/mock/store';
import { createTicket, overridePriority, runSlaTick } from '@/server/mock/ticket-engine';
import { getDashboardMetrics } from '@/server/queries/dashboard';

/** Waktu lokal WIB (UTC+7) → Date. */
const wib = (s: string): Date => new Date(`${s}+07:00`);
const cal = createBusinessCalendar(['2026-08-17']);

describe('business calendar (Asia/Jakarta)', () => {
  it('Friday 16:30 + 60m rolls over the weekend to Monday 08:30', () => {
    expect(addBusinessMinutes(wib('2026-03-13T16:30'), 60, cal)).toEqual(wib('2026-03-16T08:30'));
  });

  it('skips the 12:00–13:00 lunch break', () => {
    expect(addBusinessMinutes(wib('2026-03-16T11:30'), 60, cal)).toEqual(wib('2026-03-16T13:30'));
    expect(businessMinutesBetween(wib('2026-03-16T11:30'), wib('2026-03-16T13:30'), cal)).toBe(60);
  });

  it('skips holidays (Mon 17 Aug 2026) and weekends', () => {
    const due = addBusinessMinutes(wib('2026-08-14T16:00'), 120, cal);
    expect(due).toEqual(wib('2026-08-18T09:00'));
    expect(businessMinutesBetween(wib('2026-08-14T16:00'), due, cal)).toBe(120);
  });

  it('24x7 counts wall-clock minutes', () => {
    const c = create24x7Calendar();
    expect(addBusinessMinutes(wib('2026-03-13T16:30'), 240, c)).toEqual(wib('2026-03-13T20:30'));
  });
});

describe('priority matrix', () => {
  it('maps impact × urgency and caps service requests at P3', () => {
    expect(calculatePriority('high', 'high')).toBe('P1');
    expect(calculatePriority('medium', 'medium')).toBe('P3');
    expect(calculatePriority('low', 'low')).toBe('P4');
    expect(calculateTicketPriority('service_request', 'high', 'high')).toBe('P3');
  });
});

describe('SLA instance lifecycle', () => {
  it('pause over the weekend shifts dueAt by the paused business time', () => {
    const { resolution } = createSlaInstances(
      wib('2026-03-13T10:00'),
      { responseMinutes: 60, resolutionMinutes: 480 },
      cal,
    );
    const paused = pause(resolution, wib('2026-03-13T16:00'), cal);
    expect(paused.elapsedMinutes).toBe(300);
    const resumed = resume(paused, wib('2026-03-16T10:00'), cal);
    expect(resumed.pausedMinutes).toBe(180);
    expect(resumed.dueAt).toEqual(wib('2026-03-16T14:00'));
  });

  it('stop → met/breached; reopen keeps elapsed and breach is permanent', () => {
    const { response } = createSlaInstances(
      wib('2026-03-16T08:00'),
      { responseMinutes: 60, resolutionMinutes: 480 },
      cal,
    );
    expect(stop(response, wib('2026-03-16T08:30'), cal).status).toBe('met');
    const late = stop(response, wib('2026-03-16T10:00'), cal);
    expect(late.status).toBe('breached');
    expect(late.breachedAt).toEqual(wib('2026-03-16T09:00'));
    const reopened = reopen(late, wib('2026-03-17T08:00'), cal);
    expect(reopened.elapsedMinutes).toBe(120);
    expect(computeSlaState(reopened, wib('2026-03-17T08:00'), cal).breached).toBe(true);
  });
});

function freshStore(now: Date) {
  const store = createEmptyStore(now);
  seedStore(store, now);
  return store;
}

function newP3Ticket(store: ReturnType<typeof freshStore>, now: Date) {
  return createTicket(
    store,
    {
      catalogItemId: 'cat-item-pc-server',
      title: 'Laptop mati',
      description: 'Tidak bisa menyala',
      urgency: 'medium',
      impact: 'medium',
      formData: {},
    },
    store.users.get('usr-user')!,
    now,
  );
}

describe('engine SLA', () => {
  it('priority change P3 → P1 switches the SLA to the 24×7 calendar', () => {
    const now = wib('2026-03-13T16:30');
    const store = freshStore(now);
    const t = newP3Ticket(store, now);
    expect(t.priority).toBe('P3');
    const later = wib('2026-03-13T16:45'); // 15 menit kerja terpakai
    overridePriority(store, t.id, 'P1', 'Server produksi down', store.users.get('usr-lead')!, later);
    const { response, resolution } = store.sla.get(t.id)!;
    expect(resolution.calendarId).toBe(CAL_24X7);
    expect(resolution.targetMinutes).toBe(240);
    expect(resolution.dueAt).toEqual(wib('2026-03-13T20:30')); // 16:45 + (240 − 15) menit
    expect(response.breachedAt).toEqual(later); // 15 menit ≥ target respons P1 15 menit
  });

  it('runSlaTick emits warning and breach exactly once', () => {
    const now = wib('2026-03-16T08:00');
    const store = freshStore(now);
    const t = newP3Ticket(store, now); // respons P3 = 240 menit kerja
    const count = (type: string) =>
      (store.events.get(t.id) ?? []).filter((e) => e.type === type).length;
    runSlaTick(store, wib('2026-03-16T11:30')); // 240m*75% = 180m → 11:00
    runSlaTick(store, wib('2026-03-16T11:45'));
    expect(count('sla_breached')).toBe(0);
    expect(count('sla_warning')).toBe(1);
    runSlaTick(store, wib('2026-03-16T13:30')); // due 12:00
    runSlaTick(store, wib('2026-03-16T14:00'));
    expect(count('sla_breached')).toBe(1);
    expect(store.sla.get(t.id)!.response.breachedAt).toEqual(wib('2026-03-16T12:00'));
  });
});

describe('dashboard SLA compliance', () => {
  it('counts an active ticket that already breached against compliance', () => {
    const g = globalThis as typeof globalThis & { __sigapStore?: unknown };
    const previous = g.__sigapStore;
    const now = new Date();
    const store = freshStore(now);
    store.tickets.clear();
    store.sla.clear();
    const t = newP3Ticket(store, now);
    const pair = store.sla.get(t.id)!;
    store.sla.set(t.id, { ...pair, response: { ...pair.response, breachedAt: now } });
    store.workerLastTick = now;
    g.__sigapStore = store;
    try {
      expect(getDashboardMetrics(30).kpis.responseSlaPercent).toBe(0);
    } finally {
      g.__sigapStore = previous;
    }
  });
});
