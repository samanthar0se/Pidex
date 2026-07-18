const statusList = document.querySelector("#status");
const pairingSection = document.querySelector("#pairing");
const pairingSecret = new URL(location.href).searchParams.get("pair");
let controlSocket;

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
  const { status } = JSON.parse(data);

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
