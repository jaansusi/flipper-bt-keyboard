// Offline support (WEB-15): cache the whole app on install and serve it from
// the cache. The deploy workflow replaces BUILD_ID with the commit hash, so
// every deploy gets a new cache and old caches are deleted on activate.

const BUILD_ID = "dev";
const CACHE = `remote-keyboard-${BUILD_ID}`;

// Every file the page needs. test/precache.test.js checks this list against web/.
const PRECACHE = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "favicon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "css/style.css",
  "js/ble.js",
  "js/compose.js",
  "js/constants.js",
  "js/keymap.js",
  "js/layouts.js",
  "js/live.js",
  "js/main.js",
  "js/onscreen.js",
  "js/queue.js",
  "js/report.js",
  "js/textinput.js",
  "layouts/index.json",
  "layouts/us.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// Cache first; fall back to the network for anything not precached.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches
      .match(event.request, { ignoreSearch: true })
      .then((cached) => cached ?? fetch(event.request)),
  );
});
