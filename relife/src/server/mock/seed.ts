import {
  addBusinessMinutes,
  businessMinutesBetween,
  type BusinessCalendar,
} from '@/domain/calendar';
import { computeSlaState } from '@/domain/sla';
import type {
  Impact,
  PendingReason,
  Priority,
  ResolutionCode,
  ServiceRequestType,
  TicketType,
  Urgency,
} from '@/domain/types';
import { createRng, type Rng } from './random';
import {
  buildCalendars,
  buildCatalog,
  buildCategories,
  buildHolidays,
  buildSlaPolicies,
  buildTeams,
  buildUsers,
  CAL_BUSINESS,
} from './reference-data';
import { businessCalendar, nextId, type Store } from './store';
import {
  addComment,
  assignTicket,
  AUTO_CLOSE_BUSINESS_MINUTES,
  createTicket,
  runSlaTick,
  submitCsat,
  transitionTicket,
} from './ticket-engine';
import type { CatalogItemRecord, ChangeStatus, TicketRecord, UserRecord } from './types';

/**
 * Seeder data demo (DATA_MODEL.md §Seed): ~900 tiket historis 90 hari, deterministik (seed tetap),
 * tanggal relatif terhadap waktu seed. Semua tiket dibuat lewat ticket engine yang sama dengan UI
 * sehingga event, SLA, dan notifikasi konsisten.
 */

const SEED = 20_261_023;
const DAYS = 90;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const INCIDENT_PRIORITY: ReadonlyArray<readonly [Priority, number]> = [
  ['P1', 2],
  ['P2', 13],
  ['P3', 45],
  ['P4', 40],
];
const REQUEST_PRIORITY: ReadonlyArray<readonly [Priority, number]> = [
  ['P3', 40],
  ['P4', 60],
];

const PAIRS: Readonly<Record<Priority, ReadonlyArray<readonly [Impact, Urgency]>>> = {
  P1: [['high', 'high']],
  P2: [
    ['high', 'medium'],
    ['medium', 'high'],
  ],
  P3: [
    ['high', 'low'],
    ['medium', 'medium'],
    ['low', 'high'],
  ],
  P4: [
    ['medium', 'low'],
    ['low', 'medium'],
    ['low', 'low'],
  ],
};

const ITEM_WEIGHTS: ReadonlyArray<readonly [string, number]> = [
  ['cat-item-pc-server', 18],
  ['cat-item-share-folder', 10],
  ['cat-item-software', 14],
  ['cat-item-email', 12],
  ['cat-item-printing', 10],
  ['cat-item-network', 14],
  ['cat-item-core-system', 10],
  ['cat-item-report-system', 7],
  ['cat-item-others', 5],
];

const TITLES: Readonly<Record<string, readonly string[]>> = {
  'cat-item-pc-server': [
    'Laptop mati total tidak bisa dinyalakan',
    'PC sangat lambat sejak update Windows',
    'Monitor kedua tidak terdeteksi di docking',
    'Permintaan PC baru untuk staf keuangan',
  ],
  'cat-item-share-folder': [
    'Permintaan akses Share Folder Finance',
    'Tidak bisa tulis file ke folder bersama HR',
    'Buat folder bersama baru untuk proyek Q4',
    'Error permission denied saat buka Share Folder',
  ],
  'cat-item-software': [
    'Install Adobe Acrobat Pro di laptop kerja',
    'Aplikasi Microsoft Excel sering not responding',
    'Permintaan lisensi Microsoft Visio',
    'Update aplikasi Zoom dan driver perangkat',
  ],
  'cat-item-email': [
    'Email tertahan di outbox Outlook',
    'Pembuatan email untuk karyawan baru Sales',
    'Reset password email perusahaan',
    'Permintaan akses grup email proyek',
  ],
  'cat-item-printing': [
    'Printer lantai 2 tidak bisa mencetak',
    'Kertas macet dan hasil cetak bergaris di printer HR',
    'Penggantian toner printer Finance',
    'Setting scan-to-folder pada mesin fotokopi',
  ],
  'cat-item-network': [
    'VPN gagal connect dari rumah',
    'WiFi lantai 3 tidak ada sinyal / putus-putus',
    'Aktivasi akses VPN baru untuk WFH',
    'LAN di ruang rapat utama mati',
  ],
  'cat-item-core-system': [
    'Error saat posting jurnal di Core System',
    'Permintaan hak akses modul Finance Core System',
    'Enhancement validasi input transaksi klaim',
    'Core System timeout saat approval polis',
  ],
  'cat-item-report-system': [
    'Penarikan data produksi bulanan (Data Extraction)',
    'Laporan stok dan klaim tidak muncul di Report System',
    'Permintaan template laporan baru untuk Audit',
    'Enhancement filter tanggal pada dashboard laporan',
  ],
  'cat-item-others': [
    'Pertanyaan tentang kebijakan perangkat IT',
    'Konsultasi backup data karyawan mutasi',
    'Bantuan teknis ruang meeting hybrid',
    'Pertanyaan lisensi dan aset IT lainnya',
  ],
};

const FIRST_RESPONSES = [
  'Halo, terima kasih laporannya. Saya sedang cek sekarang.',
  'Baik, tiket sudah saya terima. Saya hubungi via Teams sebentar lagi.',
  'Terima kasih, sedang kami analisis. Mohon tunggu update berikutnya.',
  'Siap, saya remote laptop Anda dalam 10 menit ya.',
];
const ASK_USER = [
  'Boleh kirimkan screenshot pesan error yang muncul?',
  'Apakah masalah ini juga terjadi di perangkat lain?',
  'Mohon konfirmasi nomor aset laptop Anda.',
  'Kapan waktu yang pas untuk remote session?',
];
const USER_REPLIES = [
  'Sudah saya lampirkan screenshot-nya.',
  'Hanya di laptop saya saja, rekan lain normal.',
  'Nomor asetnya AST-20931.',
  'Bisa jam 2 siang ini.',
];
const INTERNAL_NOTES = [
  'Cek log: ada error driver setelah patch terakhir.',
  'Kemungkinan terkait lisensi; koordinasi dengan vendor.',
  'Sudah dicoba restart service, belum berhasil.',
  'Perlu eskalasi ke Head IT jika berulang.',
];
const RESOLUTION_NOTES: Readonly<Record<ResolutionCode, readonly string[]>> = {
  fixed: [
    'Driver diperbarui dan perangkat berfungsi normal.',
    'Konfigurasi diperbaiki, sudah dites bersama user.',
    'Komponen diganti, perangkat normal kembali.',
  ],
  workaround: [
    'Diberikan workaround sementara sambil menunggu perbaikan permanen.',
    'Gunakan koneksi alternatif sementara; problem dicatat.',
  ],
  user_error: [
    'Panduan penggunaan sudah dijelaskan ke user.',
    'Pengaturan aplikasi dikembalikan ke default.',
  ],
  no_fault_found: ['Tidak ditemukan masalah setelah pengecekan menyeluruh.'],
  duplicate: ['Duplikat dari tiket lain yang sudah ditangani.'],
  fulfilled: [
    'Permintaan sudah dipenuhi sesuai form.',
    'Akses sudah diberikan dan dikonfirmasi.',
    'Instalasi selesai dan lisensi aktif.',
  ],
};
const REOPEN_REASONS = [
  'Masalah muncul lagi pagi ini',
  'Belum sepenuhnya beres',
  'Error yang sama terjadi lagi',
];
const CANCEL_REASONS = [
  'Duplikat tiket lain',
  'Dibatalkan atas permintaan user',
  'Salah kategori, dibuat ulang',
];

interface SimContext {
  store: Store;
  rng: Rng;
  now: Date;
  businessCal: BusinessCalendar;
  requesters: UserRecord[];
}

function requireUser(store: Store, id: string | null): UserRecord {
  const user = id ? store.users.get(id) : undefined;
  if (!user) throw new Error(`Seed: user ${id} tidak ditemukan`);
  return user;
}

function requireItem(store: Store, id: string): CatalogItemRecord {
  const item = store.catalog.get(id);
  if (!item) throw new Error(`Seed: katalog ${id} tidak ditemukan`);
  return item;
}

function current(store: Store, id: string): TicketRecord {
  const ticket = store.tickets.get(id);
  if (!ticket) throw new Error(`Seed: tiket ${id} tidak ditemukan`);
  return ticket;
}

const jakartaKeyFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jakarta',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Awal hari lokal Jakarta `daysAgo` hari sebelum `now` (data seed; Jakarta tanpa DST). */
function jakartaDay(now: Date, daysAgo: number): { start: number; weekday: number } {
  const key = jakartaKeyFmt.format(new Date(now.getTime() - daysAgo * DAY));
  const start = new Date(`${key}T00:00:00+07:00`).getTime();
  return { start, weekday: new Date(start + 12 * HOUR).getUTCDay() };
}

const HOUR_WEIGHTS: ReadonlyArray<readonly [number, number]> = [
  [7, 2],
  [8, 9],
  [9, 12],
  [10, 11],
  [11, 9],
  [12, 4],
  [13, 9],
  [14, 10],
  [15, 9],
  [16, 7],
  [17, 3],
  [18, 2],
  [19, 1],
  [21, 1],
];

const REQUEST_TYPE_WEIGHTS: Readonly<
  Record<string, ReadonlyArray<readonly [ServiceRequestType, number]>>
> = {
  'cat-item-pc-server': [
    ['Problem', 65],
    ['New Request', 25],
    ['Enhancement', 5],
    ['Others', 5],
  ],
  'cat-item-share-folder': [
    ['Access Rights', 60],
    ['New Request', 20],
    ['Problem', 15],
    ['Others', 5],
  ],
  'cat-item-software': [
    ['New Request', 45],
    ['Problem', 35],
    ['Enhancement', 10],
    ['Access Rights', 10],
  ],
  'cat-item-email': [
    ['Problem', 50],
    ['New Request', 25],
    ['Access Rights', 20],
    ['Others', 5],
  ],
  'cat-item-printing': [
    ['Problem', 70],
    ['New Request', 20],
    ['Access Rights', 10],
  ],
  'cat-item-network': [
    ['Problem', 70],
    ['Access Rights', 20],
    ['New Request', 10],
  ],
  'cat-item-core-system': [
    ['Problem', 40],
    ['Enhancement', 25],
    ['Access Rights', 25],
    ['Data Extraction', 10],
  ],
  'cat-item-report-system': [
    ['Data Extraction', 45],
    ['Enhancement', 25],
    ['New Request', 15],
    ['Problem', 15],
  ],
  'cat-item-others': [
    ['Others', 50],
    ['New Request', 25],
    ['Problem', 25],
  ],
};

function formDataFor(item: CatalogItemRecord, rng: Rng): Record<string, string> {
  const data: Record<string, string> = {};
  const weights = REQUEST_TYPE_WEIGHTS[item.id];
  if (weights) {
    data.service_request_type = rng.weighted(weights);
  } else {
    data.service_request_type = item.ticketType === 'incident' ? 'Problem' : 'New Request';
  }
  for (const field of item.formSchema) {
    if (field.key === 'service_request_type') continue;
    if (!field.required && !rng.chance(0.6)) continue;
    if (field.type === 'select' && field.options?.length) data[field.key] = rng.pick(field.options);
    else if (field.type === 'date') data[field.key] = '2026-10-01';
    else if (field.key === 'asset_tag') data[field.key] = `AST-${rng.int(10000, 39999)}`;
    else data[field.key] = field.placeholder ?? 'Lihat deskripsi';
  }
  return data;
}

function pickPair(
  item: CatalogItemRecord,
  priority: Priority,
  rng: Rng,
): readonly [Impact, Urgency] {
  const pairs = PAIRS[priority];
  return pairs.find(([impact]) => impact === item.defaultImpact) ?? rng.pick(pairs);
}

function resolutionCodeFor(ticketType: TicketType, rng: Rng): ResolutionCode {
  if (ticketType === 'service_request') return 'fulfilled';
  return rng.weighted<ResolutionCode>([
    ['fixed', 70],
    ['workaround', 12],
    ['user_error', 8],
    ['no_fault_found', 6],
    ['duplicate', 4],
  ]);
}

function resolve(
  ctx: SimContext,
  id: string,
  ticketType: TicketType,
  agent: UserRecord,
  at: Date,
): void {
  const code = resolutionCodeFor(ticketType, ctx.rng);
  transitionTicket(
    ctx.store,
    id,
    'resolved',
    agent,
    {
      resolutionCode: code,
      resolutionNotes: ctx.rng.pick(RESOLUTION_NOTES[code]),
    },
    at,
  );
}

/** Skor CSAT berdistribusi realistis (rata-rata ≈ 4,2). */
function csatScore(rng: Rng): number {
  return rng.weighted<number>([
    [5, 50],
    [4, 31],
    [3, 10],
    [2, 5],
    [1, 4],
  ]);
}

const CSAT_COMMENTS: Readonly<Record<number, readonly string[]>> = {
  5: ['Cepat dan ramah, terima kasih!', 'Mantap, langsung beres.', ''],
  4: ['Terima kasih, sudah normal.', ''],
  3: ['Selesai tapi agak lama.', ''],
  2: ['Harus follow-up beberapa kali.'],
  1: ['Lama sekali penanganannya.'],
};

interface TicketSpec {
  itemId: string;
  createdAt: Date;
  requesterId: string;
  priority: Priority;
}

/**
 * Mensimulasikan siklus hidup satu tiket historis sampai `now`.
 * Langkah yang jatuh setelah `now` dihentikan sehingga tiket tetap aktif di status itu.
 */
function simulateTicket(ctx: SimContext, spec: TicketSpec): void {
  const { store, rng, now } = ctx;
  const item = requireItem(store, spec.itemId);
  const requester = requireUser(store, spec.requesterId);
  const [impact, urgency] = pickPair(item, spec.priority, rng);
  const titles = TITLES[item.id] ?? [item.name];

  const formData = formDataFor(item, rng);
  const effectiveType: TicketType =
    formData.service_request_type === 'Problem' ? 'incident' : 'service_request';

  const created = createTicket(
    store,
    {
      catalogItemId: item.id,
      title: rng.pick(titles),
      description: `${item.description} Mohon dibantu, terima kasih.`,
      urgency,
      impact,
      formData,
      attachments: rng.chance(0.15)
        ? [{ fileName: 'screenshot.png', mime: 'image/png', size: rng.int(80_000, 900_000) }]
        : [],
    },
    requester,
    spec.createdAt,
  );
  const id = created.id;
  const respCal = businessCalendar(store, store.sla.get(id)!.response.calendarId);
  let t = spec.createdAt;

  // 1) Assignment manual (tim tanpa auto-assign): agent mengambil dari antrean.
  if (!current(store, id).assigneeId) {
    const team = created.teamId ? store.teams.get(created.teamId) : undefined;
    const agents = (team?.memberIds ?? [])
      .map((m) => requireUser(store, m))
      .filter((u) => u.role === 'agent');
    const tA = addBusinessMinutes(t, rng.int(2, 40), respCal);
    if (tA > now || agents.length === 0) return;
    const agent = rng.pick(agents);
    assignTicket(store, id, { assigneeId: agent.id }, agent, tA);
    t = tA;
  }
  const assignee = requireUser(store, current(store, id).assigneeId);

  // 2) Cancel (~3%).
  if (rng.chance(0.03)) {
    const tC = new Date(t.getTime() + rng.int(10, 180) * MIN);
    if (tC <= now)
      transitionTicket(store, id, 'cancelled', assignee, { reason: rng.pick(CANCEL_REASONS) }, tC);
    return;
  }

  // 3) First response (~10% terlambat → response breached).
  const response = store.sla.get(id)!.response;
  const f1 = rng.chance(0.9) ? 0.08 + rng.next() * 0.8 : 1.05 + rng.next() * 1.5;
  let tR = addBusinessMinutes(spec.createdAt, response.targetMinutes * f1, respCal);
  if (tR <= t) tR = new Date(t.getTime() + 2 * MIN);
  if (tR > now) return;
  if (rng.chance(0.5)) {
    addComment(store, id, assignee, rng.pick(FIRST_RESPONSES), 'public', tR);
    const tIp = new Date(tR.getTime() + rng.int(1, 20) * MIN);
    if (tIp > now) return;
    transitionTicket(store, id, 'in_progress', assignee, {}, tIp);
    t = tIp;
  } else {
    transitionTicket(store, id, 'in_progress', assignee, {}, tR);
    t = tR;
  }
  if (rng.chance(0.25)) {
    const tN = new Date(t.getTime() + rng.int(5, 60) * MIN);
    if (tN > now) return;
    addComment(store, id, assignee, rng.pick(INTERNAL_NOTES), 'internal', tN);
    t = tN;
  }

  // 4) Pending (~18%).
  if (rng.chance(0.18)) {
    const tP = new Date(t.getTime() + rng.int(10, 90) * MIN);
    if (tP > now) return;
    const reason = rng.weighted<PendingReason>([
      ['awaiting_user', 60],
      ['awaiting_vendor', 20],
      ['scheduled', 10],
      ['awaiting_change', 10],
    ]);
    if (reason === 'awaiting_user')
      addComment(store, id, assignee, rng.pick(ASK_USER), 'public', tP);
    transitionTicket(store, id, 'pending', assignee, { pendingReason: reason }, tP);
    const tU = addBusinessMinutes(tP, rng.int(30, 600), ctx.businessCal);
    if (tU > now) return;
    if (reason === 'awaiting_user')
      addComment(store, id, requester, rng.pick(USER_REPLIES), 'public', tU);
    else transitionTicket(store, id, 'in_progress', assignee, {}, tU);
    t = tU;
  }

  // 5) Resolve (~10% terlambat → resolution breached).
  const resolution = store.sla.get(id)!.resolution;
  const resCal = businessCalendar(store, resolution.calendarId);
  const f2 = rng.chance(0.9) ? 0.12 + rng.next() * 0.8 : 1.02 + rng.next() * 0.9;
  const elapsed = computeSlaState(resolution, t, resCal).elapsedMinutes;
  const tS = addBusinessMinutes(t, Math.max(10, resolution.targetMinutes * f2 - elapsed), resCal);
  if (tS > now) return;
  resolve(ctx, id, effectiveType, assignee, tS);
  t = tS;

  // 6) Reopen (~4%).
  if (rng.chance(0.04)) {
    const tO = new Date(t.getTime() + rng.int(2, 40) * HOUR);
    if (tO > now) return;
    transitionTicket(store, id, 'in_progress', requester, { reason: rng.pick(REOPEN_REASONS) }, tO);
    const tS2 = addBusinessMinutes(tO, rng.int(30, 480), resCal);
    if (tS2 > now) return;
    resolve(ctx, id, effectiveType, assignee, tS2);
    t = tS2;
  }

  // 7) CSAT & close: konfirmasi requester (~45%) atau auto-close 3 hari kerja.
  const autoCloseAt = addBusinessMinutes(t, AUTO_CLOSE_BUSINESS_MINUTES, ctx.businessCal);
  const gaveCsat = rng.chance(0.55);
  if (rng.chance(0.45)) {
    const tCf = new Date(t.getTime() + rng.int(1, 30) * HOUR);
    if (tCf > now || tCf >= autoCloseAt) return;
    if (gaveCsat) {
      const score = csatScore(rng);
      submitCsat(store, id, score, rng.pick(CSAT_COMMENTS[score] ?? ['']), requester, tCf);
    }
    transitionTicket(store, id, 'closed', requester, {}, new Date(tCf.getTime() + MIN));
    return;
  }
  const tCs = new Date(t.getTime() + rng.int(1, 20) * HOUR);
  if (gaveCsat && tCs <= now && tCs < autoCloseAt) {
    const score = csatScore(rng);
    submitCsat(store, id, score, rng.pick(CSAT_COMMENTS[score] ?? ['']), requester, tCs);
  }
  if (autoCloseAt <= now) transitionTicket(store, id, 'closed', null, {}, autoCloseAt);
}

/** Mencari instant `minutes` menit kerja sebelum `now` (binary search; fungsi monoton). */
function businessAgo(now: Date, minutes: number, cal: BusinessCalendar): Date {
  let lo = now.getTime() - 60 * DAY;
  let hi = now.getTime();
  for (let i = 0; i < 48; i++) {
    const mid = Math.floor((lo + hi) / 2);
    if (businessMinutesBetween(new Date(mid), now, cal) > minutes) lo = mid;
    else hi = mid;
  }
  return new Date(hi);
}

function generateHistory(ctx: SimContext): void {
  const { rng, now } = ctx;
  const specs: TicketSpec[] = [];
  const activeRequesters = ctx.requesters.filter((u) => u.isActive);

  for (let daysAgo = DAYS; daysAgo >= 0; daysAgo--) {
    const { start, weekday } = jakartaDay(now, daysAgo);
    const weekend = weekday === 0 || weekday === 6;
    const spike = daysAgo >= 34 && daysAgo <= 40 && !weekend; // minggu lonjakan VPN (bahan demo Problem)
    const volume = weekend ? rng.int(0, 2) : rng.int(8, 13);

    const push = (itemId: string): void => {
      const hour = weekend ? rng.int(8, 20) : rng.weighted(HOUR_WEIGHTS);
      const createdAt = new Date(
        start + hour * HOUR + rng.int(0, 59) * MIN + rng.int(0, 59) * 1000,
      );
      if (createdAt >= now) return;
      const item = requireItem(ctx.store, itemId);
      const priority = rng.weighted(
        item.ticketType === 'incident' ? INCIDENT_PRIORITY : REQUEST_PRIORITY,
      );
      const requesterId = rng.chance(0.04) ? 'usr-user' : rng.pick(activeRequesters).id;
      specs.push({ itemId, createdAt, requesterId, priority });
    };

    for (let i = 0; i < volume; i++) push(rng.weighted(ITEM_WEIGHTS));
    if (spike) for (let i = 0; i < rng.int(6, 9); i++) push('cat-item-network');
  }

  specs.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  for (const spec of specs) simulateTicket(ctx, spec);
}

/** Tiket skenario untuk akun demo agar setiap alur bisa langsung dicoba. */
function generateScenarios(ctx: SimContext): void {
  const { store, now, businessCal } = ctx;
  const ago = (m: number): Date => businessAgo(now, m, businessCal);
  const user = requireUser(store, 'usr-user');
  const agent = requireUser(store, 'usr-agent');
  const reqs = ctx.requesters.filter((u) => u.isActive && u.id !== 'usr-user');
  const create = (
    itemId: string,
    title: string,
    requester: UserRecord,
    urgency: Urgency,
    at: Date,
    impact?: Impact,
    serviceRequestType?: ServiceRequestType,
  ): TicketRecord => {
    const item = requireItem(store, itemId);
    const formData = formDataFor(item, ctx.rng);
    if (serviceRequestType) formData.service_request_type = serviceRequestType;
    return createTicket(
      store,
      {
        catalogItemId: itemId,
        title,
        description: `${item.description} Mohon segera dibantu.`,
        urgency,
        impact,
        formData,
      },
      requester,
      at,
    );
  };

  // A. Milik user demo, sedang dikerjakan agent demo.
  const a = create(
    'cat-item-pc-server',
    'Laptop tidak menyala setelah update Windows',
    user,
    'high',
    ago(150),
    undefined,
    'Problem',
  );
  assignTicket(store, a.id, { assigneeId: agent.id }, agent, ago(146));
  addComment(
    store,
    a.id,
    agent,
    'Halo, saya cek remote dulu ya. Mohon laptop dicolok charger.',
    'public',
    ago(120),
  );
  transitionTicket(store, a.id, 'in_progress', agent, {}, ago(118));
  addComment(
    store,
    a.id,
    agent,
    'BIOS terdeteksi, kemungkinan SSD. Siapkan unit pinjaman.',
    'internal',
    ago(60),
  );

  // B. Milik user demo, menunggu jawaban user.
  const b = create(
    'cat-item-network',
    'VPN putus setiap pagi jam 9',
    user,
    'medium',
    ago(420),
    undefined,
    'Problem',
  );
  const bAssignee = requireUser(store, current(store, b.id).assigneeId ?? 'usr-agent4');
  if (!current(store, b.id).assigneeId)
    assignTicket(store, b.id, { assigneeId: bAssignee.id }, bAssignee, ago(410));
  transitionTicket(store, b.id, 'in_progress', bAssignee, {}, ago(380));
  addComment(
    store,
    b.id,
    bAssignee,
    'Boleh kirimkan screenshot error saat VPN putus dan versi FortiClient Anda?',
    'public',
    ago(130),
  );
  transitionTicket(store, b.id, 'pending', bAssignee, { pendingReason: 'awaiting_user' }, ago(129));

  // C. Milik user demo, sudah Resolved → bisa konfirmasi / buka lagi / CSAT.
  const c = create(
    'cat-item-email',
    'Akun Email / Windows terkunci',
    user,
    'high',
    ago(700),
    undefined,
    'Access Rights',
  );
  const cAssignee = requireUser(store, current(store, c.id).assigneeId ?? 'usr-agent4');
  if (!current(store, c.id).assigneeId)
    assignTicket(store, c.id, { assigneeId: cAssignee.id }, cAssignee, ago(690));
  addComment(
    store,
    c.id,
    cAssignee,
    'Akun sudah saya unlock, silakan coba login kembali.',
    'public',
    ago(660),
  );
  transitionTicket(store, c.id, 'in_progress', cAssignee, {}, ago(659));
  transitionTicket(
    store,
    c.id,
    'resolved',
    cAssignee,
    { resolutionCode: 'fulfilled', resolutionNotes: 'Akun di-unlock dan password direset.' },
    ago(240),
  );

  // D. Agent demo: resolution P2 at risk.
  const d = create(
    'cat-item-core-system',
    'Core System gagal posting jurnal akhir bulan',
    rqPick(ctx, reqs),
    'high',
    ago(400),
    'medium',
    'Problem',
  );
  const dAssignee = current(store, d.id).assigneeId;
  if (dAssignee !== agent.id)
    assignTicket(
      store,
      d.id,
      { assigneeId: 'usr-agent6' },
      requireUser(store, 'usr-lead'),
      ago(396),
    );
  transitionTicket(store, d.id, 'in_progress', requireUser(store, 'usr-agent6'), {}, ago(390));

  const d2 = create(
    'cat-item-pc-server',
    'Laptop direksi hang saat presentasi',
    rqPick(ctx, reqs),
    'high',
    ago(390),
    'medium',
    'Problem',
  );
  assignTicket(store, d2.id, { assigneeId: agent.id }, agent, ago(388));
  transitionTicket(store, d2.id, 'in_progress', agent, {}, ago(380));

  // E. Agent demo: response breached (belum direspons).
  const e = create(
    'cat-item-printing',
    'Printer utama lantai 2 tidak merespons',
    rqPick(ctx, reqs),
    'high',
    ago(300),
    undefined,
    'Problem',
  );
  assignTicket(store, e.id, { assigneeId: agent.id }, agent, ago(297));

  // F. Antrean Unassigned Tim IT.
  create(
    'cat-item-pc-server',
    'PC kasir cabang tidak menyala',
    rqPick(ctx, reqs),
    'high',
    ago(18),
    'medium',
    'Problem',
  );
  create(
    'cat-item-others',
    'Konsultasi kebijakan backup data departemen',
    rqPick(ctx, reqs),
    'medium',
    ago(40),
    undefined,
    'Others',
  );
  create(
    'cat-item-software',
    'Install Power BI Desktop',
    rqPick(ctx, reqs),
    'low',
    ago(95),
    undefined,
    'New Request',
  );

  // G. P1 aktif jaringan (kalender 24×7).
  const g = create(
    'cat-item-network',
    'Internet kantor pusat mati total',
    rqPick(ctx, reqs),
    'high',
    new Date(now.getTime() - 100 * MIN),
    'high',
    'Problem',
  );
  const gAssignee = requireUser(store, current(store, g.id).assigneeId ?? 'usr-agent4');
  if (!current(store, g.id).assigneeId)
    assignTicket(store, g.id, { assigneeId: gAssignee.id }, gAssignee, new Date(now.getTime() - 98 * MIN));
  addComment(
    store,
    g.id,
    gAssignee,
    'Kami sedang investigasi gangguan ISP utama, failover sedang diaktifkan.',
    'public',
    new Date(now.getTime() - 92 * MIN),
  );
  transitionTicket(store, g.id, 'in_progress', gAssignee, {}, new Date(now.getTime() - 91 * MIN));
}

function rqPick(ctx: SimContext, users: UserRecord[]): UserRecord {
  return ctx.rng.pick(users);
}

function generateChanges(store: Store, now: Date, rng: Rng): void {
  for (let i = 0; i < 20; i++) {
    const startedAt = new Date(now.getTime() - (82 - i * 4) * DAY + rng.int(9, 16) * HOUR);
    const status: ChangeStatus = i === 6 ? 'rolled_back' : i === 14 ? 'failed' : 'succeeded';
    store.sequences.change += 1;
    store.changes.push({
      id: nextId(store, 'chg'),
      number: `CHG-${String(store.sequences.change).padStart(6, '0')}`,
      type: 'standard',
      title: `Deploy Sigap v0.${i + 1}.0`,
      status,
      source: 'pipeline',
      commitSha: (0x1a2b3c4 + i * 7919).toString(16).slice(0, 7),
      environment: 'local-production',
      startedAt,
      finishedAt: new Date(startedAt.getTime() + rng.int(2, 9) * MIN),
      metadata: { fromVersion: `v0.${i}.0`, toVersion: `v0.${i + 1}.0` },
    });
  }
}

/**
 * Mengisi store dengan data referensi + histori deterministik.
 * @param store - store kosong
 * @param now - waktu seed; semua tanggal relatif terhadapnya
 */
export function seedStore(store: Store, now: Date): void {
  const createdAt = new Date(now.getTime() - (DAYS + 30) * DAY);
  for (const u of buildUsers(createdAt)) store.users.set(u.id, u);
  for (const t of buildTeams(createdAt)) store.teams.set(t.id, t);
  for (const c of buildCategories()) store.categories.set(c.id, c);
  for (const i of buildCatalog()) store.catalog.set(i.id, i);
  for (const c of buildCalendars()) store.calendars.set(c.id, c);
  store.holidays = buildHolidays();
  for (const p of buildSlaPolicies(createdAt)) store.policies.set(p.id, p);

  const ctx: SimContext = {
    store,
    rng: createRng(SEED),
    now,
    businessCal: businessCalendar(store, CAL_BUSINESS),
    requesters: [...store.users.values()].filter((u) => u.role === 'requester'),
  };
  generateHistory(ctx);
  generateScenarios(ctx);
  generateChanges(store, now, ctx.rng);
  runSlaTick(store, now);
  store.mailOutbox = []; // data demo tidak mengirim email

  // Notifikasi lama dianggap sudah dibaca; login terakhir staff realistis.
  for (const n of store.notifications) {
    if (now.getTime() - n.createdAt.getTime() > 20 * HOUR) n.readAt = n.createdAt;
  }
  for (const u of store.users.values()) {
    if (u.role !== 'requester') u.lastLoginAt = new Date(now.getTime() - ctx.rng.int(1, 30) * HOUR);
  }
}
