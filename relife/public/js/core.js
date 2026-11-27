// Shared Core Utilities: Theme, Modals, Toasts, Fetch, Forms, Drawer, Command Palette, Tabs & Auth
import { formAttachmentIds } from './attachments.js';

const THEME_KEY = 'sigap-theme';
const TOAST_KEY = 'sigap-toast';

export function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

export function setSubmitBusy(btn, busy) {
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
export function openDialog(dlg, triggerEl = document.activeElement) {
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

export function confirmModal(msg, triggerEl) {
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

// Mobile slide-over navigation drawer (<=840px)
{
  const shell = document.querySelector('.app-shell');
  const sidebar = document.getElementById('agent-sidebar');
  const mainWrap = document.querySelector('.main-wrap');
  const openBtn = document.querySelector('[data-nav-open]');
  const setDrawer = (open, returnFocus = false) => {
    if (!shell || !sidebar) return;
    shell.classList.toggle('is-nav-open', open);
    sidebar.classList.toggle('is-open', open);
    mainWrap?.toggleAttribute('inert', open);
    openBtn?.setAttribute('aria-expanded', String(open));
    if (open) {
      sidebar.querySelector('[data-nav-close], .sidebar-link')?.focus();
    } else if (returnFocus) {
      openBtn?.focus();
    }
  };
  document.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;
    if (t.closest('[data-nav-open]')) setDrawer(!sidebar?.classList.contains('is-open'));
    else if (t.closest('[data-nav-close]')) setDrawer(false, true);
    else if (t.closest('.sidebar-link') && window.innerWidth <= 840) setDrawer(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebar?.classList.contains('is-open')) setDrawer(false, true);
  });
  window.matchMedia?.('(max-width: 840px)').addEventListener?.('change', (mq) => {
    if (!mq.matches) setDrawer(false);
  });
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
  const hasMobileDock = Boolean(
    document.querySelector('.rf-mobile-bar') || document.querySelector('#bulk-bar:not([hidden])'),
  );
  root.classList.toggle('has-mobile-bar', hasMobileDock);
  const el = document.createElement('div');
  el.className = `toast toast-${type === 'ok' || type === 'err' ? type : 'info'}`;
  el.setAttribute('role', type === 'err' ? 'alert' : 'status');
  el.textContent = String(msg);
  el.title = 'Ketuk untuk menutup';
  el.addEventListener('click', () => el.remove());
  root.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

try {
  const pending = sessionStorage.getItem(TOAST_KEY);
  if (pending) {
    sessionStorage.removeItem(TOAST_KEY);
    const parsed = pending.startsWith('{') ? JSON.parse(pending) : { msg: pending, type: 'ok' };
    showToast(parsed.msg, parsed.type || 'ok');
  }
} catch { /* ignore */ }

export function saveToastForReload(msg, type = 'ok') {
  if (!msg) return;
  try { sessionStorage.setItem(TOAST_KEY, JSON.stringify({ msg, type })); } catch { /* ignore */ }
}

export async function apiFetch(url, method = 'POST', body = undefined) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if (!navigator.onLine || err?.name === 'TypeError') {
      throw new Error('Koneksi terputus. Periksa jaringan lalu coba lagi.');
    }
    throw err;
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) {
    throw new Error(json.error || json.message || `Request gagal (${res.status})`);
  }
  return json;
}

export function serializeForm(form) {
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

export function setFormError(form, msg) {
  const box = form.querySelector('[data-form-error]');
  const mobileBox = form.querySelector('[data-rf-mobile-err]');
  if (mobileBox) {
    if (msg) {
      mobileBox.textContent = msg;
      mobileBox.hidden = false;
    } else {
      mobileBox.textContent = '';
      mobileBox.hidden = true;
    }
  }
  if (box) {
    if (msg && (!mobileBox || mobileBox.offsetParent === null)) {
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

const CMDK_STATUS_LABELS = {
  new: 'Baru',
  assigned: 'Ditugaskan',
  in_progress: 'Dikerjakan',
  pending: 'Menunggu',
  resolved: 'Selesai',
  closed: 'Ditutup',
  cancelled: 'Dibatalkan',
};

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
  const isAgent = dlg?.dataset.isAgent === '1' || document.querySelector('[data-is-agent="1"]') !== null;

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

export function activateTab(tabBtn, focus = false) {
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

function activateTabFromHash() {
  const name = location.hash.slice(1);
  if (!name) return;
  document.querySelectorAll('[data-tab-group][data-tab-hash] [data-tab]').forEach((t) => {
    if (t.dataset.tab === name) activateTab(t);
  });
}
activateTabFromHash();
window.addEventListener('hashchange', activateTabFromHash);

let backdropDownDlg = null;
document.addEventListener('pointerdown', (e) => {
  backdropDownDlg = e.target instanceof HTMLDialogElement && e.target.open ? e.target : null;
});

document.addEventListener('click', async (e) => {
  const target = e.target;
  if (!(target instanceof Element)) return;

  document.querySelectorAll('details.popover[open]').forEach((pop) => {
    if (!pop.contains(target)) pop.removeAttribute('open');
  });

  if (target instanceof HTMLDialogElement && target.open && backdropDownDlg === target) {
    const r = target.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) {
      target.close();
      return;
    }
  }

  if (target.closest('[data-theme-toggle]')) {
    const next = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
    applyTheme(next);
    localStorage.setItem(THEME_KEY, next);
    return;
  }

  const openBtn = target.closest('[data-open-dialog]');
  if (openBtn) {
    openDialog(document.getElementById(openBtn.dataset.openDialog), openBtn);
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

  const tabBtn = target.closest('[data-tab]');
  if (tabBtn) {
    activateTab(tabBtn);
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

  const notifOne = target.closest('[data-notif-read]');
  if (notifOne) {
    const isNavLink =
      notifOne instanceof HTMLAnchorElement &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.shiftKey &&
      !e.altKey;
    if (isNavLink) {
      e.preventDefault();
      try {
        await apiFetch(`/api/notifications/${encodeURIComponent(notifOne.dataset.notifRead)}/read`, 'POST', {});
      } catch {
        // Proceed with navigation even if marking read fails.
      }
      location.href = notifOne.href;
      return;
    }
    try {
      await apiFetch(`/api/notifications/${encodeURIComponent(notifOne.dataset.notifRead)}/read`, 'POST', {});
      const row = notifOne.closest('.list-row');
      row?.classList.remove('is-unread');
      row?.querySelector('.unread-dot')?.classList.add('is-transparent');
      notifOne.classList.add('muted');
      if (notifOne.dataset.reload === 'true') location.reload();
    } catch (err) { showToast(err.message, 'err'); }
    return;
  }

  const notifAll = target.closest('[data-notif-read-all]');
  if (notifAll) {
    if (notifAll instanceof HTMLButtonElement) notifAll.disabled = true;
    try {
      await apiFetch('/api/notifications/read-all', 'POST', {});
      saveToastForReload('Semua notifikasi ditandai terbaca');
      location.reload();
    } catch (err) {
      showToast(err.message, 'err');
      if (notifAll instanceof HTMLButtonElement) notifAll.disabled = false;
    }
    return;
  }

  const apiBtn = target.closest('button[data-api-btn]');
  if (apiBtn) {
    if (apiBtn.dataset.confirm && !(await confirmModal(apiBtn.dataset.confirm, apiBtn))) return;
    let navigating = false;
    apiBtn.disabled = true;
    try {
      const body = apiBtn.dataset.body ? JSON.parse(apiBtn.dataset.body) : {};
      const json = await apiFetch(apiBtn.dataset.url, apiBtn.dataset.method || 'POST', body);
      if (apiBtn.dataset.redirect === 'response' && json.data?.redirect) {
        navigating = true;
        location.href = json.data.redirect;
      } else if (apiBtn.dataset.reload === 'true') {
        saveToastForReload(apiBtn.dataset.successMsg || 'Berhasil');
        navigating = true;
        location.reload();
      } else {
        showToast(apiBtn.dataset.successMsg || 'Berhasil', 'ok');
      }
    } catch (err) {
      showToast(err.message, 'err');
    } finally {
      if (!navigating) apiBtn.disabled = false;
    }
  }
});

document.addEventListener('submit', async (e) => {
  const form = e.target;
  if (!(form instanceof HTMLFormElement) || form.id === 'new-ticket-form' || !form.matches('[data-api-form]')) return;
  e.preventDefault();
  setFormError(form, '');
  const submitBtn = form.querySelector('[type="submit"]');
  let navigating = false;
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
      const nextParam = new URLSearchParams(location.search).get('next');
      const isAuthAction = action === '/api/auth/login' || action === '/api/auth/demo';
      const safeNext =
        isAuthAction &&
        nextParam &&
        nextParam.startsWith('/') &&
        !nextParam.startsWith('//') &&
        !/^\/\\/.test(nextParam)
          ? nextParam
          : null;
      navigating = true;
      location.href = safeNext || json.data.redirect;
    } else if (form.dataset.redirectTicket === 'true' && json.data?.number) {
      navigating = true;
      location.href = `/portal/tickets/${encodeURIComponent(json.data.number)}`;
    } else if (form.dataset.reload === 'true') {
      saveToastForReload(form.dataset.successMsg || 'Berhasil disimpan');
      navigating = true;
      location.reload();
    } else {
      showToast(form.dataset.successMsg || 'Berhasil disimpan', 'ok');
      form.closest('dialog')?.close();
    }
  } catch (err) {
    setFormError(form, err.message);
  } finally {
    if (!navigating) setSubmitBusy(submitBtn, false);
  }
});

document.addEventListener('change', async (e) => {
  const el = e.target;
  if (!(el instanceof HTMLElement)) return;
  if (el.matches('select[data-switch-user]')) {
    try {
      const json = await apiFetch('/api/auth/switch', 'POST', { userId: el.value });
      location.href = json.data?.redirect || '/';
    } catch (err) { showToast(err.message, 'err'); }
  }
});

document.addEventListener('input', (e) => {
  const el = e.target;
  if (!(el instanceof HTMLInputElement) || el.id !== 'cmdk-input') return;
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
      if (!res.ok || json.ok === false) throw new Error(json.error || 'Gagal mencari tiket');
      const hits = json.data?.hits ?? json.hits ?? (Array.isArray(json.data) ? json.data : []);
      renderCmdkResults(hits);
    } catch {
      if (box) {
        box.replaceChildren();
        const errP = document.createElement('p');
        errP.className = 'cmdk-hint text-danger';
        errP.textContent = navigator.onLine ? 'Gagal memuat hasil pencarian.' : 'Koneksi terputus. Periksa jaringan lalu coba lagi.';
        box.appendChild(errP);
      }
    }
  }, 200);
});

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

  const tabTarget = e.target instanceof Element ? e.target.closest('[data-tab]') : null;
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
    }
  }
});
