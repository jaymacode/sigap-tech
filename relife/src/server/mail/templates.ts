import type { TicketRecord } from '@/server/mock/types';

export type MailKind =
  | 'created'
  | 'staff_reply'
  | 'requester_reply'
  | 'assigned'
  | 'awaiting_user'
  | 'resolved'
  | 'reopened'
  | 'sla_warning'
  | 'sla_breached';

export interface MailContext {
  kind: MailKind;
  ticket: Pick<TicketRecord, 'number' | 'title' | 'priority'>;
  /** Penerima adalah requester (link portal) atau staf (link /tickets). */
  forRequester: boolean;
  /** Kutipan pesan terakhir (opsional). */
  excerpt?: string;
  /** Nama pelaku (mis. requester yang membalas). */
  actorName?: string;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function baseUrl(): string {
  return (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
}

export function ticketLink(number: string, forRequester: boolean): string {
  return `${baseUrl()}${forRequester ? '/portal/tickets/' : '/tickets/'}${encodeURIComponent(number)}`;
}

export function excerptOf(body: string, max = 280): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

const COPY: Record<MailKind, { subject: (n: string) => string; lead: (c: MailContext) => string }> = {
  created: {
    subject: (n) => `[${n}] Tiket Anda telah kami terima`,
    lead: () => 'Terima kasih, tiket Anda sudah kami terima dan akan segera ditangani oleh tim IT.',
  },
  staff_reply: {
    subject: (n) => `[${n}] Balasan baru dari tim IT`,
    lead: () => 'Tim IT membalas tiket Anda.',
  },
  requester_reply: {
    subject: (n) => `[${n}] Requester membalas tiket`,
    lead: (c) => `${c.actorName || 'Requester'} membalas tiket ini.`,
  },
  assigned: {
    subject: (n) => `[${n}] Tiket ditugaskan kepada Anda`,
    lead: () => 'Sebuah tiket ditugaskan kepada Anda.',
  },
  awaiting_user: {
    subject: (n) => `[${n}] Tiket menunggu jawaban Anda`,
    lead: () => 'Tim IT membutuhkan informasi tambahan dari Anda agar tiket dapat dilanjutkan.',
  },
  resolved: {
    subject: (n) => `[${n}] Tiket Anda telah diselesaikan`,
    lead: () =>
      'Tiket Anda ditandai selesai. Mohon konfirmasi apakah masalah sudah teratasi dan berikan penilaian (CSAT). Jika tidak ada respons, tiket akan ditutup otomatis setelah 3 hari kerja.',
  },
  reopened: {
    subject: (n) => `[${n}] Tiket dibuka kembali oleh requester`,
    lead: () => 'Requester membuka kembali tiket yang sebelumnya selesai.',
  },
  sla_warning: {
    subject: (n) => `[${n}] Peringatan SLA: mendekati batas`,
    lead: () => 'SLA tiket ini sudah terpakai 75% dan mendekati batas waktu.',
  },
  sla_breached: {
    subject: (n) => `[${n}] SLA terlampaui (breach)`,
    lead: () => 'SLA tiket ini telah terlampaui. Mohon segera ditindaklanjuti.',
  },
};

/** Merender subject + teks + HTML (inline style minimal). Semua nilai dinamis di-escape. */
export function renderMail(ctx: MailContext): { subject: string; text: string; html: string } {
  const copy = COPY[ctx.kind];
  const { number, title, priority } = ctx.ticket;
  const lead = copy.lead(ctx);
  const link = ticketLink(number, ctx.forRequester);
  const quote = ctx.excerpt ? excerptOf(ctx.excerpt) : '';

  const text = [
    lead,
    '',
    `Tiket    : ${number}`,
    `Judul    : ${title}`,
    `Prioritas: ${priority}`,
    ...(quote ? ['', `Pesan: "${quote}"`] : []),
    '',
    `Buka tiket: ${link}`,
    '',
    '— Sigap IT Service Desk',
  ].join('\n');

  const html = `<!doctype html><html lang="id"><body style="margin:0;padding:16px;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#1f2933">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e1e4e8;border-radius:8px;padding:24px">
<p style="margin:0 0 16px;font-size:15px;line-height:1.5">${escapeHtml(lead)}</p>
<table role="presentation" style="font-size:14px;line-height:1.6;border-collapse:collapse">
<tr><td style="padding-right:12px;color:#6b7280">Tiket</td><td><strong>${escapeHtml(number)}</strong></td></tr>
<tr><td style="padding-right:12px;color:#6b7280">Judul</td><td>${escapeHtml(title)}</td></tr>
<tr><td style="padding-right:12px;color:#6b7280">Prioritas</td><td>${escapeHtml(priority)}</td></tr>
</table>
${quote ? `<blockquote style="margin:16px 0;padding:8px 12px;border-left:3px solid #cbd2d9;color:#3e4c59;font-size:14px">${escapeHtml(quote)}</blockquote>` : ''}
<p style="margin:20px 0 0"><a href="${escapeHtml(link)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-size:14px">Buka tiket</a></p>
<p style="margin:20px 0 0;font-size:12px;color:#6b7280">Sigap IT Service Desk</p>
</div></body></html>`;

  return { subject: copy.subject(number), text, html };
}
