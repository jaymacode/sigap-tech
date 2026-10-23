import Link from 'next/link';
import { requireUser } from '@/server/auth/session';
import { listUserNotifications, unreadNotificationCount } from '@/server/queries/notifications';
import { CommandMenu } from '@/components/layout/command-menu';
import { NotificationBell } from '@/components/layout/notification-bell';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { UserMenu } from '@/components/layout/user-menu';

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const notifications = listUserNotifications(user.id, 10);
  const unreadCount = unreadNotificationCount(user.id);

  return (
    <div className="bg-bg text-fg flex min-h-screen flex-col">
      {/* Topbar Requester */}
      <header className="border-border bg-surface/95 sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between border-b px-4 backdrop-blur sm:px-8">
        <div className="flex items-center gap-6">
          <Link href="/portal" className="flex items-center gap-2.5">
            <div className="bg-accent text-accent-fg flex size-7 items-center justify-center rounded-lg text-sm font-black shadow-xs">
              S
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-fg text-base font-bold tracking-tight">Sigap</span>
              <span className="text-muted hidden text-xs sm:inline">Pusat Layanan IT</span>
            </div>
          </Link>

          <nav className="hidden items-center gap-4 text-xs font-medium md:flex">
            <Link href="/portal" className="text-fg/80 hover:text-accent transition-colors">
              Katalog Layanan
            </Link>
            <Link href="/portal/tickets" className="text-fg/80 hover:text-accent transition-colors">
              Tiket Saya
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-2.5">
          <CommandMenu isAgent={false} />
          <NotificationBell
            initialNotifications={notifications}
            initialUnreadCount={unreadCount}
            isAgent={false}
          />
          <ThemeToggle />
          <div className="bg-border mx-1 h-4 w-px" />
          <UserMenu user={user} />
        </div>
      </header>

      {/* Konten tengah max-width 960px sesuai DESIGN.md §3 */}
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6">{children}</main>

      {/* Footer */}
      <footer className="border-border bg-surface/40 text-muted border-t py-6 text-center text-xs">
        <div className="mx-auto flex max-w-4xl flex-col items-center justify-between gap-3 px-4 sm:flex-row">
          <p>© 2026 Sigap IT Service Desk. Jam Layanan: Senin–Jumat 08:00–17:00 WIB.</p>
          {user.role !== 'requester' ? (
            <Link
              href="/queue"
              className="text-accent inline-flex items-center gap-1 font-medium hover:underline"
            >
              <span>Buka Agent Workspace</span>
              <span aria-hidden="true">→</span>
            </Link>
          ) : null}
        </div>
      </footer>
    </div>
  );
}
