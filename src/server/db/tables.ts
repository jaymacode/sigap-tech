import type { WeeklyHours } from '@/domain/calendar';
import type { SlaInstance } from '@/domain/sla';
import { createEmptyStore, type Store } from '@/server/mock/store';
import type {
  AttachmentRecord,
  CalendarRecord,
  CatalogItemRecord,
  CategoryRecord,
  ChangeRecord,
  CommentRecord,
  CsatRecord,
  HolidayRecord,
  NotificationRecord,
  SlaInstanceRecord,
  SlaPolicyRecord,
  TeamRecord,
  TicketEventRecord,
  TicketRecord,
  UserRecord,
} from '@/server/mock/types';

/**
 * Pemetaan Store <-> baris PostgreSQL. Kolom persis seperti db/migrations/0001_init.sql.
 *
 * Aturan:
 * - `ord` = posisi dalam Map/array sumber, sehingga hydrate mengembalikan urutan iterasi yang sama.
 * - Field nullable selalu dipetakan ke `null` (bukan `undefined`).
 * - Kolom jsonb berisi nilai JS mentah; penulisan men-stringify-nya (lihat persistence.ts).
 * - Urutan key Map per-tiket (sla, events, comments, attachments) disimpan di `app_state.listKeys`,
 *   karena tabel anak tidak menyimpan urutan key Map, dan daftar kosong dari `listFor` juga perlu
 *   dipulihkan agar store hasil hydrate sama persis dengan store sumber.
 */

export type Row = Record<string, unknown>;

export interface TableDef {
  name: string;
  columns: readonly string[];
  pk: readonly string[];
  jsonb: readonly string[];
  /** Hanya INSERT (ticket_events: trigger DB menolak UPDATE/DELETE/TRUNCATE). */
  appendOnly?: boolean;
  /** Mengubah Store menjadi baris tabel ini. */
  encode: (store: Store) => Row[];
}

/** Nama tabel yang dikelola, urutan insert: induk dulu. */
export const TABLE_NAMES = [
  'users',
  'teams',
  'categories',
  'calendars',
  'holidays',
  'sla_policies',
  'catalog_items',
  'tickets',
  'team_members',
  'sla_instances',
  'ticket_events',
  'comments',
  'attachments',
  'csat',
  'notifications',
  'changes',
  'app_state',
] as const;
export type TableName = (typeof TABLE_NAMES)[number];

/** Urutan key Map untuk koleksi per-tiket, disimpan di app_state.listKeys. */
export interface ListKeys {
  sla: string[];
  events: string[];
  comments: string[];
  attachments: string[];
}

/** Baris hasil SELECT per tabel (sudah diurutkan sesuai `ord` oleh persistence.readRows). */
export type RowsByTable = Record<TableName, Row[]>;

/** Memetakan iterable ke array dengan indeks sebagai `ord`. */
function indexed<T, R>(items: Iterable<T>, fn: (item: T, ord: number) => R): R[] {
  const out: R[] = [];
  let ord = 0;
  for (const item of items) out.push(fn(item, ord++));
  return out;
}

function encodeSlaInstance(inst: SlaInstanceRecord): Row {
  return {
    id: inst.id,
    ticket_id: inst.ticketId,
    kind: inst.kind,
    policy_id: inst.policyId,
    calendar_id: inst.calendarId,
    target_minutes: inst.targetMinutes,
    status: inst.status,
    started_at: inst.startedAt,
    running_since: inst.runningSince ?? null,
    paused_at: inst.pausedAt ?? null,
    stopped_at: inst.stoppedAt ?? null,
    elapsed_minutes: inst.elapsedMinutes,
    paused_minutes: inst.pausedMinutes,
    warn_at: inst.warnAt,
    due_at: inst.dueAt,
    warned_at: inst.warnedAt ?? null,
    breached_at: inst.breachedAt ?? null,
  };
}

/** Definisi seluruh tabel. Kolom mengikuti 0001_init.sql (jangan diubah tanpa migrasi baru). */
export const TABLES: readonly TableDef[] = [
  {
    name: 'users',
    columns: [
      'id',
      'ord',
      'email',
      'name',
      'role',
      'department',
      'is_active',
      'password_hash',
      'last_login_at',
      'created_at',
    ],
    pk: ['id'],
    jsonb: [],
    encode: (s) =>
      indexed(s.users.values(), (u, ord): Row => ({
        id: u.id,
        ord,
        email: u.email,
        name: u.name,
        role: u.role,
        department: u.department,
        is_active: u.isActive,
        password_hash: u.passwordHash,
        last_login_at: u.lastLoginAt ?? null,
        created_at: u.createdAt,
      })),
  },
  {
    name: 'teams',
    columns: ['id', 'ord', 'name', 'description', 'lead_id', 'auto_assign', 'created_at'],
    pk: ['id'],
    jsonb: [],
    encode: (s) =>
      indexed(s.teams.values(), (t, ord): Row => ({
        id: t.id,
        ord,
        name: t.name,
        description: t.description,
        lead_id: t.leadId ?? null,
        auto_assign: t.autoAssign,
        created_at: t.createdAt,
      })),
  },
  {
    name: 'categories',
    columns: ['id', 'ord', 'name', 'parent_id', 'default_team_id', 'is_active'],
    pk: ['id'],
    jsonb: [],
    encode: (s) =>
      indexed(s.categories.values(), (c, ord): Row => ({
        id: c.id,
        ord,
        name: c.name,
        parent_id: c.parentId ?? null,
        default_team_id: c.defaultTeamId ?? null,
        is_active: c.isActive,
      })),
  },
  {
    name: 'calendars',
    columns: ['id', 'ord', 'name', 'kind', 'timezone', 'work_hours'],
    pk: ['id'],
    jsonb: ['work_hours'],
    encode: (s) =>
      indexed(s.calendars.values(), (c, ord): Row => ({
        id: c.id,
        ord,
        name: c.name,
        kind: c.kind,
        timezone: c.timezone,
        work_hours: c.workHours,
      })),
  },
  {
    name: 'holidays',
    columns: ['id', 'ord', 'calendar_id', 'date', 'name'],
    pk: ['id'],
    jsonb: [],
    encode: (s) =>
      indexed(s.holidays, (h, ord): Row => ({
        id: h.id,
        ord,
        calendar_id: h.calendarId,
        date: h.date,
        name: h.name,
      })),
  },
  {
    name: 'sla_policies',
    columns: ['id', 'ord', 'name', 'ticket_type', 'is_default', 'version', 'targets', 'updated_at'],
    pk: ['id'],
    jsonb: ['targets'],
    encode: (s) =>
      indexed(s.policies.values(), (p, ord): Row => ({
        id: p.id,
        ord,
        name: p.name,
        ticket_type: p.ticketType,
        is_default: p.isDefault,
        version: p.version,
        targets: p.targets,
        updated_at: p.updatedAt,
      })),
  },
  {
    name: 'catalog_items',
    columns: [
      'id',
      'ord',
      'name',
      'description',
      'icon',
      'ticket_type',
      'category_id',
      'default_impact',
      'form_schema',
      'sla_policy_id',
      'is_active',
      'keywords',
    ],
    pk: ['id'],
    jsonb: ['form_schema', 'keywords'],
    encode: (s) =>
      indexed(s.catalog.values(), (i, ord): Row => ({
        id: i.id,
        ord,
        name: i.name,
        description: i.description,
        icon: i.icon,
        ticket_type: i.ticketType,
        category_id: i.categoryId,
        default_impact: i.defaultImpact,
        form_schema: i.formSchema,
        sla_policy_id: i.slaPolicyId ?? null,
        is_active: i.isActive,
        keywords: i.keywords,
      })),
  },
  {
    name: 'tickets',
    columns: [
      'id',
      'ord',
      'number',
      'type',
      'title',
      'description',
      'catalog_item_id',
      'category_id',
      'form_data',
      'requester_id',
      'team_id',
      'assignee_id',
      'impact',
      'urgency',
      'priority',
      'priority_overridden',
      'status',
      'pending_reason',
      'resolution_code',
      'resolution_notes',
      'first_response_at',
      'resolved_at',
      'closed_at',
      'reopen_count',
      'escalation_level',
      'problem_id',
      'is_major',
      'created_at',
      'updated_at',
    ],
    pk: ['id'],
    jsonb: ['form_data'],
    encode: (s) =>
      indexed(s.tickets.values(), (t, ord): Row => ({
        id: t.id,
        ord,
        number: t.number,
        type: t.type,
        title: t.title,
        description: t.description,
        catalog_item_id: t.catalogItemId ?? null,
        category_id: t.categoryId,
        form_data: t.formData,
        requester_id: t.requesterId,
        team_id: t.teamId ?? null,
        assignee_id: t.assigneeId ?? null,
        impact: t.impact,
        urgency: t.urgency,
        priority: t.priority,
        priority_overridden: t.priorityOverridden,
        status: t.status,
        pending_reason: t.pendingReason ?? null,
        resolution_code: t.resolutionCode ?? null,
        resolution_notes: t.resolutionNotes ?? null,
        first_response_at: t.firstResponseAt ?? null,
        resolved_at: t.resolvedAt ?? null,
        closed_at: t.closedAt ?? null,
        reopen_count: t.reopenCount,
        escalation_level: t.escalationLevel,
        problem_id: t.problemId ?? null,
        is_major: t.isMajor,
        created_at: t.createdAt,
        updated_at: t.updatedAt,
      })),
  },
  {
    name: 'team_members',
    columns: ['team_id', 'user_id', 'ord'],
    pk: ['team_id', 'user_id'],
    jsonb: [],
    encode: (s) => {
      const rows: Row[] = [];
      for (const team of s.teams.values()) {
        team.memberIds.forEach((userId, ord) =>
          rows.push({ team_id: team.id, user_id: userId, ord }),
        );
      }
      return rows;
    },
  },
  {
    // Satu baris per kind (response/resolution). Tidak punya kolom ord: urutan Map ada di listKeys.sla.
    name: 'sla_instances',
    columns: [
      'id',
      'ticket_id',
      'kind',
      'policy_id',
      'calendar_id',
      'target_minutes',
      'status',
      'started_at',
      'running_since',
      'paused_at',
      'stopped_at',
      'elapsed_minutes',
      'paused_minutes',
      'warn_at',
      'due_at',
      'warned_at',
      'breached_at',
    ],
    pk: ['id'],
    jsonb: [],
    encode: (s) => {
      const rows: Row[] = [];
      for (const pair of s.sla.values()) {
        rows.push(encodeSlaInstance(pair.response), encodeSlaInstance(pair.resolution));
      }
      return rows;
    },
  },
  {
    name: 'ticket_events',
    columns: ['id', 'ticket_id', 'ord', 'actor_id', 'type', 'data', 'created_at'],
    pk: ['id'],
    jsonb: ['data'],
    appendOnly: true,
    encode: (s) => {
      const rows: Row[] = [];
      for (const list of s.events.values()) {
        list.forEach((e, ord) =>
          rows.push({
            id: e.id,
            ticket_id: e.ticketId,
            ord,
            actor_id: e.actorId ?? null,
            type: e.type,
            data: e.data,
            created_at: e.createdAt,
          }),
        );
      }
      return rows;
    },
  },
  {
    name: 'comments',
    columns: ['id', 'ticket_id', 'ord', 'author_id', 'body', 'visibility', 'created_at'],
    pk: ['id'],
    jsonb: [],
    encode: (s) => {
      const rows: Row[] = [];
      for (const list of s.comments.values()) {
        list.forEach((c, ord) =>
          rows.push({
            id: c.id,
            ticket_id: c.ticketId,
            ord,
            author_id: c.authorId,
            body: c.body,
            visibility: c.visibility,
            created_at: c.createdAt,
          }),
        );
      }
      return rows;
    },
  },
  {
    name: 'attachments',
    columns: [
      'id',
      'ticket_id',
      'ord',
      'comment_id',
      'uploader_id',
      'file_name',
      'mime',
      'size',
      'storage_key',
      'created_at',
    ],
    pk: ['id'],
    jsonb: [],
    encode: (s) => {
      const rows: Row[] = [];
      for (const list of s.attachments.values()) {
        list.forEach((a, ord) =>
          rows.push({
            id: a.id,
            ticket_id: a.ticketId,
            ord,
            comment_id: a.commentId ?? null,
            uploader_id: a.uploaderId,
            file_name: a.fileName,
            mime: a.mime,
            size: a.size,
            storage_key: a.storageKey,
            created_at: a.createdAt,
          }),
        );
      }
      return rows;
    },
  },
  {
    name: 'csat',
    columns: ['id', 'ticket_id', 'ord', 'score', 'comment', 'created_at'],
    pk: ['id'],
    jsonb: [],
    encode: (s) =>
      indexed(s.csat.values(), (c, ord): Row => ({
        id: c.id,
        ticket_id: c.ticketId,
        ord,
        score: c.score,
        comment: c.comment,
        created_at: c.createdAt,
      })),
  },
  {
    name: 'notifications',
    columns: ['id', 'ord', 'user_id', 'type', 'ticket_id', 'title', 'read_at', 'created_at'],
    pk: ['id'],
    jsonb: [],
    encode: (s) =>
      indexed(s.notifications, (n, ord): Row => ({
        id: n.id,
        ord,
        user_id: n.userId,
        type: n.type,
        ticket_id: n.ticketId ?? null,
        title: n.title,
        read_at: n.readAt ?? null,
        created_at: n.createdAt,
      })),
  },
  {
    name: 'changes',
    columns: [
      'id',
      'ord',
      'number',
      'type',
      'title',
      'status',
      'source',
      'commit_sha',
      'environment',
      'started_at',
      'finished_at',
      'metadata',
    ],
    pk: ['id'],
    jsonb: ['metadata'],
    encode: (s) =>
      indexed(s.changes, (c, ord): Row => ({
        id: c.id,
        ord,
        number: c.number,
        type: c.type,
        title: c.title,
        status: c.status,
        source: c.source,
        commit_sha: c.commitSha,
        environment: c.environment,
        started_at: c.startedAt,
        finished_at: c.finishedAt ?? null,
        metadata: c.metadata,
      })),
  },
  {
    // Scalar store fields + urutan key Map per-tiket.
    name: 'app_state',
    columns: ['key', 'value'],
    pk: ['key'],
    jsonb: ['value'],
    encode: (s) => {
      const listKeys: ListKeys = {
        sla: [...s.sla.keys()],
        events: [...s.events.keys()],
        comments: [...s.comments.keys()],
        attachments: [...s.attachments.keys()],
      };
      return [
        { key: 'sequences', value: { ...s.sequences } },
        { key: 'idCounter', value: s.idCounter },
        { key: 'seededAt', value: s.seededAt.toISOString() },
        { key: 'workerLastTick', value: s.workerLastTick?.toISOString() ?? null },
        { key: 'failedJobs', value: s.failedJobs },
        { key: 'listKeys', value: listKeys },
      ];
    },
  },
];

export const TABLE_DEFS: Readonly<Record<TableName, TableDef>> = Object.fromEntries(
  TABLES.map((t) => [t.name, t]),
) as Record<TableName, TableDef>;

/** Seluruh baris store untuk semua tabel (dipakai saveAll dan persistDiff). */
export function encodeStore(store: Store): Record<TableName, Row[]> {
  const out = {} as Record<TableName, Row[]>;
  for (const def of TABLES) out[def.name as TableName] = def.encode(store);
  return out;
}

/** Mengelompokkan baris berdasarkan kolom `key`, urutan kemunculan dipertahankan. */
function groupBy(rows: Row[], key: string): Map<string, Row[]> {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const k = row[key] as string;
    const list = groups.get(k);
    if (list) list.push(row);
    else groups.set(k, [row]);
  }
  return groups;
}

function byOrd(a: Row, b: Row): number {
  return (a.ord as number) - (b.ord as number);
}

/**
 * Membangun Store dari baris tabel. Store baru (calendarCache kosong), `ticketIdByNumber`
 * dibangun ulang dari tiket sesuai urutan Map.
 * @param data - baris per tabel
 */
export function buildStore(data: RowsByTable): Store {
  const state = new Map(data.app_state.map((r) => [r.key as string, r.value]));
  const seededAt = new Date(state.get('seededAt') as string);
  const store = createEmptyStore(seededAt);
  const seq = state.get('sequences') as { incident: number; request: number; change: number };
  store.sequences = { incident: seq.incident, request: seq.request, change: seq.change };
  store.idCounter = state.get('idCounter') as number;
  const lastTick = state.get('workerLastTick') as string | null;
  store.workerLastTick = lastTick ? new Date(lastTick) : null;
  store.failedJobs = state.get('failedJobs') as number;
  const listKeys: ListKeys = (state.get('listKeys') as ListKeys | undefined) ?? {
    sla: [],
    events: [],
    comments: [],
    attachments: [],
  };

  for (const r of data.users) {
    const u: UserRecord = {
      id: r.id as string,
      email: r.email as string,
      name: r.name as string,
      role: r.role as UserRecord['role'],
      department: r.department as string,
      isActive: r.is_active as boolean,
      passwordHash: r.password_hash as string,
      lastLoginAt: (r.last_login_at as Date | null) ?? null,
      createdAt: r.created_at as Date,
    };
    store.users.set(u.id, u);
  }

  const members = groupBy(data.team_members, 'team_id');
  for (const r of data.teams) {
    const team: TeamRecord = {
      id: r.id as string,
      name: r.name as string,
      description: r.description as string,
      leadId: (r.lead_id as string | null) ?? null,
      autoAssign: r.auto_assign as boolean,
      memberIds: (members.get(r.id as string) ?? []).sort(byOrd).map((m) => m.user_id as string),
      createdAt: r.created_at as Date,
    };
    store.teams.set(team.id, team);
  }

  for (const r of data.categories) {
    const c: CategoryRecord = {
      id: r.id as string,
      name: r.name as string,
      parentId: (r.parent_id as string | null) ?? null,
      defaultTeamId: (r.default_team_id as string | null) ?? null,
      isActive: r.is_active as boolean,
    };
    store.categories.set(c.id, c);
  }

  for (const r of data.calendars) {
    const c: CalendarRecord = {
      id: r.id as string,
      name: r.name as string,
      kind: r.kind as CalendarRecord['kind'],
      timezone: r.timezone as string,
      workHours: r.work_hours as WeeklyHours,
    };
    store.calendars.set(c.id, c);
  }

  store.holidays = data.holidays.map((r): HolidayRecord => ({
    id: r.id as string,
    calendarId: r.calendar_id as string,
    date: r.date as string,
    name: r.name as string,
  }));

  for (const r of data.sla_policies) {
    const p: SlaPolicyRecord = {
      id: r.id as string,
      name: r.name as string,
      ticketType: r.ticket_type as SlaPolicyRecord['ticketType'],
      isDefault: r.is_default as boolean,
      version: r.version as number,
      targets: r.targets as SlaPolicyRecord['targets'],
      updatedAt: r.updated_at as Date,
    };
    store.policies.set(p.id, p);
  }

  for (const r of data.catalog_items) {
    const i: CatalogItemRecord = {
      id: r.id as string,
      name: r.name as string,
      description: r.description as string,
      icon: r.icon as string,
      ticketType: r.ticket_type as CatalogItemRecord['ticketType'],
      categoryId: r.category_id as string,
      defaultImpact: r.default_impact as CatalogItemRecord['defaultImpact'],
      formSchema: r.form_schema as CatalogItemRecord['formSchema'],
      slaPolicyId: (r.sla_policy_id as string | null) ?? null,
      isActive: r.is_active as boolean,
      keywords: r.keywords as string[],
    };
    store.catalog.set(i.id, i);
  }

  for (const r of data.tickets) {
    const t: TicketRecord = {
      id: r.id as string,
      number: r.number as string,
      type: r.type as TicketRecord['type'],
      title: r.title as string,
      description: r.description as string,
      catalogItemId: (r.catalog_item_id as string | null) ?? null,
      categoryId: r.category_id as string,
      formData: r.form_data as Record<string, string>,
      requesterId: r.requester_id as string,
      teamId: (r.team_id as string | null) ?? null,
      assigneeId: (r.assignee_id as string | null) ?? null,
      impact: r.impact as TicketRecord['impact'],
      urgency: r.urgency as TicketRecord['urgency'],
      priority: r.priority as TicketRecord['priority'],
      priorityOverridden: r.priority_overridden as boolean,
      status: r.status as TicketRecord['status'],
      pendingReason: (r.pending_reason as TicketRecord['pendingReason']) ?? null,
      resolutionCode: (r.resolution_code as TicketRecord['resolutionCode']) ?? null,
      resolutionNotes: (r.resolution_notes as string | null) ?? null,
      firstResponseAt: (r.first_response_at as Date | null) ?? null,
      resolvedAt: (r.resolved_at as Date | null) ?? null,
      closedAt: (r.closed_at as Date | null) ?? null,
      reopenCount: r.reopen_count as number,
      escalationLevel: r.escalation_level as number,
      problemId: (r.problem_id as string | null) ?? null,
      isMajor: r.is_major as boolean,
      createdAt: r.created_at as Date,
      updatedAt: r.updated_at as Date,
    };
    store.tickets.set(t.id, t);
    store.ticketIdByNumber.set(t.number, t.id);
  }

  // SLA: pasangan response/resolution per tiket, urutan key dari listKeys.sla.
  const slaByTicket = groupBy(data.sla_instances, 'ticket_id');
  const toSla = (r: Row): SlaInstanceRecord => {
    const inst: SlaInstance = {
      kind: r.kind as SlaInstance['kind'],
      targetMinutes: r.target_minutes as number,
      status: r.status as SlaInstance['status'],
      startedAt: r.started_at as Date,
      runningSince: (r.running_since as Date | null) ?? null,
      pausedAt: (r.paused_at as Date | null) ?? null,
      stoppedAt: (r.stopped_at as Date | null) ?? null,
      elapsedMinutes: r.elapsed_minutes as number,
      pausedMinutes: r.paused_minutes as number,
      warnAt: r.warn_at as Date,
      dueAt: r.due_at as Date,
      warnedAt: (r.warned_at as Date | null) ?? null,
      breachedAt: (r.breached_at as Date | null) ?? null,
    };
    return {
      ...inst,
      id: r.id as string,
      ticketId: r.ticket_id as string,
      policyId: r.policy_id as string,
      calendarId: r.calendar_id as string,
    };
  };
  const slaKeys = [...listKeys.sla, ...slaByTicket.keys()];
  for (const ticketId of new Set(slaKeys)) {
    const pair = slaByTicket.get(ticketId) ?? [];
    const response = pair.find((r) => r.kind === 'response');
    const resolution = pair.find((r) => r.kind === 'resolution');
    if (response && resolution) {
      store.sla.set(ticketId, { response: toSla(response), resolution: toSla(resolution) });
    }
  }

  // Koleksi per-tiket: key dibuat sesuai listKeys (termasuk daftar kosong), isi sesuai ord.
  const eventRows = groupBy(data.ticket_events, 'ticket_id');
  for (const id of listKeys.events) store.events.set(id, []);
  for (const [id, rows] of eventRows) {
    const list = store.events.get(id) ?? [];
    for (const r of rows.sort(byOrd)) {
      const e: TicketEventRecord = {
        id: r.id as string,
        ticketId: id,
        actorId: (r.actor_id as string | null) ?? null,
        type: r.type as TicketEventRecord['type'],
        data: r.data as Record<string, unknown>,
        createdAt: r.created_at as Date,
      };
      list.push(e);
    }
    store.events.set(id, list);
  }

  const commentRows = groupBy(data.comments, 'ticket_id');
  for (const id of listKeys.comments) store.comments.set(id, []);
  for (const [id, rows] of commentRows) {
    const list = store.comments.get(id) ?? [];
    for (const r of rows.sort(byOrd)) {
      const c: CommentRecord = {
        id: r.id as string,
        ticketId: id,
        authorId: r.author_id as string,
        body: r.body as string,
        visibility: r.visibility as CommentRecord['visibility'],
        createdAt: r.created_at as Date,
      };
      list.push(c);
    }
    store.comments.set(id, list);
  }

  const attachmentRows = groupBy(data.attachments, 'ticket_id');
  for (const id of listKeys.attachments) store.attachments.set(id, []);
  for (const [id, rows] of attachmentRows) {
    const list = store.attachments.get(id) ?? [];
    for (const r of rows.sort(byOrd)) {
      const a: AttachmentRecord = {
        id: r.id as string,
        ticketId: id,
        commentId: (r.comment_id as string | null) ?? null,
        uploaderId: r.uploader_id as string,
        fileName: r.file_name as string,
        mime: r.mime as string,
        size: r.size as number,
        storageKey: r.storage_key as string,
        createdAt: r.created_at as Date,
      };
      list.push(a);
    }
    store.attachments.set(id, list);
  }

  for (const r of [...data.csat].sort(byOrd)) {
    const c: CsatRecord = {
      id: r.id as string,
      ticketId: r.ticket_id as string,
      score: r.score as number,
      comment: r.comment as string,
      createdAt: r.created_at as Date,
    };
    store.csat.set(c.ticketId, c);
  }

  store.notifications = [...data.notifications].sort(byOrd).map((r): NotificationRecord => ({
    id: r.id as string,
    userId: r.user_id as string,
    type: r.type as NotificationRecord['type'],
    ticketId: (r.ticket_id as string | null) ?? null,
    title: r.title as string,
    readAt: (r.read_at as Date | null) ?? null,
    createdAt: r.created_at as Date,
  }));

  store.changes = [...data.changes].sort(byOrd).map((r): ChangeRecord => ({
    id: r.id as string,
    number: r.number as string,
    type: r.type as ChangeRecord['type'],
    title: r.title as string,
    status: r.status as ChangeRecord['status'],
    source: r.source as ChangeRecord['source'],
    commitSha: r.commit_sha as string,
    environment: r.environment as string,
    startedAt: r.started_at as Date,
    finishedAt: (r.finished_at as Date | null) ?? null,
    metadata: r.metadata as ChangeRecord['metadata'],
  }));

  return store;
}
