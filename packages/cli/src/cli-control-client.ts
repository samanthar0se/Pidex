import { randomUUID } from "node:crypto";
import { z } from "zod";
import { invocationSchema, operationReceiptSchema, sourceUpdateActivationSchema } from "../../local-control/src/index.js";
import { projectStatus, type LocalStatus, type StatusProjection } from "./status-projection.js";

type Receipt = z.output<typeof operationReceiptSchema>;
type Invocation = z.output<typeof invocationSchema>;

export interface LocalControlTransport {
  request(method: string, payload: unknown): Promise<unknown>;
}

export class CliControlClient {
  constructor(
    private readonly transport: LocalControlTransport,
    private readonly createInvocationId: () => string = randomUUID,
  ) {}

  async status(): Promise<StatusProjection> {
    return projectStatus(await this.transport.request("status", null) as LocalStatus);
  }

  /** A transport failure is ambiguous: reconcile the same invocation, never resubmit it. */
  async invoke(input: Omit<Invocation, "invocationId">): Promise<Receipt> {
    const invocation = invocationSchema.parse({ ...input, invocationId: this.createInvocationId() });
    return this.requestOperation("operation.invoke", invocation);
  }

  /** The source driver has already published bytes; the launcher receives no mutable path. */
  async activateSourceUpdate(input: Omit<z.input<typeof sourceUpdateActivationSchema>, "invocationId">): Promise<Receipt> {
    const request = sourceUpdateActivationSchema.parse({ ...input, invocationId: this.createInvocationId() });
    return this.requestOperation("source-update.activate", request);
  }

  private async requestOperation(method: string, request: { invocationId: string }): Promise<Receipt> {
    try {
      return operationReceiptSchema.parse(await this.transport.request(method, request));
    } catch (deliveryError) {
      try {
        return operationReceiptSchema.parse(await this.transport.request(
          "operation.lookup-invocation",
          { invocationId: request.invocationId },
        ));
      } catch {
        throw deliveryError;
      }
    }
  }

  async follow(operationId: string, afterSequence = -1): Promise<{ receipt: Receipt; progress: unknown[] }> {
    const result = await this.transport.request("operation.follow", { operationId, afterSequence }) as { receipt: unknown; progress: unknown[] };
    return { receipt: operationReceiptSchema.parse(result.receipt), progress: result.progress };
  }

  async run(
    input: Omit<Invocation, "invocationId">,
    options: { detach?: boolean; signal?: AbortSignal } = {},
  ): Promise<{ receipt: Receipt; detached: boolean; progress: unknown[] }> {
    const accepted = await this.invoke(input);
    if (options.detach || options.signal?.aborted) {
      return { receipt: accepted, detached: true, progress: [] };
    }
    try {
      const followed = await this.follow(accepted.operationId);
      return { ...followed, detached: false };
    } catch (error) {
      // Disconnect and Ctrl+C never imply cancellation or a second invocation.
      if (options.signal?.aborted) return { receipt: accepted, detached: true, progress: [] };
      throw error;
    }
  }

  async cancel(operationId: string, expectedPhase: string): Promise<Receipt> {
    return operationReceiptSchema.parse(await this.transport.request("operation.cancel", { operationId, expectedPhase }));
  }
}
