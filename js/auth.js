// Login and account creation.
//
// The password separates users sharing one device and gates the app UI. It does
// NOT protect the data: localStorage is readable through devtools and the exported
// CSV opens in Excel. The UI says so plainly rather than implying real security.
//
// There is no password reset. Two things soften that: an optional hint shown after
// three failed attempts, and recovery by importing a previously exported CSV into a
// fresh account.

import {
  findAccountsByUsername,
  createAccount,
  setSession,
  mergeImported,
  rehomeOrphans,
  getWallets,
} from './storage.js';
import { generateSalt, hashPassword, verifyPassword, DEFAULT_ITERATIONS, isCryptoAvailable } from './crypto.js';
import { validateUsername, validatePassword, LIMITS } from './validate.js';
import { pickAndParseCSV } from './filesync.js';

const FAILURES_BEFORE_HINT = 3;

let failedAttempts = new Map();
let onLoggedIn = null;

const $ = (id) => document.getElementById(id);

export function initAuth(callback) {
  onLoggedIn = callback;

  $('login-form').addEventListener('submit', handleLogin);
  $('create-form').addEventListener('submit', handleCreate);
  $('show-create-btn').addEventListener('click', () => showPanel('create'));
  $('back-to-login-btn').addEventListener('click', () => showPanel('login'));
  $('recover-btn').addEventListener('click', () => showPanel('create', { recovery: true }));

  if (!isCryptoAvailable()) {
    setError(
      'login-error',
      'เบราว์เซอร์นี้ใช้ระบบเข้ารหัสไม่ได้ ต้องเปิดเว็บผ่าน https หรือ localhost ไม่ใช่เปิดไฟล์ตรงๆ'
    );
  }
}

function showPanel(name, { recovery = false } = {}) {
  $('login-panel').hidden = name !== 'login';
  $('create-panel').hidden = name !== 'create';
  clearError('login-error');
  clearError('create-error');
  $('hint-box').hidden = true;

  $('create-panel-title').textContent = recovery ? 'กู้คืนจากไฟล์' : 'สร้างบัญชีใหม่';
  $('recovery-note').hidden = !recovery;
  $('import-on-create').checked = recovery;
}

function setError(id, message) {
  const el = $(id);
  el.textContent = message;
  el.hidden = !message;
}

function clearError(id) {
  setError(id, '');
}

async function handleLogin(event) {
  event.preventDefault();
  clearError('login-error');

  const username = $('login-username').value;
  const password = $('login-password').value;

  const nameCheck = validateUsername(username);
  if (!nameCheck.ok) {
    setError('login-error', nameCheck.error);
    return;
  }

  const candidates = findAccountsByUsername(nameCheck.value);

  // No account with this name at all: creating one is the right next step.
  if (candidates.length === 0) {
    setError('login-error', `ยังไม่มีบัญชีชื่อ "${nameCheck.value}" ในเครื่องนี้`);
    $('create-username').value = nameCheck.value;
    $('show-create-btn').focus();
    return;
  }

  for (const account of candidates) {
    if (await verifyPassword(password, account)) {
      failedAttempts.delete(account.username.toLowerCase());
      finishLogin(account);
      return;
    }
  }

  // The account exists, so the likely cause is a typo. Never steer the user
  // toward making a second account here: that is how people lose track of data.
  const key = nameCheck.value.toLowerCase();
  const count = (failedAttempts.get(key) || 0) + 1;
  failedAttempts.set(key, count);

  setError('login-error', `รหัสผ่านไม่ถูกต้อง มีบัญชีชื่อ "${nameCheck.value}" อยู่แล้วในเครื่องนี้`);

  if (count >= FAILURES_BEFORE_HINT) {
    const withHint = candidates.find((a) => a.hint);
    $('hint-text').textContent = withHint
      ? `คำใบ้: ${withHint.hint}`
      : 'บัญชีนี้ไม่ได้ตั้งคำใบ้ไว้ ถ้าจำรหัสไม่ได้ ให้กู้คืนจากไฟล์ CSV ที่เคยบันทึกไว้';
    $('hint-box').hidden = false;
  }
}

function finishLogin(account) {
  const wallets = getWallets(account.id);
  setSession(account.id, wallets[0] ? wallets[0].id : null);
  if (onLoggedIn) onLoggedIn(account);
}

async function handleCreate(event) {
  event.preventDefault();
  clearError('create-error');

  const nameCheck = validateUsername($('create-username').value);
  if (!nameCheck.ok) {
    setError('create-error', nameCheck.error);
    return;
  }

  const password = $('create-password').value;
  const passCheck = validatePassword(password);
  if (!passCheck.ok) {
    setError('create-error', passCheck.error);
    return;
  }

  if (password !== $('create-password-confirm').value) {
    setError('create-error', 'รหัสผ่านทั้งสองช่องไม่ตรงกัน');
    return;
  }

  const hint = $('create-hint').value.trim().slice(0, LIMITS.HINT_MAX);

  // A same-name account is allowed (a second wallet set on a shared laptop), but
  // it is worth one confirmation so it is never a silent accident.
  if (findAccountsByUsername(nameCheck.value).length > 0) {
    const ok = confirm(
      `มีบัญชีชื่อ "${nameCheck.value}" อยู่แล้วในเครื่องนี้\n\n` +
        'การสร้างใหม่จะได้บัญชีแยกอีกอันที่ไม่เห็นข้อมูลของอันเดิม ต้องการสร้างต่อไหม'
    );
    if (!ok) return;
  }

  let imported = null;
  if ($('import-on-create').checked) {
    try {
      imported = await pickAndParseCSV();
      if (!imported) return; // user cancelled the file picker
    } catch (err) {
      setError('create-error', err.message);
      return;
    }
  }

  const salt = generateSalt();
  const hash = await hashPassword(password, salt, DEFAULT_ITERATIONS);
  const { account } = createAccount({
    username: nameCheck.value,
    salt,
    hash,
    iterations: DEFAULT_ITERATIONS,
    hint,
  });

  if (imported) {
    mergeImported(account.id, imported, false);
    const orphans = rehomeOrphans(account.id);
    const skipped = imported.skipped.length;
    alert(
      `กู้คืนข้อมูลแล้ว\n` +
        `รายการ ${imported.transactions.length} รายการ, กระเป๋า ${imported.wallets.length} ใบ, เป้าหมาย ${imported.goals.length} รายการ` +
        (skipped ? `\nข้าม ${skipped} แถวที่ข้อมูลไม่ถูกต้อง` : '') +
        (orphans ? `\nย้าย ${orphans} รายการที่ไม่มีกระเป๋าไปไว้ใน "รายการที่กู้คืน"` : '')
    );
  }

  finishLogin(account);
}
