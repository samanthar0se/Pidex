const $ = (selector, root = document) => root.querySelector(selector);

const EXPECTED_HOST_ID_KEY = "pidex.expectedHostId";
const CACHE_SCHEMA_VERSION = 1;
const PROTOCOL_BASIS = "1.1";
const MAX_CACHED_SESSION_PROJECTIONS = 10;
const MAX_FINALIZED_PAGES = 25;
const OFFLINE_STATUS = "Offline · cached state may be stale";
const ACTIVE_INTERACTION_STATES = ["open", "resolving"];
const ACTIVE_RUN_STATES = ["executing", "cancelling"];
const FAILED_RUN_STATES = ["failed", "cancelled", "interrupted"];
const supportedCapabilities = [
  "scope.host",
  "scope.session",
  "session.create",
  "session.rename",
  "session.archive",
  "session.restore",
  "session.fork",
  "run.submit",
  "run.follow-up",
  "run.steer",
  "run.release",
  "run.cancel",
  "run.stop",
  "pi.model.select",
  "pi.mode.select",
  "pi.input.text",
  "presentation.effects",
  "pi.interaction.basic",
];
const state = {
  projects: [],
  workspaces: [],
  sessions: [],
  archivedSessions: [],
  capabilities: new Map(),
  scopes: new Map(),
  current: false,
  pending: new Set(),
  apiToken: null,
  hostId: null,
  epoch: null,
  cursor: null,
  lastSuccessfulSync: null,
  currentScopes: new Set(),
};

const pairingSecret = new URL(location.href).searchParams.get("pair");
let socket;
let messageChain = Promise.resolve();
const mobileLayoutQuery = matchMedia("(max-width: 720px)");

function setDrawerOpen(isOpen) {
  document.body.classList.toggle("drawer-open", isOpen);
  $("#drawer-toggle").setAttribute("aria-expanded", String(isOpen));
}

function closeDrawer() {
  setDrawerOpen(false);
}

function toggleDrawer() {
  const isOpen = document.body.classList.contains("drawer-open");
  setDrawerOpen(!isOpen);
}

function send(command) {
  const targetSessionId = command.sessionId || currentSessionId();
  if (
    !state.current ||
    !state.currentScopes.has("host") ||
    (targetSessionId && !state.currentScopes.has(`session:${targetSessionId}`)) ||
    !socket ||
    socket.readyState !== WebSocket.OPEN
  ) {
    return false;
  }

  command.commandId ??= crypto.randomUUID();
  state.pending.add(command.commandId);
  socket.send(JSON.stringify(command));
  renderCurrentView();
  return true;
}

function navigate(path) {
  history.pushState({}, "", path);
  closeDrawer();
  route();
}

document.addEventListener("click", event => {
  const link = event.target.closest("[data-route]");
  if (!link) {
    return;
  }

  event.preventDefault();
  navigate(link.pathname);
});
addEventListener("popstate", route);
addEventListener("offline", () => setCurrent(false, OFFLINE_STATUS));
addEventListener("online", () => {
  setCurrent(false, "Reconnecting");
  authenticateStoredDevice();
});
addEventListener("visibilitychange", () => {
  if (document.hidden) {
    setCurrent(false, "Stale · return to reconcile");
    return;
  }

  if (socket?.readyState === WebSocket.OPEN) {
    const selectedSessionId = currentSessionId();
    sendScopeSet(selectedSessionId);
  }
});
addEventListener("pageshow", event => {
  // Safari may restore a standalone PWA from its page cache. Reconcile the
  // View without coupling its lifecycle to Session execution or ownership.
  if (event.persisted) {
    setCurrent(false, "Reconnecting after suspension");
    authenticateStoredDevice();
  }
});
mobileLayoutQuery.addEventListener("change", closeDrawer);
$("#drawer-toggle").onclick = toggleDrawer;
$("#drawer-backdrop").onclick = closeDrawer;
addEventListener("keydown", event => {
  if (event.key === "Escape") {
    closeDrawer();
  }
});

$("#new-session").onclick = () => $("#new-session-view").showModal();
$("#session-search").oninput = renderSidebar;
$("#session-project").onchange = renderWorkspaceOptions;
$("#create-session").onclick = () => createSession("");
$("#create-and-run").onclick = () => {
  createSession($("#new-prompt").value.trim());
};

if (pairingSecret) {
  history.replaceState({}, "", location.pathname);
  $("#pairing").hidden = false;
  $("#content").hidden = true;
  $("#pair-device").onclick = pairDevice;
} else {
  loadCachedWorkingSet().finally(authenticateStoredDevice);
}

async function pairDevice() {
  const keys = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"],
  );
  const publicKey = await crypto.subtle.exportKey("jwk", keys.publicKey);
  const challenge = await post("/pair/challenge", {
    secret: pairingSecret,
    publicKey,
  });
  const signature = await sign(keys.privateKey, challenge.challenge);
  const device = await post("/pair/complete", {
    pairingId: challenge.pairingId,
    signature: bytesToBase64Url(signature),
  });

  await saveDevice({
    deviceId: device.deviceId,
    privateKey: keys.privateKey,
  });
  location.href = "/";
}

async function authenticateStoredDevice() {
  const device = await loadDevice();
  if (!device) {
    setCurrent(false, "Pairing required");
    return;
  }

  try {
    const challenge = await post("/pair/auth-challenge", {
      deviceId: device.deviceId,
    });
    const signature = await sign(
      device.privateKey,
      challenge.challenge,
    );
    const authentication = await post("/pair/authenticate", {
      authenticationId: challenge.authenticationId,
      signature: bytesToBase64Url(signature),
    });

    state.apiToken = authentication.session;
    openControl(authentication.session);
  } catch (error) {
    setCurrent(
      false,
      String(error?.message).includes("revoked") ? "Revoked" : OFFLINE_STATUS,
    );
  }
}

function openControl(token) {
  socket?.close();
  socket = new WebSocket(
    `wss://${location.host}/control?session=${encodeURIComponent(token)}`,
  );
  socket.onmessage = event => {
    // Preserve wire order while IndexedDB transactions commit. A scope cannot
    // become current before its replacement projection is durable.
    messageChain = messageChain.then(() => handleMessage(JSON.parse(event.data)));
  };
  socket.onclose = () => setCurrent(false, OFFLINE_STATUS);
}

async function handleMessage(message) {
  switch (message.type) {
    case "host.hello":
      sendClientHello(message.hostId);
      return;
    case "protocol.admitted":
      state.capabilities = new Map(
        message.capabilities.map(capability => [capability.id, capability]),
      );
      return;
    case "host.snapshot":
      handleHostSnapshot(message);
      return;
    case "host.change-set":
      for (const change of message.changes) {
        applyHostChange(change);
      }
      renderSidebar();
      renderCurrentView();
      state.cursor = message.cursor;
      await persistWorkingSet();
      return;
    case "scope.reset":
      if (message.barrier.scope.kind === "session") {
        await resetSessionScope(message);
      } else {
        installHostReset(message);
        await persistWorkingSet();
        state.currentScopes.add("host");
        setCurrent(true, "Current");
      }
      return;
    case "scope.current":
      state.cursor = message.cursor;
      state.currentScopes.add(scopeKey(message.scope));
      await persistWorkingSet();
      setCurrent(true, "Current");
      return;
    case "timeline.change":
      applyTimelineChange(message);
      return;
    case "interaction.change":
      applyInteractionChange(message.interaction);
      return;
    case "run.execution":
    case "run.completed":
      applyRunChange(message);
      return;
    case "command.outcome":
      handleCommandOutcome(message);
      return;
    case "protocol.update-required":
      setCurrent(false, "Update required");
      return;
    case "delivery.resynchronize":
      setCurrent(false, "Resynchronizing");
      return;
  }
}

function sendClientHello(hostId) {
  const expectedHostId = localStorage.getItem(EXPECTED_HOST_ID_KEY) || hostId;
  socket.send(JSON.stringify({
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

function handleHostSnapshot(message) {
  Object.assign(state, {
    projects: message.projects,
    workspaces: message.workspaces,
    sessions: message.sessions,
    archivedSessions: message.archivedSessions,
  });
  state.hostId = message.status.hostId;
  state.epoch = message.status.synchronization.epoch;
  state.cursor = message.status.synchronization.cursor;
  state.currentScopes.add("host");
  localStorage.setItem(EXPECTED_HOST_ID_KEY, message.status.hostId);
  $("#device-state").textContent = `Device · ${message.status.hostId}`;
  setCurrent(true, "Current");
  void persistWorkingSet();
  renderCatalogControls();
  route();
}

async function resetSessionScope(message) {
  const { scope } = message.barrier;
  const { snapshot } = message;
  const timeline = [
    ...(snapshot.timelineWindow?.entries || snapshot.timeline || []),
  ];

  state.scopes.set(scope.sessionId, {
    ...snapshot,
    timeline,
    olderCursor: snapshot.timelineWindow?.olderCursor || null,
  });
  state.cursor = message.barrier.cursor;
  state.currentScopes.delete(`session:${scope.sessionId}`);
  await persistWorkingSet();
  state.currentScopes.add(`session:${scope.sessionId}`);
  setCurrent(true, "Current");
  renderCurrentView();
}

function installHostReset(message) {
  Object.assign(state, message.snapshot);
  state.cursor = message.barrier.cursor;
  state.currentScopes.delete("host");
  renderCatalogControls();
  route();
}

function applyTimelineChange(message) {
  const scope = state.scopes.get(message.sessionId);
  if (!scope) {
    return;
  }

  replaceOrAppend(scope.timeline, message.entry, "entryId");
  renderCurrentView();
}

function applyInteractionChange(interaction) {
  const scope = state.scopes.get(interaction.sessionId);
  if (!scope) {
    return;
  }

  scope.interactions ||= [];
  replaceOrAppend(scope.interactions, interaction, "interactionId");
  renderCurrentView();
}

function applyRunChange(message) {
  const sessionId = message.sessionId || message.run.sessionId;
  const scope = state.scopes.get(sessionId);
  if (!scope) {
    return;
  }

  const run = message.run || { ...message, runId: message.runId };
  scope.runs ||= [];
  replaceOrAppend(scope.runs, run, "runId");
  renderSidebar();
  renderCurrentView();
}

function replaceOrAppend(items, replacement, identityProperty) {
  const replacementIndex = items.findIndex(
    item => item[identityProperty] === replacement[identityProperty],
  );
  if (replacementIndex < 0) {
    items.push(replacement);
  } else {
    items.splice(replacementIndex, 1, replacement);
  }
}

function handleCommandOutcome(message) {
  state.pending.delete(message.commandId);
  if (message.outcome === "rejected") {
    announce(`Command rejected: ${message.error}`);
  }
  renderCurrentView();
}

function applyHostChange(change) {
  const changedSessionId = change.session.sessionId;
  state.sessions = state.sessions.filter(
    session => session.sessionId !== changedSessionId,
  );
  state.archivedSessions = state.archivedSessions.filter(
    session => session.sessionId !== changedSessionId,
  );

  if (change.type === "session.archived") {
    state.archivedSessions.push(change.session);
  } else {
    state.sessions.push(change.session);
  }
}

function setCurrent(current, label) {
  state.current = current;
  $("#connection-state").textContent = label;
  const lastSync = $("#last-sync");
  if (lastSync) {
    lastSync.textContent = state.lastSuccessfulSync
      ? `Last sync ${new Date(state.lastSuccessfulSync).toLocaleString()}`
      : "Never synchronized on this Device";
  }
  document.body.classList.toggle("stale", !current);
  $("#new-session").disabled = !current || !state.currentScopes.has("host");
  renderCurrentView();
}

function renderCatalogControls() {
  const projectOptions = state.projects.map(
    project => new Option(project.name, project.projectId),
  );
  $("#session-project").replaceChildren(
    new Option("Host-unscoped", ""),
    ...projectOptions,
  );
  renderWorkspaceOptions();
}

function renderWorkspaceOptions() {
  const selectedProjectId = $("#session-project").value;
  const workspaceOptions = state.workspaces
    .filter(workspace => workspace.projectId === selectedProjectId)
    .map(workspace => new Option(workspace.name, workspace.workspaceId));

  $("#session-workspace").replaceChildren(
    new Option("No Workspace", ""),
    ...workspaceOptions,
  );
}

function createSession(firstPrompt) {
  const commandId = crypto.randomUUID();
  const command = {
    type: "session.create",
    commandId,
    projectId: $("#session-project").value || null,
    workspaceId: $("#session-workspace").value || null,
  };
  if (!send(command)) {
    return;
  }

  $("#new-session-view").close();
  $("#new-prompt").value = "";
  if (!firstPrompt) {
    return;
  }

  const waitForSession = setInterval(() => {
    const createdSession = state.sessions.at(-1);
    if (!createdSession) {
      return;
    }

    clearInterval(waitForSession);
    navigate(`/sessions/${createdSession.sessionId}`);
    send({
      type: "run.submit",
      sessionId: createdSession.sessionId,
      prompt: firstPrompt,
      requiredCapability: "run.submit",
    });
  }, 50);
  setTimeout(() => clearInterval(waitForSession), 5_000);
}

function route() {
  renderSidebar();
  const selectedSessionId = currentSessionId();
  if (selectedSessionId && socket?.readyState === WebSocket.OPEN) {
    state.current = false;
    $("#connection-state").textContent = "Reconciling Session";
    sendScopeSet(selectedSessionId);
  }
  renderCurrentView();
}

function renderSidebar() {
  const showArchivedSessions = location.pathname === "/archived";
  const query = $("#session-search").value.toLowerCase();
  const catalog = showArchivedSessions
    ? state.archivedSessions
    : state.sessions;
  const matchingSessions = catalog.filter(session => {
    const searchableText = `${session.name} ${sessionGroupName(session)}`;
    return searchableText.toLowerCase().includes(query);
  });
  matchingSessions.sort(
    (left, right) => right.timelineRevision - left.timelineRevision,
  );

  const groups = new Map();
  for (const session of matchingSessions) {
    const groupName = sessionGroupName(session);
    const sessions = groups.get(groupName) || [];
    sessions.push(session);
    groups.set(groupName, sessions);
  }

  const groupElements = [...groups].flatMap(([name, sessions]) => {
    const heading = document.createElement("h2");
    heading.textContent = name;
    return [heading, ...sessions.map(createSessionLink)];
  });
  $("#sessions").replaceChildren(...groupElements);
}

function createSessionLink(session) {
  const link = document.createElement("a");
  link.href = `/sessions/${session.sessionId}`;
  link.dataset.route = "";
  link.className = "session-link";
  link.setAttribute(
    "aria-current",
    currentSessionId() === session.sessionId ? "page" : "false",
  );
  link.append(document.createTextNode(session.name));

  const cue = document.createElement("small");
  cue.textContent = sessionCue(session);
  link.append(cue);
  return link;
}

function sessionCue(session) {
  const scope = state.scopes.get(session.sessionId);
  const runs = scope?.runs || [];
  const interactions = (scope?.interactions || []).filter(interaction =>
    ACTIVE_INTERACTION_STATES.includes(interaction.state)
  );

  if (runs.some(run => ACTIVE_RUN_STATES.includes(run.state))) {
    return "● Run executing";
  }
  if (interactions.length) {
    const plural = interactions.length > 1 ? "s" : "";
    return `◆ ${interactions.length} open Interaction${plural}`;
  }
  if (runs.some(run => run.state === "held")) {
    return "Held work";
  }
  if (runs.some(run => run.state === "queued")) {
    return "Queued work";
  }

  const lastFailedRun = [...runs]
    .reverse()
    .find(run => FAILED_RUN_STATES.includes(run.state));
  if (lastFailedRun) {
    return `Last Run ${lastFailedRun.state}`;
  }
  if (session.residency === "sleeping") {
    return "Sleeping";
  }
  return "Resident";
}

function renderCurrentView() {
  if (location.pathname === "/archived") {
    renderArchivedSessions();
    return;
  }

  const selectedSessionId = currentSessionId();
  const session = state.sessions.find(
    item => item.sessionId === selectedSessionId,
  ) || state.archivedSessions.find(
    item => item.sessionId === selectedSessionId,
  );
  if (!session) {
    $("#content").innerHTML =
      '<div class="empty"><h1>Pidex</h1>' +
      "<p>Choose a Session or start something new.</p></div>";
    return;
  }

  const sessionView = $("#session-view").content.cloneNode(true);
  $("#content").replaceChildren(sessionView);
  $("#session-title").textContent = session.name;
  $("#session-scope").textContent =
    `${sessionGroupName(session)} · ${session.sessionId}`;
  const mobileHostState = $("#mobile-host-state");
  mobileHostState.hidden = state.current;
  mobileHostState.textContent = `Host · ${$("#connection-state").textContent}`;
  wireSessionView(session);
}

function renderArchivedSessions() {
  const content = $("#content");
  content.innerHTML =
    '<header class="view-header"><div><h1>Archived Sessions</h1>' +
    '<div class="scope">Readable, restorable Fork parents</div>' +
    "</div></header>";

  for (const session of state.archivedSessions) {
    const restoreButton = document.createElement("button");
    restoreButton.textContent = `Restore ${session.name}`;
    restoreButton.disabled = !can("session.restore");
    restoreButton.onclick = () => send({
      type: "session.restore",
      sessionId: session.sessionId,
      observedMetadataRevision: session.metadataRevision,
    });
    content.append(restoreButton);
  }
}

function wireSessionView(session) {
  const scope = state.scopes.get(session.sessionId);
  renderTimeline(scope);

  const olderTimelineButton = $("#older-timeline");
  olderTimelineButton.hidden = !scope?.olderCursor;
  olderTimelineButton.onclick = () => loadOlder(session.sessionId, scope);

  const openInteractions = (scope?.interactions || []).filter(interaction =>
    ACTIVE_INTERACTION_STATES.includes(interaction.state)
  );
  renderInteractions(openInteractions);

  const runs = scope?.runs || [];
  const executingRun = runs.find(run => ACTIVE_RUN_STATES.includes(run.state));
  const queuedRun = runs.find(run => run.state === "queued");
  const heldRun = runs.find(run => run.state === "held");

  wireComposer(session, executingRun);
  wireRunControls(session, executingRun, queuedRun, heldRun);
  wireSessionControls(session, scope);
  renderRuntimeControls();
}

function renderTimeline(scope) {
  const timeline = $("#timeline");
  if (!scope) {
    timeline.textContent = "Loading complete Timeline…";
    return;
  }
  timeline.replaceChildren(...scope.timeline.map(createTimelineEntry));
}

function wireComposer(session, executingRun) {
  const input = $("#run-input");
  input.disabled = !targetScopesCurrent(session.sessionId);
  $("#composer-state").textContent = state.current
    ? sessionCue(session)
    : $("#connection-state").textContent;

  const commandType = executingRun ? "run.follow-up" : "run.submit";
  const submitButton = $("#submit-run");
  submitButton.disabled = !can(commandType);
  submitButton.textContent = executingRun ? "Queue follow-up" : "Run";
  submitButton.onclick = () => {
    if (!input.value.trim()) {
      return;
    }

    const sent = send({
      type: commandType,
      sessionId: session.sessionId,
      prompt: input.value,
      requiredCapability: commandType,
    });
    if (sent) {
      input.value = "";
    }
  };
}

function wireRunControls(session, executingRun, queuedRun, heldRun) {
  const stopButton = $("#stop-run");
  stopButton.hidden = !executingRun?.workerGeneration || !can("run.stop");
  stopButton.onclick = () => send({
    type: "run.stop",
    sessionId: session.sessionId,
    runId: executingRun.runId,
    workerGeneration: executingRun.workerGeneration,
    observedState: "executing",
    observedTimelineRevision: session.timelineRevision,
    requiredCapability: "run.stop",
  });

  wireQueuedRunButton("#release-run", heldRun, "run.release");
  wireQueuedRunButton("#cancel-run", heldRun || queuedRun, "run.cancel");
}

function wireQueuedRunButton(selector, run, commandType) {
  const button = $(selector);
  button.hidden = !run || !can(commandType);
  button.onclick = () => send({ type: commandType, runId: run.runId });
}

function wireSessionControls(session, scope) {
  const renameButton = $("#rename-session");
  renameButton.hidden = !can("session.rename");
  renameButton.onclick = () => {
    const proposedName = prompt("Session name", session.name);
    if (proposedName?.trim()) {
      send({
        type: "session.rename",
        sessionId: session.sessionId,
        name: proposedName.trim(),
        requiredCapability: "session.rename",
        observedMetadataRevision: session.metadataRevision,
      });
    }
  };

  const archiveButton = $("#archive-session");
  archiveButton.hidden =
    session.availability === "archived" || !can("session.archive");
  archiveButton.onclick = () => send({
    type: "session.archive",
    sessionId: session.sessionId,
    observedMetadataRevision: session.metadataRevision,
  });

  const forkButton = $("#fork-session");
  forkButton.hidden = !can("session.fork");
  forkButton.onclick = () => {
    const forkPoint = [...(scope?.timeline || [])]
      .reverse()
      .find(entry => entry.finalized);
    if (!forkPoint) {
      announce("No stable Fork point is available");
      return;
    }

    send({
      type: "session.fork",
      parentSessionId: session.sessionId,
      forkPointEntryId: forkPoint.entryId,
    });
  };
}

function renderRuntimeControls() {
  const controls = [
    ["pi.model.select", $("#run-model")],
    ["pi.mode.select", $("#run-mode")],
  ];
  for (const [capabilityId, select] of controls) {
    const capability = state.capabilities.get(capabilityId);
    select.hidden = !capability;
    if (capability) {
      const options = (capability.constraints?.values || []).map(
        value => new Option(value, value),
      );
      select.replaceChildren(...options);
    }
  }
}

function renderInteractions(interactions) {
  const area = $("#interaction");
  area.hidden = !interactions.length;
  if (!interactions.length) {
    return;
  }

  let selectedIndex = 0;
  const drawSelectedInteraction = () => {
    const interaction = interactions[selectedIndex];
    area.replaceChildren();

    const title = document.createElement("strong");
    title.textContent =
      `Interaction ${selectedIndex + 1} of ${interactions.length}`;

    const message = document.createElement("p");
    message.textContent = interaction.payload.message;

    const control = createInteractionControl(interaction);
    const respondButton = document.createElement("button");
    respondButton.textContent = "Respond";
    respondButton.disabled = !targetScopesCurrent(interaction.sessionId);
    respondButton.onclick = () => {
      send({
        type: "interaction.resolve",
        interactionId: interaction.interactionId,
        workerGeneration: interaction.workerGeneration,
        observedRevision: interaction.revision,
        dismiss: false,
        value: interactionValue(interaction, control),
      });
    };

    const dismissButton = document.createElement("button");
    dismissButton.textContent = "Dismiss";
    dismissButton.disabled = !targetScopesCurrent(interaction.sessionId);
    dismissButton.onclick = () => send({
      type: "interaction.resolve",
      interactionId: interaction.interactionId,
      workerGeneration: interaction.workerGeneration,
      observedRevision: interaction.revision,
      dismiss: true,
    });

    const nextButton = document.createElement("button");
    nextButton.textContent = "Next";
    nextButton.disabled = interactions.length < 2;
    nextButton.onclick = () => {
      selectedIndex = (selectedIndex + 1) % interactions.length;
      drawSelectedInteraction();
    };

    area.append(
      title,
      message,
      control,
      respondButton,
      dismissButton,
      nextButton,
    );
  };

  drawSelectedInteraction();
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

  return document.createElement("textarea");
}

function interactionValue(interaction, control) {
  if (interaction.kind === "confirm") {
    return control.checked;
  }
  return control.value;
}

function createTimelineEntry(entry) {
  const item = document.createElement("article");
  item.className = "entry";
  item.dataset.kind = entry.kind;

  const metadata = document.createElement("div");
  metadata.className = "entry-meta";
  metadata.textContent = entry.finalized
    ? entry.kind
    : `${entry.kind} · last observed · incomplete`;

  const text = document.createElement("div");
  text.textContent = entry.text;
  item.append(metadata, text);
  return item;
}

async function loadOlder(sessionId, scope) {
  const encodedSessionId = encodeURIComponent(sessionId);
  const encodedCursor = encodeURIComponent(scope.olderCursor);
  const response = await fetch(
    `/api/sessions/${encodedSessionId}/timeline?cursor=${encodedCursor}&limit=100`,
    { headers: { authorization: `Bearer ${state.apiToken}` } },
  );
  if (!response.ok) {
    return;
  }

  const page = await response.json();
  scope.timeline = [...page.entries, ...scope.timeline];
  scope.olderCursor = page.olderCursor;
  await persistFinalizedPage(sessionId, encodedCursor, page);
  await persistWorkingSet();
  renderCurrentView();
}

function can(capabilityId) {
  const sessionId = currentSessionId();
  return targetScopesCurrent(sessionId) &&
    state.capabilities.has(capabilityId) &&
    !state.pending.size;
}

function currentSessionId() {
  return location.pathname.match(/^\/sessions\/([^/]+)$/)?.[1];
}

function sessionGroupName(session) {
  const project = state.projects.find(
    item => item.projectId === session.projectId,
  );
  const workspace = state.workspaces.find(
    item => item.workspaceId === session.workspaceId,
  );

  if (workspace) {
    return `${project?.name} / ${workspace.name}`;
  }
  if (project) {
    return `${project.name} / Project Sessions`;
  }
  return "Host-unscoped";
}

function announce(text) {
  const composerState = $("#composer-state");
  if (composerState) {
    composerState.textContent = text;
  } else {
    alert(text);
  }
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
    throw Error(value.error);
  }
  return value;
}

function sign(privateKey, challenge) {
  return crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    new TextEncoder().encode(challenge),
  );
}

function bytesToBase64Url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function targetScopesCurrent(sessionId) {
  return state.current && state.currentScopes.has("host") &&
    (!sessionId || state.currentScopes.has(`session:${sessionId}`));
}

function sendScopeSet(sessionId) {
  const session = [...state.sessions, ...state.archivedSessions]
    .find(item => item.sessionId === sessionId);
  const resourceRevisions = session ? {
    [session.sessionId]: session.metadataRevision,
    [`timeline:${session.sessionId}`]: session.timelineRevision,
  } : {};
  socket.send(JSON.stringify({
    type: "scope.set",
    sessionIds: sessionId ? [sessionId] : [],
    cursor: state.cursor || undefined,
    resourceRevisions,
    protocolVersion: PROTOCOL_BASIS,
  }));
}

function scopeKey(scope) {
  return scope.kind === "host" ? "host" : `session:${scope.sessionId}`;
}

function cacheDatabaseName(hostId) {
  return `pidex-cache-${encodeURIComponent(hostId)}`;
}

function openCache(hostId) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(cacheDatabaseName(hostId), CACHE_SCHEMA_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      for (const name of [
        "metadata",
        "discovery",
        "session-projections",
        "finalized-pages",
        "immutable-blobs",
      ]) {
        if (!database.objectStoreNames.contains(name)) {
          database.createObjectStore(name);
        }
      }
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function requestValue(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function cacheBasis(scope, resourceRevisions = {}) {
  return {
    hostId: state.hostId,
    epoch: state.epoch,
    cursor: state.cursor,
    protocolBasis: PROTOCOL_BASIS,
    cacheSchemaBasis: CACHE_SCHEMA_VERSION,
    scope,
    resourceRevisions,
    lastSuccessfulSync: state.lastSuccessfulSync,
  };
}

async function persistWorkingSet() {
  if (!state.hostId || !state.cursor) {
    return;
  }
  state.lastSuccessfulSync = new Date().toISOString();
  const database = await openCache(state.hostId);
  const transaction = database.transaction(
    ["metadata", "discovery", "session-projections"],
    "readwrite",
  );
  transaction.objectStore("metadata").put(cacheBasis("host"), "basis");
  transaction.objectStore("discovery").put({
    ...cacheBasis("host", Object.fromEntries(
      [...state.sessions, ...state.archivedSessions].map(session => [
        session.sessionId,
        session.metadataRevision,
      ]),
    )),
    projects: state.projects,
    workspaces: state.workspaces,
    sessions: state.sessions,
    archivedSessions: state.archivedSessions,
  }, "catalog");
  const projections = transaction.objectStore("session-projections");
  for (const [sessionId, projection] of [...state.scopes].slice(-MAX_CACHED_SESSION_PROJECTIONS)) {
    const session = [...state.sessions, ...state.archivedSessions]
      .find(item => item.sessionId === sessionId);
    projections.put({
      ...cacheBasis(`session:${sessionId}`, {
        metadata: session?.metadataRevision,
        timeline: session?.timelineRevision,
      }),
      projection,
      lastViewed: new Date().toISOString(),
    }, sessionId);
  }
  await transactionDone(transaction);
  database.close();
  setCurrent(state.current, state.current ? "Current" : $("#connection-state").textContent);
}

async function persistFinalizedPage(sessionId, pageCursor, page) {
  if (!state.hostId || page.entries.some(entry => !entry.finalized)) {
    return;
  }
  const database = await openCache(state.hostId);
  const transaction = database.transaction("finalized-pages", "readwrite");
  const store = transaction.objectStore("finalized-pages");
  store.put({
    ...cacheBasis(`session:${sessionId}`, { timeline: page.timelineRevision }),
    page,
    fetchedAt: new Date().toISOString(),
  }, `${sessionId}:${pageCursor}`);
  const keys = await requestValue(store.getAllKeys());
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_FINALIZED_PAGES))) {
    store.delete(key);
  }
  await transactionDone(transaction);
  database.close();
}

// Immutable HTTP bodies enter this store only after application-level identity
// verification; authenticated responses are never delegated to an HTTP cache.
async function persistVerifiedImmutableBlob(identity, body, verifiedMetadata) {
  if (!state.hostId || verifiedMetadata.hostId !== state.hostId) return;
  const database = await openCache(state.hostId);
  const transaction = database.transaction("immutable-blobs", "readwrite");
  transaction.objectStore("immutable-blobs").put({
    ...cacheBasis(verifiedMetadata.scope, verifiedMetadata.resourceRevisions),
    identity,
    body,
  }, identity);
  await transactionDone(transaction);
  database.close();
}

async function loadCachedWorkingSet() {
  const hostId = localStorage.getItem(EXPECTED_HOST_ID_KEY);
  if (!hostId) return;
  try {
    const database = await openCache(hostId);
    const transaction = database.transaction(
      ["metadata", "discovery", "session-projections"],
      "readonly",
    );
    const [basis, discovery, projections] = await Promise.all([
      requestValue(transaction.objectStore("metadata").get("basis")),
      requestValue(transaction.objectStore("discovery").get("catalog")),
      requestValue(transaction.objectStore("session-projections").getAll()),
    ]);
    await transactionDone(transaction);
    database.close();
    if (!basis || !discovery || basis.hostId !== hostId ||
        basis.cacheSchemaBasis !== CACHE_SCHEMA_VERSION ||
        basis.protocolBasis !== PROTOCOL_BASIS) return;
    Object.assign(state, {
      hostId,
      epoch: basis.epoch,
      cursor: basis.cursor,
      lastSuccessfulSync: basis.lastSuccessfulSync,
      projects: discovery.projects,
      workspaces: discovery.workspaces,
      sessions: discovery.sessions,
      archivedSessions: discovery.archivedSessions,
    });
    state.scopes = new Map(projections.map(item => [
      item.projection.session?.sessionId || item.scope.slice(8),
      item.projection,
    ]));
    renderCatalogControls();
    route();
    setCurrent(false, OFFLINE_STATUS);
  } catch {
    // Browser eviction and incompatible disposable cache generations are safe.
  }
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

async function saveDevice(value) {
  const store = await deviceStore("readwrite");
  await new Promise((resolve, reject) => {
    const request = store.put(value, "device");
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
