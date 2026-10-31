import { beforeAll, describe, expect, it } from 'vitest';
import { seedStore } from '@/server/mock/seed';
import { createEmptyStore, type Store } from '@/server/mock/store';
import {
  addComment,
  createTicket,
  EngineError,
  overridePriority,
  runSlaTick,
  submitCsat,
  transitionTicket,
} from '@/server/mock/ticket-engine';

// Rabu 21 Okt 2026 10:00 WIB — waktu seed tetap agar test deterministik.
const NOW = new Date('2026-10-21T10:00:00+07:00');

function seeded(): Store {
  const store = createEmptyStore(NOW);
  seedStore(store, NOW);
  return store;
}

function user(store: Store, id: string) {
  const u = store.users.get(id);
  if (!u) throw new Error(id);
  return u;
}

describe('seed', () => {
  let store: Store;
  beforeAll(() => {
    store = seeded();
  });

  it('membuat referensi sesuai DATA_MODEL.md', () => {
    const roles = [...store.users.values()].map((u) => u.role);
    expect(roles.filter((r) => r === 'admin')).toHaveLength(1);
    expect(roles.filter((r) => r === 'lead')).toHaveLength(2);
    expect(roles.filter((r) => r === 'agent')).toHaveLength(6);
    expect(roles.filter((r) => r === 'requester')).toHaveLength(40);
    expect(store.catalog.size).toBe(15);
    expect(store.teams.size).toBe(3);
    expect(store.changes).toHaveLength(20);
  });

  it('menghasilkan ratusan tiket 90 hari terakhir', () => {
    expect(store.tickets.size).toBeGreaterThan(600);
    const oldest = Math.min(...[...store.tickets.values()].map((t) => t.createdAt.getTime()));
    expect(NOW.getTime() - oldest).toBeLessThanOrEqual(91 * 86_400_000);
  });

  it('setiap tiket punya event created + 2 SLA instance (audit trail)', () => {
    for (const t of store.tickets.values()) {
      expect(store.events.get(t.id)?.[0]?.type).toBe('created');
      const pair = store.sla.get(t.id);
      expect(pair?.response.kind).toBe('response');
      expect(pair?.resolution.kind).toBe('resolution');
    }
  });

  it('distribusi prioritas & SLA masuk akal', () => {
    const tickets = [...store.tickets.values()];
    const share = (p: string) => tickets.filter((t) => t.priority === p).length / tickets.length;
    expect(share('P1')).toBeLessThan(0.06);
    expect(share('P3') + share('P4')).toBeGreaterThan(0.7);
    const stopped = [...store.sla.values()]
      .flatMap((p) => [p.response, p.resolution])
      .filter((i) => i.status === 'met' || i.status === 'breached');
    const met = stopped.filter((i) => i.status === 'met').length / stopped.length;
    expect(met).toBeGreaterThan(0.8);
    expect(met).toBeLessThan(0.97);
  });

  it('ada tiket aktif, unassigned, dan breached untuk demo', () => {
    const tickets = [...store.tickets.values()];
    expect(
      tickets.filter((t) => ['new', 'assigned', 'in_progress', 'pending'].includes(t.status))
        .length,
    ).toBeGreaterThan(15);
    expect(tickets.some((t) => t.status === 'new' && t.assigneeId === null)).toBe(true);
    expect(tickets.some((t) => t.status === 'resolved' && t.requesterId === 'usr-user')).toBe(true);
    expect(tickets.some((t) => t.status === 'pending' && t.requesterId === 'usr-user')).toBe(true);
  });

  it('CSAT rata-rata sekitar 4,2', () => {
    const scores = [...store.csat.values()].map((c) => c.score);
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    expect(avg).toBeGreaterThan(3.9);
    expect(avg).toBeLessThan(4.5);
  });

  it('deterministik: seed dua kali menghasilkan data identik', () => {
    const other = seeded();
    expect(other.tickets.size).toBe(store.tickets.size);
    expect([...other.tickets.values()].map((t) => t.status)).toEqual(
      [...store.tickets.values()].map((t) => t.status),
    );
  });
});

describe('engine', () => {
  it('createTicket: nomor berurutan, SLA aktif, event created', () => {
    const store = seeded();
    const before = store.sequences.incident;
    const t = createTicket(
      store,
      {
        catalogItemId: 'cat-item-laptop-dead',
        title: 'Tes',
        description: 'Deskripsi',
        urgency: 'high',
        formData: {},
      },
      user(store, 'usr-user'),
      NOW,
    );
    expect(t.number).toBe(`INC-${String(before + 1).padStart(6, '0')}`);
    expect(t.status).toBe('new');
    expect(t.priority).toBe('P3'); // low × high
    expect(store.sla.get(t.id)?.response.status).toBe('running');
  });

  it('komentar publik agent = first response; requester membalas awaiting_user → In Progress', () => {
    const store = seeded();
    const agent = user(store, 'usr-agent');
    const requester = user(store, 'usr-user');
    const t = createTicket(
      store,
      {
        catalogItemId: 'cat-item-laptop-slow',
        title: 'X',
        description: 'Y',
        urgency: 'medium',
        formData: {},
      },
      requester,
      NOW,
    );
    transitionTicket(store, t.id, 'assigned', agent, { assigneeId: agent.id }, NOW);
    const later = new Date(NOW.getTime() + 30 * 60_000);
    addComment(store, t.id, agent, 'Halo', 'public', later);
    expect(store.sla.get(t.id)?.response.status).toBe('met');
    expect(store.tickets.get(t.id)?.firstResponseAt).toEqual(later);
    transitionTicket(store, t.id, 'in_progress', agent, {}, later);
    transitionTicket(store, t.id, 'pending', agent, { pendingReason: 'awaiting_user' }, later);
    expect(store.sla.get(t.id)?.resolution.status).toBe('paused');
    addComment(
      store,
      t.id,
      requester,
      'Ini jawabannya',
      'public',
      new Date(later.getTime() + 60_000),
    );
    expect(store.tickets.get(t.id)?.status).toBe('in_progress');
    expect(store.sla.get(t.id)?.resolution.status).toBe('running');
  });

  it('requester tidak bisa menulis catatan internal', () => {
    const store = seeded();
    const t = [...store.tickets.values()].find(
      (x) => x.requesterId === 'usr-user' && x.status === 'in_progress',
    );
    expect(t).toBeDefined();
    expect(() =>
      addComment(store, t!.id, user(store, 'usr-user'), 'rahasia', 'internal', NOW),
    ).toThrow(EngineError);
  });

  it('override prioritas: alasan wajib, event & rebaseline tercatat', () => {
    const store = seeded();
    const t = [...store.tickets.values()].find(
      (x) => x.status === 'in_progress' && x.priority === 'P3',
    );
    expect(t).toBeDefined();
    const lead = user(store, 'usr-lead');
    expect(() => overridePriority(store, t!.id, 'P2', 'pendek', lead, NOW)).toThrow(EngineError);
    overridePriority(store, t!.id, 'P2', 'Berdampak ke tim direksi', lead, NOW);
    const types = store.events.get(t!.id)!.map((e) => e.type);
    expect(types).toContain('priority_overridden');
    expect(types).toContain('sla_rebaselined');
    expect(store.tickets.get(t!.id)?.priorityOverridden).toBe(true);
  });

  it('CSAT hanya sekali dan hanya setelah selesai', () => {
    const store = seeded();
    const resolved = [...store.tickets.values()].find(
      (x) => x.status === 'resolved' && !store.csat.has(x.id),
    )!;
    const requester = user(store, resolved.requesterId);
    submitCsat(store, resolved.id, 5, 'Mantap', requester, NOW);
    expect(() => submitCsat(store, resolved.id, 4, '', requester, NOW)).toThrow(EngineError);
    const active = [...store.tickets.values()].find((x) => x.status === 'in_progress')!;
    expect(() => submitCsat(store, active.id, 5, '', user(store, active.requesterId), NOW)).toThrow(
      EngineError,
    );
  });

  it('sla-tick idempoten: dijalankan 2× tidak menggandakan event/notifikasi', () => {
    const store = seeded();
    const later = new Date(NOW.getTime() + 6 * 3_600_000);
    runSlaTick(store, later);
    const events = [...store.events.values()].reduce((n, l) => n + l.length, 0);
    const notifications = store.notifications.length;
    const second = runSlaTick(store, later);
    expect(second.warned + second.breached).toBe(0);
    expect([...store.events.values()].reduce((n, l) => n + l.length, 0)).toBe(events);
    expect(store.notifications.length).toBe(notifications);
  });

  it('auto-close hanya menutup Resolved > 3 hari kerja', () => {
    const store = seeded();
    const resolved = [...store.tickets.values()].filter((x) => x.status === 'resolved');
    expect(resolved.length).toBeGreaterThan(0);
    const farFuture = new Date(NOW.getTime() + 10 * 86_400_000);
    runSlaTick(store, farFuture);
    for (const r of resolved) expect(store.tickets.get(r.id)?.status).toBe('closed');
  });

  it('autoAssign tim: menugaskan ke agent aktif dengan load paling sedikit bila on, unassigned bila off', () => {
    const store = seeded();
    const team = [...store.teams.values()][0]!;
    const requester = [...store.users.values()].find((u) => u.role === 'requester')!;
    const catalogItem = [...store.catalog.values()][0]!;

    // Case 1: team autoAssign = false
    team.autoAssign = false;
    const ticketUnassigned = createTicket(
      store,
      {
        catalogItemId: catalogItem.id,
        title: 'Test Unassigned Ticket',
        description: 'Test description',
        urgency: 'medium',
        formData: {},
      },
      requester,
      NOW,
    );
    expect(ticketUnassigned.status).toBe('new');
    expect(ticketUnassigned.assigneeId).toBeNull();

    // Case 2: team autoAssign = true
    team.autoAssign = true;
    const ticketAssigned = createTicket(
      store,
      {
        catalogItemId: catalogItem.id,
        title: 'Test Auto-assigned Ticket',
        description: 'Test description',
        urgency: 'medium',
        formData: {},
      },
      requester,
      NOW,
    );
    expect(ticketAssigned.status).toBe('assigned');
    expect(ticketAssigned.assigneeId).not.toBeNull();
    expect(team.memberIds).toContain(ticketAssigned.assigneeId!);
  });
});
