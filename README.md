# Sigap — IT Service Desk

> **IT Service Desk berbasis praktik ITIL 4 dengan perhitungan SLA berbasis jam kerja (Asia/Jakarta), priority matrix otomatis, audit trail append-only, dan pencatatan deployment sebagai Change Request.**

[![Next.js](https://img.shields.io/badge/Next.js-15_(App_Router)-black?logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue?logo=typescript)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker)](https://www.docker.com/)
[![Tests](https://img.shields.io/badge/Vitest-unit_%2B_Postgres-green?logo=vitest)](https://vitest.dev/)
[![ITSM](https://img.shields.io/badge/ITSM-ITIL_4-orange)](#praktik-itsm-yang-diterapkan)
[![License](https://img.shields.io/badge/License-MIT-purple.svg)](LICENSE)

![Dashboard KPI Sigap](assets/screenshots/dashboard.png)

---

## Ikhtisar

Sigap adalah aplikasi IT Service Desk yang dibangun dengan Next.js 15 (App Router) dan TypeScript strict. Aplikasi ini mencakup portal requester untuk mengajukan tiket dari katalog layanan, workspace agent untuk menangani antrean tiket, serta dashboard KPI dan panel administrasi untuk lead dan admin. Logika inti seperti prioritas, perhitungan SLA, kalender kerja, dan transisi status berada di `src/domain/` sebagai fungsi murni yang diuji dengan unit test.

Data disimpan di **PostgreSQL 16**, yang menjadi *system of record*. Skema dikelola sebagai migrasi SQL biasa di `db/migrations/`. Keputusan desainnya dirangkum di bagian ADR-010 di bawah.

Proyek ini dibuat sebagai portofolio untuk mendemonstrasikan cara mengoperasikan layanan IT sesuai praktik ITIL 4 (Service Level Management, Incident Management, Service Request Management, Change Enablement, dan Continual Improvement), bukan sekadar aplikasi CRUD. Sasaran pembacanya adalah tim IT yang membutuhkan pelacakan SLA dan audit, serta reviewer yang ingin melihat bagaimana proses tersebut diterjemahkan ke dalam kode.

---

## Fitur Utama

**Requester (Portal)**
- Katalog layanan dan masalah IT yang berjenjang, dengan formulir dinamis (custom form fields) untuk setiap item katalog.
- Daftar tiket saya, komentar publik, serta konfirmasi solusi dan penilaian CSAT.

**Agent (Workspace)**
- Antrean tiket: Team Queue, My Tickets, Unassigned, At Risk (≥75%), Breached, dan Semua Tiket.
- Agent hanya dapat mengklaim atau melepas tiket miliknya sendiri (ADR-008). Perpindahan tim dilakukan lewat dialog Eskalasi Fungsional dengan catatan resmi.
- Balasan publik dan catatan internal yang tidak terlihat oleh requester.
- Perubahan status mengikuti workflow yang ditegakkan oleh domain (New, Assigned, In Progress, Pending, Resolved, Closed).

**Lead & Administrator**
- Reassign tiket tim, override prioritas dengan alasan, dan pemantauan SLA tim.
- Dashboard KPI: SLA compliance respons dan resolusi, MTTA, MTTR, backlog aktif, distribusi umur tiket, tren volume harian, dan CSAT.
- Pengaturan admin: Pengguna, Tim (termasuk kontrol Auto-Assign per tim), Katalog Layanan, SLA & Kalender (jam kerja dan hari libur), serta Status Sistem untuk memicu SLA tick secara manual dengan opsi time-travel.

**Domain & Keandalan**
- Priority matrix Impact × Urgency menghasilkan P1–P4.
- SLA dihitung pada jam kerja 08:00–17:00 WIB, dengan istirahat 12:00–13:00, akhir pekan, dan hari libur nasional dikecualikan. SLA dijeda saat tiket berstatus Pending.
- Snapshot kebijakan SLA disimpan per tiket, sehingga perubahan kebijakan tidak mengubah komitmen historis (ADR-002).
- Setiap perubahan tiket menambah baris pada `ticket_events`. Tabel ini bersifat append-only: trigger database menolak `UPDATE`, `DELETE`, dan `TRUNCATE` (ADR-003).
- Setiap mutasi disimpan ke Postgres dalam **satu transaksi**. Jika penyimpanan gagal, transaksi di-rollback dan state memori dimuat ulang dari database (ADR-010).
- Worker SLA memanggil endpoint tick setiap 60 detik untuk memproses peringatan, pelanggaran, dan auto-close.

### Praktik ITSM yang Diterapkan

| Praktik ITIL 4 | Fitur di Sigap | Lokasi Implementasi |
|---|---|---|
| Service Level Management | Target respons dan resolusi berbasis kalender jam kerja. SLA dijeda saat tiket Pending. | [`src/domain/sla.ts`](src/domain/sla.ts), [`src/domain/calendar.ts`](src/domain/calendar.ts) |
| Incident Management | Matriks prioritas otomatis (Impact × Urgency = P1–P4) dan guard transisi status. | [`src/domain/priority.ts`](src/domain/priority.ts), [`src/domain/workflow.ts`](src/domain/workflow.ts) |
| Service Request Management | Katalog layanan berjenjang dengan formulir dinamis per item katalog. | `src/app/(portal)/portal/new/` |
| Change Enablement | `scripts/deploy.sh` dirancang untuk mencatat setiap deployment sebagai Change Request (`CHG-xxxxxx`) berstatus `in_progress`, lalu `succeeded` atau `rolled_back`. Skrip ini belum pernah dijalankan end-to-end. | [`scripts/deploy.sh`](scripts/deploy.sh), [`src/app/api/changes/`](src/app/api/changes/) |
| Service Desk & Continual Improvement | Dashboard KPI dengan tren volume, SLA compliance per prioritas, aging backlog, MTTR, dan CSAT. | `src/app/(agent)/dashboard/`, [`src/server/queries/dashboard.ts`](src/server/queries/dashboard.ts) |
| Accountability & Auditability | Riwayat kejadian tiket (`ticket_events`) mencatat perubahan status, komentar, penugasan, eskalasi, dan override prioritas. Tabel ini dilindungi trigger database dari perubahan dan penghapusan. | [`db/migrations/0001_init.sql`](db/migrations/0001_init.sql), [`src/server/mock/ticket-engine.ts`](src/server/mock/ticket-engine.ts) |

---

## Screenshots

| | |
|---|---|
| ![Dashboard KPI](assets/screenshots/dashboard.png) | **Dashboard KPI (Admin)**: metrik SLA, MTTA, MTTR, backlog aktif, CSAT, dan tren volume tiket 30 hari. |
| ![Detail tiket di workspace agent](assets/screenshots/antrean.png) | **Workspace agent**: detail tiket dengan panel SLA per tahap, aksi Jeda (Pending), Selesaikan (Resolve), dan Batalkan, serta riwayat aktivitas. |
| ![Portal requester](assets/screenshots/portal.png) | **Portal requester**: tiket aktif milik pengguna dan katalog layanan serta masalah IT. |

---

## Tech Stack

| Lapisan | Teknologi |
|---|---|
| Framework | Next.js 15 (App Router), React 19, TypeScript (strict) |
| UI | Tailwind CSS 4, Radix UI, lucide-react, TanStack Table, Recharts, sonner, next-themes |
| Validasi | Zod 4 |
| Data | PostgreSQL 16 (system of record) dengan driver `pg`; skema di `db/migrations/*.sql` |
| Read model | Store in-memory per proses web, dimuat dari Postgres saat boot dan diperbarui secara write-through |
| Testing | Vitest 5, fast-check (property-based testing), tes integrasi Postgres (`tests/db/`), `@playwright/test` (belum ada spec) |
| Infrastruktur lokal | Docker multi-stage (node:22-alpine, non-root), Docker Compose |
| Package manager | pnpm 9.15.9 |

### Arsitektur

Postgres adalah sumber kebenaran. Proses web menyimpan salinan data di memori (*read model*) agar pembacaan tetap sinkron dan cepat, lalu menulis setiap perubahan kembali ke Postgres dalam satu transaksi.

```mermaid
flowchart TD
    subgraph Client ["Browser"]
        U1["Portal Requester (/portal)"]
        U2["Workspace Agent (/queue, /tickets)"]
        U3["Dashboard & Admin (/dashboard, /admin)"]
    end

    subgraph AppServer ["Aplikasi Next.js 15 (Container web, satu writer)"]
        MW["Middleware (cookie session & guard rute)"]
        SA["Server Actions (validasi Zod)"]
        API["API Routes (/api/health, /api/changes, /api/worker/tick, /api/search)"]
        DE["Domain Core (priority, SLA, calendar, workflow)"]
        GW["Read model in-memory (getStore)<br/>write-through: persistStore()"]
    end

    subgraph Background ["Worker (Container worker)"]
        WRK["scripts/worker.js<br/>memanggil tick setiap 60 detik"]
    end

    subgraph Data ["Data (Container db)"]
        PG[("PostgreSQL 16<br/>system of record<br/>+ trigger append-only ticket_events")]
    end

    Client --> MW
    MW --> SA
    MW --> API
    SA --> DE
    SA --> GW
    API --> DE
    API --> GW
    WRK -->|POST /api/worker/tick| API
    GW -->|"boot: migrasi + hydrate / seed"| PG
    GW -->|"mutasi: satu transaksi"| PG
```

Alur singkat:
1. **Boot.** Container `migrate` menjalankan `scripts/migrate.js` (migrasi SQL, dikunci advisory lock). Container `web` mulai setelah migrasi selesai, memastikan migrasi, lalu memuat state dari Postgres. Jika tabel masih kosong, web membangun data demo dan menyimpannya ke database.
2. **Baca.** Halaman dan server action membaca dari read model di memori, tanpa query per request.
3. **Tulis.** Setiap mutasi diikuti penyimpanan perubahan ke Postgres dalam satu transaksi. Jika gagal, transaksi di-rollback dan memori dimuat ulang dari database, sehingga memori tidak pernah menyimpang dari data yang tersimpan.
4. **Worker.** Container `worker` hanya memanggil `POST /api/worker/tick` pada web. Hanya proses web yang menulis ke database.


### Keputusan Arsitektur Utama (ADR)

Beberapa keputusan utama:

* **ADR-001: Worker periodik, bukan timer per tiket.** Target SLA disimpan sebagai timestamp absolut (`due_at`, `warn_at`) berbasis kalender kerja, sehingga worker dapat memproses tiket yang jatuh tempo tanpa bergantung pada timer in-memory.
* **ADR-002: Snapshot SLA policy per tiket.** Target SLA dan kalender disalin saat tiket dibuat, sehingga perubahan kebijakan oleh admin tidak mengubah data historis.
* **ADR-003: Audit trail append-only.** Riwayat `ticket_events` tidak pernah di-UPDATE atau di-DELETE. Aturan ini ditegakkan oleh trigger database (`ticket_events_no_update_delete`, `ticket_events_no_truncate`), bukan hanya oleh kode aplikasi.
* **ADR-005: Mock data gateway in-memory.** Keputusan awal. Sejak ADR-010, runtime memakai Postgres; mode tanpa `DATABASE_URL` (tes unit dan `next build`) tetap berjalan dengan store in-memory.
* **ADR-008: Aturan penugasan tiket yang ketat.** Agent hanya dapat mengklaim atau melepas tiket miliknya sendiri. Team Lead dan Administrator memiliki hak intervensi penuh.
* **ADR-009: Simulasi worker dan time-travel.** Halaman Status Sistem di panel admin menyediakan pemicu SLA tick manual dengan opsi maju 1 jam, 1 hari, atau 3 hari kerja untuk melihat efek warning, breach, dan auto-close.
* **ADR-010: PostgreSQL sebagai system of record dengan read model write-through.** Menggantikan ADR-005 untuk runtime. Tradeoff terhadap repository yang melakukan query per request dijelaskan di sana.

---

## Memulai

### Menjalankan dengan Docker (direkomendasikan)

Prasyarat: Docker Desktop (Windows/macOS) atau Docker Engine dengan Docker Compose v2. Tidak diperlukan instalasi Node.js, pnpm, maupun PostgreSQL di mesin lokal.

```bash
git clone https://github.com/<username>/<repo>.git
cd <repo>
docker compose up -d --build
```

Buka [http://localhost:3000](http://localhost:3000). Aplikasi berisi data demo 90 hari yang dibuat pada boot pertama, lalu disimpan di volume Postgres. Restart container tidak membuat data demo baru.

Pemeriksaan kesehatan:

```bash
curl http://localhost:3000/api/health
```

`/api/health` mengembalikan HTTP 503 bila database tidak dapat dijangkau.

Menghentikan dan menghapus stack:

```bash
docker compose down        # hentikan container; data Postgres tetap ada di volume pgdata
docker compose down -v     # hentikan dan hapus volume (data Postgres dan MinIO); boot berikutnya seed ulang
```

#### Cara memverifikasi bahwa data benar-benar tersimpan

Langkah ini dapat dilakukan reviewer tanpa Node atau pnpm:

1. Jalankan `docker compose up -d --build`, lalu buka http://localhost:3000.
2. Login sebagai requester (`user@sigap.demo` / `Demo1234!`), lalu buat satu tiket dari katalog. Catat nomor tiketnya.
3. Restart web: `docker compose restart web`. Tunggu sampai `curl http://localhost:3000/api/health` kembali 200.
4. Buka kembali tiket tersebut. Tiket harus tetap ada, dengan riwayat kejadiannya.
5. Buka psql di container database:
   ```bash
   make psql                                # atau: docker compose exec db psql -U postgres -d sigap
   ```
   Lalu jalankan contoh query berikut:
   ```sql
   SELECT number, status FROM tickets ORDER BY created_at DESC LIMIT 5;
   SELECT type, data->>'note' FROM ticket_events ORDER BY created_at DESC LIMIT 5;
   ```
6. Uji audit trail append-only. Perintah ini harus gagal dengan pesan `ticket_events is append-only`:
   ```sql
   UPDATE ticket_events SET type = type WHERE id = (SELECT id FROM ticket_events LIMIT 1);
   ```
   Keluar dari psql dengan `\q`.

#### Port dan layanan lokal

| Layanan | URL Host | Keterangan |
|---|---|---|
| Sigap Web App | [http://localhost:3000](http://localhost:3000) | Aplikasi Next.js 15 (output standalone) |
| Mailpit (web inbox) | [http://localhost:8025](http://localhost:8025) | Disediakan. Aplikasi belum mengirim email ke Mailpit. |
| MinIO Console | [http://localhost:9001](http://localhost:9001) | Disediakan. Kredensial default `minioadmin` / `minioadmin`. Aplikasi belum menyimpan lampiran ke MinIO. |
| PostgreSQL 16 | Tidak diekspos ke host | Di jaringan Compose (`db:5432`). Akses lewat `make psql`. |

Port host dapat diubah lewat variabel lingkungan. Contoh di Linux/macOS atau Git Bash:

```bash
SIGAP_PORT=3100 docker compose up -d
# buka http://localhost:3100
```

Di PowerShell:

```powershell
$env:SIGAP_PORT = "3100"
docker compose up -d
```

#### Variabel lingkungan

Nilai default sudah tersedia di `docker-compose.yml`, sehingga file `.env` bersifat opsional. Daftar variabel beserta nilai default ada di [`.env.example`](.env.example). Variabel yang dibaca oleh kode aplikasi:

* `DATABASE_URL`: koneksi Postgres. Bila diset, web memakai Postgres sebagai system of record.
* `SIGAP_WEB_URL`: alamat web yang dipanggil oleh worker.
* `CHANGE_WEBHOOK_TOKEN`: token Bearer untuk endpoint `/api/changes`.
* `APP_VERSION`: versi yang dilaporkan oleh `/api/health`.

Variabel lain di Compose (misalnya `AUTH_SECRET`, `DEMO_MODE`, dan konfigurasi MinIO/Mailpit) sudah disiapkan, tetapi belum dibaca oleh kode.

### Akun Demo

Di halaman login (`/login`) tersedia panel **Pilih Akun Demo (1-Click Login)**. Email dan password berikut juga dapat dipakai pada form login. Password demo bersifat publik dan hanya untuk evaluasi lokal.

| Peran | Email | Password | Hak Akses Utama |
|---|---|---|---|
| Requester (Karyawan) | `user@sigap.demo` | `Demo1234!` | Mengajukan tiket dari katalog, melacak progres, komentar publik, konfirmasi solusi dan CSAT |
| Agent L1 (Staf IT) | `agent@sigap.demo` | `Demo1234!` | Antrean tiket, menangani insiden, catatan internal, claim tiket, eskalasi fungsional |
| Team Lead (Supervisor) | `lead@sigap.demo` | `Demo1234!` | Reassign tiket tim, override prioritas, memantau SLA tim, eskalasi hierarkis |
| Administrator | `admin@sigap.demo` | `Demo1234!` | Konfigurasi sistem: Pengguna, Tim, Katalog Layanan, SLA & Kalender, Status Sistem |

Catatan: login melalui form email memverifikasi email dan password. Password disimpan sebagai hash scrypt per-user. Ini hanya akun demo, bukan autentikasi produksi.

Alur uji coba singkat (sekitar 3 menit):
1. **Requester** (`user@sigap.demo`): buka Portal, pilih layanan *Reset password* atau *Akses VPN*, lalu kirim tiket.
2. **Agent L1** (`agent@sigap.demo`): buka **Team Queue** atau **Unassigned**, ambil tiket yang baru dibuat, ubah status ke *In Progress*, lalu selesaikan (*Resolve*) dengan kode resolusi.
3. **Admin** (`admin@sigap.demo`): buka **Dashboard** untuk melihat SLA compliance, MTTR, dan tren insiden, atau buka **Admin > Status Sistem** untuk memicu SLA tick dengan time-travel.

### Pengembangan Lokal tanpa Docker

Prasyarat:
* Node.js >= 20.18
* pnpm 9 (versi yang dikunci: 9.15.9)

```bash
# 1. Pasang dependensi
pnpm install

# 2. (Opsional) jalankan PostgreSQL dan layanan pendukung, lalu hubungkan aplikasi ke Postgres
docker compose -f docker-compose.dev.yml up -d
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/sigap   # PowerShell: $env:DATABASE_URL = "..."

# 3. Jalankan development server
pnpm dev
```

Tanpa `DATABASE_URL`, aplikasi berjalan dengan store in-memory yang diisi data demo, seperti sebelum ADR-010. Mode ini dipakai oleh tes unit dan `next build`.

### Shortcut Makefile

Pengguna Linux, macOS, atau Windows dengan `make` dapat memakai target berikut:

```bash
make up        # docker compose up -d lalu menunggu /api/health
make up-build  # build ulang image lokal lalu jalankan
make down      # hentikan container
make reset     # hapus volume lalu jalankan ulang (data demo baru)
make logs      # log container web dan worker
make psql      # psql interaktif ke database sigap di container db
make test      # lint, typecheck, dan unit test
make test-db   # tes integrasi Postgres dari host (database sigap_test di Postgres dev)
make test-docker  # semua tes di dalam container (sama dengan perintah docker compose di bawah)
make deploy VERSION=v1.0.0   # jalankan scripts/deploy.sh (belum pernah dijalankan end-to-end)
make dev       # docker compose dev + pnpm dev
```

Tanpa `make`, jalankan padanan perintah `docker compose` di atas secara langsung.

---

## Testing & Kualitas Kode

Tes dijalankan dengan Docker, sehingga tidak perlu Node atau pnpm di mesin lokal:

```bash
docker compose --profile test run --rm test
```

Perintah ini membangun target `builder` (berisi dev dependencies), membuat database `sigap_test` di Postgres compose bila belum ada, lalu menjalankan seluruh tes: unit test dan tes integrasi Postgres di `tests/db/`. Database `sigap` tidak pernah dipakai untuk tes destruktif.

Tes dari host (membutuhkan Node 20.18+ dan pnpm 9.15.9):

```bash
pnpm test            # Vitest: unit dan integration test (tanpa Postgres)
pnpm test:db         # Vitest: tes integrasi Postgres (butuh TEST_DATABASE_URL)
pnpm test:coverage   # Vitest dengan laporan coverage (v8)
pnpm typecheck       # tsc --noEmit
pnpm lint            # next lint + prettier --check
pnpm format          # prettier --write
```

Hasil terakhir yang terverifikasi:
* `pnpm test`: 212 test lulus (17 file; suite Postgres dilewati otomatis tanpa `TEST_DATABASE_URL`). Diverifikasi 1 November 2026.
* `pnpm test:db`: 15 test integrasi PostgreSQL lulus (7 file). `docker compose --profile test run --rm test` menjalankan keduanya: 227/227 lulus.
* `pnpm typecheck`: lihat hasil `pnpm typecheck`.

---

## Struktur Proyek

```
.
├── db/
│   └── migrations/        # migrasi SQL (0001_init.sql: skema lengkap)
├── assets/
│   └── screenshots/       # tangkapan layar untuk README
├── scripts/
│   ├── migrate.js         # menerapkan migrasi SQL (advisory lock, satu transaksi per file)
│   ├── seed.js            # helper: --if-empty hanya melaporkan status data (seed dilakukan web saat boot)
│   ├── worker.js          # worker SLA: memanggil /api/worker/tick setiap 60 detik
│   ├── deploy.sh          # deploy lokal dengan pencatatan Change dan rollback
│   ├── backup.sh          # pg_dump database sigap ke ./backups
│   └── restore.sh         # pemulihan dari file pg_dump
├── src/
│   ├── app/               # Next.js App Router: (auth), (portal), (agent), api/
│   ├── components/        # komponen UI, itsm, dan layout
│   ├── domain/            # logika murni: priority, sla, calendar, workflow, types
│   ├── lib/               # utilitas (format, views)
│   ├── middleware.ts      # guard rute dan autentikasi
│   ├── server/db/         # koneksi pg, migrasi, mapping tabel, hydrate/persist
│   └── server/            # server actions, queries, auth, dan read model (mock store)
├── tests/
│   ├── unit/              # Vitest unit test
│   ├── integration/       # Vitest integration test
│   └── db/                # tes integrasi Postgres (aktif bila TEST_DATABASE_URL diset)
├── Dockerfile
├── docker-compose.yml     # stack lengkap (db, web, worker, migrate, layanan pendukung, profil test)
├── docker-compose.dev.yml # layanan pendukung untuk pengembangan
├── Makefile
└── .env.example
```

---
