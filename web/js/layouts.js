// Compose-mode layout tables (SPEC §7.6).

import { isValidUsage } from "./report.js";

/** Throw if a layout object does not match SPEC §7.6. */
export function validateLayout(layout) {
  if (!layout || typeof layout.id !== "string" || typeof layout.name !== "string") {
    throw new Error("layout needs string id and name");
  }
  if (!layout.map || typeof layout.map !== "object") throw new Error("layout needs a map");
  for (const [char, strokes] of Object.entries(layout.map)) {
    if ([...char].length !== 1 || char !== char.normalize("NFC")) {
      throw new Error(`map key must be one NFC character: ${JSON.stringify(char)}`);
    }
    if (!Array.isArray(strokes) || strokes.length === 0) {
      throw new Error(`no strokes for ${JSON.stringify(char)}`);
    }
    for (const stroke of strokes) {
      const [mods, usage] = Array.isArray(stroke) ? stroke : [];
      if (!Number.isInteger(mods) || mods < 0 || mods > 0xff || !isValidUsage(usage)) {
        throw new Error(`invalid stroke for ${JSON.stringify(char)}: ${JSON.stringify(stroke)}`);
      }
    }
  }
  return layout;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

/** @returns {Promise<{ id: string, name: string, file: string }[]>} */
export async function loadLayoutIndex(base = "layouts/") {
  const index = await fetchJson(`${base}index.json`);
  if (!Array.isArray(index)) throw new Error("layout index must be an array");
  return index;
}

export async function loadLayout(file, base = "layouts/") {
  return validateLayout(await fetchJson(`${base}${file}`));
}
