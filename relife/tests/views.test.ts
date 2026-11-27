import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { createApp } from '@/index';
import { bootstrapDatabase } from '@/server/db/bootstrap';
import { closeSqlite, getSqlite } from '@/server/db/sqlite';
import { installDatabaseStore } from '@/server/mock/db';

const app = createApp();

beforeAll(() => {
  closeSqlite();
  process.env.DB_PATH = ':memory:';
  const outcome = bootstrapDatabase(getSqlite());
  installDatabaseStore(outcome.store, outcome.snapshot);
});

afterAll(() => {
  closeSqlite();
});

async function loginAs(role: 'requester' | 'agent' | 'lead' | 'admin'): Promise<string> {
  const res = await app.request('/api/auth/demo', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ role }),
  });
  expect(res.status).toBe(200);
  return res.headers.get('set-cookie')?.split(';')[0] ?? '';
}

function assertNoHeadingSkips(html: string, route: string): void {
  const levels = [...html.matchAll(/<h([1-6])\b/gi)].map((m) => Number(m[1]));
  expect(levels.length, `${route} should render headings`).toBeGreaterThan(0);
  expect(levels[0], `${route} should start with h1`).toBe(1);
  for (let i = 1; i < levels.length; i++) {
    const prev = levels[i - 1]!;
    const curr = levels[i]!;
    expect(curr, `${route} heading skipped from h${prev} to h${curr}`).toBeLessThanOrEqual(prev + 1);
  }
}

function assertApiFormsHaveErrorBox(html: string, route: string): void {
  const forms = [...html.matchAll(/<form\b[^>]*\bdata-api-form\b[^>]*>[\s\S]*?<\/form>/gi)];
  expect(forms.length, `${route} should have at least one [data-api-form]`).toBeGreaterThan(0);
  for (const [formHtml] of forms) {
    expect(formHtml, `${route} form missing data-form-error`).toContain('data-form-error');
  }
}

function assertShellA11y(html: string, route: string, expectSkipLink = true): void {
  expect(html, `${route} #toast-root missing class="toast-root"`).toMatch(
    /<div\b[^>]*(?:id="toast-root"[^>]*class="[^"]*\btoast-root\b|class="[^"]*\btoast-root\b[^>]*id="toast-root")[^>]*>/i,
  );
  expect(html, `${route} missing #sr-announcer`).toContain('id="sr-announcer"');
  if (expectSkipLink) {
    expect(html, `${route} missing skip link`).toContain('href="#main-content"');
    expect(html, `${route} missing #main-content target`).toContain('id="main-content"');
  }
}

describe('Relife HTML views & static assets', () => {
  it('serves app.css, app.js, and split CSS/JS modules regardless of CWD and validates JS syntax', async () => {
    const css = await app.request('/app.css');
    const js = await app.request('/app.js');
    expect(css.status).toBe(200);
    expect(css.headers.get('content-type')).toContain('text/css');
    expect(js.status).toBe(200);
    expect(js.headers.get('content-type')).toContain('text/javascript');

    const transpiler = new Bun.Transpiler({ loader: 'js' });
    const jsText = await js.text();
    expect(() => transpiler.transformSync(jsText)).not.toThrow();

    const cssModules = ['tokens.css', 'layout.css', 'components.css', 'portal.css', 'queue-detail.css', 'dashboard.css', 'admin.css', 'utilities.css'];
    for (const file of cssModules) {
      const res = await app.request(`/css/${file}`);
      expect(res.status, `/css/${file}`).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/css');
    }

    const jsModules = ['core.js', 'attachments.js', 'sla-live.js', 'portal.js', 'queue.js', 'dashboard.js', 'admin.js'];
    for (const file of jsModules) {
      const res = await app.request(`/js/${file}`);
      expect(res.status, `/js/${file}`).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/javascript');
      const code = await res.text();
      expect(() => transpiler.transformSync(code)).not.toThrow();
    }

    expect((await app.request('/css/missing.css')).status).toBe(404);
    expect((await app.request('/js/missing.js')).status).toBe(404);
  });

  it('renders valid HTML, accessible shells, forms, and interactive contracts', async () => {
    const loginRes = await app.request('/login');
    expect(loginRes.status).toBe(200);
    const loginHtml = await loginRes.text();
    assertShellA11y(loginHtml, '/login', false);
    assertApiFormsHaveErrorBox(loginHtml, '/login');

    const cookie = await loginAs('admin');
    const pages = ['/portal', '/portal/new?service=cat-item-pc-server', '/portal/tickets', '/queue', '/dashboard', '/admin'];
    const htmlByPath = new Map<string, string>();
    for (const path of pages) {
      const res = await app.request(path, { headers: { cookie } });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).not.toContain('?selected');
      expect(html).not.toContain('?disabled');
      expect(html).not.toContain('?required');
      assertShellA11y(html, path, true);
      htmlByPath.set(path, html);
    }

    const portalHtml = htmlByPath.get('/portal')!;
    expect(portalHtml).toContain('id="portal-catalog-search"');
    assertNoHeadingSkips(portalHtml, '/portal');
    for (const svc of [
      'PC / Server',
      'Share Folder',
      'Software',
      'Email',
      'Printing Service',
      'Network',
      'Core System',
      'Report System',
      'Others',
    ]) {
      expect(portalHtml).toContain(svc);
    }

    const newHtml = htmlByPath.get('/portal/new?service=cat-item-pc-server')!;
    expect(newHtml).toContain('id="att-file"');
    assertApiFormsHaveErrorBox(newHtml, '/portal/new?service=cat-item-pc-server');
    assertNoHeadingSkips(newHtml, '/portal/new?service=cat-item-pc-server');
    for (const reqType of [
      'New Request',
      'Enhancement',
      'Problem',
      'Access Rights',
      'Data Extraction',
      'Others',
    ]) {
      expect(newHtml).toContain(reqType);
    }
    expect(newHtml).toMatch(/name="catalogItemId"[^>]*value="cat-item-pc-server"[^>]*checked/);
    expect(newHtml).toContain('data-service-fields="cat-item-pc-server"');
    expect(newHtml).toContain('id="new-ticket-form"');

    const legacyNew = await app.request('/portal/new/cat-item-pc-server?type=Problem', {
      headers: { cookie },
      redirect: 'manual',
    });
    expect(legacyNew.status).toBe(302);
    expect(legacyNew.headers.get('location')).toBe(
      '/portal/new?service=cat-item-pc-server&type=Problem',
    );

    const portalTicketsHtml = htmlByPath.get('/portal/tickets')!;
    assertNoHeadingSkips(portalTicketsHtml, '/portal/tickets');

    const dashHtml = htmlByPath.get('/dashboard')!;
    assertNoHeadingSkips(dashHtml, '/dashboard');

    const adminHtml = htmlByPath.get('/admin')!;
    expect(adminHtml).not.toContain('onchange="this.form.requestSubmit()"');

    const qRes = await app.request('/queue?view=all', { headers: { cookie } });
    const qHtml = await qRes.text();
    expect(qHtml).toContain('data-sla-live="badge"');
    expect(qHtml).toContain('data-switch-user-id="usr-admin"');
    assertNoHeadingSkips(qHtml, '/queue');
    expect(qHtml).toContain('id="bulk-count"');
    expect(qHtml).not.toMatch(/tiket terpilih\s*tiket terpilih/i);

    const bulkSelectMatch = qHtml.match(/<select\b[^>]*id="bulk-assignee"[^>]*>([\s\S]*?)<\/select>/i);
    expect(bulkSelectMatch).not.toBeNull();
    const bulkOptions = [...bulkSelectMatch![1]!.matchAll(/<option\b[^>]*value="([^"]+)"[^>]*>/gi)];
    expect(bulkOptions.length).toBeGreaterThan(0);

    // Create a fresh ticket so both response & resolution SLAs are actively running
    const createRes = await app.request('/api/tickets', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        catalogItemId: 'cat-item-pc-server',
        title: 'Uji tampilan detail tiket SLA live',
        description: 'Memastikan atribut live SLA muncul di halaman detail tiket.',
        urgency: 'medium',
        formData: { service_request_type: 'Problem' },
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { data: { id: string; number: string } };
    const dRes = await app.request(`/tickets/${created.data.number}`, { headers: { cookie } });
    expect(dRes.status).toBe(200);
    const dHtml = await dRes.text();
    expect(dHtml).toContain('data-sla-live="badge"');
    expect(dHtml).toContain('data-sla-live="bar"');
    expect(dHtml).not.toContain('?disabled');
    expect(dHtml).not.toContain('?selected');
    expect(dHtml).not.toContain('onchange="this.form.requestSubmit()"');
    assertApiFormsHaveErrorBox(dHtml, `/tickets/${created.data.number}`);

    const portalDetailRes = await app.request(`/portal/tickets/${created.data.number}`, { headers: { cookie } });
    expect(portalDetailRes.status).toBe(200);
    const portalDetailHtml = await portalDetailRes.text();
    assertApiFormsHaveErrorBox(portalDetailHtml, `/portal/tickets/${created.data.number}`);

    // Assign then transition to resolved so CSAT radiogroup & reopen modal render on portal detail
    const assignRes = await app.request(`/api/tickets/${created.data.id}/assign`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ assigneeId: 'usr-agent' }),
    });
    expect(assignRes.status).toBe(200);
    const toProgRes = await app.request(`/api/tickets/${created.data.id}/transition`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ to: 'in_progress' }),
    });
    expect(toProgRes.status).toBe(200);
    const toResRes = await app.request(`/api/tickets/${created.data.id}/transition`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        to: 'resolved',
        resolutionCode: 'fixed',
        resolutionNotes: 'Perangkat telah diperbaiki dan diverifikasi.',
      }),
    });
    expect(toResRes.status).toBe(200);

    const resolvedPortalRes = await app.request(`/portal/tickets/${created.data.number}`, { headers: { cookie } });
    expect(resolvedPortalRes.status).toBe(200);
    const resolvedPortalHtml = await resolvedPortalRes.text();
    assertApiFormsHaveErrorBox(resolvedPortalHtml, `/portal/tickets/${created.data.number} (resolved)`);
    expect(resolvedPortalHtml).toContain('role="radiogroup"');
    const csatStars = [...resolvedPortalHtml.matchAll(/<button\b[^>]*\bdata-csat-star="[^"]+"[^>]*>/gi)];
    expect(csatStars.length).toBe(5);
    for (const [starTag] of csatStars) {
      expect(starTag).toContain('role="radio"');
      expect(starTag).toMatch(/aria-checked="(?:true|false)"/);
    }
  });
});
