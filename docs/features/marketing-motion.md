# Marketing site motion

The owner asked: "marketing site should get microanimation revamp. And should
allow a UI animation that shows how the whole coach onboarding process will go
like and how that will translate to a subscriber. the whole workflow." This is
the reference for both parts: the sitewide microanimations and the
coach-to-subscriber journey player. The history of each part (storyboard
deviations, earlier measurements, the merge) is in
[marketing-site.md](marketing-site.md).

The house rules come from the home hero relay
(`apps/web/components/marketing/hero-flow.tsx`) and hold everywhere:

- Every word is real HTML and visible from the first paint. Motion is
  decorative, short and plays once; nothing is infinite.
- Reduced motion (`prefers-reduced-motion: reduce`) removes movement (instant
  or opacity only) and stops auto-play.
- No metrics, counts, revenue, count-ups or testimonials; only features that
  are available now; no AI cost, AI usage fee or model cost anywhere. The
  marketing text (`packages/contracts/src/marketing-content.ts`,
  `marketing.ts`) is never reworded or removed by motion work.
- The site stays always light with lime (Pace) accents; lime sits behind ink,
  never under muted text.
- CSS transitions and keyframes, IntersectionObserver and the Web Animations
  API only: no animation library, no new dependency. Only `transform`
  (`translate`, `scale`, `rotate`), `opacity`, SVG `stroke-dashoffset` and a
  disclosure's `grid-template-rows` animate; colour changes are instant.
  Nothing changes layout (no layout shift).
- A hidden-before-reveal state applies only after a script adds a class, and
  never to above-the-fold content or the LCP element.
- Hover effects sit inside `@media (hover: hover)`. Logical properties only
  (`tests/logical-css.test.ts`); arrows and slides flip with
  `var(--inline-sign)` in right to left.

## Tokens

Defined once, on the marketing roots `.mk, .mk-header, .mk-footer` in
`apps/web/app/marketing.css` (the same values as the subscriber app's motion
pass); every other stylesheet only uses them, and
`components/marketing/motion.tsx` keeps a copy in milliseconds for the Web
Animations API (a test keeps the two equal).

| Token | Value | Use |
| --- | --- | --- |
| `--mk-dur-press` | 80 ms | the press going down |
| `--mk-dur-fast` | 140 ms | small fades, menus opening, the press coming back |
| `--mk-dur-base` | 200 ms | slides, chevrons, link bars, swaps |
| `--mk-dur-slow` | 280 ms | rises, reveals, crossfades |
| `--mk-dur-emphasis` | 420 ms | the relay's wires and dot, the journey's dot and ring |
| `--mk-ease-out` | `cubic-bezier(0.2, 0, 0, 1)` | things arriving |
| `--mk-ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | things leaving, the press |
| `--mk-ease-in-out` | `cubic-bezier(0.4, 0, 0.2, 1)` | travel (the dot), taps |
| `--mk-ease-spring` | `cubic-bezier(0.34, 1.4, 0.64, 1)` | success states only (ticks, Reserved, Confirmed, Passed, Live, Applied and Rescheduled automatically, Approved, Paid) |

## What animates where (sitewide)

Code: `apps/web/app/marketing.css` (the motion block) and one island,
`components/marketing/motion.tsx` (`MarketingMotion`, rendering nothing).

| Where | Motion |
| --- | --- |
| Buttons (header and page) | Press `scale: .97` (80 ms in, 140 ms out) on every device; a 1 px lift and a 3 px arrow nudge only where the pointer hovers. |
| Single-line links (header, breadcrumbs, footer, `.mk-link`) | A 1 px ink bar slides in from the inline start on hover (200 ms), at once on keyboard focus. |
| Header | Its shadow fades in over the first 48 px of scrolling (scroll-driven, no script). Menus open with opacity and a 4 px rise; the phone menu drops in and its items rise 30 ms apart; "Menu" presses. No browser tap flash on the menu or any disclosure (`summary`). |
| Home hero relay | Wires draw (420 ms), the dot travels, the ticks pop (spring), one Pace ring behind the mark. Ends at 2.53 s. |
| Section reveal | Units wholly below the first screen at load rise 12 px and fade in once as they enter (280 ms); grid items follow 40 ms apart (at most 240 ms). Never the hero, breadcrumbs, page heading, relay, anything on the first screen, or the journey player. |
| Link cards and tiles | Lift 2 px with a soft shadow on hover; press `scale: .99`. |
| "You stay in charge" (home) | Once, when revealed: the message, your AI's card, the confidence meter filling, the lanes, "Applied automatically" (spring), the safety lane. About 1.1 s. |
| Disclosures (FAQs, calculator assumptions) | The chevron turns (200 ms); a FAQ answer unfolds through its grid row (280 ms) and fades in. |
| Calculators | No count-up. 150 ms after the last change the result settles (opacity .55 to 1 and 4 px, 200 ms); changed cells settle too. |
| /demo, /features, /get-started | The chosen decision rises and its label pops or stamps; the screens reveal 80 ms apart with their ticks; the checklist staggers. |

Reduced motion: the reveal script does nothing; `globals.css` stops element
animations and transitions; `marketing.css` stops pseudo-elements and the
details content box and removes lifts, presses and nudges. Without
JavaScript nothing is hidden.

## The journey player

Code: `components/marketing/journey.tsx` (server: the launch gate, the scenes,
the timings, both placements), `components/marketing/journey-player.tsx` (the
only client code, React only: the control bar, the chapter clock, the root's
data attributes), `apps/web/app/marketing-journey.css` (every journey style;
imported next to `marketing.css` in `app/layout.tsx`).

Placements, only while a coach can launch (registration open and the model,
payments and payouts providers available; otherwise the pages render exactly
as before):

- `/how-it-works`: the "Eight steps, start to finish" section. Its h2, its
  `ol.mk-steps` with the registry's titles and bodies unchanged, and the HowTo
  JSON-LD stay; the stage and the controls sit above the cards. Each card adds
  a visible "Your subscriber" label (the "Who does what" column header) and the
  step's subscriber line.
- Home: a band straight after the hero with the same stage without words
  (every word is a bar), the section heading as a small label, the active
  step's title, "Your subscriber" and the step's subscriber line, the
  controls and "See how it works".

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
- Reduced motion: no auto-play; chapters change instantly; Play runs a
  slideshow whose clock has no target, so nothing on screen moves.

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

## Budget and checks

Budget, measured in local Chromium with the CPU throttled 4x against a build
of `c856d9d` (the release before the motion work): LCP within max(50 ms, 5%)
of base with the same LCP element, CLS no worse than base on load and while
scrolling, no more long tasks while scrolling than base, blocking time on load
no gross regression (base + max(100 ms, 25%)), and the reveal's own work under
50 ms.

- `tests/marketing-journey.test.ts`: captions are the registry's steps in the
  same list; the HowTo JSON-LD is unchanged; every subscriber line resolves and
  follows its visible label; the launch gate; the home band (no heading, no
  words in its stage, its subscriber line); no AI cost, fee, model name,
  amount or count in the mocks; the new-word list; the address from the
  platform; the tokens; motion hygiene of the stylesheet; the island imports
  only React and no dependency was added.
- `tests/marketing-motion-sitewide.test.ts`: the sitewide motion rules
  (animated properties, token durations and easings, hover media, reduced
  motion, nothing hidden without `.mk-motion`, tokens defined once).
- `npm run test:marketing-motion` (`scripts/run-marketing-motion-checks.mjs`)
  runs both browser checks (local Chromium only):
  - the journey (`scripts/run-marketing-motion-check.mjs` and
    `scripts/marketing-motion-check.mjs`, a stub platform API, 360x740,
    390x844 and 1366x900): the gate, auto-play and holding, keyboard and
    mouse behaviour, the icon staying visible, focus at either end, the
    active card in view, the sample-data label, the mocks' text size against
    the frames' real widths, phones, reduced motion, no JavaScript, no
    layout shift (also on the home band), contrast, right to left;
  - the sitewide check (`scripts/marketing-motion-sitewide-check.mjs`): both
    builds read the same platform stub with the launch gate open (so `/` and
    `/how-it-works` are measured with the player; `MOTION_PLATFORM=closed`
    for the fallback platform), with `MOTION_BASE_DIR` pointing at a built
    checkout of the base.
- `npm run test:brand` and `npm run test:browser` cover the pages with the
  gate closed (their platform has every provider off).

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
