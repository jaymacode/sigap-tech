import type { BusinessCalendar } from '@/domain/calendar';
import type {
  AttachmentRecord,
  CalendarRecord,
  CatalogItemRecord,
  CategoryRecord,
  ChangeRecord,
  CommentRecord,
  CsatRecord,
  HolidayRecord,
  NotificationRecord,
  Sequences,
  SlaInstanceRecord,
  SlaPolicyRecord,
  TeamRecord,
  TicketEventRecord,
  TicketRecord,
  UserRecord,
} from './types';

/**
 * Store in-memory pengganti PostgreSQL untuk fase frontend (ADR-005).
 * Struktur Map per tabel memberi lookup O(1) seperti index PK.
 */
export interface Store {
  users: Map<string, UserRecord>;
  teams: Map<string, TeamRecord>;
  categories: Map<string, CategoryRecord>;
  catalog: Map<string, CatalogItemRecord>;
  calendars: Map<string, CalendarRecord>;
  holidays: HolidayRecord[];
  policies: Map<string, SlaPolicyRecord>;
  tickets: Map<string, TicketRecord>;
  ticketIdByNumber: Map<string, string>;
  sla: Map<string, { response: SlaInstanceRecord; resolution: SlaInstanceRecord }>;
  events: Map<string, TicketEventRecord[]>;
  comments: Map<string, CommentRecord[]>;
  attachments: Map<string, AttachmentRecord[]>;
  csat: Map<string, CsatRecord>;
  notifications: NotificationRecord[];
  changes: ChangeRecord[];
  sequences: Sequences;
  seededAt: Date;
  workerLastTick: Date | null;
  failedJobs: number;
  idCounter: number;
  /** Cache kalender bisnis (di-reset saat admin mengubah kalender/libur). */
  calendarCache: Map<string, BusinessCalendar>;
}

/**
 * Membuat store kosong.
 * @param seededAt - waktu pembuatan store
 */
export function createEmptyStore(seededAt: Date): Store {
  return {
    users: new Map(),
    teams: new Map(),
    categories: new Map(),
    catalog: new Map(),
    calendars: new Map(),
    holidays: [],
    policies: new Map(),
    tickets: new Map(),
    ticketIdByNumber: new Map(),
    sla: new Map(),
    events: new Map(),
    comments: new Map(),
    attachments: new Map(),
    csat: new Map(),
    notifications: [],
    changes: [],
    sequences: { incident: 0, request: 0, change: 0 },
    seededAt,
    workerLastTick: null,
    failedJobs: 0,
    idCounter: 0,
    calendarCache: new Map(),
  };
}

/**
 * ID unik berurutan dengan prefix (pengganti `gen_random_uuid()`).
 * @param store - store
 * @param prefix - prefix entitas, mis. `evt`
 */
export function nextId(store: Store, prefix: string): string {
  store.idCounter += 1;
  return `${prefix}-${store.idCounter.toString(36).padStart(6, '0')}`;
}

/**
 * Menghasilkan nomor perubahan urut berikutnya (CHG-000001).
 */
export function nextChangeNumber(store: Store): string {
  store.sequences.change += 1;
  return `CHG-${String(store.sequences.change).padStart(6, '0')}`;
}

/**
 * Kalender bisnis untuk perhitungan domain.
 * @param store - store
 * @param calendarId - id kalender
 * @throws Error jika kalender tidak ditemukan (data rusak)
 */
export function businessCalendar(store: Store, calendarId: string): BusinessCalendar {
  const cached = store.calendarCache.get(calendarId);
  if (cached) return cached;
  const record = store.calendars.get(calendarId);
  if (!record) throw new Error(`Kalender ${calendarId} tidak ditemukan`);
  const calendar: BusinessCalendar = {
    kind: record.kind,
    timezone: record.timezone,
    workHours: record.workHours,
    holidays: store.holidays.filter((h) => h.calendarId === calendarId).map((h) => h.date),
  };
  store.calendarCache.set(calendarId, calendar);
  return calendar;
}

/** Mengosongkan cache kalender setelah perubahan jam kerja / libur. */
export function invalidateCalendars(store: Store): void {
  store.calendarCache.clear();
}

/** Daftar helper per-tiket yang selalu mengembalikan array (tidak pernah undefined). */
export function listFor<T>(map: Map<string, T[]>, ticketId: string): T[] {
  let list = map.get(ticketId);
  if (!list) {
    list = [];
    map.set(ticketId, list);
  }
  return list;
}
