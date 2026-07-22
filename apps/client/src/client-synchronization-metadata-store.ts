import {
  assertContinuityGeneration,
  type EnvironmentOperations,
} from "./client-environment-state.js";

export class ClientSynchronizationMetadataStore {
  constructor(private readonly environment: EnvironmentOperations) {}

  async write(key: string, value: unknown, generation: number) {
    await this.environment.transact(state => {
      assertContinuityGeneration(state, generation);
      state.synchronizationMetadata[key] = structuredClone(value);
    });
  }
}
