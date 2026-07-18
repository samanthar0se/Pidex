export interface BrowserSemantics {
  secureContext: boolean;
  webSocket: boolean;
  indexedDb: boolean;
  serviceWorker: boolean;
  subtleCrypto: boolean;
  randomUuid: boolean;
}

export type BrowserMode =
  | "windows-edge"
  | "windows-chrome"
  | "android-chrome"
  | "ios-safari"
  | "ios-standalone"
  | "ipados-safari"
  | "ipados-standalone";

export interface RequiredBrowserMatrixEntry {
  mode: BrowserMode;
  releases: readonly string[];
  standalone: boolean;
  exampleUserAgent: string;
}

export type BrowserAssessment =
  | { supported: true; reason: "supported" }
  | {
    supported: false;
    reason:
      | "unsupported-browser"
      | `missing-required-semantics:${string}`;
  };

export const REQUIRED_BROWSER_MATRIX: readonly RequiredBrowserMatrixEntry[];

export function assessBrowser(
  userAgent: string,
  semantics: BrowserSemantics,
  isStandalone: boolean,
): BrowserAssessment;

export function browserSemantics(scope?: typeof globalThis): BrowserSemantics;
