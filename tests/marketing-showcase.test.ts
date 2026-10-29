// The Brain showcases' runtime, CSS and rendering contract
// (docs/marketing-revamp-2026-10-26/phase1/PLAN.md §1.1–1.4, WP1): the head
// script and the island decide alike; the engine is reached only through the
// island's literal import()s and nothing on the server path loads CSS or a
// runtime module; the engine core's lifecycle (Pause, data-sc-run, a Kamran
// call, the overlay layer); the showcase stylesheets' own contract and
// budgets; static mode, data-nosnippet, the shared key and escaping.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Script, createContext } from "node:vm";
import { gzipSync } from "node:zlib";
import { createElement, isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MOTION_ALWAYS_EXCLUDED } from "../apps/web/components/marketing/motion-mode.ts";
import type { PublicPlatform } from "../apps/web/components/marketing/platform.ts";
import { BrainShowcase } from "../apps/web/components/marketing/brain/showcase.tsx";
import { ShowcaseMount, engineWanted, showcaseClasses } from "../apps/web/components/marketing/brain/mount.tsx";
import { fnv1a, renderShowcase } from "../apps/web/components/marketing/brain/render.ts";
import { SHOWCASE_HEAD_SCRIPT, SHOWCASE_PATHS } from "../apps/web/components/marketing/brain/head.ts";
import { SCENES_HEAD_SCRIPT } from "../apps/web/components/marketing/scenes-head.ts";
import { showcaseMode, showcaseOptions } from "../apps/web/components/marketing/brain/options.ts";
import type { ShowcaseKind, ShowcaseOptions } from "../apps/web/components/marketing/brain/engine/types";
import { contrast, cssRules, hex, splitTop, type Rule } from "./marketing-helpers.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WEB = join(ROOT, "apps/web");
const BRAIN = join(WEB, "components/marketing/brain");
const read = (path: string) => readFileSync(path, "utf8");
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const KINDS: ShowcaseKind[] = ["field", "board", "play", "anatomy"];
const RUNTIME = ["field.js", "play.js", "anatomy.js", "receipt.js"];
/** The first-frame sheets (app/layout.tsx); app/brain-plans.css is the member app's. */
const STAGE_SHEETS = ["brain-stage.css", "brain-field.css", "brain-play.css", "brain-anatomy.css"];
const PAGE_SHEETS = ["marketing-proof.css", "marketing-home.css", "marketing-brain-pages.css", "marketing-pricing.css"];
/** Each page's lazy sheets: the runtime modules it loads import them. */
const LAZY_BY_PAGE: Record<string, string[]> = {
  "/": ["field.run.css", "receipt.css"],
  "/trainer-brain": ["anatomy.run.css", "play.run.css"],
  "/demo": ["play.run.css"],
};
const lazySheets = () => readdirSync(join(BRAIN, "engine")).filter((f) => f.endsWith(".css"));
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]));

const FLAGS = { payments: false, payouts: false, voice: false, nutrition: false, recovery: false };
const options = (patch: Partial<ShowcaseOptions> = {}): ShowcaseOptions => ({
  appName: "trainsyou",
  cta: { label: "Join early access — free", href: "/get-started#early-access" },
  flags: FLAGS,
  ...patch,
});

// ---------------------------------------------------------------- head script and island

type Env = {
  path: string;
  search: string;
  stored: boolean;
  deviceReduce: boolean;
  memberReduce: boolean;
  webdriver: boolean;
  agent: string;
  io: boolean;
  sticky: boolean;
};
function environment(e: Env) {
  const store = new Map<string, string>(e.stored ? [["sc-on", "1"]] : []);
  const attrs = new Map<string, string>(e.memberReduce ? [["data-reduce-motion", "on"]] : []);
  const classes = new Set<string>();
  const timers: Array<() => void> = [];
  const html = {
    getAttribute: (k: string) => attrs.get(k) ?? null,
    hasAttribute: (k: string) => attrs.has(k),
    setAttribute: (k: string, v: string) => attrs.set(k, v),
    classList: {
      add: (c: string) => classes.add(c),
      toggle: (c: string, on: boolean) => (on ? classes.add(c) : classes.delete(c)),
      contains: (c: string) => classes.has(c),
    },
    get dataset() {
      return { reduceMotion: attrs.get("data-reduce-motion") };
    },
  };
  const globals: Record<string, unknown> = {
    document: { documentElement: html },
    location: { pathname: e.path, search: e.search },
    navigator: { webdriver: e.webdriver, userAgent: e.agent },
    sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) },
    matchMedia: (q: string) => ({ matches: q === "(prefers-reduced-motion: reduce)" && e.deviceReduce }),
    CSS: { supports: (p: string, v: string) => p === "position" && v === "sticky" && e.sticky },
    setTimeout: (fn: () => void) => timers.push(fn),
  };
  if (e.io) globals.IntersectionObserver = function IntersectionObserver() {};
  return { globals, classes, store, attrs, timers };
}
const ENVS: Env[] = [];
for (const path of ["/", "/demo", "/pricing"])
  for (const search of ["", "?a=1&sc=on"])
    for (const stored of [false, true])
      for (const deviceReduce of [false, true])
        for (const memberReduce of [false, true])
          for (const webdriver of [false, true])
            for (const agent of ["Mozilla/5.0 Chrome/141", "Mozilla/5.0 (compatible; Googlebot/2.1)"])
              for (const [io, sticky] of [[true, true], [true, false], [false, true]])
                ENVS.push({ path, search, stored, deviceReduce, memberReduce, webdriver, agent, io, sticky });

/** Runs fn with the environment's browser globals in place of Node's. */
function withGlobals<T>(globals: Record<string, unknown>, fn: () => T): T {
  const saved = Object.keys(globals).map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)] as const);
  for (const [k, v] of Object.entries(globals)) Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  try {
    return fn();
  } finally {
    for (const [k, d] of saved) {
      if (d) Object.defineProperty(globalThis, k, d);
      else delete (globalThis as Record<string, unknown>)[k];
    }
  }
}

/** The crawler test, in the head script and the island alike (SEC-3). */
const ROBOT = "/bot[/)-]|bot [0-9]|crawl|spider|slurp|preview|lighthouse/i";

/** The head script, run in one reusable context with an environment's globals. */
const headScript = new Script(SHOWCASE_HEAD_SCRIPT);
const headContext = createContext({});
function runHead(globals: Record<string, unknown>) {
  for (const k of Object.keys(headContext)) delete headContext[k];
  Object.assign(headContext, globals, { window: globals });
  headScript.runInContext(headContext);
}

test("the head script and the island decide alike: same reduced-motion and robot tests, same ?sc=on override", () => {
  assert.deepEqual(SHOWCASE_PATHS, ["/", "/trainer-brain", "/demo"]);
  let pins = 0, robotsIn = 0;
  for (const e of ENVS) {
    const head = environment(e);
    runHead(head.globals);
    const where = JSON.stringify(e);
    // ?sc=on is kept for the tab on every page, so a client-side navigation finds it.
    assert.equal(head.store.get("sc-on") === "1", e.stored || e.search.includes("sc=on"), where);
    if (!SHOWCASE_PATHS.includes(e.path)) {
      assert.equal(head.classes.size, 0, where);
      continue;
    }
    const island = environment(e);
    const { motion, pin } = withGlobals(island.globals, () => showcaseClasses());
    const wanted = withGlobals(island.globals, () => engineWanted());
    assert.deepEqual([head.classes.has("sc-motion"), head.classes.has("sc-pin")], [motion, pin], where);
    assert.equal(island.store.get("sc-on") === "1", e.stored || e.search.includes("sc=on"), where);
    // Expected, spelled out: crawlers and automated browsers only with the
    // override; never under either reduced-motion setting.
    const robot = e.webdriver || /bot/i.test(e.agent);
    const forced = e.stored || e.search.includes("sc=on");
    assert.equal(wanted, forced || !robot, where);
    assert.equal(motion, !e.deviceReduce && !e.memberReduce && (forced || !robot), where);
    assert.equal(pin, motion && e.io && e.sticky, where);
    if (pin) pins++;
    if (robot && motion) robotsIn++;
    // html.sc-late after 6 s, unless an island hydrated (html[data-sc-ready]).
    assert.equal(head.timers.length, motion ? 1 : 0, where);
    if (motion) {
      const late = environment(e);
      runHead(late.globals);
      late.attrs.set("data-sc-ready", "");
      late.timers[0]();
      assert.ok(!late.classes.has("sc-late"), where);
      head.timers[0]();
      assert.ok(head.classes.has("sc-late"), where);
    }
  }
  assert.ok(pins > 20 && robotsIn > 20, `${pins} pinned, ${robotsIn} automated browsers let in`);

  // The same reduced-motion, sticky and crawler tests as the scroll scenes'
  // (scenes-head.ts, scene-mount.tsx), and neither file reads the marketing
  // motion switch.
  const scenes = read(join(WEB, "components/marketing/scenes-head.ts"));
  const mount = read(join(BRAIN, "mount.tsx"));
  for (const part of [
    'if(d.getAttribute("data-reduce-motion")==="on")return;',
    'if(window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches)return;',
    'CSS.supports("position","sticky")',
  ]) {
    assert.ok(scenes.includes(part), "scenes-head.ts: " + part);
    assert.ok(SHOWCASE_HEAD_SCRIPT.includes(part), "head.ts: " + part);
  }
  assert.ok(SHOWCASE_HEAD_SCRIPT.includes(`(n.webdriver||${ROBOT}.test(n.userAgent))`), "head.ts: the crawler test");
  assert.ok(scenes.includes(`(n.webdriver||${ROBOT}.test(n.userAgent))`), "scenes-head.ts: the crawler test");
  assert.ok(read(join(WEB, "components/marketing/scene-mount.tsx")).includes(`navigator.webdriver ||\n    ${ROBOT}.test(navigator.userAgent)`), "scene-mount.tsx: the crawler test");
  assert.match(mount, /const REDUCE = "\(prefers-reduced-motion: reduce\)";/);
  assert.match(mount, /const reduced = \(\) =>\s+\(typeof matchMedia === "function" && matchMedia\(REDUCE\)\.matches\) \|\|\s+document\.documentElement\.dataset\.reduceMotion === "on";/);
  assert.ok(mount.includes(`navigator.webdriver ||\n  ${ROBOT}.test(navigator.userAgent)`), "mount.tsx: the crawler test");
  for (const file of files(BRAIN))
    assert.doesNotMatch(code(read(file)), /MARKETING_MOTION|motion-mode|data-mk-motion/, `${relative(ROOT, file)} must not read the marketing switch`);
  // app/layout.tsx renders it after the scroll scenes' script.
  const layout = read(join(WEB, "app/layout.tsx"));
  assert.ok(layout.indexOf("__html: SCENES_HEAD_SCRIPT") < layout.indexOf("__html: SHOWCASE_HEAD_SCRIPT"));
});

test("robots: a crawler's product token, never \"bot\" inside a phone's model (in-app browsers send it)", () => {
  const AGENTS: Array<[string, boolean]> = [
    ["Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", true],
    ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36", true],
    ["Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)", true],
    ["Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)", true],
    ["Mozilla/5.0 (compatible; Yahoo! Slurp; http://help.yahoo.com/help/us/ysearch/slurp)", true],
    ["Mozilla/5.0 (compatible; AdsBot-Google; +http://www.google.com/adsbot.html)", true],
    ["Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)", true],
    ["Slackbot 1.0 (+https://api.slack.com/robots)", true],
    ["TelegramBot (like TwitterBot)", true],
    ["Mozilla/5.0 (compatible;PetalBot;+https://webmaster.petalsearch.com/site/petalbot)", true],
    ["Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse", true],
    ["Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 SkypeUriPreview Preview/0.5", true],
    ["Mozilla/5.0 (Linux; Android 11; CUBOT X50 Build/RP1A.200720.011; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/118.0.5993.80 Mobile Safari/537.36 Instagram 307.0.0.34.111 Android (30/11; 480dpi; 1080x2160; CUBOT; X50; X50; mt6765; en_US; 532277166)", false],
    ["Mozilla/5.0 (Linux; Android 11; CUBOT_NOTE_20 Build/RP1A.200720.011; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/118.0.5993.80 Mobile Safari/537.36 [FBAN/FB4A;FBAV/435.0.0.42.112;FBMF/CUBOT;FBBD/CUBOT;FBDV/CUBOT_NOTE_20;FBSV/11;]", false],
    ["Mozilla/5.0 (Linux; Android 13; KINGKONG POWER Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.43 Mobile Safari/537.36 trill_310203 JsSdk/1.0 NetType/WIFI Channel/googleplay AppName/musical_ly app_version/31.2.3 ByteLocale/en ByteFullLocale/en Region/AE BytedanceWebview/d8a21c6", false],
    ["Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36", false],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0.0.0 (iPhone14,2; iOS 17_0; en_US; en; scale=3.00; 1170x2532; 516789123)", false],
  ];
  // The scroll scenes on "/" use the same test (L13): CUBOT's in-app visitors keep them too.
  const scenes = new Script(SCENES_HEAD_SCRIPT);
  for (const [agent, robot] of AGENTS) {
    const e: Env = { path: "/", search: "", stored: false, deviceReduce: false, memberReduce: false, webdriver: false, agent, io: true, sticky: true };
    const head = environment(e);
    runHead(head.globals);
    const island = environment(e);
    assert.equal(head.classes.has("sc-motion"), !robot, `head script: ${agent}`);
    assert.equal(withGlobals(island.globals, () => engineWanted()), !robot, `island: ${agent}`);
    const scene = environment(e), context = createContext({ ...scene.globals, window: scene.globals });
    scenes.runInContext(context);
    assert.equal(scene.classes.has("scenes-on"), !robot, `scroll scenes: ${agent}`);
  }
});

test("the island reaches the engine only through literal import()s of the runtime modules", () => {
  const mount = read(join(BRAIN, "mount.tsx"));
  assert.match(mount, /^"use client";/);
  const imports = [...mount.matchAll(/^import\s+(type\s+)?[^;]*?from\s+"([^"]+)";/gm)].map((m) => [m[1] ? "type" : "value", m[2]]);
  assert.deepEqual(imports, [["value", "react"], ["value", "next/navigation"], ["type", "./engine/types"]]);
  const dynamic = [...code(mount).matchAll(/import\(([^)]*)\)/g)].map((m) => m[1]);
  assert.deepEqual(dynamic, ['"./engine/field.js"', '"./engine/field.js"', '"./engine/play.js"', '"./engine/anatomy.js"']);
  assert.match(mount, /const LOADERS = \{\s+field: \(\) => import\("\.\/engine\/field\.js"\),\s+board: \(\) => import\("\.\/engine\/field\.js"\),\s+play: \(\) => import\("\.\/engine\/play\.js"\),\s+anatomy: \(\) => import\("\.\/engine\/anatomy\.js"\),\s+\};/);
  // The island's schedule: the load event, idle (or 300 ms), then 200 px.
  assert.match(mount, /document\.readyState === "complete"/);
  assert.match(mount, /requestIdleCallback\(go, \{ timeout: 1500 \}\)/);
  assert.match(mount, /window\.setTimeout\(go, 300\)/);
  assert.match(mount, /\{ rootMargin: "200px" \}/);
  assert.match(mount, /const FALLBACK_MS = 6000;/);
});

/** Static imports (type-only ones are erased): what a file loads when it is imported. */
function staticImports(file: string): string[] {
  const source = read(file);
  return [...source.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?!type\b)(?:[^;'"]*?\sfrom\s+)?"([^"]+)"/g)].map((m) => m[1]);
}
function resolveImport(from: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null; // packages: no CSS, no engine
  const base = resolve(dirname(from), spec);
  for (const candidate of [base, base + ".ts", base + ".tsx", base + ".js", join(base, "index.ts"), join(base, "index.tsx")])
    if (existsSync(candidate) && !candidate.endsWith("/")) {
      try {
        readdirSync(candidate);
      } catch {
        return candidate;
      }
    }
  throw new Error(`${relative(ROOT, from)}: cannot resolve ${spec}`);
}

test("import hygiene: the server path reaches no CSS and no runtime module; no URL-built import, fetch or new URL in the engine", () => {
  for (const start of ["components/marketing/site.tsx", "components/marketing/brain/render.ts", "components/marketing/brain/showcase.tsx"]) {
    const seen = new Set<string>();
    const walk = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      for (const spec of staticImports(file)) {
        const target = resolveImport(file, spec);
        if (!target) continue;
        assert.ok(!target.endsWith(".css"), `${start} → ${relative(ROOT, file)} imports ${spec}`);
        assert.ok(!(target.startsWith(join(BRAIN, "engine")) && RUNTIME.includes(target.split("/").pop()!)), `${start} → ${relative(ROOT, file)} imports the runtime module ${spec}`);
        walk(target);
      }
    };
    walk(join(WEB, start));
    assert.ok(seen.size > (start.endsWith("site.tsx") ? 10 : 5), `${start}: ${seen.size} files`);
  }
  for (const file of files(BRAIN).filter((f) => /\.(m?js|tsx?)$/.test(f))) {
    const where = relative(ROOT, file);
    const source = code(read(file));
    for (const m of source.matchAll(/\bimport\(([^)]*)\)/g)) assert.match(m[1], /^"\.\/engine\/[\w.]+\.js"$|^"\.\/[\w.]+\.js"$/, `${where}: import(${m[1]})`);
    assert.doesNotMatch(source, /\bfetch\(/, where);
    assert.doesNotMatch(source, /new URL\([^)]*import\.meta\.url/, where);
    assert.doesNotMatch(source, /import\.meta\.url/, where);
  }
});

test("importing the server and pure engine modules touches no browser API, timer or listener", () => {
  // In a fresh process whose browser globals record every touch.
  const probe = `
    const touched = [];
    const trap = (name) => new Proxy(function () {}, {
      get(_, p) { if (typeof p === "string") touched.push(name + "." + p); return trap(name + "." + String(p)); },
      apply() { touched.push(name + "()"); return trap(name + "()"); },
      construct() { touched.push("new " + name); return trap(name); },
    });
    for (const g of ["window", "document", "location", "matchMedia", "addEventListener", "requestAnimationFrame",
      "requestIdleCallback", "IntersectionObserver", "MutationObserver", "getComputedStyle", "sessionStorage", "localStorage", "CSS"])
      globalThis[g] = trap(g);
    Object.defineProperty(globalThis, "navigator", { value: trap("navigator"), configurable: true });
    for (const t of ["setTimeout", "setInterval", "setImmediate", "queueMicrotask"]) {
      const real = globalThis[t];
      globalThis[t] = (...a) => (touched.push(t), real(...a));
    }
    const brain = ${JSON.stringify(BRAIN)};
    await import(brain + "/render.ts");
    for (const m of ["core", "decide", "ui", "data", "field.render", "play.render", "anatomy.render"]) await import(brain + "/engine/" + m + ".js");
    process.stdout.write(JSON.stringify(touched));
  `;
  // tsx without its disk cache: a cold cache's writes are setImmediate calls of tsx's own (SEC-1).
  const out = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", probe], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, TSX_DISABLE_CACHE: "1" },
  });
  assert.deepEqual(JSON.parse(out), []);
});

// ---------------------------------------------------------------- the engine core in a minimal DOM

/** Just enough DOM for engine/core.js: elements with attributes, a tree, events and observers. */
function fakeDom() {
  const mutationObservers: Array<{ target: El; filter: string[] | null; fn: (m: unknown[]) => void; on: boolean }> = [];
  const intersections: Array<{ fn: (e: unknown[]) => void; targets: El[]; on: boolean }> = [];
  const listeners = new Map<string, Set<(e: unknown) => void>>();
  const frames = new Map<number, (t: number) => void>();
  let frameId = 0;
  class El {
    attrs = new Map<string, string>();
    children: El[] = [];
    parent: El | null = null;
    text = "";
    inert = false;
    style: Record<string, string> = {};
    events = new Map<string, Set<(e: unknown) => void>>();
    constructor(public tag: string) {}
    get tagName() {
      return this.tag.toUpperCase();
    }
    get parentElement() {
      return this.parent;
    }
    setAttribute(k: string, v: string) {
      this.attrs.set(k, String(v));
      this.notify(k);
    }
    getAttribute(k: string) {
      return this.attrs.get(k) ?? null;
    }
    hasAttribute(k: string) {
      return this.attrs.has(k);
    }
    removeAttribute(k: string) {
      if (this.attrs.delete(k)) this.notify(k);
    }
    notify(k: string) {
      for (const o of mutationObservers)
        if (o.on && o.target === this && (!o.filter || o.filter.includes(k))) queueMicrotask(() => o.on && o.fn([{ attributeName: k, target: this }]));
    }
    set className(v: string) {
      this.setAttribute("class", v);
    }
    get isConnected(): boolean {
      let e: El = this;
      while (e.parent) e = e.parent;
      return e === html;
    }
    append(...kids: Array<El | string>) {
      for (const k of kids) {
        if (typeof k === "string") this.text += k;
        else {
          k.remove();
          k.parent = this;
          this.children.push(k);
        }
      }
    }
    appendChild(k: El) {
      this.append(k);
      return k;
    }
    remove() {
      if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
      this.parent = null;
    }
    matches(sel: string) {
      const m = sel.match(/^(?:\.([\w-]+)|\[([\w-]+)\])$/);
      if (!m) throw new Error("fake selector " + sel);
      return m[1] ? (this.attrs.get("class") ?? "").split(" ").includes(m[1]) : this.attrs.has(m[2]);
    }
    closest(sel: string) {
      for (let e: El | null = this; e; e = e.parent) if (e.matches(sel)) return e;
      return null;
    }
    querySelector(sel: string): El | null {
      for (const c of this.children) {
        if (c.matches(sel)) return c;
        const deep = c.querySelector(sel);
        if (deep) return deep;
      }
      return null;
    }
    querySelectorAll(sel: string): El[] {
      return this.children.flatMap((c) => [...(c.matches(sel) ? [c] : []), ...c.querySelectorAll(sel)]);
    }
    get textContent() {
      return this.text;
    }
    set textContent(v: string) {
      this.text = v;
      this.children = [];
    }
    addEventListener(t: string, f: (e: unknown) => void) {
      if (!this.events.has(t)) this.events.set(t, new Set());
      this.events.get(t)!.add(f);
    }
    removeEventListener(t: string, f: (e: unknown) => void) {
      this.events.get(t)?.delete(f);
    }
    click() {
      for (const f of this.events.get("click") ?? []) f({});
    }
  }
  const html = new El("html");
  const body = new El("body");
  html.append(body);
  const doc = {
    documentElement: html,
    body,
    hidden: false,
    readyState: "complete",
    createElement: (tag: string) => new El(tag),
    addEventListener: (t: string, f: (e: unknown) => void) => html.addEventListener("doc:" + t, f),
    removeEventListener: (t: string, f: (e: unknown) => void) => html.removeEventListener("doc:" + t, f),
  };
  const win: Record<string, unknown> = {
    document: doc,
    navigator: { webdriver: false, userAgent: "Mozilla/5.0 Chrome/141", hardwareConcurrency: 8 },
    // The browser checks' switches, which only automated browsers obey.
    location: { search: "?tier=minimal&slow=40" },
    devicePixelRatio: 1,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    addEventListener: (t: string, f: (e: unknown) => void) => (listeners.get(t) ?? listeners.set(t, new Set()).get(t)!).add(f),
    removeEventListener: (t: string, f: (e: unknown) => void) => listeners.get(t)?.delete(f),
    requestAnimationFrame: (f: (t: number) => void) => (frames.set(++frameId, f), frameId),
    cancelAnimationFrame: (id: number) => frames.delete(id),
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    IntersectionObserver: class {
      entry: { fn: (e: unknown[]) => void; targets: El[]; on: boolean };
      constructor(fn: (e: unknown[]) => void) {
        this.entry = { fn, targets: [], on: true };
        intersections.push(this.entry);
      }
      observe(el: El) {
        this.entry.targets.push(el);
      }
      disconnect() {
        this.entry.on = false;
      }
    },
    MutationObserver: class {
      constructor(public fn: (m: unknown[]) => void) {}
      observe(target: El, o: { attributeFilter?: string[] }) {
        mutationObservers.push({ target, filter: o.attributeFilter ?? null, fn: this.fn, on: true });
      }
      disconnect() {
        for (const o of mutationObservers) if (o.fn === this.fn) o.on = false;
      }
    },
  };
  win.window = win;
  return {
    win,
    html,
    body,
    El,
    /** Runs the frames scheduled so far, at time t. */
    frame(t: number) {
      const due = [...frames.entries()];
      frames.clear();
      for (const [, f] of due) f(t);
    },
    scheduled: () => frames.size,
    /** A window or document event, as the browser dispatches it. */
    fire(type: string, init: Record<string, unknown> = {}) {
      for (const f of [...(listeners.get(type) ?? []), ...(html.events.get("doc:" + type) ?? [])]) f({ type, ...init });
    },
    /** Every scene's root comes on screen. */
    visible() {
      for (const o of intersections) if (o.on) for (const target of o.targets) o.fn([{ isIntersecting: true, target }]);
    },
    listening: () => [...listeners.values()].reduce((n, s) => n + s.size, 0) + [...html.events.entries()].filter(([t]) => t.startsWith("doc:")).reduce((n, [, s]) => n + s.size, 0),
    observing: () => mutationObservers.filter((o) => o.on).length,
  };
}

test("the engine core: Pause stays right through every pause reason, data-sc-run marks a running root, a Kamran call pauses, the overlay layer is shared and removed", async () => {
  const dom = fakeDom();
  // core.js reads the browser lazily; these globals are the browser it meets.
  const globals = { ...dom.win, MutationObserver: dom.win.MutationObserver, IntersectionObserver: dom.win.IntersectionObserver };
  for (const [k, v] of Object.entries(globals)) Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  const core = await import("../apps/web/components/marketing/brain/engine/core.js");
  const doc = dom.win.document as { hidden: boolean };
  const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
  const mk = new dom.El("div");
  mk.className = "mk";
  dom.body.append(mk);
  const root = new dom.El("section");
  root.setAttribute("data-showcase", "field");
  mk.append(root);
  const states: string[][] = [];
  const sc = core.scene(root as unknown as HTMLElement, { onState: (_running, reasons) => states.push(reasons) });
  const button = new dom.El("button");
  button.setAttribute("aria-pressed", "false"); // as the server's frame has it
  sc.button(button as unknown as HTMLElement);
  assert.equal(button.getAttribute("data-sc-pause"), "", "every Pause control carries [data-sc-pause]");
  // Its label says what a press does, so it is no toggle: a toggle's name never changes (A11Y-11).
  assert.equal(button.getAttribute("aria-pressed"), null);
  let ticks = 0;
  sc.loop(() => {
    ticks++;
  });
  assert.ok(!root.hasAttribute("data-sc-run"), "off screen: no frame for it");
  dom.visible();
  assert.equal(sc.running, true);
  assert.ok(root.hasAttribute("data-sc-run") && dom.scheduled() === 1, "running: a frame is scheduled and the root says so");
  // The location carries ?tier=minimal&slow=40: a real visitor's frames ignore both.
  const started = performance.now();
  dom.frame(16);
  dom.frame(33);
  assert.ok(performance.now() - started < 30, `two frames took ${(performance.now() - started).toFixed(0)} ms (?slow=40 obeyed)`);
  assert.ok(ticks >= 1 && root.hasAttribute("data-sc-run"));

  // The prototype's stale Pause: a receipt pauses it for reading, the visitor
  // presses Pause, the receipt closes: the button must read Play.
  sc.pause("read");
  assert.ok(!root.hasAttribute("data-sc-run"), "paused: the mark goes at once");
  assert.equal(button.textContent, "Pause");
  button.click();
  assert.deepEqual([button.textContent, button.getAttribute("data-state")], ["Play", "paused"], "Pause while reading");
  sc.set("read", false);
  assert.deepEqual([button.textContent, sc.running], ["Play", false], "the receipt closed: still paused");
  assert.deepEqual(states.at(-1), ["user"], "onState hears every change of reasons");
  button.click();
  assert.deepEqual([button.textContent, button.getAttribute("data-state"), button.getAttribute("aria-pressed"), sc.running], ["Pause", "playing", null, true]);
  assert.ok(root.hasAttribute("data-sc-run"));

  // A Kamran call (html[data-mk-call], assistant-button.tsx) pauses it.
  dom.html.setAttribute("data-mk-call", "");
  await Promise.resolve();
  assert.equal(sc.running, false);
  assert.ok(sc.reasons.has("call") && !root.hasAttribute("data-sc-run"));
  dom.html.removeAttribute("data-mk-call");
  await Promise.resolve();
  assert.equal(sc.running, true);

  // One overlay layer per marketing root, shared and counted, with one live region.
  const a = core.layer(root as unknown as HTMLElement), b = core.layer(root as unknown as HTMLElement);
  assert.equal(a.el, b.el);
  assert.equal(mk.children.at(-1), a.el as unknown, "the layer is the marketing root's last child");
  assert.equal(a.el.getAttribute("data-showcase"), "layer");
  core.say("Paused");
  core.say("Playing");
  assert.equal(mk.querySelectorAll("[data-sc-live]").length, 1, "one live region, reused");
  // A modal in the layer makes the rest of the page inert; the undo restores only what it set.
  const aside = new dom.El("aside"), held = new dom.El("p");
  dom.body.append(aside);
  held.inert = true;
  mk.append(held);
  const undo = core.inertOutside(a.el as unknown as Element);
  assert.deepEqual([root.inert, held.inert, aside.inert, mk.inert, (a.el as unknown as { inert: boolean }).inert], [true, true, true, false, false]);
  undo();
  assert.deepEqual([root.inert, held.inert, aside.inert], [false, true, false]);
  aside.remove();
  held.remove();
  a.release();
  a.release();
  assert.ok((a.el as unknown as { isConnected: boolean }).isConnected, "a second release of one hold changes nothing");
  b.release();
  assert.ok(!(a.el as unknown as { isConnected: boolean }).isConnected, "the last release removes the layer");

  // The last scene's destroy stops the loop and removes every listener.
  assert.ok(dom.listening() > 0 && dom.observing() > 0);
  sc.destroy();
  assert.equal(dom.scheduled(), 0, "no frame left");
  assert.ok(!root.hasAttribute("data-sc-run"));
  assert.deepEqual([dom.listening(), dom.observing()], [0, 0], "no listener left");
  // destroyAll does the same for everything at once.
  const again = core.scene(root as unknown as HTMLElement);
  again.loop(() => {});
  dom.visible();
  assert.equal(dom.scheduled(), 1);
  core.destroyAll();
  assert.deepEqual([dom.scheduled(), dom.listening(), dom.observing()], [0, 0, 0]);
  assert.ok(!root.hasAttribute("data-sc-run"));

  // Time in another tab (or in the back/forward cache) is not idle time, and
  // input ends an idle pause, also for a scene that did not ask for it (the
  // field's; ENG-2). Frames and performance.now() on one made-up clock.
  const realNow = performance.now;
  let t = realNow.call(performance);
  performance.now = () => t;
  try {
    const away = core.scene(root as unknown as HTMLElement, { idle: 2 }), toggle = new dom.El("button");
    away.button(toggle as unknown as HTMLElement);
    away.loop(() => {});
    dom.visible();
    const later = (ms: number) => dom.frame((t += ms));
    later(1100); // idle (2 s here) is looked at once a second
    doc.hidden = true;
    dom.fire("visibilitychange");
    assert.equal(away.running, false, "a hidden tab pauses");
    t += 5000;
    doc.hidden = false;
    dom.fire("visibilitychange");
    later(1100);
    assert.deepEqual([away.running, toggle.textContent], [true, "Pause"], "back from another tab: still playing");
    t += 5000; // the back/forward cache: no frames, and no visibility change in some browsers
    dom.fire("pageshow", { persisted: true });
    later(1100);
    assert.deepEqual([away.running, toggle.textContent], [true, "Pause"], "back from the back/forward cache: still playing");
    later(1100);
    assert.deepEqual([away.running, [...away.reasons], toggle.textContent], [false, ["idle"], "Play"], "idle on the page: paused");
    dom.fire("keydown");
    assert.deepEqual([away.running, toggle.textContent], [true, "Pause"], "input ends an idle pause");
    away.destroy();
  } finally {
    performance.now = realNow;
  }

  // A 12 fps subscriber naps between its frames instead of waking at every
  // frame (PERF-6); its root keeps data-sc-run, and a wake ends the nap.
  const slow = core.scene(root as unknown as HTMLElement, { idle: 0 });
  let breaths = 0;
  const breath = slow.loop(() => {
    breaths++;
  }, 12);
  dom.visible();
  const t1 = performance.now();
  dom.frame(t1);
  assert.deepEqual([breaths, dom.scheduled(), root.hasAttribute("data-sc-run")], [1, 0, true], "napping: no frame requested, the root still runs");
  // A second one, a frame later: one nap serves both.
  let others = 0;
  const other = slow.loop(() => {
    others++;
  }, 12);
  assert.equal(dom.scheduled(), 1, "a new subscriber ends the nap");
  dom.frame(t1 + 16.7);
  assert.deepEqual([breaths, others, dom.scheduled()], [1, 1, 0]);
  await wait(100); // the nap ends when the next breath is due (79 ms on)
  assert.equal(dom.scheduled(), 1);
  dom.frame(t1 + 83.3);
  assert.deepEqual([breaths, others, dom.scheduled()], [2, 2, 0], "the frame after a nap runs whatever is due within a frame");
  other.stop();
  const fast = slow.loop(() => {});
  assert.equal(dom.scheduled(), 1, "a new 60 fps subscriber ends the nap");
  fast.stop();
  breath.stop();
  slow.destroy();
  assert.deepEqual([dom.scheduled(), root.hasAttribute("data-sc-run")], [0, false]);

  // The watchdog, on the made-up clock again (it only moves forward).
  t = Math.max(t, realNow.call(performance));
  performance.now = () => t;
  try {
    const changes: string[] = [];
    const off = core.tier.on((name) => changes.push(name));
    assert.equal(core.tier.name, "full", "?tier=minimal is ignored for real visitors");
    const watched = core.scene(root as unknown as HTMLElement, { idle: 0 });
    const frames = (ms: number, gap: number, every = 1, slower = gap) => {
      for (let i = 1, end = t + ms; t < end; i++) dom.frame((t += i % every ? gap : slower));
    };
    /** The loop stops and starts again: a new window, whose first 500 ms are not judged. */
    const restart = () => {
      watched.pause();
      frames(17, 17);
      watched.play();
      frames(600, 16.7);
    };
    watched.loop(() => {});
    dom.visible();
    frames(600, 16.7);
    frames(2100, 33.4); // most frames miss one, or the browser caps frames at 30 Hz
    assert.deepEqual(changes, ["lite"], "a slow window steps down: lite asks for 30 fps");
    restart();
    dom.fire("scroll"); // a scroll starts: 300 ms not judged
    frames(280, 70);
    dom.html.setAttribute("style", "--consent-bar-block-size: 80px"); // <html> changes (the consent bar opens): 300 ms not judged
    await Promise.resolve();
    frames(280, 70);
    frames(4100, 16.7);
    assert.deepEqual(changes, ["lite", "full"], "two good windows step back up");
    assert.equal(dom.scheduled(), 1, "one frame asked for, though the step up kicked the loop inside a frame");
    frames(4100, 16.7);
    assert.deepEqual([changes, core.tier.name], [["lite", "full"], "full"], "never past the starting tier");
    restart();
    frames(2100, 20, 60, 240); // one long frame among frames of 20 ms: a mean over 20 ms, a median of 20
    assert.deepEqual(changes, ["lite", "full"], "an isolated long frame is no slow window");
    restart();
    frames(2100, 16.7, 15, 33.4); // 1 frame in 15 misses one: a stutter
    assert.deepEqual(changes, ["lite", "full"], "one window of stutter is no step down");
    frames(2000, 16.7, 15, 33.4);
    assert.deepEqual(changes, ["lite", "full", "lite"], "a steady stutter steps down");
    restart();
    frames(8100, 16.7);
    assert.deepEqual(changes, ["lite", "full", "lite"], "a tier left twice holds");
    // A browser that caps frames at 30 Hz (iOS Low Power Mode, Chrome's Energy Saver) gives every gap 33.3 ms
    // with little work: lite's own rate, so lite holds window after window, never minimal and DPR 1 (ENG-2).
    restart();
    frames(8100, 33.4);
    assert.deepEqual([changes, core.tier.name], [["lite", "full", "lite"], "lite"], "a 30 Hz cap holds lite");
    restart();
    frames(2100, 50); // 20 fps: lite's 30 out of reach
    assert.deepEqual(changes, ["lite", "full", "lite", "minimal"]);
    // A subscriber that slept at the lower tier looks again after a step up.
    let looks = 0;
    watched.loop(() => (looks++, false));
    restart();
    assert.equal(looks, 1);
    frames(4100, 16.7);
    assert.deepEqual([changes, core.tier.name], [["lite", "full", "lite", "minimal", "lite"], "lite"], "back up into a tier left once");
    frames(17, 17);
    assert.equal(looks, 2, "woken by the step up");
    assert.deepEqual(core.tier.log.map(([name]) => name), changes);
    off();
    watched.destroy();
  } finally {
    performance.now = realNow;
  }
  core.destroyAll();
  for (const k of Object.keys(globals)) delete (globalThis as Record<string, unknown>)[k];
});

test("?tier= and ?slow= are the browser checks' switches: automated browsers only; a device that starts at lite never steps up", () => {
  // In a fresh process each (core.js decides its tier once a document).
  const probe = (webdriver: boolean, cores = 8) => `
    const frames = [];
    globalThis.window = {
      navigator: { webdriver: ${webdriver}, userAgent: "Mozilla/5.0 Chrome/141", hardwareConcurrency: ${cores} },
      location: { search: "?tier=minimal&slow=40" },
      document: { readyState: "complete", hidden: false },
      devicePixelRatio: 1,
      matchMedia: () => ({ matches: false }),
      requestAnimationFrame: (f) => frames.push(f),
      cancelAnimationFrame() {},
      addEventListener() {},
      removeEventListener() {},
    };
    const core = await import(${JSON.stringify(join(BRAIN, "engine/core.js"))});
    const tier = core.tier.name;
    core.loop(() => {});
    const t0 = performance.now();
    frames.shift()(t0);
    const ms = performance.now() - t0;
    // 6 s of good frames on a made-up clock (without ?slow): no step up past the starting tier.
    if (!${webdriver}) {
      let t = t0 + 100;
      performance.now = () => t;
      while (t < t0 + 6100) frames.shift()((t += 16.7));
    }
    process.stdout.write(JSON.stringify({ tier, ms, after: core.tier.name }));
  `;
  const run = (webdriver: boolean, cores?: number) => {
    const args = ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--input-type=module", "-e", probe(webdriver, cores)];
    return JSON.parse(execFileSync(process.execPath, args, { cwd: ROOT, encoding: "utf8" }));
  };
  for (const webdriver of [false, true]) {
    const out = run(webdriver);
    assert.equal(out.tier, webdriver ? "minimal" : "full", `webdriver ${webdriver}`);
    assert.equal(out.ms >= 40, webdriver, `webdriver ${webdriver}: a frame took ${out.ms.toFixed(0)} ms`);
  }
  const four = run(false, 4);
  assert.deepEqual([four.tier, four.after], ["lite", "lite"], "4 cores: lite, and good frames never step it up");
});

// ---------------------------------------------------------------- styles

const sheet = (name: string) => {
  const lazy = join(BRAIN, "engine", name);
  return existsSync(lazy) ? read(lazy) : existsSync(join(WEB, "app", name)) ? read(join(WEB, "app", name)) : "";
};
const allShowcaseRules = () =>
  [...STAGE_SHEETS, ...lazySheets()].flatMap((name) => cssRules(sheet(name)).map((rule) => ({ name, rule })));
const inKeyframes = (r: Rule) => r.context.some((c) => c.startsWith("@keyframes"));
/** Where a showcase rule may apply: under [data-showcase] (an html.sc-* state or the member's setting before it), or html.sc-lock. */
const SCOPED = /^(?:(?::root\[data-reduce-motion="on"\]|html(?:\.sc-[a-z-]+|:not\(\.sc-[a-z-]+\))+) )?\[data-showcase(?:="[a-z]+")?\]/;
const MOVES = new Set(["opacity", "transform", "translate", "scale", "rotate", "stroke-dashoffset"]);

test("showcase CSS: scoped under [data-showcase], only opacity, transforms and stroke-dashoffset move, never infinite, no nesting", () => {
  const rules = allShowcaseRules();
  assert.ok(rules.length > 80, `${rules.length} rules`);
  const keyframes = new Map<string, string[]>();
  for (const name of [...STAGE_SHEETS, ...lazySheets()]) {
    const text = sheet(name).replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(text, /\binfinite\b/, `${name}: nothing loops`);
    assert.doesNotMatch(text, /&/, `${name}: no CSS nesting`);
    for (const m of text.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)) keyframes.set(m[1], []);
  }
  for (const { name, rule } of rules) {
    if (inKeyframes(rule)) {
      const kf = rule.context.find((c) => c.startsWith("@keyframes"))!.split(/\s+/)[1];
      for (const d of rule.declarations) assert.ok(MOVES.has(d.property), `${name} @keyframes ${kf} animates ${d.property}`);
      keyframes.get(kf)?.push(...rule.declarations.map((d) => d.property));
      continue;
    }
    for (const selector of rule.selectors)
      assert.ok(SCOPED.test(selector) || selector === "html.sc-lock", `${name}:${rule.line} ${selector} is not scoped under [data-showcase]`);
    for (const d of rule.declarations) {
      if (d.property === "transition" || d.property === "transition-property")
        for (const item of splitTop(d.value, ",")) {
          const prop = item.split(/\s+/).find((t) => !/^(?:-?[\d.]+m?s|var\(|cubic-bezier|steps|ease|linear|step-)/.test(t));
          assert.ok(prop && MOVES.has(prop), `${name}:${rule.line} transitions ${prop ?? "all"} (${d.value})`);
        }
      if (d.property === "animation" || d.property === "animation-name") {
        const kf = d.value.split(/\s+/).find((t) => keyframes.has(t));
        assert.ok(kf || d.value === "none", `${name}:${rule.line} animation ${d.value} names showcase keyframes`);
      }
      assert.ok(!(d.property === "will-change" && !d.value.split(/,\s*/).every((p) => MOVES.has(p))), `${name}:${rule.line} will-change ${d.value}`);
    }
  }
});

test("showcase tokens: --sc-* defined in brain-stage.css only, easing from the marketing tokens, no --mk-* definitions; ink-stage contrast", () => {
  for (const name of [...STAGE_SHEETS, ...lazySheets()]) {
    const text = sheet(name).replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(text, /--mk-[\w-]+\s*:/, `${name} defines a --mk-* token`);
    if (name !== "brain-stage.css") assert.doesNotMatch(text, /--sc-[\w-]+\s*:/, `${name} defines a --sc-* token`);
  }
  const stage = cssRules(sheet("brain-stage.css"));
  const tokens = Object.fromEntries(
    stage.filter((r) => r.selector === "[data-showcase]" && !r.context.length).flatMap((r) => r.declarations.map((d) => [d.property, d.value])),
  );
  assert.equal(tokens["--sc-ease"], "var(--mk-ease-in-out)");
  assert.equal(tokens["--sc-enter"], "var(--mk-ease-enter)");
  assert.equal(tokens["--sc-spring"], "var(--mk-ease-spring)");
  assert.match(tokens["--sc-mono"], /^ui-monospace, /, "the system monospace stack: no new font files");
  const c = (a: string, b: string) => contrast(hex(tokens[a]), hex(tokens[b]));
  for (const bg of ["--sc-stage", "--sc-node", "--sc-tint"]) {
    for (const text of ["--sc-text", "--sc-muted"]) assert.ok(c(text, bg) >= 4.5, `${text} on ${bg}: ${c(text, bg).toFixed(2)}`);
    assert.ok(c("--sc-control", bg) >= 3, `--sc-control on ${bg}: ${c("--sc-control", bg).toFixed(2)}`);
  }
  for (const lane of ["--sc-sent", "--sc-waits", "--sc-paused", "--sc-member", "--sc-learn", "--sc-ai-on"]) {
    assert.ok(c(lane, "--sc-stage") >= 3, `${lane} on the stage`);
    assert.ok(c("--sc-on-ai", lane) >= 4.5, `ink text on ${lane}`);
  }
  // Dark surfaces (luminance under 0.2) only inside a showcase.
  const dark = new Set(Object.entries(tokens).filter(([, v]) => /^#[0-9a-f]{6}$/i.test(v) && contrast(hex(v), [0, 0, 0]) < 5).map(([k]) => k));
  for (const { name, rule } of allShowcaseRules())
    for (const d of rule.declarations)
      if (/^background(-color)?$/.test(d.property) && [...dark].some((t) => d.value.includes(`var(${t})`)))
        for (const selector of rule.selectors) assert.match(selector, SCOPED, `${name}:${rule.line} paints a dark surface outside a showcase`);
});

test("showcase reduced motion follows both settings without the always-on exclusion; pre-state, pin gate and overlay layer rules", () => {
  const stage = cssRules(sheet("brain-stage.css"));
  const device = stage.filter((r) => r.context.includes("@media (prefers-reduced-motion: reduce)"));
  const member = stage.filter((r) => r.selectors.some((s) => s.startsWith(':root[data-reduce-motion="on"] [data-showcase]')));
  for (const [what, rules] of [["device", device], ["member", member]] as const) {
    const rule = rules.find((r) => r.selectors.includes(what === "device" ? "[data-showcase] *" : ':root[data-reduce-motion="on"] [data-showcase] *'));
    assert.ok(rule, `${what}: a rule for everything in a showcase`);
    assert.ok(rule.declarations.some((d) => d.property === "animation" && d.value === "none" && d.important));
    assert.ok(rule.declarations.some((d) => d.property === "transition-duration" && d.important));
  }
  for (const { name, rule } of allShowcaseRules()) {
    for (const selector of rule.selectors) {
      assert.ok(!selector.includes("data-mk-motion") && !selector.includes(MOTION_ALWAYS_EXCLUDED), `${name}: ${selector} follows the switch`);
      // Results wait for the engine only for visitors who get the motion.
      if (selector.includes('[data-sc="pre"]')) assert.ok(selector.startsWith('html.sc-motion:not(.sc-late) [data-showcase'), `${name}: ${selector}`);
    }
    // The anatomy pins only under the gate, on tall enough viewports.
    if (rule.declarations.some((d) => (d.property === "position" && d.value === "sticky") || d.value.includes("--sc-pin-len)"))) {
      assert.ok(rule.context.some((c) => c.includes("min-height: 700px")), `${name}:${rule.line} pins outside @media (min-height: 700px)`);
      for (const selector of rule.selectors) assert.ok(selector.startsWith('html.sc-pin [data-showcase="anatomy"]:not([data-sc-flat])'), `${name}: ${selector} pins outside the gate`);
    }
  }
  assert.ok(stage.some((r) => r.selector === 'html.sc-motion:not(.sc-late) [data-showcase][data-sc="pre"] .sc-res' && r.declarations.some((d) => d.property === "visibility" && d.value === "hidden")));
  assert.ok(stage.some((r) => r.selector === 'html.sc-pin [data-showcase="anatomy"]:not([data-sc-flat])'));
  // The overlay layer: fixed, above the consent bar and Kamran's button.
  const layer = stage.find((r) => r.selector === '[data-showcase="layer"]')!;
  const z = (rules: Rule[], selector: string) => Number(rules.find((r) => r.selectors.includes(selector))!.declarations.find((d) => d.property === "z-index")!.value);
  const value = (p: string) => layer.declarations.find((d) => d.property === p)?.value;
  assert.equal(value("position"), "fixed");
  const fab = z(cssRules(read(join(WEB, "app/marketing.css"))), ".mk-assistant-fab");
  const consent = Math.max(...cssRules(read(join(WEB, "app/analytics-consent.css"))).flatMap((r) => r.declarations.filter((d) => d.property === "z-index").map((d) => Number(d.value))));
  assert.ok(Number(value("z-index")) > Math.max(fab, consent), `layer ${value("z-index")} over Kamran ${fab} and the consent bar ${consent}`);
});

test("--sc-top is the site header's height, as the scroll scenes' --scene-top", () => {
  const top = (rules: Rule[], name: string) =>
    rules.filter((r) => r.declarations.some((d) => d.property === name)).map((r) => [r.context.join(" "), r.declarations.find((d) => d.property === name)!.value]);
  const scenesFile = join(WEB, "app/scroll-scenes.css");
  if (!existsSync(scenesFile)) return; // parked engine deleted: nothing to compare
  const scenes = top(cssRules(read(scenesFile)), "--scene-top");
  const showcase = top(cssRules(sheet("brain-stage.css")), "--sc-top");
  assert.deepEqual(showcase, scenes);
  assert.deepEqual(showcase.map(([, v]) => v), ["74px", "69px", "65px"]);
});

/** What the static first frames emit, across the option sets the pages use (the AI model off too: the
    fallback platform's frames, where the playground opens on the knee and its safety lock). */
function staticVocabulary() {
  const classes = new Set<string>(), attrs = new Set<string>();
  for (const kind of KINDS)
    for (const flags of [{ payments: false }, { payments: true }, { payments: false, model: false }])
      for (const mode of ["live", "static"] as const) {
        const html = renderShowcase(kind, { ...options({ flags: { ...FLAGS, ...flags } }), kind, id: "sc-" + kind, label: "x" }, mode);
        for (const m of html.matchAll(/\sclass="([^"]*)"/g)) for (const c of m[1].split(/\s+/)) classes.add(c);
        for (const m of html.matchAll(/\s([\w-]+)(?:="([^"]*)")?/g)) {
          attrs.add(m[1]);
          if (m[2] !== undefined) attrs.add(`${m[1]}="${m[2]}"`);
        }
      }
  return { classes, attrs };
}
test("lazy sheets style only what JavaScript adds; budgets: first frame ≤ 18 KB, page sheets ≤ 8 KB, lazy sheets ≤ 8 KB a page (gzipped)", () => {
  const { classes, attrs } = staticVocabulary();
  assert.ok(classes.has("sc-strip") && attrs.has('data-sc="pre"'));
  for (const name of lazySheets())
    for (const rule of cssRules(sheet(name)).filter((r) => !inKeyframes(r)))
      for (const selector of rule.selectors) {
        const states = [
          ...[...selector.matchAll(/\.([\w-]+)/g)].map((m) => !classes.has(m[1])),
          ...[...selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)].map((m) => !(m[2] === undefined ? attrs.has(m[1]) : attrs.has(`${m[1]}="${m[2]}"`))),
        ];
        assert.ok(states.some(Boolean), `${name}:${rule.line} ${selector} styles the static frame: it belongs in the first-frame sheet`);
      }
  const min = (css: string) =>
    css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").replace(/\s*([{}:;,>])\s*/g, "$1").replace(/;}/g, "}").trim();
  const gz = (names: string[]) => names.reduce((n, name) => n + (sheet(name) ? gzipSync(min(sheet(name))).length : 0), 0);
  const stageKb = gz(STAGE_SHEETS) / 1024, pageKb = gz(PAGE_SHEETS) / 1024;
  assert.ok(stageKb <= 18, `first-frame showcase sheets: ${stageKb.toFixed(1)} KB`);
  assert.ok(pageKb <= 8, `page sheets: ${pageKb.toFixed(1)} KB`);
  for (const [page, names] of Object.entries(LAZY_BY_PAGE)) assert.ok(gz(names) / 1024 <= 8, `${page} lazy sheets: ${(gz(names) / 1024).toFixed(1)} KB`);
  const unknown = lazySheets().filter((n) => !Object.values(LAZY_BY_PAGE).flat().includes(n));
  assert.deepEqual(unknown, [], "every lazy sheet counts towards a page's budget");
});

// ---------------------------------------------------------------- rendering

const elementChildren = (el: ReactElement) =>
  ([] as unknown[]).concat((el.props as { children?: unknown }).children).filter(isValidElement) as ReactElement[];

test("static mode renders the still frame (data-sc=\"off\", the anatomy flat) with no island; every root has data-nosnippet", () => {
  for (const kind of KINDS)
    for (const mode of ["live", "static"] as const) {
      const html = renderShowcase(kind, { ...options(), kind, id: "sc-" + kind, label: "A sample" }, mode);
      const open = html.match(/^<section [^>]*>/)![0];
      assert.match(open, new RegExp(`data-showcase="${kind}"`));
      assert.match(open, / data-nosnippet[ >]/, `${kind}: data-nosnippet`);
      assert.match(open, mode === "live" ? / data-sc="pre"/ : / data-sc="off"/);
      assert.equal(/ data-sc-flat/.test(open), mode === "static" && kind === "anatomy", `${kind} ${mode} flat`);
      assert.match(open, / aria-label="A sample"/);
      const el = BrainShowcase({ kind, id: "sc-" + kind, label: "A sample", options: options(), mode }) as ReactElement;
      const kids = elementChildren(el);
      assert.equal(kids.length, mode === "live" ? 2 : 1, `${kind} ${mode}: host${mode === "live" ? " and island" : " only"}`);
      assert.equal(kids.some((k) => k.type === ShowcaseMount), mode === "live");
      // React owns the host only; the engine owns what is inside it.
      const out = renderToStaticMarkup(el);
      assert.equal(out, `<div id="sc-${kind}" class="sc-host">${html}</div>`);
    }
  // Labelled by the page's H2 instead, when it supplies one: a group in the band that H2 names (one region).
  const labelled = renderShowcase("play", { ...options({ heading: false, labelledBy: "demo-h" }), kind: "play", id: "sc-play", label: "unused" }, "live");
  assert.match(labelled, /^<section class="bp" data-showcase="play" data-sc="pre" data-nosnippet role="group" aria-labelledby="demo-h">/);
});

test("host and island share one key: stable for equal HTML, new when a flag changes", () => {
  const key = (o: ShowcaseOptions) => {
    // One keyed fragment holds both, so a new key replaces both (and React
    // never sees two siblings with the same key).
    const el = BrainShowcase({ kind: "field", id: "sc-field", label: "A sample", options: o, mode: "live" }) as ReactElement;
    assert.equal(elementChildren(el).length, 2);
    assert.ok(elementChildren(el).every((k) => k.key === null));
    return el.key;
  };
  assert.equal(key(options()), key(options()));
  assert.equal(key(options()), fnv1a(renderShowcase("field", { ...options(), kind: "field", id: "sc-field", label: "A sample" }, "live")));
  assert.notEqual(key(options()), key(options({ flags: { ...FLAGS, payments: true } })), "payments on: the strip changes");
  assert.notEqual(key(options()), key(options({ cta: { label: "Teach your AI — free", href: "/signup" } })), "sign-ups open");
  // FNV-1a, 32 bits (the published test vectors).
  assert.equal(fnv1a(""), (0x811c9dc5).toString(36));
  assert.equal(fnv1a("a"), (0xe40c292c).toString(36));
  assert.equal(fnv1a("foobar"), (0xbf9cf968).toString(36));
});

test("renderShowcase escapes the platform name and every option it writes", () => {
  const evil = "<script>alert(1)</script>";
  for (const kind of KINDS) {
    const html = renderShowcase(
      kind,
      {
        ...options({ appName: evil, cta: { label: '<img src=x onerror="y">', href: '/x" onclick="y' } }),
        kind,
        id: "sc-" + kind,
        label: '"><script>z</script>',
      },
      "live",
    );
    assert.doesNotMatch(html, /<script|<img|" onclick=|" onerror=/i, kind);
    assert.match(html, /aria-label="&quot;&gt;&lt;script&gt;z&lt;\/script&gt;"/, kind);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;\. Can&#39;t switch off\./, `${kind}: the name, escaped`);
    const labelled = renderShowcase(kind, { ...options({ labelledBy: 'h" onfocus="x' }), kind, id: "sc-" + kind }, "live");
    assert.match(labelled, /aria-labelledby="h&quot; onfocus=&quot;x"/);
  }
});

test("the options come from the platform: its name, the page's call to action, the flags; recovery stays off; MARKETING_SHOWCASE", () => {
  const platform = {
    name: "Acme",
    registrationOpen: true,
    availability: { model: true, nutrition: true, mealPhotos: false, voice: false, customDomains: false, payments: true, payouts: false, whoop: true, zepp: false, instagram: false, frontier: true },
  } as unknown as PublicPlatform;
  const cta = { label: "Teach your AI — free", href: "/signup" };
  assert.deepEqual(showcaseOptions(platform, cta), {
    appName: "Acme",
    cta,
    flags: { payments: true, payouts: false, voice: false, nutrition: true, mealPhotos: false, model: true, publish: true, recovery: false },
  });
  // The AI model off: its specialists are not on yet (prepare()).
  const at = (patch: object, open = true) => showcaseOptions({ ...platform, registrationOpen: open, availability: { ...platform.availability, ...patch } } as PublicPlatform, cta).flags;
  assert.equal(at({ model: false }).model, false);
  // Publishing waits for every PUBLISH_GATES gate: sign-ups, subscriber payments and the model (HON-3).
  assert.deepEqual([at({}, false).publish, at({ payments: false }).publish, at({ model: false }).publish, at({ mealPhotos: true }).mealPhotos], [false, false, false, true]);
  const extra = showcaseOptions(platform, cta, { heading: false, labelledBy: "h", appName: "Other", flags: { ...FLAGS, recovery: true } });
  assert.equal(extra.appName, "Acme");
  assert.equal(extra.flags.recovery, false);
  assert.deepEqual([extra.heading, extra.labelledBy], [false, "h"]);
  assert.equal(showcaseMode("static"), "static");
  for (const v of [undefined, "", "live", "STATIC", "off"]) assert.equal(showcaseMode(v), "live", String(v));
  // The page reads it per request; the server render passes it on.
  const page = read(join(WEB, "app/[[...path]]/page.tsx"));
  assert.match(page, /showcase=\{showcaseMode\(process\.env\.MARKETING_SHOWCASE\)\}/);
  // While Kamran's call is open, html[data-mk-call] pauses the showcases.
  const kamran = read(join(WEB, "components/marketing/assistant-button.tsx"));
  assert.match(kamran, /useEffect\(\(\) => \{\s+if \(!open\) return;\s+const html = document\.documentElement;\s+html\.setAttribute\("data-mk-call", ""\);\s+return \(\) => html\.removeAttribute\("data-mk-call"\);\s+\}, \[open\]\);/);
});

test("the island renders nothing on the server and needs no router there", () => {
  assert.equal(renderToStaticMarkup(createElement(ShowcaseMount, { id: "sc-field", kind: "field", options: options() })), "");
});

test("right to left (?lang=ar): English sample text takes its own direction from its first letter and the page's alignment; Arabic samples keep theirs", () => {
  const rule = cssRules(read(join(WEB, "app/brain-stage.css"))).find((r) => r.selectors.some((s) => s.includes(":dir(rtl)")));
  assert.ok(rule, "brain-stage.css: the right-to-left sample text rule");
  const value = (p: string) => rule!.declarations.filter((x) => x.property == p).map((x) => x.value);
  assert.deepEqual(value("unicode-bidi"), ["plaintext"]);
  assert.deepEqual(value("text-align"), ["-webkit-match-parent", "match-parent"]);
  const [selector] = rule!.selectors;
  // Every text holder (the chips and What-ifs hold theirs directly), never an element with its own dir, at the weight
  // of one class and :dir() so the sheets' own alignments that come later stand.
  for (const tag of ["p", "li", "span", "b", "small", "summary", ".bp-chip", ".ca-wb"]) assert.match(selector, new RegExp(`[(, ]${tag.replace(".", "\\.")}[,)]`), tag);
  assert.match(selector, /^\[data-showcase\] :where\([^)]+\):dir\(rtl\):where\(:not\(\[dir\]\)\)$/);
});

test("keyboard users meet armed controls: the first Tab mounts every showcase, focus in a host mounts it, and focus survives a reduced-motion change", () => {
  const mount = code(read(join(BRAIN, "mount.tsx")));
  // A11Y-2: the still frame's controls wait, disabled, for the engine; a Tab that met them first would pass them by.
  assert.match(mount, /const onTab = \(e: KeyboardEvent\) => \{\s+if \(e\.key !== "Tab"\) return;\s+document\.removeEventListener\("keydown", onTab, true\);\s+void mount\(\);\s+\};/);
  assert.match(mount, /document\.addEventListener\("keydown", onTab, true\);\s+host\.addEventListener\("focusin", onFocus\);/);
  assert.match(mount, /document\.removeEventListener\("keydown", onTab, true\);\s+host\.removeEventListener\("focusin", onFocus\);/, "removed on unmount");
  // Robots never get there: the listeners come after the engineWanted() gate.
  assert.ok(mount.indexOf("if (!engineWanted()) return;\n    let alive") < mount.indexOf("const onTab"));
  // A11Y-12: the control that had focus (by its moment, else its place) gets it back once the engine is armed again.
  assert.match(mount, /const at = was instanceof HTMLElement && host\.contains\(was\) \? \{ cls: was\.classList\[0\], t: was\.dataset\.t, i: focusables\(host\)\.indexOf\(was\) \} : null;/);
  assert.match(mount, /void mount\(\)\.then\(\(\) => \{[\s\S]*?to\?\.focus\(\{ preventScroll: true \}\);/);
});
