import { useEffect } from "react";
import type { ClientStore } from "./client-store.js";

function applyPath(store: ClientStore, path: string) {
  if (path === "/new") {
    void store.getState().openNewSession();
    return;
  }
  if (path === "/archived") store.setState({ discoveryMode: "archived" });
  const match = path.match(/^\/sessions\/([^/]+)$/);
  if (match) void store.getState().openSession(decodeURIComponent(match[1]), "none");
}

export function useClientLifecycle(store: ClientStore) {
  useEffect(() => {
    void store.getState().loadDiscovery();
    applyPath(store, location.pathname);
    return store.getState().watchDiscovery();
  }, [store]);

  useEffect(() => {
    const applyCurrentPath = () => applyPath(store, location.pathname);
    addEventListener("popstate", applyCurrentPath);
    return () => removeEventListener("popstate", applyCurrentPath);
  }, [store]);

  useEffect(() => {
    const markOffline = () => store.getState().authorityChanged({ status: "offline" });
    const recoverAuthority = () => void store.getState().recoverAuthority();
    const recoverWhenVisible = () => {
      if (document.visibilityState === "visible") recoverAuthority();
    };

    addEventListener("offline", markOffline);
    addEventListener("online", recoverAuthority);
    document.addEventListener("visibilitychange", recoverWhenVisible);
    if (!navigator.onLine) markOffline();

    return () => {
      removeEventListener("offline", markOffline);
      removeEventListener("online", recoverAuthority);
      document.removeEventListener("visibilitychange", recoverWhenVisible);
    };
  }, [store]);
}
