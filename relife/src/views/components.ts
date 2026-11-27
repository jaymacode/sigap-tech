import { html, raw } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';
import { DEFAULT_TIMEZONE, DEFAULT_WORK_HOURS, type BusinessCalendar } from '@/domain/calendar';
import { APPROVAL_STEP_LABELS, type ApprovalStep } from '@/domain/approval';
import { PRIORITY_LABELS } from '@/domain/priority';
import { computeSlaState } from '@/domain/sla';
import type { Priority, TicketStatus } from '@/domain/types';
import {
  formatDateTime,
  formatDayHeading,
  formatSlaRemaining,
  formatSlaTarget,
  initials,
  localDateKey,
} from '@/lib/format';
import { fromSlaSnapshot, type SlaSnapshot, type TimelineEntry } from '@/lib/views';

export type HtmlContent = HtmlEscapedString | Promise<HtmlEscapedString>;

/** Emits an HTML boolean attribute only when `on` is true (hono/html has no `?attr` syntax). */
export function flag(name: string, on: boolean): HtmlEscapedString | '' {
  return on ? raw(` ${name}`) : '';
}

const FALLBACK_CALENDAR: BusinessCalendar = {
  kind: 'business_hours',
  timezone: DEFAULT_TIMEZONE,
  workHours: DEFAULT_WORK_HOURS,
  holidays: [],
};

// ---------------------------------------------------------------------------
// Inline SVG Icons (static trusted markup only — never interpolate user data)
// ---------------------------------------------------------------------------

const ICON_PATHS = {
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  ticket: '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2m0 10v2m0-8v2"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z"/>',
  warn: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4m0 4h.01"/>',
  octagon: '<polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"/><path d="M12 8v4m0 4h.01"/>',
  folder: '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>',
  dashboard: '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>',
  lifebuoy: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><path d="m4.93 4.93 4.24 4.24m5.66 5.66 4.24 4.24m-4.24-9.9 4.24-4.24m-9.9 9.9-4.24 4.24"/>',
  arrowLeft: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  checkCircle: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  pause: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
  xCircle: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6m0-6 6 6"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  edit: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
  swap: '<path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  table: '<path d="M12 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18M3 15h18"/>',
  plus: '<circle cx="12" cy="12" r="10"/><path d="M8 12h8m-4-4v8"/>',
  paperclip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  rotate: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
  laptop: '<path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3m.08 4h.01"/>',
  mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  printer: '<path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6"/><rect x="6" y="14" width="12" height="8" rx="1"/>',
  wifi: '<path d="M12 20h.01"/><path d="M2 8.82a15 15 0 0 1 20 0"/><path d="M5 12.859a10 10 0 0 1 14 0"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>',
  barChart: '<line x1="12" x2="12" y1="20" y2="10"/><line x1="18" x2="18" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="16"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  menu: '<line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="18" y2="18"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  sliders: '<line x1="4" x2="4" y1="21" y2="14"/><line x1="4" x2="4" y1="10" y2="3"/><line x1="12" x2="12" y1="21" y2="12"/><line x1="12" x2="12" y1="8" y2="3"/><line x1="20" x2="20" y1="21" y2="16"/><line x1="20" x2="20" y1="12" y2="3"/><line x1="2" x2="6" y1="14" y2="14"/><line x1="10" x2="14" y1="8" y2="8"/><line x1="18" x2="22" y1="16" y2="16"/>',
} as const;

export type IconName = keyof typeof ICON_PATHS;

export function icon(name: IconName, className = 'icon'): HtmlContent {
  return html`<svg
    class="${className}"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >${raw(ICON_PATHS[name])}</svg>`;
}

// ---------------------------------------------------------------------------
// Badges & Pills
// ---------------------------------------------------------------------------

export function priorityBadge(priority: Priority, showLabel = false): HtmlContent {
  const label = PRIORITY_LABELS[priority];
  return html`<span
    class="badge badge-priority badge-${priority.toLowerCase()}"
    title="Prioritas: ${priority} (${label})"
  ><span>${priority}</span>${showLabel ? html`<span class="badge-sub">· ${label}</span>` : null}</span>`;
}

export const AGENT_STATUS_LABELS: Readonly<Record<TicketStatus, string>> = {
  new: 'New',
  assigned: 'Assigned',
  in_progress: 'In Progress',
  pending: 'Pending',
  resolved: 'Resolved',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

export const PENDING_REASON_LABELS: Readonly<Record<string, string>> = {
  awaiting_user: 'Menunggu Jawaban User',
  awaiting_vendor: 'Menunggu Vendor',
  awaiting_change: 'Menunggu Change Request',
  scheduled: 'Terjadwal',
  awaiting_approval: 'Menunggu Persetujuan',
};

export const LEVEL_LABELS: Readonly<Record<string, string>> = {
  high: 'Tinggi',
  medium: 'Sedang',
  low: 'Rendah',
};

const REQUESTER_STATUS_LABELS: Readonly<Record<TicketStatus, string>> = {
  new: 'Terkirim',
  assigned: 'Diterima Tim',
  in_progress: 'Sedang Dikerjakan',
  pending: 'Menunggu Jawaban',
  resolved: 'Selesai',
  closed: 'Ditutup',
  cancelled: 'Dibatalkan',
};

export function statusPill(
  status: TicketStatus,
  mode: 'agent' | 'requester' = 'agent',
): HtmlContent {
  const label = mode === 'requester' ? REQUESTER_STATUS_LABELS[status] : AGENT_STATUS_LABELS[status];
  return html`<span class="pill pill-${status}"
    ><span class="pill-dot" aria-hidden="true"></span><span>${label}</span></span
  >`;
}

// ---------------------------------------------------------------------------
// SLA Components
// ---------------------------------------------------------------------------

export function slaIndicator(
  snapshot: SlaSnapshot,
  cal: BusinessCalendar = FALLBACK_CALENDAR,
  now: Date = new Date(),
  showKind = false,
): HtmlContent {
  const state = computeSlaState(fromSlaSnapshot(snapshot), now, cal);
  const kindLabel = snapshot.kind === 'response' ? 'Resp' : 'Res';
  const dueFormatted = formatDateTime(snapshot.dueAt);
  const remainingStr = formatSlaRemaining(state.remainingMinutes, cal.kind);

  let iconName: IconName = 'clock';
  let text = remainingStr;
  let variant = 'sla-normal';
  let title =
    cal.kind === 'business_hours'
      ? `Sisa waktu SLA: ${remainingStr} (jam kerja efektif). Jatuh tempo: ${dueFormatted}`
      : `Sisa waktu SLA: ${remainingStr} (24x7). Jatuh tempo: ${dueFormatted}`;

  if (state.status === 'met') {
    iconName = 'checkCircle';
    text = 'Tepat Waktu';
    variant = 'sla-ok';
    title = `SLA tercapai (Target: ${formatSlaTarget(snapshot.targetMinutes, cal.kind)})`;
  } else if (state.status === 'cancelled') {
    iconName = 'xCircle';
    text = 'Dibatalkan';
    variant = 'sla-muted';
    title = 'SLA dibatalkan';
  } else if (state.status === 'breached' || state.breached) {
    iconName = 'octagon';
    const overdue = Math.max(0, -state.remainingMinutes);
    text = overdue > 0 ? `Lewat ${formatSlaRemaining(overdue, cal.kind)}` : 'Terlewati';
    variant = 'sla-breach';
    title = `SLA terlewati pada ${dueFormatted}`;
  } else if (state.status === 'paused') {
    iconName = 'pause';
    text = `Jeda (${remainingStr})`;
    variant = 'sla-paused';
    title = `SLA dijeda. Sisa waktu saat resume: ${remainingStr}`;
  } else if (state.atRisk) {
    iconName = 'warn';
    variant = 'sla-risk';
    title = `SLA mendekati batas (≥75%). Sisa ${remainingStr}. Jatuh tempo: ${dueFormatted}`;
  }

  const isLive = state.status === 'running';
  const liveAttrs = isLive
    ? raw(
        ` data-sla-live="badge" data-rendered-at="${now.getTime()}" data-remaining="${state.remainingMinutes.toFixed(2)}" data-target="${snapshot.targetMinutes}" data-cal-kind="${cal.kind}"`,
      )
    : '';

  return html`<span class="sla-badge ${variant}" title="${title}"${liveAttrs}
    >${icon(iconName, 'icon-xs')}${showKind ? html`<span class="sla-kind">${kindLabel}:</span>` : null}<span data-sla-text>${text}</span></span
  >`;
}

export function slaProgress(
  snapshot: SlaSnapshot,
  cal: BusinessCalendar = FALLBACK_CALENDAR,
  now: Date = new Date(),
): HtmlContent {
  const state = computeSlaState(fromSlaSnapshot(snapshot), now, cal);
  const clamped = Math.min(100, Math.max(0, state.percentUsed));
  const fillClass =
    state.status === 'breached' || state.percentUsed >= 100
      ? 'is-breach'
      : state.atRisk || state.percentUsed >= 75
        ? 'is-risk'
        : 'is-ok';
  const pausedClass = state.status === 'paused' ? ' is-paused' : '';
  const isLive = state.status === 'running';
  const liveAttrs = isLive
    ? raw(
        ` data-sla-live="bar" data-rendered-at="${now.getTime()}" data-remaining="${state.remainingMinutes.toFixed(2)}" data-target="${snapshot.targetMinutes}" data-cal-kind="${cal.kind}"`,
      )
    : '';

  return html`<div
    class="sla-bar"
    role="progressbar"
    aria-valuenow="${Math.round(state.percentUsed)}"
    aria-valuemin="0"
    aria-valuemax="100"
    title="${Math.round(state.percentUsed)}% waktu SLA terpakai"${liveAttrs}
  >
    <span class="sla-bar-marker" title="Batas Peringatan SLA (75%)"></span>
    <div class="sla-bar-fill ${fillClass}${pausedClass}" style="width:${clamped}%"></div>
  </div>`;
}

export function slaCard(
  title: string,
  snapshot: SlaSnapshot,
  cal: BusinessCalendar = FALLBACK_CALENDAR,
  now: Date = new Date(),
): HtmlContent {
  return html`<div class="sla-stage">
    <div class="sla-stage-head">
      <span class="sla-stage-title">${title}</span>
      ${slaIndicator(snapshot, cal, now, false)}
    </div>
    ${slaProgress(snapshot, cal, now)}
    <div class="sla-stage-meta">
      <span>Target: ${formatSlaTarget(snapshot.targetMinutes, cal.kind)}</span>
      <span>${
        snapshot.stoppedAt
          ? `Selesai ${formatDateTime(snapshot.stoppedAt)}`
          : `Batas: ${formatDateTime(snapshot.dueAt)}`
      }</span>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// KPI Tile
// ---------------------------------------------------------------------------

export function kpiTile(opts: {
  title: string;
  value: string | number;
  subtitle?: string;
  status?: 'ok' | 'risk' | 'breach' | 'neutral';
  href?: string;
}): HtmlContent {
  const status = opts.status ?? 'neutral';
  const statusIcon: IconName | null =
    status === 'ok' ? 'checkCircle' : status === 'risk' ? 'warn' : status === 'breach' ? 'octagon' : null;
  const statusSr =
    status === 'ok' ? 'Sesuai target' : status === 'risk' ? 'Perlu perhatian' : status === 'breach' ? 'Melewati batas' : '';
  const inner = html`<div class="card kpi-tile kpi-${status}">
    <div class="kpi-head">
      <span class="kpi-title">${opts.title}</span>
      ${statusIcon ? html`<span class="kpi-status-icon">${icon(statusIcon, 'icon-xs')}<span class="sr-only">${statusSr}</span></span>` : null}
    </div>
    <div class="kpi-value tabular">${opts.value}</div>
    ${opts.subtitle ? html`<p class="kpi-sub">${opts.subtitle}</p>` : null}
  </div>`;

  return opts.href ? html`<a href="${opts.href}" class="kpi-link">${inner}</a>` : inner;
}

// ---------------------------------------------------------------------------
// Empty State
// ---------------------------------------------------------------------------

export function emptyState(
  title: string,
  desc: string,
  action?: HtmlContent,
  iconName: IconName = 'inbox',
): HtmlContent {
  return html`<div class="card empty-state">
    <div class="empty-icon">${icon(iconName, 'icon-lg')}</div>
    <h2 class="empty-title">${title}</h2>
    <p class="empty-desc">${desc}</p>
    ${action ? html`<div class="empty-action">${action}</div>` : null}
  </div>`;
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

function slaKindLabel(kind: unknown): string {
  return kind === 'response' ? 'First Response' : 'Resolution';
}

function eventDescription(entry: TimelineEntry): string {
  const d = entry.data ?? {};
  switch (entry.eventType as string | undefined) {
    case 'created':
      return `Tiket dibuat dengan prioritas ${String(d.priority ?? '—')}`;
    case 'status_changed': {
      const from = String(d.from ?? '');
      const to = String(d.to ?? '');
      const fromLabel = AGENT_STATUS_LABELS[from as TicketStatus] ?? from;
      const toLabel = AGENT_STATUS_LABELS[to as TicketStatus] ?? to;
      return `Status diubah dari ${fromLabel} menjadi ${toLabel}`;
    }
    case 'assigned':
      return d.assigneeId
        ? `Ditugaskan ke ${String(d.assigneeName ?? 'staf IT')}`
        : 'Penugasan tiket dilepas';
    case 'escalated_functional':
      return `Dieskalasi fungsional ke tim lain${d.note ? `: "${String(d.note)}"` : ''}`;
    case 'escalated_hierarchical':
      return `Eskalasi hierarkis Level ${String(d.level ?? 1)} dipicu oleh sistem`;
    case 'sla_paused': {
      const reason = String(d.reason ?? '');
      const reasonLabel = PENDING_REASON_LABELS[reason] ?? (reason || 'Menunggu');
      return `Penghitungan SLA dijeda (Alasan: ${reasonLabel})`;
    }
    case 'sla_resumed':
      return 'Penghitungan SLA dilanjutkan';
    case 'sla_warning':
      return `Peringatan SLA: ${slaKindLabel(d.kind)} SLA telah terpakai ≥ 75%`;
    case 'sla_breached':
      return `Batas waktu SLA (${slaKindLabel(d.kind)}) terlewati`;
    case 'sla_met':
      return `Target SLA (${slaKindLabel(d.kind)}) tercapai tepat waktu`;
    case 'first_response':
      return 'Respon pertama diberikan oleh staff';
    case 'sla_rebaselined':
      return 'Target SLA dihitung ulang karena perubahan prioritas';
    case 'classification_updated': {
      const impact = d.impact ? LEVEL_LABELS[String(d.impact)] ?? String(d.impact) : null;
      const urgency = d.urgency ? LEVEL_LABELS[String(d.urgency)] ?? String(d.urgency) : null;
      const parts = [impact ? `Dampak: ${impact}` : null, urgency ? `Urgensi: ${urgency}` : null].filter(Boolean);
      return parts.length > 0
        ? `Dampak/Urgensi diperbarui (${parts.join(', ')})`
        : 'Dampak/Urgensi diperbarui';
    }
    case 'auto_closed':
      return 'Tiket ditutup otomatis setelah 3 hari kerja tanpa respon';
    case 'priority_overridden':
      return `Prioritas di-override menjadi ${String(d.to ?? '')}. Alasan: "${String(d.reason ?? '')}"`;
    case 'priority_changed':
      return `Prioritas diperbarui dari ${String(d.from ?? '')} ke ${String(d.to ?? '')}`;
    case 'reopened':
      return `Tiket dibuka kembali oleh requester. Alasan: "${String(d.reason ?? '')}"`;
    case 'csat_submitted':
      return `Survei kepuasan (CSAT) diberikan: ${String(d.score ?? 5)} bintang`;
    case 'attachment_added':
      return `Lampiran ditambahkan: ${String(d.fileName ?? 'berkas')}`;
    case 'linked_problem':
      return 'Ditautkan ke catatan problem';
    case 'linked_kb':
      return 'Ditautkan ke artikel knowledge base';
    case 'approval_requested': {
      const step = APPROVAL_STEP_LABELS[d.step as ApprovalStep] ?? String(d.step ?? '');
      const via =
        d.via === 'email' ? ' (link dikirim via email)' : d.via === 'manual' ? ' (dicatat manual oleh staf IT)' : '';
      return `${d.resent ? 'Link persetujuan dikirim ulang' : 'Persetujuan diminta'}: ${step} — ${String(d.approverName ?? '')}${d.resent ? '' : via}`;
    }
    case 'approval_approved':
    case 'approval_rejected': {
      const step = APPROVAL_STEP_LABELS[d.step as ApprovalStep] ?? String(d.step ?? '');
      const verb = entry.eventType === 'approval_approved' ? 'disetujui' : 'ditolak';
      const presdir = d.presdirRequired ? ' · perlu persetujuan Presdir' : '';
      return `${step} ${verb} oleh ${String(d.approverName ?? '')}${d.note ? `: "${String(d.note)}"` : ''}${presdir}`;
    }
    case 'it_assessment_updated':
      return 'Rencana Tindakan & Analisis Dampak IT diperbarui';
    default:
      return entry.eventType?.replace(/_/g, ' ') ?? 'Aktivitas sistem';
  }
}

const ROLE_LABELS: Readonly<Record<string, string>> = {
  requester: 'Pemohon',
  agent: 'Staf IT',
  lead: 'Head IT',
  admin: 'Admin IT',
};

const clockFmt = new Intl.DateTimeFormat('id-ID', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: DEFAULT_TIMEZONE,
});

/** Pesan beruntun dari orang yang sama dalam jendela ini digabung (avatar & nama sekali). */
const RUN_WINDOW_MS = 10 * 60_000;

function dayLabel(at: string, now: Date): string {
  const key = localDateKey(at);
  if (key === localDateKey(now)) return 'Hari ini';
  if (key === localDateKey(new Date(now.getTime() - 86_400_000))) return 'Kemarin';
  return formatDayHeading(at);
}

function clock(at: string): HtmlContent {
  return html`<time class="th-time tabular" datetime="${at}" title="${formatDateTime(at)}"
    >${clockFmt.format(new Date(at))}</time
  >`;
}

function statusName(status: unknown, mode: 'agent' | 'requester'): string {
  const s = status as TicketStatus;
  return (mode === 'requester' ? REQUESTER_STATUS_LABELS[s] : AGENT_STATUS_LABELS[s]) ?? String(status);
}

/** Status event → "Lama → Baru" dengan titik warna status baru; event lain memakai kalimat deskriptif. */
function eventLine(entry: TimelineEntry, mode: 'agent' | 'requester'): HtmlContent {
  const d = entry.data ?? {};
  if (entry.eventType === 'status_changed' && d.from && d.to) {
    return html`<span class="th-ev-from">${statusName(d.from, mode)}</span>
      <span class="th-ev-arrow" aria-label="menjadi">→</span>
      <strong class="th-ev-to">${statusName(d.to, mode)}</strong>`;
  }
  return html`${eventDescription(entry)}`;
}

function eventDot(entry: TimelineEntry): string {
  if (entry.eventType === 'status_changed') return `st-${String(entry.data?.to ?? '')}`;
  if (entry.eventType === 'sla_breached') return 'st-breach';
  if (entry.eventType === 'sla_warning') return 'st-pending';
  return '';
}

type Block =
  | { kind: 'events'; entries: TimelineEntry[] }
  | { kind: 'run'; entries: TimelineEntry[] };

/** Gabungkan event berurutan menjadi satu segmen rail, dan pesan beruntun satu pengirim menjadi satu run. */
function toBlocks(entries: TimelineEntry[]): Block[] {
  const blocks: Block[] = [];
  for (const e of entries) {
    const last = blocks.at(-1);
    if (e.kind === 'event') {
      if (last?.kind === 'events') last.entries.push(e);
      else blocks.push({ kind: 'events', entries: [e] });
      continue;
    }
    const prev = last?.kind === 'run' ? last.entries.at(-1) : undefined;
    if (
      last?.kind === 'run' &&
      prev &&
      prev.kind === e.kind &&
      prev.actor?.id === e.actor?.id &&
      new Date(e.at).getTime() - new Date(prev.at).getTime() <= RUN_WINDOW_MS
    ) {
      last.entries.push(e);
    } else {
      blocks.push({ kind: 'run', entries: [e] });
    }
  }
  return blocks;
}

function attachmentList(entry: TimelineEntry): HtmlContent | null {
  if (!entry.attachments?.length) return null;
  return html`<ul class="th-files" aria-label="Lampiran">
    ${entry.attachments.map((att) => {
      const inner = html`${icon('paperclip', 'icon-xs')}
        <span class="th-file-name">${att.fileName}</span>
        <span class="th-file-size">${Math.max(1, Math.round(att.size / 1024))} KB</span>`;
      // Lampiran nyata = tautan unduh; data seed tanpa berkas ditandai "tidak tersedia".
      return att.url
        ? html`<li class="th-file"><a class="th-file-link" href="${att.url}" aria-label="Unduh ${att.fileName}">${inner}</a></li>`
        : html`<li class="th-file is-unavailable" title="Berkas tidak tersedia di server">
            ${inner} <span class="th-file-size">(tidak tersedia)</span>
          </li>`;
    })}
  </ul>`;
}

function eventsBlock(block: Block, mode: 'agent' | 'requester'): HtmlContent {
  return html`<li class="th-events" data-convo-kind="event">
    <ul class="th-rail">
      ${block.entries.map((e) => {
        const by =
          mode === 'agent' && e.actor && e.actor.role !== 'requester' && e.actor.id !== e.data?.assigneeId
            ? e.actor.name
            : null;
        return html`<li class="th-ev ${eventDot(e)}">
          <span class="th-ev-dot" aria-hidden="true"></span>
          <span class="th-ev-text">${eventLine(e, mode)}${by ? html`<span class="th-ev-by">oleh ${by}</span>` : null}</span>
          ${clock(e.at)}
        </li>`;
      })}
    </ul>
  </li>`;
}

function runBlock(block: Block, mode: 'agent' | 'requester'): HtmlContent {
  const first = block.entries[0]!;
  const name = first.actor?.name ?? 'Pengguna';
  const role = first.actor?.role ?? 'requester';
  const isInternal = first.kind === 'internal';
  const isStaff = role !== 'requester';
  const isMine = mode === 'requester' ? !isStaff : isStaff;

  if (isInternal) {
    return html`<li class="th-note" data-convo-kind="chat">
      <div class="th-note-head">
        ${icon('lock', 'icon-xs')}
        <strong>Catatan internal</strong>
        <span class="th-note-who">${name}</span>
        <span class="th-note-hint">tidak terlihat oleh pemohon</span>
      </div>
      ${block.entries.map(
        (e) => html`<article class="th-note-body" aria-label="Catatan internal dari ${name}">
          <div class="prose-pre">${e.body ?? ''}</div>
          ${attachmentList(e)}
          ${clock(e.at)}
        </article>`,
      )}
    </li>`;
  }

  // On the requester page "mine" is always the requester, so their own name/avatar is noise.
  const showWho = !(isMine && mode === 'requester');
  return html`<li
    class="th-run ${isMine ? 'is-mine' : 'is-theirs'} ${isStaff ? 'is-staff' : 'is-requester'}${showWho ? '' : ' is-self'}"
    data-convo-kind="chat"
  >
    ${showWho ? html`<span class="th-avatar" aria-hidden="true">${initials(name)}</span>` : null}
    <div class="th-stack">
      ${showWho
        ? html`<p class="th-who"><strong>${name}</strong><span class="th-role">${ROLE_LABELS[role] ?? role}</span></p>`
        : html`<p class="sr-only">Anda</p>`}
      ${block.entries.map(
        (e) => html`<article class="th-bubble" aria-label="Pesan dari ${name}">
          <div class="th-text prose-pre">${e.body ?? ''}</div>
          ${attachmentList(e)}
          ${clock(e.at)}
        </article>`,
      )}
    </div>
  </li>`;
}

/**
 * Percakapan tiket (lama → baru). Pesan tampil sebagai bubble chat — milik "saya" di kanan —,
 * perubahan status sebagai rail tipis di antaranya. `mode` menentukan sisi "saya" & label status.
 */
export function timeline(
  entries: TimelineEntry[],
  now: Date = new Date(),
  mode: 'agent' | 'requester' = 'agent',
): HtmlContent {
  if (entries.length === 0) {
    return emptyState('Belum ada riwayat', 'Belum ada riwayat aktivitas pada tiket ini.', undefined, 'message');
  }

  const days = new Map<string, TimelineEntry[]>();
  for (const e of entries) {
    const key = localDateKey(e.at);
    days.set(key, [...(days.get(key) ?? []), e]);
  }

  return html`<div class="thread thread-${mode}" data-convo>
    ${[...days.values()].map((dayEntries) => {
      const label = dayLabel(dayEntries[0]!.at, now);
      return html`<section class="th-day">
        <h3 class="th-date">${label}</h3>
        <ol class="th-list" aria-label="Aktivitas ${label}">
          ${toBlocks(dayEntries).map((b) => (b.kind === 'events' ? eventsBlock(b, mode) : runBlock(b, mode)))}
        </ol>
      </section>`;
    })}
  </div>`;
}
