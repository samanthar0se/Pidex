import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import {
  cancellationSchema,
  invocationSchema,
  operationReceiptSchema,
  progressSchema,
} from "../../local-control/src/index.js";
import { canonicalJson } from "../../local-control/src/canonical-json.js";

type Invocation = z.output<typeof invocationSchema>;
export type OperationReceipt = z.output<typeof operationReceiptSchema>;
export type PolicyOwner = Invocation["policyOwner"];
export type OperationRoutes = Readonly<
  Record<
    PolicyOwner,
    (invocation: Invocation, receipt: OperationReceipt) => Promise<void> | void
  >
>;

const acceptanceSchema = z.strictObject({
  kind: z.literal("accepted"),
  invocation: invocationSchema,
  receipt: operationReceiptSchema,
});
const receiptUpdateSchema = z.strictObject({
  kind: z.literal("receipt"),
  receipt: operationReceiptSchema,
});
const progressRecordSchema = z.strictObject({
  kind: z.literal("progress"),
  progress: progressSchema,
});
const journalRecordSchema = z.discriminatedUnion("kind", [
  acceptanceSchema,
  receiptUpdateSchema,
  progressRecordSchema,
]);
type OperationProgress = z.output<typeof progressSchema>;

/** Durable invocation ledger at the launcher/policy-owner routing boundary. */
export class DurableOperationRouter {
  readonly #byInvocation = new Map<
    string,
    { invocation: Invocation; receipt: OperationReceipt }
  >();
  readonly #byOperation = new Map<string, OperationReceipt>();
  readonly #progress = new Map<string, OperationProgress[]>();

  constructor(readonly journalPath: string) {
    if (!existsSync(journalPath)) return;
    const lines = readFileSync(journalPath, "utf8").split("\n").filter(Boolean);
    for (const line of lines) {
      const record = journalRecordSchema.parse(JSON.parse(line));
      if (record.kind === "accepted") {
        this.#byInvocation.set(record.invocation.invocationId, record);
        this.#byOperation.set(record.receipt.operationId, record.receipt);
      } else if (record.kind === "receipt") {
        this.#byOperation.set(record.receipt.operationId, record.receipt);
      } else {
        const history = this.#progress.get(record.progress.operationId) ?? [];
        history.push(record.progress);
        this.#progress.set(record.progress.operationId, history);
      }
    }
  }

  accept(
    invocationInput: z.input<typeof invocationSchema>,
    initial: { phase: string; cancellable: boolean },
  ): OperationReceipt {
    const invocation = invocationSchema.parse(invocationInput);
    const prior = this.#byInvocation.get(invocation.invocationId);
    if (prior) {
      if (canonicalJson(prior.invocation) !== canonicalJson(invocation)) {
        throw new Error("invocation-id-conflict");
      }
      return this.requireOperation(prior.receipt.operationId);
    }

    const receipt = operationReceiptSchema.parse({
      invocationId: invocation.invocationId,
      operationId: randomUUID(),
      phase: initial.phase,
      state: "accepted",
      cancellable: initial.cancellable,
    });
    const record = acceptanceSchema.parse({
      kind: "accepted",
      invocation,
      receipt,
    });
    appendDurably(this.journalPath, `${canonicalJson(record)}\n`);
    this.#byInvocation.set(invocation.invocationId, record);
    this.#byOperation.set(receipt.operationId, receipt);
    return receipt;
  }

  /** Accepts durably, then dispatches independently of the calling CLI connection. */
  route(
    invocationInput: z.input<typeof invocationSchema>,
    initial: { phase: string; cancellable: boolean },
    routes: OperationRoutes,
  ): OperationReceipt {
    const invocation = invocationSchema.parse(invocationInput);
    const alreadyAccepted = this.#byInvocation.has(invocation.invocationId);
    const receipt = this.accept(invocation, initial);
    if (!alreadyAccepted) {
      void Promise.resolve()
        .then(() => routes[invocation.policyOwner](invocation, receipt))
        .catch(() => {
          const current = this.requireOperation(receipt.operationId);
          if (!isTerminal(current.state)) {
            this.update({ ...current, state: "failed", cancellable: false });
          }
        });
    }
    return receipt;
  }

  lookup(operationId: string): OperationReceipt | undefined {
    return this.#byOperation.get(operationId);
  }

  progress(input: z.input<typeof progressSchema>): OperationProgress {
    const progress = progressSchema.parse(input);
    const receipt = this.requireOperation(progress.operationId);
    if (isTerminal(receipt.state)) throw new Error("operation-terminal");
    if (progress.phase !== receipt.phase) throw new Error("operation-phase-conflict");
    const history = this.#progress.get(progress.operationId) ?? [];
    if (progress.sequence !== history.length) throw new Error("progress-sequence-conflict");
    appendDurably(
      this.journalPath,
      `${canonicalJson(progressRecordSchema.parse({ kind: "progress", progress }))}\n`,
    );
    history.push(progress);
    this.#progress.set(progress.operationId, history);
    return progress;
  }

  cancel(input: z.input<typeof cancellationSchema>): OperationReceipt {
    const cancellation = cancellationSchema.parse(input);
    const receipt = this.requireOperation(cancellation.operationId);
    if (!receipt.cancellable) throw new Error("operation-not-cancellable");
    if (receipt.phase !== cancellation.expectedPhase) {
      throw new Error("operation-phase-conflict");
    }
    return this.update({ ...receipt, state: "cancelled", cancellable: false });
  }

  follow(operationId: string, afterSequence = -1): {
    receipt: OperationReceipt;
    progress: OperationProgress[];
  } {
    return {
      receipt: this.requireOperation(operationId),
      progress: (this.#progress.get(operationId) ?? []).filter(
        event => event.sequence > afterSequence,
      ),
    };
  }

  update(input: z.input<typeof operationReceiptSchema>): OperationReceipt {
    const receipt = operationReceiptSchema.parse(input);
    const current = this.requireOperation(receipt.operationId);
    if (current.invocationId !== receipt.invocationId || isTerminal(current.state)) {
      throw new Error("operation-state-conflict");
    }
    const record = receiptUpdateSchema.parse({ kind: "receipt", receipt });
    appendDurably(this.journalPath, `${canonicalJson(record)}\n`);
    this.#byOperation.set(receipt.operationId, receipt);
    return receipt;
  }

  private requireOperation(operationId: string): OperationReceipt {
    const receipt = this.#byOperation.get(operationId);
    if (!receipt) throw new Error("operation-not-found");
    return receipt;
  }
}

function isTerminal(state: OperationReceipt["state"]): boolean {
  return state === "succeeded" || state === "failed" || state === "cancelled";
}

function appendDurably(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const descriptor = openSync(path, "a", 0o600);
  try {
    writeSync(descriptor, text);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}
