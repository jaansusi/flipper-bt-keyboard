// Page wiring. All protocol logic lives in the other modules.

import { TIMING } from "./constants.js";
import { bluetoothSupported, FlipperConnection } from "./ble.js";
import { ComposeSender, clampInterval, textToStrokes } from "./compose.js";
import { CODE_TO_USAGE } from "./keymap.js";
import { loadLayout, loadLayoutIndex } from "./layouts.js";
import { attachLiveCapture, detectPlatform, LiveState } from "./live.js";
import {
  buttonReports,
  KEY_GROUPS,
  ModifierMode,
  STICKY_MODIFIERS,
  StickyModifiers,
  withHeld,
} from "./onscreen.js";
import { SendQueue } from "./queue.js";
import { makeReport, zeroReport } from "./report.js";
import { attachTextInput } from "./textinput.js";
import { setupTouchView } from "./touchview.js";
import { clampSpeed, MouseSender } from "./trackpad.js";

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
const sticky = new StickyModifiers();
const queue = new SendQueue((bytes, channel) => connection.write(bytes, channel), {
  onError: (error) => showMessage(`Sending failed: ${error.message}`),
  // Held modifiers stay pressed through every report, from every input mode
  transform: (report) => withHeld(report, sticky.heldMask),
});
const live = new LiveState({ platform: detectPlatform() });
const composer = new ComposeSender(queue);
const mouse = new MouseSender((state) => {
  if (connection.connected && connection.mouseSupported) queue.pushMouse(state);
});
let layout = null;
let touchView = null;

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

  const connected = state === "connected";
  document.querySelectorAll("button.sends, .key-groups button").forEach((button) => {
    button.disabled = !connected || (button.classList.contains("sends") && composer.sending);
  });
  $("capture").setAttribute("aria-disabled", String(!connected));
  $("live-text").disabled = !connected;
  touchView?.render();
}

function setupConnection() {
  connection.addEventListener("statechange", () => {
    if (!connection.connected) {
      composer.stop({ release: false });
      queue.clear();
      live.releaseAll();
      sticky.clear();
      touchView?.disconnected();
      mouse.reset();
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
      if (error?.name === "NotFoundError" && /cancel/i.test(error?.message)) return;
      // Some browsers (e.g. Bluefy) reject with values that are not Error objects
      const detail = error?.message || error?.name || String(error);
      showMessage(
        `Could not connect: ${detail}. If this keeps happening, the pairing may be out of date ` +
          "(e.g. after Forget paired devices on the Flipper): remove the Flipper in this " +
          "device's Bluetooth settings, then connect again and enter the new PIN.",
      );
    }
  });
  $("disconnect").addEventListener("click", () => connection.disconnect());
  $("message-close").addEventListener("click", hideMessage);
}

// --- Tabs -------------------------------------------------------------------

function selectTab(name) {
  if (!["compose", "live", "touch"].includes(name)) name = "compose";
  for (const tab of ["compose", "live", "touch"]) {
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
  $("tab-touch").addEventListener("click", () => selectTab("touch"));
  $("tab-live").addEventListener("click", () => {
    selectTab("live");
    // On phones, focusing the field here opens the keyboard straight away
    $($("live-touch").hidden ? "capture" : "live-text").focus();
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
    // Local information only: nothing comes back from the Flipper
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
    // Clear before sending so the value lives no longer than needed
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

  const speed = $("trackpad-speed");
  speed.value = mouse.speed = clampSpeed(storage.get("rk.speed", mouse.speed));
  speed.addEventListener("input", () => {
    mouse.speed = clampSpeed(speed.value);
    storage.set("rk.speed", String(mouse.speed));
  });
  const natural = $("natural-scroll");
  natural.checked = mouse.naturalScroll = storage.get("rk.naturalScroll", "1") === "1";
  natural.addEventListener("change", () => {
    mouse.naturalScroll = natural.checked;
    storage.set("rk.naturalScroll", natural.checked ? "1" : "0");
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

// Phones: type with the on-screen keyboard; characters go through the layout
function tap(usage) {
  send(buttonReports({ mods: 0, keys: [usage] }, sticky.consume()));
}

function typeLiveText(text) {
  if (!layout) return;
  const { chars, skipped } = textToStrokes(text, layout);
  for (const { strokes } of chars) {
    const once = sticky.consume();
    for (const [mods, usage] of strokes) send([makeReport(mods | once, [usage]), zeroReport()]);
  }
  // Don't echo the text itself: it may be a password
  if (skipped > 0) {
    showMessage(`${skipped} character${skipped === 1 ? "" : "s"} not in the ${layout.name} layout, not sent.`);
  }
}

function setupLive() {
  const touch = matchMedia("(pointer: coarse)").matches;
  $("live-touch").hidden = !touch;
  $("live-desktop").hidden = touch;

  attachTextInput($("live-text"), {
    onText: typeLiveText,
    onBackspace: (count) => {
      for (let i = 0; i < count; i++) tap(CODE_TO_USAGE.Backspace);
    },
    onEnter: () => tap(CODE_TO_USAGE.Enter),
  });

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

const MODE_LABEL = { [ModifierMode.Once]: "once", [ModifierMode.Held]: "held" };
let appliedHeldMask = 0;

function renderModifiers() {
  const active = STICKY_MODIFIERS.filter(({ mod }) => sticky.mode(mod) !== ModifierMode.Off).map(
    ({ label, mod }) => `${label} ${MODE_LABEL[sticky.mode(mod)]}`,
  );
  // On the page, in the full-screen popup, and on the full-screen keyboard
  document.querySelectorAll("button[data-mod]").forEach((button) => {
    const mode = sticky.mode(Number(button.dataset.mod));
    const label = button.dataset.label;
    button.dataset.mode = mode;
    const modeText = button.querySelector(".mode");
    if (modeText) modeText.textContent = MODE_LABEL[mode] ?? "";
    button.setAttribute("aria-pressed", String(mode !== ModifierMode.Off));
    button.setAttribute("aria-label", mode === ModifierMode.Off ? label : `${label}, ${MODE_LABEL[mode]}`);
  });
  // Visible even when the Modifiers section is collapsed
  document.querySelectorAll(".modifier-badge").forEach((badge) => (badge.textContent = active.join(" · ")));
  touchView?.renderModifiers();
}

function onModifiersChange() {
  renderModifiers();
  // Press or release held modifiers on the target right away
  if (sticky.heldMask !== appliedHeldMask) {
    appliedHeldMask = sticky.heldMask;
    send([zeroReport()]);
  }
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

  // Held repeat buttons: first repeat after 400 ms, then every 50 ms
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

function makeModifierButton({ label, mod }) {
  const element = document.createElement("button");
  element.type = "button";
  element.dataset.mod = String(mod);
  element.dataset.label = label;
  const mode = document.createElement("span");
  mode.className = "mode";
  element.append(label, mode);
  element.addEventListener("click", () => sticky.cycle(mod));
  return element;
}

/** A collapsible group; remembers whether it was open. */
function makeGroup(id, label, content, { storagePrefix, openByDefault }) {
  const details = document.createElement("details");
  details.className = "key-group";
  const storageKey = `${storagePrefix}${id}`;
  details.open = storage.get(storageKey, openByDefault ? "1" : "0") === "1";
  details.addEventListener("toggle", () => storage.set(storageKey, details.open ? "1" : "0"));
  const summary = document.createElement("summary");
  summary.textContent = label;
  details.append(summary, ...content);
  return details;
}

/**
 * Fill a container with the modifier and key groups.
 * @param {{ storagePrefix: string, openByDefault: boolean }} options
 */
function buildKeyGroups(groups, options) {
  const modifierKeys = document.createElement("div");
  modifierKeys.className = "keys";
  modifierKeys.append(...STICKY_MODIFIERS.map(makeModifierButton));
  const modifiers = makeGroup("modifiers", "Modifiers", [modifierKeys], options);
  const badge = document.createElement("span");
  badge.className = "badge modifier-badge";
  modifiers.querySelector("summary").append(badge);
  groups.append(modifiers);

  for (const group of KEY_GROUPS) {
    const keys = document.createElement("div");
    keys.className = "keys";
    keys.append(...group.buttons.map(makeKeyButton));
    groups.append(makeGroup(group.id, group.label, [keys], options));
  }
}

function setupKeys() {
  const groups = $("key-groups");
  buildKeyGroups(groups, { storagePrefix: "rk.open.", openByDefault: false });

  // Keep focus (and the phone keyboard) in the typing area when tapping keys,
  // so live typing and held modifiers combine, e.g. Alt held + Tab on the keyboard.
  // Cancelling pointerdown stops the mouse events that would move focus.
  groups.addEventListener("pointerdown", (event) => {
    const typing = document.activeElement === $("live-text") || document.activeElement === $("capture");
    if (typing && event.target.closest("button, summary")) event.preventDefault();
  });

  sticky.addEventListener("change", onModifiersChange);
}

// --- Full-screen keyboard and trackpad --------------------------------------

function setupTouch() {
  touchView = setupTouchView({
    connection,
    sticky,
    mouse,
    send,
    storage,
    buildKeyGroups: (container) =>
      buildKeyGroups(container, { storagePrefix: "rk.popup.", openByDefault: true }),
    connect: () => $("connect").click(),
  });
  document.querySelectorAll("[data-open-view]").forEach((button) => {
    button.addEventListener("click", () => touchView.open(button.dataset.openView));
  });
}

// --- Start ------------------------------------------------------------------

async function init() {
  setupTabs();
  setupConnection();
  setupCompose();
  setupLive();
  setupKeys();
  setupTouch();
  renderModifiers();
  renderConnection();

  if (!(await bluetoothSupported())) {
    $("unsupported").hidden = false;
    $("connect").hidden = true;
  }
  await setupLayouts();
  registerServiceWorker();
}

// Offline support. Not available everywhere (e.g. some in-app
// browsers); the page works without it.
function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

init();
