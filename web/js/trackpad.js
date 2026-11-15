// Trackpad: touch gestures to mouse reports (docs/web-client.md). No DOM access,
// so it can be unit-tested; fullscreen.js feeds it pointer events.

import { MOUSE_BUTTON, TIMING, TRACKPAD } from "./constants.js";

const TAP_BUTTONS = [null, MOUSE_BUTTON.LEFT, MOUSE_BUTTON.RIGHT, MOUSE_BUTTON.MIDDLE];

export function clampSpeed(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return TRACKPAD.speedDefault;
  return Math.min(TRACKPAD.speedMax, Math.max(TRACKPAD.speedMin, number));
}

/**
 * Turns movement in CSS pixels into mouse reports: applies the speed, keeps
 * the fractions for the next call, and tracks which buttons are held.
 */
export class MouseSender {
  #push;
  #buttons = 0;
  #x = 0;
  #y = 0;
  #wheel = 0;
  speed = TRACKPAD.speedDefault;
  /** Content follows the fingers, as on phones and Macs. */
  naturalScroll = true;

  /** @param {(state: {buttons: number, dx?: number, dy?: number, wheel?: number}) => void} push */
  constructor(push) {
    this.#push = push;
  }

  get buttons() {
    return this.#buttons;
  }

  move(dx, dy) {
    this.#x += dx * this.speed;
    this.#y += dy * this.speed;
    const x = Math.trunc(this.#x);
    const y = Math.trunc(this.#y);
    this.#x -= x;
    this.#y -= y;
    if (x !== 0 || y !== 0) this.#push({ buttons: this.#buttons, dx: x, dy: y });
  }

  /** @param {number} dy  finger travel in CSS px, down positive */
  scroll(dy) {
    // The wheel is positive away from the user: content moves down
    this.#wheel += (this.naturalScroll ? dy : -dy) / TRACKPAD.scrollStep;
    const steps = Math.trunc(this.#wheel);
    this.#wheel -= steps;
    if (steps !== 0) this.#push({ buttons: this.#buttons, wheel: steps });
  }

  press(button) {
    if (this.#buttons & button) return;
    this.#buttons |= button;
    this.#push({ buttons: this.#buttons });
  }

  release(button) {
    if (!(this.#buttons & button)) return;
    this.#buttons &= ~button;
    this.#push({ buttons: this.#buttons });
  }

  click(button) {
    this.press(button);
    this.release(button);
  }

  /** Release every button on the target. */
  releaseAll() {
    if (this.#buttons === 0) return;
    this.#buttons = 0;
    this.#push({ buttons: 0 });
  }

  /** Forget all state without sending (e.g. after a disconnect). */
  reset() {
    this.#buttons = 0;
    this.#x = this.#y = this.#wheel = 0;
  }
}

/**
 * Gestures:
 *   one finger moves the pointer; tap = left click
 *   tap, then touch again within 300 ms = left button held until lifted (drag;
 *     a second quick tap makes a double click)
 *   two fingers move = scroll; two-finger tap = right click
 *   three-finger tap = middle click
 * A tap is at most 250 ms long and moves at most 10 px.
 */
export class TrackpadGestures {
  #mouse;
  #pointers = new Map(); // id → { x, y }
  #session = null; // from the first finger down to the last finger up
  #lastTap = null; // { time } of the last one-finger tap

  /** @param {MouseSender} mouse */
  constructor(mouse) {
    this.#mouse = mouse;
  }

  get active() {
    return this.#pointers.size > 0;
  }

  down(id, x, y, time) {
    if (this.#pointers.has(id)) return;
    this.#pointers.set(id, { x, y });
    if (!this.#session) {
      const dragging = this.#lastTap !== null && time - this.#lastTap.time <= TIMING.dragWindow;
      this.#lastTap = null;
      this.#session = { start: time, travel: 0, maxPointers: 1, dragging };
      if (dragging) this.#mouse.press(MOUSE_BUTTON.LEFT);
      return;
    }
    const session = this.#session;
    session.maxPointers = Math.max(session.maxPointers, this.#pointers.size);
    // A second finger turns a drag into scrolling
    if (session.dragging) {
      session.dragging = false;
      this.#mouse.release(MOUSE_BUTTON.LEFT);
    }
  }

  move(id, x, y) {
    const pointer = this.#pointers.get(id);
    if (!pointer) return;
    const dx = x - pointer.x;
    const dy = y - pointer.y;
    pointer.x = x;
    pointer.y = y;
    const session = this.#session;
    session.travel += Math.hypot(dx, dy);
    // Once more than one finger has touched, the pointer stays put until all are up
    if (session.maxPointers === 1) {
      this.#mouse.move(dx, dy);
    } else if (this.#pointers.size >= 2) {
      // Each finger's move counts for its share of the fingers' average
      this.#mouse.scroll(dy / this.#pointers.size);
    }
  }

  up(id, time) {
    this.#end(id, time, true);
  }

  cancel(id, time) {
    this.#end(id, time, false);
  }

  /** Release everything, e.g. when the trackpad is hidden. */
  reset() {
    this.#pointers.clear();
    if (this.#session?.dragging) this.#mouse.release(MOUSE_BUTTON.LEFT);
    this.#session = null;
    this.#lastTap = null;
  }

  #end(id, time, completed) {
    if (!this.#pointers.delete(id) || this.#pointers.size > 0) return;
    const session = this.#session;
    this.#session = null;
    if (session.dragging) {
      this.#mouse.release(MOUSE_BUTTON.LEFT);
      return;
    }
    const tap =
      completed &&
      time - session.start <= TIMING.tapMaxDuration &&
      session.travel <= TRACKPAD.tapMaxTravel;
    if (!tap) return;
    const button = TAP_BUTTONS[Math.min(session.maxPointers, 3)];
    this.#mouse.click(button);
    if (session.maxPointers === 1) this.#lastTap = { time };
  }
}
