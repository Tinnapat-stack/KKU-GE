// Entry page: record income and expenses, and review recent entries.

import {
  getTransactions,
  addTransaction,
  updateTransaction,
  deleteTransaction,
  getCustomCategories,
  addCustomCategory,
  deleteCustomCategory,
} from './storage.js';
import { scheduleSync } from './filesync.js';
import {
  validateAmount,
  validateEntryDate,
  validateNote,
  validateName,
  todayISO,
  earliestEntryDateISO,
} from './validate.js';
import { formatBaht, formatThaiDate } from './format.js';

const CATEGORIES = {
  income: [
    { icon: '🏦', name: 'เงินเดือน/ค่าจ้าง' },
    { icon: '🏠', name: 'เงินจากที่บ้าน' },
    { icon: '🛍️', name: 'ขายของ' },
    { icon: '🎁', name: 'รางวัล/โบนัส' },
    { icon: '💹', name: 'เงินออม/ดอกเบี้ย' },
  ],
  expense: [
    { icon: '🍜', name: 'อาหาร/เครื่องดื่ม' },
    { icon: '🚌', name: 'เดินทาง' },
    { icon: '📚', name: 'การเรียน' },
    { icon: '🛒', name: 'ช้อปปิ้ง' },
    { icon: '🎬', name: 'บันเทิง' },
    { icon: '🧾', name: 'บิล/ค่าบริการ' },
    { icon: '💊', name: 'สุขภาพ' },
    { icon: '🏡', name: 'ที่พัก' },
  ],
};

const RECENT_LIMIT = 20;
const $ = (id) => document.getElementById(id);

let ctx = null; // { accountId, walletId }
let currentType = 'income';
let selectedCategory = null;
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
}

/* ---------- Type toggle ---------- */

function setType(type) {
  currentType = type;
  selectedCategory = null;

  document.querySelectorAll('.toggle-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.type === type);
  });

  const isExpense = type === 'expense';
  $('amount-box').classList.toggle('expense', isExpense);
  $('category-label').textContent = isExpense ? 'ใช้ไปกับอะไร' : 'เงินมาจากไหน';
  $('save-btn').classList.toggle('expense', isExpense);
  $('save-btn').textContent = isExpense ? '✓ บันทึกรายจ่าย' : '✓ บันทึกรายรับ';

  renderCategories();
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
    const btn = categoryButton('🏷️', cat.name);
    const remove = document.createElement('span');
    remove.className = 'cat-remove';
    remove.textContent = '×';
    remove.title = 'ลบหมวดหมู่นี้';
    remove.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!confirm(`ลบหมวดหมู่ "${cat.name}" ออกจากปุ่มลัด?\nรายการเดิมที่ใช้หมวดนี้จะยังอยู่`)) return;
      deleteCustomCategory(ctx.accountId, cat.id);
      if (selectedCategory === cat.name) selectedCategory = null;
      scheduleSync(ctx.accountId);
      renderCategories();
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
  btn.innerHTML = `<span class="cat-icon">${icon}</span><span class="cat-name"></span>`;
  btn.querySelector('.cat-name').textContent = name;
  btn.addEventListener('click', () => {
    selectedCategory = name;
    $('custom-category-wrap').hidden = true;
    renderCategories();
  });
  return btn;
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
    $('custom-category-input').focus();
  });
  return btn;
}

// A typed-in category is saved so it becomes a normal button next time.
function commitCustomCategory() {
  const check = validateName($('custom-category-input').value, { label: 'ชื่อหมวดหมู่' });
  if (!check.ok) {
    showEntryError(check.error);
    return null;
  }
  addCustomCategory(ctx.accountId, currentType, check.value);
  selectedCategory = check.value;
  $('custom-category-wrap').hidden = true;
  renderCategories();
  return check.value;
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
  selectedCategory = null;

  renderEntry();
  flashSaved();
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
    list.appendChild(recentItem(tx));
  }
}

function recentItem(tx) {
  const item = document.createElement('div');
  item.className = 'recent-item';

  const icon = document.createElement('div');
  icon.className = 'recent-icon';
  icon.textContent = iconFor(tx);

  const info = document.createElement('div');
  info.className = 'recent-info';
  const cat = document.createElement('div');
  cat.className = 'recent-cat';
  cat.textContent = tx.category;
  const meta = document.createElement('div');
  meta.className = 'recent-note';
  meta.textContent = tx.note ? `${formatThaiDate(tx.date)} · ${tx.note}` : formatThaiDate(tx.date);
  info.append(cat, meta);

  const amount = document.createElement('div');
  amount.className = `recent-amount ${tx.type}`;
  amount.textContent = `${tx.type === 'income' ? '+' : '-'}${formatBaht(tx.amount)}`;

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'recent-del';
  del.textContent = '🗑';
  del.title = 'ลบรายการ';
  del.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!confirm(`ลบรายการ "${tx.category}" ${formatBaht(tx.amount)} ?`)) return;
    deleteTransaction(ctx.accountId, tx.id);
    scheduleSync(ctx.accountId);
    renderEntry();
  });

  item.append(icon, info, amount, del);
  item.addEventListener('click', () => openEditModal(tx));
  return item;
}

function iconFor(tx) {
  const found = CATEGORIES[tx.type].find((c) => c.name === tx.category);
  if (found) return found.icon;
  return tx.type === 'income' ? '💰' : '🏷️';
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
}

function deleteFromModal() {
  if (!confirm('ลบรายการนี้?')) return;
  deleteTransaction(ctx.accountId, editingId);
  scheduleSync(ctx.accountId);
  closeEditModal();
  renderEntry();
}
