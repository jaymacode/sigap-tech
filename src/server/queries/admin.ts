import { getStore } from '@/server/mock/db';
import type {
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
}

export interface AdminData {
  users: UserRecord[];
  teams: TeamRecord[];
  categories: CategoryRecord[];
  catalog: CatalogItemRecord[];
  policies: SlaPolicyRecord[];
  holidays: HolidayRecord[];
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

  return {
    users: [...store.users.values()].sort((a, b) => a.name.localeCompare(b.name)),
    teams: [...store.teams.values()].sort((a, b) => a.name.localeCompare(b.name)),
    categories: [...store.categories.values()].sort((a, b) => a.name.localeCompare(b.name)),
    catalog: [...store.catalog.values()].sort((a, b) => a.name.localeCompare(b.name)),
    policies: [...store.policies.values()],
    holidays: store.holidays,
    stats: {
      totalTickets: store.tickets.size,
      totalUsers: store.users.size,
      totalTeams: store.teams.size,
      totalComments,
      totalEvents,
      workerLastTick: store.workerLastTick?.toISOString() ?? null,
      seedTime: store.seededAt.toISOString(),
    },
  };
}
