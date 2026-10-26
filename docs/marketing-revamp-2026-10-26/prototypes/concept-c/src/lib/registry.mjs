// Page registry: the 38 registered pages from content.json plus the four
// extra pages (signup, login, coaches, 404), the flat file mapping and the
// group that owns each page (which page module renders it, which group
// css/js it loads). DO NOT EDIT in page builds (see src/BUILDERS.md).
import { content } from "./content.mjs";

/** "/" -> "index.html", "/features/nutrition" -> "features--nutrition.html". */
export function fileFor(path) {
  if (path === "/") return "index.html";
  return path.replace(/^\//, "").replace(/\//g, "--") + ".html";
}

/**
 * Relative link to a site page, with optional query/hash:
 * href("/pricing") -> "pricing.html"; href("/pricing", "#status");
 * href("/signup?slug=x") also works. Unknown paths throw at build time so a
 * broken link never ships.
 */
export function href(path, suffix = "") {
  const m = String(path).match(/^([^?#]*)(.*)$/);
  const base = m[1] || "/";
  if (!PATHS.has(base)) throw new Error(`href(): unknown page ${base}`);
  return fileFor(base) + m[2] + suffix;
}

/** Synthetic entries for the pages that are not in content.json. */
const EXTRA = [
  {
    path: "/signup",
    kind: "signup",
    group: "audience",
    navLabel: "Sign up",
    title: "Create your trainer account",
    description: "Create your free trainsyou trainer account. Free to join, no card, nothing goes live until you publish.",
    eyebrow: "SIGN UP",
    h1: "Teach your AI. Start free.",
    indexable: false,
  },
  {
    path: "/login",
    kind: "login",
    group: "audience",
    navLabel: "Sign in",
    title: "Sign in",
    description: "Sign in to your trainsyou trainer workspace.",
    eyebrow: "SIGN IN",
    h1: "Sign in",
    indexable: false,
  },
  {
    path: "/coaches",
    kind: "coaches",
    group: "content",
    navLabel: "Find a coach",
    title: "Find a coach",
    description: "Coaches choose to be listed here.",
    eyebrow: "COACHES",
    h1: "Find a coach",
    indexable: false,
  },
  {
    path: "/404",
    kind: "404",
    group: "content",
    navLabel: "Not found",
    title: "Page not found",
    description: "This page isn't in the manual.",
    eyebrow: "404",
    h1: "This page isn't in the manual.",
    indexable: false,
  },
];

/** Which module/group owns each page. */
export function groupFor(path) {
  if (path === "/" || path === "/pricing") return "core";
  if (/^\/(how-it-works|trainer-brain|features|demo|security-and-privacy)(\/|$)/.test(path)) return "product";
  if (/^\/(for-trainers|uae|get-started|signup|login)(\/|$)/.test(path)) return "audience";
  if (/^\/(earnings-calculator|follower-calculator)$/.test(path)) return "money";
  return "content";
}

export const PAGES = [...content.pages, ...EXTRA].map((p) => ({
  ...p,
  owner: groupFor(p.path),
  file: fileFor(p.path),
}));
const PATHS = new Set(PAGES.map((p) => p.path));

export function pageFor(path) {
  const p = PAGES.find((x) => x.path === path);
  if (!p) throw new Error(`pageFor(): unknown page ${path}`);
  return p;
}
