# Claude handoff

## Work in progress

### Marketing motion — merged, deploy pending (CI timeout), 22 October 2026 (Claude, updated 12:35 UTC)

Plan: `docs/MARKETING_MOTION_PLAN_2026-10-22.md` (merged as #88), with its review corrections binding. Owner decisions: "B / sure / accept the speed cost for now. we can always switch it back to motion matching the device."
- **Approved:** Variant B (all short marketing motion always on; the pinned scroll scenes still follow OS reduce motion and the member's setting), the hero additions, and the speed cost.
- **Not approved:** un-pinning the journey walkthrough on phones. It is not being built.

**Where it stands:**
- **Phase 1 is done and pushed** as `62d92a4` on `claude/repository-overview-osejlw`, in draft PR #89.
  - The switch is `MARKETING_MOTION` in `apps/web/components/marketing/motion-mode.ts`. It is "always" now; set it to "device" to restore motion that matches the device.
  - Checks run locally: 47 node tests passed; both typechecks clean; journey browser check 231/0; member motion check 0 failures; sitewide device-mode run passed.
  - Brand (38) and RTL failures are identical to `main`. Phone has 9 failures against 11 on `main`, all on member `/app/intake`.
  - The sitewide always-mode run has 25 failures. 23 are LCP/TBT/long-task budget misses that `main` also has.
  - **One open regression for Phase 2 to fix:** CLS 0.0022 on load at 1366x900 on `/` for reduce and cookie visitors, and on `/?scenes=on` under reduce.
  - PR #89 CI passed 8/8 on `0c899e1` (Phase 1 plus the handoff).
- **Phase 2 is done**, committed as `ae73c13` (08:46 UTC) and pushed at 08:58 UTC.
  - CLS fix: the browser sometimes painted the hero before its last line ("Free to join …") arrived. The bottom-aligned column then jumped 35px. This could hit any visitor.
    - The home hero now has `<link rel="expect" href="#mk-relay-cap" blocking="render">`, so the browser waits for the rest of the hero before painting.
    - A proxy that holds the HTML at that point reproduced 0.00218 before the fix. After it, every group reads 0 at 1366 and 390.
  - Micro-animations:
    - commission pills enter in order from the inline start, 80ms apart;
    - FAQ rows cascade 40ms apart;
    - the closing CTA arrow nudges once;
    - the hero `.mk-cta` arrow nudges at 2.55s and is done by 2.97s;
    - the /features ticks pop.
    - Each starts when it is itself seen (its own trigger), per the review correction.
  - Checks run: node tests 113/113; both typechecks clean; `npm run build` passed; targeted Playwright check 116/116 (390, 1366, Arabic, reduce).
  - **Not yet run:** the full `test:marketing-motion`, brand, RTL and phone suites. These are left for the single final run.
  - PR #89 CI passed 8/8 on `8bcb0cf` (Phase 2 plus the handoff).
- **Phase 3 is done**, committed as `f9c9fae` and pushed at 09:42 UTC.
  - **Scroll-scenes engine:** it no longer requests a frame forever. It wakes on scroll, resize, `fonts.ready`, `scenes-on`/`data-scenes-still` changes, `mk-scene:seek`, IntersectionObserver or ResizeObserver changes, and pointer input (only while an ambient recipe is mounted). It stops 150ms after the last wake-up.
    - Scrubbing is identical: 126 of 126 sampled positions matched the old engine at 390 and 1366.
    - New `tests/scroll-scenes-engine.test.ts` with 8 tests.
  - **Hero "trains" sweep: built, then reverted (not shipped).** The one allowed LCP comparison (5 cold loads at CPU 4x) did not prove LCP unchanged:
    - 1366: 756 → 744ms;
    - 390: 656 → 848ms (+192ms against a 50ms allowance).
    - That is probably noise, since the sweep doesn't touch the lede at 390. A retry needs a larger sample, which is the owner's call.
  - Checks run: node 121/121; both typechecks; build; targeted Playwright 58/58.
- **Reviews (three, read-only):** no blocker.
  - One major finding: in "always" mode the journey check no longer scans stage-text contrast and size per chapter. The scan only runs in "device" mode.
  - Minor findings:
    - the concept checks never run with the member cookie;
    - the hero-arrow-at-rest check cannot fail;
    - the /features tick check can skip silently;
    - nothing ties the ambient flag to the recipes that need it;
    - the /features ticks never play at phone width;
    - the doc's "ends within 2.5 s" line is stale.
  - No build with `MARKETING_MOTION="device"` has been made. Reversibility rests on static tests and reading the code.
- **Review fixes are done**, committed as `47dc175` and pushed at 10:13 UTC.
  - The journey check scans stage text (AA, 11px) per chapter in either mode.
  - The /features set table has its own trigger, so its ticks play on phones too.
  - The concept pass runs with the cookie, and the rest/tick checks can fail.
  - A static test ties `ambient` to the recipes that read time or the pointer.
  - The stale doc sentence is fixed.
  - Full `test:marketing-motion` (09:30–09:53 UTC):
    - journey: 243 passed, 0 failed;
    - sitewide: CLS 0 on load and while scrolling, for every page, width and cohort.
    - Its 7 failures were the check's own bug: the hero nudge restart used `offsetWidth`, which an SVG doesn't have. After the fix, a targeted re-run reported 0 failures.
  - The main/base timed comparison was not made, because no base build was available. Timings are reported, not judged.
  - Node 122/122 and both typechecks clean on the final tree.
- **Owner said "stalled again" at about 10:07 UTC.** The `verify-and-fix` agent had chained brand → RTL → phone → motion one at a time on `next dev`; the brand check alone took 10+ minutes with no output.
  - Claude stopped workflow `w3v1bkz5n` at 10:09 UTC. All its processes are gone.
  - Brand, RTL, phone and motion now run in parallel on the production build (`RTL_WEB_MODE=start`, each on its own ports and database), started 10:09:49 UTC.
  - Logs: `/tmp/claude-0/-home-user-trainer-what/14381359-c138-56f9-a25b-830f6a2f39f9/scratchpad/final-test-{brand,rtl,phone,motion}.log`.
- **Final suites, done 10:30 UTC:**
  - Brand: the 38 failures are identical to `main` (diffed).
  - Phone: the 11 failures are identical to `main`.
  - RTL: crashes at admin sign-in (`waitForURL` stuck on `/admin/settings`), exactly as on `main`.
  - Member motion:
    - It failed twice (1, then 2 member view-transition layout shifts) while the brand check ran alongside.
    - It passed with 0 failures run alone on a quiet machine.
    - `main` passed with 0 failures run alone (`test-motion-base-main.log`).
    - This reads as a CPU-load timing artefact.
- **PR #89 marked ready (10:33 UTC)** with these results in its body.
  - CI on head `fb85541`: 7 of 8 green; `application` still running at 10:33 UTC.
  - Pushing anything to the branch restarts the roughly 45-minute CI run. Handoff edits are therefore committed locally and go out after the merge, in a docs-only PR.
- **Merged at 10:57 UTC.** CI was 8/8 green on `fb85541`, and PR #89 was squash-merged as `827fb2de8982c16d15dc83d2ec0d5ecbaf9c1124`.
- **Main CI on `827fb2d` did not deploy.** Its `application` job was cancelled at its 45-minute `timeout-minutes` (11:41 UTC, run 39766840217), during `run-browser-check.mjs`. Live therefore stayed on `100c812`.
  - The cause was the runner, not the code: `apt-get install` took 16 min (20 s on the Phase 1 PR run) and `npm run check` took 23 min (15 min on the PR).
  - The test steps took the same time on every run. The browser check, for example, took 6.7 min each time.
  - The job's normal 30–44 min is close to its 45-minute limit.
  - Claude cannot re-run jobs (the API returns 403). So the records PR #90 was merged to start a fresh `main` run, which deploys `827fb2d`'s code plus these docs.
  - **Suggested follow-up for the owner:** raise `application`'s `timeout-minutes` in `.github/workflows/check.yml` (for example to 60), or cache the apt and Playwright installs. This is not done yet.
- **Records:** the stage entry is in `docs/COMPLETION_STAGES.md`. `docs/PROJECT_MEMORY.md` gains two rules: the switch and how to flip it back, and running browser suites in parallel on the production build.

**Waiting on the owner (optional):** whether to retry the hero "trains" sweep with a larger LCP sample (for example 15+ cold loads per width). It stays out until then.

**Next action:**
1. Watch the `main` run started by the #90 merge until the release header shows #90's merge commit. That release includes `827fb2d`.
2. Record the live time here and in the stage entry.
3. If `application` times out again, raise its timeout in a small PR. The owner can also re-run the job from the Actions page.

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
