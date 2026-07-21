import type { ClientAdapters } from "./client-store.js";

export const routingAdapter: ClientAdapters["routing"] = {
  replace(path) {
    history.replaceState({}, "", path);
  },
};
