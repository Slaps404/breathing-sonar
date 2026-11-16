// Service worker: lets the app be installed to the home screen and open with no network.
// Network first, cache as a fallback, so a new deploy shows up on the next load (no stale code).
// Only this site's own GET requests are cached. The call request (POST, another origin) is left alone.
const CACHE = 'breathing-watch-v29';
// Fetched at install so the app opens offline even if it was only ever loaded once.
const SHELL = ['./', 'style.css', 'app.js', 'hooks.js', 'judge.js', 'dev.js', '../dsp.js', 'manifest.webmanifest', 'icon-192.png'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
});
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(res => {
      // 200 only: a 206 (part of an mp3) cannot be stored.
      if (res.status === 200) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
