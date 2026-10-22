# Marketing motion plan (22 October 2026): always-on motion and the concept's motion on the trainsyou marketing site

Repo paths are relative to `/home/user/trainer_what`. "D L##" is a line in the concept file `/root/.claude/uploads/14381359-c138-56f9-a25b-830f6a2f39f9/5d68de8c-87g_1.html`.

I made no changes. The checkout is on `claude/repository-overview-osejlw` at 594810c. CLAUDE.md names `work/completion-2026-09-26` as the working branch, so line numbers need re-checking there before any edit.

## 1. The concept and what to borrow

The concept is a flat Swiss/fitness page where "the page does reps when you do". It has no ambient or timed loops and no `@keyframes`. All movement is one of three kinds:
- scroll-scrubbed transforms from a single rAF loop (D L525);
- one-shot IntersectionObserver reveals (D L72-73, L465-466);
- direct input: press, toggles and the FAQ icon.

Its strongest ideas map well onto our home page:
- restrained short durations (nothing timed over .5s);
- one easing family;
- one-shot reveals that stagger naturally;
- a "load the bar" entrance for the commission bands (D L334-342);
- a sense that the page hands the visitor to the next action.

Its weak parts are the costly or risky ones:
- a perpetual rAF loop with interleaved layout reads and writes;
- a 200vh kinetic hero and a 420vh horizontal track;
- 3D tilts and swings;
- text scrubbed out of the DOM;
- new widgets such as tickers, a clock and a progress barbell.

We should take its rhythm, tokens and three or four micro-interactions that point at "free to start" and the sign-up CTA. We should not take its architecture or its new sections. Our relay, journey, reveal engine and widgets stay exactly as they are.

## 2. Turning motion on for every visitor

### Exact changes

Scope: `.mk` (the MarketingSite root at site.tsx:1550, which contains the header and footer) and `.mk-assistant-host` (assistant-button.tsx:83).

| # | File:lines | Change | Variant A (everything) | Variant B (recommended) |
|---|---|---|---|---|
| 1 | apps/web/app/globals.css:1996-2002 | Universal reduce rule becomes `:not(.mk, .mk *, .mk-assistant-host, .mk-assistant-host *)`. Declarations unchanged. `html` is outside `.mk`, so it keeps `scroll-behavior:auto` | yes | yes |
| 2 | apps/web/app/motion.css:49-52 | `:root[data-reduce-motion="on"] :not(.mk, .mk *, .mk-assistant-host, .mk-assistant-host *)`, with the same `:not()` before `::before`, `::after` and `::backdrop`. Lines 57-68 (View Transitions) unchanged | yes | yes |
| 3a | apps/web/app/marketing.css:1529-1598 | Remove the `no-preference` wrapper around the relay keyframes and keep the contents | yes | yes |
| 3b | marketing.css:2297-2308 | Header shadow: remove the inner `no-preference` media and keep the `@supports` | yes | yes |
| 3c | marketing.css:2570-2639 | /demo pop and stamp, early-access rise, phone menu drop: remove the wrapper | yes | yes |
| 3d | marketing.css:2648-2673 | Narrow the reduce block to `:is(.mk-header, .mk-footer):not(.mk *)`, and delete the reveal-pending override (2659-2665) and the `.mk-walk-btn` entry. This keeps /login, /signup and /coaches (header outside `.mk`) exactly as they are today | yes | yes |
| 3e | marketing.css:2704-2708 | Delete the `.mk-assistant-fab` reduce rule | yes | yes |
| 4 | apps/web/app/marketing-assistant.css:28-32 | Delete the panel reduce rule | yes | yes |
| 5 | apps/web/app/marketing-journey.css:1559-1577 | Delete the reduce block and the `data-reduce-motion` segment rule | yes | yes |
| 6 | apps/web/components/marketing/motion.tsx | Delete `REDUCED`/`reduced()` (25-30). Line 72 becomes `if (!root \|\| typeof IntersectionObserver !== "function") return;`. Line 214 drops `!reduced() &&` | yes | yes |
| 7 | apps/web/components/marketing/journey-player.tsx | Delete `REDUCE`/`reducedNow` (59-66), the `reduced` state (177) and the listener effect (365-393). Line 230 becomes `setRun(true)`. Line 295 becomes `fill.animate(...)`. Remove `reduced` from deps at 312 and 317, `!reducedNow()` at about 428, and line 465 becomes `"smooth"` | yes | yes |
| 8 | apps/web/components/marketing/scenes-head.ts:11 | Drop the `data-reduce-motion` and matchMedia returns | yes | **no** |
| 9 | apps/web/components/marketing/scene-mount.tsx:14-33, 72-86 | Drop `reduced()` and the live listeners, keeping the cleanup | yes | **no** |

Steps 8 and 9 must ship together or not at all. If they disagree, the pin is added after first paint and the page shifts (CLS). An optional step 10, for OS reduce only, makes the reveal fade-only (`translate: none` on pending units); I'd leave it out unless the owner wants it.

### What stays protected

- These stay unchanged:
  - `components/motion.ts` (`prefersReducedMotion`);
  - the member rules in `motion.css`;
  - `layout.tsx:164/173`, `public-website.ts:98-104`, `color-scheme.ts:64-86` and `appearance.tsx:79`;
  - `workspace-system.css`, `onboarding-chat.css`, `setup-wizard.css` and `site-builder-*.css`.
- The member app, the trainer workspace and coach websites keep both reduce sources.
- Non-accessibility gates stay:
  - the IntersectionObserver feature checks;
  - "first screen, units taller than 1.5 viewports and the #target unit never wait";
  - the `.mk-motion` class gate and `beforeprint`;
  - the bot and webdriver gate for scenes, and `?scenes=on`;
  - the 699px-height and 620px-width pin rules;
  - the `(hover: hover)` and `@supports` media;
  - every journey hold: Pause, hover, focus, swipe, off-screen and hidden tab (WCAG 2.2.2).

### Tests and checks to update

- **tests/marketing-motion-sitewide.test.ts**
  - Rewrite 333-343 to assert that the globals.css reduce rule excludes `.mk` and `.mk-assistant-host`.
  - Replace 346-381 with the narrowed `.mk-header:not(.mk *)` form.
  - Change 383-390 to "no `prefers-reduced-motion` media in marketing.css except the narrowed header and footer block".
  - Drop 477-480 and 496-516.
  - Add an assertion that `scenes-head.ts` and `scene-mount.tsx` contain the same reduce tests (Variant B), so the two cannot drift apart.
- **tests/marketing-journey.test.ts:586**: invert it to "no reduce block".
- **tests/motion-css.test.ts:213-227**: switch to the `:not()` form and add a "marketing excluded" assertion.
- **Must pass unchanged:** `tests/member-motion.test.ts` and `tests/rtl-layout.test.ts:592-593`.
- **scripts/marketing-motion-sitewide-check.mjs**
  - At 361-457 and 555-568, under emulated reduce and in a second run with the `trainer_member_motion=reduce` cookie, expect the same as no-preference: `.mk-motion` present, reveals and settle run, the FAQ unfolds.
  - Variant B: on `/`, `html` has no `scenes-on` and the journey auto-plays.
- **scripts/marketing-motion-check.mjs**
  - Replace section 4 (1022 to about 1130) with "under reduce: auto-play at 50% visibility or more; Pause, hover, focus and hidden-tab holds work".
  - Section 6 RTL (1199-1240): press Pause before measuring.
- **scripts/brand-check.mjs**
  - Invert 557-572 to the same rules as "motion /" (574-626).
  - In 628-660 (rtl 1440), wait for the relay to come to rest (more than 5s) before measuring.
- **Re-run:** `npm run test:motion` (member app, still with OS reduce and with the cookie) and the external `verify_scenes.py` only if Variant A is chosen.

### Recommendation for OS reduce-motion users

The owner asked for always-on, and Variant B delivers that for everything short:
- presses, link bars and chevrons;
- the FAQ unfold and the header shadow;
- the 2.5s relay and the section reveal;
- the calculator settle and the /demo pop and stamp;
- the phone menu and the assistant panel;
- the journey's auto-play with its beats, which keeps its Pause.

Only the pinned, scroll-scrubbed scenes still respect OS reduce and the member's explicit in-app choice. Those are the 480/500svh journey pin and the #control scroll beats. Visitors who set reduce then get the auto-playing journey, now animated, and the one-shot #control choreography (about 1.1s).

The trade-off is that ignoring the setting misses WCAG 2.3.3 (AAA, not AA). It also contradicts our own rule in docs/features/marketing-motion.md:16-17, so the decision must be recorded as the owner's. Pinned scrubbing is the class of motion most likely to trigger vestibular symptoms, and on phones it also adds 5 viewports of scrolling before the bands. Variant A is technically ready if the owner prefers it (add steps 8 and 9).

## 3. Mapping: concept technique to our site

Only items we adopt, adapt or deliberately keep are listed. Rejected items are in section 6.

| Concept technique (D lines) | Our section / widget | What it looks like on our site | Mechanism | Effort | Onboarding impact |
|---|---|---|---|---|---|
| Fade-up reveal (D L72-73, L465-466) | All below-fold bands (motion.tsx MarketingMotion) | **Keep ours**: 12px rise and fade, 280ms. Now on for every visitor | IO one-shot, `--mk-dur-slow`, `--mk-ease-out` (marketing.css:2411-2436) | S (section 2 only) | Faster than the concept's 20px/.42s, so content reads sooner |
| Staggered cards, .08s (D L407) | SubscriberTiles, steps, checklist | **Keep ours**: 40ms steps, capped at 240ms | `--mk-stagger` (marketing.css:2377-2394) | none | Tiles land within about 520ms |
| Plates swing onto the bar (D L334-342, JS L524) | Economics band pills, "Free to start. Your price." (site.tsx:1422-1431) | **Adapt**: the four pills enter one after another from the inline start, 25% first and 10% last, so the falling rates read in order. Flat: 16px slide and fade, no 3D | CSS on the existing `data-mk-item` marks: pending `translate: calc(-1 * var(--mk-dist-load) * var(--inline-sign,1)) 0`, `--mk-dur-slow` + `--mk-ease-enter`, 80ms stagger (add `.mk-band-pills` to the overrides at 2395-2403). Entering from the inline start cannot create a horizontal scrollbar in LTR or RTL | S | Draws the eye to the free/price band. The claim box is not delayed |
| Per-row FAQ reveal (D L429) | Home "Questions trainers ask" and every page FAQ (site.tsx:209-216) | **Adapt**: the heading, then the six rows rise 8px, 40ms apart. "Does it cost anything to join?" lands in sequence | Add `.mk-faqs` to `GRIDS` (motion.tsx:54-55) and the stagger lists (marketing.css:2377-2394). h2 plus 6 details = 7 children, so the cap stays 240ms | S | Small, positive |
| FAQ plus→minus (D L190-193) | FAQ chevron | **Keep ours**: rotate 200ms plus a 280ms unfold (Chromium) | Existing | none | none |
| Button press translateY(1px) (D L32-37) | Every button | **Keep ours**: press to scale .97, 1px hover lift, 3px arrow nudge | marketing.css:2196-2236 | none | none |
| Final mark rises as the closing CTA arrives (D L349, JS L521-523) | Closing panel CTA (site.tsx:296) | **Adapt, no new mark**: when the panel's reveal lands, the CTA arrow nudges forward once | `@keyframes mk-nudge {50%{translate: calc(var(--mk-dist-nudge)*var(--inline-sign,1)) 0}}` on `.mk-motion .mk-closing[data-mk-reveal="in"] .mk-closing-cta > .lucide-arrow-right`, `--mk-dur-emphasis`, `--mk-ease-in-out`, 280ms delay, 1 iteration | S | Points at sign-up just as the closing line lands |
| CTAs stay present while the hero plays (D L380-385) | Hero `.mk-cta` (site.tsx:1462-1464) after the HeroFlow relay | **Adapt, owner gate (Q2)**: once the relay's last tick pops (~2.53s), the hero CTA arrow nudges once. The relay hands off to "Start coaching" | The same `mk-nudge` on `.mk .mk-hero .mk-cta > .lucide-arrow-right`, delay ~2.55s, ends ~2.97s (under the 4.5s brand-check limit). Nothing is hidden and the LCP is untouched | S | Points straight at the primary action |
| Pace span extends (D L271-272, L383, JS L493) | H1 `span.mk-mark` "trains" (marketing.css:880-886) | **Adapt, owner gate (Q2)**: one-shot at load, the Pace fill sweeps in behind "trains" from the inline start. The word is ink on white from first paint | Move the background onto a `::before`: `scale: 0 1` → `1 1`, `--mk-dur-emphasis` + `--mk-ease-enter`, ~120ms delay, origin `calc(50% - 50% * var(--inline-sign,1))` | M | Emphasises the product verb. LCP must be proved unchanged |
| Rep ring stepping (D L304-306, L398-399, JS L501) | /features "Back squat" screen ticks (`.mk-sets svg`, marketing.css:2438-2446; showcase.tsx:224) | **Adapt without numbers**: completed-set ticks pop one after another (+80ms each, starting at 520ms), like reps being logged. No count-up | `tr:nth-child(n) svg` transition delay. The spring is already allowed on `.mk-sets svg` | S | Low (inner page) |
| Rule-matched chip and confidence bar (D L299-302, JS L500) | ControlFlow (site.tsx:1351-1394) | **Keep ours**: meter 420ms at +320ms, "Applied automatically" spring pop at 640ms, safety stamp at 800ms. Now on for every visitor | marketing.css:2448-2499 | none | Trust |
| Hold, then slide (D L502-505) | JourneyBand pin (journey-scene.ts) | **Keep ours**: each chapter plays for 70% of its slice and holds for 30%, the same rhythm | Existing | none | none |
| One rAF scrub loop (D L525, L529; helpers L446-450) | Scroll-scenes engine (scroll-scenes.ts:170-192) | **Learn from its weakness**: ours already reads before writing (L180) and writes only on change (L187), but it requests a frame forever and `idle` (L186) re-runs mid-pin scenes every frame. Make it event-driven and stop when idle | rAF started on scroll, resize or pointer input and stopped after ~150ms idle. Limit `idle` to recipes that use `t`/`mx` (device only) | M | Less main-thread work on phones (benefits no-preference visitors and Variant A; it does not offset Variant B's cost) |
| Mobile menu slide (D L211-212) | Phone menu `<details>` (mk-drop 200ms, items 30ms apart) | **Keep ours**, now always on | marketing.css:2570-2639 | none | none |
| Nav shadow and blur (D L39-48) | Header shadow (marketing.css:2296-2309) | **Keep ours**: CSS scroll timeline, no backdrop blur | Existing | none | none |
| Typewriter (D L295-296, JS L499) | Journey typed words, 80ms apart | **Keep ours**: words are never removed from the DOM | Existing | none | none |
| Timeline brightening (D L321-322, JS L520) | Journey chapter segments | **Keep ours** | Existing | none | none |

## 4. Shared motion tokens

The tokens are defined once in marketing.css:27-35, with a JS copy at motion.tsx:16-23. They stay separate from the subscriber tokens in `motion.css` (24-40).

| Token | Value | Status | Concept source | Reconciliation |
|---|---|---|---|---|
| `--mk-dur-press` / `fast` / `base` / `slow` / `emphasis` | 80 / 140 / 200 / 280 / 420ms | keep, **no new durations** | .12s → fast, .18s/.2s → base, .24s/.3s → slow, .42s and .5s → emphasis (capped) | Shorter wins: arriving faster helps onboarding |
| `--mk-ease-out` / `in` / `in-out` | existing | keep | CSS `ease` and the JS ease-out-cubic (D L446-450) → out; ease-in-out-cubic → in-out | Scroll-driven animations stay linear (test rule) |
| `--mk-ease-spring` | existing | keep, success states only | the concept has no overshoot | Unchanged allow-list |
| `--mk-ease-enter` | `cubic-bezier(0.2, 0.8, 0.2, 1)` | **add** | plate easing (D L338) | Only for load-in entrances: band pills and the "trains" sweep. The static test gives it an allow-list like the spring's |
| `--mk-dist-nudge` | 3px | **add** (replaces the literal at 2234) | press 1px (D L34) not adopted | Hover nudge and the CTA hand-off share it |
| `--mk-dist-item` | 8px | **add** (literal at 2427, 2464) | match chip 8px (D L300) | Same value as `--motion-distance-sm` |
| `--mk-dist-rise` | 12px | **add** (literal at 2413, 2457) | reveal 20px (D L72), shortened | Marketing only |
| `--mk-dist-load` | 16px | **add** | plates translateX(160%) (D L338), reduced | Same value as `--motion-distance-md` |
| `--mk-stagger-step` | 40ms | **add** (literals at 2377-2394) | .08s (D L407) | Cap stays `MAX_STAGGER` 240 (motion.tsx:52) |
| `--mk-stagger-load` | 80ms | **add** (literal at 2395-2403) | plates .12s (D L342) | Used for `.mk-screens`, `.mk-band-pills` and the `.mk-sets` ticks |

The 20 Oct subscriber values (instant 120 … emphasis 240, stagger 12) are not imported. The values only line up by value at 8 and 16px. Fix the drift in docs/features/motion.md, which still says the marketing tokens equal the subscriber tokens. `MOTION` in motion.tsx gains an entry only if a Web Animations API caller needs one. The sitewide test's exact-values list grows by the new tokens, and the test continues to forbid `--mk-*` tokens in any other CSS file.

## 5. Delivery in phases

Every phase:
- Updates the "Work in progress" section of `CLAUDE_HANDOFF.md`, `docs/COMPLETION_STAGES.md` and `docs/PROJECT_MEMORY.md`, and never records an unrun check as passed.
- Uses local Chromium only (`/opt/pw-browsers/chromium`).
- Does not deploy.
- Builds the base at c856d9d for `MOTION_BASE_DIR`.

### Phase 1 (PR 1): motion always on, no new motion

- **Files:** steps 1-7 from section 2 (plus 8-9 only for Variant A).
- **Tests:** the updates listed in section 2.
- **Docs:**
  - marketing-motion.md:16-17, 73-76 and 164-165;
  - marketing-site.md, at the lines listed in the gate audit;
  - scroll-scenes.md:34-49, which should also drop the removed recipes depart, assemble, rise and reveal;
  - motion.md:259-261;
  - the header comments in motion.tsx, scene-mount.tsx, scenes-head.ts, journey*.tsx, hero-flow.tsx, marketing.css:2180-2190 and 2641-2647, and marketing-journey.css:1-8;
  - fix the stale "Teach your AI" CTA name in marketing-site.md (it is now "Start coaching").
- **Checks:**
  - the node suite;
  - `npm run test:marketing-motion` (journey and sitewide) and `npm run test:brand`;
  - `npm run test:rtl`, `npm run test:phone` and `npm run test:motion`.
- **Acceptance:**
  - Under emulated OS reduce, and separately with the member cookie, the pages behave the same as with no preference. Checked on `/`, `/how-it-works`, `/pricing`, `/features` and `/earnings-calculator` at 390x844 and 1366x900:
    - `.mk-motion` is present;
    - the relay animates and is at rest by 5s;
    - the journey auto-plays and every hold works;
    - the FAQ unfolds.
  - Variant B: `/` has no `scenes-on` under either reduce source.
  - The member app is still under both sources.
  - For the no-preference cohort, LCP, CLS (0), scroll long tasks and TBT are within budget against c856d9d.
  - The known journey-player overrun on `/` and `/how-it-works` stays recorded as awaiting the owner.

### Phase 2 (PR 2): micro-animations from the concept, CSS plus a one-line GRIDS change

- **Files:**
  - marketing.css: tokens at 27-35; stagger lists at 2377-2403; band-pill pending translate; the `mk-nudge` keyframe on the closing CTA and the hero CTA (hero only if Q2 is yes); `.mk-sets` tick delays; literals refactored to the distance tokens.
  - motion.tsx: `.mk-faqs` added to `GRIDS`.
  - tests/marketing-motion-sitewide.test.ts: new tokens and their exact values; an allow-list for `--mk-ease-enter`; motion distances inside the Motion block use tokens.
  - docs/features/marketing-motion.md.
- **Check additions:**
  - brand-check "motion /": the hero CTA arrow has `translate: none` by 5s, and every animation still ends by 4.5s.
  - sitewide check:
    - the band pills and the FAQ rows reveal in order, with the last item starting no later than 240ms;
    - CLS stays 0 while scrolling;
    - the LCP element and time are unchanged;
    - nothing on the first screen waits.
  - `test:rtl` at 390 with `?lang=ar`: no horizontal overflow, the pills enter from the right and the arrows nudge left.
  - `test:phone`.
- **Acceptance:**
  - At t=0, the first-screen elements are opacity 1 with no transform.
  - The pills land within about 520ms of the band reveal.
  - The closing CTA nudge ends within about 700ms of the reveal.
  - No `infinite`, and no new dependency (the dependency-lock test is green).

### Phase 3 (PR 3): engine efficiency, plus the hero highlight if the owner approves Q2

- **Files:**
  - scroll-scenes.ts:150-200: event-driven rAF with an idle stop, and `idle` limited to recipes that use `t`/`mx`.
  - The `.mk-mark` sweep at marketing.css:880-886 (Q2).
  - docs/features/scroll-scenes.md.
- **Checks:**
  - `verify_scenes.py` on `?scenes=on`: scrolling down and up match, the end state equals the static page, CLS under 0.1, no overflow.
  - An instrumented rAF count in the sitewide check: zero callbacks after 500ms with no input on `/` with scenes on.
  - Scroll long tasks no worse than base.
  - For the sweep:
    - LCP is the same element and within max(50ms, 5%);
    - brand-check AA contrast after the scroll-through;
    - the H1 tests (`span.mk-mark`, at most 8 words) are unchanged.
- **Acceptance:**
  - Scrubbing looks identical to before.
  - Idle main-thread work on `/` drops to zero.
  - The hero text is identical at first paint.

## 6. What not to copy, and why

- **The perpetual rAF loop with interleaved reads and writes** (D L525, L529, L446-450). It writes `textContent` and `--k` every frame and does 3 forced layouts per frame on phones. That is battery drain and dropped frames on mid-range Android.
- **Hiding the nav on scroll** (D L39-40, L462-463). Our sticky header carries "Start coaching", and hiding it makes the visitor slower to act. The concept's backdrop blur is also costly on Android.
- **The barbell scroll-progress indicator** (D L255-259, L377, L484-486). It is a new widget, makes layout writes every frame, and has a bug where only one side lights.
- **The kinetic hero letters, the line-2 drift and the 200vh hero pin** (D L260-273, L380-385, L488-493).
  - Our H1 is the LCP element, and per-letter spans break the registry H1 test.
  - Screen readers depend on an `aria-label`.
  - The end-state bug freezes "ur hours." mid-lift.
  - It adds 200vh of scrolling before the walkthrough.
- **The 420vh horizontal track and coverflow** (D L274-308, L496, L502-507). Our journey already does this job. The concept's version ends on an empty stage, its tab 03 jumps there, rotateY is used without perspective, and it adds 320vh of scrolling.
- **The scroll-scrubbed typewriter** (D L499). It empties the rule text on load (bad for accessibility and SEO) and causes layout shift.
- **The rep number count** (D L501). Our "no count-ups" rule forbids it; only the ticks are adapted.
- **The tickers** (D L244-249, L386, L430, L476-477). They are new sections, their cue copy is not in our registry, and they break in RTL.
- **The story clock and night mode** (D L309-326, L402-405, L509-520). It is a new section, conflicts with "always light", and its timeline rows at .28 opacity fail contrast.
- **The console 3D tilt and the 70° plate swing** (D L149-150, L338, L474-475). 3D is the riskiest kind of motion for vestibular symptoms, which matters more once motion ignores reduce. The working switch and take-over buttons (D L153-171, L467-473) would turn our `role=img` illustration into a new interactive widget.
- **The final brand-mark rise** (D L349). It needs a new element; the CTA arrow nudge replaces it.
- **Colour, background and theme transitions** (D L20, L44, L46, L170, L313, L329-330). Our rule keeps colour changes instant, and the tests allow only compositor properties to move.
- **Language re-split and theme crossfade** (D L453-459, L479-482). Our marketing copy is English only and the site is always light.
- **The concept's reduce rules and fallbacks** (D L236, L367, L447, L529). They would bring back the gates the owner asked to remove, and their fallback leaves the lime span as a stub and the clock frozen at 06:00.
- **The dead CSS** (D L49-71, L79-146, L183-185, L195-200). Its `.in` load-in would hide our LCP.
- **The concept's copy:**
  - the CTA "Teach your AI" (ours is "Start coaching");
  - "MAYA" (a fictional trainer);
  - "Your coaching. Beyond your hours." as the H1 (it is our closing H2);
  - the exercise cue strings.

## 7. Risks and open questions for the owner

1. **How far always-on goes.** Do you approve Variant B (all short motion for everyone; pinned scroll scenes still respect OS reduce and the member's explicit Reduce motion choice), or Variant A (everything, including the 480-500svh pin)? Either way it misses WCAG 2.3.3 (AAA, not AA) and reverses our documented rule, so it is recorded as your decision.
2. **Hero motion.** Apart from the relay, the hero has deliberately had no motion. Do you approve the two hero additions: the CTA arrow hand-off at about 2.5s, and the Pace sweep behind "trains" (Phase 3, only with LCP proof)? Every word stays visible from first paint.
3. **Performance budget.** `/` and `/how-it-works` already exceed the blocking-time and LCP budget because of the journey player, and that is waiting for your acceptance. Always-on extends the same cost to visitors who had reduce set. Do you accept that, or should the Phase 3 engine idle-stop (or a lighter stage) land before Phase 1 merges?

---

## Review corrections (apply before implementing)

An independent read-only review checked this plan against the code at 594810c and the concept file. Its corrections are binding on implementation. They also change how three of the owner's open questions should be read:
- Q1: item 4, and the phone un-pin option under "Missed design techniques".
- Q2: item 11.
- Q3: item 5.

**Verdict:** the plan is mostly sound. It needs the corrections below before anyone edits code.

These parts check out:
- Its scope is right. The `mk` class sits only on `apps/web/components/marketing/site.tsx:1550`, the assistant host is outside it, and the headers on /login, /signup and /coaches keep reducing motion.
- Every line it cites at HEAD 594810c (origin/main) is correct.
- Most of its design-file citations are accurate. The concept has no `@keyframes` and no timers, and nothing in it runs longer than .5s.
- Nothing delays the sign-up CTA, the hero copy or the LCP. The hero nudge ends at about 2.97s and the first screen never waits.

All repo paths below are under `/home/user/trainer_what/`.

**Corrections (what is wrong -> fix)**

1. **Wrong branch.** `work/completion-2026-09-26` (82d4f33, 26 Sep) is 536 commits behind HEAD and does not contain `motion.tsx` or `journey-player.tsx`. -> Use origin/main 594810c, where every cited line matches, and cut a new dated branch from main.

2. **A missing guard at `journey-player.tsx:295`.** The line is `reduced || !fill ? new Animation(...) : fill.animate(...)`. Replacing it with plain `fill.animate(...)` drops the `!fill` fallback, so the code crashes and the chapter clock never advances when the segment `<i>` is missing. -> Keep the fallback: `!fill ? new Animation(new KeyframeEffect(null, null, { duration }), document.timeline) : fill.animate(...)`.

3. **The Phase 1 performance acceptance measures the wrong visitors.** Phase 1 changes nothing for no-preference visitors. The sitewide check only times page loads under no-preference, and its reduced pass checks state, not speed. -> Add a timed run under emulated reduce and another with the cookie, on all five pages. Measure:
   - CLS 0 while scrolling, now that reveals run;
   - scroll long tasks;
   - TBT on / and /how-it-works, now that the journey auto-plays.

   Compare against main 594810c under reduce as well as against the c856d9d budget.

4. **The Variant B check "/ has no scenes-on" proves nothing as written.** Playwright sets `navigator.webdriver`, so the head script turns scenes off before it ever tests for reduce. -> Load `/?scenes=on` under reduce and with the cookie, and add a no-preference `/?scenes=on` control. Variant B should show no scenes and an auto-playing journey. Variant A should show scenes on before first paint with CLS 0.

5. **The Phase 3 idle-stop does not offset the always-on cost.** The scenes engine only runs for no-preference visitors on /. Under Variant B, reduce visitors never run it; their added cost comes from the journey player's auto-play and the reveals. -> Delete "which offsets the always-on cost" from the mapping table. Reword Q3: only a lighter journey player or stage helps that group, and the idle-stop matters only for Variant A.

6. **The Phase 3 event-driven loop loses wake-ups the engine relies on.** Today `frame()` notices when `scenes-on` is removed and calls `restAll()`, and `measure()` sets `s.p=-1` to force a redraw.
   - With scroll-only wake-ups, Variant B's runtime reduce switch (`off()` in `scene-mount.tsx`) would leave inline transforms on the page until the next scroll.
   - Resize and `fonts.ready` would no longer redraw.
   - Tests that toggle `data-scenes-still` would stop working.

   -> Also wake the loop on resize, `fonts.ready`, removal of the `scenes-on` class and `mk-scene:seek`. Use passive listeners (the concept does this at D L463).

7. **Two of the new effects play off-screen.** A unit reveals when its top crosses 90% of the viewport (rootMargin -10%).
   - At 390x844 the economics band is one column below 1024px (`marketing.css:1600`), so the pills sit about 400px below that line.
   - The closing CTA sits about 200px below the panel top (64px padding, the h2, the p). It is below the fold at the trigger, at both 390x844 and 1366x900.
   - The pill stagger and the CTA nudge (280ms delay, done by about 700ms) therefore usually finish before they can be seen.

   -> Trigger them from their own visibility, as the concept does with its separate barbell observer (D L524, threshold .4). For example, make `.mk-bands-box` and `.mk-closing .button-row` their own reveal units, or start the nudge when the CTA itself intersects. Home FAQ rows 4 to 6 have the same problem to a smaller degree.

8. **Test edits Phase 2 needs but does not list** (all in `tests/marketing-motion-sitewide.test.ts`):
   - **EASING regex (line 127)** only allows out, in, in-out and spring. Every rule using `var(--mk-ease-enter)` fails, so the regex must change as well as the allow-list.
   - **TOKENS (lines 112-122) and the token count (lines 488-493).** `--mk-ease-enter` must be added to TOKENS. The count regex `--mk-(?:dur|ease)-` does not cover `--mk-dist-*` or `--mk-stagger-*`. So the plan's statement that the test "continues to forbid `--mk-*` tokens in other files" is false for those new tokens. Extend the regex. New tokens must be defined on `.mk, .mk-header, .mk-footer, .mk-assistant-host` (line ~270).
   - **Lines 458-459** read MAX_STAGGER from literal `--mk-stagger: Nms` values. If those literals become `var()` or `calc()` of `--mk-stagger-step`, `Math.max()` returns -Infinity and the test fails. Keep the literal per-item values, or make the test resolve the tokens.
   - **TIME regex (line 128)** only accepts literal delays or `var(--mk-stagger…)`. Delays written as `var(--mk-stagger-load)` or `calc()` fail.
   - **Header comment, lines 13-14,** describes the old reduce contract and needs updating.

9. **Docs.**
   - In `scroll-scenes.md`, depart, assemble, rise and reveal are not removed; they are still registered in `scenes.ts`. Only the table rows for the hero, #subscribers, #economics and the closing panel are stale: `site.tsx` wires only the journey and #control beats, and `Closing` is called without `scene`. -> Delete those rows and keep the recipe list.
   - Token drift is in two places:
     - `marketing.css:20-21` says the marketing tokens have "the same values as the subscriber app's motion pass".
     - `motion.md`'s token table still lists 80/140/200 while `motion.css` now has 120/180/200/220/240.

     The plan's "values only line up at 8 and 16px" is also wrong: `--motion-base` equals `--mk-dur-base` (200ms), and `--ease-out`, `--ease-in` and `--ease-in-out` equal their `--mk-` counterparts.
   - Comments to add to the list:
     - `marketing.css:844-847`, `:1523-1528` and `:20-26`;
     - `journey-player.tsx:15` and `:169`;
     - `scroll-scenes.css:1-2` (Variant A only).
   - The "gate audit" the plan refers to is not in the plan. The `marketing-site.md` lines are 572, 698, 762, 805, 811, 861-862, 882, 914, 953, 1070, 1109, 1123, 1159 and 1191.

10. **Two missed gates.** These animations exist only inside `motion.css`'s no-preference blocks but still reach marketing pages.
    - **The Kamran panel's Talk button** (`.button.mk-assistant-talk`). The host has class `public`, so the subscriber press rule (`.public:not(.mk) .button`, `motion.css:114+`) applies. The button stays still under OS reduce even after the plan. -> Add `.mk-assistant-host` to the marketing press selector and exclude it in `motion.css` (`.public:not(.mk, .mk-assistant-host)`), or record it as intentionally still.
    - **The footer "Privacy preferences" sheet.** The button (`frame.tsx:183`, `data-analytics-preferences`) opens `ConsentSheet`, which renders outside `.mk`. Its rise (`motion.css` ~405) stays still under OS reduce and the cookie. -> Record it as an intentionally unchanged shared subscriber component.

    No other reduce gate exists on `.mk` surfaces: hero-flow, islands, showcase, journey.tsx, journey-scene, scroll-scenes.css and the calculators are all ungated.

11. **The "trains" sweep (Phase 3).**
    - A `::before` behind inline text needs `.mk-mark{position:relative; isolation:isolate}`. With `z-index:-1` alone it paints under the hero background and vanishes. It also loses `box-decoration-break: clone`.
    - The H1 stays English under `?lang=ar`, so `--inline-sign` would sweep right-to-left across a Latin word. -> Fix the origin to the left, or set `dir` on the span.

12. **Design-file citation errors.**
    - **Barbell progress, "only one side lights":** false. `barFx` (L485-486) lights the left plates on even steps and the right plates on odd steps, so both sides fill. Its real faults: it rewrites left/right and the class on every frame, reads `scrollHeight` every frame, and shows nothing under reduce.
    - **Kinetic hero end state:** it is "r hours." that stays lifted (visibly "hours.", up to about 0.2em), not "ur hours.".
    - **"Writes `--k` every frame, 3 forced layouts on phones":** on screens up to 1060px, `howFx` takes the `vis()` branch (L502). It writes `textContent` but not `--k`, which is desktop-only. The interleaved `getBoundingClientRect` calls across the loop's functions cause far more than 3 forced layouts.
    - **"Dead CSS L79-146":** `.tags` (L103) and `.feed` (L106-108, L111) are used, at L390 and L400.
    - **"Nav shadow and blur" (L39-48):** the concept has no shadow. It has a 92% background, a blur, a bottom border and hide-on-scroll.
    - **"Three kinds of motion":** there is a fourth: class toggles at scroll thresholds that fire CSS transitions (L462-463, L500, L507, L520). It also uses several easing curves, not "one easing family" (CSS `ease`, the plate cubic-bezier, `ez` and `eio`).
    - **"200vh hero adds 200vh of scrolling":** it adds about 100vh, or 70vh at 1060px and below (L351).
    - **Plate direction:** the concept loads plates from the inline end (L338-339). Entering from the inline start is a reversal; label it as deliberate.

13. **Minor.**
    - The pills already stagger today: they are in GRIDS (`motion.tsx:55`) and in `marketing.css:2377-2394`, at 40ms with an 8px rise. Phase 2 is an override of direction, step and easing, not a new hook.
    - When registration is closed the hero CTA reads "Join early access", so the nudge should key on `.mk-cta`, not the label.
    - Typo in Phase 1 acceptance: "still still".

**Missed design techniques**
- **Triggers per widget (D L524).** The concept gives the barbell its own observer instead of relying on the section reveal; see item 7.
- **No pinning on phones.** The concept un-pins every scroll-scrubbed section at 1060px and below (L219, L351-353) and drives its demos by in-place visibility (`vis()`, L449, L502). Our journey pins at 500svh on phones. `data-pin="wide"` (`scroll-scenes.css:16-27`, `scroll-scenes.ts:135`) already turns a pin off at 620px and below with no CLS. Offer this to the owner as an option under Q1/Q3: fewer screens of scrolling before the sign-up CTA on phones. It changes current phone behaviour, so it is the owner's call.
- **Passive scroll listeners (L463)** for the Phase 3 engine; see item 6.
