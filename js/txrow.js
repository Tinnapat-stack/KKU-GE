// One transaction row, shared by the entry page's recent list and the home page's
// summary. Kept in its own module so neither page has to import the other.

import { iconForCategory } from './categories.js';
import { formatBaht, formatThaiDate } from './format.js';

// `onDelete` and `onOpen` are optional; omit them for a read-only row.
export function transactionRow(tx, { onDelete, onOpen } = {}) {
  const item = document.createElement('div');
  item.className = 'recent-item';
  if (!onOpen) item.classList.add('recent-item-static');

  const icon = document.createElement('div');
  icon.className = 'recent-icon';
  icon.textContent = iconForCategory(tx.type, tx.category);

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

  item.append(icon, info, amount);

  if (onDelete) {
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'recent-del';
    del.textContent = '🗑';
    del.title = 'ลบรายการ';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!confirm(`ลบรายการ "${tx.category}" ${formatBaht(tx.amount)} ?`)) return;
      onDelete(tx);
    });
    item.appendChild(del);
  }

  if (onOpen) item.addEventListener('click', () => onOpen(tx));
  return item;
}
