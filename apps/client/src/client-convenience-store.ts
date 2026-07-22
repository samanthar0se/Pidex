import {
  assertContinuityGeneration,
  type EnvironmentOperations,
} from "./client-environment-state.js";

type ConvenienceArea = "preferences" | "caches";

export class ClientConvenienceStore {
  constructor(private readonly environment: EnvironmentOperations) {}

  read<T>(area: ConvenienceArea, key: string) {
    return this.environment.inspect(state => state[area][key] as T | undefined);
  }

  async write(area: ConvenienceArea, key: string, value: unknown, generation: number) {
    await this.environment.transact(state => {
      assertContinuityGeneration(state, generation);
      state[area][key] = structuredClone(value);
    });
  }
}
