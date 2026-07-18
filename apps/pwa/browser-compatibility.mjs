/** Blocking release matrix. Each mode is run on the current and previous release. */
export const REQUIRED_BROWSER_MATRIX = Object.freeze([
  { mode: "windows-edge", releases: ["current", "previous"], standalone: false, exampleUserAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36 Edg/126.0" },
  { mode: "windows-chrome", releases: ["current", "previous"], standalone: false, exampleUserAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36" },
  { mode: "android-chrome", releases: ["current", "previous"], standalone: false, exampleUserAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36" },
  { mode: "ios-safari", releases: ["current", "previous"], standalone: false, exampleUserAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1" },
  { mode: "ios-standalone", releases: ["current", "previous"], standalone: true, exampleUserAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1" },
  { mode: "ipados-safari", releases: ["current", "previous"], standalone: false, exampleUserAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1" },
  { mode: "ipados-standalone", releases: ["current", "previous"], standalone: true, exampleUserAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1" },
]);

export function assessBrowser(userAgent, semantics, standalone) {
  const missing = Object.entries(semantics).find(([, present]) => !present);
  if (missing) return { supported: false, reason: `missing-required-semantics:${missing[0]}` };

  const windows = /Windows NT/.test(userAgent);
  const android = /Android/.test(userAgent);
  const appleMobile = /(iPhone|iPad|Mobile\/)/.test(userAgent) && /AppleWebKit/.test(userAgent);
  const supported =
    (windows && (/Edg\//.test(userAgent) || (/Chrome\//.test(userAgent) && !/Edg\//.test(userAgent)))) ||
    (android && /Chrome\//.test(userAgent)) ||
    (appleMobile && !/(CriOS|FxiOS|EdgiOS)\//.test(userAgent) && (standalone || /Safari\//.test(userAgent)));
  return supported
    ? { supported: true, reason: "supported" }
    : { supported: false, reason: "unsupported-browser" };
}

export function browserSemantics(scope = globalThis) {
  return {
    secureContext: scope.isSecureContext === true,
    webSocket: "WebSocket" in scope,
    indexedDb: "indexedDB" in scope,
    serviceWorker: Boolean(scope.navigator?.serviceWorker),
    subtleCrypto: Boolean(scope.crypto?.subtle),
    randomUuid: typeof scope.crypto?.randomUUID === "function",
  };
}
