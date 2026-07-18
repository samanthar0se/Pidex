const $ = (selector, root = document) => root.querySelector(selector);

const EXPECTED_HOST_ID_KEY = "pidex.expectedHostId";
const CACHE_SCHEMA_VERSION = 2;
const DEVICE_SCHEMA_VERSION = 2;
const DEVICE_DATABASE = "pidex-device";
const IDENTITY_STORE = "identity";
const DRAFT_STORE = "drafts";
const PREFERENCES_STORE = "preferences";
const DEVICE_STORES = [IDENTITY_STORE, DRAFT_STORE, PREFERENCES_STORE];
const PROTOCOL_BASIS = "1.1";
const MAX_CACHED_SESSION_PROJECTIONS = 10;
const MAX_FINALIZED_PAGES = 25;
const DEFAULT_CACHE_BUDGET_BYTES = 50 * 1024 * 1024;
const CACHE_BUDGET_PREFERENCE = "cache-budget-bytes";
const HOST_SCOPE_KEY = "host";
const SESSION_SCOPE_PREFIX = "session:";
const CACHE_STORES = {
  metadata: "metadata",
  discovery: "discovery",
  sessionProjections: "session-projections",
  finalizedPages: "finalized-pages",
  immutableBlobs: "immutable-blobs",
};
const WORKING_SET_STORES = [
  CACHE_STORES.metadata,
  CACHE_STORES.discovery,
  CACHE_STORES.sessionProjections,
];
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
  drafts: new Map(),
  draftFailures: new Map(),
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
    !targetScopesCurrent(targetSessionId) ||
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
navigator.serviceWorker?.addEventListener(
  "message",
  reconcilePushNotification,
);

function reconcilePushNotification(event) {
  if (event.data?.type !== "push-reconcile") {
    return;
  }

  // Notification hints are historical. Authenticate and synchronize before
  // rendering their target or enabling any control.
  setCurrent(false, "Reconciling notification");
  history.replaceState({}, "", event.data.path || "/");
  authenticateStoredDevice();
}

// Device-owned defaults are stored before permission is requested so lock-
// screen exposure is disclosed and can be changed both before and afterwards.
async function configurePush({ enabled, privacy = "rich", categories }) {
  const preferences = { enabled, privacy, categories };
  await savePreference("push", preferences);
  if (!("Notification" in window) || !("PushManager" in window)) {
    return "unsupported";
  }
  if (!enabled) {
    return "disabled";
  }
  if (Notification.permission === "default") {
    return await Notification.requestPermission();
  }
  return Notification.permission;
}

function savePreference(key, value) {
  return withDeviceStore(PREFERENCES_STORE, "readwrite", store =>
    requestValue(store.put(value, key)),
  );
}
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
  void registerServiceWorker();
  void initializeStorageManagement();
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
  state.currentScopes.clear();
  socket = new WebSocket(
    `wss://${location.host}/control?session=${encodeURIComponent(token)}`,
  );
  socket.onmessage = event => {
    // Preserve wire order while IndexedDB transactions commit. A scope cannot
    // become current before its replacement projection is durable.
    messageChain = messageChain
      .then(() => handleMessage(JSON.parse(event.data)))
      .catch(() => setCurrent(false, OFFLINE_STATUS));
  };
  socket.onclose = event => {
    if (event.code === 4003 && event.reason === "device-revoked") {
      void cleanupRevokedDevice();
      return;
    }
    setCurrent(false, OFFLINE_STATUS);
  };
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
      await handleHostSnapshot(message);
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
      await handleScopeReset(message);
      return;
    case "scope.current":
      state.cursor = message.cursor;
      await persistWorkingSet();
      markScopeCurrent(message.scope);
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

async function handleHostSnapshot(message) {
  Object.assign(state, {
    projects: message.projects,
    workspaces: message.workspaces,
    sessions: message.sessions,
    archivedSessions: message.archivedSessions,
  });
  state.hostId = message.status.hostId;
  state.epoch = message.status.synchronization.epoch;
  state.cursor = message.status.synchronization.cursor;
  localStorage.setItem(EXPECTED_HOST_ID_KEY, message.status.hostId);
  $("#device-state").textContent = `Device · ${message.status.hostId}`;
  renderCatalogControls();
  await persistWorkingSet();
  markScopeCurrent({ kind: "host" });
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
  state.currentScopes.delete(sessionScopeKey(scope.sessionId));
  await persistWorkingSet();
  markScopeCurrent(scope);
  renderCurrentView();
}

async function handleScopeReset(message) {
  if (message.barrier.scope.kind === "session") {
    await resetSessionScope(message);
    return;
  }

  installHostReset(message);
  await persistWorkingSet();
  markScopeCurrent(message.barrier.scope);
}

function installHostReset(message) {
  Object.assign(state, message.snapshot);
  state.cursor = message.barrier.cursor;
  state.currentScopes.delete(HOST_SCOPE_KEY);
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
  $("#new-session").disabled =
    !current || !state.currentScopes.has(HOST_SCOPE_KEY);
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
  const draftKey = deviceDraftKey(session.sessionId);
  input.value = state.drafts.get(draftKey) || "";
  input.oninput = () => {
    state.drafts.set(draftKey, input.value);
    persistDraft(draftKey, input.value).then(() => {
      state.draftFailures.delete(draftKey);
      renderComposerState(session, draftKey);
    }).catch(() => {
      state.draftFailures.set(draftKey, "Draft is only in memory · save failed");
      renderComposerState(session, draftKey);
    });
  };
  loadDraft(draftKey, input, session);
  renderComposerState(session, draftKey);

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
      state.drafts.set(draftKey, "");
      persistDraft(draftKey, "").catch(() => {
        state.draftFailures.set(draftKey, "Sent, but saved draft cleanup failed");
        renderComposerState(session, draftKey);
      });
    }
  };
}

function renderComposerState(session, draftKey) {
  const label = $("#composer-state");
  if (!label) {
    return;
  }

  const failure = state.draftFailures.get(draftKey);
  if (failure) {
    label.classList.add("draft-warning");
    label.textContent = failure;
    return;
  }

  label.classList.remove("draft-warning");
  if (state.current) {
    label.textContent = sessionCue(session);
    return;
  }

  label.textContent =
    `${$("#connection-state").textContent} · draft local and unsent`;
}

function deviceDraftKey(sessionId) {
  const hostId = state.hostId ||
    localStorage.getItem(EXPECTED_HOST_ID_KEY) ||
    "unpaired";
  return `${hostId}:${sessionId}`;
}

async function loadDraft(key, input, session) {
  if (state.drafts.has(key)) {
    return;
  }

  try {
    const value = await withDeviceStore(DRAFT_STORE, "readonly", store =>
      requestValue(store.get(key))
    );
    // An input event may have supplied newer text while storage was loading.
    if (state.drafts.has(key)) {
      return;
    }
    state.drafts.set(key, value?.text || "");
    if (input.isConnected && !input.value) {
      input.value = value?.text || "";
    }
  } catch {
    state.draftFailures.set(
      key,
      "Draft storage unavailable · text remains in memory",
    );
    renderComposerState(session, key);
  }
}

function persistDraft(key, text) {
  return withDeviceStore(DRAFT_STORE, "readwrite", store =>
    requestValue(store.put({ text, updatedAt: new Date().toISOString() }, key))
  );
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
  return state.current && requiredScopesCurrent(sessionId);
}

function requiredScopesCurrent(sessionId) {
  if (!state.currentScopes.has(HOST_SCOPE_KEY)) {
    return false;
  }
  return !sessionId || state.currentScopes.has(sessionScopeKey(sessionId));
}

function markScopeCurrent(scope) {
  state.currentScopes.add(scopeKey(scope));
  const current = requiredScopesCurrent(currentSessionId());
  const label = current ? "Current" : "Reconciling Session";
  setCurrent(current, label);
}

function sendScopeSet(sessionId) {
  const session = findSession(sessionId);
  const resourceRevisions = scopeResourceRevisions(session);

  state.currentScopes.clear();
  socket.send(JSON.stringify({
    type: "scope.set",
    sessionIds: sessionId ? [sessionId] : [],
    cursor: state.cursor || undefined,
    resourceRevisions,
    protocolVersion: PROTOCOL_BASIS,
  }));
}

function scopeResourceRevisions(session) {
  if (!session) {
    return {};
  }

  const resourceRevisions = {
    [session.sessionId]: session.metadataRevision,
  };
  const projection = state.scopes.get(session.sessionId);
  const timelineRevision = projection?.session?.timelineRevision;
  if (timelineRevision !== undefined) {
    resourceRevisions[`timeline:${session.sessionId}`] =
      timelineRevision;
  }
  return resourceRevisions;
}

function scopeKey(scope) {
  return scope.kind === "host"
    ? HOST_SCOPE_KEY
    : sessionScopeKey(scope.sessionId);
}

function sessionScopeKey(sessionId) {
  return `${SESSION_SCOPE_PREFIX}${sessionId}`;
}

function sessionCatalog() {
  return [...state.sessions, ...state.archivedSessions];
}

function findSession(sessionId) {
  return sessionCatalog().find(session => session.sessionId === sessionId);
}

function cacheDatabaseName(hostId) {
  return `pidex-cache-${encodeURIComponent(hostId)}`;
}

function openCache(hostId) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(
      cacheDatabaseName(hostId),
      CACHE_SCHEMA_VERSION,
    );
    request.onupgradeneeded = () => {
      const database = request.result;
      for (const name of Object.values(CACHE_STORES)) {
        if (!database.objectStoreNames.contains(name)) {
          database.createObjectStore(name);
        }
      }
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function withCache(hostId, operation) {
  const database = await openCache(hostId);
  try {
    return await operation(database);
  } finally {
    database.close();
  }
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

async function writeWorkingSet(database, sessions) {
  const transaction = database.transaction(
    WORKING_SET_STORES,
    "readwrite",
  );
  transaction.objectStore(CACHE_STORES.metadata).put(
    cacheBasis(HOST_SCOPE_KEY),
    "basis",
  );
  transaction.objectStore(CACHE_STORES.discovery).put({
    ...cacheBasis(HOST_SCOPE_KEY, Object.fromEntries(
      sessions.map(session => [
        session.sessionId,
        session.metadataRevision,
      ]),
    )),
    projects: state.projects,
    workspaces: state.workspaces,
    sessions: state.sessions,
    archivedSessions: state.archivedSessions,
  }, "catalog");

  const projections = transaction.objectStore(
    CACHE_STORES.sessionProjections,
  );
  projections.clear();
  const cachedScopes = [...state.scopes]
    .slice(-MAX_CACHED_SESSION_PROJECTIONS);
  for (const [sessionId, projection] of cachedScopes) {
    projections.put({
      ...cacheBasis(sessionScopeKey(sessionId), {
        metadata: projection.session?.metadataRevision,
        timeline: projection.session?.timelineRevision,
      }),
      projection,
      lastViewed: state.lastSuccessfulSync,
    }, sessionId);
  }
  await transactionDone(transaction);
}

async function persistWorkingSet() {
  if (!state.hostId || !state.cursor) {
    return;
  }

  const previousSuccessfulSync = state.lastSuccessfulSync;
  state.lastSuccessfulSync = new Date().toISOString();
  const sessions = sessionCatalog();
  try {
    await withCache(
      state.hostId,
      database => writeWorkingSet(database, sessions),
    );
  } catch (error) {
    state.lastSuccessfulSync = previousSuccessfulSync;
    throw error;
  }

  const connectionLabel = state.current
    ? "Current"
    : $("#connection-state").textContent;
  setCurrent(state.current, connectionLabel);
  void enforceCacheBudget().catch(reportStorageWriteFailure);
}

async function persistFinalizedPage(sessionId, pageCursor, page) {
  if (!state.hostId || page.entries.some(entry => !entry.finalized)) {
    return;
  }
  await withCache(state.hostId, async database => {
    const transaction = database.transaction(
      CACHE_STORES.finalizedPages,
      "readwrite",
    );
    const store = transaction.objectStore(CACHE_STORES.finalizedPages);
    store.put({
      ...cacheBasis(sessionScopeKey(sessionId), {
        timeline: page.timelineRevision,
      }),
      page,
      fetchedAt: new Date().toISOString(),
      lastViewed: new Date().toISOString(),
    }, `${sessionId}:${pageCursor}`);
    const keys = await requestValue(store.getAllKeys());
    const excessPageCount = Math.max(0, keys.length - MAX_FINALIZED_PAGES);
    for (const key of keys.slice(0, excessPageCount)) {
      store.delete(key);
    }
    await transactionDone(transaction);
  });
}

// Immutable HTTP bodies enter this store only after application-level identity
// verification; authenticated responses are never delegated to an HTTP cache.
async function persistVerifiedImmutableBlob(identity, body, verifiedMetadata) {
  if (!state.hostId || verifiedMetadata.hostId !== state.hostId) {
    return;
  }
  await withCache(state.hostId, async database => {
    const transaction = database.transaction(
      CACHE_STORES.immutableBlobs,
      "readwrite",
    );
    transaction.objectStore(CACHE_STORES.immutableBlobs).put({
      ...cacheBasis(verifiedMetadata.scope, verifiedMetadata.resourceRevisions),
      identity,
      body,
      lastViewed: new Date().toISOString(),
    }, identity);
    await transactionDone(transaction);
  });
}

async function loadCachedWorkingSet() {
  const hostId = localStorage.getItem(EXPECTED_HOST_ID_KEY);
  if (!hostId) {
    return;
  }
  try {
    const { basis, discovery, projections } = await withCache(
      hostId,
      async database => {
        const transaction = database.transaction(
          WORKING_SET_STORES,
          "readonly",
        );
        const [basis, discovery, projections] = await Promise.all([
          requestValue(
            transaction.objectStore(CACHE_STORES.metadata).get("basis"),
          ),
          requestValue(
            transaction.objectStore(CACHE_STORES.discovery).get("catalog"),
          ),
          requestValue(
            transaction.objectStore(CACHE_STORES.sessionProjections).getAll(),
          ),
        ]);
        await transactionDone(transaction);
        return { basis, discovery, projections };
      },
    );
    if (!cacheIsCompatible(basis, discovery, hostId)) {
      return;
    }
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
      item.projection.session?.sessionId ||
        item.scope.slice(SESSION_SCOPE_PREFIX.length),
      item.projection,
    ]));
    renderCatalogControls();
    route();
    setCurrent(false, OFFLINE_STATUS);
  } catch {
    // Projection schemas are replaceable. Device identity, preferences, and
    // drafts live in another database and are never part of this reset.
    await resetDisposableCache(hostId).catch(() => {});
  }
}

function resetDisposableCache(hostId) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(cacheDatabaseName(hostId));
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(Error("projection reset blocked"));
  });
}

function cacheIsCompatible(basis, discovery, hostId) {
  return Boolean(
    basis &&
    discovery &&
    basis.hostId === hostId &&
    basis.cacheSchemaBasis === CACHE_SCHEMA_VERSION &&
    basis.protocolBasis === PROTOCOL_BASIS
  );
}

function openDeviceDatabase() {
  return new Promise((resolve, reject) => {
    const openRequest = indexedDB.open(DEVICE_DATABASE, DEVICE_SCHEMA_VERSION);
    openRequest.onupgradeneeded = () => {
      for (const name of DEVICE_STORES) {
        if (!openRequest.result.objectStoreNames.contains(name)) {
          openRequest.result.createObjectStore(name);
        }
      }
    };
    openRequest.onerror = () => reject(openRequest.error);
    openRequest.onsuccess = () => resolve(openRequest.result);
  });
}

async function withDeviceStore(name, mode, operation) {
  const database = await openDeviceDatabase();
  try {
    const transaction = database.transaction(name, mode);
    const result = await operation(transaction.objectStore(name));
    await transactionDone(transaction);
    return result;
  } finally {
    database.close();
  }
}

async function persistAllDrafts() {
  const writes = [...state.drafts].map(([key, text]) =>
    persistDraft(key, text)
  );
  await Promise.all(writes);
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  const registration = await navigator.serviceWorker.register(
    "/service-worker.js",
  );
  void offerShellUpdate(registration.waiting);
  registration.addEventListener("updatefound", () => {
    watchInstallingServiceWorker(registration);
  });
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    location.reload();
  });
  navigator.serviceWorker.addEventListener(
    "message",
    handleServiceWorkerMessage,
  );
}

function watchInstallingServiceWorker(registration) {
  const installingWorker = registration.installing;
  if (!installingWorker) {
    return;
  }

  installingWorker.addEventListener("statechange", () => {
    if (
      installingWorker.state === "installed" &&
      navigator.serviceWorker.controller
    ) {
      void offerShellUpdate(registration.waiting);
    }
  });
}

async function offerShellUpdate(worker) {
  if (
    !worker ||
    !confirm("A complete Pidex update is ready. Save drafts and reload?")
  ) {
    return;
  }

  try {
    await persistAllDrafts();
    worker.postMessage({ type: "activate-shell" });
  } catch {
    alert("Update refused: a Device-owned draft could not be saved.");
  }
}

function handleServiceWorkerMessage(event) {
  if (event.data?.type === "update-refused-multiple-clients") {
    alert("Update refused: close other Pidex windows, then reload explicitly.");
  }
}

addEventListener("pagehide", () => {
  void persistAllDrafts();
});

async function saveDevice(value) {
  await withDeviceStore(IDENTITY_STORE, "readwrite", store =>
    requestValue(store.put(value, "device"))
  );
}

function loadDevice() {
  return withDeviceStore(IDENTITY_STORE, "readonly", store =>
    requestValue(store.get("device"))
  );
}

async function initializeStorageManagement() {
  const persistence = navigator.storage?.persist
    ? await navigator.storage.persist().catch(() => false) : false;
  const persisted = persistence || (navigator.storage?.persisted
    ? await navigator.storage.persisted().catch(() => false) : false);
  const budget = await loadPreference(CACHE_BUDGET_PREFERENCE)
    .catch(() => DEFAULT_CACHE_BUDGET_BYTES) || DEFAULT_CACHE_BUDGET_BYTES;
  const input = $("#storage-budget");
  if (input) input.value = String(Math.round(budget / 1024 / 1024));
  $("#storage-persistence").textContent = persisted
    ? "Persistent storage granted"
    : "Storage may be evicted by the browser or OS";
  $("#settings").disabled = false;
  $("#settings").onclick = async () => {
    await refreshStorageUsage(budget);
    $("#storage-settings").showModal();
  };
  $("#save-storage-budget").onclick = async () => {
    const bytes = Math.max(1, Number(input.value)) * 1024 * 1024;
    await savePreference(CACHE_BUDGET_PREFERENCE, bytes);
    await enforceCacheBudget(bytes);
    await refreshStorageUsage(bytes);
  };
  $("#clear-session-data").onclick = clearSessionData;
  $("#clear-all-data").onclick = async () => {
    if (confirm("Delete Device identity and drafts? Re-pairing is required.")) {
      await clearAllDeviceData();
      location.href = "/";
    }
  };
}

function loadPreference(key) {
  return withDeviceStore(PREFERENCES_STORE, "readonly", store =>
    requestValue(store.get(key))
  );
}

async function refreshStorageUsage(budget) {
  const estimate = navigator.storage?.estimate
    ? await navigator.storage.estimate().catch(() => ({})) : {};
  $("#storage-usage").textContent =
    `${formatBytes(estimate.usage || 0)} used · ${formatBytes(budget)} Pidex budget`;
}

function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function reportStorageWriteFailure(error) {
  const label = $("#storage-failure");
  if (label) label.textContent = `Storage write failed: ${error?.message || error}`;
}

async function enforceCacheBudget(explicitBudget) {
  if (!state.hostId) return;
  const budget = explicitBudget || await loadPreference(CACHE_BUDGET_PREFERENCE)
    .catch(() => DEFAULT_CACHE_BUDGET_BYTES) || DEFAULT_CACHE_BUDGET_BYTES;
  await withCache(state.hostId, async database => {
    const stores = [
      CACHE_STORES.finalizedPages,
      CACHE_STORES.immutableBlobs,
      CACHE_STORES.sessionProjections,
    ];
    const transaction = database.transaction(stores, "readwrite");
    const candidates = [];
    let usage = 0;
    for (const storeName of stores) {
      const store = transaction.objectStore(storeName);
      const [keys, values] = await Promise.all([
        requestValue(store.getAllKeys()), requestValue(store.getAll()),
      ]);
      values.forEach((value, index) => {
        const bytes = new Blob([JSON.stringify(value)]).size;
        usage += bytes;
        const sessionId = value.scope?.startsWith(SESSION_SCOPE_PREFIX)
          ? value.scope.slice(SESSION_SCOPE_PREFIX.length) : null;
        candidates.push({ storeName, key: keys[index], value, bytes, sessionId });
      });
    }
    candidates.sort((left, right) => {
      const tier = name => name === CACHE_STORES.sessionProjections ? 1 : 0;
      return tier(left.storeName) - tier(right.storeName) ||
        String(left.value.lastViewed || left.value.fetchedAt || "")
          .localeCompare(String(right.value.lastViewed || right.value.fetchedAt || ""));
    });
    for (const candidate of candidates) {
      if (usage <= budget) break;
      // Never evict the current View; lightweight discovery summaries remain.
      if (candidate.sessionId === currentSessionId()) continue;
      transaction.objectStore(candidate.storeName).delete(candidate.key);
      usage -= candidate.bytes;
    }
    await transactionDone(transaction);
  });
}

async function clearSessionData() {
  const sessionId = currentSessionId();
  if (!state.hostId || !sessionId) return;
  await withCache(state.hostId, async database => {
    const stores = [CACHE_STORES.sessionProjections, CACHE_STORES.finalizedPages,
      CACHE_STORES.immutableBlobs];
    const transaction = database.transaction(stores, "readwrite");
    transaction.objectStore(CACHE_STORES.sessionProjections).delete(sessionId);
    for (const name of stores.slice(1)) {
      const store = transaction.objectStore(name);
      const [keys, values] = await Promise.all([
        requestValue(store.getAllKeys()), requestValue(store.getAll()),
      ]);
      values.forEach((value, index) => {
        if (value.scope === sessionScopeKey(sessionId)) store.delete(keys[index]);
      });
    }
    await transactionDone(transaction);
  });
  state.scopes.delete(sessionId);
  announce("Session cache cleared; pairing and retained draft preserved");
}

async function cleanupRevokedDevice() {
  setCurrent(false, "Revoked · cleaning local data");
  await clearAllDeviceData().catch(reportStorageWriteFailure);
  setCurrent(false, "Revoked");
}

async function clearAllDeviceData() {
  socket?.close();
  const registration = await navigator.serviceWorker?.ready.catch(() => null);
  await registration?.pushManager?.getSubscription().then(value => value?.unsubscribe())
    .catch(() => {});
  const hostId = state.hostId || localStorage.getItem(EXPECTED_HOST_ID_KEY);
  if (hostId) await resetDisposableCache(hostId).catch(() => {});
  await Promise.all([DEVICE_DATABASE, "pidex-push-receipts"].map(deleteDatabase));
  for (const name of await caches.keys()) {
    if (name.startsWith("pidex-")) await caches.delete(name);
  }
  localStorage.removeItem(EXPECTED_HOST_ID_KEY);
  Object.assign(state, { hostId: null, apiToken: null, drafts: new Map(), scopes: new Map() });
}

function deleteDatabase(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(Error(`cleanup blocked for ${name}`));
  });
}
