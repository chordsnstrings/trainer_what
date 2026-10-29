# Phase 1 plan review: required changes

I changed no repository files. Every claim below was checked against the code, and several were measured. The scripts and evidence are in `/tmp/claude-0/-home-user-trainer-what/14381359-c138-56f9-a25b-830f6a2f39f9/scratchpad/review/`.

## P0: as written, this breaks the build or every marketing test

**P0-1. Engine CSS reaches the server render.**
- **The conflict.** §1.1 has `brain/render.ts` import the same engine modules on the server. The same modules also import their runtime CSS (§1.1 table, §1.4).
- **Tests crash.** Under tsx, importing a module that imports `.css` throws `SyntaxError: Unexpected token '.'` (verified in `cssimp/`). The import chain is `pages/home.tsx` → `brain/showcase.tsx` → `render.ts` → `field.js`. Every suite that renders `MarketingSite` would fail at import time: marketing-site, brand, marketing-journey, marketing-frontier and all 7 new suites.
- **The "lazy" CSS loads on every page.** A Next 16.3.6 Turbopack build (`tp/`) shows that CSS imported by a module a Server Component imports is emitted as `<link rel="stylesheet" data-precedence="next">` in the first HTML. CSS imported by a client `import()` stays in a separate chunk. Everything goes through one catch-all route (`app/[[...path]]/page.tsx`), so the runtime sheets would load on every route, the member app included.
- **Required change.**
  - Split each kind in two:
    - `engine/<kind>.render.js`: pure; holds `renderStatic` and `COPY`; imports only core, decide, ui, data and JSON; no CSS, no DOM.
    - `engine/<kind>.js`: the client runtime; imports its own `.css` and the matching render module.
  - `render.ts`, `roster.tsx` and the tests import only `*.render.js`. `LOADERS` imports only the runtime modules.
  - Add a test that walks the static imports from `site.tsx` and `render.ts` and fails on any `.css` file or runtime module.
  - Limit the "no side effects under Node" test to the render, core, decide, ui and data modules.

**P0-2. "WP1's first commit copies the engine core verbatim" fails `next build`.**
- Verified with Turbopack 16.3.6: the build fails with 2 errors.
  - `Module not found: Can't resolve 'traces.client.json'`, from `new URL("traces.client.json", import.meta.url)` at brain-core.js:58.
  - `Can't resolve <dynamic>`, from `prefetch(url)` → `import(url)` at brain-core.js:310.
- The core change list (a)–(h) fixes `load()` but omits `prefetch`. The same pattern appears at a-field.js:199 and :1227.
- **Required change.**
  - The first commit already removes the fetch and every `new URL(…, import.meta.url)`.
  - `prefetch` takes a loader instead: `prefetch(() => import("./receipt.js"), el, ms)`.
  - Add a grep test that fails on any non-literal `import(` in the engine.

## P1: tests or gates that will go red and are not in the plan

**P1-1. marketing-frontier.test.ts fails on the payments line.**
- `:116` asserts that every `AVAILABILITY_LINES` entry has `when === "frontier"`.
- `:66` asserts `marketingPageFor(page, availability(false)) === page`. The fixture at `:26-37` has `payments: true, payouts: true`.
- The planned payments-on line for `PAY_TODAY_FAQ` (§1.5) fails both. §4.2 says this file stays unchanged, and it is in WP0's acceptance.
- **Required change.** WP0 edits the test: check identity only against frontier lines (or turn the other flags off), allow a set of `when` values, and keep the copy limits for every line.

**P1-2. Moving `Section` breaks marketing-journey.test.ts.**
- `tests/marketing-journey.test.ts:21-24` imports `{ MarketingSite, Section }` from `site.tsx`. A missing named export fails the whole file (10 tests).
- `marketing-site.test.ts:61` also imports `bandPills` from `site.tsx`.
- **Required change.** `site.tsx` re-exports `Section`, `bandPills` and `availabilityChip` until WP7a updates the imports.

**P1-3. Empty stylesheets fail the motion-switch test.**
- The sheet list at `marketing-motion-sitewide.test.ts:493` is checked at `:502` with `assert.ok(reduceRules.length, …)`: every listed sheet must contain at least one reduced-motion rule.
- WP0 adds the page sheets while they are empty, so the test goes red.
- **Required change.** Only check that reduced-motion rules which do exist carry the exclusion, or add each sheet when it gains motion.

**P1-4. /demo word count.**
- Measured today: 380 registry words (introduction 41 + `scenarios` 206 + FAQs 133).
- Removing `scenarios` leaves 174, or 184 with the 51-word introduction.
- Under the copy caps, `next` plus `moments` can add at most about 260 words, so 350 is reachable only if both sections are written near their caps.
- WP0 owns the registry and runs `:396-405`, so WP0 (not WP5) must write and measure this copy.

**P1-5. Trace brand token and vocabulary scan.**
- Only 3 "trainsyou" literals are copy: `rule.source` in `traces[1]`, `[10]` and `[11]`.
- The 4th is `format: "trainsyou-brain-trace@2"`, which verify.mts:23 asserts. Do not tokenise it, and exempt it from the no-brand test.
- The t2 `basis.note` contains "floor" twice; reword the whole note.
- `decide: "floor"` is an enum present in the client copy. The vocabulary scan must cover visible strings only.

**P1-6. Robot gating is contradictory and drives CI.**
- WP1 requires the head script and `mount.tsx` to run identical robot tests.
- But §4.3 check 12 expects every link-click arrival to reach `data-sc="on"`. The `?scenes=on` override is lost on client navigation (scenes-head.ts:20 does not persist it).
- WP7a's playground smoke in `browser-check.mjs` (webdriver, no query) also waits for `data-sc="on"`.
- **Recommended.**
  - Never mount the engine for webdriver or bots unless a distinct `?sc=on` is present, and persist that in sessionStorage for the tab.
  - The call, browser and completion checks then run today's static path, so the engine adds no CPU during the call check. Crawlers index the server frame.
  - Use `?sc=on` in the showcase check and the WP7a smoke.
  - Lighthouse runs will exclude engine cost, so the showcase check is where budgets are measured.

**P1-7. LCP and CLS judged in CI contradict measurements.**
- I measured the approved prototypes in the headless shell, which is what CI installs (`lcp2.cjs`, `cls.cjs`).
- **LCP.** The H1 is the LCP element everywhere except B's /pricing at 390 px, where it is `p.lede`.
- **CLS, as measured:**

  | Page and width | CLS | Source |
  |---|---|---|
  | A home, 390 | 0.0016 at load, then +0.0027 at 4.8 s, recurring while the field plays | Streamed AI text grows a line (`span.mc-cr`, 12→24 px) |
  | A /demo, 1440 | 0.0020 | 19 px shift when the playground mounts |
  | C /trainer-brain, 1440 | 0.018 | C's page chrome |
  | B /pricing, 390 | 0.0075 | Mostly the prototype's dev buttons, plus one shift from text |

- **Required change.**
  - The LCP check accepts "H1 or lede"; SHOWCASE_DESIGN.md §1.6 says both stay the LCP.
  - WP2 reserves two lines for streamed text.
  - WP6 gets a CLS acceptance.
  - CLS is report-only until it passes 3 of 3 PR CI runs.

**P1-8. Kamran's button covers a field control on phones.**
- On A's home at 390×844, scroll 0, the field spans y 213–826. Its "How we count" control at (263, 761) intersects the floating button (52 px at 16 px insets: x 322–374, y 776–828; marketing.css:2997-3005).
- Check 8 will fail with the layout as designed. WP2 and WP4 need an explicit layout fix.

**P1-9. The import guard rejects `node:crypto`.**
- Computing `hash(html)` with `node:crypto` (or importing `server-only`) in `brain/*.tsx` fails the recursive import guard, whose allowed-import regex is at `:661-666`.
- Use a small inline string hash such as FNV-1a.

**P1-10. Deleting `.mk-econ` breaks the brand test.**
- brand.test.ts:473 requires the primary-CTA rule (marketing.css:83, 93) to include `.mk-econ .mk-address .button`.
- The only `.mk-econ` user is `EconomicsVisual` (site.tsx:1406), which WP7a deletes.
- **Required change.** WP4 keeps the `.mk-econ` wrapper around `AddressPreview`, or the CSS and test change together.

**P1-11. The first-frame CSS budget cannot be met.**
- With JS off, I counted the prototype rules whose selectors match the static markup (`cssfirst.cjs`):

  | Page | First-frame CSS (gzipped) |
  |---|---|
  | Home (field and board) | 8.2 KB of 11.8 KB |
  | /demo | 5.4 KB |
  | /trainer-brain | 11.8 KB |

- Across all four pages that is about 16–18 KB gzipped, against a 10 KB budget.
- Forcing 10 KB means moving layout rules into the lazy sheets. That causes layout shift on mount and leaves JS-off and crawler frames unstyled.
- **Required change.**
  - Set the budget from measurement.
  - Rule: lazy sheets only target classes and nodes that JS adds.
  - Browser assertion: injecting the lazy CSS into a JS-off page changes no static-frame box.
  - Put the global CSS cost, which every route including the member app pays, in the owner FYI list.

**P1-12. The fixed phone sheet conflicts with containment.**
- a-brain.css:363 makes `.mc-sheet` (the field's phone settings sheet) `position:fixed; z-index:60; bottom:0`.
- `contain: paint` on the stage clips it. `isolation: isolate` on the root traps it beneath the consent bar (z-index 45) and the floating button (z-index 60).
- Move fixed UI to `<body>` (as receipts already are), or contain only the canvas layer.

**P1-13. Receipts are mounted on `<body>`.**
- brain-anatomy.js:96-106 appends `.ba-back` and the dialog to `<body>`, outside `.mk`.
- The `--mk-*` tokens are defined only on `.mk, .mk-header, .mk-footer, .mk-assistant-host` (marketing.css:8-11, asserted at test `:310`). So `--sc-ease: var(--mk-ease-in-out)` is invalid inside receipts.
- `.ba-back` is not under `[data-showcase]`, so it fails the planned scoping and ink-stage contract tests.
- `destroy()` must remove both nodes and `html.sc-lock`; otherwise navigating with a receipt open leaves the next page scroll-locked.

**P1-14. Lifecycle gaps.**
- **(a) Restore runs in the wrong order.** With `key={hash(html)}` on the island only, a new payload (flag flip within the 60 s cache at platform.ts:59-73, then a same-page link) updates the host's innerHTML. The old island's cleanup then restores the stale snapshot on top. Key the host `<div>` with the same key.
- **(b) Removing `sc-late` makes results flash.** If hydration takes over 6 s, visitors have already seen the final frame; removing `sc-late` re-hides it. Never remove `sc-late` once set.
- **(c) Below-fold showcases.** The 6 s fallback starts at hydration, so below-fold showcases are already "off" when they mount. Define the off → on transition, or start the timer when the showcase is first near the viewport.
- **(d) Pinned anatomy when the engine fails.** `sc-pin` is set before paint, so a failed engine leaves a 520svh section with a static frame. Define the fallback.
- **(e) Pin height citation.** 420svh is C's desktop value (c-anatomy.css:10); phones use 230svh (`:286`).

**P1-15. Honesty.**
- **Placeholders in the prototype copy:**
  - B's pricing has "[rate: owner to state]", "Rate: [owner to state, decision 3]", "[rate]" and "[Portability wording: owner to confirm.]" (concept-b/src/pages-core.mjs:271, 335, 342).
  - C's Never sheet adds "Founder's signature … owner to supply · decision 2" (concept-c/src/lib/components.mjs:280).
  - Required: the Never sheet ships unsigned, and a test fails any of the four pages that renders `/\[(rate|owner)[^\]]*\]|owner to (state|confirm|supply)|decision \d/i`.
- **"Export or delete it whenever you like" overstates the product.** This is A's line (pages-product.mjs:621). Deletion is a reviewed request: app.ts:2266-2275 records it as `pending_review`. Use "download your data and request deletion" (marketing-features.ts:200), as the plan already does for /pricing, and add it to the owner FYI list.

## P2: should fix

1. **Phone hero order (accessibility).** Using CSS `order` puts the field's controls visually above the lede and CTA but after them in focus order (WCAG 2.4.3 and 1.3.2). Use DOM order H1 → field → lede → CTA with grid areas; the "H1 → lede → CTA" test still passes. Keep A's fixed two-line phone H1 (pages-core.mjs:33-35) so a font swap cannot re-wrap it above the field.
2. **`prepare()` must not mutate.** `index()` mutates and caches its input (brain-core.js:67-75), so filling the brand token in place leaks between renders in one process. Deep-clone, and test trainsyou → Acme → trainsyou and payments off → on → off.
3. **Frame checks.** "More than 30 frames per second" under 4× throttle on a 4-vCPU headless runner is flaky, and "0 frames" counts every `requestAnimationFrame` user on the page. Expose a product attribute such as `data-sc-run`. Judge "more than 0 frames" without throttling.
4. **WP7b acceptance.**
   - Replace "passes locally twice" with "3 of 3 runs on the PR's CI".
   - Throttle the CPU only in the metrics pass.
   - Time the 6 s fallback from `data-sc-ready`.
5. **Known-red regime.** In the application job, a red `npm run check` skips seed and every browser step, because their `if` needs `browser_fixture` to succeed. The draft PR therefore gets no browser signal for days. Each WP should fix the existing assertions it breaks.
6. **Budgets looser than the spec.** SHOWCASE_DESIGN §1.6 says no task over 50 ms and TBT at most 50 ms above the prototype. The plan's "2 long tasks, each 80 ms or less" and "baseline + 100 ms" loosen this; say so.
7. **Port steps missing from the WP2/WP3 lists:**
   - remove `root.__mc` (a-field.js:1229);
   - remove the `"signup.html"` fallbacks (a-field.js:326, 339);
   - brain-play mount removes `data-sc` instead of setting `"on"`;
   - static ids render as `undefined-*` (brain-play.js:38, 44, 88), so pass the host id;
   - `c-anatomy` `render()` returns the outer `<section … data-sc-module … id="anatomy" aria-labelledby="anatomy-h">` plus a skip link to `#anatomy-after` (c-anatomy.js:152-156), so output inner HTML only and add a `labelledBy` option;
   - the prototypes have extra live regions (a-field.js:173, c-anatomy.js:178);
   - the `reduced()` cache never resets on `data-reduce-motion` changes (brain-core.js:90-94).
8. **`--scene-top` lives in the parked scroll-scenes file.** It is in scroll-scenes.css:34-46, the "home page only" wiring of the engine being parked. Copy it into `brain-stage.css`. `SCENES_HEAD_SCRIPT` will still add `scenes-on` on `/` with nothing using it.
9. **No rollback or kill switch.** A revert costs a full CI cycle (the application job alone took 36 min). Add a server-read env switch that renders the static frames without mounting the engine.
10. **Smaller items:**
    - add `.sc-host` to `NEVER` in motion.tsx, because the root sits inside the host;
    - compact `FollowerCalculator` never renders `claimHref`/`claimLabel` (islands.tsx:431-445), so WP4 must render that CTA itself;
    - engine CTAs are plain `<a>` and trigger full page loads; route clicks through `router.push`;
    - add `data-nosnippet` to showcase roots so sample chat lines do not become search snippets;
    - the `marketing-journey.test.ts:220-232` edit is unnecessary; its asserts still hold;
    - record the reconciliation between CLAUDE.md's "deployment remains stopped" line and AGENTS.md:35.

## Confirmed good

- **Types and modules:**
  - `.d.ts` files beside `.js` modules plus JSON imports pass the root strict typecheck with TypeScript 7.0.2 (`pkgtest`, tsc exit 0).
  - tsx loads ESM `.js` and JSON from `apps/web`, whose package.json has no `"type"`.
- **CSS loading:** with Turbopack, CSS from a client `import()` stays out of the first HTML (`tp/`). This matches the existing precedent at assistant-button.tsx:69 → assistant-panel.tsx:3.
- **Next.js doc citations are accurate:**
  - lazy-loading.md:60, :66 and :94-95;
  - 01-getting-started/11-css.md:294;
  - preserving-ui-state.md only applies with `cacheComponents`, which is off;
  - Strict Mode is on by default;
  - dynamic routes without `loading.js` are not prefetched (prefetching.md:31), so the doubled showcase HTML in the RSC payload is never prefetched.
- **Head script:**
  - no CSP or nonce;
  - `<html suppressHydrationWarning>` is present;
  - React 19.3 does not escape script children.
- **Sticky pin:** `--scene-top` is defined on `:root`, and no marketing ancestor sets `overflow: hidden`.
- **Header:** it fits "Teach your AI — free" and "Join early access — free" from 1151 to 1440 px without overflow (measured).
- **Prototypes:**
  - no overflow and no page errors at 360, 390 or 1440 px;
  - no class-prefix collisions with existing CSS;
  - the traces and engine are clean of hype, registrar names, the payout provider, model names, AI-cost wording, hidden specialties and unresolved tokens.
- **Facts:**
  - the source `revenuecat-state-2026` exists;
  - `MEMBERSHIP_MINIMUMS` is in contracts (membership-pricing.ts:3), not the domain package;
  - there are 9 red-flag categories;
  - the brain setup step is 6 minutes;
  - the case thresholds are 3 and 20;
  - trainer-inbox.ts:296-321 confirms t6 and t9;
  - the worked-example figures are correct.
- **Engine chunk sizes (minified, gzipped):**

  | Page | Estimated engine chunks |
  |---|---|
  | Home | about 43 KB (budget 45) |
  | /trainer-brain | about 47 KB (budget 50) |
  | /demo | about 35 KB (budget 37) |

- **Static showcase HTML:** about 22 KB gzipped on /trainer-brain, counting the RSC copy, within the 25 KB record budget.
- **CI and branch:**
  - the homepage-call job has headroom (5 of 40 min);
  - the other CI jobs do not touch the four pages;
  - `main` is `4f35e5c`.
- **Line references:** the plan's `site.tsx` references are correct, except the `HeroFlow` import, which is at :58, not :56.