// Plan page: savings goals with progress tracking.

import {
  getGoals,
  addGoal,
  updateGoal,
  deleteGoal,
  setBudget,
  deleteBudget,
  getCustomCategories,
  getSubcategories,
  setSaving,
  deleteSaving,
  getSavings,
  getRecurring,
  addRecurring,
  updateRecurring,
  deleteRecurring,
  TOTAL_BUDGET,
} from './storage.js';
import { budgetStatus, LEVEL_LABELS } from './budget.js';
import { goalProgress, perDayFor, recentDays, payOutGoal, STATUS } from './goals.js';
import { nextOccurrence } from './recurring.js';
import { CATEGORIES, EXPENSE_CATEGORY_NAMES } from './categories.js';
import { scheduleSync } from './filesync.js';
import { validateAmount, validateName, validateGoalDate, todayISO } from './validate.js';
import { formatBaht, formatThaiDate, formatThaiDateLong } from './format.js';
import { showToast } from './toast.js';

const $ = (id) => document.getElementById(id);

let ctx = null;
let onGoalPaid = null;

export function initPlan(context, goalPaid) {
  ctx = context;
  onGoalPaid = goalPaid;

  $('add-goal-btn').addEventListener('click', () => toggleForm(true));
  $('goal-cancel-btn').addEventListener('click', () => toggleForm(false));
  $('goal-save-btn').addEventListener('click', saveGoal);
  $('goal-date-input').min = todayISO();
  $('goal-date-input').addEventListener('change', renderPlanHint);
  $('goal-target-input').addEventListener('input', renderPlanHint);
  $('goal-category').addEventListener('change', () => renderGoalSubs($('goal-sub'), $('goal-category').value));

  $('add-budget-btn').addEventListener('click', () => toggleBudgetForm(true));
  $('budget-cancel-btn').addEventListener('click', () => toggleBudgetForm(false));
  $('budget-save-btn').addEventListener('click', saveBudget);

  $('add-recurring-btn').addEventListener('click', () => toggleRecurringForm(true));
  $('recurring-cancel-btn').addEventListener('click', () => toggleRecurringForm(false));
  $('recurring-save-btn').addEventListener('click', saveRecurring);
  $('recurring-type').addEventListener('change', renderRecurringCategories);
  $('recurring-category').addEventListener('change', renderRecurringSubs);
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
    renderGoalCategories();
    renderPlanHint();
    $('goal-name-input').focus();
  }
}

// The spending category can be chosen now or left until the money is actually spent,
// so the first option is deliberately "decide later".
function renderGoalCategories() {
  const select = $('goal-category');
  select.innerHTML = '';

  const later = document.createElement('option');
  later.value = '';
  later.textContent = 'ยังไม่เลือก เลือกตอนใช้เงินก็ได้';
  select.appendChild(later);

  for (const cat of CATEGORIES.expense) {
    const option = document.createElement('option');
    option.value = cat.name;
    option.textContent = `${cat.icon} ${cat.name}`;
    select.appendChild(option);
  }

  renderGoalSubs($('goal-sub'), '');
}

function renderGoalSubs(select, parent) {
  select.innerHTML = '';
  const subs = parent ? getSubcategories(ctx.accountId, 'expense', parent) : [];
  select.hidden = subs.length === 0;
  if (subs.length === 0) return;

  const any = document.createElement('option');
  any.value = '';
  any.textContent = 'ไม่ระบุหมวดย่อย';
  select.appendChild(any);

  for (const sub of subs) {
    const option = document.createElement('option');
    option.value = sub.name;
    option.textContent = sub.name;
    select.appendChild(option);
  }
}

// Shows the daily split as soon as there is an amount and a date, which is what turns
// "เก็บ 1,000 ใน 15 วัน" into something a person can actually follow.
function renderPlanHint() {
  const hint = $('goal-plan-hint');
  const amount = Number($('goal-target-input').value);
  const date = $('goal-date-input').value;

  if (!(amount > 0) || !date) {
    hint.hidden = true;
    hint.textContent = '';
    return;
  }

  const perDay = perDayFor(amount, todayISO(), date);
  if (!perDay) {
    hint.hidden = true;
    return;
  }

  const days = Math.ceil(amount / perDay);
  hint.textContent = `แผนคือออมวันละ ${formatBaht(perDay)} ประมาณ ${days} วันก็ครบ`;
  hint.hidden = false;
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
    // The plan is fixed at creation. The card works out separately what today
    // actually demands, so a missed day changes the advice but not the promise.
    planPerDay: dateCheck.value ? perDayFor(targetCheck.value, todayISO(), dateCheck.value) : 0,
    spendCategory: $('goal-category').value,
    spendSub: $('goal-sub').hidden ? '' : $('goal-sub').value,
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

  for (const cat of CATEGORIES[kind]) {
    const option = document.createElement('option');
    option.value = cat.name;
    option.textContent = `${cat.icon} ${cat.name}`;
    select.appendChild(option);
  }

  renderRecurringSubs();
}

// Rent and the internet bill both sit under "บิล/ค่าบริการ", so without the
// subcategory the two rules would be impossible to tell apart in the list.
function renderRecurringSubs() {
  const kind = $('recurring-type').value;
  const select = $('recurring-sub');
  const subs = getSubcategories(ctx.accountId, kind, $('recurring-category').value);

  select.innerHTML = '';
  select.hidden = subs.length === 0;
  if (subs.length === 0) return;

  const any = document.createElement('option');
  any.value = '';
  any.textContent = 'ไม่ระบุหมวดย่อย';
  select.appendChild(any);

  for (const sub of subs) {
    const option = document.createElement('option');
    option.value = sub.name;
    option.textContent = sub.name;
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
    sub: $('recurring-sub').hidden ? '' : $('recurring-sub').value,
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
  name.textContent = rule.sub ? `${rule.category} · ${rule.sub}` : rule.category;

  const amount = document.createElement('span');
  amount.className = `recurring-amount ${rule.type}`;
  amount.textContent = `${rule.type === 'income' ? '+' : '-'}${formatBaht(rule.amount)}`;

  head.append(name, amount);

  const meta = document.createElement('div');
  meta.className = 'recurring-meta';
  const parts = [CYCLE_LABELS[rule.cycle] ? CYCLE_LABELS[rule.cycle](rule) : ''];

  // The next date is more use than the last one when deciding what is coming up.
  const next = rule.active ? nextOccurrence(rule) : '';
  parts.push(next ? `ครั้งถัดไป ${formatThaiDateLong(next)}` : 'ยังไม่เคยสร้าง');
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
  const p = goalProgress(ctx.accountId, goal);

  const card = document.createElement('div');
  card.className = `goal-card status-${p.status}`;

  const top = document.createElement('div');
  top.className = 'goal-card-top';

  const nameWrap = document.createElement('div');
  const name = document.createElement('div');
  name.className = 'goal-name';
  name.textContent = goal.name;
  nameWrap.appendChild(name);

  if (p.status === STATUS.DONE) {
    nameWrap.appendChild(badge('ใช้เงินแล้ว', 'badge-paid'));
  } else if (p.status === STATUS.REACHED) {
    nameWrap.appendChild(badge('ถึงเป้าแล้ว 🎉', 'badge-done'));
  } else if (p.overdue) {
    nameWrap.appendChild(badge('เลยกำหนด', 'badge-overdue'));
  }

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'goal-del';
  del.textContent = '🗑';
  del.title = 'ลบเป้าหมาย';
  del.addEventListener('click', () => {
    const extra =
      p.status === STATUS.DONE
        ? '\n\nรายจ่ายที่บันทึกไปแล้วจะยังอยู่ เพราะเป็นประวัติจริง'
        : '\n\nเงินที่ออมไว้ไม่ได้หายไปไหน เพราะยังอยู่ในกระเป๋าตลอด';
    if (!confirm(`ลบเป้าหมาย "${goal.name}" ?${extra}`)) return;
    deleteGoal(ctx.accountId, goal.id);
    scheduleSync(ctx.accountId);
    renderPlan();
  });

  top.append(nameWrap, del);

  const amounts = document.createElement('div');
  amounts.className = 'goal-amounts';
  amounts.innerHTML = `เก็บได้ <strong>${formatBaht(p.saved)}</strong> จาก ${formatBaht(p.target)} (${Math.round(p.percent)}%)`;

  const track = document.createElement('div');
  track.className = 'goal-bar-track';
  const fill = document.createElement('div');
  fill.className = 'goal-bar-fill';
  fill.style.width = `${p.percent}%`;
  track.appendChild(fill);

  card.append(top, amounts, track);

  if (goal.targetDate) {
    const date = document.createElement('div');
    date.className = 'goal-date';
    date.textContent = `เป้าหมายภายใน ${formatThaiDateLong(goal.targetDate)}`;
    card.appendChild(date);
  }

  if (p.status === STATUS.SAVING) {
    if (p.planPerDay > 0) card.appendChild(planLine(p));
    card.appendChild(todayRow(goal, p));
    if (goal.targetDate) card.appendChild(streakStrip(goal));
  } else if (p.status === STATUS.REACHED) {
    card.appendChild(payoutRow(goal, p));
  } else {
    card.appendChild(paidLine(goal));
  }

  return card;
}

// The promise and the reality. When they differ, the second line is the one that
// tells the user what today actually costs.
function planLine(p) {
  const line = document.createElement('div');
  line.className = 'goal-plan';

  const planned = document.createElement('span');
  planned.textContent = `แผนวันละ ${formatBaht(p.planPerDay)}`;
  line.appendChild(planned);

  if (p.catchUpPerDay > 0 && p.catchUpPerDay !== p.planPerDay) {
    const catchUp = document.createElement('span');
    catchUp.className = p.catchUpPerDay > p.planPerDay ? 'goal-catchup behind' : 'goal-catchup ahead';
    catchUp.textContent =
      p.catchUpPerDay > p.planPerDay
        ? `ตามไม่ทัน ต้องวันละ ${formatBaht(p.catchUpPerDay)} เหลือ ${p.daysLeft} วัน`
        : `นำแผนอยู่ เหลือวันละ ${formatBaht(p.catchUpPerDay)} อีก ${p.daysLeft} วัน`;
    line.appendChild(catchUp);
  }

  return line;
}

// One tick per day, with the amount editable before it is recorded. Ticking the same
// day again edits that day rather than stacking a second deposit on top.
function todayRow(goal, p) {
  const today = todayISO();
  const existing = getSavings(ctx.accountId, goal.id).find((s) => s.date === today);

  const row = document.createElement('div');
  row.className = 'goal-today';
  if (existing) row.classList.add('ticked');

  const box = document.createElement('input');
  box.type = 'checkbox';
  box.className = 'goal-tick';
  box.checked = !!existing;
  box.title = 'บันทึกว่าวันนี้ออมแล้ว';

  const label = document.createElement('span');
  label.className = 'goal-today-label';
  label.textContent = existing ? 'ออมแล้ววันนี้' : 'ออมวันนี้';

  const amount = document.createElement('input');
  amount.type = 'number';
  amount.className = 'text-input goal-today-amount';
  amount.min = '0';
  amount.step = '0.01';
  amount.value = existing ? String(existing.amount) : String(p.planPerDay || p.remaining || '');
  amount.setAttribute('aria-label', 'ยอดที่ออมวันนี้');

  const save = () => {
    const check = validateAmount(amount.value, { label: 'ยอดที่ออม' });
    if (!check.ok) {
      showToast(check.error, 'warn');
      box.checked = !!existing;
      return;
    }
    setSaving(ctx.accountId, {
      goalId: goal.id,
      walletId: goal.walletId,
      date: today,
      amount: check.value,
    });
    scheduleSync(ctx.accountId);
    renderPlan();
  };

  box.addEventListener('change', () => {
    if (box.checked) {
      save();
      return;
    }
    deleteSaving(ctx.accountId, goal.id, today);
    scheduleSync(ctx.accountId);
    renderPlan();
  });

  // Editing the number while the day is already ticked corrects that day.
  amount.addEventListener('change', () => {
    if (box.checked) save();
  });

  row.append(box, label, amount);
  return row;
}

// Seven squares, one per day. Filled means the plan was met that day.
function streakStrip(goal) {
  const strip = document.createElement('div');
  strip.className = 'goal-streak';

  for (const day of recentDays(ctx.accountId, goal)) {
    const cell = document.createElement('span');
    cell.className = 'goal-streak-day';
    if (day.amount > 0) cell.classList.add(day.met ? 'met' : 'partial');
    cell.title = day.amount > 0
      ? `${formatThaiDate(day.date)} ออม ${formatBaht(day.amount)}`
      : `${formatThaiDate(day.date)} ยังไม่ได้ออม`;
    strip.appendChild(cell);
  }

  const note = document.createElement('span');
  note.className = 'goal-streak-note';
  note.textContent = '7 วันล่าสุด';
  strip.appendChild(note);

  return strip;
}

// The money is saved but still in the wallet. Nothing has been spent until the user
// says so here, which is the moment the expense is finally recorded.
function payoutRow(goal, p) {
  const wrap = document.createElement('div');
  wrap.className = 'goal-payout';

  const note = document.createElement('p');
  note.className = 'goal-payout-note';
  note.textContent =
    'ออมครบแล้ว เงินยังอยู่ในกระเป๋าจนกว่าจะกดใช้ ตอนกดใช้ระบบจะบันทึกเป็นรายจ่ายจริงให้';
  wrap.appendChild(note);

  const category = document.createElement('select');
  category.className = 'text-input';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'เลือกหมวดที่จะใช้เงิน';
  category.appendChild(placeholder);
  for (const cat of CATEGORIES.expense) {
    const option = document.createElement('option');
    option.value = cat.name;
    option.textContent = `${cat.icon} ${cat.name}`;
    category.appendChild(option);
  }
  category.value = goal.spendCategory || '';

  const sub = document.createElement('select');
  sub.className = 'text-input';
  const fillSubs = () => {
    sub.innerHTML = '';
    const subs = category.value ? getSubcategories(ctx.accountId, 'expense', category.value) : [];
    sub.hidden = subs.length === 0;
    if (subs.length === 0) return;
    const any = document.createElement('option');
    any.value = '';
    any.textContent = 'ไม่ระบุหมวดย่อย';
    sub.appendChild(any);
    for (const s of subs) {
      const option = document.createElement('option');
      option.value = s.name;
      option.textContent = s.name;
      sub.appendChild(option);
    }
    sub.value = goal.spendSub || '';
  };
  fillSubs();
  category.addEventListener('change', fillSubs);

  const amount = document.createElement('input');
  amount.type = 'number';
  amount.className = 'text-input';
  amount.min = '0';
  amount.step = '0.01';
  amount.value = String(p.saved);
  amount.setAttribute('aria-label', 'ยอดที่จะใช้');

  const pay = document.createElement('button');
  pay.type = 'button';
  pay.className = 'btn btn-primary btn-block';
  pay.textContent = 'ใช้เงินก้อนนี้';
  pay.addEventListener('click', () => {
    if (!category.value) {
      showToast('เลือกหมวดที่จะใช้เงินก่อน', 'warn');
      return;
    }
    const check = validateAmount(amount.value, { label: 'ยอดที่จะใช้' });
    if (!check.ok) {
      showToast(check.error, 'warn');
      return;
    }
    if (!confirm(`บันทึกรายจ่าย ${formatBaht(check.value)} ในหมวด "${category.value}" ?\n\nยอดคงเหลือของกระเป๋าจะลดลงตอนนี้ และภารกิจนี้จะถือว่าจบ`)) return;

    payOutGoal(ctx.accountId, goal, {
      amount: check.value,
      category: category.value,
      sub: sub.hidden ? '' : sub.value,
    });
    scheduleSync(ctx.accountId);
    if (onGoalPaid) onGoalPaid();
    renderPlan();
    showToast(`ใช้เงินจากเป้าหมาย "${goal.name}" แล้ว`, 'info');
  });

  wrap.append(category, sub, amount, pay);
  return wrap;
}

function paidLine(goal) {
  const line = document.createElement('div');
  line.className = 'goal-paid';
  const label = goal.spendSub ? `${goal.spendCategory} · ${goal.spendSub}` : goal.spendCategory;
  line.textContent = goal.paidAt
    ? `ใช้ไปกับ ${label} เมื่อ ${formatThaiDateLong(goal.paidAt)}`
    : `ใช้ไปกับ ${label}`;
  return line;
}

function badge(text, className) {
  const el = document.createElement('span');
  el.className = `goal-badge ${className}`;
  el.textContent = text;
  return el;
}

// Inline input rather than window.prompt, to match the rest of the app.
