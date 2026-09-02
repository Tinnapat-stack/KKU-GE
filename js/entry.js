// Entry page: record income and expenses, and review recent entries.

import {
  getTransactions,
  addTransaction,
  updateTransaction,
  deleteTransaction,
  getCustomCategories,
  addCustomCategory,
  deleteCustomCategory,
  countCategoryUsage,
} from './storage.js';
import { scheduleSync } from './filesync.js';
import { budgetForCategory, budgetStatus } from './budget.js';
import { showToast, crossedUpward } from './toast.js';
import { ICONS } from './icons.js';
import {
  validateAmount,
  validateEntryDate,
  validateNote,
  validateName,
  todayISO,
  earliestEntryDateISO,
} from './validate.js';
import { formatBaht, formatThaiDate } from './format.js';
import { CATEGORIES } from './categories.js';
import { transactionRow } from './txrow.js';

const RECENT_LIMIT = 20;
const $ = (id) => document.getElementById(id);

let ctx = null; // { accountId, walletId }
let currentType = 'income';
let selectedCategory = null;
let lastSavedCategory = null;
let editingId = null;

export function initEntry(context) {
  ctx = context;

  document.querySelectorAll('.toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => setType(btn.dataset.type));
  });

  $('save-btn').addEventListener('click', saveEntry);
  $('amount-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveEntry();
  });

  $('date-input').min = earliestEntryDateISO();
  $('date-input').max = todayISO();
  $('date-input').value = todayISO();

  $('custom-category-input').addEventListener('input', (e) => renderSuggestions(e.target.value));

  $('edit-cancel-btn').addEventListener('click', closeEditModal);
  $('edit-save-btn').addEventListener('click', saveEdit);
  $('edit-delete-btn').addEventListener('click', deleteFromModal);
  $('edit-modal').addEventListener('click', (e) => {
    if (e.target === $('edit-modal')) closeEditModal();
  });

  setType('income');
}

export function setEntryContext(context) {
  ctx = context;
}

export function renderEntry() {
  renderCategories();
  renderRecent();
  renderTodayTotal();
  renderBudgetHint();
}

/* ---------- Type toggle ---------- */

function setType(type) {
  currentType = type;
  selectedCategory = null;
  lastSavedCategory = null;

  document.querySelectorAll('.toggle-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.type === type);
  });

  const isExpense = type === 'expense';
  $('amount-box').classList.toggle('expense', isExpense);
  $('category-label').textContent = isExpense ? 'ใช้ไปกับอะไร' : 'เงินมาจากไหน';
  $('save-btn').classList.toggle('expense', isExpense);
  $('save-btn').textContent = isExpense ? '✓ บันทึกรายจ่าย' : '✓ บันทึกรายรับ';

  renderCategories();
  renderBudgetHint();
}

/* ---------- Categories ---------- */

function renderCategories() {
  const grid = $('category-grid');
  grid.innerHTML = '';

  const custom = getCustomCategories(ctx.accountId, currentType);
  const builtIn = CATEGORIES[currentType];

  for (const cat of builtIn) {
    grid.appendChild(categoryButton(cat.icon, cat.name));
  }

  for (const cat of custom) {
    const btn = categoryButton('', cat.name);
    btn.classList.add('category-custom');

    const remove = document.createElement('span');
    remove.className = 'cat-remove';
    remove.textContent = '×';
    remove.title = 'ลบหมวดหมู่นี้';
    remove.addEventListener('click', (e) => {
      e.stopPropagation();
      removeCustomCategory(cat);
    });

    btn.appendChild(remove);
    grid.appendChild(btn);
  }

  grid.appendChild(otherButton());
}

function categoryButton(icon, name) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'category-btn';
  if (selectedCategory === name) {
    btn.classList.add('selected');
    if (currentType === 'expense') btn.classList.add('expense-selected');
  }
  btn.innerHTML = icon
    ? `<span class="cat-icon">${icon}</span><span class="cat-name"></span>`
    : '<span class="cat-name"></span>';
  btn.querySelector('.cat-name').textContent = name;
  btn.addEventListener('click', () => {
    selectedCategory = name;
    $('custom-category-wrap').hidden = true;
    renderCategories();
    renderBudgetHint();
  });
  return btn;
}

// Deleting a category rewrites the records that used it, so the user is told how
// many are involved and exactly what will happen to them before confirming.
function removeCustomCategory(cat) {
  const used = countCategoryUsage(ctx.accountId, cat.name);
  const detail = used
    ? `มี ${used} รายการที่ใช้หมวดนี้อยู่\nรายการเหล่านั้นจะถูกเปลี่ยนเป็น "อื่นๆ (${cat.name})" ไม่หายไปไหน`
    : 'ยังไม่มีรายการไหนใช้หมวดนี้';

  if (!confirm(`ลบหมวดหมู่ "${cat.name}" ?\n\n${detail}`)) return;

  const { renamedBudgets } = deleteCustomCategory(ctx.accountId, cat.id);
  if (selectedCategory === cat.name) selectedCategory = null;
  if (lastSavedCategory === cat.name) lastSavedCategory = null;

  scheduleSync(ctx.accountId);
  renderEntry();

  if (renamedBudgets) {
    showToast(`ย้ายงบประมาณของหมวดนี้ไปที่ "อื่นๆ (${cat.name})" แล้ว`, 'info');
  }
}

function otherButton() {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'category-btn category-other';
  btn.innerHTML = '<span class="cat-icon">➕</span><span class="cat-name">อื่นๆ (พิมพ์เอง)</span>';
  btn.addEventListener('click', () => {
    const wrap = $('custom-category-wrap');
    wrap.hidden = false;
    $('custom-category-input').value = '';
    $('save-as-category').checked = true;
    renderSuggestions('');
    $('custom-category-input').focus();
  });
  return btn;
}

// Matches what is being typed against categories the user already saved, so a
// repeat entry is one tap rather than retyping the whole name.
function renderSuggestions(query) {
  const box = $('category-suggestions');
  const q = query.trim().toLowerCase();

  const matches = getCustomCategories(ctx.accountId, currentType)
    .map((c) => c.name)
    .filter((name) => (q ? name.toLowerCase().includes(q) : true))
    .filter((name) => name.toLowerCase() !== q)
    .slice(0, 6);

  box.innerHTML = '';
  box.hidden = matches.length === 0;

  for (const name of matches) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'suggestion-chip';
    chip.textContent = name;
    chip.addEventListener('click', () => {
      selectedCategory = name;
      $('custom-category-wrap').hidden = true;
      renderCategories();
      renderBudgetHint();
    });
    box.appendChild(chip);
  }
}

// The checkbox decides whether a typed category becomes a permanent button or is
// used just this once.
function commitCustomCategory() {
  const check = validateName($('custom-category-input').value, { label: 'ชื่อหมวดหมู่' });
  if (!check.ok) {
    showEntryError(check.error);
    return null;
  }
  if ($('save-as-category').checked) {
    addCustomCategory(ctx.accountId, currentType, check.value);
  }
  selectedCategory = check.value;
  $('custom-category-wrap').hidden = true;
  renderCategories();
  renderBudgetHint();
  return check.value;
}


/* ---------- Budget hint ---------- */
// Shown the moment an expense category is picked, while the user can still change
// their mind. This is the most useful place in the app to surface a budget.

function hideBudgetHint(el) {
  el.hidden = true;
  el.textContent = '';
}

function renderBudgetHint() {
  const el = $('budget-hint');
  if (!el) return;

  // After a save the selection clears, but the budget for what was just recorded
  // is exactly what the user wants to see, so fall back to it.
  const category = selectedCategory || lastSavedCategory;

  if (currentType !== 'expense' || !category) {
    hideBudgetHint(el);
    return;
  }

  const row = budgetForCategory(ctx.accountId, ctx.walletId, category);
  if (!row) {
    hideBudgetHint(el);
    return;
  }

  const remaining = Math.max(0, row.remaining);
  const over = row.remaining < 0;
  el.className = `budget-hint level-${row.level}`;
  el.textContent = over
    ? `งบ${category}เดือนนี้เกินมาแล้ว ${formatBaht(-row.remaining)} (ใช้ ${formatBaht(row.spent)} จาก ${formatBaht(row.limit)})`
    : `งบ${category}เดือนนี้ เหลือ ${formatBaht(remaining)} จาก ${formatBaht(row.limit)}`;
  el.hidden = false;
}

// Raises a toast only when this save pushed a budget up into a higher level.
function checkBudgetAlerts() {
  const month = new Date().toISOString().slice(0, 7);
  const { total, categories } = budgetStatus(ctx.accountId, ctx.walletId);
  const rows = [...categories, ...(total ? [total] : [])];

  for (const row of rows) {
    if (row.level === 'safe') {
      crossedUpward(ctx.accountId, ctx.walletId, row.category, month, row.level);
      continue;
    }
    if (!crossedUpward(ctx.accountId, ctx.walletId, row.category, month, row.level)) continue;

    const name = row.isTotal ? 'งบรวมเดือนนี้' : `งบ${row.category}`;
    const pct = Math.round(row.percent);
    showToast(
      row.level === 'over'
        ? `${name}เกินแล้ว ใช้ไป ${formatBaht(row.spent)} จาก ${formatBaht(row.limit)} (${pct}%)`
        : `${name}ใช้ไปแล้ว ${pct}% (${formatBaht(row.spent)} จาก ${formatBaht(row.limit)})`,
      row.level,
      { icon: ICONS.alert }
    );
  }
}

/* ---------- Save ---------- */

function showEntryError(message) {
  const el = $('entry-error');
  el.textContent = message;
  el.hidden = !message;
}

function saveEntry() {
  showEntryError('');

  // An unsaved custom category still counts as the user's choice.
  if (!$('custom-category-wrap').hidden && $('custom-category-input').value.trim()) {
    if (!commitCustomCategory()) return;
  }

  const amountCheck = validateAmount($('amount-input').value);
  if (!amountCheck.ok) {
    showEntryError(amountCheck.error);
    return;
  }

  if (!selectedCategory) {
    showEntryError('กรุณาเลือกหมวดหมู่');
    return;
  }

  const dateCheck = validateEntryDate($('date-input').value);
  if (!dateCheck.ok) {
    showEntryError(dateCheck.error);
    return;
  }

  const noteCheck = validateNote($('note-input').value);
  if (!noteCheck.ok) {
    showEntryError(noteCheck.error);
    return;
  }

  addTransaction(ctx.accountId, {
    walletId: ctx.walletId,
    type: currentType,
    amount: amountCheck.value,
    category: selectedCategory,
    note: noteCheck.value,
    date: dateCheck.value,
  });
  scheduleSync(ctx.accountId);

  $('amount-input').value = '';
  $('note-input').value = '';
  $('date-input').value = todayISO();
  lastSavedCategory = currentType === 'expense' ? selectedCategory : null;
  selectedCategory = null;

  renderEntry();
  flashSaved();
  checkBudgetAlerts();
}

function flashSaved() {
  const btn = $('save-btn');
  const original = btn.textContent;
  btn.textContent = '✓ บันทึกแล้ว';
  btn.disabled = true;
  setTimeout(() => {
    btn.textContent = original;
    btn.disabled = false;
  }, 700);
}

/* ---------- Recent list ---------- */

function renderTodayTotal() {
  const today = todayISO();
  const spent = getTransactions(ctx.accountId, ctx.walletId)
    .filter((t) => t.type === 'expense' && t.date === today)
    .reduce((sum, t) => sum + t.amount, 0);

  $('entry-today-spent').textContent = formatBaht(spent);
}

function renderRecent() {
  const list = $('recent-list');
  const all = getTransactions(ctx.accountId, ctx.walletId).sort((a, b) =>
    b.date === a.date ? b.createdAt.localeCompare(a.createdAt) : b.date.localeCompare(a.date)
  );

  $('recent-count').textContent = `ทั้งหมด ${all.length} รายการ`;
  list.innerHTML = '';

  if (all.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'ยังไม่มีรายการ ลองบันทึกรายการแรกดูสิ';
    list.appendChild(empty);
    return;
  }

  for (const tx of all.slice(0, RECENT_LIMIT)) {
    list.appendChild(
      transactionRow(tx, {
        onOpen: openEditModal,
        onDelete: (t) => {
          deleteTransaction(ctx.accountId, t.id);
          scheduleSync(ctx.accountId);
          renderEntry();
          checkBudgetAlerts();
        },
      })
    );
  }
}

/* ---------- Edit modal ---------- */

function openEditModal(tx) {
  editingId = tx.id;
  $('edit-amount-input').value = tx.amount;
  $('edit-note-input').value = tx.note || '';
  $('edit-date-input').min = earliestEntryDateISO();
  $('edit-date-input').max = todayISO();
  $('edit-date-input').value = tx.date;
  $('edit-error').hidden = true;
  $('edit-modal').hidden = false;
}

function closeEditModal() {
  editingId = null;
  $('edit-modal').hidden = true;
}

function saveEdit() {
  const amountCheck = validateAmount($('edit-amount-input').value);
  const dateCheck = validateEntryDate($('edit-date-input').value);
  const noteCheck = validateNote($('edit-note-input').value);
  const failed = [amountCheck, dateCheck, noteCheck].find((c) => !c.ok);

  if (failed) {
    const el = $('edit-error');
    el.textContent = failed.error;
    el.hidden = false;
    return;
  }

  updateTransaction(ctx.accountId, editingId, {
    amount: amountCheck.value,
    date: dateCheck.value,
    note: noteCheck.value,
  });
  scheduleSync(ctx.accountId);
  closeEditModal();
  renderEntry();
  checkBudgetAlerts();
}

function deleteFromModal() {
  if (!confirm('ลบรายการนี้?')) return;
  deleteTransaction(ctx.accountId, editingId);
  scheduleSync(ctx.accountId);
  closeEditModal();
  renderEntry();
  checkBudgetAlerts();
}
