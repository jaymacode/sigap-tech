'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import type { SlaState } from '@/domain/sla';

export interface SlaProgressProps {
  percentUsed: number;
  status: SlaState['status'];
  atRisk?: boolean;
  className?: string;
  showMarker?: boolean;
}

export function SlaProgress({
  percentUsed,
  status,
  atRisk = false,
  className,
  showMarker = true,
}: SlaProgressProps) {
  const clampedPercent = Math.min(100, Math.max(0, percentUsed));

  let barColor = 'bg-sla-ok';
  if (status === 'breached' || percentUsed >= 100) {
    barColor = 'bg-sla-breach';
  } else if (atRisk || percentUsed >= 75) {
    barColor = 'bg-sla-risk';
  }

  const isPaused = status === 'paused';

  return (
    <div
      className={cn(
        'bg-surface-2 border-border/60 relative h-2 w-full overflow-hidden rounded-full border',
        className,
      )}
      role="progressbar"
      aria-valuenow={Math.round(percentUsed)}
      aria-valuemin={0}
      aria-valuemax={100}
      title={`${Math.round(percentUsed)}% waktu SLA terpakai`}
    >
      {/* 75% risk threshold marker */}
      {showMarker ? (
        <span
          className="absolute top-0 bottom-0 left-[75%] z-10 w-0.5 bg-black/25 dark:bg-white/30"
          title="Batas Peringatan SLA (75%)"
        />
      ) : null}

      {/* Progress fill */}
      <div
        className={cn(
          'h-full transition-all duration-300 ease-out',
          barColor,
          isPaused && 'sla-paused-stripes opacity-75',
        )}
        style={{ width: `${clampedPercent}%` }}
      />
    </div>
  );
}
