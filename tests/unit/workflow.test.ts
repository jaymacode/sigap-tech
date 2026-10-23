import { describe, expect, it } from 'vitest';
import { TICKET_STATUSES, type TicketStatus } from '@/domain/types';
import {
  allowedTransitions,
  isActiveStatus,
  SYSTEM_ACTOR,
  transition,
  type Actor,
  type TransitionPayload,
  type WorkflowTicket,
} from '@/domain/workflow';

const NOW = new Date('2026-10-21T03:00:00Z');
const DAY = 86_400_000;

const requester: Actor = { kind: 'user', id: 'u-req', role: 'requester' };
const otherRequester: Actor = { kind: 'user', id: 'u-other', role: 'requester' };
const assignee: Actor = { kind: 'user', id: 'u-agent', role: 'agent' };
const otherAgent: Actor = { kind: 'user', id: 'u-agent2', role: 'agent' };
const lead: Actor = { kind: 'user', id: 'u-lead', role: 'lead' };
const admin: Actor = { kind: 'user', id: 'u-admin', role: 'admin' };

function ticket(status: TicketStatus, overrides: Partial<WorkflowTicket> = {}): WorkflowTicket {
  return {
    status,
    requesterId: 'u-req',
    assigneeId: status === 'new' ? null : 'u-agent',
    pendingReason: status === 'pending' ? 'awaiting_user' : null,
    resolutionCode: status === 'resolved' || status === 'closed' ? 'fixed' : null,
    resolutionNotes: status === 'resolved' || status === 'closed' ? 'ok' : null,
    resolvedAt: status === 'resolved' ? new Date(NOW.getTime() - DAY) : null,
    closedAt: null,
    reopenCount: 0,
    ...overrides,
  };
}

const FULL_PAYLOAD: TransitionPayload = {
  assigneeId: 'u-agent',
  pendingReason: 'awaiting_vendor',
  resolutionCode: 'fixed',
  resolutionNotes: 'Driver diperbarui',
  reason: 'Alasan yang jelas',
};

/** Transisi valid (ITSM.md §5) beserta aktor yang berhak. */
const VALID: Array<[TicketStatus, TicketStatus, Actor]> = [
  ['new', 'assigned', assignee],
  ['assigned', 'in_progress', assignee],
  ['in_progress', 'pending', assignee],
  ['pending', 'in_progress', assignee],
  ['in_progress', 'resolved', assignee],
  ['resolved', 'closed', requester],
  ['resolved', 'in_progress', requester],
  ['new', 'cancelled', assignee],
  ['assigned', 'cancelled', assignee],
  ['in_progress', 'cancelled', lead],
  ['pending', 'cancelled', lead],
];

const isValidPair = (from: TicketStatus, to: TicketStatus): boolean =>
  VALID.some(([f, t]) => f === from && t === to);

describe('matriks transisi', () => {
  it.each(VALID)('%s → %s diterima', (from, to, actor) => {
    const result = transition(ticket(from), to, actor, FULL_PAYLOAD, NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.ticket.status).toBe(to);
      expect(result.value.events.at(-1)).toMatchObject({
        type: 'status_changed',
        data: { from, to },
      });
    }
  });

  const invalidPairs = TICKET_STATUSES.flatMap((from) =>
    TICKET_STATUSES.filter((to) => !isValidPair(from, to)).map((to) => [from, to] as const),
  );

  it.each(invalidPairs)('%s → %s ditolak', (from, to) => {
    const result = transition(ticket(from), to, admin, FULL_PAYLOAD, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(['invalid_transition', 'final_status']).toContain(result.error.code);
    }
  });
});

describe('syarat wajib', () => {
  const expectError = (r: ReturnType<typeof transition>, code: string): void => {
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(code);
  };

  it('new → assigned butuh assignee', () => {
    expectError(transition(ticket('new'), 'assigned', lead, {}, NOW), 'assignee_required');
  });

  it('pending butuh pending_reason', () => {
    expectError(
      transition(ticket('in_progress'), 'pending', assignee, {}, NOW),
      'pending_reason_required',
    );
  });

  it('resolve butuh resolution code & notes', () => {
    expectError(
      transition(
        ticket('in_progress'),
        'resolved',
        assignee,
        { resolutionCode: 'fixed', resolutionNotes: '  ' },
        NOW,
      ),
      'resolution_required',
    );
  });

  it('cancel butuh alasan', () => {
    expectError(
      transition(ticket('assigned'), 'cancelled', assignee, { reason: ' ' }, NOW),
      'reason_required',
    );
  });

  it('reopen butuh alasan', () => {
    expectError(
      transition(ticket('resolved'), 'in_progress', requester, {}, NOW),
      'reason_required',
    );
  });

  it('reopen setelah 7 hari ditolak', () => {
    const old = ticket('resolved', { resolvedAt: new Date(NOW.getTime() - 8 * DAY) });
    expectError(
      transition(old, 'in_progress', requester, { reason: 'Masih error' }, NOW),
      'reopen_window_expired',
    );
  });
});

describe('otorisasi aktor', () => {
  it('agent lain tidak bisa memulai tiket orang lain', () => {
    const r = transition(ticket('assigned'), 'in_progress', otherAgent, {}, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('forbidden');
  });

  it('lead mewarisi hak assignee', () => {
    expect(transition(ticket('assigned'), 'in_progress', lead, {}, NOW).ok).toBe(true);
  });

  it('requester lain tidak bisa menutup tiket', () => {
    expect(transition(ticket('resolved'), 'closed', otherRequester, {}, NOW).ok).toBe(false);
  });

  it('sistem bisa auto-close dan auto-assign', () => {
    expect(transition(ticket('resolved'), 'closed', SYSTEM_ACTOR, {}, NOW).ok).toBe(true);
    expect(
      transition(ticket('new'), 'assigned', SYSTEM_ACTOR, { assigneeId: 'u-agent' }, NOW).ok,
    ).toBe(true);
  });

  it('requester bisa melanjutkan pending hanya saat awaiting_user', () => {
    expect(transition(ticket('pending'), 'in_progress', requester, {}, NOW).ok).toBe(true);
    const vendor = ticket('pending', { pendingReason: 'awaiting_vendor' });
    expect(transition(vendor, 'in_progress', requester, {}, NOW).ok).toBe(false);
  });

  it('requester tidak bisa cancel', () => {
    expect(
      transition(ticket('new'), 'cancelled', requester, { reason: 'Tidak jadi' }, NOW).ok,
    ).toBe(false);
  });
});

describe('event yang dihasilkan', () => {
  it('assign menghasilkan assigned + status_changed', () => {
    const r = transition(ticket('new'), 'assigned', lead, { assigneeId: 'u-agent' }, NOW);
    expect(r.ok && r.value.events.map((e) => e.type)).toEqual(['assigned', 'status_changed']);
  });

  it('reopen menghasilkan reopened, menaikkan reopen_count, dan mengosongkan resolusi', () => {
    const r = transition(
      ticket('resolved'),
      'in_progress',
      requester,
      { reason: 'Masih error' },
      NOW,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.events.map((e) => e.type)).toEqual(['reopened', 'status_changed']);
      expect(r.value.ticket.reopenCount).toBe(1);
      expect(r.value.ticket.resolutionCode).toBeNull();
      expect(r.value.ticket.resolvedAt).toBeNull();
    }
  });

  it('resolve menyimpan resolvedAt & data resolusi di event', () => {
    const r = transition(ticket('in_progress'), 'resolved', assignee, FULL_PAYLOAD, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.ticket.resolvedAt).toEqual(NOW);
      expect(r.value.events[0]?.data).toMatchObject({ resolutionCode: 'fixed' });
    }
  });

  it('pending menyimpan alasan; cancel menyimpan alasan', () => {
    const p = transition(
      ticket('in_progress'),
      'pending',
      assignee,
      { pendingReason: 'scheduled' },
      NOW,
    );
    expect(p.ok && p.value.events[0]?.data).toMatchObject({ pendingReason: 'scheduled' });
    const c = transition(ticket('new'), 'cancelled', lead, { reason: 'Duplikat INC-1' }, NOW);
    expect(c.ok && c.value.events[0]?.data).toMatchObject({ reason: 'Duplikat INC-1' });
  });

  it('closed menyimpan closedAt', () => {
    const r = transition(ticket('resolved'), 'closed', requester, {}, NOW);
    expect(r.ok && r.value.ticket.closedAt).toEqual(NOW);
  });
});

describe('allowedTransitions', () => {
  it('assignee pada in_progress: pending, resolved, cancelled', () => {
    expect(allowedTransitions(ticket('in_progress'), assignee, NOW).sort()).toEqual([
      'cancelled',
      'pending',
      'resolved',
    ]);
  });

  it('requester pada resolved: closed & reopen dalam 7 hari', () => {
    expect(allowedTransitions(ticket('resolved'), requester, NOW).sort()).toEqual([
      'closed',
      'in_progress',
    ]);
  });

  it('reopen hilang setelah 7 hari', () => {
    const old = ticket('resolved', { resolvedAt: new Date(NOW.getTime() - 9 * DAY) });
    expect(allowedTransitions(old, requester, NOW)).toEqual(['closed']);
  });

  it('status final tidak punya transisi', () => {
    expect(allowedTransitions(ticket('closed'), admin, NOW)).toEqual([]);
    expect(allowedTransitions(ticket('cancelled'), admin, NOW)).toEqual([]);
  });

  it('isActiveStatus', () => {
    expect(isActiveStatus('pending')).toBe(true);
    expect(isActiveStatus('resolved')).toBe(false);
  });
});
