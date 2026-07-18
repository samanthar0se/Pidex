# 07 — Reject conflicting commands and replay receipts

**What to build:** Make concurrent Session rename demonstrate the Host's exact-target command contract: revision-preconditioned intent commits once, stale races reconcile visibly, and uncertain retries return durable outcomes without executing twice.

**Blocked by:** 06 — Create and discover scoped Sessions

**Status:** resolved

- [ ] Every mutation carries a Device-scoped unique Command ID, exact target, required capability basis, and command-specific observed preconditions.
- [ ] The Host serializes commits, accepts changes through unrelated revisions where safe, and rejects intent invalidated by a relevant race.
- [ ] An accepted rename records the domain transition, metadata revision, command envelope digest, outcome, and commit cursor in one SQLite transaction.
- [ ] Retrying the identical command returns the recorded result without re-execution; reusing the ID with different content is rejected.
- [ ] Stale/conflicting outcomes identify the failed precondition and provide current revisions or a reconciliation pointer.
- [ ] The issuing Client uses only pending presentation until the Change Set arrives; command responses never patch authoritative projection state.
- [ ] Multi-Device tests cover response/Change Set arrival in both orders, transport loss after acceptance, at-most-once retry, and receipt proof across restart.
