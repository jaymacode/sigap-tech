import Link from 'next/link';
import { PlusCircle } from 'lucide-react';
import { requireUser } from '@/server/auth/session';
import { getStore } from '@/server/mock/db';
import { listRequesterTickets } from '@/server/queries/tickets';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/itsm/status-pill';
import { EmptyState } from '@/components/itsm/empty-state';
import { formatDateTime, formatRelative } from '@/lib/format';
import { ACTIVE_STATUSES } from '@/domain/types';

interface PageProps {
  searchParams: Promise<{ status?: string; q?: string }>;
}

export default async function RequesterTicketsPage({ searchParams }: PageProps) {
  const user = await requireUser();
  const store = getStore();
  const { status: statusFilter, q: searchQuery } = await searchParams;

  let tickets = listRequesterTickets(store, user);

  if (statusFilter === 'active') {
    tickets = tickets.filter((t) => ACTIVE_STATUSES.includes(t.status));
  } else if (statusFilter === 'resolved') {
    tickets = tickets.filter((t) => t.status === 'resolved' || t.status === 'closed');
  }

  if (searchQuery?.trim()) {
    const q = searchQuery.toLowerCase();
    tickets = tickets.filter(
      (t) => t.number.toLowerCase().includes(q) || t.title.toLowerCase().includes(q),
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-fg text-2xl font-bold tracking-tight">Daftar Tiket Anda</h1>
          <p className="text-muted text-xs">
            Semua riwayat laporan masalah dan permintaan layanan yang pernah Anda ajukan.
          </p>
        </div>
        <Button asChild variant="primary" size="sm">
          <Link href="/portal">
            <PlusCircle className="size-4" />
            <span>Ajukan Layanan Baru</span>
          </Link>
        </Button>
      </div>

      {/* Filter Tabs */}
      <div className="border-border flex items-center gap-2 border-b pb-2 text-xs">
        <Link
          href="/portal/tickets"
          className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
            !statusFilter
              ? 'bg-accent/10 text-accent font-semibold'
              : 'text-muted hover:bg-surface-2 hover:text-fg'
          }`}
        >
          Semua Tiket
        </Link>
        <Link
          href="/portal/tickets?status=active"
          className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
            statusFilter === 'active'
              ? 'bg-accent/10 text-accent font-semibold'
              : 'text-muted hover:bg-surface-2 hover:text-fg'
          }`}
        >
          Sedang Diproses
        </Link>
        <Link
          href="/portal/tickets?status=resolved"
          className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
            statusFilter === 'resolved'
              ? 'bg-accent/10 text-accent font-semibold'
              : 'text-muted hover:bg-surface-2 hover:text-fg'
          }`}
        >
          Selesai & Ditutup
        </Link>
      </div>

      {/* List Tiket */}
      {tickets.length === 0 ? (
        <EmptyState
          title="Tidak ada tiket ditemukan"
          description={
            statusFilter
              ? 'Tidak ada tiket dengan kriteria filter yang dipilih.'
              : 'Anda belum memiliki tiket permohonan layanan aktif.'
          }
          action={
            <Button asChild variant="secondary" size="sm">
              <Link href="/portal">Buka Katalog Layanan</Link>
            </Button>
          }
        />
      ) : (
        <div className="divide-border border-border bg-surface flex flex-col divide-y rounded-xl border shadow-xs">
          {tickets.map((t) => (
            <Link
              key={t.id}
              href={`/portal/tickets/${t.number}`}
              className="hover:bg-surface-2/60 flex flex-col justify-between gap-3 p-4 transition-colors sm:flex-row sm:items-center"
            >
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="text-accent font-mono text-xs font-bold">{t.number}</span>
                  <span className="text-muted text-xs">·</span>
                  <span className="text-muted text-xs">{t.category}</span>
                </div>
                <h3 className="text-fg hover:text-accent text-sm font-semibold transition-colors">
                  {t.title}
                </h3>
                <span className="text-muted text-xs">
                  Dibuat {formatDateTime(t.createdAt)} ({formatRelative(t.createdAt, new Date())})
                </span>
              </div>

              <div className="flex shrink-0 items-center gap-3">
                <StatusPill status={t.status} mode="requester" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
