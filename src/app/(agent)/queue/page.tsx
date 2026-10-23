import { requireUser } from '@/server/auth/session';
import { getStore } from '@/server/mock/db';
import {
  assigneeOptions,
  calendarsForClient,
  listQueue,
  parseQueueFilters,
  QUEUE_VIEW_LABELS,
  QUEUE_VIEWS,
} from '@/server/queries/tickets';
import { QueueTable } from './queue-table';
import Link from 'next/link';

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function QueuePage({ searchParams }: PageProps) {
  const user = await requireUser(['agent', 'lead', 'admin']);
  const rawParams = await searchParams;
  const filters = parseQueueFilters(rawParams);

  const store = getStore();
  const now = new Date();
  const queueResult = listQueue(store, user, filters, now);
  const assignees = assigneeOptions(store);
  const calendars = calendarsForClient(store);

  const currentView = filters.view;

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6">
      {/* Header & View Tabs */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
          <div>
            <h1 className="text-fg text-xl font-bold tracking-tight">
              {QUEUE_VIEW_LABELS[currentView]}
            </h1>
            <p className="text-muted text-xs">
              Daftar tiket aktif yang diurutkan berdasarkan sisa waktu SLA terdekat.
            </p>
          </div>
        </div>

        {/* View Tabs */}
        <div className="border-border flex flex-wrap items-center gap-1 border-b pb-2 text-xs">
          {QUEUE_VIEWS.map((view) => {
            const isActive = currentView === view;
            const count = view === 'all' ? null : queueResult.counts[view];

            return (
              <Link
                key={view}
                href={`/queue?view=${view}`}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors ${
                  isActive
                    ? 'bg-accent/10 text-accent font-semibold'
                    : 'text-muted hover:bg-surface-2 hover:text-fg'
                }`}
              >
                <span>{QUEUE_VIEW_LABELS[view]}</span>
                {count !== null ? (
                  <span
                    className={`py-0.2 tabular rounded-full px-1.5 font-mono text-[10px] ${
                      view === 'breached' && count > 0
                        ? 'bg-rose-500/20 font-bold text-rose-600 dark:text-rose-400'
                        : view === 'at_risk' && count > 0
                          ? 'bg-amber-500/20 font-bold text-amber-600 dark:text-amber-400'
                          : 'bg-surface-2 text-muted'
                    }`}
                  >
                    {count}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      </div>

      {/* Interactive Table with URL filters & bulk action */}
      <QueueTable
        initialResult={queueResult}
        filters={filters}
        assignees={assignees}
        calendars={calendars}
      />
    </div>
  );
}
