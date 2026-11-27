import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { DB_ERROR_RESULT, persistOrFail } from '@/server/actions/persist';
import { can } from '@/server/auth/rbac';
import { requireApiUser, userRecord, type SessionUser } from '@/server/auth/session';
import {
  decideApproval,
  findByToken,
  requestItHodApproval,
  resendApprovalLink,
  updateItAssessment,
} from '@/server/mock/approvals';
import { getStore } from '@/server/mock/db';
import { EngineError } from '@/server/mock/ticket-engine';
import type { ApprovalRecord, TicketRecord } from '@/server/mock/types';
import { approvePage } from '@/views/approvals';

/**
 * Rute persetujuan: API staf (login) + halaman publik `/approve/:token` untuk approver tanpa akun.
 * Dipasang di root (`app.route('/', approvalRoutes)`).
 */
export const approvalRoutes = new Hono();

const itPartSchema = z.object({
  actionPlan: z.string().max(4000).default(''),
  impactAnalysis: z.string().max(4000).default(''),
});

const decideSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  note: z.string().max(2000).default(''),
  presdirRequired: z.boolean().optional(),
});

const manualSchema = decideSchema.extend({
  channel: z.string().trim().min(2, 'Sebutkan media konfirmasi (mis. telepon, WhatsApp)').max(80),
  note: z.string().trim().min(3, 'Catatan wajib diisi').max(2000),
});

async function body<T extends z.ZodTypeAny>(
  c: Context,
  schema: T,
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; res: Response }> {
  const raw = await c.req.json().catch(() => null);
  if (raw === null) {
    return { ok: false, res: c.json({ ok: false, error: 'Invalid JSON body' }, 400) };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      res: c.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid request' }, 400),
    };
  }
  return { ok: true, data: parsed.data };
}

function fail(c: Context, err: unknown): Response {
  if (err instanceof EngineError) {
    const status = err.code === 'not_found' ? 404 : err.code === 'forbidden' ? 403 : 400;
    return c.json({ ok: false, error: err.message, code: err.code }, status);
  }
  return c.json({ ok: false, error: err instanceof Error ? err.message : 'Gagal' }, 400);
}

const resourceOf = (t: TicketRecord) => ({ requesterId: t.requesterId, teamId: t.teamId, assigneeId: t.assigneeId });

function loadTicket(c: Context, session: SessionUser): TicketRecord | Response {
  const t = getStore().tickets.get(c.req.param('id') ?? '');
  if (!t) return c.json({ ok: false, error: 'Tiket tidak ditemukan' }, 404);
  if (!can(session, 'ticket.work', resourceOf(t)))
    return c.json({ ok: false, error: 'Anda tidak berhak mengubah tiket ini' }, 403);
  return t;
}

function loadApproval(c: Context): { row: ApprovalRecord; ticket: TicketRecord } | Response {
  const store = getStore();
  const row = store.approvals.find((a) => a.id === c.req.param('id'));
  const ticket = row ? store.tickets.get(row.ticketId) : undefined;
  if (!row || !ticket) return c.json({ ok: false, error: 'Persetujuan tidak ditemukan' }, 404);
  return { row, ticket };
}

async function done(c: Context): Promise<Response> {
  if (!(await persistOrFail())) return c.json(DB_ERROR_RESULT, 500);
  return c.json({ ok: true, data: true });
}

// --- IT part -----------------------------------------------------------------------------------

approvalRoutes.post('/api/tickets/:id/it-part', async (c) => {
  const session = requireApiUser(c, ['agent', 'lead', 'admin']);
  if (session instanceof Response) return session;
  const parsed = await body(c, itPartSchema);
  if (!parsed.ok) return parsed.res;
  const t = loadTicket(c, session);
  if (t instanceof Response) return t;
  try {
    const store = getStore();
    updateItAssessment(store, t.id, parsed.data.actionPlan, parsed.data.impactAnalysis, userRecord(store, session), new Date());
    return await done(c);
  } catch (err) {
    return fail(c, err);
  }
});

// --- Ajukan ke Head IT -------------------------------------------------------------------------

approvalRoutes.post('/api/tickets/:id/approvals/it-hod', async (c) => {
  const session = requireApiUser(c, ['agent', 'lead', 'admin']);
  if (session instanceof Response) return session;
  const t = loadTicket(c, session);
  if (t instanceof Response) return t;
  try {
    const store = getStore();
    requestItHodApproval(store, t.id, userRecord(store, session), new Date());
    return await done(c);
  } catch (err) {
    return fail(c, err);
  }
});

// --- Keputusan in-app Head IT ------------------------------------------------------------------

approvalRoutes.post('/api/approvals/:id/decide', async (c) => {
  const session = requireApiUser(c, ['lead', 'admin']);
  if (session instanceof Response) return session;
  const parsed = await body(c, decideSchema);
  if (!parsed.ok) return parsed.res;
  const found = loadApproval(c);
  if (found instanceof Response) return found;
  if (found.row.step !== 'it_hod')
    return c.json({ ok: false, error: 'Langkah ini diputuskan lewat link email atau dicatat manual' }, 400);
  if (!can(session, 'ticket.approve', resourceOf(found.ticket)))
    return c.json({ ok: false, error: 'Hanya Head IT atau admin yang dapat menyetujui' }, 403);
  try {
    const store = getStore();
    decideApproval(
      store,
      found.row.id,
      {
        approve: parsed.data.decision === 'approve',
        note: parsed.data.note,
        actor: userRecord(store, session),
        via: 'in_app',
        presdirRequired: parsed.data.presdirRequired,
      },
      new Date(),
    );
    return await done(c);
  } catch (err) {
    return fail(c, err);
  }
});

// --- Catat manual (HOD: staf IT; Presdir: Head IT/admin) ---------------------------------------

approvalRoutes.post('/api/approvals/:id/manual', async (c) => {
  const session = requireApiUser(c, ['agent', 'lead', 'admin']);
  if (session instanceof Response) return session;
  const parsed = await body(c, manualSchema);
  if (!parsed.ok) return parsed.res;
  const found = loadApproval(c);
  if (found instanceof Response) return found;
  const action = found.row.step === 'hod' ? 'ticket.work' : found.row.step === 'presdir' ? 'ticket.approve' : null;
  if (!action) return c.json({ ok: false, error: 'Approval Head IT diputuskan langsung di aplikasi' }, 400);
  if (!can(session, action, resourceOf(found.ticket)))
    return c.json({ ok: false, error: 'Anda tidak berhak mencatat persetujuan ini' }, 403);
  try {
    const store = getStore();
    decideApproval(
      store,
      found.row.id,
      {
        approve: parsed.data.decision === 'approve',
        note: `Dicatat manual: dikonfirmasi via ${parsed.data.channel}. ${parsed.data.note}`,
        actor: userRecord(store, session),
        via: 'manual',
      },
      new Date(),
    );
    return await done(c);
  } catch (err) {
    return fail(c, err);
  }
});

approvalRoutes.post('/api/approvals/:id/resend', async (c) => {
  const session = requireApiUser(c, ['agent', 'lead', 'admin']);
  if (session instanceof Response) return session;
  const found = loadApproval(c);
  if (found instanceof Response) return found;
  if (!can(session, 'ticket.work', resourceOf(found.ticket)))
    return c.json({ ok: false, error: 'Anda tidak berhak mengirim ulang link' }, 403);
  try {
    const store = getStore();
    resendApprovalLink(store, found.row.id, userRecord(store, session), new Date());
    return await done(c);
  } catch (err) {
    return fail(c, err);
  }
});

// --- Halaman publik (tanpa login) --------------------------------------------------------------

function publicSummary(ticket: TicketRecord) {
  const store = getStore();
  const requester = store.users.get(ticket.requesterId);
  return {
    number: ticket.number,
    title: ticket.title,
    description: ticket.description,
    requesterName: requester?.name ?? '—',
    department: requester?.department ?? '—',
    requestType: ticket.formData.service_request_type ?? '—',
    createdAt: ticket.createdAt.toISOString(),
    actionPlan: ticket.actionPlan,
    impactAnalysis: ticket.impactAnalysis,
  };
}

approvalRoutes.get('/approve/:token', (c) => {
  const found = findByToken(getStore(), c.req.param('token'), new Date());
  if (!found.ok) return c.html(approvePage({ state: found.reason }), found.reason === 'expired' ? 410 : 404);
  return c.html(approvePage({ state: 'form', step: found.row.step, approverName: found.row.approverName, ticket: publicSummary(found.ticket) }));
});

approvalRoutes.post('/approve/:token', async (c) => {
  const store = getStore();
  const found = findByToken(store, c.req.param('token'), new Date());
  if (!found.ok) return c.html(approvePage({ state: found.reason }), found.reason === 'expired' ? 410 : 404);
  const form = await c.req.parseBody().catch(() => null);
  if (!form) {
    return c.html(
      approvePage({
        state: 'form',
        step: found.row.step,
        approverName: found.row.approverName,
        ticket: publicSummary(found.ticket),
        error: 'Data formulir tidak valid',
      }),
      400,
    );
  }
  const decision = form.decision === 'approve' ? 'approve' : form.decision === 'reject' ? 'reject' : null;
  const note = typeof form.note === 'string' ? form.note.slice(0, 2000) : '';
  const formState = {
    state: 'form' as const,
    step: found.row.step,
    approverName: found.row.approverName,
    ticket: publicSummary(found.ticket),
    note,
  };
  if (!decision) return c.html(approvePage({ ...formState, error: 'Pilih Setujui atau Tolak' }), 400);
  try {
    decideApproval(store, found.row.id, { approve: decision === 'approve', note, actor: null, via: 'email' }, new Date());
  } catch (err) {
    return c.html(approvePage({ ...formState, error: err instanceof Error ? err.message : 'Gagal' }), 400);
  }
  if (!(await persistOrFail())) return c.html(approvePage({ ...formState, error: 'Gagal menyimpan, coba lagi' }), 500);
  return c.html(approvePage({ state: 'done', approved: decision === 'approve', number: found.ticket.number }));
});
