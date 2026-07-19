export type PublicationProtocolId =
  | "immutable-file"
  | "authority-generation"
  | "rebuildable-selector"
  | "sqlite-acknowledgment";

export interface RecoveryInvariant {
  name: string;
  passed: boolean;
}

export interface PersistenceImage {
  name: string;
  disk: string;
  recovery: string;
  allowed: boolean;
  invariants: readonly RecoveryInvariant[];
}

export interface CutPoint {
  name: string;
  acknowledged: boolean;
  images: readonly PersistenceImage[];
}

export interface PublicationProtocol {
  id: PublicationProtocolId;
  name: string;
  promise: string;
  cutPoints: readonly CutPoint[];
}

const passingInvariants = (): readonly RecoveryInvariant[] => [
  { name: "one selected authority", passed: true },
  { name: "complete reference closure", passed: true },
  { name: "no uncertain replay", passed: true },
  { name: "acknowledged outcome retained", passed: true },
];

const allowed = (
  name: string,
  disk: string,
  recovery: string,
): PersistenceImage => ({
  name,
  disk,
  recovery,
  allowed: true,
  invariants: passingInvariants(),
});

const violation = (
  name: string,
  disk: string,
  recovery: string,
  failedInvariant: string,
): PersistenceImage => ({
  name,
  disk,
  recovery,
  allowed: false,
  invariants: passingInvariants().map(invariant =>
    invariant.name === failedInvariant
      ? { ...invariant, passed: false }
      : invariant,
  ),
});

export const PUBLICATION_PROTOCOLS: readonly PublicationProtocol[] = [
  {
    id: "immutable-file",
    name: "Immutable file + authority reference",
    promise:
      "A referencing transaction never becomes recoverable without its validated digest object.",
    cutPoints: [
      {
        name: "candidate materialization started",
        acknowledged: false,
        images: [
          allowed(
            "stage absent",
            "Only the previous authority and objects remain.",
            "Discard the interrupted operation.",
          ),
          allowed(
            "partial stage",
            "An incomplete sibling stage remains unreferenced.",
            "Ignore the stage and preserve it only if diagnostically useful.",
          ),
        ],
      },
      {
        name: "candidate files flushed",
        acknowledged: false,
        images: [
          allowed(
            "durable stage",
            "A complete validated sibling stage exists without an authority reference.",
            "Treat it as retry input or an unreachable stage; keep current authority.",
          ),
        ],
      },
      {
        name: "same-parent publication returned",
        acknowledged: false,
        images: [
          allowed(
            "target visible",
            "The digest target is complete but unreferenced.",
            "Keep current authority; the object is a harmless orphan.",
          ),
          allowed(
            "stage name visible",
            "The complete bytes survived under the stage name.",
            "Keep current authority; a retry may republish after validation.",
          ),
          allowed(
            "namespace entry absent",
            "Neither target nor stage is visible after NTFS recovery.",
            "Keep current authority because no transaction references the object.",
          ),
        ],
      },
      {
        name: "referencing SQLite commit flushed and acknowledged",
        acknowledged: true,
        images: [
          allowed(
            "object and reference survive",
            "The digest target and committed SQLite reference are both valid.",
            "Open the acknowledged authority normally.",
          ),
          violation(
            "reference survives, object missing",
            "SQLite references a digest target absent after reboot.",
            "Startup fails closed and advisory evidence records a durable-acknowledgment violation.",
            "complete reference closure",
          ),
        ],
      },
    ],
  },
  {
    id: "authority-generation",
    name: "Authority-generation activation",
    promise:
      "Startup selects the valid highest Activation index or creates a continuity-rotating fallback from a valid predecessor.",
    cutPoints: [
      {
        name: "candidate tree materializing",
        acknowledged: false,
        images: [
          allowed(
            "partial stage",
            "The selected predecessor is intact beside an ineligible stage.",
            "Ignore the stage and select the predecessor.",
          ),
        ],
      },
      {
        name: "candidate tree flushed, before publication",
        acknowledged: false,
        images: [
          allowed(
            "complete stage",
            "The candidate is valid but not discoverable as a sealed generation.",
            "Select the predecessor; retry may validate and republish the stage.",
          ),
        ],
      },
      {
        name: "sealed generation published, before selector",
        acknowledged: false,
        images: [
          allowed(
            "candidate discoverable",
            "A valid higher Activation index exists while the selector is stale.",
            "Select the candidate by enumeration and repair the selector.",
          ),
          allowed(
            "candidate unavailable",
            "Only the independently valid predecessor is discoverable.",
            "Select the predecessor; do not infer activation from the stale selector.",
          ),
        ],
      },
      {
        name: "startup-equivalent resolver selected candidate and acknowledged",
        acknowledged: true,
        images: [
          allowed(
            "candidate survives",
            "The acknowledged generation has the unique highest valid Activation index.",
            "Select it and repair the selector if needed.",
          ),
          allowed(
            "candidate damaged after acknowledgment",
            "The candidate is invalid but an independently valid predecessor survives.",
            "Copy the predecessor into a fresh higher index, rotate continuity, warn, and preserve evidence.",
          ),
          violation(
            "no valid generation",
            "Neither the candidate nor a retained predecessor validates.",
            "Startup fails closed and advisory evidence records a retention or storage violation.",
            "one selected authority",
          ),
        ],
      },
    ],
  },
  {
    id: "rebuildable-selector",
    name: "Rebuildable selector replacement",
    promise:
      "Selector bytes never decide authority; retained validated generations do.",
    cutPoints: [
      {
        name: "selector stage written",
        acknowledged: false,
        images: [
          allowed(
            "old selector",
            "The old selector remains beside a stage.",
            "Enumerate generations, select the winner, then rewrite the selector.",
          ),
        ],
      },
      {
        name: "selector replacement returned",
        acknowledged: false,
        images: [
          allowed(
            "new selector",
            "The selector names the resolver's winning generation.",
            "Validate the hint against enumeration and continue.",
          ),
          allowed(
            "old, missing, or corrupt selector",
            "The selector cannot be trusted after reboot.",
            "Ignore it, enumerate generations, and reconstruct it.",
          ),
        ],
      },
      {
        name: "higher-level activation acknowledged",
        acknowledged: true,
        images: [
          allowed(
            "selector repair required",
            "Authority generations are intact while selector bytes are stale or absent.",
            "Select independently, rewrite the selector, and retain the acknowledged outcome.",
          ),
          violation(
            "selector was sole authority",
            "No independently enumerable generation can establish the winner.",
            "Startup fails closed and advisory evidence records that rebuildable state became authority.",
            "one selected authority",
          ),
        ],
      },
    ],
  },
  {
    id: "sqlite-acknowledgment",
    name: "SQLite FULL transaction acknowledgment",
    promise:
      "A power cut yields an integral old or new transaction; an acknowledged commit is the new outcome when flushes are honored.",
    cutPoints: [
      {
        name: "before durable commit",
        acknowledged: false,
        images: [
          allowed(
            "old transaction state",
            "The transaction is absent after WAL recovery.",
            "Report the operation as not committed.",
          ),
          allowed(
            "new transaction state",
            "The complete transaction and command receipt survived before the response.",
            "Report the committed outcome from authority; never replay uncertain work.",
          ),
        ],
      },
      {
        name: "FULL commit returned, before response",
        acknowledged: false,
        images: [
          allowed(
            "committed unknown outcome",
            "The complete transaction and command receipt are durable, but no response was sent.",
            "Return the recorded outcome when the Device reconnects; never execute again.",
          ),
        ],
      },
      {
        name: "durable acknowledgment sent",
        acknowledged: true,
        images: [
          allowed(
            "acknowledged transaction survives",
            "WAL recovery exposes the complete committed transaction and its dependencies.",
            "Resume from the acknowledged sequence.",
          ),
          violation(
            "acknowledged transaction lost",
            "WAL recovery exposes only the pre-commit state.",
            "Record a failed covered-storage observation: a successful flush was not honored.",
            "acknowledged outcome retained",
          ),
        ],
      },
    ],
  },
];

export interface PrototypeState {
  protocolIndex: number;
  cutPointIndex: number;
  imageIndex: number;
}

export type PrototypeAction =
  | "next-protocol"
  | "previous-protocol"
  | "next-cut"
  | "previous-cut"
  | "next-image"
  | "previous-image";

export const initialState = (): PrototypeState => ({
  protocolIndex: 0,
  cutPointIndex: 0,
  imageIndex: 0,
});

export const reducePrototype = (
  state: PrototypeState,
  action: PrototypeAction,
): PrototypeState => {
  if (action === "next-protocol" || action === "previous-protocol") {
    const delta = action === "next-protocol" ? 1 : -1;
    return {
      protocolIndex: wrap(
        state.protocolIndex + delta,
        PUBLICATION_PROTOCOLS.length,
      ),
      cutPointIndex: 0,
      imageIndex: 0,
    };
  }

  const protocol = PUBLICATION_PROTOCOLS[state.protocolIndex];
  if (action === "next-cut" || action === "previous-cut") {
    const delta = action === "next-cut" ? 1 : -1;
    return {
      ...state,
      cutPointIndex: wrap(
        state.cutPointIndex + delta,
        protocol.cutPoints.length,
      ),
      imageIndex: 0,
    };
  }

  const cutPoint = protocol.cutPoints[state.cutPointIndex];
  const delta = action === "next-image" ? 1 : -1;
  return {
    ...state,
    imageIndex: wrap(state.imageIndex + delta, cutPoint.images.length),
  };
};

export const currentCase = (state: PrototypeState) => {
  const protocol = PUBLICATION_PROTOCOLS[state.protocolIndex];
  const cutPoint = protocol.cutPoints[state.cutPointIndex];
  const image = cutPoint.images[state.imageIndex];
  return { protocol, cutPoint, image };
};

export const matrixSummary = () => {
  const cuts = PUBLICATION_PROTOCOLS.flatMap(protocol => protocol.cutPoints);
  const images = cuts.flatMap(cutPoint => cutPoint.images);
  return {
    protocols: PUBLICATION_PROTOCOLS.length,
    cutPoints: cuts.length,
    persistenceImages: images.length,
    allowedImages: images.filter(image => image.allowed).length,
    violations: images.filter(image => !image.allowed).length,
  };
};

const wrap = (value: number, length: number): number =>
  ((value % length) + length) % length;
