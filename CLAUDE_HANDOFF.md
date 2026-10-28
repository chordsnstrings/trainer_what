# Claude handoff

## Work in progress

### Status on 28 October 2026 (Claude): phase 1 of the marketing revamp, part 1 done, part 2 starting

**The owner chose the recommendation** ("Go with your recommendation", 27 Oct):
- **What gets built:** Concept A "Live Brain", plus C's "Anatomy of one decision" on /trainer-brain, C's Never list and source badges, and B's pricing page and calculators.
- **Defaults accepted:**
  - publish "14 AI specialists and 11 code steps" with "How we count";
  - names as designed;
  - Recovery rule and Meal planner "Not on yet";
  - no founder note and no card-processing rate.
- **Rollout:**
  - phase 1: home, /trainer-brain, /demo and /pricing, as their own PR, checked and deployed;
  - phase 2: every other page;
  - phase 3: Arabic, tracking and A/B.

**Spec:** `docs/marketing-revamp-2026-10-26/phase1/PLAN.md`.

**Branch and PR:** `claude/repository-overview-osejlw`, draft PR #105.
- In-progress work is saved as `WIP … [skip ci]` commits through `scratchpad/wip-commit.sh`.
- The 2-hour autosave loop has ended and is not restarted.

**Done (part 1, workflows `wf_dd1f463e-103`, `wf_83e62d78-b94` and `wf_e889164e-24d`).** Reports are in the session scratchpad as `report-wp*.md`.
- **WP0 foundations:** proof parts, stylesheets, contracts and the call to action.
- **WP1 Brain core:** traces tested against the real domain functions, render/runtime split and the island. `marketing-brain-traces` 14/14, `marketing-showcase` 15/15.
- **WP6 /pricing:** `marketing-pricing` 8/8; the calculators equal `estimateEarnings`; CLS 0.
- **WP2 home field, board and receipt:** `marketing-field` 8/8.
  - At 4× CPU throttle, p95 frame time is 16.8 ms at 390 px and 16.7 ms at 1440 px; CLS 0.00025.
  - Small copy change: the safety tooltip names the platform's rule.
- **WP3a anatomy:** pinned, flat, reduced-motion and no-JavaScript paths pass.
- **WP3b playground:** all 12 moments land in the lane `decide()` gives; CLS 0; p95 16.8 ms at 4× throttle; `marketing-anatomy-play` 23/23.
- First-frame Brain CSS is 16.81 of 18 KB.
- Saved as WIP commit `1aeba0a`.
- **Not yet run:** a Next build of the engines in a page. That happens in WP4 and WP5.

**Now running: part 2, workflow `wf_2044b74e-e8b`, launched 02:35 UTC on 28 Oct.**
1. WP4 home and WP7b browser checks side by side. WP7b builds in its own worktree, so only one agent uses Next in the main tree.
2. WP5 /trainer-brain and /demo.
3. WP7a clean-up (full `npm test`).
4. WP7b CI step.
5. WP8 docs.

**Progress at 06:45 UTC:**
- **WP4 home is done** (`0e836cc`).
- **WP5 /trainer-brain and /demo are done** (`0dfc1dd`).
- **WP7a is done:** dead code removed.
  - `site.tsx` went from 1,335 to 885 lines; `marketing.css` is 2.1 KB smaller gzipped.
  - Typecheck and build pass.
  - Full `npm test`: 2,061/2,064. The 2 failures were OCR tests, because this container lacks `tesseract`, which CI installs; with it installed they pass 29/29.
- **WP8 docs are done:** `docs/features/brain-showcase.md` is new; `marketing-site.md`, `marketing-motion.md`, `scroll-scenes.md`, `brand.md`, `dark-mode.md`, `PROJECT_MEMORY.md` (with the deploy reconciliation) and the revamp README are updated.
- **WP7b round 1 is done.** Round 2 is running: the CI step is in `check.yml`, and the final runs are on the main tree.
- **Fix round 1, F1, is done** (`22d1a1a`):
  - the board reserves its lanes' room, so CLS on `/` at 390 px went from 0.15271 to 0.00040;
  - the walkthrough dots' contrast is fixed; the brand check is back to its 36 pre-existing failures;
  - `.mc-new` and `.mc-demo` are hidden in the still frame by design.
- **Fix round 1, F2, is running:** the anatomy mount's long task and the still-frame control reset.
- **Lead:**
  - `compose.yaml` now passes `MARKETING_SHOWCASE` to `web`, so the off switch works in production through `runtime.env` plus a re-apply. WP8 found it was unwired.
  - The compose render test pins it; the deployment suite passes 160 tests, 3 skipped.
  - The comment and the docs say "re-apply", not "restart".
- **Fix round 1 is done** (`wf_b98be2ed-50e`).
  - F2: the anatomy mount's worst long task went from 291 ms to 68 ms or less at 4× CPU.
  - F2: still-frame showcase controls keep their own look; `brain-stage.css` gained reset rules.
  - F2 blamed the member-shell rule `details:has(…)::details-content` for whole-page restyles. Lead check (`scratchpad/hasexp/real.cjs`), on the real built CSS with the /trainer-brain snapshot: one insertion costs about 5 ms at 4× CPU with the rule, without it, or rewritten. Not reproduced on a still page, so it must be measured on the running page before any member-app CSS changes.
- **Review workflow running:** `wf_aa89a290-849`, five dimensions, each with an adversarial verifier.
- **Part 2 is complete** (`wf_2044b74e-e8b`); WP7b round 2 reported.
  - **CI step:** "Brain showcases on /, /trainer-brain, /demo and /pricing" is in the `homepage-call` job, after the call check, on ports 3241/4241. The job limit went from 40 to 50 minutes.
  - **Showcase check:** two final timed runs passed, in 375 s and 376 s.
  - **Brand check:** 36 failures, identical to `4f35e5c`.
  - **Motion check:** found a 0.048 CLS race on `/trainer-brain` at 1366 px. The lead applied WP7b's tested fix: a `rel=expect` marker at the hero's end, as on `/`. It gave 0 shifts in 40 loads; tests pass 33/33; documented in `marketing-motion.md`.
  - **Reported over budget on a busy machine,** to measure again quietly at the milestone:
    - field mount long task: 120 ms;
    - `/` blocking time: 406–484 ms, against a 326 ms baseline plus 100;
    - `/trainer-brain` playground p95: 83 ms at tier minimal.
- **Review findings** (`wf_aa89a290-849`, stopped after the five finders): 62 findings, saved in `scratchpad/review-findings.json`.
  - Pages and honesty, 14:
    - blocker: `llms-full.txt` and the assistant facts drop "Never" from the never-list lines;
    - the publish status is gated wrongly on payouts;
    - unmatched free text in the playground falls back to "Squats felt easy" and is "sent", even for red flags;
    - "checked against your test cases" is untrue for the first release;
    - voice and nutrition say "Try it on yourself" while their providers are off.
  - Engines, 16: for example the What-if STOP stamp leak, and the hero frozen after a hidden tab.
  - Accessibility, 23: for example the receipt focus trap, 320 px reflow and forced colours.
  - Performance, 6. PERF-1 is the root cause of the slow frames: the root-level `:root:has(...)` theme and shell rules restyle about 900 elements on every DOM insertion after scrolling. Field p95 goes from 16.8 to 66–117 ms, and the playground drops to 12 fps at 4× CPU. Deleting those rules gives 16.8 ms.
  - Security, CI and tests, 3: all minor or nit.
- **Fix round 2 is running** (`wf_f0fd9acb-b51`). Each finding is reproduced before it is fixed, and the result is reported per id.
  - First, in parallel:
    - D: replaces the root `:has()` rules with `<html>` classes, with no visual change across shells and themes;
    - C: pages, copy and honesty.
  - Then, in parallel: A1 (field, board, receipts) and B (anatomy, playground, data, render).
  - Last: A2 (core, head, island, the showcase check, tests).
  - Assignments are in `scratchpad/fix2-args.json`.
- **Fix round 2, C (pages, copy, honesty), is done** (`6b50ea6`, `e1aa4bc`): all 13 of its findings confirmed; 11 fixed, 4 of them partly.
  - **PG-1 blocker fixed:** the never-list lines are whole sentences that start with "Never".
  - **Status gates follow the product's go-live checks:**
    - publishing needs sign-ups, payments and the model, not payouts;
    - teaching needs the model;
    - the voice add-on needs voice and payments.
  - **"Checked against your test cases" claims corrected:** the first "Waits for me" release goes live without a check.
  - **/pricing:**
    - states the price minimums from `MEMBERSHIP_MINIMUMS`;
    - "How you earn" carries "Not on yet" chips;
    - `llms-full.txt` and the facts carry the status and offer lines.
  - **Checks:**
    - a flag-matrix render scan: 337 renders, 0 problems;
    - targeted tests 237/237; typecheck passes;
    - the showcase check passes, with CLS 0.00039.
  - The FYI copy list is in `scratchpad/fix2-C.json`.
- **Fix round 2, D (root `:has()` rules), is done.** PERF-1 is fixed.
  - The code landed in WIP commits `6b50ea6` and `b8f9def`.
  - `components/root-marks.tsx` marks `<html>` with `data-shell`, `data-scheme` and `data-open` from each surface. It uses an inline SSR script and a layout effect, so client navigation is handled too. No stylesheet hangs `:has()` on `:root`, `html` or `body`, and a test guards it.
  - **Performance at 4× CPU:** the field after a scroll went from p95 83 to 16.8 ms; a playground run from 100 to 16.7 ms; the playground mount from long tasks of `[161,76,139]` to none.
  - **No visual change:** 130 before/after comparisons. 126 are pixel-identical and 4 differ only in relative-time text.
  - **Dark and phone checks:** `test:dark` fails 48 identically before and after. `test:phone` had 11 failures before and 9 after; those 9 occur in both builds.
  - **Tests:** 238/238 across 23 unit files, plus 82/82.
  - **Left for A2, in the notes:** the consent bar's first appearance restyles the whole document once, and the watchdog never steps back up.
  - **Docs to update:** `brand.md:362` and `dark-mode.md:108` still name the old selectors. The "paint" explanation for the playground and `/demo` slowness was wrong (it was `:has()`); correct it in `brain-showcase.md` and `COMPLETION_STAGES.md:34`.
- **Lead follow-ups done:** `registrationOpen` is passed to `llmsFullTxt` and `marketingAssistantFacts`; the traces' Examiner line now reads "Sending on its own needs a pass".
- **Docs to update at records time:**
  - PLAN §1.5's publish row and PLAN line 610;
  - `marketing-site.md:1535` (walkthrough flags);
  - `PROJECT_MEMORY.md:54` (publishing is blocked by the payments, model and legal checks, not payouts).
- **Owner FYI, a decision:** "Teach your AI — free" still shows while the model is off, because PLAN ties it to sign-ups only.
- **Phase 2 notes, pre-existing `/faq` copy:**
  - "How does money reach me?" is in the present tense with no flag;
  - "What does a subscriber get" mentions nutrition and voice with no flag;
  - `PRICE_FAQ` omits the minimums.
- **Next:**
  - an adversarial review of the fix diff;
  - the milestone verification on a quiet machine;
  - a push without `[skip ci]`, CI to green, then merge, deploy and the live check.
- **Left for the review and fix stage:**
  - the field's plan slider snaps back if another control is touched within its 120 ms debounce;
  - `/` total blocking time measured 444 ms on a loaded machine, against a 326 ms baseline plus a 100 ms allowance; measure again at the milestone;
  - add a cross-reference in `kamran-assistant.md`.

**Lead decision for the owner's FYI list:** the "Can subscribers pay me today?" answer no longer says "Today you can join". It now reads "With an account you can already set up your page and app, and teach and test your AI", which stays true while sign-ups are closed.

**Next:**
- milestone verification (§4.6);
- review workflow, then fixes;
- PR #105 to green, merge, deploy (`scripts/watch-release.sh`) and a live check of the four pages;
- records.

**Deploy reconciliation, to be recorded before merge:** this deploy rests on the owner's explicit 27 Oct instruction, "checked and deployed". It does not rest on the coding handoff.

**Waiting on the owner:** nothing. Delete the stray `/oq-daily.log` when convenient.

### Home page as the owner's HTML design: live since 22:47 UTC on 25 October 2026 (Claude, checked 04:10 UTC on 26 Oct)

**Live.**
- PR #97 (the WHOOP check's Dubai clock fix plus records) merged as `3142b59`.
- `main` run 40237821779 passed at 22:38 UTC on 25 Oct, and "Verify serving release" (run 40241155496) passed at 22:47 UTC.
- The live release header is `3142b594da68c3a01a6cbc8fdb5846ceeb5c1ca2`. It carries #96 (the owner's HTML design) and #97.
- At 04:10 UTC on 26 Oct, `https://trainsyou.com/` answered 200 (142 KB) with the design's `.tyh` markup, the title "AI Coaching Platform for Personal Trainers | trainsyou", and `data-mk-motion="always"`.
- **Not recorded as done:** the planned post-deploy comparison (the live home check, the crawl and the route snapshot against the pre-deploy snapshot). Run it next if a full live check is wanted.
- No PRs are open.

The rest of this section is the 25 October record, kept as written.

#### 25 October record: merged, deploy blocked by a pre-existing WHOOP check, fix PR next (Claude, 21:20 UTC)

PR: [chordsnstrings/trainer_what#96](https://github.com/chordsnstrings/trainer_what/pull/96). The owner approved it on 25 October: "Approved but Make sure that nothing form the implementation stop working". Squash-merged as `af457bde92cdab27cee3598c16d408cbb7b6e014` on `main` at about 21:00 UTC. Its tree is identical to the checked PR head `d852870`.

**Not live yet.** The live release is still `e4e2f8c`.

**Why:** `main` run [40233449380](https://github.com/chordsnstrings/trainer_what/actions/runs/40233449380) failed in `subscriber-ui`, at the WHOOP journey (`whoop-training-check.mjs:278`, waiting for the workout start). The host deploys only after a green `main` run.
- **Cause, pre-existing and time-dependent:** `seed-demo.ts` schedules the member's programme from Dubai's date, but the check's browser uses the runner's UTC clock. Between 20:00 and 24:00 UTC, Dubai is a day ahead, so Today shows a rest day with no start button.
- **Evidence:** reproduced 3 of 3 times locally on `af457bd`; the baseline `e4e2f8c` fails at the same line; a probe screenshot showed "Rest day · Next: Strength foundations · Tomorrow".
- **Fix:** `timezoneId: "Asia/Dubai"` on the check's browser contexts, as `capture-app-views.mjs` already does. The full WHOOP journey then passed 2 of 2 times locally at about 21:15 UTC.
- Re-running jobs would not help before 00:00 UTC, and Claude gets a 403 on re-runs anyway.

**Running now:**
- [PR #97](https://github.com/chordsnstrings/trainer_what/pull/97) with that fix, the release records, and a correction (GSAP runs only on `/` but downloads on every page with the shared bundle, about 42 KB gzip, about 5 %);
- the rest of `main` run 40233449380 (`application`, `postgres-and-container`, `ux-spacing`);
- `scripts/watch-release.sh` in the session, polling `https://trainsyou.com/api/v1/ready` for `af457bd`. It needs a new target once the fix merges.

**Done for the live check:**
- the pre-deploy snapshot: the crawl (39 pages, 41 links, clean) and 28 other routes;
- a 44-check HTTP-only home check, which passed against the local build of `af457bd`.

**Next action:**
1. Get the fix PR's CI green and merge it.
2. Watch the new `main` run, the deploy and "Verify serving release".
3. Run the live home check, the crawl and the route snapshot, and compare them with the pre-deploy snapshot.
4. Record the result here and in `docs/COMPLETION_STAGES.md`.

**PR CI:** all 8 jobs green on `ddd3127` ([run 40197740852](https://github.com/chordsnstrings/trainer_what/actions/runs/40197740852), 14:05 UTC) and again on the final head `d852870` ([run 40200671984](https://github.com/chordsnstrings/trainer_what/actions/runs/40200671984), 14:39 UTC, docs only):
- application;
- postgres-and-container;
- homepage-call;
- subscriber-ui;
- ux-spacing;
- daily-workflows;
- compose-topology;
- wildcard-edge.

The PR merged cleanly and had no review threads.

The owner asked for three things:
- check the current implementation;
- build the home page from their uploaded HTML;
- review it for SEO, LLM SEO and conversion.

Their answers:
- **Checks:** a full check.
- **Design:** "Exact copy of the HTML", with its GSAP 3D scroll motion.
- **Additions:** none.
- **Release:** a PR first, and the owner approves before any merge or deploy.

Branch `claude/confident-wozniak-n32to1`. The record is `docs/HOME_DESIGN_2026-10-25.md`, the stage entry is in `docs/COMPLETION_STAGES.md` (2026-10-25), and the standing rule is in `docs/PROJECT_MEMORY.md`.

**Checks of the current implementation, before any change (`e4e2f8c`):**
- typecheck passed;
- `npm test`: 1,964 passed, 0 failed, 1 skipped;
- build passed;
- live crawl of 39 pages and 41 links: clean;
- `main` CI for that commit: green.

**What was built:**
- `components/marketing/home-design.tsx`, `home-design-runtime.tsx` and `app/home-design.css`:
  - generated from the file, with the `tyh-` prefix and every rule scoped under `.tyh`;
  - GSAP 3.15.0, used on `/` only;
  - the design's Inter self-hosted, and its Pace lockup.
- The registry home entry carries the design's words. The JSON-LD adds SoftwareApplication, a HowTo from the 3 visible steps, and speakable selectors.
- Robots on indexable pages gets `max-image-preview:large` and `max-snippet:-1`.
- Two visible additions: an "Analytics preferences" footer control (consent withdrawal) and `overflow-x: clip`.
- The meta description is trimmed to 155 characters.

**Verification on this head:**
- Fidelity against the owner's file, at 4 widths with and without motion:
  - all 745 elements match in tag, class, text, links and attributes;
  - computed styles match apart from 33 `start`/`end` equivalents;
  - reduced-motion screenshots differed by 0 pixels before the footer control and now differ only on the copyright line;
  - the motion differences equal the file's and the build's own raster noise.
- The behaviour check passed.
- typecheck, build, and `npm test` (1,964 passed, 0 failed, 1 skipped) all passed.
- These local checks passed: CI's `run-browser-check`, the homepage call check, marketing motion (journey 209/209 and site-wide), and the brand check for all public pages and the 8 home checks.

**Pre-existing local-check failures, identical on the baseline and not this change's:**
- brand and RTL sign-in waits for `/trainer` while the seeded coach lands on `/admin/settings`;
- dark workspace logo, member-app and coach-site dark-mode expectations;
- `onboarding-presence` contrast of 4.30:1;
- the dark check fails only on member-app screens.

**Waiting on the owner:** nothing required.
- Optional: the conversion items they declined for now (social proof, a card-fee line, the claim-your-address field).
- Optional: a later cleanup of the dormant previous-home code.

**Left by the session (owner may delete):** two empty files, `/rtl.log` and `/dark.log`, at the container root. A misgrouped shell command created them, and the safety check blocked removing files at `/`.


### Hero "trains" sweep — live, 23 October 2026 (Claude, 06:45 UTC)

Owner: "Hero trains highlight had to be there". The Phase 3 sweep went back in, exactly as built on 22 Oct:
- `.mk-mark::before` holds the fill; `@keyframes mk-sweep` grows it with `scale: 0 1`, once, 420 ms after a 120 ms delay, from the left;
- the static test is in `tests/marketing-motion-sitewide.test.ts`.

Checks run:
- node 123/123;
- `npm run build`;
- browser check, 6 of 6 cases: 390, 1366 and `?lang=ar` at 390, each with no preference and with reduce. In each it plays once, rests with the Pace fill and ink text, and CLS is 0;
- LCP over 10 loads per width: median 400 ms (390) and 524 ms (1366). Both are below the 22 Oct "before" medians, so the earlier +192 ms was noise.

**Live since 06:36 UTC on 23 Oct** as `df12b532490ad71d877763c4115793999ca84572` (PR #94, together with the allow-all tool settings).
- `scripts/watch-release.sh` reported LIVE.
- The live home page links the CSS chunk that carries `mk-sweep`, and its H1 has `<span class="mk-mark">trains</span>`.

**CI note:** the main run for the records commit `9edc68c` (#93, docs only) failed once in `run-browser-check.mjs`.
- The failing assertion: "member app 390x844: the bar covers the end of the page (content ends at 758.5, bar starts at 638.1)" (`assertConsentBar` in `scripts/browser-completion-check.mjs`).
- The same code passed on every other run that day (PR #92 and #94, main `ca93c63` and `df12b53`), so it is intermittent.
- The likely cause is a race: the `.consent-bar-space` spacer gets its height from a `ResizeObserver` after mount, and the check scrolls to the bottom 250 ms after the bar's rise.
- **If it recurs:** make the check wait until the spacer's height equals the bar's before measuring, or give the spacer its height on first render.

### Tool permissions — 23 October 2026 (Claude)

Owner: "Always allow all tool usage. It's taking too long".
- `.claude/settings.json` now allows every tool. That covers Bash, Read, Edit, Write, Glob, Grep, web fetch and search, agents, workflows, skills, and the GitHub, Claude Code Remote and Claude Docs connectors.
- The three earlier release-watch rules are kept.
- Cloud sessions cannot use bypass mode. For no prompts at all, the owner should also pick **Auto** in the mode dropdown next to the prompt box.

### Marketing motion — live, 23 October 2026 (Claude, 05:05 UTC)

**Live since 04:25 UTC on 23 Oct.** Live release is `ca93c6380a34ed8f137e05999126d3fff1700736` (#92). It carries:
- #89, the motion work (`827fb2d`);
- #90, its records;
- #91 and #92, the CI time limits.

The "Verify serving release" run succeeded at 04:25:29 UTC. A live fetch at 05:00 UTC confirmed:
- `data-mk-motion="always"` on `/`, `/how-it-works`, `/pricing`, `/features` and `/earnings-calculator`. On `/` it appears twice: the `.mk` root and the assistant host.
- `<link rel="expect" … blocking="render">` on `/`.
- Nothing on `/login`.

**What shipped** (owner decisions: Variant B, hero additions, speed cost accepted):
- Short marketing motion now plays for every visitor. The pinned scroll scenes still follow reduce motion.
- Concept micro-animations on their own triggers.
- The hero CLS fix.
- An event-driven scroll-scenes loop with an idle stop.
- The "trains" sweep was reverted, so it is not live.
- Switch back with `MARKETING_MOTION = "device"` in `apps/web/components/marketing/motion-mode.ts`.
- Checks and details: the 2026-10-22 entry in `docs/COMPLETION_STAGES.md`. The switch rule is in `docs/PROJECT_MEMORY.md`.

**Why it took until 23 Oct:** three `main` runs on 22 Oct were cancelled by job time limits, with every test passing up to the cut-off.
- `apt-get` was downloading from a slow Ubuntu mirror (`azure.archive.ubuntu.com`, about 40 KB/s against 9.6 MB/s normally).
- The mirror had recovered by 03:05 UTC on 23 Oct (25 MB/s).
- #91 and #92 raised the limits: `application` to 75 min, and the other setup-heavy jobs to 30–40 min.
- The host deploys `main` only after that commit's `check.yml` push run succeeds (`approved_head` in `infra/digitalocean/common.py`).
- Claude gets a 403 on job re-runs. Only the owner can click "Re-run failed jobs".

**Waiting on the owner (optional):**
- Whether to cache CI's apt downloads, or trim the shared apt line, so a slow mirror cannot block deploys again.

**Next action:** none for this stage.

### Meal-photo estimates: switched on live after a passing Seed 2.0 Pro test — 20–21 October 2026 (Claude)

Owner asked why meal-photo upload doesn't work, noting that ModelArk has Skylark models with vision. No code or settings were changed. The feature is built (`apps/api/src/meal-capture.ts`, `estimateMealPhoto` in `packages/providers/src/food.ts`) but switched off live.

- **Switches off.** Super admin Settings show Application → `MEAL_PHOTOS_ENABLED=false` and AI model → `MODEL_VISION_ENABLED=false`. Both must be true.
- **Which model is used.** Meal photos use the one active AI model: profile `current-settings`, `seed-2-0-pro-260328` on ModelArk, whose image-input setting (`vision`) is false. There is no separate vision-model setting. The setting's help text says to enable it only for a model with confirmed image support, and image support with Seed 2.0 Pro has not been tested.
- **Per subscriber.** Each subscriber also needs Workout + nutrition membership, a completed food profile, and three consents: nutrition, AI, and separate photo analysis. Photo estimates count toward the 40-per-day subscriber AI limit, and their cost is billed to the trainer's AI fee (task `meal_photo_estimate`, which is not on the free setup list).
- **Option A tested, 21 October (owner supplied the photo and the ModelArk skill key).** The owner's photo (penne in a creamy sauce with sun-dried tomatoes, black olives and herbs) was run through the app's own `sanitizeMealPhoto` and `estimateMealPhoto` against `seed-2-0-pro-260328`, with the two switches set to on only inside that test process. Live settings were not changed.
  - The reply **passed the app's schema**: 4 items (penne in a creamy herb sauce ~380 g/620 kcal, sun-dried tomatoes, black olives, herb garnish), all marked uncertain, plus 4 follow-up questions and a note to review before saving.
  - It took 26.9 s, using 438 input and 1,726 output tokens (1,135 of them reasoning), about USD 0.0054.
  - Macro totals show as unknown until the subscriber fills in one null (the model left olive protein null instead of guessing).
  - Risk: output used 1,726 of the 2,500-token photo budget, so a busy plate could run out.
  - Skylark embedding vision returns vectors, not food names or nutrients, so it cannot do this task.
- **Switched on, 21 October (owner: "Turn it on for me").**
  - 01:55:34 UTC: AI model → `MODEL_VISION_ENABLED=true` saved (revision 2).
  - 01:55:35 UTC: Application → `MEAL_PHOTOS_ENABLED=true` saved (revision 8).
  - The active profile `current-settings` inherits these values (`INHERITED_KEYS`).
  - **Side effect, fixed:** a saved provider setting stays inactive until its last test matches the new revision (`isActive` in `platform-settings.ts`). All AI was therefore paused from 01:55:34 until Claude re-ran the AI model test, which verified revision 2 at 01:57:33 UTC (about 2 minutes, roughly 6 AM UAE).
  - Verified: as the test subscriber, `GET /api/v1/nutrition/captures` now returns `photosEnabled: true`.
  - That test client still has no nutrition entitlement or photo consents, so it cannot upload yet. A subscriber with workout + nutrition membership sees the option after granting photo permission.


### Subscriber CI and functional polish — implementation and release tracking, 20 October 2026

Owner approved the light subscriber concept: “better. let's get it done.” Base `526c0fbb61832a9b4a3445bb4de8b20cd38aa30f`; branch `work/subscriber-polish-2026-10-20`. The actual app now implements CI White/Ink/Paper/Pace, local Inter Display, measured contrast and restrained motion. WHOOP has dedicated recovery/rules views and separate connection/workout permission. Voice guidance has its own paid add-on journey; eligible monthly memberships have exact-amount upgrade review and payment confirmation. Ordinary workout edits and paused/running rest timers restore safely. Existing prescriptions, offline logs, nutrition, bookings and music remain connected. The latest request supersedes the historical prohibition on package changes. Prepaid terms retain their price/duration and use existing module passes; overlapping purchases and different programme lengths remain guarded.

Production build and TypeScript passed. The focused suite passes payment isolation, exact-price review, refusal versus unknown outcomes, post-dispatch read failure, workspace closure, repeated confirmation, reconciliation and workout restoration. Local browser checks pass actual recovery rules/consent/reload, standard/guided adjustment receipts, draft/paused-timer restoration, upgrade review/pending controls, Arabic layout and reduced motion. Rendered text minimums: recovery 5.31:1 (320/390/1280px), voice 5.87:1. Screenshots were inspected, including enlarged text; inherited switch sizing, canvas color and narrow notices were corrected. An initial full local run reached 1,950 tests (1,938 passed, 7 failed, 5 skipped): translation/directional/timing assertions and fixtures affected during edits were corrected and targeted checks rerun. Exact final-head CI is the release gate; no failed gate is waived.

Implementation and release are tracked in [PR #84](https://github.com/chordsnstrings/trainer_what/pull/84). Its release receipt records the final checked head, main SHA, CI results and exact serving proof; consult that receipt for current deployment status instead of treating this source checkpoint as a live claim. The first PR run passed subscriber UI, daily workflows, spacing/light-dark/Arabic, homepage calls and infrastructure checks, but PostgreSQL found that bigint prices arrive as strings. The eligibility comparison now normalizes and validates the database amount, with a regression covering both numeric and string prices and rejecting unsafe values. The corrected head must pass every normal gate before merge; the established main pipeline then verifies the serving release. No live purchases, voice/music generation or production test-account mutations were performed. Detailed scope and financial contract: `docs/SUBSCRIBER_CI_2026-10-20.md`. No physical-device acceptance or live-provider qualification is claimed.

### Daily UX workflows — live, 19 October 2026

Owner: “complete all.” Implementation, merge, deployment and exact serving verification are complete. The final release is **`f67ce8de69310b9eb6a9972919eb33769a165cda`**, [verified serving](https://github.com/chordsnstrings/trainer_what/actions/runs/39286492105) at **2026-10-19T16:42:26.4808131Z** with HTTP 200. [PR #79](https://github.com/chordsnstrings/trainer_what/pull/79) delivered the broad workflow audit, [PR #80](https://github.com/chordsnstrings/trainer_what/pull/80) completed website draft retention and phone action visibility, and [PR #81](https://github.com/chordsnstrings/trainer_what/pull/81) recorded the sanitized handoff. Application merge `b65051ae69798d7446a549eb7a22ef4eebc4683b` and checked PR head `e6f73759194f0fee79f4799e933aae99ad6c14bf` share tree `ef5289dfc550deb081040d212ccf94facf25a652`. The final serving commit includes only the documentation changes from [PR #81](https://github.com/chordsnstrings/trainer_what/pull/81); application, test and workflow files are identical. The first main run eventually finalized successfully after delayed status reporting. The documentation checkpoint then passed its own full main validation. No failed gate was waived.

Trainer **Today** prioritizes real urgent work, upcoming bookings, teaching and business actions, with a dedicated **Inbox** and phone client cards. The client hub keeps the selected client across messages, plans, nutrition, coaching context and membership. My Brain presents the next teaching/review action and an early private preview while preserving qualification gates. Subscriber **Today** keeps the current workout, resume or hold first, followed by optional dated WHOOP context, meal/log shortcuts and factual weekly progress. WHOOP connection, training permission, freshness and the actual server-confirmed adjustment remain distinct.

Nutrition now has five task groups, current-day selection, meal-scoped swaps and remaining-first groceries with recoverable purchased items. Music has compact persistent controls. Onboarding completion actions stay visible, Arabic controls use the selected locale and members see their coach’s identity. Joining preserves safe, expiring, coach-scoped offer intent through authentication/recovery; checkout uses current terms and correct prepaid totals/nonrenewal. Bookings lead with the schedule, cancellations require review, accepted writes survive read failures and support opens the accepted conversation. Phone Website Studio edits the existing versioned draft; preview/publication stay explicit and resizing preserves unsaved changes.

All nine original PR #79 gates and all eight original main jobs passed. PR #80 passed all eight [checks](https://github.com/chordsnstrings/trainer_what/actions/runs/39267441115); the final serving commit passed all eight [main jobs](https://github.com/chordsnstrings/trainer_what/actions/runs/39280780392). Final main application: **1,940 passed / 0 failed / 5 skipped**; PostgreSQL: **1,939 passed / 0 failed / 6 skipped**. Original conversation: **151 passed / 0 failed**, plus browser journeys. Actual browser navigation/save/reload, phone/desktop/Arabic layouts, WHOOP receipts, nutrition swaps, joining/commerce and editor behavior were verified; representative screenshots were inspected. Earlier failures were corrected and no gate was waived.

Coverage: [25 findings and 51 page/workflow reviews](docs/UX_WORKFLOWS_2026-10-19.md). Exact evidence: `docs/UX_WORKFLOWS_RELEASE_2026-10-19.json`. The 51 entries are a coverage map, not 51 new screens. No measured conversion/retention gain or physical-device acceptance is claimed. No migration or dependency was added; tests used isolated synthetic providers/accounts. Real WHOOP authorization remains the member’s action, separate from permitting recovery-based workouts. Music was already complete at 240 tracks/eight playlists; generation was not restarted.

The downloadable `trainsyou-ux-ui-audit-2026-10-19.html` was refreshed and saved as version 2 on 20 October 2026 after the workspace reconnected. It preserves all 25 findings, 51 page/workflow reviews and both fictional interactive concepts, adds a completion note to every finding and page, and links the verified application release. Original observations are labeled as historical context. All internal links and unique anchors validate, both unchanged scripts pass syntax checks, and the existing 24 state/control checks pass. These report checks do not claim a new browser rendering pass or a new application release. The earlier report remains in version history; no requested report work remains. This final documentation-only receipt records the verified serving commit above and follows normal automatic main checks separately; it makes no new application behavior claim. The UI request has no remaining implementation or deployment work.

### Music library complete — prior release

The existing music task is complete: 240 approved tracks across eight full playlists, delivered before this UX work. [PR #77](https://github.com/chordsnstrings/trainer_what/pull/77) fixed planning stalls. Failed or interrupted plans use standard arrangements without a new AI retry, with code-built explanations. Lifetime budgets were removed in PR #73; daily limits and reconciliation of uncertain paid intents remain enforced. This UX task keeps compact persistent workout controls and does not restart generation.

### WHOOP integration — live; members authorize their accounts

The recovery/training integration from [PR #71](https://github.com/chordsnstrings/trainer_what/pull/71) is already live. Trainer rules are in My Brain → Plans. Members connect in Connections and separately enable recovery-based workouts. Fresh scored recovery can make bounded reductions when a new workout starts; stale, unscored, revoked or unlinked readings do not automatically adjust training. Started sessions retain their prescription. Raw WHOOP readings remain outside model prompts. Real member account authorization and physical-device acceptance are distinct from isolated CI coverage.

### Continuing earlier work

Start with `AGENTS.md`, the current task above and `docs/PROJECT_MEMORY.md`. Feature documents under `docs/` retain detailed implementation contracts and release receipts. Earlier handoff history remains in [the pre-checkpoint Git snapshot](https://github.com/chordsnstrings/trainer_what/blob/b65051ae69798d7446a549eb7a22ef4eebc4683b/CLAUDE_HANDOFF.md). This shorter current handoff does not override earlier product decisions; it avoids republishing account/contact details and unrelated operational history.
