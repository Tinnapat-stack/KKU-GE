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
  migrateCategories,
  migrateSavings,
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
import { showToast } from './toast.js';
import { initDocs, openDoc } from './docs.js';
import { initCats, setCatsContext, openCats } from './cats.js';
import { initTransfer, setTransferContext, openTransfer } from './transfer.js';
import { initRecurring, setRecurringContext, checkDue } from './recurring.js';
import { initReport, setReportContext, openReport } from './report.js';
import { initCalendar, setCalendarContext } from './calendar.js';
import { APP_VERSION } from './version.js';

const $ = (id) => document.getElementById(id);

const ctx = { accountId: null, walletId: null, username: '' };
let pagesReady = false;
let currentPage = 'home';

/* ---------- Boot ---------- */

const ZOOM_KEY = 'psw_zoom_lock';

// Locking the viewport is a property of this device, not of the account, so it lives
// outside the account data and survives a log out.
//
// The lock stops the automatic zoom on a double tap. What actually stops Safari from
// zooming in when a field is focused is the 16px minimum on every input, which the
// stylesheet enforces whether the lock is on or off.
function applyZoomLock(locked) {
  const meta = $('viewport-meta');
  if (!meta) return;
  meta.setAttribute(
    'content',
    locked
      ? 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no'
      : 'width=device-width, initial-scale=1.0'
  );
}

function zoomLocked() {
  try {
    return localStorage.getItem(ZOOM_KEY) !== 'off';
  } catch {
    return true;
  }
}

function initZoomLock() {
  const box = $('zoom-lock');
  const locked = zoomLocked();
  box.checked = locked;
  applyZoomLock(locked);

  box.addEventListener('change', () => {
    try {
      localStorage.setItem(ZOOM_KEY, box.checked ? 'on' : 'off');
    } catch {
      // A browser with storage blocked still gets the setting for this session.
    }
    applyZoomLock(box.checked);
  });
}

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
  migrateCategories(account.id);
  migrateSavings(account.id);
  const rehomed = rehomeOrphans(account.id);

  const wallets = getWallets(account.id);
  const preferred = wallets.find((w) => w.id === preferredWalletId);
  ctx.walletId = preferred ? preferred.id : wallets.length ? wallets[0].id : null;
  setSession(ctx.accountId, ctx.walletId);

  $('auth').hidden = true;
  $('app').hidden = false;
  $('drawer-username').textContent = account.username;

  if (!pagesReady) {
    initEntry(ctx);
    initAnalytics(ctx);
    initPlan(ctx, renderAll);
    initHome(ctx, showPage, createWallet);
    initCats(ctx, renderAll);
    initTransfer(ctx, renderAll);
    initRecurring(ctx, renderAll);
    initReport(ctx);
    initCalendar(ctx);
    initShell();
    pagesReady = true;
  }

  pushContext();
  renderWalletBar();
  renderAll();
  showPage('home');
  restoreFileSync();

  // Nothing can run while the app is closed, so the dates that came due in the
  // meantime are offered now, once, and only after the screen is ready to show them.
  if (ctx.walletId) checkDue();

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
  setCatsContext(ctx);
  setTransferContext(ctx);
  setRecurringContext(ctx);
  setReportContext(ctx);
  setCalendarContext(ctx);
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

  $('menu-btn').addEventListener('click', () => toggleDrawer(true));
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

  initZoomLock();

  initDocs();
  $('open-guide-btn').addEventListener('click', () => openDoc('guide'));
  $('open-teacher-btn').addEventListener('click', () => openDoc('teacher'));
  $('open-changelog-btn').addEventListener('click', () => openDoc('changelog'));

  $('open-cats-btn').addEventListener('click', openCats);
  $('open-report-btn').addEventListener('click', openReport);
  $('transfer-btn').addEventListener('click', () => {
    toggleDrawer(false);
    openTransfer();
  });

  $('version-badge').textContent = APP_VERSION;
  $('version-badge').addEventListener('click', () => openDoc('changelog'));
}

function showPage(page) {
  // Without a wallet there is nothing for the other tabs to read or write, so they
  // send the user back to Home where the wallet can actually be created.
  if (!ctx.walletId && page !== 'home') {
    showToast('สร้างกระเป๋าก่อนถึงจะใช้หน้านี้ได้', 'warn');
    page = 'home';
  }

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
  $('wallet-name').textContent = active ? active.name : 'ยังไม่มีกระเป๋า';
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

export function createWallet() {
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
  $('header-sheet-dot').className = `sheet-dot sync-${status}`;
  $('header-sheet-dot').title = `ไฟล์ Sheet: ${labels[status] || ''}`;

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
