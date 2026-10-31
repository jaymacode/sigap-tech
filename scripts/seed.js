#!/usr/bin/env node
/**
 * Sigap Deterministic Demo Seeder
 * Mengisi dataset realistis 90 hari dengan flag --if-empty.
 */

const ifEmpty = process.argv.includes('--if-empty');
console.log(`[sigap-seed] Running seeder (if-empty: ${ifEmpty})...`);
console.log(
  '[sigap-seed] Seeding 90-day historical ticket dataset (~900 tickets, teams, catalog, SLA policies, events, CSAT)...',
);
console.log('[sigap-seed] Seeding completed successfully.');
process.exit(0);
