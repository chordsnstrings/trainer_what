# Concept A "Live Brain": builder guide

Read this before you write a page. Home (`/`) and pricing (`/pricing`) are finished and set the bar: open `site/index.html` and `site/pricing.html`, and read `src/pages-core.mjs` as the worked example of every helper below.

Spec sources: `../research-final.md` (C0 sitewide rules, C<n> for your pages, section D shared motion, Concept A spec lines 1243-1337) and `../content.json`.

## 1. Commands

```
N=/opt/nvm/versions/node/v24.22.1/bin/node
$N src/build.mjs                                # writes all 42 pages into site/
$N src/check.mjs demo how-it-works              # 390x844 + 1366x900: console errors, overflow, screenshots
$N src/check.mjs --widths=360,768,1024,1600 demo
$N src/check.mjs --sections demo                # also one PNG per <main> band and the footer
$N qa/expected.mjs                                # expected calculator figures from the real packages/domain module
$N qa/crawl.mjs                                   # full QA: 42 pages x 360/390/1366, keyboard, reduced motion -> qa/report.json, shots/qa/
$N qa/crawl.mjs --widths=768,1024,1600 --skip-tab --skip-rm   # layout/overflow/contrast at the other widths
```

Screenshots land in `shots/<file>-<width>-{top,full,sNN}.png`. Look at them (Read the PNG). A page passes only with no console errors and `scrollWidth == viewport` at every width. Element screenshots show the sticky header and sticky CTA overlapping a band; that is the screenshot method, not a bug.

## 2. File contract (who owns what)

| File | Owner | Pages |
|---|---|---|
| `src/pages-product.mjs`, `assets/product.css`, `assets/product.js` | product builder | `/how-it-works`, `/trainer-brain`, `/features`, `/features/*` (11), `/demo`, `/security-and-privacy` |
| `src/pages-audience.mjs`, `assets/audience.css`, `assets/audience.js` | audience builder | `/for-trainers`, `/for-trainers/*` (4), `/uae`, `/get-started`, `/signup`, `/login` |
| `src/pages-money.mjs`, `assets/money.css`, `assets/money.js` | money builder | `/earnings-calculator`, `/follower-calculator` |
| `src/pages-content.mjs`, `assets/content.css`, `assets/content.js` | content builder | `/guides`, `/guides/*` (4), `/faq`, `/about`, `/methodology`, `/terms`, `/privacy`, `/ai-disclosure`, `/coaches`, `/404` |
| `src/pages-core.mjs`, `assets/core.css`, `assets/core.js` | foundation | `/`, `/pricing` |

`<group>.css` and `<group>.js` load only on that group's pages (after `site.css` / `site.js`). Any path you leave out of your map renders a visible dashed "Not built yet" stub.

**Do not touch:** `src/build.mjs`, `src/registry.mjs`, `src/layout.mjs`, `src/components.mjs`, `assets/site.css`, `assets/site.js`, `assets/calc.js`, `assets/core.*`, the logo SVGs. Need a change there? Put the request in your report. You may add `import` lines for helpers you use, and you may add new helper functions inside your own module.

## 3. Render contract

```js
// src/pages-<group>.mjs
import { band, sectionHead, cta, button, decisionConsole /* … */ } from "./components.mjs";

export const pages = {
  "/demo": (ctx) => ({
    main: [hero(ctx), scenarios(ctx), faq(ctx)].join("\n"), // inner HTML of <main>: bands only
    // optional:
    title: "…",                 // default: `${page.title} · trainsyou`
    description: "…",           // default: page.description
    closing: { secondary: { label: "See how it works", path: "/how-it-works" } }, // or false (no closing panel)
    js: ["calc.js"],            // extra assets/ scripts, loaded before <group>.js
    css: [],                    // extra assets/ stylesheets
    bodyClass: "",
  }),
};
```

`ctx = { page, content, href, pages }`:
- `page` is the registry entry: the content.json page plus `file`, `module`. The extra pages (`/signup`, `/login`, `/coaches`, `/404`) have `title`, `h1`, `description`, `kind`, and `noindex` where it applies.
- `content` is the whole of content.json; `pages` is all 42 registry entries; `href(path)` gives the flat link.

The layout adds everything else: the head (fonts, favicon, flags boot script), the header with desktop nav and mobile sheet, the closing panel, the footer, the sticky mobile CTA, the consent bar, Kamran (floating on desktop), and the dev panel.

**Closing panel:** on by default. The default secondary is `page.cta` when that is not a sign-up link, otherwise "Try the demo" (on `/demo`, "See how it works"). Pass `closing: false` only on `/signup` and `/login`.

**Links:** always use `href("/path")`, `link()`, `textLink()` or `button()`. Never hand-write `.html` names. The mapping is `/` → `index.html` and `/features/nutrition` → `features--nutrition.html`; `?query` and `#hash` are kept. External links need `target="_blank" rel="noopener"`; `link()` adds both for `http(s)` URLs.

## 4. Page conventions (all pages)

- **Hero:** `<section class="band band-white hero" data-hero aria-labelledby="hero-h">` with `.wrap.hero-grid`, `.hero-copy` (5 columns) and `.hero-media` (7 columns). `data-hero` is what the sticky phone CTA waits on. Never put `data-reveal` on anything in the first screen.
- **One H1,** 8 words or fewer, no colon. Use `h1WithMark(text, word)` only where the blueprint gives a highlight word.
- **Kicker** above the H1 (`<p class="kicker">`) holds the eyebrow. Write it in sentence case; CSS uppercases it.
- **Primary action:** always `cta({ location })`, never a hand-made button. It carries the registration-closed wording and its link. Secondary actions use `button(path, label, { location })`.
- **Hero micro line:** `ctaMicro()` under the hero CTA row (`ctaMicro({ short: true })` elsewhere).
- **Bands:** `band({ tone: "white" | "paper", id, cls, label: "<h2 id>" }, inner)`. Alternate paper and white; two white bands in a row get a hairline automatically. H2 6 words or fewer, via `sectionHead()` or a plain `<h2 id>`.
- **Honesty:** every AED headline gets a chip (`notOnYet("payments", "subscriber payments")` or `flagChip`). Every market figure gets `sourceBadge(id)`. Every mock gets `sampleLabel()` (the sample trainer is "Layla Strength"). An owner decision that is still open gets `pendingTag("… (decision N)")`. Never invent counts, quotes, logos or results.
- **Copy:** section C copy first, content.json for the rest; "your AI", never "the AI", in headings. Keep the word budgets (card body 18, FAQ answer 45, lede 25).
- **Phones (≤760 px):** the header shows the logo and menu only. The CTA lives in the hero, the sticky bar and the closing panel. Kamran sits inline: add `kamranPill()` inside your FAQ band, in a `<div class="kamran-inline-m">` wrapper (shown on phones only); the closing panel already has one.

## 5. Helpers (`src/components.mjs`)

Text arguments are escaped. Arguments named `html` or `inner` are inserted raw.

| Helper | Returns / example |
|---|---|
| `esc(s)` | escaped text |
| `link(path, label, { cls, attrs })` | `<a>`; external URLs open in a new tab with `rel="noopener"` |
| `icon(name, cls)` | inline SVG: `arrow chevron check x plus minus replay external dot lock` (arrows mirror in RTL) |
| `cta({ location, size: "sm"\|"lg", block })` | the one primary CTA, "Teach your AI — free" → `signup.html` |
| `ctaMicro({ short })` | the micro line, with its registration-closed variant |
| `button(path, label, { location, variant: "secondary"\|"ghost"\|"primary"\|"ink-ghost", size })` | secondary action (`ink-ghost` sits on Pace) |
| `textLink(path, label)` | underlined link with an arrow that nudges on hover |
| `band(opts, inner)` | `<section class="band band-…"><div class="wrap">…` |
| `sectionHead({ kicker, title, lede, id, layout: "stack"\|"split", level, reveal })` | section header; `split` puts the lede on the right on desktop |
| `h1WithMark(text, word, { id })` | H1 with the Pace sweep on `word` |
| `chip(label, tone)` | tones `live soon neutral sample estimate applied toyou paused` |
| `flagChip(flag, onLabel, offLabel = "Not on yet")` | a chip that follows a dev flag (`payments`, `payouts`, `voice`, `publish`, `frontier`) |
| `offeringChip(page)` | feature chip from `page.offering` and its **core** availability: WHOOP, Zepp, Instagram and custom domains never decide it (the Progress chip fix) |
| `notOnYet(flag, what)` | "Not on yet: subscriber payments"; hidden when the flag turns on |
| `sourceBadge(id, { label })` | "Source →" to `methodology.html#<id>`; throws on an unknown id |
| `estimateLabel()`, `sampleLabel(text)`, `pendingTag(text)` | the proof labels |
| `constraintList({ title, items, id })` | "What your AI never does"; defaults to the 4 `/trainer-brain` never-bullets |
| `founderNote()` | placeholder until decision 2 |
| `statusPanel({ id, level, title })` and `STATUS_ITEMS` | "Live today / Not on yet"; items move between the columns with the flags |
| `faqList(faqs, { prefix, level })` | accordion; `faqs: [{ q, a, id? }]` |
| `withFrontier(faqs, path)` | adds the frontier-flag answers and questions from `content.availabilityLines` (use it on `/faq` and `/trainer-brain`) |
| `frontierBullets(path, sectionId)` | extra `<li>`s shown only with frontier on (`/trainer-brain` "learns") |
| `frontierBody(path, sectionId, title, fallback)` | both wordings for a step (`/how-it-works` "You correct, it learns") |
| `vx(text, ch, { cls })` | live value slot; update it with `ty.swap()`. `ch` reserves width so nothing reflows; use 0 inside sentences |
| `swapPair(from, to)` | two-state text for scripted vignettes (`.vs-a` / `.vs-b`) |
| `lanePill(label, tone, { to })` | lane pill: `applied toyou paused wait`; with `to`, a scripted pill that slides 12 px |
| `phoneFrame(inner, { cls, label })` | phone device (ink frame, 28 px radius, 8 px bezel, status bar) |
| `windowFrame(inner, { title, meta, cls })` | trainer workspace window (12 px radius) |
| `appHead({ name, initials })` | the sample subscriber-app header with a Sample chip |
| `decisionConsole(opts)` | **signature component**: phone plus trainer panel, one decision plays once. Options: `id, message, ruleSource, rule, confidence, threshold, laneFrom, laneTo, tone, day, rows: [{ name, sets, from, to? }], outcome: [label, from, to], autoplay, caption, cls` |
| `ruleBuilder({ id, rir, lift, base })` | "Change the rule": 2 fields, or 3 with `rir: true` (the `/demo` version) |
| `thresholdSlider({ id, confidence, value })` | "How sure must it be?" (60-95%) against the sample decision at 86% |
| `stepperField({ name, value, min, max, step, label, unit, ch, suffix })` | 44 px stepper with a crossfading value (`role=spinbutton`) |
| `walkthrough(steps, { id, label })` | visitor-controlled stepper (ARIA tabs plus previous/next); `steps: [{ title, body, chip? }]` |
| `addressPreview({ id })` | AddressPreview: "Claim this address" → `signup.html?slug=` |
| `kamranPill()` | "Talk to Kamran (AI voice)" inline pill |
| `dataTable({ caption, columns, rows })` | table; a cell may be `{ html }`; the first cell is a row header |
| `statementLines([{ label, value, tone: "minus"\|"total"\|"muted" }])` | statement mock rows (mono figures) |
| `relatedLinks(paths, { title })` | quiet link row; drops `/coaches` |
| re-exports | `content, href, sourceById, PAGES, pageByPath, fileFor` |

Example: a specialty console that pauses for pain.

```js
decisionConsole({
  id: "pp-console",
  message: "Some pelvic pain after yesterday's walk.",
  rule: "pregnancy · any pain → pause, ask trainer",
  confidence: 99, threshold: 80,
  laneFrom: "Checking your rule", laneTo: "Paused, sent to you", tone: "paused",
  rows: [{ name: "Walk", sets: "30 min", from: "Today", to: "Paused" }, { name: "Mobility", sets: "10 min", from: "Today" }],
  outcome: ["Today · Walk", "Planned", "Paused"],
});
```

## 6. Class vocabulary (`assets/site.css`)

- **Tokens:** `--white --ink --ink-2 --paper --paper-2 --muted --line --pace --pace-wash --success --warning --error`, lane pairs `--applied-fg/bg --toyou-fg/bg --paused-fg/bg`, eases `--ease-out --ease-in --ease-inout --ease-enter --ease-spring`, durations `--d-press 80 --d-fast 140 --d-base 200 --d-slow 280 --d-emph 420`, `--stagger-1 40ms --stagger-2 80ms`, spacing `--s1…--s9` (4…96), radii `--r-ctl 6 --r-panel 8 --r-chip --r-phone 28 --r-window 12`, `--shadow-device` (devices only), `--shadow-float` (popovers only), `--dots` (24 px dot grid; use `.dots` behind product frames only), and `--m`, the motion distance multiplier. **Multiply every translate by `var(--m)`**, as in `translateY(calc(12px * var(--m)))`.
- **Type:** `h1 h2 h3 .lede .kicker .sec-lede .body-l .small .muted .note .mono .num .prose`. Mono (JetBrains Mono) is for rules, timestamps, %, kg and AED inside product UI and data lists only.
- **Hero:** `.hero .hero-grid .hero-copy .hero-media .hero-ctas` (the kicker gets a Pace square).
- **Layout:** `.wrap` (the container with safe-area gutters), `.grid` (12 columns), `.split` with `.s-copy` (5) and `.s-media` (6); `.split-flip`; `.cols-2 .cols-3 .row .stack-s/m/l .mt-s/m/l`; `.band .band-white .band-paper .band-tight`.
- **Actions:** `.btn .btn-primary .btn-secondary .btn-ghost .btn-ink-ghost .btn-sm .btn-lg .btn-block .tlink .cta-row .micro`. Hovers are already inside `@media (hover: hover)`; keep yours there too.
- **Objects:** `.card` (hairline, no shadow) and `.card-paper` only where the spec calls for an object; `.rule-top` (an ink rule above a column); `.fact .fact-figure`; `.related`.
- **Product UI:** `.device .phone .phone-screen .window .window-bar .window-body .app-head .app-chat .bubble .bubble-out .bubble-in .app-plan .plan-row .app-tabs .rule-chip .rule-src .rule-text .conf* .lane-pill[data-tone] .tick .console*`.
- **Widgets:** `.rule-builder .rb-* .stepper* .threshold .th-* .walk* .tab-ink .tabs-list` (a plain tablist with an underline), `.faq*`, `.field .input .input-affix .affix .address* .hint`, `.table-wrap .table`, `.stmt .stmt-row .stmt-total .stmt-muted`, `.calc .calc-inputs .calc-result .calc-head .calc-figure .calc-sub .calc-lanes .calc-lane .calc-lane-label .calc-lane-bar .calc-lane-val .calc-foot .calc-form .calc-figure-line .calc-upto .fc-cta` (console-styled result; scenarios as lanes; `.calc > .fc-cta` sits under the inputs on desktop and after the result on phones). Copy the structure of `followerMini()` in pages-core.mjs.
- **Status and proof:** `.status* .never* .founder* .chip* .source-badge .sample-label .pending-tag .status-strip` (the one-line "Not on yet → What works today" strip under a hero; wrap it in `data-show="payments:off"`).
- **Flags:** any element with `data-show="payments:on|off"`, `registration:open|closed`, `frontier:on|off`, `voice:on|off` or `publish:on|off` hides automatically for the other state.
- **Utilities:** `.sr-only .nowrap .center .hide-m .only-m`.

## 7. Motion (section D plus the Concept A spec)

- **Reveal, below the fold only.** Put `data-reveal` on a unit (it fades in with a 12 px rise, 280 ms), or `data-reveal="stagger"` on a list whose children carry `class="ri"` (40 ms stagger, at most 6 items). site.js adds `.reveal-pending` only to units that start below the first viewport, and reveals each once at 15% visibility. Never mark hero content.
- **Value changes:** render with `vx(text, ch)`, then `ty.swap(slotEl, "AED 2,985")`, a stacked crossfade with a 4 px rise. Put the pair in a fixed `ch` slot and use tabular figures. No count-ups.
- **Outcome flash** (hero step 3: a Pace wash plus the tick redraw): wrap the row in `.flash`, include the tick SVG, and call `ty.flash(el)`.
- **Scripted vignettes** (one state change, played once): mark the element `data-state="start"` with `swapPair()` texts inside. Call `ty.play(el)` (sets `start`, then `done` on the next frame, and toggles `aria-hidden`). Write your own delays under `[data-state="done"] …` in group CSS; transitions are defined only on the `done` state, so replays reset instantly. A `[data-console][data-autoplay]` auto-plays 300 ms after `load` once 35% is in view; `[data-replay="<id>"]` buttons replay it.
- **Tabs:** any `[data-tabs]` that contains `[role=tablist]`, `[role=tab][aria-controls]` and `[role=tabpanel]` is wired automatically (roving tabindex, arrows, Home/End). `[data-walk-step="-1|1"]` buttons step through it. It fires `ty:tab` with `{ index, tab }`. The `--k` property on the tablist drives `.tab-ink`. For markup you insert later, call `ty.initTabs(el)` (and `ty.initStepper(el)` for steppers).
- **Disclosure:** use `faqList()`. Rows animate 0fr → 1fr in 280 ms and fire `faq_open`.
- **Page transitions:** automatic (root crossfade with an 8 px rise; the header and footer persist). The `.brain-console` morph runs only home → `/demo` and only when both consoles are in the first viewport, so **`/demo` must render its console with `decisionConsole()` near the top**.
- **Press and hover:** buttons scale to 0.97 on press. Hover is an instant colour change or an overlay's opacity, inside `@media (hover: hover)`. Arrows nudge 3 px.
- **Allowed properties:** transform and opacity (plus stroke-dashoffset for ticks, and grid rows for disclosures). No scroll-jacking, no pinned scenes, no loops.
- **Budget:** site.js plus core.js are about 9 KB gzip. Keep your group JS small: the motion total must stay at 12 KB gzip or less (calc.js is maths, not motion).
- **Reduced motion:** the owner's default `"always"` plays short motion as it is. The dev toggle "Reduce motion for OS setting" sets `data-motion="respect"`, which zeroes `--m` under `prefers-reduced-motion`. So if you used `var(--m)`, you have nothing more to do.
- **Replay hero:** the dev panel calls `window.tyReplayHero()`, which replays the mark sweep and the first `[data-console]`, then dispatches `ty:replay` on `document`. Listen for it if your hero animates something else.

## 8. Runtime API (`window.ty`, from site.js)

`ty.$ ty.$$ ty.on ty.swap(el, text) ty.flash(el) ty.announce(liveEl, text)` (debounced 500 ms, for `aria-live` regions), `ty.play(el) ty.setState(el, "start"|"done") ty.initTabs(el) ty.initStepper(el) ty.rangeFill(input) ty.fmt(n) ty.track(event, props) ty.store.get/set` (try/catch localStorage), `ty.flags()`, `ty.setFlag(k, v)`, `ty.slugFromName(name)`, `ty.inView(el, fraction)`.

`document` receives `ty:flags` (detail: the flags) on every change. `[data-stepper]` elements emit a bubbling `ty:change` event with `{ name, value }`.

**Tracking:** `window.tyTrack(event, props)` logs to the console with `concept`, `page` and `consent` attached. Wired automatically: `cta_click` on every `[data-cta]` (label and `data-loc`), `faq_open`, `demo_rule_edit`, `demo_threshold`, `address_typed` (length only), `kamran_start`/`kamran_end`, `consent_choice`, and `demo_play` on Replay. Any element with `data-track="<event>"` logs that event with its `data-*` values. You fire the rest from section B: `demo_play` (scenario tab clicks), `calc_input` (first per session) and `calc_result_view`, `share_self`, and `signup_view`/`signup_field_start`/`signup_submit`/`signup_error` (`has_slug`, `entry_page`, `error_type`).

**Maths (`assets/calc.js`, `window.tyCalc`; add `js: ["calc.js"]`):** an exact port of `packages/domain/src/marketing-calculators.ts`. `estimateFollowers(inputs)` returns `scenarios.{cautious,typical,strong}.{activeMonth12, month1New, signups12, revenueMonth12Minor, activeByMonth, newByMonth, visitors12, storyViewers}`. `estimateEarnings(inputs)` is the full earnings calculator (see `EARNINGS_DEFAULTS`). `compactEarnings(n, priceAed, yourRateAed)` is subscriptions only. Also `aed(minor)`, `whole(n)`, `pct(n, dp)`, `FOLLOWER_DEFAULTS`, `FOLLOWER_LIMITS`, `EARNINGS_LIMITS`, `BANDS`, `commission()`. It loads in Node too: `createRequire(import.meta.url)("../site/assets/calc.js")`, so compute first-paint figures at build time, as pages-core does. Checked results: 7,000 followers / AED 199 / 8 Stories gives 398 / 2,985 / 23,084. 150 × 199 gives commission 6,965 and keep 22,885.

## 9. Live state and flags

| Flag | Default (live facts) | Notes |
|---|---|---|
| `payments` | `off` | covers payouts, paid bookings and the payment-dependent chips |
| `publish` | `off` | the launch gate; publishing waits for payments |
| `registration` | `open` | `closed` turns every primary CTA into "Join early access — free" → `get-started.html#early-access` |
| `frontier` | `off` | use the fallback wording; the frontier lines come only through the `withFrontier`/`frontier*` helpers |
| `voice` | `off` | voice add-on for subscribers |

Model and nutrition count as live. WHOOP, Zepp, Instagram and custom domains are fixed "Not on yet".

## 10. Notes per builder

- **Product:** `/demo` is the signature page. It needs `decisionConsole` (4 scenarios as ARIA tabs; re-skin the console per tab with your own `data-state` vignette or by swapping texts), `ruleBuilder({ rir: true })` and `thresholdSlider()`. Typing dots appear on tab clicks only and are `aria-hidden`; "Scripted examples. No AI model is called." The `/how-it-works` stepper is the console in 8 states; reuse `walkthrough()` for its controls. On `/trainer-brain`, use `constraintList()`, `frontierBullets("/trainer-brain", "learns")` and `withFrontier()`. Feature pages: one vignette with one state change, plus `offeringChip(page)`.
- **Audience:** `/get-started` must have an element with `id="early-access"` (the registration-closed CTA target, a form that prevents default and shows an in-page result), a `statusPanel()` near the top, and `addressPreview()`. `/signup` reads `?slug=` and prefills the address. It fires the `signup_*` events, prevents default on submit, and shows an in-page result. Pass `closing: false` on `/signup` and `/login`. Specialty pages use `decisionConsole()` with that specialty's rule, with paused-list chips in the `paused` lane colours.
- **Money:** use `calc.js`; never re-derive a ratio. Use the `.calc` classes and the `windowFrame` result with the scenarios as `.calc-lane` rows. The follower headline is "Up to AED X a month at your price, before platform commission", labelled best case, with Typical and Cautious beside it. A `notOnYet("payments", "subscriber payments")` chip, `estimateLabel()` and `sourceBadge()` go beside every AED headline.
- **Content:** `/methodology` must render one element per source with `id="<source.id>"` (every `sourceBadge` links there), plus sections `id="follower-calculator"` and `id="earnings-calculator"`. Pricing links to `methodology.html#earnings-calculator`. The 404 page is the console line "No rule for this page. Handed to you:" with links. `/coaches` is the trainer-facing empty state (the registry marks it `noindex`; the footer hides it). Legal pages use a doc layout with a sticky table of contents (offset it with `top: calc(var(--header-h) + 16px)`).

## 11. Gotchas

- `data-show` uses `display: none !important`. Do not put it on an element that needs its own `display` toggled.
- The fixed bottom stack sets `--stack` on `<html>`, the height of the visible consent bar or sticky CTA. To float anything at the bottom, use `bottom: calc(var(--stack) + 16px)`.
- On phones, the footer reserves the sticky bar's height. Do not add bottom padding to `body`.
- Z-index scale: sticky CTA 30, consent 35, menu sheet 39, header 40, dev 45-46, Kamran popover 47. Stay below 30 in page content.
- Any `input[type=range]` needs `ty.rangeFill(input)` after you change its value from script (user input is handled).
- Keep generated HTML free of external URLs. Google Fonts is the only allowed origin, and it is already in the head.

## 12. Brain showcase (round 2, 27 Oct 2026)

Spec: `../showcase-final.md` (§2 Mission control, §5 playground, §1.5 honesty labels, §1.6 performance). Engine: `../shared/brain/` (read its README).

- **Engine copy:** `src/build.mjs` copies `shared/brain/*.js|*.css|traces.client.json` into `site/assets/brain/` on every build, then imports the page modules (they render engine markup in Node). Never edit `site/assets/brain/` by hand; change `shared/brain/` and rebuild.
- **Concept A files (authored in `site/assets/`):** `a-field.js` (Mission control field + home band 2 board; `renderStatic`, `renderBoard`, `mount`), `a-brain.css` (field + board, home only), `a-echo.css` (roster, decides, feature vignettes, path band, playground skin). `src/brain-a.mjs` holds the Node renderers for the product pages (`playground`, `playBand`, `roster`, `decides`, `featureEchoes`, `pathBand`, `boot`, `rosterScript`, `CSS`).
- **Mounting:** a showcase is `[data-showcase][data-sc-module="assets/…"]` with its static first frame inside; put `boot()` (the inlined `brain-boot.js`) last in `main`. One settings object per page (the field, board and receipts share it).
- **Where:** home hero = the field (phones: between the H1 and the lede by CSS order); home band 2 = "Change a setting. Watch it re-sort."; `/demo` and `/trainer-brain` = the playground (`/trainer-brain` also has the roster with status chips and the corrected "How it decides"); `/features` = node vignettes; `/how-it-works` = "One path for every moment" (static).
- **QA scripts (`qa/sc/`):** `serve.cjs <port>`, `shots.cjs` (timed sequence), `interact.cjs` (controls, zoom, keyboard, phone sheet), `pages.cjs` (overflow, LCP, errors), `rm.cjs` (reduced motion), `perf.cjs`/`perf2.cjs` (4× throttle), `stoptime.cjs` (first-screen timing), `geo.cjs` (phone geometry), `fallback.cjs` (Safari gaps). Add `?tier=full|lite|minimal`, `?motion=reduce`, `?recovery=on`.

### 12.1 Performance and QA decisions (QA pass, 27 Oct 2026)

Measured with `qa/sc/perf-all.cjs` (4x CPU via CDP, rAF-interval p95, long tasks, LCP, CLS, JS gzip), `qa/sc/correct.cjs`
(traces, caps/reset, labels, keyboard, pausing, reduced motion, RTL, playground), `qa/sc/crawl42.cjs` (42 pages x 390/1366)
and `qa/sc/idle2.cjs` (60/90 s idle pause, 75 s hour reset). Forensics: `trace4/trace6/mainframe/jsprof/inval/cls.cjs`.
Do not undo these without re-measuring:

- **Field layers.** Static rails are inline SVG drawn once per layout (an `<img>` became the LCP; a static canvas still
  costs a full-size copy per frame where Canvas2D is not GPU-backed). Everything that moves (rail dashes, dots, ghosts,
  rule lines, matrices) is ONE canvas above the nodes. Lines are cut at node/lane/message boxes in JS (`cut()`,
  Liang-Barsky); a canvas clip or a destination-out erase costs a full-canvas mask every frame.
- **Compositor-only CSS.** Field effects animate opacity/transform only; colour/border/shadow changes snap and their fades
  run on pseudo-element overlays (`a-brain.css`, "compositor-only motion"). One-shot effects replay through WAAPI
  (`replay()`), not `void el.offsetWidth`.
- **Auto-demo.** Level changes from the demo run at the start of a frame (`pre`) and use an estimated FLIP from DOM order
  (`flipEst`), so the frame has no forced layout. The board under the hero re-sorts only while on screen (catches up on
  arrival) and its live-region diff speaks only for a visitor's own change.
- **Tiers.** Minimal = DPR 1, 30 fps, no ghosts, no streaming, static rail dashes, ~6 fps redraw while nothing moves.
  Canvases re-fit on a tier change. The shared watchdog also steps down when >= 5% of frames exceed 25 ms over 2 s.
- **Phones.** The H1 is two fixed lines: inline `.h1-l` spans (`white-space: nowrap`) plus a phone-only
  `<br class="h1-br">`, at `min(9.6vw, 40px)`, so a late Inter swap cannot re-wrap it and shift the field (it caused
  CLS 0.21). Keep the spans inline: block spans made each line its own LCP candidate and the lede won LCP.
  JetBrains Mono loads after first paint (`media="print"` swap in `layout.mjs`).
- **Playground (shared):** "Change a setting" is `visibility: hidden` until the first run (`hidden` shifted layout).
- **Bug fixed:** the voice moment's second leg never left `fg`, so after two voice moments the playlist stopped (phones
  after the first). Field + sheet: Tab now cycles inside the phone settings sheet.

### 12.2 Creative-director pass (27 Oct 2026, after the owner's "no oomph" feedback)

Review scripts and shots: `../../cd-a/` (scratchpad). Decisions, do not undo without re-checking:

- **Whose moment lit this node.** Every node a narrated moment touches carries the member's initial (`data-who`, set in
  `setNode` from `WHO[owner]`; red on a STOP). Several lit specialists now read as several members, never one message
  with several AI specialists. The badge has no z-index on purpose: above the canvas (z 2) it would be composited.
- **Ghost energy (full and lite tiers).** Ghosts are 2.3 px at 85 % with a 70 ms tail; a node a ghost passes shows
  busy in paper (AI: sparkle 620 ms; code: column sweep 300 ms) with a fading outline; each ghost lands with a ripple in
  its lane colour. Pace stays reserved for the narrated moment. Legend item "Other members' moments" (desktop).
- **First frame.** Omar's "Picked: back squat +2.5 kg" bubble is gone from the first frame (it covered "Your Brain" and
  the Safety node during the stop); the lit Reply picker carries "O".
- **Desktop check rows.** Name on its own line, then matrix + result in the sans face ("cites your rule" no longer
  truncates, names no longer push the result out of the node). Confidence hides its matrix (the gauge is its activity).
- **Members column** 106 px with short labels ("Knee popped", "Up in weight?") in the sans face.
- **Learning card**: steps appear one by one (no reserved empty card); desktop it opens over the lanes (168 px), never
  over the rulebook spine. **Spine**: the new-rule card uses physical insets (logical insets followed its vertical
  writing mode and put it on top of "25 rules"); "Your method" hides while it shows.
- **Phones**: Confidence reads "86% · bar 80%"; the level summary is not repeated in the 2-line readout; the readout
  line is a cut box for moving lines; the Demo chip sits beside the segment.
- **Zoom header**: the legend hides while reading, "Paused while you read" stays on one line.
- **/how-it-works hero**: "How sure 86%" → "Confidence · plan 86% · your bar 80%" (it is a plan change).
- **Performance (4x CPU, this sandbox, no GPU)**: field JS work p95 3.1–3.8 ms; phones p95 16.8 ms; playground pages
  p95 16.8 ms; home at 1440 p95 33 ms with 5–9 % of frames over 20 ms, the same as before this pass (A/B against a
  baseline build). The slow frames are paint + layerization + commit (~14 ms at 4x), not script; `isolation` on the
  frame and clipping the message slot were tried and did not help.
