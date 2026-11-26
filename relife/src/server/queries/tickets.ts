import { z } from 'zod';
import { businessMinutesBetween } from '@/domain/calendar';
import { computeSlaState, type SlaState } from '@/domain/sla';
import {
  ACTIVE_STATUSES,
  PRIORITIES,
  TICKET_STATUSES,
  TICKET_TYPES,
  type Priority,
  type TicketEventType,
  type TicketStatus,
} from '@/domain/types';
import { priorityRank } from '@/domain/priority';
import { attachmentUrl } from '@/server/attachments';
import { can } from '@/server/auth/rbac';
import type { SessionUser } from '@/server/auth/session';
import { CAL_BUSINESS } from '@/server/mock/reference-data';
import { businessCalendar, type Store } from '@/server/mock/store';
import type { ApprovalRecord, SlaInstanceRecord, TicketRecord } from '@/server/mock/types';
import {
  APPROVAL_STEP_LABELS,
  APPROVAL_STEPS,
  approvalGate,
  latestByStep,
  requiresItHod,
} from '@/domain/approval';
import { approvalsFor, hasPendingApproval } from '@/server/mock/approvals';
import {
  primarySla,
  toSlaSnapshot,
  type ApprovalDetail,
  type ApprovalRowView,
  type AttachmentView,
  type CalendarMap,
  type TicketDetail,
  type TicketListItem,
  type TimelineEntry,
} from '@/lib/views';

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function userRef(store: Store, id: string | null): { id: string; name: string } | null {
  if (!id) return null;
  const u = store.users.get(id);
  return u ? { id: u.id, name: u.name } : null;
}

function slaOf(
  store: Store,
  ticketId: string,
): { response: SlaInstanceRecord; resolution: SlaInstanceRecord } {
  const pair = store.sla.get(ticketId);
  if (!pair) throw new Error(`SLA untuk tiket ${ticketId} tidak ditemukan`);
  return pair;
}

/**
 * Tiket → item daftar.
 * @param store - store
 * @param t - record tiket
 */
export function toListItem(store: Store, t: TicketRecord): TicketListItem {
  const pair = slaOf(store, t.id);
  const team = t.teamId ? store.teams.get(t.teamId) : undefined;
  return {
    id: t.id,
    number: t.number,
    title: t.title,
    type: t.type,
    status: t.status,
    priority: t.priority,
    pendingReason: t.pendingReason,
    requester: userRef(store, t.requesterId) ?? { id: t.requesterId, name: 'Tidak dikenal' },
    assignee: userRef(store, t.assigneeId),
    team: team ? { id: team.id, name: team.name } : null,
    category: store.categories.get(t.categoryId)?.name ?? '—',
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    response: toSlaSnapshot(pair.response),
    resolution: toSlaSnapshot(pair.resolution),
  };
}

/** Kalender untuk client (countdown SLA). */
export function calendarsForClient(store: Store): CalendarMap {
  const map: CalendarMap = {};
  for (const id of store.calendars.keys()) map[id] = businessCalendar(store, id);
  return map;
}

function stateOf(store: Store, instance: SlaInstanceRecord, now: Date): SlaState {
  return computeSlaState(instance, now, businessCalendar(store, instance.calendarId));
}

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

export const QUEUE_VIEWS = ['my', 'team', 'unassigned', 'at_risk', 'breached', 'approval', 'all'] as const;
export type QueueView = (typeof QUEUE_VIEWS)[number];

export const QUEUE_VIEW_LABELS: Record<QueueView, string> = {
  my: 'My tickets',
  team: 'Antrean Tim IT',
  unassigned: 'Unassigned',
  at_risk: 'At risk',
  breached: 'Breached',
  approval: 'Menunggu persetujuan',
  all: 'Semua tiket',
};

export const AGE_BUCKETS = ['lt1', '1to3', '3to7', 'gt7'] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number];
export const AGE_BUCKET_LABELS: Record<AgeBucket, string> = {
  lt1: '< 1 hari kerja',
  '1to3': '1–3 hari kerja',
  '3to7': '3–7 hari kerja',
  gt7: '> 7 hari kerja',
};

const SORTS = ['sla', 'priority', 'created', 'updated'] as const;
export type QueueSort = (typeof SORTS)[number];

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const csv = <T extends string>(values: readonly [T, ...T[]]) =>
  z
    .string()
    .transform((s) => s.split(',').filter(Boolean))
    .pipe(z.array(z.enum(values)));

/** Skema filter queue dari URL (DESIGN.md §4.5: filter tersimpan di URL). */
const queueFilterSchema = z.object({
  view: z.enum(QUEUE_VIEWS).catch('team'),
  priority: csv(PRIORITIES).optional().catch(undefined),
  status: z
    .union([z.literal('active'), csv(TICKET_STATUSES)])
    .optional()
    .catch(undefined),
  type: z.enum(TICKET_TYPES).optional().catch(undefined),
  team: z.string().max(64).optional().catch(undefined),
  category: z.string().max(64).optional().catch(undefined),
  assignee: z.string().max(64).optional().catch(undefined),
  q: z.string().max(120).optional().catch(undefined),
  from: dateKey.optional().catch(undefined),
  to: dateKey.optional().catch(undefined),
  sla: z.enum(['met', 'breached']).optional().catch(undefined),
  slaKind: z.enum(['response', 'resolution']).optional().catch(undefined),
  age: z.enum(AGE_BUCKETS).optional().catch(undefined),
  sort: z.enum(SORTS).catch('sla'),
  dir: z.enum(['asc', 'desc']).catch('asc'),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});

export type QueueFilters = z.infer<typeof queueFilterSchema>;

/**
 * Parse `searchParams` menjadi filter tervalidasi; nilai tak valid diabaikan (fallback aman).
 * @param params - searchParams Next.js
 */
export function parseQueueFilters(
  params: Record<string, string | string[] | undefined>,
): QueueFilters {
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    const v = Array.isArray(value) ? value[0] : value;
    if (v !== undefined && v !== '') flat[key] = v;
  }
  return queueFilterSchema.parse(flat);
}

const PAGE_SIZE = 50;
const JAKARTA_OFFSET = '+07:00';

function inScope(user: SessionUser, t: TicketRecord): boolean {
  if (user.role === 'admin') return true;
  return t.teamId !== null && user.teamIds.includes(t.teamId);
}

function ageBucketOf(minutes: number): AgeBucket {
  const days = minutes / 480;
  if (days < 1) return 'lt1';
  if (days < 3) return '1to3';
  if (days < 7) return '3to7';
  return 'gt7';
}

interface Evaluated {
  ticket: TicketRecord;
  response: SlaState;
  resolution: SlaState;
  awaitingApproval: boolean;
}

function matchesView(view: QueueView, user: SessionUser, e: Evaluated): boolean {
  const t = e.ticket;
  const active = ACTIVE_STATUSES.includes(t.status);
  switch (view) {
    case 'my':
      return active && t.assigneeId === user.id;
    case 'team':
      return active && inScope(user, t);
    case 'unassigned':
      return active && inScope(user, t) && t.assigneeId === null;
    case 'at_risk':
      return active && inScope(user, t) && (e.response.atRisk || e.resolution.atRisk);
    case 'breached':
      return active && inScope(user, t) && (e.response.breached || e.resolution.breached);
    case 'approval':
      return active && inScope(user, t) && e.awaitingApproval;
    case 'all':
      return true;
  }
}

function matchesFilters(store: Store, f: QueueFilters, e: Evaluated, now: Date): boolean {
  const t = e.ticket;
  if (f.priority?.length && !f.priority.includes(t.priority)) return false;
  if (f.status === 'active' && !ACTIVE_STATUSES.includes(t.status)) return false;
  if (Array.isArray(f.status) && f.status.length && !f.status.includes(t.status)) return false;
  if (f.type && t.type !== f.type) return false;
  if (f.team && t.teamId !== f.team) return false;
  if (f.category) {
    const cat = store.categories.get(t.categoryId);
    if (t.categoryId !== f.category && cat?.parentId !== f.category) return false;
  }
  if (f.assignee && (f.assignee === 'none' ? t.assigneeId !== null : t.assigneeId !== f.assignee))
    return false;
  if (f.from && t.createdAt < new Date(`${f.from}T00:00:00${JAKARTA_OFFSET}`)) return false;
  if (f.to && t.createdAt > new Date(`${f.to}T23:59:59${JAKARTA_OFFSET}`)) return false;
  if (f.sla) {
    const kinds = f.slaKind ? [f.slaKind] : (['response', 'resolution'] as const);
    const pair = slaOf(store, t.id);
    const hit = kinds.some((k) =>
      f.sla === 'breached'
        ? e[k].breached && pair[k].status !== 'cancelled'
        : pair[k].status === 'met',
    );
    if (!hit) return false;
  }
  if (f.age) {
    if (!ACTIVE_STATUSES.includes(t.status)) return false;
    const minutes = businessMinutesBetween(t.createdAt, now, businessCalendar(store, CAL_BUSINESS));
    if (ageBucketOf(minutes) !== f.age) return false;
  }
  if (f.q) {
    const q = f.q.toLowerCase();
    const requester = store.users.get(t.requesterId)?.name.toLowerCase() ?? '';
    if (
      !t.number.toLowerCase().includes(q) &&
      !t.title.toLowerCase().includes(q) &&
      !requester.includes(q)
    )
      return false;
  }
  return true;
}

function slaSortKey(e: Evaluated): number {
  const primary =
    e.response.status === 'running' || e.response.status === 'paused' ? e.response : e.resolution;
  if (primary.status === 'running' || primary.status === 'breached') {
    if (ACTIVE_STATUSES.includes(e.ticket.status)) return primary.remainingMinutes;
  }
  if (primary.status === 'paused') return 1e9 + primary.remainingMinutes;
  return 2e9;
}

function compare(sort: QueueSort, a: Evaluated, b: Evaluated): number {
  switch (sort) {
    case 'sla':
      return (
        slaSortKey(a) - slaSortKey(b) ||
        priorityRank(a.ticket.priority) - priorityRank(b.ticket.priority)
      );
    case 'priority':
      return (
        priorityRank(a.ticket.priority) - priorityRank(b.ticket.priority) ||
        slaSortKey(a) - slaSortKey(b)
      );
    case 'created':
      return a.ticket.createdAt.getTime() - b.ticket.createdAt.getTime();
    case 'updated':
      return a.ticket.updatedAt.getTime() - b.ticket.updatedAt.getTime();
  }
}

export interface QueueResult {
  items: TicketListItem[];
  total: number;
  page: number;
  pageCount: number;
  counts: Record<Exclude<QueueView, 'all'>, number>;
}

function evaluate(store: Store, t: TicketRecord, now: Date): Evaluated {
  const pair = slaOf(store, t.id);
  return {
    ticket: t,
    response: stateOf(store, pair.response, now),
    resolution: stateOf(store, pair.resolution, now),
    awaitingApproval: hasPendingApproval(store, t.id),
  };
}

/**
 * Hitungan tiap view untuk badge sidebar.
 * @param store - store
 * @param user - user staff
 * @param now - waktu sekarang
 */
export function queueCounts(store: Store, user: SessionUser, now: Date): QueueResult['counts'] {
  const counts = { my: 0, team: 0, unassigned: 0, at_risk: 0, breached: 0, approval: 0 };
  for (const t of store.tickets.values()) {
    if (!ACTIVE_STATUSES.includes(t.status)) continue;
    const e = evaluate(store, t, now);
    for (const view of ['my', 'team', 'unassigned', 'at_risk', 'breached', 'approval'] as const) {
      if (matchesView(view, user, e)) counts[view] += 1;
    }
  }
  return counts;
}

/**
 * Daftar queue terfilter, terurut, berhalaman.
 * @param store - store
 * @param user - user staff (sudah dicek `queue.view`)
 * @param filters - filter dari URL
 * @param now - waktu sekarang
 */
export function listQueue(
  store: Store,
  user: SessionUser,
  filters: QueueFilters,
  now: Date,
): QueueResult {
  const candidates: Evaluated[] = [];
  for (const t of store.tickets.values()) {
    if (filters.view !== 'all' && !ACTIVE_STATUSES.includes(t.status)) continue;
    const e = evaluate(store, t, now);
    if (matchesView(filters.view, user, e) && matchesFilters(store, filters, e, now))
      candidates.push(e);
  }
  const direction = filters.dir === 'desc' ? -1 : 1;
  candidates.sort((a, b) => compare(filters.sort, a, b) * direction);
  const pageCount = Math.max(1, Math.ceil(candidates.length / PAGE_SIZE));
  const page = Math.min(filters.page, pageCount);
  return {
    items: candidates
      .slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
      .map((e) => toListItem(store, e.ticket)),
    total: candidates.length,
    page,
    pageCount,
    counts: queueCounts(store, user, now),
  };
}

// ---------------------------------------------------------------------------
// Portal requester
// ---------------------------------------------------------------------------

/**
 * Tiket milik requester, terbaru dulu.
 * @param limit - batas jumlah (opsional)
 */
export function listRequesterTickets(
  store: Store,
  user: SessionUser,
  limit?: number,
): TicketListItem[] {
  const own = [...store.tickets.values()]
    .filter((t) => t.requesterId === user.id)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return (limit ? own.slice(0, limit) : own).map((t) => toListItem(store, t));
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

/** Event yang boleh dilihat requester di timeline publik. */
const PUBLIC_EVENTS: ReadonlySet<TicketEventType> = new Set<TicketEventType>([
  'created',
  'status_changed',
  'reopened',
  'csat_submitted',
  'approval_requested',
  'approval_approved',
  'approval_rejected',
]);

/** Event yang sudah direpresentasikan oleh entri komentar. */
const HIDDEN_EVENTS: ReadonlySet<TicketEventType> = new Set<TicketEventType>([
  'commented',
  'internal_note',
]);

export type DetailResult =
  { kind: 'ok'; detail: TicketDetail } | { kind: 'not_found' } | { kind: 'forbidden' };

function attachmentView(a: {
  id: string;
  fileName: string;
  size: number;
  mime: string;
  storageKey: string;
}): AttachmentView {
  return { id: a.id, fileName: a.fileName, size: a.size, mime: a.mime, url: attachmentUrl(a) };
}

function buildTimeline(store: Store, t: TicketRecord, includeInternal: boolean): TimelineEntry[] {
  const actor = (id: string | null): TimelineEntry['actor'] => {
    const u = id ? store.users.get(id) : undefined;
    return u ? { id: u.id, name: u.name, role: u.role } : null;
  };
  const attachments = store.attachments.get(t.id) ?? [];
  const entries: TimelineEntry[] = [];
  for (const c of store.comments.get(t.id) ?? []) {
    if (c.visibility === 'internal' && !includeInternal) continue;
    entries.push({
      id: c.id,
      kind: c.visibility === 'internal' ? 'internal' : 'comment',
      at: c.createdAt.toISOString(),
      actor: actor(c.authorId),
      body: c.body,
      attachments: attachments.filter((a) => a.commentId === c.id).map(attachmentView),
    });
  }
  for (const e of store.events.get(t.id) ?? []) {
    if (HIDDEN_EVENTS.has(e.type)) continue;
    if (!includeInternal && !PUBLIC_EVENTS.has(e.type)) continue;
    entries.push({
      id: e.id,
      kind: 'event',
      at: e.createdAt.toISOString(),
      actor: actor(e.actorId),
      eventType: e.type,
      data:
        e.type === 'assigned' && typeof e.data.assigneeId === 'string'
          ? { ...e.data, assigneeName: store.users.get(e.data.assigneeId)?.name }
          : e.data,
    });
  }
  // Same instant: the message first, then the events it triggered (auto-resume, attachment, first response).
  const rank = (e: TimelineEntry) => (e.kind === 'event' ? 1 : 0);
  return entries.sort((a, b) => a.at.localeCompare(b.at) || rank(a) - rank(b));
}

/**
 * Detail tiket dengan otorisasi server-side (requester hanya tiket miliknya; internal disaring).
 * @param number - nomor tiket, mis. INC-000123
 */
const EXTRA_FORM_FIELDS = [
  { key: 'service_other', label: 'Layanan Lainnya' },
  { key: 'request_type_other', label: 'Jenis Permintaan Lainnya' },
  { key: 'hod_name', label: 'Acknowledge by HOD' },
  { key: 'hod_email', label: 'Email HOD' },
  { key: 'requester_ack', label: 'Konfirmasi Pemohon' },
] as const;

export function getTicketDetail(store: Store, user: SessionUser, number: string): DetailResult {
  const id = store.ticketIdByNumber.get(number.toUpperCase());
  const t = id ? store.tickets.get(id) : undefined;
  if (!t) return { kind: 'not_found' };
  const resource = { requesterId: t.requesterId, teamId: t.teamId };
  if (!can(user, 'ticket.read', resource)) return { kind: 'forbidden' };
  const includeInternal = can(user, 'ticket.read_internal', resource);

  const item = toListItem(store, t);
  const catalog = t.catalogItemId ? store.catalog.get(t.catalogItemId) : undefined;
  const requester = store.users.get(t.requesterId);
  const csat = store.csat.get(t.id);
  const pair = slaOf(store, t.id);
  const schemaKeys = new Set((catalog?.formSchema ?? []).map((f) => f.key));
  const formFields = [
    ...(catalog?.formSchema ?? [])
      .filter((f) => t.formData[f.key])
      .map((f) => ({ label: f.label, value: t.formData[f.key] ?? '' })),
    ...EXTRA_FORM_FIELDS.filter((f) => !schemaKeys.has(f.key) && t.formData[f.key]).map((f) => ({
      label: f.label,
      value: t.formData[f.key] ?? '',
    })),
  ];
  const related = includeInternal
    ? [...store.tickets.values()]
        .filter(
          (o) =>
            o.id !== t.id && o.categoryId === t.categoryId && ACTIVE_STATUSES.includes(o.status),
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, 5)
        .map((o) => ({ number: o.number, title: o.title, status: o.status }))
    : [];

  return {
    kind: 'ok',
    detail: {
      ...item,
      description: t.description,
      impact: t.impact,
      urgency: t.urgency,
      priorityOverridden: t.priorityOverridden,
      resolutionCode: t.resolutionCode,
      resolutionNotes: t.resolutionNotes,
      firstResponseAt: t.firstResponseAt?.toISOString() ?? null,
      resolvedAt: t.resolvedAt?.toISOString() ?? null,
      closedAt: t.closedAt?.toISOString() ?? null,
      reopenCount: t.reopenCount,
      escalationLevel: t.escalationLevel,
      catalogItem: catalog ? { id: catalog.id, name: catalog.name } : null,
      formFields,
      requesterInfo: {
        id: t.requesterId,
        name: requester?.name ?? '—',
        email: requester?.email ?? '—',
        department: requester?.department ?? '—',
        openTickets: [...store.tickets.values()].filter(
          (o) => o.requesterId === t.requesterId && ACTIVE_STATUSES.includes(o.status),
        ).length,
      },
      csat: csat
        ? { score: csat.score, comment: csat.comment, createdAt: csat.createdAt.toISOString() }
        : null,
      timeline: buildTimeline(store, t, includeInternal),
      attachments: (store.attachments.get(t.id) ?? [])
        .filter(
          (a) =>
            includeInternal ||
            !a.commentId ||
            store.comments.get(t.id)?.find((c) => c.id === a.commentId)?.visibility !== 'internal',
        )
        .map(attachmentView),
      policyName: store.policies.get(pair.resolution.policyId)?.name ?? '—',
      related,
      approval: approvalDetail(store, t, new Date()),
    },
  };
}

/** Rantai persetujuan (baris terakhir per step) + IT part untuk kartu "Persetujuan". */
function approvalDetail(store: Store, t: TicketRecord, now: Date): ApprovalDetail {
  const rows = approvalsFor(store, t.id);
  const latest = latestByStep(rows);
  const view = (a: ApprovalRecord): ApprovalRowView => ({
    id: a.id,
    step: a.step,
    status: a.status,
    approverName: a.approverName,
    approverEmail: a.approverEmail,
    decidedBy: a.decidedByUserId ? (store.users.get(a.decidedByUserId)?.name ?? null) : null,
    note: a.note,
    createdAt: a.createdAt.toISOString(),
    decidedAt: a.decidedAt?.toISOString() ?? null,
    linkActive: a.tokenHash !== null && a.expiresAt !== null && a.expiresAt > now,
  });
  const firstAssign = (store.events.get(t.id) ?? []).find(
    (e) => e.type === 'assigned' && typeof e.data.assigneeId === 'string',
  );
  const gate = t.status === 'assigned' ? approvalGate(t, rows, 'in_progress') : null;
  return {
    steps: APPROVAL_STEPS.map((step) => {
      const row = latest[step];
      return { step, label: APPROVAL_STEP_LABELS[step], row: row ? view(row) : null };
    }),
    hodName: t.formData.hod_name ?? null,
    requiresItHod: rows.length > 0 && requiresItHod(t),
    awaiting: rows.some((a) => a.status === 'pending'),
    startBlocked: gate?.message ?? null,
    actionPlan: t.actionPlan,
    impactAnalysis: t.impactAnalysis,
    receivedBy: firstAssign ? (store.users.get(firstAssign.data.assigneeId as string)?.name ?? null) : null,
    receivedAt: firstAssign?.createdAt.toISOString() ?? null,
  };
}

// ---------------------------------------------------------------------------
// Search (⌘K)
// ---------------------------------------------------------------------------

export interface SearchHit {
  number: string;
  title: string;
  status: TicketStatus;
  priority: Priority;
  requester: string;
}

/**
 * Pencarian global: nomor, judul, nama requester. Requester hanya melihat tiket miliknya.
 * @param q - kata kunci (≥ 2 karakter)
 * @param limit - jumlah maksimal hasil
 */
export function searchTickets(store: Store, user: SessionUser, q: string, limit = 8): SearchHit[] {
  const term = q.trim().toLowerCase();
  if (term.length < 2) return [];
  const hits: Array<{ t: TicketRecord; score: number }> = [];
  for (const t of store.tickets.values()) {
    if (!can(user, 'ticket.read', { requesterId: t.requesterId, teamId: t.teamId })) continue;
    const requester = store.users.get(t.requesterId)?.name ?? '';
    let score = 0;
    if (t.number.toLowerCase() === term) score = 100;
    else if (t.number.toLowerCase().includes(term)) score = 50;
    else if (t.title.toLowerCase().includes(term)) score = 20;
    else if (requester.toLowerCase().includes(term)) score = 10;
    if (score > 0) {
      if (ACTIVE_STATUSES.includes(t.status)) score += 5;
      hits.push({ t, score });
    }
  }
  return hits
    .sort((a, b) => b.score - a.score || b.t.createdAt.getTime() - a.t.createdAt.getTime())
    .slice(0, limit)
    .map(({ t }) => ({
      number: t.number,
      title: t.title,
      status: t.status,
      priority: t.priority,
      requester: store.users.get(t.requesterId)?.name ?? '—',
    }));
}

// ---------------------------------------------------------------------------
// Pilihan assignee / tim
// ---------------------------------------------------------------------------

export interface AssigneeOption {
  id: string;
  name: string;
  teamId: string;
  teamName: string;
  activeLoad: number;
}

/** Head IT + anggota tim (untuk assignee picker & bulk assign). */
export function assigneeOptions(store: Store): AssigneeOption[] {
  const load = new Map<string, number>();
  for (const t of store.tickets.values()) {
    if (t.assigneeId && ACTIVE_STATUSES.includes(t.status))
      load.set(t.assigneeId, (load.get(t.assigneeId) ?? 0) + 1);
  }
  const options: AssigneeOption[] = [];
  for (const team of store.teams.values()) {
    for (const id of new Set([team.leadId, ...team.memberIds])) {
      const u = id ? store.users.get(id) : undefined;
      if (!u?.isActive) continue;
      options.push({
        id: u.id,
        name: u.name,
        teamId: team.id,
        teamName: team.name,
        activeLoad: load.get(u.id) ?? 0,
      });
    }
  }
  return options;
}

export { primarySla };
