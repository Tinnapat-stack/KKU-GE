// One transaction row, shared by the entry page's recent list and the home page's
// summary. Kept in its own module so neither page has to import the other.

import { iconForCategory } from './categories.js';
import { formatBaht, formatThaiDate } from './format.js';

// `onDelete` and `onOpen` are optional; omit them for a read-only row.
export function transactionRow(tx, { onDelete, onOpen, peerName } = {}) {
  const item = document.createElement('div');
  item.className = 'recent-item';
  if (!onOpen) item.classList.add('recent-item-static');

  const icon = document.createElement('div');
  icon.className = 'recent-icon';
  // A transfer is neither income nor expense, so it gets its own mark rather than
  // borrowing one that would read as earning or spending.
  icon.textContent = tx.transferId ? '🔁' : iconForCategory(tx.type, tx.category);
  if (tx.transferId) item.classList.add('recent-transfer');

  const info = document.createElement('div');
  info.className = 'recent-info';

  const cat = document.createElement('div');
  cat.className = 'recent-cat';
  // The main category first, then the subcategory it was recorded under, so the row
  // says both what group the money went to and exactly what it was.
  cat.textContent = tx.sub ? `${tx.category} · ${tx.sub}` : tx.category;

  // A count only earns its place when it is more than one.
  if (tx.quantity > 1) {
    const qty = document.createElement('span');
    qty.className = 'recent-qty';
    qty.textContent = `× ${tx.quantity}`;
    cat.appendChild(qty);
  }

  const meta = document.createElement('div');
  meta.className = 'recent-note';
  // `peerName` is supplied by the caller, which is the only place that knows the
  // wallet list. Without it the row still reads correctly, just without the name.
  const parts = [formatThaiDate(tx.date)];
  if (tx.transferId && peerName) {
    parts.push(tx.type === 'expense' ? `ไป ${peerName}` : `จาก ${peerName}`);
  }
  if (tx.note) parts.push(tx.note);
  meta.textContent = parts.join(' · ');

  info.append(cat, meta);

  const amount = document.createElement('div');
  amount.className = `recent-amount ${tx.type}`;
  amount.textContent = `${tx.type === 'income' ? '+' : '-'}${formatBaht(tx.amount)}`;

  item.append(icon, info, amount);

  if (onDelete) {
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'recent-del';
    del.textContent = '🗑';
    del.title = 'ลบรายการ';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      const question = tx.transferId
        ? `ลบการโอน ${formatBaht(tx.amount)} ?\n\nรายการจะหายไปจากทั้งสองกระเป๋า`
        : `ลบรายการ "${tx.category}" ${formatBaht(tx.amount)} ?`;
      if (!confirm(question)) return;
      onDelete(tx);
    });
    item.appendChild(del);
  }

  if (onOpen) item.addEventListener('click', () => onOpen(tx));
  return item;
}
