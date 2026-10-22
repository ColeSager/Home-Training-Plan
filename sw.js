const VERSION = "5";
const CACHE = `htp-v${VERSION}`;
const NETWORK_FIRST = ["data/plan.json", "data/demos.json"];

const SHELL = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "calc.js",
  "store.js",
  "manifest.webmanifest",
  ...NETWORK_FIRST,
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/apple-touch-icon.png",
  "fonts/SuisseIntl-Regular.woff2",
  "fonts/SuisseIntl-RegularIt.woff2",
  "fonts/SuisseIntl-Medium.woff2",
  "fonts/SuisseIntl-Semibold.woff2",
  "fonts/SuisseIntl-Bold.woff2",
  "fonts/Nicholas-Regular.woff2",
  "fonts/Nicholas-Semibold.woff2",
  "fonts/Nicholas-ExtraBold.woff2",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL.map((url) => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("htp-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request, { cache: "no-cache" });
    if (res.ok) await cache.put(request, res.clone());
    return res;
  } catch {
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    throw new Error("offline");
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request, { ignoreSearch: true });
  if (hit) return hit;
  if (request.mode === "navigate") {
    const shell = await cache.match("./");
    if (shell) return shell;
  }
  const res = await fetch(request);
  if (res.ok) await cache.put(request, res.clone());
  return res;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const fresh = NETWORK_FIRST.some((p) => new URL(p, self.registration.scope).pathname === url.pathname);
  event.respondWith(fresh ? networkFirst(request) : cacheFirst(request));
});
