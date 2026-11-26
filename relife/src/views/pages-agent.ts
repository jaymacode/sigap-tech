import { html } from 'hono/html';
import { holidayTypeOf } from '@/routes/admin-calendar';
import { systemClock } from '@/server/clock';
import { formatDateTime, localDateKey, formatDuration, formatRelative, formatSlaTarget } from '@/lib/format';
import type { CalendarMap, TicketDetail } from '@/lib/views';
import type { SessionUser } from '@/server/auth/session';
import type { AdminData } from '@/server/queries/admin';
import type { DashboardData } from '@/server/queries/dashboard';
import type { NotificationItem } from '@/server/queries/notifications';
import {
  AGE_BUCKET_LABELS,
  primarySla,
  QUEUE_VIEW_LABELS,
  type AssigneeOption,
  type QueueFilters,
  type QueueResult,
} from '@/server/queries/tickets';
import {
  agentPerformanceCard,
  agingChart,
  slaPriorityChart,
  topCategoriesCard,
  volumeChart,
} from './charts';
import {
  emptyState,
  flag,
  icon,
  kpiTile,
  LEVEL_LABELS,
  PENDING_REASON_LABELS,
  priorityBadge,
  slaCard,
  slaIndicator,
  statusPill,
  timeline,
  type HtmlContent,
  type IconName,
} from './components';
import { attachmentPicker } from './attachments';
import { agentApprovalCard } from './approvals';

// ---------------------------------------------------------------------------
// Queue Page
// ---------------------------------------------------------------------------

function queuePageUrl(filters: QueueFilters, page: number): string {
  const sp = new URLSearchParams();
  sp.set('view', filters.view);
  if (filters.q) sp.set('q', filters.q);
  if (filters.priority?.length) sp.set('priority', filters.priority.join(','));
  if (typeof filters.status === 'string') sp.set('status', filters.status);
  else if (filters.status?.length) sp.set('status', filters.status.join(','));
  if (filters.type) sp.set('type', filters.type);
  if (filters.age) sp.set('age', filters.age);
  if (filters.sla) sp.set('sla', filters.sla);
  if (filters.assignee) sp.set('assignee', filters.assignee);
  if (filters.category) sp.set('category', filters.category);
  if (filters.sort !== 'sla') sp.set('sort', filters.sort);
  if (filters.dir !== 'asc') sp.set('dir', filters.dir);
  if (page > 1) sp.set('page', String(page));
  return `/queue?${sp.toString()}`;
}

function buildActiveFilterChips(
  filters: QueueFilters,
  assignees: AssigneeOption[],
): Array<{ label: string; removeUrl: string }> {
  const chips: Array<{ label: string; removeUrl: string }> = [];
  const drop = (key: keyof QueueFilters) => queuePageUrl({ ...filters, [key]: undefined }, 1);
  if (filters.q) chips.push({ label: `Cari: "${filters.q}"`, removeUrl: drop('q') });
  if (filters.priority?.length) {
    chips.push({ label: `Prioritas: ${filters.priority.join(',')}`, removeUrl: drop('priority') });
  }
  if (filters.assignee) {
    const name =
      filters.assignee === 'none'
        ? 'Unassigned'
        : (assignees.find((a) => a.id === filters.assignee)?.name ?? filters.assignee);
    chips.push({ label: `Assignee: ${name}`, removeUrl: drop('assignee') });
  }
  const statusVal =
    typeof filters.status === 'string' ? filters.status : (filters.status?.join(',') ?? '');
  if (statusVal) chips.push({ label: `Status: ${statusVal}`, removeUrl: drop('status') });
  if (filters.type) {
    chips.push({
      label: `Tipe: ${filters.type === 'incident' ? 'Incident' : 'Request'}`,
      removeUrl: drop('type'),
    });
  }
  if (filters.age) chips.push({ label: `Umur: ${AGE_BUCKET_LABELS[filters.age]}`, removeUrl: drop('age') });
  if (filters.sla) {
    chips.push({
      label: `SLA: ${filters.sla === 'met' ? 'Terpenuhi' : 'Breached'}`,
      removeUrl: drop('sla'),
    });
  }
  if (filters.category) chips.push({ label: `Kategori: ${filters.category}`, removeUrl: drop('category') });
  return chips;
}

export function queuePage(
  queueResult: QueueResult,
  filters: QueueFilters,
  assignees: AssigneeOption[],
  calendars: CalendarMap,
  currentUserId?: string,
): HtmlContent {
  const now = new Date();
  const currentView = filters.view;
  const statusVal =
    typeof filters.status === 'string' ? filters.status : (filters.status?.join(',') ?? '');
  const prioVal = filters.priority?.[0] ?? '';
  const activeChips = buildActiveFilterChips(filters, assignees);

  return html`<div class="page-pad stack-md">
    <div>
      <h1 class="page-h1">${QUEUE_VIEW_LABELS[currentView]}</h1>
      <p class="text-muted text-xs">Daftar tiket aktif yang diurutkan berdasarkan sisa waktu SLA terdekat.</p>
    </div>

    <div class="card toolbar">
      <div class="toolbar-filters">
        <form method="get" action="/queue" class="search-form">
          <input type="hidden" name="view" value="${currentView}" />
          ${prioVal ? html`<input type="hidden" name="priority" value="${prioVal}" />` : null}
          ${filters.assignee ? html`<input type="hidden" name="assignee" value="${filters.assignee}" />` : null}
          ${statusVal ? html`<input type="hidden" name="status" value="${statusVal}" />` : null}
          ${filters.type ? html`<input type="hidden" name="type" value="${filters.type}" />` : null}
          ${filters.age ? html`<input type="hidden" name="age" value="${filters.age}" />` : null}
          ${filters.sla ? html`<input type="hidden" name="sla" value="${filters.sla}" />` : null}
          ${filters.category ? html`<input type="hidden" name="category" value="${filters.category}" />` : null}
          ${filters.sort !== 'sla' ? html`<input type="hidden" name="sort" value="${filters.sort}" />` : null}
          ${filters.dir !== 'asc' ? html`<input type="hidden" name="dir" value="${filters.dir}" />` : null}
          <div class="search-wrap">
            ${icon('search', 'icon-xs search-icon')}
            <input
              type="search"
              name="q"
              class="input input-sm input-search"
              value="${filters.q ?? ''}"
              placeholder="Cari nomor, judul, pemohon..."
              aria-label="Cari tiket di queue"
            />
          </div>
          <button type="submit" class="btn btn-secondary btn-sm">Cari</button>
        </form>

        <select class="select select-sm" data-queue-filter="priority" aria-label="Filter Prioritas">
          <option value=""${flag('selected', prioVal === '')}>Prioritas: Semua</option>
          <option value="P1"${flag('selected', prioVal === 'P1')}>P1 Critical</option>
          <option value="P2"${flag('selected', prioVal === 'P2')}>P2 High</option>
          <option value="P3"${flag('selected', prioVal === 'P3')}>P3 Medium</option>
          <option value="P4"${flag('selected', prioVal === 'P4')}>P4 Low</option>
        </select>

        <select class="select select-sm" data-queue-filter="assignee" aria-label="Filter Assignee">
          <option value=""${flag('selected', !filters.assignee)}>Assignee: Semua</option>
          <option value="none"${flag('selected', filters.assignee === 'none')}>Unassigned</option>
          ${assignees.map(
            (a) => html`<option value="${a.id}"${flag('selected', filters.assignee === a.id)}>
              ${a.name}
            </option>`,
          )}
        </select>

        <details class="popover filter-popover">
          <summary class="btn btn-secondary btn-sm">Filter Lainnya</summary>
          <div class="popover-panel filter-panel">
            <select class="select select-sm" data-queue-filter="status" aria-label="Filter Status">
              <option value=""${flag('selected', statusVal === '')}>Status: Semua</option>
              <option value="active"${flag('selected', statusVal === 'active')}>Semua Aktif</option>
              <option value="new"${flag('selected', statusVal === 'new')}>New</option>
              <option value="assigned"${flag('selected', statusVal === 'assigned')}>Assigned</option>
              <option value="in_progress"${flag('selected', statusVal === 'in_progress')}>In Progress</option>
              <option value="pending"${flag('selected', statusVal === 'pending')}>Pending</option>
              <option value="resolved"${flag('selected', statusVal === 'resolved')}>Resolved</option>
              <option value="closed"${flag('selected', statusVal === 'closed')}>Closed</option>
              <option value="cancelled"${flag('selected', statusVal === 'cancelled')}>Cancelled</option>
            </select>

            <select class="select select-sm" data-queue-filter="type" aria-label="Filter Tipe">
              <option value=""${flag('selected', !filters.type)}>Tipe: Semua</option>
              <option value="incident"${flag('selected', filters.type === 'incident')}>Incident</option>
              <option value="service_request"${flag('selected', filters.type === 'service_request')}>Request</option>
            </select>

            <select class="select select-sm" data-queue-filter="age" aria-label="Filter Umur">
              <option value=""${flag('selected', !filters.age)}>Umur: Semua</option>
              <option value="lt1"${flag('selected', filters.age === 'lt1')}>&lt; 1 hari kerja</option>
              <option value="1to3"${flag('selected', filters.age === '1to3')}>1–3 hari kerja</option>
              <option value="3to7"${flag('selected', filters.age === '3to7')}>3–7 hari kerja</option>
              <option value="gt7"${flag('selected', filters.age === 'gt7')}>&gt; 7 hari kerja</option>
            </select>

            <select class="select select-sm" data-queue-filter="sla" aria-label="Filter SLA">
              <option value=""${flag('selected', !filters.sla)}>SLA: Semua</option>
              <option value="met"${flag('selected', filters.sla === 'met')}>SLA Terpenuhi</option>
              <option value="breached"${flag('selected', filters.sla === 'breached')}>SLA Breached</option>
            </select>

            <select class="select select-sm" data-queue-filter="sort" aria-label="Urutkan">
              <option value="sla"${flag('selected', filters.sort === 'sla')}>Urut: SLA Terdekat</option>
              <option value="priority"${flag('selected', filters.sort === 'priority')}>Urut: Prioritas</option>
              <option value="created"${flag('selected', filters.sort === 'created')}>Urut: Dibuat</option>
              <option value="updated"${flag('selected', filters.sort === 'updated')}>Urut: Diperbarui</option>
            </select>
          </div>
        </details>
      </div>

      <div class="toolbar-meta">
        <button type="button" id="queue-refresh" class="icon-btn" title="Muat ulang data (Auto 30d)">
          ${icon('refresh', 'icon-xs')}
        </button>
        <span class="mono text-xs text-muted">Total: <strong>${queueResult.total}</strong></span>
      </div>
    </div>

    ${activeChips.length > 0
      ? html`<div class="filter-chips">
          ${activeChips.map(
            (chip) => html`<a href="${chip.removeUrl}" class="badge filter-chip" title="Hapus filter">
              <span>${chip.label}</span>
              <span aria-hidden="true">×</span>
            </a>`,
          )}
          <a href="/queue?view=${currentView}" class="link-accent text-xs">Reset semua filter</a>
        </div>`
      : null}

    <div id="bulk-bar" class="bulk-bar" hidden>
      <div class="row-gap-sm">
        <span id="bulk-count" class="mono font-bold text-accent">0 tiket terpilih</span>
      </div>
      <div class="row-gap-sm">
        <select id="bulk-assignee" class="select select-sm">
          <option value="">-- Tugaskan Massal ke Staff --</option>
          ${assignees.map(
            (a) => html`<option value="${a.id}">
              ${a.name} · ${a.activeLoad} tiket aktif
            </option>`,
          )}
        </select>
        <button type="button" id="bulk-apply" class="btn btn-primary btn-sm">
          ${icon('users', 'icon-xs')} <span>Tugaskan</span>
        </button>
      </div>
    </div>

    ${queueResult.items.length === 0
      ? emptyState(
          'Tidak ada tiket di queue ini',
          'Semua tiket pada filter ini telah terselesaikan atau tidak ada tiket yang cocok.',
          html`<a href="/queue?view=team" class="btn btn-secondary btn-sm">Reset ke Antrean Tim IT</a>`,
        )
      : html`<div class="card table-wrap desktop-only">
            <table class="table queue-table">
              <thead>
                <tr>
                  <th class="col-check"><input type="checkbox" data-select-all aria-label="Pilih semua tiket" /></th>
                  <th>Nomor</th>
                  <th>Judul Tiket</th>
                  <th>Requester</th>
                  <th>Prioritas</th>
                  <th>Status</th>
                  <th>Assignee</th>
                  <th>Target SLA</th>
                  <th>Umur</th>
                </tr>
              </thead>
              <tbody>
                ${queueResult.items.map((t) => {
                  const pSla = primarySla(t);
                  const cal = calendars[pSla.calendarId];
                  return html`<tr data-queue-row data-href="/tickets/${t.number}">
                    <td class="col-check">
                      <input type="checkbox" data-select-id="${t.id}" aria-label="Pilih tiket ${t.number}" />
                    </td>
                    <td class="mono font-bold">
                      <a href="/tickets/${t.number}" class="link-accent">${t.number}</a>
                    </td>
                    <td>
                      <div class="ticket-cell">
                        <span class="ticket-cell-title">${t.title}</span>
                        <span class="ticket-cell-cat">${t.category}</span>
                      </div>
                    </td>
                    <td class="text-muted truncate-cell">${t.requester.name}</td>
                    <td>${priorityBadge(t.priority)}</td>
                    <td>${statusPill(t.status, 'agent')}</td>
                    <td class="truncate-cell">
                      ${t.assignee
                        ? t.assignee.name
                        : html`<span class="row-gap-xs">
                            <span class="text-muted italic">Unassigned</span>
                            ${currentUserId
                              ? html`<button
                                  type="button"
                                  class="btn btn-ghost btn-sm"
                                  data-api-btn
                                  data-url="/api/tickets/${t.id}/assign"
                                  data-body="${JSON.stringify({ assigneeId: currentUserId })}"
                                  data-reload="true"
                                  data-success-msg="Tiket berhasil diambil"
                                >
                                  Ambil
                                </button>`
                              : null}
                          </span>`}
                    </td>
                    <td>${slaIndicator(pSla, cal, now, true)}</td>
                    <td class="text-muted tabular nowrap">${formatRelative(t.createdAt, now)}</td>
                  </tr>`;
                })}
              </tbody>
            </table>
          </div>

          <div class="mobile-cards mobile-only">
            ${queueResult.items.map((t) => {
              const pSla = primarySla(t);
              const cal = calendars[pSla.calendarId];
              return html`<a href="/tickets/${t.number}" class="card mobile-card">
                <div class="row-between">
                  <span class="mono text-accent font-bold text-xs">${t.number}</span>
                  <div class="row-gap-xs">${priorityBadge(t.priority)}${statusPill(t.status, 'agent')}</div>
                </div>
                <h2 class="mobile-card-title">${t.title}</h2>
                <div class="mobile-card-foot">
                  <span class="text-muted">${t.assignee?.name ?? 'Unassigned'}</span>
                  ${slaIndicator(pSla, cal, now, false)}
                </div>
              </a>`;
            })}
          </div>

          <div class="shortcut-bar">
            Pintasan keyboard: <kbd class="kbd">j</kbd> / <kbd class="kbd">k</kbd> pilih baris ·
            <kbd class="kbd">x</kbd> centang · <kbd class="kbd">Enter</kbd> buka tiket ·
            <kbd class="kbd">Ctrl+K</kbd> cari cepat
          </div>`}

    ${queueResult.pageCount > 1
      ? html`<div class="pagination">
          <span class="text-muted text-xs">
            Halaman ${queueResult.page} dari ${queueResult.pageCount}
          </span>
          <div class="row-gap-sm">
            ${queueResult.page > 1
              ? html`<a href="${queuePageUrl(filters, queueResult.page - 1)}" class="btn btn-secondary btn-sm">← Sebelumnya</a>`
              : html`<span class="btn btn-secondary btn-sm is-disabled">← Sebelumnya</span>`}
            ${queueResult.page < queueResult.pageCount
              ? html`<a href="${queuePageUrl(filters, queueResult.page + 1)}" class="btn btn-secondary btn-sm">Selanjutnya →</a>`
              : html`<span class="btn btn-secondary btn-sm is-disabled">Selanjutnya →</span>`}
          </div>
        </div>`
      : null}
  </div>`;
}

// ---------------------------------------------------------------------------
// Agent Ticket Detail Page (with RBAC + 6 Native Modals)
// ---------------------------------------------------------------------------

export function agentTicketDetailPage(
  detail: TicketDetail,
  user: SessionUser,
  assignees: AssigneeOption[],
  calendars: CalendarMap,
): HtmlContent {
  const now = new Date();
  const cal = calendars[detail.resolution.calendarId];
  const isActive = ['new', 'assigned', 'in_progress', 'pending'].includes(detail.status);
  const canOverride = user.role === 'lead' || user.role === 'admin';

  const inTeam = detail.team ? user.teamIds.includes(detail.team.id) : false;
  const leadsTeam = detail.team ? user.ledTeamIds.includes(detail.team.id) : false;
  const isAdmin = user.role === 'admin';
  const isLead = user.role === 'lead';
  const canManageAssignment = isAdmin || leadsTeam || (isLead && inTeam);
  const isAssignedToMe = detail.assignee?.id === user.id;
  // Samakan dengan rbac.canWork + workflow.isAssigneeOrSupervisor agar tidak ada tombol mati.
  const canWork = isAdmin || ((isLead || user.role === 'agent') && (inTeam || leadsTeam));
  const canDrive = canWork && (isAssignedToMe || isAdmin || isLead);
  const isUnassigned = !detail.assignee;

  const availableAssignees = isAdmin
    ? assignees
    : detail.team
      ? assignees.filter((a) => a.teamId === detail.team?.id)
      : assignees;

  return html`<div class="page-pad stack-md">
    <div>
      <a href="/queue" class="back-link">
        ${icon('arrowLeft', 'icon-xs')} <span>Kembali ke Queue</span>
      </a>
    </div>

    <div class="card detail-bar">
      <div class="row-between-wrap">
        <div class="row-gap-sm">
          <span class="mono text-accent font-bold text-md">${detail.number}</span>
          ${priorityBadge(detail.priority, true)}
          ${statusPill(detail.status, 'agent')}
          ${detail.pendingReason
            ? html`<span class="badge badge-pending">
                Alasan: ${PENDING_REASON_LABELS[detail.pendingReason] ?? detail.pendingReason}
              </span>`
            : null}
        </div>

        ${isActive && canWork
          ? html`<div class="row-gap-xs wrap">
              ${canDrive && detail.approval.startBlocked && detail.status === 'assigned'
                ? html`<span class="badge badge-pending" title="${detail.approval.startBlocked}">
                    ${icon('lock', 'icon-xs')} <span>Menunggu persetujuan</span>
                  </span>`
                : null}
              ${canDrive && detail.status === 'assigned' && !detail.approval.startBlocked
                ? html`<button
                    type="button"
                    class="btn btn-primary btn-sm"
                    data-api-btn
                    data-url="/api/tickets/${detail.id}/transition"
                    data-body="${JSON.stringify({ to: 'in_progress' })}"
                    data-reload="true"
                    data-success-msg="Status tiket berhasil diperbarui"
                  >
                    ${icon('play', 'icon-xs')} <span>Start Progress</span>
                  </button>`
                : null}
              ${canDrive && detail.status === 'in_progress'
                ? html`<button type="button" class="btn btn-secondary btn-sm" data-open-dialog="dlg-pending">
                    ${icon('pause', 'icon-xs')} <span>Jeda (Pending)</span>
                  </button>`
                : null}
              ${canDrive && detail.status === 'pending' && !detail.approval.awaiting
                ? html`<button
                    type="button"
                    class="btn btn-primary btn-sm"
                    data-api-btn
                    data-url="/api/tickets/${detail.id}/transition"
                    data-body="${JSON.stringify({ to: 'in_progress' })}"
                    data-reload="true"
                    data-success-msg="Status tiket dilanjutkan"
                  >
                    ${icon('play', 'icon-xs')} <span>Lanjutkan (Resume)</span>
                  </button>`
                : null}
              ${canDrive && detail.status === 'in_progress' && !detail.approval.awaiting
                ? html`<button type="button" class="btn btn-success btn-sm" data-open-dialog="dlg-resolve">
                    ${icon('checkCircle', 'icon-xs')} <span>Selesaikan (Resolve)</span>
                  </button>`
                : null}
              <button type="button" class="btn btn-ghost btn-sm text-danger" data-open-dialog="dlg-cancel">
                ${icon('xCircle', 'icon-xs')} <span>Batalkan</span>
              </button>
            </div>`
          : null}
      </div>

      <h1 class="page-h1">${detail.title}</h1>
      <div class="detail-meta">
        <span>Kategori: <strong>${detail.category}</strong></span>
        <span>·</span>
        <span>Pemohon: <strong>${detail.requester.name}</strong></span>
        <span>·</span>
        <span>Dibuat: ${formatDateTime(detail.createdAt)} (${formatRelative(detail.createdAt, now)})</span>
      </div>
    </div>

    <div class="detail-grid">
      <div class="detail-main stack-md">
        <div class="card">
          <div class="card-header">
            <h2 class="section-label">Deskripsi Tiket</h2>
          </div>
          <div class="card-body stack">
            <p class="prose-pre">${detail.description}</p>
            ${detail.formFields.length > 0
              ? html`<div class="kv-grid">
                  ${detail.formFields.map(
                    (f) => html`<div class="kv-item">
                      <span class="kv-label">${f.label}</span>
                      <span class="kv-value">${f.value}</span>
                    </div>`,
                  )}
                </div>`
              : null}
          </div>
        </div>

        ${agentApprovalCard(detail, user)}

        <section class="card convo-card" aria-labelledby="convo-title">
          <div class="card-header row-between-wrap">
            <h2 class="section-label" id="convo-title">Percakapan &amp; Riwayat</h2>
            <div class="convo-filter row-gap-xs" role="group" aria-label="Filter riwayat">
              <button type="button" class="tab is-active" data-convo-filter="all" aria-pressed="true">Semua</button>
              <button type="button" class="tab" data-convo-filter="chat" aria-pressed="false">Percakapan</button>
              <button type="button" class="tab" data-convo-filter="event" aria-pressed="false">Perubahan status</button>
            </div>
          </div>
          <div class="card-body">${timeline(detail.timeline, now, 'agent')}</div>
        </section>

        ${isActive && canWork
          ? html`<div class="card composer-card">
              <div class="card-header row-between-wrap">
                <div class="row-gap-xs" data-tab-group="comment-mode" role="tablist" aria-label="Mode komentar">
                  <button type="button" role="tab" aria-selected="true" class="tab is-active" data-tab="public">
                    ${icon('message', 'icon-xs')} <span>Balas Requester (Publik)</span>
                  </button>
                  <button type="button" role="tab" aria-selected="false" class="tab tab-internal" data-tab="internal">
                    ${icon('lock', 'icon-xs')} <span>Catatan Internal (Staff Saja)</span>
                  </button>
                </div>
                <span class="text-muted text-xs">Publik mengirim notifikasi ke pemohon; internal hanya untuk staff</span>
              </div>
              <div class="card-body">
                <form
                  data-api-form
                  action="/api/tickets/${detail.id}/comments"
                  data-method="POST"
                  data-reload="true"
                  data-success-msg="Catatan berhasil disimpan"
                  class="stack"
                >
                  <input type="hidden" name="visibility" value="public" id="comment-visibility" />
                  <textarea
                    name="body"
                    rows="3"
                    class="textarea"
                    placeholder="Tulis balasan publik atau catatan investigasi internal..."
                    minlength="2"
                    required
                  ></textarea>
                  ${attachmentPicker('agent-reply-att')}
                  <div class="form-error" data-form-error role="alert" hidden></div>
                  <div class="row-between">
                    <span class="text-muted text-xs">
                      ${detail.firstResponseAt === null
                        ? 'Catatan: Balasan publik pertama akan menandai First Response tercapai.'
                        : ''}
                    </span>
                    <button type="submit" class="btn btn-primary btn-sm">
                      ${icon('send', 'icon-xs')} <span>Kirim Catatan</span>
                    </button>
                  </div>
                </form>
              </div>
            </div>`
          : null}
      </div>

      <aside class="detail-side stack">
        <div class="card">
          <div class="card-header row-between">
            <h2 class="section-label">Perjanjian SLA</h2>
            <span class="badge">${detail.policyName}</span>
          </div>
          <div class="card-body stack">
            ${slaCard('First Response', detail.response, cal, now)}
            <hr class="sep" />
            ${slaCard('Resolution', detail.resolution, cal, now)}
          </div>
        </div>

        <div class="card">
          <div class="card-header row-between">
            <h2 class="section-label">Klasifikasi &amp; Prioritas</h2>
            ${isActive && canOverride
              ? html`<button type="button" class="link-btn" data-open-dialog="dlg-override">
                  ${icon('shield', 'icon-xs')} <span>Override</span>
                </button>`
              : null}
          </div>
          <div class="card-body stack-sm text-xs">
            <div class="row-between">
              <span class="text-muted">Prioritas:</span>
              <div class="row-gap-xs">
                ${priorityBadge(detail.priority, true)}
                ${detail.priorityOverridden
                  ? html`<span class="badge badge-risk">Overridden</span>`
                  : null}
              </div>
            </div>
            <div class="row-between">
              <span class="text-muted">Dampak (Impact):</span>
              <strong>${LEVEL_LABELS[detail.impact] ?? detail.impact}</strong>
            </div>
            <div class="row-between">
              <span class="text-muted">Mendesak (Urgency):</span>
              <strong>${LEVEL_LABELS[detail.urgency] ?? detail.urgency}</strong>
            </div>
            ${isActive
              ? html`<button type="button" class="btn btn-ghost btn-sm w-full" data-open-dialog="dlg-classify">
                  ${icon('edit', 'icon-xs')} <span>Ubah Dampak / Urgensi</span>
                </button>`
              : null}
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <h2 class="section-label">Penugasan &amp; Tim</h2>
          </div>
          <div class="card-body stack-sm text-xs">
            <div class="row-between">
              <span class="text-muted">Tim Bertugas:</span>
              <strong>${detail.team?.name ?? '—'}</strong>
            </div>

            <hr class="sep" />

            ${canManageAssignment
              ? html`<form
                  data-api-form
                  action="/api/tickets/${detail.id}/assign"
                  data-method="POST"
                  data-reload="true"
                  data-success-msg="Penugasan tiket diperbarui"
                  class="stack-xs"
                >
                  <div class="row-between">
                    <label for="detail-assignee" class="text-muted">Assignee:</label>
                    <span class="text-accent">Mode Lead/Admin</span>
                  </div>
                  <div class="inline-save-form">
                    <select
                      id="detail-assignee"
                      name="assigneeId"
                      class="select select-sm"${flag('disabled', !isActive)}
                    >
                      <option value="">-- Belum Ditugaskan (Unassigned) --</option>
                      ${availableAssignees.map(
                        (a) => html`<option value="${a.id}"${flag('selected', detail.assignee?.id === a.id)}>
                          ${a.name} (${a.teamName}) · ${a.activeLoad} tiket
                        </option>`,
                      )}
                    </select>
                    <button type="submit" class="btn btn-secondary btn-sm"${flag('disabled', !isActive)}>Simpan</button>
                  </div>
                  <div class="form-error" data-form-error role="alert" hidden></div>
                </form>`
              : html`<div class="stack-sm">
                  <div class="row-between">
                    <span class="text-muted">Assignee:</span>
                    ${detail.assignee
                      ? html`<strong class="row-gap-xs">
                          ${icon('user', 'icon-xs text-muted')}
                          <span>${detail.assignee.name}</span>
                          ${isAssignedToMe ? html`<span class="badge badge-ok">Anda</span>` : null}
                        </strong>`
                      : html`<span class="text-muted italic">Belum Ditugaskan</span>`}
                  </div>
                  ${isActive
                    ? html`
                        ${isUnassigned && inTeam
                          ? html`<button
                              type="button"
                              class="btn btn-secondary btn-sm w-full"
                              data-api-btn
                              data-url="/api/tickets/${detail.id}/assign"
                              data-body="${JSON.stringify({ assigneeId: user.id })}"
                              data-reload="true"
                              data-success-msg="Tiket berhasil diambil untuk Anda"
                            >
                              ${icon('users', 'icon-xs')} <span>Ambil Tiket Ini (Assign to Me)</span>
                            </button>`
                          : null}
                        ${isUnassigned && !inTeam
                          ? html`<div class="notice-muted">
                              ${icon('lock', 'icon-xs')}
                              <span>Tiket berada di luar tim Anda (${detail.team?.name ?? '—'}).</span>
                            </div>`
                          : null}
                        ${isAssignedToMe
                          ? html`<button
                              type="button"
                              class="btn btn-secondary btn-sm w-full"
                              data-api-btn
                              data-url="/api/tickets/${detail.id}/assign"
                              data-body="${JSON.stringify({ assigneeId: null })}"
                              data-reload="true"
                              data-success-msg="Tiket dikembalikan ke queue"
                            >
                              ${icon('user', 'icon-xs')} <span>Lepas Tiket (Unassign)</span>
                            </button>`
                          : null}
                        ${!isUnassigned && !isAssignedToMe
                          ? html`<div class="notice-muted">
                              ${icon('lock', 'icon-xs')}
                              <span>Hanya Head IT / Admin yang dapat memindahkan tiket milik staf lain.</span>
                            </div>`
                          : null}
                      `
                    : null}
                </div>`}
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <h2 class="section-label">Informasi Pemohon</h2>
          </div>
          <div class="card-body stack-xs text-xs">
            <div class="row-gap-sm">
              ${icon('user', 'icon-sm text-muted')}
              <strong>${detail.requesterInfo.name}</strong>
            </div>
            <p class="text-muted">${detail.requesterInfo.email}</p>
            <hr class="sep" />
            <div class="row-between">
              <span class="text-muted">Departemen:</span>
              <strong>${detail.requesterInfo.department}</strong>
            </div>
            <div class="row-between">
              <span class="text-muted">Tiket Aktif:</span>
              <strong class="mono text-accent">${detail.requesterInfo.openTickets} tiket</strong>
            </div>
          </div>
        </div>

        ${detail.related.length > 0
          ? html`<div class="card">
              <div class="card-header">
                <h2 class="section-label">Tiket Terkait (Kategori Sama)</h2>
              </div>
              <div class="card-body stack-xs text-xs">
                ${detail.related.map(
                  (rel) => html`<a href="/tickets/${rel.number}" class="related-row">
                    <span class="mono text-accent font-bold">${rel.number}</span>
                    <span class="text-muted truncate-cell">${rel.title}</span>
                    ${statusPill(rel.status, 'agent')}
                  </a>`,
                )}
              </div>
            </div>`
          : null}
      </aside>
    </div>

    ${agentTicketModals(detail)}
  </div>`;
}

// Satu Tim IT: dialog "Eskalasi / Pindah Tim" dihapus; parameter kedua tetap opsional untuk kompatibilitas pemanggil.
function agentTicketModals(detail: TicketDetail): HtmlContent {
  return html`
    <dialog id="dlg-pending" class="modal">
      <div class="modal-box">
        <div class="modal-head">
          <h3 class="modal-title">Jeda Penghitungan SLA (Pending)</h3>
          <p class="modal-desc">Pilih alasan penundaan. Penghitungan SLA resolution akan otomatis dijeda.</p>
        </div>
        <form
          data-api-form
          action="/api/tickets/${detail.id}/transition"
          data-method="POST"
          data-reload="true"
          data-success-msg="Status tiket diubah menjadi Pending"
          class="stack"
        >
          <input type="hidden" name="to" value="pending" />
          <div class="field">
            <label for="pending-reason" class="label">Alasan Penundaan <span class="req">*</span></label>
            <select id="pending-reason" name="pendingReason" class="select" required>
              <option value="awaiting_user">Menunggu Jawaban / Konfirmasi User</option>
              <option value="awaiting_vendor">Menunggu Dukungan Pihak Ketiga / Vendor</option>
              <option value="awaiting_change">Menunggu Rilis Perubahan (Change Request)</option>
              <option value="scheduled">Terjadwal untuk Dikerjakan Nanti</option>
            </select>
          </div>
          <div class="form-error" data-form-error role="alert" hidden></div>
          <div class="modal-foot">
            <button type="button" class="btn btn-secondary btn-sm" data-close-dialog>Batal</button>
            <button type="submit" class="btn btn-primary btn-sm">Terapkan Status Pending</button>
          </div>
        </form>
      </div>
    </dialog>

    <dialog id="dlg-resolve" class="modal">
      <div class="modal-box">
        <div class="modal-head">
          <h3 class="modal-title">Selesaikan Tiket (Resolve)</h3>
          <p class="modal-desc">Catat kode resolusi dan penjelasan teknis solusi untuk pemohon.</p>
        </div>
        <form
          data-api-form
          action="/api/tickets/${detail.id}/transition"
          data-method="POST"
          data-reload="true"
          data-success-msg="Tiket berhasil diselesaikan (Resolved)"
          class="stack"
        >
          <input type="hidden" name="to" value="resolved" />
          <div class="field">
            <label for="res-code" class="label">Kode Resolusi <span class="req">*</span></label>
            <select id="res-code" name="resolutionCode" class="select" required>
              <option value="fixed">Fixed (Masalah Terselesaikan Tuntas)</option>
              <option value="workaround">Workaround (Solusi Sementara Diterapkan)</option>
              <option value="user_error">User Error (Panduan Diberikan ke Pemohon)</option>
              <option value="fulfilled">Fulfilled (Permintaan Layanan Dipenuhi)</option>
              <option value="duplicate">Duplicate (Duplikasi Tiket Lain)</option>
              <option value="no_fault_found">No Fault Found (Tidak Ditemukan Masalah)</option>
            </select>
          </div>
          <div class="field">
            <label for="res-notes" class="label">Catatan Solusi / Penyelesaian <span class="req">*</span></label>
            <textarea
              id="res-notes"
              name="resolutionNotes"
              rows="3"
              class="textarea"
              placeholder="Jelaskan tindakan yang dilakukan untuk menyelesaikan kendala ini..."
              minlength="5"
              required
            ></textarea>
          </div>
          <div class="form-error" data-form-error role="alert" hidden></div>
          <div class="modal-foot">
            <button type="button" class="btn btn-secondary btn-sm" data-close-dialog>Batal</button>
            <button type="submit" class="btn btn-success btn-sm">Simpan &amp; Resolve Tiket</button>
          </div>
        </form>
      </div>
    </dialog>

    <dialog id="dlg-cancel" class="modal">
      <div class="modal-box">
        <div class="modal-head">
          <h3 class="modal-title">Batalkan Tiket</h3>
          <p class="modal-desc">Alasan pembatalan wajib dicatat dalam audit trail sistem.</p>
        </div>
        <form
          data-api-form
          action="/api/tickets/${detail.id}/transition"
          data-method="POST"
          data-reload="true"
          data-success-msg="Tiket berhasil dibatalkan"
          class="stack"
        >
          <input type="hidden" name="to" value="cancelled" />
          <div class="field">
            <label for="cancel-reason" class="label">Alasan Pembatalan <span class="req">*</span></label>
            <textarea
              id="cancel-reason"
              name="cancellationReason"
              rows="3"
              class="textarea"
              placeholder="Mengapa tiket ini dibatalkan?..."
              minlength="5"
              required
            ></textarea>
          </div>
          <div class="form-error" data-form-error role="alert" hidden></div>
          <div class="modal-foot">
            <button type="button" class="btn btn-secondary btn-sm" data-close-dialog>Kembali</button>
            <button type="submit" class="btn btn-danger btn-sm">Konfirmasi Batalkan</button>
          </div>
        </form>
      </div>
    </dialog>

    <dialog id="dlg-override" class="modal">
      <div class="modal-box">
        <div class="modal-head">
          <h3 class="modal-title">Override Prioritas ITIL</h3>
          <p class="modal-desc">
            Khusus Head IT / Admin. Perubahan akan menghitung ulang (rebaseline) batas waktu SLA tiket.
          </p>
        </div>
        <form
          data-api-form
          action="/api/tickets/${detail.id}/priority"
          data-method="POST"
          data-reload="true"
          data-success-msg="Prioritas berhasil di-override & SLA dihitung ulang"
          class="stack"
        >
          <div class="field">
            <label for="override-prio" class="label">Prioritas Baru <span class="req">*</span></label>
            <select id="override-prio" name="priority" class="select" required>
              <option value="P1"${flag('selected', detail.priority === 'P1')}>P1 — Critical (24x7, Response 15m, Res 4j)</option>
              <option value="P2"${flag('selected', detail.priority === 'P2')}>P2 — High (Jam kerja, Response 30m, Res 8j)</option>
              <option value="P3"${flag('selected', detail.priority === 'P3')}>P3 — Medium (Jam kerja, Response 4j, Res 3 hari)</option>
              <option value="P4"${flag('selected', detail.priority === 'P4')}>P4 — Low (Jam kerja, Response 8j, Res 5 hari)</option>
            </select>
          </div>
          <div class="field">
            <label for="override-reason" class="label">Alasan Override (Wajib Minimal 10 Karakter) <span class="req">*</span></label>
            <textarea
              id="override-reason"
              name="reason"
              rows="3"
              class="textarea"
              placeholder="Contoh: Dampak meluas ke server database produksi cabang..."
              minlength="10"
              required
            ></textarea>
            <span class="field-hint">Catatan ini dicatat permanen dalam audit trail tiket_events.</span>
          </div>
          <div class="form-error" data-form-error role="alert" hidden></div>
          <div class="modal-foot">
            <button type="button" class="btn btn-secondary btn-sm" data-close-dialog>Batal</button>
            <button type="submit" class="btn btn-primary btn-sm">Override &amp; Rebaseline SLA</button>
          </div>
        </form>
      </div>
    </dialog>

    <dialog id="dlg-classify" class="modal">
      <div class="modal-box">
        <div class="modal-head">
          <h3 class="modal-title">Ubah Klasifikasi Dampak &amp; Urgensi</h3>
          <p class="modal-desc">Prioritas akan dihitung ulang secara otomatis berdasarkan matriks ITIL.</p>
        </div>
        <form
          data-api-form
          action="/api/tickets/${detail.id}/classification"
          data-method="POST"
          data-reload="true"
          data-success-msg="Klasifikasi dampak & urgensi berhasil diperbarui"
          class="stack"
        >
          <div class="field">
            <label for="impact-select" class="label">Dampak (Impact) <span class="req">*</span></label>
            <select id="impact-select" name="impact" class="select" required>
              <option value="high"${flag('selected', detail.impact === 'high')}>High (Seluruh organisasi / layanan kritis / &gt;50 user)</option>
              <option value="medium"${flag('selected', detail.impact === 'medium')}>Medium (Satu departemen / 5–50 user)</option>
              <option value="low"${flag('selected', detail.impact === 'low')}>Low (Satu user saja)</option>
            </select>
          </div>
          <div class="field">
            <label for="urgency-select" class="label">Urgensi (Urgency) <span class="req">*</span></label>
            <select id="urgency-select" name="urgency" class="select" required>
              <option value="high"${flag('selected', detail.urgency === 'high')}>High (Pekerjaan berhenti total)</option>
              <option value="medium"${flag('selected', detail.urgency === 'medium')}>Medium (Bisa bekerja tapi terhambat)</option>
              <option value="low"${flag('selected', detail.urgency === 'low')}>Low (Tidak mendesak)</option>
            </select>
          </div>
          <div id="classify-preview" class="matrix-preview">
            <span>Prioritas hasil matriks:</span>
            <strong id="classify-preview-badge" class="badge badge-${detail.priority.toLowerCase()}">${detail.priority}</strong>
          </div>
          <table class="matrix-mini" aria-label="Referensi matriks prioritas ITIL">
            <thead>
              <tr>
                <th>Impact \ Urgency</th>
                <th>High</th>
                <th>Medium</th>
                <th>Low</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th>High</th>
                <td><span class="badge badge-p1">P1</span></td>
                <td><span class="badge badge-p2">P2</span></td>
                <td><span class="badge badge-p3">P3</span></td>
              </tr>
              <tr>
                <th>Medium</th>
                <td><span class="badge badge-p2">P2</span></td>
                <td><span class="badge badge-p3">P3</span></td>
                <td><span class="badge badge-p4">P4</span></td>
              </tr>
              <tr>
                <th>Low</th>
                <td><span class="badge badge-p3">P3</span></td>
                <td><span class="badge badge-p4">P4</span></td>
                <td><span class="badge badge-p4">P4</span></td>
              </tr>
            </tbody>
          </table>
          <div class="form-error" data-form-error role="alert" hidden></div>
          <div class="modal-foot">
            <button type="button" class="btn btn-secondary btn-sm" data-close-dialog>Batal</button>
            <button type="submit" class="btn btn-primary btn-sm">Perbarui Klasifikasi</button>
          </div>
        </form>
      </div>
    </dialog>
  `;
}

// ---------------------------------------------------------------------------
// Dashboard Page
// ---------------------------------------------------------------------------

export function dashboardPage(data: DashboardData): HtmlContent {
  const { kpis } = data;
  const respStatus = kpis.responseSlaPercent >= 95 ? 'ok' : kpis.responseSlaPercent >= 85 ? 'risk' : 'breach';
  const resStatus = kpis.resolutionSlaPercent >= 95 ? 'ok' : kpis.resolutionSlaPercent >= 85 ? 'risk' : 'breach';

  return html`<div class="page-pad stack-md">
    <div class="row-between-wrap">
      <div>
        <h1 class="page-h1">Dashboard Metrik ITSM</h1>
        <p class="text-muted text-xs">
          Laporan operasional SLA, volume insiden, efektivitas penanganan, dan kepuasan pengguna.
        </p>
      </div>

      <div class="range-pills">
        ${([7, 30, 90] as const).map(
          (d) => html`<a href="/dashboard?range=${d}" class="range-pill${data.rangeDays === d ? ' is-active' : ''}">
            ${d} Hari
          </a>`,
        )}
      </div>
    </div>

    <div class="grid-kpi">
      ${kpiTile({
        title: 'Response SLA',
        value: `${kpis.responseSlaPercent}%`,
        subtitle: 'Target ≥ 95%',
        status: respStatus,
        href: '/queue?view=team',
      })}
      ${kpiTile({
        title: 'Resolution SLA',
        value: `${kpis.resolutionSlaPercent}%`,
        subtitle: 'Target ≥ 95%',
        status: resStatus,
        href: '/queue?view=team',
      })}
      ${kpiTile({
        title: 'MTTA (Jam Kerja)',
        value: formatDuration(kpis.mttaMinutes),
        subtitle: 'Rata-rata respons awal',
        status: 'neutral',
        href: '/queue?view=team',
      })}
      ${kpiTile({
        title: 'MTTR (Jam Kerja)',
        value: formatDuration(kpis.mttrMinutes),
        subtitle: 'Rata-rata waktu solusi',
        status: 'neutral',
        href: '/queue?view=team',
      })}
      ${kpiTile({
        title: 'Backlog Aktif',
        value: kpis.activeBacklog,
        subtitle: 'Tiket belum selesai',
        status: 'neutral',
        href: '/queue?view=team',
      })}
      ${kpiTile({
        title: 'CSAT Rata-rata',
        value: `★ ${kpis.csatAverage}`,
        subtitle: `${kpis.csatResponseCount} responden`,
        status: 'ok',
        href: '/queue?view=team',
      })}
    </div>

    ${volumeChart(data.volume, data.rangeDays)}

    <div class="grid-2">
      ${slaPriorityChart(data.slaByPriority)}
      ${agingChart(data.aging)}
    </div>

    <div class="grid-3">
      ${topCategoriesCard(data.topCategories)}
      ${agentPerformanceCard(data.agentPerformance)}
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Admin Page (6 Tabs)
// ---------------------------------------------------------------------------

const ADMIN_ROLE_LABELS: Readonly<Record<string, string>> = {
  requester: 'Requester',
  agent: 'Anggota IT',
  lead: 'Head IT',
  admin: 'Admin',
};
const CATALOG_ICONS: readonly IconName[] = ['laptop', 'folder', 'wrench', 'mail', 'printer', 'wifi', 'database', 'barChart'];
const ADMIN_TABS: ReadonlyArray<{ id: string; label: string; icon: IconName }> = [
  { id: 'users', label: 'Pengguna', icon: 'users' },
  { id: 'teams', label: 'Tim IT', icon: 'shield' },
  { id: 'sla', label: 'SLA Policy', icon: 'clock' },
  { id: 'catalog', label: 'Katalog Layanan', icon: 'wrench' },
  { id: 'categories', label: 'Kategori', icon: 'folder' },
  { id: 'system', label: 'Sistem & Worker', icon: 'settings' },
];
const TICKET_TYPE_LABELS: Readonly<Record<string, string>> = { incident: 'Incident', service_request: 'Service Request' };

/** Kelola hari libur (tab SLA Policy): daftar per tahun, tambah, ubah nama, hapus, impor massal. */
function holidayManager(data: AdminData): HtmlContent {
  const thisYear = Number(localDateKey(systemClock()).slice(0, 4));
  const byYear = new Map<string, AdminData['holidays']>();
  for (const h of [...data.holidays].sort((a, b) => a.date.localeCompare(b.date))) {
    const y = h.date.slice(0, 4);
    byYear.set(y, [...(byYear.get(y) ?? []), h]);
  }
  const missing = [thisYear, thisYear + 1].filter((y) => !byYear.has(String(y)));
  return html`<div class="card">
    <div class="card-header">
      <h2 class="card-title">Kalender Bisnis dan Hari Libur</h2>
      <p class="card-desc">Jam kerja (tetap): Senin-Jumat 08:00-12:00 dan 13:00-17:00 WIB; istirahat 12:00-13:00. 1 hari kerja = 8 jam kerja. Hari libur di bawah tidak dihitung dalam SLA jam kerja.</p>
    </div>
    <div class="card-body stack-md">
      ${missing.map(
        (y) => html`<div class="callout-warn" role="alert"><strong>Belum ada hari libur ${y}</strong> &mdash; SLA akan menghitung tanggal merah sebagai hari kerja. Tambahkan lewat form atau impor di bawah.</div>`,
      )}

      <form class="holiday-add" method="post" action="/api/admin/holidays" data-api-form data-reload="true" data-success-msg="Hari libur ditambahkan">
        <div class="field">
          <label for="hol-date" class="label">Tanggal</label>
          <input id="hol-date" name="date" type="date" class="input input-sm" required />
        </div>
        <div class="field">
          <label for="hol-name" class="label">Nama</label>
          <input id="hol-name" name="name" type="text" class="input input-sm" minlength="2" maxlength="80" required />
        </div>
        <div class="field">
          <label for="hol-type" class="label">Jenis</label>
          <select id="hol-type" name="type" class="input input-sm">
            <option value="libur_nasional">Libur nasional</option>
            <option value="cuti_bersama">Cuti bersama</option>
          </select>
        </div>
        <button type="submit" class="btn btn-primary btn-sm">Tambah</button>
        <div class="form-error" data-form-error role="alert" hidden></div>
      </form>

      <details class="holiday-import">
        <summary class="text-xs font-bold">Impor massal (tempel daftar)</summary>
        <div class="stack-sm" data-holiday-import>
          <label for="hol-import-text" class="label">Satu baris per hari libur: <span class="mono">YYYY-MM-DD Nama</span></label>
          <textarea id="hol-import-text" class="input mono" rows="6" data-holiday-import-text placeholder="2027-01-01 Tahun Baru Masehi"></textarea>
          <div class="holiday-preview" data-holiday-preview aria-live="polite"></div>
          <div class="form-error" data-form-error role="alert" hidden></div>
          <div class="row-between">
            <button type="button" class="btn btn-ghost btn-sm" data-holiday-preview-btn>Pratinjau</button>
            <button type="button" class="btn btn-primary btn-sm" data-holiday-import-save disabled>Simpan Impor</button>
          </div>
        </div>
      </details>

      ${data.holidays.length === 0 ? html`<p class="text-xs text-muted">Belum ada hari libur terdaftar.</p>` : null}
      ${[...byYear.entries()].map(
        ([year, list]) => html`<section class="stack-sm" aria-labelledby="hol-year-${year}">
          <h3 class="text-sm font-bold" id="hol-year-${year}">${year} <span class="text-muted text-xs">(${list.length} hari)</span></h3>
          <ul class="holiday-list">
            ${list.map(
              (h) => html`<li class="holiday-row">
                <span class="mono text-accent font-bold">${h.date}</span>
                <span class="badge ${holidayTypeOf(h.name) === 'cuti_bersama' ? 'badge-muted' : 'badge-risk'}">${holidayTypeOf(h.name) === 'cuti_bersama' ? 'Cuti bersama' : 'Libur nasional'}</span>
                <form class="holiday-edit" method="patch" action="/api/admin/holidays/${h.id}" data-api-form data-reload="true" data-success-msg="Nama diperbarui">
                  <label class="sr-only" for="hol-edit-${h.id}">Nama libur ${h.date}</label>
                  <input id="hol-edit-${h.id}" name="name" type="text" class="input input-sm" value="${h.name}" minlength="2" maxlength="80" required />
                  <button type="submit" class="btn btn-ghost btn-sm">Simpan</button>
                  <div class="form-error" data-form-error role="alert" hidden></div>
                </form>
                <button type="button" class="btn btn-ghost btn-sm text-danger" data-holiday-delete="${h.id}">Hapus</button>
              </li>`,
            )}
          </ul>
        </section>`,
      )}
    </div>
  </div>`;
}

export function adminPage(data: AdminData): HtmlContent {
  const activeUsers = data.users.filter((u) => u.isActive).length;
  const activeCatalog = data.catalog.filter((c) => c.isActive).length;
  const counts: Record<string, number> = {
    users: data.users.length,
    sla: data.policies.length,
    catalog: data.catalog.length,
    categories: data.categories.length,
  };
  const calendarOf = (id: string) => data.calendars.find((c) => c.id === id);
  // Organisasi hanya punya satu Tim IT (Head IT + anggota).
  const team = data.teams[0];
  const itStaff = data.users.filter((u) => u.role === 'agent' || u.role === 'lead');

  return html`<div class="page-pad narrow-wide stack-md admin-v2">
    <div>
      <h1 class="page-h1">Administrasi &amp; Pengaturan Sistem</h1>
      <p class="text-muted text-xs">
        Kelola pengguna, tim, kebijakan SLA, katalog layanan IT CTII, dan pantau worker sistem.
      </p>
    </div>

    <div class="grid-kpi">
      ${kpiTile({ title: 'Pengguna Aktif', value: `${activeUsers}/${data.users.length}`, subtitle: 'Akun dapat login', href: '#users' })}
      ${kpiTile({ title: 'Tim IT', value: (team?.memberIds.length ?? 0) + (team?.leadId ? 1 : 0), subtitle: `Head IT + anggota · auto-assign ${team?.autoAssign ? 'on' : 'off'}`, href: '#teams' })}
      ${kpiTile({ title: 'SLA Policy', value: data.policies.length, subtitle: `${data.calendars.length} kalender`, href: '#sla' })}
      ${kpiTile({ title: 'Katalog Layanan', value: `${activeCatalog}/${data.catalog.length}`, subtitle: 'Layanan aktif di portal', href: '#catalog' })}
      ${kpiTile({ title: 'SLA Berjalan', value: data.stats.slaRunning, subtitle: 'Tiket terbuka', status: 'ok', href: '#system' })}
      ${kpiTile({
        title: 'SLA Breach',
        value: data.stats.slaBreached,
        subtitle: 'Tiket terbuka melewati target',
        status: data.stats.slaBreached > 0 ? 'breach' : 'ok',
        href: '/queue?view=all',
      })}
    </div>

    <div>
      <div class="tab-bar admin-tabs" data-tab-group="admin" data-tab-hash role="tablist" aria-label="Bagian pengaturan admin">
        ${ADMIN_TABS.map(
          (t, i) => html`<button
            type="button"
            role="tab"
            id="admin-tab-${t.id}"
            aria-controls="admin-panel-${t.id}"
            aria-selected="${i === 0 ? 'true' : 'false'}"
            tabindex="${i === 0 ? '0' : '-1'}"
            class="tab${i === 0 ? ' is-active' : ''}"
            data-tab="${t.id}"
          >
            ${icon(t.icon, 'icon-xs')} <span>${t.label}</span>
            ${counts[t.id] !== undefined ? html`<span class="tab-count">${counts[t.id]}</span>` : null}
          </button>`,
        )}
      </div>

      <div data-tab-panel="users" role="tabpanel" id="admin-panel-users" aria-labelledby="admin-tab-users" tabindex="0" class="admin-panel">
        <div class="card">
          <div class="card-header">
            <h2 class="card-title">Daftar Pengguna</h2>
            <p class="card-desc">Ubah role dan status aktif akun. Akun nonaktif tidak dapat login.</p>
          </div>
          <div class="toolbar">
            <div class="toolbar-filters">
              <div class="search-wrap">
                ${icon('search', 'icon-sm search-icon')}
                <label for="admin-user-search" class="sr-only">Cari pengguna</label>
                <input id="admin-user-search" type="search" class="input input-sm input-search" placeholder="Cari nama, email, departemen..." data-admin-user-filter />
              </div>
              <label for="admin-user-role" class="sr-only">Filter role</label>
              <select id="admin-user-role" class="select select-sm" data-admin-user-filter>
                <option value="">Semua role</option>
                ${Object.entries(ADMIN_ROLE_LABELS).map(([v, l]) => html`<option value="${v}">${l}</option>`)}
              </select>
              <label for="admin-user-status" class="sr-only">Filter status</label>
              <select id="admin-user-status" class="select select-sm" data-admin-user-filter>
                <option value="">Semua status</option>
                <option value="active">Aktif</option>
                <option value="inactive">Nonaktif</option>
              </select>
            </div>
            <span class="text-muted text-xs" id="admin-user-count" aria-live="polite">${data.users.length} pengguna</span>
          </div>
          <div class="table-scroll max-h-lg admin-table-wrap">
            <table class="table admin-table">
              <thead>
                <tr>
                  <th scope="col">Pengguna</th>
                  <th scope="col">Departemen</th>
                  <th scope="col">Role</th>
                  <th scope="col" class="text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                ${data.users.map(
                  (u) => html`<tr data-user-row data-search="${`${u.name} ${u.email} ${u.department}`.toLowerCase()}" data-role="${u.role}" data-active="${u.isActive ? 'active' : 'inactive'}">
                    <td>
                      <div class="stack-xs">
                        <strong>${u.name}</strong>
                        <span class="mono text-muted text-xs">${u.email}</span>
                      </div>
                    </td>
                    <td class="text-muted">${u.department}</td>
                    <td>
                      <form
                        data-api-form
                        action="/api/admin/users/${u.id}/role"
                        data-method="POST"
                        data-reload="true"
                        data-success-msg="Role pengguna diperbarui"
                        class="stack-xs"
                      >
                        <div class="inline-save-form">
                          <span class="badge admin-role admin-role-${u.role}">${ADMIN_ROLE_LABELS[u.role] ?? u.role}</span>
                          <select name="role" class="select select-sm" aria-label="Ubah role ${u.name}">
                            ${Object.entries(ADMIN_ROLE_LABELS).map(
                              ([v, l]) => html`<option value="${v}"${flag('selected', u.role === v)}>${l}</option>`,
                            )}
                          </select>
                          <button type="submit" class="btn btn-secondary btn-sm">Simpan</button>
                        </div>
                        <div class="form-error" data-form-error role="alert" hidden></div>
                      </form>
                    </td>
                    <td class="text-center">
                      <button
                        type="button"
                        class="admin-toggle"
                        aria-pressed="${u.isActive ? 'true' : 'false'}"
                        aria-label="${u.isActive ? 'Nonaktifkan' : 'Aktifkan'} akun ${u.name}"
                        data-api-btn
                        data-confirm="${u.isActive ? `Nonaktifkan akun ${u.name}? Pengguna tidak akan bisa login.` : `Aktifkan kembali akun ${u.name}?`}"
                        data-url="/api/admin/users/${u.id}/toggle"
                        data-reload="true"
                        data-success-msg="Status pengguna diperbarui"
                      >
                        <span class="admin-toggle-dot" aria-hidden="true"></span>
                        <span>${u.isActive ? 'Aktif' : 'Nonaktif'}</span>
                      </button>
                    </td>
                  </tr>`,
                )}
                <tr data-user-empty${flag('hidden', data.users.length > 0)}>
                  <td colspan="4" class="text-center text-muted admin-empty">Tidak ada pengguna yang cocok dengan filter.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div data-tab-panel="teams" role="tabpanel" id="admin-panel-teams" aria-labelledby="admin-tab-teams" tabindex="0" class="admin-panel" hidden>
        ${!team
          ? emptyState('Belum ada Tim IT', 'Tim IT akan tampil di sini.', undefined, 'shield')
          : html`<div class="card">
              <div class="card-header">
                <div class="row-between">
                  <h2 class="card-title">${team.name}</h2>
                  <button
                    type="button"
                    class="admin-toggle"
                    aria-pressed="${team.autoAssign ? 'true' : 'false'}"
                    aria-label="Auto-assign ${team.name}: ${team.autoAssign ? 'aktif' : 'nonaktif'}"
                    data-api-btn
                    data-confirm="${team.autoAssign ? 'Matikan' : 'Aktifkan'} auto-assign untuk ${team.name}?"
                    data-url="/api/admin/teams/${team.id}/auto-assign"
                    data-reload="true"
                    data-success-msg="Status auto-assign tim diperbarui"
                  >
                    <span class="admin-toggle-dot" aria-hidden="true"></span>
                    <span>${team.autoAssign ? 'Auto-Assign On' : 'Auto-Assign Off'}</span>
                  </button>
                </div>
                <p class="card-desc">
                  ${team.description} Auto-assign off: Head IT yang membagi tiket ke anggota.
                </p>
              </div>
              <form
                data-api-form
                action="/api/admin/teams"
                data-method="POST"
                data-reload="true"
                data-success-msg="Tim IT diperbarui"
                class="card-body stack-sm"
              >
                <input type="hidden" name="id" value="${team.id}" />
                <input type="hidden" name="name" value="${team.name}" />
                <input type="checkbox" name="autoAssign" hidden${flag('checked', team.autoAssign)} />
                <div class="field">
                  <label for="team-lead" class="label">Head IT <span class="req">*</span></label>
                  <select id="team-lead" name="leadId" class="select select-sm" required>
                    ${itStaff.map(
                      (u) => html`<option value="${u.id}"${flag('selected', u.id === team.leadId)}>${u.name} · ${ADMIN_ROLE_LABELS[u.role] ?? u.role}</option>`,
                    )}
                  </select>
                </div>
                <fieldset class="field">
                  <legend class="label">Anggota Tim IT (${team.memberIds.length})</legend>
                  ${itStaff.map(
                    (u) => html`<label class="row-gap-sm text-xs">
                      <input type="checkbox" name="memberIds" value="${u.id}"${flag('checked', team.memberIds.includes(u.id))} />
                      <span>${u.name}</span>
                      <span class="badge admin-role admin-role-${u.role}">${ADMIN_ROLE_LABELS[u.role] ?? u.role}</span>
                    </label>`,
                  )}
                  <span class="field-hint">Head IT otomatis dikeluarkan dari daftar anggota. Atur role (Head IT / Anggota IT) di tab Pengguna.</span>
                </fieldset>
                <div class="form-error" data-form-error role="alert" hidden></div>
                <div class="modal-foot">
                  <button type="submit" class="btn btn-primary btn-sm">Simpan Tim IT</button>
                </div>
              </form>
            </div>`}
      </div>

      <div data-tab-panel="sla" role="tabpanel" id="admin-panel-sla" aria-labelledby="admin-tab-sla" tabindex="0" class="admin-panel" hidden>
        <div class="stack-md">
          ${data.policies.length === 0 ? emptyState('Belum ada SLA policy', 'Kebijakan SLA akan tampil di sini.', undefined, 'clock') : null}
          <div class="grid-2">
            ${data.policies.map((pol) => {
              const usedBy = data.catalog.filter(
                (c) => c.slaPolicyId === pol.id || (!c.slaPolicyId && pol.isDefault && c.ticketType === pol.ticketType),
              );
              return html`<div class="card">
                <div class="card-header">
                  <div class="row-between">
                    <h2 class="card-title">${pol.name}</h2>
                    <span class="badge ${pol.ticketType === 'incident' ? 'badge-incident' : 'badge-request'}">${TICKET_TYPE_LABELS[pol.ticketType] ?? pol.ticketType}</span>
                  </div>
                  <p class="card-desc">
                    ${pol.isDefault ? 'Kebijakan standar' : 'Kebijakan khusus'} · versi ${pol.version} · diperbarui ${formatDateTime(pol.updatedAt)}
                  </p>
                </div>
                <div class="card-body stack-sm">
                  <form class="stack-sm" data-sla-form data-policy-id="${pol.id}" data-success-msg="Target SLA disimpan">
                    <div class="table-wrap">
                      <table class="table admin-sla-matrix">
                        <thead>
                          <tr>
                            <th scope="col">Prioritas</th>
                            <th scope="col">Respons</th>
                            <th scope="col">Resolusi</th>
                            <th scope="col">Kalender</th>
                          </tr>
                        </thead>
                        <tbody>
                          ${(['P1', 'P2', 'P3', 'P4'] as const).map((p) => {
                            const tgt = pol.targets.find((t) => t.priority === p);
                            if (!tgt) {
                              return html`<tr class="text-muted">
                                <th scope="row">${priorityBadge(p)}</th>
                                <td colspan="3">Tidak berlaku untuk tipe ini</td>
                              </tr>`;
                            }
                            const kind = calendarOf(tgt.calendarId)?.kind ?? 'business_hours';
                            const slaField = (key: 'response' | 'resolution', label: string, mins: number) => {
                              const inHours = mins % 60 === 0;
                              const id = `sla-${pol.id}-${p}-${key}`;
                              return html`<div class="sla-field">
                                <label class="sr-only" for="${id}">${label} ${p} (nilai)</label>
                                <input id="${id}" class="input input-sm" type="number" min="1" step="1" required data-sla-value="${key}" value="${inHours ? mins / 60 : mins}" />
                                <label class="sr-only" for="${id}-unit">${label} ${p} (satuan)</label>
                                <select id="${id}-unit" class="input input-sm" data-sla-unit="${key}">
                                  <option value="1"${flag('selected', !inHours)}>menit</option>
                                  <option value="60"${flag('selected', inHours)}>jam</option>
                                </select>
                                <span class="text-xs text-muted sla-preview" data-sla-preview="${key}">${formatSlaTarget(mins, kind)}</span>
                              </div>`;
                            };
                            return html`<tr data-sla-row="${p}">
                              <th scope="row">${priorityBadge(p)}</th>
                              <td>${slaField('response', 'Respons', tgt.responseMinutes)}</td>
                              <td>${slaField('resolution', 'Resolusi', tgt.resolutionMinutes)}</td>
                              <td>
                                <label class="sr-only" for="sla-${pol.id}-${p}-cal">Kalender ${p}</label>
                                <select id="sla-${pol.id}-${p}-cal" class="input input-sm" data-sla-cal>
                                  ${data.calendars.map((cal) => html`<option value="${cal.id}" data-kind="${cal.kind}"${flag('selected', cal.id === tgt.calendarId)}>${cal.name}</option>`)}
                                </select>
                              </td>
                            </tr>`;
                          })}
                        </tbody>
                      </table>
                    </div>
                    <p class="text-xs text-muted">Target baru berlaku untuk tiket <strong>baru</strong>. Tiket yang sudah punya SLA tetap memakai target lamanya. Respons harus lebih kecil dari resolusi (maks. 30 hari).</p>
                    <div class="form-error" data-form-error role="alert" hidden></div>
                    <div class="row-between">
                      <span class="text-xs text-muted">Hanya admin yang dapat mengubah</span>
                      <button type="submit" class="btn btn-primary btn-sm">Simpan Target</button>
                    </div>
                  </form>
                  <p class="text-xs text-muted">
                    <strong>Dipakai oleh:</strong>
                    ${usedBy.length ? usedBy.map((c) => c.name).join(', ') : 'Belum ada item katalog'}
                  </p>
                </div>
              </div>`;
            })}
          </div>

          ${holidayManager(data)}
        </div>
      </div>

      <div data-tab-panel="catalog" role="tabpanel" id="admin-panel-catalog" aria-labelledby="admin-tab-catalog" tabindex="0" class="admin-panel" hidden>
        <div class="card">
          <div class="card-header">
            <h2 class="card-title">Katalog Layanan IT CTII</h2>
            <p class="card-desc">Layanan yang dapat diajukan pengguna melalui form IT CTII Internal Service Request.</p>
          </div>
          ${data.catalog.length === 0
            ? html`<div class="card-body text-muted text-xs">Belum ada item katalog.</div>`
            : html`<div class="table-wrap admin-table-wrap">
                <table class="table admin-table">
                  <thead>
                    <tr>
                      <th scope="col">Layanan</th>
                      <th scope="col">Tipe Tiket</th>
                      <th scope="col">Dampak Default</th>
                      <th scope="col">Field</th>
                      <th scope="col" class="text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${data.catalog.map((item) => {
                      const cat = data.categories.find((c) => c.id === item.categoryId);
                      const ic: IconName = (CATALOG_ICONS as readonly string[]).includes(item.icon) ? (item.icon as IconName) : 'help';
                      return html`<tr>
                        <td>
                          <div class="admin-service">
                            <span class="admin-service-icon">${icon(ic, 'icon-sm')}</span>
                            <div class="stack-xs">
                              <strong>${item.name}</strong>
                              <span class="text-muted text-xs">Kategori: ${cat?.name ?? '—'}</span>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span class="badge ${item.ticketType === 'incident' ? 'badge-incident' : 'badge-request'}">
                            ${TICKET_TYPE_LABELS[item.ticketType] ?? item.ticketType}
                          </span>
                        </td>
                        <td>${LEVEL_LABELS[item.defaultImpact] ?? item.defaultImpact}</td>
                        <td class="tabular">${item.formSchema.length}</td>
                        <td class="text-center">
                          <span class="badge ${item.isActive ? 'badge-ok' : 'badge-muted'}">${item.isActive ? 'Aktif' : 'Nonaktif'}</span>
                        </td>
                      </tr>`;
                    })}
                  </tbody>
                </table>
              </div>`}
        </div>
      </div>

      <div data-tab-panel="categories" role="tabpanel" id="admin-panel-categories" aria-labelledby="admin-tab-categories" tabindex="0" class="admin-panel" hidden>
        <div class="card">
          <div class="card-header">
            <h2 class="card-title">Kategori Layanan &amp; Masalah</h2>
            <p class="card-desc">Struktur klasifikasi tiket dan routing otomatis ke Tim IT.</p>
          </div>
          <div class="card-body">
            ${data.categories.length === 0 ? html`<p class="text-muted text-xs">Belum ada kategori.</p>` : null}
            <div class="list-card">
              ${data.categories.map((cat) => {
                const parent = data.categories.find((c) => c.id === cat.parentId);
                return html`<div class="list-row">
                  <div class="row-gap-sm">
                    ${icon('folder', 'icon-sm text-accent')}
                    <strong>${cat.name}</strong>
                    ${parent
                      ? html`<span class="text-muted text-xs">(Induk: ${parent.name})</span>`
                      : html`<span class="badge badge-accent">Kategori Utama</span>`}
                  </div>
                </div>`;
              })}
            </div>
          </div>
        </div>
      </div>

      <div data-tab-panel="system" role="tabpanel" id="admin-panel-system" aria-labelledby="admin-tab-system" tabindex="0" class="admin-panel" hidden>
        <div class="stack-md">
          <div class="grid-4">
            ${kpiTile({ title: 'Total Tiket', value: data.stats.totalTickets })}
            ${kpiTile({ title: 'Audit Events', value: data.stats.totalEvents })}
            ${kpiTile({ title: 'Total Komentar', value: data.stats.totalComments })}
            ${kpiTile({ title: 'Total Pengguna', value: data.stats.totalUsers })}
          </div>

          <div class="card">
            <div class="card-header">
              <h2 class="card-title text-accent row-gap-sm">
                ${icon('play', 'icon-sm')} <span>Simulasi Worker Berkala: SLA Tick &amp; Auto-Close</span>
              </h2>
              <p class="card-desc">
                Worker memeriksa tiket mendekati batas (75%), tiket breach, eskalasi hierarkis, dan auto-close setelah 3 hari kerja.
              </p>
            </div>
            <div class="card-body stack">
              <div class="sandbox-banner">Mode Demo / Simulasi — perubahan offset waktu hanya untuk menguji warning, breach, dan auto-close.</div>
              <div class="row-between text-xs">
                <span class="text-muted">Waktu tick worker terakhir:</span>
                <strong id="worker-last-tick" class="mono">
                  ${data.stats.workerLastTick
                    ? formatDateTime(data.stats.workerLastTick)
                    : 'Belum pernah dijalankan'}
                </strong>
              </div>

              <div class="row-between-wrap">
                <div class="row-gap-sm">
                  <label for="sla-tick-minutes" class="label">Simulasi Waktu (Offset):</label>
                  <select id="sla-tick-minutes" class="select select-sm">
                    <option value="0">Waktu Nyata (0m)</option>
                    <option value="60">+1 Jam (Warning 75%)</option>
                    <option value="480">+8 Jam Kerja (1 Hari Kerja)</option>
                    <option value="1440">+1 Hari (Breach &amp; Eskalasi)</option>
                    <option value="4320">+3 Hari Kerja (Auto-Close)</option>
                  </select>
                </div>
                <button type="button" id="sla-tick-run" class="btn btn-primary btn-sm">
                  ${icon('refresh', 'icon-xs')} <span>Jalankan SLA Tick Sekarang</span>
                </button>
              </div>

              <div id="sla-tick-output" class="tick-panel" hidden></div>
            </div>
          </div>

          <div class="card">
            <div class="card-header">
              <h2 class="card-title row-gap-sm"><span>Outbox Email</span></h2>
              <p class="card-desc">Antrean email notifikasi yang dikirim worker (retry hingga 5 kali).</p>
            </div>
            <div class="card-body stack">
              <div class="grid-4">
                ${kpiTile({ title: 'Antre', value: data.stats.mail.queued })}
                ${kpiTile({ title: 'Terkirim', value: data.stats.mail.sent })}
                ${kpiTile({ title: 'Gagal', value: data.stats.mail.failed })}
              </div>
              ${data.stats.mail.recentFailures.length
                ? html`<div class="text-xs stack-sm">
                    <strong>10 kegagalan terakhir</strong>
                    ${data.stats.mail.recentFailures.map(
                      (f) => html`<div class="row-between-wrap">
                        <span class="mono">${f.to}</span>
                        <span>${f.subject}</span>
                        <span class="text-muted">${f.attempts}x — ${f.error}</span>
                      </div>`,
                    )}
                  </div>`
                : html`<p class="text-xs text-muted">Tidak ada email gagal.</p>`}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Notifications Page
// ---------------------------------------------------------------------------

export function notificationsPage(
  items: NotificationItem[],
  unreadOnly: boolean,
  isAgent: boolean,
): HtmlContent {
  const now = new Date();
  return html`<div class="page-pad narrow-wrap stack-md">
    <div>
      <h1 class="page-h1">Pusat Notifikasi</h1>
      <p class="text-muted text-xs">
        Riwayat pemberitahuan penugasan tiket, peringatan SLA, dan pesan baru.
      </p>
    </div>

    <div class="row-between-wrap tab-bar">
      <div class="row-gap-xs">
        <a href="/notifications" class="tab${!unreadOnly ? ' is-active' : ''}">Semua Notifikasi</a>
        <a href="/notifications?unreadOnly=true" class="tab${unreadOnly ? ' is-active' : ''}">
          Belum Dibaca
        </a>
      </div>
      <button type="button" class="btn btn-secondary btn-sm" data-notif-read-all>
        ${icon('check', 'icon-xs')} <span>Tandai Semua Telah Dibaca</span>
      </button>
    </div>

    ${items.length === 0
      ? emptyState(
          'Tidak ada notifikasi',
          unreadOnly ? 'Semua notifikasi sudah Anda baca.' : 'Belum ada notifikasi baru untuk akun Anda.',
          undefined,
          'bell',
        )
      : html`<div class="card list-card">
          ${items.map((n) => {
            const isUnread = !n.readAt;
            const href = isAgent ? `/tickets/${n.ticketNumber}` : `/portal/tickets/${n.ticketNumber}`;
            return html`<div class="list-row${isUnread ? ' is-unread' : ''}">
              <div class="row-gap-sm">
                <span class="unread-dot${isUnread ? '' : ' is-transparent'}"></span>
                <div class="stack-xs">
                  <strong class="text-xs">${n.title}</strong>
                  <span class="text-muted text-xs">
                    ${formatDateTime(n.createdAt)} (${formatRelative(n.createdAt, now)})
                  </span>
                </div>
              </div>
              <div class="row-gap-sm">
                ${isUnread
                  ? html`<button
                      type="button"
                      class="link-btn"
                      data-api-btn
                      data-url="/api/notifications/${n.id}/read"
                      data-reload="true"
                      data-success-msg="Notifikasi ditandai dibaca"
                    >
                      Tandai dibaca
                    </button>`
                  : null}
                <a href="${href}" data-notif-read="${n.id}" class="badge badge-ticket mono">
                  ${n.ticketNumber}
                </a>
              </div>
            </div>`;
          })}
        </div>`}
  </div>`;
}
