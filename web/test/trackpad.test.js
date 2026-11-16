import { test } from "node:test";
import assert from "node:assert/strict";
import { clampSpeed, MouseSender, TrackpadGestures } from "../js/trackpad.js";

function setup({ speed = 1, naturalScroll = true } = {}) {
  const pushed = [];
  const mouse = new MouseSender((state) => pushed.push({ dx: 0, dy: 0, wheel: 0, ...state }));
  mouse.speed = speed;
  mouse.naturalScroll = naturalScroll;
  return { pushed, mouse, gestures: new TrackpadGestures(mouse) };
}

const clicks = (pushed) => pushed.map((p) => p.buttons);

test("speed scales movement and keeps fractions", () => {
  const { pushed, mouse } = setup({ speed: 1.5 });
  mouse.move(1, 0); // 1.5 → 1, 0.5 kept
  mouse.move(1, 0); // 2.0 → 2
  mouse.move(0.2, -0.2); // below one count: nothing sent
  assert.deepEqual(
    pushed.map((p) => [p.dx, p.dy]),
    [
      [1, 0],
      [2, 0],
    ],
  );
});

test("natural scrolling: fingers up scroll down (negative wheel)", () => {
  const { pushed, mouse } = setup();
  mouse.scroll(-45); // 20 px per step: 2 steps, 5 px kept
  mouse.scroll(-15);
  assert.deepEqual(
    pushed.map((p) => p.wheel),
    [-2, -1],
  );
  const reversed = setup({ naturalScroll: false });
  reversed.mouse.scroll(-40);
  assert.equal(reversed.pushed[0].wheel, 2);
});

test("one-finger drag moves; a tap clicks left", () => {
  const { pushed, gestures } = setup();
  gestures.down(1, 0, 0, 0);
  gestures.move(1, 30, 10);
  gestures.up(1, 400);
  assert.deepEqual(pushed, [{ buttons: 0, dx: 30, dy: 10, wheel: 0 }]);

  pushed.length = 0;
  gestures.down(2, 0, 0, 1000);
  gestures.move(2, 2, 2); // small jitter still counts as a tap
  gestures.up(2, 1100);
  assert.deepEqual(clicks(pushed.filter((p) => !p.dx)), [1, 0]);
});

test("long or moving touches are not taps", () => {
  const { pushed, gestures } = setup();
  gestures.down(1, 0, 0, 0);
  gestures.up(1, 600);
  gestures.down(2, 0, 0, 2000);
  gestures.move(2, 50, 0);
  gestures.move(2, 0, 0);
  gestures.up(2, 2100);
  assert.ok(pushed.every((p) => p.buttons === 0));
});

test("two-finger tap clicks right; three-finger tap clicks middle", () => {
  const { pushed, gestures } = setup();
  gestures.down(1, 0, 0, 0);
  gestures.down(2, 50, 0, 10);
  gestures.up(1, 100);
  gestures.up(2, 110);
  assert.deepEqual(clicks(pushed), [2, 0]);

  pushed.length = 0;
  gestures.down(1, 0, 0, 1000);
  gestures.down(2, 50, 0, 1010);
  gestures.down(3, 100, 0, 1020);
  gestures.up(1, 1100);
  gestures.up(2, 1100);
  gestures.up(3, 1100);
  assert.deepEqual(clicks(pushed), [4, 0]);
});

test("two fingers scroll and do not move the pointer", () => {
  const { pushed, gestures } = setup();
  gestures.down(1, 0, 100, 0);
  gestures.down(2, 50, 100, 5);
  // Both fingers move up 40 px: average 40 px, 2 wheel steps
  gestures.move(1, 0, 60);
  gestures.move(2, 50, 60);
  // One finger lifted: the other one still does not move the pointer
  gestures.up(1, 500);
  gestures.move(2, 100, 0);
  gestures.up(2, 600);
  assert.ok(pushed.every((p) => p.dx === 0 && p.dy === 0));
  assert.equal(
    pushed.reduce((sum, p) => sum + p.wheel, 0),
    -2,
  );
});

test("tap, then touch and move: drags with the left button held", () => {
  const { pushed, gestures } = setup();
  gestures.down(1, 0, 0, 0);
  gestures.up(1, 100); // click
  gestures.down(2, 0, 0, 300); // within 300 ms of the tap: press
  gestures.move(2, 20, 0);
  gestures.up(2, 900); // release
  assert.deepEqual(
    pushed.map((p) => [p.buttons, p.dx]),
    [
      [1, 0],
      [0, 0],
      [1, 0],
      [1, 20],
      [0, 0],
    ],
  );
});

test("a double tap is a double click", () => {
  const { pushed, gestures } = setup();
  gestures.down(1, 0, 0, 0);
  gestures.up(1, 80);
  gestures.down(2, 0, 0, 200);
  gestures.up(2, 280);
  // A third tap right after is a new single click, not a drag
  gestures.down(3, 0, 0, 400);
  gestures.up(3, 480);
  assert.deepEqual(clicks(pushed), [1, 0, 1, 0, 1, 0]);
});

test("a cancelled drag releases the button; reset releases it too", () => {
  const { pushed, gestures } = setup();
  gestures.down(1, 0, 0, 0);
  gestures.up(1, 50);
  gestures.down(2, 0, 0, 100);
  gestures.cancel(2, 150);
  assert.deepEqual(clicks(pushed), [1, 0, 1, 0]);

  pushed.length = 0;
  gestures.down(3, 0, 0, 1000);
  gestures.up(3, 1050);
  gestures.down(4, 0, 0, 1100);
  gestures.reset();
  assert.deepEqual(clicks(pushed), [1, 0, 1, 0]);
  assert.equal(gestures.active, false);
});

test("mouse buttons: press and release once each; releaseAll", () => {
  const { pushed, mouse } = setup();
  mouse.press(1);
  mouse.press(1);
  mouse.press(2);
  mouse.move(1, 0);
  mouse.releaseAll();
  mouse.releaseAll();
  assert.deepEqual(
    pushed.map((p) => [p.buttons, p.dx]),
    [
      [1, 0],
      [3, 0],
      [3, 1],
      [0, 0],
    ],
  );
});

test("speed setting is clamped", () => {
  assert.equal(clampSpeed("3"), 3);
  assert.equal(clampSpeed(0), 0.5);
  assert.equal(clampSpeed(99), 5);
  assert.equal(clampSpeed("x"), 2);
});
