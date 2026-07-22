# Prototype network boundary (PRD #163)

Pidex currently uses one deliberately unauthenticated prototype LAN runtime.
Any party that can reach the Host's IPv4 HTTP/WebSocket port can view and
control Pidex. Use only disposable, non-sensitive evaluation data on an
operator-controlled LAN; do not expose the Host to the Internet or an
uncontrolled network.

The runtime has no Client identity, credentials, authorization, revocation, or
network confidentiality. Host identity is only a continuity identifier for
synchronization, caches, backup, and restore. It does not authenticate a peer.

Backups retain authenticated encryption and complete-bundle verification.
Release integrity, lifecycle containment, worker IPC validation, provider
credentials, storage durability, diagnostics redaction, and recovery checks
remain independent of the anonymous network authority model.
