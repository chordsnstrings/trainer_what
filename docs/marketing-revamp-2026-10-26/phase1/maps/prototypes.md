Phase 1 port inventory for the approved prototypes (A field/board/demo, C anatomy, shared engine, B pricing). Nothing in the repo was changed; all builds and probes ran on a scratch copy.

## 0. What I ran and what it showed

- **Builds in the repo fail.** A and C crash in the repo on Node 24 because the root `package.json:55` sets `"type": "module"`. Both then load `calc.js` as ESM, so the CommonJS export is lost:
  - A: `concept-a/src/pages-core.mjs:15/187` throws "`calc.estimateFollowers` is not a function".
  - C: `concept-c/src/lib-content.mjs:17` leads to `site/assets/calc.js:302` throwing "Cannot set properties of undefined (setting 'tyCalc')".
  - B builds. All three build from a copy with a package.json that has no type: `/tmp/claude-0/-home-user-trainer-what/14381359-c138-56f9-a25b-830f6a2f39f9/scratchpad/protos/concept-{a,b,c}/site`.
- **Engine check passes.** `npx tsx …/shared/brain/tools/verify.mts` against today's domain code gives 4,418 checks and 0 failures (480 plan and 77 WHOOP combinations).
- **No copy drift.** A fresh `export-content.ts` output equals `prototypes/content.json`; only `exportedAt` differs.
- **Calculator figures match the domain module.** `@trainer/domain` `estimateEarnings` gives:
  - blended rate: 100 → 25%, 300 → 21.67%, 1,000 → 17%, 1,500 → 14.67%;
  - 150 × AED 199: 29,850 / commission 6,965 / you keep 22,885 / 92 sessions;
  - followers: 398 / 2,985 / 23,084.
- **Performance** (headless Chromium, no GPU, 4× CPU throttle):

| Page | Width | Frame p95 | Frames over 20 ms | Long tasks (ms) | Largest paint | Layout shift |
|---|---|---|---|---|---|---|
| A home | 1440 | 33.3 ms | 7.4% | 237, 143, 162 … | H1 | 0.013 |
| A home | 390 | 16.8 ms | — | 334, 272 | H1 | 0.03 |
| C /trainer-brain, scrolling the pin | 1440 / 390 | 33.4 / 33.3 ms | — | — | — | 0.053 at 1440 (mostly C's own hero) |
| A /demo | both | 16.8 ms | — | — | — | 0.002 |

  - On A home at 1440 the engine's own watchdog drops to the "minimal" tier ("10/111 frames > 25 ms"). The engine's own script still takes only 4 ms per frame at p95, so the slow frames are paint and compositing, as the build reports said.
  - The longest tasks happen before `load`: parsing and styling a 98 KB page and its CSS. Mounting the field adds two tasks of about 61 ms each.
- **Stale Pause label: reproduced, root cause found.** In `shared/brain/brain-core.js:205-213`, `scene().set()` only updates the buttons and `onState` when the running state flips.
  - Steps: open a receipt (the field pauses for reading), press Pause, close the receipt.
  - Result: the field stays frozen, the button still reads "Pause" with `aria-pressed=false`, and "Paused while you read" stays visible. Pressing "Pause" actually resumes it.
  - The same path applies when the idle pause starts while the field is off screen.
- **Second Pause bug (reduced motion).** In `a-field.js:1243-1253` the static `aria-pressed="false"` is kept while the field is stopped. After pressing play it is still "false", so the attribute doesn't tell the two states apart.
- **Copy checks.** The prototype's own budget checks pass on all four pages.
- **Home word count is high.** A home `main` has 1,368 visible words. Without the showcases it has 936; without the showcases, the calculator, FAQ answers and the closing panel it has about 597. The C1 home budget is 400, so check this against the repo's word counter.

## 1. Pieces

### P1. Engine core: `shared/brain/brain-core.js`, `brain-decide.js`, `brain-ui.js`, `brain-boot.js`

**Renders.** Core and decide are runtime only. `brain-ui.js` returns HTML strings (nodes, lanes, phone, Today card, rule, "How sure", step rows, 40 inline icons) and runs in both Node and the browser.

**Size** (lines, minified+gzip): core 316 lines / 3.7 KB, decide 179 / 3.9 KB, ui 140 / 4.9 KB, boot 12 / 0.5 KB.

**Dependencies.** decide and ui import core; there are no libraries. The domain functions are mirrored, not imported. Importing the real ones (`brain-plans.ts` alone is 1,937 lines, plus zod) would bloat the client bundle.

**API.** `load` (54-65), `index` (67-79), `flags` (81-84), `reduced` (90-94), `tier` and watchdog (100-122, 133-169), `loop`, `scene` (201-240), `timeline` (247-270), `say` (274-282), `fit`/`bitmap` (285-302), `whenNear`/`prefetch` (304-315). `decide`, `defaults`, `pick`, `isOff`, `totals` are in `brain-decide.js:7-179`.

**Contract with the page:**
- `<html data-recovery="on">` and `data-reduce-motion="on"`.
- `--header-h` on `<html>`. The repo uses `--scene-top` instead.
- The boot script sets `data-sc="pre"` on `[data-showcase][data-sc-module]` and removes it after 6 s if nothing started.

**Issues:**
- The stale Pause label above.
- Debug URL hooks: `?recovery=on` (:83), `?motion=reduce` (:91), `?tier=` (:103), `?slow=` (:130, burns CPU every frame).
- `load()` fetches `new URL("traces.client.json", import.meta.url)` (:58), which won't survive bundling as is.
- The tier state never steps back up. Under Next's client-side navigation it would carry across pages.
- Import has side effects (window listeners), guarded so it is safe in Node.

**Approach:** (a). Copy the modules unchanged into `apps/web/components/marketing/brain/engine/`, then:
- fix `set()` so it syncs the buttons and `onState` on every change of pause reasons;
- remove the URL hooks;
- take flags only from server attributes;
- load data via `import()` of the JSON or preloaded data;
- add a `.d.ts`, because the root `tsc` is strict and `.js` imports would error.

Effort 1–1.5 days. A strict TypeScript port (c) of all the engine code (about 3,400 dense lines) is 4–6 days with a risk of behaviour drift; defer it.

### P2. Data: `traces.json` (canonical, 51 KB) and `traces.client.json` (10.3 KB gzip)

**Contents.** Format `trainsyou-brain-trace@2`: 25 specialists (14 AI, 11 code) and 12 traces. Meal planner and Recovery rule are "Not on yet"; t3 is off by default.

**Prototype-only data shipped to the browser.** `traces.client.json` still carries:
- `verify` arrays (t6, t7, t9);
- `verbatim`, `verbatimFrom` and `verbatimRef`, which contain repo paths with line numbers, e.g. `packages/domain/src/brain-teach.ts:212-236` and `trainer-inbox.ts:316`;
- `fn` fields with internal function names, e.g. `redFlagCategories → []` and `eligibleCoachAction`.

No module renders any of these, so strip them all.

**The four open `verify` items:**
- **t6** "Skip my deload?": the Today card title "Your Brain drafted a reply". In `apps/api/src/trainer-inbox.ts:296-322` that title appears only when a draft exists for the `decisionId`; otherwise the card reads "Waiting for your reply".
- **t9** creatine: is "Waiting for your reply" the card for a personal-review topic?
- **t7, item 1:** does an edit to a Try my AI draft reach the Learner? `docs/features/trainer-preview.md` says it does not.
- **t7, item 2:** the Learner source holds only the draft, the reply and the note (`tests/brain-check.test.ts:636-660`); confirm that `apps/api` adds no member message.

**The headline count is missing.** "14 AI specialists and 11 code steps" appears only inside the `labels.howWeCount` note. The owner chose to publish the number, so it needs a visible spot, for example the roster lede, with "How we count" beside it.

**Approach.** A strip step plus a test that no internal fields ship. Port `verify.mts` into `tests/`; today it uses absolute `/home/user/trainer_what` imports. Effort 0.5–1 day, plus resolving or hedging the four verify items.

### P3. A Mission-control field and band-2 board: `concept-a/site/assets/a-field.js` (1,265 lines; 54 KB min / 20.1 KB gzip) and `a-brain.css` (514 lines; 8.1 KB gzip, home only)

**Static first frame from Node.** `renderStatic(d)` (79-142) is 29.7 KB raw / 5.9 KB gzip with 480 elements. `renderBoard(d)` (160-176) is 6.8 KB with 160 elements. Both are called from `concept-a/src/pages-core.mjs:43` (inside `.hero-media`) and `:52` (band 2).

**Runtime:**
- `mount` (195-203), `wireControls` (206-244), `mountBoard` (248-287);
- FLIP and WAAPI replays (288-319); receipts by dynamic import of brain-anatomy (322-334);
- `mountField` (336-1264): measuring, SVG rails, one canvas, moments, ghosts, the 30-second story, auto-demo, learning loop, playlist, 75-second hour reset, reduced-motion frames, zoom, phone settings sheet and bins.
- Field and board share module-level settings and subscribers (182-193).

**Contract with the static markup:**
- Root: `section.mc.sc-stage[data-showcase=field][data-cta]` and `.mb.sc-stage[data-showcase=board]`.
- `data-sc`: "pre", then "on"; missing means no JS or the 6-s timeout.
- `.mc-res` marks result states. CSS hooks: `.mc[data-sc=pre] .mc-res{visibility:hidden}` and `.mc:not([data-sc]) .mc-stamp{opacity:1}` (a-brain.css:159, 203-221, 507).
- Nodes are `.mc-frame [data-sp][data-kind][data-state][data-who][data-off]`; member rows are `.mc-m[data-t]`; lanes are `.mc-lane[data-lane]` holding `.mc-li[data-t][data-n]` and `.mc-bin[data-bin]`.
- Controls: `[data-level]` radios, `.mc-bar input[type=range]` with its `output`, `.mc-sw` switch, `.mc-lock`, `.mc-moreb` and `#mc-sheet`, `.mc-how` and `#mc-howp`.
- Also queried: `.mc-cv`, which is replaced by an SVG, and `.mc-cv2`, the canvas.
- Board: `.mb-col[data-lane] .mb-c[data-t] .mb-b`, `.mb-note`, `.mb-diff`, `.mb-tot`.

**Issues:**
- The two Pause bugs above.
- The board's `data-sc="pre"` is never cleared by `mountBoard`; only the 6-s timer clears it.
- No teardown: listeners, ResizeObservers, IntersectionObservers, timers and module singletons all stay.
- Debug flag `DBG` (179, 929).
- It injects `brain-anatomy.css` through a `<link>` built from `import.meta.url` (198-200) and prefetches the same way (1227).
- Tiles landing in the lanes cause small layout shifts. The page layout shift is 0.013 at 1440 and 0.03 at 390; the repo's home standard is 0.

**Approach:** (a).
- The server runs `renderStatic`/`renderBoard` and outputs the string with `dangerouslySetInnerHTML`.
- A thin client island replaces boot: idle, then within 200 px, then `import()`, then `mount`, plus `destroy()`.
- Add a teardown API and reset the module state.
- Pass the call to action from `claimCta(platform.registrationOpen)`. The labels "Teach your AI — free" are hardcoded in the engine's text.

Effort 3–4 days including the CSS port. A React rewrite (b) is 6–10 days and high risk: it means 60 fps imperative choreography with no gain. React for the board alone is 1–1.5 days but needs a store shared with the field, so not in phase 1.

### P4. Receipts / A's zoom: `shared/brain/brain-anatomy.js` `open()` (92-156, with `slots`/`receiptHTML` 39-91) and `brain-anatomy.css`

**Renders.** Runtime only. It builds `div.ba-sheet.sc-stage[role=dialog][data-showcase=receipt][data-mode=inline|sheet|modal]`, plus `.ba-back`. It sets `html.ba-lock`, traps focus, closes on Esc, returns focus to the opener, and announces through `say()`.

**Unused code.** `stack`, `fig` and `mount` (160-304) are dead for the A + C mix, because C uses its own `c-anatomy.js`. About half the CSS (the 3D stack and Fig. 4) is unused too.

**Size.** 6.9 KB gzip for the whole file today.

**Issues.** The CTA label is hardcoded (COPY at 11-19). `html.ba-lock` is a global selector. Next keeps global CSS after navigation, so scope it.

**Approach:** (a). Keep `open()` and drop 160-304. Effort 0.5 day.

### P5. Playground: `brain-play.js` (597 lines; 12.2 KB gzip), `brain-play.css`, A skin in `a-echo.css:109-118`

**Static.** `renderStatic(d, {cta, heading})` (100-108) is 25 KB / 5.9 KB gzip with 395 elements and shows t1 resolved. Called from `concept-a/src/brain-a.mjs:20-25`.

**Runtime.** `mount(el, o)` (122+) rebuilds the root with `el.innerHTML = shellHTML()` (:136) and keeps the static result's height reserved. It runs the attract run, chips, free text to the closest sample, controls with the before/now diff, "Throw them all", the canvas, Pause, and "How we count".

**Contract.**
- Root: `.bp[data-showcase=play]`, plus `data-cta`, `data-heading=off`, `data-src`, `data-recovery`, `data-attract=off`.
- Height reserve is read from `.bp-res`.
- Ids generated: `${u}-text`, `${u}-out`, `${u}-locktip`.
- The roster's "See it work" link uses `[data-run]` to click a `.bp-chip[data-t]` (`rosterScript`, brain-a.mjs:163).

**Issues.** No teardown. The CTA label is hardcoded (COPY at 10-17). Mounting shifts the stage 19 px (layout shift 0.002 on /demo). On C's page the CTA jumps 614 px after a run.

**Approach:** (a). Effort 1.5–2 days. A React rewrite (b) is 4–6 days, medium risk.

### P6. C anatomy, pinned on /trainer-brain: `concept-c/src/showcase/c-anatomy.js` (601 lines; 12 KB gzip) and `c-anatomy.css` (504 lines; 8.1 KB gzip)

**Static.** `render(d, {n, fig, id})` (152-181) is 27.7 KB / 4.9 KB gzip with 580 elements. It already contains `data-sc="pre"`. Mounted in C via `lib-brain.mjs:47` as `anatomy({n:3, fig:3, id:"decides"})` (`pages-product.mjs:382`).

**Runtime.** `mount` (207-601):
- its own pin: a passive scroll listener plus one loop (`readScroll` 524-531), with no rect reads inside the loop;
- a one-time intro burst and teaser (469-492), with IntersectionObserver at 593;
- ghost stacks on their own scene; What-if replays (557-585);
- the flat layout under reduced motion or viewport height under 700 (215, 588);
- `#fig-3a…j` hash jumps.

**The pin is pure CSS, not the repo's scroll-scenes engine.** `.js .ca{height:calc(100svh - var(--header-h) + 420svh)}` (c-anatomy.css:10; 230svh on phones at :286) and a sticky `.ca-frame` (:12). It depends on an `html.js` class and `--header-h` being set before first paint.

**Contract.**
- Queried: `.ca-grid`, `.ca-scene`, `.ca-cam`, `.ca-stack .ca-p` (re-rendered through `innerHTML` on What-if).
- SVG: `.ca-svg` with paths `.ca-thr`, `.ca-rl[data-r]`, `.ca-br[data-b]`, `.ca-lead` and circles `.ca-halo`, `.ca-dot`.
- Notes: `.ca-nl li[data-k]` with `.ca-nb` buttons; What-if: `.ca-wb[data-w]`; also `.ca-pause`, `.ca-g[data-run]`, `.ca-card`, `.ca-stop`, `[data-live]`.
- CSS variables read from computed style: `--ox`, `--oy`, `--pw`, `--ph`, `--gap`, `--tz`, `--ty`, `--tx`, `--txf`, `--lift`, `--flat`.
- Attributes written: `data-flat`, `data-trace`, `data-tease`, `data-step`, `data-paused`, `data-me`, `data-lit`.

**Issues:**
- It is C-skinned: 26 Newsreader serif references, "§n" eyebrows, "Fig." captions, square 2px controls. Re-skin to A's tokens, or get the owner's call on brand deviation 13.
- No teardown (window scroll and hashchange listeners).
- 41 physical CSS properties.
- `.ca-nb:hover` sits outside `@media (hover)` (:244).

**Approach:** (a), with a pre-paint gating class for /trainer-brain.
- Keeping its own pin is the simpler path; it is already through QA.
- Moving it into the repo's scroll-scenes engine (spec §1.6, `{ambient:true}`) means extending `scenes-head.ts` and `scene-mount.tsx`. Both are pinned to `pathname === "/"` and asserted in `tests/marketing-motion-sitewide.test.ts:560-581`.

Effort 2.5–3.5 days.

### P7. B pricing page and calculators

**Page.** `concept-b/src/pages-core.mjs:234-374`:
- hero with stairs (249-265);
- glance (266-276);
- "How our share falls": band table plus the blended-rate tool (277-296);
- worked example: statement plus the "Try your numbers" take-home tile (297-318);
- an hour sells once, with source badges (319-330);
- statement extras (331-351), billing and payouts (352-359), status panel (360-364), FAQ of 6 (365-369).

**Components.** `components.mjs`:
- `statusChip` 103, `srcBadge` 113, `paymentsNote` 119, `val` 127;
- `rangeField` 148, `statusPanel` 192, `statusStrip` 202, `statement` 276;
- `stairs` 287, `bandMeter` 295, `rateAxis` 300, `takeHomeTile` 315.

**Runtime.** `calc.js` (407 lines; 5.6 KB gzip): maths at 1-245, DOM binding at 247-405, `earnings` renderer at 309-339. `core.js` has the share quick-jumps at 22-29. `money.js` serves only /earnings-calculator and /follower-calculator, so it belongs to phase 2.

**Contract.** `[data-calc=earnings][data-calc-name]`, `data-in`/`data-out`, `[data-live]`, `[data-band-fill=i]`, `[data-rate-marker]` (with `--pos`), `data-sync=price`, `data-share-n`. Values change by crossfade through `TY.setValue`.
- The digit roll is a dev-panel toggle only (decision 6), so default to crossfade.
- Fonts are B's Archivo figures; the repo self-hosts only Inter.

**Approach:** (b). Server JSX plus two React islands (blended-rate slider, take-home tile) on `@trainer/domain` `estimateEarnings`/`BANDS`, which I verified match. Do not port `calc.js`. Re-skin to A's tokens. Effort about 2 days.

### P8. Static bands as server JSX, approach (b)

**Home** (`concept-a/src/pages-core.mjs`):
- hero 28-46, field/board 48-55, how 57-79, subscribers 83-123;
- control 125-153: swap A's `constraintList` for C's Never sheet;
- economics 155-182: status panel plus the AddressPreview the repo already has;
- follower mini 185-214: the repo's `FollowerCalculator` or a compact island;
- proof 224-244: drop `founderNote` (236);
- FAQ 246-266.

The prototype's How-it-works stepper (57-79) differs from the spec's "home keeps the journey band as its one pin". The repo's journey band only renders when payments are on, so decide which applies.

**/trainer-brain** (`concept-a/src/pages-product.mjs:638-670`):
- hero rule ledger 475-503, a React island with Confirm/Edit/Reject/Undo/Approve all (logic in `product.js:45-83`);
- "What it is" 505-526;
- roster (`brain-a.mjs:46-69`), from traces data;
- C anatomy in place of A's `decides()` (`brain-a.mjs:71-91`; `tbDecides` at 543 is already dead code);
- playground;
- teach 528-541;
- better 566-615, with the release and compare islands (`product.js:85-104`);
- Never sheet: C's `neverSheet({signed:false})` (`concept-c/src/lib/components.mjs:264-283`), next to A's "Your method stays yours";
- FAQ.

**/demo** (`pages-product.mjs:1641-1692`): playground hero (H1 "Throw a moment at your Brain"), then the "What happens in your account" band, then 4 FAQs.

**Source badge.** Use C's `sourceBadge` (`concept-c/src/lib/components.mjs:107-110`; CSS at `concept-c/site/assets/site.css:418-427`). All four source ids used exist in `packages/contracts/src/marketing-content.ts`.

Effort: home 2–3 days, /trainer-brain 2–2.5, /demo 0.5.

## 2. CSS against the repo motion contract (`tests/marketing-motion-sitewide.test.ts`) and logical CSS (`tests/logical-css.test.ts`)

I scanned with the tests' own `cssRules`/`motionProblems`/`physicalRule` code.

| File | Transitions/keyframes on non-compositor properties | Hover outside `@media(hover)` | Literal duration/easing (not `--mk-*`) | infinite | Physical properties |
|---|---|---|---|---|---|
| a-brain.css | 6 (bg :52, :183, :282; `left` :125 = animates layout; visibility :363; box-shadow :364) + 6 keyframes on box-shadow/border/color (:381-394) | :268 | about 120 | 0 | 32 |
| brain-base.css | :29 (bg/box-shadow/border), :117 | 0 | 18 | 0 | 11 |
| brain-play.css | :19, :81, :111 | 0 | 26 | 0 | 4 |
| brain-anatomy.css | :100 + keyframes `ba-flash` box-shadow (:128) | 0 | 28 | 0 | 31 |
| c-anatomy.css | 16 (:23, :28, :95, :108, :154, :188 `stroke`, :210, :240, :260, :465) | :244 | 80 | 0 | 41 |
| a-echo.css | 0 | 0 | 0 | 0 | 0 |
| A core.css / B core.css | 0 | 0 | 4 / 0 | 0 | 10 / 3 |

The literal-duration count for brain-play.css excludes the two keyframe references (`sc-shake`, `sc-stamp`) that are defined in brain-base.css; those are cross-file references, not violations.

**The showcases' reduced-motion rule.** `brain-base.css:128-131` deliberately skips the "always" exclusion; this is the owner's showcase exception. The test requires every reduced-motion rule in marketing.css, marketing-assistant.css and marketing-journey.css to carry `MOTION_ALWAYS_EXCLUDED` (test lines 493-517). So the showcase CSS needs its own stylesheet plus a test extension for `[data-showcase]`.

**Token definitions.** The tokens test reads every `app/*.css` (684-692), so the showcase files must not define `--mk-*` tokens. The `--sc-ease`, `--sc-enter` and `--sc-spring` values equal the repo's `--mk-ease-in-out`, `--mk-ease-enter` and `--mk-ease-spring`.

**Physical exceptions.** `a-brain.css:496` uses physical insets on purpose (a vertical writing-mode card); it needs an ALLOWED entry. The logical test scans every CSS file under `apps/web` recursively.

**Global CSS stays after navigation.** Next 16 keeps global stylesheets loaded across navigation (`node_modules/next/dist/docs/01-app/01-getting-started/11-css.md:294`). Scope every rule; there are global selectors today such as `.js .ca` and `html.ba-lock`.

## 3. Prototype-only: must not ship

- **A layout chrome.** Port only `main` content; header, phone menu (PR #102), footer, closing panel and Kamran stay the repo's. In `concept-a/src/layout.mjs`:
  - sticky CTA, consent bar simulation (149-153);
  - fake Kamran popover "Calls are not connected in this prototype" (154-159);
  - dev panel "Prototype controls" with flag switches, Replay hero, Reset, gallery link and page list (160-175);
  - localStorage flags boot `tyA.flags` (211);
  - Google Fonts links (205-209).
- **Tracking stubs.** `tyTrack` console tracking and consent simulation in `site.js`. The engine has no analytics hooks; tracking is phase 3.
- **Owner-decision placeholders:**
  - A: `pendingTag`/`founderNote` (`concept-a/src/components.mjs:153, 166-175`; `pages-core.mjs:236, 312, 487`).
  - B: "Rate: [owner to state, decision 3]" (`pages-core.mjs:271`), "[rate: owner to state]" (:335), "[rate]" (:342), "[Portability wording: owner to confirm.]" (:245), founder placeholder (:200).
  - C: Never-sheet "Founder's signature · owner to supply · decision 2" (`lib/components.mjs:280`), and `founderLetter` throughout.
- **Debug hooks and internal data:**
  - `?recovery`, `?motion`, `?tier`, `?slow` (brain-core.js); `?dbg` (a-field.js).
  - `stats`/`p95` exports exist only for QA.
  - The internal trace fields from P2.
- **B prototype-only bits:** the digit-roll toggle (`concept-b/src/layout.mjs:117`) and `data-wc-skip` QA attributes.
- **Unused or optional fonts:** Google-hosted fonts. JetBrains Mono (A's mono) must be self-hosted. Newsreader and Archivo can be dropped if C's anatomy and B's pricing are re-skinned to A's tokens.

## 4. Requirements across all pieces for the Next port

- **Keep showcase markup out of React's hands.** Run the generators' own `render*` functions on the server and output them with `dangerouslySetInnerHTML`, rather than hand-porting to JSX.
  - The engines remove, replace and `innerHTML` that DOM (`a-field` `resetFirst`, `cv.replaceWith`; play :136; c-anatomy `stack.innerHTML`). React-owned JSX there would break reconciliation.
  - Hand-ported JSX would also drift from the class and attribute contracts.
  - Mount with a sibling client component that renders nothing, like `scene-mount.tsx` does.
- **Before first paint:** server-render `data-sc="pre"` and add a no-JS fallback. Without it, results flash visible and then hide when the island hydrates. Keep the 6-s fallback, set the pin class for C's anatomy, and define `--header-h` or map it to `--scene-top`.
- **Teardown.** Add `destroy()` to the field, board, playground and anatomy, and reset module singletons (`a-field.js:182-184`). Navigation uses `next/link`, and Strict Mode mounts effects twice in development.
- **Calls to action.** Labels and links must come from the platform's `registrationOpen`. The recovery flag must come from the server, never from the URL.
- **Bundle size** (minified+gzip, loaded after first paint):
  - home: engine 12.5 + field 20.1 + data 10.3, plus the receipt module 6.9 on demand;
  - /trainer-brain: engine + anatomy 12 + playground 12.2 + data;
  - /demo: about 35 KB.
  - Showcase CSS per page is 14–18 KB gzip; `a-brain.css` and `c-anatomy.css` are each over the spec's 6 KB budget.

## 5. Recommendation and effort

| Piece | Approach | Days |
|---|---|---|
| Showcases: engine, field + board, receipt, playground, C anatomy | (a), code-split vanilla modules, server-rendered strings, thin islands, bug fixes | about 9–12 |
| Pricing calculators and all static bands | (b) | about 7–8.5 |
| CSS contract port, JetBrains Mono, tests (verify port, `[data-showcase]` motion exception, logical allow-list, Playwright spot checks at 390 and 1440, reduced motion, keyboard) | — | about 4–6 |
| **Total** | | **about 20–27 dev-days** |

- **Risks:**
  - desktop frame time needs real hardware: 33 ms p95 here, all paint;
  - long tasks before `load`;
  - layout shift must reach 0;
  - teardown and leaks under client navigation;
  - test drift: tests that encode today's copy, the home word budget, and head-script path asserts if the pin moves to /trainer-brain;
  - the 4 verify items;
  - re-skinning C and B to A's tokens (brand decision 13).

Probe scripts are in `/tmp/claude-0/-home-user-trainer-what/14381359-c138-56f9-a25b-830f6a2f39f9/scratchpad/tools/`:
- `perf.cjs`, `cls.cjs`, `lt.cjs`, `tier.cjs`: frame time, layout shift, long tasks, watchdog tier;
- `pause3.cjs`: reproduces the stale Pause label;
- `contract.mts`: the CSS scan built from the repo tests;
- `serve.cjs`: the static server.