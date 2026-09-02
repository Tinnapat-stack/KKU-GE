// Shared validation rules. Every writer goes through these so the entry form,
// the goal form and the CSV importer all enforce the same limits.

export const LIMITS = {
  AMOUNT_MAX: 1000000000,
  NAME_MAX: 40,
  NOTE_MAX: 200,
  USERNAME_MAX: 30,
  HINT_MAX: 60,
  PASSWORD_MIN: 4,
  BACKDATE_DAYS: 60,
  MAX_CUSTOM_CATEGORIES: 12,
  TOMBSTONE_DAYS: 90,
};

export function todayISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return toISODate(d);
}

export function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function earliestEntryDateISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - LIMITS.BACKDATE_DAYS);
  return toISODate(d);
}

// Returns { ok, value, error }. Amounts are rounded to 2 decimal places.
export function validateAmount(raw, { label = 'จำนวนเงิน' } = {}) {
  const n = Number(raw);
  if (raw === '' || raw === null || raw === undefined || !Number.isFinite(n)) {
    return { ok: false, error: `กรุณากรอก${label}` };
  }
  if (n <= 0) {
    return { ok: false, error: `${label}ต้องมากกว่า 0` };
  }
  if (n > LIMITS.AMOUNT_MAX) {
    return { ok: false, error: `${label}สูงเกินไป` };
  }
  return { ok: true, value: Math.round(n * 100) / 100 };
}

export function validateEntryDate(raw) {
  if (!raw) return { ok: false, error: 'กรุณาเลือกวันที่' };
  if (raw > todayISO()) return { ok: false, error: 'เลือกวันที่ในอนาคตไม่ได้' };
  if (raw < earliestEntryDateISO()) {
    return { ok: false, error: `ย้อนหลังได้ไม่เกิน ${LIMITS.BACKDATE_DAYS} วัน` };
  }
  return { ok: true, value: raw };
}

export function validateName(raw, { label = 'ชื่อ' } = {}) {
  const value = (raw || '').trim();
  if (!value) return { ok: false, error: `กรุณากรอก${label}` };
  if (value.length > LIMITS.NAME_MAX) {
    return { ok: false, error: `${label}ยาวเกิน ${LIMITS.NAME_MAX} ตัวอักษร` };
  }
  return { ok: true, value };
}

export function validateNote(raw) {
  const value = (raw || '').trim();
  if (value.length > LIMITS.NOTE_MAX) {
    return { ok: false, error: `รายละเอียดยาวเกิน ${LIMITS.NOTE_MAX} ตัวอักษร` };
  }
  return { ok: true, value };
}

export function validateUsername(raw) {
  const value = (raw || '').trim();
  if (!value) return { ok: false, error: 'กรุณากรอกชื่อผู้ใช้' };
  if (value.length > LIMITS.USERNAME_MAX) {
    return { ok: false, error: `ชื่อผู้ใช้ยาวเกิน ${LIMITS.USERNAME_MAX} ตัวอักษร` };
  }
  return { ok: true, value };
}

export function validatePassword(raw) {
  const value = raw || '';
  if (value.length < LIMITS.PASSWORD_MIN) {
    return { ok: false, error: `รหัสผ่านต้องมีอย่างน้อย ${LIMITS.PASSWORD_MIN} ตัว` };
  }
  return { ok: true, value };
}

// Goals may not be created with a date already in the past, but an existing goal
// is allowed to age past its date and simply shows as overdue.
export function validateGoalDate(raw) {
  if (!raw) return { ok: true, value: '' };
  if (raw < todayISO()) return { ok: false, error: 'วันที่เป้าหมายต้องไม่เป็นอดีต' };
  return { ok: true, value: raw };
}
