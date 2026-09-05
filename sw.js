// Service worker: keeps the whole app on the device so it opens with no network.
//
// Everything this app does already happens in the browser — the data lives in
// localStorage and the CSV file is picked from the user's own disk — so the only
// thing that ever needed the network was the app's own files. Caching all of them
// at install time is what makes "works offline" true from the first visit rather
// than after the user happens to have opened every page.
//
// The whole app is about half a megabyte, so there is no reason to be clever about
// which parts to keep.
//
// IMPORTANT: adding or removing a file in this project means editing SHELL below.
// A file that is missing from this list still works online and fails offline, which
// is the worst way to find out. The test suite compares this list against the repo.

// The version arrives on the registration URL (sw.js?v=V1.4.5) so the number lives
// in js/version.js only. Changing it also changes this worker's URL, which is what
// makes the browser notice a new release at all.
const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = `psw-${VERSION}`;

const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',

  'js/main.js',
  'js/analytics.js',
  'js/auth.js',
  'js/budget.js',
  'js/calendar.js',
  'js/categories.js',
  'js/cats.js',
  'js/crypto.js',
  'js/csv.js',
  'js/docs.js',
  'js/entry.js',
  'js/filesync.js',
  'js/format.js',
  'js/goals.js',
  'js/home.js',
  'js/homebg.js',
  'js/icons.js',
  'js/plan.js',
  'js/pwa.js',
  'js/recurring.js',
  'js/report.js',
  'js/sound.js',
  'js/storage.js',
  'js/toast.js',
  'js/transfer.js',
  'js/txrow.js',
  'js/validate.js',
  'js/version.js',

  'assets/img/home-bg.jpg',
  'assets/img/sparkle.jpg',
  'assets/img/texture.jpg',
  'assets/icon/icon-192.png',
  'assets/icon/icon-512.png',
  'assets/icon/icon-maskable-512.png',
  'assets/icon/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // One miss must not leave a half-filled cache, so they are added together.
      cache.addAll(SHELL.map((path) => new Request(path, { cache: 'reload' })))
    )
  );
  // No skipWaiting here: a new worker waits until the user says go, because
  // swapping the files under a page that is mid-entry would lose what they typed.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((n) => n.startsWith('psw-') && n !== CACHE).map((n) => caches.delete(n)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Anything that is not a plain read of our own files is none of this worker's
  // business: let the network handle it exactly as it would without one.
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  // A navigation to any address inside the scope should open the app, even offline
  // and even with a query string on the end, so it is always answered with the
  // page itself rather than with a lookup that would miss.
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match('index.html', { cacheName: CACHE }).then((hit) => hit || fetch(request))
    );
    return;
  }

  // Cache first. The cache is thrown away on every release, so what it holds can
  // only ever be the current version's files.
  event.respondWith(
    caches.match(request, { cacheName: CACHE }).then((hit) => hit || fetch(request))
  );
});
