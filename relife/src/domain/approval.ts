import type { DomainError, TicketStatus, TicketType } from './types';

/**
 * Rantai persetujuan formulir kertas "IT CTII Internal Service Request Form":
 * hod (Acknowledge by HOD) → it_hod (Approval by IT HOD) → presdir (Approval by President Director).
 * Fungsi murni; engine (server/mock/approvals.ts) yang menyimpan & menulis event.
 */

export const APPROVAL_STEPS = ['hod', 'it_hod', 'presdir'] as const;
export type ApprovalStep = (typeof APPROVAL_STEPS)[number];

export const APPROVAL_STATUSES = ['pending', 'approved', 'rejected', 'skipped'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const APPROVAL_STEP_LABELS: Readonly<Record<ApprovalStep, string>> = {
  hod: 'Acknowledge by HOD',
  it_hod: 'Approval by IT HOD',
  presdir: 'Approval by President Director',
};

/** Masa berlaku link persetujuan email. */
export const APPROVAL_LINK_DAYS = 7;

/** Jenis permintaan yang wajib disetujui Head IT sebelum dikerjakan. */
export const IT_HOD_REQUIRED_TYPES: readonly string[] = [
  'New Request',
  'Enhancement',
  'Access Rights',
  'Data Extraction',
];

/** Step yang menunggu pihak luar tim IT → SLA dijeda selama pending. */
export const EXTERNAL_STEPS: readonly ApprovalStep[] = ['hod', 'presdir'];

export interface GateApproval {
  step: ApprovalStep;
  status: ApprovalStatus;
}

export interface GateTicket {
  type: TicketType;
  status: TicketStatus;
  formData: Record<string, string>;
}

export function requiresItHod(t: Pick<GateTicket, 'type' | 'formData'>): boolean {
  return (
    t.type === 'service_request' &&
    IT_HOD_REQUIRED_TYPES.includes(t.formData.service_request_type ?? '')
  );
}

/** Baris terakhir per step (pengajuan ulang menambah baris baru). */
export function latestByStep<A extends GateApproval>(list: readonly A[]): Partial<Record<ApprovalStep, A>> {
  const out: Partial<Record<ApprovalStep, A>> = {};
  for (const a of list) out[a.step] = a;
  return out;
}

/**
 * Gerbang transisi. Tiket tanpa baris persetujuan (data lama/seed) tidak di-gate.
 * - Selama ada step pending: tidak boleh mulai dikerjakan / diselesaikan.
 * - Jenis wajib: Assigned → In Progress butuh it_hod approved.
 */
export function approvalGate(
  ticket: GateTicket,
  approvals: readonly GateApproval[],
  to: TicketStatus,
): DomainError | null {
  if (approvals.length === 0) return null;
  if (to !== 'in_progress' && to !== 'resolved') return null;
  if (ticket.status === 'resolved') return null; // reopen oleh requester
  if (approvals.some((a) => a.status === 'pending')) {
    return { code: 'approval_pending', message: 'Masih menunggu persetujuan; tiket belum bisa diproses' };
  }
  if (to === 'in_progress' && ticket.status === 'assigned' && requiresItHod(ticket)) {
    if (latestByStep(approvals).it_hod?.status !== 'approved') {
      return {
        code: 'it_hod_required',
        message: 'Jenis permintaan ini wajib disetujui Head IT sebelum dikerjakan',
      };
    }
  }
  return null;
}
