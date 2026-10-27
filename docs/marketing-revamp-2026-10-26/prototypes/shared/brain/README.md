# Brain showcase engine (shared core, round 2)

Shared engine for the three concept showcases (A "Mission control", B "24 hours of your Brain", C "Anatomy of a decision"), plus the shared playground "Throw a moment at your Brain" (spec §5). The spec is `../../showcase-final.md`. The facts behind it are in `../../showcase-map.md`.

No libraries, no WebGL, no external URLs. ES modules with relative imports, served over http(s) (an artifact upload or the generator's `site/` folder; `fetch` of the traces does not work from `file://`, so inline them with `<script type="application/json" data-brain-traces>` if you ever need that). Copy the whole folder to `site/assets/brain/`.

## Files

| File | What | Size (gzip, unminified) | Budget |
|---|---|---|---|
| `brain-boot.js` | Bootstrap (classic script, inline it): load → idle → near → `import()` | 646 B | ≤ 1 KB |
| `brain-core.js` | Data loading, one rAF loop, scenes (offscreen/hidden/idle/Pause), timelines, tiers + watchdog, reduced motion, live region, seeded RNG, DPR-capped canvas, DOM helper | 5.3 KB | ≤ 6 KB |
| `brain-decide.js` | `decide(trace, settings)` and the app's maths (plan confidence + route reasons, too-heavy rule, recovery rule), totals | 4.7 KB | — (split out of core to keep core under 6 KB) |
| `brain-ui.js` | HTML-string atoms shared by play and anatomy (nodes, lane chips, member phone with provenance, Today card, rule card, "How sure", receipt rows, streamer) + 40 lucide icons | 5.6 KB | — |
| `brain-play.js` | The playground | 13.7 KB | ≤ 16 KB |
| `brain-anatomy.js` | C's anatomy: receipt mode (A's zoom, phone sheet), the 3D stack driven by `progress(p)`, Fig. 4 | 8.3 KB | ≤ 12 KB |
| `brain-base.css` | Ink-stage tokens (`--sc-*`) and shared atoms | 3.5 KB | |
| `brain-play.css` | Playground layout | 3.9 KB | |
| `brain-anatomy.css` | Receipt sheet, 3D stack, flat view, Fig. 4 | 3.2 KB | |
| `traces.json` | Canonical data, `trainsyou-brain-trace@2`, 25 specialists, 12 traces (with `code` and `basis.refs`) | 51 KB raw | |
| `traces.client.json` | What the browser loads: minified, `code` and `basis.refs` stripped | 10.3 KB gz | |
| `demo.html` | Standalone test page (playground + receipt for every trace + C stack + Fig. 4) | | |
| `tools/` | `make-traces.cjs`, `verify.mts`, `build-demo.mjs`, `qa.cjs`, `serve.cjs`, `make-icons.mjs` | | |

Per page, what loads: playground = boot + core + decide + ui + play (≈ 30 KB gz JS) + `traces.client.json` (10 KB) + base/play CSS. Receipt only (A home) = core + decide + ui + anatomy (≈ 24 KB gz). All after first paint.

## Data (`traces.json`)

Format `trainsyou-brain-trace@2` exactly as spec §1.4. Rebuild with `node tools/make-traces.cjs` (reads the round-2 source `scratchpad/showcase/brain-traces.json`, applies the round-3 fixes listed in the script, writes both files).

```ts
Data = { format, updated, basisCommit, labels, settingsDefault, specialists: Specialist[25], traces: Trace[12] }
Specialist = { id, name, kind: "ai"|"check", crew: "teach"|"coach"|"guard", icon, line, signsOff, status: "live"|"try_yourself"|"not_on_yet", statusTip?, usesAi?, flag?, code }
Trace = { id: "t1-squats-easy", chip, decide: "chat_action"|"chat_review"|"floor"|"topic"|"plan"|"meal"|"voice"|"learn"|"recovery",
  member, when, channel, trigger: {text, lang: "en"|"ar", gloss?}, inputs?, steps: Step[], rule, sure: null|{weights, signals, score, threshold, display},
  sureNote?, reasons?, lane: "sent"|"waits"|"paused"|"member"|"learn", laneNote?, memberSees, trainerSees, status, statusNote?, flag?,
  basis: {refs, note}, controls: string[], variants: [], weight, subtitle, defaultOff?, tileTag?, verify?: string[] }
Step = { sp: specialistId|"any_ai"|"you"|"member"|"code", label?, at, dur /* ms at speed 1 */, result, say, detail?, out?, script?,
  basis?: "recorded"|"tests"|"illustrative"|"computed", fn?, highlight?, verbatimRef? }
```

Round-3 changes to the data (all in `tools/make-traces.cjs`): every step has explicit `at`/`dur` in run order (t2, t3, t5, t7, t9, t11, t12 were missing some); t12 highlights are exactly `يعورني` and `بدوخة`; `sureNote` for every non-plan trace; `verify` tags on t6 and t9 (t7 already had two); t8/t10 signals carry `missing` and `checks.list` so the browser rebuilds the app's reason strings; Plan writer / Week reviewer `signsOff` "Sure score…" → "Confidence and your bar"; t10 checker wording "Sessions 75 min or less".

**Verified against the code** (`cd /home/user/trainer_what && npx tsx <this folder>/tools/verify.mts`): 4,418 checks, 0 failures. It covers the schema; the 25 public names (14 AI, 11 code); every §1.5 honesty string; level names/summaries vs `BRAIN_LEVELS`; the plan slider label and range in `brain-plans.tsx`; plan defaults (0.8, spot check 0.25, 20 reviews); `RECHECK_DELAY_SECONDS = 60`; `VOICE_SAFETY_LINE`; platform member strings in `coaching-completion.ts`/`coaching-runtime.ts`; feed wording in `workspace-live.ts`; `redFlagCategories` on every chat trigger (floors hit, the rest are routine); every highlight word sits in a sub-phrase that triggers alone; `decide()`'s plan maths vs `planConfidence` + `planRoute` over 480 setting combinations (score, % rounding, route, reason strings, lane); `reducedLoad` 0–20 %; `reduceWhoopWorkout` over 77 load/volume combinations; every JSON variant reproduced by `decide()`; totals equal `labels.totals` with the recovery flag off and on; one AI specialist per message; floors call no AI; chat traces have no score; no model or vendor names.

## Mounting a piece

### 1. The bootstrap (≤ 1 KB, spec §1.6 Loading)

Inline `brain-boot.js` at the end of `<body>` (or `<script src>` it). It finds `[data-showcase][data-sc-module]`, sets `data-sc="pre"`, then on `load` → `requestIdleCallback(start, {timeout:1500})` (Safari: `setTimeout(start, 300)`) → IntersectionObserver (200 px) → `import(module).mount(el)`. If nothing started by 6 s it removes `data-sc` so the static final state shows. Module paths resolve against the page URL.

```html
<section class="bp" data-showcase="play" data-sc-module="assets/brain/brain-play.js" data-cta="signup.html">
  <!-- static no-JS markup from renderStatic() goes here -->
</section>
<script src="assets/brain/brain-boot.js"></script>
```

Use `[data-sc="pre"] .your-result-state { visibility: hidden }` in concept CSS to hide result states until the module plays.

### 2. Playground (`brain-play.js`)

```js
import { mount, renderStatic, closest, COPY } from "./brain-play.js";
const api = await mount(el, { src, cta: "signup.html", heading: false, recovery: false });
// api: { run(id, fromStep=0) → Promise, showAll(on), settings, data, scene, closest(text), result }
```

- Options also come from data attributes: `data-src`, `data-cta`, `data-heading="off"` (when the page has its own H2), `data-recovery="on"`.
- **No JS:** `renderStatic(data, {cta, heading, recovery})` returns the whole playground HTML with t1 resolved (final node states, result, steps, controls; buttons disabled). It runs in Node: `import { renderStatic } from ".../brain-play.js"` from the generator, then put the string inside the mount element. `tools/build-demo.mjs` shows how.
- Behaviour implemented (spec §5): specialty select reorders chips (orders from the spec, first 6 on phones plus "More moments"); 12 chips (t3 dashed "Not on yet" while the flag is off → dashed static receipt, no run, no pulse); free text → local keyword table → "Closest sample: {chip}. This page can't read new messages." (specific matches first, so "chest pain" → t12); steps play at JSON timings; "Code picks" line straight from the moment's kind tag to the one specialist; checks light in sequence; STOP stamp + red words + dim + red route for floors; rule lines from the rulebook spine; AI `out` fields stream at 40 characters/s with a caret, code steps appear whole; basis tags on every AI step and "Worked out by the app's own rules" on computed code; chips `aria-disabled` + "Skip to result" while running; "Result: {lane}" announced; settings change → diff line "Before: … Now: … Why: …" + ghost of the previous lane chip + "Run it again" primary; "Run it again" replays only from the first changed step; "Throw them all" = 12 mini stacks at time scale 0.6 with 120 ms stagger, ending with the totals line, tap one to open it; Pause button; "How we count" note.
- The run scrolls the stage into view if it is off screen (the loop pauses off screen, so a run started from the controls on a phone would otherwise freeze).

### 3. Receipt mode (`brain-anatomy.js` → `open`)

```js
import { open } from "./brain-anatomy.js";
const r = await open("t2", { from: tile.getBoundingClientRect(), mount: frameEl /* optional: inline in A's frame */,
  settings /* A's current settings, so the receipt matches the field */, cta: "signup.html",
  onChange: (trace) => {/* "Change this setting" */}, onClose: () => {/* resume the field */} });
r.close();
```

- Desktop without `mount`: modal panel growing from `from`; phones (≤ 760 px): 85 % bottom sheet; with `mount`: inline (A's zoom inside the Brain frame). Focus moves to the heading, Tab is trapped (modal/sheet), Esc closes and returns focus to the opener.
- 600 ms explode of the nine plates (rotateX 56°, rotateZ −32°, 28 px apart), then they lie flat as the receipt. Reduced motion: crossfade only.
- Seven sections in spec order: The message · Step by step (with the "Code picks…" row before the one AI step) · Your rule · How sure (plans: % bar + bar tick; chat: "Chat replies have no score…") · What {name} sees (light phone, provenance key, "AI words: none") · What you see (product wording, plan reasons verbatim) · Where this comes from (basis note, status chip + tooltip, the banner). Buttons: Replay, Change this setting (only if `onChange`), CTA, Back to the Brain.
- `receiptHTML(data, trace, decision)` is exported if you need the sections without the dialog.

### 4. C's anatomy stack (`stack`) and Fig. 4 (`fig`)

```js
import { stack, fig, NOTES } from "./brain-anatomy.js";
const s = await stack(el, { trace: "t1", notes: NOTES, onWhatIf: (k) => {}, flat: undefined /* auto: phones */ });
s.intro();          // one-time 1.2 s burst from the card (0.9 s fan-out on phones); resolves when done
s.progress(p);      // pure function of p ∈ [0,1], spec §4 table: 0–.06 exploded hold · .06–.78 inspect (a)–(i) · .78–.90 (j) correction · .90–1 recompress + What-if row
s.layout();         // call if you change the stage size yourself (a ResizeObserver already does)
await fig(el2);     // Fig. 4: flat plates + "What if his knee popped?" / "…plan change?" / "…level 1?" (2.4 s replays)
```

- C owns the pin and the scroll → p mapping (and `--len`). The stack never reads rects in `progress()`; leader anchors are projected from the known transform (`DOMMatrix` rotateX 56° · rotateZ −32° · perspective 1600, translateZ −i×56) with the stage size read on resize.
- Inspect: the plate comes forward flat (counter-rotated), others drop to 0.35, the note highlights, one leader is bright. (b) highlighter scrubs, (e)/(g) rows tick with `--q`, (f) shows the seven coaching pills on an arc with one lime line from "Chat · a rule fits" to the Reply picker, "Code picks the specialist. No AI chooses which AI runs.", the reason reveals with scroll, the camera pulls back to 0.88 and three ghost stacks light (Aisha → Week reviewer, Priya → Meal photo reader, Noura → red Safety plate).
- Flat view (phones, reduced motion): plates in a column with each note on its plate (Fig. 3a–3j).
- `mount(el)` is the bootstrap entry: `data-ba="stack"|"fig"`, `data-trace`.

## Core API (`brain-core.js`)

| Export | Use |
|---|---|
| `load(src?)` → `Promise<data>` | Inline `<script type="application/json" data-brain-traces>` first, else `src`, else `traces.client.json` beside the module. Cached. Adds `data.sp[id]`, `data.trace("t1"|fullId)`, `data.short(t)` |
| `scene(el, {idle, resumeOnInput, onState})` | A showcase region. Its loop subscribers get no frames when off screen (IO), tab hidden, after idle (90 s, 60 s on phones; `idle: 0` disables), or paused. `sc.pause()`, `sc.play()`, `sc.button(btn, {pause, play})` (visible label + `aria-pressed`), `sc.loop(fn, fps)`, `sc.running`, `sc.reasons`, `sc.destroy()` |
| `loop(fn(dt, now), {fps, scene})` | The one rAF loop for the page. Return `false` to sleep until `handle.wake()`. `handle.fps = 12` for breathing. FPS is capped by the tier |
| `timeline(scene)` | `.at(ms, fn)`, `.span(ms, dur, fn(k))`, `.play(speed)` → Promise, `.skip()` (run everything now: reduced motion, "Skip to result"), `.stop()`, `.t`. Runs on the scene's clock, so it pauses with the scene |
| `tier` | `{name: "full"|"lite"|"minimal", spec: {ghosts, halos, dpr, fps}, ghosts, down(why), on(fn), log}`. Starts lite when `hardwareConcurrency ≤ 4`, `deviceMemory ≤ 3` or `saveData`; WebKit starts full. Watchdog: frames averaging > 20 ms over 2 s, or 1 frame in 20 over 25 ms across 2 s (added in the 27 Oct QA: a steady stutter can average under 20 ms), step down one tier, never up. `?tier=lite` forces |
| `stats`, `p95(list)` | `stats.gaps` (rAF intervals), `stats.work` (time in loop subscribers), `stats.frames`. `?slow=30` burns 30 ms a frame to test the watchdog |
| `reduced()`, `onReduced(fn)` | `prefers-reduced-motion`, `<html data-reduce-motion="on">` (the member's setting) or `?motion=reduce`. Followed even under `data-motion="always"` |
| `say(text)` | The one polite live region. Only for visitor-caused changes |
| `rng(seed)` | mulberry32 (A's playlist uses seed 7) |
| `fit(canvas, w, h)`, `bitmap(w, h)` | DPR capped by tier (full 2 / lite 1.5 / minimal 1; minimal went 1.5 → 1 in the 27 Oct QA, because a canvas that is not GPU-backed costs per pixel every frame); `bitmap` = OffscreenCanvas or a detached canvas for pre-drawn edges |
| `whenNear(el, fn)`, `prefetch(url, el, ms=10000)` | Module-side lazy mount; prefetch anatomy on idle 10 s or first pointerdown/focus |
| `flags()` | `{recovery}` from `<html data-recovery="on">` or `?recovery=on` (WHOOP_TRAINING_APPROVED; off by default) |
| `phone()`, `webkit`, `h()`, `esc()`, `clamp`, `lerp`, `ease` | Helpers |

## decide (`brain-decide.js`)

`decide(trace, settings, data)` → `{lane, why, steps, memberSees, trainerSees, sure: {display, score, bar, pct}|null, reasons, tag, note, off}`. Pure; re-run it on every settings change.

`defaults(data)` → `{level: 2, lastCheckPassing: true, capPct: 5, minRir: 2, bar: 80, planMode: "automatic", addEquipmentRule, oneMoreApproved, loggedShare: 1, supplementsTopic: true, tooHeavyPct: 10, recoveryFlag: flags().recovery, recoveryRule: true, recoveryReading: 25, lowLoadPct: 10, lowVolumePct: 25}`. Note `bar` is in % (50–99); the raw 3-decimal score is compared with `bar/100` (86 passes 0.862, 87 does not).

Also: `totals(data, settings)` ("In this sample: 3 within your rules · 1 member check · 3 waited · 3 paused · 1 new rule"; 4 with the flag on), `planScore(trace, settings)`, `reducedLoad(kg, pct)`, `reduceWorkout(list, load, vol)`, `pick(trace, data, settings)` (the one specialist code picked, or null), `isOff(trace, settings)` (t3 while the flag is off), `laneText(data, lane)`.

Lane rules in `decide`: chat_action sends at level 2/3 only with a passing last check and an eligible rule (4.2 % ≤ cap, RIR ≥ minimum), else the Draft writer drafts and it waits; chat_review always waits; floors always pause; topic waits (personal, 72 h), and turning the topic off swaps in the Draft writer and still waits; plans use the app's confidence formula and route; voice uses `reducedLoad`; recovery uses `reduceWhoopWorkout` bands (< 34 low, < 67 moderate).

## Skinning (CSS custom properties)

Set on the showcase root or any ancestor. Stage colours must stay within the spec's ink stage.

| Hook | Default | A | B | C |
|---|---|---|---|---|
| `--sc-font` | `var(--font-sans)` | Inter | Inter | Inter |
| `--sc-mono` | `var(--font-mono)` | JetBrains Mono (trace lines, bubbles, console) | Archivo wdth 75 / 700 | Inter |
| `--sc-display` | `--sc-font` | Inter | Archivo | Newsreader (italic letters, captions, notes on plates) |
| `--sc-radius` | 12px (stage) | 12px | 20px | 4px |
| `--sc-radius-ctl` | `var(--r-ctl, 6px)` | | | 2px |
| `--bp-chip-radius`, `--bp-h2-size`, `--bp-gap` | 999px, clamp(28–40px), 24px | | 10px | 2px |
| Stage tokens | `--sc-stage #171917`, `--sc-node #202320`, `--sc-tint #272B27`, `--sc-text #F3F4F0`, `--sc-muted #A9AEA6`, `--sc-line #3A3F39`, `--sc-control #8A8F87`, `--sc-ai-on #D5F24A`, `--sc-sent #7FCB9F`, `--sc-waits #E0B25C`, `--sc-paused #F08A80`, `--sc-grid` 5 % | | | |
| Paper side | `--sc-paper/--sc-ink/--sc-white/--sc-pmuted/--sc-pline` fall back to the site's `--paper/--ink/--white/--muted/--line` | | | |

Node shape is not skinnable on purpose: AI specialist = pill with round matrix dots, code = square (radius 4) with square dots, Examiner = square + "uses your AI" badge. The demo's skin buttons show A/B/C skins through these hooks only.

## Things the concept builders must know

1. **Copy the folder as is** (`assets/brain/`). Load `brain-base.css` on any page with a showcase; add `brain-play.css` for the playground and `brain-anatomy.css` for receipts, the stack or Fig. 4. Everything inside a showcase must sit under an element with `data-showcase` (or `.sc-stage`) or the `--sc-*` tokens are undefined (the modules set it on their own roots).
2. **One rAF loop per page.** Build A's field and B's day on `loop()`/`scene()`/`timeline()` from `brain-core.js`; do not start a second rAF. Use `sc.button()` for the visible Pause/Play (WCAG 2.2.2) and `tier` for ghost counts (`tier.ghosts` = 20 desktop / 12 phone on full, 8 lite, 0 minimal) and halos.
3. **Settings are shared objects.** Keep one `settings` per page (from `defaults(data)`) and pass it to `decide()`, the playground (`api.settings`) and `open()` so the field, receipt and playground agree.
4. **t3 (Recovery) is off by default everywhere.** `isOff(t, settings)` is true until `<html data-recovery="on">`; leave it out of A's playlist and B's track; the playground shows the dashed card. `totals()` already handles both cases.
5. **Never show two AI specialists on one message.** Use `pick(trace, data, settings)` to light exactly one node; floors and topics return null ("No AI called"). t7's Learner works on the trainer's edit, a separate moment.
6. **Honesty labels** come from `data.labels` (exact §1.5 strings): `chip`, `subscribers` (status strip, inside every stage: `ui.strip(data)`), `rates`, `long` (playground banner), `basis.*`, `picks`, `noChatScore`, `spotCheck`, `levels.note`, `howWeCount`, `eyebrow`. A's eyebrow is `labels.eyebrow`.
7. **Phone breakpoint is 760 px** (`phone()` and the CSS). Receipts become an 85 % sheet; C's stack goes flat.
8. **Reduced motion:** every module checks `reduced()`. Runs resolve instantly (`timeline.skip()`), no breathing, no explode, flat C. The member setting is `<html data-reduce-motion="on">`.
9. **Static first frame:** `renderStatic()` for the playground. A's field and B's day need their own server-rendered start frame (spec §2/§3). The H1 stays the LCP: don't place large showcase text above it.
10. **Open `verify` items** are in the data (t6, t9, t7×2); show t6/t9 Today-card titles only as written, and flag them to the owner.
11. **Not done here:** Arabic UI strings (spec: native translator), RTL mirroring of canvas paths beyond what DOM rects give, A's ghosts/field, B's day, C's pin.

## QA (run from this folder)

```sh
node tools/make-traces.cjs                       # data
(cd /home/user/trainer_what && npx tsx "$PWD/tools/verify.mts")   # maths + verbatim: 4,418 checks
node tools/build-demo.mjs                        # static markup into demo.html + size report
node tools/qa.cjs <shots-dir> [--quick]          # Playwright: 390×844 and 1440×900, normal / reduced motion / CPU ×4
```

## QA changes (27 Oct, concept A QA pass)

- `brain-core.js`: the minimal tier renders canvases at DPR 1 (was 1.5); the watchdog also steps down when >= 5% of
  frames exceed 25 ms over a 2-s window (a steady stutter can average under 20 ms and still break the p95 budget).
- `brain-play.js`: "Change a setting" stays invisible (its space kept, so no layout shift) until the first run (it showed an empty panel and a dead "Run it
  again" in the idle state).
- Copied into `concept-a` (rebuild), `concept-b/site/assets/brain/` and `concept-c/site/assets/brain/` (brain-play.js;
  concept C's build had already minified the new brain-core.js from here at 10:52).

## QA changes (27 Oct, concept C QA pass)

- `brain-core.js`: watchdog warm-up. Frames are not judged until 1 s after the `load` event, nor in the first 500 ms
  after the loop (re)starts. Page-load and module-mount jank were stepping showcases down a tier (C lost its ghost
  stacks for the whole page view) before the showcase had drawn a frame of its own. `stats.gaps` still records every frame.
- `brain-play.js`: layout-shift guard on mount. The live playground keeps the static (no-JS) result's height reserved on
  `.bp-res`, and the block's height until the first run; filling the result at the end of the first run had pushed
  "Change a setting" and the CTA down 650 px (CLS 0.06 at 1440, counted: it lands 5 s after the click).
- Copied into `concept-a/site/assets/brain/` (unminified, as there), `concept-b` (its build syncs from here; already
  synced at 12:57) and `concept-c` (its build minifies from here).
- `brain-core.js` `scene()`: the strip under a sticky site header (`--header-h` on `<html>`, when set) counts as off
  screen, so a showcase whose last few pixels sit under the header stops animating. Copied into A and B as above.

## QA changes (27 Oct, concept A creative-director pass)

- `brain-play.js`: **attract run**. The first time the stage is well in view (45 % of it, or half the viewport on tall
  phone stages) and nobody has used the playground, it plays the first moment of the list once (t1 for Strength). Not
  under reduced motion, announces nothing, keeps the chips live (any click, key or change takes over) and keeps the
  mount's layout-shift guard. Off with `data-attract="off"` or `{ attract: false }`.
- `brain-play.js`: phones bring the stage up when a chip is tapped and the stage starts below 40 % of the viewport
  (the run played below the fold); "Throw them all" does the same for the twelve stacks. `scroll-margin-top` clears
  the sticky header.
- `brain-play.js/.css`: each "Throw them all" stack shows the one specialist code picked (or "No AI called") the
  moment it is decided.
- `brain-play.css`: node names never break inside a word; a long result wraps to its own line ("Confidence" broke
  into "Co / nfi / de / nc / e" next to "78% · bar 80%").
- `brain-base.css`: receipt code-step glyph is a square with a filled core (the empty square read as an unticked box).
- `brain-anatomy.css`: the receipt burst keeps its own 340 px plates (C's `.ba-stack .ba-plate` rule, 520 px at
  left -260 px, pushed A's zoom burst off the stage's left edge).
- Copied into A (rebuild), B (plain copy) and C (minified, as `lib-brain.mjs` ships it).
