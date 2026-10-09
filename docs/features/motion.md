# Motion (microanimations) for subscriber surfaces

Owner direction (29 September 2026): "we need to polish and incorporate
microanimations that allows user to feel interactive. plan and execute
aesthetically pleasing microanimations, not too heavy - simple
microanimations that actually makes it feel more interactive."

This page is the plan and the contract. It covers the member app, the coach
website, joining and sign-in pages (the phone-first surfaces in
`docs/features/phone-first.md`). The marketing site keeps its own motion and
text (`docs/features/marketing-site.md`); the trainer workspace is unchanged
except where it shares a primitive (a bottom sheet, a stepper).

The shared onboarding/My Brain conversation has a separate, explicit owner-requested motion contract (9 October 2026; `features/onboarding-chat.md`). Its clearer message pops may start below this document's 0.97 scale floor and settle within 420 ms. It follows reduced-motion preferences by default. **Conversation options → Message animations → On** is a deliberate local opt-in that animates only that conversation even when the device or global app preference reduces motion; Off always keeps it still. It neither changes those underlying preferences nor enables motion on other screens.

## Principles

1. **Feedback within 100 ms of every tap.** A press answers in
   `--motion-instant` (80 ms) before any network work starts.
2. **Motion explains change.** Something that arrives shows where it came
   from; something that leaves shows where it went; a value that changes
   shows which way it moved. Nothing moves only to decorate.
3. **Subtle and consistent.** Five durations, four curves and three
   distances for everything (tokens below). Movement is 4, 8 or 16 px, never
   across the screen; scale stays between 0.97 and 1.08.
4. **Never delays the member.** Controls work during an animation, a second
   tap interrupts the first, navigation never waits for an animation, and
   leaving is faster than arriving.
5. **No animation for its own sake.** Entry animations play on the first
   view only; re-renders, polling and returning to a screen stay still.
6. **No loops except live states**: listening, typing, loading. They stop
   the moment the state ends.

## Tokens (`apps/web/app/motion.css`, mirrored in `components/motion.ts`)

| Token | Value | Use |
| ----- | ----- | --- |
| `--motion-instant` | 80 ms | Press down, a tint, a check box answering |
| `--motion-fast` | 140 ms | Release, tab crossfade, small state changes, a number rolling |
| `--motion-base` | 200 ms | Arrivals (cards, toasts, messages), exits of sheets, disclosure height, theme crossfade |
| `--motion-slow` | 280 ms | Sheets and bars sliding up from the bottom edge |
| `--motion-emphasis` | 420 ms | Celebration and progress only (a finished workout, a drawn success check) |
| `--motion-progress` | 640 ms | Bars and rings growing to their value the first time they are seen (at most 700 ms) |
| `--motion-loop-typing` / `--motion-loop-shimmer` / `--motion-loop-breathe` | 1.2 s / 1.4 s / 4 s | The only loops: typing dots, skeleton shimmer, the listening ring |
| `--ease-out` | `cubic-bezier(0.2, 0, 0, 1)` | Arrivals and releases |
| `--ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | Departures |
| `--ease-in-out` | `cubic-bezier(0.4, 0, 0.2, 1)` | Things that move from one place to another (the tab indicator) |
| `--ease-spring` | `cubic-bezier(0.34, 1.4, 0.64, 1)` | Small overshoot for success moments only (a logged set, a badge, a finished workout) |
| `--motion-distance-xs` / `-sm` / `-md` | 4 / 8 / 16 px | Nudges and shakes / arrivals / sub-page slides and sheets' dialogs |

Stagger: 30 ms between siblings, at most 6 items (`MOTION.stagger`,
`MOTION.staggerMax`).

## Rules

- CSS transitions and keyframes and the Web Animations API only. No
  animation library, no new dependency.
- Animate only `transform` (and `translate`, `scale`, `rotate`) and
  `opacity`, plus `stroke-dashoffset` for SVG rings and checks and
  `grid-template-rows` for disclosure height. Never `width`, `height`,
  `top`, `left` or `margin`. A tint that accompanies a press changes at once
  (no colour transition).
- `will-change` only while something animates (set and cleared by
  `playMotion`), never in a stylesheet.
- No layout shift: things that appear reserve their space first or float
  (sheets, toasts, bars); bars grow by `scaleX` over a fill that already has
  its final size.
- Only meaningful state changes animate, not every render; entry
  animations only on the first view of a screen in a session
  (`firstView()` in `motion.ts`).
- Direction follows the document: forward goes toward the inline end
  (right in English, left in Arabic). Every horizontal movement multiplies
  by `--inline-sign` (CSS) or `inlineSign()` (script).
- Hover effects only inside `@media (hover: hover)`.
- Reduced motion: every animation and transition lives inside
  `@media (prefers-reduced-motion: no-preference)`; scripted motion goes
  through `playMotion`, which does nothing when motion is reduced. With
  reduced motion the app is the same, only still: sheets open and close at
  once, rings and bars show their value directly, loops are off, numbers
  show their final value.
- **Reduce motion choice** in Profile and settings > Display preferences,
  next to Appearance: "Match this device" (System) or "Reduce motion" (On).
  On sets `data-reduce-motion="on"` on `<html>` (from a device cookie, so
  the first paint already has it), which applies the same rules as the
  device setting: `motion.css` stops every animation and transition and
  `prefersReducedMotion()` answers true. English and Arabic text.

## Catalogue: what moves, where

| # | What | Where (component, stylesheet) |
| - | ---- | ----------------------------- |
| a | Press feedback: scale 0.97 and a tint on press (`--motion-instant`), back on release (`--motion-fast`) | Buttons, icon buttons, card links, list rows (More), tabs, choice cards; `motion.css` "Press" |
| b | Tab bar: the current tab's pill slides from the tab you left (measured, so it mirrors in Arabic); the icon pops 1 → 1.08 → 1; the unread badge pops when the count rises | `member-shell.tsx` (`useTabIndicator`), `motion.css` "Tab bar" |
| c | Screen transitions: tab switches crossfade (`--motion-fast`); a sub-page slides 16 px in from the inline end with a fade while the old page leaves toward the inline start, back reverses; the top bar, tab bar, side navigation and action bar stay still (named and held in `motion.css`). React's `<ViewTransition>` (Next 16 App Router, no configuration) as `MemberPageTransition`, which the page route puts around the workspace for `/app` addresses; the direction from `navDirection()` in `member-nav.ts`, set on `<html data-vt>` during the commit. Without View Transitions (older Safari, Firefox): a plain `--motion-fast` fade-in of the new page. Navigation never waits: the transition starts when the new page is ready and taps pass through it (`::view-transition { pointer-events: none }`). | `member-shell.tsx`, `app/[[...path]]/page.tsx`, `member-nav.ts`, `motion.css` "Screen transitions" |
| d | First view of Today and lists: blocks fade up 8 px, 30 ms apart, the first 6 staggered; loading states are skeletons with a soft shimmer instead of "Loading…" | `playArrival` + `firstView` in `motion.ts`; `Skeleton` in `phone-ui.tsx`; Today, timeline, nutrition, chat, notifications and other member screens |
| e | Sheets and dialogs slide up over a fading dim (`--motion-slow`) and leave faster (`--motion-base`); the sticky action bar slides up when it appears; toasts ("Saved", "New version ready", "Back online") slide up and fade, and saved and back-online toasts dismiss themselves | `BottomSheet`, `StickyActionBar`, `Toast` in `phone-ui.tsx`; `AppUpdateToast` in `pwa-ui.tsx`; the workspace's success notice |
| f | Workout: stepper numbers roll (old value out, new in) on minus and plus; a logged set's check draws (SVG stroke) and its row glows once; the rest timer is an SVG ring counting down; finishing shows a short completion moment (the ring fills, the check draws, the streak counts up, `--motion-emphasis`), no confetti; a 10 ms haptic tick on Log set and Finish where supported and motion is not reduced | `NumberStepper`, `DrawnCheck`, `ProgressRing`, `WorkoutComplete`, `workspace.tsx` Workout |
| g | Progress and nutrition: bars and rings grow from 0 to their value the first time they scroll into view (IntersectionObserver) and numbers count up once; returning after logging a meal moves the day's calorie bar from the old value to the new one; a newly logged meal slides into the diary | `useMeterMotion`, `CountUp` in `motion.ts`/`phone-ui.tsx`; `programme-today.tsx`, `nutrition.tsx` |
| h | Chat: a sent message slides up and fades in, shows "Sending" at reduced opacity, then sent; the digital coach shows a three-dot typing indicator while it prepares a reply; new incoming messages slide in; the send button scales in when there is text | `training-workspace.tsx` `CoachingMessages` (member side only) |
| i | Form controls: a check box or radio you just chose answers with a small pop (native controls keep the platform's own tick and dot; see "Not done"); a disclosure with one block inside opens to its height (`grid-template-rows` 0fr → 1fr on `::details-content`) and its chevron turns; inline errors fade in; the first invalid field after a submit shakes 3 times by 4 px | `motion.css` "Form controls"; `phone-first.css` (chevron); `useInvalidShake` in `motion.ts` (member shell, sign-in and joining pages, coach website) |
| j | The analytics bar and the install card slide up when they appear; after a choice they slide away and are then removed from the page (the analytics control still disappears completely); the offline pill slides down from the top bar; "Back online" fades out | `acquisition.tsx` (subscriber pages only; the marketing site's bar is unchanged), `pwa-ui.tsx` `InstallCard`, `member-shell.tsx` |
| k | Voice and guided sessions: a calm breathing ring while listening; a countdown ring for rest and timed work; the spoken cue crossfades when it changes | `voice-session.tsx`, `integration-center.tsx` `GuidedSession` |
| l | Coach website and joining: the hero fades up once per visit (not in the trainer's Design Studio preview); membership cards and galleries lift 4 px on hover (hover devices only); switching between "I'm new here" and "I already have an account" slides the fields in the direction of the choice (the typed email stays); the "You joined" notice's check draws | `coach-site.tsx`, `joining.tsx` |
| m | Theme switch: only when the member changes it, colours crossfade over `--motion-base` (a View Transition of the page, opacity only) | `appearance.tsx` `DisplayPreferences` |

## Performance and accessibility budget

- At 390x844 with the CPU slowed 4x: no long task over 50 ms caused by an
  animation (style, layout and paint time, or animation frame callbacks, in
  the long animation frame); zero layout shift from an animated element.
- Every running animation touches only the allowed properties and lasts at
  most 420 ms (rings and progress at most 700 ms); only the live loops above
  repeat.
- With `prefers-reduced-motion: reduce` emulated and with the in-app
  Reduce motion on, no transform animation runs during the same flows.
- Screen readers: animated counters and rings keep the final value in their
  accessible name or `aria-valuenow`; the typing indicator is a polite
  status ("Your digital coach is writing a reply"); nothing announces twice.

## Checks

- `tests/motion-css.test.ts`: every `@keyframes`, `animation` and
  `transition` in subscriber CSS uses the motion tokens, sits inside the
  no-preference query and is stopped by the in-app Reduce motion rule,
  never transitions `width`, `height`, `top`, `left` or `margin`, and every
  horizontal movement mirrors right to left.
- `tests/member-motion.test.ts`: the tokens match between CSS and
  `motion.ts`; helpers do nothing without a browser or with reduced motion;
  `navDirection`; the shell's change detection; the sheet's close sequence.
- `npm run test:motion` (`scripts/motion-check.mjs`): the browser budget
  above against a production build.

## What was built (branch `ui/integrate`)

- `app/motion.css` (imported once by the root layout) holds the tokens and
  every animation and transition for subscriber surfaces; `phone-first.css`,
  `analytics-consent.css` and `voice-session.css` no longer hold any. The
  earlier tokens (`--motion-press`, `-enter`, `-slide`, `-exit`) are gone.
- `components/motion.ts`: the same tokens, `prefersReducedMotion()` (the
  device setting or `data-reduce-motion="on"`), `playMotion`,
  `playArrival` + `firstView`, roll/shake/meter/ring keyframes, `haptic`,
  `countUp`, `useMeterMotion`, `useArrivals`, `useInvalidShake`,
  `withViewTransition`, `supportsViewTransitions`.
- `components/phone-ui.tsx`: `Toast`, `Skeleton`, `DrawnCheck`,
  `ProgressRing`, `CountUp`, `Meter`; `NumberStepper` rolls its number
  (a ghost of the old value leaves while the new one arrives);
  `BottomSheet` leaves in `--motion-base`.
- Member shell: the tab pill slides between tabs (measured, so it mirrors),
  the new tab's icon pops, the badge pops, `data-vt` direction, first-view
  arrivals, "Back online", the member's "Saved" toast, invalid-field shake.
- Screens: Today (skeleton, programme and calorie bars, streak count-up),
  timeline, notifications, account settings, voice session, Apple Health
  card and nutrition (skeletons); workout (drawn check and glow on a logged
  set, rest ring, haptics, completion moment with `WorkoutComplete`);
  guided session (cue fade, rest ring); voice session (rest ring, cue fade,
  breathing listening ring); chat (sending bubble, typing dots, arrivals,
  send button); nutrition diary (new entries slide in); coach website
  (hero, card lift); joining (field slide, drawn check); analytics bar and
  install card (arrive and leave); update toast (leaves on "Later").
- Display preferences: Motion, "Match this device" or "Reduce motion"
  (English and Arabic), a device choice mirrored in the
  `trainer_member_motion` cookie so `<html data-reduce-motion="on">` is in
  the first paint; the appearance change crossfades.

## Not done, and why

- **Drawn ticks inside native check boxes and radio dots.** Drawing them
  needs replacing the native controls (custom `appearance: none` boxes),
  which risks forced-colours, autofill and assistive-technology behaviour
  across browsers. Native controls answer with a small pop instead; the
  drawn check is used where the app draws its own (a logged set, the
  completion moment, "You joined").
- **Switch knobs.** No subscriber surface has a switch (they are only in
  the Super admin settings).
- **Progress screen counters and rings.** Its figures sit inside sentences
  and a table, and it has no bars or rings; the growing bars and the
  count-up are on Today (programme progress, today's calories, streak) and
  in the completion moment.
- **A calorie ring on Today.** Today shows calories as a bar; logging a
  meal moves that bar from the value it showed last to the new one when the
  member returns to Today. The ring is in the nutrition diary (above).
- **Join steps.** Joining is one short form, so the direction-aware slide
  is used for the account choice that swaps the fields. The coaching
  profile became a step flow with the member screens and now slides its
  steps (above).
- **Browser back gestures.** The in-app back button is verified to slide
  back; a system back gesture takes the same path (the direction comes from
  the addresses) but was not exercised by the check.
- **A View Transition boundary inside the workspace.** Tried first; React
  never saw the page change there in this app (measured in the check), so
  the boundary sits at the page route, as the Next 16 guide recommends.

## Member screens merged (29 September 2026)

The member-screens track (docs/features/member-screens.md) replaced Today,
the programme tab, chat, the coaching profile, membership, coaching
context and settings with new components. The catalogue was applied to
them with the same tokens and reduced-motion rules:

- **d. First view**: a screen wrapper marked `data-stagger` (Today, the
  programme, membership, coaching context, settings, the timeline) is
  entered by `arrivalTargets`, so its blocks arrive 30 ms apart instead of
  the whole screen as one block. Loading states are `Skeleton`s (Today's
  focus card, the plan, the timeline, chat, coaching context, receipts,
  galleries).
- **g. Progress**: Today's programme tile ("Day 3 of 28") and calorie tile
  carry a `Meter` that grows once and moves from the last value shown
  (`today:programme`, `today:kcal`); the streak tile counts up once
  (`today:streak`). The nutrition diary shows the latest day's recorded
  calories against the plan as a `ProgressRing` that grows once, beside
  diary entries that slide in (`useArrivals`).
- **h. Chat**: `MemberChat` has the sending bubble, typing dots, new
  messages sliding in and the `chat-send` scale on both send buttons.
- **Intake steps** (new): Next slides the step in by 16 px from the inline
  end, Back from the inline start (`inlineSign`), the progress segment just
  reached grows by `scaleX` from its inline start, and saving draws the
  check (`DrawnCheck`, emphasis). All through `playMotion`, so nothing
  moves with reduced motion.
- **e. Sheets**: every new sheet (change a session, stop renewal, book or
  cancel, leave a coach, attachments) is the shared `BottomSheet`.
- **f. Workout** is unchanged from this track.

## Checks run (29 September 2026, Node 24, local Chromium 141)

- `npx tsc --noEmit` and `npx tsc --noEmit -p apps/web/tsconfig.json`:
  clean.
- Node tests (`node --import tsx --test`): `member-motion` 13,
  `motion-css` 7 (a deliberately broken sheet made 4 of them fail, then
  was restored), and the related web suites (`member-shell`,
  `logical-css`, `rtl-layout`, `analytics-consent`, `appearance`,
  `public-pages`, `pwa`, `brand`, `coach-site`, `joining-web`,
  `programme-today`, `i18n`, `i18n-hardcoded`, `accounts-web`,
  `nutrition`, `voice-session`, `meal-capture`, `fix-web`, `fix2-web`,
  `healthkit-ui`, `notifications`, `acquisition`, `support-preview`,
  `chat-attachments`, `client-context`, `bookings-completion`,
  `marketing-site`, `governance-web`, `infra-ops-web`,
  `platform-address-web`, `web-address-web`): 301 passed, 0 failed.
- `npm run build`: passed.
- `npm run test:motion` (production build, fresh database, ports
  3747/4747, CPU slowed 4x, 390x844), on the final build: 35 steps, 77
  animations checked, 0 failures. 12 long frames (51-166 ms) fell inside
  animation windows; each carried the app's own script (React rendering
  after a tap or a fetch, 16-79 ms of script) with at most 40 ms of style,
  layout and paint from that same update and no animation-frame callback
  time, so none was caused by an animation. No layout shift came from an
  animated element (finishing a workout shifts the page as the set forms
  close, which is not an animation). With reduced motion emulated and with
  the in-app choice (by cookie, and by choosing it in Display
  preferences), nothing moved.
- `npm run test:rtl` (ports 3749/4749, production build): 87 screen
  measurements, 0 failures.
- `npm run test:phone` (ports 3751/4751, production build): 67 screen
  measurements, 0 failures (including its reduced-motion pass).
- `npm run test:brand` (production build): 112 screens passed.
- Also: the consent check (passed; the bar is gone after every answer),
  `npm run test:pwa` (33 passed) and `npm run test:dark` (61 screens,
  0 failures).

Note: "Reduce motion" is a device choice; on that device it also stills
the marketing site's own motion (the global rule in `motion.css`), which is
the member's accessibility preference rather than a change to the site.

## Verification round (30 September 2026)

- **The frame holds still.** The cause of the blank bars, found frame by
  frame: React names the entering page (`div.trainer-theme`, `_t_1_`) after
  the bars were captured, a later name paints on top, and React drops the
  root's snapshot; so the new page's opaque full-screen snapshot covered
  the top bar, the tab bar and the analytics bar while it faded in, and
  they reappeared only when the transition ended. Now, during a navigation,
  the top bar, tab bar, side navigation, action bar and analytics bar
  (`member-consent`, named because it lives in the root layout) have
  groups with `z-index: 1` above the page and no animation; the new, live
  bar shows (its title and tab pill move in place) and the old picture is
  hidden only while a new one exists (`opacity: 0`; `:only-child` keeps a
  bar only one page has and fades it with the page). `motion-check.mjs`
  records every painted frame of tab switches, a sub-page and Back
  (DevTools screencast, English and Arabic) and fails if the top bar or
  tab bar band is blank in any frame; `MOTION_FRAME_DIR=<dir>` keeps the
  frames for a person to look at. Local Chromium's renderer crashed when a
  script read `getComputedStyle()` of a transition pseudo-element that has
  an `:only-child` rule (a diagnostic probe did this; the app and the
  checks never do).
- **Arabic page changes no longer go blank.** React also sizes the
  `::view-transition` layer to 0 x 0 while the browser keeps `inset: 0`; in
  a right-to-left page that over-constrained box keeps its right edge, so
  the layer sat at the right side of the screen and every snapshot (placed
  from its physical top-left) was off screen: the whole screen was blank
  for each Arabic tab switch, sub-page and Back. `::view-transition
  { right: auto }` (motion.css, the one physical declaration allowed in
  `tests/logical-css.test.ts`) pins the layer to the left in both
  directions. Seen and confirmed frame by frame in the motion check's
  Arabic screencast.
- **No second arrival.** A screen's first-view settle-in plays only on the
  app's first load (or without View Transitions); a page reached by
  navigation moves only in its transition.
- **Title direction** follows the page (`--motion-title-shift`): in from the
  inline end on a sub-page, from the inline start on Back, a fade between
  tabs.
- **Refresh bar** waits 400 ms (`MOTION.refreshDelay`; the shell sets
  `data-refreshing` only once a refresh has run that long), so quick
  page-change refreshes show nothing and nothing animates in the top bar
  during a page transition; it never shows over skeletons.
- **Tab bar**: the tapped tab lights up on pointerdown (`data-pending`),
  before the next page commits.
- **Sheets** close the modal at once and slide away as a non-modal,
  untappable dialog, so taps on the page work during the slide; the
  keyframes start and end fully below the screen (shadow and safe area
  included). The pain sheets no longer focus their optional note (the
  keyboard covered "Stop workout and notify coach").
- **Finishing a workout**: an instant scroll to the top, no toast, the ring
  fills at once in `--motion-slow` and the check draws after it in
  `--motion-fast` (420 ms in all, the motion limit). The card's `h2` has
  `role="status"`, so checks find it by its text ("Workout done"), not as
  a heading.
- **Press feedback** also covers the coach website's section links, "More
  about", text links, Today's secondary link and Sign out (an instant 60 %
  tint, no scale); card-sized targets use a 5 % tint.
- **Consent bar** fades where it is after an answer (no slide across the
  page); the workout notice replays only when its words change.
