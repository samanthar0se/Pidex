# Windows computer-use session requirements

Pidex can expose Pi computer-use tools only when the Host, its Pi worker, the
computer-use helper, and the target application run in the same signed-in
user's interactive Windows session. A Host or worker running in Session 0 as a
Windows service cannot discover or control windows on the user's console or
Remote Desktop session.

The development Scheduled Task preserves this requirement by using a per-user
`Interactive` logon principal. The packaged launcher must preserve the same
boundary: do not convert the Host or Pi workers to a Windows service, a batch
logon, or a task that runs while the user is logged off. The desktop must be
signed in and unlocked while computer-use actions execute.

## Failure signature

Session isolation can look like a healthy installation:

- helper diagnostics report the expected protocol and architecture invariants;
- accessibility and capture checks report available;
- managed Chrome works through CDP;
- `find_roots` nevertheless returns no desktop roots.

Managed-browser success is not proof that desktop computer use works because
CDP does not require Windows UI Automation access to another session's desktop.

## Verification

Run these checks from the Host or Pi worker process context:

```powershell
query session
(Get-Process -Id $PID).SessionId
Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } |
  Select-Object ProcessName, Id, MainWindowTitle, SessionId
```

The Host/worker session ID must match the target application's active session
ID. Then open a harmless application such as Notepad and verify the complete
computer-use path:

1. `find_roots` returns the Notepad window.
2. `observe_ui` returns a state and semantic element refs.
3. `search_ui` can query that immutable state.
4. A harmless checked action returns a successor state.

If the Host reports Session 0 while `query session` shows the user on another
active session, fix the launcher context rather than changing accessibility
permissions or reinstalling the helper.
