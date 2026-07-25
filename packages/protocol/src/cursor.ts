/**
 * Synchronization cursors carry the Host identity, the synchronization epoch,
 * and the monotonic sequence of the durable change they name. The Client reads
 * the sequence to order derived facts — notably the Session attention summary,
 * which advances no sequence of its own but is a pure function of the durable
 * state one identifies.
 *
 * Encoding stays isomorphic so the Host and the Client share one definition
 * rather than drifting between a Node and a browser copy.
 */

const CURSOR_PREFIX = "sync_";

export interface DecodedCursor {
  hostId: string;
  epoch: string;
  sequence: number;
}

export function encodeCursor(hostId: string, epoch: string, sequence: number): string {
  const json = JSON.stringify({ hostId, epoch, sequence });
  return `${CURSOR_PREFIX}${btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

export function decodeCursor(cursor: string): DecodedCursor | undefined {
  if (!cursor.startsWith(CURSOR_PREFIX)) return undefined;

  try {
    const base64url = cursor.slice(CURSOR_PREFIX.length);
    const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
    const value: unknown = JSON.parse(atob(base64));
    if (!value || typeof value !== "object") return undefined;

    const record = value as Record<string, unknown>;
    const sequence = record.sequence;
    if (
      typeof record.hostId !== "string" ||
      typeof record.epoch !== "string" ||
      typeof sequence !== "number" ||
      !Number.isSafeInteger(sequence) ||
      sequence < 1
    ) {
      return undefined;
    }

    return { hostId: record.hostId, epoch: record.epoch, sequence };
  } catch {
    return undefined;
  }
}

/**
 * Orders two cursors when they share an epoch. A differing epoch means the
 * sequences are incomparable, so ordering is refused and the caller falls back
 * to accepting the fact — a scope reset resolves the epoch shortly after.
 */
export function cursorPrecedes(candidate: string, basis: string): boolean {
  const left = decodeCursor(candidate);
  const right = decodeCursor(basis);
  if (!left || !right || left.epoch !== right.epoch || left.hostId !== right.hostId) return false;
  return left.sequence < right.sequence;
}
