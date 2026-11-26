import { mailOutboxStats, type MailOutboxStats } from '@/server/mail/worker';
import { getStore } from '@/server/mock/db';
import type {
  CalendarRecord,
  CatalogItemRecord,
  CategoryRecord,
  HolidayRecord,
  SlaPolicyRecord,
  TeamRecord,
  UserRecord,
} from '@/server/mock/types';

export interface SystemStats {
  totalTickets: number;
  totalUsers: number;
  totalTeams: number;
  totalComments: number;
  totalEvents: number;
  workerLastTick: string | null;
  seedTime: string;
  /** Tiket terbuka dengan SLA resolusi sedang berjalan. */
  slaRunning: number;
  /** Tiket terbuka dengan SLA (respons/resolusi) yang sudah breach. */
  slaBreached: number;
  mail: MailOutboxStats;
}

export interface AdminData {
  users: UserRecord[];
  teams: TeamRecord[];
  categories: CategoryRecord[];
  catalog: CatalogItemRecord[];
  policies: SlaPolicyRecord[];
  holidays: HolidayRecord[];
  calendars: CalendarRecord[];
  stats: SystemStats;
}

/**
 * Mengambil semua dataset manajemen untuk halaman admin.
 */
export function getAdminData(): AdminData {
  const store = getStore();

  let totalComments = 0;
  for (const list of store.comments.values()) totalComments += list.length;

  let totalEvents = 0;
  for (const list of store.events.values()) totalEvents += list.length;

  let slaRunning = 0;
  let slaBreached = 0;
  for (const t of store.tickets.values()) {
    if (t.status === 'resolved' || t.status === 'closed' || t.status === 'cancelled') continue;
    const pair = store.sla.get(t.id);
    if (!pair) continue;
    if (pair.resolution.status === 'running') slaRunning++;
    if (pair.response.status === 'breached' || pair.resolution.status === 'breached') slaBreached++;
  }

  return {
    users: [...store.users.values()].sort((a, b) => a.name.localeCompare(b.name)),
    teams: [...store.teams.values()].sort((a, b) => a.name.localeCompare(b.name)),
    categories: [...store.categories.values()].sort((a, b) => a.name.localeCompare(b.name)),
    catalog: [...store.catalog.values()].sort((a, b) => a.name.localeCompare(b.name)),
    policies: [...store.policies.values()],
    holidays: store.holidays,
    calendars: [...store.calendars.values()],
    stats: {
      totalTickets: store.tickets.size,
      totalUsers: store.users.size,
      totalTeams: store.teams.size,
      totalComments,
      totalEvents,
      workerLastTick: store.workerLastTick?.toISOString() ?? null,
      seedTime: store.seededAt.toISOString(),
      slaRunning,
      slaBreached,
      mail: mailOutboxStats(store),
    },
  };
}
