// Loads the shared content export (../../content.json) once.
// content.pages[] holds the 38 registered pages; see BUILDERS.md for fields.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(here, "../.."); // concept-c/
export const CONTENT_PATH = resolve(ROOT, "../content.json");
export const content = JSON.parse(readFileSync(CONTENT_PATH, "utf8"));

/** A source record from content.sources by id (throws if missing). */
export function source(id) {
  const s = content.sources.find((x) => x.id === id);
  if (!s) throw new Error(`source(): unknown source id ${id}`);
  return s;
}
