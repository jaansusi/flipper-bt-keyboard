import { test } from "node:test";
import assert from "node:assert/strict";
import { SendQueue } from "../js/queue.js";
import { makeReport, zeroReport } from "../js/report.js";

const hex = (bytes) => Buffer.from(bytes).toString("hex");
const A = makeReport(0, [0x04]);
const B = makeReport(0, [0x05]);
const Z = zeroReport();

function recorder({ failTimes = 0, delay = 0 } = {}) {
  const writes = [];
  let failures = 0;
  const write = async (bytes) => {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    if (failures < failTimes) {
      failures++;
      throw new Error("write failed");
    }
    writes.push(hex(bytes));
  };
  return { writes, write };
}

test("sends a single report as an 8-byte write", async () => {
  const { writes, write } = recorder();
  const queue = new SendQueue(write);
  queue.push(A);
  await queue.whenIdle();
  assert.deepEqual(writes, [hex(A)]);
});

test("pairs waiting reports into 16-byte writes, in order", async () => {
  const { writes, write } = recorder({ delay: 5 });
  const queue = new SendQueue(write);
  queue.push(A, Z, B, Z, A);
  await queue.whenIdle();
  assert.deepEqual(writes, [hex([...A, ...Z]), hex([...B, ...Z]), hex(A)]);
});

test("retries a failed write once", async () => {
  const { writes, write } = recorder({ failTimes: 1 });
  const queue = new SendQueue(write);
  queue.push(A);
  await queue.whenIdle();
  assert.deepEqual(writes, [hex(A)]);
});

test("after two failures: clears the queue, reports the error, sends zero", async () => {
  const { writes, write } = recorder({ failTimes: 2 });
  const errors = [];
  const queue = new SendQueue(write, { onError: (e) => errors.push(e.message) });
  queue.push(A, Z, B, Z);
  await queue.whenIdle();
  assert.deepEqual(errors, ["write failed"]);
  assert.deepEqual(writes, [hex(Z)]);
  assert.equal(queue.pending, 0);
});

test("clear() drops pending reports but lets later pushes through", async () => {
  const { writes, write } = recorder({ delay: 5 });
  const queue = new SendQueue(write);
  queue.push(A, Z);
  queue.push(B, Z, B, Z);
  queue.clear();
  queue.push(Z);
  await queue.whenIdle();
  // The first write was already in flight when clear() ran
  assert.deepEqual(writes, [hex([...A, ...Z]), hex(Z)]);
});

test("whenIdle resolves immediately when empty", async () => {
  const queue = new SendQueue(async () => {});
  await queue.whenIdle();
  assert.equal(queue.busy, false);
});

test("transform is applied to every pushed report", async () => {
  const { writes, write } = recorder();
  const queue = new SendQueue(write, {
    transform: (r) => {
      const c = r.slice();
      c[0] |= 0x04;
      return c;
    },
  });
  queue.push(Z);
  await queue.whenIdle();
  assert.deepEqual(writes, ["0400000000000000"]);
});

// Mouse reports

function channelRecorder({ delay = 0, fail = () => false } = {}) {
  const writes = [];
  const write = async (bytes, channel) => {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    if (fail(bytes, channel)) throw new Error("write failed");
    writes.push(`${channel}:${hex(bytes)}`);
  };
  return { writes, write };
}

test("key writes go to the key channel, mouse writes to the mouse channel", async () => {
  const { writes, write } = channelRecorder();
  const queue = new SendQueue(write);
  queue.push(A);
  queue.pushMouse({ buttons: 1, dx: 2, dy: -2 });
  await queue.whenIdle();
  assert.deepEqual(writes, [`key:${hex(A)}`, "mouse:0102fe00"]);
});

test("movement piles up into a waiting report with the same buttons", async () => {
  const { writes, write } = channelRecorder({ delay: 5 });
  const queue = new SendQueue(write);
  queue.pushMouse({ dx: 1 }); // written straight away
  queue.pushMouse({ dx: 2 });
  queue.pushMouse({ dx: 3, dy: 1 });
  queue.pushMouse({ wheel: -1 });
  await queue.whenIdle();
  assert.deepEqual(writes, ["mouse:00010000", "mouse:000501ff"]);
});

test("a button change starts a new report; order with keys is kept", async () => {
  const { writes, write } = channelRecorder({ delay: 5 });
  const queue = new SendQueue(write);
  queue.push(Z); // in flight
  queue.pushMouse({ dx: 4 });
  queue.pushMouse({ buttons: 1 });
  queue.pushMouse({ buttons: 1, dy: 3 });
  queue.push(A, Z);
  queue.pushMouse({ buttons: 1, dy: 1 });
  queue.pushMouse({ buttons: 0 });
  await queue.whenIdle();
  assert.deepEqual(writes, [
    `key:${hex(Z)}`,
    "mouse:00040000",
    "mouse:01000300",
    `key:${hex([...A, ...Z])}`,
    "mouse:01000100",
    "mouse:00000000",
  ]);
});

test("movement beyond -127..127 is split, never lost", async () => {
  const { writes, write } = channelRecorder({ delay: 5 });
  const queue = new SendQueue(write);
  queue.push(Z); // in flight
  queue.pushMouse({ dx: 100 });
  queue.pushMouse({ dx: 200, dy: -300 });
  await queue.whenIdle();
  // dx 300 = 127 + 127 + 46; dy -300 = -127 - 127 - 46
  assert.deepEqual(writes, [`key:${hex(Z)}`, "mouse:007f8100", "mouse:007f8100", "mouse:002ed200"]);
});

test("key reports are not paired across a mouse report", async () => {
  const { writes, write } = channelRecorder({ delay: 5 });
  const queue = new SendQueue(write);
  queue.push(Z); // in flight
  queue.push(A);
  queue.pushMouse({ dx: 1 });
  queue.push(Z);
  await queue.whenIdle();
  assert.deepEqual(writes, [`key:${hex(Z)}`, `key:${hex(A)}`, "mouse:00010000", `key:${hex(Z)}`]);
});

test("after two failures, releases keys and, once used, mouse buttons", async () => {
  let failing = false;
  const { writes, write } = channelRecorder({ fail: (bytes) => failing && bytes.some((b) => b !== 0) });
  const queue = new SendQueue(write, { onError: () => {} });
  queue.pushMouse({ dx: 1 });
  await queue.whenIdle();
  failing = true;
  queue.pushMouse({ buttons: 1 });
  queue.push(A);
  await queue.whenIdle();
  assert.deepEqual(writes, ["mouse:00010000", `key:${hex(Z)}`, "mouse:00000000"]);
  assert.equal(queue.pending, 0);
});

test("the transform applies to key reports only", async () => {
  const { writes, write } = channelRecorder();
  const queue = new SendQueue(write, {
    transform: (r) => {
      const c = r.slice();
      c[0] |= 0x04;
      return c;
    },
  });
  queue.pushMouse({ buttons: 2 });
  queue.push(Z);
  await queue.whenIdle();
  assert.deepEqual(writes, ["mouse:02000000", "key:0400000000000000"]);
});
