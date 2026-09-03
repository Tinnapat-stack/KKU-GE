// Moving money between the user's own wallets.
//
// A transfer is not income and not expense: the same money is still theirs, it just
// sits somewhere else. So it is stored as a linked pair of rows under a reserved
// category, counted in each wallet's balance, and left out of every figure that
// answers "how much did I make or spend".

import { getWallets, addTransfer } from './storage.js';
import { scheduleSync } from './filesync.js';
import { validateAmount, validateEntryDate, validateNote, todayISO, earliestEntryDateISO } from './validate.js';
import { formatBaht } from './format.js';
import { showToast } from './toast.js';

const $ = (id) => document.getElementById(id);

let ctx = null;
let onDone = null;

export function initTransfer(context, done) {
  ctx = context;
  onDone = done;

  $('transfer-close').addEventListener('click', closeTransfer);
  $('transfer-cancel').addEventListener('click', closeTransfer);
  $('transfer-overlay').addEventListener('click', (e) => {
    if (e.target === $('transfer-overlay')) closeTransfer();
  });
  $('transfer-save').addEventListener('click', save);
}

export function setTransferContext(context) {
  ctx = context;
}

export function openTransfer() {
  const wallets = getWallets(ctx.accountId);

  // With one wallet there is nowhere for the money to go, and saying so is more
  // use than opening a form that cannot be completed.
  if (wallets.length < 2) {
    alert('ต้องมีอย่างน้อยสองกระเป๋าถึงจะโอนได้ สร้างกระเป๋าอีกใบก่อน');
    return;
  }

  const from = wallets.find((w) => w.id === ctx.walletId) || wallets[0];
  $('transfer-from').textContent = from.name;

  const select = $('transfer-to');
  select.innerHTML = '';
  for (const wallet of wallets) {
    if (wallet.id === from.id) continue;
    const option = document.createElement('option');
    option.value = wallet.id;
    option.textContent = wallet.name;
    select.appendChild(option);
  }

  $('transfer-amount').value = '';
  $('transfer-note').value = '';
  $('transfer-date').min = earliestEntryDateISO();
  $('transfer-date').max = todayISO();
  $('transfer-date').value = todayISO();
  setError('');

  $('transfer-overlay').hidden = false;
  $('transfer-amount').focus();
}

export function closeTransfer() {
  $('transfer-overlay').hidden = true;
}

function setError(message) {
  const el = $('transfer-error');
  el.textContent = message;
  el.hidden = !message;
}

function save() {
  setError('');

  const amountCheck = validateAmount($('transfer-amount').value, { label: 'จำนวนเงินที่โอน' });
  if (!amountCheck.ok) {
    setError(amountCheck.error);
    return;
  }

  const dateCheck = validateEntryDate($('transfer-date').value);
  if (!dateCheck.ok) {
    setError(dateCheck.error);
    return;
  }

  const noteCheck = validateNote($('transfer-note').value);
  if (!noteCheck.ok) {
    setError(noteCheck.error);
    return;
  }

  const toWalletId = $('transfer-to').value;
  if (!toWalletId || toWalletId === ctx.walletId) {
    setError('เลือกกระเป๋าปลายทางที่ไม่ใช่กระเป๋าเดิม');
    return;
  }

  const wallets = getWallets(ctx.accountId);
  const to = wallets.find((w) => w.id === toWalletId);

  addTransfer(ctx.accountId, {
    fromWalletId: ctx.walletId,
    toWalletId,
    amount: amountCheck.value,
    date: dateCheck.value,
    note: noteCheck.value,
  });
  scheduleSync(ctx.accountId);

  closeTransfer();
  if (onDone) onDone();
  showToast(`โอน ${formatBaht(amountCheck.value)} ไป "${to ? to.name : ''}" แล้ว`, 'info');
}
