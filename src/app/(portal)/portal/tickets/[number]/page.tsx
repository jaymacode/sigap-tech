import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { requireUser } from '@/server/auth/session';
import { getStore } from '@/server/mock/db';
import { getTicketDetail } from '@/server/queries/tickets';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusPill } from '@/components/itsm/status-pill';
import { Timeline } from '@/components/itsm/timeline';
import { formatDateTime, formatRelative } from '@/lib/format';
import { DetailClient } from './detail-client';

interface PageProps {
  params: Promise<{ number: string }>;
}

export default async function RequesterTicketDetailPage({ params }: PageProps) {
  const user = await requireUser();
  const { number } = await params;
  const store = getStore();
  const result = getTicketDetail(store, user, number);

  if (result.kind === 'not_found') {
    notFound();
  }
  if (result.kind === 'forbidden') {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <h1 className="text-danger text-xl font-bold">Akses Ditolak (403)</h1>
        <p className="text-muted mt-2 text-sm">
          Anda tidak memiliki izin untuk melihat detail tiket ini.
        </p>
        <Link href="/portal/tickets" className="text-accent mt-4 text-xs underline">
          Kembali ke tiket saya
        </Link>
      </div>
    );
  }

  const { detail } = result;

  return (
    <div className="flex flex-col gap-6">
      {/* Back button */}
      <div>
        <Link
          href="/portal/tickets"
          className="text-muted hover:text-fg inline-flex items-center gap-1.5 text-xs transition-colors"
        >
          <ArrowLeft className="size-3.5" />
          <span>Kembali ke Daftar Tiket</span>
        </Link>
      </div>

      {/* Ticket Header */}
      <div className="border-border flex flex-col gap-2 border-b pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-accent font-mono text-base font-bold">{detail.number}</span>
            <span className="text-muted text-xs">·</span>
            <span className="text-muted text-xs font-medium">{detail.category}</span>
          </div>
          <StatusPill status={detail.status} mode="requester" />
        </div>
        <h1 className="text-fg text-2xl font-bold">{detail.title}</h1>
        <div className="text-muted flex flex-wrap items-center gap-4 pt-1 text-xs">
          <span>Diajukan pada {formatDateTime(detail.createdAt)}</span>
          <span>·</span>
          <span>Diperbarui {formatRelative(detail.updatedAt, new Date())}</span>
          {detail.assignee ? (
            <>
              <span>·</span>
              <span className="text-fg font-medium">Ditangani oleh {detail.assignee.name}</span>
            </>
          ) : null}
        </div>
      </div>

      {/* Rincian Permohonan */}
      <Card className="shadow-xs">
        <CardHeader className="pb-2">
          <CardTitle className="text-muted text-sm font-semibold tracking-wider uppercase">
            Rincian Pengajuan
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p className="text-fg leading-relaxed whitespace-pre-wrap">{detail.description}</p>

          {/* Dynamic Form Fields */}
          {detail.formFields.length > 0 ? (
            <div className="border-border grid grid-cols-1 gap-2 border-t pt-3 sm:grid-cols-2">
              {detail.formFields.map((f, idx) => (
                <div key={idx} className="flex flex-col gap-0.5 text-xs">
                  <span className="text-muted font-medium">{f.label}</span>
                  <span className="text-fg font-semibold">{f.value}</span>
                </div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Interaksi Client: Balas, Konfirmasi Selesai, CSAT */}
      <DetailClient detail={detail} />

      {/* Aktivitas & Riwayat Balasan (Timeline) */}
      <div className="flex flex-col gap-3 pt-2">
        <h2 className="text-fg text-base font-bold">Riwayat Aktivitas & Balasan</h2>
        <Timeline entries={detail.timeline} />
      </div>
    </div>
  );
}
