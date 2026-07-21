type DiscoverableSession = {
  sessionId: string;
  searchText: string;
  timelineRevision: number;
  readState: { readStatus: "read" | "unread" };
};

export function discoverSessions<T extends DiscoverableSession>(
  sessions: T[],
  options: { query: string; unreadOnly: boolean },
): T[];
