// Marks on <html> for the surface a page shows (components/root-marks.tsx):
// the document's background, colour scheme, tab bar inset and scroll lock
// follow the surface without `:root:has(...)`, which made Chromium restyle
// the whole page on every element a Brain showcase added (review PERF-1).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  RootMark,
  holdRootMark,
  rootMarkScript,
} from "../apps/web/components/root-marks.tsx";
import { TrainerTheme } from "../apps/web/components/trainer-design.tsx";
import { noBrowser, openHarness } from "./react-dom-harness";

const source = (path: string) =>
  readFile(new URL("../" + path, import.meta.url), "utf8");

/** A stand-in <html> with attributes only. */
function fakeRoot(initial: Record<string, string> = {}) {
  const attributes = new Map(Object.entries(initial));
  return {
    attributes,
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) =>
      void attributes.set(name, String(value)),
    removeAttribute: (name: string) => void attributes.delete(name),
  };
}

test("a mark stays while any surface holds it, and goes with the last", () => {
  const root = fakeRoot();
  (globalThis as { document?: unknown }).document = { documentElement: root };
  try {
    const marketing = holdRootMark("data-shell", "public");
    const assistant = holdRootMark("data-shell", "public");
    assert.equal(root.getAttribute("data-shell"), "public");
    // A surface replacing another in the same commit: the new one holds
    // before or after the old one lets go; the token never drops.
    const dark = holdRootMark("data-scheme", "dark");
    const system = holdRootMark("data-scheme", "system");
    assert.equal(root.getAttribute("data-scheme"), "dark system");
    dark();
    dark(); // A second release changes nothing.
    assert.equal(root.getAttribute("data-scheme"), "system");
    marketing();
    assert.equal(root.getAttribute("data-shell"), "public");
    assistant();
    system();
    assert.equal(root.getAttribute("data-shell"), null);
    assert.equal(root.getAttribute("data-scheme"), null);
    // Tokens the server's script added stay until a surface releases them.
    root.setAttribute("data-open", "sheet");
    const kitchen = holdRootMark("data-open", "kitchen");
    assert.equal(root.getAttribute("data-open"), "sheet kitchen");
    kitchen();
    assert.equal(root.getAttribute("data-open"), "sheet");
  } finally {
    delete (globalThis as { document?: unknown }).document;
  }
});

test("the server's HTML carries each mark as a script that runs before the first paint", () => {
  const run = (script: string, root: ReturnType<typeof fakeRoot>) =>
    runInNewContext(script, { document: { documentElement: root } });
  const root = fakeRoot({ "data-shell": "member" });
  run(rootMarkScript("data-shell", "public"), root);
  run(rootMarkScript("data-shell", "public"), root);
  assert.equal(root.getAttribute("data-shell"), "member public");
  const html = renderToStaticMarkup(
    createElement(RootMark, { attribute: "data-scheme", token: "dark" }),
  );
  const script = html.match(/^<script>([\s\S]*)<\/script>$/)?.[1];
  assert.ok(script, html);
  const empty = fakeRoot();
  run(script, empty);
  assert.equal(empty.getAttribute("data-scheme"), "dark");
  // A subscriber surface marks the document with its scheme first; the
  // light-only Design Studio preview marks nothing.
  const member = renderToStaticMarkup(
    createElement(TrainerTheme, {
      theme: {},
      colorScheme: "system",
      children: "x",
    }),
  );
  assert.match(
    member,
    /data-color-scheme="system"><script>[^<]*"data-scheme","system"\)<\/script>x<\/div>$/,
  );
  assert.doesNotMatch(
    renderToStaticMarkup(createElement(TrainerTheme, { theme: {}, children: "x" })),
    /<script/,
  );
});

test("no stylesheet asks the whole document a :has() question", async () => {
  const dir = new URL("../apps/web/app/", import.meta.url);
  for (const name of (await readdir(dir)).filter((f) => f.endsWith(".css"))) {
    const css = (await readFile(new URL(name, dir), "utf8")).replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    // A selector whose :has() hangs on the root or the body.
    assert.doesNotMatch(
      css,
      /(^|[\s,{}>~+(])(:root|html|body)(\[[^\]]*\]|\.[\w-]+|:(?!has\()[\w-]+(\([^)]*\))?)*:has\(/m,
      name,
    );
  }
  const read = async (name: string) =>
    (await source(`apps/web/app/${name}`)).replace(/\/\*[\s\S]*?\*\//g, "");
  const [appearance, globals, workspace, phone, nutrition, marketing] =
    await Promise.all(
      [
        "appearance.css",
        "globals.css",
        "workspace-system.css",
        "phone-first.css",
        "nutrition.css",
        "marketing.css",
      ].map(read),
    );
  for (const scheme of ["dark", "system"]) {
    assert.match(
      appearance,
      new RegExp(`:root\\[data-scheme~="${scheme}"\\] \\.acquisition-consent \\{`),
    );
    assert.match(
      appearance,
      new RegExp(
        `:root\\[data-scheme~="${scheme}"\\] \\{\\s*background: var\\(--dark-paper\\);\\s*color-scheme: dark;`,
      ),
    );
  }
  assert.match(globals, /:root\[data-shell~="public"\] \{\s*background: var\(--ty-white\);/);
  assert.match(workspace, /:root\[data-shell~="workspace"\] \{ background: #ffffff; color-scheme: light; \}/);
  assert.match(phone, /:root\[data-shell~="member"\] \{\s*--member-tabbar-height: calc\(64px/);
  assert.match(phone, /:root\[data-open~="sheet"\] \{\s*overflow: hidden;/);
  assert.match(nutrition, /@media print \{\s*:root\[data-open~="kitchen"\] \{ background: white !important; \}/);
  assert.match(marketing, /html\.mk-menu-open \.mk-assistant-fab \{\s*visibility: hidden;/);
  // The keyboard still wins over the member shell's tab bar inset.
  assert.ok(
    phone.lastIndexOf(':root[data-shell~="member"]') <
      phone.indexOf(':root[data-keyboard="open"] {'),
  );
});

test("every surface the rules follow holds its mark", async () => {
  const has = (text: string, pattern: RegExp, label: string) =>
    assert.match(text, pattern, label);
  const workspace = await source("apps/web/components/workspace.tsx");
  has(
    workspace,
    /<div className="member-neutral" data-color-scheme=\{scheme\}>\s*<RootMark attribute="data-scheme" token=\{scheme\} \/>/,
    "the member app's neutral screens",
  );
  has(
    workspace,
    /className="workspace member-shell"[\s\S]{0,120}memberApp\s*>\s*<RootMark attribute="data-shell" token="member" \/>/,
    "the member shell",
  );
  has(
    workspace,
    /<PlainShell className=\{`workspace platform-ui[^\n]*\n\s*<RootMark attribute="data-shell" token="workspace" \/>/,
    "the trainer workspace",
  );
  has(
    await source("apps/web/components/pwa-ui.tsx"),
    /<div className="member-neutral" data-color-scheme=\{scheme\}>\s*<RootMark attribute="data-scheme" token=\{scheme\} \/>/,
    "the offline screen",
  );
  has(
    await source("apps/web/components/trainer-design.tsx"),
    /\{colorScheme && <RootMark attribute="data-scheme" token=\{colorScheme\} \/>\}/,
    "subscriber surfaces",
  );
  has(
    await source("apps/web/components/public-pages.tsx"),
    /className=\{coach \? "public" : "public platform-ui"\}[\s\S]{0,120}\{!coach && <RootMark attribute="data-shell" token="public" \/>\}/,
    "the platform's sign-in pages",
  );
  has(
    await source("apps/web/components/marketing/site.tsx"),
    /<div className="public mk platform-ui"[^>]*>\s*<RootMark attribute="data-shell" token="public" \/>/,
    "the marketing site",
  );
  has(
    await source("apps/web/components/coach-directory.tsx"),
    /<div className="public directory-page platform-ui">\s*<RootMark attribute="data-shell" token="public" \/>/,
    "the coach directory",
  );
  has(
    await source("apps/web/components/phone-ui.tsx"),
    /holdRootMark\("data-open", "sheet"\)[\s\S]{0,400}observer\.observe\(el, \{ attributes: true, attributeFilter: \["open"\] \}\)/,
    "bottom sheets",
  );
  has(
    await source("apps/web/components/nutrition-household.tsx"),
    /document\.body\.classList\.add\("nutrition-kitchen-open"\);[\s\S]{0,120}holdRootMark\("data-open", "kitchen"\)/,
    "the kitchen sheet",
  );
  // Every element that carries these classes is one of the above, or Kamran's
  // host, which shows only inside a marketing page (already "public").
  const components = new URL("../apps/web/components/", import.meta.url);
  const files = (await readdir(components, { recursive: true })).filter((f) =>
    f.endsWith(".tsx"),
  );
  const carriers: string[] = [];
  for (const file of files) {
    const text = await readFile(new URL(file, components), "utf8");
    if (
      /className=[^\n]*\b(member-neutral|platform-ui)\b|className="workspace member-shell"/.test(
        text,
      )
    )
      carriers.push(file);
  }
  assert.deepEqual(carriers.sort(), [
    "coach-directory.tsx",
    "marketing/assistant-button.tsx",
    "marketing/site.tsx",
    "public-pages.tsx",
    "pwa-ui.tsx",
    "workspace.tsx",
  ]);
});

// The surfaces as TrainerTheme and the shells render them (their wiring is
// checked above; TrainerTheme itself pulls in stylesheets the harness
// cannot bundle).
const ENTRY = `
import { createRoot } from "react-dom/client";
import { BottomSheet } from "../apps/web/components/phone-ui";
import { RootMark } from "../apps/web/components/root-marks";

function App({ page, scheme, sheet }) {
  return page === "member" ? (
    <div className="trainer-theme workspace member-shell" data-color-scheme={scheme}>
      <RootMark attribute="data-scheme" token={scheme} />
      <RootMark attribute="data-shell" token="member" />
      <BottomSheet open={sheet} onClose={() => {}} title="Sheet">x</BottomSheet>
    </div>
  ) : page === "public" ? (
    <div className="public platform-ui"><RootMark attribute="data-shell" token="public" /></div>
  ) : null;
}
const root = createRoot(document.getElementById("root"));
window.show = (props) => root.render(<App {...props} />);
window.marks = () => ({
  shell: document.documentElement.getAttribute("data-shell"),
  scheme: document.documentElement.getAttribute("data-scheme"),
  open: document.documentElement.getAttribute("data-open"),
  scripts: document.querySelectorAll("#root script").length,
});
`;

test(
  "client-side navigation moves the marks with the surface",
  { skip: noBrowser },
  async () => {
    const harness = await openHarness(ENTRY, { reducedMotion: "reduce" });
    try {
      const { page } = harness;
      const at = async (props: Record<string, unknown>) => {
        await page.evaluate((p) => (window as any).show(p), props);
        await page.waitForTimeout(50);
        return page.evaluate(() => (window as any).marks());
      };
      // Mounted on the client: marks, but no script elements.
      assert.deepEqual(await at({ page: "member", scheme: "dark", sheet: false }), {
        shell: "member",
        scheme: "dark",
        open: null,
        scripts: 0,
      });
      // The member's choice changes the document with the surface.
      assert.equal((await at({ page: "member", scheme: "light", sheet: false })).scheme, "light");
      // An open sheet locks the page behind; closing lets it go.
      assert.equal((await at({ page: "member", scheme: "light", sheet: true })).open, "sheet");
      assert.equal((await at({ page: "member", scheme: "light", sheet: false })).open, null);
      // To a public page: the member marks go, the public one comes.
      assert.deepEqual(await at({ page: "public" }), {
        shell: "public",
        scheme: null,
        open: null,
        scripts: 0,
      });
      assert.deepEqual(await at({ page: null }), {
        shell: null,
        scheme: null,
        open: null,
        scripts: 0,
      });
      assert.deepEqual(harness.errors, []);
    } finally {
      await harness.close();
    }
  },
);
