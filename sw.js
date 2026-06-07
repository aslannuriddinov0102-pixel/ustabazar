const CACHE = 'ustabazar-v13';
const ASSETS = ['./Usta Bazar.html', './manifest.webmanifest', './logo.svg', './logo-icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('push', (e) => {
  let data = { title: 'Usta Bazar', body: 'Yangi yangilanish' };
  try { data = { ...data, ...JSON.parse(e.data.text()) }; } catch {}
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon || '/logo-icon.svg',
      badge: data.icon || '/logo-icon.svg',
      data: { url: data.url || './Usta%20Bazar.html' },
    })
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data?.url || './Usta%20Bazar.html';
  e.waitUntil(clients.openWindow(url));
});

self.addEventListener('fetch', (e) => {
  if (e.request.url.includes('/api/') || e.request.url.includes('/uploads/')) return;
  e.respondWith(
    caches.match(e.request).then((r) => r || fetch(e.request).then((res) => {
      if (!res.ok || res.type === 'opaque') return res;
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }))
  );
});
