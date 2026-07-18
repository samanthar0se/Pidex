const statusList = document.querySelector("#status");
const pairingSection = document.querySelector("#pairing");
const newSessionButton = document.querySelector("#new-session");
const newSessionView = document.querySelector("#new-session-view");
const cancelSessionButton = document.querySelector("#cancel-session");
const createSessionButton = document.querySelector("#create-session");
const projectSelect = document.querySelector("#session-project");
const workspaceSelect = document.querySelector("#session-workspace");
const sessionsNav = document.querySelector("#sessions");
const runModelSelect = document.querySelector("#run-model");
const runModeSelect = document.querySelector("#run-mode");
const runInput = document.querySelector("#run-input");
const pairingSecret = new URL(location.href).searchParams.get("pair");
const expectedHostIdKey = "pidex.expectedHostId";
const supportedCapabilities = [
  "scope.host",
  "scope.session",
  "session.create",
  "session.rename",
  "run.submit",
  "pi.model.select",
  "pi.mode.select",
  "pi.input.text",
  "pi.runtime.cancel",
];
let admittedCapabilities = new Map();
let controlSocket;
let projection = { projects: [], workspaces: [], sessions: [] };
let admitted = false;

function setControlEnabled(enabled) {
  newSessionButton.disabled = !enabled;
  createSessionButton.disabled = !enabled;
}

setControlEnabled(false);

newSessionButton.addEventListener("click", () => {
  newSessionView.hidden = false;
});
cancelSessionButton.addEventListener("click", () => {
  newSessionView.hidden = true;
});
createSessionButton.addEventListener("click", () => {
  const projectId = projectSelect.value || null;
  const workspaceId = workspaceSelect.value || null;
  const command = {
    type: "session.create",
    commandId: crypto.randomUUID(),
    projectId,
    workspaceId,
  };
  controlSocket.send(JSON.stringify(command));
  newSessionView.hidden = true;
});
projectSelect.addEventListener("change", () => {
  const workspaceOptions = projection.workspaces
    .filter(workspace => workspace.projectId === projectSelect.value)
    .map(workspace => new Option(workspace.name, workspace.workspaceId));
  workspaceSelect.replaceChildren(
    new Option("No Workspace", ""),
    ...workspaceOptions,
  );
});

// Remove the one-time secret from browser history before doing any other work.
if (pairingSecret) {
  history.replaceState(null, "", location.pathname);
  pairingSection.hidden = false;
  document
    .querySelector("#pair-device")
    .addEventListener("click", pairDevice, { once: true });
} else {
  void authenticateStoredDevice();
}

async function pairDevice() {
  const keys = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"],
  );
  const publicKey = await crypto.subtle.exportKey("jwk", keys.publicKey);
  const challenge = await post("/pair/challenge", {
    secret: pairingSecret,
    publicKey,
  });
  const signature = await signChallenge(
    keys.privateKey,
    challenge.challenge,
  );
  const device = await post("/pair/complete", {
    pairingId: challenge.pairingId,
    signature: bytesToBase64Url(signature),
  });
  await saveDevice({ deviceId: device.deviceId, privateKey: keys.privateKey });
  pairingSection.hidden = true;
  await authenticateStoredDevice();
}

async function authenticateStoredDevice() {
  const device = await loadDevice();
  if (!device) {
    return;
  }

  const challenge = await post("/pair/auth-challenge", {
    deviceId: device.deviceId,
  });
  const signature = await signChallenge(
    device.privateKey,
    challenge.challenge,
  );
  const authenticated = await post("/pair/authenticate", {
    authenticationId: challenge.authenticationId,
    signature: bytesToBase64Url(signature),
  });
  openControl(authenticated.session);
}

function openControl(session) {
  // Browser WebSocket cannot set Authorization. The URL carries only this
  // short-lived Client session; it is never persisted.
  controlSocket = new WebSocket(
    `wss://${location.host}/control?session=${encodeURIComponent(session)}`,
  );
  controlSocket.addEventListener("message", renderStatus);
}

function renderStatus({ data }) {
  const message = JSON.parse(data);
  switch (message.type) {
    case "host.hello":
      sendClientHello(message.hostId);
      return;
    case "protocol.admitted":
      admitted = true;
      admittedCapabilities = new Map(
        message.capabilities.map(item => [item.id, item]),
      );
      renderRuntimeControls();
      return;
    case "protocol.update-required":
      showControlUnavailable(`update required (${message.reason})`);
      return;
    case "delivery.resynchronize":
      showControlUnavailable("reconnecting to resynchronize");
      return;
    case "host.change-set":
      applyHostChanges(message.changes);
      return;
    case "host.snapshot":
      if (admitted) {
        renderHostSnapshot(message);
      }
      return;
  }
}

function renderRuntimeControls() {
  for (const [capabilityId, select] of [
    ["pi.model.select", runModelSelect],
    ["pi.mode.select", runModeSelect],
  ]) {
    const capability = admittedCapabilities.get(capabilityId);
    select.hidden = !capability;
    select.disabled = !capability;
    if (capability) {
      const options = capability.constraints.values.map(
        value => new Option(value, value),
      );
      select.replaceChildren(...options);
    }
  }
  runInput.disabled = !admittedCapabilities.has("pi.input.text");
}

function sendClientHello(hostId) {
  const expectedHostId = localStorage.getItem(expectedHostIdKey) || hostId;
  localStorage.setItem(expectedHostIdKey, expectedHostId);
  controlSocket.send(JSON.stringify({
    type: "client.hello",
    expectedHostId,
    protocols: [{ major: 1, minor: 1 }],
    capabilities: supportedCapabilities.map(id => ({
      id,
      minVersion: 1,
      maxVersion: 1,
    })),
  }));
}

function showControlUnavailable(readiness) {
  admitted = false;
  setControlEnabled(false);
  statusList.replaceChildren(
    ...createStatusEntry(["Readiness", readiness]),
  );
}

function applyHostChanges(changes) {
  for (const change of changes) {
    if (change.type === "session.created") {
      projection.sessions.push(change.session);
    } else if (change.type === "session.renamed") {
      projection.sessions = projection.sessions.map(session =>
        session.sessionId === change.session.sessionId
          ? change.session
          : session,
      );
    }
  }
  renderSessions();
}

function renderHostSnapshot(message) {
  setControlEnabled(true);

  const { status } = message;
  projection = {
    projects: message.projects,
    workspaces: message.workspaces,
    sessions: message.sessions,
  };

  const entries = [
    ...status.warnings.map(warning => [
      "High-severity warning",
      warning.detail,
    ]),
    ["Host identity", status.hostId],
    ["Release identity", status.releaseId],
    ["Readiness", status.readiness],
    ["Synchronization basis", status.synchronization.cursor],
  ];

  statusList.replaceChildren(...entries.flatMap(createStatusEntry));
  const projectOptions = projection.projects.map(
    project => new Option(project.name, project.projectId),
  );
  projectSelect.replaceChildren(
    new Option("Host-unscoped", ""),
    ...projectOptions,
  );
  workspaceSelect.replaceChildren(new Option("No Workspace", ""));
  renderSessions();
}

function renderSessions() {
  const groups = new Map();
  for (const session of projection.sessions) {
    const groupName = sessionGroupName(session);
    const sessions = groups.get(groupName) ?? [];
    sessions.push(session);
    groups.set(groupName, sessions);
  }

  const sessionGroups = [...groups].flatMap(([name, sessions]) => {
    const heading = document.createElement("h2");
    heading.textContent = name;
    return [heading, ...sessions.map(createSessionLink)];
  });
  sessionsNav.replaceChildren(...sessionGroups);
}

function sessionGroupName(session) {
  const project = projection.projects.find(
    item => item.projectId === session.projectId,
  );
  const workspace = projection.workspaces.find(
    item => item.workspaceId === session.workspaceId,
  );

  if (workspace) {
    return `${project.name} / ${workspace.name}`;
  }
  if (project) {
    return `${project.name} / Project Sessions`;
  }
  return "Host-unscoped";
}

function createSessionLink(session) {
  const link = document.createElement("a");
  link.href = `/sessions/${session.sessionId}`;
  link.textContent = session.name;
  return link;
}

function signChallenge(privateKey, challenge) {
  return crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    new TextEncoder().encode(challenge),
  );
}

async function post(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    credentials: "omit",
  });
  const value = await response.json();
  if (!response.ok) {
    throw new Error(value.error || "Pidex request failed");
  }
  return value;
}

function bytesToBase64Url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function deviceStore(mode) {
  return new Promise((resolve, reject) => {
    const openRequest = indexedDB.open("pidex-device", 1);
    openRequest.onupgradeneeded = () => {
      openRequest.result.createObjectStore("identity");
    };
    openRequest.onerror = () => reject(openRequest.error);
    openRequest.onsuccess = () => {
      const transaction = openRequest.result.transaction("identity", mode);
      resolve(transaction.objectStore("identity"));
    };
  });
}

async function saveDevice(device) {
  const store = await deviceStore("readwrite");
  await new Promise((resolve, reject) => {
    const request = store.put(device, "device");
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
  });
}

async function loadDevice() {
  const store = await deviceStore("readonly");
  return new Promise((resolve, reject) => {
    const request = store.get("device");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function createStatusEntry([label, value]) {
  const term = document.createElement("dt");
  term.textContent = label;

  const description = document.createElement("dd");
  description.textContent = value;

  return [term, description];
}
