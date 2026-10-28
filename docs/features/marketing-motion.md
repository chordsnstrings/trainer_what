# Marketing site motion

The owner asked: "marketing site should get microanimation revamp. And should
allow a UI animation that shows how the whole coach onboarding process will go
like and how that will translate to a subscriber. the whole workflow." This is
the reference for both parts: the sitewide microanimations and the
coach-to-subscriber journey player. The history of each part (storyboard
deviations, earlier measurements, the merge) is in
[marketing-site.md](marketing-site.md).

The house rules first came from the home hero relay (`hero-flow.tsx`,
removed with phase 1 of the marketing revamp on 28 October 2026). They hold
everywhere except inside the Brain showcases (`[data-showcase]`, on `/`,
`/trainer-brain` and `/demo`), which have their own rules: see "The Brain
showcases: the motion exception" below and
[brain-showcase.md](brain-showcase.md).

- Every word is real HTML and visible from the first paint. Motion is
  decorative, short and plays once; nothing is infinite. The showcases'
  engine loop is the one exception: it runs only while a showcase is
  visible and playing, and it always has a Pause.
- Motion for every visitor (the owner, 22 October 2026; see "Motion for every
  visitor" below): while the switch `MARKETING_MOTION` is `"always"`, every
  short marketing motion plays whatever the device's `prefers-reduced-motion`
  or the member's own "Reduce motion" choice says. Two kinds of motion
  still follow both settings in either mode: the Brain showcases (the owner's
  showcase exception, 27 October 2026) and the pinned, scroll-scrubbed
  scenes, which no page mounts since 28 October 2026
  ([scroll-scenes.md](scroll-scenes.md)). With the switch at
  `"device"` (the earlier rule), reduced motion removes movement (instant or
  opacity only) and stops auto-play. Either way the auto-playing journey keeps
  its Pause and every hold.
- No metrics, counts, revenue, count-ups or testimonials; only features that
  are available now; no AI cost, AI usage fee or model cost anywhere. The
  marketing text (`packages/contracts/src/marketing-content.ts`,
  `marketing.ts`) is never reworded or removed by motion work.
- The site stays always light with lime (Pace) accents; lime sits behind ink,
  never under muted text. The one dark surface is the Brain showcases' ink
  stage, inside `[data-showcase]` only.
- CSS transitions and keyframes, IntersectionObserver and the Web Animations
  API only: no animation library, no new dependency. The Brain showcases add
  canvases drawn on one `requestAnimationFrame` loop, still with no library.
  Only `transform`
  (`translate`, `scale`, `rotate`), `opacity`, SVG `stroke-dashoffset` and a
  disclosure's `grid-template-rows` animate; colour changes are instant.
  Nothing changes layout (no layout shift).
- A hidden-before-reveal state applies only after a script adds a class, and
  never to above-the-fold content or the LCP element.
- Hover effects sit inside `@media (hover: hover)`. Logical properties only
  (`tests/logical-css.test.ts`); arrows and slides flip with
  `var(--inline-sign)` in right to left.

## Tokens

Defined once, on the marketing roots `.mk, .mk-header, .mk-footer,
.mk-assistant-host` in `apps/web/app/marketing.css`; every other stylesheet
only uses them, and `components/marketing/motion.tsx` keeps a copy in
milliseconds for the Web Animations API (a test keeps the two equal). They
are the marketing site's own values. The subscriber app's tokens
(`app/motion.css`) were shortened by the 20 October 2026 CI pass (120 / 180 /
200 / 220 / 240 ms, a 12 ms stagger, no overshoot); only `--motion-base`
(200 ms) and the out, in and in-out curves still match their `--mk-`
counterparts (`docs/features/motion.md`).

| Token | Value | Use |
| --- | --- | --- |
| `--mk-dur-press` | 80 ms | the press going down |
| `--mk-dur-fast` | 140 ms | small fades, menus opening, the press coming back |
| `--mk-dur-base` | 200 ms | slides, chevrons, link bars, swaps |
| `--mk-dur-slow` | 280 ms | rises, reveals, crossfades |
| `--mk-dur-emphasis` | 420 ms | the journey's dot and ring, the H1 highlight's sweep, the hero arrow's hand-off (the relay's wires and dot until 28 October 2026) |
| `--mk-ease-out` | `cubic-bezier(0.2, 0, 0, 1)` | things arriving |
| `--mk-ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | things leaving, the press |
| `--mk-ease-in-out` | `cubic-bezier(0.4, 0, 0.2, 1)` | travel (the dot), taps |
| `--mk-ease-spring` | `cubic-bezier(0.34, 1.4, 0.64, 1)` | success states only (ticks, Reserved, Confirmed, Passed, Live, Applied and Rescheduled automatically, Approved, Paid; the `/trainer-brain` rule card's stamp since 28 October 2026). The showcases' `--sc-spring` points at it |
| `--mk-ease-enter` | `cubic-bezier(0.2, 0.8, 0.2, 1)` | load-in entrances only: the H1 highlight's sweep (the commission pills until 28 October 2026; a test holds the list). The showcases' `--sc-enter` points at it |
| `--mk-dist-nudge` | 3 px | the arrow's hover nudge and the hand-off nudges |
| `--mk-dist-item` | 8 px | a grid item's rise (the old home's "You stay in charge" lanes until 28 October 2026) |
| `--mk-dist-rise` | 12 px | a section's rise (the old home's message and AI cards until 28 October 2026) |
| `--mk-dist-load` | 16 px | a load-in slide from the inline start. Its only user, the commission pills, went on 28 October 2026; the token stays because the test pins the token set |
| `--mk-stagger-step` | 40 ms | the step between grid items (at most six steps, 240 ms) |
| `--mk-stagger-load` | 80 ms | the step between load-ins: the /features screens and set ticks (the pills until 28 October 2026; at most three steps) |

The distances and staggers arrived with the concept pass (22 October 2026,
below); there are still no new durations. Each item's `--mk-stagger` is a
stagger token or a whole multiple of one, and `MAX_STAGGER` (240 ms) in
`motion.tsx` is the longest (the test resolves the tokens).

## What animates where (sitewide)

Code: `apps/web/app/marketing.css` (the motion block) and one island,
`components/marketing/motion.tsx` (`MarketingMotion`, rendering nothing).

| Where | Motion |
| --- | --- |
| Buttons (header and page) | Press `scale: .97` (80 ms in, 140 ms out) on every device; a 1 px lift and a 3 px arrow nudge only where the pointer hovers. |
| Hand-offs (concept pass) | The hero's primary action (keyed on `.mk-cta`, so "Join early access" too): its arrow nudges forward once (from 2.55 s, 420 ms, over by 2.97 s). The 2.55 s delay was set to follow the relay's last tick; it stays now that the relay is gone. The closing panel's button: its arrow nudges once, 280 ms after the button itself comes into view (done by about 700 ms). Both mirror in right to left. |
| Single-line links (header, breadcrumbs, footer, `.mk-link`) | A 1 px ink bar slides in from the inline start on hover (200 ms), at once on keyboard focus. |
| Header | Its shadow fades in over the first 48 px of scrolling (scroll-driven, no script). Menus open with opacity and a 4 px rise; the phone menu drops in and its items rise 30 ms apart; "Menu" presses. No browser tap flash on the menu or any disclosure (`summary`). |
| Home hero relay | Removed on 28 October 2026, with the relay. Until then: wires drew (420 ms), the dot travelled, the ticks popped (spring), one Pace ring behind the mark; it ended at 2.53 s. The home hero's field is now a Brain showcase (see below). |
| Section reveal | Units wholly below the first screen at load rise 12 px and fade in once as they enter (280 ms); grid items follow 40 ms apart (at most 240 ms). The FAQs are a grid too: the heading, then each question in turn. Never the hero, breadcrumbs, page heading, anything on the first screen, the journey player, or a Brain showcase and its band (`[data-showcase]`, `.mk-sc-band`, `.sc-host` in `NEVER`). |
| Own triggers (concept pass) | The home FAQs, the closing button and the `/features` "Back squat" set table are observed themselves (`data-mk-cue`), not through their band or section, which on a phone reveals (or, too tall to wait, never waits) while they are still below the fold. The commission pills were one too, until 28 October 2026. |
| Commission pills (home) | Removed on 28 October 2026. The home's share bands are now a plain list in the "Free to start. Your price." band, with no motion of their own. |
| Link cards and tiles | Lift 2 px with a soft shadow on hover; press `scale: .99`. |
| "You stay in charge" (home) | The decision-flow card and its choreography were removed on 28 October 2026. The band's flow window is static. |
| Home walkthrough (since 28 October 2026) | The rail's ink line slides under the chosen step (`translate`, 200 ms, out curve). The panels share one grid cell and swap with no motion, so nothing below moves. |
| `/trainer-brain` sample controls (since 28 October 2026) | The rule card's "Confirmed" or "Edited" stamp pops (`mk-pop`, spring, 280 ms). The release timeline's "Live" marker slides one version back and forward (280 ms). |
| `/pricing` calculators (since 28 October 2026) | The share slider's marker slides (140 ms) and the meters scale (280 ms). There is no count-up. |
| Disclosures (FAQs, calculator assumptions) | The chevron turns (200 ms); a FAQ answer unfolds through its grid row (280 ms) and fades in. |
| Calculators | No count-up. 150 ms after the last change the result settles (opacity .55 to 1 and 4 px, 200 ms); changed cells settle too. |
| /features, /get-started | The screens reveal 80 ms apart with their ticks; the "Back squat" screen's completed sets pop one after another (520 ms, then 600 ms after the set table itself comes into view, at every width), like reps being logged, no count-up; the checklist staggers. Until 28 October 2026, /demo's chosen decision also rose and its label popped or stamped. |
| Brain showcases (`/`, `/trainer-brain`, `/demo`) | Their own engine and rules: see "The Brain showcases: the motion exception" below. |

Reduced motion: with the switch at `"always"` everything in this table plays
for every visitor. With `"device"`, the reveal script does nothing,
`globals.css` and `app/motion.css` stop element animations and transitions,
and `marketing.css` stops pseudo-elements and the details content box and
removes lifts, presses and nudges. Without JavaScript nothing is hidden.

## The journey player

Code: `components/marketing/journey.tsx` (server: the launch gate, the scenes,
the timings, both placements), `components/marketing/journey-player.tsx` (the
only client code, React only: the control bar, the chapter clock, the root's
data attributes), `apps/web/app/marketing-journey.css` (every journey style;
imported next to `marketing.css` in `app/layout.tsx`).

Placements, always shown (owner, 30 September 2026; until then it was shown
only while registration was open and the model, payments and payouts
providers were available). Parts not live yet keep their availability chips:

- `/how-it-works`: the "Eight steps, start to finish" section. Its h2, its
  `ol.mk-steps` with the registry's titles and bodies unchanged, and the HowTo
  JSON-LD stay; the stage and the controls sit above the cards. Each card adds
  a visible "Your subscriber" label (the "Who does what" column header) and the
  step's subscriber line.
- Home, until 28 October 2026: a band straight after the hero with the same
  stage without words (every word is a bar), the section heading as a small
  label, the active step's title, "Your subscriber" and the step's
  subscriber line, the controls and "See how it works". Phase 1 removed the
  band (`JourneyBand`). The player's compact variant and the `.mk-walk-band`
  and `.mk-walk-compact` rules stay for phase 2 to reuse or delete. The home
  now shows the same eight steps as a stepper (marketing-site.md, "Phase 1").

### Chapters and their sources

Each chapter is one registry step (`/how-it-works`, section `steps`). The
coach side shows the workspace screen that step happens in; the dot crosses to
the subscriber's phone; chapters 6 to 8 also cross back. The subscriber line
under each card is looked up from the registry, never copied (`SUBSCRIBER_LINES`
in `journey.tsx`; a test resolves every one; bullets, steps and sentences
are counted from 1 below).

| # | Step (registry) | Coach side | Crossing | Subscriber side | Subscriber line (source) |
| --- | --- | --- | --- | --- | --- |
| 1 | Claim your address | Design Studio: the address uncovers, Reserved pops, name, colour swatch picked, logo | coach to phone at 2.3 s | The brand preview: the coach's header and colours, a placeholder page. No address bar and no Join (nothing is published yet) | `/features/subscriber-app` section `subscriber`, bullet 1 |
| 2 | Teach your Brain | Knowledge review: a rule typed, Confirm tapped, Confirmed pops | 2.3 s | Chat: the subscriber's message, typing dots, the labelled digital coach replies from the rule | `/features/chat-and-digital-coach` section `flow`, step 2 |
| 3 | Test it | Scenario lab: scenarios rise, Evaluate tapped, ticks, "Handed to you", Passed | 2.3 s | Today's session card from the evaluated release, then next week | `/features/subscriber-app` `subscriber`, bullet 2 |
| 4 | Create your offer | Your offer: price (a placeholder, never a number), length, billing slides to Monthly, free trial on; nutrition tier and voice add-on rows only when available now | 2.3 s | Membership card: AED and a placeholder, Monthly, Free trial, Join | `/features/payments-and-payouts` `subscriber`, bullet 1 |
| 5 | Publish and share | Preview, launch checks tick, Publish tapped, Live, the link for Bio and Stories | 2.3 s | A profile with the link (tapped), the coach's page opens with its address bar, Join, the card sheet, Pay, the intake chips | `/` FAQ "How do my Instagram followers become subscribers?", sentence 2 |
| 6 | It coaches daily | Exceptions: "Applied automatically", "Rescheduled automatically", then (after the return) "Safety hold" | coach to phone at 1.4 s, back (dashed) at 3.85 s | Today: the session card, two sets ticked, the third in progress, the rest ring; Report pain tapped, "Workout paused" | `/features/ai-training-plans` `subscriber`, bullet 1 |
| 7 | You correct, it learns | "Below your threshold": the hotel-gym plan, Approve tapped, Approved, "New teaching" | back (dashed) at 1.1 s, then forward at 3.1 s | The subscriber's message, "Handed to the trainer", then Approved and the plan | `/features/ai-training-plans` `subscriber`, bullet 3 |
| 8 | Get paid monthly | Monthly statement: three rows with placeholder values (no amounts, no total), "Paid monthly to your UAE IBAN" | back at 0.9 s, solid and lime-backed (the payout; the dashed return means "handed to you") | Membership card, Paid | `/pricing` section `how`, bullet 1 |

Timings (`JOURNEY_TIMING`): chapters last 5.0 to 7.5 s; a crossing takes
570 ms (the trail draws in 280 ms, the dot travels 420 ms from +150 ms); every
chapter holds its complete picture for at least 2.5 s. One pass is about 54 s
and stops on chapter 8 with Replay.

### Motion

- Base styles are each chapter's complete picture (no JavaScript, reduced
  motion and the first automatic pass show it); keyframes hold only starting
  states and run while the root carries `data-run`. Every beat builds top to
  bottom (a card rises before its rows; nothing shows an empty frame first).
- The chapter clock is a Web Animations API animation on the active progress
  segment; its end advances the chapter.
- Auto-play starts only when at least half of the stage is on screen and the
  tab is visible; it holds (and resumes by itself) off screen or in a hidden
  tab (`data-hold`: the stage's beats, wire and frames pause; the controls
  never do). A mouse resting on the player stops only the chapter clock: the
  chapter's beats finish and its picture stays; an explicit Play or Replay
  wins until the pointer leaves and comes back. Keyboard focus entering the
  player, Pause, a swipe, a chapter button, Previous, Next or a touch on the
  step cards stop auto-play until Play.
- The mocks' text scales with its frame: 2.4% of the laptop's width (3.6%
  on the full player on phones), 5.4% of the phone's, never below 11 px
  (12.5 px). The sizes are computed from the viewport and the grid shares
  (custom properties on `.mk-walk`), not with container queries, which
  measurably delayed the first paint; the journey check compares them with
  the frames' real widths.
- Phones (up to 760 px): a square stage showing one side at a time under a
  strip that names both sides ("You" with a laptop, "Your subscriber" with a
  phone; the side on screen sits on lime); at each crossing the sides swap.
  The phone is 76% of the stage, so its text is about 13 to 14 px; the coach
  window's text is at least 12.5 px. "Illustration with sample data" shows at
  every width.
- The step cards are a scroll-snap carousel on phones, and from 761 px once
  the island runs (two in view, four from 1150 px), so the active card is
  always on screen; without JavaScript wider screens keep the grid with every
  card in view. The chapter change scrolls the carousel, never the page.
- Controls: Pause/Play/Replay, Previous, eight chapter segments and Next (the
  home band has Play and the segments). The current segment is a lime track
  ringed in ink with the ink fill growing over it. Previous and Next stay
  focusable at either end (`aria-disabled`). Chapter buttons use a roving
  tabindex (arrows follow the reading direction, Home, End) and are named by
  their step; the live region speaks only when focus does not land on the
  chapter's own button (Previous, Next, a swipe, a card).
- Reduced motion: with the switch at `"always"` the player behaves as without
  it: auto-play from half the stage in view, the beats and the chapter clock
  animate, and Pause, keyboard focus, the mouse, off screen and a hidden tab
  hold it. With `"device"`: no auto-play; chapters change instantly; Play
  runs a slideshow whose clock has no target, so nothing on screen moves.
  The clock falls back to that target-less animation whenever the active
  segment's bar is missing, in either mode, so the chapter still advances.

### Weight and hydration

The stage and the step cards are server-rendered and reach the island as
slots, so the mocks never enter the JavaScript bundle. Each slot sits in its
own `<Activity mode="visible">` (React 19.2): the server still sends it
complete and in place (`<!--&-->` markers, no streamed fallback), but the
browser hydrates it after the controls, at low priority and in interruptible
pieces, instead of in the page's one hydration task. The wrappers are
memoised, so the player's own re-renders never reach them. (A `Suspense`
boundary was tried first and rejected: the server streamed the stage and the
steps into hidden `<div>`s revealed by a script, which would leave them hidden
without JavaScript and paint them late.)

The player's mount effects never read layout (the carousel's tab-stop check
runs in a ResizeObserver callback, after layout; the chapter scroll skips the
first chapter), and the hold rule targets the stage's animated parts, not a
universal selector. The stylesheet stays in `app/layout.tsx` with every other
stylesheet: stripping the journey rules from the marketing chunk did not
change first paint on pages without the player (see marketing-site.md,
"Second review").

## The Brain showcases: the motion exception (28 October 2026)

The owner's choice of 27 October 2026 ("Go with your recommendation") accepted SHOWCASE_DESIGN.md §8, decisions 1 and 2:
- the motion exception and the ink stage, limited to `[data-showcase]` sections: continuous motion, canvas, capped sample counts and pinned scenes;
- showcases follow reduced motion even while the switch is `"always"`.

The showcases are the field and the board on `/`, the decision anatomy on `/trainer-brain`, and the playground on `/trainer-brain` and `/demo`. How they are built and checked is in [brain-showcase.md](brain-showcase.md). The motion rules are:

- **A continuous loop, only while it can be seen.**
  - One `requestAnimationFrame` loop serves every showcase on the page. The field and the playground draw on canvases.
  - A showcase draws no frame while any pause reason holds: off screen, a hidden tab, idle (90 s without input, or 60 s on phones), the visitor's Pause, an open receipt, a Kamran call (`html[data-mk-call]`), or reduced motion.
  - `data-sc-run` is on a showcase root exactly while a frame is scheduled for it, so the browser check can count frames.
- **Pause.** Every showcase has a Pause control (`[data-sc-pause]`, with a correct `aria-pressed`), because its motion runs longer than 5 s (WCAG 2.2.2).
- **Reduced motion, in both switch modes.**
  - Showcases follow the device's setting and the member's own `data-reduce-motion="on"`.
  - Their CSS carries no `MOTION_ALWAYS_EXCLUDED`, and neither `brain/head.ts` nor `brain/mount.tsx` reads `MARKETING_MOTION`.
  - Under either setting, the first frame is final, the anatomy shows flat plates, the field waits paused on its still frame, and the playground resolves each run at once.
- **Nothing infinite in CSS or SVG.**
  - Inside a showcase only `opacity`, transforms and `stroke-dashoffset` animate, and no animation is `infinite`.
  - Their easing tokens point at the marketing ones: `--sc-ease`, `--sc-enter` and `--sc-spring` are `--mk-ease-in-out`, `--mk-ease-enter` and `--mk-ease-spring`.
  - `tests/marketing-showcase.test.ts` holds this.
- **Robots and automated browsers get the still frame.** They are never sent the engine, unless the URL carries `?sc=on`. So this page's browser checks (`npm run test:marketing-motion`) see the still frames, and the showcases have their own check (`npm run test:marketing-showcase`).
- **No reveal on top.** The section reveal leaves a showcase alone: `[data-showcase], .mk-sc-band, .sc-host` are in `NEVER` (`motion.tsx`). The engine measures its own boxes, so a rise on top would move them.
- **The pin.** The anatomy pins under the header with its own CSS sticky frame, not the scroll-scenes engine. That happens only under `html.sc-pin` (set before the first paint, with the scroll scenes' gating) on screens at least 700 px tall.
- **The ink stage.** A dark stage (`--sc-stage` `#171917`) inside `[data-showcase]` only. Text is 4.5:1 or more, and controls and lanes are 3:1 or more; the test computes both.
- **Budgets.** The frame budgets:
  - p95 frame gap of 20 ms or less, at 4× CPU and `?tier=full`;
  - p95 engine work of 4 ms or less per frame;
  - long tasks from mounting: at most 2, each 80 ms or less;
  - blocking time within the baseline + 100 ms.

  `npm run test:marketing-showcase` reports these, and judges them only with `SHOWCASE_JUDGE_METRICS=1` on real hardware. The pinned anatomy's scroll paint measures a p95 of about 33 ms at 4× throttling in this GPU-less sandbox, and it waits for a real-hardware check. CLS of 0.001 or less is reported in CI until three PR runs in a row pass it. Figures: [brain-showcase.md](brain-showcase.md), "Budgets".

## Motion for every visitor (22 October 2026)

The owner: "for the current marketing site, switch on motion always", then,
on the plan's questions, Variant B, the two hero additions (later phases) and
"accept the performance cost for now … we can always switch it back to motion
matching the device." This is Phase 1 of
`docs/MARKETING_MOTION_PLAN_2026-10-22.md`: no new motion, only who sees it.

**The switch.** `apps/web/components/marketing/motion-mode.ts` exports
`MARKETING_MOTION` (`"always"` now, or `"device"`). `site.tsx` renders it as
`data-mk-motion` on the marketing root (`.mk`, which holds the header and
footer) and `assistant-button.tsx` on Kamran's assistant host
(`.mk-assistant-host`, outside `.mk`). Nothing else carries the attribute.

- **CSS.** No reduced-motion rule was deleted. Each one that reaches the
  marketing root or the host gets `:not(:where([data-mk-motion="always"],
  [data-mk-motion="always"] *))` (`MOTION_ALWAYS_EXCLUDED`):
  `globals.css` (`*` under `prefers-reduced-motion: reduce`), `motion.css`
  (the member's `:root[data-reduce-motion="on"]` rule), the reduced-motion
  block at the end of the Motion section in `marketing.css`, the Kamran
  button's and panel's rules (`marketing.css`, `marketing-assistant.css`) and
  the journey's (`marketing-journey.css`). The `prefers-reduced-motion:
  no-preference` wrappers around the relay, the header shadow, /demo, the
  early-access confirmation and the phone menu were removed (their contents
  unchanged): in `"device"` mode the rules above stop them as before.
- **JavaScript.** `motion.tsx` (the reveal and the calculators' settle) and
  `journey-player.tsx` read both settings only when `MARKETING_MOTION ===
  "device"`; the player's listener for a setting changed on an open page
  runs only then.
- **Why "device" restores the old behaviour exactly.** The exclusion names
  only the value `"always"`. With `"device"` no element carries it, so every
  rule matches what it matched before, with the same specificity (`:where()`
  adds none), and the scripts read both settings as before. The removed
  no-preference wrappers changed nothing in `"device"` mode: every element
  they animated is stopped by the `globals.css` and `motion.css` rules, and
  their two pseudo-elements (the relay ring and the header shadow) by the
  reduced-motion block in `marketing.css` and the `motion.css` rule.
  `tests/marketing-motion-sitewide.test.ts` keeps both modes wired.
- **Not switched.** The pinned, scroll-scrubbed scenes on `/` (the journey
  pin and the `#control` beats; `scenes-head.ts`, `scene-mount.tsx`) follow
  both settings in either mode (Variant B); a test keeps the two scripts'
  reduced-motion tests equal. A visitor with reduced motion gets the page
  without scenes, where the journey auto-plays and `#control` plays its
  one-off choreography. The journey is not un-pinned on phones. Since
  28 October 2026 no page mounts the scenes: phase 1 took the journey band
  and `#control` off `/` ([scroll-scenes.md](scroll-scenes.md)). The Brain
  showcases are not switched either: they follow both settings in either
  mode (see "The Brain showcases: the motion exception" above). The headers
  and footers outside `.mk` (sign-in, sign-up, the coach directory), the
  member app, the trainer workspace, coach websites, onboarding and the site
  builder are unchanged.
- **Kamran's Talk button.** The host has the class `public`, so it used the
  subscriber press (`motion.css`, inside `no-preference`), which stayed still
  under reduced motion. With `"always"` the host is left out of that press
  (`.public:not(.mk, [data-mk-motion="always"])`) and presses the marketing
  way (`.mk-assistant-host:where([data-mk-motion="always"]) .button` in
  `marketing.css`), for every visitor. With `"device"` it keeps the
  subscriber press.
- **Intentionally unchanged shared subscriber pieces.** The footer's
  "Privacy preferences" opens the shared `ConsentSheet`, which renders
  outside `.mk`; its rise (`motion.css`) still follows both settings. The
  checkbox pop on the assistant panel's "Show relevant pages as we talk"
  is the subscriber form-control rule (`motion.css`, inside
  `no-preference`): it stays still under the device setting (and plays under
  the member's cookie alone, since the host is left out of that rule).
- **Accessibility note.** Ignoring the setting misses WCAG 2.3.3 (AAA, not
  AA) for the short motion and reverses this page's earlier house rule; it is
  recorded as the owner's decision. Nothing loops, nothing hides first-screen
  content or the sign-up action, the load motion ends by about 3 s (the
  relay at 2.53 s, then the hero arrow's hand-off by 2.97 s), every effect
  started by scrolling ends within about 1.1 s of its trigger (the longest
  is "You stay in charge"; the concept pass's own effects end by 880 ms,
  the set ticks), the journey holds on request, and colour changes stay
  instant. Since 28 October 2026 the relay and "You stay in charge"'s
  choreography are gone, and the hero arrow's hand-off still ends by
  2.97 s. The Brain showcases are outside this note. They run continuously
  while visible, so each has a Pause (WCAG 2.2.2), and they follow both
  reduced-motion settings in either mode.
- **Switching back.** Set `MARKETING_MOTION` to `"device"` in
  `motion-mode.ts`, then build. No other change is needed; the browser checks
  read the attribute and apply that mode's expectations.

## Concept pass (22 October 2026)

Phase 2 of `docs/MARKETING_MOTION_PLAN_2026-10-22.md`, with its binding
review corrections: a few micro-animations from the "the page does reps
when you do" concept, on widgets that already exist. No new widget or
section, no copy change, the same order and calls to action. Every effect
is CSS on the existing marks plus the reveal script; each follows the
switch (with `"device"` and reduced motion it stays still: `globals.css`
stops the animations, the reduced-motion block in `marketing.css` holds the
arrows in place and releases every waiting item, and the script never
runs).

- **Tokens.** `--mk-ease-enter`, the four `--mk-dist-*` distances and the two
  `--mk-stagger-*` steps (table above). The literals they replace (the 3 px
  nudge, the 8 and 12 px rises, the 40 and 80 ms item steps) now use them.
- **Own triggers.** `motion.tsx` gains `CUES` (`.mk-band-pills, .mk-faqs,
  .mk-closing-cta, .mk-sets`), observed with the same observer and rules as a unit
  (wholly below the first screen at load, not tall, not the `#target`, never
  in the hero, the relay, the journey or a running scene). A cue never fades
  itself: it sets `data-mk-cue` and holds its own grid's items (a unit leaves
  those items to the cue), its arrow's nudge or the set table's ticks until
  it enters the view. An
  element that is already a unit (the FAQs on an inner page) keeps its
  unit's trigger, which is its own. Printing releases every cue.
- **The pills.** In `GRIDS` already; now on the 80 ms load step (as the
  `/features` screens) and the enter curve, from `translate:
  calc(-1 * var(--mk-dist-load) * var(--inline-sign, 1)) 0`. The concept
  loads its plates from the inline end; entering from the inline start is
  deliberate: it reads with the falling rates, and it can never add a
  horizontal scrollbar in either direction. Since 28 October 2026 the pills
  are gone, and with them their cue and their place in `GRIDS`.
- **The FAQ rows.** `.mk-faqs` joins `GRIDS` and the stagger lists: the home
  heading and six questions land 40 ms apart, the last at 240 ms.
- **The arrows.** `@keyframes mk-nudge` (one step of `--mk-dist-nudge`
  toward the reading direction at 50%, back at the end, one iteration).
- **The set ticks.** The tick transition's delay is `calc(520ms +
  var(--mk-set-step, 0ms))`; the second and later set rows set
  `--mk-set-step` to one and two `--mk-stagger-load` steps. The set table
  is a cue of its own (added after the review of 22 October 2026): the
  screens' section is taller than one and a half screens on a 390 phone, so
  it never waits there, and the ticks used to show at once on phones. Now
  the table's ticks wait (opacity 0, `scale: .4`) until the table itself
  enters the view, at every width. 520 ms is after the screens' own rise
  (280 ms plus at most 240 ms of stagger), so a tick never pops before its
  screen has landed. The other screen ticks (the note and the Inbox badge)
  keep their section's reveal, as before this pass.

**The layout shift on load (Phase 1's regression).** Phase 1's timed runs
recorded CLS 0.0022 on `/` at 1366x900 for the reduced-motion and
member-cookie cohorts and on `/?scenes=on` under reduced motion. A
layout-shift observer with sources found the moving box: `.mk-hero-body`,
from y 189 / height 163 to y 154 / height 198, about 0.56 s after the
start. 163 px is the lede plus the buttons without the line under them: the
browser had painted the hero while its HTML was still being parsed, and
the hero copy's two columns sit on their bottom edge (`align-items: end`),
so when "Free to join · No upfront cost · Built for UAE trainers" arrived
the whole column moved up 35 px. It is a race of the HTML parser, not of
the motion or the cohort: a local proxy that holds the page's HTML for
800 ms right before that line reproduces exactly 0.00218 for every cohort,
with or without reduced motion. The fix is
`<link rel="expect" href="#mk-relay-cap" blocking="render">` in the home
hero (React places it in `<head>`): the first paint waits until the relay's
caption, the first element after the copy, is parsed. Nothing is hidden or
moved; browsers without `rel=expect` ignore it. The LCP element is
unchanged (the lede at 390x844, the H1 at 1366x900). Since 28 October 2026
the home hero is phase 1's, and its one `rel=expect` points at
`#mk-hero-end`: an empty element that is the hero's last child, so the
first paint waits for the whole hero, the field's first frame included.
`tests/marketing-home.test.ts` and `tests/marketing-motion-sitewide.test.ts`
hold this. The LCP element is the H1 at 390x844 and 1440x900.

**The Pace sweep behind "trains": built, measured, then shipped on the owner's instruction (23 October 2026).**
The owner approved the sweep only if LCP was proven unchanged. The plan
allowed one comparison: `/` at 390x844 and 1366x900, 5 cold loads each,
this branch before the sweep against the same branch with it.
- **What was built.** The fill moved onto `.mk-mark::before`, with
  `position: relative` and `isolation: isolate` on the span and
  `box-decoration-break: clone` kept. The sweep was `mk-sweep` (`scale: 0 1`
  to rest) at `--mk-dur-emphasis`, on `--mk-ease-enter`, 120 ms in, from a
  fixed left origin (the H1 stays English under `?lang=ar`).
- **How it was measured.** In local Chromium with the CPU throttled 4x,
  after one untimed warm-up load each.
- **Results** (each set is the 5 cold loads in order):

  | Width | LCP element (both builds) | Before the sweep (ms) | Median | With the sweep (ms) | Median | Change | Allowance |
  |---|---|---|---|---|---|---|---|
  | 1366x900 | the H1 | 688/756/940/768/724 | 756 | 888/744/592/776/672 | 744 | -12 ms | 50 ms (passes) |
  | 390x844 | the lede, `p.mk-hero-lede` | 788/720/604/624/656 | 656 | 716/880/900/664/848 | 848 | +192 ms | 50 ms, the larger of 50 ms and 5% (fails) |

- **What the results mean.** The sweep does not touch the lede, and the
  spread inside each set of five is wider than the change. The difference
  is most likely noise, but the one permitted comparison did not prove LCP
  unchanged.
- **Decision.** The sweep is left out, and the hero is as it was. AA
  contrast was not the problem: the word stays ink (`#171917`) on white,
  then on Pace (`#d5f24a`), both far above 4.5:1.
- **Trying again.** It needs a fresh comparison with more loads, and the
  owner's agreement to run one.
- **Shipped, 23 October 2026.** The owner said "Hero trains highlight had to
  be there". The same build went back in: `marketing.css` (`.mk-mark::before`,
  `@keyframes mk-sweep`) and the static test in
  `tests/marketing-motion-sitewide.test.ts`.
  - **Browser check on a local production build:** at 390x844, 1366x900 and
    `?lang=ar` at 390, each with no preference and with emulated reduce
    (switch `"always"`), the sweep runs once (420 ms after a 120 ms delay).
    By 1.5 s it is at rest (`scale: none`, fill `#d5f24a`, word `#171917`),
    with load CLS 0 and no page errors: 6 of 6 passed.
  - **LCP with the sweep, same script, 10 cold loads per width:**
    - 390x844 (the lede): 400/340/364/324/340/444/428/324/460/460 ms,
      median 400 ms;
    - 1366x900 (the H1): 436/448/548/580/572/564/524/524/444/424 ms,
      median 524 ms.
    - Both are below the 22 October "before" medians (656 and 756 ms) on
      the same script and machine type, so the earlier +192 ms was noise
      from machine load.
  - **Node tests:** the 12 marketing and motion files, 123 passed, 0 failed.

## Budget and checks

Budget, measured in local Chromium with the CPU throttled 4x against a build
of `c856d9d` (the release before the motion work): LCP within max(50 ms, 5%)
of base with the same LCP element, CLS no worse than base on load and while
scrolling, no more long tasks while scrolling than base, blocking time on load
no gross regression (base + max(100 ms, 25%)), and the reveal's own work under
50 ms.

**Since 28 October 2026 (phase 1 of the marketing revamp).**
- **Absolute budgets for the four redesigned pages.** In the sitewide check, `/`, `/trainer-brain`, `/demo` and `/pricing` no longer compare with `c856d9d` (`REDESIGNED`, `BUDGETS`). The budgets were set from measurement:
  - LCP of 2.5 s or less, on the H1 or the lede;
  - CLS of 0.001 or less;
  - at most 2 long tasks while scrolling;
  - blocking time on load of 600 ms or less.
- **Pages and rules.**
  - `/trainer-brain` and `/demo` joined the check's default pages.
  - Showcases are left out of its hidden-text rule.
  - The relay and commission-pill checks went with that code.
  - The `/?scenes=on` frame-loop pass reports "no scene on /" and is skipped, because the scenes are parked.
- **The journey check** runs on `/how-it-works` only.
- **`tests/marketing-motion-sitewide.test.ts`:**
  - the motion corpus also reads the four page sheets, and a sheet needs reduced-motion rules only if it declares an animation or a transition;
  - `NEVER` holds the showcases, and `SPRING_ALLOWED` gains `.mk-tb-stamp`;
  - the first-paint test reads the hero from `pages/home.tsx`;
  - the relay, pills and `/demo` entries went with their code.
- **The showcases' own frame and layout budgets** are in [brain-showcase.md](brain-showcase.md), with their check, `npm run test:marketing-showcase`.

- `tests/marketing-journey.test.ts`: captions are the registry's steps in the
  same list; the HowTo JSON-LD is unchanged; every subscriber line resolves and
  follows its visible label; the launch gate; the home band (no heading, no
  words in its stage, its subscriber line; since 28 October 2026, that the
  journey is absent from `/` and unchanged on `/how-it-works`, and that the
  home walkthrough's tabs equal the step titles); no AI cost, fee, model name,
  amount or count in the mocks; the new-word list; the address from the
  platform; the tokens; motion hygiene of the stylesheet; the island imports
  only React and no dependency was added.
- `tests/marketing-motion-sitewide.test.ts`: the sitewide motion rules
  (animated properties, token durations and easings, hover media, reduced
  motion, nothing hidden without `.mk-motion`, tokens defined once), and the
  switch: one constant rendered only on the marketing root and the assistant
  host, every marketing reduced-motion rule kept and scoped, no
  no-preference wrapper left, the Talk button's press in both modes, the
  scripts' reduced-motion reads gated on `"device"`, the journey clock's
  fallback, and equal reduced-motion tests in the two scenes scripts that
  never read the switch. Since the concept pass also: the new tokens and
  their values (each `--mk-stagger` resolved through its token, the longest
  equal to `MAX_STAGGER`), the enter curve's allow-list, motion distances as
  tokens, the cues and grids in `motion.tsx`, the pills, FAQ, nudge and tick
  rules, the hero hand-off after the relay's last tick and over by 3 s, and
  the home hero's render-blocking `rel=expect` on the relay's caption.
- `npm run test:marketing-motion` (`scripts/run-marketing-motion-checks.mjs`)
  runs both browser checks (local Chromium only):
  - the journey (`scripts/run-marketing-motion-check.mjs` and
    `scripts/marketing-motion-check.mjs`, a stub platform API, 360x740,
    390x844 and 1366x900): the gate, auto-play and holding, keyboard and
    mouse behaviour, the icon staying visible, focus at either end, the
    active card in view, the sample-data label, the mocks' text size against
    the frames' real widths, phones, reduced motion (by the switch: with
    `"always"`, under the device setting and separately the member's
    cookie, auto-play from half the stage in view and every hold), no
    JavaScript, no layout shift (also on the home band), stage text contrast
    (AA) and size (11 px or more) in every chapter in either mode (with
    `"always"`, under the device setting at each width: each chapter chosen
    from the keyboard, sped up 20x, read once its beats have finished and
    again as its complete picture, both sides on phones), right to left
    (paused first with `"always"`);
  - the sitewide check (`scripts/marketing-motion-sitewide-check.mjs`): both
    builds read the same platform stub with the launch gate open (so `/` and
    `/how-it-works` are measured with the player; `MOTION_PLATFORM=closed`
    for the fallback platform), with `MOTION_BASE_DIR` pointing at a built
    checkout of the base. Reduced motion follows the switch, under the
    device setting and separately the member's cookie: with `"always"`,
    `.mk-motion`, the reveals, the settle, a FAQ unfolding, the menu, the
    relay at rest by 5 s and the journey's auto-play, plus timed cold loads
    of that cohort (`MOTION_REDUCED_RUNS`, default 3) that must keep CLS 0
    and the reveal's own rules, compared (reported, not judged) with the
    same cohort on `MOTION_MAIN_DIR` (main before the switch) and the base.
    `/?scenes=on` controls: scenes before the first paint without reduced
    motion, none under either source. The concept pass (untimed, both
    widths, without reduced motion, with `"always"` under the device setting
    and separately the member's cookie, and in Arabic at 390): the pills
    wait for their own trigger at the inline start and load 80 ms apart on
    the enter curve, the FAQ rows 40 ms apart, the closing nudge 280 ms
    after its button enters, the hero hand-off from 2.53 s and at rest by
    5 s on its own timeline (its direction is read only afterwards, on a
    replay), both arrows toward the reading direction, the set ticks hidden
    until the set table's own trigger at every width and then at 520 and
    600 ms (a missing measurement fails), no sideways overflow.
- `npm run test:brand` and `npm run test:browser` cover the pages with the
  gate closed (their platform has every provider off). The brand check's
  "motion /" (and "reduced motion /" with `"always"`) also requires the
  hero's hand-off and its arrow at rest after 5 s.

### Results after the second review (29 September 2026, this machine)

The machine is a shared 4-core container; other jobs ran during these
measurements (load average up to 10), and identical loads vary by 100 ms or
more at 4x throttling, so five-run medians can move by more than the 50 ms
allowance on their own.

- `npm run test:marketing-motion` with `MOTION_BASE_DIR` set to a `next
  build` of `c856d9d`: exit 1. The journey half passed 181 of 181 checks.
  The sitewide half passed every rule of its own (nothing on the first
  screen waited, nothing hidden after a scroll-through or without
  JavaScript, reduced motion ran and settled nothing, no long task while
  scrolling, the reveal's setup at most 3.4 ms and its slowest callback
  16.9 ms, CLS 0 except 0.0005 on two of five home loads at 1366, inside
  the 0.001 allowance). It failed ten comparisons with base, with the gate
  open: LCP at 390 `/how-it-works` 456 (336), `/pricing` 408 (348),
  `/features` 700 (608), `/earnings-calculator` 372 (288), and at 1366 `/`
  524 (468), `/how-it-works` 556 (444), `/features` 724 (672) ms; blocking
  time on load at 390 `/how-it-works` 348 (242) and at 1366 `/` 629 (465)
  and `/how-it-works` 366 (262) ms. Three of the LCP failures are pages
  without the player, whose base medians in this run were 60 to 100 ms
  faster than in any other run.
- `perf.json` (seven cold loads per build, page and width, alternating,
  gate open), medians new (base): LCP at 390 `/` 424 (416),
  `/how-it-works` 424 (368), `/pricing` 412 (440), `/features` 688 (628),
  `/earnings-calculator` 320 (356), `/demo` 408 (296); at 1366 `/` 432
  (452), `/how-it-works` 480 (444), `/pricing` 444 (436), `/features` 816
  (724), `/earnings-calculator` 432 (456), `/demo` 400 (356) ms. Total
  blocking time after first paint at 1366: `/` 292 (126), `/how-it-works`
  35 (0) ms; at 390: `/` 321 (246), `/how-it-works` 155 (173) ms. CLS 0
  everywhere. Before this review the same measurement had 1366
  `/how-it-works` at LCP 528 (420) and blocking 201 (0) ms, and 1366 `/` at
  blocking 353 (154) ms.
- So the player still costs the home page about 80 to 170 ms of blocking
  time and `/how-it-works` up to about 60 ms of first paint at 4x
  throttling (roughly a quarter of that unthrottled): the budget is not met
  on those two pages, and the owner has to accept that or ask for a lighter
  stage.

### Results, concept pass (22 October 2026, this machine)

Run on this tree after `npm run build`, against a local production server
(`next start` with a platform stub, launch gate open), local Chromium only.
No timed comparison was run for this pass.

- `node --import tsx --test` on `tests/marketing-motion-sitewide.test.ts`,
  `tests/marketing-journey.test.ts`, `tests/motion-css.test.ts`,
  `tests/member-motion.test.ts`, `tests/rtl-layout.test.ts`,
  `tests/marketing-site.test.ts`, `tests/logical-css.test.ts`,
  `tests/analytics-consent.test.ts`, `tests/brand.test.ts`,
  `tests/marketing-frontier.test.ts` and `tests/marketing-assistant.test.ts`:
  113 passed, 0 failed. Two new tests in the sitewide file (the concept
  pass, and the hero's render-blocking link); the token list in
  `marketing-journey.test.ts` grew by the new tokens (the new contract).
- `npx tsc --noEmit -p .` and `-p apps/web/tsconfig.json`: clean.
  `npm run build`: passed.
- The layout shift: the proxy that holds the HTML before the hero's last
  line gave 0.00218 on `/` at 1366x900 under reduced motion and without it
  before the fix (source `div.mk-hero-body`, 189+163 to 154+198) and 0 after
  it for reduced motion, the member cookie and no preference at 1366x900
  and 390x844; with the hold before the lede instead, 0 as well. Without
  the proxy, one of roughly 75 ordinary loads of the Phase 1 build
  reproduced it (reduced motion, 1366x900, CPU throttled 4x).
- A targeted Playwright verification (390x844, 1366x900, `?lang=ar` at 390,
  and emulated reduced motion at both widths with the switch at
  `"always"`): 116 passed, 0 failed. Nothing on the first screen waited,
  the hero's CTA and H1 were opaque and unmoved, CLS on load 0 on `/` and
  `/features`; the hero hand-off had a 2550 ms delay and 420 ms, peaked at
  3 px (-3 px in Arabic) and was at rest after the relay; the pills waited
  at -16 px (16 px in Arabic) while their band had already revealed (390),
  then loaded at 0, 80, 160 and 240 ms on `cubic-bezier(0.2, 0.8, 0.2, 1)`;
  the home FAQ rows at 0 to 240 ms, 40 apart, and the `/pricing` FAQ unit
  heading-first; the closing panel revealed while its button, below the
  fold line, waited with no nudge, then the nudge ran at 280 ms for 420 ms
  toward the reading direction and was at rest by 700 ms; the `/features`
  set ticks at 520 and 600 ms at 1366 (at 390 the section is too tall to
  wait, as before); no sideways overflow, nothing waiting after a
  scroll-through, no infinite animation, no page errors.
- The sitewide check's new concept measurement, run alone with the check's
  own page setup against the same server (390 and 1366, no preference,
  reduced motion, Arabic at 390): 0 failures.
- Not run in this pass (left for the single full run): `npm run
  test:marketing-motion`, `npm run test:brand`, `npm run test:rtl`, `npm run
  test:phone` and `npm run test:motion`.

### Results, Phase 3 (22 October 2026, this machine)

Phase 3 made the home page's scroll-scenes engine event-driven, with an idle
stop (`docs/features/scroll-scenes.md`, "The frame loop", which also has that
part's own results). The Pace sweep was measured and left out then, and shipped on 23 October
(see "The Pace sweep behind "trains"" above). The tree was run after `npm run build`
against a local production server, in local Chromium only.

- **Node tests:** 121 passed, 0 failed. The files were
  `tests/scroll-scenes-engine.test.ts` (new, 8 tests),
  `tests/marketing-motion-sitewide.test.ts`, `tests/marketing-journey.test.ts`,
  `tests/motion-css.test.ts`, `tests/member-motion.test.ts`,
  `tests/rtl-layout.test.ts`, `tests/marketing-site.test.ts`,
  `tests/logical-css.test.ts`, `tests/analytics-consent.test.ts`,
  `tests/brand.test.ts`, `tests/marketing-frontier.test.ts` and
  `tests/marketing-assistant.test.ts`.
- **Typechecks and build:** `npx tsc --noEmit -p .` and
  `-p apps/web/tsconfig.json` were clean, and `npm run build` passed.
- **Scrubbing:** all 126 sampled positions were identical between the old
  and new engines.
- **Targeted verification:** 58 passed, 0 failed. It covered 390x844,
  1366x900, `?lang=ar` at 390, and emulated reduced motion at both widths
  with the switch at `"always"`.
- **The sitewide check's new frame-loop rules,** run alone: 0 failures.
- **The LCP comparison for the sweep:** the table above. It was the only
  timed run.
- **Not run** (left for the single full run): `npm run test:marketing-motion`,
  `test:brand`, `test:rtl`, `test:phone` and `test:motion`.
