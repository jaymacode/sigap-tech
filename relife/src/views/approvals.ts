import { html } from 'hono/html';
import { APPROVAL_LINK_DAYS, APPROVAL_STEP_LABELS, type ApprovalStep } from '@/domain/approval';
import { formatDateTime } from '@/lib/format';
import type { ApprovalRowView, TicketDetail } from '@/lib/views';
import type { SessionUser } from '@/server/auth/session';
import { flag, icon, type HtmlContent } from './components';
import { baseDoc } from './layout';

/**
 * Rantai persetujuan formulir IT Request ("Persetujuan"): grid tanda tangan seperti kertas,
 * aksi staf (agent page) dan halaman publik `/approve/:token`.
 */

const STATUS_LABEL: Record<ApprovalRowView['status'], string> = {
  pending: 'Menunggu',
  approved: 'Disetujui',
  rejected: 'Ditolak',
  skipped: 'Informasi',
};
const STATUS_BADGE: Record<ApprovalRowView['status'], string> = {
  pending: 'badge-pending',
  approved: 'badge-ok',
  rejected: 'badge-breach',
  skipped: '',
};

function signCol(label: string, row: ApprovalRowView | null, emptyText: string): HtmlContent {
  return html`<div class="apr-col apr-${row?.status ?? 'none'}">
    <span class="kv-label">${label}</span>
    ${row
      ? html`<strong>${row.approverName}</strong>
          <span class="badge ${STATUS_BADGE[row.status]}">${STATUS_LABEL[row.status]}</span>
          <span class="text-muted text-xs">${formatDateTime(row.decidedAt ?? row.createdAt)}</span>
          ${row.decidedBy && row.decidedBy !== row.approverName
            ? html`<span class="text-muted text-xs">dicatat oleh ${row.decidedBy}</span>`
            : null}
          ${row.note ? html`<span class="apr-note text-xs">“${row.note}”</span>` : null}`
      : html`<span class="text-muted text-xs">${emptyText}</span>`}
  </div>`;
}

/** Grid tanda tangan: User → HOD → IT HOD → Presdir. */
export function approvalSignoffs(detail: TicketDetail): HtmlContent {
  const a = detail.approval;
  const [hod, itHod, presdir] = a.steps.map((s) => s.row);
  const legacyHod: ApprovalRowView | null =
    !hod && a.hodName
      ? {
          id: '',
          step: 'hod',
          status: 'skipped',
          approverName: a.hodName,
          approverEmail: null,
          decidedBy: null,
          note: '',
          createdAt: detail.createdAt,
          decidedAt: null,
          linkActive: false,
        }
      : null;
  return html`<div class="apr-grid" aria-label="Rantai persetujuan">
    <div class="apr-col apr-approved">
      <span class="kv-label">Diajukan Pemohon</span>
      <strong>${detail.requesterInfo.name}</strong>
      <span class="badge badge-ok">Diajukan</span>
      <span class="text-muted text-xs">${formatDateTime(detail.createdAt)}</span>
    </div>
    ${signCol(APPROVAL_STEP_LABELS.hod, hod ?? legacyHod, 'Belum tercatat')}
    ${signCol(
      APPROVAL_STEP_LABELS.it_hod,
      itHod ?? null,
      a.requiresItHod ? 'Wajib sebelum dikerjakan — belum diajukan' : 'Tidak wajib untuk jenis ini',
    )}
    ${signCol(APPROVAL_STEP_LABELS.presdir, presdir ?? null, 'Tidak diperlukan (opsional)')}
  </div>`;
}

// ---------------------------------------------------------------------------
// Agent page
// ---------------------------------------------------------------------------

function manualDialog(row: ApprovalRowView): HtmlContent {
  return html`<dialog id="dlg-apr-manual-${row.id}" class="modal">
    <div class="modal-box">
      <div class="modal-head">
        <h3 class="modal-title">Catat Manual: ${APPROVAL_STEP_LABELS[row.step]}</h3>
        <p class="modal-desc">Untuk approver tanpa akun / tanpa email (${row.approverName}).</p>
      </div>
      <form data-api-form action="/api/approvals/${row.id}/manual" data-method="POST" data-reload="true"
        data-success-msg="Persetujuan dicatat" class="stack">
        <div class="field">
          <label class="label" for="apr-dec-${row.id}">Keputusan <span class="req">*</span></label>
          <select id="apr-dec-${row.id}" name="decision" class="select" required>
            <option value="approve">Disetujui</option>
            <option value="reject">Ditolak (tiket dibatalkan)</option>
          </select>
        </div>
        <div class="field">
          <label class="label" for="apr-ch-${row.id}">Dikonfirmasi via <span class="req">*</span></label>
          <input id="apr-ch-${row.id}" name="channel" class="input" placeholder="Telepon, WhatsApp, tatap muka…" minlength="2" required />
        </div>
        <div class="field">
          <label class="label" for="apr-note-${row.id}">Catatan <span class="req">*</span></label>
          <textarea id="apr-note-${row.id}" name="note" rows="3" class="textarea" minlength="3" required></textarea>
        </div>
        <div class="form-error" data-form-error role="alert" hidden></div>
        <div class="modal-foot">
          <button type="button" class="btn btn-secondary btn-sm" data-close-dialog>Batal</button>
          <button type="submit" class="btn btn-primary btn-sm">Simpan</button>
        </div>
      </form>
    </div>
  </dialog>`;
}

function decideDialog(row: ApprovalRowView, presdirEmail: boolean): HtmlContent {
  return html`<dialog id="dlg-apr-decide-${row.id}" class="modal">
    <div class="modal-box">
      <div class="modal-head">
        <h3 class="modal-title">Persetujuan Head IT</h3>
        <p class="modal-desc">Setujui atau tolak Rencana Tindakan &amp; Analisis Dampak tim IT.</p>
      </div>
      <form data-api-form action="/api/approvals/${row.id}/decide" data-method="POST" data-reload="true"
        data-success-msg="Keputusan Head IT disimpan" class="stack">
        <div class="field">
          <label class="label" for="apr-dec-${row.id}">Keputusan <span class="req">*</span></label>
          <select id="apr-dec-${row.id}" name="decision" class="select" required>
            <option value="approve">Setujui</option>
            <option value="reject">Tolak — kembalikan ke staf untuk revisi</option>
          </select>
        </div>
        <label class="row-gap-xs text-xs">
          <input type="checkbox" name="presdirRequired" />
          <span>Perlu persetujuan Presdir ${presdirEmail ? '(link dikirim via email)' : '(dicatat manual oleh Head IT)'}</span>
        </label>
        <div class="field">
          <label class="label" for="apr-note-${row.id}">Catatan (wajib bila menolak)</label>
          <textarea id="apr-note-${row.id}" name="note" rows="3" class="textarea"></textarea>
        </div>
        <div class="form-error" data-form-error role="alert" hidden></div>
        <div class="modal-foot">
          <button type="button" class="btn btn-secondary btn-sm" data-close-dialog>Batal</button>
          <button type="submit" class="btn btn-primary btn-sm">Simpan Keputusan</button>
        </div>
      </form>
    </div>
  </dialog>`;
}

function resendBtn(row: ApprovalRowView): HtmlContent {
  return html`<button type="button" class="btn btn-ghost btn-sm" data-api-btn
    data-url="/api/approvals/${row.id}/resend" data-body="{}" data-reload="true"
    data-success-msg="Link persetujuan dikirim ulang">
    ${icon('mail', 'icon-xs')} <span>Kirim ulang link</span>
  </button>`;
}

/**
 * Kartu "Persetujuan" + IT part di halaman agent. Tombol hanya muncul untuk role/status yang
 * diizinkan server (lihat routes/approvals.ts) agar tidak ada tombol mati.
 */
export function agentApprovalCard(detail: TicketDetail, user: SessionUser): HtmlContent {
  const a = detail.approval;
  const teamId = detail.team?.id ?? null;
  const inTeam = teamId ? user.teamIds.includes(teamId) : false;
  const leads = teamId ? user.ledTeamIds.includes(teamId) : false;
  const isAdmin = user.role === 'admin';
  const canWork = isAdmin || ((user.role === 'agent' || user.role === 'lead') && (inTeam || leads));
  const canApprove = isAdmin || (user.role === 'lead' && leads);
  const active = ['new', 'assigned', 'in_progress', 'pending'].includes(detail.status);
  const byStep = Object.fromEntries(a.steps.map((s) => [s.step, s.row])) as Record<ApprovalStep, ApprovalRowView | null>;
  const hod = byStep.hod;
  const itHod = byStep.it_hod;
  const presdir = byStep.presdir;
  const tracked = a.steps.some((s) => s.row);
  const itLocked = itHod?.status === 'pending' || itHod?.status === 'approved';
  const itFilled = Boolean(a.actionPlan?.trim() && a.impactAnalysis?.trim());
  const canSubmitItHod =
    tracked && canWork && ['new', 'assigned', 'in_progress'].includes(detail.status) && !a.awaiting && !itLocked;

  const actions: HtmlContent[] = [];
  const dialogs: HtmlContent[] = [];
  if (active) {
    if (hod?.status === 'pending' && canWork) {
      actions.push(html`<button type="button" class="btn btn-secondary btn-sm" data-open-dialog="dlg-apr-manual-${hod.id}">
        ${icon('edit', 'icon-xs')} <span>Catat manual HOD</span></button>`);
      dialogs.push(manualDialog(hod));
      if (hod.approverEmail) actions.push(resendBtn(hod));
    }
    if (itHod?.status === 'pending' && canApprove) {
      actions.push(html`<button type="button" class="btn btn-primary btn-sm" data-open-dialog="dlg-apr-decide-${itHod.id}">
        ${icon('shield', 'icon-xs')} <span>Setujui / Tolak (Head IT)</span></button>`);
      dialogs.push(decideDialog(itHod, Boolean(process.env.PRESDIR_EMAIL?.trim())));
    }
    if (presdir?.status === 'pending' && canApprove) {
      actions.push(html`<button type="button" class="btn btn-secondary btn-sm" data-open-dialog="dlg-apr-manual-${presdir.id}">
        ${icon('edit', 'icon-xs')} <span>Catat manual Presdir</span></button>`);
      dialogs.push(manualDialog(presdir));
    }
    if (presdir?.status === 'pending' && presdir.approverEmail && canWork) actions.push(resendBtn(presdir));
    if (canSubmitItHod && itFilled) {
      actions.push(html`<button type="button" class="btn btn-primary btn-sm" data-api-btn
        data-url="/api/tickets/${detail.id}/approvals/it-hod" data-body="{}" data-reload="true"
        data-success-msg="Diajukan ke Head IT">
        ${icon('send', 'icon-xs')} <span>Ajukan ke Head IT</span></button>`);
    }
  }

  const statusLine = hod?.status === 'pending'
    ? hod.approverEmail
      ? hod.linkActive
        ? `Link persetujuan terkirim ke ${hod.approverEmail} (berlaku ${APPROVAL_LINK_DAYS} hari). SLA dijeda.`
        : `Link ke ${hod.approverEmail} kedaluwarsa — kirim ulang atau catat manual. SLA dijeda.`
      : 'HOD tanpa email: catat konfirmasi secara manual. SLA dijeda.'
    : presdir?.status === 'pending'
      ? 'Menunggu persetujuan Presiden Direktur. SLA dijeda.'
      : itHod?.status === 'pending'
        ? 'Menunggu keputusan Head IT.'
        : a.startBlocked;

  const editable = canWork && active && !itLocked;
  return html`<section class="card apr-card" aria-labelledby="apr-title">
    <div class="card-header row-between-wrap">
      <h2 class="section-label" id="apr-title">Persetujuan &amp; Bagian IT</h2>
      ${a.awaiting ? html`<span class="badge badge-pending">Menunggu persetujuan</span>` : null}
    </div>
    <div class="card-body stack">
      ${approvalSignoffs(detail)}
      ${statusLine ? html`<p class="apr-status text-xs">${icon('clock', 'icon-xs')} <span>${statusLine}</span></p>` : null}
      ${actions.length ? html`<div class="row-gap-xs wrap">${actions}</div>` : null}
      ${canSubmitItHod && !itFilled && active
        ? html`<p class="text-muted text-xs">Isi Rencana Tindakan &amp; Analisis Dampak di bawah untuk mengajukan ke Head IT.</p>`
        : null}
      <hr class="sep" />
      <div class="kv-grid">
        <div class="kv-item"><span class="kv-label">Diterima Oleh</span><span class="kv-value">${a.receivedBy ?? 'Belum diterima'}</span></div>
        <div class="kv-item"><span class="kv-label">Tanggal Diterima</span><span class="kv-value">${a.receivedAt ? formatDateTime(a.receivedAt) : '—'}</span></div>
      </div>
      ${editable
        ? html`<form data-api-form action="/api/tickets/${detail.id}/it-part" data-method="POST" data-reload="true"
            data-success-msg="Bagian IT disimpan" class="stack-sm">
            <div class="field">
              <label class="label" for="it-action">Rencana Tindakan IT</label>
              <textarea id="it-action" name="actionPlan" rows="3" class="textarea">${a.actionPlan ?? ''}</textarea>
            </div>
            <div class="field">
              <label class="label" for="it-impact">Analisis Dampak</label>
              <textarea id="it-impact" name="impactAnalysis" rows="3" class="textarea">${a.impactAnalysis ?? ''}</textarea>
            </div>
            <div class="form-error" data-form-error role="alert" hidden></div>
            <div><button type="submit" class="btn btn-secondary btn-sm">Simpan Bagian IT</button></div>
          </form>`
        : html`<div class="stack-xs">
            <span class="kv-label">Rencana Tindakan IT</span>
            <p class="prose-pre">${a.actionPlan ?? '—'}</p>
            <span class="kv-label">Analisis Dampak</span>
            <p class="prose-pre">${a.impactAnalysis ?? '—'}</p>
            ${itLocked ? html`<span class="text-muted text-xs">${icon('lock', 'icon-xs')} Terkunci setelah diajukan ke Head IT.</span>` : null}
          </div>`}
    </div>
    ${dialogs}
  </section>`;
}

// ---------------------------------------------------------------------------
// Halaman publik /approve/:token
// ---------------------------------------------------------------------------

export interface ApproveTicketSummary {
  number: string;
  title: string;
  description: string;
  requesterName: string;
  department: string;
  requestType: string;
  createdAt: string;
  actionPlan: string | null;
  impactAnalysis: string | null;
}

export type ApprovePageProps =
  | { state: 'invalid' | 'expired' }
  | { state: 'done'; approved: boolean; number: string }
  | {
      state: 'form';
      step: ApprovalStep;
      approverName: string;
      ticket: ApproveTicketSummary;
      note?: string;
      error?: string;
    };

export function approvePage(p: ApprovePageProps): HtmlContent {
  let inner: HtmlContent;
  if (p.state !== 'form' && p.state !== 'done') {
    inner = html`<div class="card"><div class="card-body stack">
      <h1 class="page-h1">${p.state === 'expired' ? 'Link kedaluwarsa' : 'Link tidak berlaku'}</h1>
      <p class="text-muted">${p.state === 'expired'
        ? `Link persetujuan hanya berlaku ${APPROVAL_LINK_DAYS} hari. Hubungi tim IT untuk dikirim ulang.`
        : 'Link ini sudah dipakai, dibatalkan, atau tidak dikenal. Setiap link hanya bisa dipakai sekali.'}</p>
    </div></div>`;
  } else if (p.state === 'done') {
    inner = html`<div class="card"><div class="card-body stack">
      <h1 class="page-h1">${p.approved ? 'Terima kasih — permintaan disetujui' : 'Permintaan ditolak'}</h1>
      <p class="text-muted">Keputusan Anda untuk ${p.number} sudah tercatat. Halaman ini boleh ditutup.</p>
    </div></div>`;
  } else {
    const t = p.ticket;
    inner = html`<div class="card apr-public"><div class="card-body stack">
      <div>
        <span class="mono text-accent font-bold">${t.number}</span>
        <h1 class="page-h1">${t.title}</h1>
        <p class="text-muted text-xs">${APPROVAL_STEP_LABELS[p.step]} · untuk ${p.approverName}</p>
      </div>
      <div class="kv-grid">
        <div class="kv-item"><span class="kv-label">Pemohon</span><span class="kv-value">${t.requesterName}</span></div>
        <div class="kv-item"><span class="kv-label">Departemen</span><span class="kv-value">${t.department}</span></div>
        <div class="kv-item"><span class="kv-label">Jenis Permintaan</span><span class="kv-value">${t.requestType}</span></div>
        <div class="kv-item"><span class="kv-label">Tanggal Pengajuan</span><span class="kv-value">${formatDateTime(t.createdAt)}</span></div>
      </div>
      <div class="stack-xs">
        <span class="kv-label">Deskripsi Masalah / Kebutuhan</span>
        <p class="prose-pre">${t.description}</p>
      </div>
      ${p.step === 'presdir'
        ? html`<div class="stack-xs">
            <span class="kv-label">Rencana Tindakan IT</span><p class="prose-pre">${t.actionPlan ?? '—'}</p>
            <span class="kv-label">Analisis Dampak</span><p class="prose-pre">${t.impactAnalysis ?? '—'}</p>
          </div>`
        : null}
      <form method="post" class="stack" data-approve-form>
        <div class="field">
          <label class="label" for="apr-note">Catatan (wajib bila menolak)</label>
          <textarea id="apr-note" name="note" rows="3" class="textarea">${p.note ?? ''}</textarea>
        </div>
        <div class="form-error" data-form-error role="alert"${p.error ? '' : ' hidden'}>${p.error ?? ''}</div>
        <div class="apr-public-actions">
          <button type="submit" name="decision" value="approve" class="btn btn-success">Setujui Permintaan</button>
          <button type="submit" name="decision" value="reject" class="btn btn-secondary text-danger"${flag('formnovalidate', true)}>Tolak</button>
        </div>
      </form>
    </div></div>`;
  }
  return baseDoc({
    title: 'Persetujuan IT Request — Sigap',
    body: html`<main id="main-content" class="login-shell"><div class="login-wrap apr-public-wrap">${inner}</div></main>`,
    includeCmdk: false,
  });
}
