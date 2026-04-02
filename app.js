/**
 * Tennis Racket Customization Visualizer
 * 
 * Physics:
 *   Static Weight:  W_new = W_orig + m
 *   Balance:        B_new = (W_orig * B_orig + m * d) / (W_orig + m)
 *   Swingweight:    SW_new = SW_orig + (m / 1000) * (d - PIVOT)^2
 *
 *   Where:
 *     m      = added mass in grams
 *     d      = position from butt in cm
 *     PIVOT  = 10 cm (RDC standard)
 *     Racket length = 68.58 cm (fixed)
 */

// ── Constants ──────────────────────────────────────────────
const RACKET_LENGTH = 68.58;  // cm
const PIVOT = 10;             // cm from butt (RDC standard)
const POSITION_STEPS = 80;
const MASS_STEPS = 60;

// ── State ──────────────────────────────────────────────────
let baseWeight = 305;
let baseSW = 320;
let baseBalance = 32.5;
let maxMass = 20;
let colorMode = 'swingweight'; // 'swingweight' | 'balance' | 'weight'

// Pre-computed data grids
let positionAxis = [];   // length POSITION_STEPS
let massAxis = [];       // length MASS_STEPS
let swGrid = [];         // 2D [mass][pos]
let balGrid = [];        // 2D [mass][pos]
let weightGrid = [];     // 2D [mass][pos]

// Canvas state
let canvasReady = false;
let gridPadding = { top: 30, right: 20, bottom: 50, left: 60 };
let cachedCtx = null;
let cachedW = 0;
let cachedH = 0;

// Pinned point state
let pinnedPoint = null; // { posIdx, massIdx }

// Throttle state for 3D markers
let lastMarkerUpdate = 0;
const MARKER_THROTTLE_MS = 50;

// ── Physics ────────────────────────────────────────────────
function computeNewWeight(m) {
  return parseFloat((baseWeight + m).toFixed(3));
}

function computeNewBalance(m, d) {
  if (m === 0) return parseFloat(baseBalance.toFixed(3));
  return parseFloat(((baseWeight * baseBalance + m * d) / (baseWeight + m)).toFixed(3));
}

function computeNewSW(m, d) {
  return parseFloat((baseSW + (m / 1000) * Math.pow(d - PIVOT, 2)).toFixed(3));
}

// ── Data Generation ────────────────────────────────────────
function generateData() {
  positionAxis = [];
  massAxis = [];
  swGrid = [];
  balGrid = [];
  weightGrid = [];

  for (let i = 0; i < POSITION_STEPS; i++) {
    positionAxis.push(parseFloat((i * RACKET_LENGTH / (POSITION_STEPS - 1)).toFixed(3)));
  }
  for (let j = 0; j < MASS_STEPS; j++) {
    massAxis.push(parseFloat((j * maxMass / (MASS_STEPS - 1)).toFixed(3)));
  }

  for (let j = 0; j < MASS_STEPS; j++) {
    const swRow = [];
    const balRow = [];
    const wRow = [];
    const m = massAxis[j];
    for (let i = 0; i < POSITION_STEPS; i++) {
      const d = positionAxis[i];
      swRow.push(computeNewSW(m, d));
      balRow.push(computeNewBalance(m, d));
      wRow.push(computeNewWeight(m));
    }
    swGrid.push(swRow);
    balGrid.push(balRow);
    weightGrid.push(wRow);
  }
}

// ── 2D Canvas Grid ─────────────────────────────────────────
function initCanvas() {
  const canvas = document.getElementById('grid-canvas');
  const wrapper = document.getElementById('grid-wrapper');
  const dpr = window.devicePixelRatio || 1;

  const rect = wrapper.getBoundingClientRect();
  const w = rect.width;
  const h = Math.min(w * 0.42, 380);

  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  cachedCtx = ctx;
  cachedW = w;
  cachedH = h;
  canvasReady = true;
  drawGrid(ctx, w, h);

  // Mouse events
  canvas.onmousemove = (e) => handleGridHover(e, ctx, w, h);
  canvas.onmouseleave = () => handleGridLeave();
  canvas.onclick = (e) => handleGridClick(e, ctx, w, h);
  canvas.style.cursor = 'crosshair';
}

function getColorForValue(val, min, max) {
  if (max === min) return 'rgb(59,130,246)';
  let t = (val - min) / (max - min);
  t = Math.max(0, Math.min(1, t));

  // Colormap: blue → cyan → yellow → orange → red
  const stops = [
    { t: 0.0, r: 59,  g: 130, b: 246 },  // blue
    { t: 0.25, r: 8,  g: 145, b: 178 },   // cyan
    { t: 0.5, r: 234, g: 179, b: 8 },     // yellow
    { t: 0.75, r: 245, g: 158, b: 11 },   // amber
    { t: 1.0, r: 239, g: 68,  b: 68 },    // red
  ];

  let i = 0;
  for (; i < stops.length - 1; i++) {
    if (t <= stops[i + 1].t) break;
  }

  const s0 = stops[i], s1 = stops[Math.min(i + 1, stops.length - 1)];
  const localT = (s1.t === s0.t) ? 0 : (t - s0.t) / (s1.t - s0.t);

  const r = Math.round(s0.r + (s1.r - s0.r) * localT);
  const g = Math.round(s0.g + (s1.g - s0.g) * localT);
  const b = Math.round(s0.b + (s1.b - s0.b) * localT);

  return `rgb(${r},${g},${b})`;
}

function getDataGrid() {
  if (colorMode === 'balance') return balGrid;
  if (colorMode === 'weight') return weightGrid;
  return swGrid;
}

function getGridMinMax() {
  const grid = getDataGrid();
  let min = Infinity, max = -Infinity;
  for (let j = 0; j < grid.length; j++) {
    for (let i = 0; i < grid[j].length; i++) {
      if (grid[j][i] < min) min = grid[j][i];
      if (grid[j][i] > max) max = grid[j][i];
    }
  }
  return { min, max };
}

function drawGrid(ctx, w, h) {
  const pad = gridPadding;
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  ctx.clearRect(0, 0, w, h);

  const grid = getDataGrid();
  const { min, max } = getGridMinMax();

  // Draw cells
  const cellW = plotW / POSITION_STEPS;
  const cellH = plotH / MASS_STEPS;

  for (let j = 0; j < MASS_STEPS; j++) {
    for (let i = 0; i < POSITION_STEPS; i++) {
      const x = pad.left + i * cellW;
      const y = pad.top + (MASS_STEPS - 1 - j) * cellH;
      ctx.fillStyle = getColorForValue(grid[j][i], min, max);
      ctx.fillRect(x, y, Math.ceil(cellW) + 1, Math.ceil(cellH) + 1);
    }
  }

  // Axis labels
  ctx.fillStyle = '#6b7280';
  ctx.font = '500 11px Inter, sans-serif';
  ctx.textAlign = 'center';

  // X-axis ticks
  const xTicks = [0, 10, 20, 30, 40, 50, 60, RACKET_LENGTH];
  xTicks.forEach(val => {
    const x = pad.left + (val / RACKET_LENGTH) * plotW;
    ctx.fillText(val.toFixed(0), x, h - pad.bottom + 18);

    ctx.strokeStyle = 'rgba(0,0,0,0.06)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(x, pad.top);
    ctx.lineTo(x, h - pad.bottom);
    ctx.stroke();
  });

  // X-axis label
  ctx.fillStyle = '#9ca3af';
  ctx.font = '500 11px Inter, sans-serif';
  ctx.fillText('Position from Butt (cm)', pad.left + plotW / 2, h - 6);

  // Y-axis ticks
  ctx.textAlign = 'right';
  ctx.fillStyle = '#6b7280';
  const yTickCount = 5;
  for (let t = 0; t <= yTickCount; t++) {
    const val = (t / yTickCount) * maxMass;
    const y = pad.top + (1 - t / yTickCount) * plotH;
    ctx.fillText(val.toFixed(0) + 'g', pad.left - 8, y + 4);

    ctx.strokeStyle = 'rgba(0,0,0,0.06)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();
  }

  // Y-axis label
  ctx.save();
  ctx.translate(14, pad.top + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = '#9ca3af';
  ctx.textAlign = 'center';
  ctx.fillText('Added Mass (g)', 0, 0);
  ctx.restore();

  // Update legend
  updateLegend(min, max);
}

function updateLegend(min, max) {
  document.getElementById('legend-min').textContent = max.toFixed(1);
  document.getElementById('legend-max').textContent = min.toFixed(1);

  const titleMap = {
    swingweight: 'Swingweight (kg·cm²)',
    balance: 'Balance (cm)',
    weight: 'Weight (g)'
  };
  document.getElementById('legend-title').textContent = titleMap[colorMode] || '';
}

function hitTestGrid(e, w, h) {
  const canvas = document.getElementById('grid-canvas');
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const pad = gridPadding;
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;
  const relX = (mx - pad.left) / plotW;
  const relY = 1 - (my - pad.top) / plotH;
  if (relX < 0 || relX > 1 || relY < 0 || relY > 1) return null;
  return {
    posIdx: Math.min(Math.floor(relX * POSITION_STEPS), POSITION_STEPS - 1),
    massIdx: Math.min(Math.floor(relY * MASS_STEPS), MASS_STEPS - 1),
    mx, my,
  };
}

function applyGridPoint(posIdx, massIdx, ctx, w, h) {
  const pad = gridPadding;
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  const position = positionAxis[posIdx];
  const mass = massAxis[massIdx];
  const sw = swGrid[massIdx][posIdx];
  const bal = balGrid[massIdx][posIdx];
  const wt = weightGrid[massIdx][posIdx];

  // Draw crosshair
  drawGrid(ctx, w, h);
  const cx = pad.left + posIdx * (plotW / POSITION_STEPS) + (plotW / POSITION_STEPS) / 2;
  const cy = pad.top + (MASS_STEPS - 1 - massIdx) * (plotH / MASS_STEPS) + (plotH / MASS_STEPS) / 2;

  ctx.save();
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(cx, pad.top);
  ctx.lineTo(cx, h - pad.bottom);
  ctx.moveTo(pad.left, cy);
  ctx.lineTo(w - pad.right, cy);
  ctx.stroke();
  ctx.setLineDash([]);

  // Dot
  ctx.beginPath();
  ctx.arc(cx, cy, 5, 0, Math.PI * 2);
  ctx.fillStyle = '#1a1a2e';
  ctx.fill();
  ctx.strokeStyle = 'rgba(16,185,129,0.8)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  // Update readout & 3D markers
  showReadout(mass, position, wt, sw, bal);
  const now = Date.now();
  if (now - lastMarkerUpdate > MARKER_THROTTLE_MS) {
    lastMarkerUpdate = now;
    update3DMarkers(mass, position, sw, bal);
  }
}

function handleGridHover(e, ctx, w, h) {
  const hit = hitTestGrid(e, w, h);
  if (!hit) {
    // Outside grid — restore pin or clear
    if (pinnedPoint) {
      applyGridPoint(pinnedPoint.posIdx, pinnedPoint.massIdx, ctx, w, h);
    } else {
      handleGridLeave();
    }
    return;
  }
  // Preview on hover (overrides pin visually)
  applyGridPoint(hit.posIdx, hit.massIdx, ctx, w, h);
}

function handleGridClick(e, ctx, w, h) {
  const hit = hitTestGrid(e, w, h);
  if (!hit) {
    // Click outside grid — clear pin
    pinnedPoint = null;
    handleGridLeave();
    return;
  }
  // Toggle pin: if clicking the same cell, unpin; otherwise pin new cell
  if (pinnedPoint && pinnedPoint.posIdx === hit.posIdx && pinnedPoint.massIdx === hit.massIdx) {
    pinnedPoint = null;
    handleGridLeave();
  } else {
    pinnedPoint = { posIdx: hit.posIdx, massIdx: hit.massIdx };
    applyGridPoint(hit.posIdx, hit.massIdx, ctx, w, h);
  }
}

function handleGridLeave() {
  if (pinnedPoint) {
    // Restore pinned point
    if (canvasReady && cachedCtx) {
      applyGridPoint(pinnedPoint.posIdx, pinnedPoint.massIdx, cachedCtx, cachedW, cachedH);
    }
    return;
  }

  document.getElementById('readout-bar').classList.remove('visible');

  // Remove markers from 3D plots
  remove3DMarkers();

  // Redraw grid without crosshair
  if (canvasReady && cachedCtx) {
    drawGrid(cachedCtx, cachedW, cachedH);
  }
}

function showReadout(mass, pos, wt, sw, bal) {
  document.getElementById('readout-mass').textContent = mass.toFixed(1) + ' g';
  document.getElementById('readout-pos').textContent = pos.toFixed(1) + ' cm';
  document.getElementById('readout-weight').textContent = wt.toFixed(1) + ' g';
  document.getElementById('readout-sw').textContent = sw.toFixed(1) + ' kg·cm²';
  document.getElementById('readout-bal').textContent = bal.toFixed(1) + ' cm';
  document.getElementById('readout-bar').classList.add('visible');
}

// ── Color Mode Toggle ──────────────────────────────────────
function setColorMode(mode) {
  colorMode = mode;
  document.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  if (canvasReady) {
    const canvas = document.getElementById('grid-canvas');
    const wrapper = document.getElementById('grid-wrapper');
    const rect = wrapper.getBoundingClientRect();
    const w = rect.width;
    const h = Math.min(w * 0.42, 380);
    const ctx = canvas.getContext('2d');
    drawGrid(ctx, w, h);
  }
}

// ── Formulas Toggle ────────────────────────────────────────
function toggleFormulas() {
  const content = document.getElementById('formulas-content');
  const chevron = document.getElementById('formulas-chevron');
  content.classList.toggle('open');
  chevron.classList.toggle('open');
}

// ── 3D Plots ───────────────────────────────────────────────
const plotlyLayout3D = (title, zLabel) => ({
  paper_bgcolor: 'rgba(0,0,0,0)',
  plot_bgcolor: 'rgba(0,0,0,0)',
  margin: { l: 0, r: 0, t: 10, b: 0 },
  scene: {
    xaxis: {
      title: { text: 'Position (cm)', font: { size: 11, color: '#6b7280', family: 'Inter' } },
      gridcolor: 'rgba(0,0,0,0.06)',
      zerolinecolor: 'rgba(0,0,0,0.1)',
      color: '#6b7280',
      tickfont: { size: 10, family: 'JetBrains Mono', color: '#9ca3af' },
      backgroundcolor: 'rgba(0,0,0,0)',
    },
    yaxis: {
      title: { text: 'Mass (g)', font: { size: 11, color: '#6b7280', family: 'Inter' } },
      gridcolor: 'rgba(0,0,0,0.06)',
      zerolinecolor: 'rgba(0,0,0,0.1)',
      color: '#6b7280',
      tickfont: { size: 10, family: 'JetBrains Mono', color: '#9ca3af' },
      backgroundcolor: 'rgba(0,0,0,0)',
    },
    zaxis: {
      title: { text: zLabel, font: { size: 11, color: '#6b7280', family: 'Inter' } },
      gridcolor: 'rgba(0,0,0,0.06)',
      zerolinecolor: 'rgba(0,0,0,0.1)',
      color: '#6b7280',
      tickfont: { size: 10, family: 'JetBrains Mono', color: '#9ca3af' },
      backgroundcolor: 'rgba(0,0,0,0)',
    },
    bgcolor: 'rgba(255,255,255,0.0)',
    camera: {
      eye: { x: 1.8, y: -1.6, z: 1.0 }
    },
  },
  font: { family: 'Inter, sans-serif', color: '#6b7280' },
});

const plotlyConfig = {
  responsive: true,
  displaylogo: false,
  modeBarButtonsToRemove: ['toImage', 'resetCameraLastSave3d'],
};

function render3DPlots() {
  // Swingweight surface
  const swTrace = {
    type: 'surface',
    x: positionAxis,
    y: massAxis,
    z: swGrid,
    colorscale: [
      [0, '#3b82f6'],
      [0.25, '#0891b2'],
      [0.5, '#eab308'],
      [0.75, '#f59e0b'],
      [1, '#ef4444'],
    ],
    opacity: 0.88,
    contours: {
      z: { show: true, usecolormap: true, highlightcolor: '#fff', project: { z: false } }
    },
    hovertemplate:
      'Position: %{x:.1f} cm<br>Mass: %{y:.1f} g<br>SW: %{z:.1f} kg·cm²<extra></extra>',
    colorbar: {
      title: { text: 'kg·cm²', font: { size: 10, color: '#6b7280' } },
      tickfont: { size: 9, color: '#9ca3af', family: 'JetBrains Mono' },
      thickness: 12,
      len: 0.6,
      outlinewidth: 0,
    },
    name: 'Swingweight',
  };

  Plotly.newPlot('plot-swingweight', [swTrace],
    plotlyLayout3D('Swingweight Surface', 'SW (kg·cm²)'), plotlyConfig);

  // Balance surface
  const balTrace = {
    type: 'surface',
    x: positionAxis,
    y: massAxis,
    z: balGrid,
    colorscale: [
      [0, '#a78bfa'],
      [0.25, '#6366f1'],
      [0.5, '#22d3ee'],
      [0.75, '#6ee7b7'],
      [1, '#fbbf24'],
    ],
    opacity: 0.88,
    contours: {
      z: { show: true, usecolormap: true, highlightcolor: '#fff', project: { z: false } }
    },
    hovertemplate:
      'Position: %{x:.1f} cm<br>Mass: %{y:.1f} g<br>Balance: %{z:.1f} cm<extra></extra>',
    colorbar: {
      title: { text: 'cm', font: { size: 10, color: '#6b7280' } },
      tickfont: { size: 9, color: '#9ca3af', family: 'JetBrains Mono' },
      thickness: 12,
      len: 0.6,
      outlinewidth: 0,
    },
    name: 'Balance',
  };

  Plotly.newPlot('plot-balance', [balTrace],
    plotlyLayout3D('Balance Surface', 'Balance (cm)'), plotlyConfig);
}

function update3DMarkers(mass, position, sw, bal) {
  const markerTrace = {
    type: 'scatter3d',
    mode: 'markers',
    x: [position],
    y: [mass],
    z: null,
    marker: {
      size: 8,
      color: '#ef4444',
      symbol: 'diamond',
      line: { color: '#fff', width: 2 },
    },
    hoverinfo: 'skip',
    showlegend: false,
  };

  // SW plot marker
  const swMarker = { ...markerTrace, z: [sw] };
  const swPlot = document.getElementById('plot-swingweight');
  if (swPlot.data && swPlot.data.length > 1) {
    Plotly.deleteTraces('plot-swingweight', 1);
  }
  Plotly.addTraces('plot-swingweight', swMarker);

  // Balance plot marker
  const balMarker = { ...markerTrace, z: [bal] };
  const balPlot = document.getElementById('plot-balance');
  if (balPlot.data && balPlot.data.length > 1) {
    Plotly.deleteTraces('plot-balance', 1);
  }
  Plotly.addTraces('plot-balance', balMarker);
}

function remove3DMarkers() {
  try {
    const swPlot = document.getElementById('plot-swingweight');
    if (swPlot.data && swPlot.data.length > 1) {
      Plotly.deleteTraces('plot-swingweight', 1);
    }
    const balPlot = document.getElementById('plot-balance');
    if (balPlot.data && balPlot.data.length > 1) {
      Plotly.deleteTraces('plot-balance', 1);
    }
  } catch (e) { /* ignore */ }
}

// ── Main Compute & Render ──────────────────────────────────
function computeAndRender() {
  // Read inputs
  baseWeight = parseFloat(document.getElementById('input-weight').value) || 305;
  baseSW = parseFloat(document.getElementById('input-swingweight').value) || 320;
  baseBalance = parseFloat(document.getElementById('input-balance').value) || 32.5;
  maxMass = parseFloat(document.getElementById('input-max-mass').value) || 20;

  // Generate data
  generateData();

  // Render
  initCanvas();
  render3DPlots();

  // Scroll to grid
  document.getElementById('grid-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Init ───────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  computeAndRender();
});

// Resize handler
let resizeTimeout;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    if (canvasReady) initCanvas();
  }, 200);
});
