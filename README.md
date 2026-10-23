# Sigap — IT Service Desk (Spec Pack)

Paket instruksi untuk AI coding agent membangun **Sigap**: sistem helpdesk/ticketing dengan
SLA tracking, priority matrix, dashboard kinerja, dan CI/CD.

Fokus portofolio: **IT Service Management (ITSM)** berbasis praktik ITIL 4, bukan sekadar CRUD tiket.

**Mode: full lokal, tanpa biaya hosting.** Reviewer menjalankan seluruh sistem dengan
`docker compose up -d`. CI/CD memakai GitHub Actions + GitHub Container Registry (gratis untuk repo publik).

## Urutan baca untuk agent

| # | File | Isi |
|---|------|-----|
| 1 | `AGENTS.md` | Aturan kerja agent, workflow, Definition of Done. **Wajib dibaca pertama.** |
| 2 | `docs/PRD.md` | Masalah, persona, scope, user stories, acceptance criteria |
| 3 | `docs/ITSM.md` | Domain: tipe tiket, priority matrix, SLA, status lifecycle, eskalasi, metrik |
| 4 | `docs/ARCHITECTURE.md` | Tech stack, struktur folder, modul, worker SLA, API |
| 5 | `docs/DATA_MODEL.md` | Skema database lengkap + aturan integritas + seed |
| 6 | `docs/DESIGN.md` | Design system, layout, halaman, komponen, aksesibilitas |
| 7 | `docs/LOCAL_RUN.md` | Docker Compose untuk reviewer: satu perintah, data demo, Makefile |
| 8 | `docs/CICD.md` | CI, rilis image ke GHCR, deploy lokal dengan rollback |
| 9 | `docs/TESTING.md` | Strategi test, test wajib untuk logika SLA |
| 10 | `docs/ROADMAP.md` | Milestone + checklist task berurutan |
| 11 | `docs/PORTFOLIO.md` | Cara menampilkan proyek tanpa demo live |
| 12 | `docs/DECISIONS.md` | ADR awal; agent menambah keputusan baru di sini |

## Cara pakai

1. Taruh folder ini di root repo kosong (file `AGENTS.md` di root, sisanya di `docs/`).
2. Beri agent prompt awal:
   > Baca `AGENTS.md` lalu semua file di `docs/`. Kerjakan `docs/ROADMAP.md` mulai dari Milestone 0.
   > Setelah tiap milestone, update checklist dan berhenti untuk review.
3. Review tiap milestone sebelum lanjut.
