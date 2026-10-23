import * as React from 'react';
import type { TicketStatus } from '@/domain/types';
import { cn } from '@/lib/utils';

export interface StatusPillProps extends React.HTMLAttributes<HTMLSpanElement> {
  status: TicketStatus;
  mode?: 'agent' | 'requester';
}

const AGENT_LABELS: Record<TicketStatus, string> = {
  new: 'New',
  assigned: 'Assigned',
  in_progress: 'In Progress',
  pending: 'Pending',
  resolved: 'Resolved',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

const REQUESTER_LABELS: Record<TicketStatus, string> = {
  new: 'Terkirim',
  assigned: 'Diterima Tim',
  in_progress: 'Sedang Dikerjakan',
  pending: 'Menunggu Jawaban',
  resolved: 'Selesai',
  closed: 'Ditutup',
  cancelled: 'Dibatalkan',
};

const DOT_COLORS: Record<TicketStatus, string> = {
  new: 'bg-sky-500',
  assigned: 'bg-blue-500',
  in_progress: 'bg-amber-500',
  pending: 'bg-purple-500',
  resolved: 'bg-emerald-500',
  closed: 'bg-slate-400',
  cancelled: 'bg-rose-500',
};

/**
 * StatusPill netral dengan dot warna (DESIGN.md §6).
 */
export function StatusPill({ status, mode = 'agent', className, ...props }: StatusPillProps) {
  const label = mode === 'requester' ? REQUESTER_LABELS[status] : AGENT_LABELS[status];
  const dotColor = DOT_COLORS[status];

  return (
    <span
      className={cn(
        'border-border bg-surface-2/60 text-fg inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        className,
      )}
      {...props}
    >
      <span className={cn('size-1.5 shrink-0 rounded-full', dotColor)} aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
