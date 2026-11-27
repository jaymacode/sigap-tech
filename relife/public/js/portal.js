// Portal Features: Catalog Search, New Request Form v2 (Draft/Validation/Summary) & CSAT Stars
import {
  apiFetch,
  prefersReducedMotion,
  saveToastForReload,
  serializeForm,
  setFormError,
  setSubmitBusy,
} from './core.js';
import { formAttachmentIds } from './attachments.js';

const DRAFT_KEY = 'sigap-new-ticket-draft';
const CSAT_LABELS = ['', '(Sangat Tidak Puas)', '(Tidak Puas)', '(Cukup)', '(Puas)', '(Sangat Puas)'];

function filterPortalCatalog() {
  const input = document.getElementById('portal-catalog-search');
  const q = (input?.value || '').trim().toLowerCase();
  let visibleTotal = 0;

  document.querySelectorAll('[data-catalog-card]').forEach((card) => {
    const keywords = (card.dataset.keywords || '').toLowerCase();
    const match = !q || (card.textContent || '').toLowerCase().includes(q) || keywords.includes(q);
    card.hidden = !match;
    if (match) visibleTotal++;
  });

  const countEl = document.getElementById('portal-catalog-count');
  if (countEl) countEl.textContent = String(visibleTotal);
  const emptyEl = document.getElementById('portal-catalog-empty');
  if (emptyEl) emptyEl.hidden = visibleTotal > 0;
  const announcer = document.getElementById('sr-announcer');
  if (announcer && q) {
    announcer.textContent = visibleTotal === 0 ? 'Tidak ada layanan yang cocok dengan pencarian.' : `${visibleTotal} layanan ditemukan`;
  }
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
  if (!el) return '';
  if (el instanceof RadioNodeList) {
    const active = Array.from(el).find(
      (item) => item instanceof HTMLInputElement && item.checked && !item.disabled,
    );
    return active ? active.value.trim() : '';
  }
  return 'value' in el && !el.disabled ? String(el.value).trim() : '';
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
  const hodEmailEl = form.querySelector('#fd-hod-email');
  if (hodEmailEl instanceof HTMLInputElement && hodEmailEl.value.trim() && !hodEmailEl.checkValidity()) {
    addErr(4, 'Format email atasan (HOD) tidak valid.', hodEmailEl, hodEmailEl.closest('.field'));
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
      if (el instanceof RadioNodeList || (el instanceof HTMLInputElement && el.type === 'radio')) {
        const r = form.querySelector(`input[name="${CSS.escape(k)}"][value="${CSS.escape(v)}"]`);
        if (r instanceof HTMLInputElement && !r.disabled) r.checked = true;
      } else if (
        (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) &&
        !el.disabled
      ) {
        if (k === 'title' && !v.trim()) continue;
        el.value = v;
        if (k === 'title') el.dataset.autoTitle = 'false';
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

let draftTimer = null;
function scheduleDraftSave(form) {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => saveRequestDraft(form), 250);
}

document.addEventListener('sigap:attachments-changed', (e) => {
  const form = e.detail?.form;
  if (form instanceof HTMLFormElement && form.id === 'new-ticket-form') {
    saveRequestDraft(form);
  }
});

document.addEventListener('click', (e) => {
  const target = e.target;
  if (!(target instanceof Element)) return;

  if (target.closest('#portal-search-reset')) {
    const input = document.getElementById('portal-catalog-search');
    if (input instanceof HTMLInputElement) {
      input.value = '';
      input.focus();
    }
    filterPortalCatalog();
    return;
  }

  const starBtn = target.closest('[data-csat-star]');
  if (starBtn) selectCsatStar(starBtn);
});

document.addEventListener('submit', async (e) => {
  const form = e.target;
  if (!(form instanceof HTMLFormElement) || form.id !== 'new-ticket-form') return;
  e.preventDefault();
  setFormError(form, '');
  if (!validateRequestForm(form)) return;
  clearTimeout(draftTimer);
  const submitBtns = Array.from(form.querySelectorAll('[type="submit"]'));
  submitBtns.forEach((b) => setSubmitBusy(b, true));
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
    submitBtns.forEach((b) => setSubmitBusy(b, false));
  }
});

document.addEventListener('change', (e) => {
  const el = e.target;
  if (
    (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) &&
    el.closest('#new-ticket-form')
  ) {
    const rf = el.closest('#new-ticket-form');
    if (rf instanceof HTMLFormElement) {
      syncRequestForm(rf, el.name);
      clearRequestErrors(rf);
      setFormError(rf, '');
      saveRequestDraft(rf);
    }
  }
});

document.addEventListener('input', (e) => {
  const el = e.target;
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;

  if (el.id === 'title' && el instanceof HTMLInputElement) {
    el.dataset.autoTitle = el.value.trim() === '' ? 'true' : 'false';
    const rf = el.closest('#new-ticket-form');
    if (rf instanceof HTMLFormElement) {
      clearRequestErrors(rf);
      setFormError(rf, '');
      updateRequestSummary(rf);
      scheduleDraftSave(rf);
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
      setFormError(rf, '');
      updateRequestSummary(rf);
      scheduleDraftSave(rf);
    }
    return;
  }

  if (el.closest('#new-ticket-form')) {
    const rf = el.closest('#new-ticket-form');
    if (rf instanceof HTMLFormElement) {
      clearRequestErrors(rf);
      setFormError(rf, '');
      updateRequestSummary(rf);
      scheduleDraftSave(rf);
    }
    return;
  }

  if (el instanceof HTMLInputElement && el.id === 'portal-catalog-search') {
    filterPortalCatalog();
  }
});

document.addEventListener('keydown', (e) => {
  const starTarget = e.target instanceof Element ? e.target.closest('[data-csat-star]') : null;
  if (!starTarget || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
  e.preventDefault();
  const wrap = starTarget.closest('.csat-stars') || document;
  const stars = Array.from(wrap.querySelectorAll('[data-csat-star]'));
  const idx = stars.indexOf(starTarget);
  if (idx !== -1 && stars.length) {
    const delta = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : -1;
    const next = stars[(idx + delta + stars.length) % stars.length];
    if (next) selectCsatStar(next, true);
  }
});

{
  const rf = document.getElementById('new-ticket-form');
  if (rf instanceof HTMLFormElement && rf.querySelector('input[name="catalogItemId"]')) {
    syncRequestForm(rf);
    restoreRequestDraft(rf);
  }
}
