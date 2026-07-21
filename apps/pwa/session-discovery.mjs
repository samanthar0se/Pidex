export function discoverSessions(sessions, { query, unreadOnly }) {
  const normalizedQuery = query.toLowerCase();
  return sessions
    .filter(session => !unreadOnly || session.readState.readStatus === "unread")
    .filter(session => session.searchText.toLowerCase().includes(normalizedQuery))
    .toSorted((left, right) => right.timelineRevision - left.timelineRevision);
}
