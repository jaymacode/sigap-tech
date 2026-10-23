import * as React from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface KpiTileProps {
  title: string;
  value: string | number;
  subtitle?: string;
  status?: 'ok' | 'risk' | 'breach' | 'neutral';
  href?: string;
  className?: string;
}

const STATUS_BORDER: Record<'ok' | 'risk' | 'breach' | 'neutral', string> = {
  ok: 'border-l-4 border-l-sla-ok',
  risk: 'border-l-4 border-l-sla-risk',
  breach: 'border-l-4 border-l-sla-breach',
  neutral: '',
};

export function KpiTile({
  title,
  value,
  subtitle,
  status = 'neutral',
  href,
  className,
}: KpiTileProps) {
  const content = (
    <Card
      className={cn(
        'group transition-all duration-150',
        STATUS_BORDER[status],
        href && 'hover:border-border-strong hover:bg-surface-2/40 cursor-pointer',
        className,
      )}
    >
      <CardContent className="flex h-full flex-col justify-between gap-2 p-4">
        <span className="text-muted line-clamp-1 text-xs font-medium tracking-wider uppercase">
          {title}
        </span>
        <div className="tabular text-fg group-hover:text-accent font-mono text-2xl font-bold transition-colors">
          {value}
        </div>
        {subtitle ? <p className="text-muted line-clamp-1 pt-0.5 text-xs">{subtitle}</p> : null}
      </CardContent>
    </Card>
  );

  if (href) {
    return (
      <Link href={href} className="block no-underline">
        {content}
      </Link>
    );
  }

  return content;
}
