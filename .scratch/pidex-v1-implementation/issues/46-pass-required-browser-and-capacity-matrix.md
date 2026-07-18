# 46 — Pass the required browser and capacity matrix

**What to build:** Demonstrate that the complete Pidex workflow is correct on every required desktop/mobile browser and supported Host capacity floor, while incompatible browsers fail clearly without presenting partial-current control.

**Blocked by:** 31 — Deliver advisory Push notifications; 43 — Stop, shut down, and uninstall safely; 44 — Prove module and future-workspace seams; 45 — Harden product and release security

**Status:** resolved

- [ ] Blocking browser coverage includes current and previous Edge/Chrome on supported Windows, Chrome on supported Android, and Safari browser plus installed PWA on supported iOS/iPadOS.
- [ ] Core Session creation, discovery, Timeline, runtime controls, queues, steering, Interactions, Stop, lifecycle, Fork, reconnect, offline, update-required, and revocation workflows pass on each required browser mode.
- [ ] Firefox/other unsupported or incompatible browsers fail clearly and never present a projection as current/controllable when required semantics are absent.
- [ ] Capacity fixtures contain 10,000 retained Sessions, discovery across them, one 100,000-entry Timeline, and six simultaneous Clients across three Devices.
- [ ] An 8 GB Windows Host supports four resident Sessions and two concurrently executing Runs; a 16 GB Host supports eight resident and four executing.
- [ ] Behavior above capacity floors uses measured admission, preserves OS headroom, and reports pressure without artificial retained-Session caps, silent paging, dropped work, or false availability.
- [ ] Browser/capacity evidence records exact build, OS/browser versions, hardware, network conditions, configuration, datasets, and artifacts.
