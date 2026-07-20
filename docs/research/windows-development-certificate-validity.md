# Windows development certificate validity

This report answers issue [#32](https://github.com/samanthar0se/Pidex/issues/32)
for Pidex's private development CA and its `localhost` or LAN leaf
certificates. It uses the current first-party documentation linked in the
source list below. Certificate **trust** and certificate **identity** are
separate requirements: a client must trust the issuing CA, and the presented
leaf must be valid for the name or address used by the client.

## Conclusions

- Use a private, manually installed development root. Chromium's 398-day
  maximum applies to publicly trusted CAs, not a locally operated CA with no
  path to public trust.
- Keep the private CA identity stable during ordinary renewal. Reissue the
  leaf before expiry or hostname change; do not regenerate the CA merely to
  renew a leaf. A new CA requires every client to trust the new root.
- Encode service identities in `subjectAltName`: `DNS:localhost` for
  `https://localhost`, and an `iPAddress` SAN for every LAN IP used in a URL.
  A DNS SAN containing an IP string is not the equivalent of an IP SAN.
- Trust the CA in the store used by the client. Pidex's current Windows
  integration targets the current user's Root store; a different Windows user,
  service account, or Node process may use a different trust source.
- Renewal must inspect certificate dates, not only file presence and key/SAN
  coherence. Windows and TLS clients evaluate validity against the current
  clock, so an expired but internally coherent generation is not usable.

## Required certificate properties

### Root CA

The private root should be a self-signed trust anchor with an explicit CA
profile:

- `basicConstraints`: critical, `CA:TRUE`; use `pathLenConstraint:0` when the
  root is intended to sign only Pidex leaf certificates.
- `keyUsage`: critical, including `keyCertSign` (and `cRLSign` if the CA issues
  CRLs).
- A validity period long enough for the development installation, but with a
  documented replacement procedure before `notAfter`.
- A private key that remains on the Host and is protected for the owning
  Windows user. Only the public CA certificate should be copied to another
  client.

These properties make the CA role and delegation limits explicit. The current
OpenSSL invocation in `packages/host/src/certificate.ts` does not pass CA
extensions explicitly, so the generated profile should be checked against the
OpenSSL configuration in the deployment environment rather than assuming
defaults.

### TLS leaf

Each leaf should have:

- `basicConstraints`: critical, `CA:FALSE` (or an equivalent end-entity
  profile).
- `keyUsage` and `extendedKeyUsage` appropriate for the TLS server role,
  including `serverAuth` when EKU is present.
- A SAN for each supported client reference identity. DNS names use `dNSName`;
  literal IP addresses use `iPAddress`. Do not rely on the Common Name for new
  certificates.
- `notBefore`/`notAfter` that cover the current clock with enough skew and
  renewal margin. A leaf should normally be shorter-lived than its CA.

RFC 5280 requires validity, path, usage, and constraints to participate in
certificate path processing. RFC 9525 defines the current TLS service-identity
mapping and makes the SAN form the important interoperability boundary.

Pidex currently issues a 10-year CA and an 825-day leaf. The leaf extension
file explicitly adds the configured DNS or IP hostname, `DNS:localhost`, and
`IP:127.0.0.1`. The source command does not explicitly add leaf key-usage or
server-auth EKU extensions. The 825-day lifetime is permissible for a private
CA, but it is an operational choice, not a Chromium private-CA limit.

## Windows

### Trust scope

Windows separates the **Current User** and **Local Machine** certificate
stores. Current-user roots are appropriate for an interactive Pidex Host and
are not automatically available to an unrelated service account. A local
machine root is computer-wide and is appropriate only when all users/services
on that machine should trust the CA.

`CertGetCertificateChain` uses the current-user chain engine when no engine is
specified. It evaluates against the current system time when no validation time
is supplied. Supplying a historical or test time does not change the trust
store, trust-list, or revocation-store state used by the chain engine. Tests
must therefore control both certificate dates and the trust context, rather
than treating a supplied validation time as a historical snapshot of Windows
trust.

For Schannel server authentication, normal verification includes chain trust,
validity dates, revocation status, path constraints, intended usage, and
server-name matching. If an application requests manual credential
validation, Schannel leaves those checks to the application. Pidex should not
use manual validation or a disabled certificate check as a substitute for
trusting the development CA.

### Pidex implications

- Import the public CA into `Current User\Trusted Root Certification
  Authorities` for the user running the Host or browser. The existing LAN
  guide uses `certutil -user -addstore Root` for this reason.
- Import the same public CA separately on every LAN client. Opening TCP port
  `7443` and allowing it through the firewall does not establish TLS trust.
- The leaf used for a LAN URL such as `https://192.168.1.227:7443` must contain
  `IP:192.168.1.227`. When the address changes, issue a new leaf containing the
  new address and restart the Host.
- Before selecting a retained generation, check both the CA and leaf validity
  windows and renew with a safety margin. The current `validateGeneration`
  checks digests, key correspondence, issuer relationship, and hostname/IP
  matching, but does not itself check `notBefore` or `notAfter`.

## Chromium and Chrome

Chromium's certificate-lifetime rule limits newly issued TLS server
certificates from CAs trusted in a default browser installation to 398 days.
Chromium explicitly says the rule does **not** apply to a locally operated CA
that has been manually configured and has no certification path to a default
public trust anchor. Pidex may therefore choose its own private-CA and leaf
lifetime policy, subject to normal Windows and TLS validity checks.

Chromium's browser-provided public root data does not remove the need to
install/configure a private root for local development. The root must be
trusted by the browser's local/enterprise trust path on each client.

`http://localhost` receives secure-context treatment for some web-platform
features, but that is not a TLS certificate exemption. Pidex listens for TLS
on port `7443`; clients using `https://localhost:7443` still need a trusted
chain, valid dates, and a matching `DNS:localhost` SAN. Chromium exposes
`--allow-insecure-localhost` as an explicit testing switch that ignores invalid
localhost certificate errors. It must not be part of the normal development
trust or LAN workflow, and it does not make an arbitrary LAN IP valid.

## Microsoft Edge

Edge's current verifier/root-store behavior is version-sensitive:

- On Windows, Edge 112 introduced browser-provided Microsoft Root Store
  verification for public trust. The transitional `MicrosoftRootStoreEnabled`
  policy was removed for Windows/macOS in Edge 115 and is obsolete/nonworking
  after the documented cutoff; do not build the Pidex workflow around that
  policy.
- Edge continues to handle locally installed roots as local anchors, but
  local-anchor verification can be stricter than a simple “root is installed”
  check.
- Constraints encoded into platform trust anchors were opt-out during the
  transition and are always enforced from Edge 128. A constrained private root
  must therefore be usable for the requested DNS/IP identities.
- On Windows Edge 123 and later, enabling
  `RequireOnlineRevocationChecksForLocalAnchors` hard-fails certificates under
  local anchors when OCSP/CRL status cannot be obtained. A private development
  CA with no reachable revocation service should not assume this policy is
  enabled, and should document the behavior if managed machines enforce it.

The practical rule is to issue a conventional, unconstrained end-entity leaf
with the exact SANs needed by Pidex, install the public CA through the managed
Windows trust path, and test on the target Edge version and enterprise policy
set.

## Node.js

Node's trust configuration is process-specific and version-sensitive. The
relevant current controls are:

- `--use-system-ca` adds the operating-system CA store to Node's CA sources on
  supported current releases. Do not assume that a Windows Root-store import
  is visible to a Node process running an older release or a different account.
- `NODE_EXTRA_CA_CERTS=<file>` extends Node's CA set with PEM certificates, but
  Node reads it only when the process starts. Changing the variable or file
  during a running Host does not update existing trust; restart the process.
  An explicit TLS/HTTPS `ca` option replaces the default CA set, so it can also
  bypass the extra-cert behavior.
- `tls.getCACertificates('default')` reports the certificates used by default;
  it is useful for diagnostics. Newer Node releases also expose the system,
  bundled, and extra CA categories and APIs for setting defaults.
- Node performs hostname verification separately from chain trust. The default
  `tls.checkServerIdentity` and `X509Certificate.checkHost`/`checkIP` require
  the requested DNS name or IP to match the appropriate SAN. Do not set
  `rejectUnauthorized: false` to compensate for missing CA configuration.

For local Node clients, the supported choices are to run a Node version with
system-CA support under the account that trusts the root, provide
`NODE_EXTRA_CA_CERTS` before process startup, or pass the public CA explicitly
as the client `ca` option. The process must still connect using a name/address
present in the leaf SAN.

## Renewal and rollout policy

1. Persist one CA key/certificate identity for the Host. Protect the private
   key and never transfer it to a LAN client.
2. On every startup, parse and validate CA and leaf dates, chain relationship,
   key correspondence, intended usage, and all configured SANs.
3. Reissue the leaf before its safety margin expires or whenever
   `PIDEX_HOSTNAME` changes. Keep the CA unchanged, so existing client trust
   remains valid.
4. Publish a complete generation atomically and select only a complete,
   coherent generation. Keep the current generation available until the new
   one is validated.
5. If the CA itself is near expiry or its key must be replaced, create a new
   CA generation, distribute/import its public certificate on every client,
   then retire the old root after all leaves and clients have migrated.
6. Treat clock skew, Edge managed policies, Node process restarts, and Windows
   current-user versus machine scope as explicit diagnostics when reporting a
   trust failure.

This preserves the existing design's useful separation between a durable CA,
shorter-lived leaf generations, current-user Windows protection, and atomic
material selection while making date and certificate-profile validation
explicit requirements.

## Sources

- [Windows `CertGetCertificateChain`](https://learn.microsoft.com/en-us/windows/win32/api/wincrypt/nf-wincrypt-certgetcertificatechain)
- [Windows local-machine and current-user stores](https://learn.microsoft.com/en-us/windows-hardware/drivers/install/local-machine-and-current-user-certificate-stores)
- [Windows certificate chains](https://learn.microsoft.com/en-us/windows/win32/seccrypto/certificate-chains)
- [Microsoft Schannel manual validation](https://learn.microsoft.com/en-us/windows/win32/secauthn/manually-validating-schannel-credentials)
- [Chromium certificate lifetimes](https://chromium.googlesource.com/chromium/src/+/HEAD/net/docs/certificate_lifetimes.md)
- [Chromium Chrome Root Store](https://chromium.googlesource.com/chromium/src/+/main/net/data/ssl/chrome_root_store/README.md)
- [Chromium `allow-insecure-localhost` switch](https://chromium.googlesource.com/chromium/src/+/lkgr/content/public/common/content_switches.cc)
- [Edge `MicrosoftRootStoreEnabled`](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/microsoftrootstoreenabled)
- [Edge `EnforceLocalAnchorConstraintsEnabled`](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-browser-policies/enforcelocalanchorconstraintsenabled)
- [Edge `RequireOnlineRevocationChecksForLocalAnchors`](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-browser-policies/requireonlinerevocationchecksforlocalanchors)
- [Edge `CACertificatesWithConstraints`](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/cacertificateswithconstraints)
- [Node CLI options](https://nodejs.org/api/cli.html)
- [Node TLS APIs](https://nodejs.org/api/tls.html)
- [Node crypto/X.509 APIs](https://nodejs.org/api/crypto.html)
- [RFC 5280, Internet X.509 PKI](https://www.rfc-editor.org/rfc/rfc5280.html)
- [RFC 9525, Service Identity in TLS](https://www.rfc-editor.org/rfc/rfc9525.html)
- [Pidex certificate implementation](../../packages/host/src/certificate.ts)
- [Pidex LAN access guide](../development-lan-access.md)
