# Changelog

Semua perubahan pada proyek **Sigap** dicatat di dokumen ini berdasarkan panduan [Keep a Changelog](https://keepachangelog.com/id/1.0.0/).

## [Unreleased]

### Changed
- **PostgreSQL menjadi system of record** (ADR-010, menggantikan ADR-005 untuk runtime). Data disimpan di Postgres dan bertahan lewat `docker compose restart web` maupun `down`/`up`. Web memuat state saat boot, menyimpan setiap mutasi dalam satu transaksi, dan memuat ulang memori dari database setelah kegagalan. Mode tanpa `DATABASE_URL` tetap memakai store in-memory.
- `scripts/migrate.js` kini menerapkan migrasi SQL nyata dari `db/migrations/` (tabel `schema_migrations`, advisory lock 727001, satu transaksi per file, retry koneksi ±30 detik). Dockerfile menyalin `db/` ke image dan menyediakan driver `pg` untuk skrip.
- Seeding dilakukan web saat boot, hanya bila database kosong, dengan advisory lock 727002. `scripts/seed.js` menjadi helper: `--if-empty` hanya melaporkan jumlah tiket.
- `scripts/backup.sh` dan `scripts/restore.sh` memakai `pg_dump -Fc` dan `pg_restore` terhadap service `db`. Keduanya gagal dengan kode 1 bila container tidak berjalan (tidak ada lagi placeholder).
- Trigger database menolak UPDATE, DELETE, dan TRUNCATE pada `ticket_events` (`db/migrations/0001_init.sql`).
- `docker-compose.yml`: service `migrate` menjalankan `node scripts/migrate.js`. `web` menunggu migrasi selesai dan database sehat.
- `Dockerfile`: target `builder` berisi dev dependencies, `tests/`, dan `db/`. Target `tools` memasang `pg` yang dikunci (8.23.1) untuk skrip.

### Added
- Profil compose `test`: `docker compose --profile test run --rm test` menjalankan seluruh tes (unit dan integrasi Postgres) di container, dengan database `sigap_test`.
- Tes integrasi Postgres di `tests/db/` (aktif bila `TEST_DATABASE_URL` diset) dan script `pnpm test:db`.
- `Makefile`: `make psql`, `make test-db`, `make test-docker`.
- ADR-010: PostgreSQL sebagai system of record dengan read model write-through.

### Fixed
- Login email/password kini memverifikasi password. Hash scrypt dengan salt per-user disimpan di mock user (`src/server/auth/credentials.ts`). Email tidak terdaftar dan password salah menghasilkan pesan error yang sama. Tombol 1-Click Login memakai jalur verifikasi yang sama dengan password demo.
- `scripts/deploy.sh` menarik image dari `${SIGAP_IMAGE:-ghcr.io/sigap/sigap}`, sama dengan `docker-compose.yml` (sebelumnya `ghcr.io/antigravity/sigap`).
- `scripts/migrate.js` dan `scripts/seed.js` kini jelas berstatus **no-op** karena aplikasi memakai in-memory mock gateway (ADR-005). Keduanya tetap keluar dengan kode 0 agar service `migrate` di compose berjalan.
- Dokumentasi (`README.md`) kini membedakan fitur yang sudah ada dan yang masih planned. Dokumen yang sebelumnya mengklaim GHCR publishing, workflow CI, dan e2e kini ditandai sebagai planned.

### Removed
- Script `e2e` (`playwright test`) dari `package.json`. Konfigurasi dan spec Playwright belum ada.

### Tests
- Total 209 automated tests lulus 100% (termasuk 8 test baru untuk verifikasi password).

## [1.0.0] - 2026-11-01

### Added
- **Docker Containerization & Reviewer Stack**:
  - `Dockerfile`: Multi-stage build (deps, builder standalone, lightweight node:22-alpine runner non-root).
  - `docker-compose.yml`: Reviewer stack lengkap (PostgreSQL 16, MinIO object storage, MinIO Init, Mailpit, Migrate, Web Next.js 15, Worker) yang siap dijalankan dengan `docker compose up -d`.
  - `docker-compose.dev.yml`: Dependensi lokal terisolasi untuk proses development mandiri.
  - `.dockerignore` dan `.env.example`: Konfigurasi variabel lingkungan lokal aman dan siap pakai tanpa konfigurasi tambahan.
- **Worker & System API Routes**:
  - `scripts/worker.js`: Daemon background worker mandiri yang mengeksekusi pemeriksaan berkala SLA Tick dan auto-close tiket resolved > 3 hari setiap 60 detik.
  - `/api/health`: Healthcheck endpoint resmi untuk docker health monitoring dan pipeline CI.
  - `/api/worker/tick`: Endpoint pemrosesan worker periodik SLA & auto-close.
  - `/api/changes` & `/api/changes/[id]`: Endpoint manajemen Change Record terintegrasi (Bearer token authenticated).
- **Deployment & Lifecycle Automation**:
  - `scripts/deploy.sh`: Script deployment lokal dengan pre-check, Change Request registration, snapshot backup, database migration, container swapping, health verification, dan rollback (belum diuji end-to-end).
  - `scripts/backup.sh` & `scripts/restore.sh`: Script pencadangan dan pemulihan snapshot data.
  - `scripts/migrate.js` & `scripts/seed.js`: Placeholder no-op (lihat [Unreleased]). Data demo dibuat oleh mock gateway di memori.
  - `Makefile`: Shortcut praktis (`up`, `up-build`, `down`, `reset`, `logs`, `backup`, `restore`, `deploy`, `dev`, `test`, `lint`, `typecheck`).
- **Tests**:
  - `tests/integration/routes.test.ts`: Automated test suite untuk endpoint `/api/health`, `/api/worker/tick`, dan `/api/changes`.
  - Total 201 automated tests lulus 100%.

## [0.1.0] - 2026-10-23

### Added
- **Domain Logic (`src/domain/`)**:
  - `types.ts`: Domain models, enums (TicketType, Status, Priority, Impact, Urgency, Role).
  - `priority.ts`: Matriks prioritas ITIL (Impact × Urgency = Priority P1–P5) dengan override capability.
  - `calendar.ts`: Kalender jam kerja bisnis (`BusinessCalendar`) dengan dukungan zona waktu Asia/Jakarta, jam operasional fleksibel, dan daftar hari libur nasional.
  - `sla.ts`: Kalkulasi target SLA (Response & Resolution), penanganan status paused (`pending`), peringatan warning/breach, dan rekonsiliasi state.
  - `workflow.ts`: State machine transisi tiket (New → Assigned → In Progress → Pending → Resolved → Closed / Cancelled / Reopened) dan validasi transisi.
  - `server/auth/rbac.ts`: Model otorisasi berbasis peran (requester, agent, lead, admin) dan kepemilikan tiket/tim.
  - 188 unit & integration test komprehensif pada domain dan mock engine (`tests/unit/`, `tests/integration/`).
- **Mock Data Gateway (`src/server/mock/`)**:
  - `store.ts`: In-memory data store dengan seed otomatis 90 hari (~900 tiket, 49 users, 3 tim, 15 item katalog, SLA policies).
  - `ticket-engine.ts`: Engine mutasi tiket yang selalu mencatat `ticket_events` (audit trail append-only).
  - `session.ts`: Manajemen sesi cookie HTTP-only dengan fungsi utilitas `getSessionUser` dan `requireUser`.
  - `middleware.ts`: Proteksi route berbasis cookie sesi dengan auto-redirect ke login.
- **ITSM UI Primitives & Components (`src/components/`)**:
  - `src/components/ui/`: Button, Card, Controls (Checkbox, Switch), Dialog, Input, NativeSelect, Textarea, Menu (Dropdown, Popover).
  - `src/components/itsm/`: PriorityBadge, StatusPill, SlaIndicator, SlaProgress, SlaCard, Timeline audit trail, KpiTile, EmptyState.
  - `src/components/layout/`: ThemeToggle (dark/light mode), UserMenu, CommandMenu (⌘K global search), NotificationBell, AgentSidebar.
- **Pages & App Router (`src/app/`)**:
  - `(auth)/login`: Halaman login dengan 1-click fast switcher untuk 4 akun demo (Requester, Agent L1, Team Lead, Admin).
  - `(portal)`:
    - `/portal`: Dashboard katalog layanan pengguna mandiri dengan kategori dan quick search.
    - `/portal/new/[catalogId]`: Form dinamis pengajuan tiket layanan & insiden.
    - `/portal/tickets`: Daftar tiket aktif dan riwayat tiket pemohon.
    - `/portal/tickets/[number]`: Detail tiket pemohon dengan timeline, pengiriman komentar/lampiran, konfirmasi solusi, reopening, dan rating CSAT (1-5 bintang).
  - `(agent)`:
    - `/queue`: Meja kerja antrean tiket dengan 5 tab view standar ITSM, filter URL-synced, sorting SLA countdown, shortcut keyboard j/k, dan bulk assign.
    - `/tickets/[number]`: Meja kerja tiket detail agent dengan dual-tab composer (Public Reply / Internal Note), mutasi status (Pending, Resolve, Reopen, Cancel), transfer tim, override prioritas, dan card SLA visual.
    - `/dashboard`: Dasbor analitik KPI ITSM dengan grafik interaktif Recharts (Volume tren harian, SLA compliance per prioritas, distribusi umur tiket/aging, top kategori masalah, beban performa agent) beserta toggle accessible HTML table view.
    - `/notifications`: Pusat pemberitahuan lengkap dengan tab filter unread dan tombol tandai telah dibaca.
    - `/admin`: Panel konfigurasi sistem lengkap mencakup Users, Teams, Categories, Catalog Builder, SLA Policies, Business Calendar & Holidays, serta System Status dengan manual trigger SLA worker tick.
    - `/api/search`: Route handler pencarian cepat global tiket & katalog untuk modal ⌘K.
    - `not-found.tsx`: Halaman 404 terpadu.
