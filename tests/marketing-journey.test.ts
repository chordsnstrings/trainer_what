// The coach-to-subscriber journey (components/marketing/journey.tsx): the
// captions are the registry's steps unchanged, the steps stay real HTML
// with the HowTo JSON-LD intact, the subscriber lines are registry text,
// the launch gate hides the player until a coach can launch, the mocks
// carry no AI costs, fees, model names or amounts and add only the listed
// new words, and the motion code follows the house rules (tokens,
// transform and opacity only, hover in (hover: hover), reduced motion,
// nothing infinite, no new dependency).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  brandText,
  jsonLdScript,
  marketingJsonLd,
  marketingPage,
} from "@trainer/contracts";
import { DEFAULT_FOLLOWER_MODEL } from "../packages/domain/src/marketing-calculators.ts";
import {
  MarketingSite,
  Section,
} from "../apps/web/components/marketing/site.tsx";
import {
  JOURNEY_TIMING,
  SUBSCRIBER_LINES,
  journeyAvailable,
  registryLine,
} from "../apps/web/components/marketing/journey.tsx";
import type { PublicPlatform } from "../apps/web/components/marketing/platform.ts";

const ORIGIN = "https://trainsyou.example";
const APP = "trainsyou";
const ready: PublicPlatform = {
  name: APP,
  initials: "T",
  supportEmail: null,
  companyDetails: null,
  registrationOpen: true,
  coachAddressTemplate: ORIGIN + "/coach/{slug}",
  availability: {
    model: true,
    nutrition: false,
    voice: false,
    customDomains: false,
    payments: true,
    payouts: true,
    whoop: false,
    zepp: false,
    instagram: false,
  },
  followerModel: DEFAULT_FOLLOWER_MODEL,
};
const with_ = (
  changes: Partial<PublicPlatform["availability"]>,
  open = true,
): PublicPlatform => ({
  ...ready,
  registrationOpen: open,
  availability: { ...ready.availability, ...changes },
});
const render = (path: string, platform = ready) =>
  renderToStaticMarkup(
    createElement(MarketingSite, {
      page: marketingPage(path)!,
      platform,
      origin: ORIGIN,
    }),
  );
const decode = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
/** The markup of the first element opening with `open`, to its matching close. */
function element(html: string, open: RegExp): string {
  const start = html.search(open);
  assert.ok(start >= 0, `no ${open}`);
  const tag = html.slice(start + 1).match(/^[a-z0-9]+/)![0];
  let depth = 0;
  const re = new RegExp(`<${tag}[\\s>]|</${tag}>`, "g");
  re.lastIndex = start;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return html.slice(start, m.index + m[0].length);
  }
  throw new Error("unclosed " + tag);
}
const how = marketingPage("/how-it-works")!;
const steps = how.sections.find((s) => s.id === "steps")!.steps!;
const t = (s: string) => brandText(s, APP);

test("the captions are the registry's eight steps, unchanged, in the same list", () => {
  assert.equal(steps.length, 8);
  const html = render("/how-it-works");
  const section = element(
    html,
    /<section class="mk-section mk-walk-section" id="steps"/,
  );
  assert.match(section, /<h2 id="steps-h">Eight steps, start to finish<\/h2>/);
  const list = element(section, /<ol class="mk-steps">/);
  const items = [...list.matchAll(/<li data-step="(\d)">([\s\S]*?)<\/li>/g)];
  assert.equal(items.length, 8);
  items.forEach(([, n, li], i) => {
    assert.equal(Number(n), i + 1);
    assert.match(
      li,
      new RegExp(
        `<span class="mk-step-number" id="steps-n${i + 1}" aria-hidden="true">0${i + 1}</span>`,
      ),
    );
    assert.equal(
      decode(li.match(/<h3 id="steps-t\d">([\s\S]*?)<\/h3>/)![1]),
      t(steps[i].title),
    );
    // The first paragraph is the registry body, verbatim.
    assert.equal(decode(li.match(/<p>([\s\S]*?)<\/p>/)![1]), t(steps[i].body));
  });
  // The player's chapter names are the same titles, in the same order.
  const compact = render("/");
  const band = element(
    compact,
    /<section class="mk-home-band mk-home-paper mk-walk-band"/,
  );
  assert.match(band, /<p class="mk-walk-caption">Claim your address<\/p>/);
  const labels = [
    ...band.matchAll(/class="mk-walk-seg"[^>]*aria-label="([^"]+)"/g),
  ].map((m) => m[1]);
  assert.deepEqual(
    labels,
    steps.map((s) => t(s.title)),
  );
  const named = [
    ...section.matchAll(/class="mk-walk-seg"[^>]*aria-labelledby="([^"]+)"/g),
  ].map((m) => m[1]);
  assert.deepEqual(
    named,
    steps.map((_, i) => `steps-n${i + 1} steps-t${i + 1}`),
  );
  assert.equal(JOURNEY_TIMING.length, 8);
});

test("the steps stay real HTML and the HowTo JSON-LD is unchanged", () => {
  const html = render("/how-it-works");
  const graph = JSON.parse(
    jsonLdScript(marketingJsonLd(how, { origin: ORIGIN, appName: APP })),
  )["@graph"];
  const howTo = graph.find((n: any) => n["@type"] === "HowTo");
  assert.equal(howTo.step.length, 8);
  howTo.step.forEach((step: any, i: number) => {
    assert.equal(step.name, t(steps[i].title));
    assert.equal(step.text, t(steps[i].body));
    assert.ok(decode(html).includes(step.text), step.name);
  });
  // The JSON-LD the page embeds is the registry's, not the player's.
  const embedded = html.match(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
  )![1];
  assert.equal(
    embedded,
    jsonLdScript(marketingJsonLd(how, { origin: ORIGIN, appName: APP })),
  );
  // Everything after the steps renders as before.
  const closed = render("/how-it-works", with_({ payments: false }));
  const tail = (h: string) => h.slice(h.indexOf('id="lanes"'));
  assert.equal(tail(html), tail(closed));
  // The mocks are decorative and hidden from assistive technology; the
  // controls and the steps are not.
  const stage = element(html, /<div class="mk-walk-stage"/);
  assert.match(stage, /^<div class="mk-walk-stage" aria-hidden="true">/);
  assert.doesNotMatch(stage, /<h[1-6][\s>]|<a |<button|tabindex/);
  assert.match(
    html,
    /<button type="button" class="mk-walk-btn mk-walk-play" aria-label="Play">/,
  );
  assert.match(
    html,
    /<div class="mk-walk-steps" role="region" tabindex="0" aria-labelledby="steps-h">/,
  );
  assert.match(html, /<p class="sr-only" aria-live="polite"><\/p>/);
});

test("each subscriber line is registry text, looked up, never copied", () => {
  const html = decode(render("/how-it-works"));
  const lines = SUBSCRIBER_LINES.map(registryLine);
  assert.equal(lines.length, 8);
  assert.deepEqual(lines, [
    "Your brand: name, colours, logo and an installable home-screen icon.",
    "If your published teaching covers it, the labelled digital coach replies from your rules.",
    "Today’s session first, then the week ahead.",
    "Your price and terms before paying.",
    "Followers open your branded page, choose your offer and pay in AED.",
    "Today’s session and the days ahead, with dates.",
    "A note when their trainer is reviewing a change.",
    "Subscribers pay you monthly or upfront, by card, in AED.",
  ]);
  for (const line of lines)
    assert.ok(html.includes("Your subscriber: " + line), line);
  // "Your subscriber" is the existing column header on the same page.
  assert.ok(
    how.sections
      .find((s) => s.id === "lanes")!
      .table!.columns.includes("Your subscriber"),
  );
  assert.throws(
    () => registryLine({ path: "/pricing", section: "how", bullet: 9 }),
    /Unresolved/,
  );
  assert.throws(
    () => registryLine({ path: "/", faq: "Not a question?", sentence: 0 }),
    /Unresolved/,
  );
});

test("the launch gate: no player until a coach can launch, and then the base steps", () => {
  assert.equal(journeyAvailable(ready), true);
  const closedStates: Array<[string, PublicPlatform]> = [
    ["registration closed", with_({}, false)],
    ["model off", with_({ model: false })],
    ["payments off", with_({ payments: false })],
    ["payouts off", with_({ payouts: false })],
  ];
  const base = renderToStaticMarkup(
    createElement(Section, {
      section: how.sections.find((s) => s.id === "steps")!,
      t,
    }),
  );
  for (const [label, platform] of closedStates) {
    assert.equal(journeyAvailable(platform), false, label);
    const page = render("/how-it-works", platform);
    const home = render("/", platform);
    assert.doesNotMatch(page + home, /mk-walk|Your subscriber:/, label);
    // /how-it-works renders its steps section exactly as before.
    assert.ok(page.includes(`<div>${base}</div>`), label);
  }
  // Open: both placements render.
  assert.match(render("/how-it-works"), /class="mk-walk mk-walk-full"/);
  assert.match(render("/"), /class="mk-walk mk-walk-compact"/);
});

test("the home band adds no heading, no sentence and no words in its stage", () => {
  const html = render("/");
  const band = element(
    html,
    /<section class="mk-home-band mk-home-paper mk-walk-band"/,
  );
  // Directly after the hero, labelled by the existing section heading.
  const hero = element(html, /<section class="mk-hero"/);
  assert.equal(html.indexOf(band), html.indexOf(hero) + hero.length);
  assert.match(band, /aria-labelledby="mk-walk-label"/);
  assert.match(
    band,
    /<p class="small-label mk-walk-label" id="mk-walk-label">Eight steps, start to finish<\/p>/,
  );
  assert.doesNotMatch(band, /<h[1-6][\s>]/);
  assert.equal(decode(element(band, /<div class="mk-walk-stage"/)), "");
  assert.equal(
    decode(band),
    "Eight steps, start to finish Claim your address See how it works",
  );
  assert.match(band, /href="\/how-it-works#steps"/);
  // Visible words the band adds (the label, one title, the link).
  assert.ok(decode(band).split(" ").length <= 13);
});

// Words the mocks may use that are not elsewhere on the marketing site.
const NEW_WORDS = new Set(["evaluate", "ls", "layla-strength"]);
// Controls' accessible names that are not elsewhere either.
const NEW_NAMES = new Set(["replay", "previous"]);
test("the mocks: no AI costs, fees, model names or amounts; only the listed new words", async () => {
  const html = render("/how-it-works", with_({ nutrition: true, voice: true }));
  const stage = decode(element(html, /<div class="mk-walk-stage"/));
  const lines = SUBSCRIBER_LINES.map(registryLine).join(" ");
  const band = decode(
    element(
      render("/"),
      /<section class="mk-home-band mk-home-paper mk-walk-band"/,
    ),
  );
  for (const [where, text] of [
    ["stage", stage],
    ["subscriber lines", lines],
    ["home band", band],
  ]) {
    assert.doesNotMatch(
      text,
      /\bAI (usage|costs?)\b|at cost|\bfees?\b|\bcosts?\b|\bmodels?\b/i,
      where,
    );
    assert.doesNotMatch(
      text,
      /Claude|Anthropic|GPT|OpenAI|Gemini|Llama|Mistral/i,
      where,
    );
    assert.doesNotMatch(text, /\bAED\s*\d|\d\s*AED|%|\$|€|£|\bUSD\b/, where);
    assert.doesNotMatch(text, /Available soon/, where);
    assert.doesNotMatch(
      text,
      /\d[\d,]* (subscribers|members|followers|trainers|coaches)\b/i,
      where,
    );
  }
  // Every caption of the section, including the registry bodies.
  const section = decode(
    element(html, /<section class="mk-section mk-walk-section"/),
  );
  assert.doesNotMatch(section, /\bAI (usage|costs?)\b|fee for AI|AI fee/i);
  // The statement shows three rows (placeholders, no total, net or before
  // row); chapter 1's phone has no Join; chapter 5's follower pays.
  const scene = (n: number) =>
    [...html.matchAll(new RegExp(`<div class="w-s" data-s="${n}">`, "g"))].map(
      (m) => element(html.slice(m.index), /<div class="w-s"/),
    );
  const [coach8] = scene(8);
  assert.equal(
    decode(coach8),
    "Gross subscriptions Commission by band Payment processing Paid monthly to your UAE IBAN",
  );
  assert.doesNotMatch(decode(scene(1).join(" ")), /\bJoin\b/);
  assert.match(decode(scene(5)[1]), /\bJoin\b.*\bCard\b.*\bPay\b/);
  // Chapter 4's optional extras only when they are available now.
  assert.match(
    decode(scene(4)[0]),
    /Nutrition tier Optional tier Voice add-on Add-on/,
  );
  const off = render("/how-it-works");
  assert.doesNotMatch(
    decode(element(off, /<div class="mk-walk-stage"/)),
    /Nutrition tier|Voice add-on/,
  );
  assert.match(stage, /^Illustration with sample data /);
  // New words: checked against the marketing site's own sources.
  const sources = await Promise.all(
    [
      "../packages/contracts/src/marketing-content.ts",
      "../packages/contracts/src/marketing.ts",
      "../packages/contracts/src/brand.ts",
      "../apps/web/components/marketing/site.tsx",
      "../apps/web/components/marketing/showcase.tsx",
      "../apps/web/components/marketing/hero-flow.tsx",
      "../apps/web/components/marketing/islands.tsx",
      "../apps/web/components/marketing/frame.tsx",
    ].map((f) => readFile(new URL(f, import.meta.url), "utf8")),
  );
  const known = sources.join("\n").toLowerCase();
  const address = ORIGIN.replace("https://", "") + "/coach/layla-strength";
  const words = (text: string) =>
    text
      .replaceAll(address, " layla-strength ")
      .toLowerCase()
      .split(/[^a-z’'-]+/)
      .map((w) => w.replace(/^[’'-]+|[’'-]+$/g, ""))
      .filter((w) => w && !/^\d/.test(w));
  const isKnown = (w: string) =>
    new RegExp(`(^|[^a-z’'])${w.replace(/[-]/g, "\\-")}($|[^a-z’'])`).test(
      known,
    );
  const fresh = [...new Set(words(stage))].filter((w) => !isKnown(w));
  assert.deepEqual(
    fresh.sort(),
    [...NEW_WORDS].sort(),
    "new visible words in the mocks",
  );
  const names = ["Pause", "Play", "Replay", "Previous step", "Next step"];
  const freshNames = [...new Set(names.flatMap(words))].filter(
    (w) => !isKnown(w),
  );
  assert.deepEqual(
    freshNames.sort(),
    [...NEW_NAMES].sort(),
    "new words in the controls' names",
  );
});

test("the phone mock keeps the demo coach; the address comes from the platform", () => {
  const custom = {
    ...ready,
    coachAddressTemplate: "https://{slug}.coach.example",
  };
  const html = render("/how-it-works", custom);
  const stage = decode(element(html, /<div class="mk-walk-stage"/));
  assert.ok(stage.includes("layla-strength.coach.example"));
  assert.doesNotMatch(stage, /https?:\/\//);
  assert.match(stage, /Layla Strength/);
});

// ---------------------------------------------------------------------------
// Motion hygiene for the journey's stylesheet and island.
const cssUrl = new URL(
  "../apps/web/app/marketing-journey.css",
  import.meta.url,
);
const islandUrl = new URL(
  "../apps/web/components/marketing/journey-player.tsx",
  import.meta.url,
);
/** Top-level rules with their at-rule context: [context, selector, body]. */
function rules(css: string) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Array<{ context: string; selector: string; body: string }> = [];
  const walk = (src: string, context: string) => {
    let i = 0;
    while (i < src.length) {
      const open = src.indexOf("{", i);
      if (open < 0) break;
      const head = src.slice(i, open).trim();
      let depth = 1,
        j = open + 1;
      for (; j < src.length && depth; j++) {
        if (src[j] === "{") depth++;
        if (src[j] === "}") depth--;
      }
      const body = src.slice(open + 1, j - 1);
      if (head.startsWith("@media") || head.startsWith("@supports"))
        walk(body, (context + " " + head).trim());
      else out.push({ context, selector: head, body });
      i = j;
    }
  };
  walk(text, "");
  return out;
}
/** Splits on commas outside parentheses. */
function splitTop(value: string) {
  const out: string[] = [];
  let depth = 0,
    current = "";
  for (const ch of value) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(current.trim());
      current = "";
    } else current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}
const decls = (body: string) =>
  body
    .split(";")
    .map((d) => d.trim())
    .filter((d) => d.includes(":") && !d.includes("{"))
    .map(
      (d) =>
        [
          d.slice(0, d.indexOf(":")).trim(),
          d.slice(d.indexOf(":") + 1).trim(),
        ] as const,
    );

test("motion tokens: the brief's values on the marketing roots", async () => {
  const css = await readFile(cssUrl, "utf8");
  const root = rules(css).find(
    (r) => r.selector.replace(/\s+/g, " ") === ".mk, .mk-header, .mk-footer",
  )!;
  assert.deepEqual(Object.fromEntries(decls(root.body)), {
    "--mk-dur-press": "80ms",
    "--mk-dur-fast": "140ms",
    "--mk-dur-base": "200ms",
    "--mk-dur-slow": "280ms",
    "--mk-dur-emphasis": "420ms",
    "--mk-ease-out": "cubic-bezier(0.2, 0, 0, 1)",
    "--mk-ease-in": "cubic-bezier(0.4, 0, 1, 1)",
    "--mk-ease-in-out": "cubic-bezier(0.4, 0, 0.2, 1)",
    "--mk-ease-spring": "cubic-bezier(0.34, 1.4, 0.64, 1)",
  });
});

test("motion hygiene: transform and opacity only, tokens, hover media, reduced motion, nothing infinite", async () => {
  const css = await readFile(cssUrl, "utf8");
  const all = rules(css);
  const ALLOWED_KEYFRAME = new Set([
    "opacity",
    "transform",
    "translate",
    "scale",
    "rotate",
    "stroke-dashoffset",
  ]);
  for (const r of all.filter((r) => /^(from|to|\d+%)/.test(r.selector)))
    for (const [prop] of decls(r.body))
      assert.ok(ALLOWED_KEYFRAME.has(prop), `keyframe animates ${prop}`);
  // Keyframes live inside @keyframes blocks, which rules() reads as rules
  // named "@keyframes x"; read their bodies too.
  for (const block of css.matchAll(/@keyframes\s+([\w-]+)\s*\{([\s\S]*?)\n\}/g))
    for (const frame of block[2].matchAll(/\{([^{}]*)\}/g))
      for (const [prop] of decls(frame[1]))
        assert.ok(ALLOWED_KEYFRAME.has(prop), `${block[1]} animates ${prop}`);
  const TOKEN_DURATION =
    /^(?:var\(--mk-dur-[a-z]+\)|calc\(var\(--mk-dur-[a-z]+\) \+ var\(--mk-dur-[a-z]+\)\)|0s)$/;
  const TOKEN_EASING = /^var\(--mk-ease-(?:out|in|in-out|spring)\)$/;
  for (const r of all) {
    for (const [prop, value] of decls(r.body)) {
      if (prop === "transition") {
        for (const part of splitTop(value)) {
          if (part.startsWith("none")) continue;
          const [name, duration, easing] = part.split(/\s+/);
          assert.ok(
            [
              "opacity",
              "transform",
              "translate",
              "scale",
              "content-visibility",
              "grid-template-rows",
            ].includes(name),
            `${r.selector}: transition of ${name}`,
          );
          assert.match(duration, TOKEN_DURATION, `${r.selector}: ${part}`);
          if (duration !== "0s" && easing !== "allow-discrete")
            assert.match(easing, TOKEN_EASING, `${r.selector}: ${part}`);
        }
      }
      if (prop === "animation") {
        for (const part of splitTop(value)) {
          assert.doesNotMatch(part, /infinite/, r.selector);
          if (part.startsWith("none")) continue;
          const tokens = part.match(
            /(?:[\w-]+\((?:[^()]|\([^()]*\))*\)|[^\s]+)/g,
          )!;
          const [, duration, easing] = tokens;
          assert.match(duration, TOKEN_DURATION, `${r.selector}: ${part}`);
          assert.match(easing, TOKEN_EASING, `${r.selector}: ${part}`);
        }
      }
      if (prop === "animation-iteration-count")
        assert.notEqual(value, "infinite");
      if (prop.startsWith("transition") && prop !== "transition")
        assert.fail(`${r.selector}: use the transition shorthand`);
    }
    if (/:hover/.test(r.selector))
      assert.match(r.context, /\(hover: hover\)/, r.selector);
    // The spring is for success states only: the pop beat.
    if (/--mk-ease-spring/.test(r.body) && !r.selector.startsWith(".mk,"))
      assert.equal(
        r.selector,
        '[data-b="pop"]',
        "spring outside the success pop",
      );
  }
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(css, /infinite/);
  // The pop (spring) is used only on success states in the mocks: the
  // success badges, the ticks and Live.
  const source = await readFile(
    new URL("../apps/web/components/marketing/journey.tsx", import.meta.url),
    "utf8",
  );
  const pops = [...source.matchAll(/b\("pop"/g)].length;
  const badges = [
    ...source.matchAll(/tone="g" beat=\{b\("pop"[^}]*\}>\s*([A-Z][\w ]+)/g),
  ].map((m) => m[1].trim());
  assert.deepEqual([...new Set(badges)].sort(), [
    "Applied automatically",
    "Approved",
    "Confirmed",
    "Paid",
    "Passed",
    "Rescheduled automatically",
    "Reserved",
  ]);
  const others = [
    ...source.matchAll(/className="(w-tick|w-live)" \{\.\.\.b\("pop"/g),
  ].map((m) => m[1]);
  assert.deepEqual(others.sort(), ["w-live", "w-tick"]);
  assert.equal(
    pops,
    badges.length + others.length,
    "a pop outside the success states",
  );
});

test("the island imports only React and no dependency was added", async () => {
  const island = await readFile(islandUrl, "utf8");
  assert.match(island, /^"use client";/);
  const imports = [...island.matchAll(/^import[\s\S]*?from "([^"]+)";/gm)].map(
    (m) => m[1],
  );
  assert.deepEqual(imports, ["react"]);
  const root = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const web = JSON.parse(
    await readFile(
      new URL("../apps/web/package.json", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(Object.keys(root.dependencies).sort(), ["tsx", "zod"]);
  assert.deepEqual(Object.keys(web.dependencies).sort(), [
    "@trainer/domain",
    "lucide-react",
    "next",
    "react",
    "react-dom",
  ]);
  // The stylesheet is imported next to the marketing stylesheet.
  const layout = await readFile(
    new URL("../apps/web/app/layout.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    layout,
    /import "\.\/marketing\.css";\nimport "\.\/marketing-journey\.css";/,
  );
});
