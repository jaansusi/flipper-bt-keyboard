import { test } from "node:test";
import assert from "node:assert/strict";
import { diffText, PADDING } from "../js/textinput.js";

test("typing appends characters", () => {
  assert.deepEqual(diffText(PADDING, PADDING + "a"), { deleteCount: 0, insert: "a" });
});

test("backspace on the padding counts as a delete", () => {
  assert.deepEqual(diffText(PADDING, PADDING.slice(1)), { deleteCount: 1, insert: "" });
});

test("autocorrect replacing a word becomes backspaces plus the new word", () => {
  assert.deepEqual(diffText(PADDING + "teh", PADDING + "the "), { deleteCount: 2, insert: "he " });
});

test("composition updates send only the change", () => {
  assert.deepEqual(diffText(PADDING + "hel", PADDING + "hell"), { deleteCount: 0, insert: "l" });
});

test("deleted emoji count as one character each", () => {
  assert.deepEqual(diffText(PADDING + "a😀", PADDING + "a"), { deleteCount: 1, insert: "" });
});

test("no change", () => {
  assert.deepEqual(diffText(PADDING, PADDING), { deleteCount: 0, insert: "" });
});
