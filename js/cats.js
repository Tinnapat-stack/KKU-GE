// Category manager: main categories, their subcategories, and the settings that
// hang off each one.
//
// Prices live on subcategories rather than on main categories, because one main
// category holds many things at many prices. A main category's own price is stored
// as a subcategory named after it, so there is one mechanism here, not two.

import {
  getCustomCategories,
  getSubcategories,
  getCategoryPrefs,
  setCategoryCost,
  setCategoryPinned,
  addSubcategory,
  deleteCustomCategory,
  countCategoryUsage,
  categoryTarget,
  prefKey,
} from './storage.js';
import { scheduleSync } from './filesync.js';
import { CATEGORIES, iconForCategory } from './categories.js';
import { validateAmount, validateName } from './validate.js';
import { formatBaht } from './format.js';
import { showToast } from './toast.js';

const $ = (id) => document.getElementById(id);

const KINDS = [
  { kind: 'income', title: 'หมวดรายรับ' },
  { kind: 'expense', title: 'หมวดรายจ่าย' },
];

let ctx = null;
let onChanged = null;
let addingUnder = null; // { kind, parent } while the add form is open

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
  addingUnder = null;
  render();
  $('cats-overlay').hidden = false;
  $('cats-body').scrollTop = 0;
}

export function closeCats() {
  $('cats-overlay').hidden = true;
}

/* ---------- Shared delete prompt ---------- */

// Deleting a category tells the user what happens to the records that used it first.
// A standalone category rewrites them to "อื่นๆ (ชื่อเดิม)"; a subcategory rewrites
// nothing, because the main category it named still exists. The entry page calls
// this too, so there is one prompt rather than two.
// Returns true when the category was actually deleted.
export function confirmDeleteCategory(accountId, cat) {
  const used = countCategoryUsage(accountId, cat);
  const label = cat.parent ? `หมวดย่อย "${cat.name}"` : `หมวดหมู่ "${cat.name}"`;

  let detail;
  if (!used) {
    detail = 'ยังไม่มีรายการไหนใช้หมวดนี้';
  } else if (cat.parent) {
    detail =
      `มี ${used} รายการที่ใช้หมวดนี้อยู่\n` +
      `รายการเหล่านั้นยังอยู่ในหมวด "${cat.parent}" เหมือนเดิม แค่ไม่มีปุ่มลัดให้กดอีก`;
  } else {
    detail =
      `มี ${used} รายการที่ใช้หมวดนี้อยู่\n` +
      `รายการเหล่านั้นจะถูกเปลี่ยนเป็น "อื่นๆ (${cat.name})" ไม่หายไปไหน`;
  }

  if (!confirm(`ลบ${label} ?\n\n${detail}`)) return false;

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

    for (const main of CATEGORIES[kind]) {
      section.appendChild(mainRow(kind, main.name, prefs));

      for (const sub of getSubcategories(ctx.accountId, kind, main.name)) {
        section.appendChild(subRow(kind, main.name, sub));
      }

      if (addingUnder && addingUnder.kind === kind && addingUnder.parent === main.name) {
        section.appendChild(addForm(kind, main.name));
      }
    }

    const standalone = getCustomCategories(ctx.accountId, kind).filter((c) => !c.parent);
    if (standalone.length) {
      const note = document.createElement('p');
      note.className = 'cats-note';
      note.textContent = 'หมวดที่ไม่ได้สังกัดหมวดหลักไหน';
      section.appendChild(note);
      for (const cat of standalone) section.appendChild(subRow(kind, '', cat));
    }

    body.appendChild(section);
  }
}

// A main category's row edits the record named after itself, so its price and pin
// behave exactly like any subcategory's.
function mainRow(kind, name, prefs) {
  const pref = prefs.get(prefKey(name, name)) || { cost: 0, pinned: false };

  const row = document.createElement('div');
  row.className = 'cats-row cats-main';
  if (pref.pinned) row.classList.add('pinned');

  const icon = document.createElement('span');
  icon.className = 'cats-icon';
  icon.textContent = iconForCategory(kind, name);

  const label = document.createElement('span');
  label.className = 'cats-name';
  label.textContent = name;

  const controls = document.createElement('div');
  controls.className = 'cats-controls';
  controls.append(costField(kind, name, name, pref), pinButton(kind, name, name, pref));
  row.append(icon, label, controls);

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'cats-add';
  add.textContent = '+ หมวดย่อย';
  add.title = `เพิ่มหมวดย่อยใต้ ${name}`;
  add.addEventListener('click', () => {
    const open = addingUnder && addingUnder.parent === name && addingUnder.kind === kind;
    addingUnder = open ? null : { kind, parent: name };
    render();
    if (!open) $('cats-sub-name').focus();
  });
  controls.appendChild(add);

  return row;
}

function subRow(kind, parent, record) {
  const row = document.createElement('div');
  row.className = parent ? 'cats-row cats-sub' : 'cats-row';
  if (record.pinned) row.classList.add('pinned');

  const icon = document.createElement('span');
  icon.className = 'cats-icon';
  // A subcategory borrows the main category's emoji, so the grouping reads at a
  // glance while the name says which one it is.
  icon.textContent = parent ? iconForCategory(kind, parent) : iconForCategory(kind, record.name);

  const label = document.createElement('span');
  label.className = 'cats-name';
  label.textContent = record.name;

  const pref = { cost: record.cost || 0, pinned: !!record.pinned };
  const controls = document.createElement('div');
  controls.className = 'cats-controls';
  controls.append(
    costField(kind, parent, record.name, pref),
    pinButton(kind, parent, record.name, pref)
  );
  row.append(icon, label, controls);

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'cats-del';
  del.textContent = '🗑';
  del.title = 'ลบหมวดนี้';
  del.addEventListener('click', () => {
    if (!confirmDeleteCategory(ctx.accountId, record)) return;
    if (onChanged) onChanged();
    render();
  });
  controls.appendChild(del);

  return row;
}

function addForm(kind, parent) {
  const wrap = document.createElement('div');
  wrap.className = 'cats-add-form';

  const help = document.createElement('p');
  help.className = 'cats-note';
  help.textContent = `เพิ่มหมวดย่อยใต้ "${parent}" ไม่ตั้งชื่อก็ได้ จะใช้ชื่อ "${parent}" แทน`;

  const name = document.createElement('input');
  name.type = 'text';
  name.id = 'cats-sub-name';
  name.className = 'text-input';
  name.maxLength = 40;
  name.placeholder = 'ชื่อหมวดย่อย เช่น พารา';

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
  cost.placeholder = 'ราคา/หน่วย';
  cost.setAttribute('aria-label', 'ราคาต่อหน่วยของหมวดย่อยใหม่');
  costWrap.append(currency, cost);

  const error = document.createElement('p');
  error.className = 'form-error';
  error.hidden = true;

  const actions = document.createElement('div');
  actions.className = 'cats-add-actions';

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn btn-secondary btn-small';
  cancel.textContent = 'ยกเลิก';
  cancel.addEventListener('click', () => {
    addingUnder = null;
    render();
  });

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'btn btn-primary btn-small';
  save.textContent = 'เพิ่มหมวดย่อย';
  save.addEventListener('click', () => {
    const typed = name.value.trim();
    if (typed) {
      const check = validateName(typed, { label: 'ชื่อหมวดย่อย' });
      if (!check.ok) {
        error.textContent = check.error;
        error.hidden = false;
        return;
      }
    }

    let price = 0;
    if (cost.value.trim() !== '') {
      const check = validateAmount(cost.value, { label: 'ราคาต่อหน่วย' });
      if (!check.ok) {
        error.textContent = check.error;
        error.hidden = false;
        return;
      }
      price = check.value;
    }

    const result = addSubcategory(ctx.accountId, kind, parent, typed, price);
    if (!result.ok) {
      error.textContent = result.error;
      error.hidden = false;
      return;
    }

    addingUnder = null;
    changed();
    render();
    showToast(`เพิ่มหมวดย่อย "${result.record.name}" ใน "${parent}" แล้ว`, 'info');
  });

  actions.append(cancel, save);
  wrap.append(help, name, costWrap, error, actions);
  return wrap;
}

/* ---------- Row controls ---------- */

function costField(kind, parent, name, pref) {
  const wrap = document.createElement('label');
  wrap.className = 'cats-cost';

  const currency = document.createElement('span');
  currency.className = 'cats-currency';
  currency.textContent = '฿';

  const input = document.createElement('input');
  input.type = 'number';
  input.inputMode = 'decimal';
  input.min = '0';
  input.step = '0.01';
  input.placeholder = 'ราคา/หน่วย';
  input.value = pref.cost > 0 ? String(pref.cost) : '';
  input.setAttribute('aria-label', `ราคาต่อหน่วยของ ${name}`);
  input.addEventListener('change', () => saveCost(kind, parent, name, input));

  wrap.append(currency, input);
  return wrap;
}

function pinButton(kind, parent, name, pref) {
  const pin = document.createElement('button');
  pin.type = 'button';
  pin.className = 'cats-pin';
  pin.classList.toggle('on', pref.pinned);
  pin.textContent = pref.pinned ? '📌 ปักหมุดแล้ว' : 'ปักหมุด';
  pin.title = 'ปักหมุดไว้บนหน้าโฮมเพื่อบันทึกได้เร็วขึ้น';
  pin.addEventListener('click', () => {
    setCategoryPinned(ctx.accountId, kind, parent, name, !pref.pinned);
    changed();
    render();
  });
  return pin;
}

// An empty box means no cost is set, which is different from a cost of zero.
function saveCost(kind, parent, name, input) {
  const raw = input.value.trim();

  if (raw === '') {
    setCategoryCost(ctx.accountId, kind, parent, name, 0);
    changed();
    return;
  }

  const check = validateAmount(raw, { label: 'ราคาต่อหน่วย' });
  if (!check.ok) {
    showToast(check.error, 'warn');
    const current = getCategoryPrefs(ctx.accountId, kind).get(prefKey(parent, name));
    input.value = current && current.cost > 0 ? String(current.cost) : '';
    return;
  }

  setCategoryCost(ctx.accountId, kind, parent, name, check.value);
  changed();
  showToast(`ตั้งราคา ${name} ไว้ที่ ${formatBaht(check.value)} ต่อหน่วย`, 'info');
}

// Re-exported so the entry page can label a row the same way this panel does.
export { categoryTarget };
