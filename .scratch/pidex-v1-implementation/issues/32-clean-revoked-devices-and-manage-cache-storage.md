# 32 — Clean revoked Devices and manage cache storage

**What to build:** Make Device-local storage bounded and understandable, and perform best-effort complete cleanup after authenticated revocation without deleting valid data on ordinary connectivity failure or claiming remote wipe.

**Blocked by:** 05 — Authenticate and revoke Devices; 29 — Read a bounded working set offline; 31 — Deliver advisory Push notifications

**Status:** ready-for-agent

- [ ] Host revocation stops new Push scheduling and may send one final encrypted revocation hint when a usable subscription exists.
- [ ] An explicit authenticated revoked result transitions the Device to `revoked` and best-effort deletes signing key, Push subscription, drafts, preferences, projections, pages, blobs, and Host metadata.
- [ ] Network failure, Host downtime, certificate failure, or delayed Push remains offline/reconnecting and never destroys valid local data.
- [ ] Product copy states that offline/copy/backup conditions may retain cached content and that revocation is not remote wipe.
- [ ] A configurable byte budget evicts least-recently-viewed finalized pages/blobs, then older detailed Session projections, while preserving lightweight summaries when practical.
- [ ] The Device requests persistent browser storage where available and exposes usage, budget, persistence grant, and write failures.
- [ ] Clear Session data preserves pairing and explicitly retained drafts; clear all data warns that Device identity/drafts are lost and re-pairing is required.
- [ ] Browser tests cover budget pressure, OS eviction, current-View protection, revoked while offline, false-revocation prevention, cleanup interruption, and re-pair clean state.
