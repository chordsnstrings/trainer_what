# Phase 1 implementation plan: "/", "/trainer-brain", "/demo", "/pricing" (revised after review)

**Basis**
- The owner's decision of 27 Oct 2026: "Go with your recommendation".
- PLAYBOOK.md sections C0, C1, C3, C6 and C15.
- SHOWCASE_DESIGN.md §1.4–1.6, §2, §4, §5 and §8.
- Maps 1–4.
- The review of this plan. Every P0, P1 and P2 item is applied; the changelog at the end maps each item to where it landed.

**Branch and PR.**
- The work goes in one PR to `main`, from the phase-1 integration branch `claude/repository-overview-osejlw`.
- That branch is at `1aa7f04`. Its code equals `main` (`4f35e5c`); only `CLAUDE_HANDOFF.md` differs.

**What I checked myself.** No repository file was changed while planning or revising. Every fact below that the maps or the review did not already state, I checked in the tree, and each one cites its line. For this revision I re-read these:
- `scenes-head.ts:20`, `scroll-scenes.css:34-58` and `motion.tsx:55, 99-105`.
- `marketing.css:8-11, 72-76, 83, 93, 2997-3005`.
- `site.tsx:57-70, 114, 338, 1561`, `platform.ts:28-38, 59-73`, `app/[[...path]]/page.tsx:311` and `islands.tsx:431-445`.
- The test lines cited in §2 (existing-test table), `scripts/browser-check.mjs:80-89`, `AGENTS.md:35` and `CLAUDE.md:9`.
- `infra/digitalocean/hostops.py:712-718, 862` (the host's `runtime.env`).
- In the prototypes: `c-anatomy.css:10, 286`, `concept-a/src/pages-product.mjs:621, 1683-1688`, `pages-core.mjs:32-35`, `brain-core.js:310`, `a-field.js:199, 323, 1227`, and the brand and "floor" strings in `traces.json`.

---

## 0. Decisions at a glance

1. **The Brain engine.**
   - It is the verified prototype's ES modules, ported almost verbatim as `.js` files with hand-written `.d.ts` files, in `apps/web/components/marketing/brain/engine/`.
   - Each showcase kind is split in two:
     - a pure **render module** (`<kind>.render.js`): static HTML only, with no CSS and no DOM. The server, `roster.tsx` and the tests import it.
     - a client **runtime module** (`<kind>.js`): it imports its own CSS and its render module.
   - Runtime modules load only through a literal `import()` inside one client island, in this order: `load` → idle → within 200 px of the viewport.
   - No engine file contains a non-literal `import()`, a `fetch`, or `new URL(…, import.meta.url)`.
   - Phase 1 does not rewrite the engine in TypeScript.
2. **The first frame.**
   - On the server, the render modules produce an HTML string. It goes into a host `<div>` that React owns, through `dangerouslySetInnerHTML`.
   - React never touches what is inside that `<div>`; the engine owns it.
   - `destroy()` puts the server's markup back.
   - The host and the island share one key, an inline FNV-1a hash of the HTML, so a changed payload replaces both.
3. **The traces.**
   - They live in `apps/web/components/marketing/brain/data/`: `traces.json` is the canonical copy, and `traces.client.json` is generated from it with internal fields removed.
   - `prepare()` deep-clones its input and never mutates it.
   - `tests/marketing-brain-traces.test.ts` ports `verify.mts` into `npm test`, so it gates deploys.
4. **Styles.**
   - Four global sheets hold the first frame (`app/brain-*.css`). Their budget is 18 KB gzipped or less in total, set from measurement.
   - Runtime sheets are imported only by the runtime modules, and they style only classes and states that JavaScript adds.
   - Four page sheets: `app/marketing-{proof,home,brain-pages,pricing}.css`.
   - Receipts and the phone settings sheet mount in one overlay layer inside the marketing root, not on `<body>`.
   - Showcase CSS has its own contract test.
   - No CSS nesting.
5. **The pin on /trainer-brain.**
   - C's anatomy keeps its own CSS sticky pin. A new head script decides before the first paint whether to pin (`html.sc-pin`).
   - The prototype's `--header-h` becomes `--sc-top`. It is defined in `brain-stage.css` with the header heights from `scroll-scenes.css:34-46`.
   - If the engine fails, the section flattens, but only while it is entirely below the viewport.
   - After phase 1, no page mounts the scroll-scenes engine. It is parked, not deleted; phase 2 decides its fate.
6. **The home walkthrough.**
   - It becomes A's 8-step stepper that the visitor controls (PLAYBOOK decision 4).
   - The journey band and its pin leave `/`. `/how-it-works` does not change.
7. **The call to action.**
   - "Teach your AI — free" (when sign-ups are closed: "Join early access — free") appears on the four pages only: in the header, hero, closing panel, showcases and calculators.
   - Each page switches to it in the merge that ships the page.
   - `claimCta` and "Start coaching" stay everywhere else until phase 2: other pages, the sign-in and sign-up header, and Kamran's hand-off. This keeps the sign-up path untouched.
8. **Copy.**
   - Every page claim lives in the registry.
   - Showcase microcopy and the traces stay in the engine and its data, and out of JSON-LD and the llms files.
   - Tests pin the few claims that appear in both places.
   - No placeholder text from the prototypes ships, and a test fails on any.
9. **Flags.**
   - They come from `PublicPlatform.availability` and reach the engine as island options.
   - Recovery is fixed off.
   - Any string that is only true while payments are off is derived from the payments flag.
10. **Kamran** does not change: a floating button, on `/` only.
    - The field pauses while a call is open.
    - The field's phone controls keep clear of his button.
11. **No new analytics events** (phase 3).
12. **Fonts.** No new font files; `--sc-mono` uses the system monospace stack. C's anatomy and B's pricing are re-skinned to A's tokens, so the brand question in decision 13 does not arise.
13. **House rules kept.**
    - The home introduction stays visible, as the answer to the first home FAQ.
    - `/trainer-brain`, `/demo` and `/pricing` keep "In short", breadcrumbs, related links and "Last updated".
14. **Robots and automated browsers get the static frame.**
    - The engine never mounts for them unless the URL carries `?sc=on`. That override persists for the tab.
    - The existing CI checks therefore run the static path. The new showcase check uses `?sc=on`.
15. **A kill switch.** Setting `MARKETING_SHOWCASE=static` on the web service makes every showcase render as its static frame, with no engine. It needs a re-apply of the release, not a build (corrected 28 Oct: a restart does not re-read `runtime.env`).
16. **Every merge stays green.**
    - Each work package fixes, in the same merge, the existing assertions it breaks.
    - Each page's registry entry merges together with its page.

---

## 1. Architecture

### 1.1 The engine: where, in what format, how it loads

**Location:** `apps/web/components/marketing/brain/` (SHOWCASE_DESIGN.md:230). The name `components/marketing/showcase.tsx` is already taken by the /features screens.

**Format:** `.js` ES modules, each with a `.d.ts` for its public functions.
- **Why the `.d.ts` files:** the root `tsconfig.json` is strict and has no `allowJs`, while `apps/web/tsconfig.json` has `allowJs: true`. So the typecheck only needs declarations for the public surface. The review confirmed this with TypeScript 7.0.2, exit 0. tsx loads ESM `.js` and JSON from `apps/web`.
- **Why not TypeScript:** these modules are byte-for-byte the code that `verify.mts` passed (4,418 checks) and that the prototype QA passed. A strict port takes 4–6 days and risks changing behaviour (Map 4 P1). Deferred.

| Production file | Source | Changes required |
|---|---|---|
| `engine/core.js` | `prototypes/shared/brain/brain-core.js` | (a) `scene().set()` syncs the buttons and `onState` on every change in pause reasons (the stale-Pause bug, `:205-213`).<br>(b) `load()` takes data and never fetches. The fetch and `new URL("traces.client.json", import.meta.url)` (`:58`) go **in the first commit**.<br>(c) `prefetch(loader, el, ms)` takes a loader such as `() => import("./receipt.js")`, never a URL (`:310`). Also **in the first commit**.<br>(d) Remove `?recovery` and `?motion`. Honour `?tier` and `?slow` only when `navigator.webdriver` is true.<br>(e) The header strip comes from `--sc-top`.<br>(f) A new pause reason, "call", while `html[data-mk-call]` is set.<br>(g) One live region per document, in the overlay layer, reused.<br>(h) `destroyAll` stops the loop.<br>(i) The tier persists for the document lifetime.<br>(j) The `reduced()` cache resets when either reduced-motion setting changes (`:90-94`).<br>(k) `data-sc-run` sits on the root exactly while a loop frame is scheduled.<br>(l) `layer(root)` creates or reuses the overlay layer (§1.4), reference-counted.<br>Nothing touches the DOM at import time. |
| `engine/decide.js` | `brain-decide.js` | Flags come from options, never from the URL. |
| `engine/ui.js` | `brain-ui.js` | The CTA label and link come from options. CTA links carry `data-sc-cta`. |
| `engine/data.js` (new, pure) | — | `prepare(raw, {appName, flags})`, which deep-clones first; `stripForClient(full)`; `NON_TEXT_KEYS` (§1.3). |
| `engine/field.render.js` | `concept-a/site/assets/a-field.js`, its static half | `renderStatic` for `field` and `board`.<br>Every inner id is prefixed with the host id.<br>Slots are reserved for lanes, tiles and counts, and two lines for the streamed AI text (`span.mc-cr`).<br>The CTA comes from options.<br>No `"signup.html"` fallbacks (`:326`, `:339`). |
| `engine/field.js` | `a-field.js`, its runtime half | It imports `./field.run.css` and `./field.render.js`.<br>Teardown. Module state shared between field and board is reference-counted.<br>Remove `DBG` (`:179`, `:929`) and `root.__mc` (`:1229`).<br>No `new URL(..., import.meta.url)` (`:199`, `:1227`): CSS comes through a static import, receipts through `import("./receipt.js")`, and the prefetch uses a loader.<br>Fix the reduced-motion `aria-pressed` bug (`:1243-1253`).<br>The board clears its own `data-sc="pre"`.<br>No live region of its own (`:173`).<br>The phone settings sheet (`.mc-sheet`, fixed at `a-brain.css:363`) mounts in the overlay layer. |
| `engine/receipt.js` | `brain-anatomy.js` lines 1–156 (`open`, `slots`, `receiptHTML`) | Runtime only; it imports `./receipt.css`.<br>Drop `stack`, `fig` and `mount` (`:160-304`).<br>The backdrop and the dialog mount in the overlay layer, not on `<body>` (`:96-106`).<br>`html.ba-lock` becomes `html.sc-lock`. `destroy()` removes both nodes and the lock.<br>The CTA comes from options. |
| `engine/play.render.js` | `brain-play.js`, its static half | Inner ids come from the host id; `:38`, `:44` and `:88` render `undefined-*` today.<br>The CTA comes from options (COPY `:10-17`).<br>The result reserves its height. |
| `engine/play.js` | `brain-play.js`, its runtime half | It imports `./play.run.css` and `./play.render.js`.<br>Teardown.<br>`mount` sets `data-sc="on"` (the prototype removes the attribute).<br>`run(traceId)`. |
| `engine/anatomy.render.js` | `concept-c/src/showcase/c-anatomy.js`, its static half | It returns the root's inner HTML only: no outer `<section … data-sc-module … id="anatomy">` and no skip link (`:152-156`).<br>A `labelledBy` option; `heading: false`.<br>C's skin removed (§1.4). |
| `engine/anatomy.js` | `c-anatomy.js`, its runtime half | It imports `./anatomy.run.css` and `./anatomy.render.js`.<br>Teardown of the window scroll and hashchange listeners.<br>It uses `--sc-top`.<br>No live region of its own (`:178`). |
| `engine/{field.run,receipt,play.run,anatomy.run}.css` | — | Runtime-only CSS. Only the runtime modules import it, and it targets only classes and states that JavaScript adds. |

**How it loads.** The client island `brain/mount.tsx` holds one map of literal imports. It names the runtime modules only:
```ts
const LOADERS = { field: () => import("./engine/field.js"), board: () => import("./engine/field.js"),
                  play: () => import("./engine/play.js"), anatomy: () => import("./engine/anatomy.js") };
```
- **Why this is split into its own chunk.** An `import()` in client code gets its own chunk (`node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md:97-129`). The review measured this with Turbopack 16.3.6:
  - CSS reached through a client `import()` stays out of the first HTML. Precedent: `assistant-button.tsx:69` → `assistant-panel.tsx:3`.
  - CSS imported by anything a Server Component imports is emitted as `<link rel="stylesheet" data-precedence="next">` in the first HTML of every route on the catch-all. That is the reason for the render/runtime split.
- **What not to use:**
  - Never import a runtime module statically from a client file, from `site.tsx`, or from anything a server file imports. A Server Component's dynamic import is not split (`lazy-loading.md:60`).
  - No `next/dynamic`: it loses the server-rendered frame, `ssr:false` is not allowed in Server Components (`:66`, `:94-95`), and it has no idle or viewport gate.
  - No `next/script`.
- **Why a URL-taking prefetch is banned.** The verbatim core fails `next build` with two errors: `Can't resolve 'traces.client.json'` from `brain-core.js:58`, and `Can't resolve <dynamic>` from `prefetch(url)` → `import(url)` at `:310`. `a-field.js:199` and `:1227` use the same pattern.
- **Timing** (SHOWCASE_DESIGN.md:242-245):
  1. `readyState === "complete"` or the `load` event;
  2. `requestIdleCallback(start, {timeout: 1500})`, or `setTimeout(start, 300)` where that is missing;
  3. an IntersectionObserver with `rootMargin: "200px"`;
  4. `import()`, then `mount()`.

  Robots and automated browsers without the `?sc=on` override skip all of this (§1.2).
- **Server use.**
  - `brain/render.ts`, `brain/roster.tsx` and the unit tests import only the render modules, `core`, `decide`, `ui`, `data` and the JSON.
  - A WP1 test walks the static imports from `site.tsx` and `render.ts`, and fails on any `.css` file or runtime module. Under tsx a `.css` import throws `SyntaxError: Unexpected token '.'`, which would break every suite that renders `MarketingSite`.
  - Importing the render, core, decide, ui and data modules under Node has no side effects (a unit test).

### 1.2 First frame and runtime lifecycle (the contract every showcase follows)

```tsx
// brain/showcase.tsx (Server Component)
const html = renderShowcase(kind, { ...options, kind, id }, mode);
const k = fnv1a(html); // inline 32-bit FNV-1a; node:crypto and server-only fail the import guard (marketing-motion-sitewide.test.ts:661-666)
<div key={k} id={id} className="sc-host" dangerouslySetInnerHTML={{ __html: html }} />
{mode === "live" && <ShowcaseMount key={k} id={id} kind={kind} options={options} />}
```

**The server component**
- `html` is the showcase root plus the static inner HTML. Example root: `<section class="mc sc-stage" data-showcase="field" data-sc="pre" data-nosnippet aria-label=…>`.
  - When the page supplies the H2, the root uses `aria-labelledby` instead of `aria-label`.
  - `data-nosnippet` keeps sample chat lines out of search snippets.
- In static mode (below), the root carries `data-sc="off"`; the anatomy root also carries `data-sc-flat`.
- The result is cached in module scope per `(kind, options, id, mode)`, at most 32 entries.
- React owns only `.sc-host`. Given the same `__html`, it writes nothing to the DOM.
- The host and the island carry the same key. A changed payload replaces both: for example, a flag flipping inside the 60 s platform cache (`platform.ts:59-73`) followed by a link to the same page. The old island's cleanup restores its snapshot into the old, detached host it captured, never into the new one.

**`ShowcaseMount` (`"use client"`, renders `null`)**
- **`useLayoutEffect`:**
  - Set `html[data-sc-ready]`.
  - Never remove `sc-late`. Once it is set, visitors have already seen the final frame, so the engine mounts with `settled: true` and starts from that frame instead of hiding results again.
  - Repeat the head-script test. This covers client-side navigation and settings changed since load.
  - A robot without the override stops here. The root stays `data-sc="pre"`, which hides nothing without `html.sc-motion`.
  - Observe the root (IntersectionObserver, `rootMargin: "200px"`). The 6 s fallback starts the first time the root is within 200 px of the viewport; for the hero, that is at hydration.
  - If the engine has not set `"on"` by the end of the fallback, the island sets `data-sc="off"`. `off` is final for this mount: a chunk that arrives later is not mounted, so nothing flashes.
- **`useEffect`:**
  - Snapshot `host.innerHTML` into a module `WeakMap` keyed by the host element, so the second mount under Strict Mode still sees the original.
  - Schedule load → idle → near → `import()` → `mount(root, {...options, id, settled, navigate})`.
    - `navigate` is `router.push` from `next/navigation`, which the import guard allows.
    - Engine CTA links (`a[data-sc-cta]`) call it on plain left clicks (no modifier key, no `target`), so they no longer reload the whole page.
  - On any change to either reduced-motion setting (matchMedia, or a MutationObserver on `data-reduce-motion`): destroy and remount.
  - For `play`, also handle `sc:run` events and clicks on `a[data-run]`. This mounts at once if needed, then calls `run`.
  - For `anatomy`, when the root turns `off`: set `data-sc-flat` (no pin) the first time the root is entirely below the viewport, so the collapse never moves anything the visitor can see. Until then, the pinned frame shows the complete static figure.
- **Cleanup:** cancel everything pending; call `api.destroy()`, which removes the overlay nodes it created and `html.sc-lock`; restore the snapshot into the captured host.
- **Strict Mode and navigation.** Strict Mode is on by default with the app router (Map 1). Pages unmount on navigation, because `cacheComponents` is off in `apps/web/next.config.ts`; the Activity-based preservation in `02-guides/preserving-ui-state.md:13-17` does not apply. Restoring the snapshot keeps remounts safe even if it is turned on later.

**The head script (`brain/head.ts`)**
- It is inline in `<head>`, after `SCENES_HEAD_SCRIPT` (`app/layout.tsx:180-182`), and runs only on `/`, `/trainer-brain` and `/demo`. `<html>` already has `suppressHydrationWarning`.
- **The override.** `?sc=on` stores `sessionStorage["sc-on"] = "1"`. Later documents in the tab and the island's client-side re-test read it; every access is wrapped in try/catch. It is distinct from `?scenes=on`, which `scenes-head.ts:20` does not persist across client navigation.
- **Classes it adds:**
  - `sc-motion`: neither reduced-motion setting is on, and the visitor is not a robot (`navigator.webdriver`, or the user-agent pattern in `scenes-head.ts:20`) unless the override is set;
  - `sc-pin`: the same, plus IntersectionObserver and sticky positioning exist;
  - `sc-late`: after 6 s, unless `data-sc-ready` is set.
- A test keeps its reduced-motion and robot tests identical to `scenes-head.ts:20` and to `mount.tsx`.

**The CSS contract**
- Rules that hide results before the engine starts apply only under `html.sc-motion:not(.sc-late) [data-showcase][data-sc="pre"]`.
- The pinned layout applies only under `html.sc-pin [data-showcase="anatomy"]:not([data-sc-flat])`, inside `@media (min-height: 700px)`.
- So these visitors all get the final static frame: no JavaScript, reduced motion, robots, static mode, and a failed engine once it has flattened.

**The engine**
- On its first frame it sets `data-sc="on"` and `data-sc-tier`. It sets `data-sc-run` exactly while a loop frame is scheduled.
- Every Pause control carries `[data-sc-pause]` with a correct `aria-pressed` (corrected 28 Oct: with no `aria-pressed` at all; its label says what a press does, "Pause", "Play" or "Play the field". A changing name was chosen over a fixed name with a pressed state, which would break WCAG 2.5.3 against the visible "Play").
- Pause reasons: off screen, hidden tab, idle (90 s, or 60 s on phones), the visitor's Pause, reading a receipt, a call open, reduced motion (corrected 28 Oct: also keyboard focus on a moment in the field; idle counts from the later of the last input and the showcase's return to running, and input ends it).

**Static mode (the kill switch)**
- `app/[[...path]]/page.tsx` reads `process.env.MARKETING_SHOWCASE` next to its `publicPlatform()` call (`:311`). It passes `showcase: "live" | "static"` (default `"live"`) through `MarketingSite`.
- In static mode, every root renders `data-sc="off"` (and the anatomy root `data-sc-flat`). No island renders and no engine chunk loads.
- To use it, set `MARKETING_SHOWCASE=static` in the host's `runtime.env` (kept by `infra/digitalocean/hostops.py`) and re-apply the release (`hostops.py reapply`; corrected 28 Oct: `compose.yaml` passes the variable to `web`, and a plain restart does not re-read it). There is no build and no CI cycle, whereas a revert costs a full CI run (the application job alone took 36 min).
- WP1 confirms in the `next build` route table that `/[[...path]]` renders per request, so the value is read live.

**The section reveal.**
- `motion.tsx:55` `NEVER` gains `[data-showcase], .mk-sc-band, .sc-host`.
- They are appended at the end, so the regexes at `marketing-motion-sitewide.test.ts:680` and `:724` still match.
- Units are filtered with `unit.closest(NEVER)` (`motion.tsx:100-102`). So the band that wraps a showcase must carry `.mk-sc-band`, or it fades and moves while the engine is measuring it.

### 1.3 The traces, and the test that keeps them true

**Files**
- `brain/data/traces.json`, copied from `shared/brain/traces.json` with three edits:
  - The three brand literals in copy become `{APP_NAME}`. They are `rule.source` in `traces[1]`, `[10]` and `[11]` ("trainsyou. Can't switch off.").
  - `format: "trainsyou-brain-trace@2"` stays literal. `verify.mts:23` asserts it, and it is the only exemption in the no-brand check.
  - t2's whole `basis.note` is reworded under the C0 vocabulary rule, because it says "floor" twice. Old: "A trial red flag the floor now holds. Category computed by the real floor." New: "A trial red flag the safety rules now catch. The category comes from the real safety rules in code." (Derived, FYI.)
  - `decide: "floor"` is an enum value the engine never shows, so it stays.
- `brain/data/traces.client.json`, generated by `scripts/brain-traces.mjs`.
  - It strips `code`, `basis.refs`, `verify`, `verbatim`, `verbatimFrom`, `verbatimRef` and `fn`, then minifies.
  - `--check` fails if the file is stale.
- The render and runtime modules import `traces.client.json`. Only the generator and the trace test read `traces.json`.
- Both files are under `apps/`, so CI runs; pull requests that only touch `docs/**` skip it (`check.yml:2-6`).

**`prepare(raw, {appName, flags})`**
- It deep-clones `raw` first (`structuredClone`). `index()` mutates and caches its input (`brain-core.js:67-75`), so filling in place would leak one render's brand and flags into the next render in the same server process.
- It fills in the brand token.
- When payments are on, it drops the `labels.subscribers` strip and maps the status `try_yourself` to `live`.
- It adds `index()`.
- The server render and the client mount call the same function.

**`tests/marketing-brain-traces.test.ts`**
- It ports `verify.mts` checks 1–8 with paths relative to the repo: `packages/domain/src/{red-flags,brain-plans,voice-session,whoop-training,brain-teach}.ts` plus the verbatim source files.
- It adds checks for:
  - nine safety categories: `RED_FLAG_CATEGORIES.length` (`red-flags.ts:41-51`);
  - "last 28 days" (`apps/api/src/client-twin.ts:27,35`);
  - "4.2%, inside your 5% cap", run through `decide()` with defaults;
  - "seven coaching specialists": the size of the coach group;
  - the "Compare my replies" dimensions (`brain-fidelity.tsx:6-10`);
  - "8 answers and 3 cases", "20 cases" and "about 6 minutes": `SETUP_BRAIN_MINIMUM` and the `SETUP_STEPS` brain step (`packages/contracts/src/coach-setup.ts:7-14`), and `brain-teach.ts:26,28`;
  - "Approve all" skips flagged rules (`setup-brain.tsx:88,146`);
  - every specialist's `code` reference names a file that exists and contains the function;
  - the client copy equals `stripForClient(full)`;
  - no literal brand name, except `format`;
  - visible strings only (every string in the client copy except values under `NON_TEXT_KEYS`: `format`, `id`, `decide`, `status` and the other enum fields) pass these scans: the model and vendor guard, hype words, the payout provider's name, AI-cost wording, hidden-specialty words, the C0 banned vocabulary, and the placeholder pattern (§1.6);
  - the Not-on-yet shelf is exactly Meal planner and Recovery rule, and t3 is off by default (corrected 28 Oct: statuses follow the flags, so the test walks every status through payments, publishing, voice, nutrition, meal photos and the AI model; the field's shelf holds only what is not on yet of the two, the Meal planner joins the specialists once nutrition is on, and the anatomy's (f) has no shelf; t3 stays off);
  - both payments states;
  - `prepare` is pure: trainsyou → Acme → trainsyou, and payments off → on → off, return the first output again, and the imported JSON is unchanged.

**The four open verify items**

| Item | Finding | Action |
|---|---|---|
| **t6** (Today card "Your Brain drafted a reply") | **Confirmed.** A held runtime decision is stored as a `decision` plus an `exception` with a `decisionId` (`apps/api/src/coaching-runtime.ts:1483-1500`). Its message is `coachActionReply(...)` or "This request needs your trainer's personal judgment." `trainer-inbox.ts:296-309` titles every exception whose decision exists "Your Brain drafted a reply". | Drop the tag; add a verbatim check. |
| **t9** ("Waiting for your reply") | **Confirmed.** Personal-review topics open through `openPersonalReview` (`apps/api/src/safety-policy.ts:98-128`) with no `decisionId`, so they fall into `trainer-inbox.ts:310-321`. | WP1 confirms that `member_policy_review_append` writes `kind='exception'`, then drops the tag. |
| **t7 #2** (no member message reaches the Learner) | **Confirmed.** The Learner gets only the draft, your reply, your note and the category, with names removed (`apps/api/src/brain-learning.ts:98-139`). | Drop the tag. |
| **t7 #1** (does a Try my AI edit reach the Learner) | **Likely.** Any POST to `/api/v1/exceptions/:id/corrections` on an exception with a `decisionId` queues learning (`brain-learning.ts:304-321`). | WP1 confirms that a held Try my AI draft goes through the non-automatic branch of `coaching-runtime.ts`. If not, it applies the spec's own fallback: start t7 from a quiz "Change" answer (SHOWCASE_DESIGN.md:203). Either way, C's anatomy note (j) stays, because it describes edits to real subscribers' replies, which is true in the code. |

### 1.4 Styles, and the motion and brand contracts

**Global sheets**
- All imports go after `marketing-journey.css` (`layout.tsx:50`). The test at `:678-681` requires `marketing.css` to be followed immediately by `marketing-journey.css`.
- Order and owners: `marketing-proof.css` (WP0), `marketing-home.css` (WP4), `marketing-brain-pages.css` (WP5), `marketing-pricing.css` (WP6), `brain-stage.css` (WP1), `brain-field.css` (WP2), `brain-play.css` (WP3), `brain-anatomy.css` (WP3).
- **Budgets.** Measured on source with comments and whitespace removed, then gzipped; set from measurement:
  - `brain-*.css`: 18 KB or less in total.
    - Measured on the prototypes with JavaScript off, the rules that match the static markup are 8.2 KB for the home (field and board), 5.4 KB for /demo and 11.8 KB for /trainer-brain. That is about 16–18 KB across the four pages.
    - The earlier 10 KB target could only be met by moving layout rules into the lazy sheets. That would shift layout on mount and leave JavaScript-off and crawler frames unstyled.
  - Page sheets: 8 KB or less in total.
- Every route on the catch-all pays for global CSS, the member app included (`marketing-site.md:1108-1109`). That cost goes in the owner FYI list (§6); the route split remains the follow-up.

**Lazy sheets**
- `engine/*.css`, imported only by the runtime modules (pattern: `assistant-panel.tsx:3`). They load with the chunk; 8 KB gzipped or less per page.
- They style only classes and states that JavaScript adds. Two checks enforce this:
  - a unit test: every selector in `engine/*.css` names a class or attribute state that no kind's static render emits;
  - a browser check: injecting the lazy sheets into a JavaScript-off page moves no static-frame box (§4.3 check 1).
- Never import CSS from `site.tsx`, `render.ts`, or anything they import statically (§1.1).

**Scoping**
- Global CSS stays loaded after navigation (`01-app/01-getting-started/11-css.md:294`).
- Every rule therefore sits under `[data-showcase] …` (the overlay layer included) or a page prefix: `.mk-hm-` (home), `.mk-tb-` (Trainer Brain), `.mk-dm-` (demo), `.mk-pr-` (pricing), `.mk-pf-` (proof atoms).
- The only global selectors allowed are `html.sc-*` and `html.sc-lock`.
- I checked: no existing CSS uses the prototypes' prefixes `mc-`, `mb-`, `bp-`, `ca-`, `ba-`, `sc-`, `an-`, `ro-`.

**The overlay layer and containment**
- **What lives there.** Receipts, their backdrop, the field's phone settings sheet and the shared live region all mount in one `<div class="sc-layer" data-showcase="layer">`.
- **Where it goes.** `core.js` appends it as the last child of the marketing root (`.mk`, `site.tsx:1561`). It is reference-counted and removed with the last showcase.
- **Why not `<body>`** (where `brain-anatomy.js:96-106` puts receipts):
  - The `--mk-*` tokens are defined only on `.mk, .mk-header, .mk-footer, .mk-assistant-host` (`marketing.css:8-11`, asserted at `marketing-motion-sitewide.test.ts:310`). On `<body>`, `--sc-ease: var(--mk-ease-in-out)` would be invalid.
  - A node outside `[data-showcase]` fails the scoping and ink-stage contracts.
- **Stacking.**
  - `.mk` sets no transform, filter, containment or z-index (`marketing.css:72-76`), so the layer's fixed children position against the viewport.
  - The layer sits at z-index 70, above the consent bar (45) and Kamran's button (60).
- **Containment.** `contain: paint` applies to the canvas layer only. With the fixed sheet out of the root, `isolation: isolate` on the root is safe.
- **Teardown.** `destroy()` removes the nodes it added and `html.sc-lock`, so navigating away with a receipt open cannot leave the next page scroll-locked.

**The header offset**
- `brain-stage.css` defines `--sc-top` under `[data-showcase]`, with the header heights from `scroll-scenes.css:34-46`: 74 px; 69 px at 1150 px wide or less; 65 px at 760 px or less.
- The anatomy therefore no longer depends on the parked file.
- A unit test keeps the values equal while `scroll-scenes.css` exists. Check 11 asserts that the pinned frame sits flush under the header.

**Contracts**
- **Page sheets** join the existing marketing motion contract. WP0 adds them to the corpus that `tests/marketing-motion-sitewide.test.ts:301-367` and `:493-515` read: motion tokens, compositor-only properties, no `infinite`, hover inside `(hover: hover)`, and reduced-motion rules that carry `MOTION_ALWAYS_EXCLUDED`.
- **Showcase sheets** follow the new contract in `tests/marketing-showcase.test.ts`:
  - only opacity, transform and stroke-dashoffset animate;
  - `--sc-*` tokens are defined once, in `brain-stage.css`, with `--sc-ease/enter/spring` set to `var(--mk-ease-in-out/-enter/-spring)`;
  - no `--mk-*` definitions outside `marketing.css` (test `:684-692`);
  - `@media (prefers-reduced-motion: reduce)` and `:root[data-reduce-motion="on"]` rules, without the always-on exclusion;
  - dark backgrounds only under `[data-showcase]`;
  - ink-stage contrast: text 4.5:1 or more, controls and lanes 3:1 or more.
- **Logical properties everywhere.** `tests/logical-css.test.ts` scans recursively. The one deliberate physical case (`a-brain.css:496`, a card in vertical writing mode) gets an `ALLOWED` entry.
- **The prototypes' physical declarations need converting.** Grep counts: `a-brain.css` 17, `c-anatomy.css` 20, `brain-anatomy.css` 19, `site.css` 28, `money.css` 18.

**Re-skin and the ink stage**
- `--sc-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace`.
- No Newsreader, no Archivo, A's radii.
- The ink stage is part of the accepted exception (SHOWCASE_DESIGN.md:823, decision 1). It is limited to `[data-showcase]`.

### 1.5 Flags (read from `PublicPlatform`, `components/marketing/platform.ts:14-25`)

| Flag | Where it is used |
|---|---|
| `registrationOpen` | `teachCta()` (header, hero, closing, showcase `cta`, calculator CTAs); the hero micro line; AddressPreview, shown only while sign-ups are open |
| `availability.payments` | Not-on-yet chips (subscriber payments, bookings, payments and invoicing); the showcase status strip and `try_yourself` statuses (through `prepare`); the payments-on answer to "Can subscribers pay me today?" (an `AVAILABILITY_LINES` entry) |
| `payments && payouts` | "Publish" status and the walkthrough's "Publish and share" chip (`apps/api/src/onboarding.ts:520-524, 556-559`). Corrected 28 Oct: publishing follows `PUBLISH_GATES`, sign-ups, payments and the model, the go-live checks `publishStorefront` refuses on (sign-ups stand for the legal check, the same switch in production). Payouts are asked at the first payout, so they gate only "Payouts to a UAE bank" and "Get paid monthly" |
| `payouts` | "Payouts to a UAE bank" status; pricing payouts chip |
| `voice` | "Sessions led in your voice" Add-on and Not-on-yet chip; status item; pricing "Optional" card chip (corrected 28 Oct: the voice add-on status needs voice and payments, since subscribers buy it at checkout; the Optional card no longer offers it, and its chip is the domain's, on custom domains and payments) |
| `nutrition` | The home nutrition offer chip; the meal-planning row in "Tools it replaces" (Map 2, decision 6) |
| `frontier` | Only through existing and new `AVAILABILITY_LINES` (the `/trainer-brain` `learns` bullet; the renamed trained-on-my-data FAQ) |
| recovery | Fixed `false` in phase 1 (owner default). No new `AvailabilityKey`, so the fixtures that list every key stay as they are |

One pure function, `showcaseOptions(platform, cta)` in `brain/options.ts`, builds the engine options. The server render and the island use the same object.

**Corrected 28 Oct (fix round 2 and the final fix pass).** Three flags joined: `model` (teaching and testing, every AI specialist in the showcases, and the publish gate), `mealPhotos` (a new public flag: nutrition plus `MEAL_PHOTOS_ENABLED` and `MODEL_VISION_ENABLED`) and, for the showcases, `publish` (every `PUBLISH_GATES` gate on). The showcases' `try_yourself` statuses become live only with `publish`, not with payments alone. Answers can wait for a list of gates (`AvailabilityLine.when`), sign-ups included. What shipped: `docs/features/marketing-site.md` ("What is live: gates and flags") and `docs/features/brain-showcase.md` ("Flags").

### 1.6 Copy: registry or components; JSON-LD, llms and assistant facts

**The registry (`packages/contracts/src/marketing-content.ts`)** holds every page claim for the four pages. WP0 writes it; the full spec is under WP0 below.

**New shared constants**
- `NEVER_LIST`, `NEVER_NOTE`.
- `FOLLOWERS_FAQ`: the existing text, moved out of `/faq` (`:2191-2193`).
- `PAY_TODAY_FAQ`: one answer, used on both `/` and `/pricing`.
- Versions of the FAQs that say "my AI": `MY_AI_REPLACE_FAQ` and `MY_AI_TRAINED_FAQ`, plus a frontier `AVAILABILITY_LINES` entry keyed on the new question.
- Why new constants: the originals (`REPLACE_FAQ` `:653`, `TRAINED_FAQ` `:669`) also feed `/how-it-works`, `/features` and `/faq`, which stay unchanged until phase 2.

**Structured data in a contracts module**
- New `packages/contracts/src/marketing-proof.ts`: `STATUS_ITEMS` with gates, `HOME_OFFER`, `PROOF_LINKS` and `NEVER_LIST`.
- `REPLACES` (`marketing-features.ts:205-213`) gains an optional `availability`; `/features` ignores it.
- `MarketingPage` (`packages/contracts/src/marketing.ts:101-155`) gains `secondaryCta?`.

**Component microcopy**
- The hero micro line goes in the `CtaMicro` atom.
- Sample UI mocks (the phone, the flow window, the statement) stay in components.
- Showcase text stays in the engine `COPY` and the traces. It never reaches JSON-LD or llms-full.
- Tests pin the overlap:
  - the "14 AI specialists and 11 code steps" numbers equal the roster counts;
  - the playground banner equals `labels.long`;
  - the /demo `moments` text lists every chip label (corrected 28 Oct: the page builds its two paragraphs from the traces under its flags, `momentLines()`, so the registry text names no moment).

**Placeholders, and claims the product does not back**
- `tests/marketing-helpers.ts` exports `PLACEHOLDER = /\[(rate|owner)[^\]]*\]|owner to (state|confirm|supply)|decision \d/i`.
- The page tests (WP4–WP6) and the trace test fail on any match in a page's rendered HTML, the registry entries or the traces.
- Not ported:
  - B's `[rate: owner to state]`, `Rate: [owner to state, decision 3]`, `[rate]` and `[Portability wording: owner to confirm.]` (`concept-b/src/pages-core.mjs:271, 335, 342`);
  - C's founder-signature slot (`concept-c/src/lib/components.mjs:280`). The Never sheet ships unsigned.
- A's "Export or delete it whenever you like" (`concept-a/src/pages-product.mjs:621`) overstates the product, because deletion is a reviewed request (`app.ts:2266-2275` records it as `pending_review`). It becomes "Download your data and request deletion", the published fact at `marketing-features.ts:200`. Derived (FYI).

**Two hidden links in `journey.tsx`**
- `SUBSCRIBER_LINES[4]` (`apps/web/components/marketing/journey.tsx:53-66`) pointed at the home Instagram FAQ.
- `INSTAGRAM_FAQ` (`:719`) is appended to `/faq`, and the reference points there. This lands with the home merge.
- `/pricing` section `how` is kept and rendered, because the journey band reads its first bullet.
- Result: `/how-it-works` renders the same text.

**The home introduction.**
- "How does {APP_NAME} work?" stays as the first home FAQ, with `HOME_INTRO` as its answer.
- That is the house rule (`marketing.ts` `lede` doc comment) and `brand.test.ts:200-201`.
- The approved six questions follow, so the home has 7.

**Calculated figures.**
- Calculators and examples compute from `@trainer/domain` (`estimateEarnings`, `BANDS`, `aedWhole`, `estimateFollowerConversion`).
- `MEMBERSHIP_MINIMUMS` comes from `@trainer/contracts` (`membership-pricing.ts:3`).
- Do not port the prototype `calc.js`; its maths is identical (Map 2).

**Consistency.**
- JSON-LD, llms-full and the assistant facts follow the registry automatically.
- The assistant only says numbers that appear in its facts, so `tests/marketing-assistant.test.ts` runs at every page merge.
- `/demo` is not in `ASSISTANT_FACT_PAGES` and stays out.

### 1.7 The call to action

**`frame.tsx` additions**
```ts
export const TEACH_AI = BRAND_COPY.primaryAction + " — free";
export function teachCta(open: boolean): Cta;
// open:   { label: TEACH_AI, href: "/signup" }
// closed: { label: "Join early access — free", href: "/get-started#early-access" }
```

**`primaryCta`** (moved into `page-parts.tsx`) returns `teachCta(...)` when the path is in `TEACH_CTA_PATHS`.
- The set starts empty in WP0. Each page merge adds its own path (`/` with WP4, `/trainer-brain` and `/demo` with WP5, `/pricing` with WP6), so no page changes its CTA before its own merge.
- The four registry entries drop their `cta`.

**Engine CTAs** come from the options (`teachCta`) and route through `navigate` (§1.2), so they do not reload the page.

**What stays unchanged**
- `claimCta`, `START_COACHING`, the sign-up heading (`public-pages.tsx:657`), `PublicHeader`, and Kamran's hand-off (`apps/api/src/marketing-assistant.ts:346`, `packages/domain/src/marketing-assistant.ts:347`).
- Tests `brand.test.ts:206-208, 259-264`.

**Secondary calls to action, from the registry's `secondaryCta`**

| Page | Secondary call to action |
|---|---|
| `/` | Try the demo → `/demo` |
| `/trainer-brain` | Try the demo → `/demo` |
| `/demo` | See how it works → `/how-it-works` |
| `/pricing` | Estimate my earnings → `/earnings-calculator` |

`secondaryCta()` and `closingLink()` read this field when it is present.

### 1.8 Kamran, analytics, view transitions, RTL, scroll scenes

**Kamran**
- **The button stays as it is:** `button.mk-assistant-fab` on `/` only (`assistant-button.tsx:57`). It is fixed at `inset-inline-end: 16px`, bottom 16 px, 52 px square, z-index 60 (`marketing.css:2997-3005`).
- **Calls pause the field.** `AssistantButton` sets `html[data-mk-call]` while `open`.
  - The call check (a deploy gate) is a webdriver visit, so it now sees the static frame.
  - The pause still matters for real visitors.
- **The field keeps clear of the button on phones.**
  - Below 760 px wide, the field's bottom control row (Pause, "How we count", settings) keeps a 76 px gutter at its inline end: the button's 52 px, its 16 px inset and an 8 px gap.
  - The button is placed with logical properties, so the gutter mirrors in right-to-left.
  - Why: on A's home at 390×844, scroll 0, the field spans y 213–826. Its "How we count" control at (263, 761) otherwise meets the button's box (x 322–374, y 776–828).
- **Stacking.** Showcase roots use `isolation: isolate`, so nothing inside them rises above the button. Open overlays sit in the layer at z-index 70, above it.
- **Not in phase 1:** C0's inline pills on phones, Kamran on more pages, and adding `/demo` to `ASSISTANT_DESTINATIONS`.

**Analytics**
- Nothing new. Do not port the prototype's `tyTrack` or its consent simulation.
- The consent bar, first and second touch, and the `landing-welcome` slot (`acquisition.tsx:657-663`) stay as they are.
- Showcases must not capture wheel events: `browser-completion-check.mjs:235-249` needs the wheel to reach the page.

**View transitions.**
- Only the member app uses them (`components/motion.ts:408-434`, `app/motion.css`). Marketing pages have none, so there is nothing to change.
- If one is added later, the engine must pause during the transition.

**Right to left**
- Logical CSS, and canvas paths taken from DOM rectangles, so the layout mirrors without extra work.
- Phase 1 guarantees no overflow and no errors in `dir=rtl` documents. Arabic strings are phase 3.

**Scroll scenes**
- Remove `<ScrollScenes/>` from the home. The scroll-scenes engine then leaves the shared bundle: only `scene-mount.tsx` imports `scroll-scenes.ts` and `journey-scene.ts`.
- `SCENES_HEAD_SCRIPT` and the engine's tests stay.
- `SCENES_HEAD_SCRIPT` still adds `scenes-on` on `/`, but nothing consumes it any more. The rules in `scroll-scenes.css` and `motion.tsx:99-105` match only `[data-scene]` and `.mk-walk-band`, and both leave `/`. This is harmless; it is documented, and phase 2 decides.
- `docs/features/scroll-scenes.md` records that the engine is parked.

---

## 2. Work packages

**Rules for every WP**
- Each file has one owner.
- Some shared spots accept append-only edits only, merged by the lead:
  - the `BESPOKE` block in `site.tsx`;
  - `TEACH_CTA_PATHS`;
  - the `ALLOWED` list in `tests/logical-css.test.ts`;
  - the file list in `tests/model-name-guard.test.ts`;
  - `SPRING_ALLOWED` (`tests/marketing-motion-sitewide.test.ts:161-168`);
  - the `C0_PAGES` list (WP0).
- After WP0's first merge, every registry change goes through the lead. Each page's entry merges together with its page.
- **Every merge keeps `npm run check` green.**
  - Why: in the application job, a red `npm run check` skips the seed and every browser step, because their `if` needs `browser_fixture` to succeed. A known-red branch would get no browser signal for days.
  - Each WP adds its own new test file. In the same merge, it makes the edits to existing tests and scripts that its change requires (table below).
  - Before each merge, the lead runs the marketing suites (`tests/marketing-*.test.ts tests/brand.test.ts tests/logical-css.test.ts`). The draft PR's CI runs everything.
- **Command prefix:** `export PATH=/opt/nvm/versions/node/v24.22.1/bin:$PATH; cd /home/user/trainer_what`.

**Existing tests and scripts, by the merge that edits them**

| Merge | File and lines | Change |
|---|---|---|
| WP0 (first merge) | `tests/marketing-site.test.ts:1117-1127` | The honesty scan walks subfolders; otherwise `brain/` crashes it with EISDIR |
| | `tests/marketing-site.test.ts:624-672` (copy limits) | Add an empty `C0_PAGES` list. Pages in it must avoid `C0_BANNED` (helpers) in their registry text |
| | `tests/marketing-motion-sitewide.test.ts:301-367` | The motion corpus also reads the four page sheets |
| | `:493-515` | The sheet list adds the page sheets. A sheet needs reduced-motion rules only if it declares `animation` or `transition`; today `:502` requires one in every listed sheet, so an empty sheet fails. Every reduced-motion rule still carries the exclusion |
| | `:658-668` | The import guard walks subfolders and also reads `.js` |
| | `tests/marketing-frontier.test.ts:26-37, :66, :116` | The fixture takes a `payments` value (default `true`, as today). The identity check at `:66` runs with payments off. `when` may be `frontier` or `payments`. The copy limits apply to every line |
| | `tests/marketing-journey.test.ts:360-371` | Append `page-parts.tsx` and `proof.tsx` to the sources that the mocks' words are checked against, because words move out of `site.tsx` |
| WP1 | `tests/model-name-guard.test.ts` | Append `components/marketing/brain/**` |
| WP2 | `tests/logical-css.test.ts` `ALLOWED` | Append the vertical writing-mode card (`a-brain.css:496`) |
| WP4, with the `/` entry | `tests/marketing-site.test.ts:482-622` | Delete; `marketing-home.test.ts` replaces it. Remove `bandPills` from the import at `:61`, which only `:575` used |
| | `tests/brand.test.ts:199`, `:251` | The new home eyebrow; the home closing link goes to `/demo` |
| | `tests/marketing-journey.test.ts:128-131` (inside the test at `:101`), `:236-249`, `:251-296`, `:303-304` | The journey is absent from `/` and unchanged on `/how-it-works` |
| | `tests/marketing-journey.test.ts:360-371` | Append `pages/home.tsx` |
| | `tests/marketing-motion-sitewide.test.ts:831-845` | Read the hero from `pages/home.tsx`: one `rel=expect` to `#mk-hero-end`, before the copy, counted across `site.tsx` and `pages/*.tsx`. Until then it reads `site.tsx`'s old hero and would keep passing on dead code |
| | `SPRING_ALLOWED`, `C0_PAGES` | Add the stepper selector if it uses the spring; add `/` |
| WP5, with the `/trainer-brain` and `/demo` entries | `tests/marketing-site.test.ts:654-656` | `decides` holds bullets; there is no `control` section |
| | `:696-700` | `/demo` now has a lede and "In short" |
| | `:708-719` | The teach cards keep "you review the extracted text before use". The never list keeps the pain and privacy promises. "Enforced in code" is checked in the `decides` bullets ("safety rules in code") |
| | `SPRING_ALLOWED`, `C0_PAGES` | Add the rule-card stamp; add `/trainer-brain` and `/demo` |
| | `scripts/browser-check.mjs:80-89` | The `/demo` smoke test opens `/demo?sc=on` and waits for `[data-showcase="play"][data-sc="on"]`. Knee shows "Training paused"; Low recovery shows "Not on yet" |
| WP6, with the `/pricing` entry | `tests/marketing-site.test.ts:650-653` | The rendered `hours` anchors are B's two |
| | `tests/brand.test.ts:252` | The `/pricing` closing link goes to `/earnings-calculator` |
| | `C0_PAGES` | Add `/pricing` |
| WP7a | `tests/marketing-motion-sitewide.test.ts:161-168`, `:342` | Remove the relay and demo spring entries; lower the minimum count |
| | `:180` | Drop `.mk-relay-dot` from `HIDDEN_ALLOWED` |
| | `:442-446` | Drop keyframe names that only the deleted CSS used |
| | `:680` | `NEVER` no longer contains `.mk-relay` |
| | `:717-728` | The ring check; also the journey-band source check, if `JourneyBand` is deleted |
| | `:794-800` | The hero arrow's delay no longer follows the relay's last tick; it still ends by 3 s |
| | `tests/logical-css.test.ts:31-37` | Remove the relay-dot entry, together with its CSS |
| | `tests/marketing-journey.test.ts:360-371` | Drop `hero-flow.tsx` |
| | `tests/marketing-journey.test.ts:21-24` | Import `Section` from `page-parts.tsx`; `site.tsx` then drops the re-export |

**Interfaces published by WP1** (`brain/engine/types.d.ts`):
```ts
export type ShowcaseKind = "field" | "board" | "play" | "anatomy";
export type ShowcaseMode = "live" | "static";
export type ShowcaseFlags = { payments: boolean; payouts: boolean; voice: boolean; nutrition: boolean; recovery: boolean };
export type ShowcaseOptions = { appName: string; cta: { label: string; href: string }; flags: ShowcaseFlags;
                                heading?: boolean /* false: the page supplies the H2 */; labelledBy?: string /* that H2's id */;
                                attract?: boolean };
export type RenderOptions = ShowcaseOptions & { kind: ShowcaseKind; id: string /* host id; prefixes every inner id */ };
export type MountOptions = RenderOptions & { settled: boolean /* html.sc-late was set */; navigate(href: string): void };
export type ShowcaseApi = { destroy(): void /* idempotent; removes its overlay nodes and html.sc-lock */;
                            run?(traceId: string): Promise<void> };
// field.render.js / play.render.js / anatomy.render.js: pure, no CSS, no DOM; import only core, decide, ui, data and the JSON
export function renderStatic(d: BrainData, o: RenderOptions): string;              // the root's inner HTML
// field.js / play.js / anatomy.js: client runtime; each imports its own .css and its render module
export function mount(root: HTMLElement, o: MountOptions): Promise<ShowcaseApi>;
// receipt.js: runtime only, reached through import("./receipt.js") from field.js
// data.js
export function prepare(raw: RawBrainData, o: Pick<ShowcaseOptions, "appName" | "flags">): BrainData; // deep-clones raw
export function stripForClient(full: RawBrainData): RawBrainData;
export const NON_TEXT_KEYS: readonly string[];
// render.ts (server only), showcase.tsx, options.ts
export function renderShowcase(kind: ShowcaseKind, o: RenderOptions, mode: ShowcaseMode): string; // root element + inner HTML
export function BrainShowcase(p: { kind: ShowcaseKind; id: string; label: string; options: ShowcaseOptions; mode: ShowcaseMode }): JSX.Element;
export function showcaseOptions(platform: PublicPlatform, cta: Cta, extra?: Partial<ShowcaseOptions>): ShowcaseOptions;
```

**DOM hooks that checks may rely on**
- `root[data-sc]` = `pre`, `on` or `off`; `root[data-sc-tier]`; `root[data-sc-run]`; `root[data-sc-flat]`.
- `[data-sc-pause]` with `aria-pressed` (corrected 28 Oct: no `aria-pressed`; the label changes); `a[data-sc-cta]`.
- `.sc-layer[data-showcase="layer"]`.
- `html.sc-motion`, `.sc-pin`, `.sc-late`, `.sc-lock`; `html[data-sc-ready]`; `html[data-mk-call]`.
- The override `?sc=on`, kept in `sessionStorage["sc-on"]`.
- `CustomEvent("sc:run", {detail: {trace}})` on the host; `a[data-run]` delegated.
- No test-only globals in product code. Browser checks wrap `requestAnimationFrame` themselves.

### WP0: Foundations (the lead; first merge on day 1; about 2 days)

**The first merge changes no rendered HTML.** The four page entries are written and measured by WP0 by the end of day 1.5. Each then merges together with its page, along with that merge's rows of the table above, its path in `TEACH_CTA_PATHS`, and its payments `AVAILABILITY_LINES` entry for `PAY_TODAY_FAQ`:
- `/`, the `/faq` append and the `journey.tsx` link merge with WP4;
- `/trainer-brain` and `/demo` merge with WP5;
- `/pricing` merges with WP6.

**Files it owns:**
- `packages/contracts/src/marketing.ts` (`secondaryCta?`).
- `packages/contracts/src/marketing-content.ts`: the four entries, the `/faq` append, the shared constants and `AVAILABILITY_LINES`.
- New `packages/contracts/src/marketing-proof.ts`, plus its export from the contracts index.
- `marketing-features.ts` (the `REPLACES.availability` field).
- `apps/web/components/marketing/frame.tsx` (`TEACH_AI`, `teachCta`).
- New `page-parts.tsx`.
  - It moves out of `site.tsx` unchanged: `Breadcrumbs`, `Faqs`, `Related`, `Section`, `SourceNote`, `Closing` (with its unused `scene` prop removed, `site.tsx:277-290`), `Highlighted`, `dateLabel`, `primaryCta`, `secondaryCta`, `closingLink`, `HOW_IT_WORKS`.
  - It adds `pageText(platform)`, `PageHead`, `InShort` and `UpdatedLine`.
- `site.tsx`:
  - imports `page-parts.tsx`;
  - keeps exporting `Section` (re-exported from `page-parts.tsx`), `bandPills` (`:338`) and `availabilityChip` (already re-exported at `:70`; no importer today) until WP7a moves the test imports;
  - `primaryCta` uses `TEACH_CTA_PATHS`, which starts empty;
  - adds an empty `BESPOKE: Record<string, (c: Ctx) => ReactNode>` dispatch ahead of the `Home`/`StandardPage` choice (`site.tsx:1569-1575`);
  - adds an optional `showcase?: "live" | "static"` prop to `MarketingSite` and `Ctx`, defaulting to `"live"`.
- New `proof.tsx`, server-only with no hooks: `NotOnYet`, `StatusChip`, `StatusPanel`, `StatusStrip`, `SourceBadge` (it throws on an unknown source id), `NeverSheet` (unsigned: no founder or signature line), `SampleLabel`, `EstimateLabel`, `CtaMicro`.
- `journey.tsx` (`SUBSCRIBER_LINES[4]` → `/faq`; this merges with WP4).
- `motion.tsx:55` (`NEVER` gains `[data-showcase], .mk-sc-band, .sc-host`, appended).
- `app/layout.tsx`: the eight stylesheet imports, and `<script>{SHOWCASE_HEAD_SCRIPT}</script>` after `:181`, rendered only when the string is non-empty.
- A stub `brain/head.ts` that exports `""`; WP1 fills it.
- Eight empty stylesheets, plus the content of `app/marketing-proof.css`.
- **Tests:**
  - New `tests/marketing-helpers.ts`, holding helpers moved out of their test files, because importing a `*.test.ts` file would register its tests again:
    - `cssRules` (motion-sitewide `:83-129`);
    - `physicalRule` (logical-css);
    - the contrast helpers (`brand.test.ts:340-379`);
    - `MODEL_OR_VENDOR` (model-name-guard `:17`).
    - It also adds new exports: `PLACEHOLDER` (§1.6) and `C0_BANNED` (the C0 vocabulary table).
  - The WP0 rows of the existing-test table.

**Registry spec.**
- Sources are Map 2 §1, and the C0 vocabulary table applies to all new text.
- The "Copy check" column says how each entry fits the house limits.
- Every line marked "Derived (FYI)" goes into the PR's "FYI copy" list for the owner (§6).

**Home** (`marketing-content.ts:732-792`; merges with WP4). Fields:
- Eyebrow "FOR UAE PERSONAL TRAINERS".
- Lede from A `pages-core.mjs:36`.
- H1, title, description and intro unchanged.
- `secondaryCta`: Try the demo.
- `lastUpdated` moves to the phase-1 date.

| Section or field | Content | Copy check |
|---|---|---|
| `resort` | A `:51` | |
| `how` | Three steps, A `:58-62` | Fits the step limits |
| `subscribers` | Bullets from `HOME_OFFER` (A `:84-90`); note "Once your page is live." | |
| `control` | Body A `:146`; bullets `NEVER_LIST`; note `NEVER_NOTE` | |
| `economics` | Body "We earn only when your subscribers pay."; bullets: the three facts; note "Each rate applies to its band only." | |
| `followers` | Body from A `homeFollowers` | |
| `proof` | Body from A `:238`; bullets from `PROOF_LINKS` | |
| FAQs (7) | How does {APP_NAME} work? (`HOME_INTRO`), `MY_AI_REPLACE_FAQ`, `SAFETY_FAQ`, `FREE_FAQ`, `FOLLOWERS_FAQ`, `PAY_TODAY_FAQ` (A's answer), `TECH_FAQ` | Derived (FYI): 7 questions, not 6, because the intro stays first |
| `PAY_TODAY_FAQ`, payments on | Answer: "Yes. Subscribers pay you by card in AED." (corrected 28 Oct: only once sign-ups, payments and the model are all on; with payments on and publishing off: "Not yet. Subscriber payments are on, but publishing your page is not on yet. …") | Derived (FYI) |

**`/trainer-brain`** (`marketing-content.ts:862-970`; merges with WP5). Fields:
- H1 "Your AI, built from your judgment".
- Lede from A `pages-product.mjs:649`.
- No `cta`; `secondaryCta`: Try the demo.

| Section or field | Content | Copy check |
|---|---|---|
| Title | "Trainer Brain: an AI trainer from your judgment" | Derived (FYI): C's title is 65 characters with " \| trainsyou", over the 60 limit (`marketing-site.test.ts:282`) |
| Description | C's text without the word "coaching" | Derived (FYI): 161 → 152 characters, limit 155 |
| Intro | "checked against your test cases" and "sends on its own only within your rules" (corrected 28 Oct: "It is taught by you. Once it passes your test cases, it can send on its own, only within your rules." A first "Waits for me" version is published without an evaluation; only sending on its own needs a passing check) | Derived (FYI): 47 words |
| `what` | A `tbWhat` | |
| `inside` | Body: A's roster lede (`brain-a.mjs:57`), then "14 AI specialists and 11 code steps."; cards Coach, Teach and Guard, with the crew subtitle as label | Derived (FYI): Guard's "safety floor" → "safety rules" |
| `inside` note | `labels.howWeCount` | |
| `decides` | Heading and body: C's COPY (`c-anatomy.js:13-14`). Bullets: "Sent on its own: your approved reply fits and cites your rule." / "Waits for you: nothing fits your rules, or it is your topic." / "Training paused: safety rules in code catch pain and red flags first." | Derived (FYI): three 12-word lines from A's cards |
| `play` | "Throw a moment at your Brain"; body: the playground lede (`brain-play.js:11`); note `labels.long` | |
| `teach` | Five cards, A `:529-535` | |
| `learns` | Keep the id; "How it gets better"; A `:567-572` | Derived (FYI): "Compare my replies: rate its reply blind against yours, on five points." (13 → 12 words) |
| `never` | "What your AI will never do"; `NEVER_LIST`; note `NEVER_NOTE` | |
| `yours` | A `:618-624`, with `:621` "Export or delete it whenever you like" replaced by "Download your data and request deletion" | Derived (FYI): deletion is a reviewed request (`app.ts:2266-2275`); this is the published fact (`marketing-features.ts:200`) |
| `control` section | Removed | |
| FAQs | The four from A (`:639-644`); "scenarios" becomes "test cases" | |

**`/demo`** (`marketing-content.ts:971-1033`; merges with WP5). Fields:
- H1 "Throw a moment at your Brain".
- Lede from A `:1673`. Title unchanged.
- Remove `scenarios` and `cta`; `secondaryCta`: See how it works.

| Section or field | Content | Copy check |
|---|---|---|
| Description | 150 characters: "Throw a sample moment at a Trainer Brain. Watch each code check and AI specialist work, then change a setting and run it again. No AI model is called." | Derived (FYI) |
| Intro | 51 words, keeping the "no AI model is called" honesty line | Derived (FYI) |
| `next` | "What happens in your account". Body: A's section lede. Three steps: titles are A's keys Setup, Waits for me, Your choice; each body is A's title plus its detail. "6 minutes" is checked against `SETUP_STEPS`. Written close to the step caps | Derived (FYI): titles would otherwise exceed 4 words |
| `moments` | Up to 2 paragraphs of 35 words or fewer, listing the 12 chip labels; written close to the caps (corrected 28 Oct: the registry's two paragraphs now hold for every flag state and name no moment; the page lists the moments from the traces and flags) | Derived (FYI) |
| FAQs | A's first three, plus `SAFETY_FAQ` with its shared answer (one answer everywhere) | |

**WP0 measures `registryWords('/demo')` against the 350-word floor** (`marketing-site.test.ts:396-405`); this is WP0's job, not WP5's.
- Today the page has 380 words: introduction 41, `scenarios` 206, FAQs 133.
- Without `scenarios` it has 174, or 184 with the new 51-word introduction.
- Within the caps, `next` plus `moments` can add about 260 words, so the floor is reachable only if both are written near their caps.
- No approved FAQ is left to add: A's /demo has four (`pages-product.mjs:1683-1688`), three are used, and the fourth is replaced by `SAFETY_FAQ`.
- If the measured total is still short, the lead closes the gap with the shortest Derived (FYI) line, built from facts already published in the registry. Never padding.

**`/pricing`** (`marketing-content.ts:1829-1921`; merges with WP6). Fields:
- Title and description unchanged.
- H1 "Free to join. You set the price." with highlight "price".
- Lede from C15.
- No `cta`; `secondaryCta`: Estimate my earnings.

| Section or field | Content | Copy check |
|---|---|---|
| Intro | "marginal bands" → "our share for each group of subscribers" | Derived (FYI) |
| `how` | Kept unchanged | |
| `glance` | Cards titled Free, What we take, Optional; bodies of 18 words or fewer, from B and A; "Card processing is itemised on your statement."; the `{APP_NAME}` address | Derived (FYI): card titles are the column names |
| `bands` | Heading "How our share falls"; columns "Paying subscribers" and "Our share in that band"; existing note | |
| `example` | Note "An arithmetic example, not a forecast or promise." | |
| `hours`, `statement`, `billing`, `payouts` | Unchanged | |
| `status` | "Live today, and not on yet" | |
| FAQs | B's six (`concept-b/src/pages-core.mjs:240-247`), using `PAY_TODAY_FAQ`. In "Who sets the price?" the vocabulary is fixed | Derived (FYI): the data FAQ answer becomes "Your method stays private to your workspace. You and your subscribers can download your data and request deletion." This is the published "Export and deletion" fact (`marketing-features.ts:200`), with no placeholder. Corrected 28 Oct: the answer did not address ownership or leaving, so it now reads "You keep your rights in what you provide, and subscribers keep theirs: we never own your method or sell client information. If you leave, you can download your data and ask to close your workspace once your existing subscribers are looked after." (terms of 14 Oct, §73 and §95; legal or the owner to confirm) |

**`/faq`** (merges with WP4). Append `INSTAGRAM_FAQ` and use `FOLLOWERS_FAQ`. The text does not change.

**Provides:** the section ids above, `teachCta`, the page-parts API, the proof atoms, `STATUS_ITEMS`, the stylesheet slots, `BESPOKE`, the `showcase` prop, `PLACEHOLDER` and `C0_BANNED`.

**Acceptance**
- **First merge:**
  - `npm run typecheck`;
  - `node --import tsx --test tests/marketing-site.test.ts tests/brand.test.ts tests/marketing-journey.test.ts tests/marketing-frontier.test.ts tests/marketing-assistant.test.ts tests/marketing-motion-sitewide.test.ts tests/logical-css.test.ts`, all green;
  - `npm run build`;
  - a snapshot script (`scratchpad/snapshot.mts`) renders every registry page with `MarketingSite` before and after: no HTML difference on any page.
- **Each entry, before handing it over:**
  - with its patch applied: the title, description and copy-limit tests, the placeholder and C0 checks, and (for `/demo`) `registryWords` of 350 or more;
  - snapshot differences confined to that page (plus `/faq` with `/`).

### WP1: Brain core, data, lifecycle (about 3.5 days; the first commit publishes the interfaces)

**Files it owns:**
- `brain/engine/{core,decide,ui,data}.js` with their `.d.ts` files, and `types.d.ts`.
- Stub render and runtime modules with their `.d.ts` files: `field.render.js`/`field.js`, `play.render.js`/`play.js`, `anatomy.render.js`/`anatomy.js`.
  - Each `renderStatic` returns a labelled placeholder.
  - Each `mount` resolves to `{destroy(){}}`.
  - They hand these files over to WP2 and WP3.
- `brain/data/*`, `scripts/brain-traces.mjs`.
- `brain/{render.ts, showcase.tsx, mount.tsx, options.ts, head.ts}`, `app/brain-stage.css`.
- `app/[[...path]]/page.tsx` (one env read, passed to `MarketingSite`).
- `assistant-button.tsx` (one effect setting `html[data-mk-call]`).
- `tests/marketing-brain-traces.test.ts`, `tests/marketing-showcase.test.ts`.
- Its row in the existing-test table.

**First commit, merged on day 1.**
- The engine core copied verbatim apart from the build-blocking changes: (b) `load(data)` with no fetch or `new URL`, and (c) `prefetch(loader, el, ms)`.
- decide, ui and data; the `.d.ts` files and the stubs; the data and the generator; `render`/`showcase`/`mount`/`head`/`options`; `brain-stage.css`.
- `next build` passes on it.

**What it does**
- Everything in §1.1–1.3. This includes the overlay layer, `data-sc-run`, the `?sc=on` override, the FNV-1a key and static mode.
- In `brain-stage.css`: the ink tokens, `--sc-top`, the shared atoms, the pre-state rules, the pin gating and the reduced-motion rules.
- Resolves the verify items.
- `renderShowcase` HTML-escapes `appName`, and a test feeds it `<script>`.

**`tests/marketing-showcase.test.ts` covers:**
- the head script and `mount.tsx` run identical reduced-motion and robot tests (matching `scenes-head.ts:20`) and the same `?sc=on` override;
- neither reads `MARKETING_MOTION`;
- the island's only engine access is the literal `import()` of runtime modules;
- import hygiene:
  - the static-import walk from `site.tsx` and `render.ts` reaches no `.css` file and no runtime module;
  - nothing under `brain/**` contains a non-literal `import(`, a `fetch(`, or `new URL(` with `import.meta.url`;
  - importing the render, core, decide, ui and data modules under Node has no side effects;
- styles:
  - the CSS contract over `app/brain-*.css`, `engine/*.css` and the overlay layer's rules;
  - every lazy-sheet selector names a class or state that the static render never emits;
  - the gzip budgets: `brain-*.css` 18 KB or less, page sheets 8 KB or less, lazy sheets 8 KB or less per page;
  - the `--sc-top` values equal `scroll-scenes.css:34-46` while that file exists;
- rendering:
  - static mode renders `data-sc="off"` (and `data-sc-flat` on anatomy) with no island;
  - every root carries `data-nosnippet`;
  - the key is stable for equal HTML and changes when a flag changes.

**Acceptance**
- `node scripts/brain-traces.mjs --check`.
- The two new tests, about 1 second.
- typecheck; build, where the route table shows `/[[...path]]` rendered per request.
- A quick local Playwright probe on `next start`, with the stubs mounted on `/` in an unmerged scratch commit:
  - with `?sc=on`: the stub chunk is absent from the initial HTML and loads only after `load` + idle; `data-sc` ends at `off` (stub) or `on`; a client round trip `/` → `/pricing` → `/` raises no errors;
  - without `?sc=on`: no engine chunk is requested.

### WP2: Field, board and receipt (home hero and band 2; about 4 days)

**Files it owns:** `engine/field.render.js`, `engine/field.js`, `engine/receipt.js` (each with its `.d.ts`), `engine/field.run.css`, `engine/receipt.css`, `app/brain-field.css`, `tests/marketing-field.test.ts`, and its row in the existing-test table.

**What it does**
- The ports and fixes in the `field.render.js`, `field.js` and `receipt.js` rows of §1.1.
- Splits `a-brain.css` (46 KB raw) by the lazy-sheet rule: first-frame rules go to `app/brain-field.css`, rules for JavaScript-added classes and states to `engine/field.run.css`.
- Makes every motion compositor-only. Today `a-brain.css` animates `background`, `left`, `visibility` and `box-shadow`, and has keyframes on `box-shadow`, `border` and `color` (`:52, :125, :183, :282, :363-364, :381-394`). These become overlay opacity and transforms.
- **Zero layout shift:**
  - lanes reserve their slots, tiles land through transforms, and counts roll in fixed-width slots;
  - the streamed AI text reserves two lines. Measured at 390 px, `span.mc-cr` grows from 12 to 24 px: 0.0016 at load, then +0.0027 at 4.8 s, and again on every loop.
- Keeps the matched words as `<mark class="mc-hl">`. The house ban applies to the H1 only (C0); the home test narrows its ban accordingly.
- **The receipt:**
  - keeps its focus trap, closes on Esc and returns focus;
  - mounts in the overlay layer;
  - `destroy()` removes it and `html.sc-lock`.
- **The phone settings sheet** mounts in the overlay layer at z-index 70. `contain: paint` goes on the canvas layer only.
- **Kamran's gutter.** Below 760 px, the bottom control row keeps a 76 px gutter at its inline end (§1.8).
- **Receipt prefetch.** It runs through the loader, on idle after 10 s, or on the first pointerdown or focus.

**Provides:** `renderStatic` / `mount` for the kinds `field` and `board`.

**Acceptance**
- The field test passes:
  - the static frame has Noura's message, "STOP · No AI called" and the Paused bin;
  - every moment is a named button;
  - the chip and status strings are present;
  - no `img`, `video` or poster;
  - t3 is absent by default;
  - the CTA comes from the options;
  - the payments-on variant drops the strip;
  - no `href="/signup"` when sign-ups are closed;
  - inner ids carry the host id;
  - no `signup.html` and no `__mc`;
  - the streamed line reserves two lines.
- typecheck, build.
- Local Playwright on `/?sc=on`, run on the WP4 branch with WP2 applied, or on a scratch mount:
  - CLS 0.001 or less over 30 s at 390 and 1440, through at least two loops of streamed text;
  - Pause works across the receipt sequence: open → Pause → close leaves "Play" with `aria-pressed="true"` and no `data-sc-run` (corrected 28 Oct: "Play" with no `aria-pressed`);
  - 10 navigation round trips with no errors and no leftover `.sc-layer` nodes or `html.sc-lock`;
  - at scroll 0, at 390×844 and 360×800, no field control's box meets Kamran's button;
  - with the consent bar open, an open receipt and the open sheet are topmost at their centres (`elementFromPoint`).

### WP3: Anatomy (3a) and playground (3b) (about 4.5 days; two engineers)

**Files it owns:** `engine/anatomy.render.js`, `engine/anatomy.js`, `engine/play.render.js`, `engine/play.js` (each with its `.d.ts`), `engine/anatomy.run.css`, `engine/play.run.css`, `app/brain-anatomy.css`, `app/brain-play.css`, `tests/marketing-anatomy-play.test.ts`.

**3a: anatomy**
- **C's own pin.**
  - Selector: `html.sc-pin [data-showcase="anatomy"]:not([data-sc-flat])`.
  - Height: `calc(100svh - var(--sc-top) + 420svh)`, C's desktop value (`c-anatomy.css:10`); `+ 230svh` at 760 px wide or less (`:286`).
  - The frame is sticky at `top: var(--sc-top)`.
- The failure fallback from §1.2: `data-sc-flat` only while the root is entirely below the viewport; until then, the complete static figure.
- Flat plates under reduced motion and below 700 px tall; the What-if replays; `#fig-3x` hash jumps.
- **The render module returns the root's inner HTML only.** C's `render()` also returns the outer `<section … data-sc-module … id="anatomy" aria-labelledby="anatomy-h">` and a skip link to `#anatomy-after` (`c-anatomy.js:152-156`). Here the root comes from `renderShowcase` with `labelledBy`, and WP5 renders the skip link.
- `heading: false`; the C skin removed.
- Port fixes:
  - 41 physical properties made logical;
  - the `:244` hover moved inside `@media (hover: hover)`;
  - teardown;
  - no live region of its own (`c-anatomy.js:178`).

**3b: playground**
- `heading: false`.
- Inner ids come from the host id. Today `brain-play.js:38`, `:44` and `:88` render `undefined-*`.
- `mount` sets `data-sc="on"`; the prototype removes the attribute instead.
- The attract run (off under reduced motion).
- Free text is matched to the closest sample through the local keyword table only. In-browser safety rules stay off (decision 7 default). (Corrected 28 Oct: when no sample is close it says "No sample is close to that. This page can't read new messages: pick a sample moment." and plays nothing; the table loads on the first input.)
- "Throw them all".
- The result's height is reserved before and after a run. This fixes the 19 px mount shift and the 614 px CTA jump.
- `run(traceId)`.

**Provides:** `renderStatic` / `mount` for the kinds `anatomy` and `play`.

**Acceptance**
- The test passes:
  - static contracts; 12 chips; t3 dashed with no run;
  - totals equal `labels.totals`; no internal fields; CTA from the options;
  - inner ids carry the host id;
  - no outer section and no skip link in the render output.
- Local Playwright:
  - **`/trainer-brain?sc=on` at 1440×900:**
    - the section pins and steps through, flush under the header;
    - at 1440×650 and under reduced motion, the plates are flat;
    - with engine requests aborted, the root flattens only while it is entirely below the viewport.
  - **`/demo?sc=on`:**
    - Knee gives "Training paused" and "No AI called";
    - deload gives "Waits for you";
    - creatine typed as free text gives "Closest sample: …".
  - CLS 0.001 or less across a run.

### WP4: Home page (about 3 days; consumes WP0, WP1 and WP2)

**Files it owns:**
- `components/marketing/pages/home.tsx`.
- `home-islands.tsx`: `Walkthrough`, an ARIA tabs stepper from A's `components.mjs:393-415`.
- `app/marketing-home.css`, `tests/marketing-home.test.ts`.
- The `"/"` lines in `BESPOKE` and `TEACH_CTA_PATHS`.
- Its rows in the existing-test table.
- It also merges the `/` entry, the `/faq` append and the `journey.tsx` link that WP0 wrote.

**Structure, top to bottom.** Bands keep the `.mk-home-band > .mk-container.mk-home-inner` structure, so reveals keep working.

1. **Hero** (`section.mk-hero`):
   - **Contents:** eyebrow; the H1 through `Highlighted`; `<BrainShowcase kind="field" id="sc-field">`; lede; `teachCta`; the "Try the demo" button; `CtaMicro`.
   - **The H1's two fixed lines.** The text up to the highlighted word sits in an inline `span.mk-hm-l1`, followed by `<br class="mk-hm-br">` that shows only below 760 px. This is A's fixed two lines (`pages-core.mjs:33-35`): a late font swap cannot re-wrap the H1 above the field, and the H1 stays one LCP text block.
   - **DOM order:** H1 → field → lede → CTA → micro line. Phones show that order; on wide screens, grid areas put the field in the second column. No CSS `order`, so focus order follows visual order (WCAG 2.4.3, 1.3.2).
   - **First paint.** Exactly one `<link rel="expect" href="#mk-hero-end" blocking="render">`, pointing at an empty `<span id="mk-hero-end" hidden>` that is the hero's last child, so the first paint includes the whole hero.
   - **LCP:** the H1 (or the lede).
2. **`resort`** (`.mk-sc-band`): `BrainShowcase kind="board"`, plus a link to `/demo`.
3. **`how`**:
   - three steps, then `Walkthrough` over the `/how-it-works` `steps`, read through `marketingPageFor`;
   - "Publish and share" and "Get paid monthly" carry Not-on-yet chips when their flags are off.
4. **`subscribers`**:
   - `HOME_OFFER` with chips;
   - the brand line, built from `coachAddressTemplate` (tests forbid the literal domain in components);
   - a sample phone mock marked `[data-sample-ui]`, with `SampleLabel`.
5. **`control`**:
   - the body;
   - the "How your AI decides" flow window (A `:125-153`), using the t1/t6/t2 trace names and texts; a test asserts they match;
   - `NeverSheet`.
6. **`economics`** (its `id` includes `status`):
   - `StatusPanel` before any AED figure;
   - the facts, with the band list rendered from `BANDS`;
   - "Tools it replaces" from `REPLACES`, with availability chips;
   - the existing `AddressPreview` (only while sign-ups are open) inside a `.mk-econ` wrapper, plus the hint "We'll check it's free in setup". The wrapper is required because `brand.test.ts:473` requires the primary-CTA rule at `marketing.css:83` and `:93` to style `.mk-econ .mk-address .button`;
   - a link to `/pricing`.
7. **`followers`**:
   - the existing `FollowerCalculator compact` (widget unchanged) inside `.mk-home-calc`;
   - a `teachCta` link under it, rendered by WP4, because compact mode renders no CTA (`islands.tsx:431-445`);
   - chips: Not on yet (subscriber payments), `EstimateLabel`, `SourceBadge("revenuecat-state-2026")`.
8. **`proof`**: `PROOF_LINKS` to `/demo`, `/methodology`, `/pricing#bands` and `#status`. No founder note.
9. **FAQ band** "Questions trainers ask": 7 questions and an "All questions" link.
10. **`Closing`** with the secondary link. No `<ScrollScenes/>`, no `JourneyBand`, no `HeroFlow`.

**`tests/marketing-home.test.ts`** replaces `marketing-site.test.ts:482-622`. It pins:
- the hero:
  - one H1 with `span.mk-mark`, and no `<mark` in the hero copy;
  - the micro line (open and closed);
  - no "Trainer Brain" and no "payouts to a UAE bank" in the hero;
  - the DOM order H1 → field → lede → CTA;
  - the `rel=expect` target;
- the content:
  - the H2 list from the registry;
  - the 7 FAQs equal the FAQPage JSON-LD;
  - the band list equals `BANDS`;
  - `.mk-econ .mk-address .button` is present while sign-ups are open;
  - the follower figures computed by `estimateFollowerConversion`: 23,084 / 2,985 / 398;
- states and honesty:
  - sign-ups closed: no `/signup`;
  - a renamed platform: no "trainsyou";
  - no `PLACEHOLDER` match.

**Acceptance**
- That test and its rows of the existing-test table.
- typecheck, build.
- The local word count from §4.3.
- Local Playwright on `/?sc=on`: no showcase control under Kamran's button at 390×844 and 360×800, scroll 0; the LCP is the H1 or the lede.

### WP5: Trainer Brain and Demo pages (about 3.5 days; consumes WP0, WP1 and WP3)

**Files it owns:**
- `pages/trainer-brain.tsx`, `pages/demo.tsx`.
- `brain/roster.tsx`: server JSX from `prepare(traces)`, importing only `data.js` and the JSON.
- `brain-page-islands.tsx`: `RuleLedger`, `ReleaseTimeline`, `CompareReplies`, ported from `concept-a/site/assets/product.js:45-104`.
- `app/marketing-brain-pages.css`, `tests/marketing-brain-pages.test.ts`.
- Two lines each in `BESPOKE` and `TEACH_CTA_PATHS`.
- Its rows in the existing-test table.
- It also merges the `/trainer-brain` and `/demo` entries that WP0 wrote.

**`/trainer-brain`, in order**
1. Breadcrumbs, then the page head (eyebrow, H1, lede, CTAs) and the `RuleLedger` hero.
2. `what`: the trace chain.
3. `inside`: the crew cards from the registry plus `roster.tsx`, with "How we count" as a disclosure and "See it work" links (`href="#sc-play"`, `data-run`).
4. `decides` (`.mk-sc-band`):
   - C's skip link, "Skip the figure", to the `play` section;
   - `BrainShowcase kind="anatomy"`, labelled by the `decides` H2 (`labelledBy`);
   - the three lane bullets, as the figure's key.
5. `play` (`.mk-sc-band`): `BrainShowcase kind="play"`.
6. `teach`: the cards.
7. `learns`: bullets, the frontier line, `ReleaseTimeline`, `CompareReplies`.
8. `never` and `yours`, side by side.
9. `InShort`, FAQs, related links, "Last updated", `Closing`.

The rule card's stamp is the only spring motion on the page; it goes on `SPRING_ALLOWED`.

**`/demo`, in order:** breadcrumbs → head (eyebrow, H1, lede, CTAs, micro line) → `BrainShowcase kind="play" attract` → `next` (steps plus CTA) → `moments` → `InShort` → FAQs → related links → "Last updated" → `Closing`.

**Acceptance**
- The test passes:
  - the registry H1, lede and H2s;
  - "In short" sits after every section and before the FAQs;
  - the roster counts are 14 and 11;
  - the showcase roots carry the chip and strip strings, a named Pause button and a button for every moment;
  - the skip link targets an existing id;
  - no `/signup` when sign-ups are closed;
  - no `PLACEHOLDER` match.
- The existing SEO-depth test (`:396-405`) guards WP0's measured `/demo` word count at this merge.
- typecheck, build.
- Local Playwright with `?sc=on` on both pages: CLS 0.001 or less. C's page measured 0.018 from its own page chrome, which is not ported.

### WP6: Pricing page (about 2 days; consumes WP0 only)

**Files it owns:**
- `pages/pricing.tsx`.
- `pricing-islands.tsx` (`ShareSlider`, `TakeHome`).
- `app/marketing-pricing.css`, `tests/marketing-pricing.test.ts`.
- The `/pricing` lines in `BESPOKE` and `TEACH_CTA_PATHS`.
- Its rows in the existing-test table.
- It also merges the `/pricing` entry that WP0 wrote.

**Structure, following B (`concept-b/src/pages-core.mjs:249-364`):**
1. **Hero:** the stairs card from `BANDS`, and `StatusStrip` before any AED figure.
2. **`glance`.**
3. **`bands`:** the table, plus `ShareSlider`:
   - range 1 to 1,500, with jump buttons for 100, 300, 1,000 and 1,500;
   - one decimal shown: 25%, 21.7%, 17%, 14.7%;
   - a single polite `aria-live` region, debounced to 500 ms, and `aria-valuetext`.
4. **`example`:**
   - `WorkedExample`, computed on the server: 150 × AED 199 = 29,850; commission 4,975 + 1,990 = 6,965; you keep 22,885; about 92 sessions at AED 250;
   - a Not-on-yet chip;
   - `TakeHome`. Its minimum price is `MEMBERSHIP_MINIMUMS.training` from `@trainer/contracts`, never a typed 199.
   - Readouts sit in fixed-width slots with tabular numerals.
5. **`hours`:** two anchors with `SourceBadge`s; body[1] as the lede, body[0] as the caption.
6. **`statement`:** "Itemised", never a rate.
7. **Billing band:** three cards, `how`, `billing` and `payouts` (with chip).
8. **`status`:** the full panel.
9. `InShort`, FAQs, related links, "Last updated", `Closing`.

`EarningsCalculator compact` and `PriceAnchors` leave `/pricing`. `/earnings-calculator` keeps its calculator.

**Acceptance**
- The test passes:
  - the registry `bands` rows equal rows derived from `BANDS`. This also closes the gap Map 2 found: they were typed by hand;
  - every figure equals `estimateEarnings` output;
  - "An arithmetic example, not a forecast or promise";
  - no card-processing rate and no `PLACEHOLDER` match;
  - no `/signup` when sign-ups are closed.
- typecheck, build.
- No horizontal overflow at 390 px. The call check asserts this at `marketing-call-check.mjs:143,154-157`.
- Local CLS 0.001 or less at 390 and 1440, from load through slider and `TakeHome` input (inputs excluded). B's prototype measured 0.0075 at 390, mostly from its dev buttons plus one text shift.
- The LCP is the H1 or the lede; on B's page at 390 it was the lede.

### WP7a: Removing dead code and the test edits that follow from it (about 1.5 days; after WP4, WP5 and WP6)

**Test edits:** the WP7a rows of the existing-test table, each made in the same change as the deletion that requires it.

**Deletions.** For each CSS selector, show by grep that it has no users outside the deleted code.
- `components/marketing/hero-flow.tsx`.
- `DemoScenarios` (`islands.tsx:884-937`).
- In `site.tsx`:
  - the old `Home`, `HomeSection`, `ControlFlow` (`:1352-1400`), `SubscriberTiles`, `EconomicsVisual`, `PriceAnchors` (`:1038-1055`);
  - the `/pricing` branches of `CustomBlock` and `AfterSection` (`:1002-1008`, `:1068`), and the `/demo` branch (`:1144-1155`);
  - the `HeroFlow` and `ScrollScenes` imports (`:58`, `:62`);
  - `bandPills` (`:338`), if nothing uses it after WP4;
  - the `Section` re-export, once the journey test imports it from `page-parts.tsx`.
- `JourneyBand` (`journey.tsx:954-1002`), if nothing uses it any more.
- The relay, demo-tab and home-tile rules in `marketing.css`. Keep the `.mk-econ .mk-address` rules (`marketing.css:83`, `:93`), which the new home uses.

**Acceptance:** the full `npm test`.

### WP7b: Browser checks, CI and local scripts (about 3 days; starts on day 1)

**Files it owns:**
- New `scripts/marketing-showcase-check.mjs` (contents in §4.3).
- `scripts/marketing-showcase-baseline.json`: measured on the unchanged build first.
- `package.json`: `"test:marketing-showcase": "MOTION_CHECK_MODULE=./marketing-showcase-check.mjs node --import tsx scripts/run-marketing-motion-check.mjs"`.
- `scripts/run-marketing-motion-check.mjs`: an optional stub mode with `assistant: true`, used only by this check.
- `.github/workflows/check.yml`:
  - a new step in `homepage-call`, after the call check (around `:61-65`), with the same env pattern;
  - no new job name, so no new apt step is needed;
  - the step is added only after WP4–WP6 have merged, so the branch stays green;
  - CLS stays report-only (`SHOWCASE_JUDGE_CLS` unset) until three PR runs in a row pass it. Then the lead sets the variable.
- `scripts/brand-check.mjs`:
  - exempt `[data-showcase]` from the dark-surface rule (`:250-273`, `:324-328`);
  - replace the relay checks (`:367-405`, `:484-540`, `:567-569`, `:601`, `:661-697`) with checks on the hero field;
  - word budget and H2 count per §4.3 (`:551-575`).
- `scripts/marketing-motion-sitewide-check.mjs`: absolute budgets for the four pages instead of the comparison against base `c856d9d` (`:1042-1053`); drop the relay timing checks (`:944-945`, `:989`).
- `scripts/marketing-motion-check.mjs`: the home journey sections (`:394-401`, `:808-830`) apply to `/how-it-works` only.

**Acceptance**
- The new step passes on 3 of 3 runs of the PR's CI, each under 8 minutes.
- CPU throttling is used only in the metrics pass.
- The 6 s fallback is timed from `data-sc-ready`.

### WP8: Docs and records (about 1 day; drafted in parallel, finalised last)

**Files it owns**
- New `docs/features/brain-showcase.md`. It covers:
  - the engine and its render/runtime split, the data and the lifecycle contract;
  - robots and `?sc=on`, static mode and how to switch it;
  - the overlay layer and the flags;
  - the budgets, with the two that are looser than SHOWCASE_DESIGN §1.6, and whether CLS is judged in CI yet;
  - how to update the traces when product wording changes.

  The trace test's failure messages link here.
- `docs/features/marketing-site.md`: home structure `:527-646`, copy limits `:647-679` (how the home word budget counts), checks `:680-713`, honesty `:346-361`, checks run `:362-402`, "Not done / next" `:1408+`.
- `docs/features/marketing-motion.md`: the `[data-showcase]` exception at `:14-15`, `:28`, `:29-35`, `:257-266` and `:280-287`. It covers:
  - the continuous canvas loop and reduced motion in both switch modes;
  - the Pause control;
  - zero frames when off screen, hidden, idle, paused or on a call;
  - no infinite CSS or SVG animation;
  - the budgets and the ink stage.
- `docs/features/scroll-scenes.md` (`:1`, `:12`, `:37`):
  - the engine is parked;
  - `scenes-on` is still added on `/`, with no consumer;
  - the anatomy uses its own pin with the same gating, and `--sc-top` copies the header heights.
- `docs/features/brand.md` (`:18`, `:174`, `:192-194`) and `docs/features/dark-mode.md` (`:29`): the ink-stage exception.
- `docs/PROJECT_MEMORY.md`:
  - `:28-31` (the exception);
  - `:32-34` (the 27 Oct decision, the phases);
  - a rewrite of the stale `:35-39`, which describes the reverted #96 home;
  - the deploy reconciliation below.
- `docs/marketing-revamp-2026-10-26/README.md`: status.
- **The deploy reconciliation.** Before the merge, it is recorded in `CLAUDE_HANDOFF.md` and `PROJECT_MEMORY.md`:
  - `CLAUDE.md:9` says deployment "remains stopped" and must not be inferred from the coding handoff.
  - This deploy rests instead on the owner's explicit 27 Oct instruction: each phase is its own PR, "checked and deployed".
  - That is consistent with `AGENTS.md:35` ("always deploy").
- Per `CLAUDE.md`, the lead updates the `CLAUDE_HANDOFF.md` "Work in progress" section at every status update, plus a stage entry there and in `docs/COMPLETION_STAGES.md`.

---

## 3. Sequencing and integration

1. **Day 0–1.**
   - WP0's first merge: no rendered change, every test green.
   - WP0 finishes the four page entries as patches, with `/demo` measured, by day 1.5.
   - WP7b measures the baseline on the unchanged build. It only reads, so it runs in parallel.
2. **Day 1.**
   - WP1's first commit merges: the core with the build-blocking changes, the `.d.ts` files, the render and runtime stubs, the data, the generator, `render`/`showcase`/`mount`/`head`/`options` and `brain-stage.css`. `next build` passes.
   - Open a **draft PR**. From then on, every push gets full CI, including the browser steps, because every merge stays green.
3. **Days 1–5, in parallel:**
   - WP1 (fixes and tests), WP2, WP3a, WP3b, WP6;
   - WP4 and WP5 build the page structure, islands and CSS against the stubs and the entry patches;
   - WP7b writes the check against the DOM-hook contract and merges the script (not yet run in CI);
   - WP8 drafts.
4. **Merge order:**
   - WP6, with the `/pricing` entry, whenever it is ready;
   - WP2 → WP4, with the `/` entry, the `/faq` append and the `journey.tsx` link;
   - WP3 → WP5, with the `/trainer-brain` and `/demo` entries;
   - each page merge carries its rows of the existing-test table, its `TEACH_CTA_PATHS` line and its snapshot diff;
   - when WP2 and WP3 land, they replace the stub files they took over, so there is no conflict.
5. **Days 5–6.**
   - WP7a: deletions and their test edits.
   - WP7b adds the CI step.
   - The lead resolves the append-only blocks.
6. **Days 6–7: milestone verification (§4.6).**
   - If the CLS step passed 3 of 3 PR runs, the lead switches it to judged.
   - The PR leaves draft once CI is green.
   - WP8 records the deploy reconciliation.
   - Merge. The `main` push run starts the deploy gate (`infra/digitalocean/common.py:82-90`), and `verify-release.yml` confirms the release is serving.
   - The live check (§4.6), then the records.

**Effort:** about 28 dev-days. With 5–6 people in parallel, about 7–9 working days including integration and CI.

---

## 4. Verification plan

### 4.1 Per work package (targeted; never the whole app)

Each WP runs:
- its own new test file and its rows of the existing-test table;
- the marketing suites (`tests/marketing-*.test.ts tests/brand.test.ts tests/logical-css.test.ts`) before merging;
- `npm run typecheck`;
- `npm run build` when it touches runtime code;
- the local Playwright probe named in its acceptance, with `?sc=on`.

The draft PR's CI runs the full check on every push.

### 4.2 Unit tests

**New tests** (all run under `npm test`, so all gate deploys):
- `marketing-brain-traces`
- `marketing-showcase`
- `marketing-field`
- `marketing-anatomy-play`
- `marketing-home`
- `marketing-brain-pages`
- `marketing-pricing`

**Updated tests:** listed by merge in the existing-test table (§2). This now includes `marketing-frontier` (WP0).

**Tests that stay as they are and must still pass:**
- `scroll-scenes-engine`
- `discovery-seo`
- `public-pages`
- `setup-wizard-web`
- `analytics-consent`
- `rtl-layout`
- `motion-css`
- `i18n-hardcoded`
- `marketing-api`
- `marketing-follower-model`
- `branding`

### 4.3 Browser checks

**New `scripts/marketing-showcase-check.mjs`**
- It runs on the production build against the platform stub: first with sign-ups closed, then ready.
- Every page load uses `?sc=on`, except the JavaScript-off pass (check 1) and the robot pass (check 15).
- It wraps `requestAnimationFrame` with `addInitScript`.
- CPU throttling (CDP `Emulation.setCPUThrottlingRate 4`) applies only in the metrics pass. The judged checks run unthrottled.
- Viewports: 390×844 (with the consent bar open), 375×667, 360×800 and 1440×900.

*Judged in CI (deterministic):*
1. **JavaScript off** at 390×844:
   - `/` shows Noura's words, "STOP · No AI called" and the Paused bin, all ending above y 770;
   - the lanes are visible at 375×667;
   - no `img`, `video` or background image inside `[data-showcase]`;
   - injecting the lazy sheets (`engine/*.css` from the build) moves no static-frame box.
2. **The LCP element is the H1 or the lede** (SHOWCASE_DESIGN.md §1.6) on all four pages at 390 and 1440.
3. **CLS of 0.001 or less.** Report-only until it passes 3 of 3 PR CI runs, then judged (`SHOWCASE_JUDGE_CLS`). Measured:
   - from navigation to `load`, plus 10 s of the field and board running;
   - across a playground run (5 s after the click, inputs excluded);
   - while scrolling the anatomy;
   - on `/pricing`, through slider and `TakeHome` input (inputs excluded).
4. **No horizontal overflow** at 360, 390 and 1440 on the four pages, in left-to-right and in `?lang=ar` right-to-left. No duplicate ids, no page errors and no console errors.
5. **Lifecycle:**
   - `data-sc` reaches `on` within 15 s;
   - with the engine's network requests aborted after `load`, the hero root shows `data-sc="off"` within 7 s of `data-sc-ready`, with the final state visible;
   - the anatomy root, scrolled near with the engine aborted, turns `off` within 7 s of first coming within 200 px. It gets `data-sc-flat` only while entirely below the viewport, and no layout shift is recorded.
6. **Frames:**
   - while visible and running, `data-sc-run` is present, and more than 0 frames run in 1 s (no throttling);
   - `data-sc-run` is absent within 1 s in each of these states: off screen, the document forced to hidden, after Pause, under emulated reduced motion, with the member's reduce-motion cookie (`<html data-reduce-motion="on">`), and with `html[data-mk-call]` set;
   - other marketing motion still runs under "always" (`.mk-motion` and the reveals);
   - no `getAnimations()` with infinite iterations inside `[data-showcase]`.
7. **Watchdog:** `?sc=on&tier=full&slow=30` steps `data-sc-tier` down within 5 s.
8. **Kamran:** with the assistant stub on, at 390×844 and 360×800, scroll 0, the floating button's box overlaps no showcase control.
9. **Receipt and overlays:**
   - opening a receipt moves focus inside; Esc closes it and returns focus;
   - open → Pause → close leaves "Play" with `aria-pressed="true"` and no `data-sc-run` (corrected 28 Oct: "Play" with no `aria-pressed`);
   - with the consent bar open, an open receipt and the open phone sheet are topmost at their centres (`elementFromPoint`);
   - navigating away with a receipt open leaves no `.sc-layer` nodes and no `html.sc-lock`.
10. **Playground** on `/demo`:
    - Knee gives "Training paused" and "No AI called";
    - deload gives "Waits for you";
    - Low recovery gives "Not on yet" with no run;
    - free text gives "Closest sample: …";
    - a setting change shows the before/now diff line;
    - chips work from the keyboard.
11. **`/trainer-brain`:**
    - at 1440×900, `sc-pin` is set, the section is more than 3 viewports tall, and steps advance while scrolling;
    - the pinned frame's top equals the header's bottom at 1440, 1000 and 390 widths;
    - reduced motion and 1440×650 give flat plates;
    - "See it work" runs the matching trace.
12. **Navigation loop.** The first URL carries `?sc=on`, which persists for the tab. Then three rounds of `/` → `/pricing` → `/` → `/trainer-brain` → `/demo` → `/` by link clicks:
    - no errors;
    - each arrival reaches `on`;
    - `requestAnimationFrame` callbacks per frame in round 3 do not exceed round 1 (no duplicate loops).
13. **Sign-ups closed:** no `href="/signup"` anywhere on the four pages after mounting; "Join early access — free" is shown.
14. **Pricing islands:** 25%, 21.7%, 17% and 14.7% at 100, 300, 1,000 and 1,500 subscribers; the take-home figures equal `estimateEarnings`, which the check imports.
15. **Robot path:** without `?sc=on`, a webdriver visit to each page:
    - requests no engine chunk;
    - gets no `sc-motion` or `sc-pin`;
    - keeps every root at `data-sc="pre"` with the final frame visible.

    So the call, browser and completion checks run the static path.

*Reported in CI, judged locally.* Robots, Lighthouse included, never run the engine, so Lighthouse scores exclude engine cost; these budgets are measured here.

| Metric | Budget |
|---|---|
| p95 frame gap, 4× throttle, `?tier=full` | 20 ms or less |
| p95 engine work per frame | 4 ms or less |
| Time from `load` to the STOP stamp, 390×844, 4× throttle | 2.5 s or less |
| TBT | Baseline + 100 ms or less. Looser than SHOWCASE_DESIGN §1.6 (prototype + 50 ms) |
| Long tasks from mounting | At most 2, each 80 ms or less. Looser than §1.6 (no task over 50 ms) |
| Chip click and slider input latency | 200 ms or less |
| Shared JS growth | 10 KB gzipped or less |
| Engine chunks per page | Home 45 KB gzipped or less, plus the receipt at 7 KB on demand; /trainer-brain 50 KB or less; /demo 37 KB or less (review estimates: about 43, 47 and 35) |
| First-frame showcase CSS (`app/brain-*.css`) | 18 KB gzipped or less (unit test; measured 16–18 KB on the prototypes) |
| Page sheets | 8 KB gzipped or less (unit test) |
| Global CSS added | Gross 26 KB gzipped or less; the net after WP7a's deletions is recorded and goes in the owner FYI list |
| Showcase HTML cost on /trainer-brain (in both the HTML and the RSC payload) | 25 KB gzipped or less, recorded (review: about 22 KB) |

The two budgets looser than the spec are deliberate. They are listed for the owner (§6) and recorded in `brain-showcase.md`.

**Existing checks**
- `run-browser-check.mjs`, in the application job: covers all four pages, plus WP5's `/demo?sc=on` smoke test.
- `browser-completion-check.mjs`: unchanged (wheel and consent; static path).
- `run-marketing-call-check.mjs`, in the homepage-call job: unchanged (static path) and must pass.
- Local only: `npm run test:brand`, `npm run test:marketing-motion`, `run-rtl-check.mjs`.

**Home word budget (`brand-check`, local)**
- Count visible words in `main`, excluding `[data-showcase]`, `[data-sample-ui]`, `.mk-home-calc`, and closed or hidden content. That matches how C1 counts.
- The target is 400. If the approved copy measures over 400, record the measured figure as the budget in `marketing-site.md`. Do not cut copy without the owner.
- The H2 cap becomes the registry list plus the closing panel.

### 4.4 Accessibility

- Every moment is a named button, and the canvas is `aria-hidden`.
- One polite live region per document, in the overlay layer, used only for changes the visitor caused.
- Level controls are ARIA radios moved with the arrow keys. The stepper and the walkthrough follow the tabs pattern with a roving tabindex.
- Sliders carry `aria-valuetext`.
- Controls are 44 px or larger. (Amended 28 Oct, after the final review's A11Y-10: on phones every showcase control has a hit area at least 44 px tall, except the field's level radios, which are 28 px wide because Kamran's gutter leaves no room at 360 px, and the anatomy's notes on pinned phones, which are 22 px tall because 44 px would break the pinned layout. Both pass WCAG 2.5.8's 24 px. Desktop controls stay at 20–38 px. Both belong on the owner's FYI list.)
- A Pause control appears wherever motion runs longer than 5 s (WCAG 2.2.2).
- The phone hero's DOM order (H1 → field → lede → CTA) makes focus order follow visual order (WCAG 2.4.3, 1.3.2).
- The pinned anatomy has a "Skip the figure" link.
- Receipts and the phone sheet are topmost while open, trap focus and return it on close.
- Contrast is enforced by the token test.
- The keyboard paths are checked in §4.3.
- `next dev` shows no hydration warnings on the four pages. The render strings must be valid HTML: a parser fix-up would cause a mismatch.

### 4.5 Living alongside the untouched pages

- The registry snapshot runs at every merge:
  - WP0's first merge changes nothing;
  - each page merge changes only its page (plus `/faq` with `/`).
- At the milestone, the only HTML changes outside the four pages are the extra `/faq` question.
- The header, phone menu (#102), footer and Kamran are unchanged.
- Other pages keep "Start coaching" and "Available soon".
- `run-browser-check` visits every page.
- The local sitewide motion check covers `/how-it-works`, `/features` and `/earnings-calculator`.
- Every deleted CSS selector has its grep proof recorded in the PR.

### 4.6 Milestone, CI, deploy, live

**One full run at the milestone, in this order:**
1. `npm run check`;
2. `node scripts/brain-traces.mjs --check`;
3. `npm run test:marketing-showcase`;
4. `node scripts/run-browser-check.mjs` and `node --import tsx scripts/run-marketing-call-check.mjs` (with `RTL_WEB_MODE=start AUTHENTICATOR_REQUIRED=false`);
5. the local brand and motion scripts;
6. a static-mode rehearsal: `MARKETING_SHOWCASE=static` on `next start`. The four pages render `data-sc="off"` and request no engine chunk.

**After the deploy:**
- HTTP checks on the four live pages:
  - status 200, the title, the H1, the `data-showcase` roots and the CTA labels;
  - the header shows the release;
  - none of the payments-off strings while payments are on.
- A local, read-only Playwright run of checks 1–6 and 10 against production, with `?sc=on`.
- If a live check fails: switch to static mode (`runtime.env` plus a restart), then fix forward.

---

## 5. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Desktop frames are slow because of paint, not script (33 ms p95 headless without a GPU, Map 4) | Tiers and a watchdog that only steps down (corrected 28 Oct: it also steps back up after two good windows, never above the starting tier, and judges each tier against its own frame rate); DPR capped at 2; pre-drawn bitmaps; `contain: paint` on the canvas layer; no blurred shadows. CI only reports this; it is judged locally on real hardware. |
| Long tasks before `load` (845 KB gzipped of shared JS) | The engine loads only after `load` + idle, and TBT is compared with the baseline. Splitting marketing from the workspace bundle is the real fix: recommended for phase 2 or 3. |
| Engine CSS or runtime code reaching the server render, or every route's first HTML | The render/runtime split; a static-import walk test from `site.tsx` and `render.ts`; runtime sheets only inside client `import()` chunks. |
| Layout shift from engine DOM changes | Reserved slots, including two lines of streamed text; transform-only motion; the pin height set before the first paint; the anatomy flattens only off screen. CLS is judged at 0.001 or less once it passes 3 of 3 CI runs. |
| Memory leaks or duplicate loops after client navigation or Strict Mode | `destroy()` restores the snapshot and removes overlay nodes and `html.sc-lock`; module state is reference-counted; host and island share one key; a navigation-loop check. |
| Robots and automated browsers never run the engine, so existing CI and Lighthouse do not exercise it | The showcase check runs with `?sc=on` and measures the budgets; check 15 proves the static path. |
| An engine failure in production | The 6 s fallback, after which `off` is final; the anatomy flattens; static mode via `runtime.env` and a restart, with no build. |
| Overlays (receipts, the phone sheet) hidden or clipped | One overlay layer inside `.mk` at z-index 70; containment only on the canvas; check 9 asserts they are topmost. |
| The trace test fails on unrelated product copy changes | Intended: it is the honesty guarantee. The failure message links to `brain-showcase.md` to explain how to update the traces. |
| Flags change later, for example payments switching on | Payment-dependent strings and statuses derive from flags; tests cover both states; the shared key remounts host and island. |
| Test churn and parallel conflicts | One owner per file; new test files per WP; existing-test edits assigned by merge; append-only shared blocks; every merge green. |
| Copy or SEO regressions | Titles and descriptions are kept or sized to the limits; canonicals unchanged; JSON-LD, llms and snapshot tests; the home keeps its visible intro; `data-nosnippet` on showcases; no placeholders (tested). |
| The Kamran call check (a deploy gate) | The button is unchanged; the call check sees the static path; the field pauses during real calls and keeps clear of the button on phones; navigation teardown cannot throw; the call check runs in the PR. |
| CSS growth paid by every route on the catch-all, member app included | Budgets set from measurement (18 KB first frame, 8 KB pages); the lazy-sheet rule; the cost goes in the owner FYI list; the route split is recorded as the follow-up. |
| A new CI step slows or flakes the gate | Only deterministic assertions are judged; throttling only in the metrics pass; timings are reported only; the step is added after the pages land; its time is capped in the homepage-call job (5 of 40 min used today). |
| XSS through a configured platform name inside the static HTML | `esc()` everywhere, with a test using `<script>`. |
| Right-to-left documents and view transitions | Logical CSS, including Kamran's gutter, plus right-to-left smoke checks; marketing has no view transitions (§1.8). |

**Out of scope for phase 1**
- **Phase 2:** every other page, plus these sitewide changes:
  - "Teach your AI — free" everywhere (`claimCta`, sign-up heading, Kamran's hand-off);
  - "Not on yet" replacing "Available soon";
  - the C0 navigation, the phone sticky CTA bar and the page transition;
  - Kamran's inline pills and appearance on more pages, and `/demo` in his destinations;
  - FAQ renames on other pages;
  - deleting or reusing the scroll-scenes engine (and `scenes-on` on `/`);
  - `/coaches` noindex.
- **Phase 3:** Arabic strings, measurement hooks and events, the A/B route split.
- **Later:**
  - a founder note and a card-processing rate (owner defaults);
  - a recovery flag tied to `WHOOP_TRAINING_APPROVED`;
  - self-hosted JetBrains Mono;
  - a TypeScript port of the engine;
  - in-browser safety rules for free text;
  - B's digit roll;
  - tightening the long-task and TBT budgets to SHOWCASE_DESIGN §1.6.

---

## 6. Notes for the owner

- **No phase 1 work waits on you.** The defaults you accepted cover everything.
- **Deploying.** The merge deploys, per your 27 Oct "checked and deployed". The records note that this is your explicit instruction, which `CLAUDE.md`'s "deployment remains stopped" line requires.
- **For your information**, listed in the PR:
  - **Copy trimmed or derived to fit the house limits:** the lines marked "Derived (FYI)" in WP0, plus the reworded t2 trace note ("the safety rules now catch").
  - **"Download your data and request deletion"** replaces A's "Export or delete it whenever you like" on /trainer-brain, because deletion is a reviewed request. /pricing uses the same wording. No portability promise.
  - **The home keeps "How does trainsyou work?" first**, so it has 7 questions.
  - **The Instagram question moves to /faq.**
  - **The Never sheet ships unsigned** (no founder note yet).
  - **CSS cost.** Every page of the site, the member app included, loads the showcases' first-frame CSS: about 16–18 KB gzipped, plus up to 8 KB for the page sheets, minus what is deleted. This holds until the marketing and app bundles are split.
  - **Two speed budgets are looser than the showcase spec:** long tasks of 80 ms or less (spec: 50 ms), and blocking time of baseline + 100 ms or less (spec: prototype + 50 ms).
  - **Layout-shift checking in CI starts report-only.** It becomes a hard gate once it passes three runs in a row.
  - **Search engines and automated tools see the still frame**, not the animation. Lighthouse scores will not include the engine's cost.
  - **There is an off switch.** `MARKETING_SHOWCASE=static` turns every showcase into its still frame without a rebuild.
  - **Until phase 2, other pages still show** "Start coaching", "Available soon" and "the AI" questions, and Kamran stays a floating button on the home only.
- **Optional:** after the deploy, open the home on your own phone and laptop. Smoothness on real hardware is the one thing the automated checks can only report, not judge.

---

## Changelog (review item → change)

**P0**
- **P0-1, engine CSS reaching the server render.** Each kind is split into `<kind>.render.js` (pure: no CSS, no DOM) and `<kind>.js` (runtime, imports its CSS). `render.ts`, `roster.tsx` and the tests import only render modules; `LOADERS` names only runtime modules.
  - Added the static-import walk test from `site.tsx` and `render.ts`.
  - The no-side-effect test is limited to render, core, decide, ui and data.
  - Applied in §0.1, §1.1 (table, loading, server use), §1.4, the interfaces, WP1–WP3 and §5.
- **P0-2, the verbatim core fails `next build`.** WP1's first commit already removes the fetch and `new URL("traces.client.json", import.meta.url)` (`brain-core.js:58`); `prefetch` takes a loader (`:310`); `a-field.js:199` and `:1227` are fixed in WP2.
  - Added the test for non-literal `import(`, `fetch(` and `new URL(…import.meta.url)`.
  - Applied in §1.1 core (b)(c), the field row, WP1 and §3.

**P1**
- **P1-1.** WP0 edits `marketing-frontier.test.ts:26-37, :66, :116` (identity with payments off; `when` ∈ {frontier, payments}; copy limits for every line). Removed from "stay as they are" (§4.2).
- **P1-2.** `site.tsx` keeps exporting `Section` (a re-export), `bandPills` (`:338`) and `availabilityChip` (`:70`). WP7a moves the test imports (`marketing-journey.test.ts:21-24`); WP4 drops the then-unused `bandPills` import (`marketing-site.test.ts:61`).
- **P1-3.** `marketing-motion-sitewide.test.ts:493-515`: reduced-motion rules are required only in sheets that declare `animation` or `transition`; every existing rule still carries the exclusion.
- **P1-4.** WP0 (not WP5) writes `next` and `moments` near their caps and measures `registryWords('/demo')` ≥ 350, with the 380 → 174/184 arithmetic recorded. No approved FAQ is left to add (A has four, `pages-product.mjs:1683-1688`).
- **P1-5.** Three copy literals tokenised (`rule.source` in `traces[1]`, `[10]`, `[11]`). `format` stays literal and is the only no-brand exemption. t2's whole `basis.note` is reworded. `decide: "floor"` is kept as an enum. Scans cover visible strings only (`NON_TEXT_KEYS`).
- **P1-6.** The engine never mounts for webdriver or bots without `?sc=on`, which persists in `sessionStorage`.
  - The head script, the island, checks 7, 11 and 12, WP3/WP5 acceptance and the `/demo` browser smoke all use `?sc=on`.
  - New robot-path check 15. Lighthouse exclusion noted (§4.3, §6).
- **P1-7.**
  - LCP accepts the H1 or the lede (check 2, WP4, WP6).
  - WP2 reserves two lines for the streamed text.
  - WP6 gains a CLS acceptance.
  - CLS is report-only in CI until 3 of 3 PR runs pass (`SHOWCASE_JUDGE_CLS`).
- **P1-8.** Below 760 px, the field's control row keeps a 76 px inline-end gutter (§1.8, WP2). WP4 and check 8 verify it at 390×844 and 360×800.
- **P1-9.** The key is an inline FNV-1a hash, with no `node:crypto` and no `server-only` (§1.2).
- **P1-10.** WP4 keeps the `.mk-econ` wrapper around `AddressPreview` and its test pins it. WP7a keeps the `.mk-econ .mk-address` rules.
- **P1-11.**
  - The first-frame budget is now 18 KB, from measurement.
  - Lazy-sheet rule, with a unit test and a browser assertion (check 1).
  - The budgets table is reworked (gross 26 KB; net recorded).
  - Global CSS cost added to the owner FYI.
- **P1-12.** The phone sheet moves to the overlay layer. `contain: paint` applies to the canvas layer only. Check 9 asserts overlays are topmost.
- **P1-13.** Receipts mount in `.sc-layer[data-showcase="layer"]` inside `.mk`, not `<body>`, so they get the tokens and the scoping. `destroy()` removes the nodes and `html.sc-lock`. Navigation is checked in check 9.
- **P1-14.**
  - (a) Host and island share the key; cleanup restores into the captured host.
  - (b) `sc-late` is never removed; `settled` mounts.
  - (c) The fallback starts when the root is first near the viewport, and `off` is final for that mount.
  - (d) A failed anatomy flattens via `data-sc-flat`, only while it is below the viewport; static mode renders it flat.
  - (e) Pin heights corrected: 420svh desktop (`c-anatomy.css:10`), 230svh at 760 px or less (`:286`).
- **P1-15.**
  - The `PLACEHOLDER` test covers the four pages, the registry and the traces.
  - B's rate and portability placeholders and C's signature slot are not ported; the Never sheet is unsigned.
  - "Export or delete it whenever you like" is replaced by "Download your data and request deletion" (WP0 `yours`, §1.6, §6).

**P2**
- **P2-1.** Hero DOM order is H1 → field → lede → CTA, with grid areas and no CSS `order`. A's fixed two-line phone H1 is kept, inline (WP4, §4.4).
- **P2-2.** `prepare()` deep-clones, with purity sequence tests (§1.3, WP1).
- **P2-3.** Product attribute `data-sc-run`. "Frames > 0" is judged without throttling; paused states are judged by `data-sc-run`. The navigation loop compares callbacks per frame across rounds (checks 6, 9 and 12).
- **P2-4.** WP7b acceptance is 3 of 3 PR CI runs; throttling only in the metrics pass; the 6 s fallback is timed from `data-sc-ready`.
- **P2-5.** The known-red rule is replaced: every merge keeps `npm run check` green.
  - The existing-test table is assigned by merge.
  - Each page's registry entry and `TEACH_CTA_PATHS` line merge with its page.
  - WP0's first merge changes no HTML.
  - WP7b's CI step is added after the pages land.
  - WP7a shrinks to deletions and their follow-on edits.
- **P2-6.** The long-task and TBT budgets are marked looser than SHOWCASE_DESIGN §1.6 (§4.3, §6, WP8, "Later").
- **P2-7.** Port steps added:
  - `root.__mc` (`a-field.js:1229`) and the `"signup.html"` fallbacks (`:326`, `:339`);
  - play's `mount` sets `data-sc="on"`;
  - host-prefixed ids (`brain-play.js:38, 44, 88`);
  - anatomy returns inner HTML only, with `labelledBy`; WP5 renders the skip link;
  - the extra live regions removed (`a-field.js:173`, `c-anatomy.js:178`);
  - the `reduced()` cache resets (`brain-core.js:90-94`).
- **P2-8.** The header offset is copied into `brain-stage.css` as `--sc-top` (from `scroll-scenes.css:34-46`), with an equality test and a flush-under-header check. `scenes-on` on `/` is noted as harmless and documented.
- **P2-9.** Kill switch: `MARKETING_SHOWCASE=static`, read per request in `page.tsx:311` and switched via `runtime.env` plus a re-apply (corrected 28 Oct). Static rendering is tested in WP1, rehearsed in §4.6 and used as the live fallback.
- **P2-10.**
  - `.sc-host` added to `NEVER`.
  - WP4 renders the CTA under the compact calculator (`islands.tsx:431-445`).
  - Engine CTAs route through `router.push` via `navigate`.
  - `data-nosnippet` on roots.
  - The `marketing-journey.test.ts:220-232` edit is dropped.
  - The deploy reconciliation (`CLAUDE.md:9` vs `AGENTS.md:35`) is recorded by WP8 before the merge.

**Corrections from "Confirmed good"**
- The `HeroFlow` import is at `site.tsx:58`, not `:56` (WP7a).
- `MEMBERSHIP_MINIMUMS` is imported from `@trainer/contracts` (`membership-pricing.ts:3`), not the domain package (§1.6, WP6).

**Effort:** about 26 → about 28 dev-days: lifecycle, overlay layer, kill switch and per-merge test edits.