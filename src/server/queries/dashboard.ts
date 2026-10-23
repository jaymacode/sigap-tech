import { businessMinutesBetween } from '@/domain/calendar';
import { ACTIVE_STATUSES, PRIORITIES, type Priority } from '@/domain/types';
import { getStore } from '@/server/mock/db';
import { CAL_BUSINESS } from '@/server/mock/reference-data';
import { businessCalendar } from '@/server/mock/store';
import { AGE_BUCKETS, type AgeBucket } from './tickets';

export interface KpiSummary {
  responseSlaPercent: number;
  resolutionSlaPercent: number;
  mttaMinutes: number;
  mttrMinutes: number;
  activeBacklog: number;
  csatAverage: number;
  csatResponseCount: number;
}

export interface VolumePoint {
  date: string;
  created: number;
  resolved: number;
}

export interface PrioritySlaPoint {
  priority: Priority;
  metPercent: number;
  total: number;
}

export interface AgingBucketPoint {
  bucket: AgeBucket;
  label: string;
  P1: number;
  P2: number;
  P3: number;
  P4: number;
}

export interface CategoryMetric {
  id: string;
  name: string;
  count: number;
}

export interface AgentPerformanceRow {
  id: string;
  name: string;
  activeCount: number;
  resolvedCount: number;
  mttrHours: number;
  slaPercent: number;
  csatScore: number | null;
}

export interface DashboardData {
  rangeDays: number;
  kpis: KpiSummary;
  volume: VolumePoint[];
  slaByPriority: PrioritySlaPoint[];
  aging: AgingBucketPoint[];
  topCategories: CategoryMetric[];
  agentPerformance: AgentPerformanceRow[];
}

function ageBucketOf(minutes: number): AgeBucket {
  const days = minutes / 480;
  if (days < 1) return 'lt1';
  if (days < 3) return '1to3';
  if (days < 7) return '3to7';
  return 'gt7';
}

/**
 * Agregasi metrik ITSM untuk dashboard.
 * @param days - rentang hari (7, 30, atau 90)
 */
export function getDashboardMetrics(days = 30): DashboardData {
  const store = getStore();
  const now = new Date();
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const businessCal = businessCalendar(store, CAL_BUSINESS);

  // Filter tiket sesuai rentang
  const allTickets = [...store.tickets.values()];
  const inRangeTickets = allTickets.filter((t) => t.createdAt >= cutoff);

  // 1. Hitung SLA compliance response & resolution
  let responseMet = 0;
  let responseTotal = 0;
  let resolutionMet = 0;
  let resolutionTotal = 0;
  let mttaSum = 0;
  let mttaCount = 0;
  let mttrSum = 0;
  let mttrCount = 0;

  // SLA per priority map
  const priorityMetMap: Record<Priority, { met: number; total: number }> = {
    P1: { met: 0, total: 0 },
    P2: { met: 0, total: 0 },
    P3: { met: 0, total: 0 },
    P4: { met: 0, total: 0 },
  };

  for (const t of inRangeTickets) {
    if (t.status === 'cancelled') continue;
    const pair = store.sla.get(t.id);
    if (!pair) continue;

    // Response
    if (pair.response.status === 'met' || pair.response.status === 'breached') {
      responseTotal++;
      if (pair.response.status === 'met') responseMet++;
    }

    // Resolution
    if (pair.resolution.status === 'met' || pair.resolution.status === 'breached') {
      resolutionTotal++;
      const pEntry = priorityMetMap[t.priority];
      pEntry.total++;
      if (pair.resolution.status === 'met') {
        resolutionMet++;
        pEntry.met++;
      }
    }

    // MTTA (first response)
    if (t.firstResponseAt) {
      const bMin = businessMinutesBetween(t.createdAt, t.firstResponseAt, businessCal);
      mttaSum += bMin;
      mttaCount++;
    }

    // MTTR (resolved)
    if (t.resolvedAt) {
      const bMin = businessMinutesBetween(t.createdAt, t.resolvedAt, businessCal);
      mttrSum += bMin;
      mttrCount++;
    }
  }

  // Backlog aktif saat ini
  let activeBacklog = 0;
  const agingMap: Record<AgeBucket, Record<Priority, number>> = {
    lt1: { P1: 0, P2: 0, P3: 0, P4: 0 },
    '1to3': { P1: 0, P2: 0, P3: 0, P4: 0 },
    '3to7': { P1: 0, P2: 0, P3: 0, P4: 0 },
    gt7: { P1: 0, P2: 0, P3: 0, P4: 0 },
  };

  for (const t of allTickets) {
    if (ACTIVE_STATUSES.includes(t.status)) {
      activeBacklog++;
      const minutes = businessMinutesBetween(t.createdAt, now, businessCal);
      const bucket = ageBucketOf(minutes);
      agingMap[bucket][t.priority]++;
    }
  }

  // CSAT
  let csatSum = 0;
  let csatCount = 0;
  for (const csat of store.csat.values()) {
    if (csat.createdAt >= cutoff) {
      csatSum += csat.score;
      csatCount++;
    }
  }

  // 2. Volume per hari
  const dayBuckets = new Map<string, { created: number; resolved: number }>();
  // Inisialisasi rentang hari
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    dayBuckets.set(key, { created: 0, resolved: 0 });
  }

  for (const t of inRangeTickets) {
    const cKey = t.createdAt.toISOString().slice(0, 10);
    const point = dayBuckets.get(cKey);
    if (point) point.created++;
    if (t.resolvedAt && t.resolvedAt >= cutoff) {
      const rKey = t.resolvedAt.toISOString().slice(0, 10);
      const rPoint = dayBuckets.get(rKey);
      if (rPoint) rPoint.resolved++;
    }
  }

  const volume: VolumePoint[] = Array.from(dayBuckets.entries()).map(([date, data]) => ({
    date,
    created: data.created,
    resolved: data.resolved,
  }));

  // 3. SLA by Priority
  const slaByPriority: PrioritySlaPoint[] = PRIORITIES.map((p) => {
    const entry = priorityMetMap[p];
    return {
      priority: p,
      metPercent: entry.total > 0 ? Math.round((entry.met / entry.total) * 100) : 100,
      total: entry.total,
    };
  });

  // 4. Aging Buckets
  const agingLabels: Record<AgeBucket, string> = {
    lt1: '< 1 hari kerja',
    '1to3': '1–3 hari kerja',
    '3to7': '3–7 hari kerja',
    gt7: '> 7 hari kerja',
  };

  const aging: AgingBucketPoint[] = AGE_BUCKETS.map((b) => ({
    bucket: b,
    label: agingLabels[b],
    P1: agingMap[b].P1,
    P2: agingMap[b].P2,
    P3: agingMap[b].P3,
    P4: agingMap[b].P4,
  }));

  // 5. Top Categories
  const categoryCounts = new Map<string, number>();
  for (const t of inRangeTickets) {
    categoryCounts.set(t.categoryId, (categoryCounts.get(t.categoryId) ?? 0) + 1);
  }

  const topCategories: CategoryMetric[] = [...categoryCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([catId, count]) => ({
      id: catId,
      name: store.categories.get(catId)?.name ?? 'Umum',
      count,
    }));

  // 6. Agent Performance Table
  const agentMap = new Map<
    string,
    {
      name: string;
      activeCount: number;
      resolvedCount: number;
      mttrSum: number;
      mttrCount: number;
      slaMet: number;
      slaTotal: number;
      csatSum: number;
      csatCount: number;
    }
  >();

  for (const user of store.users.values()) {
    if (user.role === 'agent' && user.isActive) {
      agentMap.set(user.id, {
        name: user.name,
        activeCount: 0,
        resolvedCount: 0,
        mttrSum: 0,
        mttrCount: 0,
        slaMet: 0,
        slaTotal: 0,
        csatSum: 0,
        csatCount: 0,
      });
    }
  }

  for (const t of inRangeTickets) {
    if (!t.assigneeId) continue;
    const perf = agentMap.get(t.assigneeId);
    if (!perf) continue;

    if (ACTIVE_STATUSES.includes(t.status)) {
      perf.activeCount++;
    }
    if (t.resolvedAt) {
      perf.resolvedCount++;
      const dur = businessMinutesBetween(t.createdAt, t.resolvedAt, businessCal);
      perf.mttrSum += dur;
      perf.mttrCount++;
      const pair = store.sla.get(t.id);
      if (pair?.resolution.status === 'met' || pair?.resolution.status === 'breached') {
        perf.slaTotal++;
        if (pair.resolution.status === 'met') perf.slaMet++;
      }
      const csat = store.csat.get(t.id);
      if (csat) {
        perf.csatSum += csat.score;
        perf.csatCount++;
      }
    }
  }

  const agentPerformance: AgentPerformanceRow[] = [...agentMap.entries()].map(([id, p]) => ({
    id,
    name: p.name,
    activeCount: p.activeCount,
    resolvedCount: p.resolvedCount,
    mttrHours: p.mttrCount > 0 ? Math.round((p.mttrSum / p.mttrCount / 60) * 10) / 10 : 0,
    slaPercent: p.slaTotal > 0 ? Math.round((p.slaMet / p.slaTotal) * 100) : 100,
    csatScore: p.csatCount > 0 ? Math.round((p.csatSum / p.csatCount) * 10) / 10 : null,
  }));

  return {
    rangeDays: days,
    kpis: {
      responseSlaPercent: responseTotal > 0 ? Math.round((responseMet / responseTotal) * 100) : 100,
      resolutionSlaPercent:
        resolutionTotal > 0 ? Math.round((resolutionMet / resolutionTotal) * 100) : 100,
      mttaMinutes: mttaCount > 0 ? Math.round(mttaSum / mttaCount) : 0,
      mttrMinutes: mttrCount > 0 ? Math.round(mttrSum / mttrCount) : 0,
      activeBacklog,
      csatAverage: csatCount > 0 ? Math.round((csatSum / csatCount) * 10) / 10 : 5.0,
      csatResponseCount: csatCount,
    },
    volume,
    slaByPriority,
    aging,
    topCategories,
    agentPerformance,
  };
}
