import { html } from 'hono/html';
import type { AttachmentView } from '@/lib/views';
import { ATTACHMENT_ACCEPT, maxAttachmentBytes } from '@/server/attachments';
import { icon, type HtmlContent } from './components';

/**
 * Tombol "Lampirkan" + daftar chip untuk composer balasan. Perilaku ada di app.js
 * (`[data-att-input]` mengunggah langsung; id terkumpul jadi `attachmentIds` saat submit).
 */
export function attachmentPicker(inputId: string): HtmlContent {
  return html`<div class="att-picker" data-att-picker>
    <label class="btn btn-ghost btn-sm att-pick-btn" for="${inputId}">
      ${icon('paperclip', 'icon-xs')} <span>Lampirkan berkas</span>
    </label>
    <input
      id="${inputId}"
      type="file"
      class="sr-only"
      data-att-input
      data-max-bytes="${maxAttachmentBytes()}"
      accept="${ATTACHMENT_ACCEPT}"
      aria-describedby="${inputId}-hint"
      multiple
    />
    <span id="${inputId}-hint" class="field-hint">Gambar, PDF, teks/log, Office, ZIP · maks. ${Math.round(maxAttachmentBytes() / 1024 / 1024)} MB per berkas.</span>
    <ul class="att-list" data-att-list aria-live="polite" aria-label="Lampiran yang akan dikirim"></ul>
  </div>`;
}

/** Isi chip lampiran: tautan unduh bila berkas tersimpan, selain itu label "tidak tersedia". */
export function attachmentLink(att: AttachmentView, inner: HtmlContent): HtmlContent {
  return att.url
    ? html`<a class="att-link" href="${att.url}" aria-label="Unduh ${att.fileName}">${inner}</a>`
    : html`<span class="att-link is-unavailable" title="Berkas tidak tersedia di server"
        >${inner} <span class="text-muted text-xs">(tidak tersedia)</span></span
      >`;
}
