// Relife client behaviors — zero-dependency Vanilla ES Module
const THEME_KEY = 'sigap-theme';
const TOAST_KEY = 'sigap-toast';
const DRAFT_KEY = 'sigap-new-ticket-draft';

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function setSubmitBusy(btn, busy) {
  if (!(btn instanceof HTMLElement)) return;
  if (busy) {
    if (!btn.dataset.origHtml) btn.dataset.origHtml = btn.innerHTML;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.textContent = 'Mengirim…';
  } else {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    if (btn.dataset.origHtml) {
      btn.innerHTML = btn.dataset.origHtml;
      delete btn.dataset.origHtml;
    }
  }
}

let lastDialogTrigger = null;
function openDialog(dlg, triggerEl = document.activeElement) {
  if (!(dlg instanceof HTMLDialogElement)) return;
  lastDialogTrigger = triggerEl instanceof HTMLElement ? triggerEl : null;
  dlg.showModal();
  if (dlg.id === 'dlg-cmdk') {
    document.getElementById('cmdk-input')?.focus();
  }
}

document.addEventListener('close', (e) => {
  if (e.target instanceof HTMLDialogElement && lastDialogTrigger?.isConnected) {
    lastDialogTrigger.focus();
    lastDialogTrigger = null;
  }
}, true);

function confirmModal(msg, triggerEl) {
  const dlg = document.getElementById('dlg-confirm');
  if (!(dlg instanceof HTMLDialogElement)) return Promise.resolve(confirm(msg));
  const msgEl = document.getElementById('dlg-confirm-msg');
  if (msgEl) msgEl.textContent = msg;
  const okBtn = dlg.querySelector('[data-confirm-ok]');
  const cancelBtn = dlg.querySelector('[data-confirm-cancel]');
  return new Promise((resolve) => {
    const cleanup = (res) => {
      okBtn?.removeEventListener('click', onOk);
      cancelBtn?.removeEventListener('click', onCancel);
      dlg.removeEventListener('close', onClose);
      resolve(res);
    };
    const onOk = () => { dlg.close('ok'); cleanup(true); };
    const onCancel = () => { dlg.close('cancel'); cleanup(false); };
    const onClose = () => cleanup(dlg.returnValue === 'ok');
    okBtn?.addEventListener('click', onOk);
    cancelBtn?.addEventListener('click', onCancel);
    dlg.addEventListener('close', onClose);
    openDialog(dlg, triggerEl);
  });
}

function applyTheme(theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

const savedTheme = localStorage.getItem(THEME_KEY);
if (savedTheme === 'dark' || savedTheme === 'light') applyTheme(savedTheme);

// Keep mobile agent nav drawer collapsed on narrow viewports, always open on desktop
{
  const mobileNav = document.querySelector('[data-mobile-nav]');
  if (mobileNav) {
    const mq = window.matchMedia('(max-width: 840px)');
    const syncNav = () => {
      if (mq.matches) mobileNav.removeAttribute('open');
      else mobileNav.setAttribute('open', '');
    };
    syncNav();
    mq.addEventListener?.('change', syncNav);
  }
}

export function showToast(msg, type = 'info') {
  if (!msg) return;
  let root = document.getElementById('toast-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'toast-root';
    root.className = 'toast-root';
    document.body.appendChild(root);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${type === 'ok' || type === 'err' ? type : 'info'}`;
  el.setAttribute('role', 'status');
  el.textContent = String(msg);
  root.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// Show toast persisted across reload
try {
  const pending = sessionStorage.getItem(TOAST_KEY);
  if (pending) {
    sessionStorage.removeItem(TOAST_KEY);
    const parsed = pending.startsWith('{') ? JSON.parse(pending) : { msg: pending, type: 'ok' };
    showToast(parsed.msg, parsed.type || 'ok');
  }
} catch { /* ignore */ }

function saveToastForReload(msg, type = 'ok') {
  if (!msg) return;
  try { sessionStorage.setItem(TOAST_KEY, JSON.stringify({ msg, type })); } catch { /* ignore */ }
}

async function apiFetch(url, method = 'POST', body = undefined) {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) {
    throw new Error(json.error || json.message || `Request gagal (${res.status})`);
  }
  return json;
}

function serializeForm(form) {
  const data = {};
  const els = Array.from(form.elements);
  for (const el of els) {
    if (!el.name || el.disabled || el.type === 'submit' || el.type === 'button') continue;
    if (el.type === 'checkbox') {
      const group = form.querySelectorAll(`input[type="checkbox"][name="${CSS.escape(el.name)}"]`);
      if (group.length > 1 || el.name === 'memberIds' || el.name.endsWith('[]')) {
        const key = el.name.replace(/\[\]$/, '');
        if (!Array.isArray(data[key])) data[key] = [];
        if (el.checked) data[key].push(el.value);
      } else {
        data[el.name] = el.checked;
      }
    } else if (el.type === 'radio') {
      if (el.checked) data[el.name] = el.value;
    } else if (el.tagName === 'SELECT' && el.multiple) {
      data[el.name] = Array.from(el.selectedOptions).map((o) => o.value);
    } else if (el.type === 'number' || el.dataset.type === 'number') {
      if (el.value !== '') data[el.name] = Number(el.value);
    } else {
      data[el.name] = el.value;
    }
  }
  return data;
}

function setFormError(form, msg) {
  const box = form.querySelector('[data-form-error]');
  if (box) {
    if (msg) {
      box.textContent = msg;
      box.hidden = false;
      box.scrollIntoView({ block: 'nearest' });
    } else {
      box.textContent = '';
      box.hidden = true;
    }
  } else if (msg) {
    showToast(msg, 'err');
  }
}

// Attachments: each picked file uploads immediately (POST /api/attachments); chips carry the id.
// Forms containing [data-att-picker] send the ids as `attachmentIds` on submit.
function uploadAttachment(list, file, maxBytes) {
  const chip = document.createElement('li');
  chip.className = 'att-chip is-uploading';
  const label = document.createElement('span');
  label.className = 'att-chip-name';
  const kb = Math.max(1, Math.round((file.size || 0) / 1024));
  label.textContent = `${file.name} (${kb} KB)`;
  const progress = document.createElement('progress');
  progress.className = 'att-progress';
  progress.setAttribute('aria-label', `Mengunggah ${file.name}`);
  const status = document.createElement('span');
  status.className = 'att-status text-xs';
  status.textContent = 'Mengunggah…';
  const rm = document.createElement('button');
  rm.type = 'button';
  rm.className = 'btn btn-ghost btn-sm';
  rm.dataset.attRemove = '';
  rm.setAttribute('aria-label', `Hapus ${file.name}`);
  rm.textContent = '×';
  chip.append(label, progress, status, rm);
  list.appendChild(chip);

  const fail = (msg) => {
    chip.classList.remove('is-uploading');
    chip.classList.add('is-error');
    progress.remove();
    status.textContent = msg;
    status.setAttribute('role', 'alert');
  };
  if (maxBytes && file.size > maxBytes) {
    fail(`Ukuran lampiran maksimal ${Math.round(maxBytes / 1024 / 1024)} MB`);
    return;
  }
  const body = new FormData();
  body.append('file', file);
  fetch('/api/attachments', { method: 'POST', body })
    .then(async (res) => {
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) throw new Error(json.error || `Unggah gagal (${res.status})`);
      if (!chip.isConnected) {
        // Removed while uploading: discard the server copy too.
        fetch(`/api/attachments/${encodeURIComponent(json.data.id)}`, { method: 'DELETE' }).catch(() => {});
        return;
      }
      chip.classList.remove('is-uploading');
      chip.dataset.attId = json.data.id;
      chip.dataset.attName = json.data.fileName;
      chip.dataset.attSize = String(json.data.size || 0);
      label.textContent = `${json.data.fileName} (${Math.max(1, Math.round(json.data.size / 1024))} KB)`;
      progress.remove();
      status.textContent = '';
      const rf = list.closest('#new-ticket-form');
      if (rf instanceof HTMLFormElement) saveRequestDraft(rf);
    })
    .catch((err) => fail(err.message || 'Unggah gagal'));
}

/** Uploaded ids of a form, or null while an upload is still running. */
function formAttachmentIds(form) {
  if (form.querySelector('[data-att-list] .is-uploading')) return null;
  return Array.from(form.querySelectorAll('[data-att-list] [data-att-id]'), (el) => el.dataset.attId);
}

function filterPortalCatalog() {
  const input = document.getElementById('portal-catalog-search');
  const q = (input?.value || '').trim().toLowerCase();
  let visibleTotal = 0;

  document.querySelectorAll('[data-catalog-card]').forEach((card) => {
    const keywords = (card.dataset.keywords || '').toLowerCase();
    const textMatch = !q || (card.textContent || '').toLowerCase().includes(q) || keywords.includes(q);
    const match = textMatch;
    card.hidden = !match;
    if (match) visibleTotal++;
  });

  const countEl = document.getElementById('portal-catalog-count');
  if (countEl) countEl.textContent = String(visibleTotal);
  const emptyEl = document.getElementById('portal-catalog-empty');
  if (emptyEl) emptyEl.hidden = visibleTotal > 0;
}

// Queue selection & keyboard nav helpers
function getQueueRows() {
  return Array.from(document.querySelectorAll('[data-queue-row]'));
}

function updateBulkBar() {
  const checked = document.querySelectorAll('[data-select-id]:checked');
  const bar = document.getElementById('bulk-bar');
  if (!bar) return;
  bar.hidden = checked.length === 0;
  const countEl = document.getElementById('bulk-count');
  if (countEl) {
    const hasOuterSuffix = Array.from(countEl.parentElement?.childNodes || []).some(
      (n) => n !== countEl && n.textContent?.includes('tiket terpilih'),
    );
    countEl.textContent = hasOuterSuffix ? String(checked.length) : `${checked.length} tiket terpilih`;
  }
}

function navigateQueueFilter(key, value, resetPage = true) {
  const params = new URLSearchParams(location.search);
  if (!value) params.delete(key);
  else params.set(key, value);
  if (resetPage && key !== 'page') params.delete('page');
  const qs = params.toString();
  location.href = qs ? `/queue?${qs}` : '/queue';
}

const CMDK_STATUS_LABELS = {
  new: 'Baru',
  assigned: 'Ditugaskan',
  in_progress: 'Dikerjakan',
  pending: 'Menunggu',
  resolved: 'Selesai',
  closed: 'Ditutup',
  cancelled: 'Dibatalkan',
};

// Command palette search (debounced)
let cmdkTimer = null;
function renderCmdkResults(hits) {
  const box = document.getElementById('cmdk-results');
  if (!box) return;
  box.replaceChildren();
  if (!hits.length) {
    const empty = document.createElement('p');
    empty.className = 'cmdk-hint';
    empty.textContent = 'Tidak ada tiket yang cocok.';
    box.appendChild(empty);
    return;
  }
  const dlg = document.getElementById('dlg-cmdk');
  const isAgent =
    dlg?.dataset.isAgent === '1' ||
    document.querySelector('[data-is-agent="1"]') !== null;

  for (const hit of hits) {
    const a = document.createElement('a');
    a.href = isAgent
      ? `/tickets/${encodeURIComponent(hit.number)}`
      : `/portal/tickets/${encodeURIComponent(hit.number)}`;
    a.className = 'cmdk-item';
    const left = document.createElement('span');
    left.className = 'row';
    const num = document.createElement('span');
    num.className = 'mono text-accent';
    num.textContent = hit.number || '';
    const title = document.createElement('span');
    title.textContent = hit.title || '';
    left.append(num, title);

    const right = document.createElement('span');
    right.className = 'row';
    if (hit.priority) {
      const p = document.createElement('span');
      p.className = `badge badge-${hit.priority.toLowerCase()}`;
      p.textContent = hit.priority;
      right.appendChild(p);
    }
    if (hit.status) {
      const s = document.createElement('span');
      s.className = `pill pill-${hit.status}`;
      s.textContent = CMDK_STATUS_LABELS[hit.status] || hit.status;
      right.appendChild(s);
    }
    a.append(left, right);
    box.appendChild(a);
  }
}

const CSAT_LABELS = ['', '(Sangat Tidak Puas)', '(Tidak Puas)', '(Cukup)', '(Puas)', '(Sangat Puas)'];
const PRIORITY_MATRIX = {
  high: { high: 'P1', medium: 'P2', low: 'P3' },
  medium: { high: 'P2', medium: 'P3', low: 'P4' },
  low: { high: 'P3', medium: 'P4', low: 'P4' },
};

function activateTab(tabBtn, focus = false) {
  const group = tabBtn.closest('[data-tab-group]');
  if (!group) return;
  const name = tabBtn.dataset.tab;
  group.querySelectorAll('[data-tab]').forEach((t) => {
    const active = t === tabBtn;
    t.classList.toggle('is-active', active);
    t.setAttribute('aria-selected', String(active));
    t.setAttribute('tabindex', active ? '0' : '-1');
  });
  const scope = group.parentElement || document;
  scope.querySelectorAll('[data-tab-panel]').forEach((p) => {
    p.hidden = p.dataset.tabPanel !== name;
  });
  if (group.dataset.tabGroup === 'comment-mode') {
    const vis = document.getElementById('comment-visibility');
    if (vis) vis.value = name === 'internal' ? 'internal' : 'public';
  }
  if (group.hasAttribute('data-tab-hash') && location.hash !== `#${name}`) {
    history.replaceState(null, '', `#${name}`);
  }
  if (focus && tabBtn instanceof HTMLElement) tabBtn.focus();
}

// Tab groups with [data-tab-hash] remember the active tab in location.hash.
function activateTabFromHash() {
  const name = location.hash.slice(1);
  if (!name) return;
  document.querySelectorAll('[data-tab-group][data-tab-hash] [data-tab]').forEach((t) => {
    if (t.dataset.tab === name) activateTab(t);
  });
}
activateTabFromHash();
window.addEventListener('hashchange', activateTabFromHash);

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

function selectCsatStar(starBtn, focus = false) {
  const score = Number(starBtn.dataset.csatStar);
  const input = document.getElementById('csat-score');
  if (input) input.value = String(score);
  const wrap = starBtn.closest('.csat-stars') || document;
  wrap.querySelectorAll('[data-csat-star]').forEach((s) => {
    const val = Number(s.dataset.csatStar);
    const isSelected = val === score;
    s.classList.toggle('is-active', val <= score);
    s.setAttribute('aria-checked', String(isSelected));
    s.setAttribute('tabindex', isSelected ? '0' : '-1');
  });
  const lbl = document.getElementById('csat-label');
  if (lbl) lbl.textContent = CSAT_LABELS[score] || '';
  if (focus && starBtn instanceof HTMLElement) starBtn.focus();
}

// Event delegation: clicks
document.addEventListener('click', async (e) => {
  const target = e.target;
  if (!(target instanceof Element)) return;

  // Close open popovers when clicking outside
  document.querySelectorAll('details.popover[open]').forEach((pop) => {
    if (!pop.contains(target)) pop.removeAttribute('open');
  });

  // Backdrop click on <dialog>
  if (target instanceof HTMLDialogElement && target.open) {
    const r = target.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) {
      target.close();
      return;
    }
  }

  // Theme toggle
  if (target.closest('[data-theme-toggle]')) {
    const next = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
    applyTheme(next);
    localStorage.setItem(THEME_KEY, next);
    return;
  }

  // Dialog open/close
  const openBtn = target.closest('[data-open-dialog]');
  if (openBtn) {
    const dlg = document.getElementById(openBtn.dataset.openDialog);
    openDialog(dlg, openBtn);
    return;
  }
  const closeBtn = target.closest('[data-close-dialog]');
  if (closeBtn) {
    closeBtn.closest('dialog')?.close();
    return;
  }

  const closePop = target.closest('[data-close-popover]');
  if (closePop) {
    const pop = closePop.closest('details.popover');
    if (pop) {
      pop.removeAttribute('open');
      pop.querySelector('summary')?.focus();
    }
    return;
  }

  // Ticket conversation filter (Semua / Percakapan / Perubahan status)
  const convoBtn = target.closest('[data-convo-filter]');
  if (convoBtn) {
    const card = convoBtn.closest('.convo-card');
    const mode = convoBtn.dataset.convoFilter;
    card?.querySelectorAll('[data-convo-filter]').forEach((b) => {
      b.classList.toggle('is-active', b === convoBtn);
      b.setAttribute('aria-pressed', String(b === convoBtn));
    });
    card?.querySelector('[data-convo]')?.setAttribute('data-filter', mode);
    return;
  }

  // Tabs
  const tabBtn = target.closest('[data-tab]');
  if (tabBtn) {
    activateTab(tabBtn);
    return;
  }

  // Dashboard chart/table toggle
  const toggleBtn = target.closest('[data-toggle-pair]');
  if (toggleBtn) {
    const key = toggleBtn.dataset.togglePair;
    const chart = document.querySelector(`[data-view-chart="${CSS.escape(key)}"]`);
    const table = document.querySelector(`[data-view-table="${CSS.escape(key)}"]`);
    if (chart && table) {
      const showTable = table.hidden;
      table.hidden = !showTable;
      chart.hidden = showTable;
      toggleBtn.setAttribute('aria-pressed', String(showTable));
      const labelSpan = toggleBtn.querySelector('span');
      if (labelSpan) {
        const nextLabel = showTable ? toggleBtn.dataset.labelChart : toggleBtn.dataset.labelTable;
        if (nextLabel) labelSpan.textContent = nextLabel;
      }
    }
    return;
  }

  // Portal catalog search reset
  if (target.closest('#portal-search-reset')) {
    const input = document.getElementById('portal-catalog-search');
    if (input instanceof HTMLInputElement) {
      input.value = '';
      input.focus();
    }
    filterPortalCatalog();
    return;
  }

  const focusBtn = target.closest('[data-focus-target]');
  if (focusBtn) {
    const dest = document.getElementById(focusBtn.dataset.focusTarget);
    if (dest instanceof HTMLElement) {
      dest.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
      dest.focus({ preventScroll: true });
    }
    return;
  }

  // CSAT stars
  const starBtn = target.closest('[data-csat-star]');
  if (starBtn) {
    selectCsatStar(starBtn);
    return;
  }

  if (target.closest('#admin-user-reset')) {
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

  if (target.closest('#queue-refresh')) {
    refreshQueueInPlace();
    return;
  }

  // Attachment chip remove (also cancels the unlinked upload on the server)
  const rmAtt = target.closest('[data-att-remove]');
  if (rmAtt) {
    const chip = rmAtt.closest('li');
    const picker = rmAtt.closest('[data-att-picker]');
    if (chip?.dataset.attId) {
      fetch(`/api/attachments/${encodeURIComponent(chip.dataset.attId)}`, { method: 'DELETE' }).catch(() => {});
    }
    chip?.remove();
    const rf = picker?.closest('#new-ticket-form');
    if (rf instanceof HTMLFormElement) saveRequestDraft(rf);
    picker?.querySelector('[data-att-input]')?.focus();
    return;
  }

  // Demo user switcher button in user popover
  const switchBtn = target.closest('button[data-switch-user-id]');
  if (switchBtn) {
    switchBtn.disabled = true;
    try {
      const json = await apiFetch('/api/auth/switch', 'POST', { userId: switchBtn.dataset.switchUserId });
      location.href = json.data?.redirect || '/';
    } catch (err) {
      showToast(err.message, 'err');
      switchBtn.disabled = false;
    }
    return;
  }

  // Logout
  const logoutBtn = target.closest('button[data-logout]');
  if (logoutBtn) {
    logoutBtn.disabled = true;
    try {
      const json = await apiFetch('/api/auth/logout', 'POST', {});
      location.href = json.data?.redirect || '/login';
    } catch (err) {
      showToast(err.message, 'err');
      logoutBtn.disabled = false;
    }
    return;
  }

  // Notification read / read-all
  const notifOne = target.closest('[data-notif-read]');
  if (notifOne) {
    try {
      await apiFetch(`/api/notifications/${encodeURIComponent(notifOne.dataset.notifRead)}/read`, 'POST', {});
      notifOne.classList.add('muted');
      if (notifOne.dataset.reload === 'true') location.reload();
    } catch (err) { showToast(err.message, 'err'); }
    return;
  }
  const notifAll = target.closest('[data-notif-read-all]');
  if (notifAll) {
    try {
      await apiFetch('/api/notifications/read-all', 'POST', {});
      saveToastForReload('Semua notifikasi ditandai terbaca');
      location.reload();
    } catch (err) { showToast(err.message, 'err'); }
    return;
  }

  // Bulk assign apply
  const bulkBtn = target.closest('#bulk-apply');
  if (bulkBtn) {
    const ids = Array.from(document.querySelectorAll('[data-select-id]:checked')).map((c) => c.dataset.selectId || c.value);
    const sel = document.getElementById('bulk-assignee') || document.querySelector('#bulk-bar select');
    const assigneeId = sel?.value;
    if (!ids.length || !assigneeId) return showToast('Pilih tiket dan staff terlebih dahulu', 'err');
    bulkBtn.disabled = true;
    try {
      await apiFetch('/api/tickets/bulk-assign', 'POST', { ticketIds: ids, assigneeId });
      saveToastForReload(`${ids.length} tiket berhasil ditugaskan`);
      location.reload();
    } catch (err) {
      showToast(err.message, 'err');
      bulkBtn.disabled = false;
    }
    return;
  }

  // Admin SLA tick
  const slaBtn = target.closest('#sla-tick-run');
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

  // Generic API button
  const apiBtn = target.closest('button[data-api-btn]');
  if (apiBtn) {
    if (apiBtn.dataset.confirm && !(await confirmModal(apiBtn.dataset.confirm, apiBtn))) return;
    apiBtn.disabled = true;
    try {
      const body = apiBtn.dataset.body ? JSON.parse(apiBtn.dataset.body) : {};
      const json = await apiFetch(apiBtn.dataset.url, apiBtn.dataset.method || 'POST', body);
      if (apiBtn.dataset.redirect === 'response' && json.data?.redirect) {
        location.href = json.data.redirect;
      } else if (apiBtn.dataset.reload === 'true') {
        saveToastForReload(apiBtn.dataset.successMsg || 'Berhasil');
        location.reload();
      } else {
        showToast(apiBtn.dataset.successMsg || 'Berhasil', 'ok');
      }
    } catch (err) {
      showToast(err.message, 'err');
    } finally {
      apiBtn.disabled = false;
    }
    return;
  }

  // Clickable queue rows
  const queueRow = target.closest('tr[data-queue-row][data-href]');
  if (queueRow && !target.closest('a, button, input, select, label')) {
    location.href = queueRow.dataset.href;
  }
});

// ---------------------------------------------------------------------------
// New IT request form (v2): reveal "Others" inputs, per-service fields,
// auto-title, adaptive description guidance, live summary / progress.
// ---------------------------------------------------------------------------
function setRevealed(container, show) {
  if (!container) return;
  container.hidden = !show;
  container.querySelectorAll('input, select, textarea').forEach((input) => {
    input.disabled = !show;
  });
}

function checkedValue(form, name) {
  const el = form.querySelector(`input[name="${CSS.escape(name)}"]:checked`);
  return el instanceof HTMLInputElement ? el : null;
}

function fieldValue(form, name) {
  const el = form.elements.namedItem(name);
  return el && 'value' in el && !el.disabled ? String(el.value).trim() : '';
}

function syncRequestForm(form, changedName) {
  if (!(form instanceof HTMLFormElement)) return;
  const service = checkedValue(form, 'catalogItemId');
  const type = checkedValue(form, 'formData.service_request_type');

  if (!changedName || changedName === 'catalogItemId') {
    const serviceId = service?.value || '';
    setRevealed(form.querySelector('[data-reveal="service-other"]'), serviceId === 'cat-item-others');
    form.querySelectorAll('[data-service-fields]').forEach((group) => {
      setRevealed(group, group.getAttribute('data-service-fields') === serviceId);
    });
  }

  if (!changedName || changedName === 'formData.service_request_type') {
    setRevealed(form.querySelector('[data-reveal="type-other"]'), type?.value === 'Others');
    const desc = form.querySelector('#description');
    const hint = form.querySelector('[data-desc-hint-text]');
    if (type && desc instanceof HTMLTextAreaElement && type.dataset.descPlaceholder) {
      desc.placeholder = type.dataset.descPlaceholder;
    }
    if (type && hint && type.dataset.descHint) hint.textContent = type.dataset.descHint;
  }

  if (changedName === 'catalogItemId' || changedName === 'formData.service_request_type') {
    const titleEl = form.querySelector('#title');
    if (titleEl instanceof HTMLInputElement && titleEl.dataset.autoTitle !== 'false') {
      const svcName = service?.dataset.serviceName || '';
      titleEl.value = svcName && type ? `${svcName} — ${type.value}` : svcName;
      titleEl.dataset.autoTitle = 'true';
    }
  }

  updateRequestSummary(form);
}

function updateRequestSummary(form) {
  if (!(form instanceof HTMLFormElement)) return;
  const service = checkedValue(form, 'catalogItemId');
  const type = checkedValue(form, 'formData.service_request_type');
  const urgency = checkedValue(form, 'urgency');
  const ack = form.querySelector('input[name="requesterAck"]');
  const serviceOther = fieldValue(form, 'formData.service_other');
  const typeOther = fieldValue(form, 'formData.request_type_other');
  const hodName = fieldValue(form, 'formData.hod_name');
  const title = fieldValue(form, 'title');
  const description = fieldValue(form, 'description');
  const acked = ack instanceof HTMLInputElement && ack.checked;

  const done = {
    1: !!service && (service.value !== 'cat-item-others' || serviceOther.length > 0),
    2: !!type && !!urgency && (type.value !== 'Others' || typeOther.length > 0),
    3: title.length >= 5 && description.length >= 10,
    4: hodName.length > 0 && acked,
  };

  const setText = (key, text) => {
    const el = form.querySelector(`[data-rf-sum="${key}"]`);
    if (el) el.textContent = text;
  };
  const svcLabel = service
    ? (service.value === 'cat-item-others' && serviceOther ? `Others: ${serviceOther}` : service.dataset.serviceName || service.value)
    : '—';
  setText('service', svcLabel);
  setText('type', type ? (type.value === 'Others' && typeOther ? `Others: ${typeOther}` : type.value) : '—');
  setText('urgency', urgency?.dataset.urgencyLabel || '—');
  setText('hod', hodName || '—');
  setText('ack', acked ? `Dikonfirmasi · ${form.dataset.todayLabel || ''}`.trim() : 'Belum dikonfirmasi');
  form.querySelector('[data-rf-sum="ack"]')?.classList.toggle('is-ok', acked);

  let count = 0;
  for (const step of [1, 2, 3, 4]) {
    if (done[step]) count++;
    form.querySelector(`[data-rf-section="${step}"]`)?.classList.toggle('is-done', done[step]);
    form.querySelector(`[data-rf-check="${step}"]`)?.classList.toggle('is-done', done[step]);
  }
  form.querySelectorAll('[data-rf-progress-text]').forEach((el) => {
    el.textContent = `${count} dari 4 bagian lengkap`;
  });
  const bar = form.querySelector('[data-rf-progress-bar]');
  if (bar instanceof HTMLElement) bar.style.width = `${(count / 4) * 100}%`;
}

function clearRequestErrors(form) {
  form.querySelectorAll('.rf-section.has-error').forEach((s) => s.classList.remove('has-error'));
  form.querySelectorAll('.field.has-error').forEach((f) => f.classList.remove('has-error'));
  form.querySelectorAll('[data-section-error]').forEach((el) => {
    el.textContent = '';
    el.hidden = true;
  });
}

function validateRequestForm(form) {
  clearRequestErrors(form);
  const errors = [];
  const addErr = (secNum, msg, focusEl, fieldEl) => {
    errors.push({ secNum, msg, focusEl });
    const sec = form.querySelector(`[data-rf-section="${secNum}"]`);
    sec?.classList.add('has-error');
    if (fieldEl) fieldEl.classList.add('has-error');
    const errEl = form.querySelector(`[data-section-error="${secNum}"]`);
    if (errEl && !errEl.textContent) {
      errEl.textContent = msg;
      errEl.hidden = false;
    }
  };

  const service = checkedValue(form, 'catalogItemId');
  if (!service) {
    addErr(1, 'Pilih salah satu layanan IT yang tersedia.', form.querySelector('input[name="catalogItemId"]'));
  } else if (service.value === 'cat-item-others' && !fieldValue(form, 'formData.service_other')) {
    const el = form.elements.namedItem('formData.service_other');
    addErr(1, 'Sebutkan layanan lainnya yang Anda maksud.', el, el?.closest('.field'));
  }

  const type = checkedValue(form, 'formData.service_request_type');
  if (!type) {
    addErr(2, 'Pilih jenis permintaan Anda.', form.querySelector('input[name="formData.service_request_type"]'));
  } else if (type.value === 'Others' && !fieldValue(form, 'formData.request_type_other')) {
    const el = form.elements.namedItem('formData.request_type_other');
    addErr(2, 'Sebutkan jenis permintaan lainnya.', el, el?.closest('.field'));
  }
  if (!checkedValue(form, 'urgency')) {
    addErr(2, 'Pilih tingkat urgensi permintaan.', form.querySelector('input[name="urgency"]'));
  }

  for (const reqField of form.querySelectorAll('[data-service-fields]:not([hidden]) [required]:not(:disabled)')) {
    if (!String(reqField.value || '').trim()) {
      addErr(3, 'Lengkapi info tambahan layanan yang wajib diisi.', reqField, reqField.closest('.field'));
      break;
    }
  }
  const titleEl = form.querySelector('#title');
  if (titleEl instanceof HTMLInputElement && titleEl.value.trim().length < 5) {
    addErr(3, 'Ringkasan singkat minimal 5 karakter.', titleEl, titleEl.closest('.field'));
  }
  const descEl = form.querySelector('#description');
  if (descEl instanceof HTMLTextAreaElement && descEl.value.trim().length < 10) {
    addErr(3, 'Deskripsi masalah/kebutuhan minimal 10 karakter.', descEl, descEl.closest('.field'));
  }

  const hodEl = form.querySelector('#fd-hod-name');
  if (hodEl instanceof HTMLInputElement && !hodEl.value.trim()) {
    addErr(4, 'Masukkan nama atasan (HOD).', hodEl, hodEl.closest('.field'));
  }
  const ackEl = form.querySelector('input[name="requesterAck"]');
  if (ackEl instanceof HTMLInputElement && !ackEl.checked) {
    addErr(4, 'Centang pernyataan konfirmasi pemohon sebelum mengirim.', ackEl);
  }

  if (errors.length) {
    const first = errors[0];
    setFormError(form, `Ada ${errors.length} bagian yang belum lengkap: ${first.msg}`);
    const sec = form.querySelector(`[data-rf-section="${first.secNum}"]`);
    sec?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'nearest' });
    if (first.focusEl instanceof HTMLElement) first.focusEl.focus({ preventScroll: true });
    return false;
  }
  return true;
}

function saveRequestDraft(form) {
  try {
    const data = serializeForm(form);
    delete data.requesterAck;
    data._attachments = Array.from(form.querySelectorAll('[data-att-list] [data-att-id]'), (el) => ({
      id: el.dataset.attId,
      name: el.dataset.attName || el.querySelector('.att-chip-name')?.textContent || 'Lampiran',
      size: Number(el.dataset.attSize || 0),
    }));
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(data));
  } catch { /* ignore */ }
}

function restoreRequestDraft(form) {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    const draft = JSON.parse(raw);
    if (!draft || typeof draft !== 'object') return;
    const params = new URLSearchParams(location.search);
    if (!params.has('service') && draft.catalogItemId) {
      const r = form.querySelector(`input[name="catalogItemId"][value="${CSS.escape(draft.catalogItemId)}"]`);
      if (r instanceof HTMLInputElement) r.checked = true;
    }
    if (!params.has('type') && draft['formData.service_request_type']) {
      const r = form.querySelector(`input[name="formData.service_request_type"][value="${CSS.escape(draft['formData.service_request_type'])}"]`);
      if (r instanceof HTMLInputElement) r.checked = true;
    }
    syncRequestForm(form);
    for (const [k, v] of Object.entries(draft)) {
      if (k === '_attachments' || k === 'catalogItemId' || k === 'formData.service_request_type' || typeof v !== 'string') continue;
      const el = form.elements.namedItem(k);
      if (el instanceof HTMLInputElement && el.type === 'radio') {
        const r = form.querySelector(`input[name="${CSS.escape(k)}"][value="${CSS.escape(v)}"]`);
        if (r instanceof HTMLInputElement) r.checked = true;
      } else if (
        (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) &&
        !el.disabled
      ) {
        if (k === 'title' && el.value.trim()) continue;
        el.value = v;
        if (k === 'title' && v.trim()) el.dataset.autoTitle = 'false';
      }
    }
    if (Array.isArray(draft._attachments)) {
      const list = form.querySelector('[data-att-list]');
      if (list) {
        for (const att of draft._attachments) {
          if (!att?.id || list.querySelector(`[data-att-id="${CSS.escape(att.id)}"]`)) continue;
          const chip = document.createElement('li');
          chip.className = 'att-chip';
          chip.dataset.attId = att.id;
          chip.dataset.attName = att.name;
          chip.dataset.attSize = String(att.size || 0);
          const lbl = document.createElement('span');
          lbl.className = 'att-chip-name';
          lbl.textContent = att.size ? `${att.name} (${Math.max(1, Math.round(att.size / 1024))} KB)` : att.name;
          const rm = document.createElement('button');
          rm.type = 'button';
          rm.className = 'btn btn-ghost btn-sm';
          rm.dataset.attRemove = '';
          rm.setAttribute('aria-label', `Hapus ${att.name}`);
          rm.textContent = '×';
          chip.append(lbl, rm);
          list.appendChild(chip);
        }
      }
    }
    const desc = form.querySelector('#description');
    if (desc instanceof HTMLTextAreaElement) {
      desc.dispatchEvent(new Event('input', { bubbles: true }));
    }
    updateRequestSummary(form);
  } catch { /* ignore */ }
}

// Event delegation: submit (approve token confirm + generic API forms + dynamic new-ticket form)
document.addEventListener('submit', async (e) => {
  const form = e.target;
  if (!(form instanceof HTMLFormElement)) return;

  if (form.matches('[data-approve-form]') && form.dataset.confirmed !== '1') {
    e.preventDefault();
    setFormError(form, '');
    const decision = e.submitter instanceof HTMLButtonElement ? e.submitter.value : 'approve';
    const note = String(form.querySelector('[name="note"]')?.value || '').trim();
    if (decision === 'reject' && note.length < 3) {
      setFormError(form, 'Harap isi alasan penolakan minimal 3 karakter sebelum menolak.');
      form.querySelector('[name="note"]')?.focus();
      return;
    }
    const msg = decision === 'reject'
      ? 'Tolak permintaan IT ini? Tindakan tidak dapat dibatalkan.'
      : 'Setujui permintaan IT ini? Link persetujuan hanya berlaku satu kali.';
    if (!(await confirmModal(msg, e.submitter))) return;
    let hiddenDec = form.querySelector('input[data-apr-decision]');
    if (!hiddenDec) {
      hiddenDec = document.createElement('input');
      hiddenDec.type = 'hidden';
      hiddenDec.name = 'decision';
      hiddenDec.dataset.aprDecision = '1';
      form.appendChild(hiddenDec);
    }
    hiddenDec.value = decision;
    form.dataset.confirmed = '1';
    form.submit();
    return;
  }

  if (form.id === 'new-ticket-form') {
    e.preventDefault();
    setFormError(form, '');
    if (!validateRequestForm(form)) return;
    const submitBtn = form.querySelector('[type="submit"]');
    setSubmitBusy(submitBtn, true);
    try {
      const raw = serializeForm(form);
      const formData = {};
      for (const [k, v] of Object.entries(raw)) {
        if (k.startsWith('formData.') && typeof v === 'string') formData[k.slice(9)] = v.trim();
      }
      if (raw.requesterAck === true) {
        const who = form.dataset.requesterName || 'pemohon';
        const when = form.dataset.todayLabel || new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
        formData.requester_ack = `Dikonfirmasi oleh ${who} pada ${when}`;
      }
      const payload = {
        catalogItemId: raw.catalogItemId,
        title: String(raw.title || '').trim(),
        description: String(raw.description || '').trim(),
        urgency: raw.urgency || 'medium',
        formData,
        attachmentIds: formAttachmentIds(form),
      };
      if (!payload.attachmentIds) throw new Error('Tunggu hingga semua lampiran selesai diunggah');
      const json = await apiFetch('/api/tickets', 'POST', payload);
      try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
      saveToastForReload('Pengajuan tiket berhasil dikirim', 'ok');
      location.href = `/portal/tickets/${encodeURIComponent(json.data.number)}`;
    } catch (err) {
      setFormError(form, err.message);
      setSubmitBusy(submitBtn, false);
    }
    return;
  }

  if (!form.matches('[data-api-form]')) return;
  e.preventDefault();
  setFormError(form, '');
  const submitBtn = form.querySelector('[type="submit"]');
  setSubmitBusy(submitBtn, true);
  try {
    const method = (form.getAttribute('method') || 'POST').toUpperCase();
    const action = form.getAttribute('action') || location.pathname;
    const payload = serializeForm(form);
    if (form.querySelector('[data-att-picker]')) {
      payload.attachmentIds = formAttachmentIds(form);
      if (!payload.attachmentIds) throw new Error('Tunggu hingga semua lampiran selesai diunggah');
    }
    const json = await apiFetch(action, method, payload);
    if (form.dataset.redirect === 'response' && json.data?.redirect) {
      location.href = json.data.redirect;
    } else if (form.dataset.redirectTicket === 'true' && json.data?.number) {
      location.href = `/portal/tickets/${encodeURIComponent(json.data.number)}`;
    } else if (form.dataset.reload === 'true') {
      saveToastForReload(form.dataset.successMsg || 'Berhasil disimpan');
      location.reload();
    } else {
      showToast(form.dataset.successMsg || 'Berhasil disimpan', 'ok');
      form.closest('dialog')?.close();
    }
  } catch (err) {
    setFormError(form, err.message);
  } finally {
    setSubmitBusy(submitBtn, false);
  }
});

// Event delegation: change & input
document.addEventListener('change', async (e) => {
  const el = e.target;
  if (!(el instanceof HTMLElement)) return;

  if (el.matches('select[data-admin-user-filter]')) {
    filterAdminUsers();
    return;
  }

  if (el.matches('select[data-switch-user]')) {
    try {
      const json = await apiFetch('/api/auth/switch', 'POST', { userId: el.value });
      location.href = json.data?.redirect || '/';
    } catch (err) { showToast(err.message, 'err'); }
    return;
  }

  if (el.matches('[data-att-input]') && el instanceof HTMLInputElement && el.files) {
    const list = el.closest('[data-att-picker]')?.querySelector('[data-att-list]');
    if (list) {
      for (const f of el.files) uploadAttachment(list, f, Number(el.dataset.maxBytes) || 0);
    }
    el.value = '';
    return;
  }

  if (el instanceof HTMLInputElement && el.closest('#new-ticket-form')) {
    const rf = el.closest('#new-ticket-form');
    if (rf instanceof HTMLFormElement) {
      syncRequestForm(rf, el.name);
      clearRequestErrors(rf);
      saveRequestDraft(rf);
    }
    if (['catalogItemId', 'formData.service_request_type', 'urgency', 'requesterAck'].includes(el.name)) return;
  }

  if (el.id === 'impact-select' || el.id === 'urgency-select') {
    const impact = document.getElementById('impact-select')?.value;
    const urgency = document.getElementById('urgency-select')?.value;
    const badge = document.getElementById('classify-preview-badge');
    if (badge && impact && urgency) {
      const prio = PRIORITY_MATRIX[impact]?.[urgency] || 'P4';
      badge.textContent = prio;
      badge.className = `badge badge-${prio.toLowerCase()}`;
    }
    return;
  }

  if (el.matches('[data-select-all]')) {
    const checked = el.checked;
    document.querySelectorAll('[data-select-id]').forEach((cb) => { cb.checked = checked; });
    updateBulkBar();
    return;
  }

  if (el.matches('[data-select-id]')) {
    updateBulkBar();
    return;
  }

  if (el.matches('select[data-queue-filter], input[type="checkbox"][data-queue-filter], input[type="search"][data-queue-filter]')) {
    const val = el instanceof HTMLInputElement && el.type === 'checkbox'
      ? (el.checked ? el.value || 'true' : '')
      : el.value.trim();
    navigateQueueFilter(el.dataset.queueFilter || el.name, val);
  }
});

document.addEventListener('input', (e) => {
  const el = e.target;
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;

  if (el.id === 'title' && el instanceof HTMLInputElement) {
    // Typing takes over the title; clearing it hands control back to auto-fill.
    el.dataset.autoTitle = el.value.trim() === '' ? 'true' : 'false';
    const rf = el.closest('#new-ticket-form');
    if (rf instanceof HTMLFormElement) {
      clearRequestErrors(rf);
      updateRequestSummary(rf);
      saveRequestDraft(rf);
    }
    return;
  }

  if (el.id === 'description') {
    const counter = document.querySelector('[data-char-count="description"]');
    if (counter) {
      const len = el.value.trim().length;
      counter.textContent = len < 10 ? `${len} karakter (min. 10)` : `${len} karakter`;
      counter.classList.toggle('is-ok', len >= 10);
    }
    const rf = el.closest('#new-ticket-form');
    if (rf instanceof HTMLFormElement) {
      clearRequestErrors(rf);
      updateRequestSummary(rf);
      saveRequestDraft(rf);
    }
    return;
  }

  if (el.closest('#new-ticket-form')) {
    const rf = el.closest('#new-ticket-form');
    if (rf instanceof HTMLFormElement) {
      clearRequestErrors(rf);
      updateRequestSummary(rf);
      saveRequestDraft(rf);
    }
    return;
  }

  if (!(el instanceof HTMLInputElement)) return;

  if (el.id === 'cmdk-input') {
    clearTimeout(cmdkTimer);
    const q = el.value.trim();
    const box = document.getElementById('cmdk-results');
    if (q.length < 2) {
      if (box) {
        box.replaceChildren();
        const hint = document.createElement('p');
        hint.className = 'cmdk-hint';
        hint.textContent = 'Ketik minimal 2 karakter untuk mencari tiket.';
        box.appendChild(hint);
      }
      return;
    }
    cmdkTimer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const json = await res.json().catch(() => ({}));
        const hits = json.data?.hits ?? json.hits ?? (Array.isArray(json.data) ? json.data : []);
        renderCmdkResults(hits);
      } catch { /* ignore */ }
    }, 200);
    return;
  }

  if (el.id === 'portal-catalog-search') {
    filterPortalCatalog();
  }

  if (el.matches('[data-admin-user-filter]')) filterAdminUsers();
});

// Dropzone drag-over feedback
document.addEventListener('dragover', (e) => {
  const dz = e.target instanceof Element ? e.target.closest('.dropzone') : null;
  if (dz) dz.classList.add('is-dragover');
});
document.addEventListener('dragleave', (e) => {
  const dz = e.target instanceof Element ? e.target.closest('.dropzone') : null;
  if (dz) dz.classList.remove('is-dragover');
});
document.addEventListener('drop', (e) => {
  const dz = e.target instanceof Element ? e.target.closest('.dropzone') : null;
  if (dz) dz.classList.remove('is-dragover');
});

// Keyboard shortcuts: Ctrl/Cmd+K, Escape popovers, WAI-ARIA Tabs & CSAT, Queue j/k/x/Enter
let focusedIdx = -1;
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const openPopovers = document.querySelectorAll('details.popover[open]');
    if (openPopovers.length) {
      let summaryToFocus = null;
      openPopovers.forEach((p) => {
        if (p.contains(document.activeElement) || !summaryToFocus) {
          summaryToFocus = p.querySelector('summary');
        }
        p.removeAttribute('open');
      });
      summaryToFocus?.focus();
    }
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    const dlg = document.getElementById('dlg-cmdk');
    if (dlg instanceof HTMLDialogElement) {
      e.preventDefault();
      if (dlg.open) dlg.close();
      else openDialog(dlg, document.activeElement);
    }
    return;
  }

  const target = e.target;
  if (target instanceof HTMLInputElement && target.matches('input[type="search"][data-queue-filter]') && e.key === 'Enter') {
    e.preventDefault();
    navigateQueueFilter(target.dataset.queueFilter || target.name, target.value.trim());
    return;
  }

  const tabTarget = target instanceof Element ? target.closest('[data-tab]') : null;
  if (tabTarget && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    const group = tabTarget.closest('[data-tab-group]');
    if (group) {
      e.preventDefault();
      const tabs = Array.from(group.querySelectorAll('[data-tab]'));
      const idx = tabs.indexOf(tabTarget);
      if (idx !== -1 && tabs.length) {
        const delta = e.key === 'ArrowRight' ? 1 : -1;
        const next = tabs[(idx + delta + tabs.length) % tabs.length];
        if (next) activateTab(next, true);
      }
      return;
    }
  }

  const starTarget = target instanceof Element ? target.closest('[data-csat-star]') : null;
  if (starTarget && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
    e.preventDefault();
    const wrap = starTarget.closest('.csat-stars') || document;
    const stars = Array.from(wrap.querySelectorAll('[data-csat-star]'));
    const idx = stars.indexOf(starTarget);
    if (idx !== -1 && stars.length) {
      const delta = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : -1;
      const next = stars[(idx + delta + stars.length) % stars.length];
      if (next) selectCsatStar(next, true);
    }
    return;
  }

  if (
    target instanceof HTMLElement &&
    (target.matches('input, textarea, select, [contenteditable]') || target.closest('dialog[open]'))
  ) return;

  const rows = getQueueRows();
  if (!rows.length) return;

  if (e.key === 'j' || e.key === 'ArrowDown') {
    e.preventDefault();
    focusedIdx = Math.min(rows.length - 1, focusedIdx + 1);
  } else if (e.key === 'k' || e.key === 'ArrowUp') {
    e.preventDefault();
    focusedIdx = Math.max(0, focusedIdx - 1);
  } else if (e.key === 'x' && focusedIdx >= 0 && rows[focusedIdx]) {
    const cb = rows[focusedIdx].querySelector('[data-select-id]');
    if (cb) {
      cb.checked = !cb.checked;
      updateBulkBar();
    }
    return;
  } else if (e.key === 'Enter' && focusedIdx >= 0 && rows[focusedIdx]) {
    const row = rows[focusedIdx];
    const num = row.dataset.ticketNumber;
    const href = row.dataset.href || (num ? `/tickets/${num}` : null);
    if (href) location.href = href;
    return;
  } else {
    return;
  }

  const activeRow = rows[focusedIdx];
  rows.forEach((r, i) => r.classList.toggle('is-focused', i === focusedIdx));
  activeRow?.scrollIntoView({ block: 'nearest' });
  const announcer = document.getElementById('sr-announcer');
  if (announcer && activeRow) {
    const num = activeRow.querySelector('.link-accent')?.textContent?.trim() || '';
    const title = activeRow.querySelector('.ticket-cell-title')?.textContent?.trim() || '';
    announcer.textContent = `${num} ${title}`.trim();
  }
});

// Partial queue refresh (preserves scroll position and j/k row focus)
async function refreshQueueInPlace() {
  try {
    const res = await fetch(location.href, { headers: { 'X-Requested-With': 'fetch' } });
    if (!res.ok) return;
    const htmlText = await res.text();
    const doc = new DOMParser().parseFromString(htmlText, 'text/html');
    const curTbody = document.querySelector('.queue-table tbody');
    const nextTbody = doc.querySelector('.queue-table tbody');
    if (!curTbody || !nextTbody) {
      location.reload();
      return;
    }
    curTbody.replaceWith(nextTbody);
    const curCards = document.querySelector('.mobile-cards');
    const nextCards = doc.querySelector('.mobile-cards');
    if (curCards && nextCards) curCards.replaceWith(nextCards);
    const curTotal = document.querySelector('.toolbar-meta strong');
    const nextTotal = doc.querySelector('.toolbar-meta strong');
    if (curTotal && nextTotal) curTotal.textContent = nextTotal.textContent;
    const curNav = document.querySelector('.sidebar-nav');
    const nextNav = doc.querySelector('.sidebar-nav');
    if (curNav && nextNav) curNav.replaceWith(nextNav);
    const rows = getQueueRows();
    if (focusedIdx >= 0 && rows.length) {
      focusedIdx = Math.min(focusedIdx, rows.length - 1);
      rows[focusedIdx]?.classList.add('is-focused');
    }
    tickLiveSla();
  } catch { /* ignore transient network error */ }
}

// Auto-refresh queue every 30s if idle (no selection, no open modal, no open popover, no focused input)
if (location.pathname === '/queue') {
  setInterval(() => {
    const hasSelection = document.querySelector('[data-select-id]:checked');
    const hasDialog = document.querySelector('dialog[open]');
    const hasPopover = document.querySelector('details.popover[open]');
    const typing = document.activeElement?.matches('input, textarea, select');
    if (!hasSelection && !hasDialog && !hasPopover && !typing) refreshQueueInPlace();
  }, 30_000);
}


// Structured Admin SLA Tick renderer (zero innerHTML)
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

// Live SLA countdown & progress ticker (Asia/Jakarta UTC+7, Mon-Fri 08:00-12:00 & 13:00-17:00)
const HOLIDAYS = new Set((document.body?.dataset.holidays || '').split(',').filter(Boolean));
const JKT_OFFSET_MS = 7 * 60 * 60_000;
const DAY_MS = 86_400_000;

function isWorkDayJkt(dayIdx) {
  const dow = (dayIdx + 4) % 7; // 1970-01-01 was Thursday (4)
  if (dow === 0 || dow === 6) return false;
  if (!HOLIDAYS.size) return true;
  const iso = new Date(dayIdx * DAY_MS).toISOString().slice(0, 10);
  return !HOLIDAYS.has(iso);
}

function overlapMinutes(aStart, aEnd, bStart, bEnd) {
  const s = Math.max(aStart, bStart);
  const e = Math.min(aEnd, bEnd);
  return e > s ? (e - s) / 60_000 : 0;
}

function elapsedSlaMinutes(fromMs, toMs, calKind) {
  if (toMs <= fromMs) return 0;
  if (calKind !== 'business_hours') return (toMs - fromMs) / 60_000;
  const startJkt = fromMs + JKT_OFFSET_MS;
  const endJkt = toMs + JKT_OFFSET_MS;
  const startDay = Math.floor(startJkt / DAY_MS);
  const endDay = Math.floor((endJkt - 1) / DAY_MS);
  let mins = 0;
  for (let d = startDay; d <= endDay; d++) {
    if (!isWorkDayJkt(d)) continue;
    if (d > startDay && d < endDay) {
      mins += 480;
      continue;
    }
    const dayBase = d * DAY_MS;
    const segStart = Math.max(startJkt, dayBase);
    const segEnd = Math.min(endJkt, dayBase + DAY_MS);
    mins += overlapMinutes(segStart, segEnd, dayBase + 480 * 60_000, dayBase + 720 * 60_000);
    mins += overlapMinutes(segStart, segEnd, dayBase + 780 * 60_000, dayBase + 1020 * 60_000);
  }
  return mins;
}

function formatSlaRem(minutes, calKind) {
  const suffix = calKind === 'business_hours' ? ' kerja' : '';
  const abs = Math.abs(minutes);
  if (abs < 1) return '<1m';
  if (abs < 60) return `${Math.round(abs)}m${suffix}`;
  const hrs = Math.floor(abs / 60);
  const rem = Math.round(abs % 60);
  if (calKind === 'business_hours') {
    if (hrs < 8) return rem > 0 ? `${hrs}j ${rem}m kerja` : `${hrs}j kerja`;
    const d = Math.floor(hrs / 8), rh = hrs % 8;
    return rh > 0 ? `${d}h ${rh}j kerja` : `${d} hari kerja`;
  }
  if (hrs < 24) return rem > 0 ? `${hrs}j ${rem}m` : `${hrs}j`;
  const d = Math.floor(hrs / 24), rh = hrs % 24;
  return rh > 0 ? `${d}h ${rh}j` : `${d} hari`;
}

function tickLiveSla() {
  const nodes = document.querySelectorAll('[data-sla-live]');
  if (!nodes.length) return;
  const nowMs = Date.now();
  const updates = [];
  for (const el of nodes) {
    const renderedAt = Number(el.dataset.renderedAt || 0);
    const baseRem = Number(el.dataset.remaining || 0);
    const target = Number(el.dataset.target || 0);
    const calKind = el.dataset.calKind || 'business_hours';
    if (!renderedAt || !target) continue;

    const delta = elapsedSlaMinutes(renderedAt, nowMs, calKind);
    const rem = baseRem - delta;
    const pct = Math.max(0, ((target - rem) / target) * 100);
    const breached = rem <= 0;
    const atRisk = !breached && pct >= 75;
    updates.push({
      el,
      kind: el.dataset.slaLive,
      calKind,
      rem,
      pct,
      breached,
      atRisk,
      txtEl: el.dataset.slaLive === 'badge' ? el.querySelector('[data-sla-text]') : null,
      fill: el.dataset.slaLive === 'bar' ? el.querySelector('.sla-bar-fill') : null,
    });
  }

  for (const u of updates) {
    if (u.kind === 'badge') {
      if (u.txtEl) {
        u.txtEl.textContent = u.breached
          ? (Math.abs(u.rem) >= 1 ? `Lewat ${formatSlaRem(Math.abs(u.rem), u.calKind)}` : 'Terlewati')
          : formatSlaRem(u.rem, u.calKind);
      }
      u.el.classList.remove('sla-normal', 'sla-risk', 'sla-breach');
      u.el.classList.add(u.breached ? 'sla-breach' : u.atRisk ? 'sla-risk' : 'sla-normal');
    } else if (u.kind === 'bar') {
      const clamped = Math.min(100, Math.max(0, u.pct));
      u.el.setAttribute('aria-valuenow', String(Math.round(u.pct)));
      u.el.title = `${Math.round(u.pct)}% waktu SLA terpakai`;
      if (u.fill) {
        u.fill.style.width = `${clamped}%`;
        u.fill.classList.remove('is-ok', 'is-risk', 'is-breach');
        u.fill.classList.add(u.breached ? 'is-breach' : u.atRisk ? 'is-risk' : 'is-ok');
      }
    }
  }
}

if (document.querySelector('[data-sla-live]')) {
  tickLiveSla();
  setInterval(tickLiveSla, 15_000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) tickLiveSla();
  });
}

// Initialise the new IT request form (preselected service/type from URL + draft restore).
{
  const rf = document.getElementById('new-ticket-form');
  if (rf instanceof HTMLFormElement && rf.querySelector('input[name="catalogItemId"]')) {
    syncRequestForm(rf);
    restoreRequestDraft(rf);
  }
}

// === Admin calendar & SLA === (target SLA editor, hapus & impor hari libur; event delegation)
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

document.addEventListener('input', (e) => {
  const row = e.target instanceof HTMLElement ? e.target.closest('[data-sla-row]') : null;
  if (row) refreshSlaPreview(row);
  if (e.target instanceof HTMLElement && e.target.matches('[data-holiday-import-text]')) {
    const box = e.target.closest('[data-holiday-import]');
    const save = box?.querySelector('[data-holiday-import-save]');
    if (save) save.disabled = true; // teks berubah: wajib pratinjau ulang
  }
});
document.addEventListener('change', (e) => {
  const row = e.target instanceof HTMLElement ? e.target.closest('[data-sla-row]') : null;
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
  setFormError(box, '');
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
      location.reload();
    }
  } catch (err) {
    setFormError(box, err.message);
  }
});

// Interactive Dashboard Charts: hover (mouse), tap (mobile touch), and keyboard focus tooltips
function hideChartTip(stage) {
  if (!stage) return;
  const tip = stage.querySelector('[data-chart-tooltip]');
  if (tip) tip.hidden = true;
  stage.querySelectorAll('.chart-hit.is-active, .chart-group.is-active').forEach((el) => {
    el.classList.remove('is-active');
  });
}

function showChartTip(hit) {
  const stage = hit.closest('[data-chart-stage]');
  const tip = stage?.querySelector('[data-chart-tooltip]');
  if (!stage || !tip) return;
  stage.querySelectorAll('.chart-hit.is-active, .chart-group.is-active').forEach((el) => {
    el.classList.remove('is-active');
  });
  hit.classList.add('is-active');
  hit.closest('.chart-group')?.classList.add('is-active');

  const title = hit.getAttribute('data-chart-tip-title') || '';
  const rawRows = hit.getAttribute('data-chart-tip-rows') || '';
  tip.replaceChildren();
  if (title) {
    const h = document.createElement('div');
    h.className = 'chart-tip-title';
    h.textContent = title;
    tip.appendChild(h);
  }
  const list = document.createElement('div');
  list.className = 'chart-tip-rows';
  for (const part of rawRows.split(';;').filter(Boolean)) {
    const [label, val, tone] = part.split('|');
    const row = document.createElement('div');
    row.className = 'chart-tip-row';
    const left = document.createElement('span');
    left.className = 'chart-tip-label';
    if (tone) {
      const dot = document.createElement('span');
      dot.className = `chart-tip-dot tone-${tone}`;
      left.appendChild(dot);
    }
    const lbl = document.createElement('span');
    lbl.textContent = label || '';
    left.appendChild(lbl);
    const right = document.createElement('span');
    right.className = 'chart-tip-val';
    right.textContent = val || '';
    row.append(left, right);
    list.appendChild(row);
  }
  tip.appendChild(list);
  tip.hidden = false;

  const announcer = document.getElementById('sr-announcer');
  if (announcer) {
    const summary = Array.from(list.querySelectorAll('.chart-tip-row')).map((r) => r.textContent).join(', ');
    announcer.textContent = `${title}: ${summary}`.trim();
  }

  const stageRect = stage.getBoundingClientRect();
  const hitRect = hit.getBoundingClientRect();
  const tipRect = tip.getBoundingClientRect();
  let leftPx = hitRect.left - stageRect.left + hitRect.width / 2 - tipRect.width / 2;
  leftPx = Math.max(8, Math.min(stageRect.width - tipRect.width - 8, leftPx));
  let topPx = hitRect.top - stageRect.top - tipRect.height - 8;
  if (topPx < 4) {
    topPx = Math.min(stageRect.height - tipRect.height - 8, hitRect.top - stageRect.top + Math.min(hitRect.height * 0.45, 36));
  }
  tip.style.left = `${Math.round(leftPx)}px`;
  tip.style.top = `${Math.round(Math.max(4, topPx))}px`;
}

let lastChartPointer = 'mouse';
document.addEventListener('pointerdown', (e) => {
  if (e.pointerType) lastChartPointer = e.pointerType;
});

document.addEventListener('pointerover', (e) => {
  if (e.pointerType === 'touch') return;
  const hit = e.target instanceof Element ? e.target.closest('.chart-hit') : null;
  if (hit) showChartTip(hit);
});

document.addEventListener('pointerout', (e) => {
  if (e.pointerType === 'touch') return;
  const hit = e.target instanceof Element ? e.target.closest('.chart-hit') : null;
  if (!hit) return;
  const stage = hit.closest('[data-chart-stage]');
  const related = e.relatedTarget instanceof Element ? e.relatedTarget : null;
  if (stage && (!related || !stage.contains(related))) hideChartTip(stage);
});

document.addEventListener('click', (e) => {
  const hit = e.target instanceof Element ? e.target.closest('.chart-hit') : null;
  if (hit) {
    const stage = hit.closest('[data-chart-stage]');
    const wasActive = hit.classList.contains('is-active');
    document.querySelectorAll('[data-chart-stage]').forEach((s) => {
      if (s !== stage) hideChartTip(s);
    });
    if (wasActive && lastChartPointer === 'touch') hideChartTip(stage);
    else showChartTip(hit);
    return;
  }
  if (!(e.target instanceof Element && e.target.closest('[data-chart-stage]'))) {
    document.querySelectorAll('[data-chart-stage]').forEach((s) => hideChartTip(s));
  }
});

document.addEventListener('focusin', (e) => {
  const hit = e.target instanceof Element ? e.target.closest('.chart-hit') : null;
  if (hit) showChartTip(hit);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('[data-chart-stage]').forEach((s) => hideChartTip(s));
  }
});
