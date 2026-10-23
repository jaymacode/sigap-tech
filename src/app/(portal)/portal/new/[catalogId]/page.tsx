import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { getCatalogItemById } from '@/server/queries/catalog';
import { requireUser } from '@/server/auth/session';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ServiceForm } from './form';

interface PageProps {
  params: Promise<{ catalogId: string }>;
}

export default async function NewTicketPage({ params }: PageProps) {
  await requireUser();
  const { catalogId } = await params;
  const item = getCatalogItemById(catalogId);

  if (!item) {
    notFound();
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      {/* Back button */}
      <div>
        <Link
          href="/portal"
          className="text-muted hover:text-fg inline-flex items-center gap-1.5 text-xs transition-colors"
        >
          <ArrowLeft className="size-3.5" />
          <span>Kembali ke Katalog Layanan</span>
        </Link>
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="text-accent text-xs font-semibold tracking-wide uppercase">
            {item.categoryName}
          </span>
          <span className="text-muted text-xs">·</span>
          <span className="text-muted text-xs capitalize">
            {item.ticketType === 'incident' ? 'Laporan Gangguan' : 'Permintaan Layanan'}
          </span>
        </div>
        <h1 className="text-fg text-2xl font-bold">{item.name}</h1>
        <p className="text-muted text-sm">{item.description}</p>
      </div>

      <Card className="shadow-xs">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">Formulir Pengajuan</CardTitle>
          <CardDescription className="text-xs">
            Lengkapi rincian di bawah ini agar tim teknis dapat memproses kebutuhan Anda dengan
            tepat.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ServiceForm item={item} />
        </CardContent>
      </Card>
    </div>
  );
}
