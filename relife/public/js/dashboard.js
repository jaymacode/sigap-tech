// Dashboard Features: Chart/Table View Toggle & Interactive Chart Tooltips

function hideChartTip(stage) {
  if (!stage) return;
  const tip = stage.querySelector('[data-chart-tooltip]');
  if (tip) tip.hidden = true;
  stage.querySelectorAll('.chart-hit.is-active, .chart-group.is-active').forEach((el) => {
    el.classList.remove('is-active');
  });
}

function showChartTip(hit) {
  const stage = hit.closest('[data-chart-stage]');
  const tip = stage?.querySelector('[data-chart-tooltip]');
  if (!stage || !tip) return;
  stage.querySelectorAll('.chart-hit.is-active, .chart-group.is-active').forEach((el) => {
    el.classList.remove('is-active');
  });
  hit.classList.add('is-active');
  hit.closest('.chart-group')?.classList.add('is-active');

  const title = hit.getAttribute('data-chart-tip-title') || '';
  const rawRows = hit.getAttribute('data-chart-tip-rows') || '';
  tip.replaceChildren();
  if (title) {
    const h = document.createElement('div');
    h.className = 'chart-tip-title';
    h.textContent = title;
    tip.appendChild(h);
  }
  const list = document.createElement('div');
  list.className = 'chart-tip-rows';
  for (const part of rawRows.split(';;').filter(Boolean)) {
    const [label, val, tone] = part.split('|');
    const row = document.createElement('div');
    row.className = 'chart-tip-row';
    const left = document.createElement('span');
    left.className = 'chart-tip-label';
    if (tone) {
      const dot = document.createElement('span');
      dot.className = `chart-tip-dot tone-${tone}`;
      left.appendChild(dot);
    }
    const lbl = document.createElement('span');
    lbl.textContent = label || '';
    left.appendChild(lbl);
    const right = document.createElement('span');
    right.className = 'chart-tip-val';
    right.textContent = val || '';
    row.append(left, right);
    list.appendChild(row);
  }
  tip.appendChild(list);
  tip.hidden = false;

  const announcer = document.getElementById('sr-announcer');
  if (announcer) {
    const summary = Array.from(list.querySelectorAll('.chart-tip-row')).map((r) => r.textContent).join(', ');
    announcer.textContent = `${title}: ${summary}`.trim();
  }

  const stageRect = stage.getBoundingClientRect();
  const hitRect = hit.getBoundingClientRect();
  const tipRect = tip.getBoundingClientRect();
  let leftPx = hitRect.left - stageRect.left + hitRect.width / 2 - tipRect.width / 2;
  leftPx = Math.max(8, Math.min(stageRect.width - tipRect.width - 8, leftPx));
  let topPx = hitRect.top - stageRect.top - tipRect.height - 8;
  if (topPx < 4) {
    topPx = Math.min(stageRect.height - tipRect.height - 8, hitRect.top - stageRect.top + Math.min(hitRect.height * 0.45, 36));
  }
  tip.style.left = `${Math.round(leftPx)}px`;
  tip.style.top = `${Math.round(Math.max(4, topPx))}px`;
}

let lastChartPointer = 'mouse';
document.addEventListener('pointerdown', (e) => {
  if (e.pointerType) lastChartPointer = e.pointerType;
});

document.addEventListener('pointerover', (e) => {
  if (e.pointerType === 'touch') return;
  const hit = e.target instanceof Element ? e.target.closest('.chart-hit') : null;
  if (hit) showChartTip(hit);
});

document.addEventListener('pointerout', (e) => {
  if (e.pointerType === 'touch') return;
  const hit = e.target instanceof Element ? e.target.closest('.chart-hit') : null;
  if (!hit) return;
  const stage = hit.closest('[data-chart-stage]');
  const related = e.relatedTarget instanceof Element ? e.relatedTarget : null;
  if (stage && (!related || !stage.contains(related))) hideChartTip(stage);
});

document.addEventListener('click', (e) => {
  const target = e.target instanceof Element ? e.target : null;
  if (!target) return;

  const toggleBtn = target.closest('[data-toggle-pair]');
  if (toggleBtn) {
    const key = toggleBtn.dataset.togglePair;
    const chart = document.querySelector(`[data-view-chart="${CSS.escape(key)}"]`);
    const table = document.querySelector(`[data-view-table="${CSS.escape(key)}"]`);
    if (chart && table) {
      const showTable = table.hidden;
      table.hidden = !showTable;
      chart.hidden = showTable;
      toggleBtn.setAttribute('aria-pressed', String(showTable));
      const labelSpan = toggleBtn.querySelector('span');
      if (labelSpan) {
        const nextLabel = showTable ? toggleBtn.dataset.labelChart : toggleBtn.dataset.labelTable;
        if (nextLabel) labelSpan.textContent = nextLabel;
      }
    }
    return;
  }

  const hit = target.closest('.chart-hit');
  if (hit) {
    const stage = hit.closest('[data-chart-stage]');
    const wasActive = hit.classList.contains('is-active');
    document.querySelectorAll('[data-chart-stage]').forEach((s) => {
      if (s !== stage) hideChartTip(s);
    });
    if (wasActive && lastChartPointer === 'touch') hideChartTip(stage);
    else showChartTip(hit);
    return;
  }
  if (!target.closest('[data-chart-stage]')) {
    document.querySelectorAll('[data-chart-stage]').forEach((s) => hideChartTip(s));
  }
});

document.addEventListener('focusin', (e) => {
  if (lastChartPointer === 'touch') return;
  const hit = e.target instanceof Element ? e.target.closest('.chart-hit') : null;
  if (hit) showChartTip(hit);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Tab' || e.key.startsWith('Arrow')) lastChartPointer = 'keyboard';
  if (e.key === 'Escape') {
    document.querySelectorAll('[data-chart-stage]').forEach((s) => hideChartTip(s));
  }
});
