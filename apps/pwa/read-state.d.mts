export type SessionReadState = {
  readThroughTimelineRevision: number;
  readStatus: "read" | "unread";
  readStateRevision: number;
};

export type SessionProjection = {
  sessionId: string;
  readState: SessionReadState;
};

export type DeviceWorkingSet = {
  sessions: SessionProjection[];
  archivedSessions: SessionProjection[];
  scopes: Map<string, { session?: SessionProjection }>;
  readStates: Map<string, SessionReadState>;
};

export function validSessionReadState(value: unknown): value is SessionReadState;
export function discardSessionProjection(
  workingSet: DeviceWorkingSet,
  sessionId: string,
): void;
export function installSessionReadState(
  workingSet: DeviceWorkingSet,
  session: SessionProjection,
): "advanced" | "stale" | "unchanged" | "missing" | "inconsistent";
export function reconcileSessionReadState(
  workingSet: DeviceWorkingSet,
  sessionId: string,
  candidate: unknown,
): "advanced" | "stale" | "unchanged" | "missing" | "inconsistent";
