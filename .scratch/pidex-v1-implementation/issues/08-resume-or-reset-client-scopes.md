# 08 — Resume or reset Client scopes

**What to build:** Let a temporarily disconnected Client resume the exact Host and Session scopes it previously committed, while continuity-breaking changes produce atomic authoritative resets instead of cache/Host merging.

**Blocked by:** 07 — Reject conflicting commands and replay receipts

**Status:** ready-for-agent

- [ ] Synchronization Cursors are opaque and bind durable Host identity, synchronization epoch, and monotonic Host sequence.
- [ ] Every Client synchronizes a lightweight Host scope and adds/removes detailed Session scopes without changing Session lifecycle.
- [ ] Scope creation/reset establishes a barrier containing scope, cursor, resource revisions, protocol basis, and capabilities, then delivers buffered later Change Sets only after snapshot installation.
- [ ] Temporary transport loss preserves Client identity, requested scopes, pending Command IDs, and last atomically committed cursor.
- [ ] Compatible retained history resumes after the cursor; incompatible Host identity, epoch, protocol, scope history, or resource revision installs an explicit scope reset.
- [ ] A Client never merges cached facts and Host facts by timestamp and reports `current` only after the applicable transaction commits.
- [ ] Tests cover daemon restart continuity, restore-like epoch rotation, added Session scopes, dropped acknowledgements, redelivery, revision mismatch, and reaching another Host.
