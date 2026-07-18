# 09 — Negotiate protocol compatibility and isolate slow Clients

**What to build:** Make Client compatibility and delivery pressure fail safely: connections negotiate admitted semantics, unknown required behavior stops currentness, and a lagging Client resynchronizes without delaying Host work or sibling Clients.

**Blocked by:** 08 — Resume or reset Client scopes

**Status:** ready-for-agent

- [ ] The opening handshake binds expected Host identity and negotiates a common protocol major, compatible minor, and stable capability identifiers with constraints.
- [ ] No common major produces a clear `update required` state with control disabled rather than silent downgrade.
- [ ] Schemas declare ignorable optional fields; unknown required Change types or semantics make only the affected scope non-current and force update, reconnect, or reset.
- [ ] Each Client has a bounded outbound queue and only schema-declared replaceable projection changes may be coalesced.
- [ ] A Client that exceeds delivery bounds is closed with a typed resynchronization reason and later resumes or resets from its last acknowledged cursor.
- [ ] A slow, crashed, disconnected, backgrounded, revoked, or incompatible Client never backpressures a worker or blocks another Client.
- [ ] Protocol property tests cover minor extension, unknown required semantics, malformed envelopes, duplicate/reordered delivery, queue overflow, and safe unsupported-browser presentation.
