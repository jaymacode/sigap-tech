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
  const W = 820;
  const H = 340;
  const pad = { top: 22, right: 24, bottom: 38, left: 42 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const rawMax = volume.reduce((m, v) => Math.max(m, v.created, v.resolved), 0);
  const maxY = niceMax(rawMax);
  const n = volume.length;
  const xAt = (i: number): number =>
    n <= 1 ? pad.left + plotW / 2 : pad.left + (i / (n - 1)) * plotW;
  const yAt = (val: number): number => pad.top + plotH - (val / maxY) * plotH;
  const stepW = n <= 1 ? plotW : plotW / (n - 1);

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
        <p class="card-desc">Tren beban tiket harian dalam ${rangeDays} hari terakhir · ketuk atau arahkan kursor untuk detail</p>
      </div>
      ${chartToggleButton('vol')}
    </div>

    <div class="card-body">
      <div class="chart-stage" data-view-chart="vol" data-chart-stage>
        <div class="chart-scroll">
        <svg viewBox="0 0 ${W} ${H}" class="chart-svg chart-svg-lg" role="img" aria-label="Grafik Volume Tiket">
          ${[0, 1, 2, 3, 4].map((tick) => {
            const val = Math.round((maxY * tick) / 4);
            const y = yAt(val).toFixed(1);
            return html`<g>
              <line x1="${pad.left}" y1="${y}" x2="${W - pad.right}" y2="${y}" class="chart-grid" />
              <text x="${pad.left - 10}" y="${y}" text-anchor="end" dominant-baseline="middle" class="chart-axis">${val}</text>
            </g>`;
          })}

          ${volume.map((v, i) =>
            i % labelEvery === 0 || i === n - 1
              ? html`<text
                  x="${xAt(i).toFixed(1)}"
                  y="${H - 12}"
                  text-anchor="middle"
                  class="chart-axis"
                >${v.date.slice(5)}</text>`
              : null,
          )}

          ${n > 0
            ? html`
                <path d="${createdPath}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
                <path d="${resolvedPath}" fill="none" stroke="var(--sla-ok)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
                ${volume.map((v, i) => {
                  const cxNum = xAt(i);
                  const cx = cxNum.toFixed(1);
                  const cyC = yAt(v.created).toFixed(1);
                  const cyR = yAt(v.resolved).toFixed(1);
                  const hitW = Math.max(12, stepW);
                  const hitX = Math.max(pad.left, Math.min(W - pad.right - hitW, cxNum - hitW / 2));
                  const rows = `Tiket Baru|${v.created}|accent;;Diselesaikan|${v.resolved}|ok`;
                  return html`<g class="chart-group">
                    <line x1="${cx}" y1="${pad.top}" x2="${cx}" y2="${pad.top + plotH}" class="chart-guide" />
                    <circle cx="${cx}" cy="${cyC}" r="4.2" fill="var(--accent)" class="chart-dot" />
                    <circle cx="${cx}" cy="${cyR}" r="4.2" fill="var(--sla-ok)" class="chart-dot" />
                    <rect
                      x="${hitX.toFixed(1)}"
                      y="${pad.top}"
                      width="${hitW.toFixed(1)}"
                      height="${plotH}"
                      rx="4"
                      class="chart-hit"
                      tabindex="0"
                      role="button"
                      aria-label="${v.date}: Tiket Baru ${v.created}, Diselesaikan ${v.resolved}"
                      data-chart-tip-title="${v.date}"
                      data-chart-tip-rows="${rows}"
                    />
                  </g>`;
                })}
              `
            : html`<text x="${W / 2}" y="${H / 2}" text-anchor="middle" class="chart-axis">Belum ada data volume pada rentang ini.</text>`}
        </svg>
        </div>

        <div class="chart-tooltip" data-chart-tooltip hidden></div>

        <div class="chart-legend">
          <span class="legend-item"><i class="legend-dot legend-dot-accent" aria-hidden="true"></i> Tiket Baru</span>
          <span class="legend-item"><i class="legend-dot legend-dot-ok" aria-hidden="true"></i> Diselesaikan</span>
        </div>
      </div>

      <div data-view-table="vol" hidden>
        <div class="table-scroll max-h-64">
          <table class="table">
            <thead>
              <tr>
                <th scope="col">Tanggal</th>
                <th scope="col" class="text-right">Tiket Masuk</th>
                <th scope="col" class="text-right">Tiket Selesai</th>
              </tr>
            </thead>
            <tbody>
              ${volume.length === 0
                ? html`<tr><td colspan="3" class="text-center text-muted">Belum ada data volume.</td></tr>`
                : volume.map(
                    (v) => html`<tr>
                      <td class="mono">${v.date}</td>
                      <td class="text-right mono tabular text-accent">${v.created}</td>
                      <td class="text-right mono tabular text-sla-ok">${v.resolved}</td>
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
  const W = 560;
  const H = 280;
  const pad = { top: 18, right: 64, bottom: 34, left: 48 };
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
      <div class="chart-stage" data-view-chart="sla" data-chart-stage>
        <div class="chart-scroll chart-scroll-md">
        <svg viewBox="0 0 ${W} ${H}" class="chart-svg" role="img" aria-label="SLA Compliance per Prioritas">
          ${[0, 25, 50, 75, 100].map((pct) => {
            const x = (pad.left + (pct / 100) * plotW).toFixed(1);
            return html`<g>
              <line x1="${x}" y1="${pad.top}" x2="${x}" y2="${H - pad.bottom}" class="chart-grid" />
              <text x="${x}" y="${H - 10}" text-anchor="middle" class="chart-axis">${pct}%</text>
            </g>`;
          })}

          ${slaByPriority.every((item) => item.total === 0)
            ? html`<text x="${W / 2}" y="${H / 2}" text-anchor="middle" class="chart-axis">Belum ada data SLA pada periode ini.</text>`
            : slaByPriority.map((item, i) => {
            const y = pad.top + i * rowH + 8;
            const barH = Math.max(22, rowH - 16);
            const barW = Math.max(0, (item.metPercent / 100) * plotW);
            const cy = (y + barH / 2).toFixed(1);
            const rows = `Kepatuhan SLA|${item.metPercent}%|accent;;Total Tiket|${item.total} tiket|muted`;
            return html`<g class="chart-group">
              <text x="${pad.left - 10}" y="${cy}" text-anchor="end" dominant-baseline="middle" class="chart-axis-bold">${item.priority}</text>
              <rect x="${pad.left}" y="${y}" width="${plotW}" height="${barH}" rx="6" class="chart-track" />
              <rect x="${pad.left}" y="${y}" width="${barW.toFixed(1)}" height="${barH}" rx="6" fill="var(--accent)" />
              <text x="${(pad.left + barW + 8).toFixed(1)}" y="${cy}" dominant-baseline="middle" class="chart-val">${item.metPercent}%</text>
              <rect
                x="${pad.left}"
                y="${(y - 4).toFixed(1)}"
                width="${plotW + 48}"
                height="${(barH + 8).toFixed(1)}"
                rx="6"
                class="chart-hit"
                tabindex="0"
                role="button"
                aria-label="Prioritas ${item.priority}: Kepatuhan SLA ${item.metPercent}%, total ${item.total} tiket"
                data-chart-tip-title="Prioritas ${item.priority}"
                data-chart-tip-rows="${rows}"
              />
            </g>`;
          })}
        </svg>
        </div>

        <div class="chart-tooltip" data-chart-tooltip hidden></div>
      </div>

      <div data-view-table="sla" hidden>
        <div class="table-scroll">
        <table class="table">
          <thead>
            <tr>
              <th scope="col">Prioritas</th>
              <th scope="col" class="text-right">Total Tiket</th>
              <th scope="col" class="text-right">Kepatuhan SLA</th>
            </tr>
          </thead>
          <tbody>
            ${slaByPriority.map(
              (item) => html`<tr>
                <td class="mono font-bold">${item.priority}</td>
                <td class="text-right mono tabular">${item.total}</td>
                <td class="text-right mono tabular text-accent font-bold">${item.metPercent}%</td>
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
 * Grafik stacked bar SVG Backlog Aging (P1–P4 per bucket usia kerja) + fallback tabel.
 */
export function agingChart(aging: AgingBucketPoint[]): HtmlContent {
  const W = 560;
  const H = 290;
  const pad = { top: 24, right: 20, bottom: 38, left: 42 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const rawMax = aging.reduce((m, b) => Math.max(m, b.P1 + b.P2 + b.P3 + b.P4), 0);
  const maxY = niceMax(rawMax);
  const colW = plotW / Math.max(1, aging.length);
  const barW = Math.min(64, colW * 0.58);

  const series: ReadonlyArray<{ key: 'P1' | 'P2' | 'P3' | 'P4'; label: string; color: string; dotClass: string }> = [
    { key: 'P1', label: 'P1 Critical', color: 'var(--p1)', dotClass: 'legend-dot-p1' },
    { key: 'P2', label: 'P2 High', color: 'var(--p2)', dotClass: 'legend-dot-p2' },
    { key: 'P3', label: 'P3 Medium', color: 'var(--p3)', dotClass: 'legend-dot-p3' },
    { key: 'P4', label: 'P4 Low', color: 'var(--p4)', dotClass: 'legend-dot-p4' },
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
      <div class="chart-stage" data-view-chart="aging" data-chart-stage>
        <div class="chart-scroll chart-scroll-md">
        <svg viewBox="0 0 ${W} ${H}" class="chart-svg" role="img" aria-label="Distribusi Umur Backlog Aktif">
          ${[0, 1, 2, 3, 4].map((tick) => {
            const val = Math.round((maxY * tick) / 4);
            const y = (pad.top + plotH - (val / maxY) * plotH).toFixed(1);
            return html`<g>
              <line x1="${pad.left}" y1="${y}" x2="${W - pad.right}" y2="${y}" class="chart-grid" />
              <text x="${pad.left - 10}" y="${y}" text-anchor="end" dominant-baseline="middle" class="chart-axis">${val}</text>
            </g>`;
          })}

          ${rawMax === 0
            ? html`<text x="${W / 2}" y="${H / 2}" text-anchor="middle" class="chart-axis">Belum ada tiket aktif pada backlog saat ini.</text>`
            : aging.map((b, i) => {
            const cx = pad.left + i * colW + colW / 2;
            const x = (cx - barW / 2).toFixed(1);
            const total = b.P1 + b.P2 + b.P3 + b.P4;
            const hitX = (pad.left + i * colW + 4).toFixed(1);
            const hitW = Math.max(28, colW - 8).toFixed(1);
            const rows = `P1 Critical|${b.P1}|p1;;P2 High|${b.P2}|p2;;P3 Medium|${b.P3}|p3;;P4 Low|${b.P4}|p4;;Total|${total}|accent`;
            let curBottom = pad.top + plotH;
            return html`<g class="chart-group">
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
                />`;
              })}
              ${total > 0
                ? html`<text x="${cx.toFixed(1)}" y="${Math.max(14, curBottom - 6).toFixed(1)}" text-anchor="middle" class="chart-val">${total}</text>`
                : null}
              <text x="${cx.toFixed(1)}" y="${H - 12}" text-anchor="middle" class="chart-axis">${b.label}</text>
              <rect
                x="${hitX}"
                y="${pad.top}"
                width="${hitW}"
                height="${plotH}"
                rx="6"
                class="chart-hit"
                tabindex="0"
                role="button"
                aria-label="Usia ${b.label}: P1 ${b.P1}, P2 ${b.P2}, P3 ${b.P3}, P4 ${b.P4}, total ${total}"
                data-chart-tip-title="Usia: ${b.label}"
                data-chart-tip-rows="${rows}"
              />
            </g>`;
          })}
        </svg>
        </div>

        <div class="chart-tooltip" data-chart-tooltip hidden></div>

        <div class="chart-legend">
          ${series.map(
            (s) => html`<span class="legend-item"><i class="legend-dot ${s.dotClass}" aria-hidden="true"></i> ${s.label}</span>`,
          )}
        </div>
      </div>

      <div data-view-table="aging" hidden>
        <div class="table-scroll">
        <table class="table">
          <thead>
            <tr>
              <th scope="col">Rentang Umur</th>
              <th scope="col" class="text-right">P1</th>
              <th scope="col" class="text-right">P2</th>
              <th scope="col" class="text-right">P3</th>
              <th scope="col" class="text-right">P4</th>
            </tr>
          </thead>
          <tbody>
            ${aging.map(
              (b) => html`<tr>
                <td>${b.label}</td>
                <td class="text-right mono tabular text-p1 font-bold">${b.P1}</td>
                <td class="text-right mono tabular text-p2 font-bold">${b.P2}</td>
                <td class="text-right mono tabular text-p3 font-bold">${b.P3}</td>
                <td class="text-right mono tabular text-p4 font-bold">${b.P4}</td>
              </tr>`,
            )}
          </tbody>
        </table>
        </div>
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
      ${categories.length === 0
        ? html`<p class="text-muted text-xs">Belum ada kategori dengan tiket pada periode ini.</p>`
        : html`<div class="rank-list">
            ${categories.map(
              (c, i) => html`<a href="/queue?category=${c.id}" class="rank-row">
                <span class="rank-name">${i + 1}. ${c.name}</span>
                <span class="rank-count mono tabular">${c.count} tiket</span>
              </a>`,
            )}
          </div>`}
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
      ${agents.length === 0
        ? html`<p class="text-muted text-xs">Belum ada data kinerja staf pada periode ini.</p>`
        : html`<div class="table-scroll">
            <table class="table agent-perf-table">
              <thead>
                <tr>
                  <th scope="col">Nama Staff</th>
                  <th scope="col" class="text-center">Tiket Aktif</th>
                  <th scope="col" class="text-center">Diselesaikan</th>
                  <th scope="col" class="text-center">MTTR</th>
                  <th scope="col" class="text-center">SLA Met</th>
                  <th scope="col" class="text-center">CSAT</th>
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
                  const slaLabel =
                    a.slaPercent >= 95
                      ? 'Tercapai'
                      : a.slaPercent >= 85
                        ? 'Waspada'
                        : 'Rendah';
                  return html`<tr>
                    <td class="font-bold agent-perf-name">
                      <a href="/queue?assignee=${a.id}" class="link-plain">${a.name}</a>
                    </td>
                    <td class="text-center mono tabular text-accent font-bold" data-label="Tiket Aktif">${a.activeCount}</td>
                    <td class="text-center mono tabular" data-label="Diselesaikan">${a.resolvedCount}</td>
                    <td class="text-center mono tabular text-muted" data-label="MTTR">${a.mttrHours} jam</td>
                    <td class="text-center mono tabular font-bold ${slaCls}" data-label="SLA Met">${a.slaPercent}% <span class="text-xs">(${slaLabel})</span></td>
                    <td class="text-center mono tabular" data-label="CSAT">
                      ${a.csatScore !== null
                        ? html`<span class="text-amber font-bold"><span aria-hidden="true">★</span> ${a.csatScore}</span>`
                        : html`<span class="text-muted">—</span>`}
                    </td>
                  </tr>`;
                })}
              </tbody>
            </table>
          </div>`}
    </div>
  </div>`;
}
