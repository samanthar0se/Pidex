# Development LAN access

The development Host listens on HTTPS port `7443` and binds to `0.0.0.0`, but
the source checkout does not bundle the Windows Firewall bridge used by the
packaged application. Windows may therefore block connections from another
computer even though `https://localhost:7443` works.

Plain HTTP is not supported. An `http://` URL returns an empty response because
port `7443` expects a TLS handshake.

## Start with the LAN origin

Stop the development Host, then set its current LAN IPv4 address as the
deterministic development hostname:

```powershell
$env:PIDEX_HOSTNAME = "192.168.1.227"
npm run dev
```

Use the `https://` pairing URL printed by this command. Pidex reissues the leaf
certificate with the configured IP address while preserving its development
CA. If the Host's LAN address changes, update `PIDEX_HOSTNAME` and restart.

## Open Windows Firewall

For a Private Windows network, an administrator can add a local-subnet-only
rule from an elevated PowerShell prompt:

```powershell
New-NetFirewallRule `
  -DisplayName "Pidex 7443 (Private LAN)" `
  -Description "Allow Pidex HTTPS from the local subnet on private networks." `
  -Enabled True `
  -Direction Inbound `
  -Action Allow `
  -Profile Private `
  -Protocol TCP `
  -LocalPort 7443 `
  -RemoteAddress LocalSubnet
```

Remove the development rule when it is no longer needed:

```powershell
Remove-NetFirewallRule -DisplayName "Pidex 7443 (Private LAN)"
```

## Trust the shared Development CA once

First run `npm run dev:ca:setup` on the Host workstation. Opening the firewall
only resolves TCP timeouts; each LAN client must import the **public Development
CA certificate** from the export location printed by setup. Verify its SHA-256
fingerprint with the Host owner over a trusted channel, transfer that one public
file, and import it for the LAN client's user:

```powershell
Test-Path "$HOME\Downloads\pidex-ca.pem"
certutil -user -addstore Root "$HOME\Downloads\pidex-ca.pem"
```

Restart the browser, open the printed `https://<LAN-IP>:7443/?pair=...` URL, and
select **Pair Device**. Never copy or transfer a Development CA private key,
checkout data, a checkout-local leaf key, or an obsolete checkout certificate
path. Do not transfer the rest of `.pidex-data-dev/` and do not disable
certificate checks.

Changing `PIDEX_HOSTNAME`, replacing or renewing a leaf, and deleting a checkout
do not change the profile Development CA fingerprint and do not require trust
again on the workstation or LAN clients. The next checkout startup issues its
leaf from the same shared CA.

`npm run dev:ca:reset` is the exceptional clean break. It affects every
checkout and every previously trusted LAN client, makes a best-effort attempt
to remove the exact Current User trusted root, and may request manual trust-store
cleanup. Reset does not create a CA. Run `npm run dev:ca:setup` explicitly next,
verify that its fingerprint changed, distribute the new public certificate,
and replace the old trust entry on every client.

Runtime data under `.pidex-data-dev/` contains Host-local state and certificate
material and must not be committed.
