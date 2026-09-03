// The printable summary: what came in, what went out, and where it went, for the
// period the user is already looking at on the analytics page.
//
// It is a summary, not a dump. The number of rows is bounded by the shape of the
// report rather than by cutting data off: a week summarises by day, a year by month.
// A year of a thousand entries therefore still prints on two or three sheets, and a
// note points at the CSV for anyone who wants every line.

import { getTransactions, getWallets, getAccountById, transferTotals } from './storage.js';
import { currentPeriod } from './analytics.js';
import { toISODate } from './validate.js';
import {
  formatBaht,
  formatThaiDate,
  formatThaiDateLong,
  formatMonthYear,
  formatPercent,
} from './format.js';

const $ = (id) => document.getElementById(id);

// Beyond this many entries the detailed list stops being a summary and starts being
// the CSV, which the app already produces.
const DETAIL_LIMIT = 120;

const THAI_WEEKDAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

let ctx = null;

export function initReport(context) {
  ctx = context;

  $('report-close').addEventListener('click', closeReport);
  $('report-print').addEventListener('click', () => window.print());
  $('report-overlay').addEventListener('click', (e) => {
    if (e.target === $('report-overlay')) closeReport();
  });
}

export function setReportContext(context) {
  ctx = context;
}

export function openReport() {
  render();
  $('report-overlay').hidden = false;
  document.body.classList.add('printing-report');
  $('report-body').scrollTop = 0;
}

export function closeReport() {
  $('report-overlay').hidden = true;
  document.body.classList.remove('printing-report');
}

/* ---------- Building the numbers ---------- */

function periodRows(startISO, endISO) {
  return getTransactions(ctx.accountId, ctx.walletId, { includeTransfers: false }).filter(
    (t) => t.date >= startISO && t.date <= endISO
  );
}

// Totals per main category, with each category's subcategories under it. Grouping at
// the main level is what makes the table match the budgets and the chart.
function categoryTree(rows, type) {
  const filtered = rows.filter((t) => t.type === type);
  const total = filtered.reduce((sum, t) => sum + t.amount, 0);
  const mains = new Map();

  for (const t of filtered) {
    if (!mains.has(t.category)) mains.set(t.category, { amount: 0, count: 0, subs: new Map() });
    const main = mains.get(t.category);
    main.amount += t.amount;
    main.count += 1;

    if (!t.sub) continue;
    if (!main.subs.has(t.sub)) main.subs.set(t.sub, { amount: 0, count: 0 });
    const sub = main.subs.get(t.sub);
    sub.amount += t.amount;
    sub.count += 1;
  }

  const list = [...mains.entries()]
    .map(([name, v]) => ({
      name,
      amount: v.amount,
      count: v.count,
      subs: [...v.subs.entries()]
        .map(([subName, sv]) => ({ name: subName, ...sv }))
        .sort((a, b) => b.amount - a.amount),
    }))
    .sort((a, b) => b.amount - a.amount);

  return { list, total };
}

// One bucket per day or per month, depending on how long the period is. The bucket
// count is what keeps a year's report short.
function timeBuckets(range, start, end, rows) {
  const buckets = [];
  const add = (key, label) => buckets.push({ key, label, income: 0, expense: 0, count: 0 });

  if (range === 'year') {
    for (let m = 0; m < 12; m++) {
      const date = new Date(start.getFullYear(), m, 1);
      add(`${start.getFullYear()}-${String(m + 1).padStart(2, '0')}`, formatMonthYear(date));
    }
  } else {
    const cursor = new Date(start);
    while (cursor <= end) {
      const iso = toISODate(cursor);
      const label =
        range === 'week'
          ? `${THAI_WEEKDAYS[cursor.getDay()]} ${formatThaiDate(iso)}`
          : formatThaiDate(iso);
      add(iso, label);
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  const index = new Map(buckets.map((b) => [b.key, b]));
  for (const t of rows) {
    const key = range === 'year' ? t.date.slice(0, 7) : t.date;
    const bucket = index.get(key);
    if (!bucket) continue;
    bucket[t.type] += t.amount;
    bucket.count += 1;
  }

  // An empty day in the middle of a month is worth showing; a stretch of empty
  // months at the end of a year is not.
  return buckets.filter((b) => b.count > 0 || range !== 'year');
}

/* ---------- Rendering ---------- */

function cell(text, className) {
  const td = document.createElement('td');
  if (className) td.className = className;
  td.textContent = text;
  return td;
}

function table(headings, rows) {
  const el = document.createElement('table');
  el.className = 'report-table';

  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  headings.forEach(({ text, className }) => {
    const th = document.createElement('th');
    if (className) th.className = className;
    th.textContent = text;
    headRow.appendChild(th);
  });
  head.appendChild(headRow);

  const body = document.createElement('tbody');
  rows.forEach((cells) => body.appendChild(cells));

  el.append(head, body);
  return el;
}

function section(title, note) {
  const wrap = document.createElement('section');
  wrap.className = 'report-section';

  const heading = document.createElement('h4');
  heading.className = 'report-heading';
  heading.textContent = title;
  wrap.appendChild(heading);

  if (note) {
    const p = document.createElement('p');
    p.className = 'report-note';
    p.textContent = note;
    wrap.appendChild(p);
  }
  return wrap;
}

function render() {
  const { range, start, end, title } = currentPeriod();
  const startISO = toISODate(start);
  const endISO = toISODate(end);
  const rows = periodRows(startISO, endISO);

  const body = $('report-body');
  body.innerHTML = '';

  body.appendChild(header(title, rows.length));
  body.appendChild(totals(rows, startISO, endISO));
  body.appendChild(categorySection('expense', 'รายจ่ายแยกตามหมวด', rows));
  body.appendChild(categorySection('income', 'รายรับแยกตามหมวด', rows));
  body.appendChild(timeSection(range, start, end, rows));
  body.appendChild(detailSection(range, rows));
}

function header(title, count) {
  const wrap = document.createElement('div');
  wrap.className = 'report-header';

  const account = getAccountById(ctx.accountId);
  const wallet = getWallets(ctx.accountId).find((w) => w.id === ctx.walletId);

  const name = document.createElement('h3');
  name.className = 'report-title';
  name.textContent = 'สรุปรายรับรายจ่าย';

  const app = document.createElement('p');
  app.className = 'report-app';
  app.textContent = 'P Smart Wallet 888';

  const meta = document.createElement('dl');
  meta.className = 'report-meta';
  const pairs = [
    ['ช่วงเวลา', title],
    ['กระเป๋า', wallet ? wallet.name : '-'],
    ['ผู้ใช้', account ? account.username : '-'],
    ['จำนวนรายการ', `${count} รายการ`],
    ['ออกรายงานเมื่อ', formatThaiDateLong(toISODate(new Date()))],
  ];
  for (const [label, value] of pairs) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    meta.append(dt, dd);
  }

  wrap.append(app, name, meta);
  return wrap;
}

function totals(rows, startISO, endISO) {
  const income = rows.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expense = rows.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const moved = transferTotals(ctx.accountId, ctx.walletId, startISO, endISO);

  const wrap = section('ยอดรวมของช่วงนี้');
  const list = document.createElement('dl');
  list.className = 'report-totals';

  const lines = [
    ['รายรับ', formatBaht(income), 'income'],
    ['รายจ่าย', formatBaht(expense), 'expense'],
    ['คงเหลือสุทธิ', formatBaht(income - expense), income - expense < 0 ? 'expense' : 'balance'],
  ];

  // Transfers are not income or expense, so they sit apart from the three lines
  // above rather than inside them.
  if (moved.in > 0 || moved.out > 0) {
    lines.push(['โอนเข้ากระเป๋านี้', formatBaht(moved.in), 'muted']);
    lines.push(['โอนออกจากกระเป๋านี้', formatBaht(moved.out), 'muted']);
  }

  for (const [label, value, tone] of lines) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.className = `report-amount ${tone}`;
    dd.textContent = value;
    list.append(dt, dd);
  }

  wrap.appendChild(list);

  if (moved.in > 0 || moved.out > 0) {
    const note = document.createElement('p');
    note.className = 'report-note';
    note.textContent =
      'การโอนระหว่างกระเป๋าไม่ถูกนับเป็นรายรับหรือรายจ่าย เพราะเงินยังอยู่กับผู้ใช้ แค่ย้ายกระเป๋า';
    wrap.appendChild(note);
  }

  return wrap;
}

function categorySection(type, title, rows) {
  const { list, total } = categoryTree(rows, type);
  const wrap = section(title);

  if (list.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'report-note';
    empty.textContent = type === 'expense' ? 'ไม่มีรายจ่ายในช่วงนี้' : 'ไม่มีรายรับในช่วงนี้';
    wrap.appendChild(empty);
    return wrap;
  }

  const body = [];
  for (const main of list) {
    const tr = document.createElement('tr');
    tr.className = 'report-main-row';
    tr.append(
      cell(main.name),
      cell(String(main.count), 'num'),
      cell(formatBaht(main.amount), 'num'),
      cell(formatPercent(main.amount, total), 'num')
    );
    body.push(tr);

    for (const sub of main.subs) {
      const subRow = document.createElement('tr');
      subRow.className = 'report-sub-row';
      subRow.append(
        cell(sub.name, 'indent'),
        cell(String(sub.count), 'num'),
        cell(formatBaht(sub.amount), 'num'),
        cell(formatPercent(sub.amount, total), 'num')
      );
      body.push(subRow);
    }
  }

  const totalRow = document.createElement('tr');
  totalRow.className = 'report-total-row';
  totalRow.append(cell('รวม'), cell('', 'num'), cell(formatBaht(total), 'num'), cell('100%', 'num'));
  body.push(totalRow);

  wrap.appendChild(
    table(
      [
        { text: 'หมวดหมู่' },
        { text: 'รายการ', className: 'num' },
        { text: 'ยอดรวม', className: 'num' },
        { text: 'สัดส่วน', className: 'num' },
      ],
      body
    )
  );
  return wrap;
}

const TIME_TITLES = {
  day: 'รายการในวันนี้',
  week: 'สรุปรายวัน',
  month: 'สรุปรายวัน',
  year: 'สรุปรายเดือน',
};

function timeSection(range, start, end, rows) {
  // A single day has no useful buckets: the detailed list below is the breakdown.
  if (range === 'day') return document.createDocumentFragment();

  const buckets = timeBuckets(range, start, end, rows);
  const wrap = section(TIME_TITLES[range]);

  const body = buckets.map((b) => {
    const tr = document.createElement('tr');
    if (b.count === 0) tr.className = 'report-empty-row';
    tr.append(
      cell(b.label),
      cell(b.income ? formatBaht(b.income) : '-', 'num'),
      cell(b.expense ? formatBaht(b.expense) : '-', 'num'),
      cell(b.count ? formatBaht(b.income - b.expense) : '-', 'num')
    );
    return tr;
  });

  wrap.appendChild(
    table(
      [
        { text: range === 'year' ? 'เดือน' : 'วันที่' },
        { text: 'รายรับ', className: 'num' },
        { text: 'รายจ่าย', className: 'num' },
        { text: 'คงเหลือ', className: 'num' },
      ],
      body
    )
  );
  return wrap;
}

// Every line only for the short periods. For a month or a year the list would be
// hundreds of rows, which is what the CSV is for, so the report says so instead.
function detailSection(range, rows) {
  if (range !== 'day' && range !== 'week') {
    return section(
      'รายการแบบละเอียด',
      'ช่วงนี้ยาวเกินกว่าจะพิมพ์ทีละรายการให้อ่านไหว ถ้าต้องการรายตัวทั้งหมด ' +
        'ให้เปิด MENU แล้วกดดาวน์โหลดไฟล์ CSV ซึ่งเปิดได้ด้วย Excel และ Google Sheets'
    );
  }

  const sorted = [...rows].sort((a, b) =>
    a.date === b.date ? a.createdAt.localeCompare(b.createdAt) : a.date.localeCompare(b.date)
  );
  const wrap = section('รายการแบบละเอียด');

  if (sorted.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'report-note';
    empty.textContent = 'ไม่มีรายการในช่วงนี้';
    wrap.appendChild(empty);
    return wrap;
  }

  const shown = sorted.slice(0, DETAIL_LIMIT);
  const body = shown.map((t) => {
    const tr = document.createElement('tr');
    const label = t.sub ? `${t.category} · ${t.sub}` : t.category;
    tr.append(
      cell(formatThaiDate(t.date)),
      cell(t.quantity > 1 ? `${label} × ${t.quantity}` : label),
      cell(t.note || '-'),
      cell(`${t.type === 'income' ? '+' : '-'}${formatBaht(t.amount)}`, `num ${t.type}`)
    );
    return tr;
  });

  wrap.appendChild(
    table(
      [
        { text: 'วันที่' },
        { text: 'หมวดหมู่' },
        { text: 'รายละเอียด' },
        { text: 'จำนวนเงิน', className: 'num' },
      ],
      body
    )
  );

  if (sorted.length > shown.length) {
    const note = document.createElement('p');
    note.className = 'report-note';
    note.textContent = `แสดง ${shown.length} จาก ${sorted.length} รายการ ที่เหลืออยู่ในไฟล์ CSV`;
    wrap.appendChild(note);
  }

  return wrap;
}
