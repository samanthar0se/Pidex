import type { ClientAdapters } from "./client-store.js";
import { clientEnvironment } from "./environment-instance.js";

const key = "expanded-projects";
export const preferenceAdapter: NonNullable<ClientAdapters["preferences"]> = {
  async readExpandedProjects() {
    return await clientEnvironment.readPreference<string[]>(key) ?? [];
  },
  async writeExpandedProjects(projectIds) {
    await clientEnvironment.writePreference(key, projectIds, await clientEnvironment.continuityGeneration());
  },
};
