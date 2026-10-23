'use client';

import * as React from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  FileText,
  Lock,
  MessageSquare,
  Pause,
  Play,
  RotateCcw,
  ShieldAlert,
  UserCheck,
} from 'lucide-react';
import { Avatar } from '@/components/ui/controls';
import { Tooltip } from '@/components/ui/menu';
import { formatDateTime, formatDayHeading, formatRelative, localDateKey } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { TimelineEntry } from '@/lib/views';

export interface TimelineProps {
  entries: TimelineEntry[];
  now?: Date;
  className?: string;
}

function eventIcon(type?: string) {
  switch (type) {
    case 'created':
      return <FileText className="text-accent size-3.5" />;
    case 'status_changed':
      return <ArrowRight className="size-3.5 text-sky-500" />;
    case 'assigned':
      return <UserCheck className="size-3.5 text-blue-500" />;
    case 'sla_paused':
      return <Pause className="size-3.5 text-purple-500" />;
    case 'sla_resumed':
      return <Play className="size-3.5 text-emerald-500" />;
    case 'sla_warning':
      return <AlertTriangle className="size-3.5 text-amber-500" />;
    case 'sla_breached':
      return <AlertOctagon className="size-3.5 text-rose-500" />;
    case 'priority_overridden':
    case 'priority_changed':
      return <ShieldAlert className="size-3.5 text-amber-600" />;
    case 'reopened':
      return <RotateCcw className="size-3.5 text-orange-500" />;
    default:
      return <span className="bg-muted size-1.5 rounded-full" />;
  }
}

function eventDescription(entry: TimelineEntry): string {
  const d = entry.data ?? {};
  switch (entry.eventType) {
    case 'created':
      return `Tiket dibuat dengan prioritas ${String(d.priority ?? '—')}`;
    case 'status_changed':
      return `Status diubah dari ${String(d.from ?? '')} menjadi ${String(d.to ?? '')}`;
    case 'assigned':
      return d.assigneeId ? `Tiket ditugaskan ke staff` : 'Penugasan tiket dilepas (Unassigned)';
    case 'escalated_functional':
      return `Dieskalasi fungsional ke tim lain${d.note ? `: "${String(d.note)}"` : ''}`;
    case 'escalated_hierarchical':
      return `Eskalasi hierarkis Level ${String(d.level ?? 1)} dipicu oleh sistem`;
    case 'sla_paused':
      return `Penghitungan SLA dijeda (Alasan: ${String(d.reason ?? 'Pending')})`;
    case 'sla_resumed':
      return `Penghitungan SLA dilanjutkan`;
    case 'sla_warning':
      return `Peringatan SLA: ${String(d.kind ?? '')} SLA telah terpakai ≥ 75%`;
    case 'sla_breached':
      return `Batas waktu SLA (${String(d.kind ?? '')}) terlewati (Breached)`;
    case 'sla_rebaselined':
      return `Target SLA dihitung ulang karena perubahan prioritas`;
    case 'priority_overridden':
      return `Prioritas di-override menjadi ${String(d.to ?? '')}. Alasan: "${String(d.reason ?? '')}"`;
    case 'priority_changed':
      return `Prioritas diperbarui dari ${String(d.from ?? '')} ke ${String(d.to ?? '')}`;
    case 'reopened':
      return `Tiket dibuka kembali oleh requester. Alasan: "${String(d.reason ?? '')}"`;
    case 'csat_submitted':
      return `Survei kepuasan (CSAT) diberikan: ${String(d.score ?? 5)} bintang`;
    default:
      return entry.eventType?.replace(/_/g, ' ') ?? 'Aktivitas sistem';
  }
}

export function Timeline({ entries, now = new Date(), className }: TimelineProps) {
  // Kelompokkan entri per hari
  const grouped = React.useMemo(() => {
    const map = new Map<string, TimelineEntry[]>();
    for (const e of entries) {
      const dateKey = localDateKey(e.at);
      const list = map.get(dateKey) ?? [];
      list.push(e);
      map.set(dateKey, list);
    }
    return Array.from(map.entries());
  }, [entries]);

  if (entries.length === 0) {
    return (
      <div className="text-muted flex flex-col items-center justify-center p-8 text-center">
        <MessageSquare className="mb-2 size-8 stroke-[1.5] opacity-50" />
        <p className="text-sm">Belum ada riwayat aktivitas pada tiket ini.</p>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-6', className)}>
      {grouped.map(([dateKey, dayEntries]) => (
        <div key={dateKey} className="flex flex-col gap-3">
          {/* Tanggal separator */}
          <div className="relative flex items-center justify-center">
            <div className="absolute inset-0 flex items-center">
              <div className="border-border w-full border-t" />
            </div>
            <span className="border-border bg-surface text-muted relative rounded-full border px-3 py-0.5 text-xs font-medium">
              {formatDayHeading(dayEntries[0]!.at)}
            </span>
          </div>

          {/* List entri */}
          <div className="flex flex-col gap-3">
            {dayEntries.map((entry) => {
              const fullTime = formatDateTime(entry.at);
              const relativeTime = formatRelative(entry.at, now);

              // 1. System Event
              if (entry.kind === 'event') {
                return (
                  <div
                    key={entry.id}
                    className="text-muted flex items-center gap-2.5 px-3 py-1.5 text-xs"
                  >
                    <span className="bg-surface-2 border-border flex size-6 shrink-0 items-center justify-center rounded-full border">
                      {eventIcon(entry.eventType)}
                    </span>
                    <span className="text-fg/80 flex-1">
                      {entry.actor ? (
                        <strong className="text-fg mr-1 font-semibold">{entry.actor.name}:</strong>
                      ) : null}
                      {eventDescription(entry)}
                    </span>
                    <Tooltip content={fullTime}>
                      <span className="text-muted tabular cursor-default text-xs">
                        {relativeTime}
                      </span>
                    </Tooltip>
                  </div>
                );
              }

              // 2. Comment or Internal Note
              const isInternal = entry.kind === 'internal';

              return (
                <div
                  key={entry.id}
                  className={cn(
                    'flex flex-col rounded-xl border p-4 shadow-xs transition-colors',
                    isInternal
                      ? 'border-note-border bg-note text-fg'
                      : 'border-border bg-surface text-fg',
                  )}
                >
                  {/* Header pesan */}
                  <div className="flex items-center justify-between gap-2 pb-2">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={entry.actor?.name ?? 'Sistem'} size={26} />
                      <div className="flex items-center gap-1.5">
                        <span className="text-fg text-sm font-semibold">
                          {entry.actor?.name ?? 'Pengguna'}
                        </span>
                        {entry.actor?.role && entry.actor.role !== 'requester' ? (
                          <span className="bg-surface-2 border-border/80 py-0.2 text-muted rounded border px-1.5 text-[10px] font-medium uppercase">
                            {entry.actor.role}
                          </span>
                        ) : null}
                        {isInternal ? (
                          <span className="flex items-center gap-1 rounded bg-amber-200/80 px-1.5 py-0.5 text-[11px] font-semibold text-amber-900 dark:bg-amber-900/60 dark:text-amber-200">
                            <Lock className="size-3" /> Catatan Internal
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <Tooltip content={fullTime}>
                      <span className="text-muted tabular cursor-default text-xs">
                        {relativeTime}
                      </span>
                    </Tooltip>
                  </div>

                  {/* Body pesan */}
                  <div className="text-fg pl-8 text-sm leading-relaxed whitespace-pre-wrap">
                    {entry.body}
                  </div>

                  {/* Lampiran */}
                  {entry.attachments && entry.attachments.length > 0 ? (
                    <div className="flex flex-wrap gap-2 pt-3 pl-8">
                      {entry.attachments.map((att) => (
                        <div
                          key={att.id}
                          className="border-border/80 bg-surface text-fg flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs"
                        >
                          <FileText className="text-muted size-3.5" />
                          <span className="font-medium">{att.fileName}</span>
                          <span className="text-muted text-[11px]">
                            ({Math.round(att.size / 1024)} KB)
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
