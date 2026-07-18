// This digest identifies one immutable, complete shell manifest. Release
// tooling changes it whenever any member changes.
const SHELL_GENERATION = "sha256-0413678e-pidex-shell-v1";
const SHELL_CACHE = `pidex-shell-${SHELL_GENERATION}`;
const SHELL = ["/", "/index.html", "/app.js", "/manifest.webmanifest"];

self.addEventListener("install", event => {
  event.waitUntil(cacheShell());
});

self.addEventListener("message", event => {
  if (event.data?.type !== "activate-shell") {
    return;
  }
  event.waitUntil(activateShell(event));
});

self.addEventListener("activate", event => {
  event.waitUntil(removeOldShellsAndClaimClients());
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") {
    return;
  }

  const url = new URL(event.request.url);
  if (
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/")
  ) {
    return;
  }
  event.respondWith(shellResponse(event.request));
});

self.addEventListener("push", event => {
  const hint = event.data?.json() || {};
  event.waitUntil(showAdvisoryHint(hint));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const path = event.notification.data?.path || "/";
  event.waitUntil(openAndReconcile(path));
});

async function showAdvisoryHint(hint) {
  if (hint.version !== 1 || !hint.eventId || await hasPushReceipt(hint.eventId)) return;
  await savePushReceipt(hint.eventId);
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of windows) client.postMessage({ type: "push-hint", eventId: hint.eventId });
  // A foreground Client renders the synchronized in-app fact; avoid a second surface.
  if (windows.some(client => client.visibilityState === "visible")) return;
  await self.registration.showNotification(hint.title || "Pidex update", {
    body: hint.body || "Open Pidex to reconcile current state.",
    tag: `${hint.hostId}:${hint.eventId}`,
    data: { path: hint.path || "/", eventId: hint.eventId },
  });
}

async function openAndReconcile(path) {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  let client = windows.find(item => new URL(item.url).pathname === new URL(path, self.location.origin).pathname);
  client = client || await self.clients.openWindow(path);
  client?.postMessage({ type: "push-reconcile", path });
  await client?.focus?.();
}

function pushReceiptDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("pidex-push-receipts", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("events");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function hasPushReceipt(eventId) {
  const db = await pushReceiptDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction("events").objectStore("events").get(eventId);
    request.onsuccess = () => resolve(Boolean(request.result));
    request.onerror = () => reject(request.error);
  });
}

async function savePushReceipt(eventId) {
  const db = await pushReceiptDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("events", "readwrite");
    transaction.objectStore("events").put(Date.now(), eventId);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

async function cacheShell() {
  const responses = await Promise.all(
    SHELL.map(url => fetch(url, { cache: "reload" })),
  );
  if (responses.some(response => !response.ok)) {
    throw Error("incomplete shell generation");
  }

  const cache = await caches.open(SHELL_CACHE);
  try {
    await Promise.all(
      SHELL.map((url, index) => cache.put(url, responses[index])),
    );
  } catch (error) {
    await caches.delete(SHELL_CACHE);
    throw error;
  }
  // Deliberately no skipWaiting: older pages keep their worker generation.
}

async function activateShell(event) {
  const clients = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  if (clients.length > 1) {
    event.source?.postMessage({
      type: "update-refused-multiple-clients",
    });
    return;
  }
  await self.skipWaiting();
}

async function removeOldShellsAndClaimClients() {
  for (const name of await caches.keys()) {
    if (name.startsWith("pidex-shell-") && name !== SHELL_CACHE) {
      await caches.delete(name);
    }
  }
  await self.clients.claim();
}

async function shellResponse(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cachedResponse = await cache.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }
  if (request.mode === "navigate") {
    return cache.match("/index.html");
  }
  return fetch(request);
}
