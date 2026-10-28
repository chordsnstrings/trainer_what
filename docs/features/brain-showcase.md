# Brain showcases

The scripted, animated pictures of a trainer's AI on the marketing site: the field and the board on `/`, the playground on `/trainer-brain` and `/demo`, and the decision anatomy on `/trainer-brain`. They show what happens to a member's message: code checks first, one AI specialist that code picks, code checks after, and the lane the moment ends in. Every moment is a sample. Nothing on these pages calls an AI model.

Built in phase 1 of the marketing revamp (28 October 2026, branch `claude/repository-overview-osejlw`, PR #105). The owner chose the recommendation on 27 October ("Go with your recommendation"). That accepted the defaults in `docs/marketing-revamp-2026-10-26/showcase/SHOWCASE_DESIGN.md` §8:
- the motion exception and the ink stage, both limited to `[data-showcase]`;
- showcases that follow reduced motion even while the marketing motion switch is `"always"`;
- "14 AI specialists and 11 code steps", published with "How we count";
- the Recovery rule and the Meal planner shown as "Not on yet".

The spec is `docs/marketing-revamp-2026-10-26/phase1/PLAN.md` §1. This page records what shipped, including where it differs from the plan. Page structure and copy are in [marketing-site.md](marketing-site.md), and the motion rules in [marketing-motion.md](marketing-motion.md).

## What visitors see

| Showcase (kind) | Where | Host id | What it shows |
|---|---|---|---|
| Field (`field`) | `/`, the hero, between the H1 and the lede | `sc-field` | "A sample hour of your Brain". Sample members' messages pass the checks, one specialist and more checks, and land in a lane: Sent on its own, Your Today, or Training paused. Its first frame is the stop on Noura's knee: "STOP · No AI called" and the Paused bin. Every moment is a button that opens its receipt. |
| Board (`board`) | `/`, band 2, "Change a setting. Watch it re-sort." (`#resort`) | `sc-board` | Every sample moment, sorted by the settings. The field and the board share one settings object, so a change of level or threshold in either re-sorts both. |
| Playground (`play`) | `/trainer-brain` "Throw a moment at your Brain" (`#play`), and `/demo` under the page head | `sc-play` | 12 sample moments as chips. Free text finds the closest sample from a local keyword table. Settings change the result and show a before/now line: level, how sure a plan must be, supplements, too heavy, and the safety lock. On `/demo` it plays the first moment once on its own (`attract`). |
| Decision anatomy (`anatomy`) | `/trainer-brain` "Anatomy of one decision" (`#decides`) | `sc-anatomy` | One reply, Omar's squat, taken apart into nine plates: (a) the message through (i) what the member reads, plus the correction (j). It pins under the header on screens 700 px tall or more, and shows flat plates otherwise. The What-ifs replay a popped knee, a plan change and level 1. A "Skip the figure" link comes before it. |

**Honesty labels, in every frame:**
- the chip "Sample · scripted · no AI model called";
- while subscriber payments are off, the strip "Subscribers can't join yet: subscriber payments are not on. You can run all of this on yourself with Try my AI.";
- a basis on each AI step: "From a test run", "From the app's tests", "Illustrative" or "Worked out by the app's own rules";
- "Not on yet" on the Recovery rule and the Meal planner. The Low recovery moment is off by default and never runs.

**Kept out of search and structured data.**
- `data-nosnippet` on every root keeps the sample lines out of search snippets.
- Showcase text never reaches JSON-LD, `llms.txt`, `llms-full.txt` or the assistant facts.
- The claims that pages and showcases share are pinned by tests (see "Updating the traces").

## Files

**`apps/web/components/marketing/brain/engine/`.** The approved prototype's ES modules, ported as `.js` files with hand-written `.d.ts` files for their public surface. `types.d.ts` holds the shared types.
- **Pure modules:** no DOM, no CSS and nothing at import time, so the server and the tests import them.
  - `core.js`: data indexing, the one frame loop, scenes and pause reasons, tiers and the watchdog, reduced motion, and the overlay layer with its live region.
  - `decide.js`: the lane a moment ends in, from the settings.
  - `ui.js`: shared HTML atoms (nodes, lanes, the status strip, the call to action).
  - `data.js`: `prepare`, `stripForClient` and `NON_TEXT_KEYS`.
  - The render modules: `field.render.js` (field and board), `play.render.js` and `anatomy.render.js`.
- **Runtime modules:** browser only. Each imports its own stylesheet and its render module.
  - `field.js` (field and board), `play.js` and `anatomy.js`.
  - `receipt.js`, which `field.js` loads on demand.
- **Lazy stylesheets:** `field.run.css`, `receipt.css`, `play.run.css` and `anatomy.run.css`.

**`brain/data/`.**
- `traces.json` is the canonical copy: 25 specialists (14 AI, 11 code steps), 12 moments, the labels, the sample settings, and for each claim the code it rests on.
- `traces.client.json` is generated from it.

**`brain/` itself:**
- `render.ts`: `renderShowcase()`, the root and its static inner HTML (server).
- `showcase.tsx`: `BrainShowcase`, the host and the island in one keyed fragment.
- `mount.tsx`: `ShowcaseMount`, the client island that loads and runs the engine.
- `head.ts`: `SHOWCASE_HEAD_SCRIPT` and `SHOWCASE_PATHS`.
- `options.ts`: `showcaseOptions()` and `showcaseMode()`.
- `roster.tsx`: the `/trainer-brain` roster ("Who's inside your Brain"), server JSX from the same data.

**Elsewhere:**
- The first-frame stylesheets: `app/brain-stage.css`, `brain-field.css`, `brain-play.css` and `brain-anatomy.css`. They are global, imported in `app/layout.tsx`.
- `scripts/brain-traces.mjs`.
- `scripts/marketing-showcase-check.mjs`, with `scripts/marketing-showcase-baseline.json`.
- The tests: `tests/marketing-brain-traces.test.ts`, `marketing-showcase.test.ts`, `marketing-field.test.ts` and `marketing-anatomy-play.test.ts`.
- The pages that place the showcases: `components/marketing/pages/home.tsx`, `trainer-brain.tsx` and `demo.tsx`.

The sample controls on `/trainer-brain` (`brain-page-islands.tsx`: RuleLedger, ReleaseTimeline and CompareReplies) are ordinary React islands, not showcases.

## The render/runtime split

**Why.** CSS imported by anything a Server Component imports becomes a `<link rel="stylesheet">` in the first HTML of every route on the catch-all, the member app included. CSS reached only through a client `import()` stays in that chunk.

**Rules:**
- Only `mount.tsx` reaches the runtime modules. It holds one map of literal `import()`s (`LOADERS`), and each runtime module becomes its own chunk with its CSS.
- Never import a runtime module or an engine stylesheet from `site.tsx`, `render.ts`, a page, or anything they import statically. Under `tsx` a `.css` import throws, which would break every suite that renders `MarketingSite`.
- No `next/dynamic`: it loses the server frame and has no idle or viewport gate. No `next/script` either.
- No engine file has a non-literal `import()`, a `fetch` or `new URL(…, import.meta.url)`. The verbatim prototype failed `next build` on exactly these.

**How the tests hold it.** `tests/marketing-showcase.test.ts` walks the static imports from `site.tsx` and `render.ts` and fails on any `.css` file or runtime module. It also checks that importing the server and pure modules touches no browser API, timer or listener.

## Lifecycle

1. **The server.**
   - `BrainShowcase` calls `renderShowcase(kind, options, mode)`. That writes `<section class="… sc-stage" data-showcase="<kind>" data-sc="pre" data-nosnippet aria-labelledby="…">` around the render module's inner HTML. The root uses `aria-label` instead when no page H2 names it.
   - The HTML goes into `<div class="sc-host" id="<host id>">` through `dangerouslySetInnerHTML`. React owns the host and never looks inside it.
   - Host and island sit in one fragment keyed by the 32-bit FNV-1a hash of the HTML. A changed payload replaces both, for example a flag flipped inside the platform's 60 s cache.
   - Equal options give equal HTML, and the last 32 renders are cached.
2. **The first frame is final.**
   - Each kind's first frame is a finished picture: the field's stop on Noura's knee, the playground's first moment played to its end, and the anatomy's complete figure.
   - Results the engine will play again carry `.sc-res`. They are hidden only under `html.sc-motion:not(.sc-late) [data-showcase][data-sc="pre"]`.
   - Controls render `disabled` until the engine wires them. `brain-stage.css` gives disabled showcase controls their own look, because the site's disabled-button rule (`subscriber-public.css`) would otherwise draw them as white dashed boxes.
3. **The head script** (`head.ts`). It is inline in `<head>`, after the scroll scenes' script, and acts only on `SHOWCASE_PATHS` (`/`, `/trainer-brain` and `/demo`). Before the first paint it adds:
   - `sc-motion`, when neither reduced-motion setting is on and the visitor is not a robot (unless `?sc=on`);
   - `sc-pin`, under the same conditions, when IntersectionObserver and sticky positioning exist;
   - `sc-late`, 6 s later, if no island has set `html[data-sc-ready]`. The final frame then shows, and an engine that still mounts starts from it (`settled`).
4. **The island** (`mount.tsx`, which renders nothing).
   - **Before paint:** it sets `html[data-sc-ready]` and repeats the head script's test, which covers client-side navigation and settings changed since load. It starts the 6 s fallback the first time the root comes within 200 px of the viewport.
   - **After paint:** it snapshots the host's HTML. Then it waits for the load event, then idle (`requestIdleCallback` with a 1.5 s timeout, or 300 ms without it), then for the root to come within 200 px. Only then does it run `import()` and `mount(root, {…options, kind, id, settled, navigate})`.
5. **The engine.** On its first frame it sets `data-sc="on"` and `data-sc-tier`. `data-sc-run` sits on the root exactly while a frame is scheduled for it.
6. **"Off" is final.**
   - The island restores the server frame and sets `data-sc="off"` in three cases: the engine has not set `"on"` 6 s after the root first came near, the chunk fails to load, or the engine fails to mount.
   - An engine that finishes mounting later is destroyed, never shown.
   - The anatomy also stops pinning (`data-sc-flat`), but only once it is entirely below the viewport, so nothing the visitor sees moves. Until then its pinned frame shows the complete figure.
7. **Changes and teardown.**
   - A change to either reduced-motion setting destroys the engine and mounts it again from the server frame.
   - Unmounting (navigation, or Strict Mode's second mount) cancels everything pending and calls `destroy()`. That removes the overlay nodes it added and `html.sc-lock`. The island then puts the snapshot back.
   - The tier is kept for the document.
8. **Calls to action and run requests.**
   - Engine links carry `a[data-sc-cta]`. The island sends a plain left click through `router.push`, so the page does not reload.
   - The playground also runs a moment on an `sc:run` event (`{detail: {trace}}`) on its host, or on a click on `a[data-run]`, such as the roster's "See it work" links. It mounts at once if needed.

## What runs, and when it stops

- **One loop.** One `requestAnimationFrame` loop serves every showcase on the page.
  - The field and the playground draw their moving parts on one canvas each (`aria-hidden`). The anatomy has no canvas.
  - No CSS or SVG animation inside a showcase runs forever.
- **No frames while paused.** A showcase draws nothing while any pause reason holds:
  - off screen (the strip under the sticky header counts as off screen);
  - a hidden tab;
  - idle: 90 s without input, or 60 s on phones;
  - the visitor's Pause;
  - an open receipt;
  - a Kamran call: `html[data-mk-call]`, which `assistant-button.tsx` sets while the call panel is open;
  - reduced motion.

  Input resumes only an idle pause, never the visitor's own.
- **Pause controls.** Every Pause control is `[data-sc-pause]` with a correct `aria-pressed`. Motion that lasts longer than 5 s can always be paused (WCAG 2.2.2).
- **Tiers.**

  | Tier | Pixel ratio, at most | Frame rate | Detail |
  |---|---|---|---|
  | `full` | 2 | 60 fps | Every ghost and halo |
  | `lite` | 1.5 | 30 fps | Fewer ghosts, no halos |
  | `minimal` | 1 | 30 fps | No ghosts |

  - Starting tier: `lite` on a device with 4 cores or fewer, 3 GB of memory or less, or Save-Data. Safari and every iPhone or iPad browser start at `full`, because WebKit reports neither memory nor a reliable core count; the watchdog decides there.
  - The watchdog steps down one tier when frames average over 20 ms for 2 s, or when 1 frame in 20 takes over 25 ms over 2 s. It ignores the first second after `load` and the first 500 ms after the loop starts.
  - It never steps up. The tier holds for the document, client-side navigation included.
- **The check's switches.** `?tier=full|lite|minimal` and `?slow=<ms>` (which burns that long on every frame to force the watchdog) work only in automated browsers (`navigator.webdriver`).

## Reduced motion

Showcases follow the device's `prefers-reduced-motion` and the member's own `<html data-reduce-motion="on">`, whatever `MARKETING_MOTION` says. This is the owner's showcase exception (SHOWCASE_DESIGN.md §8, decision 2), and the showcase CSS carries no `MOTION_ALWAYS_EXCLUDED`.

With either setting:
- there is no `sc-motion` or `sc-pin`: the first frame is final, and the anatomy shows flat plates;
- the field starts paused on its still frame, with "Play the field" pressed (`aria-pressed="true"`). If the visitor presses it, the field steps to a new moment every 2.5 s instead of playing the hour, with no ghosts and no streamed text;
- the playground resolves each run at once and never plays on its own;
- `app/brain-stage.css` stops every animation and transition under `[data-showcase]`.

## Robots, automated browsers and `?sc=on`

- **Robots never get the engine.** A robot is `navigator.webdriver`, or a user agent that matches `bot|crawl|spider|slurp|preview|lighthouse`. `head.ts` and `mount.tsx` use the same test, and a test keeps the two equal.
- **What robots see.** They read the first frame, which is final: `data-sc="pre"` hides nothing without `html.sc-motion`.
- **What that means for checks.**
  - The existing browser, completion and Kamran call checks see the still frames.
  - Lighthouse scores leave out the engine's cost.
- **`?sc=on` lets an automated browser in.**
  - It is stored as `sessionStorage["sc-on"] = "1"` and holds for the tab, client-side navigation included. That is unlike `?scenes=on`.
  - `scripts/browser-check.mjs` clears it after its `/demo` smoke test.

## Static mode: the off switch

**What it does.** With `MARKETING_SHOWCASE=static` in the web process's environment, every showcase renders as its still frame:
- every root is `data-sc="off"`, and the anatomy is flat (`data-sc-flat`);
- no island renders, and no engine chunk loads.

**How it is read.** `app/[[...path]]/page.tsx` reads the variable per request through `showcaseMode()`. The route is dynamic (`ƒ /[[...path]]`), so a new web process applies it without a build.

**Checked locally.** After a `next start` restart with the variable set and no rebuild, the roots rendered `off`, no showcase island hydrated and no engine chunk was requested. WP1, WP4 and WP5 each checked this, on 27 and 28 October 2026.

**Open: production wiring.**
- The host runs `docker compose --env-file runtime.env` (`infra/digitalocean/host.py`). `runtime.env` only fills in the variables that `compose.yaml` names.
- The `web` service names only `NODE_ENV`, `PUBLIC_APP_URL`, `PLATFORM_ROOT_DOMAIN`, `INTERNAL_PROXY_SECRET` and `API_INTERNAL_URL`, and the controller refuses `env_file`.
- So setting the variable in `runtime.env` does not reach the site until `compose.yaml` gains `MARKETING_SHOWCASE: ${MARKETING_SHOWCASE:-}` under `web.environment`. That is the pattern `PLATFORM_ROOT_DOMAIN` already uses; `tests/test_web_address_deployment.py` pins that variable's two lines. An empty value means live.

**Switching, once that line is in:**
1. Set `MARKETING_SHOWCASE=static` in `runtime.env`, from the DigitalOcean console.
2. Request "Re-apply runtime settings" on the Super admin "Host and backups" page, or run `hostops.py reapply` from the console ([infra-ops.md](infra-ops.md)). Either one recreates the serving release with the current `runtime.env`. A plain container restart does not re-read it.
3. To go back, remove the line (or set it to `live`) and re-apply.

## The overlay layer

- **What lives there.** Receipts opened as a dialog or a phone sheet, their backdrop, the field's phone settings sheet and the one polite live region mount in `<div class="sc-layer" data-showcase="layer">`. On desktop the field opens its receipts inside its own zoom instead.
- **Where it goes.** It is the last child of the marketing root (`.mk`), so the `--mk-*` tokens reach it. It is not on `<body>`.
- **Stacking.** It is fixed at z-index 70, above the consent bar (45) and Kamran's button (60).
- **Lifetime.** It is reference-counted and removed with the last showcase.
- **Scroll lock.** While a receipt is open as a dialog or a sheet, `html.sc-lock` stops page scrolling. Closing it, or `destroy()`, removes the lock, so leaving a page with a receipt open cannot lock the next page.
- **Announcements.** The live region speaks only for changes the visitor caused.

## Flags

`showcaseOptions(platform, cta, extra)` builds one options object from the platform facts. The server render and the island get the same object.

| Option | From | What it changes |
|---|---|---|
| `appName` | the platform name | Replaces `{APP_NAME}` in the traces, for example "Platform safety rules · trainsyou. Can't switch off." |
| `cta` | `teachCta(registrationOpen)` | "Teach your AI — free" → `/signup`, or "Join early access — free" → `/get-started#early-access` while sign-ups are closed. The field and the board carry it in their frame, so the key changes with it. |
| `flags.payments` | `availability.payments` | While it is off: the status strip shows, and "Try it on yourself" stays. Once it is on: the strip goes, and those items become live, each only if its own `needs` flag is also on. |
| `flags.voice`, `flags.nutrition` | availability | With payments on, an item that `needs` one of them stays "Try it on yourself" until that flag is on too. The meal photo reader and the meal-photo moment (t4) need `nutrition`. The voice lines, the set logger and the voice-session moment (t5) need `voice`. |
| `flags.payouts` | `availability.payouts` | Passed with the others. No showcase status uses it yet. |
| `flags.recovery` | fixed `false` in phase 1 | Low recovery (t3) and the Recovery rule stay "Not on yet", whatever the platform says. |

The Meal planner's "Not on yet" is fixed in the data, not driven by a flag. Its `flag` field names the settings it waits for: `NUTRITION_ENABLED && NUTRITION_SCOPE_APPROVED`. The Recovery rule and Low recovery name `WHOOP_TRAINING_APPROVED`.
| `heading`, `labelledBy`, `attract` | the page | `heading: false` leaves the H2 to the page, and `labelledBy` names it. `attract` makes the `/demo` playground play once on its own. |

**How the data is prepared.** `prepare(raw, {appName, flags})` deep-clones its input before filling it, so one render's name and flags never leak into the next. `tests/marketing-brain-traces.test.ts` checks this with trainsyou → Acme → trainsyou, and with payments off → on → off.

## Styles and the ink stage

- **The ink stage.** Showcases sit on a dark stage, `--sc-stage` `#171917`, with nodes `#202320` and text `#f3f4f0`. This is the one dark surface on the always-light public pages, and it is allowed only under `[data-showcase]` (SHOWCASE_DESIGN.md §8, decision 1).
  - Product surfaces inside a stage (the phone, the Today card) keep the product's light tokens.
  - On the stage, Pace (`--sc-pace`, `--sc-ai-on`, `--sc-learn`) also colours text, lanes and the focus ring, on ink only.
- **Contrast.** `tests/marketing-showcase.test.ts` computes it:
  - text 4.5:1 or more on the stage, the nodes and the tints;
  - controls and lane colours 3:1 or more;
  - ink text on every lane colour 4.5:1 or more.

  The same test fails on any dark background outside `[data-showcase]`.
- **Tokens.** `--sc-*` tokens are defined once, in `brain-stage.css`. `--sc-ease`, `--sc-enter` and `--sc-spring` point at the matching `--mk-*` tokens, and no showcase sheet defines a `--mk-*` token. `--sc-mono` is the system monospace stack, so there are no new font files.
- **Scoping.** Every rule sits under `[data-showcase]` (the overlay layer included) or an `html.sc-*` state. Page sheets use their own prefixes: `.mk-hm-`, `.mk-tb-`, `.mk-dm-`, `.mk-pr-` and `.mk-pf-`. There is no CSS nesting, and the properties are logical throughout.
- **What moves.** Only `opacity`, transforms and `stroke-dashoffset` animate, and nothing is `infinite`.
- **The pin gate.**
  - The anatomy pins only under `html.sc-pin [data-showcase="anatomy"]:not([data-sc-flat])`, inside `@media (min-height: 700px)`.
  - Its height is set before the first paint from `--sc-pin-len`: 420svh, or 230svh at 760 px wide or less.
  - The base CSS is the flat figure.
- **`--sc-top`.** It is the sticky header's height: 74 px, 69 px at 1150 px wide or less, 65 px at 760 px or less. These are the scroll scenes' `--scene-top` values, and a test keeps the two equal while `scroll-scenes.css` exists.
- **Lazy sheets.** They style only classes and states that JavaScript adds. A unit test checks every selector against what the first frames emit, and browser check 1 injects them into a JavaScript-off page and requires that no box moves.
- **The section reveal.** It never touches a showcase: `motion.tsx`'s `NEVER` holds `[data-showcase], .mk-sc-band, .sc-host`. The band that wraps a showcase carries `.mk-sc-band`.
- **Kamran's button.** It stays where it was: a floating button, on `/` only.
  - Below 760 px wide, the field's bottom controls keep a 76 px gutter at the inline end for it: its 52 px, its 16 px inset and an 8 px gap.
  - Showcase roots use `isolation: isolate`, so nothing inside them rises above the button.

## Budgets

**Judged in CI by unit tests** (`tests/marketing-showcase.test.ts`, gzipped after removing comments and whitespace). Measured on 28 October 2026:

| Budget | Limit | Measured |
|---|---|---|
| First-frame showcase CSS (`brain-stage`, `-field`, `-play`, `-anatomy`) | 18 KB | 17.0 KB (17,361 B), about 1 KB left |
| Page sheets (`marketing-proof`, `-home`, `-brain-pages`, `-pricing`) | 8 KB | 7.94 KB (8,132 B), about 60 B left |
| Lazy sheets, per page | 8 KB | `/` 4.3 KB (field and receipt), `/trainer-brain` 3.6 KB, `/demo` 1.6 KB |

**Reported by `npm run test:marketing-showcase`, and judged only with `SHOWCASE_JUDGE_METRICS=1`.** That switch is meant for real hardware, because CI and this sandbox have no GPU. The measurements are from WP7b's run on `0dfc1dd` (28 October): one run, 390×844 at a pixel ratio of 3, 4× CPU throttling, `?tier=full`.

| Metric | Budget | Measured |
|---|---|---|
| Field frame gap, p95 | 20 ms | 16.8 ms |
| Field engine work per frame, p95 | 4 ms | 1.8 ms |
| `load` to the STOP stamp | 2.5 s | 1,480 ms |
| Blocking time against the baseline (`4f35e5c`) | baseline + 100 ms. **Looser than SHOWCASE_DESIGN §1.6** (prototype + 50 ms) | `/` 345 (326), `/trainer-brain` 140 (107), `/demo` 112 (291), `/pricing` 293 (281) ms |
| Long tasks from mounting | at most 2, each 80 ms or less. **Looser than §1.6** (no task over 50 ms) | field: one, 78 ms. Anatomy: 291 and 79 ms, over budget (see "Open") |
| Chip and slider input latency | 200 ms | 72 ms (`/demo`), 80 ms (`/pricing`) |
| Engine chunks | `/` 45 KB plus the receipt 7 KB on demand; `/trainer-brain` 50 KB; `/demo` 37 KB | 41.3 + 4.4 KB, 46.1 KB, 34 KB |
| Shared JavaScript growth | 10 KB | +7.1 KB. A later run that included WP7a's deletions measured +3.1 KB |
| Global CSS added | 26 KB gross | +19.9 KB net, before WP7a removed 2,097 B (gzipped) from `marketing.css`. The later run measured +17.9 KB net |
| Showcase HTML on `/trainer-brain` | 25 KB | 18.9 KB |

The later run is fix round 1's, on 28 October: `d5d32b9` plus the board fix. It passed the whole check too.

**These are single runs in a shared container without a GPU, and they vary between runs.** For example, the anatomy's mount measured long tasks of 291 and 79 ms in WP7b's run and one task of 71 ms in the later run. Its scroll p95 measured 66.6 ms in WP7b's run and 16.8 ms in the later one. That is why the metrics are reported, not judged. Every CI run uploads `test-results/marketing-showcase.json` in the `homepage-call-evidence` artifact.

The two budgets looser than the showcase spec are deliberate. They are in the owner's FYI list, and tightening them is later work.

**Layout shift (CLS).**
- The budget is 0.001 or less.
- CI reports it but does not judge it yet. It becomes judged once it has passed in three PR runs in a row: then set `SHOWCASE_JUDGE_CLS: "1"` on the CI step.
- Measured on `0dfc1dd`:
  - `/` at 1440: 0.00016;
  - the `/demo` click, the `/trainer-brain` scroll and the `/pricing` sliders: 0;
  - `/` at 390: 0.153. The board's columns moved 92 px when it mounted on screen after the field had played about 10 s.
- Fix round 1 changed the board (`22d1a1a`): it keeps its room and re-sorts by FLIP, so it shifts nothing when it mounts. Its run then measured:
  - `/` at 390: 0.00040;
  - `/` at 1440: 0.00007;
  - the other three: 0.

  The rest comes from the streamed text's cursor.

**What waits for real hardware: the desktop pin and scroll paint cost.**
- WP3a measured the anatomy's scroll at 4× CPU throttling in this GPU-less sandbox (1440×900 and 390×844): p95 frame gap 33.3 ms, against the 20 ms budget. The prototype measures the same, 33.4 ms.
- The cost is compositing and painting, not script. Removing the plates, or the ghosts and the overlay, brings it to 16.8 ms. Unthrottled, every gap is 16.7–16.8 ms, and engine work stays at 1.5–2.3 ms a frame.
- WP7b's metrics pass found more in the same sandbox:

  | What | p95 frame gap | Tier reached |
  |---|---|---|
  | The anatomy while scrolling | 66.6 ms | `minimal` |
  | The `/trainer-brain` playground | 66.7 ms | `minimal` |
  | The `/demo` playground | 33.3 ms | `lite` |

- The tiers and the watchdog limit the damage on slow devices.
- Judge this on real hardware. The owner can also simply open `/` and `/trainer-brain` on their own phone and laptop.

## Checks

**Unit tests.** All of them run in `npm test`, so they gate deploys.
- **`tests/marketing-brain-traces.test.ts`** (14 tests). The traces against the product: see "Updating the traces".
- **`tests/marketing-showcase.test.ts`** (15 tests):
  - the head script and the island decide alike;
  - literal `import()`s only, and import hygiene;
  - no side effects at import;
  - the core: Pause stays correct through every pause reason, `data-sc-run`, the Kamran pause, and the shared overlay layer;
  - the CSS contract and tokens, ink-stage contrast, reduced motion without the always-on exclusion, the pre-state, the pin gate and the layer;
  - `--sc-top`, the lazy sheets and the CSS budgets;
  - static mode, the shared key, escaping, the options, and the island on the server.
- **`tests/marketing-field.test.ts`** (8) and **`tests/marketing-anatomy-play.test.ts`** (23). Each kind's first frame:
  - inner ids that start with the host id;
  - valid HTML, with no parser fix-up and therefore no hydration mismatch;
  - reserved sizes;
  - the honesty labels and the call to action;
  - the runtime's own CSS, its literal imports and the layer.
- **The page tests:** `tests/marketing-home.test.ts` (10) and `tests/marketing-brain-pages.test.ts` (12).
- **`node scripts/brain-traces.mjs --check`.** It fails when `traces.client.json` is stale. The trace test checks the same thing.

**Browser check.** `npm run test:marketing-showcase`, after `npm run build`.
- **How it runs.**
  - It runs `scripts/marketing-showcase-check.mjs` through `scripts/run-marketing-motion-check.mjs`, which starts `next start` against a platform stub.
  - Ports: `MOTION_WEB_PORT`/`MOTION_API_PORT`, default 3967/4967.
  - It uses local Chromium only, never a cloud browser.
- **The stub's two states.**
  1. It starts closed: sign-ups closed, every provider off.
  2. After the metrics, it turns to "assistant": sign-ups open, payments on, and Kamran's button on `/`.
- **What is judged.** Fifteen deterministic checks:
  1. JavaScript off: the first screen, and the lazy sheets moving no box;
  2. the LCP element is the H1 or the lede;
  3. CLS, reported only;
  4. overflow, duplicate ids and errors, at 360, 390 and 1440 wide, left to right and right to left;
  5. the lifecycle and fallbacks;
  6. frames and every pause reason;
  7. the watchdog;
  8. Kamran's button;
  9. receipts and overlays;
  10. the `/demo` playground;
  11. the `/trainer-brain` pin and "See it work";
  12. a three-round navigation loop;
  13. sign-ups closed and open;
  14. the `/pricing` calculators;
  15. the robot path.
- **The metrics pass** is reported only (see "Budgets"). CPU throttling applies only in that pass.
- **Variables:**

  | Variable | What it does |
  |---|---|
  | `SHOWCASE_PAGES` | narrows the pages |
  | `SHOWCASE_CHECKS` | runs a subset, for example `1,4,metrics` |
  | `SHOWCASE_RUNS` | loads per page in the metrics pass (median; default 1) |
  | `SHOWCASE_JUDGE_CLS` | judges layout shift |
  | `SHOWCASE_JUDGE_METRICS` | judges the metrics, on real hardware |
  | `SHOWCASE_BASELINE` | the baseline file to compare with |
  | `SHOWCASE_BASELINE_OUT` | writes a new baseline |
  | `SHOWCASE_OUT` | the results file (default `test-results/marketing-showcase.json`) |

- **The baseline.** `scripts/marketing-showcase-baseline.json` was measured on `4f35e5c`, the build before phase 1, on 28 October 2026, with `SHOWCASE_CHECKS=metrics SHOWCASE_RUNS=5`. Never measure it again on a later build.

**CI.** The `homepage-call` job runs the browser check as "Brain showcases on /, /trainer-brain, /demo and /pricing", on ports 3241/4241.
- It runs after the call check, even when that check fails, as long as the browser install succeeded.
- The job's limit went from 40 to 50 minutes. A full run takes about 6 minutes and must stay under 8.

**Other browser checks.**
- **`npm run test:browser`** (`scripts/browser-check.mjs`, in the `application` job):
  - opens `/demo?sc=on` and waits for `[data-showcase="play"][data-sc="on"]`;
  - plays the knee moment (t2), which must show "Training paused" and "No AI called";
  - plays Low recovery (t3), which must show "Not on yet";
  - clears the flag.
- **`npm run test:brand`** checks the hero field at 1440 and 390, the word budget, and the field in right to left.

**Results so far.**
- WP7b's full run on `0dfc1dd`: exit 0, 0 failures, 6 min 5 s. Its numbers are in "Budgets".
- The fallbacks, measured from `data-sc-ready`:

  | Case | Result |
  |---|---|
  | Hero chunks aborted | `off` after 374 ms |
  | Hero chunks stalled (the 6 s fallback) | `off` after 6,013 ms |
  | Anatomy, engine aborted | `off` 265 ms after coming near; flat only once entirely below the viewport |
  | Watchdog (`?tier=full&slow=30`) | stepped down to `lite` in 2.5 s |

## Updating the traces when the product changes

`tests/marketing-brain-traces.test.ts` keeps every sample true to the code. A failing block ends with "N of M checks failed (update the traces with the product: docs/features/brain-showcase.md)" and lists the checks that failed.

**What it compares.**
- **Wording quoted from the product:**
  - the Brain levels' names and summaries (`BRAIN_LEVELS`);
  - the plan slider's label and range, and the plan settings' defaults;
  - the platform's own sentences in `coaching-completion.ts` and `coaching-runtime.ts`;
  - the Today and feed wording;
  - the inbox card titles, "Your Brain drafted a reply" and "Waiting for your reply";
  - the voice lines;
  - what the Learner receives.
- **Safety:** every chat moment's categories, computed by `redFlagCategories()`. Each highlighted word sits in a phrase that triggers on its own, and there are nine categories (`RED_FLAG_CATEGORIES`).
- **Plan maths:** `decide()` equals `planConfidence()` and `planRoute()` across 480 combinations. Voice and recovery maths equal `reducedLoad()` and `reduceWhoopWorkout()`.
- **Lanes:** `decide()` reproduces every moment's lane, every variant and the totals.
- **Shared claims:**
  - "last 28 days";
  - "4.2%, inside your 5% cap";
  - "seven coaching specialists";
  - nine safety categories;
  - the setup numbers: 8 answers and 3 cases, 20 cases, about 6 minutes;
  - "Approve all" skips flagged rules;
  - the "Compare my replies" points.
- **Code references:** every specialist's `code` reference ("identifier · repo path") names a file that exists and contains that identifier.
- **The client copy and the copy scans:**
  - the client copy equals `stripForClient(full)`;
  - the brand is a token, never a literal;
  - every visible string passes the copy scans: no model or vendor name, hype words, the payout provider, AI-cost wording, hidden specialties, the C0 vocabulary or placeholders.
- **The rest:** the Not-on-yet shelf, both payments states, and `prepare()` purity.

**When a check fails:**
1. **Read which check failed.** Decide whether the product changed or the traces drifted. The product is the truth: change the traces to match it. Never change the product, or loosen a check, to keep a sample.
2. **Edit `apps/web/components/marketing/brain/data/traces.json`,** the canonical copy.
   - Write the brand as `{APP_NAME}`. The only literal brand is `format: "trainsyou-brain-trace@2"`.
   - Keep the sample labels and each AI step's `basis`.
   - Keep `code` references in the form "identifier · repo path".
   - Set `updated` to the day, and `basisCommit` to the commit you checked against.
3. **Regenerate the client copy.** Run `node scripts/brain-traces.mjs`, then `node scripts/brain-traces.mjs --check`. Never edit `traces.client.json` by hand: it is minified and has the internal fields removed.
4. **If a page states the same claim, change the registry and its test in the same commit.** The registry is `packages/contracts/src/marketing-content.ts`. The overlaps are:
   - "14 AI specialists and 11 code steps", which equals the roster counts;
   - the `play` note, which equals `labels.long`;
   - the `inside` note, which equals `labels.howWeCount`;
   - the `/demo` moments text, which states each moment's outcome from its lane;
   - the home flow window's moments (t1, t6 and t2).
5. **If a specialist or moment changes status,** for example the Meal planner goes live or a recovery flag arrives, update its `status`, `flag` or `needs`. Then update the shelf and payments-state expectations in the trace test, and the flag mapping in `options.ts`.
6. **Run the related tests:**
   ```sh
   node --import tsx --test tests/marketing-brain-traces.test.ts tests/marketing-showcase.test.ts \
     tests/marketing-field.test.ts tests/marketing-anatomy-play.test.ts \
     tests/marketing-home.test.ts tests/marketing-brain-pages.test.ts
   ```

`traces.json` and `traces.client.json` are under `apps/`, so a pull request that changes them runs CI. A pull request that only changes docs does not.

## Where it differs from the plan

- **Statuses need a second flag when payments are on.** "Try it on yourself" becomes live only when payments and the item's own `needs` flag (nutrition or voice) are both on. Otherwise those items would read as live while their provider is off.
- **The roots and their names.** Each render module exports `ROOT`, its root classes per kind. `RenderOptions` gains `label`, which becomes the root's `aria-label`.
- **The island handles every engine call to action** with one delegated handler, and falls back to `location.assign` where no app router is mounted (the unit tests' server renders).
- **The pin gate lives in `brain-stage.css`,** with `--sc-pin-len`, because only that sheet may define `--sc-*` tokens.
- **The field and the board carry the receipts' call to action** in an inert `<template class="mc-cta">`. Opening sign-ups therefore changes the key and remounts the island.
- **The platform's own safety rule is in every frame.** The safety lock's tip, the anatomy's plate (b) and the playground's Safety node name it: "Platform safety rules · {APP_NAME}. Can't switch off."
- **The playground.**
  - Its result column does not stick, because only the anatomy may use `position: sticky`.
  - "Step by step" and "Change a setting" are phone-only toggle buttons, not `<details>`.
  - Its first frame is the first moment played to its end. The engine adopts it rather than rebuilding it.
  - `attract` is opt-in, and only `/demo` turns it on.
- **The roster's "See it work" links point at the band, `#play`, not `#sc-play`.** With `#sc-play` the playground's top landed under the sticky header. The island still runs the link, because the target contains the playground.
- **The anatomy.**
  - It is flat by default, and the 3D figure applies only under the gate.
  - Its notes are `#<host id>-a` to `-j`.
  - Colour changes are instant, because only opacity and transforms may animate.
- **A blurred glow on lit nodes is kept** in the field and the playground (concept A's). The plan's risk table said "no blurred shadows". It is listed for a decision with the desktop paint cost.
- **Host and island share one keyed fragment.** The plan gave both the same key as siblings, which made React log a duplicate-key error under `next dev`.

## Open

These are open as of 28 October 2026, at `289ed10`.
- **Static mode in production:** the `compose.yaml` line above.
- **CLS is not judged in CI yet.** After the board fix the measured CLS is within 0.001, but CI judges it only after three PR runs in a row pass. Then set `SHOWCASE_JUDGE_CLS: "1"` on the CI step.
- **The anatomy's mount.** It measured long tasks of 291 and 79 ms in WP7b's first run (the budget is 2 tasks of 80 ms or less). The fix round then changed the mount (`26fbe25`, `289ed10`): it reads before it writes, inserts no node at mount or per frame, and skips layout writes that change nothing. WP7b's second round measures the final tree.
- **Frame budgets on real hardware,** above all the pinned anatomy's scroll paint. The sandbox measures a p95 of about 33 ms at 4× throttling, and its runs vary (see "Budgets").
- **Every route pays for the first-frame CSS.** Every route on the catch-all, the member app included, loads the four first-frame showcase sheets (17.0 KB gzipped) and the page sheets (7.94 KB). WP7a took 2.1 KB off `marketing.css`. The fix is splitting the marketing and app bundles, recommended for phase 2 or 3.
- **Later work:**
  - a TypeScript port of the engine;
  - in-browser safety rules for free text (the owner's default is no);
  - a recovery flag tied to `WHOOP_TRAINING_APPROVED`;
  - Arabic strings and measurement events (phase 3);
  - tightening the blocking-time and long-task budgets to §1.6.
