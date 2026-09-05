// Installing the app, keeping it working offline, and telling the user when a new
// version is ready.
//
// The service worker itself is sw.js at the root of the project. This module is the
// page's half of that arrangement: it registers the worker, watches for a newer one,
// and offers the two things a browser cannot offer on its own — a button that
// installs the app on Android, and instructions for iPhone, where installing is a
// Safari menu item and no page is allowed to trigger it.

import { APP_VERSION } from './version.js';
import { openDoc } from './docs.js';

const $ = (id) => document.getElementById(id);

const DISMISS_KEY = 'psw_install_hint';

let installPrompt = null; // the deferred Android prompt, when the browser offers one
let reloading = false;

// A service worker needs a secure context. Opening index.html straight off the disk
// gives file://, where registering throws, so the app simply goes without one.
const canRegister = () =>
  'serviceWorker' in navigator && (location.protocol === 'https:' || location.protocol === 'http:');

// Already installed: the app is running from the home screen rather than in a tab.
export function isInstalled() {
  const standalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
  return !!standalone || window.navigator.standalone === true;
}

const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  // iPadOS reports itself as a Mac, and is told apart by having a touch screen.
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/* ---------- The worker ---------- */

function register() {
  if (!canRegister()) return;

  // main.js lives in js/, so a bare 'sw.js' would resolve to js/sw.js. The base of
  // the page is the right root, and it is also what keeps this working under the
  // /KKU-GE/ subpath that GitHub Pages serves from.
  const url = new URL(`sw.js?v=${encodeURIComponent(APP_VERSION)}`, document.baseURI);
  const scope = new URL('./', document.baseURI);

  navigator.serviceWorker
    .register(url, { scope })
    .then((reg) => watchForUpdate(reg))
    .catch(() => {
      // Offline support is a bonus, never a requirement. A browser that refuses is
      // left alone rather than shown an error about a feature it did not ask for.
    });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });
}

function watchForUpdate(reg) {
  // A worker already waiting means the files for the next version are on the device
  // and only the swap is left.
  if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);

  reg.addEventListener('updatefound', () => {
    const next = reg.installing;
    if (!next) return;
    next.addEventListener('statechange', () => {
      // Without a controller this is the very first install, which needs no notice.
      if (next.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(next);
    });
  });
}

function offerUpdate(worker) {
  const bar = $('update-bar');
  if (!bar) return;
  bar.hidden = false;

  $('update-now').onclick = () => {
    bar.hidden = true;
    // The worker takes over, controllerchange fires, and the page reloads there.
    worker.postMessage('SKIP_WAITING');
  };
  $('update-later').onclick = () => {
    bar.hidden = true;
  };
}

/* ---------- The install card ---------- */

function dismissed() {
  try {
    return localStorage.getItem(DISMISS_KEY) === 'off';
  } catch {
    return false;
  }
}

function renderInstallCard() {
  const card = $('install-card');
  if (!card) return;

  // Nothing to offer once it is installed, and nothing to nag about once the user
  // has said no.
  if (isInstalled() || dismissed()) {
    card.hidden = true;
    return;
  }

  // Android hands the page a real install prompt. iOS never does, so it gets told
  // where the button is instead.
  const installable = !!installPrompt;
  $('install-do').hidden = !installable;
  $('install-text').textContent = installable
    ? 'ติดตั้งลงเครื่องไว้ใช้แบบออฟไลน์ได้ ไม่ต้องพิมพ์ที่อยู่เว็บอีก'
    : isIOS()
      ? 'เพิ่มลงหน้าจอโฮมได้ กดปุ่มแชร์ใน Safari แล้วเลือก "เพิ่มลงในหน้าจอโฮม"'
      : 'เปิดเมนูของเบราว์เซอร์แล้วเลือกติดตั้งแอป จะใช้งานแบบออฟไลน์ได้';

  card.hidden = false;
}

export function initPWA() {
  register();

  window.addEventListener('beforeinstallprompt', (event) => {
    // Holding on to the event is what lets the app put the prompt behind its own
    // button instead of leaving it to the browser's banner.
    event.preventDefault();
    installPrompt = event;
    renderInstallCard();
  });

  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    const card = $('install-card');
    if (card) card.hidden = true;
  });

  $('install-do').addEventListener('click', async () => {
    if (!installPrompt) return;
    const prompt = installPrompt;
    installPrompt = null; // a deferred prompt can only be used once
    prompt.prompt();
    await prompt.userChoice.catch(() => null);
    renderInstallCard();
  });

  $('install-how').addEventListener('click', () => openDoc('install'));

  $('install-dismiss').addEventListener('click', () => {
    try {
      localStorage.setItem(DISMISS_KEY, 'off');
    } catch {
      // Storage blocked: the card stays for this visit and that is fine.
    }
    $('install-card').hidden = true;
  });

  renderInstallCard();
}
