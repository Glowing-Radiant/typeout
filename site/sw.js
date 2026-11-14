// Offline support.
//
// scripts/build.mjs stamps VERSION with the build id and adds ?v=<build> to every script and
// stylesheet the pages load. So:
//   - pages are fetched from the network first, and only fall back to the cache when offline;
//   - scripts and styles are cached by their versioned URL, which never changes within a build, so
//     a new page always loads files from its own build and never a stale copy;
//   - each deploy installs a new worker with a new cache, and the old cache is deleted.
// The page is cached as './' (not './index.html'): hosts such as Cloudflare Pages redirect
// /index.html, and a redirected response cannot be served for a navigation.
const VERSION = '__BUILD__';
const CACHE = `typeout-${VERSION}`;

const versioned = (path) => (/\.(js|css)$/.test(path) ? `${path}?v=${VERSION}` : path);

const ASSETS = [
  './',
  './manifest.webmanifest',
  './assets/css/styles.css',
  './assets/js/app.js',
  './assets/js/theme-init.js',
  './assets/js/scoring.js',
  './assets/js/passages.js',
  './assets/js/presets.js',
  './assets/js/storage.js',
  './assets/js/dictation.js',
  './assets/js/online.js',
  './assets/js/leaderboard.js',
  './assets/icons/icon.svg',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
].map(versioned);

const PRECACHED = new Set(ASSETS.map((path) => new URL(path, self.location).href));

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // cache: 'reload' skips the browser's HTTP cache, so the new worker never stores old files.
      .then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('typeout-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Pages: network first, so a new deploy shows up straight away; fall back to the cache offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok && !res.redirected) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put('./', copy));
          }
          return res;
        })
        .catch(() => caches.match('./')),
    );
    return;
  }

  // Precached files (versioned scripts and styles, icons, manifest): cache first, network if missing.
  // Anything else, such as the app's own update check and the API, goes straight to the network.
  if (!PRECACHED.has(url.href)) return;
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
});
