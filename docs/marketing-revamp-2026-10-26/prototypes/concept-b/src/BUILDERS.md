# Concept B "Beyond Your Hours": builder guide

Read this before you write a page. The home (`/`) and pricing (`/pricing`) pages in `src/pages-core.mjs` set the visual and motion bar; open `site/index.html` and `site/pricing.html` and copy their patterns.

Spec sources: `../research-final.md` sections C (your page's blueprint, the copy to use), D (shared tokens, transitions, reveal), Concept B (lines 1338-1421: per-page treatment for B) and E (owner decisions). Content: `../content.json` via `ctx.page` and `ctx.content`.

## 1. Files and ownership

| File | Owner | Builders may |
|---|---|---|
| `src/build.mjs` (dispatcher), `src/core.mjs`, `src/layout.mjs`, `src/components.mjs`, `src/pages-core.mjs` | foundation | import only (adding an import line to your own module is fine) |
| `site/assets/site.css`, `site.js`, `boot.js`, `calc.js`, `core.css`, `core.js` | foundation | not edit. Request changes in your report |
| `src/pages-product.mjs` + `site/assets/product.css/.js` | product builder | /how-it-works, /trainer-brain, /features, /features/*, /demo, /security-and-privacy |
| `src/pages-audience.mjs` + `audience.css/.js` | audience builder | /for-trainers, /for-trainers/*, /uae, /get-started, /signup, /login |
| `src/pages-money.mjs` + `money.css/.js` | money builder | /earnings-calculator, /follower-calculator |
| `src/pages-content.mjs` + `content.css/.js` | content builder | /guides, /guides/*, /faq, /about, /methodology, /terms, /privacy, /ai-disclosure, /coaches, /404 |

Build: `node src/build.mjs` (Node 24 at `/opt/nvm/versions/node/v24.22.1/bin/node`). It writes all 42 flat pages, prints which pages are still stubs, and fails on broken internal links. Check in a browser: `node tools/check.cjs page.html other.html` (screenshots to `shots/`; `SEG=1` adds full-page segments; `SIZES=390x844,1366x900` by default; `FULL=0` skips full-page shots). `node tools/interact.cjs` is the home/pricing smoke test; copy it for your widgets.

Your group's `.css` and `.js` load only on your pages, after `site.css` / `site.js` / `calc.js`.

## 2. Module contract

```js
// src/pages-money.mjs
export const pages = {
  "/earnings-calculator": (ctx) => ({
    main: `...`,                       // required: the <main> content
    closing: { secondary: { label: "Send this to myself", href: "#" } }, // or false to drop the closing panel
    // optional: title, description, sticky:false, kamran:true, bodyClass, head, styles:[file], scripts:[file]
  }),
};
```
A render function may return a plain string (the `<main>` HTML). The layout adds the head, header, closing panel (default title "Your coaching. Beyond your hours."), footer, sticky mobile CTA, consent bar and dev panel.

`ctx` = `{ path, file, group, page, content, C, h, href, esc, pageFor, registry, LIVE }`
- `page`: the content.json page (synthetic `{path, kind, title, description, navLabel}` for signup, login, coaches, 404).
- `h`: every helper below (`const { band, sectionHead } = ctx.h`), or import from `./components.mjs`.
- `C`: calculator maths (same file the browser runs). Use it for first-paint figures: `C.compactEarnings(150, 199).beforeOtherCostsMinor`, `C.estimateFollowerConversion(C.DEFAULT_FOLLOWER_INPUTS)`, `C.aed(minor)`, `C.whole(n)`, `C.pct1(n)`, `C.countLabel(n)`.
- `href("/features/nutrition")` gives `"features--nutrition.html"`; it keeps `?query` and `#hash`. Never hand-write `/path` links. External sources: `h.ext(url, label)` (new tab, rel=noopener).
- `esc(text)` for every content string you interpolate.

## 3. Helpers (all return HTML strings)

| Helper | Use |
|---|---|
| `hl(text, word)` | H1 with the Pace highlight: `<h1 id="h1" class="sweep">${hl(page.h1, page.h1Highlight)}</h1>` (span.mk-mark, never `<mark>`; `class="sweep"` plays the 420 ms fill once) |
| `eyebrow(text, {muted, plain})` | Archivo caps label with a rule |
| `sectionHead({eyebrow, title, id, lede, level, center, row, after, reveal})` | Section header, `.reveal` by default. `titleHtml`/`ledeHtml` for markup |
| `band({id, tone, labelledby, inner, narrow, tight, cls})` | Full-width section. `tone`: `white` (default), `paper`, `wash` (pace-wash, economics), `pace` (closing only) |
| `ctaRow({location, secondary:{label, href, button}, micro})` | The one primary CTA + a page secondary + micro line |
| `primaryCta({location, size:"sm", block})` | "Teach your AI — free" to signup.html; flips to "Join early access — free" when registration is off |
| `secondaryLink({label, href, location, button})` | Arrow text link (or outline button) |
| `microLine()` | "Free to join · Nothing to pay upfront · Nothing goes live until you publish" (registration-aware) |
| `chip(text, kind)` | kinds `ok`, `off`, `err`, `line`, `sample`, `pace`, `ink`, `plain` |
| `offeringChip(page.offering)` | Included / Optional tier / Add-on |
| `statusChip(flag, what)` | "Not on yet: what" (and "Live: what" when the flag is on). Flags: `payments`, `voice`, `publish`, `frontier`, `registration` |
| `statusPanel({id, foot})` | "Live today / Not on yet", flag-driven (home, pricing, get-started) |
| `statusStrip({href})` | One-line status under a hero, before any AED figure |
| `paymentsNote()` | Owner wording under every AED take-home figure: "Subscriber payments are not on yet. Set up and teach your AI now." |
| `sampleLabel(text)` | "Sample trainer · scripted" chip (or "Sample") |
| `estimateLabel()` | "Estimate, not a promise" |
| `srcBadge(sourceId)` | "Source →" to `methodology.html#<id>`; renders nothing for an unknown id (no badge, no figure) |
| `val(text, {out, w, cls, align, showPrice, attrs})` | A value slot that crossfades (or digit-rolls) when its text changes |
| `aed(n)` | "AED 199" with a no-break space (whole dirhams) |
| `numberField({label, in, value, min, max, step, suffix, help, sync})` | Calculator number input (`data-in`) |
| `rangeField({label, in, value, min, max, step, display, out, valuetext, sync, ends, w})` | Labelled range with live figure and `aria-valuetext` |
| `addressPreview({id, location, hint})` | AddressPreview, "Claim this address" to `signup.html?slug=` |
| `faq(items, {idPrefix})` | Accordion (answers closed, grid-rows disclosure, `faq_open` event). `items: [{q, a}]` or `{q, html}` |
| `phone({body, url, small, label, ariaLabel, rtl})` | Device frame (object, never a band). `label:false` hides the sample chip. `rtl:true` makes it the RTL-preview vignette |
| `offerScreen(price)`, `todayScreen()` | Sample Layla Strength offer page and subscriber Today screen |
| `windowFrame({title, body, cls})` | Trainer workspace window |
| `controlFlow()` | Subscriber message, your rule, 86%, three lanes |
| `constraintList({items, label})` | What your AI never does (default: /trainer-brain "never" bullets) |
| `statement({title, period, rows:[{label, value, sub}], total:{label, value}, note})` | Static sample statement with Sample + Not on yet chips |
| `stairs({here, labels})` | 25/20/15/10 staircase |
| `bandMeter(n)` | Four bands that fill with subscribers (`data-band-fill`) |
| `rateAxis(ratePct)` | Blended-rate marker on a 25% to 10% axis |
| `sessionMarks(n, ariaLabel)` | Static grid of session marks in tens |
| `takeHomeTile({subscribers, price, rate, name, title, vt, priceMin})` | B signature: price and subscriber sliders, our share, you keep (before card processing), band meter, chips, payments note |
| `walk(steps, {id, label})` | Visitor-controlled stepper (ARIA tabs, prev/next, progress line). `steps: [{title, body, chip}]` |
| `kamranPill({location, inline, float})` | "Talk to Kamran (AI voice)" |
| `table({caption, columns, rows, figCols})` | Data table; `figCols` get Archivo figures |
| `crumbs(page, pageFor)` | Breadcrumbs from `page.parent` |
| `icon(name)` | arrow, check, cross, pending, lock, plus, minus, chevron, prev, next, mic, info, faq, sliders, signal, battery |

## 4. CSS vocabulary (site.css)

- Tokens on `:root`: `--white --ink --paper --muted --line --line-strong --pace --pace-wash --keep --band-1..4 --success --warning --error`, radii `--r-control 10 / --r-card 16 / --r-tile 20 / --r-phone 32 / --r-chip`, spacing `--s-1..9` (4 8 12 16 24 32 48 72 112), `--section-y` (112 / 72 on phones), `--shadow-card`, `--shadow-raised`, easings `--ease-out/in/inout/enter/spring`, durations `--d-press 80 / --d-fast 140 / --d-base 200 / --d-slow 280 / --d-emph 420`, `--stagger-1 40 / --stagger-2 80`.
- Type: `h1`..`h4` or `.h1`..`.h4`, `.lede`, `.fine`, `.muted`, `.prose` (68ch measure for guides and legal). Archivo is for figures and eyebrows only: `.fig` (with `.fig-take` 36-96 px, `.fig-band` 28-56 px, `.fig-md`, `.fig-sm`), `.eyebrow`, `.keep` (green "you keep" figures only).
- Layout: `.container` (1240 + gutters 48/24/16, safe-area aware), `.container--narrow`, `.band(--paper|--wash|--pace|--tight)`, `.band-rule`, `.grid` + `.span-N`, `.split` (5/7), `.split--even`, `.split--center`, `.cols-2/3/4`, `.row`, `.stack`, `.page-hero` (inner-page hero), `.sec-head`.
- Objects: `.card` (`--flat`, `--paper`, `--raised`), `.tile`, `.statement`, `.phone`, `.window`, `.status`, `.status-strip`, `.tick-list` (+ `.never-list`), `.lanes/.lane`, `.meter`, `.bubble`, `.session-card`, `.app-icon`, `.addr-pill`.
- Controls: `.btn` (`--secondary`, `--ghost`, `--sm`, `--block`), `.link`, `.inline-link`, `.chip`, `.src`, `.field`, `.affix`, `.input`, `.check`, `.range`, `.pricer`, `.address`, `.table`, `.faq/.acc`, `.tabs/.tab/.tab-ind/.tabpanel`, `.walk`.
- Flag visibility (honest states): `.if-payments-on/-off`, `.if-reg-open/-closed`, `.if-frontier-on/-off`, `.if-voice-on/-off`, `.if-publish-open/-gated`. Render both variants; CSS shows the right one. Frontier copy: the content.json `availabilityLines` with `when: "frontier"` go inside `.if-frontier-on`; the fallback wording inside `.if-frontier-off` (live default).
- Light surfaces only. Pace is a background behind ink text, never text or a line colour on white. No ink bands; an ink element is a small object (a chip, a button).

## 5. Motion rules and utilities

- Page transition: automatic (cross-document View Transitions, direction-aware slide 16 px). Header and footer persist. Nothing to do.
- Shared element: home hero price tile to the earnings calculator result. Money builder: put `data-vt="price-tile" data-vt-from="index.html"` on the result tile (it morphs only when it is in the first viewport; boot.js handles it).
- Reveal-once: add `class="reveal"` to a block (a header, a card, a list) below the first screen. Add `data-stagger` to animate its direct children one by one (max 6, 40 ms). Never put `.reveal` on the hero or anything in the first screen; the script would skip it anyway. Keep reveal units smaller than about 5 screens (the observer needs 15% visible). Band fills inside a revealed block scale in automatically (`.band-track`, `.stair-bar`, `.strike`; set `style="--i:n"` for 80 ms steps).
- Values that respond to input: render with `val(...)`, update with `TY.setValue(el, "AED 1,234")`. It crossfades in 140 ms, or digit-rolls when the dev panel turns on decision 6. Give right-aligned standalone figures a fixed width (`w: "9ch"`); leave in-sentence values without `w`.
- Flash a settled value: `TY.flash(el)` on an element with class `flash` (pace-wash overlay, 420 ms).
- Announce results: one `<p class="sr-only" aria-live="polite" data-live></p>` per widget; `TY.announce(region, text)` (debounced 500 ms).
- Hero change after first paint: `TY.onHero((heroEl, replay) => { ... })` in your group js; put `data-hero` on your hero section. It runs 300 ms after load if the hero is in view, and again from the dev panel's "Replay hero". Only a change of state animates; the start state is complete HTML.
- Tabs: markup `role="tablist" data-tabs` + `role="tab"` buttons with `aria-controls` + `role="tabpanel"` panels (`.tab-ind` span for the sliding underline). Listen for `ty:tab` on the tablist. `TY.initTabs(list)` returns `{select(i), tabs}`.
- Stepper: `walk(steps)` is ready to use (`data-walk`).
- Accordion: `faq(items)` markup; no script needed.
- Animate only transform and opacity (plus stroke-dashoffset, clip-path, grid-template-rows for disclosures). Hover styles go inside `@media (hover: hover)`. No loops, no pinned or scroll-scrubbed scenes, no count-ups on load.
- Reduced motion: `MARKETING_MOTION = "always"` is the default (same motion for everyone). `html[data-motion="reduce"]` (dev panel, decision 5) removes translation; if you add a long or large motion, add a `html[data-motion="reduce"]` override in your group css.

## 6. Calculators (assets/calc.js)

The maths is a line-for-line port of `packages/domain/src/marketing-calculators.ts` and the commission bands. Never change a ratio. Bindings are declarative:
- Root: `data-calc="follower"` or `data-calc="earnings"` (+ `data-full` for the full earnings calculator with billing, nutrition, voice and sessions), `data-calc-name="earnings_page"` for events.
- Inputs: `data-in="followers|price|stories|reels|keywordDms|cancel|visits|members|links|views|engagement"` (follower) or `data-in="subscribers|billing|price|months|nutritionShare|nutritionPrice|voiceShare|voicePrice|sessions|sessionPrice|rate"` (earnings).
- Outputs (`data-out`): follower `cautious|typical|strong` + `.revenue|.active|.month1|.signups`, and `price`; earnings `subscribers, price, avg, revenue, commission, rate, keep, sessionsIncome, sessions, band.N.subs, band.N.commission`, plus `data-band-fill="0..3"` and `data-rate-marker`.
- After every update the root dispatches `ty:calc` with `{type, inputs, estimate}`; render anything extra (levers via `TYCalc.followerLevers(inputs)`, breakdown bars) from your group js.
- `data-sync="price"` on any price input carries the visitor's price across every widget on the page; `data-show-price="0|100"` elements print it.
- Events are automatic: `calc_input` (first per session per calculator), `calc_result_view` (result in view after input).
- Defaults at first paint must equal what the script computes (it never rewrites matching text): earnings defaults 60 subscribers, AED 199, 30% at AED 299 nutrition gives AED 229 average, AED 13,740, AED 3,435, AED 10,305, about 41 sessions; follower defaults 7,000 / AED 199 / 8 Stories give Cautious AED 398, Typical AED 2,985, Best case AED 23,084.

## 7. Events (window.tyTrack)

`tyTrack(event, props)` logs to the console with `concept` and `page`, marked sent / held until consent / not sent. Automatic: `cta_click` (any `[data-cta="<location>"]`), `faq_open`, `calc_input`, `calc_result_view`, `address_typed` (length only), `kamran_start`, `share_self` (`[data-share]` or `TY.share()`), `consent_choice`. Fire the rest yourself: `demo_play`, `demo_rule_edit`, `demo_threshold`, `signup_view`, `signup_field_start`, `signup_submit`, `signup_error`, `kamran_end`.

Forms: `<form data-proto data-success="In-page message" data-event="signup_submit">` with a `<p data-result hidden>` inside; submit is prevented and the message shown. Never use alert/confirm/prompt or `<a download>`.

## 8. Page-kind conventions

- Every page: one H1 (8 words or fewer, no colon, `hl()` on its highlight word), H2s of 6 words or fewer, lede 25 words or fewer, card bodies 18 or fewer, FAQ answers 45 or fewer. "AI" always belongs to someone ("your AI"). Banned: seamless, revolutionary, cutting-edge, unlock, empower, game-changing, trusted by, #1, guaranteed, passive income, model or vendor names, the payout provider's name.
- Inner pages start with `<section class="page-hero" data-hero aria-labelledby="h1">`, optional `crumbs()`, eyebrow, H1, lede, `ctaRow({location:"hero", secondary})`. Sections follow with `band()` + `sectionHead()`.
- Any AED take-home or revenue figure: a `statusChip("payments", "subscriber payments")` beside it and `paymentsNote()` under it, and a status (panel or strip) earlier on the page. Market figures carry `srcBadge(id)`; sample data carries `sampleLabel()`.
- Feature pages: `offeringChip(page.offering)` plus a `statusChip` for each flag in `page.availability` that is off live (`payments`, `payouts` → `payments`, `voice`). `model` is on; `nutrition` shows "Optional tier"; `whoop`/`zepp`: use core availability (Included), not `some()`.
- Specialty pages: `page.examplePriceAed` drives the price ladder (B leads with it).
- Legal pages: `closing: false`, `sticky` stays; doc layout with `.prose`. Signup and login: `sticky: false`; signup renders the early-access form under `.if-reg-closed` with `id="early-access"` (the closed CTA links to `signup.html#early-access`). Coaches: noindex is already on every prototype page. 404: no motion, everything in the first screen.
- Kamran: inline `kamranPill({location, inline:true})` in FAQ bands on phones; `kamran: true` in the render result adds the desktop float.
- Sample trainer: "Layla Strength" (`layla-strength.trainsyou.com`), always labelled. No people photos, no counts, testimonials, logos, ratings or results. Owner-supplied items print as `[owner to supply]`.

## 9. Do not touch

`site.css`, `site.js`, `boot.js`, `calc.js`, `core.css`, `core.js`, `build.mjs`, `core.mjs`, `layout.mjs`, `components.mjs`, `pages-core.mjs`. If you need a helper, a token, a CSS class or a runtime hook that is missing, build it locally in your group files when it is page-specific, and list anything sitewide in your report so the foundation can add it.

## 10. Whole-site QA (run after any change)

- `/opt/nvm/versions/node/v24.22.1/bin/node tools/qa.cjs [page.html ...]` (Node 24: it imports the real `packages/domain/src/marketing-calculators.ts`). Crawls every page at 360, 390 and 1366 (plus 768/1024/1600 overflow and a reduced-motion pass): console errors, non-font external requests, overflow, title/H1, links and anchors, alt text, contrast of every text node, clipped or spilling text, chips/tiles broken by broad selectors, first-screen visibility, view transitions, header focus rings, dropdown, mobile menu, sticky CTA and prototype button at page end, dev-panel switches, calculator outputs against the real maths. Writes `shots/qa/summary.json`, `report.json` and 390/1366 screenshots. `SHOTS=0` skips screenshots, `CONC=n` sets parallel pages.
- `node tools/tile.cjs <segH> <cols> shots/qa/x-390-full.png` slices full-page shots into readable tiles (`SCALE=0.5` for desktop).
- `node tools/copy-check.cjs`: H1/H2/lede/FAQ word budgets and banned terms (legal pages quote "guarantee" in negations; the 7-word guide H2s include their section number).
- Conventions fixed in QA: vignettes ship in their final state (`vg is-b`) and only below-the-fold ones are armed; tables with 3+ columns stack on phones (`table--stack`, labels added at build); adjacent source badges are numbered; the phone bottom reserve lives in the footer; broad `x span {display:block}` rules must use `span:where(:not(.chip, .app-icon-tile, .btn))`.

## 11. Adversarial review pass (26 Oct 2026): decisions to keep

- Apostrophes: `layout.mjs` converts straight apostrophes in visible text to ’ (never inside tags, scripts or styles). The FAQ filter normalises both forms.
- Vocabulary: the grade-6 replacements match `(?:your )?held-out scenarios` (no "your your"); money pages run `plain()` on content strings so "marginal bands" never shows.
- Home hero lede: "Teach it your method. It coaches every subscriber daily, under your name, at your price." (no "teach it once": teaching continues through corrections).
- Home subscribers band: adds "Progress they can see" (C1 band 3); the caption carries `statusChip("publish", "publishing")` so every item reads as "once your page is live".
- Pricing: hero card says "Free to set up, nothing to pay upfront" (sourced wording, no invented "no monthly fee" claim); statement totals read "You keep, before card processing"; band table ranges use en dashes.
- Tablet hero (720–960 px): offer phone and price tile stay overlapped so the signature tile is in the first screen. Below 720 the stage stacks.
- Session marks are filled ink squares (a booked calendar), and the "1 session" card carries one matching mark.
- Pricer buttons at a limit look disabled (`aria-disabled="true"`: paper fill, muted icon, no press; never opacity, so QA never reads it as hidden).
- `calc_input` carries `price_bucket` (and `scenario` only when set), never `undefined` props.
- The subscriber Today screen marks finished exercises with a check, not a strike-through.
