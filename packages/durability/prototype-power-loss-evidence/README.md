# PROTOTYPE — sudden-power-loss evidence

This throwaway logic prototype asks whether a release campaign can distinguish a real abrupt-power-loss recovery claim from the existing process-crash fault seam. It models the four publication protocols that must carry Pidex authority: immutable files, Authority-generation activation, rebuildable selectors, and SQLite durable acknowledgment.

The prototype deliberately separates two kinds of evidence:

- an exhaustive persistence-state oracle that enumerates every allowed post-cut disk image at each named protocol step; and
- a Windows Hyper-V campaign whose out-of-band controller hard-powers the guest off only after the guest reaches the named step, then boots a read-only recovery witness.

The model is the proof of protocol-state coverage. Hyper-V proves that the real Windows/NTFS path, abrupt reboot path, and evidence collection are wired; it does not certify physical storage. Both results are advisory release evidence: a failed or missing campaign is prominent and actionable but does not block promotion. PDU-based physical testing remains characterization unless Pidex later names qualified hardware in its support boundary.

Run it from the repository root:

```sh
npm run prototype:power-loss-evidence
```

Use the keyboard to move among publication protocols, cut points, and possible post-cut disk images. The interesting question is whether every displayed image has the right recovery verdict and whether the advisory evidence makes failures impossible to mistake for proof.
