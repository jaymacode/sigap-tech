'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  AlertOctagon,
  AlertTriangle,
  FolderOpen,
  Inbox,
  LayoutDashboard,
  LifeBuoy,
  Menu,
  Settings,
  User,
  Users,
} from 'lucide-react';
import { Dialog, SheetContent } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { QueueResult } from '@/server/queries/tickets';
import type { SessionUser } from '@/server/auth/session';

interface AgentSidebarProps {
  user: SessionUser;
  counts: QueueResult['counts'];
}

export function AgentSidebar({ user, counts }: AgentSidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentView = searchParams.get('view') ?? 'team';
  const [mobileOpen, setMobileOpen] = React.useState(false);

  const isQueue = pathname === '/queue' || pathname.startsWith('/tickets');
  const isDashboard = pathname === '/dashboard';
  const isAdmin = pathname === '/admin';

  const navContent = (
    <div className="flex h-full flex-col justify-between p-3">
      <div className="flex flex-col gap-6">
        {/* Brand */}
        <div className="flex items-center gap-2.5 px-2 py-1">
          <div className="bg-accent text-accent-fg flex size-7 items-center justify-center rounded-lg text-sm font-black tracking-tight shadow-xs">
            S
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-fg text-base font-bold tracking-tight">Sigap</span>
            <span className="bg-accent-soft/70 py-0.2 text-accent rounded px-1.5 text-[10px] font-semibold">
              ITSM
            </span>
          </div>
        </div>

        {/* Queue Views */}
        <div className="flex flex-col gap-1">
          <span className="text-muted px-2 text-[11px] font-semibold tracking-wider uppercase">
            Queue Tiket
          </span>
          <nav className="flex flex-col gap-0.5">
            <Link
              href="/queue?view=team"
              onClick={() => setMobileOpen(false)}
              className={cn(
                'flex items-center justify-between rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                isQueue && currentView === 'team'
                  ? 'bg-accent/10 text-accent font-semibold'
                  : 'text-fg/80 hover:bg-surface-2 hover:text-fg',
              )}
            >
              <div className="flex items-center gap-2">
                <Users className="size-4" />
                <span>Team Queue</span>
              </div>
              <span className="tabular text-muted font-mono text-xs">{counts.team}</span>
            </Link>

            <Link
              href="/queue?view=my"
              onClick={() => setMobileOpen(false)}
              className={cn(
                'flex items-center justify-between rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                isQueue && currentView === 'my'
                  ? 'bg-accent/10 text-accent font-semibold'
                  : 'text-fg/80 hover:bg-surface-2 hover:text-fg',
              )}
            >
              <div className="flex items-center gap-2">
                <User className="size-4" />
                <span>My Tickets</span>
              </div>
              <span className="tabular text-muted font-mono text-xs">{counts.my}</span>
            </Link>

            <Link
              href="/queue?view=unassigned"
              onClick={() => setMobileOpen(false)}
              className={cn(
                'flex items-center justify-between rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                isQueue && currentView === 'unassigned'
                  ? 'bg-accent/10 text-accent font-semibold'
                  : 'text-fg/80 hover:bg-surface-2 hover:text-fg',
              )}
            >
              <div className="flex items-center gap-2">
                <Inbox className="size-4" />
                <span>Unassigned</span>
              </div>
              <span className="tabular text-muted font-mono text-xs">{counts.unassigned}</span>
            </Link>

            <Link
              href="/queue?view=at_risk"
              onClick={() => setMobileOpen(false)}
              className={cn(
                'flex items-center justify-between rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                isQueue && currentView === 'at_risk'
                  ? 'bg-amber-500/10 font-semibold text-amber-600 dark:text-amber-400'
                  : 'text-fg/80 hover:bg-surface-2 hover:text-fg',
              )}
            >
              <div className="flex items-center gap-2">
                <AlertTriangle className="size-4 text-amber-500" />
                <span>At Risk (≥75%)</span>
              </div>
              {counts.at_risk > 0 ? (
                <span className="py-0.2 tabular rounded-full bg-amber-500/20 px-1.5 font-mono text-[10px] font-bold text-amber-600 dark:text-amber-400">
                  {counts.at_risk}
                </span>
              ) : (
                <span className="tabular text-muted font-mono text-xs">0</span>
              )}
            </Link>

            <Link
              href="/queue?view=breached"
              onClick={() => setMobileOpen(false)}
              className={cn(
                'flex items-center justify-between rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                isQueue && currentView === 'breached'
                  ? 'bg-rose-500/10 font-semibold text-rose-600 dark:text-rose-400'
                  : 'text-fg/80 hover:bg-surface-2 hover:text-fg',
              )}
            >
              <div className="flex items-center gap-2">
                <AlertOctagon className="size-4 text-rose-500" />
                <span>Breached</span>
              </div>
              {counts.breached > 0 ? (
                <span className="py-0.2 tabular rounded-full bg-rose-500/20 px-1.5 font-mono text-[10px] font-bold text-rose-600 dark:text-rose-400">
                  {counts.breached}
                </span>
              ) : (
                <span className="tabular text-muted font-mono text-xs">0</span>
              )}
            </Link>

            <Link
              href="/queue?view=all"
              onClick={() => setMobileOpen(false)}
              className={cn(
                'flex items-center justify-between rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                isQueue && currentView === 'all'
                  ? 'bg-accent/10 text-accent font-semibold'
                  : 'text-fg/80 hover:bg-surface-2 hover:text-fg',
              )}
            >
              <div className="flex items-center gap-2">
                <FolderOpen className="size-4" />
                <span>Semua Tiket</span>
              </div>
            </Link>
          </nav>
        </div>

        {/* Management & Analytics */}
        <div className="flex flex-col gap-1">
          <span className="text-muted px-2 text-[11px] font-semibold tracking-wider uppercase">
            Analitik & Kelola
          </span>
          <nav className="flex flex-col gap-0.5">
            <Link
              href="/dashboard"
              onClick={() => setMobileOpen(false)}
              className={cn(
                'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                isDashboard
                  ? 'bg-accent/10 text-accent font-semibold'
                  : 'text-fg/80 hover:bg-surface-2 hover:text-fg',
              )}
            >
              <LayoutDashboard className="size-4" />
              <span>Dashboard KPI</span>
            </Link>

            {user.role === 'admin' ? (
              <Link
                href="/admin"
                onClick={() => setMobileOpen(false)}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                  isAdmin
                    ? 'bg-accent/10 text-accent font-semibold'
                    : 'text-fg/80 hover:bg-surface-2 hover:text-fg',
                )}
              >
                <Settings className="size-4" />
                <span>Pengaturan Admin</span>
              </Link>
            ) : null}
          </nav>
        </div>
      </div>

      {/* Footer Switcher */}
      <div className="border-border border-t pt-3">
        <Link
          href="/portal"
          className="text-muted hover:bg-surface-2 hover:text-fg flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs transition-colors"
        >
          <LifeBuoy className="size-4" />
          <span>Lihat Portal Requester</span>
        </Link>
      </div>
    </div>
  );

  return (
    <>
      {/* Tombol menu mobile */}
      <button
        onClick={() => setMobileOpen(true)}
        className="text-muted hover:bg-surface-2 hover:text-fg flex size-8 items-center justify-center rounded-md md:hidden"
        aria-label="Buka menu navigasi"
      >
        <Menu className="size-5" />
      </button>

      {/* Sheet navigasi mobile */}
      <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent>{navContent}</SheetContent>
      </Dialog>

      {/* Sidebar Desktop */}
      <aside className="border-border bg-surface hidden w-60 shrink-0 border-r md:block">
        {navContent}
      </aside>
    </>
  );
}
