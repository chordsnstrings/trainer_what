# Concept C "The Method": builder guide

Concept C reads like a coaching manual that has come to life. The display face is serif (Newsreader); body text is Inter. The page sits on an 8 + 4 manuscript grid: text on the left, margin notes on the right. Sections are numbered "§n" and open with a 1 px rule that draws itself. Paper sheets hold rule cards, the Never sheet and letters. There are no shadows.

Motion is "highlighter and ink": a Pace mark scales in behind a phrase, rules draw with `stroke-dashoffset`, values crossfade, and a rule card gets stamped "Confirmed". Home (`/`) and Pricing (`/pricing`) are fully built in `src/pages-core.mjs` and set the bar. Open `site/index.html` and `site/pricing.html` and copy their patterns.

Spec sources:
- `../research-final.md`: C0 sitewide rules (lines 428-542), your page's C section, section D (shared tokens and motion), and Concept C (lines 1422-1504), including its per-page treatment table.
- `../content.json`: the content.

## 1. Files and ownership

| File | Owner | Notes |
|---|---|---|
| `src/build.mjs` | foundation | Dispatcher. **Do not edit.** |
| `src/lib/registry.mjs`, `content.mjs`, `layout.mjs`, `components.mjs` | foundation | **Do not edit.** Ask for changes in your report. |
| `src/pages-core.mjs` | foundation | Home and Pricing. Read it as the reference. |
| `src/pages-product.mjs` | product builder | `/how-it-works`, `/trainer-brain`, `/features`, `/features/*` (11), `/demo`, `/security-and-privacy` |
| `src/pages-audience.mjs` | audience builder | `/for-trainers`, `/for-trainers/*` (4), `/uae`, `/get-started`, `/signup`, `/login` |
| `src/pages-money.mjs` | money builder | `/earnings-calculator`, `/follower-calculator` |
| `src/pages-content.mjs` | content builder | `/guides`, `/guides/*` (4), `/faq`, `/about`, `/methodology`, `/terms`, `/privacy`, `/ai-disclosure`, `/coaches`, `/404` |
| `site/assets/site.css`, `site.js`, `boot.js`, `calc.js`, `core.css`, `core.js` | foundation | **Do not edit.** |
| `site/assets/<group>.css` and `<group>.js` | each builder | Loaded only on that group's pages (product, audience, money, content). |
| `src/tools/*.cjs` | anyone | Check tools. You may run them; please don't change them. |

You may add your own helper modules, for example `src/lib-product.mjs`, and import them from your page module. That is the only change allowed outside your own files.

## 2. Build and check

```sh
PATH=/opt/nvm/versions/node/v24.22.1/bin:$PATH
node src/build.mjs                       # all 42 pages -> site/
node src/build.mjs /demo /features/safety  # only these
node src/tools/check.cjs demo.html --widths=360,390,768,1024,1366,1600   # console errors, overflow, H1 count, screenshots in shots/
node src/tools/sections.cjs demo.html 390 --wait=1500   # one screenshot per <main> section (shots/sec-*)
node src/tools/words.cjs index.html      # visible words in <main>, per section
node src/tools/qa.cjs [page.html ...] [--no-shots] [--jobs=3]   # full QA: static + 360/390/1366 + reduced motion; shots/qa/, shots/qa/report.json
node src/tools/ref-calc.mts              # regenerate src/tools/ref-calc.json from packages/domain (calculator reference for qa.cjs)
```

`qa.cjs` checks: head contract, one H1, links and #anchors, allowed hosts only, console errors, failed requests, horizontal overflow, words broken across lines, first screen never hidden, every reveal resolves, contrast (4.5/3), touch targets (44 px, `::after` hit areas count), header focus rings, mobile menu (keyboard, trap, Escape, click), desktop dropdown, sticky CTA (mid-page on, end off, clear of Dev), dev panel (6 flags, content follows, 42 links, All concepts, replay, reset), view transitions, calculators against the repo maths. Run it with `--jobs=3` or fewer: more parallel browsers starve frames and make reveal checks flaky.

- The build fails when a page does not have exactly one `<h1>`.
- `href()` throws on an unknown path, so a broken internal link never builds.
- Look at your screenshots (Read the PNG). In `sections.cjs` shots of very tall sections, the "Skip to content" link and the sticky header can appear mid-image. That is a capture artifact, not a bug.

## 3. Page module contract

```js
// src/pages-product.mjs
export const pages = {
  "/demo": ({ page, content, href, h, pageFor }) => ({
    main: `...`,          // HTML inside <main>. The first section is the hero and carries data-hero.
    title: page.title,    // optional <title> override (keep the query terms; " · trainsyou" is appended)
    description: "...",   // optional meta description
    closing: { label: "Read the AI disclosure", path: "/ai-disclosure" }, // closing-panel secondary; false hides the panel
    sticky: true,         // mobile sticky CTA bar (false on /signup and /login)
    kamran: true,         // floating "Talk to Kamran (AI voice)" pill on desktop
    calc: false,          // true loads assets/calc.js (window.tyCalc)
    bodyClass: "",
  }),
};
```

The `ctx` object:
- `page`: the content.json entry, plus `owner` and `file`. The fields are `path, kind, group, navLabel, title, description, eyebrow, h1, h1Highlight, lede, intro, sections[] {id, heading, body[], bullets[], cards[] {title, body}, steps[], table {caption, columns, rows}, note, sources[]}, faqs[] {q, a}, cta {label, href}, related[], availability[], offering, examplePriceAed, parent`.
- `content`: the whole export, including `sources`, `setupChecklist`, `availabilityLines`, `citedAssumptions`, `entitySentence`, `notStatements`, `nav`, `footer`, `brand` and `membershipPricing`.
- `href(path, suffix?)`: returns a relative file link, for example `href("/features/nutrition")` gives `features--nutrition.html` and `href("/pricing", "#status")` works too. A query is allowed: `href("/signup?slug=x")`.
- `h`: every export of `src/lib/components.mjs`.
- `pageFor(path)`: returns another page's entry, for its `navLabel`, `h1` and so on.

What the layout adds on its own:
- the head (fonts, `site.css`, `<group>.css`, `boot.js`, `site.js`, `<group>.js`);
- the header with the real lockup and nav, and the mobile menu sheet;
- the closing panel (Pace, "Your coaching. Beyond your hours.");
- the footer, sticky CTA, Kamran, consent bar and dev panel.

Do not add any of these yourself. Pages that are not built fall back to a dashed "Not built yet" stub.

## 4. Copy and honesty rules (hard)

- **Copy source:** use the section C copy for your page (H1s ≤ 8 words, no colon; H2 ≤ 6 words; lede ≤ 25; card body ≤ 18; FAQ answers ≤ 45). Use content.json for everything else.
- **AI ownership:** "AI" always belongs to the trainer: "your AI".
- **Product name:** define it once per page as "your AI (we call it your Trainer Brain)".
- **One CTA:** use `h.cta({ location })` only. Its label is "Teach your AI — free" and it goes to `signup.html`. The page's own action is the secondary: `h.secondary(label, path, { location })`.
- **Never invent:** no testimonials, user counts, logos, ratings, awards, earnings or results.
- **Sample data:** label it with `h.sampleLabel()` (sample trainer "Layla Strength").
- **Live state, as the default:**

  | Flag | Default |
  |---|---|
  | registration | open |
  | payments and payouts | off |
  | publishing | blocked by the payments launch gate |
  | frontier | off (use fallback wording) |
  | voice for subscribers | off |

  Every AED headline gets `h.statusChip("payments", "Not on yet: subscriber payments", ...)` beside it. Any page that lists availability uses `h.statusPanel()` and never a hand-written list.
- **Market figures:** every market figure gets `h.sourceBadge("<source id>")`. Figures built from several sources get `h.methodBadge("follower-formula" | "earnings-method" | "principles")`.
  - **Content builder:** on `/methodology`, give each source entry `id="<source.id>"` and each section `id="<section.id>"`, so these anchors resolve.
- **Banned words:** seamless, revolutionary, cutting-edge, unlock, empower, game-changing, "trusted by", #1, guaranteed, passive income, any AI or model cost, and vendor, model or payout-provider names.
- **Pending owner content:** the founder's name, photo, words and signature (decision 2) and the card-processing rate (decision 3) are shown as `<span class="placeholder">…</span>` with the decision number. Never fill them in.

## 5. Helpers (`h.*`, src/lib/components.mjs)

Text arguments are escaped. Arguments named `…Html` take raw HTML.

| Helper | Signature | Example and notes |
|---|---|---|
| `esc, attrs, cx, each, slug` | basics | `each(list, (x, i) => \`<li>${esc(x)}</li>\`)` |
| `icon` | `(name, {size, className, label})` | check, circle, arrow, chevron, plus, close, menu, pause, user, lock, mic, share, wifi |
| `whenOn / whenOff / flagged` | `(flag, html, tag="span")` | flags: payments, publish, voice, frontier, registration. `flagged("frontier", fallbackHtml, frontierHtml)` |
| `chip` | `(kind, text)` | kinds: included, optional, addon, noton, live, sample, estimate, neutral |
| `statusChip` | `(flag, offText, onText="Live today")` | `statusChip("payments", "Not on yet: subscriber payments", "Subscriber payments live")` |
| `offeringChip` | `(page.offering)` | Included / Optional tier / Add-on |
| `sampleLabel / estimateLabel` | `(text?)` | "Sample trainer · scripted" / "Estimate, not a promise" |
| `sourceBadge` | `(sourceId, {label})` | "Source →" to `methodology.html#id`. Throws on an unknown id. |
| `methodBadge` | `(anchor, label="Sources")` | links to a methodology section |
| `cta` | `({location, size:"lg"\|"md"\|"sm", block, query})` | `cta({ location: "hero" })`; `query: "?slug=x"` |
| `secondary` | `(label, path, {location, variant:"link"\|"button"})` | the secondary action |
| `linkArrow` | `(label, pathOrHash)` | an underlined text link with a nudging arrow. `"#status"` works. |
| `microLine` | `()` | the micro line under the hero CTAs, with the registration-closed variant |
| `mark / h1Html` | `(text)` / `(h1, highlight)` | Pace highlighter. **Use at most one per viewport.** |
| `sectionHead` | `({n, title \| titleHtml, lede, id, level})` | "§n" + drawing rule + serif H2. Give the `id` and use it as the section's `aria-labelledby`. |
| `ruleLine` | `()` | a standalone drawing rule |
| `band` | `({id, labelledby, paper, tight, contentHtml})` | a `<section class="band">` with `.wrap` |
| `msRow` | `(textHtml, noteHtml)` | an 8 + 4 row with a margin note (inline under the text at ≤760) |
| `marginNote` | `(noteHtml, {pin})` | `<div class="mnote" role="note">`; `pin:"a"` adds a circled letter |
| `pullQuote` | `(textHtml, {cite})` | serif italic. Width is capped by `.pull p { max-width: 18ch }` in the p's own font size |
| `figure` | `({n, caption?, bodyHtml, sample=true})` | "Fig. n — caption" + Sample chip; it is a reveal unit |
| `valueSlot` | `(text, {w, align, key})` | `.vx` stacked-span slot; update with `ty.swap(el, text)` |
| `liveRegion` | `(id)` | a polite, visually hidden region |
| `statusPanel` | `({id="status", title, compact, headingLevel})` | Live today / Not on yet. Its items move with the flags. Use one per page, `id="status"`. |
| `neverSheet` | `({titleHtml, compact, signed})` | the signed constraint list (C's signature sheet) |
| `founderLetter` | `({title})` | placeholder letter (decision 2) |
| `ruleCard` | `({kicker, text, source, scope, status, confirmedOn, pins, actions, sample, id})` | C's typeset rule card. Its stamp straddles the bottom inline-end corner, so leave about 24 px of room right and below it. |
| `phone` | `({screenHtml, label, rtlVignette})` | ink device frame. Build the screen with the `.app-*` classes. `rtlVignette` is only for the subscriber-app vignette. |
| `windowFrame` | `({title, bodyHtml, chipHtml})` | trainer workspace panel |
| `lanes` | `({active:"applied"\|"toyou"\|"paused"})` | the three decision lanes |
| `addressPreview` | `({id, location})` | "Claim this address" → `signup.html?slug=…` with the hint "We’ll check it’s free in setup." Tracks `address_typed`. |
| `table` | `({caption, columns, rows, numeric:[i]})` | hairline table; numeric columns are right-aligned and tabular |
| `faq` | `(items, {id, headingLevel})` | accordion (button + region, grid-rows). Fires `faq_open`. |
| `tabs` | `({id, label, tabs:[{id,label,panelHtml}]})` | ARIA tabs with roving tabindex and arrows/Home/End. Dispatches `ty:tab`. |
| `stepper` | `({id, label, steps:[{title, panelHtml}]})` | visitor-led stepper: tabs + prev/next + drawn progress line. Dispatches `ty:step`. |
| `kamranPill` | `({inline, location})` | inline variant: only visible on phones; put it in FAQ bands. |
| `shareButton` | `({label})` | "Send this to myself": Web Share, else copy plus "Link copied". Fires `share_self`. |
| `field` | `({id, label, type, value, prefix, suffix, help, attrsObj, inputHtml})` | labelled input with AED/% affixes |
| `stubMain` | (dispatcher only) | |

Constants: `CTA_LABEL`, `CTA_CLOSED_LABEL`, `NEVER_ITEMS`.

## 6. CSS vocabulary (site.css)

- **Tokens:** `--white --ink --paper --muted --line --pace --pace-wash --paper-2 --rule --margin-ink --success(-bg) --warning(-bg) --error(-bg)`; `--font-serif --font-sans`; `--ease-out/-in/-inout/-enter/-spring`; `--d-press 80, --d-fast 140, --d-base 200, --d-slow 280, --d-emph 420`; `--stagger-1 40, --stagger-2 80`; `--r-control 4, --r-sheet 2, --r-card 6`; `--s1…--s9` (4…96); `--band-pad` (96 on desktop, 64 on phones); `--gutter` (32/24/16); `--col-gap`; `--header-h`; `--sticky-h`; `--dir` (−1 in RTL).
- **Pace:** only ever a background behind ink text. The surface is light only.
- **Layout:** `.wrap`, `.band`, `.band--paper`, `.band--tight`, `.grid-12`, `.ms` (8+4 grid: put `.ms-text` + `.mnote` inside), `.ms-row`, `.two`, `.stack`, `.stack-sm`, `.row`.
- **Hero:** `<section class="hero" data-hero>` + `.wrap.hero-grid` (7/5; stacks at ≤1100) + `.hero-copy`, `.eyebrow`, `h1.display`, `.lede`, `.hero-actions`, `.micro`, `.status-strip` (the one-line status under the hero, before any AED figure).
- **Type:** `.display`/h1, `.h2`/h2, `.h3`/h3, `.lede`, `.eyebrow`, `.kicker`, `.big-p` (serif paragraph), `.prose` (reading measure 64ch; guides and legal), `.fine`, `.muted`, `.tnum`, `.nowrap`, `.serif`, `.measure`.
- **Section head:** `.sec-head`, `.sec-rule`, `.sn`, `.rule-svg`, `.sec-lede`.
- **Figures:** `.fig`, `.fig-body`, `.fig-cap`, `.fig-n`; `.pull`, `.pull-cite`.
- **Buttons:** `.btn` + `.btn-primary` (ink) | `.btn-secondary` (outline); sizes `.btn-lg`, `.btn-sm`, `.btn-block`, `.btn-icon`; `.link-arrow` (`.la` + `.arr`).
  - `.btn-ui` / `.btn-ui--ink` are button shapes inside product figures. They are not interactive, so set `aria-hidden` on their container.
- **Labels:** `.chip--*`, `.chips`, `.chip-dot`, `.src`, `.placeholder`.
- **Sheets:** `.sheet`, `.sheet--white`, `.status-panel`, `.never-sheet`, `.letter`, `.stmt` (statement mock: `.stmt-head`, `.stmt-t`, `.stmt-lines`), `.mini` (small UI figure: `.mini-k`, `.mini-serif`, `.mini-line`, `.mini-checks`, `.mini-price`, `.mini-sub`, `.mini-url`, `.mini-quote`, `.mini-wait`).
- **Product objects:** `.rule-card` (+ `.is-confirmed`), `.phone` / `.phone-screen`, and app UI:
  - `.app`, `.app-top`, `.app-icon`, `.app-name`, `.app-sub`, `.app-h`, `.app-card`, `.app-row`, `.app-btn`, `.app-badge`, `.app-note`, `.app-tabbar`;
  - `.bubble--in` / `.bubble--out`, `.window` / `.window-bar` / `.window-body`, `.lanes` / `.lane`, `.meter > i` (set `style="--v:.86"`).
- **Widgets:** `.field`, `.field-label`, `.field-help`, `.input-wrap`, `.input`, `.affix`, `.check`, `.range` (set `--p` for the fill), `.addr`, `.tabs`, `.tablist`, `.tab`, `.tabpanel`, `.stepper`, `.faq`, `.tbl`, `.tbl-wrap`, `.toc` (margin table of contents: `<nav class="toc"><p class="toc-k">Contents</p><ol><li><a href="#id"><span class="toc-n">§1</span><span>Title</span></a>`; hidden at ≤1100).
- **Calculator sheet:** `.calc` (inputs 5 / result 7), `.calc-in`, `.calc-out` (sheet), `.calc-k`, `.calc-fig`, `.calc-label`, `.calc-lines` (dl rows), `.calc-cta`, `.scens` / `.scen` / `.scen.is-best` / `.scen-k` / `.scen-v` / `.scen-s` (three scenario columns).
- **Flags:** `.if-payments-on/off`, `.if-publish-open/blocked`, `.if-reg-open/closed`, `.if-frontier-on/off`, `.if-voice-on/off` (prefer the `whenOn`/`whenOff` helpers).
- **Utilities:** `.sr-only`, `.flip` (mirrors an arrow icon).

## 7. Motion (site.js runtime, `window.ty`)

- **Reveal once:**
  - Put `data-reveal` on blocks **below the first screen**. Each block should be shorter than a viewport, so split long sections into heads, rows, figures and sheets.
  - site.js adds `.reveal-pending` only to units that start below the fold, then swaps it for `.is-in` once, at a ratio of 0.15 or with a quarter of the viewport visible.
  - Nothing inside `[data-hero]` is ever hidden. Never hide the first screen with your own CSS.
  - Inside a unit, these animate for free: `.rule-svg` (draws), `.mnote` (slides from inline-end, 80 ms after its paragraph), `.mk-mark` (highlighter sweep), `.meter > i` (fills), `.lane.is-active` (slides in).
- **Stagger:** put `data-stagger` on a list. Its children get `--i` (capped at 5) and rise 40 ms apart. Or set `style="--i:n"` yourself on sibling units.
- **Values:** `ty.swap(slotEl, "AED 2,985")` crossfades stacked spans. Use `{html:true}` for markup. Slots should have a fixed width (`valueSlot(text, {w:"10ch"})`). Keep values out of the middle of sentences: put them at a line end or in their own cell, so nothing reflows. Call `ty.announce(liveRegionEl, text)` once per result (debounced 500 ms).
- **Rule card:** `ty.confirmRule(cardEl)` runs C's only success state: status crossfade, Pace-wash overlay, ink edge, and a spring stamp. `ty.resetRule(cardEl)` undoes it. On `/trainer-brain`, wire it to a real Confirm `<button>` you place next to the card. The card's own `.btn-ui` shapes are decorative.
- **Tabs and stepper:** `ty.wireTabs(root, onSelect)` already runs for `[data-tabs]` and `[data-stepper]`. Listen for `root.addEventListener("ty:tab" | "ty:step", e => e.detail.index)`.
- **Hero replay:** register with `ty.onReplay(fn)`. The dev panel's "Replay hero" scrolls up, restarts the H1 highlighter and calls your fn. Hero changes play once after `load`, and only while in view (see core.js).
- **Flags:** `ty.onFlags(fn)` is called with `{payments, publish, registration, frontier, voice, "rtl-preview"}` on every toggle. Read the current state with `ty.flags()`.
- **Other helpers:**
  - `ty.track(event, props)` (also `window.tyTrack`);
  - `ty.debounce(fn, ms)`;
  - `ty.inView(el)`;
  - `ty.slugFromName(name)`;
  - `ty.observeReveal(root)` (call it after you inject HTML).
- **Allowed motion:**
  - Animate only `transform` and `opacity`, plus `stroke-dashoffset` and the FAQ's `grid-template-rows`.
  - Colour changes are instant or done by an overlay's opacity.
  - Hover effects go inside `@media (hover: hover)`.
  - No loops, except the AddressPreview caret, which blinks only while focused.
  - No pinning, no scroll-scrubbing, no count-ups. First-paint values are real HTML.
  - Durations come from the tokens only.
- **Reduced motion:** the owner's `MARKETING_MOTION="always"` applies, so short motion plays for everyone. Only smooth scrolling is turned off under reduce. Don't add long or large motion.
- **Budget:** boot + site + core JS is about 9.2 KB gzip. Keep each group's own motion JS under about 2.5 KB gzip. `calc.js` is maths and does not count.
- **Page transitions:** cross-document View Transitions are already on: a root crossfade (200 ms out, 280 ms in) with the header and footer persisting.
  - Don't add a `view-transition-name` to anything.
  - If you really need a shared morph, use `data-vt-name="x"`. boot.js applies it only while the element is in the first viewport.

## 8. Calculators (money builder; others may reuse)

`calc.js` is a 1:1 port of `packages/domain/src/marketing-calculators.ts` and of `index.ts` (BANDS, commission). Do not change a ratio. It provides:
- `tyCalc.estimateFollowerConversion(inputs)`, `followerLevers(inputs, model, "strong")`, `DEFAULT_FOLLOWER_INPUTS`, `FOLLOWER_LIMITS`, `FOLLOWER_MODEL`;
- `estimateEarnings(inputs)`, `DEFAULT_EARNINGS_INPUTS`, `EARNINGS_LIMITS`;
- `commission`, `projectedCommission`, `blendedRatePct(count, priceAed)`;
- `aedWhole(minor)` ("AED 23,084"), `whole`, `pct`, `countLabel`, `displayCount`, `slugFromName`.

Defaults are verified against the blueprint:

| Calculator | Case | Result |
|---|---|---|
| Follower | Cautious | AED 398 |
| Follower | Typical | AED 2,985 |
| Follower | Strong | AED 23,084 |
| Earnings | Average price | AED 229 |
| Earnings | Subscriptions | AED 13,740 |
| Earnings | Commission | AED 3,435 |
| Earnings | Kept | AED 10,305 |
| Earnings | Sessions | about 41 |

Compute first-paint values at build time: `createRequire(import.meta.url)(resolve(ROOT, "site/assets/calc.js"))`, as `pages-core.mjs` does. Set `calc: true` in the PageResult. Track:
- `calc_input`: the first input per session;
- `calc_result_view`;
- `share_self`.

Label results "ILLUSTRATIVE ARITHMETIC" or "Estimate, not a promise". Put the payments chip beside every AED result. Keep "before platform commission" on the follower headline, and show all three scenarios side by side (`.scens`). Copy the layout from `index.html` §6 and `pricing.html` §4.

## 9. Page-kind conventions for C

- **Section order:** every page is a hero (`data-hero`), then numbered sections (`sectionHead({n})`), then the closing panel (automatic). Alternate `band` and `band--paper` sparingly; one paper band per two or three sections reads best.
- **Grid:** put facts, times, sources and status chips in the **margin column** (`.ms` / `msRow`). Do not use cards unless the spec calls for an object.
- **Feature detail:** a "Fig. n" annotated vignette with one state change, and facts in the margin. Offering chip: `h.offeringChip(page.offering)`. Availability chips come from `page.availability`:

  | `page.availability` value | Flag to use |
  |---|---|
  | `payments`, `payouts` | `payments` |
  | `voice` | `voice` |
  | `model` | none: it is live, so show no chip |
  | `nutrition`, `whoop`, `zepp` | no dev flag: show "Not on yet" only where the spec says so |

  Use core availability for Progress, never `some()`.
- **Legal, guides and methodology:** `.prose` for the reading measure, `.toc` in the margin, footnoted `sourceBadge`s, and `pullQuote`s.
- **Other pages:**
  - **Specialty pages:** rules typeset as a manual page, and the paused list as a `neverSheet`-style sheet.
  - **404:** H1 "This page isn't in the manual.", with links home, demo, pricing and guides, and `cta()`. It has no motion.
  - **Signup:**
    - It needs an element with `id="early-access"` (the early-access form, shown when `[data-registration=closed]`).
    - Read `?slug=` to show "your-name.trainsyou.com — we'll check it's free in setup".
    - Set `sticky: false` and `closing: false`.
    - Forms use `data-proto-form="signup_submit"` + `[data-form-result]` (site.js prevents the submit and shows the in-page result).
  - **Login:** `sticky: false`, `closing: false`.
  - **Coaches:** keep the page, but it has no footer link (decision 11), and it gets the trainer-facing empty state.
- **RTL:** the dev panel's RTL toggle only flips `[data-rtl-vignette]` (the subscriber-app vignette). Elements with `data-ar="…"` swap text. Use only real member-app Arabic strings from the repo; if you can't find them, leave the vignette English and say so in your report.
- **Events** (log only; site.js wires the generic ones): `cta_click`, `demo_play`, `demo_rule_edit`, `demo_threshold`, `calc_input`, `calc_result_view`, `address_typed`, `faq_open`, `kamran_start`, `kamran_end`, `share_self`, `signup_view`, `signup_field_start`, `signup_submit`, `signup_error`. For any link or button, use `data-track="event" data-track-props='{"label":"…","location":"…"}'`.

## 10. Gotchas we hit

- QA pass (26 Oct): a `ch` or `auto` grid column next to a big figure or a no-wrap value column squeezes the label into one letter per line (UAE stats, the hour-vs-month ladder). Size such columns in the figure's own `em` or cap them with `fit-content(…%)`, and run `qa.cjs`, which flags words broken across lines.
- A stacked table (`display: block` on table/tr/td) must also set `caption { display: block; }`, or the caption shrinks to one word per line.
- Web fonts swap after `site.js` runs and can pull a pending reveal unit into the first viewport; `site.js` re-checks on `load` and `document.fonts.ready`.

- `ch` max-widths resolve against the element's own font size. Put them on the text element, not its wrapper (see `.pull p`).
- `mark()` is `nowrap`. Keep marked phrases to one or two words, and keep closing punctuation with them: `<span class="nowrap">${mark("easy sessions")}.”</span>`.
- Desktop nav appears only at ≥1240 px. Below that, the header shows Sign in + CTA + Menu, and on phones (≤760) logo + Menu only.
- The page bottom is reserved for the sticky bar on phones (`body.has-sticky`). The dev button sits above it.
- Home word count is 544 budgeted words against the 400 budget (calculator, closed answers and product UI excluded). About 130 of them are required components the counter still includes: the status panel, the Never sheet, AddressPreview, figure captions and sample labels, and the founder placeholders. The review pass (26 Oct) added the band staircase to §5 (the marginal-rate fact the blueprint puts on home) and cut step 1 of §3 to a pointer to §1. Keep your pages inside their own section C budgets.
- Review pass (26 Oct): the phone Dev tab is 14 px wide so it stays inside the 16 px gutter (an invisible ::after keeps a 34 px hit area). Don't widen it: at 24 px it covered the first letter of every left-aligned line.
- "Not on yet" replaces every bare "when enabled" from content.json (see the Progress bullet mapping in lib-product-features.mjs).
