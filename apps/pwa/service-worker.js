// This digest identifies one immutable, complete shell manifest. Release
// tooling changes it whenever any member changes.
const SHELL_GENERATION = "sha256-30c6d87f-pidex-shell-v1";
const SHELL_CACHE = `pidex-shell-${SHELL_GENERATION}`;
const SHELL = ["/", "/index.html", "/app.js", "/manifest.webmanifest"];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const responses = await Promise.all(SHELL.map(url => fetch(url, { cache: "reload" })));
    if (responses.some(response => !response.ok)) throw Error("incomplete shell generation");
    const cache = await caches.open(SHELL_CACHE);
    try {
      await Promise.all(SHELL.map((url, index) => cache.put(url, responses[index])));
    } catch (error) {
      await caches.delete(SHELL_CACHE);
      throw error;
    }
    // Deliberately no skipWaiting: older pages keep their worker generation.
  })());
});

self.addEventListener("message", event => {
  if (event.data?.type !== "activate-shell") return;
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (clients.length > 1) {
      event.source?.postMessage({ type: "update-refused-multiple-clients" });
      return;
    }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith("pidex-shell-") && name !== SHELL_CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    return (await cache.match(event.request)) ||
      (event.request.mode === "navigate" ? cache.match("/index.html") : fetch(event.request));
  })());
});

self.addEventListener("push", event => {
  const hint = event.data?.json() || {};
  event.waitUntil(self.registration.showNotification(hint.title || "Pidex update", {
    body: hint.body || "Open Pidex to reconcile current state.",
    data: { path: hint.path || "/" },
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(event.notification.data?.path || "/"));
});
