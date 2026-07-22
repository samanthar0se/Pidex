# Prototype LAN operation

Pidex’s anonymous runtime is only for disposable, non-sensitive evaluation data on an operator-controlled LAN. Prototype LAN reachability grants full control; Pidex does not determine whether a network is private or safe.

The Host binds IPv4 wildcard and serves plain HTTP and WebSocket connections. Development defaults to `http://0.0.0.0:7443`; the unpacked Host defaults to `http://0.0.0.0:47831`. Replace `<LAN-IP>` in the startup guidance with an address selected by the operator. Browser and CLI Clients need no setup or credentials.

Network isolation is the operator’s responsibility. Pidex does not inspect, configure, or repair Windows Firewall, discover a LAN address, or provide confidentiality or peer identity. Do not expose the Host to the Internet or use it with sensitive or valuable data.

Future production distribution or support requires a separate hardening design; this prototype does not preselect that architecture.
