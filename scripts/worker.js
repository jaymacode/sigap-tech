#!/usr/bin/env node
/**
 * Sigap SLA & Ticket Worker
 * Menjalankan SLA Tick & Auto-Close berkala setiap 60 detik.
 */

const WEB_URL = process.env.SIGAP_WEB_URL || 'http://127.0.0.1:3000';
const TICK_INTERVAL_MS = 60_000;

console.log(`[sigap-worker] Starting SLA worker process targeting ${WEB_URL}...`);

let isRunning = true;

async function doTick() {
  try {
    const res = await fetch(`${WEB_URL}/api/worker/tick`, { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      const stats = data.data;
      console.log(
        `[sigap-worker] [${new Date().toISOString()}] Tick completed: warned=${stats.warned}, breached=${stats.breached}, activeAtRisk=${stats.activeAtRisk}, autoClosed=${stats.autoClosed}`,
      );
    } else {
      console.warn(`[sigap-worker] Tick returned status ${res.status}: ${res.statusText}`);
    }
  } catch (err) {
    console.warn(`[sigap-worker] Failed to connect to web app (${WEB_URL}): ${err.message}`);
  }
}

// Initial tick after brief startup delay
setTimeout(async () => {
  if (!isRunning) return;
  await doTick();

  const timer = setInterval(async () => {
    if (!isRunning) {
      clearInterval(timer);
      return;
    }
    await doTick();
  }, TICK_INTERVAL_MS);
}, 3000);

process.on('SIGTERM', () => {
  console.log('[sigap-worker] Received SIGTERM, shutting down gracefully...');
  isRunning = false;
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[sigap-worker] Received SIGINT, shutting down gracefully...');
  isRunning = false;
  process.exit(0);
});
