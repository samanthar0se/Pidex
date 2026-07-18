const statusList = document.querySelector("#status");
const controlSocket = new WebSocket(`wss://${location.host}/control`);

controlSocket.addEventListener("message", ({ data }) => {
  const { status } = JSON.parse(data);

  statusList.innerHTML = [
    ...status.warnings.map(warning => `<dt>High-severity warning</dt><dd>${warning.detail}</dd>`),
    `<dt>Host identity</dt><dd>${status.hostId}</dd>`,
    `<dt>Release identity</dt><dd>${status.releaseId}</dd>`,
    `<dt>Readiness</dt><dd>${status.readiness}</dd>`,
    `<dt>Synchronization basis</dt><dd>${status.synchronization.cursor}</dd>`,
  ].join("");
});
