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
