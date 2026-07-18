export interface BrowserSemantics {
  secureContext: boolean;
  webSocket: boolean;
  indexedDb: boolean;
  serviceWorker: boolean;
  subtleCrypto: boolean;
  randomUuid: boolean;
}

export const REQUIRED_BROWSER_MATRIX: readonly {
  mode: string;
  releases: readonly string[];
  standalone: boolean;
  exampleUserAgent: string;
}[];

export function assessBrowser(
  userAgent: string,
  semantics: BrowserSemantics,
  standalone: boolean,
): { supported: boolean; reason: string };

export function browserSemantics(scope?: typeof globalThis): BrowserSemantics;
