import { createClientStore } from "./client-store.js";
import { productionAdapters } from "./adapters.js";

export const store = createClientStore(productionAdapters);
