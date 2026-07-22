# Development LAN access

The development Host serves plain HTTP on IPv4 wildcard port `7443`. Start it
with:

```console
npm run dev
```

Startup prints `http://localhost:7443` for local access and the literal
`http://<LAN-IP>:7443` template for another machine. Replace `<LAN-IP>` with the
Host machine's IPv4 address. Pidex does not discover an address or inspect or
change firewall settings. `PIDEX_PORT` explicitly selects another port.

This unauthenticated prototype gives anyone who can reach the port full view
and control. Use only disposable, non-sensitive evaluation data on an
operator-controlled LAN; do not expose it to the Internet.
