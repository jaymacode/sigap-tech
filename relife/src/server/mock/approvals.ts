import { createHash, randomBytes } from 'node:crypto';
import {
  APPROVAL_LINK_DAYS,
  APPROVAL_STEP_LABELS,
  EXTERNAL_STEPS,
  latestByStep,
  type ApprovalStep,
} from '@/domain/approval';
import { pause as pauseSla, resume as resumeSla } from '@/domain/sla';
import { ACTIVE_STATUSES } from '@/domain/types';
import { enqueueMail } from '@/server/mail/mailer';
import { baseUrl, escapeHtml } from '@/server/mail/templates';
import { businessCalendar, nextId, type Store } from './store';
import {
  appendEvent,
  EngineError,
  notify,
  requireTicket,
  saveTicket,
  setSla,
  slaPair,
  teamLeadId,
  transitionTicket,
} from './ticket-engine';
import type { ApprovalRecord, TicketRecord, UserRecord } from './types';

/**
 * Rantai persetujuan formulir IT Request (HOD → Head IT → Presdir). Semua perubahan menulis event
 * `approval_*` + notifikasi in-app, seperti operasi engine lainnya.
 *
 * SLA: selama step eksternal (hod/presdir) pending, kedua clock dijeda lewat pause/resume SLA yang
 * sama dengan status Pending — status tiket tidak diubah (New/Assigned tetap), jadi workflow tidak
 * perlu transisi baru.
 */

const DAY_MS = 86_400_000;
const PRESDIR_NAME = 'Presiden Direktur';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function approvalsFor(store: Store, ticketId: string): ApprovalRecord[] {
  return store.approvals.filter((a) => a.ticketId === ticketId);
}

export function hasPendingApproval(store: Store, ticketId: string): boolean {
  return store.approvals.some((a) => a.ticketId === ticketId && a.status === 'pending');
}

function stepLabel(step: ApprovalStep): string {
  return APPROVAL_STEP_LABELS[step];
}

function addRow(
  store: Store,
  ticket: TicketRecord,
  step: ApprovalStep,
  status: ApprovalRecord['status'],
  approverName: string,
  approverEmail: string | null,
  note: string,
  now: Date,
): ApprovalRecord {
  const row: ApprovalRecord = {
    id: nextId(store, 'apr'),
    ticketId: ticket.id,
    step,
    status,
    approverName,
    approverEmail,
    decidedByUserId: null,
    note,
    tokenHash: null,
    expiresAt: null,
    createdAt: now,
    decidedAt: status === 'pending' ? null : now,
  };
  store.approvals.push(row);
  return row;
}

/** Membuat token sekali pakai (hanya hash yang disimpan) dan mengirim link via email. */
function mailLink(store: Store, ticket: TicketRecord, row: ApprovalRecord, now: Date): void {
  if (!row.approverEmail) return;
  const token = randomBytes(32).toString('base64url');
  row.tokenHash = hashToken(token);
  row.expiresAt = new Date(now.getTime() + APPROVAL_LINK_DAYS * DAY_MS);
  const url = `${baseUrl()}/approve/${token}`;
  const requester = store.users.get(ticket.requesterId);
  const subject = `[${ticket.number}] Mohon persetujuan: ${ticket.title}`;
  const lines = [
    `Yth. ${row.approverName},`,
    '',
    `${requester?.name ?? 'Pemohon'} (${requester?.department ?? '-'}) mengajukan IT Request ${ticket.number}:`,
    `"${ticket.title}"`,
    '',
    `Langkah: ${stepLabel(row.step)}`,
    `Setujui atau tolak melalui link berikut (berlaku ${APPROVAL_LINK_DAYS} hari, sekali pakai):`,
    url,
  ];
  const html = `<p>Yth. ${escapeHtml(row.approverName)},</p>
<p>${escapeHtml(requester?.name ?? 'Pemohon')} (${escapeHtml(requester?.department ?? '-')}) mengajukan IT Request <strong>${escapeHtml(ticket.number)}</strong>: “${escapeHtml(ticket.title)}”.</p>
<p>Langkah: <strong>${escapeHtml(stepLabel(row.step))}</strong></p>
<p><a href="${escapeHtml(url)}">Buka halaman persetujuan</a> (berlaku ${APPROVAL_LINK_DAYS} hari, sekali pakai).</p>`;
  enqueueMail(store, { to: row.approverEmail, subject, text: lines.join('\n'), html, ticketId: ticket.id }, now);
}

/** Jeda kedua clock SLA selama step eksternal pending; lanjutkan bila tidak ada lagi. */
function syncSla(store: Store, ticketId: string, now: Date): void {
  const ticket = requireTicket(store, ticketId);
  if (!ACTIVE_STATUSES.includes(ticket.status)) return;
  const waiting = approvalsFor(store, ticketId).some(
    (a) => a.status === 'pending' && EXTERNAL_STEPS.includes(a.step),
  );
  const pair = slaPair(store, ticketId);
  for (const kind of ['response', 'resolution'] as const) {
    // Status Pending sendiri menjeda resolution; jangan dilanjutkan di sini.
    if (!waiting && kind === 'resolution' && ticket.status === 'pending') continue;
    const before = pair[kind];
    const cal = businessCalendar(store, before.calendarId);
    const after = waiting ? pauseSla(before, now, cal) : resumeSla(before, now, cal);
    if (after === before) continue;
    setSla(store, ticketId, kind, after);
    appendEvent(
      store,
      ticketId,
      null,
      waiting ? 'sla_paused' : 'sla_resumed',
      waiting
        ? { kind, reason: 'awaiting_approval' }
        : { kind, dueAt: after.dueAt.toISOString() },
      now,
    );
  }
}

function staffContact(store: Store, ticket: TicketRecord): string | null {
  return ticket.assigneeId ?? teamLeadId(store, ticket.teamId);
}

// ---------------------------------------------------------------------------
// Create / request
// ---------------------------------------------------------------------------

/**
 * Dipanggil setelah tiket dibuat dari portal. Service request menunggu Acknowledge by HOD
 * (link email bila ada `hod_email`, selain itu dicatat manual oleh staf IT). Problem/incident:
 * HOD dicatat sebagai informasi saja (`skipped`) dan tidak memblokir.
 */
export function startApprovalChain(store: Store, ticket: TicketRecord, now: Date): void {
  const name = ticket.formData.hod_name?.trim() ?? '';
  const email = ticket.formData.hod_email?.trim() || null;
  if (ticket.type === 'incident' || !name) {
    addRow(
      store,
      ticket,
      'hod',
      'skipped',
      name || '—',
      email,
      ticket.type === 'incident'
        ? 'Informasi saja — Problem/incident tidak menunggu persetujuan.'
        : 'Nama HOD tidak diisi.',
      now,
    );
    return;
  }
  const row = addRow(store, ticket, 'hod', 'pending', name, email, '', now);
  mailLink(store, ticket, row, now);
  appendEvent(
    store,
    ticket.id,
    ticket.requesterId,
    'approval_requested',
    { step: 'hod', approverName: name, via: email ? 'email' : 'manual' },
    now,
  );
  if (!email) {
    notify(
      store,
      staffContact(store, ticket),
      'approval',
      ticket,
      `${ticket.number}: catat Acknowledge HOD (${name}) secara manual`,
      now,
    );
  }
  syncSla(store, ticket.id, now);
}

/**
 * Staf IT "Ajukan ke Head IT" (Approval by IT HOD) setelah mengisi Action / Impact.
 * @throws EngineError bila langkah sebelumnya belum selesai atau sudah diajukan
 */
export function requestItHodApproval(
  store: Store,
  ticketId: string,
  actor: UserRecord,
  now: Date,
): ApprovalRecord {
  const ticket = requireTicket(store, ticketId);
  if (!['new', 'assigned', 'in_progress'].includes(ticket.status))
    throw new EngineError('invalid_status', 'Tiket tidak dalam status yang bisa diajukan');
  const list = approvalsFor(store, ticketId);
  if (list.some((a) => a.status === 'pending'))
    throw new EngineError('approval_pending', 'Masih ada persetujuan yang menunggu');
  const latest = latestByStep(list).it_hod;
  if (latest?.status === 'approved')
    throw new EngineError('already_approved', 'Sudah disetujui Head IT');
  if (!ticket.actionPlan?.trim() || !ticket.impactAnalysis?.trim())
    throw new EngineError('it_part_required', 'Isi "Action to be taken" dan "Impact and Analysis" dahulu');
  const leadId = teamLeadId(store, ticket.teamId);
  const lead = leadId ? store.users.get(leadId) : undefined;
  const row = addRow(store, ticket, 'it_hod', 'pending', lead?.name ?? 'Head IT', lead?.email ?? null, '', now);
  appendEvent(
    store,
    ticketId,
    actor.id,
    'approval_requested',
    { step: 'it_hod', approverName: row.approverName, via: 'in_app' },
    now,
  );
  notify(store, leadId, 'approval', ticket, `${ticket.number} menunggu persetujuan Head IT`, now, actor.id);
  saveTicket(store, ticket, now);
  return row;
}

// ---------------------------------------------------------------------------
// Decide
// ---------------------------------------------------------------------------

export interface DecisionInput {
  approve: boolean;
  note: string;
  /** null = approver lewat link email (tanpa akun). */
  actor: UserRecord | null;
  via: 'email' | 'in_app' | 'manual';
  /** Head IT mencentang "Perlu persetujuan Presdir". */
  presdirRequired?: boolean;
}

/**
 * Memutuskan satu baris pending. Tolak HOD/Presdir → tiket dibatalkan; tolak Head IT → kembali
 * ke staf untuk revisi Action / Impact (tiket tetap aktif).
 * @throws EngineError bila baris sudah diputuskan / tiket final
 */
export function decideApproval(
  store: Store,
  approvalId: string,
  input: DecisionInput,
  now: Date,
): ApprovalRecord {
  const row = store.approvals.find((a) => a.id === approvalId);
  if (!row) throw new EngineError('not_found', 'Persetujuan tidak ditemukan');
  if (row.status !== 'pending')
    throw new EngineError('already_decided', 'Persetujuan ini sudah diputuskan');
  const ticket = requireTicket(store, row.ticketId);
  if (!ACTIVE_STATUSES.includes(ticket.status))
    throw new EngineError('final_status', 'Tiket sudah tidak aktif');
  const note = input.note.trim();
  if (!input.approve && note.length < 3)
    throw new EngineError('reason_required', 'Alasan penolakan wajib diisi');

  Object.assign(row, {
    status: input.approve ? 'approved' : 'rejected',
    note,
    decidedByUserId: input.actor?.id ?? null,
    decidedAt: now,
    tokenHash: null,
  });
  if (input.actor && input.via === 'in_app') row.approverName = input.actor.name;
  const actorId = input.actor?.id ?? null;
  const presdir = input.approve && row.step === 'it_hod' && input.presdirRequired === true;
  appendEvent(
    store,
    ticket.id,
    actorId,
    input.approve ? 'approval_approved' : 'approval_rejected',
    {
      step: row.step,
      approverName: row.approverName,
      note,
      via: input.via,
      ...(presdir ? { presdirRequired: true } : {}),
    },
    now,
  );

  const label = stepLabel(row.step);
  if (!input.approve && row.step !== 'it_hod') {
    transitionTicket(
      store,
      ticket.id,
      'cancelled',
      input.actor && input.actor.role !== 'requester' ? input.actor : null,
      { reason: `Ditolak (${label}): ${note}` },
      now,
    );
    return row;
  }

  notify(
    store,
    staffContact(store, ticket),
    'approval',
    ticket,
    `${ticket.number}: ${label} ${input.approve ? 'disetujui' : 'ditolak — revisi diperlukan'}`,
    now,
    actorId,
  );
  if (input.approve && row.step === 'hod') {
    notify(store, ticket.requesterId, 'approval', ticket, `${ticket.number}: disetujui HOD`, now, actorId);
  }
  if (presdir) {
    const email = process.env.PRESDIR_EMAIL?.trim() || null;
    const p = addRow(store, ticket, 'presdir', 'pending', PRESDIR_NAME, email, '', now);
    mailLink(store, ticket, p, now);
    appendEvent(
      store,
      ticket.id,
      actorId,
      'approval_requested',
      { step: 'presdir', approverName: PRESDIR_NAME, via: email ? 'email' : 'manual' },
      now,
    );
    if (!email) {
      notify(
        store,
        teamLeadId(store, ticket.teamId),
        'approval',
        ticket,
        `${ticket.number}: catat persetujuan Presdir secara manual`,
        now,
      );
    }
  }
  syncSla(store, ticket.id, now);
  saveTicket(store, requireTicket(store, ticket.id), now);
  return row;
}

/** Baris pending milik token yang masih berlaku, atau alasan kegagalan. */
export function findByToken(
  store: Store,
  token: string,
  now: Date,
): { ok: true; row: ApprovalRecord; ticket: TicketRecord } | { ok: false; reason: 'invalid' | 'expired' } {
  const hash = hashToken(token);
  const row = store.approvals.find((a) => a.tokenHash === hash);
  if (!row || row.status !== 'pending') return { ok: false, reason: 'invalid' };
  const ticket = store.tickets.get(row.ticketId);
  if (!ticket || !ACTIVE_STATUSES.includes(ticket.status)) return { ok: false, reason: 'invalid' };
  if (!row.expiresAt || row.expiresAt <= now) return { ok: false, reason: 'expired' };
  return { ok: true, row, ticket };
}

/** Kirim ulang link (token lama otomatis tidak berlaku). */
export function resendApprovalLink(store: Store, approvalId: string, actor: UserRecord, now: Date): void {
  const row = store.approvals.find((a) => a.id === approvalId);
  if (!row || row.status !== 'pending' || !row.approverEmail || row.step === 'it_hod')
    throw new EngineError('invalid_state', 'Link tidak bisa dikirim ulang');
  const ticket = requireTicket(store, row.ticketId);
  mailLink(store, ticket, row, now);
  appendEvent(
    store,
    ticket.id,
    actor.id,
    'approval_requested',
    { step: row.step, approverName: row.approverName, via: 'email', resent: true },
    now,
  );
}

// ---------------------------------------------------------------------------
// IT part
// ---------------------------------------------------------------------------

/**
 * Menyimpan "Action to be taken" & "Impact and Analysis". Terkunci selama menunggu / setelah
 * disetujui Head IT (setara formulir yang sudah ditandatangani).
 */
export function updateItAssessment(
  store: Store,
  ticketId: string,
  actionPlan: string,
  impactAnalysis: string,
  actor: UserRecord,
  now: Date,
): TicketRecord {
  const ticket = requireTicket(store, ticketId);
  if (!ACTIVE_STATUSES.includes(ticket.status))
    throw new EngineError('final_status', 'Tiket tidak aktif');
  const itHod = latestByStep(approvalsFor(store, ticketId)).it_hod;
  if (itHod?.status === 'pending' || itHod?.status === 'approved')
    throw new EngineError('locked', 'Bagian IT terkunci karena sudah diajukan/disetujui Head IT');
  appendEvent(store, ticketId, actor.id, 'it_assessment_updated', {}, now);
  return saveTicket(
    store,
    { ...ticket, actionPlan: actionPlan.trim() || null, impactAnalysis: impactAnalysis.trim() || null },
    now,
  );
}
