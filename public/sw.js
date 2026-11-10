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

// ── Push notifications ─────────────────────────────
// Every push must show a notification (iOS revokes permission otherwise).
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'SFEF Motors', {
    body: d.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: d.tag,                // one banner per conversation, replaced by newer ones…
    renotify: !!d.tag,         // …but still buzz for each new message
    data: { url: d.url || '/' },
  }));
});

// Tapping a notification opens the app at that conversation — reusing an
// open window if there is one.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).origin === self.location.origin) {
        await w.focus();
        w.postMessage({ type: 'open', url });
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
