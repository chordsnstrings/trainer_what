# Claude handoff

## Work in progress

### Home page as the owner's HTML design: in progress, 25 October 2026 (Claude)

The owner answered the four questions:
- **Checks:** a full check.
- **Design:** an exact copy of the HTML, including its GSAP 3D scroll motion.
- **Additions:** none ("as it is now").
- **Release:** a PR first, and the owner approves before anything merges or deploys.

Branch: `claude/confident-wozniak-n32to1`. Nothing is merged or deployed.

**Baseline (before any change), all passed:**
- typecheck;
- `npm test`: 1,965 tests, 1,964 passed, 0 failed, 1 skipped, 24m43s;
- `npm run build`;
- live crawl of trainsyou.com: 39 sitemap pages and 41 internal links, all 200, each with one H1, a description, a self-canonical and valid JSON-LD;
- the `main` CI run for this exact commit `e4e2f8c` ([39913170469](https://github.com/chordsnstrings/trainer_what/actions/runs/39913170469)): every job green, browser and PostgreSQL jobs included.

**What has been built (checkpoint, not yet complete):**
- `components/marketing/home-design.tsx` (markup), `home-design-runtime.tsx` (the design's script, with clean-up for navigation in place) and `app/home-design.css`.
  - The CSS is generated from the design: `tyh-` class prefix, rules scoped to `.tyh`, logical properties.
- GSAP `3.15.0` is bundled. The design's Google Inter (with the optical-size axis) is self-hosted. The design's Pace lockup is `BRAND_ASSETS.lockupPace`.
- The home registry entry now carries the design's words, for metadata, llms files and JSON-LD:
  - adds SoftwareApplication, a 4-step HowTo and speakable selectors;
  - the meta description is shortened from 184 to 155 characters;
  - the old home renderer has been removed from `site.tsx`.

**Fidelity check against the owner's file:**
- At 1366, 1080, 720 and 390 px, all 745 elements match in tag, class, text, links and attributes.
- Computed styles match, apart from 33 `left`/`right` values written as `start`/`end`.
- Full-page reduced-motion screenshots: 0 different pixels at all four widths.
- With motion, any remaining differences are anti-aliasing on the hero button, about the same as the design file against itself (720 to 1,369 pixels).

**Fixes found by that comparison:**
- the root font size: the app's 14px against the design's 16px rem;
- global element-rule leaks;
- split text nodes;
- `backdrop-filter` dropped by the CSS compiler when it came before its `-webkit-` form.

**Behaviour check passed:** menu, sticky bar, calculator maths and its sign-up link price, campaign parameters on sign-up links, feed replay, FAQ, JSON-LD equal to the page, navigating away and back, no console errors.

**Remaining:**
- update the unit and browser tests that assert the old home;
- re-run typecheck, the unit tests, the build, the browser suites and the PostgreSQL suite;
- update the records;
- open the PR for the owner's approval.

**Next action:** update the tests.

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
