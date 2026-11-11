/*
 * Service Worker: Die App startet auch ohne Netz und zeigt die gespeicherten
 * Gespräche. Fragen gehen ohne Netz natürlich nicht.
 *
 * Erst Netz, dann Zwischenspeicher: Mit Empfang kommt immer die neueste
 * Fassung, ohne Empfang die zuletzt geladene. Anfragen an andere Adressen
 * (Supabase, die Funktion amy-chat) fasst der Service Worker nicht an.
 *
 * VERSION hochzählen, wenn Dateien dazukommen oder wegfallen.
 */

const VERSION = 'v3';
const CACHE = `fragmal-${VERSION}`;

const SHELL = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/api.js',
  './js/auth.js',
  './js/config.js',
  './js/einfuehrung.js',
  './js/kosten.js',
  './js/markdown.js',
  './js/store.js',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((namen) => Promise.all(namen.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const anfrage = e.request;
  if (anfrage.method !== 'GET') return;
  if (new URL(anfrage.url).origin !== self.location.origin) return;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const antwort = await fetch(anfrage);
      if (antwort.ok) cache.put(anfrage, antwort.clone());
      return antwort;
    } catch {
      const alt = await cache.match(anfrage, { ignoreSearch: true });
      if (alt) return alt;
      if (anfrage.mode === 'navigate') {
        const start = await cache.match('./index.html');
        if (start) return start;
      }
      throw new Error('offline');
    }
  })());
});
