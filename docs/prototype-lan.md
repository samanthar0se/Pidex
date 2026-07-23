# Prototype LAN operation

Pidex’s anonymous runtime is only for disposable, non-sensitive evaluation data on an operator-controlled LAN. Prototype LAN reachability grants full control; Pidex does not determine whether a network is private or safe.

The Host binds IPv4 wildcard and serves plain HTTP and WebSocket connections. Development defaults to `http://0.0.0.0:7443`; the unpacked Host defaults to `http://0.0.0.0:47831`. Replace `<LAN-IP>` in the startup guidance with an address selected by the operator. Browser and CLI Clients need no setup or credentials.

The interactive Host uses the release-pinned Pi SDK with the signed-in user's
Pi profile. `PIDEX_WORKSPACE` selects the coding working directory. Pi tools and
extensions therefore run with that Windows user's authority; the LAN boundary
is a control boundary, not a sandbox.

Network isolation is the operator’s responsibility. Pidex does not inspect, configure, or repair Windows Firewall, discover a LAN address, or provide confidentiality or peer identity. Do not expose the Host to the Internet or use it with sensitive or valuable data.

## Chrome HTTP PWA warning

Chrome 150 on Windows can show a large **Not secure** strip in the installed
Pidex PWA even when the same HTTP origin is not labeled insecure in a normal
Chrome tab. Reinstalling the PWA does not necessarily clear it. The Pidex
manifest is same-origin and scoped from `/`; this warning is Chrome UI, not a
Pidex-rendered banner.

The verified workaround on a managed remote Windows machine is:

1. Open `chrome://flags/#unsafely-treat-insecure-origin-as-secure`, enable
   **Insecure origins treated as secure**, and enter every exact Pidex origin.
   Origins include scheme, hostname or IP address, and port; separate multiple
   origins with commas.
2. Chrome then reports that the corresponding command-line flag is
   unsupported. Suppress that second warning from an elevated PowerShell:

   ```powershell
   reg.exe add "HKLM\SOFTWARE\Policies\Google\Chrome" `
     /v CommandLineFlagSecurityWarningsEnabled `
     /t REG_DWORD `
     /d 0 `
     /f `
     /reg:64
   ```

3. Fully exit Chrome, restart it, and confirm at `chrome://policy` that
   `CommandLineFlagSecurityWarningsEnabled` is `false`.

Chrome only honors the warning-suppression policy on Windows instances joined
to Active Directory or Azure AD, or enrolled in Chrome Enterprise Core. On an
unmanaged Windows machine there may be no clean HTTP workaround; locally
trusted HTTPS is the reliable alternative. See Chrome's
[insecure-origin guidance](https://www.chromium.org/Home/chromium-security/deprecating-powerful-features-on-insecure-origins/)
and
[`CommandLineFlagSecurityWarningsEnabled` policy](https://chromeenterprise.google/policies/command-line-flag-security-warnings-enabled/).

Future production distribution or support requires a separate hardening design; this prototype does not preselect that architecture.
