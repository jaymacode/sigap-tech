import { businessMinutesBetween } from '@/domain/calendar';
import { calculateTicketPriority, isValidOverrideReason, priorityRank } from '@/domain/priority';
import {
  cancel as cancelSla,
  computeSlaState,
  createSlaInstances,
  pause as pauseSla,
  rebaseline,
  reopen as reopenSla,
  resume as resumeSla,
  stop as stopSla,
  type SlaInstance,
} from '@/domain/sla';
import {
  ACTIVE_STATUSES,
  PRIORITIES,
  type Impact,
  type Priority,
  type SlaKind,
  type TicketEventType,
  type TicketStatus,
  type Urgency,
} from '@/domain/types';
import { transition, type Actor, type TransitionPayload } from '@/domain/workflow';
import { CAL_BUSINESS } from './reference-data';
import { businessCalendar, listFor, nextId, type Store } from './store';
import type {
  AttachmentRecord,
  CommentVisibility,
  NotificationType,
  SlaInstanceRecord,
  SlaTargetRecord,
  TicketRecord,
  UserRecord,
} from './types';

/**
 * Ticket engine mock — padanan `ticketService`/`slaService`/`assignmentService` (ARCHITECTURE.md §3).
 * Setiap operasi: domain memutuskan → engine menyimpan tiket + SLA + `ticket_events` + notifikasi
 * secara bersamaan (setara satu transaksi DB). Tidak ada jalur update tiket tanpa event.
 *
 * Otorisasi RBAC dicek di layer server action; engine hanya menegakkan aturan domain.
 */

export class EngineError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'EngineError';
  }
}

/** Auto-close setelah 3 hari kerja (PRD US-05). */
export const AUTO_CLOSE_BUSINESS_MINUTES = 3 * 8 * 60;

// ---------------------------------------------------------------------------
// Helper internal
// ---------------------------------------------------------------------------

function toActor(user: UserRecord | null): Actor {
  return user ? { kind: 'user', id: user.id, role: user.role } : { kind: 'system' };
}

function requireTicket(store: Store, ticketId: string): TicketRecord {
  const ticket = store.tickets.get(ticketId);
  if (!ticket) throw new EngineError('not_found', 'Tiket tidak ditemukan');
  return ticket;
}

function saveTicket(store: Store, ticket: TicketRecord, now: Date): TicketRecord {
  const saved = { ...ticket, updatedAt: now };
  store.tickets.set(ticket.id, saved);
  return saved;
}

function appendEvent(
  store: Store,
  ticketId: string,
  actorId: string | null,
  type: TicketEventType,
  data: Record<string, unknown>,
  at: Date,
): void {
  listFor(store.events, ticketId).push({
    id: nextId(store, 'evt'),
    ticketId,
    actorId,
    type,
    data,
    createdAt: at,
  });
}

function notify(
  store: Store,
  userId: string | null | undefined,
  type: NotificationType,
  ticket: TicketRecord,
  title: string,
  at: Date,
  exceptUserId?: string | null,
): void {
  if (!userId || userId === exceptUserId) return;
  store.notifications.push({
    id: nextId(store, 'ntf'),
    userId,
    type,
    ticketId: ticket.id,
    title,
    readAt: null,
    createdAt: at,
  });
}

function teamLeadId(store: Store, teamId: string | null): string | null {
  return teamId ? (store.teams.get(teamId)?.leadId ?? null) : null;
}

function slaPair(
  store: Store,
  ticketId: string,
): { response: SlaInstanceRecord; resolution: SlaInstanceRecord } {
  const pair = store.sla.get(ticketId);
  if (!pair) throw new EngineError('sla_missing', 'SLA instance tidak ditemukan');
  return pair;
}

function setSla(store: Store, ticketId: string, kind: SlaKind, instance: SlaInstance): void {
  const pair = slaPair(store, ticketId);
  store.sla.set(ticketId, { ...pair, [kind]: { ...pair[kind], ...instance } });
}

/**
 * Mencari target SLA untuk prioritas. Policy request hanya punya P3/P4; jika prioritas tidak ada,
 * pakai target prioritas terdekat yang lebih rendah.
 */
function targetFor(store: Store, policyId: string, priority: Priority): SlaTargetRecord {
  const policy = store.policies.get(policyId);
  if (!policy) throw new EngineError('policy_missing', `SLA policy ${policyId} tidak ditemukan`);
  const ordered = PRIORITIES.slice(priorityRank(priority) - 1);
  for (const p of ordered) {
    const target = policy.targets.find((t) => t.priority === p);
    if (target) return target;
  }
  const fallback = policy.targets.at(-1);
  if (!fallback) throw new EngineError('policy_empty', `SLA policy ${policyId} tidak punya target`);
  return fallback;
}

function policyIdFor(store: Store, ticket: Pick<TicketRecord, 'type' | 'catalogItemId'>): string {
  const item = ticket.catalogItemId ? store.catalog.get(ticket.catalogItemId) : undefined;
  if (item?.slaPolicyId) return item.slaPolicyId;
  const def = [...store.policies.values()].find((p) => p.ticketType === ticket.type && p.isDefault);
  if (!def) throw new EngineError('policy_missing', 'Default SLA policy tidak ditemukan');
  return def.id;
}

/** Menulis event SLA saat instance berhenti (met/breached). */
function recordSlaStop(
  store: Store,
  ticket: TicketRecord,
  before: SlaInstanceRecord,
  after: SlaInstance,
  at: Date,
): void {
  if (after === before) return;
  setSla(store, ticket.id, before.kind, after);
  if (after.status === 'met' || after.status === 'breached') {
    appendEvent(
      store,
      ticket.id,
      null,
      after.status === 'met' ? 'sla_met' : 'sla_breached',
      {
        kind: before.kind,
        elapsedMinutes: Math.round(after.elapsedMinutes),
        targetMinutes: after.targetMinutes,
      },
      at,
    );
  }
}

/** First response: hentikan response clock (komentar publik agent / status → In Progress). */
function markFirstResponse(store: Store, ticket: TicketRecord, at: Date): TicketRecord {
  const { response } = slaPair(store, ticket.id);
  const cal = businessCalendar(store, response.calendarId);
  recordSlaStop(store, ticket, response, stopSla(response, at, cal), at);
  return ticket.firstResponseAt ? ticket : { ...ticket, firstResponseAt: at };
}

/** Agent aktif dengan beban tiket aktif paling sedikit (round-robin by load, tie → urutan id). */
function pickAssignee(store: Store, teamId: string): string | null {
  const team = store.teams.get(teamId);
  if (!team) return null;
  const candidates = team.memberIds.filter((id) => {
    const u = store.users.get(id);
    return u?.isActive && u.role === 'agent';
  });
  if (candidates.length === 0) return null;
  const load = new Map(candidates.map((id) => [id, 0]));
  for (const t of store.tickets.values()) {
    if (t.assigneeId && load.has(t.assigneeId) && ACTIVE_STATUSES.includes(t.status)) {
      load.set(t.assigneeId, (load.get(t.assigneeId) ?? 0) + 1);
    }
  }
  return (
    [...load.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null
  );
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export interface AttachmentInput {
  fileName: string;
  mime: string;
  size: number;
}

export interface CreateTicketInput {
  catalogItemId: string;
  title: string;
  description: string;
  urgency: Urgency;
  /** Hanya untuk staff/seed; portal requester selalu memakai default katalog. */
  impact?: Impact;
  formData: Record<string, string>;
  attachments?: AttachmentInput[];
}

function nextNumber(store: Store, type: TicketRecord['type']): string {
  if (type === 'incident') {
    store.sequences.incident += 1;
    return `INC-${String(store.sequences.incident).padStart(6, '0')}`;
  }
  store.sequences.request += 1;
  return `REQ-${String(store.sequences.request).padStart(6, '0')}`;
}

function addAttachments(
  store: Store,
  ticket: TicketRecord,
  uploaderId: string,
  files: AttachmentInput[],
  commentId: string | null,
  at: Date,
): void {
  const list = listFor(store.attachments, ticket.id);
  for (const file of files) {
    const record: AttachmentRecord = {
      id: nextId(store, 'att'),
      ticketId: ticket.id,
      commentId,
      uploaderId,
      fileName: file.fileName,
      mime: file.mime,
      size: file.size,
      storageKey: `mock/${ticket.number}/${file.fileName}`,
      createdAt: at,
    };
    list.push(record);
    appendEvent(
      store,
      ticket.id,
      uploaderId,
      'attachment_added',
      { fileName: file.fileName, size: file.size },
      at,
    );
  }
}

/**
 * Membuat tiket dari katalog: tiket + 2 SLA instance + event `created` + auto-assign.
 * @param store - store
 * @param input - data form (sudah divalidasi Zod)
 * @param requester - pembuat tiket
 * @param now - waktu sekarang
 * @throws EngineError jika katalog tidak ditemukan / nonaktif
 */
export function createTicket(
  store: Store,
  input: CreateTicketInput,
  requester: UserRecord,
  now: Date,
): TicketRecord {
  const item = store.catalog.get(input.catalogItemId);
  if (!item || !item.isActive)
    throw new EngineError('catalog_not_found', 'Layanan tidak ditemukan');
  const category = store.categories.get(item.categoryId);

  const impact = input.impact ?? item.defaultImpact;
  const priority = calculateTicketPriority(item.ticketType, impact, input.urgency);
  let ticket: TicketRecord = {
    id: nextId(store, 'tkt'),
    number: nextNumber(store, item.ticketType),
    type: item.ticketType,
    title: input.title.trim(),
    description: input.description.trim(),
    catalogItemId: item.id,
    categoryId: item.categoryId,
    formData: input.formData,
    requesterId: requester.id,
    teamId: category?.defaultTeamId ?? null,
    assigneeId: null,
    impact,
    urgency: input.urgency,
    priority,
    priorityOverridden: false,
    status: 'new',
    pendingReason: null,
    resolutionCode: null,
    resolutionNotes: null,
    firstResponseAt: null,
    resolvedAt: null,
    closedAt: null,
    reopenCount: 0,
    escalationLevel: 0,
    problemId: null,
    isMajor: false,
    createdAt: now,
    updatedAt: now,
  };
  store.tickets.set(ticket.id, ticket);
  store.ticketIdByNumber.set(ticket.number, ticket.id);

  const policyId = policyIdFor(store, ticket);
  const target = targetFor(store, policyId, priority);
  const cal = businessCalendar(store, target.calendarId);
  const { response, resolution } = createSlaInstances(
    now,
    { responseMinutes: target.responseMinutes, resolutionMinutes: target.resolutionMinutes },
    cal,
  );
  const base = { ticketId: ticket.id, policyId, calendarId: target.calendarId };
  store.sla.set(ticket.id, {
    response: { ...response, ...base, id: nextId(store, 'sla') },
    resolution: { ...resolution, ...base, id: nextId(store, 'sla') },
  });

  appendEvent(
    store,
    ticket.id,
    requester.id,
    'created',
    {
      number: ticket.number,
      priority,
      impact: ticket.impact,
      urgency: ticket.urgency,
      teamId: ticket.teamId,
    },
    now,
  );
  if (input.attachments?.length)
    addAttachments(store, ticket, requester.id, input.attachments, null, now);

  // Auto-assign (ITSM.md §6) bila tim mengaktifkannya.
  const team = ticket.teamId ? store.teams.get(ticket.teamId) : undefined;
  if (team?.autoAssign) {
    const assigneeId = pickAssignee(store, team.id);
    if (assigneeId)
      ticket = transitionTicket(store, ticket.id, 'assigned', null, { assigneeId }, now);
  }
  return ticket;
}

// ---------------------------------------------------------------------------
// Transition
// ---------------------------------------------------------------------------

const STATUS_LABEL_FOR_REQUESTER: Partial<Record<TicketStatus, string>> = {
  resolved: 'sudah diselesaikan — mohon konfirmasi',
  pending: 'menunggu jawaban Anda',
  closed: 'ditutup',
  cancelled: 'dibatalkan',
};

/**
 * Menjalankan transisi status beserta efek SLA (ITSM.md §4.3) dan notifikasi.
 * @param actor - user pelaku, atau null untuk sistem
 * @throws EngineError dengan kode DomainError bila transisi ditolak
 */
export function transitionTicket(
  store: Store,
  ticketId: string,
  to: TicketStatus,
  actor: UserRecord | null,
  payload: TransitionPayload,
  now: Date,
): TicketRecord {
  const current = requireTicket(store, ticketId);
  const result = transition(current, to, toActor(actor), payload, now);
  if (!result.ok) throw new EngineError(result.error.code, result.error.message);

  let ticket = result.value.ticket;
  const actorId = actor?.id ?? null;
  for (const event of result.value.events)
    appendEvent(store, ticket.id, actorId, event.type, event.data, now);

  const { response, resolution } = slaPair(store, ticket.id);
  const resCal = businessCalendar(store, resolution.calendarId);
  const from = current.status;

  if (to === 'in_progress' && from === 'assigned') {
    ticket = markFirstResponse(store, ticket, now);
  } else if (to === 'pending') {
    setSla(store, ticket.id, 'resolution', pauseSla(resolution, now, resCal));
    appendEvent(
      store,
      ticket.id,
      null,
      'sla_paused',
      { kind: 'resolution', reason: ticket.pendingReason },
      now,
    );
  } else if (to === 'in_progress' && from === 'pending') {
    const resumed = resumeSla(resolution, now, resCal);
    setSla(store, ticket.id, 'resolution', resumed);
    appendEvent(
      store,
      ticket.id,
      null,
      'sla_resumed',
      { kind: 'resolution', dueAt: resumed.dueAt.toISOString() },
      now,
    );
  } else if (to === 'resolved') {
    ticket = markFirstResponse(store, ticket, now);
    recordSlaStop(
      store,
      ticket,
      slaPair(store, ticket.id).resolution,
      stopSla(resolution, now, resCal),
      now,
    );
  } else if (to === 'in_progress' && from === 'resolved') {
    const reopened = reopenSla(resolution, now, resCal);
    setSla(store, ticket.id, 'resolution', reopened);
    appendEvent(
      store,
      ticket.id,
      null,
      'sla_resumed',
      { kind: 'resolution', dueAt: reopened.dueAt.toISOString() },
      now,
    );
  } else if (to === 'cancelled') {
    setSla(
      store,
      ticket.id,
      'response',
      cancelSla(response, now, businessCalendar(store, response.calendarId)),
    );
    setSla(store, ticket.id, 'resolution', cancelSla(resolution, now, resCal));
  }

  ticket = saveTicket(store, ticket, now);

  // Notifikasi
  if (to === 'assigned') {
    notify(
      store,
      ticket.assigneeId,
      'assigned',
      ticket,
      `${ticket.number} ditugaskan kepada Anda`,
      now,
      actorId,
    );
  }
  if (from === 'resolved' && to === 'in_progress') {
    notify(
      store,
      ticket.assigneeId,
      'status_changed',
      ticket,
      `${ticket.number} dibuka kembali oleh requester`,
      now,
      actorId,
    );
  }
  const requesterLabel =
    to === 'pending' && ticket.pendingReason !== 'awaiting_user'
      ? undefined
      : STATUS_LABEL_FOR_REQUESTER[to];
  if (requesterLabel) {
    notify(
      store,
      ticket.requesterId,
      'status_changed',
      ticket,
      `Tiket ${ticket.number} ${requesterLabel}`,
      now,
      actorId,
    );
  }
  return ticket;
}

// ---------------------------------------------------------------------------
// Comment
// ---------------------------------------------------------------------------

/**
 * Menambah komentar publik / catatan internal.
 * - Komentar publik pertama oleh staff = first response.
 * - Balasan requester saat `awaiting_user` → sistem melanjutkan tiket ke In Progress.
 * @throws EngineError jika tiket final atau requester mencoba catatan internal
 */
export function addComment(
  store: Store,
  ticketId: string,
  author: UserRecord,
  body: string,
  visibility: CommentVisibility,
  now: Date,
  attachments: AttachmentInput[] = [],
): TicketRecord {
  let ticket = requireTicket(store, ticketId);
  if (ticket.status === 'closed' || ticket.status === 'cancelled') {
    throw new EngineError(
      'final_status',
      'Tiket sudah final; buat tiket baru bila masalah berulang',
    );
  }
  const isStaff = author.role !== 'requester';
  if (!isStaff && visibility === 'internal') {
    throw new EngineError('forbidden', 'Requester tidak dapat menulis catatan internal');
  }

  const comment = {
    id: nextId(store, 'cmt'),
    ticketId,
    authorId: author.id,
    body: body.trim(),
    visibility,
    createdAt: now,
  };
  listFor(store.comments, ticketId).push(comment);
  appendEvent(
    store,
    ticketId,
    author.id,
    visibility === 'internal' ? 'internal_note' : 'commented',
    { commentId: comment.id },
    now,
  );
  if (attachments.length) addAttachments(store, ticket, author.id, attachments, comment.id, now);

  if (isStaff && visibility === 'public') {
    ticket = saveTicket(store, markFirstResponse(store, ticket, now), now);
    notify(
      store,
      ticket.requesterId,
      'comment',
      ticket,
      `Balasan baru di ${ticket.number}`,
      now,
      author.id,
    );
  }
  if (!isStaff) {
    notify(
      store,
      ticket.assigneeId ?? teamLeadId(store, ticket.teamId),
      'comment',
      ticket,
      `${author.name} membalas ${ticket.number}`,
      now,
      author.id,
    );
    if (ticket.status === 'pending' && ticket.pendingReason === 'awaiting_user') {
      ticket = transitionTicket(store, ticketId, 'in_progress', null, {}, now);
    }
  }
  return ticket;
}

// ---------------------------------------------------------------------------
// Assign / escalate
// ---------------------------------------------------------------------------

export interface AssignInput {
  assigneeId: string | null;
  teamId?: string;
  note?: string;
}

/**
 * Assign / reassign tiket; pindah tim = functional escalation (event `escalated_functional`).
 * @throws EngineError bila assignee bukan anggota tim tujuan
 */
export function assignTicket(
  store: Store,
  ticketId: string,
  input: AssignInput,
  actor: UserRecord,
  now: Date,
): TicketRecord {
  let ticket = requireTicket(store, ticketId);
  if (ticket.status === 'closed' || ticket.status === 'cancelled') {
    throw new EngineError('final_status', 'Tiket sudah final');
  }
  const targetTeamId = input.teamId ?? ticket.teamId;
  if (input.assigneeId) {
    const team = targetTeamId ? store.teams.get(targetTeamId) : undefined;
    const assignee = store.users.get(input.assigneeId);
    if (!assignee?.isActive) throw new EngineError('invalid_assignee', 'Assignee tidak aktif');
    if (team && !team.memberIds.includes(input.assigneeId) && team.leadId !== input.assigneeId) {
      throw new EngineError('invalid_assignee', 'Assignee bukan anggota tim tujuan');
    }
  }

  if (targetTeamId !== ticket.teamId) {
    appendEvent(
      store,
      ticket.id,
      actor.id,
      'escalated_functional',
      {
        fromTeamId: ticket.teamId,
        toTeamId: targetTeamId,
        note: input.note?.trim() ?? '',
      },
      now,
    );
    ticket = saveTicket(store, { ...ticket, teamId: targetTeamId ?? null }, now);
    notify(
      store,
      teamLeadId(store, targetTeamId ?? null),
      'escalated',
      ticket,
      `${ticket.number} dieskalasi ke tim Anda`,
      now,
      actor.id,
    );
  }

  if (ticket.status === 'new' && input.assigneeId) {
    return transitionTicket(
      store,
      ticket.id,
      'assigned',
      actor,
      { assigneeId: input.assigneeId },
      now,
    );
  }
  if (input.assigneeId !== ticket.assigneeId) {
    appendEvent(
      store,
      ticket.id,
      actor.id,
      'assigned',
      { assigneeId: input.assigneeId, previousAssigneeId: ticket.assigneeId },
      now,
    );
    ticket = saveTicket(store, { ...ticket, assigneeId: input.assigneeId }, now);
    notify(
      store,
      input.assigneeId,
      'assigned',
      ticket,
      `${ticket.number} ditugaskan kepada Anda`,
      now,
      actor.id,
    );
  }
  return ticket;
}

// ---------------------------------------------------------------------------
// Priority
// ---------------------------------------------------------------------------

function applyPriorityChange(
  store: Store,
  ticket: TicketRecord,
  priority: Priority,
  now: Date,
): void {
  const pair = slaPair(store, ticket.id);
  const policyId = pair.resolution.policyId;
  const target = targetFor(store, policyId, priority);
  for (const kind of ['response', 'resolution'] as const) {
    const instance = pair[kind];
    const cal = businessCalendar(store, instance.calendarId);
    const newTarget = kind === 'response' ? target.responseMinutes : target.resolutionMinutes;
    const result = rebaseline(instance, newTarget, now, cal);
    if (result.instance === instance) continue;
    setSla(store, ticket.id, kind, result.instance);
    appendEvent(
      store,
      ticket.id,
      null,
      'sla_rebaselined',
      {
        kind,
        previousDueAt: result.previousDueAt.toISOString(),
        newDueAt: result.newDueAt.toISOString(),
        targetMinutes: newTarget,
      },
      now,
    );
    if (result.breachedImmediately) {
      appendEvent(store, ticket.id, null, 'sla_breached', { kind, reason: 'rebaseline' }, now);
    }
  }
}

/**
 * Override prioritas oleh lead/admin dengan alasan wajib (≥10 karakter) + rebaseline SLA.
 * @throws EngineError bila alasan kurang atau tiket final
 */
export function overridePriority(
  store: Store,
  ticketId: string,
  priority: Priority,
  reason: string,
  actor: UserRecord,
  now: Date,
): TicketRecord {
  const ticket = requireTicket(store, ticketId);
  if (!ACTIVE_STATUSES.includes(ticket.status))
    throw new EngineError('final_status', 'Prioritas hanya bisa diubah pada tiket aktif');
  if (!isValidOverrideReason(reason))
    throw new EngineError('reason_required', 'Alasan override minimal 10 karakter');
  if (priority === ticket.priority)
    throw new EngineError('no_change', 'Prioritas sama dengan sebelumnya');
  appendEvent(
    store,
    ticket.id,
    actor.id,
    'priority_overridden',
    { from: ticket.priority, to: priority, reason: reason.trim() },
    now,
  );
  applyPriorityChange(store, ticket, priority, now);
  return saveTicket(store, { ...ticket, priority, priorityOverridden: true }, now);
}

/**
 * Mengubah impact/urgency (agent/lead). Prioritas dihitung ulang kecuali sudah di-override.
 * @throws EngineError bila tiket tidak aktif
 */
export function updateClassification(
  store: Store,
  ticketId: string,
  impact: Impact,
  urgency: Urgency,
  actor: UserRecord,
  now: Date,
): TicketRecord {
  const ticket = requireTicket(store, ticketId);
  if (!ACTIVE_STATUSES.includes(ticket.status))
    throw new EngineError('final_status', 'Tiket tidak aktif');
  const priority = ticket.priorityOverridden
    ? ticket.priority
    : calculateTicketPriority(ticket.type, impact, urgency);
  appendEvent(
    store,
    ticket.id,
    actor.id,
    'priority_changed',
    {
      from: ticket.priority,
      to: priority,
      impact,
      urgency,
      previousImpact: ticket.impact,
      previousUrgency: ticket.urgency,
    },
    now,
  );
  if (priority !== ticket.priority) applyPriorityChange(store, ticket, priority, now);
  return saveTicket(store, { ...ticket, impact, urgency, priority }, now);
}

// ---------------------------------------------------------------------------
// CSAT
// ---------------------------------------------------------------------------

/**
 * Menyimpan CSAT (1–5) — sekali per tiket, hanya setelah Resolved/Closed.
 * @throws EngineError jika status belum selesai atau CSAT sudah ada
 */
export function submitCsat(
  store: Store,
  ticketId: string,
  score: number,
  comment: string,
  actor: UserRecord,
  now: Date,
): TicketRecord {
  const ticket = requireTicket(store, ticketId);
  if (ticket.status !== 'resolved' && ticket.status !== 'closed') {
    throw new EngineError('not_resolved', 'Survei hanya tersedia setelah tiket selesai');
  }
  if (store.csat.has(ticketId)) throw new EngineError('duplicate', 'Survei sudah diisi');
  if (!Number.isInteger(score) || score < 1 || score > 5)
    throw new EngineError('invalid_score', 'Skor harus 1–5');
  store.csat.set(ticketId, {
    id: nextId(store, 'csat'),
    ticketId,
    score,
    comment: comment.trim(),
    createdAt: now,
  });
  appendEvent(store, ticketId, actor.id, 'csat_submitted', { score }, now);
  return saveTicket(store, ticket, now);
}

// ---------------------------------------------------------------------------
// SLA tick (simulasi worker — ADR-005)
// ---------------------------------------------------------------------------

export interface TickResult {
  warned: number;
  breached: number;
  autoClosed: number;
}

function adminIds(store: Store): string[] {
  return [...store.users.values()].filter((u) => u.role === 'admin' && u.isActive).map((u) => u.id);
}

/**
 * Simulasi job `sla-tick` + `auto-close` (ARCHITECTURE.md §4). Idempoten: `warnedAt`/`breachedAt`
 * mencegah event/notifikasi ganda; eskalasi hierarkis sesuai ITSM.md §6.
 * @param store - store
 * @param now - waktu tick
 */
export function runSlaTick(store: Store, now: Date): TickResult {
  const result: TickResult = { warned: 0, breached: 0, autoClosed: 0 };
  for (const [ticketId, pair] of store.sla) {
    for (const kind of ['response', 'resolution'] as const) {
      const instance = pair[kind];
      if (instance.status !== 'running') continue;
      if (instance.warnAt > now && instance.dueAt > now) continue; // murah: index (status, warn_at)
      const ticket = store.tickets.get(ticketId);
      if (!ticket) continue;
      const cal = businessCalendar(store, instance.calendarId);
      const state = computeSlaState(instance, now, cal);
      const kindLabel = kind === 'response' ? 'Response' : 'Resolution';
      const p1p2 = ticket.priority === 'P1' || ticket.priority === 'P2';

      if (state.percentUsed >= 75 && !instance.warnedAt) {
        setSla(store, ticketId, kind, { ...instance, warnedAt: now });
        appendEvent(
          store,
          ticketId,
          null,
          'sla_warning',
          { kind, percentUsed: Math.round(state.percentUsed) },
          now,
        );
        notify(
          store,
          ticket.assigneeId,
          'sla_warning',
          ticket,
          `${kindLabel} SLA ${ticket.number} at risk (75%)`,
          now,
        );
        if (kind === 'resolution' && p1p2) {
          notify(
            store,
            teamLeadId(store, ticket.teamId),
            'sla_warning',
            ticket,
            `${ticket.priority} ${ticket.number} mendekati breach`,
            now,
          );
        }
        result.warned += 1;
      }
      const latest = slaPair(store, ticketId)[kind];
      if (state.breached && !latest.breachedAt) {
        setSla(store, ticketId, kind, {
          ...latest,
          breachedAt: latest.dueAt < now ? latest.dueAt : now,
        });
        appendEvent(store, ticketId, null, 'sla_breached', { kind }, now);
        notify(
          store,
          ticket.assigneeId,
          'sla_breached',
          ticket,
          `${kindLabel} SLA ${ticket.number} breached`,
          now,
        );
        notify(
          store,
          teamLeadId(store, ticket.teamId),
          'sla_breached',
          ticket,
          `${kindLabel} SLA ${ticket.number} breached`,
          now,
        );
        if (kind === 'resolution') {
          const level = ticket.priority === 'P1' ? 2 : 1;
          appendEvent(store, ticketId, null, 'escalated_hierarchical', { level }, now);
          saveTicket(
            store,
            { ...ticket, escalationLevel: Math.max(ticket.escalationLevel, level) },
            now,
          );
          if (level === 2) {
            for (const id of adminIds(store))
              notify(
                store,
                id,
                'escalated',
                ticket,
                `P1 ${ticket.number} breached — eskalasi level 2`,
                now,
              );
          }
        }
        result.breached += 1;
      }
    }
  }

  const businessCal = businessCalendar(store, CAL_BUSINESS);
  for (const ticket of [...store.tickets.values()]) {
    if (ticket.status !== 'resolved' || !ticket.resolvedAt) continue;
    if (
      businessMinutesBetween(ticket.resolvedAt, now, businessCal) >= AUTO_CLOSE_BUSINESS_MINUTES
    ) {
      transitionTicket(store, ticket.id, 'closed', null, {}, now);
      result.autoClosed += 1;
    }
  }
  store.workerLastTick = now;
  return result;
}
