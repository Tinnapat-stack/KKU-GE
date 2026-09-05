// Entries that repeat: rent every month on the 5th, a subscription every 30 days.
//
// A web app with no server cannot wake itself up, so nothing happens on the day
// itself. Instead, opening the app works out every date that came due since the last
// time and offers them all at once. The user confirms before anything is written,
// because a rule set months ago may no longer match what they actually pay.

import {
  getRecurring,
  addTransaction,
  updateRecurring,
} from './storage.js';
import { scheduleSync } from './filesync.js';
import { toISODate, todayISO } from './validate.js';
import { formatBaht, formatThaiDate } from './format.js';
import { showToast } from './toast.js';

const $ = (id) => document.getElementById(id);

// A rule that has not been opened in a very long time should not generate hundreds
// of rows in one go.
const MAX_CATCH_UP = 60;

let ctx = null;
let onDone = null;
let pending = []; // [{ rule, date }]

export function initRecurring(context, done) {
  ctx = context;
  onDone = done;

  $('due-skip').addEventListener('click', () => finish(false));
  $('due-create').addEventListener('click', () => finish(true));
}

export function setRecurringContext(context) {
  ctx = context;
}

/* ---------- Dates ---------- */

const daysInMonth = (year, month) => new Date(year, month + 1, 0).getDate();

// The day of the month a rule falls on, pulled back to the last day when the month
// is too short. Asking for the 31st in February means the 28th or 29th, not March.
function monthlyDate(year, month, dayOfMonth) {
  const day = Math.min(dayOfMonth, daysInMonth(year, month));
  return toISODate(new Date(year, month, day));
}

// Does this rule fall on this exact date? The calendar looks forward and does not
// care whether a date has already been generated, so it cannot use dueDates, which
// walks from the last run.
export function occursOn(rule, dateISO) {
  if (!rule.active) return false;
  const start = rule.startDate || '';
  if (start && dateISO < start) return false;

  if (rule.cycle === 'days') {
    const step = Math.max(1, Number(rule.intervalDays) || 30);
    const from = new Date(`${start || dateISO}T00:00:00`);
    const on = new Date(`${dateISO}T00:00:00`);
    const days = Math.round((on - from) / 86400000);
    return days >= 0 && days % step === 0;
  }

  const day = Math.min(Math.max(1, Number(rule.dayOfMonth) || 1), 31);
  const on = new Date(`${dateISO}T00:00:00`);
  return dateISO === monthlyDate(on.getFullYear(), on.getMonth(), day);
}

// The next date on or after today that this rule falls on. Scanning forward is fine
// because the answer is at most one cycle away, and a year is the safety net.
export function nextOccurrence(rule, from = todayISO()) {
  const cursor = new Date(`${from}T00:00:00`);
  for (let i = 0; i < 366; i++) {
    const date = toISODate(cursor);
    if (occursOn(rule, date)) return date;
    cursor.setDate(cursor.getDate() + 1);
  }
  return '';
}

// Every date a rule came due, from the day after its last run up to today.
export function dueDates(rule, today = todayISO()) {
  const dates = [];
  const start = rule.startDate || today;

  if (rule.cycle === 'days') {
    const step = Math.max(1, Number(rule.intervalDays) || 30);
    let cursor = new Date(rule.lastRun || start);
    // With no run yet the start date itself is the first occurrence; after that,
    // each occurrence is `step` days on from the one before.
    if (rule.lastRun) cursor.setDate(cursor.getDate() + step);

    while (toISODate(cursor) <= today && dates.length < MAX_CATCH_UP) {
      dates.push(toISODate(cursor));
      cursor.setDate(cursor.getDate() + step);
    }
    return dates;
  }

  const day = Math.min(Math.max(1, Number(rule.dayOfMonth) || 1), 31);
  const from = new Date(rule.lastRun || start);
  const cursor = new Date(from.getFullYear(), from.getMonth(), 1);

  while (dates.length < MAX_CATCH_UP) {
    const date = monthlyDate(cursor.getFullYear(), cursor.getMonth(), day);
    if (date > today) break;
    if (date >= start && (!rule.lastRun || date > rule.lastRun)) dates.push(date);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return dates;
}

/* ---------- The prompt ---------- */

// Called once after the app opens. Returns true when something was offered, so the
// caller knows a dialog is on screen.
export function checkDue() {
  pending = [];

  for (const rule of getRecurring(ctx.accountId, ctx.walletId)) {
    if (!rule.active) continue;
    for (const date of dueDates(rule)) pending.push({ rule, date });
  }

  if (pending.length === 0) return false;

  pending.sort((a, b) => a.date.localeCompare(b.date));
  render();
  $('due-overlay').hidden = false;
  return true;
}

function render() {
  const list = $('due-list');
  list.innerHTML = '';

  $('due-count').textContent = `มี ${pending.length} รายการที่ถึงกำหนดแล้ว`;

  pending.forEach((item, i) => {
    const row = document.createElement('label');
    row.className = 'due-row';

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = true;
    box.dataset.index = String(i);

    const text = document.createElement('span');
    text.className = 'due-text';

    const title = document.createElement('span');
    title.className = 'due-title';
    const label = item.rule.sub ? `${item.rule.category} · ${item.rule.sub}` : item.rule.category;
    title.textContent = label;

    const meta = document.createElement('span');
    meta.className = 'due-meta';
    meta.textContent = formatThaiDate(item.date);

    text.append(title, meta);

    const amount = document.createElement('span');
    amount.className = `due-amount ${item.rule.type}`;
    amount.textContent = `${item.rule.type === 'income' ? '+' : '-'}${formatBaht(item.rule.amount)}`;

    row.append(box, text, amount);
    list.appendChild(row);
  });
}

// Every offered date is marked as handled either way, so the same dates are never
// offered twice. The dialog says so, because a silent skip would be a surprise.
function finish(create) {
  const checked = new Set(
    [...$('due-list').querySelectorAll('input:checked')].map((el) => Number(el.dataset.index))
  );

  let made = 0;
  const lastByRule = new Map();

  pending.forEach((item, i) => {
    if (create && checked.has(i)) {
      addTransaction(ctx.accountId, {
        walletId: item.rule.walletId,
        type: item.rule.type,
        amount: item.rule.amount,
        quantity: 1,
        category: item.rule.category,
        sub: item.rule.sub || '',
        note: item.rule.note || '',
        date: item.date,
        fromRecurring: item.rule.id,
      });
      made++;
    }

    const previous = lastByRule.get(item.rule.id);
    if (!previous || item.date > previous) lastByRule.set(item.rule.id, item.date);
  });

  for (const [id, date] of lastByRule) updateRecurring(ctx.accountId, id, { lastRun: date });
  scheduleSync(ctx.accountId);

  pending = [];
  $('due-overlay').hidden = true;
  if (onDone) onDone();

  showToast(
    made ? `สร้างรายการประจำ ${made} รายการแล้ว` : 'ข้ามรายการประจำรอบนี้แล้ว',
    'info'
  );
}
