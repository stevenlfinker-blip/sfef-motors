const CACHE = 'sfef-v5';
const SHELL = [
  '/',
  '/css/styles.css',
  '/js/api.js',
  '/js/app.js',
  '/js/dashboard.js',
  '/js/cars.js',
  '/js/maintenance.js',
  '/js/parts.js',
  '/js/tools.js',
  '/js/cleaning.js',
  '/js/other.js',
  '/js/market.js',
  '/js/expenses.js',
  '/js/events.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const { request } = e;
  const url = new URL(request.url);

  // API calls — network only, never cache
  if (url.pathname.startsWith('/api/') || url.pathname === '/login' || url.pathname === '/logout') {
    return;
  }

  // App shell — network first (always get current code when online),
  // fall back to cache only when offline. This is what makes deploys
  // show up immediately without ever needing to bump CACHE by hand.
  e.respondWith(
    fetch(request).then(res => {
      if (res.ok && request.method === 'GET') {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(request, clone));
      }
      return res;
    }).catch(() => caches.match(request))
  );
});
