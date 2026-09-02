// Home page: what the app can do, and where the user stands right now.
//
// Every figure here is derived from stored data. Nothing is hard-coded, so the
// page doubles as an honest status board rather than a brochure.

import {
  getTransactions,
  getGoals,
  getBudgets,
  getWallets,
  getAccountById,
} from './storage.js';
import { budgetStatus, monthBounds, LEVEL_LABELS } from './budget.js';
import { ICONS } from './icons.js';
import { transactionRow } from './txrow.js';
import { formatBaht, formatBahtShort, formatThaiDateLong, formatMonthYear } from './format.js';
import { todayISO, toISODate } from './validate.js';

const $ = (id) => document.getElementById(id);

const RECENT_ON_HOME = 4;

let ctx = null;
let onNavigate = null;
let onCreateWallet = null;

export function initHome(context, navigate, createWallet) {
  ctx = context;
  onNavigate = navigate;
  onCreateWallet = createWallet;

  document.getElementById('home-quick-add').addEventListener('click', () => {
    if (onNavigate) onNavigate('entry');
    // Focusing the amount field is what turns the blueprint's "record in three
    // seconds" claim into something the interface actually delivers.
    const amount = document.getElementById('amount-input');
    if (amount) amount.focus();
  });

  document.getElementById('home-create-wallet-btn').addEventListener('click', () => {
    if (onCreateWallet) onCreateWallet();
  });
}

export function setHomeContext(context) {
  ctx = context;
}

export function renderHome() {
  renderHero();

  // An account can legitimately have no wallet, for instance after importing a file
  // that carried none. Rather than papering over it, Home says so and offers a fix.
  const hasWallet = !!ctx.walletId;
  document.getElementById('home-no-wallet').hidden = hasWallet;
  document.getElementById('home-main').hidden = !hasWallet;
  if (!hasWallet) return;

  renderMonthSummary();
  renderRecent();
  renderBudgetCard();
  renderFeatures();
  renderAccountSummary();
}

/* ---------- Hero ---------- */

function renderHero() {
  const account = getAccountById(ctx.accountId);
  $('home-greeting').textContent = `สวัสดี ${account ? account.username : ''}`;
  $('home-date').textContent = formatThaiDateLong(todayISO());
}

/* ---------- This month ---------- */

function monthTransactions() {
  const { start, end } = monthBounds();
  return getTransactions(ctx.accountId, ctx.walletId).filter(
    (t) => t.date >= start && t.date <= end
  );
}

function renderMonthSummary() {
  const rows = monthTransactions();
  const income = rows.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expense = rows.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const balance = income - expense;

  $('home-month-label').textContent = formatMonthYear(new Date());
  $('home-month-income').textContent = formatBahtShort(income);
  $('home-month-expense').textContent = formatBahtShort(expense);

  const balanceEl = $('home-month-balance');
  balanceEl.textContent = formatBahtShort(balance);
  balanceEl.classList.toggle('negative', balance < 0);

  // The blueprint asks for the running balance, not only this month's, so both are
  // shown: the month for budgeting and the total for the real position.
  const all = getTransactions(ctx.accountId, ctx.walletId);
  const running = all.reduce((sum, t) => sum + (t.type === 'income' ? t.amount : -t.amount), 0);
  const runningEl = $('home-running-balance');
  runningEl.textContent = formatBahtShort(running);
  runningEl.classList.toggle('negative', running < 0);
}

/* ---------- Recent transactions ---------- */

function renderRecent() {
  const list = $('home-recent-list');
  const rows = getTransactions(ctx.accountId, ctx.walletId).sort((a, b) =>
    b.date === a.date ? b.createdAt.localeCompare(a.createdAt) : b.date.localeCompare(a.date)
  );

  list.innerHTML = '';
  $('home-recent-empty').hidden = rows.length > 0;
  $('home-recent-more').hidden = rows.length <= RECENT_ON_HOME;

  for (const tx of rows.slice(0, RECENT_ON_HOME)) {
    list.appendChild(transactionRow(tx));
  }
}

/* ---------- Budget card ---------- */

function renderBudgetCard() {
  const container = $('home-budget-body');
  const { total, categories } = budgetStatus(ctx.accountId, ctx.walletId);
  const rows = total ? [total, ...categories] : categories;

  container.innerHTML = '';

  if (rows.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'home-budget-empty';
    empty.textContent = 'ยังไม่ได้ตั้งงบประมาณ ตั้งไว้แล้วแอปจะเตือนเมื่อใช้ใกล้เกิน';

    const cta = document.createElement('button');
    cta.type = 'button';
    cta.className = 'btn btn-small btn-secondary';
    cta.textContent = 'ไปตั้งงบ';
    cta.addEventListener('click', () => onNavigate && onNavigate('plan'));

    container.append(empty, cta);
    return;
  }

  // Only the few most at-risk budgets belong on a summary screen.
  for (const row of rows.slice(0, 4)) {
    container.appendChild(budgetMiniRow(row));
  }

  if (rows.length > 4) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'home-budget-more';
    more.textContent = `ดูงบทั้งหมด ${rows.length} รายการ`;
    more.addEventListener('click', () => onNavigate && onNavigate('plan'));
    container.appendChild(more);
  }
}

function budgetMiniRow(row) {
  const el = document.createElement('div');
  el.className = `home-budget-row level-${row.level}`;

  const top = document.createElement('div');
  top.className = 'home-budget-row-top';

  const name = document.createElement('span');
  name.className = 'home-budget-name';
  name.textContent = row.isTotal ? 'งบรวมทั้งเดือน' : row.category;

  const value = document.createElement('span');
  value.className = 'home-budget-value';
  value.textContent = `${Math.round(row.percent)}%`;

  top.append(name, value);

  const track = document.createElement('div');
  track.className = 'budget-bar-track';
  const fill = document.createElement('div');
  fill.className = 'budget-bar-fill';
  fill.style.width = `${Math.min(100, row.percent)}%`;
  track.appendChild(fill);

  const detail = document.createElement('div');
  detail.className = 'home-budget-detail';
  detail.textContent =
    row.remaining >= 0
      ? `เหลือ ${formatBaht(row.remaining)} จาก ${formatBaht(row.limit)}`
      : `เกินงบ ${formatBaht(-row.remaining)} · ${LEVEL_LABELS[row.level]}`;

  el.append(top, track, detail);
  return el;
}

/* ---------- Feature cards ---------- */

function renderFeatures() {
  const container = $('home-features');
  const transactions = getTransactions(ctx.accountId, ctx.walletId);
  const goals = getGoals(ctx.accountId, ctx.walletId);
  const budgets = getBudgets(ctx.accountId, ctx.walletId);
  const reached = goals.filter((g) => (g.savedAmount || 0) >= g.targetAmount).length;

  const features = [
    {
      page: 'entry',
      icon: ICONS.entry,
      title: 'บันทึกรายรับรายจ่าย',
      desc: 'จดเงินเข้าเงินออกภายในไม่กี่วินาที เลือกหมวดหมู่จากปุ่มลัด ย้อนหลังได้ 60 วัน',
      stat: `บันทึกแล้ว ${transactions.length} รายการ`,
    },
    {
      page: 'analytics',
      icon: ICONS.analytics,
      title: 'ดูสถิติการใช้เงิน',
      desc: 'เทียบรายรับกับรายจ่ายราย วัน สัปดาห์ เดือน ปี พร้อมกราฟและอันดับหมวดที่ใช้มากสุด',
      stat: transactions.length ? 'พร้อมดูสรุปแล้ว' : 'ยังไม่มีข้อมูลให้สรุป',
    },
    {
      page: 'plan',
      icon: ICONS.gauge,
      title: 'ตั้งงบประมาณ',
      desc: 'กำหนดเพดานรายเดือนต่อหมวดหรือทั้งเดือน แล้วแอปจะเตือนตอนใช้ถึง 70% และตอนเกินงบ',
      stat: budgets.length ? `ตั้งงบไว้ ${budgets.length} รายการ` : 'ยังไม่ได้ตั้งงบ',
    },
    {
      page: 'plan',
      icon: ICONS.plan,
      title: 'เป้าหมายการออม',
      desc: 'ตั้งเป้าว่าจะเก็บเงินเท่าไรภายในเมื่อไร แล้วค่อยๆ เพิ่มเงินเข้าไปพร้อมดูความคืบหน้า',
      stat: goals.length ? `${goals.length} เป้าหมาย · สำเร็จแล้ว ${reached}` : 'ยังไม่มีเป้าหมาย',
    },
  ];

  container.innerHTML = '';
  for (const f of features) {
    container.appendChild(featureCard(f));
  }
}

function featureCard({ page, icon, title, desc, stat }) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'feature-card';
  card.addEventListener('click', () => onNavigate && onNavigate(page));

  const head = document.createElement('div');
  head.className = 'feature-head';

  const iconEl = document.createElement('span');
  iconEl.className = 'feature-icon';
  iconEl.innerHTML = icon;

  const titleEl = document.createElement('span');
  titleEl.className = 'feature-title';
  titleEl.textContent = title;

  head.append(iconEl, titleEl);

  const descEl = document.createElement('p');
  descEl.className = 'feature-desc';
  descEl.textContent = desc;

  const statEl = document.createElement('span');
  statEl.className = 'feature-stat';
  statEl.textContent = stat;

  card.append(head, descEl, statEl);
  return card;
}

/* ---------- Account summary ---------- */

// Consecutive days ending today (or yesterday) that have at least one entry.
// Counting from yesterday keeps a streak alive until the day is actually over.
function loggingStreak(transactions) {
  if (transactions.length === 0) return 0;

  const days = new Set(transactions.map((t) => t.date));
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);

  if (!days.has(toISODate(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!days.has(toISODate(cursor))) return 0;
  }

  let streak = 0;
  while (days.has(toISODate(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function renderAccountSummary() {
  const account = getAccountById(ctx.accountId);
  const wallets = getWallets(ctx.accountId);
  const active = wallets.find((w) => w.id === ctx.walletId);
  const transactions = getTransactions(ctx.accountId, ctx.walletId);
  const allTransactions = getTransactions(ctx.accountId);
  const streak = loggingStreak(transactions);

  const firstDate = allTransactions.length
    ? allTransactions.map((t) => t.date).sort()[0]
    : (account && account.createdAt ? account.createdAt.slice(0, 10) : todayISO());

  const rows = [
    { icon: ICONS.wallet, label: 'กระเป๋าที่ใช้อยู่', value: active ? active.name : '-' },
    { icon: ICONS.home, label: 'กระเป๋าทั้งหมด', value: `${wallets.length} ใบ` },
    { icon: ICONS.check, label: 'บันทึกในกระเป๋านี้', value: `${transactions.length} รายการ` },
    { icon: ICONS.flame, label: 'บันทึกต่อเนื่อง', value: streak > 0 ? `${streak} วัน` : 'ยังไม่เริ่ม' },
    { icon: ICONS.file, label: 'เริ่มใช้งานเมื่อ', value: formatThaiDateLong(firstDate) },
  ];

  const container = $('home-account-rows');
  container.innerHTML = '';

  for (const row of rows) {
    const el = document.createElement('div');
    el.className = 'account-row';

    const icon = document.createElement('span');
    icon.className = 'account-row-icon';
    icon.innerHTML = row.icon;

    const label = document.createElement('span');
    label.className = 'account-row-label';
    label.textContent = row.label;

    const value = document.createElement('span');
    value.className = 'account-row-value';
    value.textContent = row.value;

    el.append(icon, label, value);
    container.appendChild(el);
  }
}
