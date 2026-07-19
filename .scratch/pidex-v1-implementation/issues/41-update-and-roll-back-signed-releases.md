# 41 — Update and roll back signed releases

**What to build:** Let the developer stage and activate a complete authenticated Pidex release only at a Host-wide safe boundary, preserving matching daemon/worker/data generations and rolling back automatically only before new authority accepts mutations.

**Blocked by:** 02 — Install and autostart the canonical Host; 23 — Archive and restore Sessions safely; 34 — Migrate versioned data and Pi artifacts safely; 37 — Create and manage online recovery snapshots

**Status:** resolved

- [ ] The Host verifies release metadata and complete packages against a pinned signing root and stages them in immutable versioned directories.
- [ ] Partial, corrupt, or unverified downloads never execute; paired Clients can see a ready update and defer activation.
- [ ] Activation stops new mutations and waits up to 15 minutes for Host-wide quiescence: no executing/queued/held/cancelling Run, unresolved Interaction, or incomplete lifecycle work.
- [ ] Timeout aborts update and resumes acceptance; explicit update force first durably applies normal Stop semantics to every affected Session.
- [ ] The launcher flushes, stops workers, activates matching release/data generation, starts one matching daemon/worker protocol generation, and commits the active pointer only after readiness.
- [ ] Pidex never hot-swaps the Pi SDK in a worker or runs mixed daemon/worker generations.
- [ ] Failure before new mutation acceptance restores prior release pointer/data generation; failure after acceptance requires supported reverse migration or managed restore.
- [ ] Tests cover signature/metadata failure, partial download, quiescence blocker, forced update, migration failure, readiness timeout, launcher replacement, rollback boundary, and Client update-required state.
