import { describe, expect, it } from 'vitest';
import { can, type Action, type AuthUser, type TicketResource } from '@/server/auth/rbac';

const requester: AuthUser = { id: 'req', role: 'requester', teamIds: [], ledTeamIds: [] };
const agentL1: AuthUser = { id: 'ag', role: 'agent', teamIds: ['l1'], ledTeamIds: [] };
const leadInfra: AuthUser = { id: 'ld', role: 'lead', teamIds: ['infra'], ledTeamIds: ['infra'] };
const admin: AuthUser = { id: 'ad', role: 'admin', teamIds: [], ledTeamIds: [] };

const ownTicketL1: TicketResource = { requesterId: 'req', teamId: 'l1' };
const ownUnassignedL1: TicketResource = { requesterId: 'req', teamId: 'l1', assigneeId: null };
const ownAssignedToAgL1: TicketResource = { requesterId: 'req', teamId: 'l1', assigneeId: 'ag' };
const assignedToOtherL1: TicketResource = {
  requesterId: 'req',
  teamId: 'l1',
  assigneeId: 'other-agent',
};
const otherTicketInfra: TicketResource = { requesterId: 'someone', teamId: 'infra' };
const unroutedTicket: TicketResource = { requesterId: 'someone', teamId: null };

type Row = [string, AuthUser, Action, TicketResource | undefined, boolean];

const ROWS: Row[] = [
  // requester
  ['requester baca tiket sendiri', requester, 'ticket.read', ownTicketL1, true],
  ['requester tidak baca tiket orang lain', requester, 'ticket.read', otherTicketInfra, false],
  ['requester tidak lihat catatan internal', requester, 'ticket.read_internal', ownTicketL1, false],
  ['requester komentar tiket sendiri', requester, 'ticket.comment', ownTicketL1, true],
  ['requester tidak komentar internal', requester, 'ticket.comment_internal', ownTicketL1, false],
  ['requester konfirmasi tiket sendiri', requester, 'ticket.confirm', ownTicketL1, true],
  ['requester CSAT tiket sendiri', requester, 'ticket.csat', ownTicketL1, true],
  ['requester tidak kerjakan tiket', requester, 'ticket.work', ownTicketL1, false],
  ['requester buat tiket', requester, 'ticket.create', undefined, true],
  ['requester tidak lihat queue', requester, 'queue.view', undefined, false],
  ['requester tidak lihat dashboard', requester, 'dashboard.view', undefined, false],
  // agent
  ['agent baca semua tiket (read-only pencarian)', agentL1, 'ticket.read', otherTicketInfra, true],
  ['agent lihat catatan internal', agentL1, 'ticket.read_internal', otherTicketInfra, true],
  ['agent kerjakan tiket timnya', agentL1, 'ticket.work', ownTicketL1, true],
  ['agent tidak kerjakan tiket tim lain', agentL1, 'ticket.work', otherTicketInfra, false],
  ['agent tidak kerjakan tiket tanpa tim', agentL1, 'ticket.work', unroutedTicket, false],
  ['agent komentar internal tiket timnya', agentL1, 'ticket.comment_internal', ownTicketL1, true],
  ['agent tidak komentar tiket tim lain', agentL1, 'ticket.comment', otherTicketInfra, false],
  [
    'agent assign di timnya (fallback tanpa info assignee)',
    agentL1,
    'ticket.assign',
    ownTicketL1,
    true,
  ],
  ['agent assign tiket unassigned di timnya', agentL1, 'ticket.assign', ownUnassignedL1, true],
  ['agent lepas tiket miliknya di timnya', agentL1, 'ticket.assign', ownAssignedToAgL1, true],
  [
    'agent tidak bisa assign tiket milik agent lain di timnya (ADR-008)',
    agentL1,
    'ticket.assign',
    assignedToOtherL1,
    false,
  ],
  ['agent tidak reassign lintas tim', agentL1, 'ticket.reassign_team', ownTicketL1, false],
  ['agent tidak override prioritas', agentL1, 'ticket.override_priority', ownTicketL1, false],
  ['agent lihat queue', agentL1, 'queue.view', undefined, true],
  ['agent lihat dashboard', agentL1, 'dashboard.view', undefined, true],
  ['agent tidak lihat performa agent', agentL1, 'dashboard.view_agents', undefined, false],
  ['agent tulis KB', agentL1, 'kb.write', undefined, true],
  ['agent tidak kelola problem', agentL1, 'problem.manage', undefined, false],
  ['agent tidak admin', agentL1, 'admin.manage', undefined, false],
  // lead
  ['lead kerjakan tiket tim yang dipimpin', leadInfra, 'ticket.work', otherTicketInfra, true],
  ['lead tidak kerjakan tiket tim lain', leadInfra, 'ticket.work', ownTicketL1, false],
  [
    'lead override prioritas tim sendiri',
    leadInfra,
    'ticket.override_priority',
    otherTicketInfra,
    true,
  ],
  ['lead tidak override di tim lain', leadInfra, 'ticket.override_priority', ownTicketL1, false],
  ['lead reassign lintas tim', leadInfra, 'ticket.reassign_team', ownTicketL1, true],
  ['lead reassign tiket staf di timnya', leadInfra, 'ticket.assign', otherTicketInfra, true],
  ['lead lihat performa agent', leadInfra, 'dashboard.view_agents', undefined, true],
  ['lead kelola problem', leadInfra, 'problem.manage', undefined, true],
  ['lead tidak admin', leadInfra, 'admin.manage', undefined, false],
  // admin
  ['admin kerjakan semua', admin, 'ticket.work', otherTicketInfra, true],
  ['admin assign tiket siapapun di tim manapun', admin, 'ticket.assign', assignedToOtherL1, true],
  ['admin override semua', admin, 'ticket.override_priority', ownTicketL1, true],
  ['admin kelola sistem', admin, 'admin.manage', undefined, true],
  ['admin tidak konfirmasi tiket orang lain', admin, 'ticket.confirm', ownTicketL1, false],
  // fail closed
  ['aksi tiket tanpa resource ditolak', admin, 'ticket.read', undefined, false],
];

describe('can() — tabel aturan ARCHITECTURE.md §5', () => {
  it.each(ROWS)('%s', (_label, user, action, resource, expected) => {
    expect(can(user, action, resource)).toBe(expected);
  });
});
