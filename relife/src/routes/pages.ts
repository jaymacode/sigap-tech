import { Hono, type Context } from 'hono';
import { html } from 'hono/html';
import { getSessionUser, homeFor, requirePageUser, type SessionUser } from '@/server/auth/session';
import { getStore } from '@/server/mock/db';
import { businessCalendar } from '@/server/mock/store';
import { getAdminData } from '@/server/queries/admin';
import { getActiveCatalogItems } from '@/server/queries/catalog';
import { getDashboardMetrics } from '@/server/queries/dashboard';
import { listUserNotifications, unreadNotificationCount } from '@/server/queries/notifications';
import {
  assigneeOptions,
  calendarsForClient,
  getTicketDetail,
  listQueue,
  listRequesterTickets,
  parseQueueFilters,
  queueCounts,
} from '@/server/queries/tickets';
import { emptyState, type HtmlContent } from '@/views/components';
import { agentLayout, portalLayout } from '@/views/layout';
import {
  adminPage,
  agentTicketDetailPage,
  dashboardPage,
  notificationsPage,
  queuePage,
} from '@/views/pages-agent';
import {
  loginPage,
  portalHomePage,
  portalNewTicketPage,
  portalTicketDetailPage,
  portalTicketsPage,
} from '@/views/pages-portal';

const pages = new Hono();

function renderErrorPage(
  user: SessionUser,
  title: string,
  heading: string,
  desc: string,
  backHref: string,
  backLabel: string,
  isAgent: boolean,
): HtmlContent {
  const store = getStore();
  const notifications = listUserNotifications(user.id, 10);
  const unreadCount = unreadNotificationCount(user.id);
  const body = html`<div class="page-pad narrow-wrap">
    ${emptyState(
      heading,
      desc,
      html`<a href="${backHref}" class="btn btn-secondary btn-sm">${backLabel}</a>`,
      'warn',
    )}
  </div>`;

  if (isAgent) {
    return agentLayout({
      user,
      title,
      activePath: 'queue',
      notifications,
      unreadCount,
      queueCounts: queueCounts(store, user, new Date()),
      body,
    });
  }
  return portalLayout({
    user,
    title,
    activeNav: 'tickets',
    notifications,
    unreadCount,
    body,
  });
}

function portalCtx(_c: Context, user: SessionUser) {
  return {
    user,
    notifications: listUserNotifications(user.id, 10),
    unreadCount: unreadNotificationCount(user.id),
  };
}

function agentCtx(_c: Context, user: SessionUser) {
  const store = getStore();
  return {
    user,
    notifications: listUserNotifications(user.id, 10),
    unreadCount: unreadNotificationCount(user.id),
    queueCounts: queueCounts(store, user, new Date()),
  };
}

pages.get('/', (c) => {
  const user = getSessionUser(c);
  return c.redirect(user ? homeFor(user.role) : '/login');
});

pages.get('/login', (c) => {
  const user = getSessionUser(c);
  if (user) return c.redirect(homeFor(user.role));
  return c.html(loginPage());
});

pages.get('/portal', (c) => {
  const auth = requirePageUser(c);
  if (auth instanceof Response) return auth;
  const store = getStore();
  const items = getActiveCatalogItems();
  const tickets = listRequesterTickets(store, auth);
  return c.html(
    portalLayout({
      ...portalCtx(c, auth),
      title: 'Katalog Layanan',
      activeNav: 'catalog',
      body: portalHomePage({ user: auth, items, tickets }),
    }),
  );
});

pages.get('/portal/new', (c) => {
  const auth = requirePageUser(c);
  if (auth instanceof Response) return auth;
  const items = getActiveCatalogItems();
  const preselectedService = c.req.query('service');
  const preselectedType = c.req.query('type');
  return c.html(
    portalLayout({
      ...portalCtx(c, auth),
      title: 'Permintaan Layanan IT',
      activeNav: 'catalog',
      body: portalNewTicketPage({ user: auth, items, preselectedService, preselectedType }),
    }),
  );
});

pages.get('/portal/new/:catalogId', (c) => {
  const type = c.req.query('type');
  let target = `/portal/new?service=${encodeURIComponent(c.req.param('catalogId'))}`;
  if (type) target += `&type=${encodeURIComponent(type)}`;
  return c.redirect(target, 302);
});

pages.get('/portal/tickets', (c) => {
  const auth = requirePageUser(c);
  if (auth instanceof Response) return auth;
  const store = getStore();
  const statusFilter = c.req.query('status');
  const q = c.req.query('q');
  const tickets = listRequesterTickets(store, auth);
  return c.html(
    portalLayout({
      ...portalCtx(c, auth),
      title: 'Tiket Saya',
      activeNav: 'tickets',
      body: portalTicketsPage(tickets, statusFilter, q),
    }),
  );
});

pages.get('/portal/tickets/:number', (c) => {
  const auth = requirePageUser(c);
  if (auth instanceof Response) return auth;
  const store = getStore();
  const result = getTicketDetail(store, auth, c.req.param('number'));
  if (result.kind === 'not_found') {
    return c.html(
      renderErrorPage(
        auth,
        'Tiket Tidak Ditemukan',
        'Tiket Tidak Ditemukan (404)',
        'Nomor tiket tidak ditemukan di sistem.',
        '/portal/tickets',
        'Kembali ke Tiket Saya',
        false,
      ),
      404,
    );
  }
  if (result.kind === 'forbidden') {
    return c.html(
      renderErrorPage(
        auth,
        'Akses Ditolak',
        'Akses Ditolak (403)',
        'Anda tidak memiliki izin untuk melihat detail tiket ini.',
        '/portal/tickets',
        'Kembali ke Tiket Saya',
        false,
      ),
      403,
    );
  }
  const cal = businessCalendar(store, result.detail.resolution.calendarId);
  return c.html(
    portalLayout({
      ...portalCtx(c, auth),
      title: result.detail.number,
      activeNav: 'tickets',
      body: portalTicketDetailPage(result.detail, cal),
    }),
  );
});

pages.get('/queue', (c) => {
  const auth = requirePageUser(c, ['agent', 'lead', 'admin']);
  if (auth instanceof Response) return auth;
  const store = getStore();
  const filters = parseQueueFilters(c.req.query());
  const result = listQueue(store, auth, filters, new Date());
  const assignees = assigneeOptions(store);
  const calendars = calendarsForClient(store);
  return c.html(
    agentLayout({
      user: auth,
      title: 'Queue Tiket',
      activePath: 'queue',
      activeView: filters.view,
      notifications: listUserNotifications(auth.id, 10),
      unreadCount: unreadNotificationCount(auth.id),
      queueCounts: result.counts,
      body: queuePage(result, filters, assignees, calendars, auth.id, auth.role),
    }),
  );
});

pages.get('/tickets/:number', (c) => {
  const auth = requirePageUser(c, ['agent', 'lead', 'admin']);
  if (auth instanceof Response) return auth;
  const store = getStore();
  const result = getTicketDetail(store, auth, c.req.param('number'));
  if (result.kind === 'not_found') {
    return c.html(
      renderErrorPage(
        auth,
        'Tiket Tidak Ditemukan',
        'Tiket Tidak Ditemukan (404)',
        'Nomor tiket tidak ditemukan di sistem.',
        '/queue',
        'Kembali ke Queue',
        true,
      ),
      404,
    );
  }
  if (result.kind === 'forbidden') {
    return c.html(
      renderErrorPage(
        auth,
        'Akses Ditolak',
        'Akses Ditolak (403)',
        'Anda tidak memiliki izin akses untuk memeriksa tiket tim ini.',
        '/queue',
        'Kembali ke Queue',
        true,
      ),
      403,
    );
  }
  const assignees = assigneeOptions(store);
  const calendars = calendarsForClient(store);
  return c.html(
    agentLayout({
      ...agentCtx(c, auth),
      title: result.detail.number,
      activePath: 'queue',
      body: agentTicketDetailPage(result.detail, auth, assignees, calendars),
    }),
  );
});

pages.get('/dashboard', (c) => {
  const auth = requirePageUser(c, ['agent', 'lead', 'admin']);
  if (auth instanceof Response) return auth;
  const rangeParam = c.req.query('range');
  const days = rangeParam === '7' ? 7 : rangeParam === '90' ? 90 : 30;
  const data = getDashboardMetrics(days);
  return c.html(
    agentLayout({
      ...agentCtx(c, auth),
      title: 'Dashboard KPI',
      activePath: 'dashboard',
      body: dashboardPage(data),
    }),
  );
});

pages.get('/admin', (c) => {
  const auth = requirePageUser(c, ['admin']);
  if (auth instanceof Response) return auth;
  const data = getAdminData();
  return c.html(
    agentLayout({
      ...agentCtx(c, auth),
      title: 'Pengaturan Admin',
      activePath: 'admin',
      body: adminPage(data),
    }),
  );
});

pages.get('/notifications', (c) => {
  const auth = requirePageUser(c);
  if (auth instanceof Response) return auth;
  const unreadOnly = c.req.query('unreadOnly') === 'true';
  let items = listUserNotifications(auth.id, 50);
  if (unreadOnly) items = items.filter((n) => !n.readAt);
  const isAgent = auth.role !== 'requester';

  if (isAgent) {
    return c.html(
      agentLayout({
        ...agentCtx(c, auth),
        title: 'Pusat Notifikasi',
        activePath: 'notifications',
        body: notificationsPage(items, unreadOnly, true),
      }),
    );
  }
  return c.html(
    portalLayout({
      ...portalCtx(c, auth),
      title: 'Pusat Notifikasi',
      activeNav: 'notifications',
      body: notificationsPage(items, unreadOnly, false),
    }),
  );
});

export default pages;
