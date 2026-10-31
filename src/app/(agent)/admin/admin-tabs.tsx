'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  CheckCircle2,
  Clock,
  FolderTree,
  Play,
  RefreshCw,
  Settings,
  Shield,
  Sliders,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/input';
import {
  toggleTeamAutoAssignAction,
  toggleUserActiveAction,
  updateUserRoleAction,
} from '@/server/actions/admin';
import { triggerSlaTickAction } from '@/server/actions/tickets';
import { formatDateTime, formatDuration } from '@/lib/format';
import type { AdminData } from '@/server/queries/admin';
import type { Role } from '@/domain/types';
import type { TickResult } from '@/server/mock/ticket-engine';

interface AdminTabsProps {
  data: AdminData;
}

export function AdminTabs({ data }: AdminTabsProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = React.useState<
    'users' | 'teams' | 'categories' | 'catalog' | 'sla' | 'system'
  >('users');

  const [togglingTeamId, setTogglingTeamId] = React.useState<string | null>(null);
  const [advanceMinutes, setAdvanceMinutes] = React.useState<number>(0);
  const [tickResult, setTickResult] = React.useState<
    (TickResult & { simulatedNow?: string }) | null
  >(null);
  const [isTicking, setIsTicking] = React.useState(false);

  const handleToggleUser = async (userId: string) => {
    const res = await toggleUserActiveAction(userId);
    if (res.ok) {
      toast.success(res.data ? 'Pengguna diaktifkan' : 'Pengguna dinonaktifkan');
      router.refresh();
    } else {
      toast.error(res.error);
    }
  };

  const handleUpdateRole = async (userId: string, role: Role) => {
    const res = await updateUserRoleAction(userId, role);
    if (res.ok) {
      toast.success(`Role pengguna diperbarui menjadi ${role}`);
      router.refresh();
    } else {
      toast.error(res.error);
    }
  };

  const handleToggleTeamAutoAssign = async (teamId: string) => {
    setTogglingTeamId(teamId);
    try {
      const res = await toggleTeamAutoAssignAction(teamId);
      if (res.ok) {
        toast.success(
          res.data
            ? 'Auto-Assign diaktifkan untuk tim ini'
            : 'Auto-Assign dinonaktifkan untuk tim ini',
        );
        router.refresh();
      } else {
        toast.error(res.error);
      }
    } finally {
      setTogglingTeamId(null);
    }
  };

  const handleTriggerTick = async (minutes = advanceMinutes) => {
    setIsTicking(true);
    setTickResult(null);
    try {
      const res = await triggerSlaTickAction(minutes);
      if (res.ok) {
        setTickResult(res.data);
        const newlyProcessed = res.data.warned + res.data.breached + res.data.autoClosed;
        if (newlyProcessed > 0) {
          toast.success(
            `SLA Tick memproses: ${res.data.warned} warning baru, ${res.data.breached} breach baru, ${res.data.autoClosed} auto-closed`,
          );
        } else {
          toast.info(
            `SLA Tick selesai: Terdeteksi ${res.data.activeBreached} tiket Breached & ${res.data.activeAtRisk} tiket At Risk (${res.data.totalRunning} SLA aktif dipantau)`,
          );
        }
        router.refresh();
      } else {
        toast.error(res.error);
      }
    } finally {
      setIsTicking(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Sub Tabs */}
      <div className="border-border flex flex-wrap items-center gap-1 border-b pb-2 text-xs">
        <button
          onClick={() => setActiveTab('users')}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors ${
            activeTab === 'users'
              ? 'bg-accent/10 text-accent font-semibold'
              : 'text-muted hover:bg-surface-2 hover:text-fg'
          }`}
        >
          <Users className="size-4" />
          <span>Pengguna ({data.users.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('teams')}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors ${
            activeTab === 'teams'
              ? 'bg-accent/10 text-accent font-semibold'
              : 'text-muted hover:bg-surface-2 hover:text-fg'
          }`}
        >
          <Shield className="size-4" />
          <span>Tim ({data.teams.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('categories')}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors ${
            activeTab === 'categories'
              ? 'bg-accent/10 text-accent font-semibold'
              : 'text-muted hover:bg-surface-2 hover:text-fg'
          }`}
        >
          <FolderTree className="size-4" />
          <span>Kategori ({data.categories.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('catalog')}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors ${
            activeTab === 'catalog'
              ? 'bg-accent/10 text-accent font-semibold'
              : 'text-muted hover:bg-surface-2 hover:text-fg'
          }`}
        >
          <Sliders className="size-4" />
          <span>Katalog Layanan ({data.catalog.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('sla')}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors ${
            activeTab === 'sla'
              ? 'bg-accent/10 text-accent font-semibold'
              : 'text-muted hover:bg-surface-2 hover:text-fg'
          }`}
        >
          <Clock className="size-4" />
          <span>SLA & Kalender</span>
        </button>

        <button
          onClick={() => setActiveTab('system')}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors ${
            activeTab === 'system'
              ? 'bg-accent/10 text-accent font-semibold'
              : 'text-muted hover:bg-surface-2 hover:text-fg'
          }`}
        >
          <Settings className="size-4" />
          <span>Status Sistem</span>
        </button>
      </div>

      {/* TAB 1: USERS */}
      {activeTab === 'users' ? (
        <Card className="shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div>
              <CardTitle className="text-base font-semibold">Daftar Pengguna</CardTitle>
              <CardDescription className="text-xs">
                Kelola hak akses role dan status aktif akun pengguna sistem Sigap
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <div className="border-border max-h-[500px] scrollbar-thin overflow-y-auto rounded-lg border">
              <table className="w-full text-left text-xs">
                <thead className="bg-surface-2 text-muted border-border sticky top-0 border-b font-semibold">
                  <tr>
                    <th className="p-2.5">Nama</th>
                    <th className="p-2.5">Email</th>
                    <th className="p-2.5">Departemen</th>
                    <th className="p-2.5">Role</th>
                    <th className="p-2.5 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-border/60 divide-y">
                  {data.users.map((u) => (
                    <tr key={u.id} className="hover:bg-surface-2/40">
                      <td className="text-fg p-2.5 font-semibold">{u.name}</td>
                      <td className="text-muted p-2.5 font-mono">{u.email}</td>
                      <td className="text-muted p-2.5">{u.department}</td>
                      <td className="p-2.5">
                        <NativeSelect
                          value={u.role}
                          onChange={(e) => handleUpdateRole(u.id, e.target.value as Role)}
                          className="h-7 w-28 text-xs"
                        >
                          <option value="requester">Requester</option>
                          <option value="agent">Agent</option>
                          <option value="lead">Lead</option>
                          <option value="admin">Admin</option>
                        </NativeSelect>
                      </td>
                      <td className="p-2.5 text-center">
                        <button
                          onClick={() => handleToggleUser(u.id)}
                          className={`cursor-pointer rounded px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                            u.isActive
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                              : 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                          }`}
                        >
                          {u.isActive ? 'Aktif' : 'Nonaktif'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* TAB 2: TEAMS */}
      {activeTab === 'teams' ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {data.teams.map((team) => {
            const lead = data.users.find((u) => u.id === team.leadId);
            return (
              <Card key={team.id} className="shadow-xs">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-fg text-base font-bold">{team.name}</CardTitle>
                    <button
                      type="button"
                      onClick={() => handleToggleTeamAutoAssign(team.id)}
                      disabled={togglingTeamId === team.id}
                      title="Klik untuk mengubah status auto-assign tim ini"
                      className={`flex cursor-pointer items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-semibold transition-all ${
                        team.autoAssign
                          ? 'border-emerald-300 bg-emerald-100 text-emerald-800 hover:bg-emerald-200 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                          : 'border-border bg-surface-2 text-muted hover:bg-surface-3 hover:text-fg'
                      }`}
                    >
                      <span
                        className={`inline-block size-1.5 rounded-full ${
                          team.autoAssign ? 'bg-emerald-600 dark:bg-emerald-400' : 'bg-muted'
                        }`}
                      />
                      <span>{team.autoAssign ? 'Auto-Assign On' : 'Auto-Assign Off'}</span>
                    </button>
                  </div>
                  <CardDescription className="text-xs">
                    Team Lead: <strong>{lead?.name ?? '—'}</strong>
                  </CardDescription>
                </CardHeader>
                <CardContent className="border-border/60 flex flex-col gap-2 border-t pt-2 text-xs">
                  <span className="text-muted font-semibold">
                    Anggota Tim ({team.memberIds.length}):
                  </span>
                  <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
                    {team.memberIds.map((mid) => {
                      const member = data.users.find((u) => u.id === mid);
                      return (
                        <div key={mid} className="flex items-center justify-between py-0.5">
                          <span className="text-fg">{member?.name}</span>
                          <span className="text-muted text-[11px]">{member?.role}</span>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : null}

      {/* TAB 3: CATEGORIES */}
      {activeTab === 'categories' ? (
        <Card className="shadow-xs">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Kategori Layanan & Masalah</CardTitle>
            <CardDescription className="text-xs">
              Struktur klasifikasi tiket dan routing otomatis ke tim terkait
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="divide-border/60 border-border divide-y rounded-lg border">
              {data.categories.map((cat) => {
                const team = data.teams.find((t) => t.id === cat.defaultTeamId);
                const parent = data.categories.find((c) => c.id === cat.parentId);
                return (
                  <div key={cat.id} className="flex items-center justify-between p-3 text-xs">
                    <div className="flex items-center gap-2">
                      <FolderTree className="text-accent size-4" />
                      <div>
                        <span className="text-fg font-semibold">{cat.name}</span>
                        {parent ? (
                          <span className="text-muted ml-2 text-[11px]">
                            (Induk: {parent.name})
                          </span>
                        ) : (
                          <span className="text-accent ml-2 text-[10px] font-bold">
                            Kategori Utama
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="bg-surface-2 text-muted rounded px-2 py-0.5 font-medium">
                      Routing Tim: {team?.name ?? '—'}
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* TAB 4: CATALOG BUILDER */}
      {activeTab === 'catalog' ? (
        <Card className="shadow-xs">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Item Katalog Layanan</CardTitle>
            <CardDescription className="text-xs">
              Daftar form layanan yang tersedia untuk diajukan oleh pengguna di portal
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="divide-border/60 border-border divide-y rounded-lg border">
              {data.catalog.map((item) => {
                const cat = data.categories.find((c) => c.id === item.categoryId);
                return (
                  <div key={item.id} className="flex items-center justify-between p-3 text-xs">
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-fg font-semibold">{item.name}</span>
                        <span
                          className={`py-0.2 rounded px-1.5 text-[10px] font-semibold uppercase ${
                            item.ticketType === 'incident'
                              ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                              : 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300'
                          }`}
                        >
                          {item.ticketType}
                        </span>
                      </div>
                      <span className="text-muted text-[11px]">
                        Kategori: {cat?.name ?? '—'} · Dampak Default: {item.defaultImpact} ·{' '}
                        {item.formSchema.length} field kustom
                      </span>
                    </div>

                    <span
                      className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                        item.isActive
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                          : 'bg-surface-2 text-muted'
                      }`}
                    >
                      {item.isActive ? 'Aktif' : 'Nonaktif'}
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* TAB 5: SLA POLICIES & CALENDAR */}
      {activeTab === 'sla' ? (
        <div className="flex flex-col gap-6">
          {/* Kebijakan SLA */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {data.policies.map((pol) => (
              <Card key={pol.id} className="shadow-xs">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-fg text-sm font-bold">{pol.name}</CardTitle>
                    <span className="bg-accent/10 text-accent py-0.2 rounded px-1.5 text-[10px] font-semibold uppercase">
                      {pol.ticketType}
                    </span>
                  </div>
                  <CardDescription className="text-xs">
                    {pol.isDefault ? 'Kebijakan SLA Standar' : 'Kebijakan SLA Khusus'}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <table className="border-border w-full rounded border text-left text-xs">
                    <thead className="bg-surface-2 text-muted border-border border-b font-semibold">
                      <tr>
                        <th className="p-2">Prioritas</th>
                        <th className="p-2">Response Time</th>
                        <th className="p-2">Resolution Time</th>
                      </tr>
                    </thead>
                    <tbody className="divide-border/60 divide-y">
                      {pol.targets.map((tgt) => (
                        <tr key={tgt.priority}>
                          <td className="p-2 font-mono font-bold">{tgt.priority}</td>
                          <td className="p-2 font-mono">{formatDuration(tgt.responseMinutes)}</td>
                          <td className="p-2 font-mono">{formatDuration(tgt.resolutionMinutes)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Kalender Kerja & Libur */}
          <Card className="shadow-xs">
            <CardHeader className="pb-2">
              <CardTitle className="text-fg text-sm font-bold">
                Kalender Bisnis: Senin–Jumat 08:00–17:00 WIB (Istirahat 12:00–13:00)
              </CardTitle>
              <CardDescription className="text-xs">
                Jam istirahat dan hari libur nasional tidak dihitung dalam SLA jam kerja.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <span className="text-muted mb-2 block text-xs font-semibold">
                Daftar Hari Libur Nasional Terdaftar ({data.holidays.length}):
              </span>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
                {data.holidays.map((h) => (
                  <div
                    key={h.id}
                    className="border-border bg-surface-2/40 flex items-center justify-between rounded border px-2.5 py-1.5 text-xs"
                  >
                    <span className="text-accent font-mono font-semibold">{h.date}</span>
                    <span className="text-muted max-w-[150px] truncate">{h.name}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* TAB 6: SYSTEM STATUS */}
      {activeTab === 'system' ? (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card className="shadow-xs">
              <CardContent className="p-4">
                <span className="text-muted text-xs uppercase">Total Tiket</span>
                <div className="text-fg mt-1 font-mono text-2xl font-bold">
                  {data.stats.totalTickets}
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-xs">
              <CardContent className="p-4">
                <span className="text-muted text-xs uppercase">Audit Events</span>
                <div className="text-fg mt-1 font-mono text-2xl font-bold">
                  {data.stats.totalEvents}
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-xs">
              <CardContent className="p-4">
                <span className="text-muted text-xs uppercase">Total Komentar</span>
                <div className="text-fg mt-1 font-mono text-2xl font-bold">
                  {data.stats.totalComments}
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-xs">
              <CardContent className="p-4">
                <span className="text-muted text-xs uppercase">Pengguna Aktif</span>
                <div className="text-fg mt-1 font-mono text-2xl font-bold">
                  {data.stats.totalUsers}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Trigger SLA Tick Worker */}
          <Card className="border-accent/40 bg-surface shadow-xs">
            <CardHeader className="pb-2">
              <CardTitle className="text-accent flex items-center gap-1.5 text-sm font-semibold">
                <Play className="size-4" />
                <span>Simulasi Worker Berkala: SLA Tick & Auto-Close</span>
              </CardTitle>
              <CardDescription className="text-xs">
                Di lingkungan produksi, worker ini berjalan setiap menit via pg-boss untuk memeriksa
                tiket mendekati batas (75%), tiket breach, eskalasi hierarkis, dan auto-close
                setelah 3 hari kerja.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-col gap-3">
                <div className="bg-surface-2/40 border-border/60 flex flex-col gap-2 rounded-lg border p-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted">Waktu tick worker terakhir:</span>
                    <strong className="text-fg font-mono">
                      {data.stats.workerLastTick
                        ? formatDateTime(data.stats.workerLastTick)
                        : 'Belum pernah dijalankan'}
                    </strong>
                  </div>
                  <div className="flex flex-col gap-1.5 pt-1">
                    <span className="text-muted text-[11px] font-semibold">
                      Pilihan Simulasi Waktu (Time-Travel Offset):
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        { label: 'Waktu Nyata (0m)', val: 0 },
                        { label: '+1 Jam (Warning 75%)', val: 60 },
                        { label: '+1 Hari (Breach & Eskalasi)', val: 1440 },
                        { label: '+3 Hari Kerja (Auto-Close)', val: 4320 },
                      ].map((preset) => (
                        <button
                          key={preset.val}
                          type="button"
                          onClick={() => setAdvanceMinutes(preset.val)}
                          className={`cursor-pointer rounded border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                            advanceMinutes === preset.val
                              ? 'bg-accent border-accent text-white shadow-xs'
                              : 'bg-surface-2 text-muted border-border hover:bg-surface-3 hover:text-fg'
                          }`}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <p className="text-muted text-[11px]">
                    {advanceMinutes === 0
                      ? 'Menjalankan tick pada waktu sistem saat ini.'
                      : `Mensimulasikan worker berjalan pada ${
                          advanceMinutes >= 1440
                            ? `+${advanceMinutes / 1440} hari`
                            : `+${advanceMinutes / 60} jam`
                        } di masa depan.`}
                  </p>

                  <Button
                    variant="primary"
                    size="sm"
                    disabled={isTicking}
                    onClick={() => handleTriggerTick(advanceMinutes)}
                    className="shrink-0 gap-1.5"
                  >
                    <RefreshCw className={`size-3.5 ${isTicking ? 'animate-spin' : ''}`} />
                    <span>
                      {isTicking
                        ? 'Memproses...'
                        : advanceMinutes > 0
                          ? `Jalankan Tick (+${
                              advanceMinutes >= 1440
                                ? `${advanceMinutes / 1440} Hari`
                                : `${advanceMinutes / 60} Jam`
                            })`
                          : 'Jalankan SLA Tick Sekarang'}
                    </span>
                  </Button>
                </div>
              </div>

              {tickResult ? (
                <div className="border-accent/40 bg-accent/5 animate-fade-in flex flex-col gap-3 rounded-lg border p-3.5 text-xs">
                  <div className="border-accent/20 flex flex-wrap items-center justify-between border-b pb-2">
                    <div className="text-accent flex items-center gap-1.5 font-semibold">
                      <CheckCircle2 className="size-4 shrink-0" />
                      <span>Hasil Evaluasi SLA Tick Worker</span>
                    </div>
                    {tickResult.simulatedNow ? (
                      <span className="text-muted font-mono text-[11px]">
                        Waktu Evaluasi: {formatDateTime(tickResult.simulatedNow)}
                      </span>
                    ) : null}
                  </div>

                  {/* Ringkasan Status SLA Real-time */}
                  <div className="flex flex-col gap-1.5">
                    <span className="text-muted text-[11px] font-semibold tracking-wider uppercase">
                      Status SLA Terdeteksi di Sistem Saat Ini ({tickResult.totalRunning} SLA
                      aktif):
                    </span>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div className="bg-surface rounded-md border border-rose-500/20 p-2.5">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-rose-600 dark:text-rose-400">
                            Tiket Breached ({tickResult.activeBreached}):
                          </span>
                          <span className="text-muted text-[10px]">
                            {tickResult.breached > 0
                              ? `+${tickResult.breached} baru ter-breach di tick ini`
                              : 'Sudah tercatat sebelumnya'}
                          </span>
                        </div>
                        {tickResult.breachedTickets.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5 pt-2">
                            {tickResult.breachedTickets.map((num) => (
                              <Link
                                key={num}
                                href={`/tickets/${num}`}
                                className="rounded border border-rose-200 bg-rose-500/10 px-1.5 py-0.5 font-mono text-[11px] font-bold text-rose-600 hover:underline dark:border-rose-900/60 dark:text-rose-400"
                              >
                                {num}
                              </Link>
                            ))}
                          </div>
                        ) : (
                          <p className="text-muted pt-1 text-[11px] italic">
                            Tidak ada tiket aktif yang breached.
                          </p>
                        )}
                      </div>

                      <div className="bg-surface rounded-md border border-amber-500/20 p-2.5">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-amber-600 dark:text-amber-400">
                            Tiket Mendekati Batas / At Risk 75% ({tickResult.activeAtRisk}):
                          </span>
                          <span className="text-muted text-[10px]">
                            {tickResult.warned > 0
                              ? `+${tickResult.warned} baru diberi warning di tick ini`
                              : 'Sudah diperingatkan'}
                          </span>
                        </div>
                        {tickResult.atRiskTickets.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5 pt-2">
                            {tickResult.atRiskTickets.map((num) => (
                              <Link
                                key={num}
                                href={`/tickets/${num}`}
                                className="rounded border border-amber-200 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[11px] font-bold text-amber-600 hover:underline dark:border-amber-900/60 dark:text-amber-400"
                              >
                                {num}
                              </Link>
                            ))}
                          </div>
                        ) : (
                          <p className="text-muted pt-1 text-[11px] italic">
                            Tidak ada tiket aktif mendekati batas.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Tindakan Worker pada Tick Ini */}
                  <div className="border-border/60 bg-surface-2/40 flex flex-col gap-1 rounded-md border p-2.5 text-[11px]">
                    <div className="text-muted flex items-center justify-between">
                      <span>Tindakan Baru yang Dieksekusi pada Tick Ini:</span>
                      <span className="text-fg font-mono font-semibold">
                        {tickResult.warned} warning baru · {tickResult.breached} breach baru ·{' '}
                        {tickResult.autoClosed} auto-closed
                      </span>
                    </div>
                    <p className="text-muted text-[10px]">
                      Sesuai arsitektur ITSM (ADR-001 &amp; ADR-003), worker periodik bersifat{' '}
                      <strong>idempoten</strong>: notifikasi dan pencatatan audit trail hanya dibuat
                      sekali saat pertama kali tiket melampaui batas untuk mencegah duplikasi event
                      berulang.
                    </p>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
