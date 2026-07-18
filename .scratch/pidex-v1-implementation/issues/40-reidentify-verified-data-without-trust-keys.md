# 40 — Reidentify verified data without trust keys

**What to build:** Preserve fully verified product data when Host trust identity cannot be recovered by explicitly ending old cryptographic continuity, issuing a new Host identity/origin/CA, invalidating all Devices, and retaining non-restorable evidence when authority itself fails validation.

**Blocked by:** 39 — Restore the whole Host

**Status:** ready-for-agent

- [ ] Reidentify is offered only through Host-local recovery when product authority/reference closure fully verifies but Host trust keys are unrecoverable and no usable portable identity exists.
- [ ] Before commitment, Pidex creates the strongest verified encrypted export still possible and explains consequences.
- [ ] Reidentify creates new Host identity, canonical origin, private CA, and synchronization epoch around the verified data.
- [ ] Every captured Device authorization becomes invalid, all Clients/caches must reconcile as another Host basis, and fresh pairing is required.
- [ ] Recovery records that old cryptographic continuity ended and never presents Reidentify as rotation, ordinary restore, clone, or equivalent identity preservation.
- [ ] When global authoritative data does not verify, Pidex may create an encrypted evidence package containing damaged generations, intact stores, manifests, and diagnostics but labels it non-restorable.
- [ ] Evidence export never performs row extraction, guessed relationship repair, silent omission, approximate reconstruction, or last-write-wins salvage.
- [ ] Recovery tests cover missing Host key, missing CA only, portable identity available, corrupt authority, export interruption, new-origin trust, Device invalidation, and successful fresh pairing.
