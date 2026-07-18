# 38 — Export and verify a portable backup

**What to build:** Let the developer explicitly drain the Host, create one complete passphrase-encrypted portable bundle, fully verify it, and export it with honest distinctions between bundle, transfer, and saved-destination verification.

**Blocked by:** 23 — Archive and restore Sessions safely; 35 — Protect accepted work under storage pressure; 37 — Create and manage online recovery snapshots

**Status:** resolved

- [ ] Starting backup creates a durable maintenance operation, stops new product mutations, and drains accepted work toward quiescence for at most 15 minutes.
- [ ] Backup offers no force path; timeout/failure aborts, cleans/quarantines staging, and resumes normal acceptance without silently stopping work.
- [ ] The user-supplied passphrase remains only in volatile operation memory and never enters receipts, logs, diagnostics, support bundles, or later operations.
- [ ] The authenticated encrypted bundle contains coherent database, all referenced blobs/Pi artifacts, portable Host identity/CA, barrier, version inventory, and complete hash manifest—no executables.
- [ ] Pidex closes, rereads, decrypts, and verifies every manifest entry before reporting Bundle verified.
- [ ] PWA download is resumable/hash-checked and reports Delivered and stream-verified; Destination verified requires Pidex to reread the supplied saved file or CLI-visible destination.
- [ ] Exported files are user-owned and never rotated/deleted automatically; non-secret catalog identity/hash/barrier/compatibility/verification remains after staging expiry.
- [ ] Tests cover active blockers, cancellation by another Client, initiating Client loss, daemon loss/passphrase discard, bad destination, interrupted transfer, wrong passphrase, tamper, and full verify.
