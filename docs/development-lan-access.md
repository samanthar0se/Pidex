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
$env:PIDEX_ADAPTERS = "deterministic"
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

## Trust the development CA

Opening the port only resolves TCP timeouts. Copy the public
`.pidex-data/tls/pidex-ca.pem` file to the other Windows machine, verify that it
came from the Host, and import it for that user. For example, from PowerShell
on the other machine, transfer it over SSH with the source and destination on
the same command line:

```powershell
$hostUser = "User"
$hostAddress = "192.168.1.227"
scp "${hostUser}@${hostAddress}:C:/git/Pidex/.pidex-data/tls/pidex-ca.pem" "$HOME\Downloads\pidex-ca.pem"
```

Confirm that the transfer succeeded before importing the certificate:

```powershell
Test-Path "$HOME\Downloads\pidex-ca.pem"
certutil -user -addstore Root "$HOME\Downloads\pidex-ca.pem"
```

Restart the browser, open the printed `https://<LAN-IP>:7443/?pair=...` URL, and
select **Pair Device**. Never transfer `pidex-ca-key.dpapi`, `host-key.dpapi`,
the SQLite files, or the rest of `.pidex-data/`. Remove the development CA from
the other machine when it is no longer needed; do not replace trust with a
disabled certificate check.

Runtime data under `.pidex-data/` contains Host-local state and certificate
material and must not be committed.
