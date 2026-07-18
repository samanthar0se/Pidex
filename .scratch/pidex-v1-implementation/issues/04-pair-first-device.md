# 04 — Pair the first Device

**What to build:** Let a developer authorize one browser profile or app installation as a paired Device through a short-lived Host-local secret and then establish an authenticated Client without storing a replayable bearer credential.

**Blocked by:** 03 — Discover and expose the Host on the Private LAN

**Status:** ready-for-agent

- [ ] A Host-local action creates a one-time pairing secret shown as QR and manual entry, expiring after five minutes with a bounded failure count.
- [ ] Discovery, bootstrap pages, logs, diagnostics, and ordinary product state never expose the pairing secret.
- [ ] The first successful exchange consumes the secret and requires no second approval click.
- [ ] The Device generates a non-extractable signing key, registers only its public key, and receives an immutable Host-local Device identity.
- [ ] The Device proves possession through a signed challenge and receives only a short-lived authenticated Client session.
- [ ] Pairing UX clearly states that the Device gains the complete Pidex surface and the signed-in Windows user's Pi machine authority.
- [ ] Product tests cover success, expiry, repeated failure, concurrent use, consumed-secret replay, malformed keys, and canonical-origin enforcement.
