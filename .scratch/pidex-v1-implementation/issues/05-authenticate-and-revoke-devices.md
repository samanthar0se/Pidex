# 05 — Authenticate and revoke Devices

**What to build:** Protect every product surface with Device authentication, allow any paired Device or Host-local administrator to revoke a target Device, and immediately stop that identity's future and live authority without disturbing others.

**Blocked by:** 04 — Pair the first Device

**Status:** resolved

- [ ] Projects, Workspaces, Sessions, Timeline data, capabilities, status, APIs, WebSockets, and commands reject unauthenticated access.
- [ ] Every paired Device receives equal full v1 authority; no read-only role, Device scope, or per-capability grant is introduced.
- [ ] Client startup and reconnect perform fresh signed-challenge authentication rather than relying on a persisted long-lived bearer credential.
- [ ] Revocation atomically rejects the Device key, invalidates connection sessions, terminates every live Client for that Device, stops future Push scheduling, and retains a non-secret tombstone.
- [ ] Revoking one Device leaves all other paired Devices, Host identity, and private CA unchanged.
- [ ] Pairing the same browser profile again creates a new Device identity rather than reviving the revoked record.
- [ ] Multi-Client tests cover command/revocation races, reconnect after revocation, stale sessions, and unaffected sibling Devices.
