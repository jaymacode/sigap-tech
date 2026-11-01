import { Pool } from 'pg';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { runMigrations } from '@/server/db/migrate';
import { hydrateStore, saveAll, takeSnapshot } from '@/server/db/persistence';
import {
  ensureTestDatabase,
  expectSameStore,
  NOW,
  resetSchema,
  seededStore,
  TEST_DATABASE_URL,
} from './helpers';

describe.skipIf(!TEST_DATABASE_URL)('round-trip seed → saveAll → hydrate', () => {
  let pool: Pool;

  beforeAll(async () => {
    await ensureTestDatabase(TEST_DATABASE_URL!);
    pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 4 });
    await resetSchema(pool);
    await runMigrations(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('hydrate(saveAll(S)) sama dengan S', async () => {
    let t = performance.now();
    const seeded = seededStore(NOW);
    const seedMs = performance.now() - t;

    t = performance.now();
    await saveAll(pool, seeded);
    const saveMs = performance.now() - t;

    t = performance.now();
    const hydrated = await hydrateStore(pool);
    const hydrateMs = performance.now() - t;

    expectSameStore(hydrated, seeded);
    // Snapshot dari hasil hydrate harus identik dengan snapshot dari store sumber.
    const a = takeSnapshot(hydrated);
    const b = takeSnapshot(seeded);
    for (const key of Object.keys(b) as Array<keyof typeof b>) {
      if ([...b[key].entries()].join() !== [...a[key].entries()].join()) {
        throw new Error(`snapshot ${key} berbeda setelah hydrate`);
      }
    }

    console.log(
      `[timing] seed ${seedMs.toFixed(0)} ms, saveAll ${saveMs.toFixed(0)} ms, hydrate ${hydrateMs.toFixed(0)} ms ` +
        `(tickets=${seeded.tickets.size}, events=${[...seeded.events.values()].flat().length})`,
    );
  });
});
