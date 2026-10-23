import { requireUser } from '@/server/auth/session';
import { getAdminData } from '@/server/queries/admin';
import { AdminTabs } from './admin-tabs';

export default async function AdminPage() {
  await requireUser(['admin']);
  const data = getAdminData();

  return (
    <div className="flex max-w-6xl flex-col gap-6 p-4 sm:p-6">
      <div>
        <h1 className="text-fg text-xl font-bold tracking-tight">
          Administrasi & Pengaturan Sistem
        </h1>
        <p className="text-muted text-xs">
          Konfigurasi data master pengguna, penugasan tim, taksonomi kategori, katalog layanan, dan
          kebijakan SLA ITIL.
        </p>
      </div>

      <AdminTabs data={data} />
    </div>
  );
}
