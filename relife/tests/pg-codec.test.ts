import { describe, expect, it } from 'bun:test';
import { decodeRow, planDiff, takeSnapshot } from '@/server/db/persistence';
import { encodePgValue, pgPlaceholder, pgSelectColumn } from '@/server/db/postgres';
import { TABLES, type TableDef } from '@/server/db/tables';
import { seedStore } from '@/server/mock/seed';
import { createEmptyStore } from '@/server/mock/store';

const def = (name: string): TableDef => TABLES.find((t) => t.name === name)!;

describe('PostgreSQL dialect helpers (pure)', () => {
  it('selects jsonb columns as text and leaves others alone', () => {
    expect(pgSelectColumn(def('tickets'), 'form_data')).toBe('form_data::text AS form_data');
    expect(pgSelectColumn(def('tickets'), 'title')).toBe('title');
    expect(pgSelectColumn(def('app_state'), 'value')).toBe('value::text AS value');
  });

  it('casts placeholders for jsonb, timestamptz and boolean columns', () => {
    const t = def('tickets');
    expect(pgPlaceholder(t, 'form_data', 1)).toBe('$1::jsonb');
    expect(pgPlaceholder(t, 'created_at', 2)).toBe('$2::timestamptz');
    expect(pgPlaceholder(t, 'is_major', 3)).toBe('$3::boolean');
    expect(pgPlaceholder(t, 'title', 4)).toBe('$4');
    expect(pgPlaceholder(def('holidays'), 'date', 5)).toBe('$5');
  });

  it('encodes bind values (booleans stay booleans, JSON stringified, Date as ISO)', () => {
    const t = def('tickets');
    const d = new Date('2026-11-26T01:02:03.456Z');
    expect(encodePgValue(t, 'is_major', true)).toBe(true);
    expect(encodePgValue(t, 'created_at', d)).toBe('2026-11-26T01:02:03.456Z');
    expect(encodePgValue(t, 'form_data', { a: 1 })).toBe('{"a":1}');
    expect(encodePgValue(t, 'assignee_id', undefined)).toBeNull();
    expect(encodePgValue(def('app_state'), 'value', 'x')).toBe('"x"');
  });

  it('decodes a Postgres-shaped row the same as a SQLite-shaped row', () => {
    const t = def('users');
    const sqliteRaw = {
      id: 'u1', ord: 0, email: 'a@b', name: 'A', role: 'agent', department: 'IT',
      is_active: 1, password_hash: 'h', last_login_at: null, created_at: '2026-11-26T00:00:00.000Z',
    };
    const pgRaw = { ...sqliteRaw, is_active: true, created_at: new Date('2026-11-26T00:00:00.000Z') };
    expect(decodeRow(t, pgRaw)).toEqual(decodeRow(t, sqliteRaw));

    // jsonb read as text: a JSON string scalar must survive (app_state.seededAt).
    const s = def('app_state');
    expect(decodeRow(s, { key: 'seededAt', value: '"2026-11-26T00:00:00.000Z"' }).value).toBe(
      '2026-11-26T00:00:00.000Z',
    );
  });

  it('planDiff is empty for an unchanged store and rejects event mutation', () => {
    const now = new Date('2026-11-26T00:00:00Z');
    const store = createEmptyStore(now);
    seedStore(store, now);
    const snap = takeSnapshot(store);
    expect(planDiff(store, snap).empty).toBe(true);

    const evt = [...store.events.values()].flat()[0]!;
    evt.type = 'tampered' as typeof evt.type;
    expect(() => planDiff(store, snap)).toThrow(/append-only/);
  });
});
