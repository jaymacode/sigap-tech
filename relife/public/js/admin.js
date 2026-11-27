// Admin Panel Features: User Filters, SLA Tick Runner, SLA Matrix Editor & Holidays
import {
  apiFetch,
  confirmModal,
  saveToastForReload,
  setFormError,
  setSubmitBusy,
  showToast,
} from './core.js';

function filterAdminUsers() {
  const q = (document.getElementById('admin-user-search')?.value || '').trim().toLowerCase();
  const role = document.getElementById('admin-user-role')?.value || '';
  const status = document.getElementById('admin-user-status')?.value || '';
  let shown = 0;
  document.querySelectorAll('[data-user-row]').forEach((row) => {
    const match =
      (!q || (row.dataset.search || '').includes(q)) &&
      (!role || row.dataset.role === role) &&
      (!status || row.dataset.active === status);
    row.hidden = !match;
    if (match) shown++;
  });
  const empty = document.querySelector('[data-user-empty]');
  if (empty) empty.hidden = shown > 0;
  const count = document.getElementById('admin-user-count');
  if (count) count.textContent = `${shown} pengguna`;
  const resetBtn = document.getElementById('admin-user-reset');
  if (resetBtn) resetBtn.hidden = !q && !role && !status;
}

function renderTickOutput(container, d) {
  container.hidden = false;
  container.replaceChildren();

  const head = document.createElement('div');
  head.className = 'row-between-wrap tick-head';
  const title = document.createElement('strong');
  title.className = 'text-accent text-xs';
  title.textContent = `Evaluasi SLA (${d.totalRunning ?? 0} SLA aktif)`;
  const ts = document.createElement('span');
  ts.className = 'mono text-xs text-muted';
  ts.textContent = d.simulatedNow ? new Date(d.simulatedNow).toLocaleString('id-ID') : '';
  head.append(title, ts);

  const grid = document.createElement('div');
  grid.className = 'grid-2';

  const makeBox = (label, count, tickets, cls) => {
    const box = document.createElement('div');
    box.className = 'tick-box';
    const h = document.createElement('div');
    h.className = `text-xs font-bold ${cls}`;
    h.textContent = `${label} (${count ?? 0})`;
    box.appendChild(h);
    if (Array.isArray(tickets) && tickets.length) {
      const links = document.createElement('div');
      links.className = 'row-gap-xs wrap';
      tickets.slice(0, 12).forEach((num) => {
        const a = document.createElement('a');
        a.href = `/tickets/${encodeURIComponent(num)}`;
        a.className = 'badge mono';
        a.textContent = num;
        links.appendChild(a);
      });
      box.appendChild(links);
    } else {
      const p = document.createElement('span');
      p.className = 'text-xs text-muted italic';
      p.textContent = 'Tidak ada tiket aktif.';
      box.appendChild(p);
    }
    return box;
  };

  grid.append(
    makeBox('Tiket Breached', d.activeBreached, d.breachedTickets, 'text-sla-breach'),
    makeBox('At Risk (≥75%)', d.activeAtRisk, d.atRiskTickets, 'text-sla-risk'),
  );

  const foot = document.createElement('div');
  foot.className = 'text-xs text-muted mono';
  foot.textContent = `Aksi tick ini: ${d.warned ?? 0} warning baru · ${d.breached ?? 0} breach baru · ${d.autoClosed ?? 0} auto-closed`;

  container.append(head, grid, foot);
}

function slaTargetText(minutes, calKind) {
  if (!Number.isFinite(minutes) || minutes <= 0) return 'Isi angka lebih dari 0';
  const biz = calKind === 'business_hours';
  const sfx = biz ? ' kerja' : '';
  const perDay = biz ? 480 : 1440;
  const d = Math.floor(minutes / perDay);
  const h = Math.floor((minutes % perDay) / 60);
  const m = minutes % 60;
  const parts = [];
  if (d) parts.push(`${d} hari`);
  if (h) parts.push(`${h} jam`);
  if (m) parts.push(`${m} menit`);
  return parts.join(' ') + sfx;
}

function slaFieldMinutes(row, key) {
  const v = Number(row.querySelector(`[data-sla-value="${key}"]`)?.value);
  const u = Number(row.querySelector(`[data-sla-unit="${key}"]`)?.value || 1);
  return v * u;
}

function refreshSlaPreview(row) {
  const kind = row.querySelector('[data-sla-cal] option:checked')?.dataset.kind || 'business_hours';
  for (const key of ['response', 'resolution']) {
    const out = row.querySelector(`[data-sla-preview="${key}"]`);
    if (out) out.textContent = slaTargetText(slaFieldMinutes(row, key), kind);
  }
}

function renderHolidayPreview(box, rows) {
  box.replaceChildren();
  const ul = document.createElement('ul');
  ul.className = 'holiday-preview-list';
  for (const r of rows) {
    const li = document.createElement('li');
    li.className = r.error ? 'is-error' : 'is-ok';
    li.textContent = r.error
      ? `Baris ${r.line}: ${r.error} (${r.date} ${r.name})`
      : `Baris ${r.line}: ${r.date} ${r.name}`;
    ul.append(li);
  }
  box.append(ul);
}

document.addEventListener('click', async (e) => {
  const t = e.target instanceof Element ? e.target : null;
  if (!t) return;

  if (t.closest('#admin-user-reset')) {
    const s = document.getElementById('admin-user-search');
    const r = document.getElementById('admin-user-role');
    const st = document.getElementById('admin-user-status');
    if (s instanceof HTMLInputElement) s.value = '';
    if (r instanceof HTMLSelectElement) r.value = '';
    if (st instanceof HTMLSelectElement) st.value = '';
    filterAdminUsers();
    s?.focus();
    return;
  }

  const slaBtn = t.closest('#sla-tick-run');
  if (slaBtn) {
    const mins = Number(document.getElementById('sla-tick-minutes')?.value || 0);
    const out = document.getElementById('sla-tick-output');
    slaBtn.disabled = true;
    try {
      const json = await apiFetch('/api/admin/sla-tick', 'POST', { advanceMinutes: mins });
      const d = json.data || {};
      const lastEl = document.getElementById('worker-last-tick');
      if (lastEl && d.simulatedNow) {
        lastEl.textContent = new Date(d.simulatedNow).toLocaleString('id-ID', {
          day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
        });
      }
      if (out) renderTickOutput(out, d);
      const newly = (d.warned || 0) + (d.breached || 0) + (d.autoClosed || 0);
      showToast(
        newly > 0
          ? `SLA Tick: ${d.warned || 0} warning, ${d.breached || 0} breach, ${d.autoClosed || 0} auto-closed`
          : `SLA Tick selesai: ${d.activeBreached || 0} breached, ${d.activeAtRisk || 0} at-risk`,
        newly > 0 ? 'ok' : 'info',
      );
    } catch (err) {
      if (out) {
        out.hidden = false;
        out.textContent = err.message;
      }
      showToast(err.message, 'err');
    } finally {
      slaBtn.disabled = false;
    }
    return;
  }

  const del = t.closest('[data-holiday-delete]');
  if (del) {
    if (!(await confirmModal('Hapus hari libur ini dari kalender SLA?', del))) return;
    del.disabled = true;
    try {
      await apiFetch(`/api/admin/holidays/${encodeURIComponent(del.dataset.holidayDelete)}`, 'DELETE');
      saveToastForReload('Hari libur dihapus');
      location.reload();
    } catch (err) {
      showToast(err.message, 'err');
      del.disabled = false;
    }
    return;
  }

  const previewBtn = t.closest('[data-holiday-preview-btn]');
  const saveBtn = t.closest('[data-holiday-import-save]');
  if (!previewBtn && !saveBtn) return;
  const box = t.closest('[data-holiday-import]');
  const text = box.querySelector('[data-holiday-import-text]').value;
  const out = box.querySelector('[data-holiday-preview]');
  const save = box.querySelector('[data-holiday-import-save]');
  const activeBtn = previewBtn || saveBtn;
  let reloading = false;
  setFormError(box, '');
  if (activeBtn instanceof HTMLButtonElement) activeBtn.disabled = true;
  try {
    const json = await apiFetch('/api/admin/holidays/import', 'POST', { text, dryRun: !!previewBtn });
    if (previewBtn) {
      renderHolidayPreview(out, json.data.rows);
      const summary = document.createElement('p');
      summary.className = 'text-xs text-muted';
      summary.textContent = `${json.data.valid} baris valid, ${json.data.errors} bermasalah`;
      out.prepend(summary);
      save.disabled = json.data.errors > 0 || json.data.valid === 0;
    } else {
      saveToastForReload(`${json.data.added} hari libur ditambahkan`);
      reloading = true;
      location.reload();
    }
  } catch (err) {
    setFormError(box, err.message);
  } finally {
    if (previewBtn instanceof HTMLButtonElement) previewBtn.disabled = false;
    else if (!reloading && saveBtn instanceof HTMLButtonElement) saveBtn.disabled = false;
  }
});

document.addEventListener('input', (e) => {
  const el = e.target;
  if (!(el instanceof HTMLElement)) return;
  if (el.matches('[data-admin-user-filter]')) filterAdminUsers();
  const row = el.closest('[data-sla-row]');
  if (row) refreshSlaPreview(row);
  if (el.matches('[data-holiday-import-text]')) {
    const save = el.closest('[data-holiday-import]')?.querySelector('[data-holiday-import-save]');
    if (save) save.disabled = true;
  }
});

document.addEventListener('change', (e) => {
  const el = e.target;
  if (!(el instanceof HTMLElement)) return;
  if (el.matches('select[data-admin-user-filter]')) filterAdminUsers();
  const row = el.closest('[data-sla-row]');
  if (row) refreshSlaPreview(row);
});

document.addEventListener('submit', async (e) => {
  const form = e.target;
  if (!(form instanceof HTMLFormElement) || !form.matches('[data-sla-form]')) return;
  e.preventDefault();
  setFormError(form, '');
  const targets = [...form.querySelectorAll('[data-sla-row]')].map((row) => ({
    priority: row.dataset.slaRow,
    responseMinutes: slaFieldMinutes(row, 'response'),
    resolutionMinutes: slaFieldMinutes(row, 'resolution'),
    calendarId: row.querySelector('[data-sla-cal]').value,
  }));
  const btn = form.querySelector('[type="submit"]');
  setSubmitBusy(btn, true);
  try {
    await apiFetch(`/api/admin/sla-policies/${encodeURIComponent(form.dataset.policyId)}/targets`, 'PATCH', { targets });
    saveToastForReload(form.dataset.successMsg || 'Berhasil disimpan');
    location.reload();
  } catch (err) {
    setFormError(form, err.message);
    setSubmitBusy(btn, false);
  }
});
