'use client';

import * as React from 'react';
import { LogOut, UserCheck } from 'lucide-react';
import { Avatar } from '@/components/ui/controls';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/menu';
import { loginWithDemo, logout } from '@/server/actions/auth';
import type { SessionUser } from '@/server/auth/session';

export interface UserMenuProps {
  user: SessionUser;
}

export function UserMenu({ user }: UserMenuProps) {
  const [isPending, startTransition] = React.useTransition();

  const handleSwitch = (role: 'requester' | 'agent' | 'lead' | 'admin') => {
    startTransition(async () => {
      await loginWithDemo(role);
    });
  };

  const handleLogout = () => {
    startTransition(async () => {
      await logout();
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="hover:bg-surface-2 focus-visible:outline-accent flex items-center gap-2 rounded-full p-1 transition-colors focus-visible:outline-2"
          aria-label="Menu profil pengguna"
        >
          <Avatar name={user.name} size={30} />
          <span className="hidden text-left text-xs font-medium sm:block">
            <span className="text-fg block font-semibold">{user.name}</span>
            <span className="text-muted block text-[11px] capitalize">{user.role}</span>
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <div className="flex flex-col gap-0.5">
            <span className="text-fg font-semibold">{user.name}</span>
            <span className="text-muted text-[11px]">{user.email}</span>
            <span className="text-muted text-[10px] capitalize">
              {user.department} · Role: {user.role}
            </span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuGroup>
          <DropdownMenuLabel>Ganti Akun Demo</DropdownMenuLabel>
          <DropdownMenuItem
            disabled={isPending}
            onClick={() => handleSwitch('requester')}
            className={user.role === 'requester' ? 'text-accent font-semibold' : ''}
          >
            <UserCheck className="size-4" />
            <span>Requester (Maya)</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={isPending}
            onClick={() => handleSwitch('agent')}
            className={user.role === 'agent' ? 'text-accent font-semibold' : ''}
          >
            <UserCheck className="size-4" />
            <span>Agent L1 (Dimas)</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={isPending}
            onClick={() => handleSwitch('lead')}
            className={user.role === 'lead' ? 'text-accent font-semibold' : ''}
          >
            <UserCheck className="size-4" />
            <span>Team Lead (Rina)</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={isPending}
            onClick={() => handleSwitch('admin')}
            className={user.role === 'admin' ? 'text-accent font-semibold' : ''}
          >
            <UserCheck className="size-4" />
            <span>Administrator (Andi)</span>
          </DropdownMenuItem>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={isPending}
          onClick={handleLogout}
          destructive
          className="cursor-pointer"
        >
          <LogOut className="text-danger size-4" />
          <span>Keluar</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
