import { getStore } from '@/server/mock/db';
import type { NotificationRecord } from '@/server/mock/types';

export interface NotificationItem {
  id: string;
  ticketId: string | null;
  ticketNumber: string;
  type: NotificationRecord['type'];
  title: string;
  readAt: string | null;
  createdAt: string;
}

/**
 * Mengambil daftar notifikasi milik user.
 */
export function listUserNotifications(userId: string, limit = 20): NotificationItem[] {
  const store = getStore();
  const list = store.notifications
    .filter((n) => n.userId === userId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit);

  return list.map((n) => {
    const t = n.ticketId ? store.tickets.get(n.ticketId) : undefined;
    return {
      id: n.id,
      ticketId: n.ticketId,
      ticketNumber: t?.number ?? 'TKT',
      type: n.type,
      title: n.title,
      readAt: n.readAt ? n.readAt.toISOString() : null,
      createdAt: n.createdAt.toISOString(),
    };
  });
}

/**
 * Jumlah notifikasi yang belum dibaca.
 */
export function unreadNotificationCount(userId: string): number {
  const store = getStore();
  return store.notifications.filter((n) => n.userId === userId && !n.readAt).length;
}
