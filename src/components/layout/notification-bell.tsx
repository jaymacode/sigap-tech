'use client';

import * as React from 'react';
import Link from 'next/link';
import { Bell, Check, ExternalLink } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/menu';
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from '@/server/actions/tickets';
import { formatRelative } from '@/lib/format';
import type { NotificationItem } from '@/server/queries/notifications';

interface NotificationBellProps {
  initialNotifications?: NotificationItem[];
  initialUnreadCount?: number;
  isAgent?: boolean;
}

export function NotificationBell({
  initialNotifications = [],
  initialUnreadCount = 0,
  isAgent = true,
}: NotificationBellProps) {
  const [unread, setUnread] = React.useState(initialUnreadCount);
  const [items, setItems] = React.useState(initialNotifications);
  const [isPending, startTransition] = React.useTransition();

  const handleMarkAllRead = () => {
    startTransition(async () => {
      await markAllNotificationsReadAction();
      setUnread(0);
      setItems((prev) => prev.map((n) => ({ ...n, readAt: new Date().toISOString() })));
    });
  };

  const handleClickItem = (id: string) => {
    startTransition(async () => {
      await markNotificationReadAction(id);
      setUnread((u) => Math.max(0, u - 1));
      setItems((prev) =>
        prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)),
      );
    });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="text-muted hover:bg-surface-2 hover:text-fg focus-visible:outline-accent relative flex size-8 items-center justify-center rounded-md focus-visible:outline-2"
          aria-label={`Notifikasi (${unread} belum dibaca)`}
          title="Notifikasi"
        >
          <Bell className="size-4" />
          {unread > 0 ? (
            <span className="absolute top-1 right-1 flex size-2">
              <span className="bg-danger absolute inline-flex size-full animate-ping rounded-full opacity-75" />
              <span className="bg-danger relative inline-flex size-2 rounded-full" />
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="shadow-pop w-80 p-0">
        <div className="border-border flex items-center justify-between border-b px-4 py-2.5">
          <div className="flex items-center gap-1.5">
            <span className="text-fg text-sm font-semibold">Notifikasi</span>
            {unread > 0 ? (
              <span className="bg-accent/10 py-0.2 text-accent rounded-full px-1.5 font-mono text-[10px] font-bold">
                {unread}
              </span>
            ) : null}
          </div>
          {unread > 0 ? (
            <button
              onClick={handleMarkAllRead}
              disabled={isPending}
              className="text-accent inline-flex items-center gap-1 text-xs hover:underline"
            >
              <Check className="size-3" />
              <span>Tandai dibaca</span>
            </button>
          ) : null}
        </div>

        <div className="divide-border/60 max-h-72 scrollbar-thin divide-y overflow-y-auto">
          {items.length === 0 ? (
            <div className="text-muted py-8 text-center text-xs">Tidak ada notifikasi</div>
          ) : (
            items.slice(0, 8).map((item) => {
              const href = isAgent
                ? `/tickets/${item.ticketNumber}`
                : `/portal/tickets/${item.ticketNumber}`;
              const isUnread = !item.readAt;

              return (
                <Link
                  key={item.id}
                  href={href}
                  onClick={() => isUnread && handleClickItem(item.id)}
                  className={`hover:bg-surface-2 block px-4 py-3 text-xs transition-colors ${
                    isUnread ? 'bg-accent/5 font-medium' : 'text-muted'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-fg">{item.title}</span>
                    {isUnread ? (
                      <span className="bg-accent mt-1 size-1.5 shrink-0 rounded-full" />
                    ) : null}
                  </div>
                  <span className="text-muted mt-1 block text-[11px]">
                    {formatRelative(item.createdAt, new Date())}
                  </span>
                </Link>
              );
            })
          )}
        </div>

        <div className="border-border border-t p-2 text-center">
          <Link
            href="/notifications"
            className="text-accent inline-flex items-center gap-1 text-xs font-medium hover:underline"
          >
            <span>Buka pusat notifikasi</span>
            <ExternalLink className="size-3" />
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
