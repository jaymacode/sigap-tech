import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  addBusinessMinutes,
  businessMinutesBetween,
  create24x7Calendar,
  createBusinessCalendar,
  isWithinBusinessHours,
  type BusinessCalendar,
} from '@/domain/calendar';

/** Helper: waktu lokal Jakarta (UTC+7, tanpa DST) → Date UTC. */
const jkt = (iso: string): Date => new Date(`${iso}+07:00`);

// 2026-08-17 (Senin) = HUT RI.
const cal = createBusinessCalendar(['2026-08-17']);

describe('addBusinessMinutes', () => {
  it('mulai di dalam jam kerja, selesai di hari sama', () => {
    expect(addBusinessMinutes(jkt('2026-10-21T09:00'), 90, cal)).toEqual(jkt('2026-10-21T10:30'));
  });

  it('melewati istirahat 12–13', () => {
    expect(addBusinessMinutes(jkt('2026-10-21T11:30'), 60, cal)).toEqual(jkt('2026-10-21T13:30'));
  });

  it('mulai saat istirahat dihitung dari 13:00', () => {
    expect(addBusinessMinutes(jkt('2026-10-21T12:15'), 30, cal)).toEqual(jkt('2026-10-21T13:30'));
  });

  it('melewati jam pulang → lanjut 08:00 hari kerja berikutnya', () => {
    expect(addBusinessMinutes(jkt('2026-10-21T16:00'), 120, cal)).toEqual(jkt('2026-10-22T09:00'));
  });

  it('Jumat 16:30 + 60 menit → Senin 08:30', () => {
    expect(addBusinessMinutes(jkt('2026-10-23T16:30'), 60, cal)).toEqual(jkt('2026-10-26T08:30'));
  });

  it('mulai Sabtu → dihitung dari Senin 08:00', () => {
    expect(addBusinessMinutes(jkt('2026-10-24T10:00'), 30, cal)).toEqual(jkt('2026-10-26T08:30'));
  });

  it('melewati hari libur 17 Agustus (Senin)', () => {
    // Jumat 14 Agt 16:00 + 120 menit: 60 menit Jumat, Senin libur → Selasa 09:00.
    expect(addBusinessMinutes(jkt('2026-08-14T16:00'), 120, cal)).toEqual(jkt('2026-08-18T09:00'));
  });

  it('target 0 menit mengembalikan start', () => {
    const start = jkt('2026-10-24T10:00');
    expect(addBusinessMinutes(start, 0, cal)).toEqual(start);
  });

  it('target besar 40 jam kerja = 5 hari kerja', () => {
    expect(addBusinessMinutes(jkt('2026-10-19T08:00'), 40 * 60, cal)).toEqual(
      jkt('2026-10-23T17:00'),
    );
  });

  it('tepat di akhir interval tetap di hari yang sama', () => {
    expect(addBusinessMinutes(jkt('2026-10-23T16:00'), 60, cal)).toEqual(jkt('2026-10-23T17:00'));
  });

  it('kalender 24x7 = penambahan biasa', () => {
    const start = jkt('2026-10-24T22:00');
    expect(addBusinessMinutes(start, 240, create24x7Calendar())).toEqual(jkt('2026-10-25T02:00'));
  });

  it('menolak menit tidak hingga', () => {
    expect(() => addBusinessMinutes(new Date(), Number.NaN, cal)).toThrow(RangeError);
  });

  it('menolak kalender tanpa jam kerja', () => {
    const empty: BusinessCalendar = { ...cal, workHours: {} };
    expect(() => addBusinessMinutes(new Date(), 10, empty)).toThrow(RangeError);
  });

  it('menolak format jam tidak valid', () => {
    const bad: BusinessCalendar = { ...cal, workHours: { 3: [{ start: '8:00', end: '17:00' }] } };
    expect(() => addBusinessMinutes(jkt('2026-10-21T07:00'), 10, bad)).toThrow(RangeError);
  });

  it('menolak jam di luar rentang', () => {
    const bad: BusinessCalendar = { ...cal, workHours: { 3: [{ start: '08:00', end: '25:00' }] } };
    expect(() => addBusinessMinutes(jkt('2026-10-21T07:00'), 10, bad)).toThrow(RangeError);
  });
});

describe('businessMinutesBetween', () => {
  it('0 jika b <= a', () => {
    const a = jkt('2026-10-21T10:00');
    expect(businessMinutesBetween(a, a, cal)).toBe(0);
    expect(businessMinutesBetween(a, jkt('2026-10-21T09:00'), cal)).toBe(0);
  });

  it('tidak menghitung istirahat & malam', () => {
    expect(businessMinutesBetween(jkt('2026-10-21T11:00'), jkt('2026-10-22T09:00'), cal)).toBe(
      60 + 240 + 60,
    );
  });

  it('akhir pekan bernilai 0', () => {
    expect(businessMinutesBetween(jkt('2026-10-24T08:00'), jkt('2026-10-25T20:00'), cal)).toBe(0);
  });

  it('24x7 = selisih biasa', () => {
    expect(
      businessMinutesBetween(
        jkt('2026-10-24T08:00'),
        jkt('2026-10-24T09:30'),
        create24x7Calendar(),
      ),
    ).toBe(90);
  });

  it('property: between(start, add(start, m)) === m', () => {
    const base = jkt('2026-01-01T00:00').getTime();
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 365 * 24 * 60 }),
        fc.integer({ min: 1, max: 5000 }),
        (offsetMinutes, minutes) => {
          const start = new Date(base + offsetMinutes * 60_000);
          const end = addBusinessMinutes(start, minutes, cal);
          return Math.abs(businessMinutesBetween(start, end, cal) - minutes) < 1e-9;
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('zona waktu', () => {
  it('tidak hardcode Jakarta: kalender Europe/Berlin melewati DST dengan benar', () => {
    // DST Eropa berakhir 2026-10-25 (Minggu). Jumat 16:30 CEST (+02:00) + 60 → Senin 08:30 CET (+01:00).
    const berlin = createBusinessCalendar([], 'Europe/Berlin');
    const start = new Date('2026-10-23T16:30+02:00');
    expect(addBusinessMinutes(start, 60, berlin)).toEqual(new Date('2026-10-26T08:30+01:00'));
  });

  it('kalender Asia/Tokyo memakai jam kerja lokal Tokyo', () => {
    const tokyo = createBusinessCalendar([], 'Asia/Tokyo');
    expect(addBusinessMinutes(new Date('2026-10-21T07:00+09:00'), 30, tokyo)).toEqual(
      new Date('2026-10-21T08:30+09:00'),
    );
  });
});

describe('isWithinBusinessHours', () => {
  it('benar di jam kerja, salah saat istirahat, libur, dan akhir pekan', () => {
    expect(isWithinBusinessHours(jkt('2026-10-21T09:00'), cal)).toBe(true);
    expect(isWithinBusinessHours(jkt('2026-10-21T12:30'), cal)).toBe(false);
    expect(isWithinBusinessHours(jkt('2026-08-17T09:00'), cal)).toBe(false);
    expect(isWithinBusinessHours(jkt('2026-10-24T09:00'), cal)).toBe(false);
    expect(isWithinBusinessHours(jkt('2026-10-24T09:00'), create24x7Calendar())).toBe(true);
  });
});
