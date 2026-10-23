'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Check, CheckCircle2, MessageSquare, RotateCcw, Send, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/input';
import {
  addCommentAction,
  submitCsatAction,
  transitionTicketAction,
} from '@/server/actions/tickets';
import type { TicketDetail } from '@/lib/views';

interface DetailClientProps {
  detail: TicketDetail;
}

export function DetailClient({ detail }: DetailClientProps) {
  const router = useRouter();
  const [commentBody, setCommentBody] = React.useState('');
  const [isSubmittingComment, setIsSubmittingComment] = React.useState(false);

  // Reopen modal / state
  const [reopenReason, setReopenReason] = React.useState('');
  const [showReopenBox, setShowReopenBox] = React.useState(false);
  const [isProcessingStatus, setIsProcessingStatus] = React.useState(false);

  // CSAT state
  const [csatScore, setCsatScore] = React.useState(5);
  const [csatComment, setCsatComment] = React.useState('');
  const [isSubmittingCsat, setIsSubmittingCsat] = React.useState(false);

  const handleSendComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentBody.trim()) return;
    setIsSubmittingComment(true);
    try {
      await addCommentAction(detail.id, commentBody.trim(), 'public');
      setCommentBody('');
      router.refresh();
    } finally {
      setIsSubmittingComment(false);
    }
  };

  const handleConfirmClose = async () => {
    setIsProcessingStatus(true);
    try {
      await transitionTicketAction({
        ticketId: detail.id,
        to: 'closed',
      });
      router.refresh();
    } finally {
      setIsProcessingStatus(false);
    }
  };

  const handleReopen = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reopenReason.trim()) return;
    setIsProcessingStatus(true);
    try {
      await transitionTicketAction({
        ticketId: detail.id,
        to: 'in_progress',
        reopenReason: reopenReason.trim(),
      });
      setShowReopenBox(false);
      setReopenReason('');
      router.refresh();
    } finally {
      setIsProcessingStatus(false);
    }
  };

  const handleSubmitCsat = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingCsat(true);
    try {
      await submitCsatAction(detail.id, csatScore, csatComment.trim());
      router.refresh();
    } finally {
      setIsSubmittingCsat(false);
    }
  };

  const isResolved = detail.status === 'resolved';
  const isClosed = detail.status === 'closed';

  return (
    <div className="flex flex-col gap-6">
      {/* Banner Konfirmasi Selesai & Reopen jika status Resolved */}
      {isResolved ? (
        <Card className="border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-sm font-bold text-emerald-800 dark:text-emerald-300">
              <CheckCircle2 className="size-4 text-emerald-600" />
              <span>Tim Teknis Telah Menyelesaikan Kendala Anda</span>
            </CardTitle>
            <CardDescription className="text-xs text-emerald-700 dark:text-emerald-400">
              {detail.resolutionNotes
                ? `Catatan penyelesaian: "${detail.resolutionNotes}"`
                : 'Mohon konfirmasi jika masalah sudah tertangani dengan baik.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2 pt-2">
            <Button
              variant="primary"
              size="sm"
              disabled={isProcessingStatus}
              onClick={handleConfirmClose}
              className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
            >
              <Check className="size-4" />
              <span>Masalah Sudah Selesai</span>
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={isProcessingStatus}
              onClick={() => setShowReopenBox(!showReopenBox)}
              className="gap-1.5"
            >
              <RotateCcw className="size-3.5" />
              <span>Kendala Masih Terjadi (Buka Lagi)</span>
            </Button>

            {showReopenBox ? (
              <form
                onSubmit={handleReopen}
                className="mt-3 flex w-full flex-col gap-2 border-t border-emerald-200 pt-3 dark:border-emerald-800"
              >
                <Textarea
                  value={reopenReason}
                  onChange={(e) => setReopenReason(e.target.value)}
                  placeholder="Jelaskan kendala apa yang masih Anda alami..."
                  rows={2}
                  required
                />
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowReopenBox(false)}
                  >
                    Batal
                  </Button>
                  <Button
                    type="submit"
                    variant="danger"
                    size="sm"
                    disabled={isProcessingStatus || !reopenReason.trim()}
                  >
                    Kirim & Buka Kembali
                  </Button>
                </div>
              </form>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* Kartu Survei Kepuasan (CSAT) jika Resolved/Closed */}
      {isResolved || isClosed ? (
        <Card className="border-accent/30 bg-surface shadow-xs">
          <CardHeader className="pb-2">
            <CardTitle className="text-accent flex items-center gap-1.5 text-sm font-semibold">
              <Star className="fill-accent size-4" />
              <span>Survei Kepuasan Layanan (CSAT)</span>
            </CardTitle>
            <CardDescription className="text-xs">
              {detail.csat
                ? 'Terima kasih telah memberikan masukan atas penanganan tiket ini.'
                : 'Seberapa puas Anda dengan kecepatan dan solusi yang diberikan oleh tim kami?'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {detail.csat ? (
              <div className="bg-surface-2 flex flex-col gap-2 rounded-lg p-3">
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Star
                      key={star}
                      className={`size-4 ${
                        star <= detail.csat!.score
                          ? 'fill-amber-400 text-amber-400'
                          : 'text-border-strong'
                      }`}
                    />
                  ))}
                  <span className="text-fg ml-2 font-mono text-xs font-bold">
                    {detail.csat.score} dari 5 Bintang
                  </span>
                </div>
                {detail.csat.comment ? (
                  <p className="text-fg text-xs italic">&ldquo;{detail.csat.comment}&rdquo;</p>
                ) : null}
              </div>
            ) : (
              <form onSubmit={handleSubmitCsat} className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setCsatScore(star)}
                      className="p-1 transition-transform hover:scale-110"
                      title={`${star} Bintang`}
                    >
                      <Star
                        className={`size-6 ${
                          star <= csatScore
                            ? 'fill-amber-400 text-amber-400'
                            : 'text-border-strong hover:text-amber-300'
                        }`}
                      />
                    </button>
                  ))}
                  <span className="text-muted ml-2 text-xs font-medium">
                    (
                    {csatScore === 5
                      ? 'Sangat Puas'
                      : csatScore >= 3
                        ? 'Cukup Puas'
                        : 'Kurang Puas'}
                    )
                  </span>
                </div>

                <Textarea
                  value={csatComment}
                  onChange={(e) => setCsatComment(e.target.value)}
                  placeholder="Komentar atau saran tambahan (opsional)..."
                  rows={2}
                />

                <div className="flex justify-end">
                  <Button type="submit" variant="primary" size="sm" disabled={isSubmittingCsat}>
                    {isSubmittingCsat ? 'Mengirim...' : 'Kirim Penilaian'}
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* Kolom Balas Komentar Publik jika tiket belum final */}
      {!isClosed && detail.status !== 'cancelled' ? (
        <Card className="shadow-xs">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-sm font-semibold">
              <MessageSquare className="text-accent size-4" />
              <span>Kirim Pesan / Balasan ke Tim IT</span>
            </CardTitle>
            <CardDescription className="text-xs">
              Tambahkan informasi atau respon atas pertanyaan dari teknisi yang menangani.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSendComment} className="flex flex-col gap-3">
              <Textarea
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                placeholder="Tulis pesan atau jawaban Anda di sini..."
                rows={3}
                required
              />
              <div className="flex justify-end">
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={isSubmittingComment || !commentBody.trim()}
                  className="gap-1.5"
                >
                  <Send className="size-3.5" />
                  <span>{isSubmittingComment ? 'Mengirim...' : 'Kirim Balasan'}</span>
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
