import type { Role } from '@/domain/types';

/**
 * RBAC (ARCHITECTURE.md §5): satu tabel aturan `can(user, action, resource)`.
 * Fungsi murni tanpa I/O sehingga bisa dipakai di server action, route handler, dan untuk
 * menyembunyikan kontrol di UI (otorisasi tetap dicek di server).
 */

export interface AuthUser {
  id: string;
  role: Role;
  /** Tim tempat user menjadi anggota. */
  teamIds: readonly string[];
  /** Tim yang dipimpin user (role lead). */
  ledTeamIds: readonly string[];
}

export interface TicketResource {
  requesterId: string;
  teamId: string | null;
}

export type TicketAction =
  | 'ticket.read'
  | 'ticket.read_internal'
  | 'ticket.comment'
  | 'ticket.comment_internal'
  | 'ticket.work'
  | 'ticket.assign'
  | 'ticket.reassign_team'
  | 'ticket.override_priority'
  | 'ticket.confirm'
  | 'ticket.csat';

export type GlobalAction =
  | 'ticket.create'
  | 'queue.view'
  | 'dashboard.view'
  | 'dashboard.view_agents'
  | 'problem.manage'
  | 'kb.write'
  | 'admin.manage';

export type Action = TicketAction | GlobalAction;

type TicketRule = (user: AuthUser, ticket: TicketResource) => boolean;
type GlobalRule = (user: AuthUser) => boolean;

const isStaff = (u: AuthUser): boolean => u.role !== 'requester';
const isAdmin = (u: AuthUser): boolean => u.role === 'admin';
const isOwner: TicketRule = (u, t) => t.requesterId === u.id;
const inTeam: TicketRule = (u, t) => t.teamId !== null && u.teamIds.includes(t.teamId);
const leadsTeam: TicketRule = (u, t) =>
  u.role === 'lead' && t.teamId !== null && u.ledTeamIds.includes(t.teamId);

/** Hak kerja: agent di tim tiket; lead di tim yang ia pimpin/anggota; admin semua. */
const canWork: TicketRule = (u, t) =>
  isAdmin(u) || ((u.role === 'agent' || u.role === 'lead') && (inTeam(u, t) || leadsTeam(u, t)));

const TICKET_RULES: Readonly<Record<TicketAction, TicketRule>> = {
  // requester: hanya tiket miliknya; staff: semua (agent read-only untuk pencarian).
  'ticket.read': (u, t) => isStaff(u) || isOwner(u, t),
  'ticket.read_internal': (u) => isStaff(u),
  'ticket.comment': (u, t) => isOwner(u, t) || canWork(u, t),
  'ticket.comment_internal': canWork,
  'ticket.work': canWork,
  'ticket.assign': canWork,
  // PRD §4: lead boleh reassign lintas tim.
  'ticket.reassign_team': (u) => u.role === 'lead' || isAdmin(u),
  'ticket.override_priority': (u, t) => isAdmin(u) || leadsTeam(u, t),
  'ticket.confirm': isOwner,
  'ticket.csat': isOwner,
};

const GLOBAL_RULES: Readonly<Record<GlobalAction, GlobalRule>> = {
  'ticket.create': () => true,
  'queue.view': isStaff,
  'dashboard.view': isStaff,
  'dashboard.view_agents': (u) => u.role === 'lead' || isAdmin(u),
  'problem.manage': (u) => u.role === 'lead' || isAdmin(u),
  'kb.write': isStaff,
  'admin.manage': isAdmin,
};

function isTicketAction(action: Action): action is TicketAction {
  return action in TICKET_RULES;
}

/**
 * Mengecek izin.
 * @param user - user terautentikasi
 * @param action - aksi yang diminta
 * @param resource - tiket (wajib untuk aksi `ticket.*` selain `ticket.create`)
 * @returns true jika diizinkan. Aksi tiket tanpa resource selalu ditolak (fail closed).
 */
export function can(user: AuthUser, action: Action, resource?: TicketResource): boolean {
  if (isTicketAction(action)) {
    return resource ? TICKET_RULES[action](user, resource) : false;
  }
  return GLOBAL_RULES[action](user);
}
