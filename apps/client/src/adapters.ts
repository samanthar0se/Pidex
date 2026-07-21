import type { ClientAdapters } from "./client-store.js";
import { draftAdapter } from "./draft-adapter.js";
import { hostSessionAdapter } from "./host-session-adapter.js";
import { routingAdapter } from "./routing-adapter.js";
import { preferenceAdapter } from "./preference-adapter.js";

export const productionAdapters: ClientAdapters = {
  host: hostSessionAdapter,
  drafts: draftAdapter,
  preferences: preferenceAdapter,
  routing: routingAdapter,
};
