Type: grilling
Status: resolved
Blocked by: 01, 02

## Question

What discovery, pairing, device identity, authentication, authorization, transport-security, revocation, and project-trust model is appropriate for one developer using Pidex across a local LAN?

## Comments

Browser secure-context requirements were checked while resolving transport. A private-LAN HTTP origin cannot provide the service-worker and installability baseline required by the PWA-first destination, so HTTPS remains mandatory even though v1 trusts the LAN.

Pi's current project-trust implementation was also checked. It can gate project-local executable resources by canonical path, but Pidex deliberately overrides that gate: the user chose to trust the entire Host and leave any additional guardrails to their Pi configuration.

[Define Windows daemon operations](09-define-windows-daemon-operations.md) later revised Private-network enforcement. Pidex now uses a wildcard HTTPS listener with Windows Firewall as its only Private-profile enforcement, and warns without stopping LAN service when that enforcement cannot be verified. This accepts possible unintended Public-profile exposure while retaining every authentication, canonical-origin, and transport requirement below.

## Answer

### Trust boundary and exposure

Pidex v1 trusts the configured Windows Host, the signed-in Windows user, the entire Host filesystem and execution environment, and networks the user has classified as Private in Windows. Pidex-owned Windows Firewall rules restrict its wildcard HTTPS listener to the Private profile by default. Public-profile exposure is outside the intended default, but firewall deletion, drift, policy override, or profile misclassification only raises a prominent warning and does not stop LAN service; v1 therefore does not provide an application-level Private-only guarantee. An explicit Host-local override may also broaden the firewall policy.

The trusted-LAN assumption simplifies discovery and bootstrap; it does not create anonymous product access. An unpaired client receives only minimal discovery metadata, temporary CA-onboarding content, and the pairing exchange. Projects, Workspaces, Sessions, Timelines, runtime capabilities, status, APIs, WebSockets, and commands require Device authentication.

### Host origin and transport

Each Host has a durable cryptographic identity independent of its TLS certificate and DNS name. It exposes one canonical HTTPS origin. Authenticated APIs enforce that origin and do not treat certificate aliases, raw IP addresses, or alternate hostnames as equivalent app origins, because browser keys, installed PWAs, service workers, and local caches are origin-scoped.

Pidex v1 generates and manages a private CA and a Host certificate for the canonical origin. A later public certificate can replace the private-CA leaf without changing Host identity or paired Device state when the hostname remains unchanged. Changing the canonical origin is an explicit migration that requires PWA reinstallation and Device re-pairing; Host-owned domain data is unaffected.

A Host-local action may temporarily expose an HTTP bootstrap endpoint under the same intended Private-profile firewall policy. It serves only onboarding instructions and the public CA certificate, accepts no credentials or commands, and closes automatically. After the Device installs the CA, all pairing and product traffic uses HTTPS. There is no authenticated HTTP fallback.

### Discovery and pairing

The Host advertises minimal Pidex location metadata over mDNS only on interfaces Windows classifies as Private and presents its canonical URL through a Host-local setup surface. QR and manual hostname or IP entry provide deterministic fallbacks. Discovery is only a location hint and never grants authority.

Pairing is capability-based. A Host-local action generates a one-time pairing secret, displayed as QR and manual entry, that expires after five minutes, permits only a small bounded number of failures, and is consumed by the first successful pairing. Possession of that secret is sufficient; there is no second approval click. The secret is never exposed through discovery, the HTTP bootstrap surface, logs, or product state.

### Device identity, authentication, and authorization

During pairing, each browser profile or app installation generates a non-extractable signing key and registers its public key with the Host. That record becomes a paired Device. On Client startup and reconnect, a signed challenge establishes a short-lived authenticated connection session; Pidex does not persist a replayable long-lived bearer credential. Pairing itself has no calendar or inactivity expiry and remains valid until explicit revocation.

All paired Devices represent the same developer and have equal full v1 authority. V1 has no read-only role, per-Device scopes, or per-capability grants. Pairing must clearly state that the Device can exercise the complete Pidex product surface and, through Pi, the signed-in Windows user's machine authority.

### Revocation and recovery

The Host-local administration surface or any paired Device may revoke another Device. Revocation atomically rejects that Device's signing key, terminates all of its live Clients, invalidates its issued connection sessions, and retains a non-secret audit tombstone. It does not rotate the Host CA or disturb other Devices. Pairing the same browser profile again creates a new Device identity. Offline cache cleanup and the limits of revoking data already copied to a Device remain delegated to [Define offline cache and background behavior](14-define-offline-cache-and-background-behavior.md).

### Machine and Pi resource trust

Pidex v1 trusts the entire Host, not individual Projects, Workspaces, or paths. Any paired Device may direct supported Pidex operations at any Host directory the signed-in Windows user can access. Every Pi worker is started with project trust enabled, so project-local settings, skills, prompts, packages, and executable extensions load without a Pidex trust prompt. Pidex supplies no additional path, Workspace, or Project trust policy; users who want stricter controls must add them outside the v1 Pidex boundary.
