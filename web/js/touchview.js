// Full-screen view: on-screen keyboard and trackpad (docs/web-client.md).

import { MOD } from "./constants.js";
import { FULL_LAYOUT_MIN_WIDTH, KEYBOARD_LAYOUTS, TouchKeys } from "./keyboard.js";
import { ModifierMode } from "./onscreen.js";
import { TrackpadGestures } from "./trackpad.js";

const $ = (id) => document.getElementById(id);

const MODES = ["keyboard", "both", "trackpad"];

/**
 * @param {{
 *   connection: import("./ble.js").FlipperConnection,
 *   sticky: import("./onscreen.js").StickyModifiers,
 *   mouse: import("./trackpad.js").MouseSender,
 *   send: (reports: Uint8Array[]) => void,
 *   storage: { get: (key: string, fallback: string) => string, set: (key: string, value: string) => void },
 *   buildKeyGroups: (container: HTMLElement) => void,
 *   connect: () => void,
 * }} context
 */
export function setupTouchView({ connection, sticky, mouse, send, storage, buildKeyGroups, connect }) {
  const view = $("touch-view");
  const keyboard = $("touch-keyboard");
  const trackpad = $("trackpad");
  const popup = $("touch-popup");
  const special = $("touch-special");

  const touchKeys = new TouchKeys();
  const gestures = new TrackpadGestures(mouse);
  let mode = MODES.includes(storage.get("rk.view", "")) ? storage.get("rk.view", "") : "both";
  let page = "letters"; // compact layouts only
  let fullLayout = false;
  let wakeLock = null;

  // --- Keyboard -------------------------------------------------------------

  const shifted = () => sticky.mode(MOD.LSHIFT) !== ModifierMode.Off;

  function releaseKeys() {
    const report = touchKeys.releaseAll();
    if (report) send([report]);
    keyboard.querySelectorAll("[data-down]").forEach((element) => delete element.dataset.down);
  }

  function makeKey(spec) {
    const element = document.createElement(spec.type === "gap" ? "span" : "button");
    element.className = `tk-key tk-${spec.type}`;
    element.style.setProperty("--w", spec.width);
    if (spec.type === "gap") return element;
    element.type = "button";
    element.textContent = spec.label;

    if (spec.type === "mod") {
      // Same as the modifier buttons: off → once → held. main.js renders mode changes.
      const current = sticky.mode(spec.mod);
      element.dataset.mod = String(spec.mod);
      element.dataset.label = spec.label;
      element.dataset.mode = current;
      element.setAttribute("aria-pressed", String(current !== ModifierMode.Off));
      element.addEventListener("click", () => sticky.cycle(spec.mod));
      return element;
    }
    if (spec.type === "layer") {
      element.addEventListener("click", () => {
        releaseKeys();
        page = spec.to;
        renderKeyboard();
      });
      return element;
    }

    // A physical key: down while the finger is down, so the target repeats it when held
    if (spec.aria) element.setAttribute("aria-label", spec.aria);
    if (spec.label !== spec.shiftLabel) {
      element.dataset.label = spec.label;
      element.dataset.shiftLabel = spec.shiftLabel;
    }
    element.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      element.setPointerCapture?.(event.pointerId);
      const report = touchKeys.down(event.pointerId, spec.usage, sticky.consume());
      if (!report) return;
      element.dataset.down = "";
      send([report]);
    });
    const up = (event) => {
      const report = touchKeys.up(event.pointerId);
      if (!report) return;
      delete element.dataset.down;
      send([report]);
    };
    element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", up);
    // Keyboard activation (Enter/Space on a focused key) produces a click with detail 0
    element.addEventListener("click", (event) => {
      if (event.detail !== 0) return;
      const report = touchKeys.down("keyboard", spec.usage, sticky.consume());
      if (report) send([report, touchKeys.up("keyboard")]);
    });
    return element;
  }

  function renderKeyboard() {
    const layout = KEYBOARD_LAYOUTS[fullLayout ? "full" : page];
    keyboard.replaceChildren(
      ...layout.map((row) => {
        const element = document.createElement("div");
        element.className = "tk-row";
        element.append(...row.map(makeKey));
        return element;
      }),
    );
    renderModifiers();
  }

  /** Shifted labels while Shift is on. Modifier keys are rendered by main.js. */
  function renderModifiers() {
    const shift = shifted();
    keyboard.querySelectorAll("[data-shift-label]").forEach((element) => {
      element.textContent = shift ? element.dataset.shiftLabel : element.dataset.label;
    });
  }

  // Full layout when there is room for it
  new ResizeObserver(([entry]) => {
    const full = entry.contentRect.width >= FULL_LAYOUT_MIN_WIDTH;
    if (full === fullLayout) return;
    releaseKeys();
    fullLayout = full;
    renderKeyboard();
  }).observe(keyboard);

  // --- Trackpad -------------------------------------------------------------

  trackpad.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    trackpad.setPointerCapture?.(event.pointerId);
    gestures.down(event.pointerId, event.clientX, event.clientY, event.timeStamp);
  });
  trackpad.addEventListener("pointermove", (event) => {
    gestures.move(event.pointerId, event.clientX, event.clientY);
  });
  trackpad.addEventListener("pointerup", (event) => gestures.up(event.pointerId, event.timeStamp));
  trackpad.addEventListener("pointercancel", (event) => gestures.cancel(event.pointerId, event.timeStamp));

  view.querySelectorAll(".mouse-buttons button").forEach((element) => {
    const button = Number(element.dataset.button);
    element.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      element.setPointerCapture?.(event.pointerId);
      element.dataset.down = "";
      mouse.press(button);
    });
    const up = () => {
      if (!("down" in element.dataset)) return;
      delete element.dataset.down;
      mouse.release(button);
    };
    element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", up);
    element.addEventListener("click", (event) => {
      if (event.detail === 0) mouse.click(button);
    });
  });

  function releaseMouse() {
    gestures.reset();
    mouse.releaseAll();
    view.querySelectorAll(".mouse-buttons [data-down]").forEach((element) => delete element.dataset.down);
  }

  // --- View -----------------------------------------------------------------

  function setMode(next) {
    if (next === "keyboard") releaseMouse();
    if (next === "trackpad") releaseKeys();
    mode = next;
    view.dataset.mode = mode;
    view.querySelectorAll(".segmented button").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
    });
    storage.set("rk.view", mode);
  }

  function setPopup(open) {
    popup.hidden = !open;
    special.setAttribute("aria-expanded", String(open));
  }

  async function keepScreenOn() {
    try {
      wakeLock = await navigator.wakeLock?.request("screen");
    } catch {
      // Not allowed (e.g. battery saver); the screen may turn off.
    }
  }

  function show(next) {
    setMode(next);
    if (!view.hidden) return;
    // Close the phone keyboard if a text field had focus
    document.activeElement?.blur?.();
    view.hidden = false;
    document.body.classList.add("touch-open");
    render();
    keepScreenOn();
    if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }

  function hide() {
    if (view.hidden) return;
    releaseKeys();
    releaseMouse();
    setPopup(false);
    view.hidden = true;
    document.body.classList.remove("touch-open");
    wakeLock?.release().catch(() => {});
    wakeLock = null;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }

  // The view has its own history entry, so Back closes it instead of leaving the page
  function open(next = mode) {
    if (!history.state?.touchView) history.pushState({ touchView: true }, "");
    show(next);
  }

  function close() {
    if (history.state?.touchView) history.back();
    else hide();
  }

  window.addEventListener("popstate", () => {
    if (history.state?.touchView) show(mode);
    else hide();
  });

  document.addEventListener("visibilitychange", () => {
    if (view.hidden) return;
    if (document.visibilityState === "hidden") {
      releaseKeys();
      releaseMouse();
    } else {
      keepScreenOn();
    }
  });

  view.querySelectorAll(".segmented button").forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.mode));
  });
  special.addEventListener("click", () => setPopup(popup.hidden));
  $("touch-popup-close").addEventListener("click", () => setPopup(false));
  $("touch-exit").addEventListener("click", close);
  $("touch-connect").addEventListener("click", connect);
  // No long-press menus or text selection on keys and the trackpad
  view.addEventListener("contextmenu", (event) => event.preventDefault());

  buildKeyGroups($("touch-key-groups"));

  function render() {
    const { state } = connection;
    const status = $("touch-status");
    status.dataset.state = state;
    const label = state === "connected" ? "Connected" : state === "connecting" ? "Connecting…" : "Disconnected";
    status.setAttribute("aria-label", label);
    status.title = label;

    const banner = $("touch-banner");
    banner.hidden = state === "connected";
    $("touch-banner-text").textContent =
      state === "connecting" ? "Connecting… (enter the PIN if asked)" : "Not connected to the Flipper.";
    $("touch-connect").hidden = state !== "disconnected";
    $("touch-connect").textContent = connection.hasDevice ? "Reconnect" : "Connect";

    const mouseMissing = state === "connected" && !connection.mouseSupported;
    trackpad.toggleAttribute("data-unsupported", mouseMissing);
    $("trackpad-unsupported").hidden = !mouseMissing;
  }

  setMode(mode);
  renderKeyboard();

  return {
    open,
    render,
    renderModifiers,
    /** Forget held keys and gestures; nothing can be sent any more. */
    disconnected() {
      touchKeys.releaseAll();
      gestures.reset();
      keyboard.querySelectorAll("[data-down]").forEach((element) => delete element.dataset.down);
    },
  };
}
