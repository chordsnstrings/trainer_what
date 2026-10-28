# Scroll scenes (parked since 28 October 2026)

Until 28 October 2026, scrolling the home page (`/`) played some sections. Each frame depends only on the scroll position, so a scene plays the same forwards and backwards. When a scene reaches its end, the section looks exactly as it did before scenes existed. The design (colours, fonts, spacing, copy and layout) is unchanged. Scenes use native scrolling and CSS transforms only; there is no animation library.

## Status: parked

Phase 1 of the marketing revamp (PR #105) rebuilt `/`. The home no longer has the journey band or `#control`, so no page mounts the engine. It is parked, not deleted. Phase 2 decides whether to delete it or reuse it.

**What remains:**
- The engine and its recipes: `scroll-scenes.ts`, `scenes.ts` and `journey-scene.ts`.
- `scene-mount.tsx`. Its `ScrollScenes` is no longer rendered anywhere.
- `app/scroll-scenes.css`, still imported in `app/layout.tsx`, so every route still loads it.
- The journey player's scrub mode.
- `tests/scroll-scenes-engine.test.ts`, which still runs in `npm test`.
- The head script. `SCENES_HEAD_SCRIPT` still adds `scenes-on` to `<html>` on `/` before the first paint. Nothing consumes it now: the rules in `scroll-scenes.css` and `motion.tsx` match only `[data-scene]` and `.mk-walk-band`, and both left `/`. It is harmless, and phase 2 removes it with the engine or uses it again.

**The anatomy's pin is separate.**
- The anatomy on `/trainer-brain` ([brain-showcase.md](brain-showcase.md)) pins with its own CSS sticky frame, not with this engine.
- Its head script (`brain/head.ts`) gates the pin the same way `scenes-head.ts` gates scenes. It adds `sc-pin` only without reduced motion (the device's setting or the member's own), for visitors who are not robots, and when IntersectionObserver and sticky positioning exist. The pin also needs a viewport at least 700 px tall, like this engine's short-viewport gate.
- Its `--sc-top` copies `--scene-top`'s header heights: 74 px, 69 px at 1150 px wide or less, and 65 px at 760 px or less. `tests/marketing-showcase.test.ts` keeps the two equal while `scroll-scenes.css` exists.

**Browser checks.** The sitewide motion check's `/?scenes=on` pass reports "no scene on /" and skips the frame-loop rules. `verify_scenes.py` has nothing to run against.

The rest of this page describes the engine as it ran on the home page until 28 October 2026.

## What was on the home page (until 28 October 2026)

| Section | Scene | What moves |
|---|---|---|
| Journey band (`JourneyBand`, `journey.tsx`) | `journey`, pinned (`--len: 480`, `--len-phone: 500`) | Nothing gets new styles. Scroll replaces the player's clock: chapter = floor(q × 8). The first 70% of a chapter's slice plays its beats, and the rest holds the complete picture. |
| `#control` (`ControlFlow`) | `beats`, in 4 beats | The message, then the AI card, then the meter fill, then the lanes. The `data-from` poses are the old reveal's "before" poses. |

Only these two were wired in `site.tsx` (the journey band and `scene="beats"` on `#control`). The hero, `#subscribers`, `#economics` and the closing panel had no scene: `Closing` was rendered without `scene`, so they kept the section reveal. The `depart`, `assemble`, `rise` and `reveal` recipes are still registered in `scenes.ts` and can be wired again (see "Add a scene to a section"). Nothing else gets a scene: the followers calculator, FAQs, Kamran button, header and footer. No other page has scenes.

## Files

- `apps/web/components/marketing/scroll-scenes.ts`: the engine, from the scroll-scenes library. Since 22 October 2026 its frame loop is event-driven and stops when idle (see "The frame loop"); what it draws is unchanged.
- `apps/web/components/marketing/scenes.ts`: the scene recipes, from the library. The only change is that `device` is registered as ambient (see "The frame loop").
- `apps/web/app/scroll-scenes.css`: the library stylesheet (unchanged), then the trainsyou wiring:
  - `--scene-top`: the header height (74 / 69 / 65px);
  - the short-viewport gate;
  - instant chapter swaps while scrubbing.
- `apps/web/components/marketing/journey-scene.ts`: the custom `journey` scene. It sends `mk-scene {active, q}` to `.mk-walk` and handles `mk-scene:seek`.
- `apps/web/components/marketing/journey-player.tsx`: scrub mode (`data-scrub`). While it is on:
  - there is no autoplay and the clock never advances;
  - Play jumps to the next chapter boundary, and Replay jumps to the scene start;
  - the segments, arrow keys and swipe go to a chapter by scrolling.
- `apps/web/components/marketing/scene-mount.tsx`: `ScrollScenes`, rendered at the end of `Home` in `site.tsx` until 28 October 2026 (no page renders it now). It does three things:
  - it mounts the engine;
  - it makes every in-place scene finish: one already on screen at load stays complete, and one near the footer finishes by the end of the page;
  - it turns scenes off if reduced motion is switched on while the page is open (the same test as the head script; a static test keeps the two equal).
- `apps/web/components/marketing/scenes-head.ts`: the head script (inline in `app/layout.tsx`). It adds `<html class="scenes-on">` before the first paint.

## Who gets today's page

Since 28 October 2026 the head script below still runs on `/`, but no scene is there to switch on (see "Status: parked").

Scenes are on only when the head script adds `scenes-on`. It is not added in these cases:

- the path is not `/`;
- reduced motion is on (`prefers-reduced-motion` or the member's own `html[data-reduce-motion="on"]`);
- the visitor has no JavaScript;
- the visitor is a crawler or an automated browser (`navigator.webdriver`, or a bot user agent);
- the browser has no IntersectionObserver or sticky positioning.

Browser checks add `?scenes=on` to switch scenes on despite webdriver. Reduced motion still wins over `?scenes=on`.

**The marketing motion switch does not reach the scenes.** Since 22 October 2026 every short marketing motion plays for every visitor (`MARKETING_MOTION = "always"` in `components/marketing/motion-mode.ts`, the owner's Variant B; `docs/features/marketing-motion.md`, "Motion for every visitor"). The pinned, scroll-scrubbed scenes are the exception: both reduced-motion settings still keep them off, in either mode, and neither `scenes-head.ts` nor `scene-mount.tsx` reads the switch. A visitor with reduced motion gets the page without scenes, where the walkthrough auto-plays (with its Pause and holds) and `#control` plays its one-off choreography (about 1.1 s) through the section reveal. With the switch at `"device"` they get the still page, as before. The journey is not un-pinned on phones.

Viewports under 700px tall get no pin. CSS decides this before the first paint, and the walkthrough auto-plays as before. The section reveal (`motion.tsx`) does not run on scene sections while scenes are on. The player and the reveal respect `data-reduce-motion="on"` only while the marketing switch is `"device"`.

## The frame loop

The engine used to request an animation frame forever, and to redraw every scene part-way through its progress on every frame. Since 22 October 2026 (Phase 3 of `docs/MARKETING_MOTION_PLAN_2026-10-22.md`) the loop runs only while something can change. Each of these wakes it:

- a scroll of the page;
- a resize, which also measures the scenes again;
- the web fonts becoming ready (`document.fonts.ready`), which also measures again;
- `<html>` gaining or losing `scenes-on`. When the class is removed at runtime (reduced motion switched on while the page is open, `scene-mount.tsx`), the next frame removes every inline style and finishes the scrubbed animations at once, without waiting for a scroll. The loop then sleeps until the class comes back, and then measures again;
- `data-scenes-still` being toggled. Every scene is redrawn at the new setting;
- `mk-scene:seek` on a scene (the walkthrough's own controls);
- a scene entering or leaving the area the engine watches (its IntersectionObserver);
- the page or a scene changing size (a ResizeObserver on `<body>` and on each scene). Content above a scene can move it without a scroll, and the old loop caught that by reading the rects on every frame;
- pointer movement, but only while a recipe that reads the pointer is mounted (an ambient recipe; none is on the home page).

Frames continue for `IDLE_MS` (150 ms) after the last wake-up and then stop. A recipe registered with `{ ambient: true }` reads `c.t` or the pointer (`c.mx`, `c.my`). Only `device` is registered that way. While an ambient scene is part-way through (0 < p < 1, not still), the loop keeps running and redraws it on every frame, as before. Every other recipe is a pure function of progress, so it is drawn only when its progress changes. Every listener is passive, and the cleanup removes all of them and disconnects the observers.

What a frame draws is unchanged. Progress comes from the same rects, read before anything is written, and a scene is drawn whenever its progress changes. The only frames dropped are redraws of a non-ambient scene at a progress it had already drawn, and those wrote the same values again.

## Add a scene to a section

1. Pick a scene from the table in the scroll-scenes library: `beats`, `assemble`, `rise`, `flip`, `reveal`, `depart` or `device`. Use each type at most once per page.
2. Put `data-scene="<type>"` on the full-width section element. Only `reveal` may go on an inner element. (The old home's `HomeSection` took a `scene` prop; it was deleted on 28 October 2026.)
3. Mark the parts that move with `data-beat`. Parts with the same number move together.
4. Never mark inputs, forms, accordions or tabs, and never mark an element whose `transform` or `opacity` React sets.
5. Copy each "before" pose from the site's CSS into `data-from`. For example, `opacity: 0; translate: 0 12px` becomes `data-from="y:12 o:0"`.
6. Switch the old clock off for anything the scene now drives. While `html.scenes-on` is present, `motion.tsx` already skips every unit inside `[data-scene]`.
7. For a pinned scene, add `data-pin`, a `<div data-stage>` around the section's container, and `style={{ "--len": 300 } as CSSProperties}`. The stage must fit in one viewport below the header.

## Tune it

- `--len`: the pin length in svh on desktop. `--len-phone` is the length at 620px wide and below. Use about 60–90svh per beat and 200–500svh per pin.
- `data-from`: the starting pose. The keys are `x y z` (px), `rx ry rz` (deg), `s sx sy` (scale), `o` (opacity), and `wipe` / `wipey` (0–1). Keep the amplitudes modest.
- `data-span`: how much of the viewport an in-place scene takes to finish. The default is `.7`.
- The walkthrough's split between beats and hold is `SCRUB_BEATS` in `journey-player.tsx`.

## Switch scenes off

- **One section:** remove its `data-scene` attribute. The old reveal comes back for it automatically.
- **The whole page:** remove the `SCENES_HEAD_SCRIPT` script tag in `app/layout.tsx`, or make the script return early. Without `scenes-on`, nothing pins or moves and the page is today's page.

## Checks

Run `verify_scenes.py` from the scroll-scenes library against `http://127.0.0.1:<port>/?scenes=on` on the production build, with local Chromium only. Its checks are:

- screenshots scrolling down and up match;
- the end state equals the reduced-motion page;
- CLS is below 0.1;
- there is no horizontal overflow.

The walkthrough is expected to end on chapter 8 rather than chapter 1, because the progress UI rests on its last step.

`tests/scroll-scenes-engine.test.ts` drives the real engine in a small fake page: a frame clock, the window's listeners and the observers. It covers:

- the idle stop;
- drawing only on a change of progress;
- an ambient scene drawn on every frame only while it is part-way through;
- the pointer waking the loop only with an ambient recipe;
- each wake-up listed above;
- `scenes-on` removed, which clears the inline styles without a scroll;
- `data-scenes-still`, which redraws at the still pose;
- passive listeners, and a cleanup that leaves nothing behind;
- the shipped recipes themselves (a static read of each `registerScene(...)` call in `scenes.ts` and `journey-scene.ts`, comments removed): a recipe whose frame callback reads `c.t`, `c.mx` or `c.my` must pass `{ ambient: true }`, and a recipe that passes it must read one of them (today only `device`), so a recipe added later that floats or tilts without the flag fails the test instead of freezing between scrolls.

`npm run test:marketing-motion` runs in an automated browser, so scenes are off there and it checks today's behaviour. Its sitewide half also loads `/?scenes=on` as controls: without reduced motion `<html class="scenes-on">` must be there before the body is parsed (before the first paint) with no layout shift; under emulated reduced motion, and separately with the member's `trainer_member_motion=reduce` cookie, there must be no scenes, and the walkthrough auto-plays (switch `"always"`) or waits (switch `"device"`).

The sitewide half also counts every animation-frame callback on `/?scenes=on` (no preference, both widths). Its rules are:

- frames run while the page scrolls through the journey's pin;
- in the second that starts 500 ms after the last input there is no frame at all;
- toggling `data-scenes-still` wakes the loop;
- removing `scenes-on` without a scroll wakes it and leaves no inline style under a scene.

### Results, frame loop (22 October 2026, this machine)

Run on this tree after `npm run build`, against a local production server (`next start` with a platform stub), local Chromium only. No timed comparison was run.

- **Unit tests.** `node --import tsx --test tests/scroll-scenes-engine.test.ts`: 8 passed. With the other motion, RTL, site and brand test files the total was 121 passed, 0 failed.
- **Scrubbing identical to before.** The same scroll positions were sampled on a build of the old engine (`HEAD` versions of `scroll-scenes.ts` and `scenes.ts`) and on the new one, at 390x844 and 1366x900. The positions ran down and then back up through the journey's pin and `#control`, about 0.23 of a viewport apart. At each position the sample recorded the walkthrough's `q`, every `#control` beat's inline style and `data-on`, and every `aria-current` under a scene. All 126 samples matched (66 at 390, 60 at 1366).
- **Targeted Playwright verification.** 58 passed, 0 failed. It covered 390x844, 1366x900 and `?lang=ar` at 390 on `/?scenes=on`, and emulated reduced motion at both widths with the switch at `"always"`.
  - With scenes on:
    - no frame in a one-second window starting 2 s after load, nor in the second that starts 500 ms after each input;
    - 35 frames while scrolling through the pin, with the walkthrough following;
    - `mk-scene:seek` with q .5 woke the loop and reached q 0.4999 to 0.5001;
    - `data-scenes-still` (10 to 11 frames) and a resize (9 to 11 frames) each woke it, and then it stopped;
    - mouse movement at 1366 did not wake it;
    - removing `scenes-on` with `#control` part-way through cleared all 6 moved beats in 2 to 3 frames without a scroll, and then the loop slept;
    - CLS 0 on load, no sideways overflow, no page errors.
  - Under reduced motion: no scenes, the journey auto-played, no inline scene styles, CLS 0.
- **The sitewide check's `scenes()`.** Run alone with the check's own page setup (CPU 4x) and its `/?scenes=on` rules: 0 failures. At 390 it counted 19 scroll frames, 0 idle frames, 11 still frames, 2 frames after `scenes-on` was removed and 0 styled elements left; at 1366, 18, 0, 11, 3 and 0. Under reduced motion and the cookie: no scenes, and the journey played.
- **Not run** (left for the single full run): `npm run test:marketing-motion`, `test:brand`, `test:rtl`, `test:phone` and `test:motion`, and `verify_scenes.py`.
