'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  LEVELS,
  PENDING_REASONS,
  RESOLUTION_CODES,
  TICKET_STATUSES,
  type Impact,
  type Priority,
  type Urgency,
} from '@/domain/types';
import { can } from '@/server/auth/rbac';
import { requireUser, userRecord } from '@/server/auth/session';
import { getStore } from '@/server/mock/db';
import {
  addComment as engineAddComment,
  assignTicket as engineAssignTicket,
  createTicket as engineCreateTicket,
  overridePriority as engineOverridePriority,
  runSlaTick,
  submitCsat as engineSubmitCsat,
  transitionTicket as engineTransitionTicket,
  updateClassification as engineUpdateClassification,
  type AttachmentInput,
  type TickResult,
} from '@/server/mock/ticket-engine';

export type ActionResult<T = unknown> =
  { ok: true; data: T } | { ok: false; error: string; code?: string };

// ---------------------------------------------------------------------------
// Buat Tiket
// ---------------------------------------------------------------------------

const createTicketSchema = z.object({
  catalogItemId: z.string().min(1, 'Layanan wajib dipilih'),
  title: z.string().min(5, 'Judul minimal 5 karakter').max(120, 'Judul maksimal 120 karakter'),
  description: z.string().min(10, 'Deskripsi minimal 10 karakter'),
  urgency: z.enum(LEVELS),
  impact: z.enum(LEVELS).optional(),
  formData: z.record(z.string(), z.string()).default({}),
  attachments: z
    .array(
      z.object({
        fileName: z.string(),
        mime: z.string(),
        size: z.number().max(10 * 1024 * 1024, 'Ukuran lampiran maksimal 10MB'),
      }),
    )
    .optional(),
});

export type CreateTicketFormData = z.infer<typeof createTicketSchema>;

/**
 * Server action membuat tiket dari portal/workspace.
 */
export async function createTicketAction(
  data: CreateTicketFormData,
): Promise<ActionResult<{ number: string; id: string }>> {
  try {
    const session = await requireUser();
    const parsed = createTicketSchema.parse(data);
    const store = getStore();
    const author = userRecord(store, session);

    const ticket = engineCreateTicket(
      store,
      {
        catalogItemId: parsed.catalogItemId,
        title: parsed.title,
        description: parsed.description,
        urgency: parsed.urgency,
        impact: parsed.impact,
        formData: parsed.formData,
        attachments: parsed.attachments,
      },
      author,
      new Date(),
    );

    revalidatePath('/portal');
    revalidatePath('/portal/tickets');
    revalidatePath('/queue');
    return { ok: true, data: { number: ticket.number, id: ticket.id } };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Gagal membuat tiket';
    return { ok: false, error: msg };
  }
}

// ---------------------------------------------------------------------------
// Komentar / Catatan Internal
// ---------------------------------------------------------------------------

const commentSchema = z.object({
  ticketId: z.string().min(1),
  body: z.string().min(2, 'Pesan tidak boleh kosong'),
  visibility: z.enum(['public', 'internal']),
  attachments: z
    .array(
      z.object({
        fileName: z.string(),
        mime: z.string(),
        size: z.number(),
      }),
    )
    .optional(),
});

export async function addCommentAction(
  ticketId: string,
  body: string,
  visibility: 'public' | 'internal',
  attachments: AttachmentInput[] = [],
): Promise<ActionResult> {
  try {
    const session = await requireUser();
    const parsed = commentSchema.parse({ ticketId, body, visibility, attachments });
    const store = getStore();
    const ticket = store.tickets.get(parsed.ticketId);
    if (!ticket) return { ok: false, error: 'Tiket tidak ditemukan' };

    const resource = { requesterId: ticket.requesterId, teamId: ticket.teamId };
    if (parsed.visibility === 'internal') {
      if (!can(session, 'ticket.comment_internal', resource)) {
        return { ok: false, error: 'Anda tidak memiliki hak menulis catatan internal' };
      }
    } else {
      if (!can(session, 'ticket.comment', resource)) {
        return { ok: false, error: 'Anda tidak memiliki hak membalas tiket ini' };
      }
    }

    const author = userRecord(store, session);
    engineAddComment(
      store,
      ticket.id,
      author,
      parsed.body,
      parsed.visibility,
      new Date(),
      parsed.attachments,
    );

    revalidatePath(`/tickets/${ticket.number}`);
    revalidatePath(`/portal/tickets/${ticket.number}`);
    return { ok: true, data: true };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : 'Gagal mengirim pesan' };
  }
}

// ---------------------------------------------------------------------------
// Transisi Status
// ---------------------------------------------------------------------------

const transitionSchema = z.object({
  ticketId: z.string(),
  to: z.enum(TICKET_STATUSES),
  pendingReason: z.enum(PENDING_REASONS).optional(),
  resolutionCode: z.enum(RESOLUTION_CODES).optional(),
  resolutionNotes: z.string().optional(),
  cancellationReason: z.string().optional(),
  reopenReason: z.string().optional(),
  assigneeId: z.string().optional(),
});

export async function transitionTicketAction(
  data: z.infer<typeof transitionSchema>,
): Promise<ActionResult> {
  try {
    const session = await requireUser();
    const parsed = transitionSchema.parse(data);
    const store = getStore();
    const ticket = store.tickets.get(parsed.ticketId);
    if (!ticket) return { ok: false, error: 'Tiket tidak ditemukan' };

    const resource = { requesterId: ticket.requesterId, teamId: ticket.teamId };
    const actor = userRecord(store, session);

    // Otorisasi server-side
    if (parsed.to === 'cancelled' && !can(session, 'ticket.work', resource)) {
      return { ok: false, error: 'Hanya staff yang berhak membatalkan tiket' };
    }
    if (parsed.to === 'closed' && session.role !== 'admin' && ticket.requesterId !== session.id) {
      return { ok: false, error: 'Hanya requester atau admin yang dapat menutup tiket ini' };
    }
    if (
      parsed.to === 'in_progress' &&
      ticket.status === 'resolved' &&
      ticket.requesterId !== session.id
    ) {
      return {
        ok: false,
        error: 'Hanya requester yang dapat membuka kembali tiket yang telah selesai',
      };
    }

    engineTransitionTicket(
      store,
      ticket.id,
      parsed.to,
      actor,
      {
        pendingReason: parsed.pendingReason,
        resolutionCode: parsed.resolutionCode,
        resolutionNotes: parsed.resolutionNotes,
        reason: parsed.cancellationReason ?? parsed.reopenReason,
        assigneeId: parsed.assigneeId,
      },
      new Date(),
    );

    revalidatePath(`/tickets/${ticket.number}`);
    revalidatePath(`/portal/tickets/${ticket.number}`);
    revalidatePath('/queue');
    revalidatePath('/portal/tickets');
    return { ok: true, data: true };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : 'Transisi ditolak' };
  }
}

// ---------------------------------------------------------------------------
// Assignment & Eskalasi
// ---------------------------------------------------------------------------

const assignSchema = z.object({
  ticketId: z.string(),
  assigneeId: z.string().nullable(),
  teamId: z.string().optional(),
  note: z.string().optional(),
});

export async function assignTicketAction(
  data: z.infer<typeof assignSchema>,
): Promise<ActionResult> {
  try {
    const session = await requireUser(['agent', 'lead', 'admin']);
    const parsed = assignSchema.parse(data);
    const store = getStore();
    const ticket = store.tickets.get(parsed.ticketId);
    if (!ticket) return { ok: false, error: 'Tiket tidak ditemukan' };

    const resource = {
      requesterId: ticket.requesterId,
      teamId: ticket.teamId,
      assigneeId: ticket.assigneeId,
    };
    if (!can(session, 'ticket.assign', resource)) {
      return { ok: false, error: 'Anda tidak memiliki hak penugasan tiket ini' };
    }

    // 1. Pindah tim (Eskalasi Fungsional / Reassign Tim)
    if (parsed.teamId && parsed.teamId !== ticket.teamId) {
      if (session.role === 'agent') {
        if (!parsed.note || parsed.note.trim().length < 5) {
          return {
            ok: false,
            error: 'Catatan eskalasi wajib diisi minimal 5 karakter untuk memindahkan tim',
          };
        }
      } else if (!can(session, 'ticket.reassign_team', resource)) {
        return { ok: false, error: 'Anda tidak memiliki hak memindahkan tiket ke tim lain' };
      }
    }

    // 2. Pembatasan Penugasan Agent (ADR-008 Option B)
    if (session.role === 'agent') {
      if (ticket.assigneeId === null) {
        // Tiket unassigned: hanya boleh klaim untuk diri sendiri
        if (parsed.assigneeId !== null && parsed.assigneeId !== session.id) {
          return {
            ok: false,
            error: 'Agent hanya berhak mengambil tiket unassigned untuk diri sendiri',
          };
        }
      } else if (ticket.assigneeId === session.id) {
        // Tiket milik sendiri: hanya boleh melepas ke unassigned
        if (parsed.assigneeId !== null && parsed.assigneeId !== session.id) {
          return {
            ok: false,
            error: 'Agent hanya berhak melepaskan penugasan tiket miliknya sendiri',
          };
        }
      } else {
        // Tiket milik agent lain: dilarang merebut
        return {
          ok: false,
          error: 'Hanya Team Lead atau Admin yang berhak memindahkan tiket milik staf lain',
        };
      }
    }

    const actor = userRecord(store, session);
    engineAssignTicket(store, ticket.id, parsed, actor, new Date());

    revalidatePath(`/tickets/${ticket.number}`);
    revalidatePath('/queue');
    return { ok: true, data: true };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : 'Penugasan gagal' };
  }
}

/**
 * Bulk assign beberapa tiket sekaligus dari tabel queue.
 */
export async function bulkAssignAction(
  ticketIds: string[],
  assigneeId: string | null,
  teamId?: string,
): Promise<ActionResult<{ count: number }>> {
  try {
    const session = await requireUser(['agent', 'lead', 'admin']);
    const store = getStore();
    const actor = userRecord(store, session);
    let count = 0;

    // Untuk agent: hanya boleh bulk assign ke dirinya sendiri
    if (session.role === 'agent') {
      if (assigneeId !== session.id && assigneeId !== null) {
        return { ok: false, error: 'Agent hanya dapat mengambil tiket untuk diri sendiri' };
      }
      if (teamId && !session.teamIds.includes(teamId)) {
        return { ok: false, error: 'Agent tidak dapat memindahkan tiket ke tim lain' };
      }
    }

    for (const id of ticketIds) {
      const ticket = store.tickets.get(id);
      if (!ticket) continue;
      const resource = {
        requesterId: ticket.requesterId,
        teamId: ticket.teamId,
        assigneeId: ticket.assigneeId,
      };
      if (!can(session, 'ticket.assign', resource)) {
        continue;
      }
      // Agent tidak boleh merebut tiket agent lain
      if (
        session.role === 'agent' &&
        ticket.assigneeId !== null &&
        ticket.assigneeId !== session.id
      ) {
        continue;
      }
      engineAssignTicket(store, ticket.id, { assigneeId, teamId }, actor, new Date());
      count++;
    }

    revalidatePath('/queue');
    return { ok: true, data: { count } };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : 'Bulk assign gagal' };
  }
}

// ---------------------------------------------------------------------------
// Override Prioritas & Klasifikasi
// ---------------------------------------------------------------------------

export async function overridePriorityAction(
  ticketId: string,
  priority: Priority,
  reason: string,
): Promise<ActionResult> {
  try {
    const session = await requireUser(['lead', 'admin']);
    const store = getStore();
    const ticket = store.tickets.get(ticketId);
    if (!ticket) return { ok: false, error: 'Tiket tidak ditemukan' };

    if (
      !can(session, 'ticket.override_priority', {
        requesterId: ticket.requesterId,
        teamId: ticket.teamId,
      })
    ) {
      return {
        ok: false,
        error: 'Hanya Team Lead dan Admin yang berhak melakukan override prioritas',
      };
    }

    const actor = userRecord(store, session);
    engineOverridePriority(store, ticket.id, priority, reason, actor, new Date());

    revalidatePath(`/tickets/${ticket.number}`);
    revalidatePath('/queue');
    return { ok: true, data: true };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : 'Gagal override prioritas' };
  }
}

export async function updateClassificationAction(
  ticketId: string,
  impact: Impact,
  urgency: Urgency,
): Promise<ActionResult> {
  try {
    const session = await requireUser(['agent', 'lead', 'admin']);
    const store = getStore();
    const ticket = store.tickets.get(ticketId);
    if (!ticket) return { ok: false, error: 'Tiket tidak ditemukan' };

    const actor = userRecord(store, session);
    engineUpdateClassification(store, ticket.id, impact, urgency, actor, new Date());

    revalidatePath(`/tickets/${ticket.number}`);
    revalidatePath('/queue');
    return { ok: true, data: true };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : 'Gagal mengubah klasifikasi' };
  }
}

// ---------------------------------------------------------------------------
// CSAT
// ---------------------------------------------------------------------------

export async function submitCsatAction(
  ticketId: string,
  score: number,
  comment: string,
): Promise<ActionResult> {
  try {
    const session = await requireUser();
    const store = getStore();
    const ticket = store.tickets.get(ticketId);
    if (!ticket) return { ok: false, error: 'Tiket tidak ditemukan' };

    if (ticket.requesterId !== session.id) {
      return { ok: false, error: 'Hanya pembuat tiket yang dapat mengisi survei kepuasan' };
    }

    const actor = userRecord(store, session);
    engineSubmitCsat(store, ticket.id, score, comment, actor, new Date());

    revalidatePath(`/portal/tickets/${ticket.number}`);
    return { ok: true, data: true };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : 'Gagal mengirim survei' };
  }
}

// ---------------------------------------------------------------------------
// Notifikasi & SLA Tick
// ---------------------------------------------------------------------------

export async function markNotificationReadAction(notificationId: string): Promise<ActionResult> {
  try {
    const session = await requireUser();
    const store = getStore();
    const n = store.notifications.find(
      (item) => item.id === notificationId && item.userId === session.id,
    );
    if (n) {
      n.readAt = new Date();
    }
    revalidatePath('/notifications');
    return { ok: true, data: true };
  } catch (err: unknown) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Gagal memperbarui notifikasi',
    };
  }
}

export async function markAllNotificationsReadAction(): Promise<ActionResult> {
  try {
    const session = await requireUser();
    const store = getStore();
    const now = new Date();
    for (const n of store.notifications) {
      if (n.userId === session.id && !n.readAt) {
        n.readAt = now;
      }
    }
    revalidatePath('/notifications');
    return { ok: true, data: true };
  } catch (err: unknown) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Gagal memperbarui notifikasi',
    };
  }
}

export async function triggerSlaTickAction(
  advanceMinutes = 0,
): Promise<ActionResult<TickResult & { simulatedNow: string }>> {
  try {
    await requireUser(['admin']);
    const store = getStore();
    const now = new Date(Date.now() + advanceMinutes * 60_000);
    const result = runSlaTick(store, now);
    revalidatePath('/admin');
    revalidatePath('/queue');
    revalidatePath('/dashboard');
    return {
      ok: true,
      data: {
        ...result,
        simulatedNow: now.toISOString(),
      },
    };
  } catch (err: unknown) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Gagal menjalankan SLA worker',
    };
  }
}
