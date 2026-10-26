// Content loading, the 42-page registry and the flat-file link mapping.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const SRC = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(SRC, "..");
export const SITE = join(ROOT, "site");
export const CONTENT_PATH = join(ROOT, "..", "content.json");

/** The whole content export (pages, sources, nav, footer, brand, ...). */
export const content = JSON.parse(readFileSync(CONTENT_PATH, "utf8"));

/** Pages beyond the 38 registered ones. Builders fill their copy from section C. */
const EXTRA_PAGES = [
  {
    path: "/signup", kind: "signup", group: "trainers", navLabel: "Sign up",
    title: "Create your trainer account", h1: "Create your trainer account",
    description: "Free to join. Create your trainsyou account and start teaching your AI.",
  },
  {
    path: "/login", kind: "login", group: "trainers", navLabel: "Sign in",
    title: "Sign in", h1: "Sign in", description: "Sign in to your trainsyou workspace.",
  },
  {
    path: "/coaches", kind: "coaches", group: "company", navLabel: "Find a coach",
    title: "Find a coach", h1: "Find a coach", noindex: true,
    description: "Coaching sites built on trainsyou appear here once trainers publish.",
  },
  {
    path: "/404", kind: "404", group: "company", navLabel: "Not found",
    title: "Page not found", h1: "No rule for this page", noindex: true,
    description: "This page does not exist.",
  },
];

/** Which page module renders which path (and therefore which group assets load). */
export function moduleFor(path) {
  if (path === "/" || path === "/pricing") return "core";
  if (/^\/(how-it-works|trainer-brain|demo|security-and-privacy)$/.test(path) || /^\/features(\/|$)/.test(path)) return "product";
  if (/^\/for-trainers(\/|$)/.test(path) || /^\/(uae|get-started|signup|login)$/.test(path)) return "audience";
  if (/^\/(earnings-calculator|follower-calculator)$/.test(path)) return "money";
  return "content";
}

/** All 42 pages in site order. Each entry: the content page plus `file` and `module`. */
export const PAGES = [...content.pages, ...EXTRA_PAGES].map((page) => ({
  ...page,
  file: fileFor(page.path),
  module: moduleFor(page.path),
}));
export const pageByPath = new Map(PAGES.map((p) => [p.path, p]));

/** "/" -> index.html; "/features/nutrition" -> features--nutrition.html; "/404" -> 404.html. */
export function fileFor(path) {
  if (path === "/" || path === "") return "index.html";
  return path.replace(/^\//, "").replace(/\/$/, "").replace(/\//g, "--") + ".html";
}

/**
 * Relative link for any site path, keeping ?query and #hash:
 * href("/pricing") -> "pricing.html"; href("/methodology#x") -> "methodology.html#x";
 * href("#faq") -> "#faq"; external URLs are returned unchanged.
 */
export function href(target) {
  if (!target) return "index.html";
  if (/^(https?:|mailto:|tel:|#)/.test(target)) return target;
  const m = target.match(/^([^?#]*)(\?[^#]*)?(#.*)?$/);
  return fileFor(m[1] || "/") + (m[2] || "") + (m[3] || "");
}

/** The source record for a methodology id (throws on unknown ids so no badge points nowhere). */
export function sourceById(id) {
  const s = content.sources.find((x) => x.id === id);
  if (!s) throw new Error("Unknown source id: " + id);
  return s;
}

/** Nav label for a path, from the registry. */
export const labelFor = (path) => pageByPath.get(path)?.navLabel ?? path;
