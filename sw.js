/*
 * Immune Defense service worker.
 *
 * Goal: work offline, but always pick up the newest deploy automatically.
 *
 * NETWORK-FIRST for same-origin GETs — online, it fetches the latest file and
 * refreshes the cache; offline, it falls back to the cached copy, and for a
 * page navigation finally to the app shell. The house default (GameHub
 * setup/APP_DESIGN_RULES.md rule 6); it does not have the stale-build problem
 * a cache-first worker has (LESSONS 1.1).
 *
 * skipWaiting() + clients.claim() are deliberate: they let the next deploy
 * replace a bad worker instead of waiting for every tab in the world to
 * close. _headers serves this file `no-store` for the same reason.
 *
 * DEPLOY CHECKLIST — bump CACHE here and BUILD in js/version.js together.
 * scripts/check-deploy.mjs fails if they disagree, and also walks the import
 * graph from js/app.js and fails if any module is missing from SHELL: on a
 * first visit the page imports its modules BEFORE this worker takes control,
 * so the fetch handler never sees them, and a module missing here is missing
 * offline forever (LESSONS 1.4).
 */

var CACHE = "immunedefense-b2";

var SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/tokens.css",
  "./css/base.css",
  "./css/components.css",
  "./css/game.css",
  "./js/app.js",
  "./js/audio.js",
  "./js/battle.js",
  "./js/install.js",
  "./js/screens.js",
  "./js/store.js",
  "./js/ui.js",
  "./js/version.js",
  "./js/data/cells.js",
  "./js/data/guide.js",
  "./js/data/levels.js",
  "./js/data/threats.js",
  "./js/render/palette.js",
  "./js/render/renderer.js",
  "./js/render/sprites.js",
  "./js/sim/game.js",
  "./js/sim/map.js",
  "./js/sim/rng.js",
  "./icons/favicon.svg",
  "./icons/apple-touch-icon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", function (e) {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(SHELL.map(function (u) {
      return c.add(u).catch(function () { /* one miss must not fail the install */ });
    }));
  }).catch(function () { /* no Cache Storage (private mode): run uncached */ }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE) return caches.delete(k);
      }));
    }).catch(function () {}).then(function () { return self.clients.claim(); })
  );
});

/* The handler must never hand respondWith() a rejected promise — that is a
 * network error with nothing in the PAGE console, because the worker has its
 * own console that nobody has open on a phone (LESSONS 1.5). So every step
 * that can throw falls back to something that cannot. */
self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.status === 200 && res.type === "basic") {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { return c.put(req, copy); }).catch(function () {});
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) {
        if (hit) return hit;
        if (req.mode === "navigate") return caches.match("./index.html");
        return Response.error();
      }).then(function (res) {
        return res || Response.error();
      }).catch(function () { return Response.error(); });
    })
  );
});
