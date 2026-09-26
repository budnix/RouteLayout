// Service worker: aplikacja działa offline. Wersja jest wstawiana przy deployu (pages.yml zamienia
// __SW_VERSION__ na sha commitu); każda wersja ma własny cache, stare są usuwane przy aktywacji.
// Lokalnie (wersja "dev") zasoby idą najpierw z sieci, żeby nie oglądać nieświeżych plików.
// Test w tests/smoke.test.cjs sprawdza, że PRECACHE zawiera każdy plik z js/, css/, vendor/ i icons/.

const VERSION = '__SW_VERSION__';
const DEV = VERSION.startsWith('__');
const CACHE = `routelayout-${DEV ? 'dev' : VERSION}`;

const PRECACHE = [
  './', 'index.html', 'manifest.json', 'css/app.css',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/main.js', 'js/catalog.js', 'js/layout.js', 'js/editor2d.js', 'js/view3d.js', 'js/fitter.js', 'js/normalize.js',
  'js/closer.js', 'js/checks.js', 'js/train.js', 'js/print.js', 'js/share.js', 'js/scenery.js', 'js/spatial.js', 'js/partlist.js', 'js/i18n.js',
  'js/ui/app.js', 'js/ui/palette.js', 'js/ui/topbar.js', 'js/ui/sketch.js', 'js/ui/problems.js', 'js/ui/tools.js',
  'js/ui/trainmode.js', 'js/ui/closing.js', 'js/ui/selection.js', 'js/ui/menu.js', 'js/ui/levels.js', 'js/ui/offline.js',
  'vendor/three.module.js', 'vendor/three.core.js', 'vendor/OrbitControls.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 'reload' omija cache HTTP przeglądarki – do nowego cache trafia zawsze świeża kopia
    await Promise.all(PRECACHE.map(async (url) => {
      try { const res = await fetch(new Request(url, { cache: 'reload' })); if (res.ok) await cache.put(url, res); }
      catch (err) { console.warn('sw precache', url, err); }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const nav = req.mode === 'navigate';
  // nawigacja i tryb dev: sieć najpierw (świeży index.html wykrywa nową wersję), cache jako zapas
  // zasoby w wersji produkcyjnej: cache najpierw (adresy z ?v=sha należą do tej samej wersji), sieć jako zapas
  e.respondWith(nav || DEV ? networkFirst(req) : cacheFirst(req));
});

async function cacheFirst(req) {
  const hit = await caches.match(req, { ignoreSearch: true });
  if (hit) return hit;
  return fetchAndStore(req);
}
async function networkFirst(req) {
  try { return await fetchAndStore(req); }
  catch (err) {
    const hit = await caches.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' && await caches.match('index.html'));
    if (hit) return hit;
    throw err;
  }
}
async function fetchAndStore(req) {
  const res = await fetch(req);
  if (res.ok && res.type === 'basic') { const cache = await caches.open(CACHE); cache.put(stripVersion(req), res.clone()); }
  return res;
}
function stripVersion(req) { const u = new URL(req.url); u.search = ''; return u.href; }
