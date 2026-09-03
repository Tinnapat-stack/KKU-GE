// Analytics page: income vs expense for a chosen period, with a category breakdown.

import { getTransactions } from './storage.js';
import {
  formatBaht,
  formatBahtShort,
  formatPercent,
  formatThaiDateLong,
  formatMonthYear,
  toBuddhistYear,
  parseISODate,
} from './format.js';
import { toISODate } from './validate.js';

const ANIM_MS = 900; // blueprint caps the animation at one second
const COLOR_INCOME = '#2e9e6d';
const COLOR_INCOME_DARK = '#1d6d49';
const COLOR_EXPENSE = '#d9534f';
const COLOR_EXPENSE_DARK = '#93332f';
const COLOR_EMPTY = '#3b465c';
const COLOR_EMPTY_DARK = '#2a3244';

const $ = (id) => document.getElementById(id);

let ctx = null;
let currentRange = 'year';
let currentOffset = 0;
let animationFrame = null;

export function initAnalytics(context) {
  ctx = context;

  document.querySelectorAll('.range-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      currentRange = tab.dataset.range;
      currentOffset = 0;
      document.querySelectorAll('.range-tab').forEach((t) => t.classList.toggle('active', t === tab));
      renderAnalytics();
    });
  });

  $('period-prev').addEventListener('click', () => {
    currentOffset--;
    renderAnalytics();
  });

  $('period-next').addEventListener('click', () => {
    currentOffset++;
    renderAnalytics();
  });
}

export function setAnalyticsContext(context) {
  ctx = context;
}

/* ---------- Period maths ---------- */

function periodBounds(range, offset) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  if (range === 'day') {
    const day = new Date(now);
    day.setDate(day.getDate() + offset);
    return { start: day, end: day, title: formatThaiDateLong(toISODate(day)) };
  }

  if (range === 'week') {
    const start = new Date(now);
    // Thai weeks start on Monday; getDay() returns 0 for Sunday.
    const weekday = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - weekday + offset * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return {
      start,
      end,
      title: `${start.getDate()}/${start.getMonth() + 1} - ${end.getDate()}/${end.getMonth() + 1}`,
    };
  }

  if (range === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
    return { start, end, title: formatMonthYear(start) };
  }

  const year = now.getFullYear() + offset;
  return {
    start: new Date(year, 0, 1),
    end: new Date(year, 11, 31),
    title: `ปี ${toBuddhistYear(year)}`,
  };
}

// The report reads the same period the user is already looking at, so the date
// maths lives here once rather than being repeated there.
export function currentPeriod() {
  const { start, end, title } = periodBounds(currentRange, currentOffset);
  return { range: currentRange, start, end, title };
}

/* ---------- Render ---------- */

export function renderAnalytics() {
  const { start, end, title } = periodBounds(currentRange, currentOffset);
  const startISO = toISODate(start);
  const endISO = toISODate(end);

  // Transfers move money rather than make or spend it, so they stay out of every
  // total, percentage and slice on this page.
  const rows = getTransactions(ctx.accountId, ctx.walletId, { includeTransfers: false }).filter(
    (t) => t.date >= startISO && t.date <= endISO
  );

  $('period-title').textContent = title;
  $('period-count').textContent = `${rows.length} รายการ`;
  // Future periods hold nothing useful, so stop the user walking into them.
  $('period-next').disabled = currentOffset >= 0;

  const income = rows.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expense = rows.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const total = income + expense;

  $('total-income').textContent = formatBahtShort(income);
  $('total-expense').textContent = formatBahtShort(expense);
  $('total-income-pct').textContent = `${formatPercent(income, total)} ของทั้งหมด`;
  $('total-expense-pct').textContent = `${formatPercent(expense, total)} ของทั้งหมด`;

  const balance = income - expense;
  const balanceEl = $('chart-balance');
  balanceEl.textContent = formatBahtShort(balance);
  balanceEl.classList.toggle('negative', balance < 0);

  // The wireframe puts the dominant share in the middle of the chart.
  const dominant = income >= expense ? income : expense;
  $('chart-pct').textContent = total ? formatPercent(dominant, total) : '';

  renderBreakdown('breakdown-expense', rows, 'expense', 'ยังไม่มีรายจ่ายในช่วงนี้');
  renderBreakdown('breakdown-income', rows, 'income', 'ยังไม่มีรายรับในช่วงนี้');

  animatePie(income, expense);
}

function renderBreakdown(containerId, rows, type, emptyText) {
  const container = $(containerId);
  container.innerHTML = '';

  const filtered = rows.filter((t) => t.type === type);
  const total = filtered.reduce((s, t) => s + t.amount, 0);

  if (total === 0) {
    const empty = document.createElement('div');
    empty.className = 'breakdown-empty';
    empty.textContent = emptyText;
    container.appendChild(empty);
    return;
  }

  const byCategory = new Map();
  for (const t of filtered) {
    byCategory.set(t.category, (byCategory.get(t.category) || 0) + t.amount);
  }

  const sorted = Array.from(byCategory.entries()).sort((a, b) => b[1] - a[1]);

  for (const [category, amount] of sorted) {
    const row = document.createElement('div');
    row.className = 'breakdown-row';

    const top = document.createElement('div');
    top.className = 'breakdown-row-top';
    const name = document.createElement('span');
    name.textContent = category;
    const value = document.createElement('span');
    value.textContent = formatBaht(amount);
    top.append(name, value);

    const track = document.createElement('div');
    track.className = 'breakdown-bar-track';
    const fill = document.createElement('div');
    fill.className = `breakdown-bar-fill ${type}`;
    fill.style.width = `${(amount / total) * 100}%`;
    track.appendChild(fill);

    row.append(top, track);
    container.appendChild(row);
  }
}

/* ---------- Pseudo-3D pie chart ---------- */
// Canvas 2D has no real 3D. Depth comes from drawing the same ellipse repeatedly,
// shifted down a pixel at a time, then painting the lit top face over the stack.

function animatePie(income, expense) {
  const canvas = $('pie-canvas');
  const c = canvas.getContext('2d');
  const total = income + expense;

  if (animationFrame) cancelAnimationFrame(animationFrame);

  const slices = total
    ? [
        { value: income, top: COLOR_INCOME, side: COLOR_INCOME_DARK },
        { value: expense, top: COLOR_EXPENSE, side: COLOR_EXPENSE_DARK },
      ].filter((s) => s.value > 0)
    : [{ value: 1, top: COLOR_EMPTY, side: COLOR_EMPTY_DARK }];

  const startTime = performance.now();

  const frame = (time) => {
    const elapsed = time - startTime;
    // Ease-out so the sweep decelerates into place.
    const t = Math.min(1, elapsed / ANIM_MS);
    const progress = 1 - Math.pow(1 - t, 3);

    drawPie(c, canvas, slices, progress);

    if (t < 1) {
      animationFrame = requestAnimationFrame(frame);
    } else {
      animationFrame = null;
    }
  };

  animationFrame = requestAnimationFrame(frame);
}

function drawPie(c, canvas, slices, progress) {
  const w = canvas.width;
  const h = canvas.height;
  const depth = 26;
  const cx = w / 2;
  // Radius follows the width; the height is sized to match in the markup, so the
  // disc plus its extruded rim sits centred with no dead space underneath.
  const rx = w * 0.42;
  const ry = rx * 0.55; // squash the circle to suggest a tilted disc
  const cy = (h - depth) / 2;

  c.clearRect(0, 0, w, h);

  const total = slices.reduce((s, slice) => s + slice.value, 0);
  const sweep = Math.PI * 2 * progress;
  const startAngle = -Math.PI / 2;

  const angles = [];
  let angle = startAngle;
  for (const slice of slices) {
    const size = (slice.value / total) * sweep;
    angles.push({ slice, from: angle, to: angle + size });
    angle += size;
  }

  // Sides first, bottom-up, so the top face lands on a solid rim.
  for (let offset = depth; offset > 0; offset--) {
    for (const { slice, from, to } of angles) {
      c.beginPath();
      c.moveTo(cx, cy + offset);
      c.ellipse(cx, cy + offset, rx, ry, 0, from, to);
      c.closePath();
      c.fillStyle = slice.side;
      c.fill();
    }
  }

  for (const { slice, from, to } of angles) {
    c.beginPath();
    c.moveTo(cx, cy);
    c.ellipse(cx, cy, rx, ry, 0, from, to);
    c.closePath();
    c.fillStyle = slice.top;
    c.fill();

    // A hairline separator keeps two adjacent slices readable.
    c.strokeStyle = 'rgba(0,0,0,0.18)';
    c.lineWidth = 1;
    c.stroke();
  }
}
