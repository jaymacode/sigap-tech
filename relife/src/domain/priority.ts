import type { Impact, Priority, TicketType, Urgency } from './types';

/**
 * Priority matrix Impact × Urgency (ITSM.md §3).
 * Disimpan sebagai tabel data (bukan if/else) agar mudah diaudit terhadap dokumen.
 */
const MATRIX: Readonly<Record<Impact, Readonly<Record<Urgency, Priority>>>> = {
  high: { high: 'P1', medium: 'P2', low: 'P3' },
  medium: { high: 'P2', medium: 'P3', low: 'P4' },
  low: { high: 'P3', medium: 'P4', low: 'P4' },
};

/**
 * Menghitung prioritas dari impact & urgency.
 * @param impact - luas dampak
 * @param urgency - seberapa cepat harus pulih
 * @returns prioritas P1–P4
 */
export function calculatePriority(impact: Impact, urgency: Urgency): Priority {
  return MATRIX[impact][urgency];
}

/**
 * Prioritas efektif per tipe tiket. Service Request memakai policy terpisah yang hanya
 * mengenal P3/P4 (ITSM.md §4.1), sehingga hasil matriks P1/P2 dibatasi menjadi P3 (ADR-008).
 * @param type - tipe tiket
 * @param impact - luas dampak
 * @param urgency - tingkat urgensi
 */
export function calculateTicketPriority(
  type: TicketType,
  impact: Impact,
  urgency: Urgency,
): Priority {
  const priority = calculatePriority(impact, urgency);
  if (type === 'service_request' && (priority === 'P1' || priority === 'P2')) return 'P3';
  return priority;
}

export const PRIORITY_LABELS: Readonly<Record<Priority, string>> = {
  P1: 'Critical',
  P2: 'High',
  P3: 'Medium',
  P4: 'Low',
};

/** Label urgency berbahasa awam untuk portal requester (ITSM.md §2, DESIGN.md §1.3). */
/** Minimal panjang alasan override prioritas (ITSM.md §3). */
export const OVERRIDE_REASON_MIN_LENGTH = 10;

/**
 * Memvalidasi alasan override prioritas.
 * @param reason - alasan yang diisi lead/admin
 * @returns true jika alasan cukup panjang setelah di-trim
 */
export function isValidOverrideReason(reason: string): boolean {
  return reason.trim().length >= OVERRIDE_REASON_MIN_LENGTH;
}

/** Urutan numerik prioritas (P1 = paling penting) untuk sorting. */
export function priorityRank(priority: Priority): number {
  return Number(priority.slice(1));
}
