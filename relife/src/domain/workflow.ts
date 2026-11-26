import {
  ACTIVE_STATUSES,
  err,
  ok,
  PENDING_REASONS,
  RESOLUTION_CODES,
  type DomainError,
  type PendingReason,
  type ResolutionCode,
  type Result,
  type Role,
  type TicketEventType,
  type TicketStatus,
} from './types';

/**
 * State machine lifecycle tiket (ITSM.md §5).
 *
 * Aturan disimpan sebagai tabel `RULES` agar mudah dicocokkan dengan dokumen dan di-test
 * sebagai matriks. `transition` tidak menyentuh SLA — service yang menerjemahkan perubahan status
 * ke operasi SLA (pause/resume/stop) supaya kedua modul tetap terpisah & mudah di-test.
 */

export interface WorkflowTicket {
  status: TicketStatus;
  requesterId: string;
  assigneeId: string | null;
  pendingReason: PendingReason | null;
  resolutionCode: ResolutionCode | null;
  resolutionNotes: string | null;
  resolvedAt: Date | null;
  closedAt: Date | null;
  reopenCount: number;
}

export type Actor = { kind: 'system' } | { kind: 'user'; id: string; role: Role };

export interface TransitionPayload {
  assigneeId?: string;
  pendingReason?: PendingReason;
  resolutionCode?: ResolutionCode;
  resolutionNotes?: string;
  /** Alasan untuk cancel / reopen. */
  reason?: string;
}

export interface DomainEvent {
  type: TicketEventType;
  data: Record<string, unknown>;
}

export interface TransitionResult<T extends WorkflowTicket> {
  ticket: T;
  events: DomainEvent[];
}

export const REOPEN_WINDOW_DAYS = 7;
export const MIN_REASON_LENGTH = 3;
const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Predikat aktor
// ---------------------------------------------------------------------------

const isSystem = (a: Actor): boolean => a.kind === 'system';
const isStaff = (a: Actor): boolean =>
  a.kind === 'user' && (a.role === 'agent' || a.role === 'lead' || a.role === 'admin');
const isSupervisor = (a: Actor): boolean =>
  a.kind === 'user' && (a.role === 'lead' || a.role === 'admin');
/** Assignee tiket, atau lead/admin yang mewarisi semua hak agent (ADR-007). */
const isAssigneeOrSupervisor = (t: WorkflowTicket, a: Actor): boolean =>
  (a.kind === 'user' && a.id === t.assigneeId && isStaff(a)) || isSupervisor(a);
const isOwnerRequester = (t: WorkflowTicket, a: Actor): boolean =>
  a.kind === 'user' && a.id === t.requesterId;

const hasReason = (p: TransitionPayload): boolean =>
  (p.reason ?? '').trim().length >= MIN_REASON_LENGTH;

const domainError = (code: string, message: string): DomainError => ({ code, message });

// ---------------------------------------------------------------------------
// Tabel aturan
// ---------------------------------------------------------------------------

interface Rule {
  from: readonly TicketStatus[];
  to: TicketStatus;
  allowed: (t: WorkflowTicket, a: Actor) => boolean;
  /** Validasi syarat; `null` jika lolos. */
  check: (t: WorkflowTicket, p: TransitionPayload, now: Date) => DomainError | null;
  apply: (t: WorkflowTicket, p: TransitionPayload, now: Date) => Partial<WorkflowTicket>;
  extraEvents?: (t: WorkflowTicket, p: TransitionPayload) => DomainEvent[];
}

function reopenWindowOpen(t: WorkflowTicket, now: Date): boolean {
  if (!t.resolvedAt) return false;
  return now.getTime() - t.resolvedAt.getTime() <= REOPEN_WINDOW_DAYS * DAY_MS;
}

const RULES: readonly Rule[] = [
  {
    from: ['new'],
    to: 'assigned',
    allowed: (_t, a) => isSystem(a) || isStaff(a),
    check: (t, p) =>
      (p.assigneeId ?? t.assigneeId)
        ? null
        : domainError('assignee_required', 'Assignee wajib diisi'),
    apply: (t, p) => ({ assigneeId: p.assigneeId ?? t.assigneeId }),
    extraEvents: (t, p) => [
      { type: 'assigned', data: { assigneeId: p.assigneeId ?? t.assigneeId } },
    ],
  },
  {
    from: ['assigned'],
    to: 'in_progress',
    allowed: isAssigneeOrSupervisor,
    check: () => null,
    apply: () => ({}),
  },
  {
    from: ['in_progress'],
    to: 'pending',
    allowed: isAssigneeOrSupervisor,
    check: (_t, p) =>
      p.pendingReason && PENDING_REASONS.includes(p.pendingReason)
        ? null
        : domainError('pending_reason_required', 'Alasan pending wajib dipilih'),
    apply: (_t, p) => ({ pendingReason: p.pendingReason ?? null }),
  },
  {
    from: ['pending'],
    to: 'in_progress',
    allowed: (t, a) =>
      isAssigneeOrSupervisor(t, a) ||
      isSystem(a) ||
      (isOwnerRequester(t, a) && t.pendingReason === 'awaiting_user'),
    check: () => null,
    apply: () => ({ pendingReason: null }),
  },
  {
    from: ['in_progress'],
    to: 'resolved',
    allowed: isAssigneeOrSupervisor,
    check: (_t, p) =>
      p.resolutionCode &&
      RESOLUTION_CODES.includes(p.resolutionCode) &&
      (p.resolutionNotes ?? '').trim().length > 0
        ? null
        : domainError('resolution_required', 'Resolution code dan resolution notes wajib diisi'),
    apply: (_t, p, now) => ({
      resolutionCode: p.resolutionCode ?? null,
      resolutionNotes: (p.resolutionNotes ?? '').trim(),
      resolvedAt: now,
    }),
  },
  {
    from: ['resolved'],
    to: 'closed',
    allowed: (t, a) => isSystem(a) || isOwnerRequester(t, a),
    check: () => null,
    apply: (_t, _p, now) => ({ closedAt: now }),
  },
  {
    from: ['resolved'],
    to: 'in_progress',
    allowed: isOwnerRequester,
    check: (t, p, now) => {
      if (!reopenWindowOpen(t, now)) {
        return domainError(
          'reopen_window_expired',
          `Tiket hanya bisa dibuka lagi dalam ${REOPEN_WINDOW_DAYS} hari setelah selesai`,
        );
      }
      return hasReason(p) ? null : domainError('reason_required', 'Alasan wajib diisi');
    },
    apply: (t) => ({
      resolvedAt: null,
      resolutionCode: null,
      resolutionNotes: null,
      reopenCount: t.reopenCount + 1,
    }),
    extraEvents: (_t, p) => [{ type: 'reopened', data: { reason: (p.reason ?? '').trim() } }],
  },
  {
    from: ACTIVE_STATUSES,
    to: 'cancelled',
    // Sistem: penolakan persetujuan lewat link email (approver tanpa akun).
    allowed: (_t, a) => isSystem(a) || isStaff(a),
    check: (_t, p) => (hasReason(p) ? null : domainError('reason_required', 'Alasan wajib diisi')),
    apply: () => ({ pendingReason: null }),
  },
];

function findRule(from: TicketStatus, to: TicketStatus): Rule | undefined {
  return RULES.find((r) => r.to === to && r.from.includes(from));
}

// ---------------------------------------------------------------------------
// API publik
// ---------------------------------------------------------------------------

/**
 * Menjalankan transisi status.
 * @param ticket - tiket saat ini
 * @param to - status tujuan
 * @param actor - pelaku (user atau sistem)
 * @param payload - data syarat transisi
 * @param now - waktu sekarang (diinjeksi)
 * @returns tiket baru + daftar event yang wajib ditulis, atau DomainError
 */
export function transition<T extends WorkflowTicket>(
  ticket: T,
  to: TicketStatus,
  actor: Actor,
  payload: TransitionPayload,
  now: Date,
): Result<TransitionResult<T>, DomainError> {
  if (ticket.status === 'closed' || ticket.status === 'cancelled') {
    return err(domainError('final_status', 'Tiket sudah final dan tidak bisa diubah'));
  }
  const rule = findRule(ticket.status, to);
  if (!rule) {
    return err(
      domainError('invalid_transition', `Transisi ${ticket.status} → ${to} tidak diizinkan`),
    );
  }
  if (!rule.allowed(ticket, actor)) {
    return err(domainError('forbidden', 'Anda tidak berhak melakukan transisi ini'));
  }
  const failure = rule.check(ticket, payload, now);
  if (failure) return err(failure);

  const next: T = { ...ticket, ...rule.apply(ticket, payload, now), status: to };
  const statusEvent: DomainEvent = {
    type: 'status_changed',
    data: {
      from: ticket.status,
      to,
      ...(payload.pendingReason && to === 'pending'
        ? { pendingReason: payload.pendingReason }
        : {}),
      ...(to === 'resolved'
        ? { resolutionCode: payload.resolutionCode, resolutionNotes: next.resolutionNotes }
        : {}),
      ...(to === 'cancelled' ? { reason: (payload.reason ?? '').trim() } : {}),
    },
  };
  return ok({
    ticket: next,
    events: [...(rule.extraEvents?.(ticket, payload) ?? []), statusEvent],
  });
}

/** true jika status termasuk aktif (backlog). */