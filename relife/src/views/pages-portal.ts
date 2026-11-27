import { html } from 'hono/html';
import type { BusinessCalendar } from '@/domain/calendar';
import { DEMO_PASSWORD } from '@/domain/demo';
import {
  ACTIVE_STATUSES,
  SERVICE_REQUEST_TYPES,
  type Role,
  type ServiceRequestType,
  type TicketStatus,
} from '@/domain/types';
import { formatDateTime, formatRelative } from '@/lib/format';
import type { TicketDetail, TicketListItem } from '@/lib/views';
import { isDemoAuth } from '@/server/auth/config';
import type { SessionUser } from '@/server/auth/session';
import type { CatalogItemRecord } from '@/server/mock/types';
import {
  emptyState,
  flag,
  icon,
  statusPill,
  timeline,
  type HtmlContent,
  type IconName,
} from './components';
import { baseDoc } from './layout';
import { approvalSignoffs } from './approvals';
import { attachmentLink, attachmentPicker } from './attachments';
import { ATTACHMENT_ACCEPT, maxAttachmentBytes } from '@/server/attachments';

// ---------------------------------------------------------------------------
// Login Page
// ---------------------------------------------------------------------------

const DEMO_CARDS: ReadonlyArray<{
  role: Role;
  name: string;
  title: string;
  desc: string;
  iconName: IconName;
}> = [
  {
    role: 'requester',
    name: 'Putri Maharani',
    title: 'Requester (Pengguna Akhir)',
    desc: 'Ajukan keluhan, pantau tiket, beri rating CSAT',
    iconName: 'user',
  },
  {
    role: 'agent',
    name: 'Dimas Saputra',
    title: 'Anggota Tim IT',
    desc: 'Ambil tiket dari antrean Tim IT, respons, update status, dan investigasi',
    iconName: 'wrench',
  },
  {
    role: 'lead',
    name: 'Rina Kusuma',
    title: 'Head IT',
    desc: 'Bagi tiket ke anggota Tim IT, pantau breach, dan override prioritas',
    iconName: 'users',
  },
  {
    role: 'admin',
    name: 'Andi Pratama',
    title: 'Administrator Sistem',
    desc: 'Kelola pengguna, Tim IT, SLA policy, katalog, dan status sistem',
    iconName: 'shield',
  },
];

export function loginPage(): HtmlContent {
  const body = html`<main id="main-content" class="login-shell">
    <div class="login-wrap">
      <div class="login-brand">
        <div class="brand-logo brand-logo-lg">S</div>
        <h1>Sigap IT Service Desk</h1>
        <p class="text-muted">
          Sistem ITSM berbasis ITIL 4 dengan perhitungan SLA jam kerja akurat (Asia/Jakarta) dan
          prioritas otomatis.
        </p>
      </div>

      ${isDemoAuth() ? demoLoginCards() : imsLoginCard()}
    </div>
  </main>`;

  return baseDoc({
    title: 'Masuk — Sigap IT Service Desk',
    body,
    includeCmdk: false,
  });
}

function imsLoginCard(): HtmlContent {
  return html`<div class="card">
    <div class="card-body stack">
      <p class="card-desc">Gunakan akun karyawan yang terdaftar di sistem identitas perusahaan.</p>
      <a href="/auth/ims/login" class="btn btn-primary w-full">Masuk dengan akun perusahaan (IMS)</a>
    </div>
  </div>`;
}

function demoLoginCards(): HtmlContent {
  return html`<div class="card">
        <div class="card-header row-between">
          <div>
            <h2 class="card-title text-accent row-gap-sm">
              ${icon('checkCircle', 'icon-sm')}
              <span>Pilih Akun Demo (1-Click Login)</span>
            </h2>
            <p class="card-desc">Pilih peran di bawah ini untuk langsung mencoba alur kerja sesuai hak aksesnya:</p>
          </div>
          <span class="mono text-xs text-muted">Password demo otomatis</span>
        </div>
        <div class="card-body">
          <div class="demo-grid">
            ${DEMO_CARDS.map(
              (c) => html`<form
                data-api-form
                action="/api/auth/demo"
                data-method="POST"
                data-redirect="response"
              >
                <input type="hidden" name="role" value="${c.role}" />
                <div class="form-error" data-form-error role="alert" hidden></div>
                <button type="submit" class="demo-card">
                  <span class="demo-icon">${icon(c.iconName, 'icon-md')}</span>
                  <span class="demo-info">
                    <span class="demo-name">
                      <span>${c.name}</span>
                      ${icon('arrowRight', 'icon-xs text-muted')}
                    </span>
                    <span class="demo-role">${c.title}</span>
                    <span class="demo-desc">${c.desc}</span>
                  </span>
                </button>
              </form>`,
            )}
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h2 class="card-title">Atau Masuk dengan Email</h2>
          <p class="card-desc">
            Gunakan email pengguna terdaftar (mis. <code>admin@sigap.demo</code>, <code>agent@sigap.demo</code>)
          </p>
        </div>
        <div class="card-body">
          <form
            data-api-form
            action="/api/auth/login"
            data-method="POST"
            data-redirect="response"
            class="stack"
          >
            <div class="field">
              <label for="email" class="label">Email</label>
              <input id="email" name="email" type="email" inputmode="email" autocomplete="email" enterkeyhint="next" class="input" placeholder="nama@sigap.demo" required />
            </div>
            <div class="field">
              <label for="password" class="label">Password</label>
              <input id="password" name="password" type="password" autocomplete="current-password" enterkeyhint="go" class="input" value="${DEMO_PASSWORD}" required />
            </div>
            <div class="form-error" data-form-error role="alert" hidden></div>
            <button type="submit" class="btn btn-primary w-full">Masuk ke Sistem</button>
          </form>
        </div>
      </div>`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveItemIcon(name: string): IconName {
  switch (name) {
    case 'laptop':
      return 'laptop';
    case 'folder':
      return 'folder';
    case 'wrench':
      return 'wrench';
    case 'mail':
      return 'mail';
    case 'printer':
      return 'printer';
    case 'wifi':
      return 'wifi';
    case 'database':
      return 'database';
    case 'barChart':
      return 'barChart';
    default:
      return 'help';
  }
}

const REQUEST_TYPE_META: Readonly<Record<ServiceRequestType, { desc: string; tag?: string }>> = {
  'New Request': { desc: 'Permintaan perangkat, akun, atau layanan baru.' },
  Enhancement: { desc: 'Penambahan fitur atau peningkatan sistem.' },
  Problem: { desc: 'Gangguan, error, atau kendala operasional.', tag: 'Gangguan' },
  'Access Rights': { desc: 'Permintaan atau perubahan hak akses.' },
  'Data Extraction': { desc: 'Penarikan data atau laporan khusus.' },
  Others: { desc: 'Kebutuhan atau pertanyaan IT lainnya.' },
};

function statusHint(status: TicketStatus): string {
  switch (status) {
    case 'new':
      return 'Terkirim, menunggu diterima tim IT.';
    case 'assigned':
      return 'Sudah diterima tim IT.';
    case 'in_progress':
      return 'Sedang dikerjakan teknisi.';
    case 'pending':
      return 'Menunggu balasan Anda.';
    case 'resolved':
      return 'Selesai, mohon konfirmasi Anda.';
    case 'closed':
      return 'Tiket sudah ditutup.';
    case 'cancelled':
      return 'Tiket dibatalkan.';
  }
}

function formatShortIdDate(d: Date): string {
  return d.toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  });
}

// ---------------------------------------------------------------------------
// Portal Home
// ---------------------------------------------------------------------------

export function portalHomePage(opts: {
  user: SessionUser;
  items: Array<CatalogItemRecord & { categoryName: string }>;
  tickets: TicketListItem[];
}): HtmlContent {
  const { user, items, tickets } = opts;
  const now = new Date();
  const firstName = user.name.split(' ')[0] ?? user.name;
  const activeCount = tickets.filter((t) => ACTIVE_STATUSES.includes(t.status)).length;
  const actionTickets = tickets.filter(
    (t) => t.status === 'pending' || t.status === 'resolved',
  );
  const recentTickets = tickets.slice(0, 3);

  return html`<div class="stack-lg">
    <section class="portal-hero-card portal-hero-v2">
      <div class="portal-hero-top">
        <div class="stack-xs">
          <div class="row-gap-sm wrap">
            <h1>Halo, ${firstName}. Ada yang bisa dibantu?</h1>
            <span class="badge">${user.department}</span>
          </div>
          <p class="text-muted">
            Ajukan permintaan layanan IT CTII secara online, tanpa formulir kertas.
          </p>
        </div>
        <div class="portal-cta-group">
          <a href="/portal/new" class="btn btn-primary portal-cta-main">
            ${icon('plus', 'icon-sm')} <span>Buat Permintaan IT</span>
          </a>
          <a href="/portal/tickets" class="btn btn-secondary btn-sm">
            ${icon('ticket', 'icon-xs')}
            <span>Tiket Saya</span>
            ${activeCount > 0 ? html`<span class="tab-count tabular">${activeCount}</span>` : null}
          </a>
        </div>
      </div>
    </section>

    ${actionTickets.length > 0
      ? html`<section class="portal-alert-strip" aria-label="Tiket membutuhkan perhatian Anda">
          <div class="row-gap-sm">
            ${icon('bell', 'icon-sm text-sla-risk')}
            <span>
              <strong>${actionTickets.length} tiket membutuhkan tindak lanjut Anda</strong>
              — balas pertanyaan teknisi atau konfirmasi penyelesaian.
            </span>
          </div>
          <div class="row-gap-xs wrap">
            ${actionTickets.slice(0, 3).map(
              (t) => html`<a href="/portal/tickets/${t.number}" class="badge badge-risk mono">
                ${t.number} · ${t.status === 'pending' ? 'Perlu Balasan' : 'Konfirmasi'}
              </a>`,
            )}
          </div>
        </section>`
      : null}

    <section id="services" class="stack-md">
      <div class="row-between-wrap">
        <div class="stack-xs">
          <h2 class="page-h2">
            Layanan IT
            <span id="portal-catalog-count" class="tab-count tabular">${items.length}</span>
          </h2>
          <p class="text-muted text-xs">Pilih layanan yang dibutuhkan untuk langsung mengisi formulir.</p>
        </div>
        <div class="search-wrap portal-search-wrap">
          ${icon('search', 'icon-sm search-icon')}
          <input
            id="portal-catalog-search"
            type="search"
            enterkeyhint="search"
            class="input input-search"
            placeholder="Cari layanan (mis. PC, Share Folder, Email, VPN)..."
            aria-label="Cari layanan di katalog"
          />
        </div>
      </div>

      <div class="service-grid">
        ${items.map(
          (item) => html`<a
            href="/portal/new?service=${encodeURIComponent(item.id)}"
            class="card service-card"
            data-catalog-card
            data-keywords="${item.keywords.join(' ')}"
          >
            <div class="service-card-icon">
              ${icon(resolveItemIcon(item.icon), 'icon-md')}
            </div>
            <div class="service-card-body">
              <div class="row-between">
                <h3 class="service-card-title">${item.name}</h3>
                <span class="service-card-arrow">${icon('chevronRight', 'icon-xs')}</span>
              </div>
              <p class="text-muted text-xs line-clamp-2">${item.description}</p>
            </div>
          </a>`,
        )}
      </div>

      <div id="portal-catalog-empty" class="card empty-state" hidden>
        <div class="empty-icon">${icon('search', 'icon-lg')}</div>
        <h3 class="empty-title">Layanan tidak ditemukan</h3>
        <p class="empty-desc">
          Tidak ada kategori yang cocok dengan pencarian Anda. Coba kata kunci lain atau pilih Others.
        </p>
        <div class="row-gap-sm wrap justify-center">
          <button type="button" id="portal-search-reset" class="btn btn-secondary btn-sm">
            Reset Pencarian
          </button>
          <a href="/portal/new?service=cat-item-others" class="btn btn-primary btn-sm">
            Buat Permintaan Lainnya
          </a>
        </div>
      </div>
    </section>

    ${recentTickets.length > 0
      ? html`<section class="stack">
          <div class="row-between">
            <h2 class="page-h2">Tiket Anda Terbaru</h2>
            <a href="/portal/tickets" class="link-accent row-gap-xs text-xs">
              <span>Lihat semua (${tickets.length})</span>
              ${icon('arrowRight', 'icon-xs')}
            </a>
          </div>
          <div class="grid-3">
            ${recentTickets.map(
              (t) => html`<a href="/portal/tickets/${t.number}" class="card card-link">
                <div class="stack-xs">
                  <div class="row-between">
                    <span class="mono text-accent font-bold text-xs">${t.number}</span>
                    ${statusPill(t.status, 'requester')}
                  </div>
                  <h3 class="card-link-title" title="${t.title}">${t.title}</h3>
                  <p class="text-muted text-xs">${statusHint(t.status)}</p>
                </div>
                <div class="card-link-foot">
                  <span>${t.category}</span>
                  <span class="tabular">${formatRelative(t.updatedAt, now)}</span>
                </div>
              </a>`,
            )}
          </div>
        </section>`
      : null}

    <p class="portal-process-note text-xs text-muted">
      <strong>Alur layanan:</strong> 1. Isi formulir → 2. Persetujuan atasan (HOD) → 3. Diproses tim IT → 4. Konfirmasi selesai.
    </p>
  </div>`;
}

// ---------------------------------------------------------------------------
// Portal New Ticket
// ---------------------------------------------------------------------------

const REQUEST_TYPE_FORM_META: Readonly<
  Record<ServiceRequestType, { label: string; placeholder: string; hint: string }>
> = {
  'New Request': {
    label: 'Permintaan baru',
    placeholder:
      'Contoh: Mohon disiapkan laptop dan akun email untuk karyawan baru divisi Finance (Budi Santoso), mulai bekerja 1 Desember.',
    hint: 'Sebutkan apa yang dibutuhkan, untuk siapa, dan kapan dibutuhkan.',
  },
  Enhancement: {
    label: 'Pengembangan / perubahan',
    placeholder:
      'Contoh: Saat ini laporan klaim hanya bisa difilter per bulan. Mohon ditambahkan filter per cabang agar rekap mingguan lebih cepat.',
    hint: 'Jelaskan kondisi saat ini, perubahan yang diinginkan, dan manfaatnya.',
  },
  Problem: {
    label: 'Gangguan / error',
    placeholder:
      'Contoh: Sejak pagi ini printer Lt. 2 tidak bisa mencetak. Muncul pesan "Printer offline". Sudah coba restart PC tetapi belum berhasil.',
    hint: 'Ceritakan apa yang terjadi, sejak kapan, pesan error yang muncul, dan langkah yang sudah dicoba.',
  },
  'Access Rights': {
    label: 'Hak akses',
    placeholder:
      'Contoh: Mohon akses Read & Write ke folder \\\\fileserver\\Finance\\2026 untuk Siti (staf Finance) karena mulai menangani rekonsiliasi.',
    hint: 'Sebutkan sistem/folder, tingkat akses (baca/tulis), untuk siapa, dan alasannya.',
  },
  'Data Extraction': {
    label: 'Penarikan data',
    placeholder:
      'Contoh: Mohon data produksi polis per cabang periode Jan–Okt 2026 dalam format Excel untuk bahan rapat direksi.',
    hint: 'Sebutkan data apa, periode, filter yang diperlukan, format (Excel/CSV/PDF), dan tujuan penggunaannya.',
  },
  Others: {
    label: 'Lainnya',
    placeholder: 'Jelaskan kebutuhan atau pertanyaan Anda sejelas mungkin.',
    hint: 'Semakin jelas informasinya, semakin cepat tim IT dapat membantu.',
  },
};

const DEFAULT_DESC_PLACEHOLDER =
  'Jelaskan masalah atau kebutuhan Anda: apa yang terjadi / dibutuhkan, sejak kapan, dan dampaknya ke pekerjaan.';
const DEFAULT_DESC_HINT = 'Pilih jenis permintaan di atas untuk melihat panduan pengisian yang sesuai.';

const URGENCY_OPTIONS: ReadonlyArray<{ value: 'low' | 'medium' | 'high'; label: string; desc: string }> = [
  { value: 'low', label: 'Rendah', desc: 'Tidak mendesak, bisa dijadwalkan' },
  { value: 'medium', label: 'Sedang', desc: 'Pekerjaan masih jalan, tapi terhambat' },
  { value: 'high', label: 'Mendesak', desc: 'Pekerjaan terhenti / berdampak luas' },
];

/** Fields that duplicate a built-in input of the v2 form and therefore are not rendered. */
const REDUNDANT_SCHEMA_KEYS: Readonly<Record<string, readonly string[]>> = {
  'cat-item-others': ['other_topic'],
};

function rfStepHead(num: number, title: string, desc: string): HtmlContent {
  return html`<div class="rf-section-head">
    <span class="rf-step-num" aria-hidden="true">
      <span class="rf-step-digit">${num}</span>
      <span class="rf-step-check">${icon('check', 'icon-xs')}</span>
    </span>
    <div class="stack-xs">
      <h2 id="rf-s${num}-title" class="rf-section-title">${title}</h2>
      <p class="rf-section-desc">${desc}</p>
    </div>
  </div>`;
}

export function portalNewTicketPage(opts: {
  user: SessionUser;
  items: Array<CatalogItemRecord & { categoryName: string }>;
  preselectedService?: string;
  preselectedType?: string;
}): HtmlContent {
  const { user, items } = opts;
  const selectedItem = items.find((i) => i.id === opts.preselectedService);
  const selectedType: ServiceRequestType | undefined = SERVICE_REQUEST_TYPES.includes(
    opts.preselectedType as ServiceRequestType,
  )
    ? (opts.preselectedType as ServiceRequestType)
    : selectedItem
      ? selectedItem.ticketType === 'incident'
        ? 'Problem'
        : 'New Request'
      : undefined;
  const typeMeta = selectedType ? REQUEST_TYPE_FORM_META[selectedType] : undefined;
  const initialTitle = selectedItem
    ? selectedType
      ? `${selectedItem.name} — ${selectedType}`
      : selectedItem.name
    : '';
  const isOthersService = selectedItem?.id === 'cat-item-others';
  const isOthersType = selectedType === 'Others';
  const todayLabel = formatShortIdDate(new Date());

  return html`<div class="rf-wrap stack-md">
    <a href="/portal" class="back-link">
      ${icon('arrowLeft', 'icon-xs')}
      <span>Kembali ke Katalog Layanan</span>
    </a>

    <div class="card rf-paper-head">
      <div class="rf-paper-title">
        <div class="service-card-icon">${icon('file', 'icon-md')}</div>
        <div class="stack-xs">
          <h1 class="page-h1">Ajukan Permintaan Layanan IT</h1>
          <p class="text-muted text-xs">
            Isi 4 bagian singkat di bawah ini. Kolom bertanda <span class="req">*</span> wajib diisi.
          </p>
        </div>
      </div>
      <dl class="form-meta-strip rf-meta">
        <div class="form-meta-cell">
          <dt class="form-meta-label">Nomor Tiket</dt>
          <dd class="form-meta-val mono text-muted">Dibuat otomatis</dd>
        </div>
        <div class="form-meta-cell">
          <dt class="form-meta-label">Pemohon</dt>
          <dd class="form-meta-val" title="${user.name}">${user.name}</dd>
        </div>
        <div class="form-meta-cell">
          <dt class="form-meta-label">Departemen</dt>
          <dd class="form-meta-val" title="${user.department}">${user.department}</dd>
        </div>
        <div class="form-meta-cell">
          <dt class="form-meta-label">Tanggal Pengajuan</dt>
          <dd class="form-meta-val tabular">${todayLabel}</dd>
        </div>
      </dl>
    </div>

    <form
      id="new-ticket-form"
      data-ticket-create-form
      data-api-form
      novalidate
      action="/api/tickets"
      data-method="POST"
      data-redirect-ticket="true"
      data-success-msg="Pengajuan tiket berhasil dikirim"
      data-requester-name="${user.name}"
      data-today-label="${todayLabel}"
      class="rf-layout"
    >
      <div class="rf-main stack-md">
        <section class="card rf-section" data-rf-section="1" aria-labelledby="rf-s1-title">
          ${rfStepHead(1, 'Layanan terkait', 'Pilih satu layanan IT yang paling sesuai dengan kebutuhan Anda.')}
          <div class="rf-section-body">
            <fieldset class="choice-fieldset">
              <legend class="sr-only">Layanan terkait (wajib pilih satu)</legend>
              <div class="rf-service-grid">
                ${items.map(
                  (it) => html`<label class="choice-card rf-service-tile">
                    <input
                      type="radio"
                      name="catalogItemId"
                      value="${it.id}"
                      class="sr-only"
                      data-service-name="${it.name}"
                      required${flag('checked', it.id === selectedItem?.id)}
                    />
                    <span class="service-card-icon rf-tile-icon">${icon(resolveItemIcon(it.icon), 'icon-sm')}</span>
                    <span class="rf-tile-body">
                      <strong class="choice-card-title">${it.name}</strong>
                      <span class="choice-card-desc">${it.description}</span>
                    </span>
                    <span class="rf-tile-check" aria-hidden="true">${icon('check', 'icon-xs')}</span>
                  </label>`,
                )}
              </div>
            </fieldset>
            <div class="field rf-reveal" data-reveal="service-other"${flag('hidden', !isOthersService)}>
              <label for="fd-service-other" class="label">Sebutkan layanan lainnya <span class="req">*</span></label>
              <input
                id="fd-service-other"
                name="formData.service_other"
                type="text"
                class="input"
                maxlength="120"
                placeholder="Mis. Telepon / PABX, CCTV, akses gedung"
                required${flag('disabled', !isOthersService)}
              />
            </div>
            <p class="field-error" data-section-error="1" role="alert" hidden></p>
          </div>
        </section>

        <section class="card rf-section" data-rf-section="2" aria-labelledby="rf-s2-title">
          ${rfStepHead(2, 'Jenis permintaan', 'Pilih apa yang Anda perlukan dari tim IT.')}
          <div class="rf-section-body stack-md">
            <fieldset class="choice-fieldset">
              <legend class="sr-only">Jenis permintaan (wajib pilih satu)</legend>
              <div class="choice-grid-3">
                ${SERVICE_REQUEST_TYPES.map((typeOpt) => {
                  const meta = REQUEST_TYPE_META[typeOpt];
                  const fm = REQUEST_TYPE_FORM_META[typeOpt];
                  return html`<label class="choice-card rf-type-card">
                    <input
                      type="radio"
                      name="formData.service_request_type"
                      value="${typeOpt}"
                      class="sr-only"
                      data-type-label="${fm.label}"
                      data-desc-placeholder="${fm.placeholder}"
                      data-desc-hint="${fm.hint}"
                      required${flag('checked', typeOpt === selectedType)}
                    />
                    <span class="choice-card-head">
                      <strong class="choice-card-title">${fm.label}</strong>
                      ${meta.tag ? html`<span class="badge badge-incident">${meta.tag}</span>` : null}
                    </span>
                    <span class="rf-type-id">${typeOpt}</span>
                    <span class="choice-card-desc">${meta.desc}</span>
                  </label>`;
                })}
              </div>
            </fieldset>
            <div class="field rf-reveal" data-reveal="type-other"${flag('hidden', !isOthersType)}>
              <label for="fd-request-type-other" class="label">Sebutkan jenis permintaan lainnya <span class="req">*</span></label>
              <input
                id="fd-request-type-other"
                name="formData.request_type_other"
                type="text"
                class="input"
                maxlength="120"
                placeholder="Mis. Konsultasi, peminjaman perangkat, pelatihan"
                required${flag('disabled', !isOthersType)}
              />
            </div>

            <fieldset class="choice-fieldset">
              <legend class="label">Seberapa mendesak? <span class="req">*</span></legend>
              <div class="urgency-grid">
                ${URGENCY_OPTIONS.map(
                  (u) => html`<label class="choice-card urgency-${u.value}">
                    <input
                      type="radio"
                      name="urgency"
                      value="${u.value}"
                      class="sr-only"
                      data-urgency-label="${u.label}"
                      required${flag('checked', u.value === 'medium')}
                    />
                    <strong class="choice-card-title"><span class="rf-urg-dot" aria-hidden="true"></span>${u.label}</strong>
                    <span class="choice-card-desc">${u.desc}</span>
                  </label>`,
                )}
              </div>
            </fieldset>
            <p class="field-error" data-section-error="2" role="alert" hidden></p>
          </div>
        </section>

        <section class="card rf-section" data-rf-section="3" aria-labelledby="rf-s3-title">
          ${rfStepHead(3, 'Detail permintaan', 'Ceritakan masalah atau kebutuhan Anda dengan bahasa Anda sendiri.')}
          <div class="rf-section-body stack-md">
            ${items.map((it) => {
              const skip = REDUNDANT_SCHEMA_KEYS[it.id] ?? [];
              const fields = it.formSchema.filter(
                (f) => f.key !== 'service_request_type' && !skip.includes(f.key),
              );
              if (fields.length === 0) return null;
              const active = it.id === selectedItem?.id;
              return html`<fieldset class="choice-fieldset rf-service-fields" data-service-fields="${it.id}"${flag('hidden', !active)}>
                <legend class="label rf-fields-legend">Info tambahan · ${it.name}</legend>
                <div class="form-grid-2">
                  ${fields.map((field) => {
                    const id = `fd-${it.id}-${field.key}`;
                    const ph = field.placeholder ?? `Masukkan ${field.label.toLowerCase()}...`;
                    return html`<div class="field${field.type === 'textarea' ? ' span-full' : ''}">
                      <label for="${id}" class="label">
                        ${field.label}${field.required ? html` <span class="req">*</span>` : html` <span class="text-muted">(opsional)</span>`}
                      </label>
                      ${field.type === 'textarea'
                        ? html`<textarea
                            id="${id}"
                            name="formData.${field.key}"
                            class="textarea"
                            rows="3"
                            placeholder="${ph}"${flag('required', field.required)}${flag('disabled', !active)}
                          ></textarea>`
                        : field.type === 'select'
                          ? html`<select
                              id="${id}"
                              name="formData.${field.key}"
                              class="select"${flag('required', field.required)}${flag('disabled', !active)}
                            >
                              <option value="">-- Pilih --</option>
                              ${(field.options ?? []).map((opt) => html`<option value="${opt}">${opt}</option>`)}
                            </select>`
                          : html`<input
                              id="${id}"
                              name="formData.${field.key}"
                              type="${field.type === 'date' ? 'date' : 'text'}"
                              class="input"
                              placeholder="${ph}"${flag('required', field.required)}${flag('disabled', !active)}
                            />`}
                    </div>`;
                  })}
                </div>
              </fieldset>`;
            })}

            <div class="field">
              <label for="title" class="label">Ringkasan singkat <span class="req">*</span></label>
              <input
                id="title"
                name="title"
                type="text"
                class="input"
                value="${initialTitle}"
                data-auto-title="true"
                placeholder="Mis. Akses Share Folder Finance untuk staf baru"
                minlength="5"
                maxlength="120"
                required
              />
              <span class="field-hint">Terisi otomatis dari pilihan Anda — boleh diubah agar lebih spesifik.</span>
            </div>

            <div class="field">
              <div class="row-between">
                <label for="description" class="label">
                  Deskripsi masalah / kebutuhan <span class="req">*</span>
                </label>
                <span class="text-xs text-muted tabular" data-char-count="description" aria-live="polite">0 karakter (min. 10)</span>
              </div>
              <textarea
                id="description"
                name="description"
                rows="5"
                class="textarea"
                placeholder="${typeMeta?.placeholder ?? DEFAULT_DESC_PLACEHOLDER}"
                aria-describedby="description-hint"
                minlength="10"
                required
              ></textarea>
              <span id="description-hint" class="field-hint rf-desc-hint" data-desc-hint>
                ${icon('help', 'icon-xs')}
                <span data-desc-hint-text>${typeMeta?.hint ?? DEFAULT_DESC_HINT}</span>
              </span>
            </div>

            <div class="field" data-att-picker>
              <label for="att-file" class="label">Lampiran <span class="text-muted">(opsional)</span></label>
              <label for="att-file" class="dropzone">
                <input
                  id="att-file"
                  type="file"
                  class="dropzone-input"
                  data-att-input
                  data-max-bytes="${maxAttachmentBytes()}"
                  accept="${ATTACHMENT_ACCEPT}"
                  aria-describedby="att-file-hint"
                  multiple
                />
                <span class="dropzone-icon">${icon('upload', 'icon-md text-accent')}</span>
                <span class="dropzone-text">
                  <strong>Pilih berkas dari perangkat</strong> atau seret ke sini
                </span>
                <span id="att-file-hint" class="text-xs text-muted">Gambar, PDF, teks/CSV/log, Office, ZIP. Maks. ${Math.round(maxAttachmentBytes() / 1024 / 1024)} MB per berkas.</span>
              </label>
              <ul id="att-list" class="att-list" data-att-list aria-live="polite" aria-label="Lampiran terunggah"></ul>
            </div>
            <p class="field-error" data-section-error="3" role="alert" hidden></p>
          </div>
        </section>

        <section class="card rf-section" data-rf-section="4" aria-labelledby="rf-s4-title">
          ${rfStepHead(4, 'Persetujuan', 'Konfirmasi pemohon dan persetujuan atasan (HOD) sebagai pengganti formulir kertas.')}
          <div class="rf-section-body stack-md">
            <div class="rf-note">
              ${icon('shield', 'icon-sm')}
              <p>
                Atasan (HOD) Anda akan menerima notifikasi persetujuan. Tim IT mulai memproses setelah atasan menyetujui permintaan ini.
              </p>
            </div>
            <div class="form-grid-2">
              <div class="field">
                <label for="fd-hod-name" class="label">Nama atasan (HOD) <span class="req">*</span></label>
                <input
                  id="fd-hod-name"
                  name="formData.hod_name"
                  type="text"
                  class="input"
                  autocomplete="off"
                  maxlength="120"
                  placeholder="Mis. Andi Wijaya"
                  required
                />
              </div>
              <div class="field">
                <label for="fd-hod-email" class="label">Email atasan (HOD) <span class="text-muted">(opsional)</span></label>
                <input
                  id="fd-hod-email"
                  name="formData.hod_email"
                  type="email"
                  inputmode="email"
                  class="input"
                  autocomplete="off"
                  placeholder="nama@perusahaan.co.id"
                />
                <span class="field-hint">Isi agar atasan menerima tautan persetujuan lewat email.</span>
              </div>
            </div>
            <label class="rf-ack">
              <input type="checkbox" name="requesterAck" value="yes" class="rf-ack-input" required />
              <span class="rf-ack-text">
                <strong>Saya menyatakan informasi di atas benar</strong>
                <span class="text-xs text-muted">
                  Berlaku sebagai tanda tangan pemohon: ${user.name} · ${todayLabel}
                </span>
              </span>
            </label>
            <p class="field-error" data-section-error="4" role="alert" hidden></p>
          </div>
        </section>
      </div>

      <aside class="rf-aside" aria-labelledby="rf-summary-title">
        <div class="card rf-summary">
          <div class="rf-summary-head">
            <h2 id="rf-summary-title" class="rf-summary-title">Ringkasan formulir</h2>
            <span class="text-xs text-muted tabular" data-rf-progress-text aria-live="polite">0 dari 4 bagian lengkap</span>
          </div>
          <div class="rf-progress" aria-hidden="true"><span class="rf-progress-bar" data-rf-progress-bar></span></div>
          <ol class="rf-checklist">
            <li data-rf-check="1">${icon('checkCircle', 'icon-xs')}<span>Layanan terkait</span></li>
            <li data-rf-check="2">${icon('checkCircle', 'icon-xs')}<span>Jenis permintaan &amp; urgensi</span></li>
            <li data-rf-check="3">${icon('checkCircle', 'icon-xs')}<span>Detail permintaan</span></li>
            <li data-rf-check="4">${icon('checkCircle', 'icon-xs')}<span>Persetujuan</span></li>
          </ol>
          <dl class="rf-summary-list">
            <div>
              <dt>Layanan</dt>
              <dd data-rf-sum="service">${selectedItem?.name ?? '—'}</dd>
            </div>
            <div>
              <dt>Jenis Permintaan</dt>
              <dd data-rf-sum="type">${selectedType ?? '—'}</dd>
            </div>
            <div>
              <dt>Urgensi</dt>
              <dd data-rf-sum="urgency">Sedang</dd>
            </div>
          </dl>
          <div class="rf-sign-table" role="group" aria-label="Tanda tangan">
            <div class="rf-sign-cell">
              <span class="rf-sign-label">Pemohon</span>
              <strong class="rf-sign-name">${user.name}</strong>
              <span class="rf-sign-status" data-rf-sum="ack">Belum dikonfirmasi</span>
            </div>
            <div class="rf-sign-cell">
              <span class="rf-sign-label">Persetujuan HOD</span>
              <strong class="rf-sign-name" data-rf-sum="hod">—</strong>
              <span class="rf-sign-status">Menunggu setelah dikirim</span>
            </div>
          </div>
          <div class="form-error" data-form-error role="alert" hidden></div>
          <div class="rf-actions">
            <button type="submit" class="btn btn-primary rf-submit">
              ${icon('send', 'icon-xs')} <span>Kirim Permintaan</span>
            </button>
            <a href="/portal" class="btn btn-secondary">Batal</a>
          </div>
        </div>
      </aside>
      <div class="rf-mobile-bar" aria-label="Status pengisian formulir">
        <span class="text-xs font-bold tabular" data-rf-progress-text>0 dari 4 bagian lengkap</span>
        <button type="submit" class="btn btn-primary">
          ${icon('send', 'icon-xs')} <span>Kirim Permintaan</span>
        </button>
      </div>
    </form>
  </div>`;
}

// ---------------------------------------------------------------------------
// Portal Tickets List
// ---------------------------------------------------------------------------

export function portalTicketsPage(
  tickets: TicketListItem[],
  statusFilter?: string,
  searchQuery?: string,
): HtmlContent {
  const now = new Date();
  const activeCount = tickets.filter((t) => ACTIVE_STATUSES.includes(t.status)).length;
  const resolvedCount = tickets.filter(
    (t) => t.status === 'resolved' || t.status === 'closed',
  ).length;

  let filtered = tickets;
  if (statusFilter === 'active') {
    filtered = filtered.filter((t) => ACTIVE_STATUSES.includes(t.status));
  } else if (statusFilter === 'resolved') {
    filtered = filtered.filter((t) => t.status === 'resolved' || t.status === 'closed');
  }
  if (searchQuery?.trim()) {
    const q = searchQuery.trim().toLowerCase();
    filtered = filtered.filter(
      (t) =>
        t.number.toLowerCase().includes(q) ||
        t.title.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q),
    );
  }

  return html`<div class="stack-md">
    <div class="row-between-wrap">
      <div>
        <h1 class="page-h1">Daftar Tiket Anda</h1>
        <p class="text-muted text-xs">
          Pantau progres penanganan laporan masalah dan permintaan layanan IT Anda.
        </p>
      </div>
      <a href="/portal/new" class="btn btn-primary btn-sm">
        ${icon('plus', 'icon-xs')} <span>Buat Permintaan</span>
      </a>
    </div>

    <div class="portal-tickets-toolbar">
      <div class="tab-bar">
        <a href="/portal/tickets" class="tab${!statusFilter ? ' is-active' : ''}">
          <span>Semua Tiket</span>
          <span class="tab-count tabular">${tickets.length}</span>
        </a>
        <a href="/portal/tickets?status=active" class="tab${statusFilter === 'active' ? ' is-active' : ''}">
          <span>Sedang Diproses</span>
          <span class="tab-count tabular">${activeCount}</span>
        </a>
        <a href="/portal/tickets?status=resolved" class="tab${statusFilter === 'resolved' ? ' is-active' : ''}">
          <span>Selesai &amp; Ditutup</span>
          <span class="tab-count tabular">${resolvedCount}</span>
        </a>
      </div>

      <form method="get" action="/portal/tickets" class="portal-search-bar">
        ${statusFilter ? html`<input type="hidden" name="status" value="${statusFilter}" />` : null}
        <div class="search-wrap flex-1">
          ${icon('search', 'icon-xs search-icon')}
          <input
            type="search"
            enterkeyhint="search"
            name="q"
            class="input input-sm input-search"
            value="${searchQuery ?? ''}"
            placeholder="Cari nomor tiket, judul, atau kategori..."
            aria-label="Cari tiket saya"
          />
        </div>
        <button type="submit" class="btn btn-secondary btn-sm">Cari</button>
        ${searchQuery?.trim()
          ? html`<a
              href="/portal/tickets${statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : ''}"
              class="btn btn-ghost btn-sm"
            >Reset</a>`
          : null}
      </form>
    </div>

    ${filtered.length === 0
      ? emptyState(
          statusFilter || searchQuery?.trim() ? 'Tidak ada tiket ditemukan' : 'Belum ada tiket',
          statusFilter || searchQuery?.trim()
            ? 'Tidak ada tiket dengan kriteria filter atau pencarian yang dipilih.'
            : 'Permintaan IT yang Anda ajukan akan muncul di sini beserta progresnya.',
          html`<a href="/portal/new" class="btn btn-primary btn-sm">
            ${icon('plus', 'icon-xs')} <span>Buat Permintaan IT</span>
          </a>`,
        )
      : html`<div class="card list-card portal-ticket-list">
          ${filtered.map(
            (t) => html`<a href="/portal/tickets/${t.number}" class="list-row">
              <div class="stack-xs">
                <div class="row-gap-sm wrap text-xs">
                  <span class="mono text-accent font-bold">${t.number}</span>
                  <span class="badge ${t.type === 'incident' ? 'badge-incident' : 'badge-request'}">
                    ${t.type === 'incident' ? 'Gangguan' : 'Permintaan'}
                  </span>
                  <span class="text-muted">${t.category}</span>
                  ${t.status === 'pending'
                    ? html`<span class="badge badge-risk">Perlu Balasan Anda</span>`
                    : t.status === 'resolved'
                      ? html`<span class="badge badge-ok">Mohon Konfirmasi</span>`
                      : null}
                </div>
                <h2 class="list-row-title">${t.title}</h2>
                <span class="portal-status-line text-xs">${statusHint(t.status)}</span>
                <span class="text-muted text-xs">
                  ${t.assignee ? `Ditangani ${t.assignee.name}` : 'Menunggu penugasan tim'} · Dibuat
                  ${formatDateTime(t.createdAt)} (${formatRelative(t.createdAt, now)})
                </span>
              </div>
              <div class="row-gap-sm shrink-0">
                ${statusPill(t.status, 'requester')}
                ${icon('chevronRight', 'icon-xs text-muted')}
              </div>
            </a>`,
          )}
        </div>`}
  </div>`;
}

// ---------------------------------------------------------------------------
// Portal Ticket Detail
// ---------------------------------------------------------------------------

const STEPPER_STEPS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'new', label: 'Terkirim' },
  { key: 'assigned', label: 'Diterima Tim' },
  { key: 'in_progress', label: 'Diproses' },
  { key: 'resolved', label: 'Selesai' },
];

const PAPER_LABELS: readonly string[] = [
  'Service Request Type',
  'Layanan Lainnya',
  'Jenis Permintaan Lainnya',
  'Acknowledge by HOD',
  'Email HOD',
  'Konfirmasi Pemohon',
];

function paperOther(detail: TicketDetail, label: string): string {
  const v = detail.formFields.find((f) => f.label === label)?.value;
  return v ? ` (${v})` : '';
}

function stepIndexFor(status: TicketStatus): number {
  switch (status) {
    case 'new':
      return 0;
    case 'assigned':
      return 1;
    case 'in_progress':
    case 'pending':
      return 2;
    case 'resolved':
    case 'closed':
      return 3;
    case 'cancelled':
      return -1;
  }
}

export function portalTicketDetailPage(
  detail: TicketDetail,
  _cal?: BusinessCalendar,
): HtmlContent {
  const now = new Date();
  const isResolved = detail.status === 'resolved';
  const isClosed = detail.status === 'closed';
  const isFinal = isClosed || detail.status === 'cancelled';
  const currentStep = stepIndexFor(detail.status);
  const reqTypeField = detail.formFields.find((f) => f.label === 'Service Request Type');
  const extraFields = detail.formFields.filter((f) => !PAPER_LABELS.includes(f.label));

  return html`<div class="stack-md">
    <div>
      <a href="/portal/tickets" class="back-link">
        ${icon('arrowLeft', 'icon-xs')} <span>Kembali ke Daftar Tiket</span>
      </a>
    </div>

    <div class="card detail-head">
      <div class="row-between-wrap">
        <div class="row-gap-sm wrap">
          <span class="mono text-accent font-bold text-md">${detail.number}</span>
          <span class="badge ${detail.type === 'incident' ? 'badge-incident' : 'badge-request'}">
            ${detail.type === 'incident' ? 'Gangguan' : 'Permintaan Layanan'}
          </span>
          <span class="badge">${detail.category}</span>
        </div>
        ${statusPill(detail.status, 'requester')}
      </div>
      <h1 class="page-h1">${detail.title}</h1>
      <p class="portal-status-line text-xs">${statusHint(detail.status)}</p>

      ${detail.status === 'cancelled'
        ? html`<div class="notice-muted">
            ${icon('xCircle', 'icon-xs')}
            <span>Tiket ini telah dibatalkan.</span>
          </div>`
        : html`<ol class="stepper" aria-label="Progres penyelesaian tiket">
            ${STEPPER_STEPS.map((st, idx) => {
              const isDone = idx < currentStep || (isClosed && idx === 3);
              const isCurrent = idx === currentStep && !isClosed;
              const isPaused = isCurrent && detail.status === 'pending';
              return html`<li
                class="stepper-item${isDone ? ' is-done' : ''}${isCurrent ? ' is-current' : ''}${isPaused ? ' is-paused' : ''}"
              >
                <span class="stepper-dot" aria-hidden="true">
                  ${isDone ? icon('check', 'icon-xs') : idx + 1}
                </span>
                <span class="stepper-label">
                  ${isPaused ? 'Menunggu Anda' : st.label}
                </span>
              </li>`;
            })}
          </ol>`}
    </div>

    ${detail.status === 'pending'
      ? html`<div class="portal-alert-strip">
          <div class="row-gap-sm">
            ${icon('message', 'icon-sm text-sla-risk')}
            <span>
              <strong>Tim IT menunggu jawaban Anda</strong> agar penanganan tiket dapat dilanjutkan.
            </span>
          </div>
          <button
            type="button"
            class="btn btn-primary btn-sm"
            data-focus-target="portal-reply-body"
          >
            Tulis Balasan
          </button>
        </div>`
      : null}

    ${isResolved
      ? html`<div class="card banner-resolved">
          <div class="card-header">
            <h2 class="card-title text-sla-ok row-gap-sm">
              ${icon('checkCircle', 'icon-sm')}
              <span>Tim Teknis Telah Menyelesaikan Kendala Anda</span>
            </h2>
            <p class="card-desc">
              ${detail.resolutionNotes
                ? `Catatan penyelesaian: "${detail.resolutionNotes}"`
                : 'Mohon konfirmasi jika masalah sudah tertangani dengan baik.'}
            </p>
          </div>
          <div class="card-body row-gap-sm wrap">
            <button
              type="button"
              class="btn btn-success btn-sm"
              data-api-btn
              data-confirm="Konfirmasi bahwa masalah sudah selesai dan tutup tiket ini secara permanen?"
              data-url="/api/tickets/${detail.id}/transition"
              data-body="${JSON.stringify({ to: 'closed' })}"
              data-reload="true"
              data-success-msg="Tiket dikonfirmasi selesai"
            >
              ${icon('check', 'icon-xs')} <span>Masalah Sudah Selesai</span>
            </button>
            <button type="button" class="btn btn-secondary btn-sm" data-open-dialog="dlg-reopen">
              ${icon('rotate', 'icon-xs')} <span>Kendala Masih Terjadi (Buka Lagi)</span>
            </button>
          </div>
        </div>

        <dialog id="dlg-reopen" class="modal">
          <div class="modal-box">
            <div class="modal-head">
              <h3 class="modal-title">Buka Kembali Tiket</h3>
              <p class="modal-desc">Jelaskan kendala apa yang masih Anda alami agar tim dapat menindaklanjuti.</p>
            </div>
            <form
              data-api-form
              action="/api/tickets/${detail.id}/transition"
              data-method="POST"
              data-reload="true"
              data-success-msg="Tiket dibuka kembali"
              class="stack"
            >
              <input type="hidden" name="to" value="in_progress" />
              <div class="field">
                <label for="reopen-reason" class="label">Alasan Pembukaan Kembali <span class="req">*</span></label>
                <textarea
                  id="reopen-reason"
                  name="reopenReason"
                  rows="3"
                  class="textarea"
                  placeholder="Jelaskan kendala apa yang masih Anda alami..."
                  minlength="3"
                  required
                ></textarea>
              </div>
              <div class="form-error" data-form-error role="alert" hidden></div>
              <div class="modal-foot">
                <button type="button" class="btn btn-secondary btn-sm" data-close-dialog>Batal</button>
                <button type="submit" class="btn btn-primary btn-sm">Kirim &amp; Buka Kembali</button>
              </div>
            </form>
          </div>
        </dialog>`
      : null}

    <div class="portal-detail-grid">
      <div class="stack-md">
        <div class="card portal-paper-form">
          <div class="card-header">
            <h2 class="section-label">Formulir Permintaan IT</h2>
          </div>
          <div class="card-body stack">
            <div class="kv-grid paper-grid">
              <div class="kv-item"><span class="kv-label">Nomor Tiket</span><span class="kv-value mono">${detail.number}</span></div>
              <div class="kv-item"><span class="kv-label">Departemen</span><span class="kv-value">${detail.requesterInfo.department || 'Belum diisi'}</span></div>
              <div class="kv-item"><span class="kv-label">Pemohon</span><span class="kv-value">${detail.requesterInfo.name}</span></div>
              <div class="kv-item"><span class="kv-label">Tanggal Pengajuan</span><span class="kv-value">${formatDateTime(detail.createdAt)}</span></div>
              <div class="kv-item"><span class="kv-label">Layanan Terkait</span><span class="kv-value">${detail.category}${paperOther(detail, 'Layanan Lainnya')}</span></div>
              <div class="kv-item"><span class="kv-label">Jenis Permintaan</span><span class="kv-value">${reqTypeField?.value ?? 'Belum diisi'}${paperOther(detail, 'Jenis Permintaan Lainnya')}</span></div>
            </div>
            <div class="stack-xs">
              <h3 class="kv-label">Deskripsi Masalah / Kebutuhan</h3>
              <p class="prose-pre">${detail.description}</p>
            </div>
            <div class="stack-xs">
              <h3 class="kv-label">Persetujuan</h3>
              ${approvalSignoffs(detail)}
              ${detail.approval.awaiting
                ? html`<p class="apr-status text-xs">${icon('clock', 'icon-xs')}
                    <span>Menunggu persetujuan — waktu SLA tidak berjalan selama menunggu.</span></p>`
                : null}
            </div>
            ${detail.approval.receivedBy || detail.approval.actionPlan || detail.approval.impactAnalysis
              ? html`<div class="kv-grid paper-grid">
                  <div class="kv-item"><span class="kv-label">Diterima Oleh</span><span class="kv-value">${detail.approval.receivedBy ?? '—'}</span></div>
                  <div class="kv-item"><span class="kv-label">Tanggal Diterima</span><span class="kv-value">${detail.approval.receivedAt ? formatDateTime(detail.approval.receivedAt) : '—'}</span></div>
                  <div class="kv-item"><span class="kv-label">Rencana Tindakan IT</span><span class="kv-value prose-pre">${detail.approval.actionPlan ?? '—'}</span></div>
                  <div class="kv-item"><span class="kv-label">Analisis Dampak</span><span class="kv-value prose-pre">${detail.approval.impactAnalysis ?? '—'}</span></div>
                </div>`
              : null}
            ${extraFields.length > 0
              ? html`<div class="kv-grid">
                  ${extraFields.map(
                    (f) => html`<div class="kv-item">
                      <span class="kv-label">${f.label}</span>
                      <span class="kv-value">${f.value}</span>
                    </div>`,
                  )}
                </div>`
              : null}
            ${detail.attachments.length > 0
              ? html`<div class="timeline-attachments">
                  ${detail.attachments.map(
                    (att) => html`<span class="att-chip"
                      >${attachmentLink(
                        att,
                        html`${icon('file', 'icon-xs')} <strong>${att.fileName}</strong>
                          <span class="text-muted">(${Math.round(att.size / 1024)} KB)</span>`,
                      )}</span
                    >`,
                  )}
                </div>`
              : null}
          </div>
        </div>

        ${isResolved || isClosed
          ? html`<div class="card">
              <div class="card-header">
                <h2 class="card-title text-accent row-gap-sm">
                  ${icon('star', 'icon-sm')} <span>Survei Kepuasan Layanan (CSAT)</span>
                </h2>
                <p class="card-desc">
                  ${detail.csat
                    ? 'Terima kasih telah memberikan masukan atas penanganan tiket ini.'
                    : 'Seberapa puas Anda dengan kecepatan dan solusi yang diberikan oleh tim kami?'}
                </p>
              </div>
              <div class="card-body">
                ${detail.csat
                  ? html`<div class="csat-saved">
                      <div class="row-gap-xs">
                        ${[1, 2, 3, 4, 5].map(
                          (s) => html`<span class="star ${s <= detail.csat!.score ? 'is-filled' : ''}" aria-hidden="true">★</span>`,
                        )}
                        <strong class="mono text-xs">${detail.csat.score} dari 5 Bintang</strong>
                      </div>
                      ${detail.csat.comment ? html`<p class="text-xs italic">"${detail.csat.comment}"</p>` : null}
                    </div>`
                  : html`<form
                      data-api-form
                      action="/api/tickets/${detail.id}/csat"
                      data-method="POST"
                      data-reload="true"
                      data-success-msg="Penilaian CSAT berhasil dikirim"
                      class="stack"
                    >
                      <input type="hidden" name="score" value="5" id="csat-score" />
                      <div class="csat-stars" role="radiogroup" aria-label="Skor Kepuasan">
                        ${[1, 2, 3, 4, 5].map(
                          (s) => html`<button
                            type="button"
                            role="radio"
                            aria-checked="${s === 5 ? 'true' : 'false'}"
                            aria-label="${s} dari 5 bintang"
                            tabindex="${s === 5 ? '0' : '-1'}"
                            class="csat-star${s <= 5 ? ' is-active' : ''}"
                            data-csat-star="${s}"
                          >★</button>`,
                        )}
                        <span class="text-muted text-xs" id="csat-label">(Sangat Puas)</span>
                      </div>
                      <label for="csat-comment" class="sr-only">Komentar atau saran tambahan</label>
                      <textarea
                        id="csat-comment"
                        name="comment"
                        rows="2"
                        class="textarea"
                        placeholder="Komentar atau saran tambahan (opsional)..."
                      ></textarea>
                      <div class="form-error" data-form-error role="alert" hidden></div>
                      <div class="form-actions">
                        <button type="submit" class="btn btn-primary btn-sm">Kirim Penilaian</button>
                      </div>
                    </form>`}
              </div>
            </div>`
          : null}

        <section class="card convo-card" aria-labelledby="convo-title">
          <div class="card-header">
            <h2 class="section-label" id="convo-title">Percakapan dengan Tim IT</h2>
          </div>
          <div class="card-body">${timeline(detail.timeline, now, 'requester')}</div>
        </section>

        ${!isFinal
          ? (() => {
              const replyHeaderContent = (heading: boolean) => html`
                ${heading
                  ? html`<h2 class="card-title row-gap-sm">
                      ${icon('message', 'icon-sm text-accent')}
                      <span>Kirim Pesan / Balasan ke Tim IT</span>
                    </h2>`
                  : html`<span class="card-title row-gap-sm">
                      ${icon('message', 'icon-sm text-accent')}
                      <span>Kirim Pesan / Balasan ke Tim IT</span>
                    </span>`}
                <span class="card-desc">Tambahkan informasi atau respon atas pertanyaan dari teknisi yang menangani.</span>
              `;
              const replyBody = html`<div class="card-body">
                <form
                  data-api-form
                  action="/api/tickets/${detail.id}/comments"
                  data-method="POST"
                  data-reload="true"
                  data-success-msg="Balasan berhasil dikirim"
                  class="stack"
                >
                  <input type="hidden" name="visibility" value="public" />
                  <label for="portal-reply-body" class="sr-only">Pesan atau balasan untuk tim IT</label>
                  <textarea
                    id="portal-reply-body"
                    name="body"
                    rows="3"
                    class="textarea"
                    placeholder="Tulis pesan atau jawaban Anda di sini..."
                    minlength="2"
                    required
                  ></textarea>
                  ${attachmentPicker('portal-reply-att')}
                  <div class="form-error" data-form-error role="alert" hidden></div>
                  <div class="form-actions">
                    <button type="submit" class="btn btn-primary btn-sm">
                      ${icon('send', 'icon-xs')} <span>Kirim Balasan</span>
                    </button>
                  </div>
                </form>
              </div>`;
              return isResolved
                ? html`<details class="card details-card">
                    <summary class="card-header row-between">
                      <span class="stack-xs">${replyHeaderContent(false)}</span>
                      ${icon('chevronRight', 'icon-sm text-muted details-chevron')}
                    </summary>
                    ${replyBody}
                  </details>`
                : html`<div class="card">
                    <div class="card-header">${replyHeaderContent(true)}</div>
                    ${replyBody}
                  </div>`;
            })()
          : null}
      </div>

      <aside class="portal-detail-side">
        <div class="card">
          <div class="card-header">
            <h2 class="section-label">Ringkasan Tiket</h2>
          </div>
          <div class="card-body stack-sm text-xs">
            <div class="row-between">
              <span class="text-muted">Nomor Tiket</span>
              <strong class="mono">${detail.number}</strong>
            </div>
            <div class="row-between">
              <span class="text-muted">Status</span>
              ${statusPill(detail.status, 'requester')}
            </div>
            <div class="row-between">
              <span class="text-muted">Layanan</span>
              <strong>${detail.category}</strong>
            </div>
            ${reqTypeField
              ? html`<div class="row-between">
                  <span class="text-muted">Jenis Permintaan</span>
                  <strong>${reqTypeField.value}</strong>
                </div>`
              : null}
            <div class="row-between">
              <span class="text-muted">Penanggung Jawab</span>
              <strong>${detail.assignee?.name ?? 'Menunggu penugasan'}</strong>
            </div>
            <div class="row-between">
              <span class="text-muted">Diajukan</span>
              <span class="tabular">${formatDateTime(detail.createdAt)}</span>
            </div>
            <div class="row-between">
              <span class="text-muted">Diperbarui</span>
              <span class="tabular">${formatRelative(detail.updatedAt, now)}</span>
            </div>
          </div>
        </div>
      </aside>
    </div>
  </div>`;
}
