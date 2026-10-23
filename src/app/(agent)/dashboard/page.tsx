import Link from 'next/link';
import { requireUser } from '@/server/auth/session';
import { getDashboardMetrics } from '@/server/queries/dashboard';
import { KpiTile } from '@/components/itsm/kpi-tile';
import { formatDuration } from '@/lib/format';
import { DashboardCharts } from './dashboard-charts';

interface PageProps {
  searchParams: Promise<{ range?: string }>;
}

export default async function DashboardPage({ searchParams }: PageProps) {
  await requireUser(['agent', 'lead', 'admin']);
  const { range: rangeParam } = await searchParams;

  const days = rangeParam === '7' ? 7 : rangeParam === '90' ? 90 : 30;
  const data = getDashboardMetrics(days);
  const { kpis } = data;

  const respStatus =
    kpis.responseSlaPercent >= 95 ? 'ok' : kpis.responseSlaPercent >= 85 ? 'risk' : 'breach';
  const resStatus =
    kpis.resolutionSlaPercent >= 95 ? 'ok' : kpis.resolutionSlaPercent >= 85 ? 'risk' : 'breach';

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6">
      {/* Header & Date Range Filter */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-fg text-xl font-bold tracking-tight">Dashboard Metrik ITSM</h1>
          <p className="text-muted text-xs">
            Laporan operasional SLA, volume insiden, efektivitas penanganan, dan kepuasan pengguna.
          </p>
        </div>

        {/* Range Selector */}
        <div className="border-border bg-surface flex items-center gap-1 rounded-lg border p-1 text-xs">
          <Link
            href="/dashboard?range=7"
            className={`rounded-md px-3 py-1 font-medium transition-colors ${
              days === 7
                ? 'bg-accent text-accent-fg font-semibold'
                : 'text-muted hover:text-fg hover:bg-surface-2'
            }`}
          >
            7 Hari
          </Link>
          <Link
            href="/dashboard?range=30"
            className={`rounded-md px-3 py-1 font-medium transition-colors ${
              days === 30
                ? 'bg-accent text-accent-fg font-semibold'
                : 'text-muted hover:text-fg hover:bg-surface-2'
            }`}
          >
            30 Hari
          </Link>
          <Link
            href="/dashboard?range=90"
            className={`rounded-md px-3 py-1 font-medium transition-colors ${
              days === 90
                ? 'bg-accent text-accent-fg font-semibold'
                : 'text-muted hover:text-fg hover:bg-surface-2'
            }`}
          >
            90 Hari
          </Link>
        </div>
      </div>

      {/* Row 1: 6 KPI Tiles dengan Status Warna dan Drill-Down ke Queue */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <KpiTile
          title="Response SLA"
          value={`${kpis.responseSlaPercent}%`}
          subtitle="Target ≥ 95%"
          status={respStatus}
          href="/queue?view=team"
        />

        <KpiTile
          title="Resolution SLA"
          value={`${kpis.resolutionSlaPercent}%`}
          subtitle="Target ≥ 95%"
          status={resStatus}
          href="/queue?view=team"
        />

        <KpiTile
          title="MTTA (Jam Kerja)"
          value={formatDuration(kpis.mttaMinutes)}
          subtitle="Rata-rata respons awal"
          status="neutral"
          href="/queue?view=team"
        />

        <KpiTile
          title="MTTR (Jam Kerja)"
          value={formatDuration(kpis.mttrMinutes)}
          subtitle="Rata-rata waktu solusi"
          status="neutral"
          href="/queue?view=team"
        />

        <KpiTile
          title="Backlog Aktif"
          value={kpis.activeBacklog}
          subtitle="Tiket belum selesai"
          status="neutral"
          href="/queue?view=team"
        />

        <KpiTile
          title="CSAT Rata-rata"
          value={`★ ${kpis.csatAverage}`}
          subtitle={`${kpis.csatResponseCount} responden`}
          status="ok"
          href="/queue?view=team"
        />
      </div>

      {/* Recharts Analytics Charts & Tables */}
      <DashboardCharts data={data} />
    </div>
  );
}
