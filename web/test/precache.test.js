import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = fileURLToPath(new URL("..", import.meta.url));

// Not deployed (see .github/workflows/pages.yml), or the service worker itself
const NOT_PRECACHED = new Set(["sw.js", "package.json"]);
const NOT_DEPLOYED_DIRS = new Set(["test", "node_modules"]);

function listFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return NOT_DEPLOYED_DIRS.has(name) ? [] : listFiles(path);
    return [relative(WEB, path)];
  });
}

// sw.js is a classic service worker script, so read its list as text
function precacheList() {
  const source = readFileSync(join(WEB, "sw.js"), "utf8");
  const block = source.match(/PRECACHE = \[([\s\S]*?)\]/)[1];
  return [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

test("service worker precaches exactly the deployed files", () => {
  const deployed = listFiles(WEB)
    .filter((f) => !NOT_PRECACHED.has(f) && !f.startsWith("."))
    .sort();
  const cached = precacheList().filter((f) => f !== "./").sort();
  assert.deepEqual(cached, deployed);
});
