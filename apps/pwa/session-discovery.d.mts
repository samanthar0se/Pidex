type DiscoverableSession = {
  sessionId: string;
  name: string;
  timelineRevision: number;
  readState: { readStatus: "read" | "unread" };
};

export function discoverSessions<T extends DiscoverableSession>(
  sessions: T[],
  options: { query: string; unreadOnly: boolean },
): T[];
export function accessibleSessionStatus(
  session: DiscoverableSession,
  attention: "quiet" | "working" | "needs-response",
): string;
