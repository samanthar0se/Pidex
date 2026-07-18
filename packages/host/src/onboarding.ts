import { createServer } from "node:http";

export interface OnboardingOptions {
  caCertificate: Buffer;
  canonicalOrigin: string;
  expiresInMs?: number;
}

/** A deliberately data-free, loopback-only CA bootstrap action. */
export async function startOnboarding(options: OnboardingOptions) {
  const server = createServer((request, response) => {
    if (request.method !== "GET") {
      response.writeHead(405, { allow: "GET" }).end();
    } else if (request.url === "/pidex-ca.pem") {
      response.writeHead(200, { "content-type": "application/x-pem-file", "cache-control": "no-store" });
      response.end(options.caCertificate);
    } else if (request.url === "/") {
      response.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
      response.end(`Install the Pidex private CA, then open ${options.canonicalOrigin}\nNo credentials are accepted here.\n`);
    } else response.writeHead(404).end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Onboarding did not bind TCP");
  const timer = setTimeout(() => server.close(), options.expiresInMs ?? 5 * 60_000);
  timer.unref();
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: async () => { clearTimeout(timer); await new Promise<void>(resolve => server.close(() => resolve())); },
  };
}
