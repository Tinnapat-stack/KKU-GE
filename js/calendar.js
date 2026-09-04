// The Home calendar: what is already committed, laid out on real dates.
//
// It shows only what the user has scheduled — recurring rules and the daily saving
// plan of a goal — not what they actually recorded. Mixing the two would answer two
// different questions in one grid: "what is coming" and "what happened".
//
// A month has 31 cells on a 400px screen, so a cell can only hold a number and a few
// dots; the details open below on a tap. A week has seven rows and room to name
// things outright, so it does.

import { getRecurring } from './storage.js';
import { occursOn } from './recurring.js';
import { savingGoals, goalProgress } from './goals.js';
import { toISODate, todayISO } from './validate.js';
import { formatBaht, formatThaiDate, formatMonthYear } from './format.js';

const $ = (id) => document.getElementById(id);

const THAI_WEEKDAYS = ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'];
const THAI_WEEKDAYS_FULL = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์'];

let ctx = null;
let view = 'month';
let offset = 0;
let selectedDate = '';

export function initCalendar(context) {
  ctx = context;

  document.querySelectorAll('.cal-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      view = tab.dataset.view;
      offset = 0;
      selectedDate = '';
      renderCalendar();
    });
  });

  $('cal-prev').addEventListener('click', () => {
    offset -= 1;
    selectedDate = '';
    renderCalendar();
  });
  $('cal-next').addEventListener('click', () => {
    offset += 1;
    selectedDate = '';
    renderCalendar();
  });
  $('cal-today').addEventListener('click', () => {
    offset = 0;
    selectedDate = todayISO();
    renderCalendar();
  });
}

export function setCalendarContext(context) {
  ctx = context;
}

/* ---------- What falls on a date ---------- */

// Thai weeks start on Monday, but getDay() calls Sunday zero.
const mondayIndex = (date) => (date.getDay() + 6) % 7;

// Everything committed for one date: the recurring rules that fall on it, and the
// goals whose saving plan is still running.
export function itemsOn(accountId, walletId, dateISO, rules, goals) {
  const items = [];

  for (const rule of rules) {
    if (!occursOn(rule, dateISO)) continue;
    items.push({
      kind: rule.type, // income or expense
      name: rule.sub ? `${rule.category} · ${rule.sub}` : rule.category,
      amount: rule.amount,
      note: rule.note || '',
    });
  }

  // A goal asks for its daily amount every day from today until the deadline. Past
  // days are not shown as still owing: that day is gone, and the catch-up figure on
  // the goal card is where falling behind is reported.
  const today = todayISO();
  for (const { goal, perDay } of goals) {
    if (dateISO < today || dateISO > goal.targetDate) continue;
    items.push({ kind: 'saving', name: goal.name, amount: perDay, note: 'ออมตามแผน' });
  }

  return items;
}

function sources() {
  const rules = getRecurring(ctx.accountId, ctx.walletId).filter((r) => r.active);
  const goals = savingGoals(ctx.accountId, ctx.walletId).map((goal) => {
    const p = goalProgress(ctx.accountId, goal);
    return { goal, perDay: p.catchUpPerDay || p.planPerDay || 0 };
  });
  return { rules, goals };
}

/* ---------- Rendering ---------- */

export function renderCalendar() {
  document.querySelectorAll('.cal-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.view === view);
  });

  const { rules, goals } = sources();
  const empty = rules.length === 0 && goals.length === 0;
  $('cal-empty').hidden = !empty;
  $('cal-body').hidden = empty;
  $('cal-detail').hidden = empty || !selectedDate;
  if (empty) {
    $('cal-title').textContent = '';
    return;
  }

  if (view === 'month') renderMonth(rules, goals);
  else renderWeek(rules, goals);
}

function renderMonth(rules, goals) {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const today = todayISO();

  $('cal-title').textContent = formatMonthYear(first);

  const body = $('cal-body');
  body.innerHTML = '';
  body.className = 'cal-body cal-month';

  for (const label of THAI_WEEKDAYS) {
    const head = document.createElement('span');
    head.className = 'cal-weekday';
    head.textContent = label;
    body.appendChild(head);
  }

  // Blank cells so the first of the month lands under the right weekday.
  for (let i = 0; i < mondayIndex(first); i++) {
    const blank = document.createElement('span');
    blank.className = 'cal-cell cal-blank';
    body.appendChild(blank);
  }

  for (let day = 1; day <= days; day++) {
    const date = toISODate(new Date(first.getFullYear(), first.getMonth(), day));
    const items = itemsOn(ctx.accountId, ctx.walletId, date, rules, goals);

    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'cal-cell';
    cell.dataset.date = date;
    if (date === today) cell.classList.add('today');
    if (date === selectedDate) cell.classList.add('selected');
    if (items.length === 0) cell.classList.add('quiet');

    const number = document.createElement('span');
    number.className = 'cal-day';
    number.textContent = String(day);
    cell.appendChild(number);

    const dots = document.createElement('span');
    dots.className = 'cal-dots';
    // One dot per kind, not per item: three dots say everything a cell this size can.
    for (const kind of ['income', 'expense', 'saving']) {
      if (!items.some((i) => i.kind === kind)) continue;
      const dot = document.createElement('i');
      dot.className = `cal-dot dot-${kind}`;
      dots.appendChild(dot);
    }
    cell.appendChild(dots);

    cell.addEventListener('click', () => {
      selectedDate = selectedDate === date ? '' : date;
      renderCalendar();
    });

    body.appendChild(cell);
  }

  renderDetail(rules, goals);
}

function renderDetail(rules, goals) {
  const detail = $('cal-detail');
  detail.innerHTML = '';
  detail.hidden = !selectedDate;
  if (!selectedDate) return;

  const items = itemsOn(ctx.accountId, ctx.walletId, selectedDate, rules, goals);

  const heading = document.createElement('div');
  heading.className = 'cal-detail-head';
  heading.textContent = formatThaiDate(selectedDate);
  detail.appendChild(heading);

  if (items.length === 0) {
    const none = document.createElement('p');
    none.className = 'cal-detail-empty';
    none.textContent = 'วันนี้ไม่มีรายการที่ตั้งไว้';
    detail.appendChild(none);
    return;
  }

  for (const item of items) detail.appendChild(itemRow(item));
}

function renderWeek(rules, goals) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const start = new Date(now);
  start.setDate(start.getDate() - mondayIndex(now) + offset * 7);
  const today = todayISO();

  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  $('cal-title').textContent =
    `${start.getDate()}/${start.getMonth() + 1} - ${end.getDate()}/${end.getMonth() + 1}`;

  const body = $('cal-body');
  body.innerHTML = '';
  body.className = 'cal-body cal-week';

  for (let i = 0; i < 7; i++) {
    const date = toISODate(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
    const items = itemsOn(ctx.accountId, ctx.walletId, date, rules, goals);

    const row = document.createElement('div');
    row.className = 'cal-week-row';
    if (date === today) row.classList.add('today');

    const label = document.createElement('div');
    label.className = 'cal-week-label';
    label.textContent = `${THAI_WEEKDAYS_FULL[i]} ${new Date(`${date}T00:00:00`).getDate()}`;

    const list = document.createElement('div');
    list.className = 'cal-week-items';

    if (items.length === 0) {
      const none = document.createElement('span');
      none.className = 'cal-detail-empty';
      none.textContent = 'ว่าง';
      list.appendChild(none);
    } else {
      // A week has room to name things, so nothing is hidden behind a tap here.
      for (const item of items) list.appendChild(itemRow(item));
    }

    row.append(label, list);
    body.appendChild(row);
  }

  $('cal-detail').hidden = true;
}

function itemRow(item) {
  const row = document.createElement('div');
  row.className = `cal-item kind-${item.kind}`;

  const dot = document.createElement('i');
  dot.className = `cal-dot dot-${item.kind}`;

  const name = document.createElement('span');
  name.className = 'cal-item-name';
  name.textContent = item.name;

  const amount = document.createElement('span');
  amount.className = 'cal-item-amount';
  const sign = item.kind === 'income' ? '+' : item.kind === 'expense' ? '-' : '';
  amount.textContent = `${sign}${formatBaht(item.amount)}`;

  row.append(dot, name, amount);
  return row;
}
