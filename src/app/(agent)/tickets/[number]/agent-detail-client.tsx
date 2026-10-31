'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRightLeft,
  CheckCircle2,
  Edit2,
  Lock,
  MessageSquare,
  Pause,
  Play,
  Send,
  ShieldAlert,
  User,
  UserCheck,
  UserMinus,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, NativeSelect, Textarea } from '@/components/ui/input';
import { PriorityBadge } from '@/components/itsm/priority-badge';
import { SlaCard } from '@/components/itsm/sla-card';
import { StatusPill } from '@/components/itsm/status-pill';
import { Timeline } from '@/components/itsm/timeline';
import {
  addCommentAction,
  assignTicketAction,
  overridePriorityAction,
  transitionTicketAction,
  updateClassificationAction,
} from '@/server/actions/tickets';
import { formatDateTime, formatRelative } from '@/lib/format';
import type { CalendarMap, TicketDetail } from '@/lib/views';
import type { SessionUser } from '@/server/auth/session';
import type { AssigneeOption, TeamOption } from '@/server/queries/tickets';
import type {
  Impact,
  PendingReason,
  Priority,
  ResolutionCode,
  TicketStatus,
  Urgency,
} from '@/domain/types';

interface AgentDetailClientProps {
  detail: TicketDetail;
  user: SessionUser;
  assignees: AssigneeOption[];
  teams: TeamOption[];
  calendars: CalendarMap;
}

export function AgentDetailClient({
  detail,
  user,
  assignees,
  teams,
  calendars,
}: AgentDetailClientProps) {
  const router = useRouter();

  // Composer state
  const [commentMode, setCommentMode] = React.useState<'public' | 'internal'>('public');
  const [commentBody, setCommentBody] = React.useState('');
  const [isSubmittingComment, setIsSubmittingComment] = React.useState(false);

  // Dialog states
  const [pendingOpen, setPendingOpen] = React.useState(false);
  const [pendingReason, setPendingReason] = React.useState<PendingReason>('awaiting_user');

  const [resolveOpen, setResolveOpen] = React.useState(false);
  const [resolutionCode, setResolutionCode] = React.useState<ResolutionCode>('fixed');
  const [resolutionNotes, setResolutionNotes] = React.useState('');

  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [cancelReason, setCancelReason] = React.useState('');

  const [overrideOpen, setOverrideOpen] = React.useState(false);
  const [overridePriority, setOverridePriority] = React.useState<Priority>(detail.priority);
  const [overrideReason, setOverrideReason] = React.useState('');

  const [classifyOpen, setClassifyOpen] = React.useState(false);
  const [impact, setImpact] = React.useState<Impact>(detail.impact);
  const [urgency, setUrgency] = React.useState<Urgency>(detail.urgency);

  const [escalateOpen, setEscalateOpen] = React.useState(false);
  const [escalateTeamId, setEscalateTeamId] = React.useState('');
  const [escalateNote, setEscalateNote] = React.useState('');

  const [isProcessing, setIsProcessing] = React.useState(false);
  const [dialogError, setDialogError] = React.useState<string | null>(null);

  const cal = calendars[detail.resolution.calendarId];
  const canOverride = user.role === 'lead' || user.role === 'admin';

  // Penugasan & Hak Akses (ADR-008 Option B)
  const inTeam = detail.team ? user.teamIds.includes(detail.team.id) : false;
  const leadsTeam = detail.team ? user.ledTeamIds.includes(detail.team.id) : false;
  const isAdmin = user.role === 'admin';
  const isLead = user.role === 'lead';
  const canManageAssignment = isAdmin || leadsTeam || (isLead && inTeam);

  const isAssignedToMe = detail.assignee?.id === user.id;
  const isUnassigned = !detail.assignee;

  const availableAssignees = React.useMemo(() => {
    if (isAdmin) return assignees;
    if (detail.team) {
      return assignees.filter((a) => a.teamId === detail.team?.id);
    }
    return assignees;
  }, [isAdmin, detail.team, assignees]);

  const otherTeams = React.useMemo(() => {
    return teams.filter((t) => t.id !== detail.team?.id);
  }, [teams, detail.team]);

  // 1. Kirim Komentar / Internal Note
  const handleSendComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentBody.trim()) return;
    setIsSubmittingComment(true);
    try {
      const res = await addCommentAction(detail.id, commentBody.trim(), commentMode);
      if (res.ok) {
        setCommentBody('');
        toast.success(
          commentMode === 'internal'
            ? 'Catatan internal berhasil disimpan'
            : 'Balasan berhasil dikirim ke pemohon',
        );
        router.refresh();
      } else {
        toast.error(res.error);
      }
    } finally {
      setIsSubmittingComment(false);
    }
  };

  // 2. Transisi Langsung (Start Progress, Close)
  const handleDirectTransition = async (to: TicketStatus) => {
    setIsProcessing(true);
    try {
      const res = await transitionTicketAction({
        ticketId: detail.id,
        to,
      });
      if (!res.ok) {
        toast.error(res.error);
      } else {
        toast.success('Status tiket berhasil diperbarui');
        router.refresh();
      }
    } finally {
      setIsProcessing(false);
    }
  };

  // 3. Assign / Unassign
  const handleAssign = async (assigneeId: string | null) => {
    setIsProcessing(true);
    try {
      const res = await assignTicketAction({
        ticketId: detail.id,
        assigneeId,
        teamId: detail.team?.id,
      });
      if (!res.ok) {
        toast.error(res.error);
      } else {
        toast.success(
          assigneeId
            ? assigneeId === user.id
              ? 'Tiket berhasil diambil untuk Anda'
              : 'Penugasan tiket berhasil diperbarui'
            : 'Tiket berhasil dikembalikan ke queue (Unassigned)',
        );
        router.refresh();
      }
    } finally {
      setIsProcessing(false);
    }
  };

  // 4. Eskalasi Fungsional (Pindah Tim)
  const handleSubmitEscalate = async () => {
    if (!escalateTeamId) {
      setDialogError('Pilih tim tujuan eskalasi');
      return;
    }
    if (escalateNote.trim().length < 5) {
      setDialogError('Catatan eskalasi minimal 5 karakter');
      return;
    }
    setIsProcessing(true);
    setDialogError(null);
    try {
      const res = await assignTicketAction({
        ticketId: detail.id,
        assigneeId: null,
        teamId: escalateTeamId,
        note: escalateNote.trim(),
      });
      if (!res.ok) {
        setDialogError(res.error);
        toast.error(res.error);
      } else {
        toast.success('Tiket berhasil dieskalasi ke tim tujuan');
        setEscalateOpen(false);
        setEscalateNote('');
        router.refresh();
      }
    } finally {
      setIsProcessing(false);
    }
  };

  // 5. Submit Dialog Pending
  const handleSubmitPending = async () => {
    setIsProcessing(true);
    setDialogError(null);
    try {
      const res = await transitionTicketAction({
        ticketId: detail.id,
        to: 'pending',
        pendingReason,
      });
      if (!res.ok) {
        setDialogError(res.error);
        toast.error(res.error);
      } else {
        toast.success('Status tiket diubah menjadi Pending (SLA dijeda)');
        setPendingOpen(false);
        router.refresh();
      }
    } finally {
      setIsProcessing(false);
    }
  };

  // 6. Submit Dialog Resolve
  const handleSubmitResolve = async () => {
    if (resolutionNotes.trim().length < 5) {
      setDialogError('Catatan penyelesaian minimal 5 karakter');
      return;
    }
    setIsProcessing(true);
    setDialogError(null);
    try {
      const res = await transitionTicketAction({
        ticketId: detail.id,
        to: 'resolved',
        resolutionCode,
        resolutionNotes: resolutionNotes.trim(),
      });
      if (!res.ok) {
        setDialogError(res.error);
        toast.error(res.error);
      } else {
        toast.success('Tiket berhasil diselesaikan (Resolved)');
        setResolveOpen(false);
        router.refresh();
      }
    } finally {
      setIsProcessing(false);
    }
  };

  // 7. Submit Dialog Cancel
  const handleSubmitCancel = async () => {
    if (cancelReason.trim().length < 5) {
      setDialogError('Alasan pembatalan minimal 5 karakter');
      return;
    }
    setIsProcessing(true);
    setDialogError(null);
    try {
      const res = await transitionTicketAction({
        ticketId: detail.id,
        to: 'cancelled',
        cancellationReason: cancelReason.trim(),
      });
      if (!res.ok) {
        setDialogError(res.error);
        toast.error(res.error);
      } else {
        toast.success('Tiket berhasil dibatalkan');
        setCancelOpen(false);
        router.refresh();
      }
    } finally {
      setIsProcessing(false);
    }
  };

  // 8. Submit Override Prioritas
  const handleSubmitOverride = async () => {
    if (overrideReason.trim().length < 10) {
      setDialogError('Alasan override prioritas minimal 10 karakter');
      return;
    }
    setIsProcessing(true);
    setDialogError(null);
    try {
      const res = await overridePriorityAction(detail.id, overridePriority, overrideReason.trim());
      if (!res.ok) {
        setDialogError(res.error);
        toast.error(res.error);
      } else {
        toast.success('Prioritas berhasil di-override & SLA dihitung ulang');
        setOverrideOpen(false);
        router.refresh();
      }
    } finally {
      setIsProcessing(false);
    }
  };

  // 9. Submit Klasifikasi Impact/Urgency
  const handleSubmitClassify = async () => {
    setIsProcessing(true);
    setDialogError(null);
    try {
      const res = await updateClassificationAction(detail.id, impact, urgency);
      if (!res.ok) {
        setDialogError(res.error);
        toast.error(res.error);
      } else {
        toast.success('Klasifikasi dampak & urgensi berhasil diperbarui');
        setClassifyOpen(false);
        router.refresh();
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const isActive = ['new', 'assigned', 'in_progress', 'pending'].includes(detail.status);

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6">
      {/* Header bar tiket */}
      <div className="border-border bg-surface flex flex-col gap-2 rounded-xl border p-4 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-accent font-mono text-base font-bold">{detail.number}</span>
            <PriorityBadge priority={detail.priority} showLabel />
            <StatusPill status={detail.status} mode="agent" />
            {detail.pendingReason ? (
              <span className="rounded bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700 dark:bg-purple-950/60 dark:text-purple-300">
                Alasan: {detail.pendingReason}
              </span>
            ) : null}
          </div>

          {/* Action buttons bar */}
          {isActive ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {detail.status === 'new' || detail.status === 'assigned' ? (
                <Button
                  variant="primary"
                  size="sm"
                  disabled={isProcessing}
                  onClick={() => handleDirectTransition('in_progress')}
                  className="h-8 gap-1.5 text-xs"
                >
                  <Play className="size-3.5" />
                  <span>Start Progress</span>
                </Button>
              ) : null}

              {detail.status === 'in_progress' ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={isProcessing}
                  onClick={() => setPendingOpen(true)}
                  className="h-8 gap-1.5 text-xs"
                >
                  <Pause className="size-3.5" />
                  <span>Jeda (Pending)</span>
                </Button>
              ) : null}

              {detail.status === 'pending' ? (
                <Button
                  variant="primary"
                  size="sm"
                  disabled={isProcessing}
                  onClick={() => handleDirectTransition('in_progress')}
                  className="h-8 gap-1.5 text-xs"
                >
                  <Play className="size-3.5" />
                  <span>Lanjutkan (Resume)</span>
                </Button>
              ) : null}

              {detail.status === 'in_progress' || detail.status === 'assigned' ? (
                <Button
                  variant="primary"
                  size="sm"
                  disabled={isProcessing}
                  onClick={() => setResolveOpen(true)}
                  className="h-8 gap-1.5 bg-emerald-600 text-xs text-white hover:bg-emerald-700"
                >
                  <CheckCircle2 className="size-3.5" />
                  <span>Selesaikan (Resolve)</span>
                </Button>
              ) : null}

              <Button
                variant="ghost"
                size="sm"
                disabled={isProcessing}
                onClick={() => setCancelOpen(true)}
                className="text-danger hover:bg-danger/10 h-8 gap-1.5 text-xs"
              >
                <XCircle className="size-3.5" />
                <span>Batalkan</span>
              </Button>
            </div>
          ) : detail.status === 'resolved' ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={isProcessing}
              onClick={() => handleDirectTransition('closed')}
              className="h-8 gap-1.5 text-xs"
            >
              <CheckCircle2 className="size-3.5" />
              <span>Tutup Tiket (Close)</span>
            </Button>
          ) : null}
        </div>

        <h1 className="text-fg pt-1 text-xl font-bold">{detail.title}</h1>

        <div className="text-muted flex flex-wrap items-center gap-3 text-xs">
          <span>
            Kategori: <strong className="text-fg">{detail.category}</strong>
          </span>
          <span>·</span>
          <span>
            Pemohon: <strong className="text-fg">{detail.requester.name}</strong>
          </span>
          <span>·</span>
          <span>
            Dibuat: {formatDateTime(detail.createdAt)} (
            {formatRelative(detail.createdAt, new Date())})
          </span>
        </div>
      </div>

      {/* Main 2-column layout (Area lebar + Panel kanan 320px) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Kolom Kiri: Deskripsi, Composer, Timeline (2 kolom) */}
        <div className="flex flex-col gap-6 lg:col-span-2">
          {/* Deskripsi & Form Data */}
          <Card className="shadow-xs">
            <CardHeader className="pb-2">
              <CardTitle className="text-muted text-xs font-semibold tracking-wider uppercase">
                Deskripsi Tiket
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <p className="text-fg leading-relaxed whitespace-pre-wrap">{detail.description}</p>

              {detail.formFields.length > 0 ? (
                <div className="border-border grid grid-cols-1 gap-2.5 border-t pt-3 sm:grid-cols-2">
                  {detail.formFields.map((f, i) => (
                    <div key={i} className="flex flex-col text-xs">
                      <span className="text-muted font-medium">{f.label}</span>
                      <span className="text-fg font-semibold">{f.value}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* Composer: Toggle Komentar Publik vs Catatan Internal */}
          {isActive ? (
            <Card className="border-accent/30 shadow-xs">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setCommentMode('public')}
                    className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                      commentMode === 'public'
                        ? 'bg-accent text-accent-fg'
                        : 'text-muted hover:bg-surface-2'
                    }`}
                  >
                    <MessageSquare className="size-3.5" />
                    <span>Balas Requester (Publik)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setCommentMode('internal')}
                    className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                      commentMode === 'internal'
                        ? 'bg-amber-400 font-bold text-amber-950'
                        : 'text-muted hover:bg-surface-2'
                    }`}
                  >
                    <Lock className="size-3.5" />
                    <span>Catatan Internal (Staff Saja)</span>
                  </button>
                </div>

                <span className="text-muted text-[11px]">
                  {commentMode === 'internal'
                    ? 'Hanya dapat dilihat oleh sesama agent & lead'
                    : 'Akan mengirimkan notifikasi ke pemohon'}
                </span>
              </CardHeader>

              <CardContent>
                <form onSubmit={handleSendComment} className="flex flex-col gap-3">
                  <Textarea
                    value={commentBody}
                    onChange={(e) => setCommentBody(e.target.value)}
                    placeholder={
                      commentMode === 'internal'
                        ? 'Tulis investigasi teknis, koordinasi internal, atau catatan eskalasi...'
                        : 'Tulis balasan atau solusi yang akan dilihat oleh pemohon...'
                    }
                    rows={3}
                    className={
                      commentMode === 'internal'
                        ? 'border-note-border bg-note text-fg focus-visible:border-amber-500'
                        : ''
                    }
                    required
                  />

                  <div className="flex items-center justify-between">
                    <span className="text-muted text-xs">
                      {detail.firstResponseAt === null && commentMode === 'public'
                        ? 'Catatan: Balasan publik pertama akan menandai First Response tercapai.'
                        : ''}
                    </span>
                    <Button
                      type="submit"
                      variant={commentMode === 'internal' ? 'secondary' : 'primary'}
                      size="sm"
                      disabled={isSubmittingComment || !commentBody.trim()}
                      className="gap-1.5"
                    >
                      <Send className="size-3.5" />
                      <span>{isSubmittingComment ? 'Mengirim...' : 'Kirim Catatan'}</span>
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          ) : null}

          {/* Timeline aktivitas & komentar */}
          <div className="flex flex-col gap-3">
            <h2 className="text-muted text-sm font-semibold tracking-wider uppercase">
              Riwayat Aktivitas & Timeline
            </h2>
            <Timeline entries={detail.timeline} />
          </div>
        </div>

        {/* Kolom Kanan (Panel 320px): SLA, Klasifikasi, Penugasan, Requester Info */}
        <div className="flex flex-col gap-4">
          {/* 1. SLA Card */}
          <SlaCard
            response={detail.response}
            resolution={detail.resolution}
            policyName={detail.policyName}
            calendar={cal}
          />

          {/* 2. Klasifikasi & Override Card */}
          <Card className="shadow-xs">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-muted text-xs font-semibold tracking-wider uppercase">
                Klasifikasi & Prioritas
              </CardTitle>
              {isActive && canOverride ? (
                <button
                  type="button"
                  onClick={() => setOverrideOpen(true)}
                  className="text-accent flex items-center gap-1 text-xs font-medium hover:underline"
                >
                  <ShieldAlert className="size-3.5" />
                  <span>Override</span>
                </button>
              ) : null}
            </CardHeader>
            <CardContent className="flex flex-col gap-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted">Prioritas:</span>
                <div className="flex items-center gap-1.5">
                  <PriorityBadge priority={detail.priority} showLabel />
                  {detail.priorityOverridden ? (
                    <span className="rounded bg-amber-500/10 px-1 text-[10px] font-bold text-amber-600 dark:text-amber-400">
                      Overridden
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted">Dampak (Impact):</span>
                <span className="text-fg font-semibold capitalize">{detail.impact}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted">Mendesak (Urgency):</span>
                <span className="text-fg font-semibold capitalize">{detail.urgency}</span>
              </div>

              {isActive ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setClassifyOpen(true)}
                  className="text-muted hover:text-fg mt-1 w-full text-xs"
                >
                  <Edit2 className="mr-1 size-3" /> Ubah Dampak / Urgensi
                </Button>
              ) : null}
            </CardContent>
          </Card>

          {/* 3. Penugasan & Tim Card (ADR-008 Option B) */}
          <Card className="shadow-xs">
            <CardHeader className="pb-2">
              <CardTitle className="text-muted text-xs font-semibold tracking-wider uppercase">
                Penugasan & Tim
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-xs">
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-muted">Tim Bertugas:</span>
                  <span className="text-fg font-semibold">{detail.team?.name ?? '—'}</span>
                </div>
                {isActive && otherTeams.length > 0 && (inTeam || canManageAssignment) ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEscalateTeamId('');
                      setEscalateNote('');
                      setDialogError(null);
                      setEscalateOpen(true);
                    }}
                    disabled={isProcessing}
                    className="text-muted hover:text-fg h-7 w-full justify-center text-xs"
                  >
                    <ArrowRightLeft className="mr-1.5 size-3.5" /> Eskalasi / Pindah Tim
                  </Button>
                ) : null}
              </div>

              <div className="border-border flex flex-col gap-2 border-t pt-2">
                {canManageAssignment ? (
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-muted">Assignee:</label>
                      <span className="text-accent text-[10px] font-medium">Mode Lead/Admin</span>
                    </div>
                    <NativeSelect
                      value={detail.assignee?.id ?? ''}
                      onChange={(e) => handleAssign(e.target.value || null)}
                      disabled={isProcessing || !isActive}
                      className="h-8 text-xs"
                    >
                      <option value="">-- Belum Ditugaskan (Unassigned) --</option>
                      {availableAssignees.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} ({a.teamName}) · {a.activeLoad} tiket
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-muted">Assignee:</span>
                      {detail.assignee ? (
                        <span className="text-fg flex items-center gap-1.5 font-semibold">
                          <User className="text-muted size-3.5" />
                          {detail.assignee.name}
                          {isAssignedToMe ? (
                            <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                              Anda
                            </span>
                          ) : null}
                        </span>
                      ) : (
                        <span className="text-muted italic">Belum Ditugaskan</span>
                      )}
                    </div>

                    {isActive ? (
                      <div className="pt-1">
                        {isUnassigned && inTeam ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={isProcessing}
                            onClick={() => handleAssign(user.id)}
                            className="bg-accent/10 text-accent hover:bg-accent/20 border-accent/20 w-full text-xs font-medium"
                          >
                            <UserCheck className="mr-1.5 size-3.5" /> Ambil Tiket Ini (Assign to Me)
                          </Button>
                        ) : null}

                        {isUnassigned && !inTeam ? (
                          <div className="bg-surface-2 text-muted flex items-start gap-1.5 rounded p-2 text-[11px]">
                            <Lock className="mt-0.5 size-3.5 shrink-0" />
                            <span>Tiket berada di luar tim Anda ({detail.team?.name ?? '—'}).</span>
                          </div>
                        ) : null}

                        {isAssignedToMe ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={isProcessing}
                            onClick={() => handleAssign(null)}
                            className="text-muted hover:text-danger w-full text-xs"
                          >
                            <UserMinus className="mr-1.5 size-3.5" /> Lepas Tiket (Unassign)
                          </Button>
                        ) : null}

                        {!isUnassigned && !isAssignedToMe ? (
                          <div className="bg-surface-2 text-muted flex items-start gap-1.5 rounded p-2 text-[11px]">
                            <Lock className="mt-0.5 size-3.5 shrink-0" />
                            <span>
                              Hanya Team Lead / Admin yang dapat memindahkan tiket milik staf lain.
                            </span>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* 4. Requester Info Card */}
          <Card className="shadow-xs">
            <CardHeader className="pb-2">
              <CardTitle className="text-muted text-xs font-semibold tracking-wider uppercase">
                Informasi Pemohon
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-xs">
              <div className="flex items-center gap-2">
                <User className="text-muted size-4" />
                <span className="text-fg font-bold">{detail.requesterInfo.name}</span>
              </div>
              <p className="text-muted">{detail.requesterInfo.email}</p>
              <div className="border-border text-muted flex items-center justify-between border-t pt-1">
                <span>Departemen:</span>
                <span className="text-fg font-semibold">{detail.requesterInfo.department}</span>
              </div>
              <div className="text-muted flex items-center justify-between">
                <span>Tiket Aktif:</span>
                <span className="text-accent font-mono font-semibold">
                  {detail.requesterInfo.openTickets} tiket
                </span>
              </div>
            </CardContent>
          </Card>

          {/* 5. Related Tickets */}
          {detail.related.length > 0 ? (
            <Card className="shadow-xs">
              <CardHeader className="pb-2">
                <CardTitle className="text-muted text-xs font-semibold tracking-wider uppercase">
                  Tiket Terkait (Kategori Sama)
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-xs">
                {detail.related.map((rel) => (
                  <Link
                    key={rel.number}
                    href={`/tickets/${rel.number}`}
                    className="hover:bg-surface-2 flex items-center justify-between rounded p-1.5 transition-colors"
                  >
                    <span className="text-accent font-mono font-bold">{rel.number}</span>
                    <span className="text-muted max-w-[150px] truncate">{rel.title}</span>
                    <StatusPill status={rel.status} mode="agent" />
                  </Link>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>

      {/* DIALOG PENDING */}
      <Dialog open={pendingOpen} onOpenChange={setPendingOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Jeda Penghitungan SLA (Pending)</DialogTitle>
            <DialogDescription>
              Pilih alasan penundaan. Penghitungan SLA resolution akan otomatis dijeda.
            </DialogDescription>
          </DialogHeader>

          {dialogError ? (
            <div className="border-danger/30 bg-danger/10 text-danger rounded border p-2 text-xs">
              {dialogError}
            </div>
          ) : null}

          <div className="flex flex-col gap-3 py-2">
            <Field label="Alasan Penundaan" htmlFor="pending-reason" required>
              <NativeSelect
                id="pending-reason"
                value={pendingReason}
                onChange={(e) => setPendingReason(e.target.value as PendingReason)}
              >
                <option value="awaiting_user">Menunggu Jawaban / Konfirmasi User</option>
                <option value="awaiting_vendor">Menunggu Dukungan Pihak Ketiga / Vendor</option>
                <option value="awaiting_change">Menunggu Rilis Perubahan (Change Request)</option>
                <option value="scheduled">Terjadwal untuk Dikerjakan Nanti</option>
              </NativeSelect>
            </Field>
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={() => setPendingOpen(false)}>
              Batal
            </Button>
            <Button variant="primary" disabled={isProcessing} onClick={handleSubmitPending}>
              {isProcessing ? 'Menyimpan...' : 'Terapkan Status Pending'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DIALOG RESOLVE */}
      <Dialog open={resolveOpen} onOpenChange={setResolveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Selesaikan Tiket (Resolve)</DialogTitle>
            <DialogDescription>
              Catat kode resolusi dan penjelasan teknis solusi untuk pemohon.
            </DialogDescription>
          </DialogHeader>

          {dialogError ? (
            <div className="border-danger/30 bg-danger/10 text-danger rounded border p-2 text-xs">
              {dialogError}
            </div>
          ) : null}

          <div className="flex flex-col gap-3 py-2">
            <Field label="Kode Resolusi" htmlFor="res-code" required>
              <NativeSelect
                id="res-code"
                value={resolutionCode}
                onChange={(e) => setResolutionCode(e.target.value as ResolutionCode)}
              >
                <option value="fixed">Fixed (Masalah Terselesaikan Tuntas)</option>
                <option value="workaround">Workaround (Solusi Sementara Diterapkan)</option>
                <option value="user_error">User Error (Panduan Diberikan ke Pemohon)</option>
                <option value="fulfilled">Fulfilled (Permintaan Layanan Dipenuhi)</option>
                <option value="duplicate">Duplicate (Duplikasi Tiket Lain)</option>
                <option value="no_fault_found">No Fault Found (Tidak Ditemukan Masalah)</option>
              </NativeSelect>
            </Field>

            <Field label="Catatan Solusi / Penyelesaian" htmlFor="res-notes" required>
              <Textarea
                id="res-notes"
                rows={3}
                value={resolutionNotes}
                onChange={(e) => setResolutionNotes(e.target.value)}
                placeholder="Jelaskan tindakan yang dilakukan untuk menyelesaikan kendala ini..."
                required
              />
            </Field>
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={() => setResolveOpen(false)}>
              Batal
            </Button>
            <Button
              variant="primary"
              disabled={isProcessing}
              onClick={handleSubmitResolve}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {isProcessing ? 'Menyelesaikan...' : 'Simpan & Resolve Tiket'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DIALOG CANCEL */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Batalkan Tiket</DialogTitle>
            <DialogDescription>
              Alasan pembatalan wajib dicatat dalam audit trail sistem.
            </DialogDescription>
          </DialogHeader>

          {dialogError ? (
            <div className="border-danger/30 bg-danger/10 text-danger rounded border p-2 text-xs">
              {dialogError}
            </div>
          ) : null}

          <div className="flex flex-col gap-3 py-2">
            <Field label="Alasan Pembatalan" htmlFor="cancel-reason" required>
              <Textarea
                id="cancel-reason"
                rows={3}
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Mengapa tiket ini dibatalkan?..."
                required
              />
            </Field>
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={() => setCancelOpen(false)}>
              Kembali
            </Button>
            <Button variant="danger" disabled={isProcessing} onClick={handleSubmitCancel}>
              {isProcessing ? 'Membatalkan...' : 'Konfirmasi Batalkan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DIALOG OVERRIDE PRIORITAS */}
      <Dialog open={overrideOpen} onOpenChange={setOverrideOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Override Prioritas ITIL</DialogTitle>
            <DialogDescription>
              Khusus Team Lead / Admin. Perubahan akan menghitung ulang (rebaseline) batas waktu SLA
              tiket.
            </DialogDescription>
          </DialogHeader>

          {dialogError ? (
            <div className="border-danger/30 bg-danger/10 text-danger rounded border p-2 text-xs">
              {dialogError}
            </div>
          ) : null}

          <div className="flex flex-col gap-3 py-2">
            <Field label="Prioritas Baru" htmlFor="override-prio" required>
              <NativeSelect
                id="override-prio"
                value={overridePriority}
                onChange={(e) => setOverridePriority(e.target.value as Priority)}
              >
                <option value="P1">P1 — Critical (24x7, Response 15m, Res 4j)</option>
                <option value="P2">P2 — High (Jam kerja, Response 30m, Res 8j)</option>
                <option value="P3">P3 — Medium (Jam kerja, Response 4j, Res 3 hari)</option>
                <option value="P4">P4 — Low (Jam kerja, Response 8j, Res 5 hari)</option>
              </NativeSelect>
            </Field>

            <Field
              label="Alasan Override (Wajib Minimal 10 Karakter)"
              htmlFor="override-reason"
              hint="Catatan ini dicatat permanen dalam audit trail tiket_events."
              required
            >
              <Textarea
                id="override-reason"
                rows={3}
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="Contoh: Dampak meluas ke server database produksi cabang..."
                required
              />
            </Field>
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={() => setOverrideOpen(false)}>
              Batal
            </Button>
            <Button variant="primary" disabled={isProcessing} onClick={handleSubmitOverride}>
              {isProcessing ? 'Menyimpan...' : 'Override & Rebaseline SLA'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DIALOG UBAH KLASIFIKASI */}
      <Dialog open={classifyOpen} onOpenChange={setClassifyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ubah Klasifikasi Dampak & Urgensi</DialogTitle>
            <DialogDescription>
              Prioritas akan dihitung ulang secara otomatis berdasarkan matriks ITIL.
            </DialogDescription>
          </DialogHeader>

          {dialogError ? (
            <div className="border-danger/30 bg-danger/10 text-danger rounded border p-2 text-xs">
              {dialogError}
            </div>
          ) : null}

          <div className="flex flex-col gap-3 py-2">
            <Field label="Dampak (Impact)" htmlFor="impact-select" required>
              <NativeSelect
                id="impact-select"
                value={impact}
                onChange={(e) => setImpact(e.target.value as Impact)}
              >
                <option value="high">
                  High (Seluruh organisasi / layanan kritis / &gt;50 user)
                </option>
                <option value="medium">Medium (Satu departemen / 5–50 user)</option>
                <option value="low">Low (Satu user saja)</option>
              </NativeSelect>
            </Field>

            <Field label="Urgensi (Urgency)" htmlFor="urgency-select" required>
              <NativeSelect
                id="urgency-select"
                value={urgency}
                onChange={(e) => setUrgency(e.target.value as Urgency)}
              >
                <option value="high">High (Pekerjaan berhenti total)</option>
                <option value="medium">Medium (Bisa bekerja tapi terhambat)</option>
                <option value="low">Low (Tidak mendesak)</option>
              </NativeSelect>
            </Field>
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={() => setClassifyOpen(false)}>
              Batal
            </Button>
            <Button variant="primary" disabled={isProcessing} onClick={handleSubmitClassify}>
              {isProcessing ? 'Menyimpan...' : 'Perbarui Klasifikasi'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DIALOG ESKALASI TIM (ADR-008 Option B) */}
      <Dialog open={escalateOpen} onOpenChange={setEscalateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eskalasi Fungsional (Pindah Tim)</DialogTitle>
            <DialogDescription>
              Pindahkan penanganan tiket ke tim spesialis lain. Tiket akan berstatus Unassigned di
              tim baru dan alasan eskalasi wajib dicatat.
            </DialogDescription>
          </DialogHeader>

          {dialogError ? (
            <div className="border-danger/30 bg-danger/10 text-danger rounded border p-2 text-xs">
              {dialogError}
            </div>
          ) : null}

          <div className="flex flex-col gap-3 py-2">
            <Field label="Tim Tujuan Eskalasi" htmlFor="escalate-team" required>
              <NativeSelect
                id="escalate-team"
                value={escalateTeamId}
                onChange={(e) => setEscalateTeamId(e.target.value)}
              >
                <option value="">-- Pilih Tim Tujuan --</option>
                {otherTeams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} — {t.description}
                  </option>
                ))}
              </NativeSelect>
            </Field>

            <Field
              label="Alasan Eskalasi (Wajib Minimal 5 Karakter)"
              htmlFor="escalate-note"
              hint="Catatan ini dicatat permanen dalam audit trail tiket_events."
              required
            >
              <Textarea
                id="escalate-note"
                rows={3}
                value={escalateNote}
                onChange={(e) => setEscalateNote(e.target.value)}
                placeholder="Contoh: Kendala routing switch core memerlukan investigasi mendalam tim Network..."
                required
              />
            </Field>
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={() => setEscalateOpen(false)}>
              Batal
            </Button>
            <Button
              variant="primary"
              disabled={isProcessing || !escalateTeamId || escalateNote.trim().length < 5}
              onClick={handleSubmitEscalate}
            >
              {isProcessing ? 'Memproses...' : 'Konfirmasi Eskalasi'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
