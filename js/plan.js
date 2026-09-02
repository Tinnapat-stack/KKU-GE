// Plan page: savings goals with progress tracking.

import { getGoals, addGoal, updateGoal, deleteGoal } from './storage.js';
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

export function renderPlan() {
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
