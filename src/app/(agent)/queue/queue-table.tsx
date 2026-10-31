'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowUpDown, ChevronLeft, ChevronRight, RefreshCw, Search, UserCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/controls';
import { Input, NativeSelect } from '@/components/ui/input';
import { PriorityBadge } from '@/components/itsm/priority-badge';
import { SlaIndicator } from '@/components/itsm/sla-indicator';
import { StatusPill } from '@/components/itsm/status-pill';
import { EmptyState } from '@/components/itsm/empty-state';
import { bulkAssignAction } from '@/server/actions/tickets';
import { formatRelative } from '@/lib/format';
import { primarySla, type CalendarMap } from '@/lib/views';
import type { AssigneeOption, QueueFilters, QueueResult } from '@/server/queries/tickets';

interface QueueTableProps {
  initialResult: QueueResult;
  filters: QueueFilters;
  assignees: AssigneeOption[];
  calendars: CalendarMap;
}

export function QueueTable({ initialResult, filters, assignees, calendars }: QueueTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const [focusedIndex, setFocusedIndex] = React.useState<number>(0);
  const [bulkAssigneeId, setBulkAssigneeId] = React.useState<string>('');
  const [isBulkPending, setIsBulkPending] = React.useState(false);
  const [isRefreshing, setIsRefreshing] = React.useState(false);

  // Auto-refresh tiap 30 detik (DESIGN.md §4.5)
  React.useEffect(() => {
    const timer = setInterval(() => {
      router.refresh();
    }, 30_000);
    return () => clearInterval(timer);
  }, [router]);

  const updateFilters = (newParams: Record<string, string | undefined>) => {
    const current = new URLSearchParams(searchParams.toString());
    for (const [key, val] of Object.entries(newParams)) {
      if (val === undefined || val === '') {
        current.delete(key);
      } else {
        current.set(key, val);
      }
    }
    // Reset ke halaman 1 saat filter berubah
    if (!('page' in newParams)) {
      current.delete('page');
    }
    router.push(`/queue?${current.toString()}`);
  };

  // Keyboard navigation: j/k to move selection, Enter to open (DESIGN.md §7)
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Hanya jika tidak sedang mengetik di input/textarea
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIndex((idx) => Math.min(initialResult.items.length - 1, idx + 1));
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIndex((idx) => Math.max(0, idx - 1));
      } else if (e.key === 'Enter') {
        const item = initialResult.items[focusedIndex];
        if (item) {
          router.push(`/tickets/${item.number}`);
        }
      } else if (e.key === 'x') {
        const item = initialResult.items[focusedIndex];
        if (item) {
          setSelectedIds((prev) =>
            prev.includes(item.id) ? prev.filter((id) => id !== item.id) : [...prev, item.id],
          );
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusedIndex, initialResult.items, router]);

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(initialResult.items.map((i) => i.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleToggleOne = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));
  };

  const handleBulkAssign = async () => {
    if (!bulkAssigneeId || selectedIds.length === 0) return;
    setIsBulkPending(true);
    try {
      const assignee = assignees.find((a) => a.id === bulkAssigneeId);
      const res = await bulkAssignAction(selectedIds, bulkAssigneeId, assignee?.teamId);
      if (!res.ok) {
        toast.error(res.error);
      } else {
        toast.success(`${res.data.count} tiket berhasil ditugaskan`);
        setSelectedIds([]);
        setBulkAssigneeId('');
        router.refresh();
      }
    } finally {
      setIsBulkPending(false);
    }
  };

  const allSelected =
    initialResult.items.length > 0 && selectedIds.length === initialResult.items.length;
  const someSelected = selectedIds.length > 0 && selectedIds.length < initialResult.items.length;

  return (
    <div className="flex flex-col gap-4">
      {/* Filter Toolbar */}
      <div className="bg-surface border-border flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 shadow-xs">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          {/* Search bar */}
          <div className="relative max-w-xs min-w-48 flex-1">
            <Search className="text-muted absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
            <Input
              value={filters.q ?? ''}
              onChange={(e) => updateFilters({ q: e.target.value || undefined })}
              placeholder="Cari judul/nomor/requester..."
              className="h-8 pl-8 text-xs"
            />
          </div>

          {/* Filter Status */}
          <NativeSelect
            value={typeof filters.status === 'string' ? filters.status : ''}
            onChange={(e) => updateFilters({ status: e.target.value || undefined })}
            className="h-8 w-32 text-xs"
          >
            <option value="">Status: Semua</option>
            <option value="active">Semua Aktif</option>
            <option value="new">New</option>
            <option value="assigned">Assigned</option>
            <option value="in_progress">In Progress</option>
            <option value="pending">Pending</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
            <option value="cancelled">Cancelled</option>
          </NativeSelect>

          {/* Filter Prioritas */}
          <NativeSelect
            value={filters.priority?.[0] ?? ''}
            onChange={(e) => updateFilters({ priority: e.target.value || undefined })}
            className="h-8 w-28 text-xs"
          >
            <option value="">Prioritas: Semua</option>
            <option value="P1">P1 Critical</option>
            <option value="P2">P2 High</option>
            <option value="P3">P3 Medium</option>
            <option value="P4">P4 Low</option>
          </NativeSelect>

          {/* Filter Tipe */}
          <NativeSelect
            value={filters.type ?? ''}
            onChange={(e) => updateFilters({ type: e.target.value || undefined })}
            className="h-8 w-28 text-xs"
          >
            <option value="">Tipe: Semua</option>
            <option value="incident">Incident</option>
            <option value="request">Request</option>
          </NativeSelect>

          {/* Filter Umur Tiket */}
          <NativeSelect
            value={filters.age ?? ''}
            onChange={(e) => updateFilters({ age: e.target.value || undefined })}
            className="h-8 w-32 text-xs"
          >
            <option value="">Umur: Semua</option>
            <option value="lt1">&lt; 1 hari kerja</option>
            <option value="1to3">1–3 hari kerja</option>
            <option value="3to7">3–7 hari kerja</option>
            <option value="gt7">&gt; 7 hari kerja</option>
          </NativeSelect>

          {/* Filter SLA */}
          <NativeSelect
            value={filters.sla ?? ''}
            onChange={(e) => updateFilters({ sla: e.target.value || undefined })}
            className="h-8 w-32 text-xs"
          >
            <option value="">SLA: Semua</option>
            <option value="met">SLA Terpenuhi</option>
            <option value="breached">SLA Breached</option>
          </NativeSelect>
        </div>

        {/* Refresh & Count */}
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => {
              setIsRefreshing(true);
              router.refresh();
              setTimeout(() => setIsRefreshing(false), 600);
            }}
            title="Muat ulang data (Auto 30d)"
          >
            <RefreshCw className={`size-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          </Button>
          <span className="text-muted tabular font-mono text-xs">
            Total: <strong>{initialResult.total}</strong>
          </span>
        </div>
      </div>

      {/* Bulk Action Bar (muncul jika ada tiket terpilih) */}
      {selectedIds.length > 0 ? (
        <div className="bg-accent-soft/80 border-accent/40 animate-slide-up flex items-center justify-between rounded-lg border px-4 py-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-accent font-mono font-semibold">
              {selectedIds.length} tiket terpilih
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedIds([])}
              className="text-muted hover:text-fg h-6 px-1.5"
            >
              Batal
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <NativeSelect
              value={bulkAssigneeId}
              onChange={(e) => setBulkAssigneeId(e.target.value)}
              className="bg-surface h-7 text-xs"
            >
              <option value="">-- Tugaskan Massal ke Staff --</option>
              {assignees.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.teamName}) · {a.activeLoad} tiket aktif
                </option>
              ))}
            </NativeSelect>

            <Button
              variant="primary"
              size="sm"
              disabled={!bulkAssigneeId || isBulkPending}
              onClick={handleBulkAssign}
              className="h-7 px-3"
            >
              <UserCheck className="size-3.5" />
              <span>{isBulkPending ? 'Memproses...' : 'Tugaskan'}</span>
            </Button>
          </div>
        </div>
      ) : null}

      {/* Desktop Table View */}
      {initialResult.items.length === 0 ? (
        <EmptyState
          title="Tidak ada tiket di queue ini"
          description="Semua tiket pada filter ini telah terselesaikan atau tidak ada tiket yang cocok."
          action={
            <Button variant="secondary" size="sm" onClick={() => router.push('/queue?view=team')}>
              Reset ke Team Queue
            </Button>
          }
        />
      ) : (
        <div className="border-border bg-surface hidden overflow-hidden rounded-xl border shadow-xs md:block">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-border bg-surface-2/60 text-muted border-b font-semibold tracking-wider uppercase">
                <th className="w-10 px-3 py-2.5">
                  <Checkbox
                    checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                    onCheckedChange={(checked) => handleSelectAll(checked === true)}
                    aria-label="Pilih semua tiket"
                  />
                </th>
                <th className="w-24 px-3 py-2.5">
                  <button
                    onClick={() =>
                      updateFilters({
                        sort: 'created',
                        dir: filters.dir === 'asc' ? 'desc' : 'asc',
                      })
                    }
                    className="hover:text-fg flex items-center gap-1 font-semibold"
                  >
                    <span>Nomor</span>
                    <ArrowUpDown className="size-3" />
                  </button>
                </th>
                <th className="px-3 py-2.5">Judul Tiket</th>
                <th className="w-32 px-3 py-2.5">Requester</th>
                <th className="w-20 px-3 py-2.5">
                  <button
                    onClick={() =>
                      updateFilters({
                        sort: 'priority',
                        dir: filters.dir === 'asc' ? 'desc' : 'asc',
                      })
                    }
                    className="hover:text-fg flex items-center gap-1 font-semibold"
                  >
                    <span>Prioritas</span>
                    <ArrowUpDown className="size-3" />
                  </button>
                </th>
                <th className="w-28 px-3 py-2.5">Status</th>
                <th className="w-32 px-3 py-2.5">Assignee</th>
                <th className="w-36 px-3 py-2.5">
                  <button
                    onClick={() =>
                      updateFilters({
                        sort: 'sla',
                        dir: filters.dir === 'asc' ? 'desc' : 'asc',
                      })
                    }
                    className="hover:text-fg flex items-center gap-1 font-semibold"
                  >
                    <span>Target SLA</span>
                    <ArrowUpDown className="size-3" />
                  </button>
                </th>
                <th className="w-24 px-3 py-2.5">Umur</th>
              </tr>
            </thead>
            <tbody className="divide-border/60 divide-y">
              {initialResult.items.map((t, idx) => {
                const isSelected = selectedIds.includes(t.id);
                const isFocused = focusedIndex === idx;
                const pSla = primarySla(t);
                const cal = calendars[pSla.calendarId];

                return (
                  <tr
                    key={t.id}
                    className={`hover:bg-surface-2/60 cursor-pointer transition-colors ${
                      isSelected ? 'bg-accent/5' : ''
                    } ${isFocused ? 'ring-accent/60 ring-1 ring-inset' : ''}`}
                    onClick={(e) => {
                      // Jika bukan klik checkbox, buka tiket
                      const target = e.target as HTMLElement;
                      if (!target.closest('button[role="checkbox"]') && !target.closest('input')) {
                        router.push(`/tickets/${t.number}`);
                      }
                    }}
                  >
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => handleToggleOne(t.id)}
                        aria-label={`Pilih tiket ${t.number}`}
                      />
                    </td>
                    <td className="text-accent px-3 py-2.5 font-mono font-bold whitespace-nowrap">
                      <Link href={`/tickets/${t.number}`} className="hover:underline">
                        {t.number}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-col">
                        <span className="text-fg line-clamp-1 font-medium">{t.title}</span>
                        <span className="text-muted text-[11px]">{t.category}</span>
                      </div>
                    </td>
                    <td className="text-muted max-w-[120px] truncate px-3 py-2.5">
                      {t.requester.name}
                    </td>
                    <td className="px-3 py-2.5">
                      <PriorityBadge priority={t.priority} />
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusPill status={t.status} mode="agent" />
                    </td>
                    <td className="text-fg max-w-[120px] truncate px-3 py-2.5">
                      {t.assignee ? (
                        t.assignee.name
                      ) : (
                        <span className="text-muted italic">Unassigned</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <SlaIndicator sla={pSla} calendar={cal} showKind={true} />
                    </td>
                    <td className="text-muted tabular px-3 py-2.5 whitespace-nowrap">
                      {formatRelative(t.createdAt, new Date())}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Mobile Card List View (< 768px sesuai DESIGN.md §3) */}
      <div className="flex flex-col gap-2.5 md:hidden">
        {initialResult.items.map((t) => {
          const pSla = primarySla(t);
          const cal = calendars[pSla.calendarId];
          return (
            <Link
              key={t.id}
              href={`/tickets/${t.number}`}
              className="border-border bg-surface hover:border-accent hover:bg-surface-2/40 flex flex-col gap-2 rounded-xl border p-3.5 shadow-xs transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="text-accent font-mono text-xs font-bold">{t.number}</span>
                <div className="flex items-center gap-1.5">
                  <PriorityBadge priority={t.priority} />
                  <StatusPill status={t.status} mode="agent" />
                </div>
              </div>
              <h3 className="text-fg line-clamp-2 text-xs font-medium">{t.title}</h3>
              <div className="border-border/60 flex items-center justify-between border-t pt-1 text-xs">
                <span className="text-muted">{t.assignee?.name ?? 'Unassigned'}</span>
                <SlaIndicator sla={pSla} calendar={cal} />
              </div>
            </Link>
          );
        })}
      </div>

      {/* Pagination Controls */}
      {initialResult.pageCount > 1 ? (
        <div className="text-muted flex items-center justify-between py-2 text-xs">
          <span>
            Halaman {initialResult.page} dari {initialResult.pageCount}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={initialResult.page <= 1}
              onClick={() => updateFilters({ page: String(initialResult.page - 1) })}
              className="h-7 gap-1 text-xs"
            >
              <ChevronLeft className="size-3.5" />
              <span>Sebelumnya</span>
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={initialResult.page >= initialResult.pageCount}
              onClick={() => updateFilters({ page: String(initialResult.page + 1) })}
              className="h-7 gap-1 text-xs"
            >
              <span>Selanjutnya</span>
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
