import assert from "node:assert/strict";
import test from "node:test";
import {
  accessibleSessionStatus,
  discoverSessions,
} from "../apps/pwa/session-discovery.mjs";
import { VisibleTailMarkRead } from "../apps/pwa/visible-tail-mark-read.mjs";

test("unread discovery filters canonical available and archived catalogs without changing recency order", () => {
  const sessions = [
    { sessionId: "older-unread", name: "Older", timelineRevision: 5,
      readState: { readStatus: "unread" as const } },
    { sessionId: "newer-read", name: "Newer", timelineRevision: 9,
      readState: { readStatus: "read" as const } },
    { sessionId: "newer-unread", name: "Newest", timelineRevision: 12,
      readState: { readStatus: "unread" as const } },
  ];

  assert.deepEqual(
    discoverSessions(sessions, { query: "", unreadOnly: true })
      .map(session => session.sessionId),
    ["newer-unread", "older-unread"],
  );
  assert.deepEqual(
    discoverSessions([sessions[0]!], { query: "old", unreadOnly: true })
      .map(session => session.sessionId),
    ["older-unread"],
  );
  assert.equal(
    accessibleSessionStatus(sessions[0]!, "needs-response"),
    "Unread, Needs response",
  );
  assert.equal(
    accessibleSessionStatus(sessions[1]!, "working"),
    "Working",
  );
});

test("visible-tail acknowledgement uses the exact committed revision and excludes stale Views", () => {
  const acknowledgements = new VisibleTailMarkRead(() => "command-id");
  const eligible = {
    sessionId: "s1", presentedTimelineRevision: 7,
    authoritativeCommitted: true, currentSession: true, foreground: true,
    tailVisible: true, online: true, loading: false,
  };

  assert.deepEqual(acknowledgements.command(eligible), {
    type: "session.mark-read", commandId: "command-id", sessionId: "s1",
    presentedTimelineRevision: 7, requiredCapabilityBasis: "1.2",
  });
  assert.equal(acknowledgements.command(eligible), undefined);
  assert.equal(
    acknowledgements.command({ ...eligible, presentedTimelineRevision: 8,
      foreground: false }),
    undefined,
  );
  assert.equal(
    acknowledgements.command({ ...eligible, presentedTimelineRevision: 8,
      online: false }),
    undefined,
  );
  assert.equal(
    acknowledgements.command({ ...eligible, presentedTimelineRevision: 8,
      loading: true }),
    undefined,
  );
  assert.equal(
    acknowledgements.command({ ...eligible, presentedTimelineRevision: 8,
      tailVisible: false }),
    undefined,
  );
  assert.equal(
    acknowledgements.command({ ...eligible, presentedTimelineRevision: 9 })
      ?.presentedTimelineRevision,
    9,
  );
});
