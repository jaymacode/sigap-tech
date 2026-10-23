/**
 * Tipe & enum domain Sigap (DATA_MODEL.md §Enum).
 * Didefinisikan sebagai tuple `as const` agar bisa dipakai untuk Zod enum dan iterasi UI
 * tanpa duplikasi daftar nilai.
 */

export const ROLES = ['requester', 'agent', 'lead', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const TICKET_TYPES = ['incident', 'service_request'] as const;
export type TicketType = (typeof TICKET_TYPES)[number];

export const LEVELS = ['low', 'medium', 'high'] as const;
export type Impact = (typeof LEVELS)[number];
export type Urgency = (typeof LEVELS)[number];

export const PRIORITIES = ['P1', 'P2', 'P3', 'P4'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const TICKET_STATUSES = [
  'new',
  'assigned',
  'in_progress',
  'pending',
  'resolved',
  'closed',
  'cancelled',
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/** Status yang dianggap "aktif" (masuk backlog, bisa dibatalkan). */
export const ACTIVE_STATUSES: readonly TicketStatus[] = [
  'new',
  'assigned',
  'in_progress',
  'pending',
];

export const PENDING_REASONS = [
  'awaiting_user',
  'awaiting_vendor',
  'awaiting_change',
  'scheduled',
] as const;
export type PendingReason = (typeof PENDING_REASONS)[number];

export const RESOLUTION_CODES = [
  'fixed',
  'workaround',
  'user_error',
  'no_fault_found',
  'duplicate',
  'fulfilled',
] as const;
export type ResolutionCode = (typeof RESOLUTION_CODES)[number];

export const SLA_KINDS = ['response', 'resolution'] as const;
export type SlaKind = (typeof SLA_KINDS)[number];

export const SLA_STATUSES = ['running', 'paused', 'met', 'breached', 'cancelled'] as const;
export type SlaStatus = (typeof SLA_STATUSES)[number];

export const TICKET_EVENT_TYPES = [
  'created',
  'assigned',
  'status_changed',
  'priority_changed',
  'priority_overridden',
  'commented',
  'internal_note',
  'attachment_added',
  'escalated_functional',
  'escalated_hierarchical',
  'sla_warning',
  'sla_breached',
  'sla_met',
  'sla_paused',
  'sla_resumed',
  'sla_rebaselined',
  'reopened',
  'csat_submitted',
  'linked_problem',
  'linked_kb',
] as const;
export type TicketEventType = (typeof TICKET_EVENT_TYPES)[number];

/** Hasil operasi domain yang bisa gagal tanpa melempar exception. */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

/** Error domain dengan kode stabil (untuk test & mapping pesan UI). */
export interface DomainError {
  code: string;
  message: string;
}

export const MINUTE_MS = 60_000;
