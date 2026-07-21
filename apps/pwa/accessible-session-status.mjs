export function accessibleSessionStatus(session, attention) {
  const statuses = [];
  if (session.readState.readStatus === "unread") statuses.push("Unread");
  if (attention === "needs-response") statuses.push("Needs response");
  if (attention === "working") statuses.push("Working");
  return statuses.join(", ");
}
