'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bell, Check, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/itsm/empty-state';
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from '@/server/actions/tickets';
import { formatDateTime, formatRelative } from '@/lib/format';
import type { NotificationItem } from '@/server/queries/notifications';

interface NotificationsClientProps {
  notifications: NotificationItem[];
  unreadOnly: boolean;
}

export function NotificationsClient({ notifications, unreadOnly }: NotificationsClientProps) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();

  const handleMarkAllRead = () => {
    startTransition(async () => {
      await markAllNotificationsReadAction();
      router.refresh();
    });
  };

  const handleReadOne = (id: string) => {
    startTransition(async () => {
      await markNotificationReadAction(id);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="border-border flex items-center justify-between border-b pb-2 text-xs">
        <div className="flex items-center gap-2">
          <Link
            href="/notifications"
            className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
              !unreadOnly
                ? 'bg-accent/10 text-accent font-semibold'
                : 'text-muted hover:bg-surface-2 hover:text-fg'
            }`}
          >
            Semua Notifikasi
          </Link>
          <Link
            href="/notifications?unreadOnly=true"
            className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
              unreadOnly
                ? 'bg-accent/10 text-accent font-semibold'
                : 'text-muted hover:bg-surface-2 hover:text-fg'
            }`}
          >
            Belum Dibaca
          </Link>
        </div>

        <Button
          variant="secondary"
          size="sm"
          disabled={isPending}
          onClick={handleMarkAllRead}
          className="h-7 gap-1.5 text-xs"
        >
          <Check className="size-3.5" />
          <span>Tandai Semua Telah Dibaca</span>
        </Button>
      </div>

      {notifications.length === 0 ? (
        <EmptyState
          icon={<Bell className="size-6 stroke-[1.5]" />}
          title="Tidak ada notifikasi"
          description={
            unreadOnly
              ? 'Semua notifikasi sudah Anda baca.'
              : 'Belum ada notifikasi baru untuk akun Anda.'
          }
        />
      ) : (
        <div className="divide-border/70 border-border bg-surface flex flex-col divide-y rounded-xl border shadow-xs">
          {notifications.map((n) => {
            const isUnread = !n.readAt;
            return (
              <div
                key={n.id}
                className={`hover:bg-surface-2/40 flex items-start justify-between gap-4 p-4 transition-colors ${
                  isUnread ? 'bg-accent/5' : ''
                }`}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={`mt-1 size-2 shrink-0 rounded-full ${
                      isUnread ? 'bg-accent' : 'bg-transparent'
                    }`}
                  />
                  <div className="flex flex-col gap-0.5">
                    <span className="text-fg text-xs font-semibold">{n.title}</span>
                    <span className="text-muted text-[11px]">
                      {formatDateTime(n.createdAt)} ({formatRelative(n.createdAt, new Date())})
                    </span>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {isUnread ? (
                    <button
                      onClick={() => handleReadOne(n.id)}
                      className="text-muted hover:text-fg text-xs font-medium"
                      title="Tandai dibaca"
                    >
                      Tandai dibaca
                    </button>
                  ) : null}

                  <Link
                    href={`/tickets/${n.ticketNumber}`}
                    className="bg-surface-2 border-border text-accent flex items-center gap-1 rounded border px-2 py-1 font-mono text-xs font-bold hover:underline"
                  >
                    <span>{n.ticketNumber}</span>
                    <ExternalLink className="size-3" />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
