'use client';

import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { computeSlaState } from '@/domain/sla';
import { formatDateTime, formatDuration } from '@/lib/format';
import { fromSlaSnapshot, type SlaSnapshot } from '@/lib/views';
import { DEFAULT_TIMEZONE, DEFAULT_WORK_HOURS, type BusinessCalendar } from '@/domain/calendar';
import { SlaIndicator } from './sla-indicator';
import { SlaProgress } from './sla-progress';

const FALLBACK_CALENDAR: BusinessCalendar = {
  kind: 'business_hours',
  timezone: DEFAULT_TIMEZONE,
  workHours: DEFAULT_WORK_HOURS,
  holidays: [],
};

export interface SlaCardProps {
  response: SlaSnapshot;
  resolution: SlaSnapshot;
  policyName: string;
  calendar?: BusinessCalendar;
}

export function SlaCard({ response, resolution, policyName, calendar }: SlaCardProps) {
  const [now, setNow] = React.useState<Date>(() => new Date());

  React.useEffect(() => {
    const isAnyRunning = response.status === 'running' || resolution.status === 'running';
    if (!isAnyRunning) return;
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, [response.status, resolution.status]);

  const cal = calendar ?? FALLBACK_CALENDAR;

  const respState = React.useMemo(() => {
    return computeSlaState(fromSlaSnapshot(response), now, cal);
  }, [response, now, cal]);

  const resState = React.useMemo(() => {
    return computeSlaState(fromSlaSnapshot(resolution), now, cal);
  }, [resolution, now, cal]);

  return (
    <Card className="shadow-xs">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-muted text-sm font-semibold tracking-wide uppercase">
          Perjanjian SLA
        </CardTitle>
        <span className="bg-surface-2 text-muted rounded px-2 py-0.5 text-xs font-medium">
          {policyName}
        </span>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-xs">
        {/* Response SLA */}
        <div className="border-border flex flex-col gap-1.5 border-b pb-3">
          <div className="flex items-center justify-between">
            <span className="text-fg font-semibold">First Response</span>
            <SlaIndicator sla={response} calendar={calendar} />
          </div>
          <SlaProgress
            percentUsed={respState.percentUsed}
            status={respState.status}
            atRisk={respState.atRisk}
          />
          <div className="text-muted flex items-center justify-between pt-0.5">
            <span>Target: {formatDuration(response.targetMinutes)}</span>
            <span>
              {response.stoppedAt
                ? `Selesai ${formatDateTime(response.stoppedAt)}`
                : `Batas: ${formatDateTime(response.dueAt)}`}
            </span>
          </div>
        </div>

        {/* Resolution SLA */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-fg font-semibold">Resolution</span>
            <SlaIndicator sla={resolution} calendar={calendar} />
          </div>
          <SlaProgress
            percentUsed={resState.percentUsed}
            status={resState.status}
            atRisk={resState.atRisk}
          />
          <div className="text-muted flex items-center justify-between pt-0.5">
            <span>Target: {formatDuration(resolution.targetMinutes)}</span>
            <span>
              {resolution.stoppedAt
                ? `Selesai ${formatDateTime(resolution.stoppedAt)}`
                : `Batas: ${formatDateTime(resolution.dueAt)}`}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
