// Optional analytics consent on subscriber and public surfaces
// (docs/features/analytics-consent.md): before an answer a slim bar that
// reserves its own space above the member app's bottom chrome; after any
// answer (allow, decline or close) nothing floats on any page and the
// answer survives a reload; the answer changes only from a public footer
// link or Profile > Privacy.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ANALYTICS_CHOICE_KEY,
  AnalyticsSetting,
  AcquisitionConsent,
  CONSENT_BAR_TEXT,
  ConsentBar,
  ConsentSheet,
  asksForAnalytics,
  choiceFor,
  readAnalyticsChoice,
  saveAnalyticsChoice,
  showsConsentBar,
} from "../apps/web/components/acquisition.tsx";

const web = (path: string) =>
  readFile(new URL("../apps/web/" + path, import.meta.url), "utf8");
function memoryStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}
/** The body of the first rule whose selector list is exactly `selector`. */
function rule(css: string, selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)\\s*${escaped} \\{([^}]*)\\}`).exec(css);
  assert.ok(match, `the ${selector} rule`);
  return match[1];
}

test("any answer (allow, decline or close) is kept and ends the first prompt", () => {
  const store = memoryStore();
  assert.equal(readAnalyticsChoice(store), null);
  assert.equal(asksForAnalytics({ granted: false }, null), true);
  for (const answer of ["allow", "decline", "dismiss"] as const) {
    const saved = choiceFor(answer);
    saveAnalyticsChoice(saved, store);
    assert.equal(store.data.get(ANALYTICS_CHOICE_KEY), saved);
    assert.equal(
      readAnalyticsChoice(store),
      saved,
      "the answer survives a reload",
    );
    assert.equal(asksForAnalytics({ granted: false }, saved), false);
  }
  assert.deepEqual(
    ["allow", "decline", "dismiss"].map((a) => choiceFor(a as any)),
    ["allowed", "declined", "dismissed"],
  );
  // A saved server consent never prompts; no readback yet never prompts.
  assert.equal(asksForAnalytics({ granted: true }, null), false);
  assert.equal(asksForAnalytics(null, null), false);
  // An unknown stored value is not an answer.
  assert.equal(
    readAnalyticsChoice(memoryStore({ [ANALYTICS_CHOICE_KEY]: "maybe" })),
    null,
  );
  // A visitor who declined before this change keeps their answer.
  assert.equal(
    readAnalyticsChoice(memoryStore({ [ANALYTICS_CHOICE_KEY]: "declined" })),
    "declined",
  );
});

test("blocked browser storage still keeps the answer for the visit", () => {
  const blocked = {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("SecurityError");
    },
  };
  saveAnalyticsChoice("dismissed", blocked);
  assert.equal(readAnalyticsChoice(blocked), "dismissed");
  assert.equal(readAnalyticsChoice(null), "dismissed");
  // A later successful save replaces the in-visit answer.
  const store = memoryStore();
  saveAnalyticsChoice("declined", store);
  assert.equal(readAnalyticsChoice(memoryStore()), null);
});

test("the bar shows only before an answer, waits for a scroll on marketing pages and hides behind the sheet", () => {
  const base = {
    permission: { granted: false },
    choice: null,
    marketing: false,
    scrolled: false,
    sheetOpen: false,
  } as const;
  assert.equal(
    showsConsentBar(base),
    true,
    "coach website, sign-in and member app: at once",
  );
  assert.equal(
    showsConsentBar({ ...base, marketing: true }),
    false,
    "marketing: not on the first screen",
  );
  assert.equal(
    showsConsentBar({ ...base, marketing: true, scrolled: true }),
    true,
  );
  assert.equal(showsConsentBar({ ...base, sheetOpen: true }), false);
  for (const choice of ["allowed", "declined", "dismissed"] as const)
    assert.equal(
      showsConsentBar({ ...base, choice }),
      false,
      `nothing after ${choice}`,
    );
  assert.equal(
    showsConsentBar({ ...base, permission: { granted: true } }),
    false,
  );
});

test("the bar: two equal 48 px choices, a real Close button and a real privacy link", () => {
  const html = renderToStaticMarkup(
    createElement(ConsentBar, { audience: "people", onChoose: () => {} }),
  );
  assert.match(
    html,
    /<aside class="acquisition-consent consent-bar" data-audience="people" aria-label="Optional analytics">/,
  );
  // The spacer after the page reserves the bar's height.
  assert.match(html, /^<div class="consent-bar-space" aria-hidden="true"/);
  const choices = [
    ...html.matchAll(
      /<button type="button" class="([^"]+)"[^>]*>([^<]+)<\/button>/g,
    ),
  ];
  assert.deepEqual(
    choices.map((m) => [m[1], m[2]]),
    [
      ["consent-choice", "Allow analytics"],
      ["consent-choice", "No thanks"],
    ],
    "allow and decline share one style",
  );
  assert.match(
    html,
    /<button type="button" class="consent-close" aria-label="Close">/,
  );
  assert.match(
    html,
    /<a class="consent-link" href="\/privacy">Privacy policy<\/a>/,
  );
  assert.ok(html.includes(CONSENT_BAR_TEXT.people));
  assert.doesNotMatch(html, /Analytics preferences|Details|text-button/);
  // Plain subscriber copy: no developer words.
  for (const text of Object.values(CONSENT_BAR_TEXT))
    assert.doesNotMatch(text, /\b(utm|cookie|ID|tracking pixel|event)\b/i);
  // The marketing sentence is unchanged.
  const marketing = renderToStaticMarkup(
    createElement(ConsentBar, { audience: "trainers", onChoose: () => {} }),
  );
  assert.ok(
    marketing.includes(
      "Optional analytics show us which links bring trainers here. Health and coaching data are never included.",
    ),
  );
});

test("the preferences sheet: a labelled modal dialog with equal choices, a 48 px Close and the readback", () => {
  const props = { onChoose: async () => true, onClose: () => {} };
  const off = renderToStaticMarkup(
    createElement(ConsentSheet, { ...props, permission: { granted: false } }),
  );
  assert.match(
    off,
    /^<dialog class="acquisition-consent consent-sheet" aria-labelledby="consent-sheet-title">/,
  );
  assert.match(
    off,
    /<h2 id="consent-sheet-title">Optional site analytics<\/h2>/,
  );
  assert.match(
    off,
    /<button type="button" class="consent-close" aria-label="Close">/,
  );
  assert.match(
    off,
    /<a class="consent-link" href="\/privacy">Read our privacy policy<\/a>/,
  );
  assert.match(off, /Analytics are off for this browser\./);
  assert.deepEqual(
    [...off.matchAll(/class="consent-choice"[^>]*>([^<]+)</g)].map((m) => m[1]),
    ["Allow optional analytics", "Continue without analytics"],
  );
  assert.doesNotMatch(off, /text-button|>Close</);
  const on = renderToStaticMarkup(
    createElement(ConsentSheet, {
      ...props,
      permission: {
        granted: true,
        firstTouch: { source: "instagram", campaign: "spring" },
        lastTouch: { source: "newsletter", campaign: "second" },
      },
    }),
  );
  assert.match(
    on,
    />First source: instagram\. Last tagged source: newsletter\.</,
  );
  assert.deepEqual(
    [...on.matchAll(/class="consent-choice"[^>]*>([^<]+)</g)].map((m) => m[1]),
    ["Withdraw analytics consent"],
  );
});

test("nothing renders before the readback, and Profile > Privacy waits for it too", () => {
  assert.equal(
    renderToStaticMarkup(
      createElement(AcquisitionConsent, { marketingPaths: ["/"] }),
    ),
    "",
  );
  const setting = renderToStaticMarkup(createElement(AnalyticsSetting));
  assert.match(setting, /<h3>Optional site analytics<\/h3>/);
  assert.match(setting, /role="status">Checking your choice…</);
  assert.match(
    setting,
    /<button type="button" class="button secondary analytics-setting-action" disabled="">Turn on analytics<\/button>/,
  );
  assert.match(setting, /href="\/privacy"/);
});

test("no floating analytics control remains in the component", async () => {
  const source = await web("components/acquisition.tsx");
  // The old fixed "Analytics preferences" button and its inline position.
  assert.doesNotMatch(source, /position: "fixed"/);
  assert.doesNotMatch(source, />\s*Analytics preferences\s*</);
  assert.doesNotMatch(source, /footerEntry/);
  // Close ends the prompt like any other answer.
  assert.match(source, /onClick=\{\(\) => onChoose\("dismiss"\)\}/);
});

test("the answer changes only from public footer links and Profile > Privacy", async () => {
  // Public pages share one subscriber footer (components/subscriber-footer.tsx)
  // whose "Analytics preferences" button opens the preferences sheet.
  const footer = await web("components/subscriber-footer.tsx");
  assert.match(
    footer,
    /<footer className="subscriber-footer">[\s\S]*\{analytics && \([\s\S]*data-analytics-preferences=""[\s\S]*<\/footer>/,
  );
  // The coach website offers it except in the trainer's private preview.
  const coachSite = await web("components/coach-site.tsx");
  assert.match(coachSite, /<SubscriberFooter[\s\S]*?analytics=\{!preview\}/);
  // Sign-in, joining and legal pages (the platform's and a coach's own
  // address) use the same footer with the entry on.
  const publicPages = await web("components/public-pages.tsx");
  assert.match(publicPages, /<SubscriberFooter\s/);
  assert.doesNotMatch(publicPages, /analytics=\{false\}/);
  const workspace = await web("components/workspace.tsx");
  // The member app's settings (MemberSettings, reached from More > Privacy
  // and your data at /app/profile#privacy): the privacy card holds the
  // analytics switch; its title comes from the profile catalog
  // (docs/features/arabic.md).
  assert.match(
    workspace,
    /<Card id="privacy">\s*<h2>\{t\("yourData"\)\}<\/h2>[\s\S]*?<AnalyticsSetting \/>\s*<\/Card>/,
  );
  const profile = await web("lib/i18n/messages/profile.ts");
  assert.match(profile, /yourData: "Your data"/);
  // The member app's own footers offer no analytics control: the workspace
  // footer and the member shell's laptop footer (components/member-shell.tsx).
  const memberFooter =
    /<footer className="workspace-footer">([\s\S]*?)<\/footer>/.exec(workspace);
  assert.ok(memberFooter);
  assert.doesNotMatch(memberFooter[1], /analytics/i);
  const shell = await web("components/member-shell.tsx");
  const shellFooter =
    /<footer className="member-footer">([\s\S]*?)<\/footer>/.exec(shell);
  assert.ok(shellFooter);
  assert.doesNotMatch(shellFooter[1], /analytics/i);
  // The marketing footer keeps its entry (marketing text is unchanged).
  const frame = await web("components/marketing/frame.tsx");
  assert.match(
    frame,
    /data-analytics-preferences="">\s*Analytics preferences\s*</,
  );
});

test("phone-first styles: the bar sits above the member app's bottom chrome and the safe area", async () => {
  const css = await web("app/analytics-consent.css");
  const layout = await web("app/layout.tsx");
  assert.match(layout, /import "\.\/analytics-consent\.css";/);
  // Mobile first: wider screens are added with min-width queries only.
  assert.doesNotMatch(css, /max-width:\s*\d/);
  assert.match(css, /@media \(min-width: 760px\)/);
  const bar = rule(css, ".consent-bar");
  assert.match(bar, /position: fixed;/);
  assert.match(bar, /inset-block-end: var\(--member-bottom-inset, 0px\);/);
  assert.match(
    bar,
    /env\(safe-area-inset-bottom, 0px\) - var\(--member-bottom-inset, 0px\)/,
  );
  assert.match(rule(css, ".consent-choice"), /min-block-size: 48px;/);
  const close = rule(css, ".consent-close");
  assert.match(close, /inline-size: 48px;/);
  assert.match(close, /block-size: 48px;/);
  assert.match(rule(css, ".consent-link"), /text-decoration: underline;/);
  // Phones get a bottom sheet; its motion respects reduced motion.
  const sheet = rule(css, ".consent-sheet");
  assert.match(sheet, /inset-block: auto 0;/);
  assert.match(sheet, /overscroll-behavior: contain;/);
  // Its movement (and the bar's) lives in app/motion.css, inside the
  // no-preference query (tests/motion-css.test.ts).
  assert.doesNotMatch(css, /(^|[;{\s])animation(-name)?\s*:/m);
  assert.match(await web("app/motion.css"), /\.consent-sheet\[open\] \{\s*animation:/);
  // The old marketing-only bar rules are gone.
  assert.doesNotMatch(await web("app/marketing.css"), /\.consent-bar/);
});
