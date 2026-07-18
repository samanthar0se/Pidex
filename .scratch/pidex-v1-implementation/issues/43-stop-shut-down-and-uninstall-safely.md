# 43 — Stop, shut down, and uninstall safely

**What to build:** Let the developer stop, restart, and uninstall Pidex without silently cancelling accepted work, while handling forced operations and Windows shutdown through the established lifecycle and preserving durable Host data by default.

**Blocked by:** 21 — Force-stop an uncooperative Session tree; 38 — Export and verify a portable backup; 41 — Update and roll back signed releases; 42 — Diagnose the Host and export support evidence

**Status:** ready-for-agent

- [ ] Normal stop, restart, and uninstall enter draining, reject new mutations, show remaining work, and wait up to 15 minutes for natural quiescence.
- [ ] Drain timeout/failure aborts the operation and resumes normal acceptance without silently escalating to cancellation.
- [ ] Explicit force durably accepts normal Stop semantics for affected Sessions before terminating contained Jobs.
- [ ] Windows logoff/shutdown rejects new work, uses a 10-second bounded flush/cooperative-abort budget, then relies on Job closure; unproved execution reconciles Interrupted on next start.
- [ ] Normal uninstall removes startup registration, Firewall rules, Current User root trust, binaries, staged releases, and disposable caches.
- [ ] Normal uninstall preserves durable data, Host identity, encrypted CA material, Pidex state, Pi artifacts, and managed backups for same-user reinstall.
- [ ] Destructive purge is separate, strongly confirmed, explains backup consequences, and cannot bypass drain/force rules.
- [ ] Tests cover quiescent/busy drain, force, shutdown during every Run state, reinstall preservation, purge cancellation, helper failure, and orphan-free process teardown.
