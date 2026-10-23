import type { WeeklyHours, CalendarKind } from '@/domain/calendar';
import type { SlaInstance } from '@/domain/sla';
import type {
  Impact,
  PendingReason,
  Priority,
  ResolutionCode,
  Role,
  TicketEventType,
  TicketStatus,
  TicketType,
  Urgency,
} from '@/domain/types';

/**
 * Record mock in-memory yang meniru tabel DATA_MODEL.md (camelCase).
 * Saat backend asli (Drizzle) dibangun, tipe ini menjadi acuan bentuk hasil repository.
 */

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  role: Role;
  department: string;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export interface TeamRecord {
  id: string;
  name: string;
  description: string;
  leadId: string | null;
  autoAssign: boolean;
  memberIds: string[];
  createdAt: Date;
}

export interface CategoryRecord {
  id: string;
  name: string;
  parentId: string | null;
  defaultTeamId: string | null;
  isActive: boolean;
}

export const FORM_FIELD_TYPES = ['text', 'textarea', 'select', 'date'] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

export interface FormField {
  key: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  options?: string[];
  placeholder?: string;
}

export interface CatalogItemRecord {
  id: string;
  name: string;
  description: string;
  /** Nama ikon lucide (lihat `components/itsm/catalog-icon.tsx`). */
  icon: string;
  ticketType: TicketType;
  categoryId: string;
  defaultImpact: Impact;
  formSchema: FormField[];
  slaPolicyId: string | null;
  isActive: boolean;
  /** Kata kunci untuk pencarian portal. */
  keywords: string[];
}

export interface CalendarRecord {
  id: string;
  name: string;
  kind: CalendarKind;
  timezone: string;
  workHours: WeeklyHours;
}

export interface HolidayRecord {
  id: string;
  calendarId: string;
  date: string;
  name: string;
}

export interface SlaTargetRecord {
  priority: Priority;
  responseMinutes: number;
  resolutionMinutes: number;
  calendarId: string;
}

export interface SlaPolicyRecord {
  id: string;
  name: string;
  ticketType: TicketType;
  isDefault: boolean;
  version: number;
  targets: SlaTargetRecord[];
  updatedAt: Date;
}

export interface SlaInstanceRecord extends SlaInstance {
  id: string;
  ticketId: string;
  policyId: string;
  calendarId: string;
}

export interface TicketRecord {
  id: string;
  number: string;
  type: TicketType;
  title: string;
  description: string;
  catalogItemId: string | null;
  categoryId: string;
  formData: Record<string, string>;
  requesterId: string;
  teamId: string | null;
  assigneeId: string | null;
  impact: Impact;
  urgency: Urgency;
  priority: Priority;
  priorityOverridden: boolean;
  status: TicketStatus;
  pendingReason: PendingReason | null;
  resolutionCode: ResolutionCode | null;
  resolutionNotes: string | null;
  firstResponseAt: Date | null;
  resolvedAt: Date | null;
  closedAt: Date | null;
  reopenCount: number;
  escalationLevel: number;
  problemId: string | null;
  isMajor: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface TicketEventRecord {
  id: string;
  ticketId: string;
  /** null = sistem. */
  actorId: string | null;
  type: TicketEventType;
  data: Record<string, unknown>;
  createdAt: Date;
}

export type CommentVisibility = 'public' | 'internal';

export interface CommentRecord {
  id: string;
  ticketId: string;
  authorId: string;
  body: string;
  visibility: CommentVisibility;
  createdAt: Date;
}

export interface AttachmentRecord {
  id: string;
  ticketId: string;
  commentId: string | null;
  uploaderId: string;
  fileName: string;
  mime: string;
  size: number;
  storageKey: string;
  createdAt: Date;
}

export interface CsatRecord {
  id: string;
  ticketId: string;
  score: number;
  comment: string;
  createdAt: Date;
}

export const NOTIFICATION_TYPES = [
  'assigned',
  'comment',
  'sla_warning',
  'sla_breached',
  'status_changed',
  'escalated',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface NotificationRecord {
  id: string;
  userId: string;
  type: NotificationType;
  ticketId: string | null;
  title: string;
  readAt: Date | null;
  createdAt: Date;
}

export type ChangeStatus = 'planned' | 'in_progress' | 'succeeded' | 'failed' | 'rolled_back';

export interface ChangeRecord {
  id: string;
  number: string;
  type: 'standard' | 'normal' | 'emergency';
  title: string;
  status: ChangeStatus;
  source: 'pipeline' | 'manual';
  commitSha: string;
  environment: string;
  startedAt: Date;
  finishedAt: Date | null;
  metadata: { fromVersion: string; toVersion: string };
}

export interface Sequences {
  incident: number;
  request: number;
  change: number;
}
