// Attachment Uploader: XHR upload progress, retry, chip removal & dropzone feedback

function notifyAttachmentChange(el) {
  const form = el?.closest('form');
  if (form instanceof HTMLFormElement) {
    document.dispatchEvent(new CustomEvent('sigap:attachments-changed', { detail: { form } }));
  }
}

function uploadAttachment(list, file, maxBytes) {
  const chip = document.createElement('li');
  chip.className = 'att-chip is-uploading';
  const label = document.createElement('span');
  label.className = 'att-chip-name';
  const kb = Math.max(1, Math.round((file.size || 0) / 1024));
  label.textContent = `${file.name} (${kb} KB)`;
  const progress = document.createElement('progress');
  progress.className = 'att-progress';
  progress.max = 100;
  progress.value = 0;
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

  const fail = (msg, canRetry = false) => {
    chip.classList.remove('is-uploading');
    chip.classList.add('is-error');
    progress.remove();
    status.textContent = msg;
    status.setAttribute('role', 'alert');
    if (canRetry && !chip.querySelector('[data-att-retry]')) {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'btn btn-secondary btn-sm';
      retry.dataset.attRetry = '';
      retry.textContent = 'Coba lagi';
      retry.addEventListener('click', () => {
        chip.remove();
        uploadAttachment(list, file, maxBytes);
      });
      chip.insertBefore(retry, rm);
    }
  };
  if (maxBytes && file.size > maxBytes) {
    fail(`Ukuran lampiran maksimal ${Math.round(maxBytes / 1024 / 1024)} MB`);
    return;
  }

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/attachments');
  xhr.upload.addEventListener('progress', (ev) => {
    if (ev.lengthComputable && ev.total > 0) {
      progress.value = Math.round((ev.loaded / ev.total) * 100);
      status.textContent = `${progress.value}%`;
    }
  });
  xhr.addEventListener('load', () => {
    let json = {};
    try { json = JSON.parse(xhr.responseText || '{}'); } catch { /* ignore */ }
    if (xhr.status < 200 || xhr.status >= 300 || json.ok === false) {
      fail(json.error || `Unggah gagal (${xhr.status})`, xhr.status >= 500 || xhr.status === 0);
      return;
    }
    if (!chip.isConnected) {
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
    notifyAttachmentChange(list);
  });
  xhr.addEventListener('error', () => {
    fail(navigator.onLine ? 'Gagal mengunggah berkas' : 'Koneksi terputus saat mengunggah', true);
  });
  const body = new FormData();
  body.append('file', file);
  xhr.send(body);
}

/** Uploaded ids of a form, or null while an upload is still running. */
export function formAttachmentIds(form) {
  if (form.querySelector('[data-att-list] .is-uploading')) return null;
  return Array.from(form.querySelectorAll('[data-att-list] [data-att-id]'), (el) => el.dataset.attId);
}

document.addEventListener('click', (e) => {
  const rmAtt = e.target instanceof Element ? e.target.closest('[data-att-remove]') : null;
  if (!rmAtt) return;
  const chip = rmAtt.closest('li');
  const picker = rmAtt.closest('[data-att-picker]');
  if (chip?.dataset.attId) {
    fetch(`/api/attachments/${encodeURIComponent(chip.dataset.attId)}`, { method: 'DELETE' }).catch(() => {});
  }
  chip?.remove();
  notifyAttachmentChange(picker);
  picker?.querySelector('[data-att-input]')?.focus();
});

document.addEventListener('change', (e) => {
  const el = e.target;
  if (!(el instanceof HTMLInputElement) || !el.matches('[data-att-input]') || !el.files) return;
  const list = el.closest('[data-att-picker]')?.querySelector('[data-att-list]');
  if (list) {
    for (const f of el.files) uploadAttachment(list, f, Number(el.dataset.maxBytes) || 0);
  }
  el.value = '';
});

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
