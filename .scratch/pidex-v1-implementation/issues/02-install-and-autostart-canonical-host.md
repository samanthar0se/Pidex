# 02 — Install and autostart the canonical Host

**What to build:** Let the developer install Pidex for one Windows user and obtain one stable, automatically started canonical HTTPS Host with private-CA trust, versioned launcher supervision, and visible startup failure recovery.

**Blocked by:** 01 — Bootstrap a runnable Host and product test seam

**Status:** ready-for-agent

- [ ] A signed per-user installation bundles every required runtime, registers logon startup, and runs normal Host processes unelevated.
- [ ] A stable launcher enforces one Host instance for the Windows user and starts an immutable versioned daemon release without a console window.
- [ ] Setup commits one collision-resistant canonical `.local` hostname and fixed high port, and Windows rename, network change, or update does not silently alter it.
- [ ] Pidex creates a private CA and leaf certificate, protects private keys with versioned DPAPI envelopes and user-only ACLs, and installs only public trust in the Current User store.
- [ ] Normal readiness completes within 15 seconds; failed starts retry at 1, 2, 4, 8, and 16 seconds before opening a circuit breaker.
- [ ] While the circuit breaker is open, LAN product service and workers remain down while Host-local CLI/recovery status exposes the cause and explicit retry path.
- [ ] Installer, launcher, certificate, identity, and startup behavior are exercised through the Windows adapter contract and product status seam.
