import type { ClientAdapters } from "./client-store.js";
import { clientEnvironment } from "./environment-instance.js";

const observed = new Map<string, { revision: number; generation: number }>();

export const draftAdapter: ClientAdapters["drafts"] = {
  async read(sessionId) {
    const draft = await clientEnvironment.readDraft(sessionId);
    observed.set(sessionId, draft);
    return draft.text;
  },
  async write(sessionId, value) {
    const basis = observed.get(sessionId) ?? await clientEnvironment.readDraft(sessionId);
    const result = await clientEnvironment.saveDraft(sessionId, value, basis.revision, basis.generation);
    if (result.kind === "saved") observed.set(sessionId, { revision: result.revision, generation: basis.generation });
  },
};
