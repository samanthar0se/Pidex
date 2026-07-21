import type { ClientAdapters } from "./client-store.js";

export const routingAdapter: ClientAdapters["routing"] = {
  push(path) {
    history.pushState({}, "", path);
  },
  replace(path) {
    history.replaceState({}, "", path);
  },
  subscribe(listener) {
    const handle = () => listener(location.pathname);
    addEventListener("popstate", handle);
    return () => removeEventListener("popstate", handle);
  },
};
