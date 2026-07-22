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
  // The complete generation can activate; each Client settles its own environment writes on controllerchange.
  await self.skipWaiting();
})()));
self.addEventListener("activate", event => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith("pidex-shell-") && key !== SHELL_CACHE) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  const path = new URL(event.request.url).pathname;
  const isShellOrStatic = event.request.mode === "navigate" || path === "/" || path === "/index.html"
    || path === "/manifest.webmanifest" || path.startsWith("/assets/");
  if (!isShellOrStatic) { event.respondWith(fetch(event.request, { cache: "no-store" })); return; }
  event.respondWith((async () => {
    const shellCache = await caches.open(SHELL_CACHE);
    return (await shellCache.match(event.request))
      || (event.request.mode === "navigate" ? await shellCache.match("/") : fetch(event.request));
  })());
});
