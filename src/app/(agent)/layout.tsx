import { requireUser } from '@/server/auth/session';
import { getStore } from '@/server/mock/db';
import { queueCounts } from '@/server/queries/tickets';
import { listUserNotifications, unreadNotificationCount } from '@/server/queries/notifications';
import { AgentSidebar } from '@/components/layout/agent-sidebar';
import { CommandMenu } from '@/components/layout/command-menu';
import { NotificationBell } from '@/components/layout/notification-bell';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { UserMenu } from '@/components/layout/user-menu';

export default async function AgentLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser(['agent', 'lead', 'admin']);
  const store = getStore();
  const counts = queueCounts(store, user, new Date());
  const notifications = listUserNotifications(user.id, 10);
  const unreadCount = unreadNotificationCount(user.id);

  return (
    <div className="bg-bg flex h-screen w-full overflow-hidden">
      {/* Sidebar kiri */}
      <AgentSidebar user={user} counts={counts} />

      {/* Area konten utama */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Topbar */}
        <header className="border-border bg-surface flex h-12 shrink-0 items-center justify-between border-b px-4 shadow-xs">
          <div className="flex items-center gap-3">
            {/* Command search ⌘K */}
            <CommandMenu isAgent={true} />
          </div>

          <div className="flex items-center gap-2">
            <NotificationBell
              initialNotifications={notifications}
              initialUnreadCount={unreadCount}
              isAgent={true}
            />
            <ThemeToggle />
            <div className="bg-border mx-1 h-4 w-px" />
            <UserMenu user={user} />
          </div>
        </header>

        {/* Konten halaman */}
        <main className="flex-1 scrollbar-thin overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
