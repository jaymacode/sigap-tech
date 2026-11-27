// Live SLA Countdown & Progress Bars (Asia/Jakarta UTC+7, Mon-Fri 08:00-12:00 & 13:00-17:00)
const HOLIDAYS = new Set((document.body?.dataset.holidays || '').split(',').filter(Boolean));
const JKT_OFFSET_MS = 7 * 60 * 60_000;
const DAY_MS = 86_400_000;

function isWorkDayJkt(dayIdx) {
  const dow = (dayIdx + 4) % 7; // 1970-01-01 was Thursday (4)
  if (dow === 0 || dow === 6) return false;
  if (!HOLIDAYS.size) return true;
  const iso = new Date(dayIdx * DAY_MS).toISOString().slice(0, 10);
  return !HOLIDAYS.has(iso);
}

function overlapMinutes(aStart, aEnd, bStart, bEnd) {
  const s = Math.max(aStart, bStart);
  const e = Math.min(aEnd, bEnd);
  return e > s ? (e - s) / 60_000 : 0;
}

function elapsedSlaMinutes(fromMs, toMs, calKind) {
  if (toMs <= fromMs) return 0;
  if (calKind !== 'business_hours') return (toMs - fromMs) / 60_000;
  const startJkt = fromMs + JKT_OFFSET_MS;
  const endJkt = toMs + JKT_OFFSET_MS;
  const startDay = Math.floor(startJkt / DAY_MS);
  const endDay = Math.floor((endJkt - 1) / DAY_MS);
  let mins = 0;
  for (let d = startDay; d <= endDay; d++) {
    if (!isWorkDayJkt(d)) continue;
    if (d > startDay && d < endDay) {
      mins += 480;
      continue;
    }
    const dayBase = d * DAY_MS;
    const segStart = Math.max(startJkt, dayBase);
    const segEnd = Math.min(endJkt, dayBase + DAY_MS);
    mins += overlapMinutes(segStart, segEnd, dayBase + 480 * 60_000, dayBase + 720 * 60_000);
    mins += overlapMinutes(segStart, segEnd, dayBase + 780 * 60_000, dayBase + 1020 * 60_000);
  }
  return mins;
}

function formatSlaRem(minutes, calKind) {
  const suffix = calKind === 'business_hours' ? ' kerja' : '';
  const abs = Math.abs(minutes);
  if (abs < 1) return '<1m';
  if (abs < 60) return `${Math.round(abs)}m${suffix}`;
  const hrs = Math.floor(abs / 60);
  const rem = Math.round(abs % 60);
  if (calKind === 'business_hours') {
    if (hrs < 8) return rem > 0 ? `${hrs}j ${rem}m kerja` : `${hrs}j kerja`;
    const d = Math.floor(hrs / 8), rh = hrs % 8;
    return rh > 0 ? `${d}h ${rh}j kerja` : `${d} hari kerja`;
  }
  if (hrs < 24) return rem > 0 ? `${hrs}j ${rem}m` : `${hrs}j`;
  const d = Math.floor(hrs / 24), rh = hrs % 24;
  return rh > 0 ? `${d}h ${rh}j` : `${d} hari`;
}

export function tickLiveSla() {
  const nodes = document.querySelectorAll('[data-sla-live]');
  if (!nodes.length) return;
  const nowMs = Date.now();
  const updates = [];
  for (const el of nodes) {
    if (el instanceof HTMLElement && el.offsetParent === null) continue;
    const renderedAt = Number(el.dataset.renderedAt || 0);
    const baseRem = Number(el.dataset.remaining || 0);
    const target = Number(el.dataset.target || 0);
    const calKind = el.dataset.calKind || 'business_hours';
    if (!renderedAt || !target) continue;

    const delta = elapsedSlaMinutes(renderedAt, nowMs, calKind);
    const rem = baseRem - delta;
    const pct = Math.max(0, ((target - rem) / target) * 100);
    const breached = rem <= 0;
    const atRisk = !breached && pct >= 75;
    updates.push({
      el,
      kind: el.dataset.slaLive,
      calKind,
      rem,
      pct,
      breached,
      atRisk,
      txtEl: el.dataset.slaLive === 'badge' ? el.querySelector('[data-sla-text]') : null,
      fill: el.dataset.slaLive === 'bar' ? el.querySelector('.sla-bar-fill') : null,
    });
  }

  for (const u of updates) {
    if (u.kind === 'badge') {
      if (u.txtEl) {
        u.txtEl.textContent = u.breached
          ? (Math.abs(u.rem) >= 1 ? `Lewat ${formatSlaRem(Math.abs(u.rem), u.calKind)}` : 'Terlewati')
          : formatSlaRem(u.rem, u.calKind);
      }
      u.el.classList.remove('sla-normal', 'sla-risk', 'sla-breach');
      u.el.classList.add(u.breached ? 'sla-breach' : u.atRisk ? 'sla-risk' : 'sla-normal');
    } else if (u.kind === 'bar') {
      const clamped = Math.min(100, Math.max(0, u.pct));
      u.el.setAttribute('aria-valuenow', String(Math.round(u.pct)));
      u.el.title = `${Math.round(u.pct)}% waktu SLA terpakai`;
      if (u.fill) {
        u.fill.style.width = `${clamped}%`;
        u.fill.classList.remove('is-ok', 'is-risk', 'is-breach');
        u.fill.classList.add(u.breached ? 'is-breach' : u.atRisk ? 'is-risk' : 'is-ok');
      }
    }
  }
}

if (document.querySelector('[data-sla-live]')) {
  tickLiveSla();
  setInterval(() => {
    if (!document.hidden) tickLiveSla();
  }, 15_000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) tickLiveSla();
  });
}
