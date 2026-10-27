# Phase 1 test and CI constraints for /, /trainer-brain, /demo and /pricing

I changed no repository files. Scratch copies and outputs are in `/tmp/claude-0/-home-user-trainer-what/14381359-c138-56f9-a25b-830f6a2f39f9/scratchpad/`: `baseline.txt`, `baseline2.txt`, `scan.mjs` and `proto/`.

## A. Baseline (27 Oct 2026, Node 24.22.1)

**Requested run:** `node --import tsx --test tests/marketing-*.test.ts tests/logical-css.test.ts tests/brand*.test.ts`
- 102 tests: 102 pass, 0 fail, 0 skipped, 60.1 s.
- Tests per file: marketing-site 25, marketing-motion-sitewide 11, marketing-journey 10, marketing-api 10, marketing-assistant 11, marketing-follower-model 12, marketing-frontier 3, logical-css 3, brand 12, branding 5.

**Neighbouring suites that also constrain these pages:** 78 tests, 78 pass, 29.1 s.
- scroll-scenes-engine 9, model-name-guard 4, motion-css 7, i18n-hardcoded 2, analytics-consent 10, setup-wizard-web 11, public-pages 12, discovery-seo 13, rtl-layout 10.

**Trace verifier** (`docs/marketing-revamp-2026-10-26/prototypes/shared/brain/tools/verify.mts`):
- Result: 4,418 checks, 480 plan combinations, 77 WHOOP combinations, 0 fails, 0.5 s.
- The traces match the current domain code.

**Approved figures recomputed from the domain code.** All match, so new tests can compute them instead of hard-coding them.
- Pricing slider, from `estimateEarnings`: 100 subscribers → 25%, 300 → 21.67%, 1,000 → 17%, 1,500 → 14.67%.
- Pricing worked example: 150 × AED 199 = AED 29,850; commission AED 6,965; you keep AED 22,885; about 92 sessions.
- Home follower block, from `estimateFollowerConversion` defaults: AED 23,084 strong, 2,985 typical, 398 cautious.

**CI timings.** The last green `main` push run (3d6b9bd, 26 Oct) took:

| Job | Took | Time limit |
|---|---|---|
| application | 36 min | 75 min |
| homepage-call | 5 min | 40 min |
| ux-spacing | 10 min | 40 min |
| postgres-and-container | 16 min | 40 min |
| subscriber-ui | 3.5 min | 30 min |

**Prototype builds:**
- Concept A and concept C do not build inside the repo. The root `package.json` sets `"type":"module"`, so `site/assets/calc.js` loads as ESM and its `module.exports` line never runs.
  - A fails with `calc.estimateFollowers is not a function` at `concept-a/src/pages-core.mjs:187` (the require is at :15).
  - C fails with `Cannot set properties of undefined (setting 'tyCalc')`.
- Both build when the prototypes folder is copied outside the repo. I did that in the scratchpad.
- Concept B builds in place.

## B. CI facts

**Triggers** (`.github/workflows/check.yml:2-6`):
- Every push to `main` runs CI.
- Pull requests skip CI when they only change `docs/**` or `*.md`.
- So runtime code and the trace data must live under `apps/` or `packages/`, never under `docs/`.

**Deploy gate:**
- `infra/digitalocean/common.py:82-90` deploys only a successful `check.yml` push run for the `main` SHA. `verify-release.yml:1-25` then waits until that SHA serves.
- A job cancelled at its time limit blocks the release (`docs/PROJECT_MEMORY.md:44`).
- So every new CI step is a deploy gate, and its timing assertions must be robust.

**How tests run:**
- `npm test` = `node --import tsx --test --test-concurrency=1 tests/*.test.ts` (`package.json:15`). Only top-level `tests/*.test.ts` files run.
- `npm run check` = typecheck + test + build (`package.json:19`). The root `tsconfig` is strict and covers `apps/**/*.ts(x)` and `tests/**/*.ts`.
- `.js` files are not typechecked, so port the showcase code as TypeScript.

**CI jobs that load marketing pages:**
- **application** (`check.yml:96,102`): runs `npm run check`, then `scripts/run-browser-check.mjs`, which uses `browser-check.mjs` and `browser-completion-check.mjs`.
- **homepage-call** (`check.yml:45-71`): runs `scripts/run-marketing-call-check.mjs` → `scripts/marketing-call-check.mjs`.

No other CI job visits these pages. The only marketing-related assertion elsewhere is `daily-workflows-check.mjs:208-210`, which checks the member onboarding header does not say "Kamran".

**Not in CI:** `test:brand`, `test:marketing-motion` (journey and sitewide), the default `rtl-check.mjs`, phone, dark, pwa, screenshots, and the e2e harness. `onboarding-chat.yml` runs `logical-css`, but only on its own onboarding paths.

## C. Unit tests in CI: what each asserts about the four pages

Verdicts: KEEP (still holds), UPDATE (will fail and must be changed), EXTEND (add coverage), RETIRE.

### `tests/marketing-site.test.ts` (25 tests)

**Registry and discovery — KEEP:**
- `:131-169`: unique path, title, description and H1; description 70–175 characters (`:143-146`); intro 35–65 words (`:154-158`); section sources resolve; unique section ids.
- `:171-212` and `:238-272`: all four paths stay in the registry and in `PUBLIC_MARKETING_PATHS` (`:243-244`); nav and footer link only registry pages (`:266-271`).
- `:274-313`: title is "… | trainsyou" and at most 60 characters (`:282`); description at most 155 (`:283`); home Open Graph image is `/brand/social-share-1200x630.png` (`:288-293`).
  - `:312` hard-codes the renamed home title "Free-to-join AI trainer platform for UAE coaches | Acme Coaching". UPDATE only if the home title changes.
- `:315-376` (JSON-LD): the H1 must be visible (`:332`); every FAQPage question and answer must appear in the rendered HTML (`:334-340`); home Organization description = `ENTITY_SENTENCE` (`:362`).
- `:396-405` (SEO depth): every indexable non-hub page, including all four, needs at least 350 registry words. Showcase and trace text does not count, so keep the registry sections substantive.

**Home test `:482-619` — fails as a whole. UPDATE by rewriting it.** It asserts:
- One H1 equal to the registry text, with `<span class="mk-mark">` (`:486-492`). This can be kept: the approved H1 is still "Teach your AI. It trains your subscribers."
- No `<mark` anywhere in the home HTML (`:493`). This clashes with the field's `<mark class="mc-hl">` on Noura's matched words.
- Lede at most 25 words (`:495`).
- Micro line exactly "Free to join · No upfront cost · Built for UAE trainers" (`:497`). The approved line is "Free to join · Nothing to pay upfront · Nothing goes live until you publish".
- "payouts to a UAE bank" absent from the whole home page (`:499`).
- The `mk-hero` section has no "Trainer Brain" and exactly one "unsure/not sure" (`:503-510`).
- `main` names the UAE and links to /trainer-brain, /demo, /features, /pricing, /follower-calculator and /how-it-works (`:512-517`).
- The relay figure (`:519-527`) and the HeroFlow voice and nutrition rows (`:531-541`).
- Tile links (`:543-547`), the ControlFlow card's `role="img"` label (`:550-552`) and the address preview (`:553-563`).
- `readFile` of `site.tsx`, `hero-flow.tsx`, `chip.tsx`, `showcase.tsx` and `frame.tsx` (`:564-567`). This throws if `hero-flow.tsx` is deleted.
- Band pills equal `BANDS`, with "Commission by paying subscriber" and "Each rate applies only to the subscribers in its band." (`:568-583`).
- "Card processing is itemised." (`:586`).
- Exactly six H2s (`:588-597`). Prototype A has 9.
- Six FAQs that match the FAQPage data, the first being "How does {APP} work?" (`:601-610`). The approved FAQ list has no such question.
- The exact calculator JSX line in `site.tsx` (`:612-618`).

**Copy limits `:624-669` — KEEP the limits, UPDATE the moved-content lines:**
- Limits for /, /trainer-brain and /pricing: H1 ≤ 8 words with no colon; eyebrow ≤ 4; lede ≤ 25; H2 ≤ 6; at most 2 paragraphs of ≤ 35 words; card title ≤ 4 and body ≤ 18; at most 5 bullets of ≤ 12 words; FAQ answers ≤ 45; banned words.
- `:650-653`: /pricing section "hours" must cite exactly three sources and render "AED 70–350 … AED 200–700+ … AED 400–2,000". B's pricing page drops "AED 200–700+".
- `:654-656`: /trainer-brain "decides" cards must be exactly Confident / Not sure / Safety, and a "control" section must exist.
- `:659-662`: `llms-full.txt` keeps "### An hour sells only once".
- `:663-668`: every page has `<section class="mk-closing"` and one H1.

**Header pages `:674-705`:**
- The lede sits only in `mk-page-head`, and the intro appears once in an "In short" section placed before the FAQ (`:676-694`). KEEP for /trainer-brain and /pricing.
- /demo must have no lede and no "In short" (`:696-700`). Prototype A's /demo has a lede. UPDATE, and add /demo to the copy-limit list.

**Other assertions:**
- `:708-719`: exact /trainer-brain teach and never bullets ("Keep pain, medical issues or red flags from you.", "Use your teaching elsewhere: your Brain stays private to your workspace."). KEEP unless C's Never list rewords them.
- `:739-756` (llms files), `:758-798` (hidden specialties) and `:942-947` (no "estimate range"). KEEP.
- `:1004-1005`: /pricing must contain "An arithmetic example, not a forecast or promise". B's pricing page lacks it. UPDATE the copy or the test.
- `:1016-1024`: no AI-cost wording in the registry or the rendered pages, which includes server-rendered showcase text. KEEP.
- `:1072-1093`: a renamed platform shows its name. With registration closed, the home shows "Join early access" and no `href="/signup"` (`:1084-1086`). KEEP and EXTEND to all four pages: every showcase and playground call to action must go through `primaryCta`. The prototype hard-codes `data-cta="signup.html"`.
- `:1101-1128` (honesty scan): registrars, the payout provider's name and hype on every rendered page.
  - `:1117-1127` reads every `readdir` entry with `readFile`. A `components/marketing/brain/` folder, the path `SHOWCASE_DESIGN.md:230` proposes, crashes it with EISDIR. UPDATE to a recursive walk and include the traces data.

### `tests/marketing-motion-sitewide.test.ts` (11 tests)

- **`:301-367`** reads only `marketing.css`. Every rule must use `--mk-dur`/`--mk-ease` tokens and move only transform, opacity or stroke-dashoffset. The file must not contain the word `infinite` at all (`:337`).
  - The spring easing is allowed only on the selectors listed at `:161-168`, and at least 4 rules must use it (`:342`). Removing the relay and the demo drops it below 4. UPDATE.
  - Keep the showcase CSS out of `marketing.css`.
- **`:369-447`**: hover rules sit inside `(hover: hover)`. `:442-446` requires the relay keyframes (`mk-draw`, `mk-ring`, `mk-tick`) and the demo keyframes (`mk-stamp`, `mk-pop`) to still be used. UPDATE when they go.
- **`:449-581`** (the marketing motion switch):
  - The root must be exactly `<div className="public mk platform-ui" data-mk-motion={MARKETING_MOTION}>` (`:465`), and only `site.tsx` and `assistant-button.tsx` may carry the attribute (`:478`).
  - `:493-515`: every reduced-motion rule in the marketing, assistant and journey stylesheets must exclude the always-on switch. That is the opposite of the showcase rule, so the showcase's reduced-motion rules need their own stylesheet.
  - `:564-580`: the scroll-scenes head script and mount must read both reduced-motion settings and never the switch. `:574` asserts the mount gate `location.pathname === "/" && !reduced() &&`. UPDATE if /trainer-brain gets a pin.
  - EXTEND the same "never reads the switch" assertion to the showcase runtime.
- **`:583-617`**: anything hidden (opacity below 0.01) must sit under `.mk-motion` or in the allowed list. Keep the showcase's `[data-sc="pre"]` hiding out of `marketing.css`, or add a scoped allowance.
- **`:658-668`**: imports in `components/marketing` are limited to React, `next/link`, `next/navigation`, lucide, the workspace packages and relative paths. `next/dynamic` and `next/script` are not allowed. The scan is top-level only, so files in a subfolder escape it. EXTEND it to be recursive.
  - `:680` checks the reveal script's never-reveal list (`.mk-hero, .mk-page-head, .mk-relay`). EXTEND the list (`motion.tsx:55`) with `[data-showcase]`.
- **`:688-692`**: motion tokens may be defined only in `marketing.css`. Showcase `--sc-*` names are fine.
- **`:717-721`**: the ring animation must apply only to `.mk .mk-relay .mk-relay-mark::after`. UPDATE.
- **`:731-829`** (concept pass): `:794-800` times the hero arrow after `.mk-relay-rows li:nth-child(3) svg` and throws without the relay CSS. UPDATE.
- **`:831-845`**: the hero must contain `<link rel="expect" href="#mk-relay-cap" blocking="render" />` before the copy, plus `<HeroFlow`. UPDATE to point at the first element after the new hero copy, and keep only one such link.
- **`:847-886`** ("trains" sweep) and **`:888-922`** (phone menu from PR #102): KEEP.

### `tests/marketing-journey.test.ts` (10 tests)

- **Home band** (`:101-149`, `:236-249`, `:251-289`, `:297-310`): `/` must render `mk-walk mk-walk-compact` (`:247`) directly after the hero (`:259`), with the label "From setup to daily coaching" (`:261-264`), exact text (`:278-283`), a link to `/how-it-works#steps` (`:288`), and no amounts or percentages (`:297-329`). UPDATE per the journey-band decision in section I.
- **`:359-399`**: words in the journey mocks must also appear in `marketing-content.ts`, `marketing.ts`, `brand.ts`, `site.tsx`, `showcase.tsx`, `hero-flow.tsx`, `islands.tsx` or `frame.tsx` (`:360-371`). Deleting `hero-flow.tsx` throws, and removing home copy can leave mock words unmatched. UPDATE the list.
- **`:657-667`** (no new web dependencies) and **`:678-681`** (`layout.tsx:49-50` must import `marketing.css` immediately followed by `marketing-journey.css`): KEEP. Add any new stylesheet import after these two lines.

### `tests/brand.test.ts` (12 tests)

- `:158`: `proxy.ts:180` must contain the literal `|brand/)`. Bundle the traces with the code instead of fetching a static file, or insert any new excluded folder before `brand/`.
- `:195-209`:
  - `home.eyebrow` must equal "FOR PERSONAL TRAINERS" (`BRAND_COPY.audience`, `brand.ts:16`). The approved eyebrow is "FOR UAE PERSONAL TRAINERS". UPDATE this assertion; leave `BRAND_COPY.audience` alone because it feeds `llms.txt` (`:204`).
  - `claimCta(true)` must be "Start coaching" → /signup (`:206-208`). KEEP.
- `:211-256` (closing panel on / and /pricing) and `:258-268` (header and footer): KEEP.
- `:381` and `:437-448`: forbid `background: var(--band-ink)` in six platform stylesheets. A `#171917` ink stage passes this regex silently. EXTEND: allow dark backgrounds only under `[data-showcase]`.
- `:489-496` (no Pace-coloured text) and `:499-520` (public pages stay light in every scheme): KEEP.

### `tests/logical-css.test.ts` (3 tests)

- `:354-393` scans every `.css` file and every JSX `style` in `apps/web`, recursively.
- `:150-170` requires horizontal translation to be 0 or to multiply `var(--inline-sign)`.
- The prototype CSS has many physical left/right declarations by grep count: `a-brain.css` 17, `c-anatomy.css` 20, `brain-anatomy.css` 19, `site.css` 28, `money.css` 18. They must be converted.
- `:517-524` fails on stale allowlist entries. The relay-dot entry (`:31-37`, `marketing.css:1322`) must be removed in the same change that removes the relay CSS.
- Canvas coordinates are not scanned.

### Other suites

- **`scroll-scenes-engine.test.ts`** (`:315`): reads only `scenes.ts` and `journey-scene.ts`, and `:352` allows only "device" as an ambient scene. EXTEND it if an anatomy scene file is added.
- **`marketing-frontier.test.ts`** (`:76-80`): /trainer-brain must keep a section with id `learns`, because `AVAILABILITY_LINES` targets it (`marketing-content.ts:682-713`).
- **`model-name-guard.test.ts`** (`:40-60`): EXTEND it to the app's copy of the traces. The traces pass today.
- **`marketing-assistant.test.ts`** (`:194-251`, `:375-387`), **`setup-wizard-web.test.ts`** (`:234-246`), **`public-pages.test.ts`** (`:281-311`), **`discovery-seo.test.ts`**, **`rtl-layout.test.ts`** (`:147-155`), **`analytics-consent.test.ts`** (`:361-365`, `:399`), **`motion-css.test.ts`** (`:213-237`), **`i18n-hardcoded.test.ts`** (marketing components are out of scope), **`marketing-api`**, **`marketing-follower-model`** and **`branding`**: KEEP.
- **Availability flags:** `PublicPlatform.availability` is a `Record<AvailabilityKey, boolean>` (`platform.ts:21`). Adding a flag forces edits to every fixture that lists all keys:
  - `marketing-site.test.ts:82-93`, `marketing-journey.test.ts:42-53`, `brand.test.ts:218-229`
  - `scripts/run-marketing-motion-check.mjs:47-58`, `scripts/marketing-motion-sitewide-check.mjs:105-116`

  Showing Recovery rule and Meal planner as "Not on yet" needs no new flag.

## D. Browser checks in CI

### `scripts/browser-check.mjs` (application job, 1440×1050)

- `:47-67` visits all four pages. Each must answer OK, `main#main.mk-main` must have exactly one non-empty H1 (`:70-77`), and the navigations "Main" and "Site map" must exist (`:78-79`; `frame.tsx:70,183`).
- `:80-89` expects /demo tabs: "New pain" shows "Workout paused" and "the trainer is alerted"; "Outside what it was taught" shows "Handed to the trainer". The playground has no such tabs. UPDATE to a playground smoke test.
- Any page error fails the job (`:29`, `:679`).

### `scripts/browser-completion-check.mjs` (same job)

- On / the analytics bar must not show before a scroll and must appear after `mouse.wheel(0, 600)` (`:235-249`). The showcase must not swallow wheel events; the prototype only prevents default on key and click handlers.
- The footer "Analytics preferences" button must work (`:218-232`).
- /pricing second-touch and withdrawal (`:306-352`). KEEP.

### `scripts/marketing-call-check.mjs` (homepage-call job; 390 and 1280 px plus a default context)

- / must have exactly one button named "Talk to Kamran (AI voice)" (`:72-74`, `:207-209`, `:308-310`). `assistant-button.tsx:57` shows it only on /.
- The first turn's page key must be "home" (`:88`).
- `.mk-footer a[href="/about"]` is used for client-side navigation that keeps the call alive (`:104-105`, `:148-153`).
- No horizontal overflow on /pricing at 390 px (`:143`, `:154-157`).
- `.mk-header a[href="/"]` must be clickable on /faq and /pricing (`:206`).
- No page errors (`:353`).
- KEEP. Keep Kamran as a floating button in phase 1: C0's inline pills with the same name would make Playwright's click ambiguous and fail. The field must not cover the button. Consider pausing the field while a call is open, because the check's timing waits (`:82`, `:91-102`, `:135-138`) run on 4-vCPU runners.

## E. Local-only checks (not deploy gates; update them for phase 1)

**`scripts/brand-check.mjs`** (`npm run test:brand`):
- `:45` covers /, /trainer-brain and /pricing.
- `:251-272` and `:324-328`: any visible surface of 12 px or more with luminance below 0.2 fails, except buttons. The ink stage fails this unless `[data-showcase]` is exempted.
- The home first-screen checks rely on the relay (`:367-405`, `:567-569`, `:601`).
- Home limits: at most 400 visible words in `main` outside `.mk-home-calc` (`:551-574`), at most 6 H2s (`:575`), and the relay plays once within 4.5 s and rests by 5 s (`:484-539`).
- Right-to-left relay (`:661-697`) and Arabic overflow at 390 px (`:699-714`).
- The prototype home has about 1,974 static words in `main` (about 1,221 without the `[data-showcase]` subtrees; both counts include both registration variants), so re-measure in a browser.

**`scripts/marketing-motion-sitewide-check.mjs`:**
- Default pages include / and /pricing (`:88`).
- It judges against base build c856d9d: LCP within max(50 ms, 5%) with the same LCP element; CLS within +0.001; no more scroll long tasks; TBT within max(100 ms, 25%) (`:1042-1053`). A redesigned / and /pricing cannot pass the same-element and base comparisons.
- It also checks the relay at 1 s and 5 s (`:944-945`) and the hero arrow hand-off at 2.53 s or later (`:989`).
- UPDATE: use a new baseline or absolute budgets.

**Other local checks:**
- `scripts/marketing-motion-check.mjs` (journey): `:394-401` and `:808-830` cover the home journey band. UPDATE per the journey-band decision.
- `rtl-check.mjs:26-35,524-533` and `capture-app-views.mjs:128-129`: leave as they are.
- e2e harness:
  - `core-features.e2e.ts:109-151`: the key pages answer 200 with one H1, a canonical link, JSON-LD, sitemap and llms entries.
  - `extended.e2e.ts:592-596`: needs "Earnings calculator" or "Commission by band" on / or /pricing. B's pricing page has "Earnings calculator".
  - `public-join.e2e.ts:15-24`: the pages answer 200.

## F. Non-obvious breakages

1. **EISDIR crash:** a `components/marketing/brain/` subfolder crashes the honesty scan (`marketing-site.test.ts:1117-1127`), and the import guard (`motion-sitewide :660-668`) silently skips it.
2. **Name clash:** `components/marketing/showcase.tsx` already exists (the /features screens, referenced at `marketing-site.test.ts:564` and `marketing-journey.test.ts:366`). Don't reuse the name.
3. **`<mark>` ban:** the home bans `<mark` (`:493`), but the field highlights Noura's words with `<mark>`.
4. **Hard-coded brand in the traces:** "trainsyou. Can't switch off." appears 3 times (the safety source). It must use the brand token so a renamed platform works.
5. **Reduced motion:** `globals.css` and `motion.css` skip the marketing root while the switch is "always". The showcase must carry its own `@media (prefers-reduced-motion: reduce)` and `:root[data-reduce-motion="on"]` rules, without that exclusion and outside the three switch-checked stylesheets.
6. **CI runners and the lite tier:** GitHub's 4-vCPU runners make `brain-core.js:107` pick the lite tier. Keep the `?tier=` (`:103`) and `?slow=` (`:130`) test switches in the port.
7. **Trace verifier port:** `verify.mts` imports absolute `/home/user/trainer_what/...` paths (`:6-10`, `:13-14`); make them repo-relative.
   - The client copy currently equals the full copy minus `code` and `basis.refs` (36,883 vs 39,824 bytes); keep a test so they can't drift.
   - The verifier deliberately ties marketing data to product source strings (`brain-plans.tsx`, `brain-check.ts`, `coaching-runtime.ts`, `workspace-live.ts`, `voice-runner.ts`), so a product copy change will fail it.
8. **Scenes on /trainer-brain:** the path gates are in `scenes-head.ts` (`pathname!=="/"`) and `scene-mount.tsx:30`. Automated browsers get no scenes without `?scenes=on`.
9. **Importing helpers:** importing a `*.test.ts` file registers its tests again. Move `cssRules` (`motion-sitewide :83-129`), `physicalRule` (logical-css), the contrast helpers (`brand.test.ts:340-379`) and `MODEL_OR_VENDOR` (`model-name-guard :17`) into a helper module, like `tests/programme-fixtures.ts`.

## G. Docs to update for the showcase exception

- **`docs/features/marketing-motion.md`:**
  - `:14-15` ("nothing is infinite"), `:28` ("always light") and `:29-35` (CSS and Web Animations only; compositor properties only): add a scoped `[data-showcase]` exception covering the continuous canvas loop, reduced motion in both switch modes, a Pause control for auto-play over 5 s, zero frames when off screen, hidden or idle, no CSS or SVG `infinite`, the budgets from `SHOWCASE_DESIGN.md:257-260`, and the ink stage.
  - `:257-266`: add showcases to the "Not switched" list.
  - `:280-287`: amend the accessibility note.
- **`docs/features/scroll-scenes.md`:** `:1`, `:12` ("No other page has scenes"), `:37` ("the path is not `/`"), the files list `:14-31` and the checks `:89-120`, if /trainer-brain gets its pin.
- **`docs/features/marketing-site.md`:** home structure `:527-646`, copy limits `:647-679` (the 400-word rule at `:671` must say how showcase text counts), checks `:680-713`, honesty rules `:346-361`, checks run `:362-402`, and "Not done / next" `:1408+`.
- **`docs/features/brand.md`:** `:18`, `:174` and `:192-194`. **`docs/features/dark-mode.md`:** `:29`. Both need the scoped ink-stage exception.
- **`docs/PROJECT_MEMORY.md`:**
  - `:31` ("New motion must be short, play once…"): add the exception.
  - `:33` ("Waiting for the owner's choice"): record the 27 Oct decision.
  - `:35-39` is stale: it describes the reverted #96 home, and `home-design*.tsx`, `home-design.css` and GSAP do not exist. Rewrite it.
- Per `CLAUDE.md`, the orchestrator records each stage in `CLAUDE_HANDOFF.md` and `docs/COMPLETION_STAGES.md`.

## H. Recommended test strategy for phase 1

### 1. Update in the same PR as the pages, so CI stays green

- **`marketing-site.test.ts`:**
  - Rewrite `:482-619` as the Concept A home contract.
  - Update `:650-656` and `:1004-1005` for the new pricing and Trainer Brain structure.
  - Update `:696-700` for the /demo lede.
  - Make `:1117-1127` recursive.
- **`marketing-motion-sitewide.test.ts`:**
  - Update `:342`, `:442-446`, `:717-721`, `:794-800` and `:831-845` when the relay and demo code go.
  - Update `:574` if scenes extend to /trainer-brain.
  - Make `:658-668` recursive, and add `[data-showcase]` to the never-reveal list checked at `:680`.
- **`marketing-journey.test.ts`:** update `:128-147`, `:236-310` and `:360-371`.
- **`brand.test.ts`:** update `:199` and extend `:437-448`.
- **`logical-css.test.ts`:** drop the relay `ALLOWED` entry.
- **`scroll-scenes-engine.test.ts`:** add any new scene file to `:315`.
- **`browser-check.mjs`:** replace the /demo tabs at `:80-89` with a playground smoke test.
- **Remove the dead code:** remove HeroFlow, DemoScenarios and their CSS in the same PR rather than leaving them dormant under contract tests.

### 2. New unit tests (they run automatically through `npm test`)

**a) `tests/marketing-brain-traces.test.ts`** ports `verify.mts` against the app's copy of the traces, with one subtest per block:
- schema and roster: 25 names, 14 AI specialists and 11 code steps;
- exact honesty strings (`labels.chip`, `labels.subscribers`, `labels.long`, `labels.rates` and so on);
- verbatim wording checked against the product code;
- `redFlagCategories` and the highlighted words;
- 480 `planConfidence` / `planRoute` combinations;
- `reducedLoad` and `reduceWhoopWorkout`;
- `decide()` lanes and variants;
- totals with the recovery flag off and on.

It also checks that the client copy equals the full copy minus `code` and `basis.refs`, scans for model names, hype, the payout provider's name, AI-cost wording and hidden specialties, requires a brand token instead of a literal "trainsyou", confirms the Not-on-yet shelf is meal planner and recovery, and confirms t3 is off by default. It takes about 0.5 s.

**b) `tests/marketing-showcase.test.ts`** checks the CSS and runtime contract:
- every selector in the showcase stylesheet is scoped under `[data-showcase]`;
- no `infinite`, no SVG `repeatCount`, and no JS `iterations: Infinity`;
- only opacity, transform and stroke-dashoffset animate;
- a closed set of tokens, defined once;
- reduced-motion rules exist for both sources and do not carry the always-on exclusion;
- the runtime reads `prefers-reduced-motion` and `data-reduce-motion`, listens for changes, and never reads `MARKETING_MOTION`;
- one animation-frame loop, paused on `visibilitychange`, when off screen, on idle and on Pause;
- no Worker, no WebGL, no external library;
- `[data-sc="pre"]` hiding only under the attribute the loader sets;
- ink-stage contrast: at least 4.5:1 for text, at least 3:1 for controls and lanes.

**c) Server-rendered page checks** in `marketing-site.test.ts` for all four pages:
- registry H1, lede, H2s and FAQs;
- the showcase roots carry the chip and status strings, a named Pause button, buttons for every moment, no images or posters, and t3 dashed or absent;
- DOM order H1, then lede, then call to action;
- registration closed: "Join early access" and no `/signup`;
- renamed platform: no "trainsyou";
- pricing figures computed from `estimateEarnings`.

### 3. New browser check: `scripts/marketing-showcase-check.mjs`

It runs on the production build against the platform stub, with no database. Start it with `MOTION_CHECK_MODULE=./marketing-showcase-check.mjs node --import tsx scripts/run-marketing-motion-check.mjs` (the runner is at `:111-140`), and add `npm run test:marketing-showcase`.

**Judged in CI** (these checks are deterministic):
- With JavaScript off at 390×844, the server-rendered first frame shows Noura's words, the STOP stamp and the Paused bin above y 770. At 375×667 the lanes are visible.
- The H1 is the LCP element at 390 and 1440 px.
- CLS on load is at most 0.001.
- No horizontal overflow at 360, 390 or 1440 px on any of the four pages, and no page errors.
- `[data-sc="pre"]` is cleared within 6 s.
- Counting animation-frame callbacks:
  - frames run while the field is visible;
  - no frames in a 1 s window when it is off screen, the tab is hidden, after Pause, under emulated reduced motion, or with the `trainer_member_motion` cookie;
  - the rest of the marketing motion still runs under the "always" switch.
- No infinite animations inside `[data-showcase]`.
- `?slow=30` makes the watchdog step down a tier.
- Kamran's button on / is not covered.
- /demo playground:
  - knee → "Training paused" and "No AI called";
  - deload → "Waits for you";
  - Low recovery → "Not on yet";
  - free text → "Closest sample: …".
- /trainer-brain with `?scenes=on` pins the anatomy on viewports at least 700 px tall, and shows flat plates under reduced motion.

**Reported in CI, judged only locally:** p95 frame gap of at most 20 ms and engine work of at most 4 ms per frame, at 4× CPU throttle with `?tier=full`, plus TBT and INP.

**Where in CI:** add it as a step in the existing homepage-call job after the call check (`check.yml:61-65`). That job already runs the apt mirror script, `npm ci`, the build and the Playwright install, and uses about 5 of its 40 minutes. Adding a step creates no new job name. A separate job must start with `sh scripts/ci-apt-mirror.sh` (`PROJECT_MEMORY.md:44`).

### 4. Verification order

Run the touched test files, then typecheck, then `npm run build`, then the new browser check and `run-browser-check.mjs`. Run one full `npm run check` at the milestone, then let CI run on the PR. Refresh `test:brand` and `test:marketing-motion` locally; they are not gates.

## I. Decisions that change which tests move

1. **Home journey band:** keep it as the page's one pin (`SHOWCASE_DESIGN.md:475`) or make it a visitor-controlled stepper that is never pinned (`PLAYBOOK.md:560`). The two specs conflict.
2. **Scroll scenes on /trainer-brain:** extend them for C's pin (`SHOWCASE_DESIGN.md:287,559,619`).
3. **"Teach your AI — free" call to action:** set it per page in the registry (`site.tsx:82-87`) and keep `claimCta`. `public-header.tsx:44` uses `claimCta` on /login and /signup, which stay untouched.
4. **Kamran:** keep the floating button in phase 1, or adopt C0's inline pills (`PLAYBOOK.md:451`) and update the call check.
5. **"Available soon" → "Not on yet" sitewide** (`PLAYBOOK.md:465`): this wording is test-encoded on /features (`marketing-site.test.ts:456,1077`; `marketing-journey.test.ts:323`). Do it in phase 2, or include those test edits now.
6. **Home 400-word budget:** exclude `[data-showcase]` text (as `.mk-home-calc` is) or count it. Also decide the H2 cap: the limit is 6, the prototype has 9.
7. **Ink stage:** confirm it is part of the accepted exception. It sits in the same decision (`SHOWCASE_DESIGN.md:823`) but contradicts the "always light" rule in the brand docs and tests.
8. **Noura's highlighted words:** use `<mark>` (and narrow the home `<mark>` ban to the H1) or switch them to `<span>`.