import { timingSafeEqual } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { adminCalendarRoutes } from '@/routes/admin-calendar';
import { attachmentRoutes } from '@/routes/attachments';
import { claimUploads } from '@/server/attachments';
import {
  LEVELS,
  PENDING_REASONS,
  PRIORITIES,
  RESOLUTION_CODES,
  ROLES,
  SERVICE_REQUEST_TYPES,
  TICKET_STATUSES,
} from '@/domain/types';
import { DB_ERROR_RESULT, persistOrFail } from '@/server/actions/persist';
import { can } from '@/server/auth/rbac';
import { getSessionUser, requireApiUser, userRecord } from '@/server/auth/session';
import { getDbDriver } from '@/server/db/config';
import { checkPostgres } from '@/server/db/postgres';
import { getSqlite, isDatabaseEnabled } from '@/server/db/sqlite';
import { startApprovalChain } from '@/server/mock/approvals';
import { getStore } from '@/server/mock/db';
import { nextChangeNumber, nextId } from '@/server/mock/store';
import {
  addComment as engineAddComment,
  assignTicket as engineAssignTicket,
  createTicket as engineCreateTicket,
  EngineError,
  overridePriority as engineOverridePriority,
  runSlaTick,
  submitCsat as engineSubmitCsat,
  transitionTicket as engineTransitionTicket,
  updateClassification as engineUpdateClassification,
} from '@/server/mock/ticket-engine';
import type {
  CatalogItemRecord,
  CategoryRecord,
  ChangeRecord,
  ChangeStatus,
  TicketRecord,
} from '@/server/mock/types';
import { searchTickets } from '@/server/queries/tickets';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

/** Id hasil POST /api/attachments (lihat routes/attachments.ts). */
const attachmentIdsSchema = z.array(z.string().min(1)).max(10, 'Maksimal 10 lampiran').optional();

const createTicketSchema = z.object({
  catalogItemId: z.string().min(1, 'Layanan wajib dipilih'),
  title: z.string().trim().min(5, 'Judul minimal 5 karakter').max(120, 'Judul maksimal 120 karakter'),
  description: z.string().trim().min(10, 'Deskripsi minimal 10 karakter').max(10000, 'Deskripsi maksimal 10000 karakter'),
  urgency: z.enum(LEVELS),
  impact: z.enum(LEVELS).optional(),
  formData: z
    .record(z.string(), z.string().max(2000, 'Nilai kolom tambahan terlalu panjang'))
    .default({})
    .transform((fd) => {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(fd)) {
        const trimmed = v.trim();
        if (trimmed) out[k] = trimmed;
      }
      return out;
    }),
  attachmentIds: attachmentIdsSchema,
}).superRefine((val, ctx) => {
  const fd = val.formData;
  const fail = (key: string, message: string) =>
    ctx.addIssue({ code: 'custom', path: ['formData', key], message });
  if (fd.service_request_type && !(SERVICE_REQUEST_TYPES as readonly string[]).includes(fd.service_request_type)) {
    fail('service_request_type', 'Jenis permintaan tidak valid');
  }
  if (val.catalogItemId === 'cat-item-others' && !fd.service_other) {
    fail('service_other', 'Sebutkan layanan lainnya');
  }
  if (fd.service_request_type === 'Others' && !fd.request_type_other) {
    fail('request_type_other', 'Sebutkan jenis permintaan lainnya');
  }
  if (fd.hod_email && !z.string().email().safeParse(fd.hod_email).success) {
    fail('hod_email', 'Email HOD tidak valid');
  }
});

const commentSchema = z.object({
  body: z.string().trim().min(2, 'Pesan tidak boleh kosong').max(10000, 'Pesan maksimal 10000 karakter'),
  visibility: z.enum(['public', 'internal']),
  attachmentIds: attachmentIdsSchema,
});

const transitionSchema = z.object({
  to: z.enum(TICKET_STATUSES),
  pendingReason: z.enum(PENDING_REASONS).optional(),
  resolutionCode: z.enum(RESOLUTION_CODES).optional(),
  resolutionNotes: z.string().max(5000).optional(),
  cancellationReason: z.string().max(1000).optional(),
  reopenReason: z.string().max(1000).optional(),
  assigneeId: z.string().optional(),
});

const assignSchema = z.object({
  assigneeId: z
    .string()
    .nullable()
    .optional()
    .transform((v) => (v && v.trim() !== '' ? v : null)),
  note: z.string().optional(),
});

const bulkAssignSchema = z.object({
  ticketIds: z.array(z.string().min(1)).min(1, 'Pilih minimal satu tiket').max(100, 'Maksimal 100 tiket sekaligus'),
  assigneeId: z
    .string()
    .nullable()
    .transform((v) => (v && v.trim() !== '' ? v : null)),
});

const overridePrioritySchema = z.object({
  priority: z.enum(PRIORITIES),
  reason: z.string().trim().min(10, 'Alasan override minimal 10 karakter').max(500, 'Alasan maksimal 500 karakter'),
});

const classificationSchema = z.object({
  impact: z.enum(LEVELS),
  urgency: z.enum(LEVELS),
});

const csatSchema = z.object({
  score: z.coerce.number().int().min(1, 'Skor harus 1–5').max(5, 'Skor harus 1–5'),
  comment: z.string().trim().max(1000, 'Komentar maksimal 1000 karakter').default(''),
});

const userRoleSchema = z.object({
  role: z.enum(ROLES),
});

const teamSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2, 'Nama tim minimal 2 karakter').max(100, 'Nama tim maksimal 100 karakter'),
  leadId: z.string().min(1, 'Head IT wajib dipilih'),
  autoAssign: z.boolean(),
  memberIds: z.array(z.string()),
});

const categorySchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2, 'Nama kategori minimal 2 karakter').max(100, 'Nama kategori maksimal 100 karakter'),
  parentId: z.string().nullable().optional(),
  defaultTeamId: z.string().nullable().optional(),
});

const catalogSchema = z.object({
  id: z.string().optional(),
  categoryId: z.string().min(1, 'Kategori wajib dipilih'),
  name: z.string().trim().min(3, 'Nama layanan minimal 3 karakter').max(120, 'Nama layanan maksimal 120 karakter'),
  description: z.string().trim().max(2000, 'Deskripsi maksimal 2000 karakter'),
  ticketType: z.enum(['incident', 'service_request']),
  defaultImpact: z.enum(LEVELS),
  slaPolicyId: z.string().nullable().optional(),
  isActive: z.boolean(),
  formSchema: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      type: z.enum(['text', 'textarea', 'select', 'date']),
      required: z.boolean(),
      options: z.array(z.string()).optional(),
    }),
  ),
});

const slaTickSchema = z.object({
  advanceMinutes: z.coerce
    .number()
    .finite()
    .min(0, 'Menit tidak boleh negatif')
    .max(525600, 'Maksimal simulasi 1 tahun (525600 menit)')
    .default(0),
});

const createChangeSchema = z.object({
  type: z.enum(['standard', 'normal', 'emergency']).default('standard'),
  title: z.string().min(3),
  source: z.enum(['pipeline', 'manual']).default('pipeline'),
  commitSha: z.string().default('unknown'),
  environment: z.string().default('production-local'),
  fromVersion: z.string().default('0.0.0'),
  toVersion: z.string().default('0.1.0'),
});

const updateChangeSchema = z.object({
  status: z.enum(['planned', 'in_progress', 'succeeded', 'failed', 'rolled_back']),
  notes: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function parseJson<T extends z.ZodTypeAny>(
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

function errorResponse(c: Context, err: unknown, fallback: string): Response {
  if (err instanceof EngineError) {
    const status = err.code === 'not_found' ? 404 : err.code === 'forbidden' ? 403 : 400;
    return c.json({ ok: false, error: err.message, code: err.code }, status);
  }
  return c.json({ ok: false, error: err instanceof Error ? err.message : fallback }, 400);
}

function verifyWebhookToken(c: Context): boolean {
  const auth = c.req.header('authorization');
  // The dev fallback token must never be accepted in production.
  const expectedToken =
    process.env.CHANGE_WEBHOOK_TOKEN || (process.env.NODE_ENV === 'production' ? '' : 'local-change-token');
  if (!auth || !expectedToken) return false;
  const token = Buffer.from(auth.replace(/^Bearer\s+/i, ''));
  const expected = Buffer.from(expectedToken);
  return token.length === expected.length && timingSafeEqual(token, expected);
}

function checkDatabase(): { enabled: boolean; ok?: boolean; latencyMs?: number } {
  if (!isDatabaseEnabled()) return { enabled: false };
  const started = Date.now();
  try {
    getSqlite().query('SELECT 1').get();
    return { enabled: true, ok: true, latencyMs: Date.now() - started };
  } catch {
    return { enabled: true, ok: false, latencyMs: Date.now() - started };
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const apiRoutes = new Hono();

// Tickets
apiRoutes.post('/tickets', async (c) => {
  const session = requireApiUser(c);
  if (session instanceof Response) return session;
  const body = await parseJson(c, createTicketSchema);
  if (!body.ok) return body.res;

  try {
    const store = getStore();
    const { attachmentIds, impact, ...input } = body.data;
    const attachments = claimUploads(store, session.id, attachmentIds ?? []);
    const ticket = engineCreateTicket(
      store,
      { ...input, impact: session.role === 'requester' ? undefined : impact, attachments },
      userRecord(store, session),
      new Date(),
    );
    startApprovalChain(store, ticket, new Date());
    if (!(await persistOrFail())) return c.json(DB_ERROR_RESULT, 500);
    return c.json({ ok: true, data: { number: ticket.number, id: ticket.id } }, 201);
  } catch (err) {
    return errorResponse(c, err, 'Gagal membuat tiket');
  }
});

apiRoutes.post('/tickets/bulk-assign', async (c) => {
  const session = requireApiUser(c, ['agent', 'lead', 'admin']);
  if (session instanceof Response) return session;
  const body = await parseJson(c, bulkAssignSchema);
  if (!body.ok) return body.res;

  const { ticketIds, assigneeId } = body.data;
  if (session.role === 'agent') {
    if (assigneeId !== session.id && assigneeId !== null) {
      return c.json({ ok: false, error: 'Agent hanya dapat mengambil tiket untuk diri sendiri' }, 403);
    }
  }

  try {
    const store = getStore();
    const actor = userRecord(store, session);
    if (assigneeId) {
      const targetUser = store.users.get(assigneeId);
      if (!targetUser?.isActive || targetUser.role === 'requester') {
        return c.json({ ok: false, error: 'Assignee bukan staf IT aktif' }, 400);
      }
    }

    const targets: TicketRecord[] = [];
    for (const id of new Set(ticketIds)) {
      const ticket = store.tickets.get(id);
      if (!ticket) continue;
      const resource = {
        requesterId: ticket.requesterId,
        teamId: ticket.teamId,
        assigneeId: ticket.assigneeId,
      };
      if (!can(session, 'ticket.assign', resource)) continue;
      if (session.role === 'agent' && ticket.assigneeId !== null && ticket.assigneeId !== session.id) {
        continue;
      }
      if (ticket.status === 'closed' || ticket.status === 'cancelled') {
        return c.json({ ok: false, error: `Tiket ${ticket.number} sudah final` }, 400);
      }
      if (assigneeId && ticket.teamId) {
        const team = store.teams.get(ticket.teamId);
        if (team && !team.memberIds.includes(assigneeId) && team.leadId !== assigneeId) {
          return c.json({ ok: false, error: `Assignee bukan anggota tim ${team.name}` }, 400);
        }
      }
      targets.push(ticket);
    }

    for (const ticket of targets) {
      engineAssignTicket(store, ticket.id, { assigneeId }, actor, new Date());
    }

    if (!(await persistOrFail())) return c.json(DB_ERROR_RESULT, 500);
    return c.json({ ok: true, data: { count: targets.length } });
  } catch (err) {
    return errorResponse(c, err, 'Bulk assign gagal');
  }
});

apiRoutes.post('/tickets/:id/comments', async (c) => {
  const session = requireApiUser(c);
  if (session instanceof Response) return session;
  const body = await parseJson(c, commentSchema);
  if (!body.ok) return body.res;

  const store = getStore();
  const ticket = store.tickets.get(c.req.param('id'));
  if (!ticket) return c.json({ ok: false, error: 'Tiket tidak ditemukan' }, 404);

  const resource = { requesterId: ticket.requesterId, teamId: ticket.teamId };
  if (body.data.visibility === 'internal') {
    if (!can(session, 'ticket.comment_internal', resource)) {
      return c.json({ ok: false, error: 'Anda tidak memiliki hak menulis catatan internal' }, 403);
    }
  } else if (!can(session, 'ticket.comment', resource)) {
    return c.json({ ok: false, error: 'Anda tidak memiliki hak membalas tiket ini' }, 403);
  }

  try {
    engineAddComment(
      store,
      ticket.id,
      userRecord(store, session),
      body.data.body,
      body.data.visibility,
      new Date(),
      claimUploads(store, session.id, body.data.attachmentIds ?? []),
    );
    if (!(await persistOrFail())) return c.json(DB_ERROR_RESULT, 500);
    return c.json({ ok: true, data: true });
  } catch (err) {
    return errorResponse(c, err, 'Gagal mengirim pesan');
  }
});

apiRoutes.post('/tickets/:id/transition', async (c) => {
  const session = requireApiUser(c);
  if (session instanceof Response) return session;
  const body = await parseJson(c, transitionSchema);
  if (!body.ok) return body.res;

  const store = getStore();
  const ticket = store.tickets.get(c.req.param('id'));
  if (!ticket) return c.json({ ok: false, error: 'Tiket tidak ditemukan' }, 404);

  const parsed = body.data;
  const resource = { requesterId: ticket.requesterId, teamId: ticket.teamId };

  // Staff hanya boleh menggerakkan tiket tim sendiri (owner requester ditangani aturan workflow).
  if (
    ticket.requesterId !== session.id &&
    !can(session, 'ticket.work', resource) &&
    parsed.to !== 'closed'
  ) {
    return c.json({ ok: false, error: 'Anda tidak berhak mengubah status tiket ini' }, 403);
  }
  // Ambil tiket lewat transisi mengikuti aturan ADR-008 (agent hanya untuk diri sendiri).
  if (parsed.to === 'assigned' && session.role === 'agent' && parsed.assigneeId !== session.id) {
    return c.json({ ok: false, error: 'Agent hanya dapat mengambil tiket untuk diri sendiri' }, 403);
  }
  if (parsed.to === 'cancelled' && !can(session, 'ticket.work', resource)) {
    return c.json({ ok: false, error: 'Hanya staff yang berhak membatalkan tiket' }, 403);
  }
  if (parsed.to === 'closed' && session.role !== 'admin' && ticket.requesterId !== session.id) {
    return c.json(
      { ok: false, error: 'Hanya requester atau admin yang dapat menutup tiket ini' },
      403,
    );
  }
  if (
    parsed.to === 'in_progress' &&
    ticket.status === 'resolved' &&
    ticket.requesterId !== session.id
  ) {
    return c.json(
      { ok: false, error: 'Hanya requester yang dapat membuka kembali tiket yang telah selesai' },
      403,
    );
  }

  try {
    engineTransitionTicket(
      store,
      ticket.id,
      parsed.to,
      userRecord(store, session),
      {
        pendingReason: parsed.pendingReason,
        resolutionCode: parsed.resolutionCode,
        resolutionNotes: parsed.resolutionNotes,
        reason: parsed.cancellationReason ?? parsed.reopenReason,
        assigneeId: parsed.assigneeId,
      },
      new Date(),
    );
    if (!(await persistOrFail())) return c.json(DB_ERROR_RESULT, 500);
    return c.json({ ok: true, data: true });
  } catch (err) {
    return errorResponse(c, err, 'Transisi ditolak');
  }
});

apiRoutes.post('/tickets/:id/assign', async (c) => {
  const session = requireApiUser(c, ['agent', 'lead', 'admin']);
  if (session instanceof Response) return session;
  const body = await parseJson(c, assignSchema);
  if (!body.ok) return body.res;

  const store = getStore();
  const ticket = store.tickets.get(c.req.param('id'));
  if (!ticket) return c.json({ ok: false, error: 'Tiket tidak ditemukan' }, 404);

  const parsed = body.data;
  const resource = {
    requesterId: ticket.requesterId,
    teamId: ticket.teamId,
    assigneeId: ticket.assigneeId,
  };
  if (!can(session, 'ticket.assign', resource)) {
    return c.json({ ok: false, error: 'Anda tidak memiliki hak penugasan tiket ini' }, 403);
  }

  // ADR-008 Option B: agent hanya boleh klaim tiket unassigned atau melepas tiket miliknya sendiri
  if (session.role === 'agent') {
    if (ticket.assigneeId === null) {
      if (parsed.assigneeId !== null && parsed.assigneeId !== session.id) {
        return c.json(
          { ok: false, error: 'Agent hanya berhak mengambil tiket unassigned untuk diri sendiri' },
          403,
        );
      }
    } else if (ticket.assigneeId === session.id) {
      if (parsed.assigneeId !== null && parsed.assigneeId !== session.id) {
        return c.json(
          { ok: false, error: 'Agent hanya berhak melepaskan penugasan tiket miliknya sendiri' },
          403,
        );
      }
    } else {
      return c.json(
        { ok: false, error: 'Hanya Head IT atau Admin yang berhak memindahkan tiket milik staf lain' },
        403,
      );
    }
  }

  try {
    engineAssignTicket(store, ticket.id, parsed, userRecord(store, session), new Date());
    if (!(await persistOrFail())) return c.json(DB_ERROR_RESULT, 500);
    return c.json({ ok: true, data: true });
  } catch (err) {
    return errorResponse(c, err, 'Penugasan gagal');
  }
});

apiRoutes.post('/tickets/:id/priority', async (c) => {
  const session = requireApiUser(c, ['lead', 'admin']);
  if (session instanceof Response) return session;
  const body = await parseJson(c, overridePrioritySchema);
  if (!body.ok) return body.res;

  const store = getStore();
  const ticket = store.tickets.get(c.req.param('id'));
  if (!ticket) return c.json({ ok: false, error: 'Tiket tidak ditemukan' }, 404);

  if (
    !can(session, 'ticket.override_priority', {
      requesterId: ticket.requesterId,
      teamId: ticket.teamId,
    })
  ) {
    return c.json(
      { ok: false, error: 'Hanya Head IT dan Admin yang berhak melakukan override prioritas' },
      403,
    );
  }

  try {
    engineOverridePriority(
      store,
      ticket.id,
      body.data.priority,
      body.data.reason,
      userRecord(store, session),
      new Date(),
    );
    if (!(await persistOrFail())) return c.json(DB_ERROR_RESULT, 500);
    return c.json({ ok: true, data: true });
  } catch (err) {
    return errorResponse(c, err, 'Gagal override prioritas');
  }
});

apiRoutes.post('/tickets/:id/classification', async (c) => {
  const session = requireApiUser(c, ['agent', 'lead', 'admin']);
  if (session instanceof Response) return session;
  const body = await parseJson(c, classificationSchema);
  if (!body.ok) return body.res;

  const store = getStore();
  const ticket = store.tickets.get(c.req.param('id'));
  if (!ticket) return c.json({ ok: false, error: 'Tiket tidak ditemukan' }, 404);
  if (!can(session, 'ticket.work', { requesterId: ticket.requesterId, teamId: ticket.teamId })) {
    return c.json({ ok: false, error: 'Anda tidak berhak mengubah klasifikasi tiket ini' }, 403);
  }

  try {
    engineUpdateClassification(
      store,
      ticket.id,
      body.data.impact,
      body.data.urgency,
      userRecord(store, session),
      new Date(),
    );
    if (!(await persistOrFail())) return c.json(DB_ERROR_RESULT, 500);
    return c.json({ ok: true, data: true });
  } catch (err) {
    return errorResponse(c, err, 'Gagal mengubah klasifikasi');
  }
});

apiRoutes.post('/tickets/:id/csat', async (c) => {
  const session = requireApiUser(c);
  if (session instanceof Response) return session;
  const body = await parseJson(c, csatSchema);
  if (!body.ok) return body.res;

  const store = getStore();
  const ticket = store.tickets.get(c.req.param('id'));
  if (!ticket) return c.json({ ok: false, error: 'Tiket tidak ditemukan' }, 404);

  if (ticket.requesterId !== session.id) {
    return c.json(
      { ok: false, error: 'Hanya pembuat tiket yang dapat mengisi survei kepuasan' },
      403,
    );
  }

  try {
    engineSubmitCsat(
      store,
      ticket.id,
      body.data.score,
      body.data.comment,
      userRecord(store, session),
      new Date(),
    );
    if (!(await persistOrFail())) return c.json(DB_ERROR_RESULT, 500);
    return c.json({ ok: true, data: true });
  } catch (err) {
    return errorResponse(c, err, 'Gagal mengirim survei');
  }
});

// Notifications
apiRoutes.post('/notifications/read-all', async (c) => {
  const session = requireApiUser(c);
  if (session instanceof Response) return session;

  const store = getStore();
  const now = new Date();
  for (const n of store.notifications) {
    if (n.userId === session.id && !n.readAt) n.readAt = now;
  }
  if (!(await persistOrFail())) return c.json(DB_ERROR_RESULT, 500);
  return c.json({ ok: true, data: true });
});

apiRoutes.post('/notifications/:id/read', async (c) => {
  const session = requireApiUser(c);
  if (session instanceof Response) return session;

  const store = getStore();
  const id = c.req.param('id');
  const n = store.notifications.find((item) => item.id === id && item.userId === session.id);
  if (n) n.readAt = new Date();
  if (!(await persistOrFail())) return c.json(DB_ERROR_RESULT, 500);
  return c.json({ ok: true, data: true });
});

// Admin
apiRoutes.route('/', adminCalendarRoutes);
apiRoutes.route('/attachments', attachmentRoutes);
apiRoutes.post('/admin/users/:id/toggle', async (c) => {
  const session = requireApiUser(c, ['admin']);
  if (session instanceof Response) return session;

  const store = getStore();
  const user = store.users.get(c.req.param('id'));
  if (!user) return c.json({ ok: false, error: 'User tidak ditemukan' }, 404);
  user.isActive = !user.isActive;
  if (!(await persistOrFail())) return c.json(DB_ERROR_RESULT, 500);
  return c.json({ ok: true, data: user.isActive });
});

apiRoutes.post('/admin/users/:id/role', async (c) => {
  const session = requireApiUser(c, ['admin']);
  if (session instanceof Response) return session;
  const body = await parseJson(c, userRoleSchema);
  if (!body.ok) return body.res;

  const store = getStore();
  const user = store.users.get(c.req.param('id'));
  if (!user) return c.json({ ok: false, error: 'User tidak ditemukan' }, 404);
  if (body.data.role === 'requester') {
    for (const team of store.teams.values()) {
      if (team.leadId === user.id) {
        return c.json(
          { ok: false, error: 'User masih menjadi Head IT tim; pindahkan Head IT terlebih dahulu' },
          400,
        );
      }
    }
    for (const team of store.teams.values()) {
      team.memberIds = team.memberIds.filter((id) => id !== user.id);
    }
  }
  user.role = body.data.role;
  if (!(await persistOrFail())) return c.json(DB_ERROR_RESULT, 500);
  return c.json({ ok: true, data: true });
});

apiRoutes.post('/admin/teams', async (c) => {
  const session = requireApiUser(c, ['admin']);
  if (session instanceof Response) return session;
  const body = await parseJson(c, teamSchema);
  if (!body.ok) return body.res;

  const parsed = body.data;
  const store = getStore();
  // Organisasi hanya punya satu Tim IT: endpoint ini hanya mengubah tim yang ada.
  const existing = parsed.id ? store.teams.get(parsed.id) : undefined;
  if (!existing) return c.json({ ok: false, error: 'Tim tidak ditemukan (hanya ada satu Tim IT)' }, 404);
  const isStaff = (id: string) => {
    const u = store.users.get(id);
    return !!u && u.isActive && u.role !== 'requester';
  };
  if (!isStaff(parsed.leadId) || !parsed.memberIds.every(isStaff)) {
    return c.json({ ok: false, error: 'Head IT dan anggota harus akun staf IT aktif' }, 400);
  }
  existing.name = parsed.name;
  existing.leadId = parsed.leadId;
  existing.autoAssign = parsed.autoAssign;
  existing.memberIds = [...new Set(parsed.memberIds)].filter((id) => id !== parsed.leadId);

  if (!(await persistOrFail())) return c.json(DB_ERROR_RESULT, 500);
  return c.json({ ok: true, data: true });
});

apiRoutes.post('/admin/teams/:id/auto-assign', async (c) => {
  const session = requireApiUser(c, ['admin']);
  if (session instanceof Response) return session;

  const store = getStore();
  const team = store.teams.get(c.req.param('id'));
  if (!team) return c.json({ ok: false, error: 'Tim tidak ditemukan' }, 404);
  team.autoAssign = !team.autoAssign;
  if (!(await persistOrFail())) return c.json(DB_ERROR_RESULT, 500);
  return c.json({ ok: true, data: team.autoAssign });
});

apiRoutes.post('/admin/categories', async (c) => {
  const session = requireApiUser(c, ['admin']);
  if (session instanceof Response) return session;
  const body = await parseJson(c, categorySchema);
  if (!body.ok) return body.res;

  const parsed = body.data;
  const store = getStore();
  if (parsed.parentId) {
    if (parsed.parentId === parsed.id || !store.categories.has(parsed.parentId)) {
      return c.json({ ok: false, error: 'Kategori induk tidak valid' }, 400);
    }
  }
  if (parsed.defaultTeamId && !store.teams.has(parsed.defaultTeamId)) {
    return c.json({ ok: false, error: 'Tim default tidak ditemukan' }, 400);
  }
  if (parsed.id) {
    const existing = store.categories.get(parsed.id);
    if (!existing) return c.json({ ok: false, error: 'Kategori tidak ditemukan' }, 404);
    existing.name = parsed.name;
    existing.parentId = parsed.parentId ?? null;
    existing.defaultTeamId = parsed.defaultTeamId ?? null;
  } else {
    const newId = nextId(store, 'cat');
    const record: CategoryRecord = {
      id: newId,
      name: parsed.name,
      parentId: parsed.parentId ?? null,
      defaultTeamId: parsed.defaultTeamId ?? null,
      isActive: true,
    };
    store.categories.set(newId, record);
  }

  if (!(await persistOrFail())) return c.json(DB_ERROR_RESULT, 500);
  return c.json({ ok: true, data: true });
});

apiRoutes.post('/admin/catalog', async (c) => {
  const session = requireApiUser(c, ['admin']);
  if (session instanceof Response) return session;
  const body = await parseJson(c, catalogSchema);
  if (!body.ok) return body.res;

  const parsed = body.data;
  const store = getStore();
  if (!store.categories.has(parsed.categoryId)) {
    return c.json({ ok: false, error: 'Kategori layanan tidak ditemukan' }, 400);
  }
  if (parsed.slaPolicyId && !store.policies.has(parsed.slaPolicyId)) {
    return c.json({ ok: false, error: 'Kebijakan SLA tidak ditemukan' }, 400);
  }
  if (parsed.id) {
    const existing = store.catalog.get(parsed.id);
    if (!existing) return c.json({ ok: false, error: 'Item katalog tidak ditemukan' }, 404);
    existing.categoryId = parsed.categoryId;
    existing.name = parsed.name;
    existing.description = parsed.description;
    existing.ticketType = parsed.ticketType;
    existing.defaultImpact = parsed.defaultImpact;
    existing.slaPolicyId = parsed.slaPolicyId ?? null;
    existing.isActive = parsed.isActive;
    existing.formSchema = parsed.formSchema;
  } else {
    const newId = nextId(store, 'svc');
    const record: CatalogItemRecord = {
      id: newId,
      categoryId: parsed.categoryId,
      name: parsed.name,
      description: parsed.description,
      icon: 'HelpCircle',
      ticketType: parsed.ticketType,
      defaultImpact: parsed.defaultImpact,
      slaPolicyId: parsed.slaPolicyId ?? null,
      isActive: parsed.isActive,
      keywords: [parsed.name.toLowerCase()],
      formSchema: parsed.formSchema,
    };
    store.catalog.set(newId, record);
  }

  if (!(await persistOrFail())) return c.json(DB_ERROR_RESULT, 500);
  return c.json({ ok: true, data: true });
});

apiRoutes.post('/admin/sla-tick', async (c) => {
  const session = requireApiUser(c, ['admin']);
  if (session instanceof Response) return session;

  const rawText = await c.req.text();
  let advanceMinutes = 0;
  if (rawText.trim()) {
    let raw: unknown;
    try {
      raw = JSON.parse(rawText);
    } catch {
      return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
    }
    const parsed = slaTickSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(
        { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid request' },
        400,
      );
    }
    advanceMinutes = parsed.data.advanceMinutes;
  }

  const store = getStore();
  const now = new Date(Date.now() + advanceMinutes * 60_000);
  const result = runSlaTick(store, now);
  if (!(await persistOrFail())) return c.json(DB_ERROR_RESULT, 500);
  return c.json({
    ok: true,
    data: {
      ...result,
      simulatedNow: now.toISOString(),
    },
  });
});

// Search
apiRoutes.get('/search', (c) => {
  const user = getSessionUser(c);
  if (!user) return c.json({ hits: [] }, 401);

  const q = c.req.query('q') ?? '';
  const hits = searchTickets(getStore(), user, q, 8);
  return c.json({ hits });
});

// Health
apiRoutes.get('/health', async (c) => {
  const driver = getDbDriver();
  const database = {
    driver,
    ...(driver === 'postgres' ? await checkPostgres() : checkDatabase()),
  };
  const databaseDown = database.enabled && database.ok !== true;

  try {
    const store = getStore();
    const version = process.env.APP_VERSION || '0.1.0';
    const lastTick = store.workerLastTick ? store.workerLastTick.toISOString() : null;

    return c.json(
      {
        status: databaseDown ? 'unhealthy' : 'healthy',
        version,
        db: 'ready',
        database,
        worker_last_tick: lastTick,
        uptime_seconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
      },
      databaseDown ? 503 : 200,
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json(
      {
        status: 'unhealthy',
        error: message,
        database,
        timestamp: new Date().toISOString(),
      },
      503,
    );
  }
});

// Worker tick
apiRoutes.post('/worker/tick', async (c) => {
  if (!verifyWebhookToken(c)) {
    const session = requireApiUser(c, ['admin']);
    if (session instanceof Response) return session;
  }
  try {
    const store = getStore();
    const result = runSlaTick(store, new Date());
    if (!(await persistOrFail())) return c.json(DB_ERROR_RESULT, 500);
    return c.json({
      ok: true,
      data: {
        ...result,
        lastTick: store.workerLastTick?.toISOString(),
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Worker tick failed';
    return c.json({ ok: false, error: msg }, 500);
  }
});

// Changes webhook
apiRoutes.get('/changes', (c) => {
  if (!verifyWebhookToken(c)) {
    const session = requireApiUser(c, ['agent', 'lead', 'admin']);
    if (session instanceof Response) return session;
  }
  const store = getStore();
  return c.json({ ok: true, data: store.changes });
});

apiRoutes.post('/changes', async (c) => {
  if (!verifyWebhookToken(c)) {
    return c.json({ ok: false, error: 'Unauthorized' }, 401);
  }
  const body = await parseJson(c, createChangeSchema);
  if (!body.ok) return body.res;

  const parsed = body.data;
  const store = getStore();
  const change: ChangeRecord = {
    id: nextId(store, 'chg'),
    number: nextChangeNumber(store),
    type: parsed.type,
    title: parsed.title,
    status: 'in_progress',
    source: parsed.source,
    commitSha: parsed.commitSha,
    environment: parsed.environment,
    startedAt: new Date(),
    finishedAt: null,
    metadata: {
      fromVersion: parsed.fromVersion,
      toVersion: parsed.toVersion,
    },
  };

  store.changes.unshift(change);
  if (!(await persistOrFail())) return c.json(DB_ERROR_RESULT, 500);
  return c.json({ ok: true, data: change }, 201);
});

apiRoutes.patch('/changes/:id', async (c) => {
  if (!verifyWebhookToken(c)) {
    return c.json({ ok: false, error: 'Unauthorized' }, 401);
  }
  const body = await parseJson(c, updateChangeSchema);
  if (!body.ok) return body.res;

  const id = c.req.param('id');
  const store = getStore();
  const change = store.changes.find((item) => item.id === id || item.number === id);
  if (!change) {
    return c.json({ ok: false, error: 'Change record not found' }, 404);
  }

  change.status = body.data.status as ChangeStatus;
  if (['succeeded', 'failed', 'rolled_back'].includes(body.data.status)) {
    change.finishedAt = new Date();
  }

  if (!(await persistOrFail())) return c.json(DB_ERROR_RESULT, 500);
  return c.json({ ok: true, data: change });
});
