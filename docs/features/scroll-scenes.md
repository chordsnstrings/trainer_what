# Scroll scenes (home page)

On the home page (`/`), scrolling plays some sections. Each frame depends only on the scroll position, so a scene plays the same forwards and backwards. When a scene reaches its end, the section looks exactly as it did before scenes existed. The design (colours, fonts, spacing, copy and layout) is unchanged. Scenes use native scrolling and CSS transforms only; there is no animation library.

## What is on the home page

| Section | Scene | What moves |
|---|---|---|
| Journey band (`JourneyBand`, `journey.tsx`) | `journey`, pinned (`--len: 480`, `--len-phone: 500`) | Nothing gets new styles. Scroll replaces the player's clock: chapter = floor(q × 8). The first 70% of a chapter's slice plays its beats, and the rest holds the complete picture. |
| `#control` (`ControlFlow`) | `beats`, in 4 beats | The message, then the AI card, then the meter fill, then the lanes. The `data-from` poses are the old reveal's "before" poses. |

Only these two are wired in `site.tsx` (the journey band and `scene="beats"` on `#control`). The hero, `#subscribers`, `#economics` and the closing panel have no scene: `Closing` is rendered without `scene`, so they keep the section reveal. The `depart`, `assemble`, `rise` and `reveal` recipes are still registered in `scenes.ts` and can be wired again (see "Add a scene to a section"). Nothing else gets a scene: the followers calculator, FAQs, Kamran button, header and footer. No other page has scenes.

## Files

- `apps/web/components/marketing/scroll-scenes.ts`: the engine (the scroll-scenes library, unchanged).
- `apps/web/components/marketing/scenes.ts`: the scene recipes (library, unchanged).
- `apps/web/app/scroll-scenes.css`: the library stylesheet (unchanged), then the trainsyou wiring:
  - `--scene-top`: the header height (74 / 69 / 65px);
  - the short-viewport gate;
  - instant chapter swaps while scrubbing.
- `apps/web/components/marketing/journey-scene.ts`: the custom `journey` scene. It sends `mk-scene {active, q}` to `.mk-walk` and handles `mk-scene:seek`.
- `apps/web/components/marketing/journey-player.tsx`: scrub mode (`data-scrub`). While it is on:
  - there is no autoplay and the clock never advances;
  - Play jumps to the next chapter boundary, and Replay jumps to the scene start;
  - the segments, arrow keys and swipe go to a chapter by scrolling.
- `apps/web/components/marketing/scene-mount.tsx`: `ScrollScenes`, rendered at the end of `Home` in `site.tsx`. It does three things:
  - it mounts the engine;
  - it makes every in-place scene finish: one already on screen at load stays complete, and one near the footer finishes by the end of the page;
  - it turns scenes off if reduced motion is switched on while the page is open (the same test as the head script; a static test keeps the two equal).
- `apps/web/components/marketing/scenes-head.ts`: the head script (inline in `app/layout.tsx`). It adds `<html class="scenes-on">` before the first paint.

## Who gets today's page

Scenes are on only when the head script adds `scenes-on`. It is not added in these cases:

- the path is not `/`;
- reduced motion is on (`prefers-reduced-motion` or the member's own `html[data-reduce-motion="on"]`);
- the visitor has no JavaScript;
- the visitor is a crawler or an automated browser (`navigator.webdriver`, or a bot user agent);
- the browser has no IntersectionObserver or sticky positioning.

Browser checks add `?scenes=on` to switch scenes on despite webdriver. Reduced motion still wins over `?scenes=on`.

**The marketing motion switch does not reach the scenes.** Since 22 October 2026 every short marketing motion plays for every visitor (`MARKETING_MOTION = "always"` in `components/marketing/motion-mode.ts`, the owner's Variant B; `docs/features/marketing-motion.md`, "Motion for every visitor"). The pinned, scroll-scrubbed scenes are the exception: both reduced-motion settings still keep them off, in either mode, and neither `scenes-head.ts` nor `scene-mount.tsx` reads the switch. A visitor with reduced motion gets the page without scenes, where the walkthrough auto-plays (with its Pause and holds) and `#control` plays its one-off choreography (about 1.1 s) through the section reveal. With the switch at `"device"` they get the still page, as before. The journey is not un-pinned on phones.

Viewports under 700px tall get no pin. CSS decides this before the first paint, and the walkthrough auto-plays as before. The section reveal (`motion.tsx`) does not run on scene sections while scenes are on. The player and the reveal respect `data-reduce-motion="on"` only while the marketing switch is `"device"`.

## Add a scene to a section

1. Pick a scene from the table in the scroll-scenes library: `beats`, `assemble`, `rise`, `flip`, `reveal`, `depart` or `device`. Use each type at most once per page.
2. Put `data-scene="<type>"` on the full-width section element. Only `reveal` may go on an inner element. For a `HomeSection`, pass `scene="…"`.
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

`npm run test:marketing-motion` runs in an automated browser, so scenes are off there and it checks today's behaviour. Its sitewide half also loads `/?scenes=on` as controls: without reduced motion `<html class="scenes-on">` must be there before the body is parsed (before the first paint) with no layout shift; under emulated reduced motion, and separately with the member's `trainer_member_motion=reduce` cookie, there must be no scenes, and the walkthrough auto-plays (switch `"always"`) or waits (switch `"device"`).
