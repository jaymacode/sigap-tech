import { DEFAULT_TIMEZONE, DEFAULT_WORK_HOURS } from '@/domain/calendar';
import { DEMO_PASSWORD } from '@/domain/demo';
import type { Role } from '@/domain/types';
import { hashPassword } from '@/server/auth/credentials';
import type {
  CalendarRecord,
  CatalogItemRecord,
  CategoryRecord,
  HolidayRecord,
  SlaPolicyRecord,
  TeamRecord,
  UserRecord,
} from './types';

/**
 * Data referensi seed (DATA_MODEL.md §Seed): 1 admin, 2 lead, 6 agent, 40 requester,
 * 3 tim, kategori 2 level, 15 item katalog, kalender, libur nasional, SLA policy.
 */

export const DEMO_ACCOUNTS = [
  { email: 'user@sigap.demo', role: 'requester', label: 'Requester' },
  { email: 'agent@sigap.demo', role: 'agent', label: 'Agent L1' },
  { email: 'lead@sigap.demo', role: 'lead', label: 'Team Lead' },
  { email: 'admin@sigap.demo', role: 'admin', label: 'Admin' },
] as const satisfies ReadonlyArray<{ email: string; role: Role; label: string }>;

export const CAL_BUSINESS = 'cal-business';
export const CAL_24X7 = 'cal-24x7';

export const TEAM_L1 = 'team-l1';
export const TEAM_INFRA = 'team-infra';
export const TEAM_APPS = 'team-apps';

export const POLICY_INCIDENT = 'pol-incident';
export const POLICY_REQUEST = 'pol-request';
export const POLICY_NEW_ACCOUNT = 'pol-new-account';

const STAFF: ReadonlyArray<[id: string, email: string, name: string, role: Role, dept: string]> = [
  ['usr-admin', 'admin@sigap.demo', 'Andi Pratama', 'admin', 'IT'],
  ['usr-lead', 'lead@sigap.demo', 'Rina Kusuma', 'lead', 'IT'],
  ['usr-lead2', 'bayu.santoso@sigap.demo', 'Bayu Santoso', 'lead', 'IT'],
  ['usr-agent', 'agent@sigap.demo', 'Dimas Saputra', 'agent', 'IT'],
  ['usr-agent2', 'sari.wulandari@sigap.demo', 'Sari Wulandari', 'agent', 'IT'],
  ['usr-agent3', 'fajar.nugroho@sigap.demo', 'Fajar Nugroho', 'agent', 'IT'],
  ['usr-agent4', 'eko.prasetyo@sigap.demo', 'Eko Prasetyo', 'agent', 'IT'],
  ['usr-agent5', 'maya.anggraini@sigap.demo', 'Maya Anggraini', 'agent', 'IT'],
  ['usr-agent6', 'hendra.wijaya@sigap.demo', 'Hendra Wijaya', 'agent', 'IT'],
];

const REQUESTER_NAMES = [
  'Putri Maharani',
  'Agus Setiawan',
  'Lestari Handayani',
  'Rudi Hartono',
  'Nadia Safitri',
  'Yoga Firmansyah',
  'Intan Permata',
  'Bambang Sutrisno',
  'Citra Ayu',
  'Teguh Wibowo',
  'Wulan Sari',
  'Arif Rahman',
  'Dian Puspita',
  'Galih Pamungkas',
  'Fitri Rahayu',
  'Irfan Hakim',
  'Kartika Dewi',
  'Joko Susilo',
  'Melati Indah',
  'Reza Mahendra',
  'Siti Aminah',
  'Taufik Hidayat',
  'Ratna Sari',
  'Wahyu Kurniawan',
  'Novi Andriani',
  'Hadi Purnomo',
  'Ayu Lestari',
  'Gilang Ramadhan',
  'Eka Saputri',
  'Doni Kusnadi',
  'Mega Utami',
  'Rizky Pratama',
  'Anisa Rahma',
  'Bagus Hermawan',
  'Laras Ningrum',
  'Yudi Setiadi',
  'Tika Amalia',
  'Fikri Maulana',
  'Sinta Oktaviani',
  'Raka Aditya',
];

const DEPARTMENTS = [
  'Keuangan',
  'HR',
  'Sales',
  'Marketing',
  'Operasional',
  'Legal',
  'Procurement',
  'Customer Care',
];

function slugEmail(name: string): string {
  return `${name
    .toLowerCase()
    .replace(/[^a-z]+/g, '.')
    .replace(/^\.|\.$/g, '')}@sigap.demo`;
}

/**
 * Membuat daftar user seed.
 * @param createdAt - waktu pembuatan (relatif waktu seed)
 */
export function buildUsers(createdAt: Date): UserRecord[] {
  const staff = STAFF.map(([id, email, name, role, department]) => ({
    id,
    email,
    name,
    role,
    department,
    isActive: true,
    passwordHash: hashPassword(DEMO_PASSWORD),
    lastLoginAt: null,
    createdAt,
  }));
  const requesters = REQUESTER_NAMES.map((name, i) => ({
    id: i === 0 ? 'usr-user' : `usr-req-${String(i).padStart(2, '0')}`,
    email: i === 0 ? 'user@sigap.demo' : slugEmail(name),
    name,
    role: 'requester' as const,
    department: DEPARTMENTS[i % DEPARTMENTS.length] ?? 'Umum',
    isActive: i !== 39, // satu user nonaktif untuk contoh admin
    passwordHash: hashPassword(DEMO_PASSWORD),
    lastLoginAt: null,
    createdAt,
  }));
  return [...staff, ...requesters];
}

export function buildTeams(createdAt: Date): TeamRecord[] {
  return [
    {
      id: TEAM_L1,
      name: 'Service Desk L1',
      description: 'Titik kontak pertama: akun, perangkat, permintaan standar.',
      leadId: 'usr-lead',
      autoAssign: false,
      memberIds: ['usr-agent', 'usr-agent2', 'usr-agent3'],
      createdAt,
    },
    {
      id: TEAM_INFRA,
      name: 'Infrastructure',
      description: 'Jaringan, VPN, server, dan email.',
      leadId: 'usr-lead2',
      autoAssign: true,
      memberIds: ['usr-agent4', 'usr-agent5'],
      createdAt,
    },
    {
      id: TEAM_APPS,
      name: 'Applications',
      description: 'Aplikasi bisnis (ERP, HRIS) dan integrasi.',
      leadId: 'usr-lead2',
      autoAssign: false,
      memberIds: ['usr-agent5', 'usr-agent6'],
      createdAt,
    },
  ];
}

export function buildCategories(): CategoryRecord[] {
  const c = (
    id: string,
    name: string,
    parentId: string | null,
    team: string | null,
  ): CategoryRecord => ({
    id,
    name,
    parentId,
    defaultTeamId: team,
    isActive: true,
  });
  return [
    c('cat-hardware', 'Perangkat Keras', null, TEAM_L1),
    c('cat-laptop', 'Laptop & PC', 'cat-hardware', TEAM_L1),
    c('cat-printer', 'Printer & Periferal', 'cat-hardware', TEAM_L1),
    c('cat-network', 'Jaringan', null, TEAM_INFRA),
    c('cat-vpn', 'VPN', 'cat-network', TEAM_INFRA),
    c('cat-wifi', 'WiFi & LAN', 'cat-network', TEAM_INFRA),
    c('cat-access', 'Akun & Akses', null, TEAM_L1),
    c('cat-password', 'Password', 'cat-access', TEAM_L1),
    c('cat-account', 'Akun Baru', 'cat-access', TEAM_L1),
    c('cat-app-access', 'Akses Aplikasi', 'cat-access', TEAM_APPS),
    c('cat-email', 'Email & Kolaborasi', null, TEAM_INFRA),
    c('cat-apps', 'Aplikasi Bisnis', null, TEAM_APPS),
    c('cat-erp', 'ERP', 'cat-apps', TEAM_APPS),
    c('cat-software', 'Software', null, TEAM_L1),
  ];
}

const LOCATION_FIELD = {
  key: 'location',
  label: 'Lokasi Anda',
  type: 'select' as const,
  required: true,
  options: [
    'Kantor Pusat — Lt. 1',
    'Kantor Pusat — Lt. 2',
    'Kantor Pusat — Lt. 3',
    'Cabang Surabaya',
    'Cabang Bandung',
    'Remote / WFH',
  ],
};

export function buildCatalog(): CatalogItemRecord[] {
  const item = (
    id: string,
    name: string,
    description: string,
    icon: string,
    ticketType: 'incident' | 'service_request',
    categoryId: string,
    defaultImpact: 'low' | 'medium' | 'high',
    formSchema: CatalogItemRecord['formSchema'],
    keywords: string[],
    slaPolicyId: string | null = null,
  ): CatalogItemRecord => ({
    id,
    name,
    description,
    icon,
    ticketType,
    categoryId,
    defaultImpact,
    formSchema,
    slaPolicyId,
    isActive: true,
    keywords,
  });

  return [
    item(
      'cat-item-laptop-dead',
      'Laptop tidak menyala',
      'Laptop/PC mati total, tidak bisa booting, atau layar hitam.',
      'laptop',
      'incident',
      'cat-laptop',
      'low',
      [
        {
          key: 'asset_tag',
          label: 'Nomor aset (stiker di bawah laptop)',
          type: 'text',
          required: false,
          placeholder: 'AST-12345',
        },
        LOCATION_FIELD,
        { key: 'since', label: 'Sejak kapan?', type: 'date', required: false },
      ],
      ['laptop', 'pc', 'mati', 'booting', 'layar'],
    ),
    item(
      'cat-item-laptop-slow',
      'Laptop lambat / sering hang',
      'Performa menurun, aplikasi sering not responding.',
      'gauge',
      'incident',
      'cat-laptop',
      'low',
      [{ key: 'asset_tag', label: 'Nomor aset', type: 'text', required: false }, LOCATION_FIELD],
      ['lambat', 'hang', 'lemot', 'freeze'],
    ),
    item(
      'cat-item-printer',
      'Printer bermasalah',
      'Tidak bisa mencetak, kertas macet, atau hasil cetak buruk.',
      'printer',
      'incident',
      'cat-printer',
      'medium',
      [
        {
          key: 'printer_name',
          label: 'Nama/lokasi printer',
          type: 'text',
          required: true,
          placeholder: 'PRN-LT2-HR',
        },
        LOCATION_FIELD,
      ],
      ['printer', 'cetak', 'scan', 'kertas'],
    ),
    item(
      'cat-item-vpn',
      'VPN tidak bisa terhubung',
      'Gagal konek VPN kantor atau sering terputus.',
      'shield',
      'incident',
      'cat-vpn',
      'medium',
      [
        {
          key: 'vpn_client',
          label: 'Aplikasi VPN',
          type: 'select',
          required: true,
          options: ['FortiClient', 'OpenVPN', 'Tidak tahu'],
        },
        {
          key: 'error_message',
          label: 'Pesan error (jika ada)',
          type: 'textarea',
          required: false,
        },
      ],
      ['vpn', 'remote', 'wfh', 'koneksi'],
    ),
    item(
      'cat-item-wifi',
      'WiFi / internet kantor bermasalah',
      'Tidak ada koneksi, lambat, atau sering putus di area kantor.',
      'wifi',
      'incident',
      'cat-wifi',
      'medium',
      [LOCATION_FIELD],
      ['wifi', 'internet', 'lan', 'jaringan'],
    ),
    item(
      'cat-item-email',
      'Email tidak bisa kirim/terima',
      'Masalah Outlook/webmail, kotak masuk penuh, atau email tertahan.',
      'mail',
      'incident',
      'cat-email',
      'low',
      [
        {
          key: 'client',
          label: 'Aplikasi email',
          type: 'select',
          required: true,
          options: ['Outlook Desktop', 'Webmail', 'Ponsel'],
        },
      ],
      ['email', 'outlook', 'mailbox'],
    ),
    item(
      'cat-item-erp',
      'Aplikasi ERP error',
      'Error saat transaksi, laporan tidak muncul, atau modul tidak bisa dibuka.',
      'boxes',
      'incident',
      'cat-erp',
      'medium',
      [
        {
          key: 'module',
          label: 'Modul',
          type: 'select',
          required: true,
          options: ['Finance', 'Procurement', 'Inventory', 'Sales'],
        },
        { key: 'error_message', label: 'Pesan error', type: 'textarea', required: false },
      ],
      ['erp', 'sap', 'transaksi', 'laporan'],
    ),
    item(
      'cat-item-monitor',
      'Monitor / periferal rusak',
      'Monitor, keyboard, mouse, atau docking station bermasalah.',
      'monitor',
      'incident',
      'cat-printer',
      'low',
      [
        {
          key: 'device',
          label: 'Perangkat',
          type: 'select',
          required: true,
          options: ['Monitor', 'Keyboard', 'Mouse', 'Docking station', 'Headset'],
        },
        LOCATION_FIELD,
      ],
      ['monitor', 'mouse', 'keyboard'],
    ),
    item(
      'cat-item-password',
      'Reset password',
      'Lupa password atau akun terkunci (email, Windows, aplikasi).',
      'key-round',
      'service_request',
      'cat-password',
      'low',
      [
        {
          key: 'system',
          label: 'Sistem',
          type: 'select',
          required: true,
          options: ['Windows / email', 'ERP', 'HRIS', 'VPN'],
        },
      ],
      ['password', 'lupa', 'terkunci', 'locked'],
    ),
    item(
      'cat-item-new-account',
      'Akun karyawan baru',
      'Pembuatan akun email, Windows, dan akses dasar untuk karyawan baru.',
      'user-plus',
      'service_request',
      'cat-account',
      'low',
      [
        { key: 'employee_name', label: 'Nama karyawan baru', type: 'text', required: true },
        { key: 'start_date', label: 'Tanggal mulai kerja', type: 'date', required: true },
        {
          key: 'department',
          label: 'Departemen',
          type: 'select',
          required: true,
          options: DEPARTMENTS,
        },
      ],
      ['akun', 'karyawan baru', 'onboarding'],
      POLICY_NEW_ACCOUNT,
    ),
    item(
      'cat-item-app-access',
      'Akses aplikasi / folder',
      'Permintaan hak akses ke aplikasi, shared folder, atau grup.',
      'folder-lock',
      'service_request',
      'cat-app-access',
      'low',
      [
        { key: 'resource', label: 'Aplikasi / folder yang diminta', type: 'text', required: true },
        { key: 'justification', label: 'Alasan kebutuhan', type: 'textarea', required: true },
      ],
      ['akses', 'folder', 'permission', 'hak akses'],
    ),
    item(
      'cat-item-software',
      'Install software',
      'Instalasi aplikasi standar atau berlisensi.',
      'package',
      'service_request',
      'cat-software',
      'low',
      [
        {
          key: 'software',
          label: 'Nama software',
          type: 'text',
          required: true,
          placeholder: 'mis. Adobe Acrobat',
        },
        { key: 'asset_tag', label: 'Nomor aset laptop', type: 'text', required: false },
      ],
      ['install', 'software', 'aplikasi', 'lisensi'],
    ),
    item(
      'cat-item-new-device',
      'Permintaan perangkat baru',
      'Laptop pengganti, monitor tambahan, atau aksesoris.',
      'hard-drive',
      'service_request',
      'cat-laptop',
      'low',
      [
        {
          key: 'device',
          label: 'Perangkat',
          type: 'select',
          required: true,
          options: ['Laptop', 'Monitor', 'Headset', 'Docking station'],
        },
        { key: 'justification', label: 'Alasan kebutuhan', type: 'textarea', required: true },
      ],
      ['perangkat', 'laptop baru', 'monitor'],
    ),
    item(
      'cat-item-vpn-access',
      'Akses VPN baru',
      'Aktivasi akses VPN untuk kerja remote.',
      'globe-lock',
      'service_request',
      'cat-vpn',
      'low',
      [{ key: 'until', label: 'Dibutuhkan sampai', type: 'date', required: false }],
      ['vpn', 'akses', 'remote'],
    ),
    item(
      'cat-item-other',
      'Pertanyaan / layanan lain',
      'Tidak menemukan layanan yang sesuai? Ceritakan kebutuhan Anda.',
      'circle-help',
      'service_request',
      'cat-software',
      'low',
      [],
      ['lain', 'pertanyaan', 'bantuan'],
    ),
  ];
}

export function buildCalendars(): CalendarRecord[] {
  return [
    {
      id: CAL_BUSINESS,
      name: 'Jam Kerja Jakarta',
      kind: 'business_hours',
      timezone: DEFAULT_TIMEZONE,
      workHours: DEFAULT_WORK_HOURS,
    },
    { id: CAL_24X7, name: '24×7', kind: '24x7', timezone: DEFAULT_TIMEZONE, workHours: {} },
  ];
}

/** Libur nasional Indonesia (contoh seed; admin dapat mengubah). */
export function buildHolidays(): HolidayRecord[] {
  const list: Array<[string, string]> = [
    ['2026-01-01', 'Tahun Baru Masehi'],
    ['2026-01-16', 'Isra Mikraj'],
    ['2026-02-17', 'Tahun Baru Imlek'],
    ['2026-03-19', 'Hari Suci Nyepi'],
    ['2026-03-20', 'Idul Fitri'],
    ['2026-03-23', 'Cuti Bersama Idul Fitri'],
    ['2026-04-03', 'Wafat Yesus Kristus'],
    ['2026-05-01', 'Hari Buruh'],
    ['2026-05-14', 'Kenaikan Yesus Kristus'],
    ['2026-05-27', 'Idul Adha'],
    ['2026-06-01', 'Hari Lahir Pancasila'],
    ['2026-06-16', 'Tahun Baru Islam'],
    ['2026-08-17', 'Hari Kemerdekaan RI'],
    ['2026-08-25', 'Maulid Nabi Muhammad'],
    ['2026-12-25', 'Hari Raya Natal'],
    ['2027-01-01', 'Tahun Baru Masehi'],
  ];
  return list.map(([date, name]) => ({ id: `hol-${date}`, calendarId: CAL_BUSINESS, date, name }));
}

export function buildSlaPolicies(updatedAt: Date): SlaPolicyRecord[] {
  return [
    {
      id: POLICY_INCIDENT,
      name: 'Incident — Default',
      ticketType: 'incident',
      isDefault: true,
      version: 1,
      updatedAt,
      targets: [
        { priority: 'P1', responseMinutes: 15, resolutionMinutes: 240, calendarId: CAL_24X7 },
        { priority: 'P2', responseMinutes: 30, resolutionMinutes: 480, calendarId: CAL_BUSINESS },
        { priority: 'P3', responseMinutes: 240, resolutionMinutes: 1440, calendarId: CAL_BUSINESS },
        { priority: 'P4', responseMinutes: 480, resolutionMinutes: 2400, calendarId: CAL_BUSINESS },
      ],
    },
    {
      id: POLICY_REQUEST,
      name: 'Service Request — Default',
      ticketType: 'service_request',
      isDefault: true,
      version: 1,
      updatedAt,
      targets: [
        { priority: 'P3', responseMinutes: 240, resolutionMinutes: 1440, calendarId: CAL_BUSINESS },
        { priority: 'P4', responseMinutes: 480, resolutionMinutes: 2400, calendarId: CAL_BUSINESS },
      ],
    },
    {
      id: POLICY_NEW_ACCOUNT,
      name: 'Akun Baru (2 hari kerja)',
      ticketType: 'service_request',
      isDefault: false,
      version: 1,
      updatedAt,
      targets: [
        { priority: 'P3', responseMinutes: 240, resolutionMinutes: 960, calendarId: CAL_BUSINESS },
        { priority: 'P4', responseMinutes: 480, resolutionMinutes: 960, calendarId: CAL_BUSINESS },
      ],
    },
  ];
}
