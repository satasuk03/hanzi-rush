// Hashed /assets never change: cache first. Everything else same-origin: network first, so a deploy shows up on the
// next launch and the cached copy only covers offline. The API is never cached.
const CACHE = 'hanzi-rush-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const save = (key, res) => {
  if (res.ok) {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(key, copy));
  }
  return res;
};

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api')) return;

  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => save(req, res))));
    return;
  }
  const key = req.mode === 'navigate' ? url.pathname : req;
  e.respondWith(fetch(req).then((res) => save(key, res)).catch(() => caches.match(key).then((hit) => hit || Response.error())));
});
