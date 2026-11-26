import { html } from 'hono/html';
import type {
  AgentPerformanceRow,
  AgingBucketPoint,
  CategoryMetric,
  PrioritySlaPoint,
  VolumePoint,
} from '@/server/queries/dashboard';
import { icon, type HtmlContent } from './components';

function niceMax(val: number): number {
  if (val <= 4) return 4;
  const step = Math.ceil(val / 4);
  return step * 4;
}

function smoothPath(
  points: ReadonlyArray<{ x: number; y: number }>,
  minY: number,
  maxY: number,
): string {
  if (points.length === 0) return '';
  const first = points[0]!;
  if (points.length === 1) return `M ${first.x.toFixed(1)},${first.y.toFixed(1)}`;
  const clampY = (y: number): number => Math.min(maxY, Math.max(minY, y));
  let d = `M ${first.x.toFixed(1)},${first.y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[Math.min(points.length - 1, i + 2)]!;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = clampY(p1.y + (p2.y - p0.y) / 6);
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = clampY(p2.y - (p3.y - p1.y) / 6);
    d += ` C ${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}

function chartToggleButton(pair: string): HtmlContent {
  return html`<button
    type="button"
    class="btn btn-ghost btn-sm"
    data-toggle-pair="${pair}"
    aria-pressed="false"
    data-label-table="Lihat sebagai tabel"
    data-label-chart="Lihat sebagai grafik"
  >
    ${icon('table', 'icon-xs')} <span>Lihat sebagai tabel</span>
  </button>`;
}

/**
 * Grafik SVG dual-line Volume Tiket 30 hari + fallback tabel HTML.
 */
export function volumeChart(volume: VolumePoint[], rangeDays: number): HtmlContent {
  const W = 720;
  const H = 220;
  const pad = { top: 18, right: 20, bottom: 32, left: 36 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const rawMax = volume.reduce((m, v) => Math.max(m, v.created, v.resolved), 0);
  const maxY = niceMax(rawMax);
  const n = volume.length;
  const xAt = (i: number): number =>
    n <= 1 ? pad.left + plotW / 2 : pad.left + (i / (n - 1)) * plotW;
  const yAt = (val: number): number => pad.top + plotH - (val / maxY) * plotH;

  const createdPath = smoothPath(
    volume.map((v, i) => ({ x: xAt(i), y: yAt(v.created) })),
    pad.top,
    pad.top + plotH,
  );
  const resolvedPath = smoothPath(
    volume.map((v, i) => ({ x: xAt(i), y: yAt(v.resolved) })),
    pad.top,
    pad.top + plotH,
  );
  const labelEvery = Math.max(1, Math.ceil(n / 7));

  return html`<div class="card">
    <div class="card-header row-between">
      <div>
        <h2 class="card-title">Volume Tiket (Dibuat vs Diselesaikan)</h2>
        <p class="card-desc">Tren beban tiket harian dalam ${rangeDays} hari terakhir</p>
      </div>
      ${chartToggleButton('vol')}
    </div>

    <div class="card-body">
      <div data-view-chart="vol">
        <svg viewBox="0 0 ${W} ${H}" class="chart-svg" role="img" aria-label="Grafik Volume Tiket">
          ${[0, 1, 2, 3, 4].map((tick) => {
            const val = Math.round((maxY * tick) / 4);
            const y = yAt(val).toFixed(1);
            return html`<g>
              <line x1="${pad.left}" y1="${y}" x2="${W - pad.right}" y2="${y}" class="chart-grid" />
              <text x="${pad.left - 8}" y="${y}" text-anchor="end" dominant-baseline="middle" class="chart-axis">${val}</text>
            </g>`;
          })}

          ${volume.map((v, i) =>
            i % labelEvery === 0 || i === n - 1
              ? html`<text
                  x="${xAt(i).toFixed(1)}"
                  y="${H - 10}"
                  text-anchor="middle"
                  class="chart-axis"
                >${v.date.slice(5)}</text>`
              : null,
          )}

          ${n > 0
            ? html`
                <path d="${createdPath}" fill="none" stroke="#0f766e" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" />
                <path d="${resolvedPath}" fill="none" stroke="#16a34a" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" />
                ${volume.map((v, i) => {
                  const cx = xAt(i).toFixed(1);
                  const cyC = yAt(v.created).toFixed(1);
                  const cyR = yAt(v.resolved).toFixed(1);
                  return html`<g>
                    <circle cx="${cx}" cy="${cyC}" r="3.2" fill="#0f766e">
                      <title>${v.date}: Masuk ${v.created}, Selesai ${v.resolved}</title>
                    </circle>
                    <circle cx="${cx}" cy="${cyR}" r="3.2" fill="#16a34a">
                      <title>${v.date}: Selesai ${v.resolved}, Masuk ${v.created}</title>
                    </circle>
                  </g>`;
                })}
              `
            : null}
        </svg>

        <div class="chart-legend">
          <span class="legend-item"><i class="legend-dot" style="background:#0f766e"></i> Tiket Baru</span>
          <span class="legend-item"><i class="legend-dot" style="background:#16a34a"></i> Diselesaikan</span>
        </div>
      </div>

      <div data-view-table="vol" hidden>
        <div class="table-scroll max-h-64">
          <table class="table">
            <thead>
              <tr>
                <th>Tanggal</th>
                <th class="text-right">Tiket Masuk</th>
                <th class="text-right">Tiket Selesai</th>
              </tr>
            </thead>
            <tbody>
              ${volume.map(
                (v) => html`<tr>
                  <td class="mono">${v.date}</td>
                  <td class="text-right mono text-accent">${v.created}</td>
                  <td class="text-right mono text-sla-ok">${v.resolved}</td>
                </tr>`,
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>`;
}

/**
 * Grafik horizontal bar SVG SLA Compliance per Prioritas (P1–P4) + fallback tabel.
 */
export function slaPriorityChart(slaByPriority: PrioritySlaPoint[]): HtmlContent {
  const W = 480;
  const H = 180;
  const pad = { top: 14, right: 56, bottom: 26, left: 42 };
  const plotW = W - pad.left - pad.right;
  const rowH = (H - pad.top - pad.bottom) / Math.max(1, slaByPriority.length);

  return html`<div class="card">
    <div class="card-header row-between">
      <div>
        <h2 class="card-title">SLA Compliance per Prioritas</h2>
        <p class="card-desc">Persentase target resolusi terpenuhi per tingkat P1–P4</p>
      </div>
      ${chartToggleButton('sla')}
    </div>

    <div class="card-body">
      <div data-view-chart="sla">
        <svg viewBox="0 0 ${W} ${H}" class="chart-svg" role="img" aria-label="SLA Compliance per Prioritas">
          ${[0, 25, 50, 75, 100].map((pct) => {
            const x = (pad.left + (pct / 100) * plotW).toFixed(1);
            return html`<g>
              <line x1="${x}" y1="${pad.top}" x2="${x}" y2="${H - pad.bottom}" class="chart-grid" />
              <text x="${x}" y="${H - 8}" text-anchor="middle" class="chart-axis">${pct}%</text>
            </g>`;
          })}

          ${slaByPriority.map((item, i) => {
            const y = pad.top + i * rowH + 6;
            const barH = Math.max(14, rowH - 12);
            const barW = Math.max(0, (item.metPercent / 100) * plotW);
            const cy = (y + barH / 2).toFixed(1);
            return html`<g>
              <text x="${pad.left - 8}" y="${cy}" text-anchor="end" dominant-baseline="middle" class="chart-axis-bold">${item.priority}</text>
              <rect x="${pad.left}" y="${y}" width="${plotW}" height="${barH}" rx="4" class="chart-track" />
              <rect x="${pad.left}" y="${y}" width="${barW.toFixed(1)}" height="${barH}" rx="4" fill="#0f766e">
                <title>${item.priority}: ${item.metPercent}% (${item.total} tiket)</title>
              </rect>
              <text x="${(pad.left + barW + 6).toFixed(1)}" y="${cy}" dominant-baseline="middle" class="chart-val">${item.metPercent}%</text>
            </g>`;
          })}
        </svg>
      </div>

      <div data-view-table="sla" hidden>
        <table class="table">
          <thead>
            <tr>
              <th>Prioritas</th>
              <th class="text-right">Total Tiket</th>
              <th class="text-right">Kepatuhan SLA</th>
            </tr>
          </thead>
          <tbody>
            ${slaByPriority.map(
              (item) => html`<tr>
                <td class="mono font-bold">${item.priority}</td>
                <td class="text-right mono">${item.total}</td>
                <td class="text-right mono text-accent font-bold">${item.metPercent}%</td>
              </tr>`,
            )}
          </tbody>
        </table>
      </div>
    </div>
  </div>`;
}

/**
 * Grafik stacked bar SVG Backlog Aging (P1–P4 per bucket usia kerja) + fallback tabel.
 */
export function agingChart(aging: AgingBucketPoint[]): HtmlContent {
  const W = 480;
  const H = 190;
  const pad = { top: 14, right: 16, bottom: 30, left: 36 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const rawMax = aging.reduce((m, b) => Math.max(m, b.P1 + b.P2 + b.P3 + b.P4), 0);
  const maxY = niceMax(rawMax);
  const colW = plotW / Math.max(1, aging.length);
  const barW = Math.min(48, colW * 0.56);

  const series: ReadonlyArray<{ key: 'P1' | 'P2' | 'P3' | 'P4'; label: string; color: string }> = [
    { key: 'P1', label: 'P1 Critical', color: '#dc2626' },
    { key: 'P2', label: 'P2 High', color: '#ea580c' },
    { key: 'P3', label: 'P3 Medium', color: '#ca8a04' },
    { key: 'P4', label: 'P4 Low', color: '#64748b' },
  ];

  return html`<div class="card">
    <div class="card-header row-between">
      <div>
        <h2 class="card-title">Distribusi Umur Backlog Aktif</h2>
        <p class="card-desc">Tiket aktif dikelompokkan berdasarkan usia kerja &amp; prioritas</p>
      </div>
      ${chartToggleButton('aging')}
    </div>

    <div class="card-body">
      <div data-view-chart="aging">
        <svg viewBox="0 0 ${W} ${H}" class="chart-svg" role="img" aria-label="Distribusi Umur Backlog Aktif">
          ${[0, 1, 2, 3, 4].map((tick) => {
            const val = Math.round((maxY * tick) / 4);
            const y = (pad.top + plotH - (val / maxY) * plotH).toFixed(1);
            return html`<g>
              <line x1="${pad.left}" y1="${y}" x2="${W - pad.right}" y2="${y}" class="chart-grid" />
              <text x="${pad.left - 8}" y="${y}" text-anchor="end" dominant-baseline="middle" class="chart-axis">${val}</text>
            </g>`;
          })}

          ${aging.map((b, i) => {
            const cx = pad.left + i * colW + colW / 2;
            const x = (cx - barW / 2).toFixed(1);
            let curBottom = pad.top + plotH;
            return html`<g>
              ${series.map((s) => {
                const count = b[s.key];
                if (count <= 0) return null;
                const h = (count / maxY) * plotH;
                curBottom -= h;
                return html`<rect
                  x="${x}"
                  y="${curBottom.toFixed(1)}"
                  width="${barW.toFixed(1)}"
                  height="${h.toFixed(1)}"
                  fill="${s.color}"
                >
                  <title>${b.label} (${s.label}): ${count}</title>
                </rect>`;
              })}
              <text x="${cx.toFixed(1)}" y="${H - 10}" text-anchor="middle" class="chart-axis">${b.label}</text>
            </g>`;
          })}
        </svg>

        <div class="chart-legend">
          ${series.map(
            (s) => html`<span class="legend-item"><i class="legend-dot" style="background:${s.color}"></i> ${s.label}</span>`,
          )}
        </div>
      </div>

      <div data-view-table="aging" hidden>
        <table class="table">
          <thead>
            <tr>
              <th>Rentang Umur</th>
              <th class="text-right">P1</th>
              <th class="text-right">P2</th>
              <th class="text-right">P3</th>
              <th class="text-right">P4</th>
            </tr>
          </thead>
          <tbody>
            ${aging.map(
              (b) => html`<tr>
                <td>${b.label}</td>
                <td class="text-right mono text-p1 font-bold">${b.P1}</td>
                <td class="text-right mono text-p2 font-bold">${b.P2}</td>
                <td class="text-right mono text-p3 font-bold">${b.P3}</td>
                <td class="text-right mono text-p4 font-bold">${b.P4}</td>
              </tr>`,
            )}
          </tbody>
        </table>
      </div>
    </div>
  </div>`;
}

export function topCategoriesCard(categories: CategoryMetric[]): HtmlContent {
  return html`<div class="card">
    <div class="card-header">
      <h2 class="card-title">Top 10 Kategori</h2>
      <p class="card-desc">Kategori dengan volume insiden/permohonan tertinggi</p>
    </div>
    <div class="card-body">
      <div class="rank-list">
        ${categories.map(
          (c, i) => html`<a href="/queue?category=${c.id}" class="rank-row">
            <span class="rank-name">${i + 1}. ${c.name}</span>
            <span class="rank-count mono tabular">${c.count} tiket</span>
          </a>`,
        )}
      </div>
    </div>
  </div>`;
}

export function agentPerformanceCard(agents: AgentPerformanceRow[]): HtmlContent {
  return html`<div class="card span-2">
    <div class="card-header">
      <h2 class="card-title">Kinerja Anggota Tim IT</h2>
      <p class="card-desc">Beban tiket aktif, resolusi, rata-rata MTTR, kepatuhan SLA, dan kepuasan CSAT</p>
    </div>
    <div class="card-body">
      <div class="table-scroll">
        <table class="table">
          <thead>
            <tr>
              <th>Nama Staff</th>
              <th class="text-center">Tiket Aktif</th>
              <th class="text-center">Diselesaikan</th>
              <th class="text-center">MTTR</th>
              <th class="text-center">SLA Met</th>
              <th class="text-center">CSAT</th>
            </tr>
          </thead>
          <tbody>
            ${agents.map((a) => {
              const slaCls =
                a.slaPercent >= 95
                  ? 'text-sla-ok'
                  : a.slaPercent >= 85
                    ? 'text-sla-risk'
                    : 'text-sla-breach';
              return html`<tr>
                <td class="font-bold">
                  <a href="/queue?assignee=${a.id}" class="link-plain">${a.name}</a>
                </td>
                <td class="text-center mono text-accent font-bold">${a.activeCount}</td>
                <td class="text-center mono">${a.resolvedCount}</td>
                <td class="text-center mono text-muted">${a.mttrHours} jam</td>
                <td class="text-center mono font-bold ${slaCls}">${a.slaPercent}%</td>
                <td class="text-center mono">
                  ${a.csatScore !== null
                    ? html`<span class="text-amber font-bold">★ ${a.csatScore}</span>`
                    : html`<span class="text-muted">—</span>`}
                </td>
              </tr>`;
            })}
          </tbody>
        </table>
      </div>
    </div>
  </div>`;
}
