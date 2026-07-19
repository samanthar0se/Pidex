# Development LAN access

The development Host listens on HTTPS port `7443` and binds to `0.0.0.0`, but
the source checkout does not bundle the Windows Firewall bridge used by the
packaged application. Windows may therefore block connections from another
computer even though `https://localhost:7443` works.

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

Opening the port only resolves TCP timeouts. The development certificate is
issued by a Host-private CA trusted for the current user on the Host, and its
leaf certificate covers `localhost` and `127.0.0.1`, not the Host's LAN IP.
Remote browsers therefore require a deliberate certificate trust and hostname
setup. Do not treat disabled certificate verification as a permanent solution.

Runtime data under `.pidex-data/` contains Host-local state and certificate
material and must not be committed.
