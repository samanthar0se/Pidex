const SHELL_GENERATION = "pidex-client-v1";
const SHELL_CACHE = `pidex-shell-${SHELL_GENERATION}`;
self.addEventListener("install", event => event.waitUntil((async () => {
  const shell = await fetch("/", { cache: "reload" });
  const markup = await shell.clone().text();
  const generatedAssets = [...markup.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(match => match[1]);
  const urls = ["/", "/index.html", "/manifest.webmanifest", ...generatedAssets];
  const responses = await Promise.all(urls.map(url => url === "/" ? shell : fetch(url, { cache: "reload" })));
  if (responses.some(response => !response.ok)) throw Error("incomplete shell generation");
  const cache = await caches.open(SHELL_CACHE);
  try { await Promise.all(responses.map((response, index) => cache.put(urls[index], response))); }
  catch (error) { await caches.delete(SHELL_CACHE); throw error; }
  // Deliberately no skipWaiting: activation requires an explicit saved-draft reload.
})()));
self.addEventListener("message", event => event.waitUntil((async () => {
  if (event.data?.type !== "activate-shell" || !event.data?.draftsSaved) return;
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  if (clients.length > 1) { event.source?.postMessage({ type: "update-refused-multiple-clients" }); return; }
  await self.skipWaiting();
})()));
self.addEventListener("activate", event => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith("pidex-shell-") && key !== SHELL_CACHE) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith((async () => (await caches.match(event.request)) || (event.request.mode === "navigate" ? await caches.match("/") : fetch(event.request)))());
});
