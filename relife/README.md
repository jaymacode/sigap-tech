# Relife — Sigap IT Service Desk (Zero-Docker Edition)

**Relife** adalah implementasi ulang aplikasi **Sigap IT Service Desk** dengan arsitektur ringan tanpa Docker: server HTTP & SSR HTML berjalan di **Bun + Hono**, penyimpanan persisten memakai **SQLite (`bun:sqlite`)**, dan antarmuka interaktif dibangun dengan **Vanilla HTML, CSS, dan ES Module JavaScript** tanpa framework frontend atau bundler terpisah.

## Ringkasan Stack & Arsitektur

- **Runtime & Server**: Bun + Hono (`src/index.ts`) — menyajikan rute SSR HTML, aset statis (`/public/app.css`, `/public/app.js`), dan REST API JSON (`/api/*`).
- **Database**: SQLite native via `bun:sqlite` (skema relasional + seed otomatis demo).
- **Frontend**: Server-rendered HTML dengan CSS variables (Light/Dark theme) di `public/app.css` dan satu modul interaktif `public/app.js` menggunakan native `<dialog>`, `<details>`, `fetch`, `URLSearchParams`, `localStorage`, dan rendering DOM aman (`createElement`/`textContent`).

## Menjalankan Aplikasi

```bash
cd relife
bun install
bun run dev
```

Perintah lainnya:

- `bun run start` — menjalankan server produksi
- `bun test` — menjalankan unit & integration tests
- `bun run typecheck` — memeriksa tipe TypeScript (`tsc --noEmit`)

## Akun Demo

Semua akun demo menggunakan kata sandi **`Demo1234!`**:

- **Requester**: `user@sigap.demo` — pemohon; membuat dan memantau tiket miliknya.
- **Anggota Tim IT** (role `agent`): `agent@sigap.demo` (Dimas Saputra) — mengambil dan mengerjakan tiket dari antrean Tim IT.
- **Head IT** (role `lead`): `lead@sigap.demo` (Rina Kusuma) — memimpin Tim IT, membagi/memindahkan tiket ke anggota, dan override prioritas.
- **Administrator**: `admin@sigap.demo` — mengelola pengguna, Tim IT (Head IT, anggota, auto-assign), SLA, dan katalog.

Organisasi hanya memiliki **satu Tim IT** (`team-it`): satu Head IT dan seluruh staf IT lainnya sebagai anggota (termasuk `bayu.santoso@sigap.demo` dan anggota demo lain). Semua kategori dirutekan ke Tim IT. Auto-assign nonaktif secara default sehingga Head IT yang membagi tiket; admin dapat mengaktifkannya di **Admin › Tim IT**. Database lama otomatis digabungkan ke Tim IT oleh migrasi `db/0003_single_team.sql`.

> Pengalih user cepat juga tersedia pada panel/header demo untuk berpindah peran dengan satu klik.

## Autentikasi: Demo (dev) & IMS (produksi)

Cookie sesi `sigap_session` berisi `<userId>.<HMAC-SHA256>` yang ditandatangani dengan `SESSION_SECRET`. Cookie tanpa tanda tangan atau yang diubah ditolak (user dianggap logout), dan setiap request mengecek ulang bahwa user masih ada dan aktif. Mengganti `SESSION_SECRET` membuat semua sesi lama tidak berlaku.

| Variabel | Default | Keterangan |
| --- | --- | --- |
| `AUTH_MODE` | `demo` | `demo`: login 1-klik, email + password, dan pengalih akun aktif. `ims`: semua itu dimatikan (endpoint 404), halaman login hanya menampilkan tombol **Masuk dengan akun perusahaan (IMS)** ke `/auth/ims/login`. Nilai lain membuat server menolak start. |
| `SESSION_SECRET` | rahasia dev bawaan (dengan peringatan di console) | Minimal 32 karakter. **Wajib** bila `NODE_ENV=production` atau `AUTH_MODE=ims`; tanpa itu server menolak start. Buat dengan mis. `openssl rand -base64 48`. |
| `NODE_ENV` | – | `production` menambahkan atribut `Secure` pada cookie (wajib HTTPS) dan mewajibkan `SESSION_SECRET`. |
| `IMS_ROLE_MAP` | kosong | Pemetaan grup IMS ke role, mis. `IT-HEAD:lead,IT-STAFF:agent,IT-ADMIN:admin`. Bila user ada di beberapa grup, role tertinggi dipakai. Bila diisi, IMS menjadi sumber kebenaran role (tanpa grup cocok = `requester`); bila kosong, user baru menjadi `requester` dan role user lama tetap dikelola Administrator. |

**Integrasi IMS** (`src/server/auth/ims.ts`): protokol IMS (OIDC/SAML/LDAP/REST) belum ditentukan. Modul ini mendefinisikan kontrak `ImsProvider` (`startLogin(c)` → URL redirect, `handleCallback(c)` → `ImsProfile { externalId, email, name, department, groups[] }`) dan `provisionUser()` yang meng-upsert user berdasarkan email (id lama dipertahankan, user nonaktif ditolak). Route `GET /auth/ims/login` dan `GET /auth/ims/callback` sudah terpasang; selama belum ada provider yang didaftarkan lewat `setImsProvider()`, keduanya menjawab **501 — Integrasi IMS belum dikonfigurasi**. User hasil IMS tidak punya password sehingga tidak bisa login lewat form email.

## Formulir IT Request (CTII)

Formulir pemohon di `/portal/new` mengikuti "IT CTII Internal Service Request Form":

1. **Service / Problem Related to** — pilih layanan dari katalog. Jika memilih "Others", kolom "Layanan Lainnya" wajib diisi (`service_other`).
2. **Service Request Type** — New Request, Enhancement, Problem, Access Rights, Data Extraction, atau Others (jika Others, isi `request_type_other`).
3. **Deskripsi** — judul, deskripsi, urgensi, dan lampiran.
4. **Acknowledge by HOD** — nama (`hod_name`) dan email (`hod_email`, divalidasi bila diisi) atasan.
5. **Konfirmasi Pemohon** — centang pernyataan pemohon (`requester_ack`).

Semua isian tersimpan di `formData` tiket dan tampil di detail tiket (portal dan agent). Validasi server pada `POST /api/tickets` mengembalikan 400 dengan pesan berbahasa Indonesia; nilai string di `formData` di-trim dan nilai kosong dibuang.

Deep link: `/portal/new?service=<catalogItemId>&type=<Service Request Type>` memilih layanan dan jenis permintaan secara otomatis, contoh `/portal/new?service=cat-item-network&type=Problem`.

## Database: SQLite (dev) & PostgreSQL (produksi)

Store aplikasi tetap in-memory; saat boot di-hydrate dari database, dan setiap perubahan ditulis sebagai diff per tabel dalam satu transaksi. Driver dipilih lewat env:

| Variabel | Nilai | Keterangan |
| --- | --- | --- |
| `DB_DRIVER` | `sqlite` (default) \| `postgres` | Nilai lain menggagalkan boot. |
| `DB_PATH` | path file, `:memory:`, atau `memory-only` | Hanya untuk SQLite. Default `data/sigap.db`; `memory-only` = tanpa persistensi. Diabaikan bila `DB_DRIVER=postgres`. |
| `DATABASE_URL` | `postgres://user:pass@host:5432/db` | Wajib bila `DB_DRIVER=postgres`. |
| `TEST_DATABASE_URL` | URL Postgres sekali pakai | Mengaktifkan `tests/postgres.test.ts` (tabel Sigap di DB itu **dihapus**). |

- Migrasi SQLite: `db/*.sql`. Migrasi PostgreSQL: `db/postgres/*.sql`. Keduanya dicatat di tabel `schema_migrations` dan dijalankan otomatis saat boot (Postgres: satu transaksi dengan advisory lock).
- Postgres yang kosong langsung di-seed ke kondisi Tim IT tunggal + katalog CTII, jadi migrasi data `0002`/`0003` (khusus SQLite lama) tidak diperlukan di sana.
- `ticket_events` append-only di kedua driver (trigger menolak UPDATE/DELETE, di Postgres juga TRUNCATE).
- `/api/health` melaporkan `database.driver`.

Mencoba Postgres secara lokal:

```bash
docker compose -f docker-compose.postgres.yml up -d
DB_DRIVER=postgres DATABASE_URL=postgres://sigap:sigap@localhost:5432/sigap bun run dev
TEST_DATABASE_URL=postgres://sigap:sigap@localhost:5432/sigap bun test tests/postgres.test.ts
```

Langkah cut-over SQLite → PostgreSQL:

1. Buat database PostgreSQL kosong dan user pemiliknya (butuh hak `CREATE` + kepemilikan tabel; reset demo memakai `ALTER TABLE ... DISABLE TRIGGER`).
2. Hentikan aplikasi, lalu salin `data/sigap.db` (beserta `-wal`/`-shm` bila ada) ke lokasi backup.
3. Pastikan salinan sudah termigrasi penuh (script menolak bila belum; jalankan aplikasi sekali dengan `DB_PATH=<salinan>`).
4. Dari folder `relife/`: `DATABASE_URL=postgres://... bun scripts/sqlite-to-postgres.ts <salinan.db>` — script menerapkan migrasi Postgres, menolak DB yang tidak kosong, menyalin semua tabel dalam satu transaksi, lalu memverifikasi isi per baris.
5. Set `DB_DRIVER=postgres` dan `DATABASE_URL`, jalankan aplikasi, cek `/api/health` (`database.driver = "postgres"`, `ok: true`).
6. Rollback: kembalikan `DB_DRIVER=sqlite` (file SQLite lama tidak diubah oleh script).
