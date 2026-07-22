import type { ClientAdapters } from "./client-store.js";
import { draftAdapter } from "./draft-adapter.js";
import { hostSessionAdapter } from "./host-session-adapter.js";
import { routingAdapter } from "./routing-adapter.js";
import { preferenceAdapter } from "./preference-adapter.js";
import { journalHostAdapter } from "./journaled-host-adapter.js";

export const productionAdapters: ClientAdapters = {
  host: journalHostAdapter(hostSessionAdapter),
  drafts: draftAdapter,
  preferences: preferenceAdapter,
  routing: routingAdapter,
};
