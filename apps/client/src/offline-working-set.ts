export interface WorkingSetBasis {
  origin: string;
  hostId: string;
  cacheSchema: number;
  protocol: string;
  synchronizationEpoch: string;
  cursor?: string;
  resourceRevisions?: Readonly<Record<string, number>>;
}

export interface WorkingSetRecord<Facts, Drafts> {
  basis: WorkingSetBasis;
  lastSynchronizedAt: string;
  facts: Facts;
  drafts: Drafts;
}

export function workingSetKey(basis: WorkingSetBasis): string {
  return [basis.origin, basis.hostId, basis.cacheSchema, basis.protocol, basis.synchronizationEpoch]
    .map(encodeURIComponent).join("|");
}

export class IndexedDbWorkingSetStorage<Facts, Drafts> {
  async read(basis: WorkingSetBasis): Promise<WorkingSetRecord<Facts, Drafts> | undefined> {
    return this.perform("readonly", store => store.get(workingSetKey(basis)));
  }

  async writeAfterBarrier(record: WorkingSetRecord<Facts, Drafts>): Promise<void> {
    await this.perform("readwrite", store => store.put(record, workingSetKey(record.basis)));
  }

  private async perform<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("pidex-client-working-sets", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("working-sets");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return new Promise<T>((resolve, reject) => {
      const request = operation(database.transaction("working-sets", mode).objectStore("working-sets"));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
}

export class OfflineWorkingSet<Facts, Drafts> {
  constructor(private record: WorkingSetRecord<Facts, Drafts>) {}

  offline(reached: WorkingSetBasis) {
    if (!sameBasis(this.record.basis, reached)) return undefined;
    return {
      availability: "stale" as const,
      completeness: "incomplete" as const,
      mutability: "read-only" as const,
      lastSynchronizedAt: this.record.lastSynchronizedAt,
      facts: this.record.facts,
      drafts: this.record.drafts,
    };
  }

  reach(reached: WorkingSetBasis) {
    const previous = this.record.basis;
    if (previous.origin === reached.origin && previous.hostId !== reached.hostId) {
      return {
        kind: "different-host" as const,
        facts: undefined,
        quarantinedDrafts: this.record.drafts,
        commandsEnabled: false as const,
      };
    }
    if (!sameBasis(previous, reached)) {
      return {
        kind: "continuity-reset" as const,
        facts: undefined,
        drafts: this.record.drafts,
        commandsEnabled: false as const,
      };
    }
    return { kind: "matching" as const, commandsEnabled: false as const };
  }

  commitAfterBarrier(basis: WorkingSetBasis, facts: Facts, lastSynchronizedAt: string) {
    this.record = { basis, facts, drafts: this.record.drafts, lastSynchronizedAt };
    return { commandsEnabled: true as const };
  }
}

function sameBasis(left: WorkingSetBasis, right: WorkingSetBasis): boolean {
  return left.origin === right.origin
    && left.hostId === right.hostId
    && left.cacheSchema === right.cacheSchema
    && left.protocol === right.protocol
    && left.synchronizationEpoch === right.synchronizationEpoch
    && (left.cursor === undefined || right.cursor === undefined || left.cursor === right.cursor)
    && revisionsMatch(left.resourceRevisions, right.resourceRevisions);
}

function revisionsMatch(left?: Readonly<Record<string, number>>, right?: Readonly<Record<string, number>>): boolean {
  if (!left || !right) return true;
  return JSON.stringify(Object.entries(left).sort()) === JSON.stringify(Object.entries(right).sort());
}
