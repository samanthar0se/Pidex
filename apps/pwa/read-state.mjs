const READ_STATUSES = new Set(["read", "unread"]);

export function validSessionReadState(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    Object.keys(value).length === 3 &&
    Object.hasOwn(value, "readThroughTimelineRevision") &&
    Object.hasOwn(value, "readStatus") &&
    Object.hasOwn(value, "readStateRevision") &&
    Number.isInteger(value.readThroughTimelineRevision) &&
    value.readThroughTimelineRevision > 0 &&
    READ_STATUSES.has(value.readStatus) &&
    Number.isInteger(value.readStateRevision) &&
    value.readStateRevision > 0
  );
}

function identical(left, right) {
  return left.readThroughTimelineRevision === right.readThroughTimelineRevision &&
    left.readStatus === right.readStatus &&
    left.readStateRevision === right.readStateRevision;
}

function projections(workingSet, sessionId) {
  const summaries = [
    ...workingSet.sessions,
    ...workingSet.archivedSessions,
  ].filter(session => session.sessionId === sessionId);
  const scoped = workingSet.scopes.get(sessionId)?.session;
  return scoped ? [...summaries, scoped] : summaries;
}

function share(workingSet, sessionId, readState) {
  workingSet.readStates.set(sessionId, readState);
  for (const projection of projections(workingSet, sessionId)) {
    projection.readState = readState;
  }
}

export function discardSessionProjection(workingSet, sessionId) {
  workingSet.sessions = workingSet.sessions.filter(
    session => session.sessionId !== sessionId,
  );
  workingSet.archivedSessions = workingSet.archivedSessions.filter(
    session => session.sessionId !== sessionId,
  );
  workingSet.scopes.delete(sessionId);
  workingSet.readStates.delete(sessionId);
}

export function installSessionReadState(workingSet, session) {
  if (!validSessionReadState(session?.readState)) {
    discardSessionProjection(workingSet, session?.sessionId);
    return "inconsistent";
  }
  return reconcileSessionReadState(
    workingSet,
    session.sessionId,
    session.readState,
  );
}

export function reconcileSessionReadState(workingSet, sessionId, candidate) {
  if (!validSessionReadState(candidate)) {
    discardSessionProjection(workingSet, sessionId);
    return "inconsistent";
  }
  const current = workingSet.readStates.get(sessionId) ||
    projections(workingSet, sessionId)[0]?.readState;
  if (!current) return "missing";
  if (!validSessionReadState(current)) {
    discardSessionProjection(workingSet, sessionId);
    return "inconsistent";
  }
  if (candidate.readStateRevision < current.readStateRevision) return "stale";
  if (candidate.readStateRevision === current.readStateRevision) {
    if (!identical(candidate, current)) {
      discardSessionProjection(workingSet, sessionId);
      return "inconsistent";
    }
    share(workingSet, sessionId, current);
    return "unchanged";
  }
  const canonical = { ...candidate };
  share(workingSet, sessionId, canonical);
  return "advanced";
}
