// App entry point: session handling, wallet switching, file panel, navigation.

import {
  getSession,
  setSession,
  clearSession,
  getAccountById,
  getWallets,
  addWallet,
  renameWallet,
  deleteWallet,
  purgeTombstones,
  rehomeOrphans,
  previewImport,
  mergeImported,
} from './storage.js';
import { initAuth } from './auth.js';
import { initEntry, setEntryContext, renderEntry } from './entry.js';
import { initAnalytics, setAnalyticsContext, renderAnalytics } from './analytics.js';
import { initPlan, setPlanContext, renderPlan } from './plan.js';
import { initHome, setHomeContext, renderHome } from './home.js';
import { renderIcons } from './icons.js';
import { initHomeBackground, playHomeBackground, stopHomeBackground } from './homebg.js';
import * as filesync from './filesync.js';
import { validateName } from './validate.js';

const $ = (id) => document.getElementById(id);

const ctx = { accountId: null, walletId: null, username: '' };
let pagesReady = false;
let currentPage = 'home';

/* ---------- Boot ---------- */

function boot() {
  renderIcons();
  initHomeBackground();
  initAuth(enterApp);
  filesync.installLifecycleHooks();
  filesync.onStatus(renderSyncStatus);

  const session = getSession();
  const account = session ? getAccountById(session.accountId) : null;

  if (account) {
    enterApp(account, session.walletId);
  } else {
    clearSession();
    showAuth();
  }
}

function showAuth() {
  $('auth').hidden = false;
  $('app').hidden = true;
}

function enterApp(account, preferredWalletId) {
  ctx.accountId = account.id;
  ctx.username = account.username;

  purgeTombstones(account.id);
  const rehomed = rehomeOrphans(account.id);

  let wallets = getWallets(account.id);
  if (wallets.length === 0) {
    addWallet(account.id, 'กระเป๋าหลัก');
    wallets = getWallets(account.id);
  }

  const preferred = wallets.find((w) => w.id === preferredWalletId);
  ctx.walletId = preferred ? preferred.id : wallets[0].id;
  setSession(ctx.accountId, ctx.walletId);

  $('auth').hidden = true;
  $('app').hidden = false;
  $('username-chip').textContent = account.username;

  if (!pagesReady) {
    initEntry(ctx);
    initAnalytics(ctx);
    initPlan(ctx);
    initHome(ctx, showPage);
    initShell();
    pagesReady = true;
  }

  pushContext();
  renderWalletBar();
  renderAll();
  showPage('home');
  restoreFileSync();

  if (rehomed > 0) {
    alert(`พบ ${rehomed} รายการที่ไม่มีกระเป๋า ย้ายไปไว้ในกระเป๋า "รายการที่กู้คืน" แล้ว`);
  }
}

// Each page holds its own reference, so context changes must be pushed down.
function pushContext() {
  setEntryContext(ctx);
  setAnalyticsContext(ctx);
  setPlanContext(ctx);
  setHomeContext(ctx);
}

function renderAll() {
  renderEntry();
  renderPlan();
  renderAnalytics();
  renderHome();
}

/* ---------- Shell wiring ---------- */

function initShell() {
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => showPage(btn.dataset.page));
  });

  $('username-chip').addEventListener('click', () => toggleDrawer(true));
  $('drawer-close').addEventListener('click', () => toggleDrawer(false));
  $('drawer').addEventListener('click', (e) => {
    if (e.target === $('drawer')) toggleDrawer(false);
  });

  $('logout-btn').addEventListener('click', logout);
  $('add-wallet-btn').addEventListener('click', createWallet);
  $('rename-wallet-btn').addEventListener('click', renameCurrentWallet);
  $('delete-wallet-btn').addEventListener('click', deleteCurrentWallet);

  $('connect-file-btn').addEventListener('click', connectFile);
  $('export-btn').addEventListener('click', () => filesync.downloadCSV(ctx.accountId, ctx.username));
  $('import-btn').addEventListener('click', importFile);
  $('sync-banner-btn').addEventListener('click', regrantPermission);
}

function showPage(page) {
  currentPage = page;
  // Home draws a photograph behind the chrome, so the header needs its own local
  // scrim there and nowhere else.
  $('app').classList.toggle('on-home', page === 'home');
  document.querySelectorAll('.page').forEach((el) => {
    el.hidden = el.id !== `page-${page}`;
  });
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.page === page);
  });

  // Re-rendering on switch replays the chart animation, per the blueprint.
  if (page === 'home') {
    renderHome();
    playHomeBackground();
  } else {
    stopHomeBackground();
  }
  if (page === 'entry') renderEntry();
  if (page === 'analytics') renderAnalytics();
  if (page === 'plan') renderPlan();
}

function toggleDrawer(show) {
  $('drawer').hidden = !show;
  if (show) renderWalletList();
}

async function logout() {
  await filesync.flush(ctx.accountId);
  clearSession();
  location.reload();
}

/* ---------- Wallets ---------- */

function renderWalletBar() {
  const wallets = getWallets(ctx.accountId);
  const active = wallets.find((w) => w.id === ctx.walletId);
  $('wallet-name').textContent = active ? active.name : '';
  $('wallet-count').textContent = wallets.length > 1 ? `${wallets.length} กระเป๋า` : '';
}

function renderWalletList() {
  const list = $('wallet-list');
  list.innerHTML = '';

  for (const wallet of getWallets(ctx.accountId)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wallet-item';
    btn.classList.toggle('active', wallet.id === ctx.walletId);
    btn.textContent = wallet.name;
    btn.addEventListener('click', () => switchWallet(wallet.id));
    list.appendChild(btn);
  }
}

async function switchWallet(walletId) {
  await filesync.flush(ctx.accountId);
  ctx.walletId = walletId;
  setSession(ctx.accountId, walletId);
  pushContext();
  renderWalletBar();
  renderWalletList();
  renderAll();
  toggleDrawer(false);
}

function createWallet() {
  const input = prompt('ตั้งชื่อกระเป๋าใหม่', 'กระเป๋าใหม่');
  if (input === null) return;

  const check = validateName(input, { label: 'ชื่อกระเป๋า' });
  if (!check.ok) {
    alert(check.error);
    return;
  }

  const wallet = addWallet(ctx.accountId, check.value);
  filesync.scheduleSync(ctx.accountId);
  switchWallet(wallet.id);
}

function renameCurrentWallet() {
  const wallets = getWallets(ctx.accountId);
  const active = wallets.find((w) => w.id === ctx.walletId);
  if (!active) return;

  const input = prompt('เปลี่ยนชื่อกระเป๋า', active.name);
  if (input === null) return;

  const check = validateName(input, { label: 'ชื่อกระเป๋า' });
  if (!check.ok) {
    alert(check.error);
    return;
  }

  renameWallet(ctx.accountId, ctx.walletId, check.value);
  filesync.scheduleSync(ctx.accountId);
  renderWalletBar();
  renderWalletList();
}

function deleteCurrentWallet() {
  const wallets = getWallets(ctx.accountId);
  if (wallets.length <= 1) {
    alert('ต้องมีอย่างน้อยหนึ่งกระเป๋า สร้างกระเป๋าใหม่ก่อนจึงจะลบใบนี้ได้');
    return;
  }

  const active = wallets.find((w) => w.id === ctx.walletId);
  if (!confirm(`ลบกระเป๋า "${active.name}" พร้อมรายการและเป้าหมายทั้งหมดในกระเป๋านี้?`)) return;

  deleteWallet(ctx.accountId, ctx.walletId);
  filesync.scheduleSync(ctx.accountId);

  const remaining = getWallets(ctx.accountId);
  switchWallet(remaining[0].id);
}

/* ---------- File panel ---------- */

function renderSyncStatus(status) {
  const labels = {
    unsupported: 'เบราว์เซอร์นี้เขียนไฟล์อัตโนมัติไม่ได้',
    off: 'ยังไม่ได้เชื่อมไฟล์',
    syncing: 'กำลังบันทึกลงไฟล์...',
    synced: 'บันทึกลงไฟล์แล้ว',
    pending: 'รออนุญาตเข้าถึงไฟล์',
    error: 'เขียนไฟล์ไม่สำเร็จ',
  };

  const el = $('sync-status');
  el.textContent = labels[status] || '';
  el.className = `sync-status sync-${status}`;

  // The banner is only for a file the user already connected, whose permission
  // the browser dropped between sessions. Never show it before they connect one.
  $('sync-banner').hidden = status !== 'pending';
}

async function restoreFileSync() {
  const status = await filesync.refreshConnection(ctx.accountId);
  if (status === 'unsupported') {
    $('connect-file-btn').disabled = true;
    $('file-unsupported-note').hidden = false;
  }
}

async function regrantPermission() {
  const handle = await filesync.getStoredHandle(ctx.accountId);
  if (!handle) return;

  const permission = await filesync.requestPermission(handle);
  if (permission === 'granted') {
    await filesync.flush(ctx.accountId);
  } else {
    renderSyncStatus('pending');
  }
}

async function connectFile() {
  try {
    await filesync.connectFile(ctx.accountId, ctx.username);
    renderSyncStatus('synced');
  } catch (err) {
    // An aborted picker is a normal cancel, not a failure worth reporting.
    if (err && err.name === 'AbortError') return;
    alert(err.message || 'เชื่อมต่อไฟล์ไม่สำเร็จ');
  }
}

async function importFile() {
  let parsed;
  try {
    parsed = await filesync.pickAndParseCSV();
  } catch (err) {
    alert(err.message || 'อ่านไฟล์ไม่สำเร็จ');
    return;
  }
  if (!parsed) return;

  const preview = previewImport(ctx.accountId, parsed);
  const skippedNote = parsed.skipped.length
    ? `\nข้าม ${parsed.skipped.length} แถวที่ข้อมูลไม่ถูกต้อง (เช่น บรรทัด ${parsed.skipped[0].line}: ${parsed.skipped[0].reason})`
    : '';

  const proceed = confirm(
    'สรุปการนำเข้า\n\n' +
      `เพิ่มใหม่ ${preview.added} รายการ\n` +
      `อัปเดตของเดิม ${preview.updated} รายการ\n` +
      `เหมือนเดิม ${preview.unchanged} รายการ` +
      skippedNote +
      '\n\nรายการที่ถูกลบไปแล้วจะไม่ถูกกู้กลับมา ต้องการนำเข้าต่อไหม'
  );
  if (!proceed) return;

  mergeImported(ctx.accountId, parsed, false);
  const rehomed = rehomeOrphans(ctx.accountId);
  filesync.scheduleSync(ctx.accountId);

  const wallets = getWallets(ctx.accountId);
  if (!wallets.some((w) => w.id === ctx.walletId)) {
    ctx.walletId = wallets[0].id;
    setSession(ctx.accountId, ctx.walletId);
    pushContext();
  }

  renderWalletBar();
  renderWalletList();
  renderAll();
  toggleDrawer(false);

  alert(
    `นำเข้าเสร็จแล้ว` +
      (rehomed ? `\nย้าย ${rehomed} รายการที่ไม่มีกระเป๋าไปไว้ใน "รายการที่กู้คืน"` : '')
  );
}

boot();
