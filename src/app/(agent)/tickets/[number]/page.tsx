import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { requireUser } from '@/server/auth/session';
import { getStore } from '@/server/mock/db';
import { assigneeOptions, calendarsForClient, getTicketDetail } from '@/server/queries/tickets';
import { AgentDetailClient } from './agent-detail-client';

interface PageProps {
  params: Promise<{ number: string }>;
}

export default async function AgentTicketDetailPage({ params }: PageProps) {
  const user = await requireUser(['agent', 'lead', 'admin']);
  const { number } = await params;
  const store = getStore();

  const result = getTicketDetail(store, user, number);

  if (result.kind === 'not_found') {
    notFound();
  }
  if (result.kind === 'forbidden') {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <h1 className="text-danger text-xl font-bold">Akses Ditolak (403)</h1>
        <p className="text-muted mt-2 text-sm">
          Anda tidak memiliki izin akses untuk memeriksa tiket tim ini.
        </p>
        <Link href="/queue" className="text-accent mt-4 text-xs underline">
          Kembali ke Queue
        </Link>
      </div>
    );
  }

  const assignees = assigneeOptions(store);
  const calendars = calendarsForClient(store);

  return (
    <div className="flex flex-col">
      <div className="px-6 pt-4">
        <Link
          href="/queue"
          className="text-muted hover:text-fg inline-flex items-center gap-1.5 text-xs transition-colors"
        >
          <ArrowLeft className="size-3.5" />
          <span>Kembali ke Queue</span>
        </Link>
      </div>
      <AgentDetailClient
        detail={result.detail}
        user={user}
        assignees={assignees}
        calendars={calendars}
      />
    </div>
  );
}
