import { html } from 'hono/html';
import { formatRelative, initials } from '@/lib/format';
import { isDemoAuth } from '@/server/auth/config';
import type { SessionUser } from '@/server/auth/session';
import { getStore } from '@/server/mock/db';
import type { NotificationItem } from '@/server/queries/notifications';
import type { QueueResult } from '@/server/queries/tickets';
import { icon, type HtmlContent } from './components';

export function baseDoc(opts: {
  title: string;
  body: HtmlContent;
  isDarkDefault?: boolean;
  isAgent?: boolean;
  includeCmdk?: boolean;
  holidays?: string[];
}): HtmlContent {
  const isAgent = opts.isAgent ?? false;
  const includeCmdk = opts.includeCmdk ?? true;
  const defaultDark = opts.isDarkDefault ? 'true' : 'false';
  const holidayAttr = (opts.holidays ?? []).join(',');

  return html`<!DOCTYPE html>
<html lang="id">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${opts.title}</title>
    <script>
      (function () {
        try {
          var t = localStorage.getItem('sigap-theme');
          if (t === 'dark' || (!t && (${defaultDark} || window.matchMedia('(prefers-color-scheme: dark)').matches))) {
            document.documentElement.classList.add('dark');
          }
        } catch (e) {}
      })();
    </script>
    <link rel="stylesheet" href="/app.css" />
    <script type="module" src="/app.js"></script>
  </head>
  <body data-holidays="${holidayAttr}">
    <a href="#main-content" class="skip-link">Lewati ke konten utama</a>
    ${opts.body}
    ${includeCmdk ? commandPaletteDialog(isAgent) : null}
    <dialog id="dlg-confirm" class="modal" aria-labelledby="dlg-confirm-title" aria-describedby="dlg-confirm-msg">
      <div class="modal-box">
        <div class="modal-head">
          <h3 id="dlg-confirm-title" class="modal-title">Konfirmasi Tindakan</h3>
          <p id="dlg-confirm-msg" class="modal-desc"></p>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn btn-secondary btn-sm" data-confirm-cancel>Batal</button>
          <button type="button" class="btn btn-primary btn-sm" data-confirm-ok>Ya, Lanjutkan</button>
        </div>
      </div>
    </dialog>
    <div id="sr-announcer" class="sr-only" aria-live="polite"></div>
    <div id="toast-root" class="toast-root" aria-live="polite"></div>
  </body>
</html>`;
}

function commandPaletteDialog(isAgent: boolean): HtmlContent {
  return html`<dialog id="dlg-cmdk" class="modal cmdk-modal" data-is-agent="${isAgent ? '1' : '0'}">
    <div class="cmdk-box">
      <div class="cmdk-head">
        ${icon('search', 'icon-sm text-muted')}
        <input
          id="cmdk-input"
          type="search"
          enterkeyhint="search"
          class="cmdk-input"
          placeholder="${isAgent
            ? 'Cari nomor (INC-000001), judul, atau requester...'
            : 'Cari tiket (INC-000001) atau judul...'}"
          autocomplete="off"
        />
        <button type="button" class="btn btn-ghost btn-sm" data-close-dialog aria-label="Tutup pencarian">Tutup</button>
      </div>
      <div id="cmdk-results" class="cmdk-results">
        <p class="cmdk-hint">Ketik minimal 2 karakter untuk mencari tiket</p>
      </div>
      <div class="cmdk-quick">
        <span class="cmdk-group-label">Navigasi Cepat</span>
        ${isAgent
          ? html`
              <a href="/queue" class="cmdk-item">${icon('ticket', 'icon-sm')} <span>Queue Tiket</span></a>
              <a href="/dashboard" class="cmdk-item">${icon('dashboard', 'icon-sm')} <span>Dashboard Metrik</span></a>
              <a href="/admin" class="cmdk-item">${icon('settings', 'icon-sm')} <span>Administrasi &amp; Pengaturan</span></a>
            `
          : html`
              <a href="/portal" class="cmdk-item">${icon('file', 'icon-sm')} <span>Katalog Layanan</span></a>
              <a href="/portal/tickets" class="cmdk-item">${icon('ticket', 'icon-sm')} <span>Tiket Saya</span></a>
            `}
      </div>
    </div>
  </dialog>`;
}

const DEMO_SWITCH_USERS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'usr-user', label: 'Requester (Putri)' },
  { id: 'usr-agent', label: 'Anggota IT (Dimas)' },
  { id: 'usr-lead', label: 'Head IT (Rina)' },
  { id: 'usr-admin', label: 'Administrator (Andi)' },
];

function topbarControls(opts: {
  user: SessionUser;
  notifications: NotificationItem[];
  unreadCount: number;
  isAgent: boolean;
  now: Date;
}): HtmlContent {
  const { user, notifications, unreadCount, isAgent, now } = opts;

  return html`<div class="topbar-actions">
    <details class="popover">
      <summary
        class="icon-btn"
        aria-label="Notifikasi (${unreadCount} belum dibaca)"
        title="Notifikasi"
      >
        ${icon('bell', 'icon-sm')}
        ${unreadCount > 0 ? html`<span class="notif-dot" aria-hidden="true"></span>` : null}
      </summary>
      <div class="popover-panel">
        <div class="popover-head">
          <div class="row-gap-sm">
            <strong>Notifikasi</strong>
            ${unreadCount > 0 ? html`<span class="badge badge-accent">${unreadCount}</span>` : null}
          </div>
          ${unreadCount > 0
            ? html`<button type="button" class="link-btn" data-notif-read-all>Tandai dibaca</button>`
            : null}
        </div>
        <div class="popover-list">
          ${notifications.length === 0
            ? html`<div class="popover-empty">Tidak ada notifikasi</div>`
            : notifications.slice(0, 8).map((item) => {
                const href = isAgent
                  ? `/tickets/${item.ticketNumber}`
                  : `/portal/tickets/${item.ticketNumber}`;
                const unread = !item.readAt;
                return html`<a
                  href="${href}"
                  data-notif-read="${item.id}"
                  class="popover-item${unread ? ' is-unread' : ''}"
                >
                  <div class="popover-item-row">
                    <span>${item.title}</span>
                    ${unread ? html`<span class="unread-dot" aria-hidden="true"></span>` : null}
                  </div>
                  <span class="popover-item-time">${formatRelative(item.createdAt, now)}</span>
                </a>`;
              })}
        </div>
        <div class="popover-foot">
          <a href="/notifications" class="link-accent">Buka pusat notifikasi</a>
        </div>
      </div>
    </details>

    <button
      type="button"
      class="icon-btn"
      data-theme-toggle
      aria-label="Ganti tema Terang/Gelap"
      title="Ganti tema Terang/Gelap"
    >
      ${icon('sun', 'icon-sm icon-sun')}
      ${icon('moon', 'icon-sm icon-moon')}
    </button>

    <span class="divider-v" aria-hidden="true"></span>

    <details class="popover user-popover">
      <summary class="user-trigger" aria-label="Menu profil pengguna">
        <span class="avatar avatar-sm">${initials(user.name)}</span>
        <span class="user-meta hide-sm">
          <span class="user-name">${user.name}</span>
          <span class="user-role">${user.role}</span>
        </span>
      </summary>
      <div class="popover-panel user-panel">
        <div class="user-panel-head">
          <strong class="text-xs">${user.name}</strong>
          <span class="text-muted text-xs">${user.email}</span>
          <span class="text-muted text-xs capitalize">${user.department} · Role: ${user.role}</span>
        </div>
        ${isDemoAuth()
          ? html`<hr class="sep" />
              <span class="user-panel-label">Ganti Akun Demo</span>
              <div class="user-panel-list">
                ${DEMO_SWITCH_USERS.map(
                  (u) => html`<button
                    type="button"
                    class="user-panel-item${user.id === u.id ? ' is-current' : ''}"
                    data-switch-user-id="${u.id}"
                  >
                    ${icon('users', 'icon-xs')} <span>${u.label}</span>
                  </button>`,
                )}
              </div>`
          : ''}
        <hr class="sep" />
        <button type="button" class="user-panel-item text-danger" data-logout>
          ${icon('logout', 'icon-xs')} <span>Keluar</span>
        </button>
      </div>
    </details>
  </div>`;
}

function cmdkTrigger(): HtmlContent {
  return html`<button
    type="button"
    class="cmdk-trigger"
    data-open-dialog="dlg-cmdk"
    aria-label="Cari tiket atau navigasi"
    title="Cari tiket atau navigasi (Ctrl+K)"
  >
    ${icon('search', 'icon-xs')}
    <span class="hide-sm">Cari tiket, nomor, atau requester...</span>
    <span class="show-sm">Cari...</span>
    <kbd class="kbd hide-sm">Ctrl+K</kbd>
  </button>`;
}

export function portalLayout(opts: {
  user: SessionUser;
  title: string;
  activeNav: 'catalog' | 'tickets' | 'notifications';
  notifications: NotificationItem[];
  unreadCount: number;
  body: HtmlContent;
}): HtmlContent {
  const now = new Date();
  const content = html`<div class="portal-shell">
    <header class="topbar portal-topbar">
      <div class="topbar-left">
        <a href="/portal" class="brand">
          <span class="brand-logo">S</span>
          <span class="brand-name">Sigap</span>
          <span class="brand-sub hide-sm">IT Service Portal</span>
        </a>
        <nav class="portal-nav" aria-label="Navigasi Portal">
          <a href="/portal" class="nav-link${opts.activeNav === 'catalog' ? ' is-active' : ''}">
            Katalog Layanan
          </a>
          <a href="/portal/tickets" class="nav-link${opts.activeNav === 'tickets' ? ' is-active' : ''}">
            Tiket Saya
          </a>
        </nav>
      </div>
      <div class="topbar-right">
        <a href="/portal/new" class="btn btn-primary btn-sm portal-new-btn" aria-label="Buat Permintaan IT">
          ${icon('plus', 'icon-xs')} <span>Buat Permintaan</span>
        </a>
        ${cmdkTrigger()}
        ${topbarControls({
          user: opts.user,
          notifications: opts.notifications,
          unreadCount: opts.unreadCount,
          isAgent: false,
          now,
        })}
      </div>
    </header>

    <main id="main-content" class="portal-main">${opts.body}</main>

    <footer class="portal-footer">
      <div class="portal-footer-inner">
        <p>© 2026 Sigap · IT CTII Service Portal. Jam Layanan: Senin–Jumat 08:00–17:00 WIB.</p>
        ${opts.user.role !== 'requester'
          ? html`<a href="/queue" class="link-accent row-gap-xs">
              <span>Buka Agent Workspace</span>
              ${icon('arrowRight', 'icon-xs')}
            </a>`
          : null}
      </div>
    </footer>
  </div>`;

  return baseDoc({
    title: `${opts.title} — Sigap IT Service Desk`,
    body: content,
    isAgent: false,
    holidays: getStore().holidays.map((h) => h.date),
  });
}

export function agentLayout(opts: {
  user: SessionUser;
  title: string;
  activePath: 'queue' | 'dashboard' | 'admin' | 'notifications';
  activeView?: string;
  notifications: NotificationItem[];
  unreadCount: number;
  queueCounts: QueueResult['counts'];
  body: HtmlContent;
}): HtmlContent {
  const now = new Date();
  const isQueue = opts.activePath === 'queue';
  const view = opts.activeView ?? 'team';
  const { queueCounts: counts } = opts;

  const content = html`<div class="app-shell">
    <aside class="sidebar">
      <div class="sidebar-top">
        <a href="/queue" class="brand sidebar-brand">
          <span class="brand-logo">S</span>
          <span class="brand-name">Sigap</span>
          <span class="badge badge-accent">ITSM</span>
        </a>

      <details class="mobile-nav-details" data-mobile-nav>
        <summary class="mobile-nav-summary">
          ${icon('dashboard', 'icon-xs')} <span>Menu</span>
        </summary>
        <div class="sidebar-group">
          <span class="sidebar-label">Queue Tiket</span>
          <nav class="sidebar-nav">
            <a href="/queue?view=team" class="sidebar-link${isQueue && view === 'team' ? ' is-active' : ''}">
              <span class="row-gap-sm">${icon('users', 'icon-sm')} <span>Antrean Tim IT</span></span>
              <span class="sidebar-count tabular">${counts.team}</span>
            </a>
            <a href="/queue?view=my" class="sidebar-link${isQueue && view === 'my' ? ' is-active' : ''}">
              <span class="row-gap-sm">${icon('user', 'icon-sm')} <span>My Tickets</span></span>
              <span class="sidebar-count tabular">${counts.my}</span>
            </a>
            <a href="/queue?view=unassigned" class="sidebar-link${isQueue && view === 'unassigned' ? ' is-active' : ''}">
              <span class="row-gap-sm">${icon('inbox', 'icon-sm')} <span>Unassigned</span></span>
              <span class="sidebar-count tabular">${counts.unassigned}</span>
            </a>
            <a href="/queue?view=at_risk" class="sidebar-link${isQueue && view === 'at_risk' ? ' is-active is-risk' : ''}">
              <span class="row-gap-sm">${icon('warn', 'icon-sm text-sla-risk')} <span>At Risk (≥75%)</span></span>
              <span class="sidebar-count tabular${counts.at_risk > 0 ? ' count-risk' : ''}">${counts.at_risk}</span>
            </a>
            <a href="/queue?view=breached" class="sidebar-link${isQueue && view === 'breached' ? ' is-active is-breach' : ''}">
              <span class="row-gap-sm">${icon('octagon', 'icon-sm text-sla-breach')} <span>Breached</span></span>
              <span class="sidebar-count tabular${counts.breached > 0 ? ' count-breach' : ''}">${counts.breached}</span>
            </a>
            <a href="/queue?view=approval" class="sidebar-link${isQueue && view === 'approval' ? ' is-active' : ''}">
              <span class="row-gap-sm">${icon('shield', 'icon-sm')} <span>Menunggu Persetujuan</span></span>
              <span class="sidebar-count tabular${counts.approval > 0 ? ' count-risk' : ''}">${counts.approval}</span>
            </a>
            <a href="/queue?view=all" class="sidebar-link${isQueue && view === 'all' ? ' is-active' : ''}">
              <span class="row-gap-sm">${icon('folder', 'icon-sm')} <span>Semua Tiket</span></span>
            </a>
          </nav>
        </div>

        <div class="sidebar-group">
          <span class="sidebar-label">Analitik &amp; Kelola</span>
          <nav class="sidebar-nav">
            <a href="/dashboard" class="sidebar-link${opts.activePath === 'dashboard' ? ' is-active' : ''}">
              <span class="row-gap-sm">${icon('dashboard', 'icon-sm')} <span>Dashboard KPI</span></span>
            </a>
            ${opts.user.role === 'admin'
              ? html`<a href="/admin" class="sidebar-link${opts.activePath === 'admin' ? ' is-active' : ''}">
                  <span class="row-gap-sm">${icon('settings', 'icon-sm')} <span>Pengaturan Admin</span></span>
                </a>`
              : null}
            <a href="/portal" class="sidebar-link sidebar-portal-mobile">
              <span class="row-gap-sm">${icon('lifebuoy', 'icon-sm')} <span>Portal Requester</span></span>
            </a>
          </nav>
        </div>
      </details>
      </div>

      <div class="sidebar-foot">
        <a href="/portal" class="sidebar-link">
          <span class="row-gap-sm">${icon('lifebuoy', 'icon-sm')} <span>Lihat Portal Requester</span></span>
        </a>
      </div>
    </aside>

    <div class="main-wrap">
      <header class="topbar">
        <div class="topbar-left">${cmdkTrigger()}</div>
        ${topbarControls({
          user: opts.user,
          notifications: opts.notifications,
          unreadCount: opts.unreadCount,
          isAgent: true,
          now,
        })}
      </header>
      <main id="main-content" class="main-content">${opts.body}</main>
    </div>
  </div>`;

  return baseDoc({
    title: `${opts.title} — Sigap ITSM`,
    body: content,
    isAgent: true,
    holidays: getStore().holidays.map((h) => h.date),
  });
}
