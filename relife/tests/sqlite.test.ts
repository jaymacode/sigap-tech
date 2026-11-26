import { afterEach, describe, expect, it } from 'bun:test';
import { bootstrapDatabase, resetDatabaseStore, runMigrations } from '@/server/db/bootstrap';
import {
  hydrateStore,
  persistDiff,
  snapshotCounts,
  takeSnapshot,
} from '@/server/db/persistence';
import { closeSqlite, getSqlite, openSqlite } from '@/server/db/sqlite';
import { TABLE_NAMES } from '@/server/db/tables';
import { getStore, installDatabaseStore, persistStore } from '@/server/mock/db';
import { addComment, createTicket } from '@/server/mock/ticket-engine';

describe('SQLite persistence', () => {
  afterEach(() => {
    closeSqlite();
    delete process.env.DB_PATH;
    const g = globalThis as typeof globalThis & {
      __sigapStore?: unknown;
      __sigapSnapshot?: unknown;
      __sigapChain?: unknown;
      __sigapBootstrap?: unknown;
    };
    g.__sigapStore = undefined;
    g.__sigapSnapshot = undefined;
    g.__sigapChain = undefined;
    g.__sigapBootstrap = undefined;
  });

  it('migrates, seeds, and hydrates exact types and order', () => {
    const db = openSqlite(':memory:');
    try {
      const outcome = bootstrapDatabase(db);
      expect(outcome.summary.migrationsApplied).toEqual(expect.arrayContaining([
        '0001_init.sql',
        '0002_ctii_catalog.sql',
        '0003_single_team.sql',
        '0004_attachment_storage.sql',
        '0005_approvals.sql',
        '0006_mail_outbox.sql',
      ]));
      expect(outcome.summary.mode).toBe('seeded');

      // Second bootstrap on same DB hydrates instead of re-seeding
      const second = bootstrapDatabase(db);
      expect(second.summary.migrationsApplied).toEqual([]);
      expect(second.summary.mode).toBe('hydrated');

      const hydrated = hydrateStore(db);
      const seeded = outcome.store;

      expect([...hydrated.users.keys()]).toEqual([...seeded.users.keys()]);
      expect([...hydrated.tickets.keys()]).toEqual([...seeded.tickets.keys()]);
      expect([...hydrated.sla.keys()]).toEqual([...seeded.sla.keys()]);
      expect([...hydrated.events.keys()]).toEqual([...seeded.events.keys()]);
      expect([...hydrated.comments.keys()]).toEqual([...seeded.comments.keys()]);
      expect(hydrated.seededAt.toISOString()).toBe(seeded.seededAt.toISOString());
      expect(hydrated.sequences).toEqual(seeded.sequences);
      expect(hydrated.idCounter).toBe(seeded.idCounter);

      const firstUser = hydrated.users.values().next().value;
      expect(firstUser).toBeDefined();
      expect(firstUser!.createdAt).toBeInstanceOf(Date);
      expect(typeof firstUser!.isActive).toBe('boolean');

      const firstTicket = hydrated.tickets.values().next().value;
      expect(firstTicket).toBeDefined();
      expect(firstTicket!.createdAt).toBeInstanceOf(Date);
      expect(firstTicket!.updatedAt).toBeInstanceOf(Date);
      expect(typeof firstTicket!.isMajor).toBe('boolean');
      expect(typeof firstTicket!.priorityOverridden).toBe('boolean');
      expect(typeof firstTicket!.formData).toBe('object');

      const firstSla = hydrated.sla.values().next().value;
      expect(firstSla).toBeDefined();
      expect(firstSla!.response.startedAt).toBeInstanceOf(Date);
      expect(firstSla!.response.warnAt).toBeInstanceOf(Date);
      expect(firstSla!.resolution.dueAt).toBeInstanceOf(Date);

      const firstEvents = hydrated.events.get(firstTicket!.id);
      expect(firstEvents).toBeDefined();
      expect(firstEvents!.length).toBeGreaterThan(0);
      expect(firstEvents![0]!.createdAt).toBeInstanceOf(Date);
      expect(typeof firstEvents![0]!.data).toBe('object');

      const firstCalendar = hydrated.calendars.values().next().value;
      expect(firstCalendar).toBeDefined();
      expect(typeof firstCalendar!.workHours).toBe('object');

      expect(hydrated.holidays.length).toBeGreaterThan(0);
      const holiday = hydrated.holidays[0]!;
      expect(typeof holiday.date).toBe('string');
      expect(holiday.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(holiday.date).not.toBeInstanceOf(Date);

      expect(snapshotCounts(takeSnapshot(hydrated))).toEqual(snapshotCounts(outcome.snapshot));
    } finally {
      db.close();
    }
  });

  it('persists diffs for ticket creation, comments, updates, and deletes', () => {
    const db = openSqlite(':memory:');
    try {
      const { store, snapshot } = bootstrapDatabase(db);
      const requester = [...store.users.values()].find((u) => u.role === 'requester')!;
      const catalogItem = [...store.catalog.values()].find((c) => c.isActive)!;
      const now = new Date(store.seededAt.getTime() + 60_000);
      // Remove an existing seeded notification before creating a new ticket
      const removedNotification = store.notifications.pop()!;

      const created = createTicket(
        store,
        {
          catalogItemId: catalogItem.id,
          title: 'VPN client disconnects repeatedly',
          description: 'Drops every 10 minutes on Windows 11',
          urgency: 'high',
          formData: { os: 'Windows 11' },
        },
        requester,
        now,
      );
      addComment(store, created.id, requester, 'Tried restarting router', 'public', now);

      // Mutate a team (update)
      const firstTeam = store.teams.values().next().value!;
      firstTeam.description = 'Updated team description';

      const res = persistDiff(db, store, snapshot);
      expect(res.counts.tickets.upserted).toBe(1);
      expect(res.counts.comments.upserted).toBe(1);
      expect(res.counts.sla_instances.upserted).toBe(2);
      expect(res.counts.ticket_events.upserted).toBeGreaterThan(0);
      expect(res.counts.teams.upserted).toBe(1);
      expect(res.counts.notifications.deleted).toBe(1);

      const fresh = hydrateStore(db);
      const loadedTicket = fresh.tickets.get(created.id);
      expect(loadedTicket).toBeDefined();
      expect(loadedTicket!.title).toBe('VPN client disconnects repeatedly');
      expect(loadedTicket!.formData).toEqual({ os: 'Windows 11' });
      expect(fresh.comments.get(created.id)?.map((c) => c.body)).toEqual([
        'Tried restarting router',
      ]);
      expect(fresh.events.get(created.id)?.length).toBe(store.events.get(created.id)?.length);
      expect(fresh.teams.get(firstTeam.id)?.description).toBe('Updated team description');
      expect(fresh.notifications.some((n) => n.id === removedNotification.id)).toBe(false);
    } finally {
      db.close();
    }
  });

  it('blocks UPDATE and DELETE on ticket_events via append-only triggers (ADR-003)', () => {
    const db = openSqlite(':memory:');
    try {
      const { store } = bootstrapDatabase(db);
      const firstEvent = [...store.events.values()].flat()[0]!;

      expect(() => {
        db.prepare('UPDATE ticket_events SET type = ? WHERE id = ?').run(
          'tampered',
          firstEvent.id,
        );
      }).toThrow(/ticket_events is append-only/);

      expect(() => {
        db.prepare('DELETE FROM ticket_events WHERE id = ?').run(firstEvent.id);
      }).toThrow(/ticket_events is append-only/);
    } finally {
      db.close();
    }
  });

  it('rolls back failed persistStore and rehydrates clean state from SQLite', async () => {
    process.env.DB_PATH = ':memory:';
    const db = getSqlite();
    const { store, snapshot } = bootstrapDatabase(db);
    installDatabaseStore(store, snapshot);

    const activeStore = getStore(store.seededAt);
    const ticket = activeStore.tickets.values().next().value!;
    const originalPriority = ticket.priority;

    // Violate CHECK constraint on tickets.priority
    (ticket as { priority: string }).priority = 'P99';

    await expect(persistStore()).rejects.toThrow();

    // After failed persist, getStore() must reflect rehydrated DB state, not corrupted memory
    const recovered = getStore(store.seededAt);
    expect(recovered.tickets.get(ticket.id)?.priority).toBe(originalPriority);

    // Also verify resetDatabaseStore restores clean seeded data & keeps triggers intact
    const resetSummary = await resetDatabaseStore(new Date('2026-11-26T00:00:00Z'));
    for (const table of TABLE_NAMES) {
      if (table === 'mail_outbox') continue; // seed tidak mengirim email
      if (table === 'attachment_uploads') continue; // seed tidak punya unggahan tertunda
      if (table === 'approvals') continue; // seed tidak membuat rantai persetujuan
      expect(resetSummary.rowCounts[table]).toBeGreaterThan(0);
    }
    const afterReset = getStore(new Date('2026-11-26T00:00:00Z'));
    const evt = [...afterReset.events.values()].flat()[0]!;
    expect(() => {
      db.prepare('DELETE FROM ticket_events WHERE id = ?').run(evt.id);
    }).toThrow(/ticket_events is append-only/);
  });

  it('migrates legacy catalog/categories safely via 0002_ctii_catalog.sql without breaking existing tickets', () => {
    const db = openSqlite(':memory:');
    try {
      const outcome = bootstrapDatabase(db);
      expect(outcome.summary.mode).toBe('seeded');

      // Simulate a legacy DB state: insert a legacy category + catalog item + ticket, remove 0002 migration record
      db.exec('PRAGMA foreign_keys = ON');
      db.prepare(
        "INSERT INTO categories (id, ord, name, parent_id, default_team_id, is_active) VALUES ('cat-legacy', 99, 'Legacy Cat', NULL, 'team-it', 1)",
      ).run();
      db.prepare(
        "INSERT INTO catalog_items (id, ord, name, description, icon, ticket_type, category_id, default_impact, form_schema, sla_policy_id, is_active, keywords) VALUES ('cat-item-legacy', 99, 'Legacy Item', 'Old', 'help', 'incident', 'cat-legacy', 'low', '[]', NULL, 1, '[]')",
      ).run();
      db.prepare("DELETE FROM schema_migrations WHERE id = '0002_ctii_catalog.sql'").run();

      const applied = runMigrations(db);
      expect(applied).toEqual(['0002_ctii_catalog.sql']);

      const hydrated = hydrateStore(db);
      expect(hydrated.categories.get('cat-legacy')?.isActive).toBe(false);
      expect(hydrated.catalog.get('cat-item-legacy')?.isActive).toBe(false);
      const activeItems = [...hydrated.catalog.values()].filter((c) => c.isActive);
      expect(activeItems.map((c) => c.name)).toEqual([
        'PC / Server',
        'Share Folder',
        'Software',
        'Email',
        'Printing Service',
        'Network',
        'Core System',
        'Report System',
        'Others',
      ]);
    } finally {
      db.close();
    }
  });

  it('has exactly one Tim IT and 0003_single_team.sql folds legacy teams into it', () => {
    const db = openSqlite(':memory:');
    try {
      bootstrapDatabase(db);
      const seeded = hydrateStore(db);
      expect([...seeded.teams.keys()]).toEqual(['team-it']);
      expect(seeded.teams.get('team-it')?.leadId).toBe('usr-lead');
      expect(seeded.teams.get('team-it')?.memberIds).toContain('usr-lead2');
      expect(seeded.users.get('usr-lead2')?.role).toBe('agent');

      // Simulate a pre-0003 DB: second lead, legacy team with a ticket + category routed to it.
      const ticketId = [...seeded.tickets.keys()][0]!;
      db.exec('PRAGMA foreign_keys = ON');
      db.transaction(() => {
        db.exec(`
          UPDATE users SET role = 'lead' WHERE id = 'usr-lead2';
          INSERT INTO teams (id, ord, name, description, lead_id, auto_assign, created_at)
            VALUES ('team-infra', 1, 'Infrastructure', 'Legacy', 'usr-lead2', 1, '2026-01-01T00:00:00.000Z');
          INSERT INTO team_members (team_id, user_id, ord) VALUES ('team-infra', 'usr-agent4', 0);
          UPDATE categories SET default_team_id = 'team-infra' WHERE id = 'cat-network';
          DELETE FROM schema_migrations WHERE id = '0003_single_team.sql';
        `);
        db.prepare("UPDATE tickets SET team_id = 'team-infra' WHERE id = ?").run(ticketId);
      })();

      expect(runMigrations(db)).toEqual(['0003_single_team.sql']);
      const migrated = hydrateStore(db);
      expect([...migrated.teams.keys()]).toEqual(['team-it']);
      const team = migrated.teams.get('team-it')!;
      expect(team.leadId).toBe('usr-lead');
      expect(team.memberIds).not.toContain('usr-lead');
      expect(team.memberIds).toEqual(expect.arrayContaining(['usr-lead2', 'usr-agent', 'usr-agent6']));
      expect(migrated.tickets.get(ticketId)?.teamId).toBe('team-it');
      expect(migrated.categories.get('cat-network')?.defaultTeamId).toBe('team-it');
      expect(migrated.users.get('usr-lead2')?.role).toBe('agent');
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      db.close();
    }
  });
});
