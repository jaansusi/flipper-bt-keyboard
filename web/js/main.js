// Page wiring. All protocol logic lives in the other modules.

import { TIMING } from "./constants.js";
import { bluetoothSupported, FlipperConnection } from "./ble.js";
import { ComposeSender, clampInterval } from "./compose.js";
import { loadLayout, loadLayoutIndex } from "./layouts.js";
import { attachLiveCapture, detectPlatform, LiveState } from "./live.js";
import { buttonReports, KEY_GROUPS, STICKY_MODIFIERS, StickyModifiers } from "./onscreen.js";
import { SendQueue } from "./queue.js";

const $ = (id) => document.getElementById(id);

// localStorage can be missing or throw (private mode, blocked storage)
const storage = {
  get(key, fallback) {
    try {
      return localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Not persisted; defaults apply next time.
    }
  },
};

const connection = new FlipperConnection();
const queue = new SendQueue((bytes) => connection.write(bytes), {
  onError: (error) => showMessage(`Sending failed: ${error.message}`),
});
const live = new LiveState({ platform: detectPlatform() });
const sticky = new StickyModifiers();
const composer = new ComposeSender(queue);
let layout = null;

function send(reports) {
  if (connection.connected) queue.push(...reports);
}

function showMessage(text) {
  $("message-text").textContent = text;
  $("message").hidden = false;
}

function hideMessage() {
  $("message").hidden = true;
}

// --- Connection -------------------------------------------------------------

function renderConnection() {
  const { state } = connection;
  const status = $("status");
  status.dataset.state = state;
  status.textContent =
    state === "connected"
      ? `Connected${connection.deviceName ? ` to ${connection.deviceName}` : ""}`
      : state === "connecting"
        ? "Connecting… (enter the PIN if asked)"
        : "Disconnected";

  const connect = $("connect");
  connect.hidden = state === "connected";
  connect.disabled = state === "connecting";
  connect.textContent = connection.hasDevice ? "Reconnect" : "Connect";
  $("disconnect").hidden = state !== "connected";
  $("help").hidden = state === "connected";

  const connected = state === "connected";
  document.querySelectorAll("button.sends, #key-groups button").forEach((button) => {
    button.disabled = !connected || (button.classList.contains("sends") && composer.sending);
  });
  $("capture").setAttribute("aria-disabled", String(!connected));
}

function setupConnection() {
  connection.addEventListener("statechange", () => {
    if (!connection.connected) {
      composer.stop({ release: false });
      queue.clear();
      live.releaseAll();
      sticky.clear();
    }
    renderConnection();
  });

  $("connect").addEventListener("click", async () => {
    hideMessage();
    try {
      if (connection.hasDevice) await connection.reconnect();
      else await connection.connect();
    } catch (error) {
      // The user closed the device chooser
      if (error.name === "NotFoundError" && /cancel/i.test(error.message)) return;
      showMessage(`Could not connect: ${error.message}`);
    }
  });
  $("disconnect").addEventListener("click", () => connection.disconnect());
  $("message-close").addEventListener("click", hideMessage);
}

// --- Tabs -------------------------------------------------------------------

function selectTab(name) {
  for (const tab of ["compose", "live"]) {
    const selected = tab === name;
    $(`tab-${tab}`).setAttribute("aria-selected", String(selected));
    $(`panel-${tab}`).hidden = !selected;
  }
  storage.set("rk.tab", name);
}

function setupTabs() {
  const touch = matchMedia("(pointer: coarse)").matches;
  selectTab(storage.get("rk.tab", touch ? "compose" : "live"));
  $("tab-compose").addEventListener("click", () => selectTab("compose"));
  $("tab-live").addEventListener("click", () => {
    selectTab("live");
    $("capture").focus();
  });
}

// --- Compose ----------------------------------------------------------------

function setComposing(sending) {
  $("compose-stop").hidden = !sending;
  renderConnection();
}

async function compose(text, { label }) {
  if (!layout) {
    showMessage("No keyboard layout loaded.");
    return;
  }
  if (!text) return;
  hideMessage();
  const progress = $("compose-progress");
  const sending = composer.send(text, layout, $("interval").value, (sent, total) => {
    progress.textContent = `Sending ${sent} of ${total}…`;
  });
  // composer.sending is already true here, so the Send buttons get disabled
  setComposing(true);
  try {
    const result = await sending;
    // Local information only: nothing comes back from the Flipper (SPEC §7.7)
    const skipped = result.skipped ? `, skipped ${result.skipped} not in the ${layout.name} layout` : "";
    progress.textContent = result.stopped
      ? `Stopped after ${result.sent} of ${result.total} characters`
      : `Sent ${result.sent} ${label}${skipped}`;
  } finally {
    setComposing(false);
  }
}

function setupCompose() {
  $("compose-send").addEventListener("click", () => {
    const text = $("compose-text").value;
    compose(text, { label: text.length === 1 ? "character" : "characters" });
  });
  $("compose-stop").addEventListener("click", () => composer.stop());

  $("password-send").addEventListener("click", () => {
    const field = $("password");
    let text = field.value;
    // Clear before sending so the value lives no longer than needed (WEB-10)
    field.value = "";
    if (text && $("password-enter").checked) text += "\n";
    compose(text, { label: "password characters" });
  });
  $("password").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      $("password-send").click();
    }
  });

  const interval = $("interval");
  interval.value = clampInterval(storage.get("rk.interval", TIMING.composeIntervalDefault));
  interval.addEventListener("change", () => {
    interval.value = clampInterval(interval.value);
    storage.set("rk.interval", interval.value);
  });
}

async function setupLayouts() {
  const select = $("layout");
  try {
    const index = await loadLayoutIndex();
    for (const entry of index) select.add(new Option(entry.name, entry.id));
    const load = async (id) => {
      const entry = index.find((e) => e.id === id) ?? index[0];
      layout = await loadLayout(entry.file);
      select.value = entry.id;
      storage.set("rk.layout", entry.id);
    };
    select.addEventListener("change", () =>
      load(select.value).catch((error) => showMessage(`Could not load layout: ${error.message}`)),
    );
    await load(storage.get("rk.layout", "us"));
  } catch (error) {
    showMessage(`Could not load keyboard layouts: ${error.message}`);
  }
}

// --- Live -------------------------------------------------------------------

function setupLive() {
  const capture = $("capture");
  attachLiveCapture(capture, live, send);

  const fullscreen = $("fullscreen");
  if (!navigator.keyboard?.lock || !document.documentElement.requestFullscreen) return;
  fullscreen.hidden = false;
  fullscreen.addEventListener("click", async () => {
    try {
      await document.documentElement.requestFullscreen();
      await navigator.keyboard.lock();
      selectTab("live");
      capture.focus();
    } catch (error) {
      showMessage(`Fullscreen not available: ${error.message}`);
    }
  });
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement) navigator.keyboard.unlock();
  });
}

// --- On-screen keys ---------------------------------------------------------

function renderSticky() {
  document.querySelectorAll("#sticky button").forEach((button) => {
    button.setAttribute("aria-pressed", String(sticky.isActive(Number(button.dataset.mod))));
  });
}

function makeKeyButton(button) {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = button.label;
  if (button.aria) element.setAttribute("aria-label", button.aria);

  if (!button.repeat) {
    element.addEventListener("click", () => send(buttonReports(button, sticky.consume())));
    return element;
  }

  // Held repeat buttons: first repeat after 400 ms, then every 50 ms (SPEC §7.5)
  let delayTimer = null;
  let repeatTimer = null;
  let mods = 0;
  const stop = () => {
    clearTimeout(delayTimer);
    clearInterval(repeatTimer);
    delayTimer = repeatTimer = null;
  };
  element.addEventListener("pointerdown", (event) => {
    if (element.disabled || event.button !== 0) return;
    mods = sticky.consume();
    send(buttonReports(button, mods));
    delayTimer = setTimeout(() => {
      repeatTimer = setInterval(() => send(buttonReports(button, mods)), TIMING.repeatInterval);
    }, TIMING.repeatDelay);
  });
  for (const type of ["pointerup", "pointercancel", "pointerleave"]) {
    element.addEventListener(type, stop);
  }
  // Keyboard activation (Enter/Space) produces a click with detail 0
  element.addEventListener("click", (event) => {
    if (event.detail === 0) send(buttonReports(button, sticky.consume()));
  });
  return element;
}

function setupKeys() {
  const stickyBox = $("sticky");
  for (const { label, mod } of STICKY_MODIFIERS) {
    const element = document.createElement("button");
    element.type = "button";
    element.textContent = label;
    element.dataset.mod = String(mod);
    element.addEventListener("click", () => sticky.toggle(mod));
    stickyBox.append(element);
  }
  sticky.addEventListener("change", renderSticky);
  renderSticky();

  const groups = $("key-groups");
  for (const group of KEY_GROUPS) {
    const section = document.createElement("div");
    section.className = "key-group";
    const keys = document.createElement("div");
    keys.className = "keys";
    keys.append(...group.buttons.map(makeKeyButton));

    if (group.collapsible) {
      const details = document.createElement("details");
      details.open = !matchMedia("(pointer: coarse)").matches;
      const summary = document.createElement("summary");
      summary.textContent = group.label;
      details.append(summary, keys);
      section.append(details);
    } else {
      const heading = document.createElement("h3");
      heading.textContent = group.label;
      section.append(heading, keys);
    }
    groups.append(section);
  }
}

// --- Start ------------------------------------------------------------------

async function init() {
  setupTabs();
  setupConnection();
  setupCompose();
  setupLive();
  setupKeys();
  renderConnection();

  if (!(await bluetoothSupported())) {
    $("unsupported").hidden = false;
    $("connect").hidden = true;
    $("help").hidden = true;
  }
  await setupLayouts();
  registerServiceWorker();
}

// Offline support (WEB-15). Not available everywhere (e.g. some in-app
// browsers); the page works without it.
function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

init();
