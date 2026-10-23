import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="bg-bg text-fg flex min-h-screen flex-col items-center justify-center p-4 text-center">
      <div className="bg-surface-2 text-muted mb-4 flex size-14 items-center justify-center rounded-2xl font-mono text-xl font-bold">
        404
      </div>
      <h1 className="text-fg text-xl font-bold">Halaman Tidak Ditemukan</h1>
      <p className="text-muted mt-2 max-w-sm text-xs">
        Halaman yang Anda tuju mungkin telah dipindahkan, nomor tiket tidak ditemukan, atau tautan
        tidak valid.
      </p>
      <div className="mt-6 flex items-center gap-3">
        <Button asChild variant="primary" size="sm">
          <Link href="/">Kembali ke Beranda</Link>
        </Button>
      </div>
    </div>
  );
}
