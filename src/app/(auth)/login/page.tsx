'use client';

import * as React from 'react';
import { ArrowRight, CheckCircle2, Shield, User, Users, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { loginWithDemo, loginWithEmail } from '@/server/actions/auth';
import type { Role } from '@/domain/types';
import { DEMO_PASSWORD } from '@/domain/demo';

const DEMO_CARDS: Array<{
  role: Role;
  name: string;
  title: string;
  desc: string;
  icon: React.ReactNode;
}> = [
  {
    role: 'requester',
    name: 'Putri Maharani',
    title: 'Requester (Pengguna Akhir)',
    desc: 'Ajukan keluhan, pantau tiket, beri rating CSAT',
    icon: <User className="size-5 text-teal-600 dark:text-teal-400" />,
  },
  {
    role: 'agent',
    name: 'Dimas Saputra',
    title: 'Agent L1 (Service Desk)',
    desc: 'Tangani queue, respons tiket, update status, dan investigasi',
    icon: <Wrench className="size-5 text-blue-600 dark:text-blue-400" />,
  },
  {
    role: 'lead',
    name: 'Rina Kusuma',
    title: 'Team Lead (Operasional)',
    desc: 'Pantau breach, eskalasi tiket, dan override prioritas',
    icon: <Users className="size-5 text-amber-600 dark:text-amber-400" />,
  },
  {
    role: 'admin',
    name: 'Andi Pratama',
    title: 'Administrator Sistem',
    desc: 'Kelola tim, SLA policy, katalog, dan status sistem',
    icon: <Shield className="size-5 text-rose-600 dark:text-rose-400" />,
  },
];

export default function LoginPage() {
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState(DEMO_PASSWORD);
  const [error, setError] = React.useState<string | null>(null);
  const [loadingRole, setLoadingRole] = React.useState<Role | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const handleDemoLogin = async (role: Role) => {
    setLoadingRole(role);
    setError(null);
    try {
      await loginWithDemo(role);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal login');
      setLoadingRole(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await loginWithEmail(email, password);
      if (!res.ok) {
        setError(res.error ?? 'Email tidak ditemukan');
        setIsSubmitting(false);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal login');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-bg flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="flex w-full max-w-xl flex-col gap-8">
        {/* Brand header */}
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="bg-accent text-accent-fg flex size-11 items-center justify-center rounded-xl text-xl font-black shadow-md">
            S
          </div>
          <h1 className="text-fg text-2xl font-bold tracking-tight">Sigap IT Service Desk</h1>
          <p className="text-muted max-w-md text-xs">
            Sistem ITSM berbasis ITIL 4 dengan perhitungan SLA jam kerja akurat (Asia/Jakarta) dan
            prioritas otomatis.
          </p>
        </div>

        {/* Demo Fast Login Box */}
        <Card className="border-accent/30 bg-surface shadow-xs">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-accent flex items-center gap-1.5 text-sm font-semibold">
                <CheckCircle2 className="size-4" />
                <span>Pilih Akun Demo (1-Click Login)</span>
              </CardTitle>
              <span className="text-muted font-mono text-[11px]">Password demo otomatis</span>
            </div>
            <CardDescription className="text-xs">
              Pilih peran di bawah ini untuk langsung mencoba alur kerja sesuai hak aksesnya:
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {DEMO_CARDS.map((card) => {
              const isLoading = loadingRole === card.role;
              return (
                <button
                  key={card.role}
                  type="button"
                  disabled={loadingRole !== null || isSubmitting}
                  onClick={() => handleDemoLogin(card.role)}
                  className="border-border bg-surface-2/40 hover:border-accent hover:bg-surface-2 focus-visible:outline-accent flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-left transition-all focus-visible:outline-2 disabled:opacity-60"
                >
                  <div className="bg-surface border-border flex size-8 shrink-0 items-center justify-center rounded-md border">
                    {card.icon}
                  </div>
                  <div className="flex flex-col gap-0.5 overflow-hidden">
                    <span className="text-fg flex items-center gap-1 text-xs font-semibold">
                      <span>{card.name}</span>
                      {isLoading ? (
                        <span className="text-accent ml-auto animate-pulse text-[10px]">
                          Masuk...
                        </span>
                      ) : (
                        <ArrowRight className="text-muted ml-auto size-3" />
                      )}
                    </span>
                    <span className="text-accent truncate text-[11px] font-medium">
                      {card.title}
                    </span>
                    <span className="text-muted line-clamp-1 text-[10px]">{card.desc}</span>
                  </div>
                </button>
              );
            })}
          </CardContent>
        </Card>

        {/* Manual Login Form */}
        <Card className="shadow-xs">
          <CardHeader className="pb-2">
            <CardTitle className="text-fg text-sm font-semibold">Atau Masuk dengan Email</CardTitle>
            <CardDescription className="text-xs">
              Gunakan email pengguna terdaftar (mis. <code>admin@sigap.demo</code>,{' '}
              <code>agent@sigap.demo</code>)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
              {error ? (
                <div className="border-danger/30 bg-danger/10 text-danger rounded-md border px-3 py-2 text-xs">
                  {error}
                </div>
              ) : null}

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="nama@sigap.demo"
                  required
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                />
              </div>

              <Button
                type="submit"
                variant="primary"
                disabled={isSubmitting || loadingRole !== null}
                className="mt-1 w-full"
              >
                {isSubmitting ? 'Memproses...' : 'Masuk ke Sistem'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
