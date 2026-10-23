'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { TableIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { DashboardData } from '@/server/queries/dashboard';

interface DashboardChartsProps {
  data: DashboardData;
}

export function DashboardCharts({ data }: DashboardChartsProps) {
  const [showVolumeTable, setShowVolumeTable] = React.useState(false);
  const [showSlaTable, setShowSlaTable] = React.useState(false);
  const [showAgingTable, setShowAgingTable] = React.useState(false);

  return (
    <div className="flex flex-col gap-6">
      {/* 1. Volume Chart: Created vs Resolved */}
      <Card className="shadow-xs">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div>
            <CardTitle className="text-fg text-base font-semibold">
              Volume Tiket (Dibuat vs Diselesaikan)
            </CardTitle>
            <CardDescription className="text-xs">
              Tren beban tiket harian dalam {data.rangeDays} hari terakhir
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowVolumeTable(!showVolumeTable)}
            className="text-muted hover:text-fg h-7 gap-1.5 text-xs"
          >
            <TableIcon className="size-3.5" />
            <span>{showVolumeTable ? 'Tampilkan Grafik' : 'Lihat sebagai tabel'}</span>
          </Button>
        </CardHeader>
        <CardContent>
          {showVolumeTable ? (
            <div className="border-border max-h-64 overflow-y-auto rounded border">
              <table className="w-full text-left text-xs">
                <thead className="bg-surface-2 text-muted border-border border-b font-semibold">
                  <tr>
                    <th className="p-2">Tanggal</th>
                    <th className="p-2 text-right">Tiket Masuk</th>
                    <th className="p-2 text-right">Tiket Selesai</th>
                  </tr>
                </thead>
                <tbody className="divide-border/60 divide-y">
                  {data.volume.map((v) => (
                    <tr key={v.date} className="hover:bg-surface-2/40">
                      <td className="p-2 font-mono">{v.date}</td>
                      <td className="text-accent p-2 text-right font-mono">{v.created}</td>
                      <td className="p-2 text-right font-mono text-emerald-600 dark:text-emerald-400">
                        {v.resolved}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="h-64 w-full pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.volume}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(val) => val.slice(5)}
                    tick={{ fontSize: 11 }}
                    stroke="#888888"
                  />
                  <YAxis tick={{ fontSize: 11 }} stroke="#888888" allowDecimals={false} />
                  <RechartsTooltip
                    contentStyle={{
                      backgroundColor: 'var(--color-surface)',
                      borderColor: 'var(--color-border)',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }} />
                  <Line
                    type="monotone"
                    dataKey="created"
                    name="Tiket Baru"
                    stroke="#0f766e"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="resolved"
                    name="Diselesaikan"
                    stroke="#16a34a"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Baris 2: SLA per Prioritas & Backlog Aging */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* SLA per Prioritas */}
        <Card className="shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="text-fg text-base font-semibold">
                SLA Compliance per Prioritas
              </CardTitle>
              <CardDescription className="text-xs">
                Persentase target resolusi terpenuhi per tingkat P1–P4
              </CardDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowSlaTable(!showSlaTable)}
              className="text-muted hover:text-fg h-7 gap-1 text-xs"
            >
              <TableIcon className="size-3.5" />
              <span>{showSlaTable ? 'Grafik' : 'Tabel'}</span>
            </Button>
          </CardHeader>
          <CardContent>
            {showSlaTable ? (
              <table className="w-full text-left text-xs">
                <thead className="bg-surface-2 text-muted border-border border-b font-semibold">
                  <tr>
                    <th className="p-2">Prioritas</th>
                    <th className="p-2 text-right">Total Tiket</th>
                    <th className="p-2 text-right">Kepatuhan SLA</th>
                  </tr>
                </thead>
                <tbody className="divide-border/60 divide-y">
                  {data.slaByPriority.map((item) => (
                    <tr key={item.priority}>
                      <td className="p-2 font-mono font-bold">{item.priority}</td>
                      <td className="p-2 text-right font-mono">{item.total}</td>
                      <td className="text-accent p-2 text-right font-mono font-semibold">
                        {item.metPercent}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="h-56 w-full pt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    layout="vertical"
                    data={data.slaByPriority}
                    margin={{ left: 10, right: 20 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} horizontal={false} />
                    <XAxis type="number" domain={[0, 100]} unit="%" tick={{ fontSize: 11 }} />
                    <YAxis
                      dataKey="priority"
                      type="category"
                      tick={{ fontSize: 11, fontWeight: 'bold' }}
                    />
                    <RechartsTooltip
                      formatter={(val) => [`${val}%`, 'SLA Met']}
                      contentStyle={{
                        backgroundColor: 'var(--color-surface)',
                        borderColor: 'var(--color-border)',
                        borderRadius: '8px',
                        fontSize: '12px',
                      }}
                    />
                    <Bar
                      dataKey="metPercent"
                      name="% SLA Met"
                      fill="#0f766e"
                      radius={[0, 4, 4, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Backlog Aging */}
        <Card className="shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="text-fg text-base font-semibold">
                Distribusi Umur Backlog Aktif
              </CardTitle>
              <CardDescription className="text-xs">
                Tiket aktif dikelompokkan berdasarkan usia kerja & prioritas
              </CardDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAgingTable(!showAgingTable)}
              className="text-muted hover:text-fg h-7 gap-1 text-xs"
            >
              <TableIcon className="size-3.5" />
              <span>{showAgingTable ? 'Grafik' : 'Tabel'}</span>
            </Button>
          </CardHeader>
          <CardContent>
            {showAgingTable ? (
              <table className="w-full text-left text-xs">
                <thead className="bg-surface-2 text-muted border-border border-b font-semibold">
                  <tr>
                    <th className="p-2">Rentang Umur</th>
                    <th className="p-2 text-right">P1</th>
                    <th className="p-2 text-right">P2</th>
                    <th className="p-2 text-right">P3</th>
                    <th className="p-2 text-right">P4</th>
                  </tr>
                </thead>
                <tbody className="divide-border/60 divide-y">
                  {data.aging.map((b) => (
                    <tr key={b.bucket}>
                      <td className="p-2">{b.label}</td>
                      <td className="text-p1 p-2 text-right font-mono font-bold">{b.P1}</td>
                      <td className="text-p2 p-2 text-right font-mono font-bold">{b.P2}</td>
                      <td className="text-p3 p-2 text-right font-mono font-bold">{b.P3}</td>
                      <td className="text-p4 p-2 text-right font-mono font-bold">{b.P4}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="h-56 w-full pt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.aging}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="#888888" />
                    <YAxis tick={{ fontSize: 11 }} stroke="#888888" allowDecimals={false} />
                    <RechartsTooltip
                      contentStyle={{
                        backgroundColor: 'var(--color-surface)',
                        borderColor: 'var(--color-border)',
                        borderRadius: '8px',
                        fontSize: '12px',
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '6px' }} />
                    <Bar dataKey="P1" name="P1 Critical" fill="var(--color-p1)" stackId="a" />
                    <Bar dataKey="P2" name="P2 High" fill="var(--color-p2)" stackId="a" />
                    <Bar dataKey="P3" name="P3 Medium" fill="var(--color-p3)" stackId="a" />
                    <Bar dataKey="P4" name="P4 Low" fill="var(--color-p4)" stackId="a" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Baris 3: Top 10 Kategori & Agent Performance Table */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Top 10 Kategori */}
        <Card className="shadow-xs lg:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-fg text-base font-semibold">Top 10 Kategori</CardTitle>
            <CardDescription className="text-xs">
              Kategori dengan volume insiden/permohonan tertinggi
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="divide-border/60 flex flex-col divide-y">
              {data.topCategories.map((c, i) => (
                <Link
                  key={c.id}
                  href={`/queue?category=${c.id}`}
                  className="hover:bg-surface-2 group flex items-center justify-between rounded px-1 py-2 text-xs transition-colors"
                >
                  <span className="text-fg group-hover:text-accent truncate pr-2">
                    {i + 1}. {c.name}
                  </span>
                  <span className="text-accent tabular shrink-0 font-mono font-bold">
                    {c.count} tiket
                  </span>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Tabel Kinerja Agent (Agent Performance) */}
        <Card className="shadow-xs lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-fg text-base font-semibold">
              Kinerja Staff Service Desk
            </CardTitle>
            <CardDescription className="text-xs">
              Beban tiket aktif, resolusi, rata-rata MTTR, kepatuhan SLA, dan kepuasan CSAT
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="border-border overflow-x-auto rounded border">
              <table className="w-full text-left text-xs">
                <thead className="bg-surface-2 text-muted border-border border-b font-semibold">
                  <tr>
                    <th className="p-2.5">Nama Staff</th>
                    <th className="p-2.5 text-center">Tiket Aktif</th>
                    <th className="p-2.5 text-center">Diselesaikan</th>
                    <th className="p-2.5 text-center">MTTR</th>
                    <th className="p-2.5 text-center">SLA Met</th>
                    <th className="p-2.5 text-center">CSAT</th>
                  </tr>
                </thead>
                <tbody className="divide-border/60 divide-y">
                  {data.agentPerformance.map((agent) => (
                    <tr key={agent.id} className="hover:bg-surface-2/40">
                      <td className="text-fg p-2.5 font-semibold">
                        <Link
                          href={`/queue?assignee=${agent.id}`}
                          className="hover:text-accent hover:underline"
                        >
                          {agent.name}
                        </Link>
                      </td>
                      <td className="text-accent p-2.5 text-center font-mono font-bold">
                        {agent.activeCount}
                      </td>
                      <td className="p-2.5 text-center font-mono">{agent.resolvedCount}</td>
                      <td className="text-muted p-2.5 text-center font-mono">
                        {agent.mttrHours} jam
                      </td>
                      <td className="p-2.5 text-center font-mono font-semibold">
                        <span
                          className={
                            agent.slaPercent >= 95
                              ? 'text-sla-ok'
                              : agent.slaPercent >= 85
                                ? 'text-sla-risk'
                                : 'text-sla-breach'
                          }
                        >
                          {agent.slaPercent}%
                        </span>
                      </td>
                      <td className="p-2.5 text-center font-mono">
                        {agent.csatScore !== null ? (
                          <span className="font-bold text-amber-500">★ {agent.csatScore}</span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
