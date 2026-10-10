const CACHE = "nutri-guia-v14";
const FILES = ["/", "/portal.html", "/styles.css?v=14", "/features.css?v=14", "/app.js?v=14", "/portal.js", "/nutrition.mjs", "/safety.mjs", "/contact.mjs", "/charts.mjs",
  "/js/util.js", "/js/state.js", "/js/nav.js", "/js/logic.js", "/js/agenda.js", "/js/patients.js", "/js/detail.js", "/js/plans.js", "/js/settings.js", "/js/feedback.js", "/js/meal-options.js", "/js/auth.js",
  "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png"];

// Un archivo que falle no debe impedir la instalación de los demás.
self.addEventListener("install", event => event.waitUntil(caches.open(CACHE).then(cache => Promise.all(FILES.map(file => cache.add(file).catch(() => {}))))));
self.addEventListener("activate", event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))));
self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  const isPortal = url.pathname === "/portal" || url.pathname.startsWith("/portal/");
  event.respondWith(
    fetch(request).then(response => {
      if (response.ok && !isPortal) { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(request, copy)); }
      return response;
    }).catch(() => caches.match(request).then(cached => cached || (request.mode === "navigate" ? caches.match(isPortal ? "/portal.html" : "/") : undefined)))
  );
});
