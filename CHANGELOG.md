# Changelog

Semua perubahan pada proyek **Sigap** dicatat di dokumen ini berdasarkan panduan [Keep a Changelog](https://keepachangelog.com/id/1.0.0/).

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
  - `scripts/deploy.sh`: Script automated zero-downtime deployment lokal lengkap dengan pre-check, Change Request registration, snapshot backup, database migration, container swapping, health verification, dan automated rollback.
  - `scripts/backup.sh` & `scripts/restore.sh`: Script pencadangan dan pemulihan snapshot data.
  - `scripts/migrate.js` & `scripts/seed.js`: Runner migrasi dan seeding data demo relatif 90 hari.
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
