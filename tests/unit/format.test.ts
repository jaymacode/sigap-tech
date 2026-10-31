import { describe, expect, it } from 'vitest';
import { formatDuration, formatSlaRemaining, formatSlaTarget } from '@/lib/format';

describe('formatSlaRemaining', () => {
  it('formats business_hours remaining time correctly based on 8-hour workday (480 min)', () => {
    // 597 minutes = 1 workday (480 min) + 1 hour (60 min) + 57 min
    expect(formatSlaRemaining(597, 'business_hours')).toBe('1h kerja 1j');

    // Exactly 480 minutes = 1 hari kerja
    expect(formatSlaRemaining(480, 'business_hours')).toBe('1 hari kerja');

    // 960 minutes = 2 hari kerja
    expect(formatSlaRemaining(960, 'business_hours')).toBe('2 hari kerja');

    // 120 minutes = 2j kerja
    expect(formatSlaRemaining(120, 'business_hours')).toBe('2j kerja');

    // 45 minutes = 45m kerja
    expect(formatSlaRemaining(45, 'business_hours')).toBe('45m kerja');
  });

  it('formats 24x7 remaining time correctly based on 24-hour day (1440 min)', () => {
    // 1500 minutes = 1d + 1h
    expect(formatSlaRemaining(1500, '24x7')).toBe('1h 1j');

    // 120 minutes = 2j
    expect(formatSlaRemaining(120, '24x7')).toBe('2j');

    // 45 minutes = 45m
    expect(formatSlaRemaining(45, '24x7')).toBe('45m');
  });
});

describe('formatSlaTarget', () => {
  it('formats business_hours targets displaying both workdays and total work hours', () => {
    // 2400 minutes = 40 hours = 5 days of 8 hours
    expect(formatSlaTarget(2400, 'business_hours')).toBe('5 hari kerja (40 jam kerja)');

    // 480 minutes = 8 hours = 1 day
    expect(formatSlaTarget(480, 'business_hours')).toBe('1 hari kerja (8 jam kerja)');

    // 240 minutes = 4 hours
    expect(formatSlaTarget(240, 'business_hours')).toBe('4 jam kerja');

    // 30 minutes
    expect(formatSlaTarget(30, 'business_hours')).toBe('30 menit kerja');
  });

  it('formats 24x7 targets displaying 24x7 label', () => {
    // 240 minutes = 4 hours
    expect(formatSlaTarget(240, '24x7')).toBe('4 jam (24x7)');

    // 1440 minutes = 1 day
    expect(formatSlaTarget(1440, '24x7')).toBe('1 hari (24x7)');
  });
});
