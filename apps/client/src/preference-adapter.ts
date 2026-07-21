import type { ClientAdapters } from "./client-store.js";

const key = "pidex:expanded-projects";
export const preferenceAdapter: NonNullable<ClientAdapters["preferences"]> = {
  async readExpandedProjects() {
    try { return JSON.parse(localStorage.getItem(key) ?? "[]") as string[]; }
    catch { return []; }
  },
  async writeExpandedProjects(projectIds) { localStorage.setItem(key, JSON.stringify(projectIds)); },
};
