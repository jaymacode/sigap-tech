import * as React from 'react';
import { Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'border-border bg-surface/50 flex flex-col items-center justify-center rounded-xl border border-dashed p-12 text-center',
        className,
      )}
    >
      <div className="bg-surface-2 text-muted mb-3 flex size-12 items-center justify-center rounded-full">
        {icon ?? <Inbox className="size-6 stroke-[1.5]" />}
      </div>
      <h3 className="text-fg text-base font-semibold">{title}</h3>
      {description ? <p className="text-muted mt-1 max-w-sm text-sm">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
