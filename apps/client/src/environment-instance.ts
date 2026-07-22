import { ClientEnvironment, IndexedDbClientEnvironmentStorage } from "./client-environment.js";

export const clientEnvironment = new ClientEnvironment(new IndexedDbClientEnvironmentStorage());
