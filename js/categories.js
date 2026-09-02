// The built-in category lists, shared by the entry form and the budget picker.
// Kept in their own module so the plan page does not have to import the entry page.

export const CATEGORIES = {
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

export const EXPENSE_CATEGORY_NAMES = CATEGORIES.expense.map((c) => c.name);

// Falls back to a generic mark for categories the user typed themselves.
export function iconForCategory(type, category) {
  const found = (CATEGORIES[type] || []).find((c) => c.name === category);
  if (found) return found.icon;
  return type === 'income' ? '💰' : '🏷️';
}

// A stored category record whose name matches a built-in is not a new category:
// it only carries that built-in's unit cost and pinned state.
export function isBuiltInCategory(type, name) {
  return (CATEGORIES[type] || []).some((c) => c.name === name);
}
