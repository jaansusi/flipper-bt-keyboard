import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clampInterval, ComposeSender, normalizeText, textToStrokes } from "../js/compose.js";
import { validateLayout } from "../js/layouts.js";
import { SendQueue } from "../js/queue.js";

const us = validateLayout(
  JSON.parse(readFileSync(new URL("../layouts/us.json", import.meta.url), "utf8")),
);

test("every printable ASCII character maps to the US table", () => {
  let text = "";
  for (let c = 0x20; c < 0x7f; c++) text += String.fromCharCode(c);
  const { chars, skipped } = textToStrokes(text, us);
  assert.equal(skipped, 0);
  assert.equal(chars.length, 95);
});

test("unmapped characters are skipped and counted", () => {
  const { chars, skipped } = textToStrokes("aäb€", us);
  assert.deepEqual(chars.map((c) => c.char), ["a", "b"]);
  assert.equal(skipped, 2);
});

test("line endings become \\n", () => {
  assert.equal(normalizeText("a\r\nb\rc\n"), "a\nb\nc\n");
  assert.equal(textToStrokes("a\r\n", us).chars.length, 2);
});

test("NFC normalization joins combining characters", () => {
  assert.equal(normalizeText("é"), "é");
  // é is not in the US table: one skipped character, not "e" plus junk
  assert.deepEqual(textToStrokes("é", us), { chars: [], skipped: 1 });
});

test("characters outside the BMP count as one character", () => {
  assert.equal(textToStrokes("😀", us).skipped, 1);
});

test("clampInterval keeps 16–1000 ms", () => {
  assert.equal(clampInterval(5), 16);
  assert.equal(clampInterval("20"), 20);
  assert.equal(clampInterval(5000), 1000);
  assert.equal(clampInterval("abc"), 20);
});

test("validateLayout rejects bad tables", () => {
  const base = { id: "x", name: "X" };
  assert.throws(() => validateLayout({ ...base, map: { a: [[0, 0xe0]] } }));
  assert.throws(() => validateLayout({ ...base, map: { a: [] } }));
  assert.throws(() => validateLayout({ ...base, map: { ab: [[0, 4]] } }));
  assert.throws(() => validateLayout({ ...base, map: { a: [[256, 4]] } }));
  assert.throws(() => validateLayout({ map: {} }));
  assert.doesNotThrow(() => validateLayout({ ...base, map: { "^": [[0x40, 0x20], [0, 0x2c]] } }));
});

test("ComposeSender sends press/release per stroke and reports progress", async () => {
  const writes = [];
  const queue = new SendQueue(async (bytes) => writes.push(Buffer.from(bytes).toString("hex")));
  const sender = new ComposeSender(queue);
  const progress = [];
  const result = await sender.send("aA", us, 16, (sent, total) => progress.push([sent, total]));
  assert.deepEqual(result, { sent: 2, total: 2, skipped: 0, stopped: false });
  assert.deepEqual(progress, [[1, 2], [2, 2]]);
  assert.deepEqual(writes, [
    "00000400000000000000000000000000",
    "02000400000000000000000000000000",
  ]);
});

test("ComposeSender.stop ends the loop and releases keys", async () => {
  const writes = [];
  const queue = new SendQueue(async (bytes) => {
    await new Promise((r) => setTimeout(r, 2));
    writes.push(Buffer.from(bytes).toString("hex"));
  });
  const sender = new ComposeSender(queue);
  const sending = sender.send("abcdefghij", us, 16, (sent) => {
    if (sent === 2) sender.stop();
  });
  const result = await sending;
  await queue.whenIdle();
  assert.equal(result.stopped, true);
  assert.equal(result.sent, 2);
  assert.equal(writes.at(-1), "0000000000000000");
});
