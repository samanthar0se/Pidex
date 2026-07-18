# 47 — Meet latency and resource budgets

**What to build:** Tune the complete product to meet the decided p95 responsiveness and bounded resource targets under supported network/capacity conditions without weakening correctness or hiding external latency.

**Blocked by:** 46 — Pass the required browser and capacity matrix

**Status:** resolved

- [ ] Under at most 50 ms RTT/1% loss, p95 cold/warm usable shell is at most 3s/1s and cached/uncached recent Session open is at most 300ms/2s.
- [ ] p95 Host command outcome is at most 250ms, authoritative projection reconciliation 500ms, and live output display 250ms after Host receipt.
- [ ] p95 resumable reconnect reaches current within 3s, sleeping worker reaches ready within 5s, and normal daemon readiness remains within 15s.
- [ ] Upstream provider latency, tool execution, user media, Push delivery, and backup destination I/O are excluded from local budgets and shown distinctly.
- [ ] Quiescent launcher plus daemon stay at or below 300 MB RSS and 1% average CPU; each quiescent resident worker stays at or below 300 MB RSS.
- [ ] A Client displaying the 100,000-entry Timeline stays at or below 300 MB JavaScript heap and maintains responsive navigation/virtualization.
- [ ] Default rotating diagnostics/crash artifacts stay at or below 1 GB; after soak returns to equivalent quiescence, handles do not grow monotonically and memory growth is at most 10%.
- [ ] Benchmark evidence is reproducible, attributes regressions to local/external waits, and retains all authority/correctness assertions while tuning.
