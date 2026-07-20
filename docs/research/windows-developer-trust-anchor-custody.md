# Windows Developer Trust-Anchor Custody

## Answer

Windows has a supported, unelevated per-user composition for Pidex:

1. Resolve a canonical data root below `FOLDERID_LocalAppData` for the signed-in
   user, rather than putting the authority under a checkout or under
   `LocalMachine`.
2. Keep the CA private key either as a versioned file protected by classic
   DPAPI with the default current-user scope, or as a persisted current-user CNG
   key. The first option fits Pidex's current Node/OpenSSL seam. The second
   keeps long-lived key operations in a Windows key-storage provider but needs a
   native CNG signing seam.
3. Keep the public CA certificate separate from the private key and add only
   that public certificate to the `Root` store at
   `CERT_SYSTEM_STORE_CURRENT_USER`. Use the store's user `.Default` physical
   store (or the equivalent `Cert:\CurrentUser\Root` operation), never a machine
   store.
4. Restrict the Pidex data directory and DPAPI envelopes with a protected DACL
   containing only the current user's intended access. Treat this as access
   control, not as protection from an administrator, backup privilege, or a
   process already running as that user.
5. Verify the resulting public root by thumbprint and by a current-user chain
   build. Verify the private key's cryptographic correspondence and the CA
   identity before every use. Setup is idempotent only when the existing
   certificate, key, metadata, ACL, and trust projection agree; disagreement
   must fail closed rather than silently replacing the CA.

These primitives support persistence across normal process exit and reboot when
the user profile, registry hive, protected key material, and storage remain
available. They do **not** provide an unconditional physical-media or
sudden-power-loss guarantee. Successful Windows flush operations are a
conditional persistence boundary toward the device; they do not make a
certificate-store update and a file-generation update one atomic transaction.

## Pidex boundary

The current repository already concentrates this work behind
`WindowsPlatformAdapter`: `protectForCurrentUser`, `unprotectForCurrentUser`,
`restrictToCurrentUser`, and `trustCurrentUserCertificate`. The current
certificate implementation creates retained TLS generations under the supplied
Host data directory, stores `pidex-ca.pem` publicly and
`pidex-ca-key.dpapi`/`host-key.dpapi` as protected material, then passes the
unprotected host key and certificate to Node TLS. See
[`packages/adapters/src/index.ts`](https://github.com/samanthar0se/Pidex/blob/ee94331/packages/adapters/src/index.ts#L136-L143)
and
[`packages/host/src/certificate.ts`](https://github.com/samanthar0se/Pidex/blob/ee94331/packages/host/src/certificate.ts#L48-L94).

That makes the DPAPI-envelope design the lowest-risk implementation choice:
Node's documented TLS API accepts PEM or a `Buffer` for `key` and `cert`, while
the native adapter can perform DPAPI and Windows trust operations. A CNG key
handle is not a documented input to the current Node TLS `key` option. Node's
engine-based private-key options are deprecated, so choosing CNG for a signing
key requires a deliberately supported native bridge rather than assuming that
Node/OpenSSL will consume an `NCRYPT_KEY_HANDLE`.

The existing durability research also applies here: generation files should be
staged, validated, flushed, and published on one volume; at least one older
valid generation should remain; and startup must reconstruct from validated
generations rather than trusting a selector. That protocol makes custody
recoverable, not physically indestructible.

## Primitive inventory

### Per-profile location

`FOLDERID_LocalAppData` is a Microsoft `PERUSER` known folder whose documented
default is `%LOCALAPPDATA%` (`%USERPROFILE%\AppData\Local`). Use
`SHGetKnownFolderPath(FOLDERID_LocalAppData, ...)` instead of constructing a
profile path from `USERNAME` or a checkout path. This establishes a stable
per-user location for Pidex metadata, protected envelopes, retained public
certificates, and recovery evidence. It does not establish that the resolved
volume is fixed, local, NTFS, or protected against power loss; retain Pidex's
separate storage-coverage classification.

Microsoft documents the Current User certificate stores separately, under
`HKEY_CURRENT_USER\Software\Microsoft\SystemCertificates`. Therefore the
certificate store itself is already profile-scoped; it should not be duplicated
inside every checkout.

Sources:

- [KNOWNFOLDERID: `FOLDERID_LocalAppData`](https://learn.microsoft.com/en-us/windows/win32/shell/knownfolderid)
- [SHGetKnownFolderPath](https://learn.microsoft.com/en-us/windows/win32/api/shlobj_core/nf-shlobj_core-shgetknownfolderpath)
- [Windows Certificate System Store Locations and Registry Paths](https://learn.microsoft.com/en-us/windows/win32/seccrypto/system-store-locations)

### Classic DPAPI: recommended baseline

`CryptProtectData` with `dwFlags == 0` protects a `DATA_BLOB` so that normally
only a user with matching logon credentials on the same computer can decrypt
it. `CRYPTPROTECT_LOCAL_MACHINE` must **not** be used: Microsoft documents that
it allows any user on that computer to decrypt the result. A roaming profile is
an explicitly documented exception in which the same user may decrypt on
another computer; that exception is not a general migration guarantee.

Use `CryptProtectData` and `CryptUnprotectData` with a `NULL` prompt structure
and `CRYPTPROTECT_UI_FORBIDDEN` for the non-interactive Host path. Optional
entropy is supported, but it must be available and identical during unprotect;
it is not a useful independent recovery secret unless Pidex deliberately
custodies it. The protected blob includes a MAC for tamper detection, but
Microsoft warns that corrupted input can produce varying errors and in some
cases corrupted output. Pidex should therefore add an envelope version,
expected key role, public-key/certificate identity, length, and application
digest checks rather than treating a successful unprotect alone as proof.

DPAPI protects the key material; it does not make the containing file durable.
The file must be published and flushed by the filesystem protocol below. The
documented availability boundary is the same user profile and, normally, the
same computer, while the file and the DPAPI user credentials/master-key
material remain available.

Sources:

- [`CryptProtectData`](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata)
- [`CryptUnprotectData`](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptunprotectdata)
- [CNG DPAPI](https://learn.microsoft.com/en-us/windows/win32/seccng/cng-dpapi)

Do not substitute `CryptProtectMemory` for a persisted envelope. Microsoft
documents it for temporary data in the same process or across processes, not as
the profile-persistent custody primitive.

### CNG persisted key: supported alternative

The Microsoft Software Key Storage Provider supports persisted asymmetric keys
and key isolation. The CNG operation is:

1. `NCryptOpenStorageProvider` for `MS_KEY_STORAGE_PROVIDER`.
2. `NCryptCreatePersistedKey` with a stable, Pidex-owned key name and without
   `NCRYPT_MACHINE_KEY_FLAG`; Microsoft documents that omission as current-user
   scope.
3. Set `NCRYPT_KEY_USAGE_PROPERTY` to signing and set a persistent
   `NCRYPT_SECURITY_DESCR_PROPERTY` DACL if the provider reports that security
   descriptors are supported.
4. Leave the export policy without `NCRYPT_ALLOW_EXPORT_FLAG` or
   `NCRYPT_ALLOW_PLAINTEXT_EXPORT_FLAG`; verify the resulting property and
   explicitly test that an export is refused before treating the key as
   non-exportable.
5. Call `NCryptFinalizeKey`; the key cannot be used before finalization. Reopen
   it later with `NCryptOpenKey` without the machine flag and sign with
   `NCryptSignHash`. Explicit reset can use `NCryptDeleteKey` after trust has
   been removed and no retained generation refers to the key.

Microsoft documents user private CNG keys under
`%APPDATA%\Microsoft\Crypto\Keys`, while shared/machine locations differ.
That is a provider-owned storage location, not a Pidex-managed arbitrary path.
Do not infer that a key file may be copied, renamed, or restored independently
of the KSP. CNG's key-isolation architecture is valuable because long-lived
private keys can stay out of the application process, but a native signer must
still be designed and tested.

The CNG route can establish a durable current-user CA signing capability, but
it changes the module seam. It does not directly satisfy the current code's
need to hand Node TLS a PEM host key. A reasonable split is a CNG-protected CA
signing key plus a DPAPI-protected leaf key if the native bridge only signs
certificates, or a fully native TLS/private-key path if non-exportable leaf
keys are also required. That is an architecture choice for a later module
ticket, not a reason to replace the DPAPI baseline in this research ticket.

Sources:

- [Key Storage and Retrieval](https://learn.microsoft.com/en-us/windows/win32/seccng/key-storage-and-retrieval)
- [`NCryptCreatePersistedKey`](https://learn.microsoft.com/en-us/windows/win32/api/ncrypt/nf-ncrypt-ncryptcreatepersistedkey)
- [`NCryptOpenKey`](https://learn.microsoft.com/en-us/windows/win32/api/ncrypt/nf-ncrypt-ncryptopenkey)
- [`NCryptSetProperty`](https://learn.microsoft.com/en-us/windows/win32/api/ncrypt/nf-ncrypt-ncryptsetproperty)
- [Key Storage Property Identifiers](https://learn.microsoft.com/en-us/windows/win32/seccng/key-storage-property-identifiers)
- [`NCryptFinalizeKey`](https://learn.microsoft.com/en-us/windows/win32/api/ncrypt/nf-ncrypt-ncryptfinalizekey)
- [`NCryptSignHash`](https://learn.microsoft.com/en-us/windows/win32/api/ncrypt/nf-ncrypt-ncryptsignhash)
- [`NCryptDeleteKey`](https://learn.microsoft.com/en-us/windows/win32/api/ncrypt/nf-ncrypt-ncryptdeletekey)

### ACLs

Windows assigns a new file or directory a default security descriptor inherited
from its parent when `lpSecurityAttributes` is `NULL`. That is not sufficient
for a user-only custody claim. At creation or immediately after creation, build
an explicit DACL for the current user's SID, remove broad inherited access, and
set `PROTECTED_DACL_SECURITY_INFORMATION` (equivalently
`SE_DACL_PROTECTED`) so later parent inheritance cannot add ACEs. The relevant
operations are `SetEntriesInAcl`, `SetNamedSecurityInfo` or
`SetSecurityInfo`, and `GetNamedSecurityInfo`/`GetSecurityDescriptorControl`
for read-back. Verify the DACL and effective access before accepting the
directory; do not merely inspect the path string.

The minimal intended policy is current-user access required to create, read,
replace, and delete Pidex custody material, with no `Everyone`, broad `Users`,
or inherited ACE granting access to other interactive users. The exact
`SYSTEM`/backup policy is an implementation parameter: retaining an explicit
service/backup principal would no longer be a literal user-only policy, while
removing it can affect backup and recovery tooling. Whichever policy is chosen,
record it and verify it on every setup/open.

ACLs are authorization, not encryption. Microsoft documents backup/restore
privileges that can override ordinary file ACLs, and an administrator can take
ownership or alter DACLs. DPAPI or CNG remains the key-protection boundary;
ACLs primarily prevent accidental exposure, sibling-user access, and ordinary
path tampering.

Sources:

- [File Security and Access Rights](https://learn.microsoft.com/en-us/windows/win32/fileio/file-security-and-access-rights)
- [SECURITY_INFORMATION](https://learn.microsoft.com/en-us/windows/win32/secauthz/security-information)
- [`SetEntriesInAcl`](https://learn.microsoft.com/en-us/windows/win32/api/aclapi/nf-aclapi-setentriesinaclw)
- [`SetNamedSecurityInfo`](https://learn.microsoft.com/en-us/windows/win32/api/aclapi/nf-aclapi-setnamedsecurityinfow)
- [`GetNamedSecurityInfo`](https://learn.microsoft.com/en-us/windows/win32/api/aclapi/nf-aclapi-getnamedsecurityinfow)
- [`GetSecurityDescriptorControl`](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-getsecuritydescriptorcontrol)
- [`SetSecurityDescriptorControl`](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-setsecuritydescriptorcontrol)
- [ACE Inheritance Rules](https://learn.microsoft.com/en-us/windows/win32/secauthz/ace-inheritance-rules)

### Filesystem publication and flush

Use a Pidex-managed directory below `LocalAppData`, preferably on the same
volume for all generations. For each generation:

1. Create a unique staging directory and files with exclusive creation.
2. Write a self-describing envelope containing a schema version, immutable CA
   identity, key role, lengths, and hashes of every public/protected material
   file.
3. Close any plaintext private-key writer after protecting the key; remove the
   plaintext staging copy before publication.
4. Validate the complete generation, including CA-to-private-key
   correspondence, before publication.
5. Flush writable files with `FlushFileBuffers` (Node `fsync` is the portable
   seam already used by Pidex; a native adapter may call the Win32 API directly)
   and treat a failed flush as a failed publication.
6. Publish by a same-volume rename/replacement and validate the published
   result. Do not use cross-volume `MOVEFILE_COPY_ALLOWED` for an authoritative
   transition: Microsoft documents that it becomes copy-and-delete.
7. Retain an older independently valid generation until a later startup-equivalent
   verification proves it is safe to collect.

`FlushFileBuffers` writes buffered information for an open file to the device
and requires `GENERIC_WRITE`. Microsoft also documents that file metadata is
cached and that `FILE_FLAG_WRITE_THROUGH` or an explicit flush is needed to
persist metadata changes. `MOVEFILE_WRITE_THROUGH` waits for the move and
guarantees a flush at the end of a copy-and-delete move, but Microsoft does not
specify an exactly-old-or-new sudden-power-loss result for a same-volume
namespace replacement. `ReplaceFile` likewise does not establish that stronger
contract.

The Current User certificate store is registry-backed. Microsoft documents
that registry-provider store changes are immediately persisted to the registry,
and `CertControlStore(CERT_STORE_CTRL_COMMIT)` reports successful copying to
persisted storage; for a provider that automatically persists, the commit is
ignored. If Pidex needs an explicit registry-hive persistence fence after the
trust projection, `RegFlushKey(HKEY_CURRENT_USER)` is documented to return only
after the hive data has been written to the registry store on disk. It is
expensive and flushes other changed keys in the hive, so it should be a native,
deliberate policy choice, not an assumption hidden in every certificate add.

The file generation and registry trust projection cannot be committed as one
Win32 transaction. Treat the Root-store entry as a rebuildable projection:
publish and verify the key/certificate generation first, add/verify the Root
entry second, and repair a missing matching Root entry on later explicit setup.
If either side is contradictory, report recovery/reset rather than silently
generating a new CA.

Sources:

- [WriteFile](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-writefile)
- [File Caching](https://learn.microsoft.com/en-us/windows/win32/fileio/file-caching)
- [FlushFileBuffers](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers)
- [MoveFileEx](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexw)
- [ReplaceFile](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-replacefilew)
- [RegFlushKey](https://learn.microsoft.com/en-us/windows/win32/api/winreg/nf-winreg-regflushkey)
- [Managing a Certificate Store State](https://learn.microsoft.com/en-us/windows/win32/seccrypto/managing-a-certificate-store-state)

## Trust operations

### Native product path

The native bridge should:

1. Open `Root` using `CertOpenStore` with
   `CERT_SYSTEM_STORE_CURRENT_USER`. For an unambiguous user write, open the
   `Root.Default` physical store with `CERT_STORE_PROV_PHYSICAL_W`; the
   documented Current User logical stores are under HKCU and their `Root`
   collection also has read-only/system-derived members.
2. Add the exact self-signed CA certificate with
   `CertAddCertificateContextToStore` and `CERT_STORE_ADD_USE_EXISTING`. This
   disposition makes repeated setup idempotent for the same matching
   certificate while avoiding duplicate entries. Never use `ADD_ALWAYS` for
   setup.
3. Optionally call `CertControlStore(..., CERT_STORE_CTRL_COMMIT, NULL)` and
   handle a provider failure as a failed trust projection. For the registry
   provider, Microsoft documents immediate persistence; an explicit
   `RegFlushKey(HKEY_CURRENT_USER)` is an additional expensive fence, not a
   certificate-store transaction.
4. Close the store and reopen it. Find the exact certificate by SHA-256/DER
   identity and confirm that the stored DER equals the generation's public CA.
5. Build a chain for a Pidex leaf with `CertGetCertificateChain`, using its
   default `HCCE_CURRENT_USER` chain engine, then apply
   `CertVerifyCertificateChainPolicy` with `CERT_CHAIN_POLICY_SSL` and the
   server-auth expected usage. The latter function returns whether policy could
   be checked; the caller must inspect `dwError == 0` for a pass. It does not
   itself perform revocation checking.

Explicit reset reverses the operation: locate only the exact Pidex CA
certificate by identity, call `CertDeleteCertificateFromStore`, close and
verify absence, then remove the corresponding retained key generations only
under the separate reset/retention policy. Never delete all user roots and
never treat a missing root as permission to mint a replacement during ordinary
startup.

Sources:

- [`CertOpenStore`](https://learn.microsoft.com/en-us/windows/win32/api/wincrypt/nf-wincrypt-certopenstore)
- [`CertAddCertificateContextToStore`](https://learn.microsoft.com/en-us/windows/win32/api/wincrypt/nf-wincrypt-certaddcertificatecontexttostore)
- [`CertDeleteCertificateFromStore`](https://learn.microsoft.com/en-us/windows/win32/api/wincrypt/nf-wincrypt-certdeletecertificatefromstore)
- [`CertCloseStore`](https://learn.microsoft.com/en-us/windows/win32/api/wincrypt/nf-wincrypt-certclosestore)
- [`CertControlStore`](https://learn.microsoft.com/en-us/windows/win32/api/wincrypt/nf-wincrypt-certcontrolstore)
- [`CertGetCertificateChain`](https://learn.microsoft.com/en-us/windows/win32/api/wincrypt/nf-wincrypt-certgetcertificatechain)
- [`CertVerifyCertificateChainPolicy`](https://learn.microsoft.com/en-us/windows/win32/api/wincrypt/nf-wincrypt-certverifycertificatechainpolicy)

### Supported operator fallbacks

For a human-operated setup or recovery flow, Microsoft documents both of these
Current User operations:

```powershell
Import-Certificate -FilePath "$env:TEMP\pidex-ca.cer" -CertStoreLocation Cert:\CurrentUser\Root
certutil -user -addstore Root "$env:TEMP\pidex-ca.cer"
```

`Import-Certificate` explicitly targets `Cert:\CurrentUser\Root`. `certutil`
documents `-user` as using HKCU keys or the user certificate store and
documents `-addstore`/`-delstore`. Microsoft cautions that `certutil` is an
administrator/developer tool and is not recommended in production code; use
the native CryptoAPI bridge for Pidex's idempotent, fingerprint-bound path.

### Browser and Node availability

- **Windows chain consumers:** The Windows Trusted Root Certification
  Authorities store is the trust store for roots Windows trusts. A Current
  User `Root` entry is available to the current user's Windows chain engine;
  the default `CertGetCertificateChain` engine is explicitly
  `HCCE_CURRENT_USER`.
- **Microsoft Edge:** Since Edge 112 on Windows, Edge ships its default list
  and verifier, but Microsoft says it still queries the underlying platform
  for and trusts locally installed user/enterprise roots. Edge's built-in
  verifier is stricter about RFC 5280 details than the old platform verifier;
  Pidex CA and leaf profiles must therefore be standards-conformant. The old
  `MicrosoftRootStoreEnabled` policy was removed in Edge 115, so do not design
  around opting Edge back to the old verifier.
- **Google Chrome/Chromium:** Chrome's Chrome Root Store and common verifier
  became enabled by default on Windows in Chrome 108. Chrome's first-party FAQ
  documents that, for TCP TLS, it automatically consumes certificates added to
  the Current User Trusted Root Certification Authorities store. Pidex's HTTPS
  and WebSocket connections use TCP, so the Current User Root projection is
  the supported browser path. The FAQ separately says QUIC considers local
  trust only for removing trust; do not generalize the TCP add-trust statement
  to QUIC.
- **Node:** Node TLS is OpenSSL-based. Its documented default CA list is the
  bundled Mozilla snapshot, not automatically the Windows Current User store.
  Recent Node releases provide `--use-system-ca`/`tls.getCACertificates('system')`
  and document the Windows Current User Trusted Root store as an input, but
  those flags are versioned additions after the repository's broad Node 22+
  floor. For a version-independent Pidex Node client, pass the public CA via
  the `ca` option or use `NODE_EXTRA_CA_CERTS` at process launch. The Pidex Host
  server still receives its own `key` and `cert`; installing the Root entry
  does not supply the server private key to Node.

Sources:

- [Trusted Root Certification Authorities Certificate Store](https://learn.microsoft.com/en-us/windows-hardware/drivers/install/trusted-root-certification-authorities-certificate-store)
- [Microsoft Edge TLS server certificate verification](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-security-cert-verification)
- [Chrome Root Store FAQ](https://chromium.googlesource.com/chromium/src/+/main/net/data/ssl/chrome_root_store/faq.md)
- [Node `tls` API](https://nodejs.org/api/tls.html)
- [Node CLI: `--use-system-ca` and `NODE_EXTRA_CA_CERTS`](https://nodejs.org/api/cli.html#--use-system-ca)
- [Node first-party `secure-context.js`](https://github.com/nodejs/node/blob/v22.14.0/lib/internal/tls/secure-context.js)
- [Node CLI: `NODE_EXTRA_CA_CERTS`](https://nodejs.org/api/cli.html#node_extra_ca_certsfile)

## Durability and availability claims

The following table deliberately distinguishes a documented capability from a
Pidex recommendation and from a claim that must not be made.

| Boundary | Supported claim | Boundary or failure |
| --- | --- | --- |
| Current User scope | Current User stores and CNG keys can be opened without `LocalMachine` scope; default DPAPI protects to the same user on the same computer. | Other Windows users are not the supported custody reader. A roaming profile is an explicit DPAPI exception, not general portability. |
| Checkout sharing | A profile-rooted store and canonical profile data directory can be reused by every Pidex checkout/worktree for that user. | A checkout-local CA cannot provide the required shared identity. A profile path alone does not prove storage quality. |
| Normal restart/reboot | Persisted registry/file/CNG state is available again if the profile and storage remain readable and the operations completed successfully. | Microsoft does not turn a successful key/store/file API call into a guarantee against profile deletion, corruption, failed storage, or power removal. |
| DPAPI confidentiality | A different user normally cannot decrypt a default-scope DPAPI envelope; the envelope also authenticates protected data. | An administrator/backup privilege or a process already running as the user is outside an ACL-only threat boundary. DPAPI unprotect success still needs application identity checks. |
| ACL isolation | A protected DACL can block ordinary access and prevent later inherited ACEs. | ACLs are not encryption and can be overridden by backup/restore privileges or administrators. |
| File durability | `FlushFileBuffers` and, where deliberately used, `RegFlushKey` provide documented write/flush completion boundaries toward Windows storage. | Neither documents stable nonvolatile media under arbitrary hardware, firmware, hypervisor, or sudden power loss. Directory namespace replacement is not documented as exactly old-or-new. |
| Recovery | Checksummed retained generations allow deterministic recovery if at least one complete generation remains. | Recovery may select an older generation or enter recovery mode; it cannot prove the newest generation survived an unqualified power cut. |
| Browser trust | Current User Root is consumed for TCP TLS by current Edge and Chrome/Chromium behavior documented by their vendors. | Browser version, policy, verifier cache, certificate profile, and RFC 5280 validity still matter. QUIC and arbitrary clients have different contracts. |
| Node trust | Explicit `ca` or launch-time `NODE_EXTRA_CA_CERTS` is available; recent Node can consume Windows system trust with `--use-system-ca`. | The repository's generic Node 22+ requirement does not imply every installed Node patch has the system-CA feature. Do not assume Current User Root automatically configures OpenSSL. |
| CNG key isolation | Microsoft Software KSP can retain a current-user key and sign through `NCryptSignHash`; key security descriptors and export policy are available. | A CNG key is provider-owned and needs a native Pidex signing seam. CNG does not automatically make the existing PEM-based Node TLS server use the key. |

## Implementation-ready baseline

Unless the later module decision explicitly chooses CNG, implement the following
baseline:

1. Resolve `FOLDERID_LocalAppData` and derive one stable Pidex trust-anchor
   directory independent of all Workspaces and checkouts.
2. Serialize explicit setup/reset operations with a Host-local lock. Create the
   directory and apply a protected current-user DACL; read back and verify the
   policy.
3. On first setup only, generate a CA and leaf identity in private staging,
   protect the CA and leaf private keys with default-scope DPAPI, and retain a
   public CA certificate plus versioned identity metadata. Zero and remove
   plaintext private-key staging before publishing.
4. Publish a complete, hashed generation with the existing Pidex
   flush/validate/rename/recovery protocol. Never overwrite the selected
   generation in place and never generate a replacement merely because trust
   installation is missing.
5. Add the exact public CA to Current User `Root.Default` with
   `CERT_STORE_ADD_USE_EXISTING`, optionally commit/flush the user hive under
   the native bridge policy, close, reopen, and fingerprint-verify it.
6. Verify the CA private key matches the public CA and that a test leaf chains
   through the Current User engine. Separately verify the leaf hostname/IP SAN
   and TLS usage before starting the Host.
7. On every later startup, load only a complete coherent generation and repair
   a missing matching Root projection. Contradictory roots, protected blobs,
   ACLs, or generations produce a typed recovery/reset cause.
8. For explicit reset/uninstall, remove only the exact Pidex root certificate,
   verify its absence, and then apply the separate retention/destruction policy
   to key generations. Do not remove unrelated Current User roots.
9. Advertise availability as conditional: same signed-in user/profile, readable
   storage, successful persistence operations, and a supported browser/Node
   trust consumer. Keep Pidex's existing degraded storage warning outside the
   fixed local NTFS boundary.

This baseline establishes one per-profile CA usable by the Pidex Host and its
TCP browser clients without elevation, while keeping the stronger CNG option
available behind a native module seam.

## Evidence classification

**Microsoft-documented guarantees:** Current User store locations; DPAPI user
and computer scope; CNG current-user versus machine flag; persisted CNG key
operations; DACL inheritance protection; file/registry flush behavior; native
certificate-store add/delete/commit and current-user chain-engine selection.

**Vendor-documented availability:** Edge and Chrome's consumption of locally
installed Current User roots for TCP TLS; Node's explicit CA inputs and its
versioned Windows system-CA support.

**Pidex recommendations:** profile-rooted identity; DPAPI envelope as the
current implementation baseline; explicit protected DACL verification;
generation publication and retained recovery; Root-store projection ordering;
fingerprint/cryptographic-coherence checks; fail-closed contradictory state;
and explicit reset.

**Not observed or not promised by the owning contracts:** a single transaction
covering the filesystem generation and Current User registry store; an
exactly-old-or-new power-loss result for rename or certificate-store writes;
stable-media persistence on arbitrary hardware; ACL resistance to an
administrator/backup privilege; automatic Windows-store use by every Node 22+
installation; or direct use of an `NCRYPT_KEY_HANDLE` as a Node TLS PEM key.
