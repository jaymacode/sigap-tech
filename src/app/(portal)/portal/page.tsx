import Link from 'next/link';
import { ArrowRight, HelpCircle, Laptop, Shield, Wrench } from 'lucide-react';
import { requireUser } from '@/server/auth/session';
import { getStore } from '@/server/mock/db';
import { getActiveCatalog } from '@/server/queries/catalog';
import { listRequesterTickets } from '@/server/queries/tickets';
import { StatusPill } from '@/components/itsm/status-pill';
import { formatRelative } from '@/lib/format';

function getCategoryIcon(name: string) {
  const n = name.toLowerCase();
  if (n.includes('hardware') || n.includes('perangkat'))
    return <Laptop className="size-5 text-teal-600" />;
  if (n.includes('software') || n.includes('aplikasi'))
    return <Wrench className="size-5 text-blue-600" />;
  if (n.includes('akses') || n.includes('akun') || n.includes('keamanan'))
    return <Shield className="size-5 text-purple-600" />;
  return <HelpCircle className="text-accent size-5" />;
}

export default async function PortalHomePage() {
  const user = await requireUser();
  const store = getStore();
  const catalogGroups = getActiveCatalog();
  const recentTickets = listRequesterTickets(store, user, 3);

  return (
    <div className="flex flex-col gap-10">
      {/* Hero section */}
      <div className="flex flex-col items-center justify-center py-6 text-center">
        <h1 className="text-fg text-3xl font-extrabold tracking-tight">
          Ada yang bisa kami bantu?
        </h1>
        <p className="text-muted mt-2 max-w-lg text-sm">
          Pilih layanan atau ajukan laporan masalah IT di bawah ini. Tim Sigap siap membantu selama
          jam kerja.
        </p>
      </div>

      {/* 3 Tiket Terakhir Milik User */}
      {recentTickets.length > 0 ? (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-muted text-sm font-semibold tracking-wide uppercase">
              Tiket Anda Saat Ini
            </h2>
            <Link
              href="/portal/tickets"
              className="text-accent inline-flex items-center gap-1 text-xs font-medium hover:underline"
            >
              <span>Lihat semua tiket</span>
              <ArrowRight className="size-3" />
            </Link>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {recentTickets.map((t) => (
              <Link
                key={t.id}
                href={`/portal/tickets/${t.number}`}
                className="group border-border bg-surface hover:border-accent hover:bg-surface-2/40 flex flex-col justify-between rounded-xl border p-4 shadow-xs transition-all"
              >
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-accent font-mono text-xs font-bold">{t.number}</span>
                    <StatusPill status={t.status} mode="requester" />
                  </div>
                  <h3 className="text-fg group-hover:text-accent line-clamp-2 text-sm font-medium transition-colors">
                    {t.title}
                  </h3>
                </div>
                <div className="text-muted border-border/60 mt-3 flex items-center justify-between border-t pt-2 text-xs">
                  <span>{t.category}</span>
                  <span className="tabular">{formatRelative(t.updatedAt, new Date())}</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* Katalog Layanan Berdasarkan Kategori */}
      <section id="services" className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-fg text-lg font-bold">Katalog Layanan & Masalah IT</h2>
          <p className="text-muted text-xs">
            Pilih kategori yang sesuai dengan kebutuhan atau kendala yang Anda hadapi:
          </p>
        </div>

        <div className="flex flex-col gap-8">
          {catalogGroups.map(({ category, items }) => (
            <div key={category.id} className="flex flex-col gap-3">
              <div className="border-border flex items-center gap-2 border-b pb-2">
                {getCategoryIcon(category.name)}
                <h3 className="text-fg text-base font-semibold">{category.name}</h3>
                <span className="text-muted text-xs">({items.length} layanan)</span>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((item) => (
                  <Link
                    key={item.id}
                    href={`/portal/new/${item.id}`}
                    className="group border-border bg-surface hover:border-accent hover:bg-surface-2/60 flex flex-col justify-between rounded-xl border p-4 shadow-xs transition-all"
                  >
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between">
                        <span
                          className={`py-0.2 rounded px-1.5 text-[10px] font-semibold uppercase ${
                            item.ticketType === 'incident'
                              ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                              : 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300'
                          }`}
                        >
                          {item.ticketType === 'incident' ? 'Masalah / Rusak' : 'Permintaan'}
                        </span>
                        <ArrowRight className="text-muted group-hover:text-accent size-3.5 transition-all group-hover:translate-x-0.5" />
                      </div>
                      <h4 className="text-fg group-hover:text-accent text-sm font-semibold transition-colors">
                        {item.name}
                      </h4>
                      <p className="text-muted line-clamp-2 text-xs">{item.description}</p>
                    </div>

                    <div className="border-border/40 text-accent mt-4 border-t pt-2 text-[11px] font-medium">
                      Buka Formulir →
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
