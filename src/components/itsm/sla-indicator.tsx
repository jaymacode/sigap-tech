'use client';

import * as React from 'react';
import { AlertOctagon, AlertTriangle, CheckCircle2, Clock, PauseCircle } from 'lucide-react';
import { computeSlaState } from '@/domain/sla';
import { formatDateTime, formatSlaRemaining, formatSlaTarget } from '@/lib/format';
import { cn } from '@/lib/utils';
import { fromSlaSnapshot, type SlaSnapshot } from '@/lib/views';
import { DEFAULT_TIMEZONE, DEFAULT_WORK_HOURS, type BusinessCalendar } from '@/domain/calendar';
import { Tooltip } from '@/components/ui/menu';

const FALLBACK_CALENDAR: BusinessCalendar = {
  kind: 'business_hours',
  timezone: DEFAULT_TIMEZONE,
  workHours: DEFAULT_WORK_HOURS,
  holidays: [],
};

export interface SlaIndicatorProps {
  sla: SlaSnapshot;
  calendar?: BusinessCalendar;
  showKind?: boolean;
  className?: string;
}

export function SlaIndicator({ sla, calendar, showKind = false, className }: SlaIndicatorProps) {
  const [now, setNow] = React.useState<Date>(() => new Date());

  // Update countdown tiap 60 detik jika statusnya running
  React.useEffect(() => {
    if (sla.status !== 'running') return;
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, [sla.status]);

  const domainInstance = React.useMemo(() => fromSlaSnapshot(sla), [sla]);
  const cal = calendar ?? FALLBACK_CALENDAR;
  const calKind = cal.kind;

  // Evaluasi state SLA saat ini
  const state = React.useMemo(() => {
    return computeSlaState(domainInstance, now, cal);
  }, [domainInstance, now, cal]);

  const kindLabel = sla.kind === 'response' ? 'Resp' : 'Res';
  const dueTimeFormatted = formatDateTime(sla.dueAt);
  const remainingStr = formatSlaRemaining(state.remainingMinutes, calKind);

  let icon = <Clock className="size-3.5 shrink-0" />;
  let text = remainingStr;
  let colorStyle = 'text-fg/80 border-border bg-surface-2/60';
  let title =
    calKind === 'business_hours'
      ? `Sisa waktu SLA: ${remainingStr} (jam kerja efektif). Jatuh tempo: ${dueTimeFormatted}`
      : `Sisa waktu SLA: ${remainingStr} (24x7). Jatuh tempo: ${dueTimeFormatted}`;

  if (state.status === 'met') {
    icon = <CheckCircle2 className="text-sla-ok size-3.5 shrink-0" />;
    text = 'Tepat Waktu';
    colorStyle = 'text-sla-ok border-sla-ok/30 bg-sla-ok/10';
    title = `SLA tercapai (Target: ${formatSlaTarget(sla.targetMinutes, calKind)})`;
  } else if (state.status === 'breached' || state.breached) {
    icon = <AlertOctagon className="text-sla-breach animate-pulse-soft size-3.5 shrink-0" />;
    const overdue = Math.max(0, -state.remainingMinutes);
    text = overdue > 0 ? `Lewat ${formatSlaRemaining(overdue, calKind)}` : 'Terlewati';
    colorStyle = 'text-sla-breach border-sla-breach/30 bg-sla-breach/10';
    title = `SLA terlewati pada ${dueTimeFormatted}`;
  } else if (state.status === 'paused') {
    icon = <PauseCircle className="size-3.5 shrink-0 text-purple-600 dark:text-purple-400" />;
    text = `Jeda (${remainingStr})`;
    colorStyle =
      'text-purple-700 dark:text-purple-300 border-purple-300 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/40';
    title = `SLA dijeda. Sisa waktu saat resume: ${remainingStr}`;
  } else if (state.atRisk) {
    icon = <AlertTriangle className="text-sla-risk animate-pulse-soft size-3.5 shrink-0" />;
    text = remainingStr;
    colorStyle = 'text-sla-risk border-sla-risk/30 bg-sla-risk/10';
    title = `SLA mendekati batas (≥75%). Sisa ${remainingStr}. Jatuh tempo: ${dueTimeFormatted}`;
  }

  return (
    <Tooltip content={title}>
      <span
        className={cn(
          'tabular inline-flex shrink-0 cursor-default items-center gap-1 rounded-sm border px-2 py-0.5 font-mono text-xs font-medium transition-colors',
          colorStyle,
          className,
        )}
      >
        {icon}
        {showKind ? <span className="font-sans font-semibold opacity-75">{kindLabel}:</span> : null}
        <span>{text}</span>
      </span>
    </Tooltip>
  );
}
