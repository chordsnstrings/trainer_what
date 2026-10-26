// Content loading, page registry, flat file mapping and link helpers.
// Foundation-owned: builders import from here but do not edit it.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const SRC = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(SRC, "..");
export const SITE = join(ROOT, "site");
export const CONTENT_PATH = join(ROOT, "..", "content.json");

/** The whole exported content (pages, sources, nav, footer, brand, ...). */
export const content = JSON.parse(readFileSync(CONTENT_PATH, "utf8"));

/** Calculator maths, the same file the browser runs (assets/calc.js). */
createRequire(import.meta.url)(join(SITE, "assets", "calc.js"));
export const C = globalThis.TYCalc;

/** HTML-escape text for element content and attribute values. */
export const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** "/" -> index.html; "/features/nutrition" -> features--nutrition.html */
export function fileFor(path) {
  if (path === "/" || path === "") return "index.html";
  return path.replace(/^\//, "").replace(/\/$/, "").replace(/\//g, "--") + ".html";
}

/**
 * Relative link for any site path, keeping ?query and #hash:
 * href("/pricing") -> "pricing.html"; href("/methodology#x") -> "methodology.html#x";
 * href("#faq") -> "#faq"; external URLs are returned unchanged.
 */
export function href(path) {
  if (!path) return "index.html";
  if (/^(https?:|mailto:|tel:|#|\.\.\/)/.test(path)) return path;
  const m = String(path).match(/^([^?#]*)(.*)$/);
  return fileFor(m[1] || "/") + m[2];
}

/** Which module renders a path, and which group assets it loads. */
export function groupFor(path) {
  if (path === "/" || path === "/pricing") return "core";
  if (/^\/(how-it-works|trainer-brain|demo|security-and-privacy)$/.test(path) || path === "/features" || path.startsWith("/features/")) return "product";
  if (path === "/for-trainers" || path.startsWith("/for-trainers/") || /^\/(uae|get-started|signup|login)$/.test(path)) return "audience";
  if (/^\/(earnings-calculator|follower-calculator)$/.test(path)) return "money";
  return "content";
}

/** The four pages beyond the 38 registered ones. */
const EXTRA = [
  { path: "/signup", kind: "signup", group: "account", navLabel: "Sign up", title: "Create your trainer account", description: "Free to join. No card. Nothing goes live until you publish.", indexable: false },
  { path: "/login", kind: "login", group: "account", navLabel: "Sign in", title: "Sign in", description: "Sign in to your trainsyou workspace.", indexable: false },
  { path: "/coaches", kind: "coaches", group: "company", navLabel: "Find a coach", title: "Find a coach", description: "Coaches choose to be listed here.", indexable: false },
  { path: "/404", kind: "404", group: "system", navLabel: "404", title: "Page not found", description: "This page isn't here.", indexable: false },
];

/**
 * Registry of all 42 pages, in content order then the extras.
 * Each entry: { path, file, group, page } where page is the content.json
 * page object (or the synthetic one for the extras).
 */
export const registry = [...content.pages, ...EXTRA].map((page) => ({
  path: page.path,
  file: fileFor(page.path),
  group: groupFor(page.path),
  page,
}));
export const byPath = Object.fromEntries(registry.map((r) => [r.path, r]));
export const pageFor = (path) => byPath[path]?.page;
export const sourceFor = (id) => content.sources.find((s) => s.id === id);

/** Live product facts (section B/E). The dev panel toggles them on <html>. */
export const LIVE = { payments: "off", registration: "open", frontier: "off", voice: "off", publish: "gated" };

/** Count visible words in an HTML fragment (budget checks). */
export function wordCount(html) {
  const text = String(html)
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ");
  return text.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
}
