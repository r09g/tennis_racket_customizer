/**
 * Racket Matcher — Customization Surface Intersection
 *
 * For racket k with base (W_k, SW_k, B_k), adding mass m at position d:
 *   W = W_k + m
 *   B = (W_k·B_k + m·d) / (W_k + m)
 *   SW = SW_k + (m/1000)·(d − 10)²
 *
 * Matching: find target (W_t, B_t, SW_t) reachable by ALL rackets.
 * Weight fixes mass per racket: m_k = W_t − W_k.
 * Balance fixes position: d_k = ((W_k+m_k)·B_t − W_k·B_k) / m_k.
 * Then check SW tolerance. If all pass → matched.
 */

const RACKET_LENGTH = 68.58;
const PIVOT = 10;
const POS_STEPS = 80;
const MASS_STEPS = 60;

const RACKET_COLORS = [
  { main: '#10b981', dim: 'rgba(16,185,129,0.35)' },
  { main: '#3b82f6', dim: 'rgba(59,130,246,0.35)' },
  { main: '#ec4899', dim: 'rgba(236,72,153,0.35)' },
  { main: '#f59e0b', dim: 'rgba(245,158,11,0.35)' },
];

// ── State ──────────────────────────────────────────────
let rackets = [];
let maxLead = 20;
let tolSW = 0.5;
let tolBal = 0.05;
let colorMode = 'swingweight';

let racketData = [];       // per-racket {posAxis, massAxis, swGrid, balGrid, weightGrid}
let matchedMask = [];      // matchedMask[r][massIdx][posIdx] = bool
let matchComputed = false;
let matchCellCount = 0;

let canvasStates = [];
let pinnedPoint = null;  // { rIdx, mIdx, pIdx } — the clicked/pinned cell
const gridPadding = { top: 30, right: 20, bottom: 50, left: 60 };

// ── Racket Management ──────────────────────────────────
function createDefaultRacket(i) {
  const v = [
    { weight: 305.0, sw: 320.0, balance: 32.5 },
    { weight: 307.0, sw: 318.0, balance: 32.3 },
    { weight: 303.0, sw: 322.0, balance: 32.7 },
    { weight: 306.0, sw: 319.0, balance: 32.4 },
  ];
  return { ...v[i % 4], id: Date.now() + i };
}

function addRacket() {
  if (rackets.length >= 4) return;
  rackets.push(createDefaultRacket(rackets.length));
  renderRacketCards();
  updateAddButton();
}

function removeRacket(idx) {
  if (rackets.length <= 2) return;
  rackets.splice(idx, 1);
  renderRacketCards();
  updateAddButton();
}

function updateAddButton() {
  document.getElementById('btn-add-racket').style.display = rackets.length >= 4 ? 'none' : '';
}

function renderRacketCards() {
  const grid = document.getElementById('rackets-grid');
  grid.innerHTML = '';
  rackets.forEach((r, i) => {
    const c = RACKET_COLORS[i];
    const card = document.createElement('div');
    card.className = 'racket-card';
    card.style.borderColor = c.main + '40';
    card.innerHTML = `
      <div class="racket-card-header">
        <div class="racket-color-dot" style="background:${c.main}"></div>
        <span class="racket-label">Racket ${i + 1}</span>
        ${rackets.length > 2 ? `<button class="racket-remove" onclick="removeRacket(${i})">✕</button>` : ''}
      </div>
      <div class="racket-card-inputs">
        <div class="input-group"><label>Weight</label><div class="input-wrapper">
          <input type="number" value="${r.weight}" min="200" max="400" step="0.1" id="r-${i}-w" onchange="rackets[${i}].weight=parseFloat(this.value)">
          <span class="input-unit">g</span></div></div>
        <div class="input-group"><label>Swingweight</label><div class="input-wrapper">
          <input type="number" value="${r.sw}" min="200" max="450" step="0.1" id="r-${i}-sw" onchange="rackets[${i}].sw=parseFloat(this.value)">
          <span class="input-unit">kg·cm²</span></div></div>
        <div class="input-group"><label>Balance</label><div class="input-wrapper">
          <input type="number" value="${r.balance}" min="25" max="40" step="0.1" id="r-${i}-b" onchange="rackets[${i}].balance=parseFloat(this.value)">
          <span class="input-unit">cm</span></div></div>
      </div>`;
    grid.appendChild(card);
  });
}

// ── Physics ────────────────────────────────────────────
function calcWeight(bw, m) { return bw + m; }
function calcBalance(bw, bb, m, d) {
  return m < 0.001 ? bb : (bw * bb + m * d) / (bw + m);
}
function calcSW(bsw, m, d) {
  return bsw + (m / 1000) * (d - PIVOT) * (d - PIVOT);
}

// ── Data Generation ────────────────────────────────────
function generateAllData() {
  racketData = rackets.map(r => {
    const posAxis = [], massAxis = [];
    for (let i = 0; i < POS_STEPS; i++) posAxis.push(i * RACKET_LENGTH / (POS_STEPS - 1));
    for (let j = 0; j < MASS_STEPS; j++) massAxis.push(j * maxLead / (MASS_STEPS - 1));
    const swGrid = [], balGrid = [], weightGrid = [];
    for (let j = 0; j < MASS_STEPS; j++) {
      const sr = [], br = [], wr = [];
      for (let i = 0; i < POS_STEPS; i++) {
        sr.push(calcSW(r.sw, massAxis[j], posAxis[i]));
        br.push(calcBalance(r.weight, r.balance, massAxis[j], posAxis[i]));
        wr.push(calcWeight(r.weight, massAxis[j]));
      }
      swGrid.push(sr); balGrid.push(br); weightGrid.push(wr);
    }
    return { posAxis, massAxis, swGrid, balGrid, weightGrid };
  });
}

// ── Match Computation ──────────────────────────────────
function computeMatchedRegion() {
  matchedMask = rackets.map(() =>
    Array.from({ length: MASS_STEPS }, () => new Array(POS_STEPS).fill(false))
  );
  matchCellCount = 0;
  if (rackets.length < 2) { matchComputed = true; return; }

  const ref = rackets[0], refD = racketData[0];

  for (let mIdx = 0; mIdx < MASS_STEPS; mIdx++) {
    for (let pIdx = 0; pIdx < POS_STEPS; pIdx++) {
      const m0 = refD.massAxis[mIdx], d0 = refD.posAxis[pIdx];
      const tW = ref.weight + m0;
      const tB = calcBalance(ref.weight, ref.balance, m0, d0);
      const tSW = calcSW(ref.sw, m0, d0);

      let ok = true;
      const others = [];

      for (let k = 1; k < rackets.length; k++) {
        const rk = rackets[k];
        const mk = tW - rk.weight;
        if (mk < -0.001 || mk > maxLead + 0.001) { ok = false; break; }

        if (mk < 0.001) {
          if (Math.abs(rk.balance - tB) > tolBal || Math.abs(rk.sw - tSW) > tolSW) { ok = false; break; }
          others.push({ k, mIdx: 0, pIdx: 0 });
          continue;
        }

        const dk = ((rk.weight + mk) * tB - rk.weight * rk.balance) / mk;
        if (dk < -0.01 || dk > RACKET_LENGTH + 0.01) { ok = false; break; }
        const dkC = Math.max(0, Math.min(RACKET_LENGTH, dk));
        if (Math.abs(calcSW(rk.sw, mk, dkC) - tSW) > tolSW) { ok = false; break; }

        others.push({
          k,
          mIdx: nearIdx(racketData[k].massAxis, mk),
          pIdx: nearIdx(racketData[k].posAxis, dkC),
        });
      }

      if (ok) {
        matchedMask[0][mIdx][pIdx] = true;
        matchCellCount++;
        for (const o of others) matchedMask[o.k][o.mIdx][o.pIdx] = true;
      }
    }
  }
  matchComputed = true;
}

function nearIdx(axis, val) {
  let b = 0, bd = Infinity;
  for (let i = 0; i < axis.length; i++) {
    const d = Math.abs(axis[i] - val);
    if (d < bd) { bd = d; b = i; }
  }
  return b;
}

// ── Color Helpers ──────────────────────────────────────
function getDataGrid(r) {
  if (colorMode === 'balance') return racketData[r].balGrid;
  if (colorMode === 'weight') return racketData[r].weightGrid;
  return racketData[r].swGrid;
}

function getSharedMinMax() {
  let min = Infinity, max = -Infinity;
  for (let r = 0; r < rackets.length; r++) {
    const g = getDataGrid(r);
    for (let j = 0; j < g.length; j++)
      for (let i = 0; i < g[j].length; i++) {
        if (g[j][i] < min) min = g[j][i];
        if (g[j][i] > max) max = g[j][i];
      }
  }
  return { min, max };
}

function colorFor(val, min, max) {
  if (max === min) return 'rgb(59,130,246)';
  let t = Math.max(0, Math.min(1, (val - min) / (max - min)));
  const S = [
    { t: 0, r: 59, g: 130, b: 246 }, { t: .25, r: 8, g: 145, b: 178 },
    { t: .5, r: 234, g: 179, b: 8 }, { t: .75, r: 245, g: 158, b: 11 },
    { t: 1, r: 239, g: 68, b: 68 },
  ];
  let i = 0;
  for (; i < S.length - 1; i++) if (t <= S[i + 1].t) break;
  const a = S[i], b2 = S[Math.min(i + 1, S.length - 1)];
  const lt = b2.t === a.t ? 0 : (t - a.t) / (b2.t - a.t);
  return `rgb(${Math.round(a.r + (b2.r - a.r) * lt)},${Math.round(a.g + (b2.g - a.g) * lt)},${Math.round(a.b + (b2.b - a.b) * lt)})`;
}

// ── Canvas Setup ───────────────────────────────────────
function initCanvases() {
  const cont = document.getElementById('match-grids-container');
  cont.innerHTML = '';
  canvasStates = [];

  rackets.forEach((r, idx) => {
    const c = RACKET_COLORS[idx];
    const wrap = document.createElement('div');
    wrap.className = 'match-grid-card';
    wrap.style.borderColor = c.main + '30';
    wrap.innerHTML = `
      <div class="match-grid-header">
        <div class="racket-color-dot" style="background:${c.main}"></div>
        <span>Racket ${idx + 1}</span>
        <span class="match-grid-specs">${r.weight.toFixed(1)}g · SW ${r.sw.toFixed(1)} · Bal ${r.balance.toFixed(1)}cm</span>
      </div>
      <div class="match-grid-wrapper" id="mgw-${idx}">
        <canvas id="mc-${idx}"></canvas>
      </div>`;
    cont.appendChild(wrap);
  });

  requestAnimationFrame(() => {
    rackets.forEach((_, idx) => {
      const wrapper = document.getElementById(`mgw-${idx}`);
      const canvas = document.getElementById(`mc-${idx}`);
      const dpr = window.devicePixelRatio || 1;
      const rect = wrapper.getBoundingClientRect();
      const w = rect.width, h = Math.min(w * 0.42, 380);
      canvas.width = w * dpr; canvas.height = h * dpr;
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      canvasStates[idx] = { ctx, w, h, canvas };
      drawGrid(idx);
      canvas.onmousemove = (e) => {
        clearTimeout(canvasStates[idx].hoverTimer);
        canvasStates[idx].hoverTimer = setTimeout(() => handleHover(idx, e), 50);
      };
      canvas.onmouseleave = () => {
        clearTimeout(canvasStates[idx].hoverTimer);
        handleLeave();
      };
      canvas.onclick = (e) => {
        clearTimeout(canvasStates[idx].hoverTimer);
        handleClick(idx, e);
      };
    });
  });
}

// ── Grid Drawing ───────────────────────────────────────
function drawGrid(rIdx) {
  const { ctx, w, h } = canvasStates[rIdx];
  const pad = gridPadding;
  const pW = w - pad.left - pad.right, pH = h - pad.top - pad.bottom;
  ctx.clearRect(0, 0, w, h);

  const grid = getDataGrid(rIdx);
  const { min, max } = getSharedMinMax();
  const mask = matchComputed ? matchedMask[rIdx] : null;
  const cW = pW / POS_STEPS, cH = pH / MASS_STEPS;

  for (let j = 0; j < MASS_STEPS; j++) {
    for (let i = 0; i < POS_STEPS; i++) {
      const x = pad.left + i * cW, y = pad.top + (MASS_STEPS - 1 - j) * cH;
      ctx.fillStyle = colorFor(grid[j][i], min, max);
      ctx.fillRect(x, y, Math.ceil(cW) + 1, Math.ceil(cH) + 1);
      if (mask && !mask[j][i]) {
        ctx.fillStyle = 'rgba(248,249,251,0.75)';
        ctx.fillRect(x, y, Math.ceil(cW) + 1, Math.ceil(cH) + 1);
      }
    }
  }

  // Matched border glow
  if (mask) {
    ctx.strokeStyle = 'rgba(16,185,129,0.3)';
    ctx.lineWidth = 1;
    for (let j = 0; j < MASS_STEPS; j++) for (let i = 0; i < POS_STEPS; i++) {
      if (!mask[j][i]) continue;
      const edge = i === 0 || i === POS_STEPS - 1 || j === 0 || j === MASS_STEPS - 1 ||
        !mask[j][i - 1] || !mask[j][i + 1] || !(mask[j - 1] || [])[i] || !(mask[j + 1] || [])[i];
      if (edge) {
        ctx.strokeRect(pad.left + i * cW, pad.top + (MASS_STEPS - 1 - j) * cH, Math.ceil(cW), Math.ceil(cH));
      }
    }
  }

  drawAxes(ctx, w, h);
}

function drawAxes(ctx, w, h) {
  const pad = gridPadding;
  const pW = w - pad.left - pad.right, pH = h - pad.top - pad.bottom;
  ctx.fillStyle = '#6b7280'; ctx.font = '500 10px Inter,sans-serif'; ctx.textAlign = 'center';
  [0, 10, 20, 30, 40, 50, 60, Math.round(RACKET_LENGTH)].forEach(v => {
    const x = pad.left + (v / RACKET_LENGTH) * pW;
    ctx.fillStyle = '#6b7280'; ctx.fillText(v, x, h - pad.bottom + 16);
    ctx.strokeStyle = 'rgba(0,0,0,0.06)'; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, h - pad.bottom); ctx.stroke();
  });
  ctx.fillStyle = '#9ca3af'; ctx.fillText('Position (cm from butt)', pad.left + pW / 2, h - 4);
  ctx.textAlign = 'right'; ctx.fillStyle = '#6b7280';
  for (let t = 0; t <= 5; t++) {
    const val = (t / 5) * maxLead, y = pad.top + (1 - t / 5) * pH;
    ctx.fillText(val.toFixed(0) + 'g', pad.left - 6, y + 4);
    ctx.strokeStyle = 'rgba(0,0,0,0.06)'; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(w - pad.right, y); ctx.stroke();
  }
  ctx.save(); ctx.translate(12, pad.top + pH / 2); ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = '#9ca3af'; ctx.textAlign = 'center'; ctx.fillText('Added Mass (g)', 0, 0);
  ctx.restore();
}

// ── Hover / Click ──────────────────────────────────────

function resolvePoint(rIdx, mIdx, pIdx) {
  const r = rackets[rIdx], d = racketData[rIdx];
  const m = d.massAxis[mIdx], pos = d.posAxis[pIdx];
  const tW = r.weight + m;
  const tB = calcBalance(r.weight, r.balance, m, pos);
  const tSW = calcSW(r.sw, m, pos);

  const configs = [];
  for (let k = 0; k < rackets.length; k++) {
    if (k === rIdx) {
      configs.push({ k, mass: m, pos, w: tW, b: tB, sw: tSW });
      continue;
    }
    const rk = rackets[k], mk = tW - rk.weight;
    let dk = pos;
    if (mk >= 0.001) {
      dk = ((rk.weight + mk) * tB - rk.weight * rk.balance) / mk;
      dk = Math.max(0, Math.min(RACKET_LENGTH, dk));
    }
    configs.push({
      k, mass: mk, pos: dk, w: tW,
      b: calcBalance(rk.weight, rk.balance, mk, dk),
      sw: calcSW(rk.sw, mk, dk),
    });
  }
  return { configs, tW, tB, tSW };
}

function applyPoint(rIdx, mIdx, pIdx) {
  const { configs, tW, tB, tSW } = resolvePoint(rIdx, mIdx, pIdx);
  drawCrosshairs(configs);
  showReadout(configs, tW, tB, tSW);
  updateCurvePlot(tW, configs);
  update3DMarkers(configs);
}

function hitTest(rIdx, e) {
  const { w, h, canvas } = canvasStates[rIdx];
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  const pad = gridPadding;
  const pW = w - pad.left - pad.right, pH = h - pad.top - pad.bottom;
  const rx = (mx - pad.left) / pW, ry = 1 - (my - pad.top) / pH;
  if (rx < 0 || rx > 1 || ry < 0 || ry > 1) return null;
  const pIdx = Math.min(Math.floor(rx * POS_STEPS), POS_STEPS - 1);
  const mIdx = Math.min(Math.floor(ry * MASS_STEPS), MASS_STEPS - 1);
  if (!matchComputed || !matchedMask[rIdx][mIdx][pIdx]) return null;
  return { rIdx, mIdx, pIdx };
}

function handleHover(rIdx, e) {
  const hit = hitTest(rIdx, e);
  if (!hit) {
    // If pinned, restore pinned point visuals
    if (pinnedPoint) {
      applyPoint(pinnedPoint.rIdx, pinnedPoint.mIdx, pinnedPoint.pIdx);
    } else {
      clearCrosshairs(); hideReadout();
    }
    return;
  }

  // Preview on hover (even if pinned — hover overrides visually)
  applyPoint(hit.rIdx, hit.mIdx, hit.pIdx);
}

function handleClick(rIdx, e) {
  const hit = hitTest(rIdx, e);
  if (!hit) {
    // Clicked outside matched region → clear pin
    pinnedPoint = null;
    clearCrosshairs(); hideReadout();
    clear3DMarkers();
    renderInitialCurvePlot();
    return;
  }
  // Pin this point
  pinnedPoint = hit;
  applyPoint(hit.rIdx, hit.mIdx, hit.pIdx);
}

function handleLeave() {
  if (pinnedPoint) {
    applyPoint(pinnedPoint.rIdx, pinnedPoint.mIdx, pinnedPoint.pIdx);
  } else {
    clearCrosshairs(); hideReadout(); clear3DMarkers();
  }
}

function drawCrosshairs(configs) {
  for (let k = 0; k < rackets.length; k++) {
    drawGrid(k);
    const c = configs.find(x => x.k === k);
    if (!c) continue;
    const { ctx, w, h } = canvasStates[k];
    const pad = gridPadding;
    const pW = w - pad.left - pad.right, pH = h - pad.top - pad.bottom;
    const cx = pad.left + (c.pos / RACKET_LENGTH) * pW;
    const cy = pad.top + (1 - c.mass / maxLead) * pH;

    ctx.save();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(cx, pad.top); ctx.lineTo(cx, h - pad.bottom);
    ctx.moveTo(pad.left, cy); ctx.lineTo(w - pad.right, cy);
    ctx.stroke(); ctx.setLineDash([]);

    ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#1a1a2e'; ctx.fill();
    ctx.strokeStyle = RACKET_COLORS[k].main; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.restore();
  }
}

function clearCrosshairs() {
  for (let k = 0; k < rackets.length; k++) if (canvasStates[k]) drawGrid(k);
}

function showReadout(configs, tW, tB, tSW) {
  document.getElementById('match-readout-weight').textContent = tW.toFixed(1) + ' g';
  document.getElementById('match-readout-balance').textContent = tB.toFixed(2) + ' cm';
  document.getElementById('match-readout-sw').textContent = tSW.toFixed(2) + ' kg·cm²';
  let html = '';
  for (const c of configs) {
    html += `<span class="readout-racket-chip" style="border-color:${RACKET_COLORS[c.k].main}">
      <span class="racket-color-dot" style="background:${RACKET_COLORS[c.k].main};width:7px;height:7px"></span>
      R${c.k + 1}: ${c.mass.toFixed(1)}g @ ${c.pos.toFixed(1)}cm</span>`;
  }
  document.getElementById('match-readout-rackets').innerHTML = html;
  document.getElementById('match-readout-bar').classList.add('visible');
}

function hideReadout() {
  document.getElementById('match-readout-bar').classList.remove('visible');
}

// ── Color Mode ─────────────────────────────────────────
function setMatchColorMode(mode) {
  colorMode = mode;
  document.querySelectorAll('#match-color-toggle .toggle-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === mode));
  if (canvasStates.length) for (let k = 0; k < rackets.length; k++) drawGrid(k);
}

// ── Curve Plot (updates on hover) ──────────────────────
function updateCurvePlot(tW, configs) {
  const traces = [];
  rackets.forEach((r, rIdx) => {
    const mk = tW - r.weight;
    if (mk < 0 || mk > maxLead) return;
    const bals = [], sws = [];
    for (let i = 0; i <= 300; i++) {
      const d = (i / 300) * RACKET_LENGTH;
      bals.push(calcBalance(r.weight, r.balance, mk, d));
      sws.push(calcSW(r.sw, mk, d));
    }
    traces.push({
      type: 'scatter', mode: 'lines', x: bals, y: sws,
      name: `R${rIdx + 1} (${mk.toFixed(1)}g)`,
      line: { color: RACKET_COLORS[rIdx].main, width: 3 },
      hovertemplate: `R${rIdx + 1}<br>Bal: %{x:.2f} cm<br>SW: %{y:.2f}<extra></extra>`,
    });
  });

  // Match point star
  if (configs.length) {
    traces.push({
      type: 'scatter', mode: 'markers',
      x: [configs[0].b], y: [configs[0].sw],
      name: 'Match', marker: { color: '#fff', size: 14, symbol: 'star', line: { color: '#fbbf24', width: 2 } },
      hovertemplate: 'MATCH<br>Bal: %{x:.2f}<br>SW: %{y:.2f}<extra></extra>',
    });
  }

  const layout = {
    paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(248,249,251,0.5)',
    margin: { l: 60, r: 30, t: 40, b: 50 },
    title: { text: `Curves at ${tW.toFixed(1)}g`, font: { size: 13, color: '#6b7280', family: 'Inter' } },
    xaxis: { title: { text: 'Balance (cm)', font: { size: 11, color: '#6b7280' } },
      gridcolor: 'rgba(0,0,0,0.06)', color: '#6b7280',
      tickfont: { size: 10, family: 'JetBrains Mono', color: '#9ca3af' } },
    yaxis: { title: { text: 'Swingweight (kg·cm²)', font: { size: 11, color: '#6b7280' } },
      gridcolor: 'rgba(0,0,0,0.06)', color: '#6b7280',
      tickfont: { size: 10, family: 'JetBrains Mono', color: '#9ca3af' } },
    legend: { font: { size: 11, color: '#6b7280' }, bgcolor: 'rgba(255,255,255,0.9)',
      bordercolor: 'rgba(0,0,0,0.06)', borderwidth: 1 },
    font: { family: 'Inter', color: '#6b7280' },
  };
  Plotly.react('plot-curves', traces, layout, { responsive: true, displaylogo: false, modeBarButtonsToRemove: ['toImage'] });
}

function renderInitialCurvePlot() {
  Plotly.newPlot('plot-curves', [], {
    paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(248,249,251,0.5)',
    margin: { l: 60, r: 30, t: 40, b: 50 },
    title: { text: 'Hover on a matched cell to see curves', font: { size: 13, color: '#9ca3af', family: 'Inter' } },
    xaxis: { title: { text: 'Balance (cm)', font: { size: 11, color: '#6b7280' } }, gridcolor: 'rgba(0,0,0,0.06)', color: '#6b7280' },
    yaxis: { title: { text: 'Swingweight (kg·cm²)', font: { size: 11, color: '#6b7280' } }, gridcolor: 'rgba(0,0,0,0.06)', color: '#6b7280' },
    font: { family: 'Inter', color: '#6b7280' },
  }, { responsive: true, displaylogo: false });
}

// ── Combined 3D Surface Plots ──────────────────────────
let surfaceTraceCount = { sw: 0, bal: 0 }; // track how many static traces exist

function render3DSurfaces() {
  const pS = 50, mS = 40;
  const pos = [], mas = [];
  for (let i = 0; i < pS; i++) pos.push((i / (pS - 1)) * RACKET_LENGTH);
  for (let j = 0; j < mS; j++) mas.push((j / (mS - 1)) * maxLead);

  const swTraces = [], balTraces = [];

  rackets.forEach((r, rIdx) => {
    const c = RACKET_COLORS[rIdx];
    const sg = [], bg = [];
    for (let j = 0; j < mS; j++) {
      const sr = [], br = [];
      for (let i = 0; i < pS; i++) {
        sr.push(calcSW(r.sw, mas[j], pos[i]));
        br.push(calcBalance(r.weight, r.balance, mas[j], pos[i]));
      }
      sg.push(sr); bg.push(br);
    }

    // SW surface
    swTraces.push({
      type: 'surface', x: pos, y: mas, z: sg,
      colorscale: [[0, c.main + '55'], [0.5, c.main + 'aa'], [1, c.main]],
      opacity: 0.92, showscale: false, name: `R${rIdx + 1}`,
      contours: { z: { show: true, usecolormap: true, highlightcolor: '#fff', project: { z: false } } },
      hovertemplate: `R${rIdx + 1}<br>Pos: %{x:.1f}cm<br>Mass: %{y:.1f}g<br>SW: %{z:.1f}<extra></extra>`,
    });

    // Balance surface
    balTraces.push({
      type: 'surface', x: pos, y: mas, z: bg,
      colorscale: [[0, c.main + '55'], [0.5, c.main + 'aa'], [1, c.main]],
      opacity: 0.92, showscale: false, name: `R${rIdx + 1}`,
      contours: { z: { show: true, usecolormap: true, highlightcolor: '#fff', project: { z: false } } },
      hovertemplate: `R${rIdx + 1}<br>Pos: %{x:.1f}cm<br>Mass: %{y:.1f}g<br>Bal: %{z:.2f}cm<extra></extra>`,
    });

    // Matched region markers
    if (matchComputed) {
      const rd = racketData[rIdx];
      const mxs = [], mys = [], mzs = [], mxb = [], myb = [], mzb = [];
      for (let j = 0; j < MASS_STEPS; j += 2) for (let i = 0; i < POS_STEPS; i += 2) {
        if (matchedMask[rIdx][j][i]) {
          mxs.push(rd.posAxis[i]); mys.push(rd.massAxis[j]); mzs.push(rd.swGrid[j][i]);
          mxb.push(rd.posAxis[i]); myb.push(rd.massAxis[j]); mzb.push(rd.balGrid[j][i]);
        }
      }
      if (mxs.length) {
        swTraces.push({
          type: 'scatter3d', mode: 'markers', x: mxs, y: mys, z: mzs,
          marker: { size: 2.5, color: '#f59e0b', opacity: 0.7 },
          name: `R${rIdx + 1} matched`, showlegend: false,
          hovertemplate: `R${rIdx + 1} matched<br>Pos: %{x:.1f}cm<br>Mass: %{y:.1f}g<br>SW: %{z:.1f}<extra></extra>`,
        });
        balTraces.push({
          type: 'scatter3d', mode: 'markers', x: mxb, y: myb, z: mzb,
          marker: { size: 2.5, color: '#f59e0b', opacity: 0.7 },
          name: `R${rIdx + 1} matched`, showlegend: false,
          hovertemplate: `R${rIdx + 1} matched<br>Pos: %{x:.1f}cm<br>Mass: %{y:.1f}g<br>Bal: %{z:.2f}cm<extra></extra>`,
        });
      }
    }
  });

  surfaceTraceCount.sw = swTraces.length;
  surfaceTraceCount.bal = balTraces.length;

  const makeLayout = (zTitle) => ({
    paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
    margin: { l: 0, r: 0, t: 10, b: 0 },
    scene: {
      xaxis: { title: { text: 'Position (cm)', font: { size: 10, color: '#6b7280' } }, gridcolor: 'rgba(0,0,0,0.06)', color: '#6b7280', tickfont: { size: 9, family: 'JetBrains Mono', color: '#9ca3af' }, backgroundcolor: 'rgba(0,0,0,0)' },
      yaxis: { title: { text: 'Mass (g)', font: { size: 10, color: '#6b7280' } }, gridcolor: 'rgba(0,0,0,0.06)', color: '#6b7280', tickfont: { size: 9, family: 'JetBrains Mono', color: '#9ca3af' }, backgroundcolor: 'rgba(0,0,0,0)' },
      zaxis: { title: { text: zTitle, font: { size: 10, color: '#6b7280' } }, gridcolor: 'rgba(0,0,0,0.06)', color: '#6b7280', tickfont: { size: 9, family: 'JetBrains Mono', color: '#9ca3af' }, backgroundcolor: 'rgba(0,0,0,0)' },
      bgcolor: 'rgba(255,255,255,0.0)', camera: { eye: { x: 1.8, y: -1.6, z: 1.0 } },
    },
    font: { family: 'Inter', color: '#6b7280' },
    legend: { font: { size: 10, color: '#6b7280' }, bgcolor: 'rgba(255,255,255,0.9)' },
  });

  const cfg = { responsive: true, displaylogo: false, modeBarButtonsToRemove: ['toImage', 'resetCameraLastSave3d'] };

  Plotly.newPlot('srfc-sw', swTraces, makeLayout('SW (kg·cm²)'), cfg);
  setTimeout(() => Plotly.newPlot('srfc-bal', balTraces, makeLayout('Balance (cm)'), cfg), 100);
}

// ── Dynamic 3D Markers (hover/click) ───────────────────
function update3DMarkers(configs) {
  // Build per-racket markers for SW and Balance plots
  const swMarkerTraces = [], balMarkerTraces = [];

  for (const c of configs) {
    const col = RACKET_COLORS[c.k];
    swMarkerTraces.push({
      type: 'scatter3d', mode: 'markers', x: [c.pos], y: [c.mass], z: [c.sw],
      marker: { size: 8, color: col.main, symbol: 'diamond', line: { color: '#fff', width: 2 } },
      name: `R${c.k + 1} sel`, showlegend: false, hoverinfo: 'skip',
    });
    balMarkerTraces.push({
      type: 'scatter3d', mode: 'markers', x: [c.pos], y: [c.mass], z: [c.b],
      marker: { size: 8, color: col.main, symbol: 'diamond', line: { color: '#fff', width: 2 } },
      name: `R${c.k + 1} sel`, showlegend: false, hoverinfo: 'skip',
    });
  }

  // Remove old markers then add new ones
  const swEl = document.getElementById('srfc-sw');
  const balEl = document.getElementById('srfc-bal');
  if (!swEl || !swEl.data) return;

  // Trim to only static traces
  while (swEl.data.length > surfaceTraceCount.sw) Plotly.deleteTraces('srfc-sw', -1);
  while (balEl.data.length > surfaceTraceCount.bal) Plotly.deleteTraces('srfc-bal', -1);

  // Add new marker traces
  Plotly.addTraces('srfc-sw', swMarkerTraces);
  Plotly.addTraces('srfc-bal', balMarkerTraces);
}

function clear3DMarkers() {
  const swEl = document.getElementById('srfc-sw');
  const balEl = document.getElementById('srfc-bal');
  if (swEl && swEl.data) {
    while (swEl.data.length > surfaceTraceCount.sw) Plotly.deleteTraces('srfc-sw', -1);
  }
  if (balEl && balEl.data) {
    while (balEl.data.length > surfaceTraceCount.bal) Plotly.deleteTraces('srfc-bal', -1);
  }
}

// ── Main ───────────────────────────────────────────────
function runMatch() {
  maxLead = parseFloat(document.getElementById('input-max-lead').value) || 20;
  tolSW = parseFloat(document.getElementById('input-tol-sw').value) || 0.5;
  tolBal = parseFloat(document.getElementById('input-tol-bal').value) || 0.05;

  rackets.forEach((r, i) => {
    r.weight = parseFloat(document.getElementById(`r-${i}-w`).value) || r.weight;
    r.sw = parseFloat(document.getElementById(`r-${i}-sw`).value) || r.sw;
    r.balance = parseFloat(document.getElementById(`r-${i}-b`).value) || r.balance;
  });

  generateAllData();
  computeMatchedRegion();

  document.getElementById('results-section').style.display = '';

  // Update match region label
  const label = document.getElementById('match-region-label');
  if (matchCellCount === 0) {
    label.textContent = '⚠ No matching configurations found within the max lead constraint. Try increasing max lead or tolerances.';
    label.style.color = '#fb923c';
  } else {
    label.textContent = `✓ Matched region found — hover to explore`;
    label.style.color = '#10b981';
  }

  pinnedPoint = null;
  initCanvases();
  renderInitialCurvePlot();
  render3DSurfaces();

  document.getElementById('results-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Init ───────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  rackets.push(createDefaultRacket(0));
  rackets.push(createDefaultRacket(1));
  renderRacketCards();
  updateAddButton();
});

let resizeT;
window.addEventListener('resize', () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => { if (canvasStates.length) initCanvases(); }, 200);
});
