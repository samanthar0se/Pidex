import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface ViteManifestEntry {
  file: string;
  css?: string[];
}

export interface ClientAsset {
  file: string;
  contentType: string;
  cacheControl?: string;
}

export type ClientAssetResolver = (method: string | undefined, url: string | undefined) => ClientAsset | undefined;

export function createClientAssetResolver(clientDist: string): ClientAssetResolver {
  const assets = fixedAssets(clientDist);
  let buildAssets = readBuildAssets(clientDist);

  return (method, rawUrl) => {
    const pathname = new URL(rawUrl ?? "/", "http://pidex.invalid").pathname;
    const asset = assets[pathname];
    if (asset) return asset;
    if (pathname.startsWith("/assets/")) {
      try {
        buildAssets = readBuildAssets(clientDist);
      } catch {}
      return buildAssets[pathname];
    }
    if (method === "GET" && pathname.startsWith("/sessions/")) return assets["/"];
    return undefined;
  };
}

function readBuildAssets(clientDist: string): Record<string, ClientAsset> {
  const manifest = JSON.parse(
    readFileSync(resolve(clientDist, ".vite/manifest.json"), "utf8"),
  ) as Record<string, ViteManifestEntry>;
  const entry = manifest["index.html"];
  if (!entry) throw new Error("production Client manifest has no index entry");
  return {
    [`/${entry.file}`]: {
      file: `${clientDist}/${entry.file}`,
      contentType: "text/javascript",
      cacheControl: "public, max-age=31536000, immutable",
    },
    ...Object.fromEntries((entry.css ?? []).map(file => [`/${file}`, {
      file: `${clientDist}/${file}`,
      contentType: "text/css",
      cacheControl: "public, max-age=31536000, immutable",
    }])),
  };
}

function fixedAssets(clientDist: string): Record<string, ClientAsset> {
  return {
    "/": {
      file: `${clientDist}/index.html`,
      contentType: "text/html",
      cacheControl: "no-cache",
    },
    "/index.html": {
      file: `${clientDist}/index.html`,
      contentType: "text/html",
      cacheControl: "no-cache",
    },
    "/service-worker.js": {
      file: `${clientDist}/service-worker.js`,
      contentType: "text/javascript",
      cacheControl: "no-cache",
    },
    "/manifest.webmanifest": {
      file: `${clientDist}/manifest.webmanifest`,
      contentType: "application/manifest+json",
      cacheControl: "no-cache",
    },
    "/favicon.svg": {
      file: `${clientDist}/favicon.svg`,
      contentType: "image/svg+xml",
      cacheControl: "public, max-age=86400",
    },
    "/icons/pidex-app-icon-white.png": {
      file: "icon/pidex-app-icon-white.png",
      contentType: "image/png",
      cacheControl: "public, max-age=86400",
    },
    "/icons/pidex-app-icon-white.svg": {
      file: "icon/pidex-app-icon-white.svg",
      contentType: "image/svg+xml",
      cacheControl: "public, max-age=86400",
    },
    "/icons/pidex-gradient.svg": {
      file: "icon/pidex-gradient.svg",
      contentType: "image/svg+xml",
      cacheControl: "public, max-age=86400",
    },
  };
}
