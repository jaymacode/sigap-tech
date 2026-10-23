import type { BusinessCalendar } from '@/domain/calendar';
import type { SlaInstance, SlaState } from '@/domain/sla';
import type {
  Impact,
  PendingReason,
  Priority,
  ResolutionCode,
  Role,
  SlaKind,
  SlaStatus,
  TicketEventType,
  TicketStatus,
  TicketType,
  Urgency,
} from '@/domain/types';

/**
 * View model serializable (props RSC → client). Semua waktu ISO UTC string.
 */

export interface UserRef {
  id: string;
  name: string;
}

/** Snapshot SLA instance; client merekonstruksi `SlaInstance` untuk countdown live. */
export interface SlaSnapshot {
  kind: SlaKind;
  targetMinutes: number;
  status: SlaStatus;
  startedAt: string;
  runningSince: string | null;
  pausedAt: string | null;
  stoppedAt: string | null;
  elapsedMinutes: number;
  pausedMinutes: number;
  warnAt: string;
  dueAt: string;
  warnedAt: string | null;
  breachedAt: string | null;
  calendarId: string;
}

/** Kalender serializable untuk client (BusinessCalendar sudah plain object). */
export type CalendarMap = Record<string, BusinessCalendar>;

export interface TicketListItem {
  id: string;
  number: string;
  title: string;
  type: TicketType;
  status: TicketStatus;
  priority: Priority;
  pendingReason: PendingReason | null;
  requester: UserRef;
  assignee: UserRef | null;
  team: { id: string; name: string } | null;
  category: string;
  createdAt: string;
  updatedAt: string;
  response: SlaSnapshot;
  resolution: SlaSnapshot;
}

export interface TimelineEntry {
  id: string;
  kind: 'comment' | 'internal' | 'event';
  at: string;
  actor: (UserRef & { role: Role }) | null;
  /** Untuk comment/internal. */
  body?: string;
  attachments?: AttachmentView[];
  /** Untuk event sistem. */
  eventType?: TicketEventType;
  data?: Record<string, unknown>;
}

export interface AttachmentView {
  id: string;
  fileName: string;
  size: number;
  mime: string;
}

export interface TicketDetail extends TicketListItem {
  description: string;
  impact: Impact;
  urgency: Urgency;
  priorityOverridden: boolean;
  resolutionCode: ResolutionCode | null;
  resolutionNotes: string | null;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  reopenCount: number;
  escalationLevel: number;
  catalogItem: { id: string; name: string } | null;
  formFields: Array<{ label: string; value: string }>;
  requesterInfo: {
    id: string;
    name: string;
    email: string;
    department: string;
    openTickets: number;
  };
  csat: { score: number; comment: string; createdAt: string } | null;
  timeline: TimelineEntry[];
  attachments: AttachmentView[];
  policyName: string;
  related: Array<{ number: string; title: string; status: TicketStatus }>;
}

// ---------------------------------------------------------------------------
// Konversi snapshot ⇄ domain
// ---------------------------------------------------------------------------

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);
const date = (s: string | null): Date | null => (s ? new Date(s) : null);

/** Domain instance → snapshot serializable. */
export function toSlaSnapshot(instance: SlaInstance & { calendarId: string }): SlaSnapshot {
  return {
    kind: instance.kind,
    targetMinutes: instance.targetMinutes,
    status: instance.status,
    startedAt: instance.startedAt.toISOString(),
    runningSince: iso(instance.runningSince),
    pausedAt: iso(instance.pausedAt),
    stoppedAt: iso(instance.stoppedAt),
    elapsedMinutes: instance.elapsedMinutes,
    pausedMinutes: instance.pausedMinutes,
    warnAt: instance.warnAt.toISOString(),
    dueAt: instance.dueAt.toISOString(),
    warnedAt: iso(instance.warnedAt),
    breachedAt: iso(instance.breachedAt),
    calendarId: instance.calendarId,
  };
}

/** Snapshot → domain instance (dipakai di client untuk `computeSlaState`). */
export function fromSlaSnapshot(s: SlaSnapshot): SlaInstance {
  return {
    kind: s.kind,
    targetMinutes: s.targetMinutes,
    status: s.status,
    startedAt: new Date(s.startedAt),
    runningSince: date(s.runningSince),
    pausedAt: date(s.pausedAt),
    stoppedAt: date(s.stoppedAt),
    elapsedMinutes: s.elapsedMinutes,
    pausedMinutes: s.pausedMinutes,
    warnAt: new Date(s.warnAt),
    dueAt: new Date(s.dueAt),
    warnedAt: date(s.warnedAt),
    breachedAt: date(s.breachedAt),
  };
}

/** SLA yang paling relevan ditampilkan di daftar: response bila masih berjalan, selain itu resolution. */
export function primarySla(item: Pick<TicketListItem, 'response' | 'resolution'>): SlaSnapshot {
  const r = item.response.status;
  return r === 'running' || r === 'paused' ? item.response : item.resolution;
}

export type { SlaState };
