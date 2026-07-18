# 45 — Harden product and release security

**What to build:** Prove the selected trusted-Host security boundary with automated controls across every public, local, privileged, update, backup, IPC, storage, and export surface, and make release provenance auditable.

**Blocked by:** 32 — Clean revoked Devices and manage cache storage; 40 — Reidentify verified data without trust keys; 41 — Update and roll back signed releases; 42 — Diagnose the Host and export support evidence; 44 — Prove module and future-workspace seams

**Status:** ready-for-agent

- [ ] A maintained threat model states trusted Host/user/LAN assumptions, wildcard-Firewall warning behavior, equal Device authority, worker non-sandbox status, offline cache limits, and backup/recovery threats.
- [ ] Applicable automated controls map to OWASP ASVS Level 2 and cover every authenticated/anonymous/local/privileged surface.
- [ ] Blocking automation covers secret scanning, dependency/vulnerability scanning, static analysis, schema/protocol fuzz/property tests, TLS/origin, pairing limits, challenge auth/revocation, authorization, CSRF/cross-origin, and localhost launch capability.
- [ ] Privileged helper, signed updates, backup encryption/KDF, DPAPI key custody, IPC validation, module registration, Push payloads, logs, diagnostics, and support-bundle redaction receive adversarial tests.
- [ ] Standard cryptographic algorithms, key sizes, certificate lifetimes/rotation, session lifetimes, and backup container/KDF choices are recorded with safe migration/rotation behavior.
- [ ] Every shipped artifact is signed and has an artifact-linked SBOM; partial/unverified artifacts never become runnable.
- [ ] No known critical/high vulnerability ships; any medium finding records scope, compensating controls, owner, and explicit acceptance.
- [ ] Security tests do not claim Session-worker privilege isolation or remote cache erasure beyond the decided boundary.
