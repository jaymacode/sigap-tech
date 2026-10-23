import * as React from 'react';
import type { Priority } from '@/domain/types';
import { cn } from '@/lib/utils';

export interface PriorityBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  priority: Priority;
  showLabel?: boolean;
}

const LABELS: Record<Priority, string> = {
  P1: 'Critical',
  P2: 'High',
  P3: 'Medium',
  P4: 'Low',
};

const STYLES: Record<Priority, string> = {
  P1: 'bg-p1/10 text-p1 border-p1/30 hover:bg-p1/20',
  P2: 'bg-p2/10 text-p2 border-p2/30 hover:bg-p2/20',
  P3: 'bg-p3/10 text-p3 border-p3/30 hover:bg-p3/20',
  P4: 'bg-p4/10 text-p4 border-p4/30 hover:bg-p4/20',
};

/**
 * Priority badge pill (DESIGN.md §6). Teks P1–P4, warna tidak menjadi satu-satunya penanda.
 */
export function PriorityBadge({
  priority,
  showLabel = false,
  className,
  ...props
}: PriorityBadgeProps) {
  const label = LABELS[priority];

  return (
    <span
      className={cn(
        'tabular inline-flex shrink-0 items-center justify-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-xs font-semibold transition-colors',
        STYLES[priority],
        className,
      )}
      title={`Prioritas: ${priority} (${label})`}
      {...props}
    >
      <span>{priority}</span>
      {showLabel ? <span className="font-sans font-normal opacity-90">· {label}</span> : null}
    </span>
  );
}
