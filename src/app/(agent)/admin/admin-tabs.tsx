'use client';

import * as React from 'react';
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
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/input';
import { toggleUserActiveAction, updateUserRoleAction } from '@/server/actions/admin';
import { triggerSlaTickAction } from '@/server/actions/tickets';
import { formatDateTime, formatDuration } from '@/lib/format';
import type { AdminData } from '@/server/queries/admin';
import type { Role } from '@/domain/types';

interface AdminTabsProps {
  data: AdminData;
}

export function AdminTabs({ data }: AdminTabsProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = React.useState<
    'users' | 'teams' | 'categories' | 'catalog' | 'sla' | 'system'
  >('users');

  const [tickResult, setTickResult] = React.useState<{
    warned: number;
    breached: number;
    autoClosed: number;
  } | null>(null);
  const [isTicking, setIsTicking] = React.useState(false);

  const handleToggleUser = async (userId: string) => {
    await toggleUserActiveAction(userId);
    router.refresh();
  };

  const handleUpdateRole = async (userId: string, role: Role) => {
    await updateUserRoleAction(userId, role);
    router.refresh();
  };

  const handleTriggerTick = async () => {
    setIsTicking(true);
    setTickResult(null);
    try {
      const res = await triggerSlaTickAction();
      if (res.ok) {
        setTickResult(res.data);
        router.refresh();
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
                    <span
                      className={`py-0.2 rounded px-1.5 text-[10px] font-semibold ${
                        team.autoAssign
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                          : 'bg-surface-2 text-muted'
                      }`}
                    >
                      {team.autoAssign ? 'Auto-Assign On' : 'Auto-Assign Off'}
                    </span>
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
                Sesuai ITSM.md §4.2, jam istirahat dan hari libur nasional tidak dihitung dalam SLA
                jam kerja.
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
              <div className="flex items-center justify-between">
                <div className="text-muted text-xs">
                  Waktu tick terakhir:{' '}
                  <strong>
                    {data.stats.workerLastTick
                      ? formatDateTime(data.stats.workerLastTick)
                      : 'Belum pernah dijalankan manual'}
                  </strong>
                </div>

                <Button
                  variant="primary"
                  size="sm"
                  disabled={isTicking}
                  onClick={handleTriggerTick}
                  className="gap-1.5"
                >
                  <RefreshCw className={`size-3.5 ${isTicking ? 'animate-spin' : ''}`} />
                  <span>{isTicking ? 'Menjalankan...' : 'Jalankan SLA Tick Sekarang'}</span>
                </Button>
              </div>

              {tickResult ? (
                <div className="border-accent/40 bg-accent/5 animate-fade-in flex items-center gap-4 rounded-lg border p-3 text-xs">
                  <CheckCircle2 className="text-accent size-4 shrink-0" />
                  <span>
                    Hasil Tick: <strong>{tickResult.warned}</strong> tiket diberi peringatan (75%),{' '}
                    <strong>{tickResult.breached}</strong> tiket ditandai breached,{' '}
                    <strong>{tickResult.autoClosed}</strong> tiket otomatis ditutup (3 hari kerja).
                  </span>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
