// Category manager: one screen for the unit cost, the pin, and deletion.
//
// The entry page keeps its own quick path for creating a category while
// recording, but every setting on a category is edited here, so the entry form
// stays a form for recording rather than a place to configure things.

import {
  getCustomCategories,
  getCategoryPrefs,
  setCategoryCost,
  setCategoryPinned,
  deleteCustomCategory,
  countCategoryUsage,
} from './storage.js';
import { scheduleSync } from './filesync.js';
import { CATEGORIES, iconForCategory } from './categories.js';
import { validateAmount } from './validate.js';
import { formatBaht } from './format.js';
import { showToast } from './toast.js';

const $ = (id) => document.getElementById(id);

const KINDS = [
  { kind: 'income', title: 'หมวดรายรับ' },
  { kind: 'expense', title: 'หมวดรายจ่าย' },
];

let ctx = null;
let onChanged = null;

export function initCats(context, changed) {
  ctx = context;
  onChanged = changed;

  $('cats-close').addEventListener('click', closeCats);
  $('cats-overlay').addEventListener('click', (e) => {
    if (e.target === $('cats-overlay')) closeCats();
  });
}

export function setCatsContext(context) {
  ctx = context;
}

export function openCats() {
  render();
  $('cats-overlay').hidden = false;
  $('cats-body').scrollTop = 0;
}

export function closeCats() {
  $('cats-overlay').hidden = true;
}

/* ---------- Shared delete prompt ---------- */

// Deleting a category rewrites the records that used it, so the user is told how
// many are involved and exactly what will happen to them before confirming. The
// entry page's own delete button calls this too, so there is one prompt, not two.
// Returns true when the category was actually deleted.
export function confirmDeleteCategory(accountId, cat) {
  const used = countCategoryUsage(accountId, cat.name);
  const detail = used
    ? `มี ${used} รายการที่ใช้หมวดนี้อยู่\nรายการเหล่านั้นจะถูกเปลี่ยนเป็น "อื่นๆ (${cat.name})" ไม่หายไปไหน`
    : 'ยังไม่มีรายการไหนใช้หมวดนี้';

  if (!confirm(`ลบหมวดหมู่ "${cat.name}" ?\n\n${detail}`)) return false;

  const { renamedBudgets } = deleteCustomCategory(accountId, cat.id);
  scheduleSync(accountId);

  if (renamedBudgets) {
    showToast(`ย้ายงบประมาณของหมวดนี้ไปที่ "อื่นๆ (${cat.name})" แล้ว`, 'info');
  }
  return true;
}

/* ---------- Rendering ---------- */

function changed() {
  scheduleSync(ctx.accountId);
  if (onChanged) onChanged();
}

function render() {
  const body = $('cats-body');
  body.innerHTML = '';

  for (const { kind, title } of KINDS) {
    const section = document.createElement('section');
    section.className = 'cats-section';

    const heading = document.createElement('h4');
    heading.className = 'cats-section-heading';
    heading.textContent = title;
    section.appendChild(heading);

    const prefs = getCategoryPrefs(ctx.accountId, kind);
    const custom = getCustomCategories(ctx.accountId, kind);
    const rows = [
      ...CATEGORIES[kind].map((c) => ({ name: c.name, custom: null })),
      ...custom.map((c) => ({ name: c.name, custom: c })),
    ];

    for (const row of rows) {
      section.appendChild(categoryRow(kind, row, prefs.get(row.name) || { cost: 0, pinned: false }));
    }

    if (custom.length === 0) {
      const note = document.createElement('p');
      note.className = 'cats-note';
      note.textContent = 'หมวดที่คุณสร้างเองจะมาอยู่ตรงนี้ สร้างได้จากปุ่ม "อื่นๆ (พิมพ์เอง)" ในหน้าบันทึก';
      section.appendChild(note);
    }

    body.appendChild(section);
  }
}

function categoryRow(kind, { name, custom }, pref) {
  const row = document.createElement('div');
  row.className = 'cats-row';
  if (pref.pinned) row.classList.add('pinned');

  const icon = document.createElement('span');
  icon.className = 'cats-icon';
  icon.textContent = iconForCategory(kind, name);

  const label = document.createElement('span');
  label.className = 'cats-name';
  label.textContent = name;

  const costWrap = document.createElement('label');
  costWrap.className = 'cats-cost';
  const currency = document.createElement('span');
  currency.className = 'cats-currency';
  currency.textContent = '฿';

  const cost = document.createElement('input');
  cost.type = 'number';
  cost.inputMode = 'decimal';
  cost.min = '0';
  cost.step = '0.01';
  cost.placeholder = 'ราคาต่อหน่วย';
  cost.value = pref.cost > 0 ? String(pref.cost) : '';
  cost.setAttribute('aria-label', `ราคาต่อหน่วยของ ${name}`);
  cost.addEventListener('change', () => saveCost(kind, name, cost));

  costWrap.append(currency, cost);

  const pin = document.createElement('button');
  pin.type = 'button';
  pin.className = 'cats-pin';
  pin.classList.toggle('on', pref.pinned);
  pin.textContent = pref.pinned ? '📌 ปักหมุดแล้ว' : 'ปักหมุด';
  pin.title = 'ปักหมุดไว้บนหน้าโฮมเพื่อบันทึกได้เร็วขึ้น';
  pin.addEventListener('click', () => {
    setCategoryPinned(ctx.accountId, kind, name, !pref.pinned);
    changed();
    render();
  });

  row.append(icon, label, costWrap, pin);

  // Only a category the user created can be deleted. A built-in one has its
  // settings cleared instead, which is what the delete button would otherwise mean.
  if (custom) {
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'cats-del';
    del.textContent = '🗑';
    del.title = 'ลบหมวดนี้';
    del.addEventListener('click', () => {
      if (!confirmDeleteCategory(ctx.accountId, custom)) return;
      if (onChanged) onChanged();
      render();
    });
    row.appendChild(del);
  }

  return row;
}

// An empty box means no cost is set, which is different from a cost of zero.
function saveCost(kind, name, input) {
  const raw = input.value.trim();

  if (raw === '') {
    setCategoryCost(ctx.accountId, kind, name, 0);
    changed();
    return;
  }

  const check = validateAmount(raw, { label: 'ราคาต่อหน่วย' });
  if (!check.ok) {
    showToast(check.error, 'warn');
    const current = getCategoryPrefs(ctx.accountId, kind).get(name);
    input.value = current && current.cost > 0 ? String(current.cost) : '';
    return;
  }

  setCategoryCost(ctx.accountId, kind, name, check.value);
  changed();
  showToast(`ตั้งราคา ${name} ไว้ที่ ${formatBaht(check.value)} ต่อหน่วย`, 'info');
}
