// Sign in and account creation.
//
// The blueprint specifies an app with no password, so a username alone is the
// default path. A password is an opt-in extra, useful when several people share one
// machine and could pick the same username. It gates the app UI only: localStorage
// is readable through devtools and the exported CSV opens in Excel, so it separates
// users rather than protecting data.
//
// There is no password reset. An optional hint appears after three failed attempts,
// and a previously exported CSV can be imported into a fresh account to recover.

import {
  findAccountsByUsername,
  createAccount,
  setSession,
  mergeImported,
  rehomeOrphans,
  getWallets,
  addWallet,
  accountHasPassword,
} from './storage.js';
import {
  generateSalt,
  hashPassword,
  verifyPassword,
  DEFAULT_ITERATIONS,
  isCryptoAvailable,
} from './crypto.js';
import { validateUsername, validatePassword, LIMITS } from './validate.js';
import { pickAndParseCSV } from './filesync.js';

const FAILURES_BEFORE_HINT = 3;

const failedAttempts = new Map();
let onLoggedIn = null;

const $ = (id) => document.getElementById(id);

export function initAuth(callback) {
  onLoggedIn = callback;

  $('login-form').addEventListener('submit', handleLogin);
  $('create-form').addEventListener('submit', handleCreate);
  $('show-create-btn').addEventListener('click', () => showPanel('create'));
  $('back-to-login-btn').addEventListener('click', () => showPanel('login'));
  $('recover-btn').addEventListener('click', () => showPanel('create', { recovery: true }));

  // The password fields only exist once the user asks for them.
  $('use-password').addEventListener('change', (e) => {
    $('password-fields').hidden = !e.target.checked;
  });

  // Typing a different username retracts a password prompt raised for the previous
  // one, so the form never asks for a password the new name does not need.
  $('login-username').addEventListener('input', () => {
    $('login-password-wrap').hidden = true;
    $('hint-box').hidden = true;
    clearError('login-error');
  });
}

function showPanel(name, { recovery = false } = {}) {
  $('login-panel').hidden = name !== 'login';
  $('create-panel').hidden = name !== 'create';
  clearError('login-error');
  clearError('create-error');
  $('hint-box').hidden = true;

  $('create-panel-title').textContent = recovery ? 'กู้คืนจากไฟล์' : 'เริ่มใช้งาน';
  $('recovery-note').hidden = !recovery;
  $('import-on-create').checked = recovery;
}

function setError(id, message) {
  const el = $(id);
  el.textContent = message;
  el.hidden = !message;
}

const clearError = (id) => setError(id, '');

/* ---------- Sign in ---------- */

async function handleLogin(event) {
  event.preventDefault();
  clearError('login-error');

  const nameCheck = validateUsername($('login-username').value);
  if (!nameCheck.ok) {
    setError('login-error', nameCheck.error);
    return;
  }

  const candidates = findAccountsByUsername(nameCheck.value);

  if (candidates.length === 0) {
    setError('login-error', `ยังไม่มีบัญชีชื่อ "${nameCheck.value}" ในเครื่องนี้`);
    $('create-username').value = nameCheck.value;
    $('show-create-btn').focus();
    return;
  }

  const open = candidates.filter((a) => !accountHasPassword(a));
  const locked = candidates.filter((a) => accountHasPassword(a));
  const typed = $('login-password').value;

  // Nothing under this name has a password, so the username is the whole login.
  if (locked.length === 0) {
    finishLogin(open[0]);
    return;
  }

  // Something under this name does have one. Reveal the field and stop until the
  // user has actually had a chance to type into it.
  if ($('login-password-wrap').hidden) {
    $('login-password-wrap').hidden = false;
    $('login-password').value = '';
    $('login-password').focus();
    setError('login-error', `บัญชีชื่อ "${nameCheck.value}" ตั้งรหัสผ่านไว้ กรุณากรอกรหัสผ่าน`);
    return;
  }

  // An empty box means they want the passwordless account that shares the name.
  if (typed === '' && open.length > 0) {
    finishLogin(open[0]);
    return;
  }

  for (const account of locked) {
    if (await verifyPassword(typed, account)) {
      failedAttempts.delete(nameCheck.value.toLowerCase());
      finishLogin(account);
      return;
    }
  }

  // The account exists, so a typo is the likely cause. Never steer toward making a
  // second account here: that is how people lose track of their data.
  const key = nameCheck.value.toLowerCase();
  const count = (failedAttempts.get(key) || 0) + 1;
  failedAttempts.set(key, count);

  setError('login-error', `รหัสผ่านไม่ถูกต้อง มีบัญชีชื่อ "${nameCheck.value}" อยู่แล้วในเครื่องนี้`);

  if (count >= FAILURES_BEFORE_HINT) {
    const withHint = locked.find((a) => a.hint);
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

/* ---------- Create ---------- */

async function handleCreate(event) {
  event.preventDefault();
  clearError('create-error');

  const nameCheck = validateUsername($('create-username').value);
  if (!nameCheck.ok) {
    setError('create-error', nameCheck.error);
    return;
  }

  const wantsPassword = $('use-password').checked;
  let password = '';
  let hint = '';

  if (wantsPassword) {
    if (!isCryptoAvailable()) {
      setError(
        'create-error',
        'ตั้งรหัสผ่านไม่ได้ เพราะต้องเปิดเว็บผ่าน https หรือ localhost ไม่ใช่เปิดไฟล์ตรงๆ'
      );
      return;
    }

    password = $('create-password').value;
    const passCheck = validatePassword(password);
    if (!passCheck.ok) {
      setError('create-error', passCheck.error);
      return;
    }
    if (password !== $('create-password-confirm').value) {
      setError('create-error', 'รหัสผ่านทั้งสองช่องไม่ตรงกัน');
      return;
    }
    hint = $('create-hint').value.trim().slice(0, LIMITS.HINT_MAX);
  }

  // A same-name account is allowed, but never as a silent accident.
  const existing = findAccountsByUsername(nameCheck.value);
  if (existing.length > 0) {
    const ok = confirm(
      `มีบัญชีชื่อ "${nameCheck.value}" อยู่แล้วในเครื่องนี้\n\n` +
        'การสร้างใหม่จะได้บัญชีแยกอีกอันที่ไม่เห็นข้อมูลของอันเดิม ต้องการสร้างต่อไหม' +
        (wantsPassword ? '' : '\n\nแนะนำให้ตั้งรหัสผ่านด้วย จะได้แยกสองบัญชีนี้ออกจากกันตอนเข้าใช้งาน')
    );
    if (!ok) return;
  }

  const importing = $('import-on-create').checked;
  let imported = null;

  if (importing) {
    try {
      imported = await pickAndParseCSV();
      if (!imported) return; // the picker was cancelled
    } catch (err) {
      setError('create-error', err.message);
      return;
    }
  }

  let salt = '';
  let hash = '';
  let iterations = 0;
  if (wantsPassword) {
    salt = generateSalt();
    hash = await hashPassword(password, salt, DEFAULT_ITERATIONS);
    iterations = DEFAULT_ITERATIONS;
  }

  // An import brings its own wallets, so seeding one here would leave a spare.
  const { account } = createAccount({
    username: nameCheck.value,
    salt,
    hash,
    iterations,
    hint,
    seedWallet: !importing,
  });

  if (imported) {
    mergeImported(account.id, imported, false);
    const orphans = rehomeOrphans(account.id);

    // A file with no usable wallet still has to leave the account able to record.
    if (getWallets(account.id).length === 0) addWallet(account.id, 'กระเป๋าหลัก');

    const skipped = imported.skipped.length;
    alert(
      'กู้คืนข้อมูลแล้ว\n' +
        `รายการ ${imported.transactions.length} รายการ, กระเป๋า ${getWallets(account.id).length} ใบ, ` +
        `เป้าหมาย ${imported.goals.length} รายการ` +
        (skipped ? `\nข้าม ${skipped} แถวที่ข้อมูลไม่ถูกต้อง` : '') +
        (orphans ? `\nย้าย ${orphans} รายการที่ไม่มีกระเป๋าไปไว้ใน "รายการที่กู้คืน"` : '')
    );
  }

  finishLogin(account);
}
