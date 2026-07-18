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
const submitRunButton = document.querySelector("#submit-run");
const followUpButton = document.querySelector("#follow-up");
const stopRunButton = document.querySelector("#stop-run");
const interactionArea = document.querySelector("#interaction");
const activeInteractions = new Map();
const pairingSecret = new URL(location.href).searchParams.get("pair");
const expectedHostIdKey = "pidex.expectedHostId";
const supportedCapabilities = [
  "scope.host",
  "scope.session",
  "session.create",
  "session.rename",
  "run.submit",
  "run.follow-up",
  "run.release",
  "run.cancel",
  "run.stop",
  "pi.model.select",
  "pi.mode.select",
  "pi.input.text",
  "pi.runtime.cancel",
  "presentation.effects",
  "pi.interaction.basic",
];
const presentation = { generation: null, status: new Map(), widgets: new Map() };
let admittedCapabilities = new Map();
let controlSocket;
let projection = { projects: [], workspaces: [], sessions: [] };
let admitted = false;
let observedExecution = null;

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
submitRunButton.addEventListener("click", () => sendRun("run.submit"));
followUpButton.addEventListener("click", () => sendRun("run.follow-up"));
stopRunButton.addEventListener("click", () => {
  if (!observedExecution || !presentation.generation) return;
  controlSocket.send(JSON.stringify({
    type: "run.stop", commandId: crypto.randomUUID(),
    sessionId: observedExecution.sessionId, runId: observedExecution.runId,
    workerGeneration: presentation.generation, observedState: "executing",
    observedTimelineRevision: observedExecution.timelineRevision,
    requiredCapability: "run.stop",
  }));
});

function sendRun(type) {
  const sessionId = location.pathname.match(/^\/sessions\/([^/]+)$/)?.[1];
  if (!sessionId || !runInput.value.trim()) {
    return;
  }

  controlSocket.send(JSON.stringify({
    type,
    commandId: crypto.randomUUID(),
    sessionId,
    prompt: runInput.value,
    requiredCapability: type,
  }));
  runInput.value = "";
}

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
    case "presentation.effect":
      renderPresentationEffect(message);
      return;
    case "presentation.reset":
      if (presentation.generation === message.workerGeneration) {
        resetPresentation();
      }
      return;
    case "interaction.change":
      renderInteraction(message.interaction);
      return;
    case "scope.reset":
      if (message.barrier.scope.kind === "session" && message.snapshot.runs) {
        const run = message.snapshot.runs.find(item => item.state === "executing");
        observedExecution = run ? { ...run, timelineRevision: message.barrier.resourceRevisions.timeline } : null;
        renderStop();
      }
      return;
    case "timeline.change":
      if (observedExecution && observedExecution.sessionId === message.sessionId) {
        observedExecution.timelineRevision = message.revision;
      }
      return;
    case "run.completed":
      if (observedExecution?.runId === message.run.runId) observedExecution = null;
      renderStop();
      return;
    case "run.execution":
      observedExecution = message.state === "executing" ? message : null;
      presentation.generation = message.workerGeneration;
      renderStop();
      return;
  }
}

function renderPresentationEffect(message) {
  if (
    presentation.generation &&
    presentation.generation !== message.workerGeneration
  ) {
    resetPresentation();
  }
  presentation.generation = message.workerGeneration;
  renderStop();

  const effect = message.effect;
  switch (effect.type) {
    case "title":
      document.querySelector("#pi-title").textContent = effect.text || "";
      return;
    case "status":
      renderKeyedPresentationEffect(
        effect,
        presentation.status,
        "#pi-status",
      );
      return;
    case "widget":
      renderKeyedPresentationEffect(
        effect,
        presentation.widgets,
        "#pi-widgets",
      );
      return;
    case "notification": {
      const item = document.createElement("li");
      item.textContent = `${effect.level}: ${effect.text}`;
      document.querySelector("#pi-notifications").append(item);
      return;
    }
    case "editor-text": {
      if (
        effect.disposition === "inject" &&
        document.activeElement === runInput
      ) {
        runInput.value = effect.text;
        return;
      }

      const suggestion = document.createElement("pre");
      suggestion.textContent = effect.text;
      document.querySelector("#pi-suggestions").append(suggestion);
      return;
    }
  }
}

function renderStop() {
  const visible = Boolean(observedExecution && presentation.generation && admittedCapabilities.has("run.stop"));
  stopRunButton.hidden = !visible;
  stopRunButton.disabled = !visible;
}

function renderKeyedPresentationEffect(effect, values, targetSelector) {
  if (effect.text === null) {
    values.delete(effect.key);
  } else {
    values.set(effect.key, effect.text);
  }

  document
    .querySelector(targetSelector)
    .replaceChildren(...[...values].flatMap(createStatusEntry));
}

function resetPresentation() {
  presentation.generation = null;
  presentation.status.clear();
  presentation.widgets.clear();
  for (const selector of [
    "#pi-title",
    "#pi-status",
    "#pi-widgets",
    "#pi-notifications",
  ]) {
    document.querySelector(selector).replaceChildren();
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
  const isSessionRoute = /^\/sessions\/[^/]+$/.test(location.pathname);
  submitRunButton.disabled =
    !isSessionRoute || !admittedCapabilities.has("run.submit");
  followUpButton.disabled =
    !isSessionRoute || !admittedCapabilities.has("run.follow-up");
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
  const selectedSessionId = location.pathname.match(
    /^\/sessions\/([^/]+)$/,
  )?.[1];
  if (selectedSessionId) {
    controlSocket.send(JSON.stringify({
      type: "scope.set",
      sessionIds: [selectedSessionId],
      protocolVersion: "1.1",
    }));
  }
}

function renderInteraction(interaction) {
  const isActive = interaction.state === "open" ||
    interaction.state === "resolving";
  if (isActive) {
    activeInteractions.set(interaction.interactionId, interaction);
  } else {
    activeInteractions.delete(interaction.interactionId);
  }

  const orderedInteractions = [...activeInteractions.values()]
    .sort(compareInteractionPriority);
  interactionArea.replaceChildren(
    ...orderedInteractions.map(createInteractionPanel),
  );
  interactionArea.hidden = orderedInteractions.length === 0;
}

function compareInteractionPriority(left, right) {
  if (left.deadlineAt !== null && right.deadlineAt !== null) {
    return left.deadlineAt - right.deadlineAt ||
      left.createdAt - right.createdAt;
  }
  if (left.deadlineAt !== null) {
    return -1;
  }
  if (right.deadlineAt !== null) {
    return 1;
  }
  return left.createdAt - right.createdAt;
}

function createInteractionPanel(interaction) {
  const panel = document.createElement("div");

  const message = document.createElement("p");
  // Keep extension-provided content inert rather than interpreting it as markup.
  message.textContent = interaction.payload.message;
  const control = createInteractionControl(interaction);
  const respondButton = document.createElement("button");
  respondButton.textContent = "Respond";
  const dismissButton = document.createElement("button");
  dismissButton.textContent = "Dismiss";

  respondButton.addEventListener("click", () => {
    sendInteractionResolution(interaction, control, false);
  });
  dismissButton.addEventListener("click", () => {
    sendInteractionResolution(interaction, control, true);
  });

  if (interaction.state === "resolving") {
    control.disabled = true;
    respondButton.disabled = true;
    dismissButton.disabled = true;
  }

  panel.replaceChildren(
    message,
    control,
    respondButton,
    dismissButton,
  );
  return panel;
}

function createInteractionControl(interaction) {
  if (interaction.kind === "select") {
    const select = document.createElement("select");
    const options = interaction.payload.options.map(
      value => new Option(value, value),
    );
    select.replaceChildren(...options);
    return select;
  }

  if (interaction.kind === "confirm") {
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    return checkbox;
  }

  const editor = document.createElement("textarea");
  editor.value = typeof interaction.payload.defaultValue === "string"
    ? interaction.payload.defaultValue
    : "";
  return editor;
}

function sendInteractionResolution(interaction, control, dismiss) {
  const command = {
    type: "interaction.resolve",
    commandId: crypto.randomUUID(),
    interactionId: interaction.interactionId,
    workerGeneration: interaction.workerGeneration,
    observedRevision: interaction.revision,
    dismiss,
  };
  if (!dismiss) {
    command.value = interaction.kind === "confirm"
      ? control.checked
      : control.value;
  }
  controlSocket.send(JSON.stringify(command));
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
