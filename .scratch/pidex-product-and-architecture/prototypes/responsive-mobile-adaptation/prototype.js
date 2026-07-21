const variants = {
  A: { name: "Direct collapse", note: "Desktop hierarchy folded into header, drawer, Timeline, and dock" },
  B: { name: "Context shelf", note: "Session and Run context stay in a compact shelf above the Timeline" },
  C: { name: "Focus deck", note: "Exact target and request context form a compact control deck" },
};

const scenarios = {
  working: "Working · empty draft",
  steering: "Working · steering draft",
  interactions: "Two open requests",
  offline: "Offline cached View",
  held: "Interrupted · held work",
  drawer: "Discovery drawer",
};

const sessions = [
  { title: "Reconnect receipt race", cue: "working", unread: true, meta: "Working · Run 18", time: "now" },
  { title: "Release pipeline review", cue: "response", unread: true, meta: "2 requests", time: "2m" },
  { title: "Index corruption diagnosis", cue: "response", unread: false, meta: "Held work", time: "8m" },
  { title: "PWA cache boundaries", cue: "", unread: false, meta: "Completed", time: "1h" },
];

const state = {
  variant: new URL(location.href).searchParams.get("variant") || "A",
  scenario: new URL(location.href).searchParams.get("scenario") || "working",
};

function header() {
  const runActive = ["working", "steering", "interactions", "offline"].includes(state.scenario);
  if (state.variant === "A") {
    return `<header class="session-header header-a">
      <button class="icon" data-action="drawer" aria-label="Open Sessions">☰</button>
      <div class="title"><strong>Reconnect receipt race</strong><small>Pidex / main · Run 18</small></div>
      ${runActive ? `<button class="stop compact-stop" aria-label="Stop Run 18"><span></span></button>` : ""}
      <button class="icon" aria-label="More actions">•••</button>
    </header>`;
  }
  if (state.variant === "B") {
    return `<header class="session-header header-b">
      <button class="icon" data-action="drawer" aria-label="Open Sessions">☰</button>
      <button class="session-chip" data-action="drawer"><span class="cue working"></span><span class="title"><strong>Reconnect receipt race</strong><small>Pidex / main</small></span><span>⌄</span></button>
      <div class="header-actions">${runActive ? `<button class="stop compact-stop" aria-label="Stop Run 18"><span></span></button>` : ""}<button class="icon">•••</button></div>
    </header><div class="context-ribbon"><span>Run 18 · Codex mini · Agent mode</span><span>${runActive ? "Working 2m" : "Interrupted"}</span></div>`;
  }
  return `<header class="session-header header-c">
    <button class="session-chip" data-action="drawer"><span class="cue working"></span><span class="title"><strong>Reconnect receipt race</strong><small>Pidex / main</small></span><span>⌄</span></button>
    <button class="icon">•••</button>
  </header>${runActive ? `<div class="stop-rail"><span>Run 18 · exact observed target</span><button class="stop" aria-label="Stop Run 18"><span></span> Stop</button></div>` : ""}`;
}

function connectionRow() {
  if (state.scenario !== "offline") return "";
  return `<div class="connection-row"><span><strong>Offline</strong> · cached through 10:42</span><button>Details</button></div>`;
}

function timeline() {
  const held = state.scenario === "held";
  return `<section class="timeline">
    <div class="day">Today · 10:39</div>
    <article class="prompt">Make reconnect command receipts impossible to replay twice.</article>
    <article class="work">
      <div class="work-summary">${held ? "△" : `<span class="spinner"></span>`} ${held ? "Worked for 1m 46s" : "Working for 2m 14s"} <span>›</span></div>
      <div class="assistant">
        <p>I’m tracing command identity through reconnection and the authoritative receipt lookup.</p>
        <div class="tool">✓ Read <code>packages/host/src/commands.ts</code></div>
        <div class="tool">${held ? "✓" : "◌"} ${held ? "Checked receipt invariants" : "Running product tests…"}</div>
        ${held ? `<div class="terminal"><strong>Run interrupted</strong><small>The Host lost the worker before settlement.</small></div>` : `<p>The receipt needs one durable identity across transport retries, with reconciliation before another Host mutation becomes available.</p>`}
      </div>
    </article>
  </section>`;
}

function composer() {
  const steering = state.scenario === "steering";
  const offline = state.scenario === "offline";
  return `<div class="composer">
    ${offline ? `<p class="draft-note">Draft stays on this Device · sending waits for current authority</p>` : ""}
    <textarea aria-label="Composer Draft" placeholder="${steering ? "" : "Message Pidex…"}">${steering ? "Also verify expiration after an indeterminate receipt." : ""}</textarea>
    <div class="composer-footer"><button class="pill">Codex mini ⌄</button><button class="pill">Agent ⌄</button><span class="spacer"></span><button class="send" ${offline ? "disabled" : ""} aria-label="${steering ? "Steer Run 18" : "Stop Run 18"}">${steering ? "↑" : "■"}</button></div>
  </div>`;
}

function interaction() {
  return `<div class="interaction">
    <div class="interaction-head"><strong>Release pipeline review</strong><small>1 of 2 · 04:12</small></div>
    <div class="interaction-body">
      <p>Which release channel should receive the validated build?</p>
      <button class="choice selected"><span class="radio"></span> Internal validation</button>
      <button class="choice"><span class="radio"></span> Stable</button>
      <div class="interaction-actions"><button class="quiet">Write message</button><button class="quiet">Dismiss</button><button class="primary">Respond</button></div>
    </div>
    <div class="stack-tabs"><button>1 · Channel</button><button>2 · Confirm signing</button></div>
  </div>`;
}

function heldControl() {
  return `<div class="interaction"><div class="interaction-head"><strong>Held follow-up</strong><small>after Interrupted Run 17</small></div><div class="interaction-body"><p>Re-run the index verification after recovery.</p><div class="interaction-actions"><button class="quiet">Cancel</button><button class="primary">Release</button></div></div></div>`;
}

function dock() {
  let surface = composer();
  if (state.scenario === "interactions") surface = interaction();
  if (state.scenario === "held") surface = heldControl();
  return `<div class="control-dock"><div class="control-surface">${surface}</div></div>`;
}

function drawer() {
  if (state.scenario !== "drawer") return "";
  return `<div class="drawer-backdrop" data-action="close-drawer"></div><aside class="drawer">
    <div class="drawer-head"><span class="brand-mark">P</span> Pidex <button class="icon" data-action="close-drawer">×</button></div>
    <button class="drawer-action">＋ New Session</button><button class="drawer-search">⌕ Search Sessions</button>
    <div class="drawer-scroll"><div class="section-title">Projects</div><div class="project-title">⌄ Pidex</div>
      ${sessions.map((session, index) => `<button class="session-row ${index === 0 ? "selected" : ""} ${session.unread ? "unread" : ""}"><span class="cue ${session.cue || (session.unread ? "unread" : "")}"></span><span class="row-copy"><span class="row-title">${session.title}</span><span class="row-meta">${session.meta}</span></span><span class="row-time">${session.time}</span></button>`).join("")}
      <div class="section-title">Chats</div><button class="session-row unread"><span class="cue unread"></span><span class="row-copy"><span class="row-title">Explore API response shape</span><span class="row-meta">Completed</span></span><span class="row-time">Fri</span></button>
    </div><div class="drawer-host"><strong>● Current</strong><small>Host synced just now · This Device</small></div>
  </aside>`;
}

function render() {
  const prototype = document.querySelector("#prototype");
  prototype.innerHTML = `<div class="phone variant-${state.variant.toLowerCase()}">${header()}${connectionRow()}${timeline()}${state.scenario === "working" ? `<button class="jump">↓ Latest</button>` : ""}${dock()}${drawer()}</div>`;
  document.querySelector("#variant-label").textContent = `${state.variant} — ${variants[state.variant].name}`;
  document.querySelector("#scenario").value = state.scenario;
}

function updateUrl() {
  const url = new URL(location.href);
  url.searchParams.set("variant", state.variant);
  url.searchParams.set("scenario", state.scenario);
  history.replaceState({}, "", url);
  render();
}

function cycle(direction) {
  const keys = Object.keys(variants);
  state.variant = keys[(keys.indexOf(state.variant) + direction + keys.length) % keys.length];
  updateUrl();
}

const scenarioSelect = document.querySelector("#scenario");
scenarioSelect.innerHTML = Object.entries(scenarios).map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
scenarioSelect.onchange = event => { state.scenario = event.target.value; updateUrl(); };
document.querySelector("#previous").onclick = () => cycle(-1);
document.querySelector("#next").onclick = () => cycle(1);
document.querySelector("#variant-label").onclick = () => { state.scenario = "drawer"; updateUrl(); };
document.addEventListener("click", event => {
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action === "drawer") { state.scenario = "drawer"; updateUrl(); }
  if (action === "close-drawer") { state.scenario = "working"; updateUrl(); }
});
document.addEventListener("keydown", event => {
  if (["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName) || event.target.isContentEditable) return;
  if (event.key === "ArrowLeft") cycle(-1);
  if (event.key === "ArrowRight") cycle(1);
});

render();
