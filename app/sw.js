// Service worker : l'appli et les questions restent disponibles hors ligne.
// VERSION est remplacée par le SHA du commit lors de la publication (CI),
// ce qui invalide l'ancien cache à chaque nouvelle version.

const VERSION = '__BUILD__';
const CACHE = `cet-${VERSION}`;
const SHELL = [
  './',
  'index.html',
  'css/app.css',
  'js/main.js',
  'js/core/random.js',
  'js/core/progress.js',
  'js/core/selection.js',
  'js/core/session.js',
  'js/core/scoring.js',
  'js/adapters/storage.js',
  'packs/index.json',
  'packs/togaf/pack.json',
  'packs/togaf/questions.json',
  'packs/togaf/objectives.json',
  'js/core/objectives.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('cet-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Réseau d'abord (contenu à jour), cache en repli (hors ligne).
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return res;
      })
      .catch(() => caches.match(request, { ignoreSearch: true }).then((r) => r ?? caches.match('index.html'))),
  );
});
