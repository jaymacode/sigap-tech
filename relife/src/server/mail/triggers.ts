import type { Store } from '@/server/mock/store';
import type { NotificationType, TicketRecord, UserRecord } from '@/server/mock/types';
import { enqueueMail } from './mailer';
import { renderMail, type MailContext, type MailKind } from './templates';

function emailTo(store: Store, userId: string): UserRecord | null {
  const u = store.users.get(userId);
  return u && u.isActive && u.email ? u : null;
}

function lastPublicComment(
  store: Store,
  ticketId: string,
): { body: string; authorId: string } | null {
  const list = store.comments.get(ticketId) ?? [];
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]!.visibility === 'public') return list[i]!;
  }
  return null;
}

function send(
  store: Store,
  user: UserRecord,
  ticket: TicketRecord,
  ctx: Omit<MailContext, 'ticket' | 'forRequester'>,
  now: Date,
): void {
  const mail = renderMail({ ...ctx, ticket, forRequester: user.id === ticket.requesterId });
  enqueueMail(store, { to: user.email, ...mail, ticketId: ticket.id }, now);
}

/** Konfirmasi tiket dibuat → requester. */
export function mailTicketCreated(store: Store, ticket: TicketRecord, now: Date): void {
  const user = emailTo(store, ticket.requesterId);
  if (user) send(store, user, ticket, { kind: 'created', excerpt: ticket.description }, now);
}

/**
 * Dipanggil dari `notify()` (setelah filter penerima/pelaku). Memetakan notifikasi in-app ke email;
 * jenis yang tidak relevan (mis. status closed/cancelled) diabaikan.
 */
export function mailForNotification(
  store: Store,
  userId: string,
  type: NotificationType,
  ticket: TicketRecord,
  now: Date,
): void {
  const user = emailTo(store, userId);
  if (!user) return;
  const toRequester = userId === ticket.requesterId;
  let kind: MailKind | null = null;
  let excerpt: string | undefined;
  let actorName: string | undefined;

  switch (type) {
    case 'assigned':
      kind = 'assigned';
      break;
    case 'comment': {
      const c = lastPublicComment(store, ticket.id);
      excerpt = c?.body;
      if (toRequester) kind = 'staff_reply';
      else {
        kind = 'requester_reply';
        actorName = c ? store.users.get(c.authorId)?.name : undefined;
      }
      break;
    }
    case 'status_changed':
      if (!toRequester) kind = 'reopened';
      else if (ticket.status === 'resolved') kind = 'resolved';
      else if (ticket.status === 'pending' && ticket.pendingReason === 'awaiting_user')
        kind = 'awaiting_user';
      break;
    case 'sla_warning':
    case 'sla_breached':
      kind = type;
      break;
  }
  if (kind) send(store, user, ticket, { kind, excerpt, actorName }, now);
}
