type SessionReadStatus = {
  readState: { readStatus: "read" | "unread" };
};

export function accessibleSessionStatus(
  session: SessionReadStatus,
  attention: "quiet" | "working" | "needs-response",
): string;
