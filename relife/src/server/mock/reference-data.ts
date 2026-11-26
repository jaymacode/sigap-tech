import { DEFAULT_TIMEZONE, DEFAULT_WORK_HOURS } from '@/domain/calendar';
import { DEMO_PASSWORD } from '@/domain/demo';
import { SERVICE_REQUEST_TYPES, type Role } from '@/domain/types';
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
 * Data referensi seed (DATA_MODEL.md §Seed): 1 admin, 1 Head IT (lead), 7 anggota IT (agent),
 * 40 requester, 1 Tim IT, kategori 2 level, 15 item katalog, kalender, libur nasional, SLA policy.
 */

export const CAL_BUSINESS = 'cal-business';
export const CAL_24X7 = 'cal-24x7';

/** Satu-satunya tim: Tim IT (Head IT + anggota). */
export const TEAM_IT = 'team-it';

export const POLICY_INCIDENT = 'pol-incident';
export const POLICY_REQUEST = 'pol-request';
export const POLICY_NEW_ACCOUNT = 'pol-new-account';

const STAFF: ReadonlyArray<[id: string, email: string, name: string, role: Role, dept: string]> = [
  ['usr-admin', 'admin@sigap.demo', 'Andi Pratama', 'admin', 'IT'],
  ['usr-lead', 'lead@sigap.demo', 'Rina Kusuma', 'lead', 'IT'],
  ['usr-lead2', 'bayu.santoso@sigap.demo', 'Bayu Santoso', 'agent', 'IT'],
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
      id: TEAM_IT,
      name: 'Tim IT',
      description: 'Tim IT CTII: Head IT dan anggota.',
      leadId: 'usr-lead',
      // Head IT yang membagi tiket; auto-assign bisa diaktifkan dari Admin › Tim.
      autoAssign: false,
      memberIds: STAFF.filter(([, , , role]) => role === 'agent').map(([id]) => id),
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
    c('cat-pc-server', 'PC / Server', null, TEAM_IT),
    c('cat-share-folder', 'Share Folder', null, TEAM_IT),
    c('cat-software', 'Software', null, TEAM_IT),
    c('cat-email', 'Email', null, TEAM_IT),
    c('cat-printing', 'Printing Service', null, TEAM_IT),
    c('cat-network', 'Network', null, TEAM_IT),
    c('cat-core-system', 'Core System', null, TEAM_IT),
    c('cat-report-system', 'Report System', null, TEAM_IT),
    c('cat-others', 'Others', null, TEAM_IT),
  ];
}

const SERVICE_REQUEST_TYPE_FIELD = {
  key: 'service_request_type',
  label: 'Service Request Type',
  type: 'select' as const,
  required: true,
  options: [...SERVICE_REQUEST_TYPES],
};

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
      'cat-item-pc-server',
      'PC / Server',
      'Perangkat PC, laptop, monitor, periferal, atau server.',
      'laptop',
      'incident',
      'cat-pc-server',
      'medium',
      [
        SERVICE_REQUEST_TYPE_FIELD,
        {
          key: 'asset_tag',
          label: 'Nomor Aset / Hostname',
          type: 'text',
          required: false,
          placeholder: 'AST-12345 / PC-FIN-01',
        },
        { ...LOCATION_FIELD, required: false },
      ],
      ['pc', 'server', 'laptop', 'desktop', 'monitor', 'komputer', 'hardware', 'hang', 'mati'],
    ),
    item(
      'cat-item-share-folder',
      'Share Folder',
      'Akses, pembuatan, izin baca/tulis, atau kendala folder bersama.',
      'folder',
      'service_request',
      'cat-share-folder',
      'low',
      [
        SERVICE_REQUEST_TYPE_FIELD,
        {
          key: 'folder_path',
          label: 'Path / Nama Share Folder',
          type: 'text',
          required: false,
          placeholder: '\\\\fileserver\\Finance\\2026',
        },
        {
          key: 'access_level',
          label: 'Tingkat Akses',
          type: 'select',
          required: false,
          options: ['Read Only', 'Read & Write', 'Full Control'],
        },
      ],
      ['share', 'folder', 'shared', 'drive', 'permission', 'akses', 'nas', 'file'],
    ),
    item(
      'cat-item-software',
      'Software',
      'Instalasi, pembaruan, lisensi, atau kendala aplikasi kerja.',
      'wrench',
      'service_request',
      'cat-software',
      'low',
      [
        SERVICE_REQUEST_TYPE_FIELD,
        {
          key: 'software_name',
          label: 'Nama Software / Aplikasi',
          type: 'text',
          required: false,
          placeholder: 'Mis. Microsoft Office, Adobe Acrobat',
        },
        {
          key: 'asset_tag',
          label: 'Nomor Aset Perangkat',
          type: 'text',
          required: false,
          placeholder: 'AST-12345',
        },
      ],
      ['software', 'aplikasi', 'install', 'lisensi', 'office', 'excel', 'adobe', 'program'],
    ),
    item(
      'cat-item-email',
      'Email',
      'Akun email, Outlook/Webmail, grup distribusi, atau kendala kirim/terima.',
      'mail',
      'incident',
      'cat-email',
      'low',
      [
        SERVICE_REQUEST_TYPE_FIELD,
        {
          key: 'email_client',
          label: 'Aplikasi Email',
          type: 'select',
          required: false,
          options: ['Outlook Desktop', 'Webmail', 'Mobile / Ponsel'],
        },
      ],
      ['email', 'outlook', 'webmail', 'mailbox', 'mail', 'password', 'grup'],
    ),
    item(
      'cat-item-printing',
      'Printing Service',
      'Printer, scanner, fotokopi, koneksi cetak, atau penggantian toner.',
      'printer',
      'incident',
      'cat-printing',
      'low',
      [
        SERVICE_REQUEST_TYPE_FIELD,
        {
          key: 'printer_name',
          label: 'Nama / Lokasi Printer',
          type: 'text',
          required: false,
          placeholder: 'PRN-LT2-HR',
        },
        { ...LOCATION_FIELD, required: false },
      ],
      ['printing', 'printer', 'cetak', 'scan', 'scanner', 'toner', 'kertas'],
    ),
    item(
      'cat-item-network',
      'Network',
      'WiFi, LAN, internet kantor, koneksi VPN, atau akses jaringan.',
      'wifi',
      'incident',
      'cat-network',
      'medium',
      [
        SERVICE_REQUEST_TYPE_FIELD,
        {
          key: 'connection_type',
          label: 'Jenis Koneksi',
          type: 'select',
          required: false,
          options: ['WiFi Kantor', 'LAN / Kabel', 'VPN Remote', 'Lainnya'],
        },
        { ...LOCATION_FIELD, required: false },
      ],
      ['network', 'jaringan', 'wifi', 'lan', 'internet', 'vpn', 'koneksi', 'putus'],
    ),
    item(
      'cat-item-core-system',
      'Core System',
      'Sistem inti bisnis, modul transaksi, enhancement, atau hak akses sistem.',
      'database',
      'incident',
      'cat-core-system',
      'high',
      [
        SERVICE_REQUEST_TYPE_FIELD,
        {
          key: 'module_name',
          label: 'Modul / Menu Terkait',
          type: 'text',
          required: false,
          placeholder: 'Mis. Underwriting, Finance, Claims',
        },
      ],
      ['core', 'system', 'sistem', 'erp', 'transaksi', 'modul', 'aplikasi bisnis', 'polis'],
    ),
    item(
      'cat-item-report-system',
      'Report System',
      'Pembuatan laporan, penarikan data (data extraction), atau error report.',
      'barChart',
      'service_request',
      'cat-report-system',
      'medium',
      [
        SERVICE_REQUEST_TYPE_FIELD,
        {
          key: 'report_name',
          label: 'Nama Laporan / Data',
          type: 'text',
          required: false,
          placeholder: 'Mis. Laporan Produksi Bulanan',
        },
        {
          key: 'period',
          label: 'Periode Data',
          type: 'text',
          required: false,
          placeholder: 'Mis. Jan–Okt 2026',
        },
      ],
      ['report', 'laporan', 'reporting', 'data', 'ekstraksi', 'extraction', 'dashboard', 'bi'],
    ),
    item(
      'cat-item-others',
      'Others',
      'Permintaan layanan atau kendala IT lainnya di luar kategori di atas.',
      'help',
      'service_request',
      'cat-others',
      'low',
      [
        SERVICE_REQUEST_TYPE_FIELD,
        {
          key: 'other_topic',
          label: 'Topik / Layanan Terkait',
          type: 'text',
          required: false,
          placeholder: 'Sebutkan topik layanan atau perangkat',
        },
      ],
      ['others', 'lainnya', 'lain', 'bantuan', 'konsultasi', 'pertanyaan'],
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
