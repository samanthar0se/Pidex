# 03 — Discover and expose the Host on the Private LAN

**What to build:** Make the canonical Host reachable from another Device on the intended Private LAN through minimal discovery, safe CA onboarding, wildcard HTTPS exposure, and actionable Windows Firewall health without weakening authentication.

**Blocked by:** 02 — Install and autostart the canonical Host

**Status:** ready-for-agent

- [ ] `_pidex._tcp.local` advertises only on Windows Private-classified interfaces and includes only canonical location, friendly label, discovery protocol version, and Host fingerprint.
- [ ] QR, canonical hostname, and manual IP/bootstrap fallbacks converge product use on the canonical HTTPS origin.
- [ ] A temporary Host-local action serves only onboarding instructions and the public CA certificate over HTTP, accepts no credentials or commands, and closes automatically.
- [ ] HTTPS binds wildcard addresses while Pidex-owned Firewall rules intend Private-profile exposure and the privileged helper accepts only fixed-schema Pidex operations.
- [ ] Missing, disabled, broadened, or unverifiable Firewall enforcement produces persistent high-severity warnings in PWA, CLI, diagnostics, logs, and coarse Windows events without stopping LAN service.
- [ ] mDNS remains Private-interface-only during degraded Firewall health, and no anonymous request can read product state or capabilities.
- [ ] Automated Windows and product-boundary tests cover profile changes, mDNS loss, name resolution, port collision, Firewall drift, bootstrap expiry, and canonical-origin enforcement.
