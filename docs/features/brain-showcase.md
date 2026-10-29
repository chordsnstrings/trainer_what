# Brain showcases

The scripted, animated pictures of a trainer's AI on the marketing site: the field and the board on `/`, the playground on `/trainer-brain` and `/demo`, and the decision anatomy on `/trainer-brain`. They show what happens to a member's message: code checks first, one AI specialist that code picks, code checks after, and the lane the moment ends in. Every moment is a sample. Nothing on these pages calls an AI model.

Built in phase 1 of the marketing revamp (28 October 2026, branch `claude/repository-overview-osejlw`, PR #105). The owner chose the recommendation on 27 October ("Go with your recommendation"). That accepted the defaults in `docs/marketing-revamp-2026-10-26/showcase/SHOWCASE_DESIGN.md` §8:
- the motion exception and the ink stage, both limited to `[data-showcase]`;
- showcases that follow reduced motion even while the marketing motion switch is `"always"`;
- "14 AI specialists and 11 code steps", published with "How we count";
- the Recovery rule and the Meal planner shown as "Not on yet". Since fix round 2 the Meal planner follows the nutrition flag ("Flags"); the Recovery rule stays off for all of phase 1.

The spec is `docs/marketing-revamp-2026-10-26/phase1/PLAN.md` §1. This page records what shipped, including where it differs from the plan. It was brought in line with the code on 28 October 2026, after two fix rounds, the final review and its fix pass (up to `41e3a4c`). Page structure and copy are in [marketing-site.md](marketing-site.md), and the motion rules in [marketing-motion.md](marketing-motion.md).

## What visitors see

| Showcase (kind) | Where | Host id | What it shows |
|---|---|---|---|
| Field (`field`) | `/`, the hero, between the H1 and the lede | `sc-field` | "A sample hour of your Brain". Sample members' messages pass the checks, one specialist and more checks, and land in a lane: Sent on its own, Your Today, or Training paused. Its first frame is the stop on Noura's knee: "STOP · No AI called" and the Paused bin. Every moment is a button that opens its receipt. A full lane shows the tiles that fit and rolls the rest into "+N". |
| Board (`board`) | `/`, band 2, "Change a setting. Watch it re-sort." (`#resort`) | `sc-board` | Every sample moment, sorted by the settings. The field and the board share one settings object, so a change of level or threshold in either re-sorts both. After a change, a short line under the columns says what moved, for example "Aisha and Fatima moved to …" or "No moment crossed your bar."; the reasons go to the announcement. |
| Playground (`play`) | `/trainer-brain` "Throw a moment at your Brain" (`#play`), and `/demo` under the page head | `sc-play` | 12 sample moments as chips. Settings change the result and show a before/now line: level, how sure a plan must be, supplements, too heavy, and the safety lock. A moment that does not run under the page's flags shows the card "Built and tested. Not on yet." and plays nothing. Free text finds the closest sample from a local keyword table (see "Free text"). On `/demo` it plays the first moment that runs once on its own (`attract`). |
| Decision anatomy (`anatomy`) | `/trainer-brain` "Anatomy of one decision" (`#decides`) | `sc-anatomy` | One reply, Omar's squat, taken apart into nine plates: (a) the message through (i) what the member reads, plus the correction (j). It pins under the header on screens 700 px tall or more, and shows flat plates otherwise. The What-ifs replay a popped knee, a plan change and level 1. A "Skip the figure" link comes before it. While the AI model is off it shows Omar's moment as not on yet ("Moments that are not on yet"). |

**Honesty labels, in every frame:**
- the chip "Sample · scripted · no AI model called";
- until trainers can publish to subscribers, a status strip that says why subscribers can't join (`prepare()` in `data.js`):
  - subscriber payments off, AI model on: "Subscribers can't join yet: subscriber payments are not on. You can run most of this on yourself with Try my AI.";
  - subscriber payments off, AI model off: "Subscribers can't join yet: subscriber payments are not on.";
  - subscriber payments on, publishing not on (sign-ups closed or the model off): "Subscribers can't join yet: publishing is not on yet.";
- a basis on each AI step: "From a test run", "From the app's tests", "Illustrative" or "Worked out by the app's own rules";
- the playground's banner: "Sample moments. Code steps use the app's own limits on sample data. AI steps replay answers from test runs or the app's tests, or are marked illustrative. No AI model is called on this page." It shows as two blocks, the first two sentences and the rest. The `/trainer-brain` play note and the `/demo` answer "Is this a real AI response?" carry the same sentence (the review's HON-8: three steps are tagged "From the app's tests");
- "Not on yet" on every specialist and moment the page's flags leave off ("Flags"). The Recovery rule and Low recovery (t3) are always off in phase 1.

**Kept out of search and structured data.**
- `data-nosnippet` on every root keeps the sample lines out of search snippets.
- Showcase text never reaches JSON-LD, `llms.txt`, `llms-full.txt` or the assistant facts. The `/demo` paragraphs about the 12 moments are drawn from the traces by the page itself; the registry's text for them names no moment.
- The claims that pages and showcases share are pinned by tests (see "Updating the traces").

## Files

**`apps/web/components/marketing/brain/engine/`.** The approved prototype's ES modules, ported as `.js` files with hand-written `.d.ts` files for their public surface. `types.d.ts` holds the shared types.
- **Pure modules:** no DOM, no CSS and nothing at import time, so the server and the tests import them.
  - `core.js`: data indexing, the one frame loop, scenes and pause reasons, tiers and the watchdog, reduced motion, the overlay layer with its live region, `inertOutside()` and `nextTask()`.
  - `decide.js`: the lane a moment ends in, from the settings, and whether it runs here (`off`).
  - `ui.js`: shared HTML atoms (nodes, lanes, the status strip, the call to action).
  - `data.js`: `prepare`, `stripForClient` and `NON_TEXT_KEYS`.
  - The render modules: `field.render.js` (field and board), `play.render.js` and `anatomy.render.js`.
- **Runtime modules:** browser only. Each imports its own stylesheet and its render module.
  - `field.js` (field and board), `play.js` and `anatomy.js`.
  - `receipt.js`, which `field.js` loads on demand.
  - `play.keys.js`, the playground's keyword table, which `play.js` loads on the first free-text input (about 5.9 KB gzipped, outside the `/demo` engine budget).
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
- The public availability flags: `publicAvailability()` in `apps/api/src/marketing.ts`, with the web fallback in `components/marketing/platform.ts`.

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
   - `BrainShowcase` calls `renderShowcase(kind, options, mode)`. That writes `<section class="… sc-stage" data-showcase="<kind>" data-sc="pre" data-nosnippet …>` around the render module's inner HTML.
   - The root is named by the page: `role="group"` with `aria-labelledby` when the band's H2 names it (so the band and the showcase are not two regions of one name), or `aria-label` when no page H2 does.
   - The HTML goes into `<div class="sc-host" id="<host id>">` through `dangerouslySetInnerHTML`. React owns the host and never looks inside it.
   - Host and island sit in one fragment keyed by the 32-bit FNV-1a hash of the HTML. A changed payload replaces both, for example a flag flipped inside the platform's 60 s cache.
   - Equal options give equal HTML, and the last 32 renders are cached.
2. **The first frame is final.**
   - Each kind's first frame is a finished picture: the field's stop on Noura's knee, the playground's first moment that runs played to its end, and the anatomy's complete figure.
   - Results the engine will play again carry `.sc-res`. They are hidden only under `html.sc-motion:not(.sc-late) [data-showcase][data-sc="pre"]`.
   - Controls render `disabled` until the engine wires them, the board's cards included. `brain-stage.css` gives disabled showcase controls their own look, because the site's disabled-button rule (`subscriber-public.css`) would otherwise draw them as white dashed boxes. "How we count" is a `<details>`, so it opens without the engine.
3. **The head script** (`head.ts`). It is inline in `<head>`, after the scroll scenes' script, and acts only on `SHOWCASE_PATHS` (`/`, `/trainer-brain` and `/demo`). Before the first paint it adds:
   - `sc-motion`, when neither reduced-motion setting is on and the visitor is not a robot (unless `?sc=on`);
   - `sc-pin`, under the same conditions, when IntersectionObserver and sticky positioning exist;
   - `sc-late`, 6 s later, if no island has set `html[data-sc-ready]`. The final frame then shows, and an engine that still mounts starts from it (`settled`).
4. **The island** (`mount.tsx`, which renders nothing).
   - **Before paint:** it sets `html[data-sc-ready]` and repeats the head script's test, which covers client-side navigation and settings changed since load. It starts the 6 s fallback the first time the root comes within 200 px of the viewport.
   - **After paint:** it snapshots the host's HTML. Then it waits for the load event, then idle (`requestIdleCallback` with a 1.5 s timeout, or 300 ms without it), then for the root to come within 200 px. Only then does it mark `performance.mark("sc-mount:<host id>")`, run `import()` and call `mount(root, {…options, kind, id, settled, navigate})`.
   - **Keyboard users get it sooner.** The page's first Tab mounts every showcase (each island hears it), and focus inside a host mounts that one at once, so a Tab never meets a control still disabled while it waits for its engine (the final review's A11Y-2).
5. **The engine.**
   - The field and the anatomy start their mount in a task of their own (`C.nextTask()`: `scheduler.yield()` where there is one), so the chunk's evaluation and the mount are never one long task at 4× CPU.
   - On its first frame it sets `data-sc="on"` and `data-sc-tier`. `data-sc-run` sits on the root exactly while a frame is scheduled for it.
6. **"Off" is final.**
   - The island restores the server frame and sets `data-sc="off"` in three cases: the engine has not set `"on"` 6 s after the root first came near, the chunk fails to load, or the engine fails to mount.
   - An engine that finishes mounting later is destroyed, never shown.
   - The anatomy also stops pinning (`data-sc-flat`), but only once it is entirely below the viewport, so nothing the visitor sees moves. Until then its pinned frame shows the complete figure.
7. **Changes and teardown.**
   - A change to either reduced-motion setting destroys the engine and mounts it again from the server frame. Focus that was inside goes back to the same control once it is armed again, or to the root (A11Y-12).
   - Unmounting (navigation, or Strict Mode's second mount) cancels everything pending and calls `destroy()`. That removes the overlay nodes it added, `html.sc-lock` and any inert marks. The island then puts the snapshot back.
   - The tier is kept for the document.
8. **Calls to action and run requests.**
   - Engine links carry `a[data-sc-cta]`. The island sends a plain left click through `router.push`, so the page does not reload.
   - The playground also runs a moment on an `sc:run` event (`{detail: {trace}}`) on its host, or on a click on `a[data-run]`, such as the roster's "See it work" links. It mounts at once if needed.

## What runs, and when it stops

- **One loop.** One `requestAnimationFrame` loop serves every showcase on the page.
  - The field and the playground draw their moving parts on one canvas each (`aria-hidden`). The anatomy has no canvas.
  - No CSS or SVG animation inside a showcase runs forever.
  - **Naps.** When no subscriber is due within the next two frames (loops under about 24 fps: the 12 fps breathing, the 10 fps reduced-motion field), the loop sleeps on a timer until the next one is due. `data-sc-run` stays on during a nap, and any kick ends it. 30 and 60 fps loops wake every frame, because the watchdog judges those gaps.
- **No frames while paused.** A showcase draws nothing while any pause reason holds:
  - off screen (the strip under the sticky header counts as off screen);
  - a hidden tab;
  - idle: 90 s without input, or 60 s on phones;
  - the visitor's Pause;
  - an open receipt;
  - keyboard focus on a moment in the field: it shows "Paused while you read", as an open receipt does, so no tile moves, rolls into "+N" or is replaced under the focus (A11Y-3);
  - a Kamran call: `html[data-mk-call]`, which `assistant-button.tsx` sets while the call panel is open ([kamran-assistant.md](kamran-assistant.md));
  - reduced motion.
- **Idle.** It counts from the later of the last input and the moment the showcase last started running. Time in another tab, off screen or in the back/forward cache is not idle time (`pageshow` with `persisted` resets the clock). Input ends any idle pause, for every showcase, but never the visitor's own Pause.
- **Pause controls.** Every Pause control is `[data-sc-pause]` and carries no `aria-pressed`: its label says what a press does ("Pause", "Play", or "Play the field" for the reduced-motion field), so a screen reader hears "Pause, button" or "Play, button". Motion that lasts longer than 5 s can always be paused (WCAG 2.2.2). The anatomy keeps the visitor's Pause through a change of mode (a phone turned, a window resized; ENG-4).
- **Tiers.**

  | Tier | Pixel ratio, at most | Frame rate | Detail |
  |---|---|---|---|
  | `full` | 2 | 60 fps | Every ghost and halo |
  | `lite` | 1.5 | 30 fps | Fewer ghosts, no halos |
  | `minimal` | 1 | 30 fps | No ghosts |

  - **Starting tier:** `lite` on a device with 4 cores or fewer, 3 GB of memory or less, or Save-Data. Safari and every iPhone or iPad browser start at `full`, because WebKit reports neither memory nor a reliable core count; the watchdog decides there.
  - **The watchdog** judges frame gaps under 250 ms in windows of 2 s, against the frame its tier asks for: 16.7 ms at `full`, 33.3 ms at 30 fps.
    - It steps down one tier when a window's median gap is over 1.2 frames (20 ms at `full`, 40 ms at 30 fps), or when two windows in a row stutter: 1 frame in 20 (of 30 or more) over 1.5 frames (25 ms, 50 ms). One isolated long frame cannot step it down.
    - A browser that caps frames at 30 Hz (iOS Low Power Mode, Chrome's Energy Saver) gives steady 33.3 ms gaps. That is what `lite` asks for, so it takes `full` to `lite` and holds there, never `minimal` (ENG-2).
    - It steps back up after two good windows in a row (fewer than 1 frame in 40 over 1.5 of the tier above's frames). It never goes above the starting tier, and only into a tier left once: a tier left twice holds for the document. A step up wakes subscribers that slept for the lower tier.
    - It does not judge frames until 1 s after the load event, in the 500 ms after the loop starts or the tier changes, right after a nap, or in the 300 ms after a scroll starts, a resize, or any change to `<html>`'s attributes (a restyle of the whole document, such as the consent bar).
    - The tier holds across client-side navigation.
- **The check's switches.** `?tier=full|lite|minimal` and `?slow=<ms>` (which burns that long on every frame to force the watchdog) work only in automated browsers (`navigator.webdriver`).

## Reduced motion

Showcases follow the device's `prefers-reduced-motion` and the member's own `<html data-reduce-motion="on">`, whatever `MARKETING_MOTION` says. This is the owner's showcase exception (SHOWCASE_DESIGN.md §8, decision 2), and the showcase CSS carries no `MOTION_ALWAYS_EXCLUDED`.

With either setting:
- there is no `sc-motion` or `sc-pin`: the first frame is final, and the anatomy shows flat plates;
- the field starts paused on its still frame, on "Play the field". If the visitor presses it, the field steps to a new moment every 2.5 s instead of playing the hour, with no ghosts and no streamed text;
- the playground resolves each run at once and never plays on its own;
- nothing is replayed by script either: the field's count and lane replays (Web Animations, which the CSS switch does not reach) are skipped (ENG-13);
- `app/brain-stage.css` stops every animation and transition under `[data-showcase]`.

## Robots, automated browsers and `?sc=on`

- **Robots never get the engine.** A robot is `navigator.webdriver`, or a user agent that matches `/bot[/)-]|bot [0-9]|crawl|spider|slurp|preview|lighthouse/i`: "bot" must be a product token such as "Googlebot/2.1" or "Slackbot 1.0", never the "bot" inside a phone's model name that in-app browsers send (a CUBOT phone's Instagram or Facebook WebView). `head.ts` and `mount.tsx` use the same pattern, and a test keeps the two equal and runs 17 user agents through both. The scroll scenes' `scenes-head.ts` and `scene-mount.tsx` use it too ([scroll-scenes.md](scroll-scenes.md)).
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

**Production wiring.**
- The host runs `docker compose --env-file runtime.env` (`infra/digitalocean/host.py`), and `runtime.env` only fills in the variables that `compose.yaml` names.
- The `web` service names `MARKETING_SHOWCASE: ${MARKETING_SHOWCASE:-}`. An empty value means live.
- `tests/test_host_deployment.py` checks the rendered Compose configuration: the variable reaches `web`, empty by default.
- The controller refuses `env_file`, so a variable that `compose.yaml` does not name never reaches the site.

**Switching:**
1. Set `MARKETING_SHOWCASE=static` in `runtime.env`, from the DigitalOcean console.
2. Request "Re-apply runtime settings" on the Super admin "Host and backups" page, or run `hostops.py reapply` from the console ([infra-ops.md](infra-ops.md)). Either one recreates the serving release with the current `runtime.env`. A plain container restart does not re-read it.
3. To go back, remove the line (or set it to `live`) and re-apply.

## The overlay layer

- **What lives there.** Receipts opened as a dialog or a phone sheet, their backdrop, the field's phone settings sheet and the one polite live region mount in `<div class="sc-layer" data-showcase="layer">`. On desktop the field opens its receipts inside its own zoom instead.
- **When it comes.** The field, the board and the anatomy create it when they first need it: a receipt, the phone sheet or an announcement. So they insert no node at mount. The playground creates it when it mounts.
- **Where it goes.** It is the last child of the marketing root (`.mk`), so the `--mk-*` tokens reach it. It is not on `<body>`.
- **Stacking.** It is fixed at z-index 70, above the consent bar (45) and Kamran's button (60).
- **Lifetime.** It is reference-counted and removed with the last showcase.
- **Modal receipts and the phone sheet.** While a receipt is open as a dialog or a sheet, or the field's settings sheet is open on a phone (`role="dialog"`, `aria-modal="true"` while it sits in the layer; back to `role="group"` in the controls row on desktop):
  - everything outside the layer is inert (`C.inertOutside()`, which undoes only what it set), and `html.sc-lock` stops page scrolling, with `scrollbar-gutter: stable` so nothing shifts when the scrollbar goes;
  - Esc and Tab are heard on the document in the capture phase, so Esc closes it wherever focus is (a tap on its text moves focus to the body) and Tab wraps inside;
  - closing it lifts the inert marks before focus returns to the opener. Closing, or `destroy()`, removes the lock, so leaving a page with a receipt open cannot lock the next page.
- **The inline receipt** (the field's zoom on desktop) makes the field's covered parts inert. The field's header and its Pause stay reachable. The box takes focus from a click on its text (`tabindex="-1"`), so its keys stay its own.
- **Turning a phone.** A receipt open in the zoom when the layout turns into the phone's (a phone turned upright, a window narrowed) reopens as the phone's sheet from its lane's bin, so the hero is never left zoomed and inert (ENG-1).
- **The phone settings sheet** is never taller than the viewport and scrolls within, so at 400% zoom (320×256) its title and Done stay in reach (A11Y-6).
- **Announcements.** The live region speaks only for changes the visitor caused.

## Flags

`showcaseOptions(platform, cta, extra)` builds one options object from the platform facts. The server render and the island get the same object.

| Option | From | What it changes |
|---|---|---|
| `appName` | the platform name | Replaces `{APP_NAME}` in the traces, for example "Platform safety rules · trainsyou. Can't switch off." |
| `cta` | `teachCta(registrationOpen)` | "Teach your AI — free" → `/signup`, or "Join early access — free" → `/get-started#early-access` while sign-ups are closed. The field and the board carry it in their frame, so the key changes with it. |
| `flags.publish` | `gatesState(platform, PUBLISH_GATES) === true`: sign-ups, subscriber payments and the AI model all on, as the status panel reads them | Until it is on, items stay "Try it on yourself" and the status strip shows. Once it is on, the strip goes and "Try it on yourself" becomes live, unless the item's own flag (below) leaves it not on yet. |
| `flags.payments` | `availability.payments` | Picks the strip's wording while publishing is off: it names subscriber payments while they are off, publishing once they are on. |
| `flags.model` | `availability.model` | While the AI model is off, every AI specialist (and every code step that uses AI, such as the Examiner) is not on yet, and so is every moment one of them plays. Safety rules and the other code steps stay as they are. The strip leaves out "Try my AI". |
| `flags.nutrition`, `flags.mealPhotos`, `flags.voice` | `availability` | An item that `needs` a flag is not on yet while that flag is off, whatever the others say. The Meal planner needs `nutrition`. The meal photo reader and the meal-photo moment (t4) need `mealPhotos`. The voice lines, the set logger and the voice-session moment (t5) need `voice`. |
| `flags.payouts` | `availability.payouts` | Passed with the others. No showcase status uses it. |
| `flags.recovery` | fixed `false` in phase 1 | Low recovery (t3) and the Recovery rule stay "Not on yet", whatever the platform says. |
| `heading`, `labelledBy`, `attract` | the page | `heading: false` leaves the H2 to the page, and `labelledBy` names it. `attract` makes the `/demo` playground play once on its own. |

**Where the flags come from.** `publicAvailability()` (`apps/api/src/marketing.ts`):
- `nutrition` is the model plus `NUTRITION_ENABLED`, and in production also `NUTRITION_SCOPE_APPROVED`, as activation needs;
- `mealPhotos` is `nutrition` plus `MEAL_PHOTOS_ENABLED` and `MODEL_VISION_ENABLED`, the product's own meal-photo switches (`meal-capture.ts`); `tests/marketing-api.test.ts` holds the rule;
- the web fallback (`components/marketing/platform.ts`) has every flag off;
- a fixture without `model` counts as on, one without `mealPhotos` as off, and one without `publish` as payments and the model; `showcaseOptions()` always passes all three.

The `flag` field names what each off item waits for: `WHOOP_TRAINING_APPROVED` for the Recovery rule and Low recovery, `NUTRITION_ENABLED && NUTRITION_SCOPE_APPROVED` for the Meal planner.

**How the data is prepared.** `prepare(raw, {appName, flags})` deep-clones its input before filling it, so one render's name and flags never leak into the next. `tests/marketing-brain-traces.test.ts` checks this with trainsyou → Acme → trainsyou, and with payments off → on → off. Another of its tests walks every status and the strip through the flags: payments, publishing, voice, nutrition, meal photos and the AI model.

## Moments that are not on yet

**The rule.** A moment does not run here (`decide()`'s `off`) when it is Low recovery while its flag is off, or when one of its steps, under the current settings, runs a specialist the page's flags leave not on yet. With the AI model off that is every moment but four: the three safety stops (the knee, the pregnancy and the chest pain in Arabic) and the creatine question.

**The playground and the anatomy show it built and tested, never played** (the lead's decision L9):
- **Playground chips** carry "Not on yet". A press shows the card "Built and tested. Not on yet." with "Specialist not on yet: <name>." or "Specialists not on yet: <names>.", lights those specialists, plays nothing and announces "<moment>: Built and tested. Not on yet.". Low recovery keeps its own card: its tested lane, dashed, with the tests' details.
- **A setting change** that sends the moment to a specialist that is not on yet shows the same card and announces the same line. For example, with the model off, turning supplements off hands the creatine question to the Draft writer, not on yet.
- **"Throw them all"** draws such moments with a "Not on yet" chip and no specialist, and the totals line ends " · N not on yet".
- **The first frame and the `/demo` attract run** play the first moment that runs: Omar's, or else the first chip that runs in the specialty's order (the knee stop while the model is off).
- **The anatomy**, with Omar's moment off (the AI model off):
  - the screen-reader summary reads "A sample figure, taken apart in layers. Omar's message passes four code checks. The AI specialist code would pick for it is not on yet, so nothing is sent. The notes list every layer.";
  - plates (f) to (i) read "Not on yet" or "Not reached", and plate (i) "Nothing is sent while it is not on yet.";
  - the card reads "Omar · Squats felt easy", with a dashed "Not on yet" in place of the lane;
  - notes (f) to (j) say what happens "once it is on", and (f)'s count reads "None is on yet.";
  - a What-if whose moment does not run adds " · Not on yet" to its button. Pinned on phones the suffix takes a second line in the button, without the dot, so the What-ifs keep the three lines row 4 holds (four below 359 px, as with the model on). On one line they needed a fourth, and "Omar's reply" covered the caption (28 October 2026; `.ca-wb small` in the phone pin block, the dot is an `aria-hidden` span). Row 4 is 204 px below 359 px, where "Omar's reply" no longer fits beside level 1; it was 204 px only below 341 px, so from 341 to 358 px both states covered the caption by 28 px. At 320–362 px the "Sample · scripted · no AI model called" pill now wraps instead of running under Pause.
- **The anatomy's ghost stacks** run only moments that are on, and no pill that is not on yet gets a member tag.

**The field and the board keep their sample hour.** Every moment still plays its sample there, but its receipt says so: a "Not on yet" chip in the header beside the lane its sample plays to, and the status line in its last section (L4).
- The field's "Not on yet" shelf lists only what is not on yet of the Meal planner and the Recovery rule (L2).
- Once nutrition is on, the Meal planner joins row 3 beside the Set logger on desktop. Phones leave it out, because the row has no room.
- An off specialist carries a small "Not on yet" chip on its lower edge, so its name keeps the node's width (L3).

**The roster** shows "See it work" only for a moment that runs: with the model off, Memory has no link (ENG-6).

**`/demo`'s "The 12 sample moments"** are built from the same prepared traces and `decide()` (`momentLines()` in `pages/demo.tsx`), so they follow the flags too.

## Free text

- The playground matches typed text against a local keyword table (`play.keys.js`) only: English and Arabic folding, red-flag rows first (pregnancy; urgent symptoms, blood pressure, sugar, self-harm and eating disorders; pain and injury), then specific words.
- When no sample is close, it says "No sample is close to that. This page can't read new messages: pick a sample moment.", plays nothing and announces only that line. There is no fallback to a sample.
- On the product's own safety corpus, the table misses none of the 252 messages `redFlagCategories()` flags, and it over-flags 84 of 733 others, so it is at least as cautious. A unit test runs the same corpus.
- In-browser safety rules stay off (the owner's default).

## Accessibility

**Keyboard.**
- Field: every member is a tab stop, and Up and Down also move between them. Each lane's tiles keep one roving stop.
- Level controls are radios moved with the arrow keys. In right to left, the arrow points the way the choice moves (ENG-15).
- The phone bins' list closes when focus moves on, on Esc and on an outside tap. A receipt opened from it keeps it open, and focus returns to the tile.
- The anatomy: Tab runs through notes (a) to (j), then the What-ifs (shown while they hold focus), then Pause. On narrow pinned phones, focus on a note the step hides moves to the step's note, or to the figure (A11Y-8).
- The playground: Back focuses "Throw them all", and a mini focuses its chip. Phone chips keep their whole focus ring.
- The sticky header hides no focused control: the public root's `scroll-padding-block-start` is the header's height plus 8 px ([brand.md](brand.md)).

**Names and announcements.**
- One polite live region per document, used only for changes the visitor caused. The `/demo` attract run announces nothing.
- No `<output>`, `role="status"` or second live region inside a showcase. Slider readouts are `aria-hidden` text, and each slider carries `aria-valuetext`.
- The field's lanes and the board's columns are not landmarks: each list is named by its heading (A11Y-20). Each phone bin's name starts with its lane's name, for example "Training paused …, open the list" (A11Y-9).
- The board's level note is read out. Its hidden sizers are not.
- Headings: on `/demo`, "What each step said" is an H2 under the page's H1; on `/trainer-brain` it is an H3 under the band's H2. With its own heading the anatomy's H2 is `#<host id>-title`, apart from its notes `#<host id>-a` to `-j`.

**Targets.** Phone controls have hit areas at least 44 px tall, from `min-block-size` or a transparent `::before` or `::after` box. Two deviations from PLAN §4.4 remain, both above WCAG 2.5.8's 24 px:
- the field's level radios are 28 px wide on phones, because there is no room inside Kamran's gutter at 360 px;
- the anatomy's notes on pinned phones are 22 px tall, because 44 px would break the pinned layout.

Desktop controls are unchanged at 20–38 px.

**Forced colours.** The field and board radios and switch, the playground's chips and segmented choices, and the What-ifs mark their chosen state with system colours (`Highlight` and `HighlightText`).

**Reflow, zoom and spacing.**
- Nothing overflows sideways at 320 px.
- At 400% zoom the phone settings sheet scrolls within ("The overlay layer").
- Under WCAG text-spacing overrides, the field's lanes show what fits plus "+N". Without JavaScript the still frame's lanes are still cut.

**Right to left (`?lang=ar`).**
- The field's drawn layer (canvas and rails) mirrors, and the anatomy's leader lines start from the side that faces the notes.
- English sample text takes its direction from its first letter (`unicode-bidi: plaintext`, in `brain-stage.css`), so "Up in weight?" keeps its question mark at the end. Arabic samples carry their own `dir`.

## Styles and the ink stage

- **The ink stage.** Showcases sit on a dark stage, `--sc-stage` `#171917`, with nodes `#202320` and text `#f3f4f0`. This is the one dark surface on the always-light public pages, and it is allowed only under `[data-showcase]` (SHOWCASE_DESIGN.md §8, decision 1).
  - Product surfaces inside a stage (the phone, the Today card) keep the product's light tokens.
  - On the stage, Pace (`--sc-pace`, `--sc-ai-on`, `--sc-learn`) also colours text, lanes and the focus ring, on ink only.
- **Contrast.** `tests/marketing-showcase.test.ts` computes it:
  - text 4.5:1 or more on the stage, the nodes and the tints;
  - controls and lane colours 3:1 or more;
  - ink text on every lane colour 4.5:1 or more.

  The same test fails on any dark background outside `[data-showcase]`. Skipped nodes and steps keep their text at the muted colour and dim only their icons (7.82:1 at the least, measured in fix round 2).
  The test reads the `--sc-*` tokens, so an inherited page colour slips past it: the app's global `small` (`--muted`, `#616660`) measured 3.0:1 on the stage in the anatomy's "Not on yet". Text on the stage takes an `--sc-*` colour; that suffix now uses `--sc-muted`, measured 7.82:1 on the stage at 390 and 1440, and `inherit` on a pressed button, 16.00:1 (28 October 2026). In forced colours a pressed What-if takes the system highlight in `brain-anatomy.css` too: `brain-stage.css`'s rule had the same weight and lost to the later sheet, leaving a 1.1:1 fill in a light contrast theme.
- **Canvases and SVG layers start at `width="0" height="0"`** (the field's rails and canvas, the playground's canvas) until the engine sizes them. Without the attributes they have the default 300 × 150 box, wider than a 320 px screen's content, and `/demo` scrolled sideways by 8 px in CI, until the engine sized the canvas (about half a second in local runs) (28 October 2026).
- **Tokens.** `--sc-*` tokens are defined once, in `brain-stage.css`. `--sc-ease`, `--sc-enter` and `--sc-spring` point at the matching `--mk-*` tokens, and no showcase sheet defines a `--mk-*` token. `--sc-mono` is the system monospace stack, so there are no new font files.
- **Scoping.** Every rule sits under `[data-showcase]` (the overlay layer included) or an `html.sc-*` state. Page sheets use their own prefixes: `.mk-hm-`, `.mk-tb-`, `.mk-dm-`, `.mk-pr-` and `.mk-pf-`. There is no CSS nesting, and the properties are logical throughout.
- **What moves.** Only `opacity`, transforms and `stroke-dashoffset` animate, and nothing is `infinite`.
- **The pin gate.**
  - The anatomy pins only under `html.sc-pin [data-showcase="anatomy"]:not([data-sc-flat])`, inside `@media (min-height: 700px)`. All of `anatomy.run.css` sits inside that media query, so no pinned-only rule reaches the flat figure.
  - Its height is set before the first paint from `--sc-pin-len`: 420svh, or 230svh at 760 px wide or less.
  - The base CSS is the flat figure.
- **`--sc-top`.** It is the sticky header's height: 74 px, 69 px at 1150 px wide or less, 65 px at 760 px or less. These are the scroll scenes' `--scene-top` values, and a test keeps the two equal while `scroll-scenes.css` exists. The public root's scroll padding is these heights plus 8 px.
- **No root `:has()`.** Since fix round 2, no stylesheet hangs `:has()` on `:root`, `html` or `body` (`tests/root-marks.test.ts`). Such rules made Chromium restyle the whole document whenever a showcase added or removed an element; at 4× CPU that, not paint, was what slowed the playground (WP7b's 66.7 ms) and the field after a scroll. Surfaces now mark `<html>` instead (`components/root-marks.tsx`; [brand.md](brand.md), [dark-mode.md](dark-mode.md)).
- **Lazy sheets.** They style only classes and states that JavaScript adds. A unit test checks every selector against what the first frames emit, and browser check 1 injects them into a JavaScript-off page and requires that no box moves.
- **The section reveal.** It never touches a showcase: `motion.tsx`'s `NEVER` holds `[data-showcase], .mk-sc-band, .sc-host`. The band that wraps a showcase carries `.mk-sc-band`.
- **Kamran's button.** It stays where it was: a floating button, on `/` only.
  - Below 760 px wide, the field's bottom controls keep a 76 px gutter at the inline end for it: its 52 px, its 16 px inset and an 8 px gap.
  - Showcase roots use `isolation: isolate`, so nothing inside them rises above the button.

## Budgets

**Judged in CI by unit tests** (`tests/marketing-showcase.test.ts`, gzipped after removing comments and whitespace). Measured by the docs pass on 28 October 2026 with the test's own arithmetic, on `41e3a4c`. Re-measured the same way on the final commit (after `451080b`, `3ac6da5`, `da806d9`, `8e3dd8a` and the What-if, forced-colour and sample-pill rules): first-frame 18,039 B (3,547 + 6,000 + 2,884 + 5,608), 393 B left; page sheets 8,125 B, 67 B left:

| Budget | Limit | Measured |
|---|---|---|
| First-frame showcase CSS (`brain-stage`, `-field`, `-play`, `-anatomy`) | 18 KB (18,432 B) | 17.5 KB (17,911 B: 3,547 + 6,000 + 2,834 + 5,530), 521 B left |
| Page sheets (`marketing-proof`, `-home`, `-brain-pages`, `-pricing`) | 8 KB (8,192 B) | 7.93 KB (8,118 B), 74 B left |
| Lazy sheets, per page | 8 KB | `/` 4.4 KB (field and receipt), `/trainer-brain` 3.7 KB, `/demo` 1.6 KB |

**Reported by `npm run test:marketing-showcase`, and judged only with `SHOWCASE_JUDGE_METRICS=1`.** That switch is meant for real hardware: CI and this sandbox have no GPU, and with software compositing (SwiftShader here) the check reports frame gaps without judging them. The figures below are from the final fix pass's two metrics runs on 28 October (E, on a worktree build made at 17:21 UTC from the tree of the time): three loads per page at about 17:26 UTC, and seven loads of `/` and `/trainer-brain` at 17:32 UTC. Figures are medians, apart from mounts and frames, which come from each run's first load. Both runs: 390×844 at a pixel ratio of 3, 4× CPU throttling, `?tier=full`.

| Metric | Budget | Measured (three loads; seven loads) |
|---|---|---|
| Field frame gap, p95, after a scroll down 200 px and back | 20 ms | 16.8 ms (tier `full`); 16.8 ms (tier `lite` by the end) |
| The same, with the field partly under the sticky header | 20 ms | 16.8 ms; 16.7 ms |
| Anatomy frame gap, p95: idle, and while scrolling through the pin | 20 ms | 16.7 and 16.8 ms; 16.8 and 16.8 ms (tier `full`) |
| Playground frame gap, p95 (one knee run, start to end) | 20 ms | `/trainer-brain` 16.8 ms, `/demo` 16.8 ms |
| Engine work per frame, p95 | 4 ms | 0.6–2.8 ms everywhere |
| `load` to the STOP stamp | 2.5 s | 1,531 ms; 1,477 ms |
| The engine's own blocking time, from the response's end to 5 s after `load` | 100 ms | `/` 0, `/trainer-brain` 0, `/demo` 2 ms; `/` 0 ms (0–34 over the seven loads), `/trainer-brain` 0 |
| Page blocking time (TBT), same window | the build before phase 1, served in the same session (`SHOWCASE_BASELINE_URL`), + 100 ms | Not judged: no baseline build was served. Reported: `/` 314 ms; 339 ms (221–407 over the seven loads). `/trainer-brain` 149; 177 ms. `/demo` 199 ms, `/pricing` 296 ms |
| Long tasks from mounting | at most 2, each 80 ms or less. **Looser than SHOWCASE_DESIGN §1.6** (no task over 50 ms) | Field [51, 60], board none, anatomy [50], both playgrounds none. Over the seven loads the field stayed within budget, and the anatomy went over in 2: [86, 117] and [91, 92] (see "Open") |
| Chip and slider input latency | 200 ms | 72 ms (`/demo`, the knee chip), 56 ms (`/pricing`) |
| Engine chunks | `/` 45 KB plus the receipt 7 KB on demand; `/trainer-brain` 50 KB; `/demo` 37 KB | 43.7 + 4.5 KB, 48.1 KB, 34.9 KB |
| Shared JavaScript growth | 10 KB | +4.5 KB (835.1 KB against 830.6) |
| Global CSS added | 26 KB gross | +18.6 KB net (104.6 KB against 86.1) |
| Showcase HTML on `/trainer-brain` | 25 KB | 16.7 KB (HTML 8.1 + RSC 8.6) |
| Largest paint (reported) | — | `/` 748 ms, `/trainer-brain` 608, `/demo` 492, `/pricing` 524 |

**How blocking time is measured since the final fix pass.** It runs from the response's end, not from the first paint, which the framework's own script task falls on either side of. The engine's share (long tasks in frames that ran its chunks or the island's) is judged against a fixed 100 ms. The page's total is judged only against the build before phase 1 measured in the same session, interleaved run by run. The number stored in `scripts/marketing-showcase-baseline.json` (`/` 326 ms) came from another machine and the first paint, so it is shown for reference only: measured the same way, the baseline build sat over it too (the final review's PERF-4).

**Mount windows.** A long task counts as a mount task only between the island's `sc-mount:<id>` mark (or the root coming near) and `"on"` + 1 s, and only in a frame that ran the engine's or the island's script, or only rendered. The consent bar opens on the first scroll, so the check opens it first (a 60 px scroll and back) and reports its long tasks on its own ("consent": none on the four pages in these runs).

**These are runs in a shared container without a GPU, and they vary.** The anatomy's mount, for example, measured 291 and 79 ms in WP7b's first run, [158, 52, 67], [223, 61, 58] and [114, 50, 50] in fix round 2, [57, 62] in P's final-pass run and [50] in E's. Part of fix round 2's figures was the consent bar's restyle of the whole document, which no longer happens on marketing pages ([analytics-consent.md](analytics-consent.md)). Every CI run uploads `test-results/marketing-showcase.json` in the `homepage-call-evidence` artifact.

The long-task budget looser than the showcase spec is deliberate. It is in the owner's FYI list, and tightening it is later work.

**Layout shift (CLS).**
- The budget is 0.001 or less.
- CI reports it but does not judge it yet. It becomes judged once it has passed in three PR runs in a row: then set `SHOWCASE_JUDGE_CLS: "1"` on the CI step.
- Measured in the final fix pass (E's run of 17:11 UTC on 28 October):
  - `/` at 390: 0.00039, and at 1440: 0.00007, both from the streamed text's cursor (`span.sc-caret`);
  - the `/demo` click, the `/trainer-brain` anatomy scroll and the `/pricing` sliders: 0.
- History: `/` at 390 measured 0.153 on `0dfc1dd`, when the board's columns moved 92 px as it mounted. Fix round 1 (`22d1a1a`) made the board keep its room and re-sort by FLIP. The final pass also reserves the room of the board's longest "what moved" line, so a setting change no longer grows or shrinks the board (ENG-5): check 16 measured its height at 1,638.5 px (390) and 703.7 px (1440) through five changes.

**What waits for real hardware.**
- **The frame budgets.** They are judged only on GPU hardware. E's final runs measured every showcase within 20 ms, but earlier runs in the same container did not:
  - the pinned anatomy's scroll measured a p95 of 33.3–50 ms through fix round 2 (WP3a, fix round 2's B and D), the same before and after the root-`:has()` fix. Its frames are bound by raster and compositing; script stays at about 2–4 ms. The prototype measured the same 33.4 ms. Why E's runs measured 16.8 ms is not established: the eleven full runs after them measured 16.7–16.8 ms in six, 33.3 ms in four and 50 ms in the run on the final commit's What-if change;
  - the field after a scroll and back measured 33.3 ms in 1 of 3 runs in fix round 2: the per-frame commit of its pixel-ratio-2 canvas, a CPU copy without a GPU (the final review's PERF-5).
- **Corrected 28 October.** The WP7b table this page used to show (the `/trainer-brain` playground at 66.7 ms and tier `minimal`, the `/demo` playground at 33.3 ms and `lite`) was not paint. It was the whole-document restyle of the `:root:has()` rules ("Styles and the ink stage"). Fix round 2 removed them, and both playgrounds then measured 16.7–16.8 ms at tier `full`.
- **The anatomy's mount**: see "Open".
- **The watchdog's two-window stutter rule.** In this container at 4× CPU the field sits at about 1 frame in 30 over 25 ms with no event at all, near the old one-window line. Real-device data may tune it.
- The tiers and the watchdog limit the damage on slow devices. The owner can also simply open `/` and `/trainer-brain` on their own phone and laptop.

## Checks

**Unit tests.** All of them run in `npm test`, so they gate deploys.
- **`tests/marketing-brain-traces.test.ts`** (15 tests). The traces against the product: see "Updating the traces".
- **`tests/marketing-showcase.test.ts`** (19):
  - the head script and the island decide alike, and the robot pattern against 17 user agents;
  - literal `import()`s only, and import hygiene;
  - no side effects at import;
  - the core, on a made-up clock: Pause through every pause reason (no `aria-pressed`), `data-sc-run`, the Kamran pause, the shared overlay layer and `inertOutside()`, idle after another tab or the back/forward cache, naps, the watchdog (median, two windows, holds, the 30 Hz cap, stepping up), and one frame callback a frame;
  - `?tier=` and `?slow=` for automated browsers only;
  - the CSS contract and tokens, ink-stage contrast, reduced motion without the always-on exclusion, the pre-state, the pin gate and the layer;
  - `--sc-top`, the lazy sheets and the CSS budgets;
  - static mode, the shared key, escaping, the options (the `publish`, `model` and `mealPhotos` flags included) and the island on the server;
  - English sample text in right to left;
  - the first Tab mounting every showcase, and focus kept through a reduced-motion change.
- **`tests/marketing-field.test.ts`** (11) and **`tests/marketing-anatomy-play.test.ts`** (28). Each kind's first frame:
  - inner ids that start with the host id;
  - valid HTML, with no parser fix-up and therefore no hydration mismatch;
  - reserved sizes, the board's "what moved" line included;
  - the honesty labels and the call to action;
  - moments that are not on yet: the playground's chips and cards, the anatomy with the model off, the ghost stacks, the field's shelf;
  - the runtime's own CSS, its literal imports and the layer;
  - code contracts for the runtimes: modal receipts and the sheet hear Esc and Tab on the document, a receipt in the zoom turns into the phone's sheet, keyboard focus holds the field, the anatomy keeps the visitor's Pause through a change of mode, free text has no fallback.
- **The page tests:** `tests/marketing-home.test.ts` (12) and `tests/marketing-brain-pages.test.ts` (12, including the `/demo` moments paragraphs in six flag states).
- **`tests/root-marks.test.ts`** (7) guards against `:has()` on the root, and `tests/marketing-api.test.ts` holds the meal-photo availability rule.
- **`node scripts/brain-traces.mjs --check`.** It fails when `traces.client.json` is stale. The trace test checks the same thing.

**Browser check.** `npm run test:marketing-showcase`, after `npm run build`.
- **How it runs.**
  - It runs `scripts/marketing-showcase-check.mjs` through `scripts/run-marketing-motion-check.mjs`, which starts `next start` against a platform stub.
  - Ports: `MOTION_WEB_PORT`/`MOTION_API_PORT`, default 3967/4967.
  - It uses local Chromium only, never a cloud browser.
- **The stub's two states.**
  1. It starts closed: sign-ups closed, every provider off, the AI model included.
  2. After the closed checks and the metrics, it turns to "assistant": sign-ups open, payments on, the model on, and Kamran's button on `/`.
- **What is judged.** Sixteen deterministic checks:
  1. JavaScript off: the first screen, and the lazy sheets moving no box at 390 and 1440 (on a second try as well);
  2. the largest paint is the H1 or the lede, at 390 and 1440;
  3. CLS, reported only;
  4. overflow, duplicate ids and errors, at 320, 360, 390 and 1440 wide, left to right and right to left. On a failure it names the elements that stick out past the screen and are not clipped, with their left and right edges: that is how CI's 2 px at 320 px was traced to the home H1's first line in the fallback font ([marketing-site.md](marketing-site.md), "Hero");
  5. the lifecycle and fallbacks;
  6. frames and every pause reason; after Pause the control reads "Play…" with no `aria-pressed`;
  7. the watchdog;
  8. Kamran's button;
  9. receipts and overlays: focus, Esc, Pause; with the consent bar open, the phone receipt and settings sheet on top; nothing left after leaving; a receipt open in the zoom at 844×390 becomes the phone's sheet when turned to 390×844;
  10. the `/demo` playground under the page's flags, twice: in the closed pass with the model off (the off cards, and the creatine question's supplements switch handing it to the Draft writer and back) and in the open pass with the model on (the before/now line and the deload lane); the knee, low recovery, free text (a close sample, and none for "hello there") and the keyboard in both;
  11. the `/trainer-brain` pin and "See it work";
  12. a three-round navigation loop;
  13. sign-ups closed and open;
  14. the `/pricing` calculators;
  15. the robot path;
  16. at 1280×900, Tab from the top of `/` and of `/trainer-brain` reaches the board's controls and the playground's chips, and the board's height holds through a change of each of its controls.
- **The metrics pass** is reported only (see "Budgets"). CPU throttling applies only in that pass. It samples frames after a scroll down 200 px and back, adds a field sample partly under the header, takes the playground's sample over one knee run, and times input on the knee chip (it runs with the model off, and sits in the phone's first six).
- **Variables:**

  | Variable | What it does |
  |---|---|
  | `SHOWCASE_PAGES` | narrows the pages |
  | `SHOWCASE_CHECKS` | runs a subset, for example `1,4,metrics` |
  | `SHOWCASE_RUNS` | loads per page in the metrics pass (median; default 1, or 5 when judging) |
  | `SHOWCASE_JUDGE_CLS` | judges layout shift |
  | `SHOWCASE_JUDGE_METRICS` | judges the metrics, on real hardware |
  | `SHOWCASE_BASELINE_URL` | the build before phase 1, served alongside, for page blocking time measured in the same session |
  | `SHOWCASE_BASELINE` | the baseline file to compare with |
  | `SHOWCASE_BASELINE_OUT` | writes a new baseline |
  | `SHOWCASE_OUT` | the results file (default `test-results/marketing-showcase.json`) |

- **The baseline.** `scripts/marketing-showcase-baseline.json` was measured on `4f35e5c`, the build before phase 1, on 28 October 2026, with `SHOWCASE_CHECKS=metrics SHOWCASE_RUNS=5`. Its JavaScript and CSS sizes are still the comparison for shared growth; its blocking times are shown for reference only. Never measure it again on a later build.

**CI.** The `homepage-call` job runs the browser check as "Brain showcases on /, /trainer-brain, /demo and /pricing", on ports 3241/4241.
- It runs after the call check, even when that check fails, as long as the browser install succeeded.
- The job's limit went from 40 to 50 minutes. Full runs in this sandbox took 6 min 5 s to 6 min 27 s, before the final pass added step 16 and the open pass of step 10. A full run must stay under 8 minutes.

**Other browser checks.**
- **`npm run test:browser`** (`scripts/browser-check.mjs`, in the `application` job):
  - opens `/demo?sc=on` and waits for `[data-showcase="play"][data-sc="on"]`;
  - plays the knee moment (t2), which must show "Training paused" and "No AI called";
  - plays Low recovery (t3), which must show "Not on yet";
  - clears the flag.
- **`npm run test:brand`** checks the hero field at 1440 and 390, the word budget, and the field in right to left.

**Results so far** (local Chromium in this sandbox, except the bullet marked CI; nothing here is a real-hardware result).
- WP7b's full run on `0dfc1dd`: exit 0, 0 failures, 6 min 5 s.
- Fix round 2 (A2), three full runs on `c91de92`: 1 or 2 failures each, both since dealt with. The anatomy's Pause still wrote `aria-pressed` (fixed in the final pass, L1). One run overflowed by 8 px at `/demo` 320; the final pass traced it to the header's `nav.mk-mobile-nav`, outside the showcases (corrected 28 October: CI on `5cd8e2d` failed on the same 8 px, and the lead traced it to the playground canvas's default 300 px width; fixed in `386cabd`, and gone from CI on `a9b9f4d`; "Styles"). Step 7 stepped down in 2.5 s; step 12 counted one callback per frame in every round.
- The final fix pass, 28 October:
  - P's full run on `488b9d1`, while E's playground work was still in progress: exit 1, with 4 failures, all in the playground. The lazy sheets moved `.bp-out`, `.bp-change` and `.bp-set` by 9 px at 1440 with JavaScript off on `/trainer-brain` and `/demo`; a `/demo` setting change showed an empty before/now line; and in the open pass at 390 the largest paint on `/demo` was the longer `p.bp-banner`. Everything else passed.
  - E's last judged runs, on worktree builds made at 17:05 and 17:21 UTC: steps 3, 4, 6, 9, 10 (both passes), 11 and 16 passed at 17:11, and step 10 passed again beside the metrics at 17:26. They did not include steps 1, 5, 7, 8, 12, 14 or 15.
  - E's two metrics runs passed (reported figures in "Budgets").
  - E's full `npm test` at the end of the pass: 2,094 tests, 2,093 passed, 1 skipped, 0 failed (22 min 43 s).
- **The milestone verification** (PLAN §4.6, 28 October): the full check passed on `da806d9` twice (421 s and 414 s) and on `218ea40` (402 s). The full record is in `docs/COMPLETION_STAGES.md`.
- **The final commit's What-if change**, before its colour rule (build `mvsqc7kr`, 28 October): the full check passed in 440 s. Its metrics are reported only, and this run was slower than the ten before it, with 6 figures over budget against 0–1: the home field 33.3 ms at tier `lite`; the anatomy scroll 50 ms with 4.4 ms of engine work; its mount [77, 88]; `/demo`'s playground 33.3 ms with 5.8 ms of work.
- **The final tree** (build `mvsrrl9d`, with the colour rule and the last three fixes: the 341–358 px What-if row, forced colours, the sample pill): the full check passed in 446 s. Its metrics were again slower than the morning's runs, on `/demo` too, where the final diff applies no rule (the playground 49.9 ms with 7 ms of work, its mount [108, 68]), so this container's load is the likelier cause; they are judged on GPU hardware.
- **CI, PR #105** (the `homepage-call` step, closed and open passes):
  - on `5cd8e2d` it failed 4 lines: `/` overflowed 2 px at 320 in both directions (closed pass); `/demo` overflowed 8 px at 320 right to left (closed pass; the playground canvas's default 300 px width); and in the open pass `/demo`'s largest paint at 390 was the banner. The `/demo` lines were fixed by the canvas and SVG size attributes ("Styles") and by drawing the banner as two blocks, its first two sentences and the rest, so the H1 is the largest paint at 390 and 1440;
  - on `a9b9f4d` only `/`'s 2 px remained. It never reproduced locally. Step 4 then named `span.mk-hm-l1` at [16, 321.8]: the H1 in the fallback font. Fixed in the home CSS;
  - on `e2a8cef` the step passed in 6 min 26 s.
- The fallbacks, measured by WP7b from `data-sc-ready`:

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
  - what the Learner receives;
  - the notice a member sees when their week's sessions are adjusted on their own (t8, from `message-templates.ts` and `brain-plans.ts`, word for word).
- **Safety:** every chat moment's categories, computed by `redFlagCategories()`. Each highlighted word sits in a phrase that triggers on its own, and there are nine categories (`RED_FLAG_CATEGORIES`).
- **Plan maths:** `decide()` equals `planConfidence()` and `planRoute()` across 2,000 combinations, every slider position from 50 to 99 included. A score that rounding would lift onto a bar it misses shows one decimal below the bar ("70.5% · your bar 71%"). Voice and recovery maths equal `reducedLoad()` and `reduceWhoopWorkout()`.
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
- **The rest:** the honesty strings exactly as SHOWCASE_DESIGN.md §1.5 now gives them, the strip and every status through the flags (payments, publishing, voice, nutrition, meal photos and the AI model), and `prepare()` purity.

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
   - the `play` note and the `/demo` answer "Is this a real AI response?", which equal `labels.long`;
   - the `inside` note, which equals `labels.howWeCount`;
   - the home flow window's moments (t1, t6 and t2);
   - the `/trainer-brain` sample ledger and trace chain, which the brain-pages test ties to t6's rule and t1's load, increase, reps in reserve and cap.

   The `/demo` moments paragraphs need no edit: `momentLines()` computes them from the traces. Their registry text names no moment, and the test checks that.
5. **If a specialist or moment changes status,** for example the Meal planner goes live or a recovery flag arrives, update its `status`, `flag` or `needs` (`nutrition`, `mealPhotos` or `voice`). Then update the flag-state expectations in the trace test and the flag mapping in `options.ts`. A new public flag also needs `publicAvailability()`, the contracts type, the web fallback in `platform.ts` and `tests/marketing-api.test.ts`.
6. **Run the related tests:**
   ```sh
   node --import tsx --test tests/marketing-brain-traces.test.ts tests/marketing-showcase.test.ts \
     tests/marketing-field.test.ts tests/marketing-anatomy-play.test.ts \
     tests/marketing-home.test.ts tests/marketing-brain-pages.test.ts
   ```

`traces.json` and `traces.client.json` are under `apps/`, so a pull request that changes them runs CI. A pull request that only changes docs does not.

## Where it differs from the plan

- **Statuses wait for publishing, not for payments alone.** "Try it on yourself" becomes live only once trainers can publish (sign-ups, subscriber payments and the AI model: `PUBLISH_GATES`, as the status panel reads them), and only for items whose own `needs` flag is on (the final review's HON-3). PLAN §1.5 tied the statuses to payments.
- **The AI model and meal photos are flags too.** With the model off every AI specialist is not on yet. Meal photos have their own public flag, because the product has its own switches for them (L10).
- **Moments that are not on yet never play** in the playground or the anatomy (the lead's decision, L9). The field and the board keep their sample hour, and their receipts say "Not on yet".
- **Pause carries no `aria-pressed`.** The plan asked for "a correct `aria-pressed`". A name that changes ("Pause", "Play") with no pressed state was chosen instead, because a fixed name would break WCAG 2.5.3 against the visible "Play" label or drop "Play the field".
- **The anatomy's plate (f) shows the seven coaching specialists**, the Meal planner among them (dashed until nutrition is on), with no separate shelf, as SHOWCASE_DESIGN.md §(f) specifies. The field's shelf follows the flags instead of always holding the Meal planner and the Recovery rule.
- **Free text never falls back to a sample** ("Free text").
- **Two target sizes stay under 44 px** ("Accessibility").
- **The watchdog steps back up** after two good windows, judges each tier against its own frame rate, and ignores page events. The plan's risk table had a watchdog that only steps down.
- **The roots and their names.** Each render module exports `ROOT`, its root classes per kind. `RenderOptions` gains `label`, which becomes the root's `aria-label`; a root labelled by its band is `role="group"`.
- **The island handles every engine call to action** with one delegated handler, and falls back to `location.assign` where no app router is mounted (the unit tests' server renders).
- **The pin gate lives in `brain-stage.css`,** with `--sc-pin-len`, because only that sheet may define `--sc-*` tokens.
- **The field and the board carry the receipts' call to action** in an inert `<template class="mc-cta">`. Opening sign-ups therefore changes the key and remounts the island.
- **The platform's own safety rule is in every frame.** The safety lock's tip, the anatomy's plate (b) and the playground's Safety node name it: "Platform safety rules · {APP_NAME}. Can't switch off."
- **The playground.**
  - Its result column does not stick, because only the anatomy may use `position: sticky`.
  - "Step by step" and "Change a setting" are phone-only toggle buttons, not `<details>`. "How we count" is a `<details>`.
  - Its first frame is the first moment that runs, played to its end. The engine adopts it rather than rebuilding it.
  - `attract` is opt-in, and only `/demo` turns it on.
- **The roster's "See it work" links point at the band, `#play`, not `#sc-play`.** With `#sc-play` the playground's top landed under the sticky header. The island still runs the link, because the target contains the playground.
- **The anatomy.**
  - It is flat by default, and the 3D figure applies only under the gate.
  - Its notes are `#<host id>-a` to `-j`, and its own H2 (when it has one) is `#<host id>-title`.
  - Colour changes are instant, because only opacity and transforms may animate.
- **A blurred glow on lit nodes is kept** in the field and the playground (concept A's). The plan's risk table said "no blurred shadows". It is listed for a decision with the desktop paint cost.
- **Host and island share one keyed fragment.** The plan gave both the same key as siblings, which made React log a duplicate-key error under `next dev`.

## Open

These are open as of 28 October 2026, at `41e3a4c`. The first item then, the full check on the final tree, is removed: it passed on `218ea40` (402 s), on the What-if change before its colour rule (440 s), and on the final tree (446 s) ("Results so far").
- **CLS is not judged in CI yet.** The measured CLS is within 0.001, but CI judges it only after three PR runs in a row pass. Then set `SHOWCASE_JUDGE_CLS: "1"` on the CI step.
- **The anatomy's mount at 4× CPU.** It went over budget in about 2 of 7 loads in this GPU-less container: [86, 117] and [91, 92] in E's seven-load run. What remains is the page restyle forced inside `figure()`, plus the rendering task after it: over 8 profiled loads, `figure()` took 54–84 ms after its yield, 18–42 ms of it style and layout forced by `data-sc="on"`, and the next rendering task 63–85 ms of page restyle and paint. Moving the style flush into a task of its own would paint an in-between "on" frame before the figure's writes, so it was not done. Measure again on GPU hardware or a quiet machine before changing more. With more than one load, the metrics judge mounts and frames from the first load only, so one outlier can pass or fail a run by chance.
- **Frame budgets on real hardware,** above all the pinned anatomy's scroll ("What waits for real hardware").
- **Page blocking time is not judged** unless the build before phase 1 is served alongside (`SHOWCASE_BASELINE_URL`).
- **The playground's scroll and focus (E's files).**
  - `.bp-diagram` keeps `scroll-margin-block-start: calc(var(--sc-top) + 8px)` (`brain-play.css`, and again in `play.run.css`), which now adds to the public root's scroll padding: `play.js`'s scroll to the diagram lands about 164 px down instead of 82. Dropping the margin also saves first-frame bytes.
  - The rest of the final review's A11Y-1: the playground's focus moves with `preventScroll` (`play.js`), and the check has no Shift+Tab walk.
- **Other owners' areas.** While the consent bar is open it covers the anatomy's Pause at 1440×900 and on phones. (Corrected 28 October: the 8 px overflow at `/demo` 320 was the playground canvas's default width, not the header's `nav.mk-mobile-nav`; fixed, "Styles".)
- **For the lead or the owner.**
  - With the model off, 5 of the 6 chips a phone shows in the playground read "Not on yet" (t1, t6, t8, t5 and t10); only the knee runs. That is accurate. Ordering runnable moments first would change the specialty's order, which tests pin.
  - Full lanes show fewer tiles plus "+N" (a design change from the storyboard).
  - The two target-size deviations ("Accessibility") are recorded in PLAN §4.4 (amended 28 October, A11Y-10); the owner can still ask for a design change instead.
  - The watchdog's two-window rule may need tuning on real devices.
- **Every route pays for the first-frame CSS.** Every route on the catch-all, the member app included, loads the four first-frame showcase sheets (17.6 KB gzipped on the final commit) and the page sheets (7.93 KB). The catch-all route also ships about 835 KB gzipped of JavaScript to every marketing page, workspace and member chunks included. Splitting the marketing and app bundles (a marketing route group) is the lever, recommended for phase 2 or 3.
- **Later work:**
  - a TypeScript port of the engine;
  - in-browser safety rules for free text (the owner's default is no);
  - a recovery flag tied to `WHOOP_TRAINING_APPROVED`;
  - Arabic strings and measurement events (phase 3);
  - tightening the long-task budget to §1.6.
