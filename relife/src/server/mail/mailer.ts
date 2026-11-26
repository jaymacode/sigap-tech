import { nextId, type Store } from '@/server/mock/store';

/**
 * Shared contract for outgoing email. Callers only enqueue; delivery (console/file/SMTP),
 * retries and persistence are the mailer's job (see ./worker.ts).
 */
export interface MailMessage {
  to: string;
  subject: string;
  /** Plain-text body (always required). */
  text: string;
  /** Optional HTML body. */
  html?: string;
  /** Ticket this mail belongs to, for traceability. */
  ticketId?: string | null;
}

/** Kill switch global: `MAIL_ENABLED=false` mematikan seluruh email (default aktif). */
export function mailEnabled(): boolean {
  return (process.env.MAIL_ENABLED ?? 'true').toLowerCase() !== 'false';
}

/**
 * Queue an email for delivery. Never throws for delivery problems: it only appends to the
 * store's durable outbox (persisted by the normal persistStore flow); the worker sends it.
 */
export function enqueueMail(store: Store, msg: MailMessage, now: Date): void {
  if (!mailEnabled()) return;
  store.mailOutbox.push({
    id: nextId(store, 'mail'),
    toEmail: msg.to,
    subject: msg.subject,
    text: msg.text,
    html: msg.html ?? null,
    ticketId: msg.ticketId ?? null,
    status: 'queued',
    attempts: 0,
    lastError: null,
    createdAt: now,
    sentAt: null,
    nextAttemptAt: now,
  });
}
