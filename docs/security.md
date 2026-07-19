# Product and release security (PRD: Build Pidex v1)

This document is the maintained security boundary and release gate. A change to a
surface below must update its control and adversarial test.

## Threat model and non-claims

The Windows Host and its signed binaries, the current Windows user, and the
Host-private CA are trusted. The LAN is **hostile**: TLS authenticates the Host
and Device challenge credentials authenticate Clients. A wildcard Firewall rule
is never silently substituted for the selected network profiles; drift or a
required wildcard is prominently warned. All paired Devices have equal authority
and revocation is the boundary.

Pi Session workers are contained lifecycle children but are **not sandboxes** and
have the current user's privileges. Tests must not claim worker privilege
isolation. Offline Device caches are bounded convenience copies: revocation
prevents future synchronization but cannot remotely erase bytes already held by
a Device. Push contains advisory opaque identifiers only.

Backups face theft, tampering, rollback, partial-write, weak-passphrase, and
malicious-path threats. Portable backups are authenticated encryption and restore
requires compatibility and full verification before atomic activation. Recovery
snapshots remain Host-local and protected by current-user custody. Diagnostics,
logs, and support bundles are local, allowlisted, bounded, and redacted; they are
never automatically transmitted.

## Surface inventory and ASVS 4.0.3 Level 2 controls

| Surface | Access | ASVS controls | Blocking evidence |
|---|---|---|---|
| HTTPS/WebSocket, pairing | anonymous then authenticated | V2, V3, V4, V9, V13 | `lan-exposure`, `device-pairing`, `device-revocation`, protocol tests |
| PWA/offline/Push | Device | V3, V4, V5, V11, V13, V14 | cache, service-worker, advisory-push tests |
| localhost launch/status | local capability | V2, V4, V12, V13 | host diagnostics and CLI tests |
| launcher/helper/installation | privileged local | V1, V4, V10, V14 | Windows installation and release-update tests |
| worker and module IPC | local untrusted input | V4, V5, V12, V13 | module-seams, worker, protocol tests |
| SQLite/blob/key custody | Host | V6, V8, V10 | storage, corruption, migration tests |
| updates and artifacts | release | V10, V14 | signed-release and product-release-security tests |
| backup/restore | Device plus strong confirmation | V2, V4, V6, V8 | backup, recovery, restore, reidentification tests |
| logs/diagnostics/export | local authorized | V4, V7, V8, V12 | host-diagnostics tests |

Schema validation is strict and bounded at protocol/IPC boundaries. Authentication,
origin/CSRF, authorization, rate limits, revocation, malformed input, redaction,
partial publication, and cryptographic failure are negative-test requirements.
Fuzz/property fixtures belong beside the owning surface and are blocking.

## Cryptographic profile and rotation

* Releases: Ed25519 signatures from a pinned offline root; SHA-256 artifact
  digests. Every file and a CycloneDX 1.5 SBOM are linked by the signed manifest.
* Host identity: private CA and leaf use standard platform-supported algorithms;
  leaf lifetime is at most 90 days and rotates before two-thirds of its lifetime.
  CA rotation requires explicit recovery/reidentification and a new trust epoch.
* Sessions/challenges: at least 128 random bits, single-purpose, constant-time
  checked, short lived (launch: single use/60 seconds; pairing: 10 minutes), and
  invalidated by use, expiry, epoch change, or Device revocation.
* Portable backup v1: scrypt to 256 bits with a random 128-bit salt, AES-256-GCM,
  and a random 96-bit nonce. Containers are versioned; parameters may only be
  strengthened by a new readable format. Verification precedes migration and
  activation. Keys/passphrases are not persisted.
* Windows private keys: versioned Current User DPAPI envelopes and user-only ACLs.
  Rotation writes and verifies new custody before switching; old material is
  retained only for bounded rollback/recovery and never silently downgraded.

## Release gate and vulnerability handling

CI blocks type errors, tests, production dependency high/critical advisories, and
simple committed-secret patterns. Release infrastructure additionally runs its
approved SAST and protocol fuzz jobs. A release is assembled in non-executable
staging, completely hashed, SBOM-generated, signed, independently verified, then
atomically published. Partial, mixed-generation, unsigned, malformed-SBOM, or
unverified bytes never become runnable.

Critical/high findings block promotion. A medium finding requires a tracked ID,
affected scope, compensating controls, named owner, expiry date, and explicit
security-owner acceptance; expired or incomplete acceptances block promotion.

