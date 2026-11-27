// Agent Queue List, Bulk Assign, Keyboard Navigation, Partial Refresh & Ticket Detail / Approvals
import {
  apiFetch,
  confirmModal,
  saveToastForReload,
  setFormError,
  setSubmitBusy,
  showToast,
} from './core.js';
import { tickLiveSla } from './sla-live.js';

const PRIORITY_MATRIX = {
  high: { high: 'P1', medium: 'P2', low: 'P3' },
  medium: { high: 'P2', medium: 'P3', low: 'P4' },
  low: { high: 'P3', medium: 'P4', low: 'P4' },
};

function getQueueRows() {
  return Array.from(document.querySelectorAll('[data-queue-row]'));
}

function syncSelectCheckbox(cb) {
  const id = cb.dataset.selectId;
  if (!id) return;
  document.querySelectorAll(`[data-select-id="${CSS.escape(id)}"]`).forEach((peer) => {
    peer.checked = cb.checked;
  });
}

function selectedTicketIds() {
  return [...new Set(Array.from(document.querySelectorAll('[data-select-id]:checked'), (c) => c.dataset.selectId || c.value).filter(Boolean))];
}

function updateBulkBar() {
  const count = selectedTicketIds().length;
  const bar = document.getElementById('bulk-bar');
  if (!bar) return;
  bar.hidden = count === 0;
  const countEl = document.getElementById('bulk-count');
  if (countEl) {
    const hasOuterSuffix = Array.from(countEl.parentElement?.childNodes || []).some(
      (n) => n !== countEl && n.textContent?.includes('tiket terpilih'),
    );
    countEl.textContent = hasOuterSuffix ? String(count) : `${count} tiket terpilih`;
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

let focusedIdx = -1;
async function refreshQueueInPlace(manual = false) {
  const btn = manual ? document.getElementById('queue-refresh') : null;
  if (btn instanceof HTMLButtonElement) {
    btn.classList.add('is-spinning');
    btn.disabled = true;
  }
  try {
    const res = await fetch(location.href, { headers: { 'X-Requested-With': 'fetch' } });
    if (!res.ok) throw new Error(`Gagal memuat ulang (${res.status})`);
    const htmlText = await res.text();
    const doc = new DOMParser().parseFromString(htmlText, 'text/html');
    const curResults = document.getElementById('queue-results');
    const nextResults = doc.getElementById('queue-results');
    if (!curResults || !nextResults) {
      location.reload();
      return;
    }
    curResults.replaceWith(nextResults);
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
    updateBulkBar();
    if (manual) showToast('Daftar antrean diperbarui', 'ok');
  } catch {
    if (manual) showToast(navigator.onLine ? 'Gagal memperbarui antrean' : 'Koneksi terputus. Periksa jaringan lalu coba lagi.', 'err');
  } finally {
    if (btn instanceof HTMLButtonElement) {
      btn.classList.remove('is-spinning');
      btn.disabled = false;
    }
  }
}

document.addEventListener('click', async (e) => {
  const target = e.target;
  if (!(target instanceof Element)) return;

  if (target.closest('#queue-refresh')) {
    refreshQueueInPlace(true);
    return;
  }

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

  const bulkBtn = target.closest('#bulk-apply');
  if (bulkBtn) {
    const ids = selectedTicketIds();
    const sel = document.getElementById('bulk-assignee') || document.querySelector('#bulk-bar select');
    const assigneeId = sel?.value;
    if (!ids.length || !assigneeId) return showToast('Pilih tiket dan staff terlebih dahulu', 'err');
    bulkBtn.disabled = true;
    try {
      const json = await apiFetch('/api/tickets/bulk-assign', 'POST', { ticketIds: ids, assigneeId });
      const assigned = json.data?.count ?? 0;
      if (assigned === 0) {
        showToast('Tidak ada tiket yang dapat ditugaskan', 'info');
        bulkBtn.disabled = false;
        return;
      }
      saveToastForReload(`${assigned} tiket berhasil ditugaskan`);
      location.reload();
    } catch (err) {
      showToast(err.message, 'err');
      bulkBtn.disabled = false;
    }
    return;
  }

  const queueRow = target.closest('tr[data-queue-row][data-href]');
  if (queueRow && !target.closest('a, button, input, select, label')) {
    location.href = queueRow.dataset.href;
  }
});

document.addEventListener('submit', async (e) => {
  const form = e.target;
  if (!(form instanceof HTMLFormElement) || !form.matches('[data-approve-form]') || form.dataset.confirmed === '1') return;
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
  form.querySelectorAll('button[type="submit"], button[name="decision"]').forEach((b) => setSubmitBusy(b, true));
  form.submit();
});

document.addEventListener('change', (e) => {
  const el = e.target;
  if (!(el instanceof HTMLElement)) return;

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
    syncSelectCheckbox(el);
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

document.addEventListener('keydown', (e) => {
  const target = e.target;
  if (target instanceof HTMLInputElement && target.matches('input[type="search"][data-queue-filter]') && e.key === 'Enter') {
    e.preventDefault();
    navigateQueueFilter(target.dataset.queueFilter || target.name, target.value.trim());
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
      syncSelectCheckbox(cb);
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

if (location.pathname === '/queue') {
  setInterval(() => {
    const hasSelection = document.querySelector('[data-select-id]:checked');
    const hasDialog = document.querySelector('dialog[open]');
    const hasPopover = document.querySelector('details.popover[open]');
    const typing = document.activeElement?.matches('input, textarea, select');
    if (!hasSelection && !hasDialog && !hasPopover && !typing) refreshQueueInPlace();
  }, 30_000);
}
