# Browser and capacity release evidence

Issue 46 is a blocking, non-retryable release gate. Run the complete product workflow on every mode in `REQUIRED_BROWSER_MATRIX`, at both `current` and `previous`:

- creation and discovery;
- Timeline, runtime controls, queues, steering, Interactions, and Stop;
- lifecycle and Fork; and
- reconnect, offline, update-required, and revocation.

Unsupported browsers must show the compatibility stop screen and establish no control connection.

Capacity runs use 10,000 retained Sessions, discovery over the full catalog, one 100,000-entry Timeline, and six Clients on three Devices. The 8 GiB Windows tier exercises four resident Sessions/two executing Runs; the 16 GiB tier exercises eight/four. Admission beyond these floors is based on measured memory and storage headroom, never a retained-Session cap.

For every run retain:

- commit and signed build identifiers;
- exact Windows/mobile OS and browser versions;
- browser/standalone mode;
- CPU, RAM, and storage hardware;
- network RTT, loss, and bandwidth;
- Host configuration and capacity thresholds;
- dataset seed and counts;
- start/end time and outcome; and
- logs, screenshots/video, traces, and report artifact hashes.

Missing metadata or any failed workflow blocks promotion. Reruns may gather diagnostics but do not replace a failure.
