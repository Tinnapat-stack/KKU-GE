// Home background animation: money falls from above and settles into a slow
// drift, while golden light eases in as though coming through several small
// openings overhead.
//
// The photograph underneath cannot be animated, since it is one flat layer. What
// moves is drawn here on a canvas above it, which also keeps the moving elements
// crisp regardless of the photograph's resolution.

const FULL_MS = 3000;   // first visit of a session
const SHORT_MS = 1200;  // every visit after that
const MAX_DPR = 2;

// Light through openings, not one spotlight: several narrow beams across the top.
const BEAMS = [
  { x: 0.18, spread: 0.16, strength: 0.30 },
  { x: 0.34, spread: 0.10, strength: 0.22 },
  { x: 0.52, spread: 0.20, strength: 0.34 },
  { x: 0.71, spread: 0.12, strength: 0.24 },
  { x: 0.87, spread: 0.15, strength: 0.20 },
];

let canvas = null;
let ctx = null;
let sparkleEl = null;
let rayEl = null;
let particles = [];
let rafId = null;
let startTime = 0;
let duration = FULL_MS;
let hasPlayed = false; // resets on reload, so a refresh replays the full sequence
let running = false;

const reducedMotion = () =>
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const rand = (min, max) => min + Math.random() * (max - min);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

/* ---------- Setup ---------- */

function sizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w, h };
}

// Phones draw fewer notes than desktops, both for looks and for battery.
function particleCount(width) {
  if (width < 420) return 26;
  if (width < 800) return 34;
  return 46;
}

function makeParticles(w, h) {
  const list = [];
  const count = particleCount(w);

  for (let i = 0; i < count; i++) {
    // Three depth tiers: far notes are smaller, dimmer and slower.
    const tier = i % 3;
    const scale = [0.55, 0.8, 1][tier];

    list.push({
      tier,
      x: rand(-0.08 * w, 1.08 * w),
      y: rand(-h * 1.15, -20),
      vy: rand(60, 130) * scale,
      vx: rand(-12, 12),
      sway: rand(0.6, 1.6),
      swayPhase: rand(0, Math.PI * 2),
      angle: rand(0, Math.PI * 2),
      spin: rand(-1.1, 1.1),
      width: rand(26, 42) * scale,
      alpha: [0.34, 0.6, 0.85][tier],
      isCoin: Math.random() < 0.25,
    });
  }
  return list;
}

/* ---------- Drawing ---------- */

function drawNote(c, p) {
  const w = p.width;
  const h = w * 0.44;

  const grad = c.createLinearGradient(-w / 2, 0, w / 2, 0);
  grad.addColorStop(0, '#cfe0c4');
  grad.addColorStop(0.5, '#eef3e6');
  grad.addColorStop(1, '#bcd0b2');

  c.fillStyle = grad;
  c.fillRect(-w / 2, -h / 2, w, h);

  c.strokeStyle = 'rgba(70,95,60,0.55)';
  c.lineWidth = 1;
  c.strokeRect(-w / 2, -h / 2, w, h);

  // A suggestion of the printed oval, enough to read as a banknote at this size.
  c.strokeStyle = 'rgba(70,95,60,0.4)';
  c.beginPath();
  c.ellipse(0, 0, w * 0.16, h * 0.3, 0, 0, Math.PI * 2);
  c.stroke();
}

function drawCoin(c, p) {
  const r = p.width * 0.28;
  const grad = c.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.15, 0, 0, r);
  grad.addColorStop(0, '#f6dc94');
  grad.addColorStop(0.6, '#d9ad42');
  grad.addColorStop(1, '#9c7620');

  c.fillStyle = grad;
  c.beginPath();
  c.arc(0, 0, r, 0, Math.PI * 2);
  c.fill();

  c.strokeStyle = 'rgba(120,90,20,0.7)';
  c.lineWidth = 1;
  c.stroke();
}

function drawLight(c, w, h, progress) {
  for (const beam of BEAMS) {
    const cx = beam.x * w;
    const radius = h * (0.75 + beam.spread);
    const grad = c.createRadialGradient(cx, -h * 0.12, 0, cx, -h * 0.12, radius);
    const peak = beam.strength * progress;

    grad.addColorStop(0, `rgba(255,214,130,${peak})`);
    grad.addColorStop(0.45, `rgba(233,183,86,${peak * 0.35})`);
    grad.addColorStop(1, 'rgba(214,163,60,0)');

    c.fillStyle = grad;
    c.fillRect(cx - w * beam.spread * 2.4, 0, w * beam.spread * 4.8, h);
  }
}

function draw(w, h, progress) {
  ctx.clearRect(0, 0, w, h);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  drawLight(ctx, w, h, progress);
  ctx.restore();

  for (const p of particles) {
    ctx.save();
    ctx.globalAlpha = p.alpha;
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    if (p.isCoin) drawCoin(ctx, p);
    else drawNote(ctx, p);
    ctx.restore();
  }
}

/* ---------- Loop ---------- */

function step(now) {
  if (!running) return;

  const { w, h } = { w: canvas.clientWidth, h: canvas.clientHeight };
  const elapsed = now - startTime;
  const t = Math.min(1, elapsed / duration);
  const progress = easeOut(t);

  // Damping ramps up across the sequence, so the notes ease into a slow drift and
  // stay on screen rather than falling away.
  const damping = 1 - 0.92 * progress;
  const dt = 1 / 60;

  for (const p of particles) {
    p.y += p.vy * damping * dt * 60 * 0.016;
    p.x += (p.vx + Math.sin(elapsed / 900 + p.swayPhase) * p.sway * 8) * damping * dt;
    p.angle += p.spin * damping * dt;

    // Anything that still drifts past the bottom wraps back above the viewport.
    if (p.y > h + 60) p.y = -60;
  }

  draw(w, h, progress);

  if (sparkleEl) sparkleEl.style.opacity = String(0.5 * progress);
  if (rayEl) rayEl.style.opacity = String(0.32 * progress);

  if (t < 1) {
    rafId = requestAnimationFrame(step);
  } else {
    // Hold the final frame. Stopping the loop here is what keeps the page from
    // burning battery once there is nothing left to animate.
    rafId = null;
    running = false;
  }
}

function renderFinalFrame() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  for (const p of particles) {
    p.y = rand(0.05 * h, 0.95 * h);
  }
  draw(w, h, 1);
  if (sparkleEl) sparkleEl.style.opacity = '0.5';
  if (rayEl) rayEl.style.opacity = '0.32';
}

/* ---------- Public API ---------- */

export function initHomeBackground() {
  canvas = document.getElementById('home-canvas');
  sparkleEl = document.getElementById('home-sparkle');
  rayEl = document.getElementById('home-lightray');
  if (!canvas) return;
  ctx = canvas.getContext('2d');

  window.addEventListener('resize', () => {
    if (!canvas || document.getElementById('home-layers').hidden) return;
    const { w, h } = sizeCanvas();
    particles = makeParticles(w, h);
    renderFinalFrame();
  });
}

// Called whenever Home becomes the visible page.
export function playHomeBackground() {
  const layers = document.getElementById('home-layers');
  if (!canvas || !layers) return;

  layers.hidden = false;
  document.getElementById('backdrop').classList.add('on-home');
  const { w, h } = sizeCanvas();
  particles = makeParticles(w, h);

  if (reducedMotion()) {
    renderFinalFrame();
    hasPlayed = true;
    return;
  }

  duration = hasPlayed ? SHORT_MS : FULL_MS;
  hasPlayed = true;

  // A shorter replay starts the notes already on screen, so returning to Home
  // shows the light easing in rather than a second downpour.
  if (duration === SHORT_MS) {
    for (const p of particles) p.y = rand(-0.2 * h, 0.9 * h);
  }

  cancelAnimationFrame(rafId);
  running = true;
  startTime = performance.now();
  rafId = requestAnimationFrame(step);
}

// Called when any other page becomes visible.
export function stopHomeBackground() {
  const layers = document.getElementById('home-layers');
  running = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  if (layers) layers.hidden = true;
  const backdrop = document.getElementById('backdrop');
  if (backdrop) backdrop.classList.remove('on-home');
}
