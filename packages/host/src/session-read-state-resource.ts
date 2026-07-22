const PREFIX = "readState:";

export function sessionReadStateResourceId(sessionId: string): string {
  return `${PREFIX}${sessionId}`;
}

export function sessionIdFromReadStateResourceId(resourceId: string): string | undefined {
  return resourceId.startsWith(PREFIX) ? resourceId.slice(PREFIX.length) : undefined;
}
