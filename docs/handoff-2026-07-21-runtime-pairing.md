# Pidex Runtime and Pairing Handoff

## Objective

Determine whether Pidex is runnable after the latest work, start it with fresh development data, and connect from a second Windows machine running Google Chrome.

## Current runtime state

- Repository: `C:\git\pidex`
- Branch: `main`, 20 commits ahead of `origin/main` when inspected.
- Development Host was started with `npm run dev` and reported ready at `https://192.168.1.227:7443`.
- The Host listens on `0.0.0.0:7443`.
- `.env` supplies `PIDEX_HOSTNAME=192.168.1.227`.
- `.pidex-data-dev/` was deliberately deleted because recent schema changes were breaking changes. Startup rebuilt fresh development authority data.
- The shared Development CA was not deleted. It remains under `%LOCALAPPDATA%\Pidex\Development CA`.
- The long-running `npm run dev` process was still active at the end of the investigation.

## Validation completed

- Node: `v22.23.1`
- OpenSSL: available and the development prerequisite check passes.
- `npm ci`: completed successfully after refreshing stale dependencies.
- `npm run typecheck`: passes.
- `npm run build:client`: passes. Generated tracked assets were restored afterward so the diagnostic build did not alter the working tree.
- Fresh isolated Host startup succeeded and returned HTTP 200 over HTTPS.
- A targeted Client test run passed 15 of 16 tests; the remaining `development-https.product.test.ts` failure was a Windows `EBUSY` cleanup failure.
- The original full-suite attempt was invalidated when `npm ci` overlapped the still-running test process and partially replaced `node_modules`; do not use that run as release evidence.

## Original startup failure

Before deleting `.pidex-data-dev/`, normal startup failed at `packages/host/src/store.ts:2446` with:

```text
Error: invalid-session-read-state
```

Fresh authority data removed this startup blocker. The old `.pidex-data-dev/` contained only development runtime state, but deleting it also discarded development Sessions, Device pairings, Host identity, disposable leaf TLS material, and logs.

## Remote TLS investigation

The public Development CA was copied to the remote Windows machine over SSH:

```powershell
scp 'User@192.168.1.227:C:/Users/User/AppData/Local/Pidex/Development CA/pidex-development-ca.pem' "$HOME\Downloads\pidex-development-ca.pem"
```

The transferred PEM file SHA-256 matched the Host:

```text
2ece9aae52cbaa22fdd3a623e535a544e592132f921556b2ec42308d5435d3f6
```

The decoded certificate SHA-256 fingerprint is:

```text
82:98:9C:38:F7:6C:E2:01:1D:CF:84:AF:FD:FE:6B:C7:29:E1:69:A5:F9:CA:5F:67:07:55:3F:7E:DD:62:F5:36
```

`certutil -user -addstore Root` reported that the exact Pidex Development CA was already trusted by the remote user.

On both machines, Windows `curl.exe` with normal certificate checking fails with:

```text
CRYPT_E_NO_REVOCATION_CHECK (0x80092012)
```

`curl.exe -k` returns HTTP 200. The Pidex development leaf has valid SANs for `localhost`, `127.0.0.1`, `::1`, and `192.168.1.227`, but it publishes no CRL distribution point or OCSP endpoint. This explains Schannel's strict revocation-check failure, but it is not the blocker for stock Chrome: stock Chrome on the Host successfully loaded the same origin with a clean profile.

The remote machine's normal Chrome profile showed a top-level `ERR_FAILED`. Starting Chrome with a clean profile, extensions disabled, and no proxy loaded the Pidex page successfully:

```powershell
& "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" --user-data-dir="$env:TEMP\pidex-chrome-test" --no-proxy-server --disable-extensions "https://192.168.1.227:7443/"
```

This isolates the original `ERR_FAILED` to the remote Chrome profile, an extension, or the Windows/system proxy path. It is separate from the application-level pairing failure described next.

## Confirmed Client defect

The clean Chrome profile loads the React Client, but the UI remains:

```text
Offline
Host authority is unavailable. No cached authoritative facts are available.
Host unavailable
```

Opening the printed `?pair=...` URL in that profile produces the same result.

The root cause is confirmed in source:

- `apps/client/src/host-session-adapter.ts` opens `wss://<host>/control` without a Device session token.
- `apps/client/src/client-lifecycle.ts` ignores the `pair` query parameter.
- The React Client contains no pairing or stored-Device authentication implementation.
- `packages/host/src/host.ts` correctly rejects `/control` upgrades unless they include a valid `?session=...` token or bearer authorization.

Therefore every React Client WebSocket receives HTTP 401 and is surfaced as `Host unavailable`. The current pairing URL cannot work in the new React Client.

## Existing implementation to reuse

The legacy PWA already contains the complete intended browser flow in `apps/pwa/app.js`:

1. Read the `pair` query parameter.
2. Generate a non-extractable P-256 ECDSA key pair.
3. Call `POST /pair/challenge` with the secret and public JWK.
4. Sign the challenge and call `POST /pair/complete`.
5. Persist `{ deviceId, privateKey }` in IndexedDB database `pidex-device`, identity store.
6. On normal startup, call `POST /pair/auth-challenge`.
7. Sign and call `POST /pair/authenticate`.
8. Open `wss://<host>/control?session=<token>`.

The Host implementation and product-level Host tests for this flow already exist in `packages/host/src/pairing.ts` and `test/device-pairing.product.test.ts`.

## Recommended next work

Port the established PWA Device pairing/authentication flow into the React Client rather than changing Host authorization:

1. Add a focused React Client Device-auth module using the existing IndexedDB schema and non-extractable `CryptoKey` storage.
2. Add a pairing view or explicit pairing state for `?pair=...`; do not silently display generic offline state.
3. Authenticate the stored Device before opening any control socket.
4. Make every socket in `host-session-adapter.ts` use the current short-lived session token.
5. Reauthenticate and reconnect when the ten-minute session expires or the socket closes.
6. Add a regression test that loads the production React Client with a pairing URL, completes challenge/response, and proves the resulting WebSocket uses `?session=...`.
7. Rebuild `apps/client/dist/`, restart the development Host, generate a new pairing URL, and verify from the clean remote Chrome profile.

The pairing secret printed during this investigation should be treated as expired or exposed in terminal history. Generate a new one after implementing the Client fix.

## Working-tree caution

The repository already had unrelated modified and untracked files before this investigation, including `.sandcastle/*`, `README.md`, `docs/architecture-decisions.md`, `docs/computer-use.md`, research documents, and `NUL`. Do not discard or overwrite them. This handoff document is the only intentional source-tree addition from the investigation.
