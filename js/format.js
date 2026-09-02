// Shared display formatting. Dates render in the Buddhist era, matching the
// wireframe (2026 CE shows as ปี 2569).

const THAI_MONTHS_SHORT = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

const THAI_MONTHS_FULL = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

export const toBuddhistYear = (year) => year + 543;

export function formatBaht(amount) {
  const n = Number(amount) || 0;
  return `฿${n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Compact form used where space is tight, such as the chart balance.
export function formatBahtShort(amount) {
  const n = Number(amount) || 0;
  return `฿${n.toLocaleString('th-TH', { maximumFractionDigits: 0 })}`;
}

export function parseISODate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// "5 ส.ค. 69"
export function formatThaiDate(iso) {
  if (!iso) return '';
  const date = parseISODate(iso);
  const be = toBuddhistYear(date.getFullYear());
  return `${date.getDate()} ${THAI_MONTHS_SHORT[date.getMonth()]} ${String(be).slice(-2)}`;
}

// "5 สิงหาคม 2569"
export function formatThaiDateLong(iso) {
  if (!iso) return '';
  const date = parseISODate(iso);
  return `${date.getDate()} ${THAI_MONTHS_FULL[date.getMonth()]} ${toBuddhistYear(date.getFullYear())}`;
}

export function formatMonthYear(date) {
  return `${THAI_MONTHS_FULL[date.getMonth()]} ${toBuddhistYear(date.getFullYear())}`;
}

export function formatPercent(part, total) {
  if (!total) return '0%';
  return `${Math.round((part / total) * 100)}%`;
}
