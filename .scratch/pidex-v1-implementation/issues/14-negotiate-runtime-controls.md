# 14 — Negotiate runtime controls

**What to build:** Expose only the model, mode, input, and runtime controls admitted by the exact bundled Pi SDK and the negotiated Pidex capability basis, failing clearly when required behavior is unavailable.

**Blocked by:** 10 — Execute the first completed Run

**Status:** ready-for-agent

- [ ] Worker readiness probes every required Pi SDK semantic and advertises stable versioned optional capability identifiers plus constraints.
- [ ] Missing required capabilities, changed required semantics, schema mismatch, or unknown required worker messages block worker readiness with typed diagnostics.
- [ ] The Host handshake incorporates worker-derived capabilities without exposing Pi SDK objects or private runtime structures.
- [ ] The PWA presents capability-dependent model, mode, and supported-input controls and omits or disables unsupported behavior rather than simulating it.
- [ ] Commands declare required capability basis and are rejected when the connected Client/worker basis cannot satisfy it.
- [ ] A runtime upgrade cannot silently reduce a Session below the daily-driver capability baseline or mix daemon/worker generations.
- [ ] The Pi contract suite exercises required, optional, absent, malformed, and version-shifted capability combinations against the exact bundled SDK.
