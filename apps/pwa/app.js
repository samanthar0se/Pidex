const ws = new WebSocket(`wss://${location.host}/control`);
ws.addEventListener("message", ({data}) => {
  const {status: s} = JSON.parse(data);
  document.querySelector("#status").innerHTML = `<dt>Host identity</dt><dd>${s.hostId}</dd><dt>Release identity</dt><dd>${s.releaseId}</dd><dt>Readiness</dt><dd>${s.readiness}</dd><dt>Synchronization basis</dt><dd>${s.synchronization.cursor}</dd>`;
});
