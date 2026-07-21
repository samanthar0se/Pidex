import { randomBytes } from "node:crypto";
import { z } from "zod";
import { canonicalJson } from "./canonical-json.js";
import {
  identifierSchema,
  protocolSchema,
} from "./contract-schemas.js";

const childIdentitySchema = z.strictObject({
  processId: z.number().int().positive(),
  role: z.enum(["daemon", "maintenance"]),
  instanceId: identifierSchema,
  releaseId: identifierSchema,
  configId: identifierSchema,
  protocol: protocolSchema,
});
export type ChildBootstrapIdentity = z.infer<typeof childIdentitySchema>;

/** One failed or successful presentation consumes the inherited child nonce. */
export class OneUseChildBootstrap {
  readonly #pending = new Map<string, ChildBootstrapIdentity>();

  issue(identity: ChildBootstrapIdentity): Buffer {
    const parsed = childIdentitySchema.parse(identity);
    const nonce = randomBytes(32);
    this.#pending.set(nonce.toString("hex"), parsed);
    return nonce;
  }

  authenticate<T>(
    nonce: Uint8Array,
    identity: ChildBootstrapIdentity,
    route: () => T,
  ): T {
    const key = Buffer.from(nonce).toString("hex");
    const expected = this.#pending.get(key);
    this.#pending.delete(key);
    const parsed = childIdentitySchema.safeParse(identity);
    if (
      !expected ||
      !parsed.success ||
      canonicalJson(expected) !== canonicalJson(parsed.data)
    ) {
      throw new Error("child bootstrap rejected");
    }
    return route();
  }
}
