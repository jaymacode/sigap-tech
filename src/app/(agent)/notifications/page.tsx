import { requireUser } from '@/server/auth/session';
import { listUserNotifications } from '@/server/queries/notifications';
import { NotificationsClient } from './notifications-client';

interface PageProps {
  searchParams: Promise<{ unreadOnly?: string }>;
}

export default async function NotificationsPage({ searchParams }: PageProps) {
  const user = await requireUser();
  const { unreadOnly } = await searchParams;

  let notifications = listUserNotifications(user.id, 50);

  if (unreadOnly === 'true') {
    notifications = notifications.filter((n) => !n.readAt);
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-fg text-xl font-bold tracking-tight">Pusat Notifikasi</h1>
          <p className="text-muted text-xs">
            Riwayat pemberitahuan penugasan tiket, peringatan SLA, dan pesan baru.
          </p>
        </div>
      </div>

      {/* Tabs & Client List */}
      <NotificationsClient notifications={notifications} unreadOnly={unreadOnly === 'true'} />
    </div>
  );
}
