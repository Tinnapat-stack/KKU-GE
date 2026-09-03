// Entry page: record income and expenses, and review recent entries.

import {
  getTransactions,
  addTransaction,
  updateTransaction,
  deleteTransaction,
  getCustomCategories,
  getSubcategories,
  addCustomCategory,
  getCategoryPrefs,
  categoryTarget,
  prefKey,
} from './storage.js';
import { scheduleSync } from './filesync.js';
import { budgetForCategory, budgetStatus } from './budget.js';
import { showToast, crossedUpward } from './toast.js';
import { ICONS } from './icons.js';
import {
  validateAmount,
  validateQuantity,
  validateEntryDate,
  validateNote,
  validateName,
  todayISO,
  earliestEntryDateISO,
  LIMITS,
} from './validate.js';
import { formatBaht, formatThaiDate } from './format.js';
import { CATEGORIES, iconForCategory } from './categories.js';
import { transactionRow } from './txrow.js';
import { confirmDeleteCategory } from './cats.js';

const RECENT_LIMIT = 20;
const $ = (id) => document.getElementById(id);

let ctx = null; // { accountId, walletId }
let currentType = 'income';
// What is picked is a stored category record, not just a name: a subcategory has a
// parent, and the transaction has to record both.
let selected = null; // { parent, name, category, sub }
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

  $('qty-minus').addEventListener('click', () => stepQuantity(-1));
  $('qty-plus').addEventListener('click', () => stepQuantity(1));
  $('qty-input').addEventListener('input', renderTotal);
  $('qty-input').addEventListener('blur', normaliseQuantity);
  $('amount-input').addEventListener('input', renderTotal);

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
  renderTotal();
}

// Home's pinned chips call this before switching page, so the form is already
// filled in by the time it appears.
export function prefillEntry({ type, parent, name }) {
  setType(type);
  $('amount-input').value = '';
  setQuantity(1);
  selectCategory({ parent, name });
  const amount = $('amount-input');
  amount.focus();
  amount.select();
}

/* ---------- Type toggle ---------- */

function setType(type) {
  currentType = type;
  selected = null;
  lastSavedCategory = null;
  setQuantity(1);

  document.querySelectorAll('.toggle-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.type === type);
  });

  const isExpense = type === 'expense';
  $('amount-box').classList.toggle('expense', isExpense);
  $('category-label').textContent = isExpense ? 'ใช้ไปกับอะไร' : 'เงินมาจากไหน';
  $('save-btn').classList.toggle('expense', isExpense);
  renderSaveLabel();

  renderCategories();
  renderBudgetHint();
  renderTotal();
}

/* ---------- Quantity ---------- */
// The amount box holds the price of one thing; quantity multiplies it. At the
// default of one the form behaves exactly as it did before this existed.

function currentQuantity() {
  const n = Math.floor(Number($('qty-input').value));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, LIMITS.QUANTITY_MAX) : 1;
}

function setQuantity(value) {
  $('qty-input').value = String(Math.min(Math.max(1, value), LIMITS.QUANTITY_MAX));
  renderTotal();
}

function stepQuantity(delta) {
  setQuantity(currentQuantity() + delta);
}

// Typing lets any text sit in the box while the user works; leaving it puts a
// usable number back so the form is never in a state it cannot save.
function normaliseQuantity() {
  setQuantity(currentQuantity());
}

function entryTotal() {
  const unit = Number($('amount-input').value);
  if (!Number.isFinite(unit)) return null;
  return Math.round(unit * currentQuantity() * 100) / 100;
}

// The multiplication is only spelled out when it actually changes the number.
function renderTotal() {
  const el = $('qty-total');
  const qty = currentQuantity();
  const unit = Number($('amount-input').value);
  const show = qty > 1 && Number.isFinite(unit) && unit > 0;

  el.hidden = !show;
  el.textContent = show ? `${formatBaht(unit)} × ${qty} = ${formatBaht(entryTotal())}` : '';
  renderSaveLabel();
}

function renderSaveLabel() {
  const base = currentType === 'expense' ? '✓ บันทึกรายจ่าย' : '✓ บันทึกรายรับ';
  const total = entryTotal();
  const show = currentQuantity() > 1 && total !== null && total > 0;
  $('save-btn').textContent = show ? `${base} ${formatBaht(total)}` : base;
}

/* ---------- Categories ---------- */

function renderCategories() {
  const grid = $('category-grid');
  grid.innerHTML = '';

  const prefs = getCategoryPrefs(ctx.accountId, currentType);

  // Each main category is followed straight away by its own subcategories, so the
  // grid groups itself without needing headings.
  for (const main of CATEGORIES[currentType]) {
    grid.appendChild(categoryButton({ parent: main.name, name: main.name }, main.icon, prefs));

    for (const sub of getSubcategories(ctx.accountId, currentType, main.name)) {
      const btn = categoryButton(sub, main.icon, prefs);
      btn.classList.add('category-sub');
      attachRemove(btn, sub);
      grid.appendChild(btn);
    }
  }

  // Categories that belong to no main category come last, still without an emoji.
  for (const cat of getCustomCategories(ctx.accountId, currentType).filter((c) => !c.parent)) {
    const btn = categoryButton(cat, '', prefs);
    btn.classList.add('category-custom');
    attachRemove(btn, cat);
    grid.appendChild(btn);
  }

  grid.appendChild(otherButton());
}

function attachRemove(btn, record) {
  const remove = document.createElement('span');
  remove.className = 'cat-remove';
  remove.textContent = '×';
  remove.title = 'ลบหมวดหมู่นี้';
  remove.addEventListener('click', (e) => {
    e.stopPropagation();
    removeCustomCategory(record);
  });
  btn.appendChild(remove);
}

// `record` is { parent, name }. A subcategory borrows the main category's emoji and
// shows its own name, which is how a row of them reads as one group.
function categoryButton(record, icon, prefs) {
  const target = categoryTarget(record);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'category-btn';

  if (selected && selected.category === target.category && selected.sub === target.sub) {
    btn.classList.add('selected');
    if (currentType === 'expense') btn.classList.add('expense-selected');
  }

  btn.innerHTML = icon
    ? `<span class="cat-icon">${icon}</span><span class="cat-name"></span>`
    : '<span class="cat-name"></span>';
  btn.querySelector('.cat-name').textContent = record.name;

  // A category with a unit cost says so on its button, so the number that lands in
  // the amount box is never a surprise.
  const cost = (prefs.get(prefKey(record.parent, record.name)) || {}).cost || 0;
  if (cost > 0) {
    btn.classList.add('has-cost');
    const tag = document.createElement('span');
    tag.className = 'cat-cost';
    tag.textContent = formatBaht(cost);
    btn.appendChild(tag);
  }

  btn.addEventListener('click', () => selectCategory(record));
  return btn;
}

// Choosing a category fills in its unit cost when one is set. Typing over the
// number is still allowed: the cost is a starting point, not a lock.
function selectCategory(record) {
  selected = { parent: record.parent || '', name: record.name, ...categoryTarget(record) };
  $('custom-category-wrap').hidden = true;

  const cost =
    (getCategoryPrefs(ctx.accountId, currentType).get(prefKey(record.parent, record.name)) || {})
      .cost || 0;
  if (cost > 0) $('amount-input').value = String(cost);

  renderCategories();
  renderBudgetHint();
  renderTotal();
}

function removeCustomCategory(cat) {
  if (!confirmDeleteCategory(ctx.accountId, cat)) return;
  if (selected && selected.name === cat.name) selected = null;
  if (lastSavedCategory === cat.name) lastSavedCategory = null;
  renderEntry();
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
    renderParentChoices();
    renderSuggestions('');
    $('custom-category-input').focus();
  });
  return btn;
}

// A typed category can stand on its own or carry on from a main category, which is
// the second way of making a subcategory.
function renderParentChoices() {
  const select = $('custom-category-parent');
  select.innerHTML = '';

  const none = document.createElement('option');
  none.value = '';
  none.textContent = 'ไม่สังกัดหมวดหลัก';
  select.appendChild(none);

  for (const main of CATEGORIES[currentType]) {
    const option = document.createElement('option');
    option.value = main.name;
    option.textContent = `${main.icon} ${main.name}`;
    select.appendChild(option);
  }
}

// Matches what is being typed against categories the user already saved, so a
// repeat entry is one tap rather than retyping the whole name.
function renderSuggestions(query) {
  const box = $('category-suggestions');
  const q = query.trim().toLowerCase();

  const matches = getCustomCategories(ctx.accountId, currentType)
    .filter((c) => (q ? c.name.toLowerCase().includes(q) : true))
    .filter((c) => c.name.toLowerCase() !== q)
    .slice(0, 6);

  box.innerHTML = '';
  box.hidden = matches.length === 0;

  for (const record of matches) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'suggestion-chip';
    chip.textContent = record.parent ? `${record.parent} · ${record.name}` : record.name;
    chip.addEventListener('click', () => selectCategory(record));
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

  const parent = $('custom-category-parent').value || '';
  if ($('save-as-category').checked) {
    addCustomCategory(ctx.accountId, currentType, check.value, parent);
  }
  selectCategory({ parent, name: check.value });
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
  const category = (selected && selected.category) || lastSavedCategory;

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

  const unitCheck = validateAmount($('amount-input').value, { label: 'ราคาต่อหน่วย' });
  if (!unitCheck.ok) {
    showEntryError(unitCheck.error);
    return;
  }

  const qtyCheck = validateQuantity($('qty-input').value);
  if (!qtyCheck.ok) {
    showEntryError(qtyCheck.error);
    return;
  }

  // The stored amount is always the total, so every other screen keeps reading a
  // single number and none of them had to change.
  const amountCheck = validateAmount(unitCheck.value * qtyCheck.value);
  if (!amountCheck.ok) {
    showEntryError(amountCheck.error);
    return;
  }

  if (!selected) {
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
    quantity: qtyCheck.value,
    category: selected.category,
    sub: selected.sub,
    note: noteCheck.value,
    date: dateCheck.value,
  });
  scheduleSync(ctx.accountId);

  $('amount-input').value = '';
  $('note-input').value = '';
  $('date-input').value = todayISO();
  setQuantity(1);
  lastSavedCategory = currentType === 'expense' ? selected.category : null;
  selected = null;

  renderEntry();
  flashSaved();
  checkBudgetAlerts();
}

function flashSaved() {
  const btn = $('save-btn');
  btn.textContent = '✓ บันทึกแล้ว';
  btn.disabled = true;
  setTimeout(() => {
    renderSaveLabel();
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

  // Quantity is shown but not editable here: changing it would raise the question
  // of whether the total follows, and this modal edits the total directly.
  const qty = tx.quantity || 1;
  const qtyNote = $('edit-qty-note');
  qtyNote.hidden = qty <= 1;
  qtyNote.textContent = qty > 1 ? `บันทึกไว้ ${qty} หน่วย ยอดด้านบนคือยอดรวม` : '';

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
