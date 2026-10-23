# Changelog

Semua perubahan pada proyek **Sigap** dicatat di dokumen ini berdasarkan panduan [Keep a Changelog](https://keepachangelog.com/id/1.0.0/).

## [Unreleased] - 2026-10-23

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
