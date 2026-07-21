export function discoverSessions(sessions, { query, unreadOnly }) {
  const normalizedQuery = query.toLowerCase();
  return sessions
    .filter(session => !unreadOnly || session.readState.readStatus === "unread")
    .filter(session => session.name.toLowerCase().includes(normalizedQuery))
    .toSorted((left, right) => right.timelineRevision - left.timelineRevision);
}

export function accessibleSessionStatus(session, attention) {
  const statuses = [];
  if (session.readState.readStatus === "unread") statuses.push("Unread");
  if (attention === "needs-response") statuses.push("Needs response");
  if (attention === "working") statuses.push("Working");
  return statuses.join(", ");
}
