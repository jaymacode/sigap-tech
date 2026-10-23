import { describe, expect, it } from 'vitest';
import {
  calculatePriority,
  calculateTicketPriority,
  isValidOverrideReason,
  priorityRank,
  PRIORITY_LABELS,
} from '@/domain/priority';
import type { Impact, Priority, Urgency } from '@/domain/types';

describe('calculatePriority (ITSM.md §3)', () => {
  const cases: Array<[Impact, Urgency, Priority]> = [
    ['high', 'high', 'P1'],
    ['high', 'medium', 'P2'],
    ['high', 'low', 'P3'],
    ['medium', 'high', 'P2'],
    ['medium', 'medium', 'P3'],
    ['medium', 'low', 'P4'],
    ['low', 'high', 'P3'],
    ['low', 'medium', 'P4'],
    ['low', 'low', 'P4'],
  ];

  it.each(cases)('impact %s × urgency %s → %s', (impact, urgency, expected) => {
    expect(calculatePriority(impact, urgency)).toBe(expected);
  });
});

describe('calculateTicketPriority', () => {
  it('incident memakai matriks apa adanya', () => {
    expect(calculateTicketPriority('incident', 'high', 'high')).toBe('P1');
  });
  it('service request dibatasi ke P3/P4', () => {
    expect(calculateTicketPriority('service_request', 'high', 'high')).toBe('P3');
    expect(calculateTicketPriority('service_request', 'medium', 'high')).toBe('P3');
    expect(calculateTicketPriority('service_request', 'low', 'low')).toBe('P4');
  });
});

describe('override reason', () => {
  it('menolak alasan < 10 karakter setelah trim', () => {
    expect(isValidOverrideReason('   singkat ')).toBe(false);
  });
  it('menerima alasan ≥ 10 karakter', () => {
    expect(isValidOverrideReason('Dampak ke seluruh kantor cabang')).toBe(true);
  });
});

describe('helpers', () => {
  it('priorityRank mengurutkan P1 paling penting', () => {
    expect(['P3', 'P1', 'P4', 'P2'].sort((a, b) => priorityRank(a as Priority) - priorityRank(b as Priority))).toEqual(['P1', 'P2', 'P3', 'P4']);
  });
  it('label tersedia untuk semua prioritas', () => {
    expect(PRIORITY_LABELS.P1).toBe('Critical');
    expect(PRIORITY_LABELS.P4).toBe('Low');
  });
});
