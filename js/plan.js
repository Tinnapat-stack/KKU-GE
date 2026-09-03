// Plan page: savings goals with progress tracking.

import {
  getGoals,
  addGoal,
  updateGoal,
  deleteGoal,
  setBudget,
  deleteBudget,
  getCustomCategories,
  getRecurring,
  addRecurring,
  updateRecurring,
  deleteRecurring,
  TOTAL_BUDGET,
} from './storage.js';
import { budgetStatus, LEVEL_LABELS } from './budget.js';
import { CATEGORIES, EXPENSE_CATEGORY_NAMES } from './categories.js';
import { scheduleSync } from './filesync.js';
import { validateAmount, validateName, validateGoalDate, todayISO } from './validate.js';
import { formatBaht, formatThaiDateLong } from './format.js';

const $ = (id) => document.getElementById(id);

let ctx = null;

export function initPlan(context) {
  ctx = context;

  $('add-goal-btn').addEventListener('click', () => toggleForm(true));
  $('goal-cancel-btn').addEventListener('click', () => toggleForm(false));
  $('goal-save-btn').addEventListener('click', saveGoal);
  $('goal-date-input').min = todayISO();

  $('add-budget-btn').addEventListener('click', () => toggleBudgetForm(true));
  $('budget-cancel-btn').addEventListener('click', () => toggleBudgetForm(false));
  $('budget-save-btn').addEventListener('click', saveBudget);

  $('add-recurring-btn').addEventListener('click', () => toggleRecurringForm(true));
  $('recurring-cancel-btn').addEventListener('click', () => toggleRecurringForm(false));
  $('recurring-save-btn').addEventListener('click', saveRecurring);
  $('recurring-type').addEventListener('change', renderRecurringCategories);
  $('recurring-cycle').addEventListener('change', renderCycleFields);
}

export function setPlanContext(context) {
  ctx = context;
}

function toggleForm(show) {
  $('goal-form-wrap').hidden = !show;
  $('add-goal-btn').hidden = show;
  $('goal-error').hidden = true;

  if (show) {
    $('goal-name-input').value = '';
    $('goal-target-input').value = '';
    $('goal-date-input').value = '';
    $('goal-name-input').focus();
  }
}

function showGoalError(message) {
  const el = $('goal-error');
  el.textContent = message;
  el.hidden = !message;
}

function saveGoal() {
  const nameCheck = validateName($('goal-name-input').value, { label: 'ชื่อเป้าหมาย' });
  if (!nameCheck.ok) {
    showGoalError(nameCheck.error);
    return;
  }

  const targetCheck = validateAmount($('goal-target-input').value, { label: 'จำนวนเงินเป้าหมาย' });
  if (!targetCheck.ok) {
    showGoalError(targetCheck.error);
    return;
  }

  const dateCheck = validateGoalDate($('goal-date-input').value);
  if (!dateCheck.ok) {
    showGoalError(dateCheck.error);
    return;
  }

  addGoal(ctx.accountId, {
    walletId: ctx.walletId,
    name: nameCheck.value,
    targetAmount: targetCheck.value,
    targetDate: dateCheck.value,
  });
  scheduleSync(ctx.accountId);

  toggleForm(false);
  renderPlan();
}


/* ---------- Budgets ---------- */
// A budget is one recurring monthly ceiling per category, plus an optional ceiling
// for the wallet as a whole. Rows render riskiest first so the thing about to go
// wrong is the thing the user sees.

function budgetCategoryOptions() {
  const custom = getCustomCategories(ctx.accountId, 'expense').map((c) => c.name);
  return [...EXPENSE_CATEGORY_NAMES, ...custom];
}

export function renderBudgets() {
  const list = $('budget-list');
  if (!list) return;

  const { total, categories } = budgetStatus(ctx.accountId, ctx.walletId);
  const rows = total ? [total, ...categories] : categories;

  list.innerHTML = '';
  $('budget-empty').hidden = rows.length > 0;

  for (const row of rows) {
    list.appendChild(budgetRow(row));
  }
}

function budgetRow(row) {
  const card = document.createElement('div');
  card.className = `budget-row level-${row.level}${row.isTotal ? ' budget-total' : ''}`;

  const top = document.createElement('div');
  top.className = 'budget-row-top';

  const name = document.createElement('div');
  name.className = 'budget-name';
  name.textContent = row.isTotal ? 'งบรวมทั้งเดือน' : row.category;

  const status = document.createElement('span');
  status.className = 'budget-level';
  status.textContent = LEVEL_LABELS[row.level];

  const label = document.createElement('div');
  label.append(name, status);

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'goal-del';
  del.textContent = '🗑';
  del.title = 'ลบงบนี้';
  del.addEventListener('click', () => {
    const what = row.isTotal ? 'งบรวมทั้งเดือน' : `งบ${row.category}`;
    if (!confirm(`ลบ${what}?`)) return;
    deleteBudget(ctx.accountId, row.id);
    scheduleSync(ctx.accountId);
    renderPlan();
  });

  top.append(label, del);

  const amounts = document.createElement('div');
  amounts.className = 'budget-amounts';
  amounts.textContent =
    row.remaining >= 0
      ? `ใช้ไป ${formatBaht(row.spent)} จาก ${formatBaht(row.limit)} · เหลือ ${formatBaht(row.remaining)}`
      : `ใช้ไป ${formatBaht(row.spent)} จาก ${formatBaht(row.limit)} · เกิน ${formatBaht(-row.remaining)}`;

  const track = document.createElement('div');
  track.className = 'budget-bar-track';
  const fill = document.createElement('div');
  fill.className = 'budget-bar-fill';
  fill.style.width = `${Math.min(100, row.percent)}%`;
  track.appendChild(fill);

  const pct = document.createElement('div');
  pct.className = 'budget-pct';
  pct.textContent = `${Math.round(row.percent)}%`;

  card.append(top, amounts, track, pct);
  return card;
}

function toggleBudgetForm(show) {
  $('budget-form-wrap').hidden = !show;
  $('add-budget-btn').hidden = show;
  $('budget-error').hidden = true;

  if (!show) return;

  const select = $('budget-category-select');
  select.innerHTML = '';

  const totalOpt = document.createElement('option');
  totalOpt.value = TOTAL_BUDGET;
  totalOpt.textContent = 'งบรวมทั้งเดือน (ทุกหมวด)';
  select.appendChild(totalOpt);

  for (const name of budgetCategoryOptions()) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  }

  $('budget-amount-input').value = '';
  select.focus();
}

function saveBudget() {
  const category = $('budget-category-select').value;
  const check = validateAmount($('budget-amount-input').value, { label: 'จำนวนเงินงบ' });

  if (!check.ok) {
    const el = $('budget-error');
    el.textContent = check.error;
    el.hidden = false;
    return;
  }

  // setBudget upserts, so choosing an existing category edits it rather than
  // stacking a second budget on the same category.
  setBudget(ctx.accountId, {
    walletId: ctx.walletId,
    category,
    amount: check.value,
  });
  scheduleSync(ctx.accountId);
  toggleBudgetForm(false);
  renderPlan();
}

/* ---------- Goals ---------- */

export function renderPlan() {
  renderBudgets();
  renderRecurring();
  renderGoals();
}

/* ---------- Recurring entries ---------- */

const CYCLE_LABELS = {
  monthly: (rule) => `ทุกเดือน วันที่ ${rule.dayOfMonth}`,
  days: (rule) => `ทุก ${rule.intervalDays} วัน`,
};

function toggleRecurringForm(show) {
  $('recurring-form-wrap').hidden = !show;
  $('add-recurring-btn').hidden = show;
  $('recurring-error').hidden = true;

  if (!show) return;

  $('recurring-type').value = 'expense';
  $('recurring-amount').value = '';
  $('recurring-note').value = '';
  $('recurring-cycle').value = 'monthly';
  $('recurring-day').value = '1';
  $('recurring-interval').value = '30';
  $('recurring-start').value = todayISO();
  renderRecurringCategories();
  renderCycleFields();
}

function renderRecurringCategories() {
  const kind = $('recurring-type').value;
  const select = $('recurring-category');
  select.innerHTML = '';

  // Main categories only. A rule repeats a fixed amount, so the extra precision of a
  // subcategory buys nothing here and would go stale as soon as one is renamed.
  for (const cat of CATEGORIES[kind]) {
    const option = document.createElement('option');
    option.value = cat.name;
    option.textContent = `${cat.icon} ${cat.name}`;
    select.appendChild(option);
  }
}

// The two cycles need different numbers, so only the relevant one is on screen.
function renderCycleFields() {
  const monthly = $('recurring-cycle').value === 'monthly';
  $('recurring-day-wrap').hidden = !monthly;
  $('recurring-interval-wrap').hidden = monthly;
  $('recurring-cycle-help').textContent = monthly
    ? 'ยึดวันที่ในปฏิทิน ถ้าตั้งวันที่ 31 แล้วเดือนนั้นสั้นกว่า จะเลื่อนมาเป็นวันสุดท้ายของเดือนแทน'
    : 'นับจากครั้งล่าสุด วันที่จึงค่อยๆ เลื่อนไปในปฏิทิน เหมาะกับค่าสมาชิกที่ให้สิทธิ์เป็นจำนวนวัน';
}

function saveRecurring() {
  const showError = (message) => {
    const el = $('recurring-error');
    el.textContent = message;
    el.hidden = !message;
  };
  showError('');

  const amountCheck = validateAmount($('recurring-amount').value, { label: 'จำนวนเงิน' });
  if (!amountCheck.ok) {
    showError(amountCheck.error);
    return;
  }

  const cycle = $('recurring-cycle').value;
  const dayOfMonth = Number($('recurring-day').value);
  const intervalDays = Number($('recurring-interval').value);

  if (cycle === 'monthly' && (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31)) {
    showError('วันที่ของเดือนต้องอยู่ระหว่าง 1 ถึง 31');
    return;
  }
  if (cycle === 'days' && (!Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 365)) {
    showError('จำนวนวันต้องอยู่ระหว่าง 1 ถึง 365');
    return;
  }

  const start = $('recurring-start').value;
  if (!start) {
    showError('เลือกวันที่เริ่มต้นด้วย');
    return;
  }

  addRecurring(ctx.accountId, {
    walletId: ctx.walletId,
    type: $('recurring-type').value,
    category: $('recurring-category').value,
    sub: '',
    amount: amountCheck.value,
    note: $('recurring-note').value.trim().slice(0, 200),
    cycle,
    dayOfMonth: cycle === 'monthly' ? dayOfMonth : 0,
    intervalDays: cycle === 'days' ? intervalDays : 0,
    startDate: start,
    // A rule starting today should offer today, so it has not run yet.
    lastRun: '',
  });
  scheduleSync(ctx.accountId);

  toggleRecurringForm(false);
  renderRecurring();
}

export function renderRecurring() {
  const list = $('recurring-list');
  if (!list) return;

  const rules = getRecurring(ctx.accountId, ctx.walletId).sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt)
  );

  list.innerHTML = '';
  $('recurring-empty').hidden = rules.length > 0;

  for (const rule of rules) list.appendChild(recurringRow(rule));
}

function recurringRow(rule) {
  const row = document.createElement('div');
  row.className = 'recurring-row';
  if (!rule.active) row.classList.add('paused');

  const head = document.createElement('div');
  head.className = 'recurring-head';

  const name = document.createElement('span');
  name.className = 'recurring-name';
  name.textContent = rule.category;

  const amount = document.createElement('span');
  amount.className = `recurring-amount ${rule.type}`;
  amount.textContent = `${rule.type === 'income' ? '+' : '-'}${formatBaht(rule.amount)}`;

  head.append(name, amount);

  const meta = document.createElement('div');
  meta.className = 'recurring-meta';
  const parts = [CYCLE_LABELS[rule.cycle] ? CYCLE_LABELS[rule.cycle](rule) : ''];
  parts.push(rule.lastRun ? `ล่าสุด ${formatThaiDateLong(rule.lastRun)}` : 'ยังไม่เคยสร้าง');
  if (!rule.active) parts.push('หยุดไว้');
  meta.textContent = parts.filter(Boolean).join(' · ');

  const actions = document.createElement('div');
  actions.className = 'recurring-actions';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'btn btn-secondary btn-small';
  toggle.textContent = rule.active ? 'หยุดไว้ก่อน' : 'ใช้งานต่อ';
  toggle.addEventListener('click', () => {
    updateRecurring(ctx.accountId, rule.id, { active: !rule.active });
    scheduleSync(ctx.accountId);
    renderRecurring();
  });

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'btn btn-danger btn-small';
  remove.textContent = 'ลบ';
  remove.addEventListener('click', () => {
    if (!confirm(`ลบรายการประจำ "${rule.category}" ?\n\nรายการที่สร้างไปแล้วยังอยู่เหมือนเดิม`)) return;
    deleteRecurring(ctx.accountId, rule.id);
    scheduleSync(ctx.accountId);
    renderRecurring();
  });

  actions.append(toggle, remove);
  row.append(head, meta, actions);
  return row;
}

function renderGoals() {
  const list = $('goal-list');
  const goals = getGoals(ctx.accountId, ctx.walletId).sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt)
  );

  list.innerHTML = '';
  $('goal-empty').hidden = goals.length > 0;

  for (const goal of goals) {
    list.appendChild(goalCard(goal));
  }
}

function goalCard(goal) {
  const saved = goal.savedAmount || 0;
  const target = goal.targetAmount || 0;
  const percent = target ? Math.min(100, (saved / target) * 100) : 0;
  const reached = saved >= target;
  const overdue = goal.targetDate && goal.targetDate < todayISO() && !reached;

  const card = document.createElement('div');
  card.className = 'goal-card';

  const top = document.createElement('div');
  top.className = 'goal-card-top';

  const nameWrap = document.createElement('div');
  const name = document.createElement('div');
  name.className = 'goal-name';
  name.textContent = goal.name;
  nameWrap.appendChild(name);

  if (reached) {
    nameWrap.appendChild(badge('ถึงเป้าแล้ว 🎉', 'badge-done'));
  } else if (overdue) {
    nameWrap.appendChild(badge('เลยกำหนด', 'badge-overdue'));
  }

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'goal-del';
  del.textContent = '🗑';
  del.title = 'ลบเป้าหมาย';
  del.addEventListener('click', () => {
    if (!confirm(`ลบเป้าหมาย "${goal.name}" ?`)) return;
    deleteGoal(ctx.accountId, goal.id);
    scheduleSync(ctx.accountId);
    renderPlan();
  });

  top.append(nameWrap, del);

  const amounts = document.createElement('div');
  amounts.className = 'goal-amounts';
  amounts.innerHTML = `เก็บได้ <strong>${formatBaht(saved)}</strong> จาก ${formatBaht(target)} (${Math.round(percent)}%)`;

  const track = document.createElement('div');
  track.className = 'goal-bar-track';
  const fill = document.createElement('div');
  fill.className = 'goal-bar-fill';
  fill.style.width = `${percent}%`;
  track.appendChild(fill);

  card.append(top, amounts, track);

  if (goal.targetDate) {
    const date = document.createElement('div');
    date.className = 'goal-date';
    date.textContent = `เป้าหมายภายใน ${formatThaiDateLong(goal.targetDate)}`;
    card.appendChild(date);
  }

  card.appendChild(addFundsRow(goal));
  return card;
}

function badge(text, className) {
  const el = document.createElement('span');
  el.className = `goal-badge ${className}`;
  el.textContent = text;
  return el;
}

// Inline input rather than window.prompt, to match the rest of the app.
function addFundsRow(goal) {
  const row = document.createElement('div');
  row.className = 'goal-add-row';

  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'text-input goal-add-input';
  input.placeholder = 'เพิ่มเงินเข้าเป้าหมาย';
  input.min = '0';
  input.step = '0.01';

  const error = document.createElement('div');
  error.className = 'inline-error';
  error.hidden = true;

  const submit = () => {
    const check = validateAmount(input.value, { label: 'จำนวนเงิน' });
    if (!check.ok) {
      error.textContent = check.error;
      error.hidden = false;
      return;
    }
    // Saving past the target is allowed; the bar caps but the number is real.
    updateGoal(ctx.accountId, goal.id, { savedAmount: (goal.savedAmount || 0) + check.value });
    scheduleSync(ctx.accountId);
    renderPlan();
  };

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-primary goal-add-btn';
  btn.textContent = '+ เพิ่มเงิน';
  btn.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  });

  const inputs = document.createElement('div');
  inputs.className = 'goal-add-inputs';
  inputs.append(input, btn);

  row.append(inputs, error);
  return row;
}
